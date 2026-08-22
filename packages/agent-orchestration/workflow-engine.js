'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  WorkflowDefinitionSchema,
  assertPortShape,
  deepFreeze,
  parseContract,
  validatePortInput,
  validatePortResult,
} = require('../agent-runtime-contracts');
const { isRelationalSessionEventStore } = require('../agent-session-store');
const { terminalChild } = require('./local-subagent-provider');
const { digest, eventRef, stableId } = require('./utilities');

const ACTIVE_PARENT_RESERVATIONS = new WeakMap();

class WorkflowEngineError extends Error {
  constructor(message, code = 'WORKFLOW_ENGINE_INVALID', details = {}) {
    super(message);
    this.name = 'WorkflowEngineError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

class WorkflowEngine {
  #active = new Map();
  #activeParents;
  #clock;
  #engineId;
  #provider;
  #store;

  constructor({ engine_id = 'workflow:local', session_store, subagent_provider, clock = { now: () => new Date() } }) {
    if (!isRelationalSessionEventStore(session_store)) {
      throw new WorkflowEngineError('workflow engine requires the nominal relational session store');
    }
    assertPortShape('SubagentProvider', subagent_provider);
    if (!clock || typeof clock.now !== 'function') throw new WorkflowEngineError('workflow engine requires a clock');
    this.#engineId = engine_id;
    this.#store = session_store;
    this.#provider = subagent_provider;
    this.#clock = clock;
    const reservationAuthority = session_store.ledger.db || session_store.ledger;
    if (!ACTIVE_PARENT_RESERVATIONS.has(reservationAuthority)) ACTIVE_PARENT_RESERVATIONS.set(reservationAuthority, new Map());
    this.#activeParents = ACTIVE_PARENT_RESERVATIONS.get(reservationAuthority);
  }

  #checkpoint(input, workflow, phase, claimRef) {
    const parentId = input.parent_session_id;
    const definitionDigest = digest(workflow);
    const state = this.#store.replay(parentId);
    const payload = {
      workflow_id: workflow.workflow_id,
      definition_digest: definitionDigest,
      claim_ref: claimRef,
      phase_id: phase.phase_id,
      mode: phase.mode,
      completed_step_ids: phase.steps.map((step) => step.step_id),
      child_session_ids: phase.steps.map((step) => step.child_spec.session_id),
      checkpoint_ref: `workflow-checkpoint://${workflow.workflow_id}/${phase.phase_id}/${definitionDigest.slice(7, 23)}`,
    };
    const event = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      event_id: stableId('event', parentId, 'workflow.phase.checkpointed', workflow.workflow_id, phase.phase_id, definitionDigest),
      session_id: parentId,
      sequence: state.current_sequence + 1,
      occurred_at: input.occurred_at,
      event_type: 'workflow.phase.checkpointed',
      payload,
    };
    const receipt = this.#store.append({ session_id: parentId, expected_version: state.current_sequence, events: [event] });
    if (receipt.events.length !== 1 || receipt.events[0].event_id !== event.event_id) {
      throw new WorkflowEngineError('workflow checkpoint receipt is invalid', 'WORKFLOW_CHECKPOINT_RECEIPT_INVALID');
    }
    return { ...payload, event_id: event.event_id };
  }

  #validateScope(parent, workflow, manifest) {
    const steps = workflow.phases.flatMap((phase) => phase.steps);
    const reservations = Object.values(parent.workflow_reservations);
    const reservedCount = reservations.reduce((count, reservation) => count + reservation.step_count, 0);
    const legacyCount = parent.workflow_checkpoints.reduce(
      (count, checkpoint) => count + (parent.workflow_reservations[checkpoint.workflow_id] ? 0 : checkpoint.completed_step_ids?.length || 1),
      0,
    );
    const alreadyReserved = Boolean(parent.workflow_reservations[workflow.workflow_id]);
    if (reservedCount + legacyCount + (alreadyReserved ? 0 : steps.length) > parent.spec.limits.max_workflow_steps) {
      throw new WorkflowEngineError('workflow step limit exceeds the parent ceiling', 'WORKFLOW_STEP_LIMIT_EXCEEDED');
    }
    const newChildren = steps.filter((step) => !parent.children.includes(step.child_spec.session_id));
    if (newChildren.length > parent.spec.limits.max_children - parent.children.length) {
      throw new WorkflowEngineError('workflow child count exceeds the parent ceiling', 'WORKFLOW_CHILD_LIMIT_EXCEEDED');
    }
    if (workflow.max_parallelism > manifest.max_parallel_children) {
      throw new WorkflowEngineError('workflow parallelism exceeds provider capability', 'WORKFLOW_PARALLEL_LIMIT_EXCEEDED');
    }
    const joinWindows = workflow.phases.reduce(
      (count, phase) => count + (phase.mode === 'pipeline' ? phase.steps.length : Math.ceil(phase.steps.length / workflow.max_parallelism)),
      0,
    );
    if (joinWindows * workflow.join_timeout_ms > parent.spec.limits.max_duration_ms) {
      throw new WorkflowEngineError('workflow worst-case duration exceeds the parent ceiling', 'WORKFLOW_DURATION_LIMIT_EXCEEDED');
    }
    for (const step of steps) {
      if (
        step.child_spec.parent_session_id !== parent.session_id ||
        step.child_spec.authority_ref !== parent.spec.authority_ref ||
        step.child_spec.policy_ref !== parent.spec.policy_ref
      ) {
        throw new WorkflowEngineError('workflow child widens or changes parent authority', 'WORKFLOW_AUTHORITY_WIDENING');
      }
      for (const [name, value] of Object.entries(step.child_spec.limits)) {
        if (value > parent.spec.limits[name]) {
          throw new WorkflowEngineError('workflow child widens a parent resource limit', 'WORKFLOW_LIMIT_WIDENING', { limit: name });
        }
      }
    }
  }

  #reserve(input, workflow) {
    const parentId = input.parent_session_id;
    const definitionDigest = digest(workflow);
    const state = this.#store.replay(parentId);
    const existing = state.workflow_reservations[workflow.workflow_id];
    if (existing) {
      if (existing.definition_digest !== definitionDigest) {
        throw new WorkflowEngineError('workflow identifier conflicts with a durable reservation', 'WORKFLOW_DEFINITION_CONFLICT');
      }
      if (existing.released && existing.released.status !== 'completed') {
        throw new WorkflowEngineError('workflow reservation is already terminal', 'WORKFLOW_ALREADY_TERMINAL');
      }
      if (existing.released && input.resume_from_ref) {
        throw new WorkflowEngineError('completed workflow cannot consume a resume claim', 'WORKFLOW_RESUME_CLAIM_INVALID');
      }
      if (!existing.released) {
        if (!input.resume_from_ref) {
          throw new WorkflowEngineError('active workflow requires an explicit durable resume claim', 'WORKFLOW_ALREADY_ACTIVE');
        }
        if (input.resume_from_ref !== existing.claim_ref) {
          throw new WorkflowEngineError('workflow resume claim is stale', 'WORKFLOW_RESUME_CLAIM_STALE');
        }
        const now = new Date(this.#clock.now()).getTime();
        if (!Number.isFinite(now) || now <= Date.parse(existing.claim_expires_at)) {
          throw new WorkflowEngineError('workflow claim is still live and cannot be reclaimed', 'WORKFLOW_CLAIM_LIVE');
        }
        const claimExpiresAt = new Date(now + state.spec.limits.max_duration_ms).toISOString();
        const claimedAt = new Date(now).toISOString();
        const reclaim = {
          schema_version: CONTRACT_SCHEMA_VERSION,
          event_id: stableId('event', parentId, 'workflow.reclaimed', workflow.workflow_id, input.request_id, existing.claim_ref),
          session_id: parentId,
          sequence: state.current_sequence + 1,
          occurred_at: claimedAt,
          event_type: 'workflow.reclaimed',
          payload: {
            workflow_id: workflow.workflow_id,
            definition_digest: definitionDigest,
            claim_id: input.request_id,
            claim_expires_at: claimExpiresAt,
            prior_claim_ref: existing.claim_ref,
          },
        };
        this.#store.append({ session_id: parentId, expected_version: state.current_sequence, events: [reclaim] });
        return {
          ...existing,
          claim_id: input.request_id,
          claim_expires_at: claimExpiresAt,
          claim_ref: eventRef(reclaim.event_id),
        };
      }
      return existing;
    }
    if (input.resume_from_ref) {
      throw new WorkflowEngineError('workflow resume claim has no durable reservation', 'WORKFLOW_RESUME_CLAIM_INVALID');
    }
    const active = Object.values(state.workflow_reservations).find((reservation) => !reservation.released);
    if (active) throw new WorkflowEngineError('parent already has an active durable workflow', 'WORKFLOW_PARENT_ALREADY_ACTIVE');
    const childIds = workflow.phases.flatMap((phase) => phase.steps.map((step) => step.child_spec.session_id));
    const now = new Date(this.#clock.now()).getTime();
    if (!Number.isFinite(now)) throw new WorkflowEngineError('workflow clock returned an invalid instant');
    const claimExpiresAt = new Date(now + state.spec.limits.max_duration_ms).toISOString();
    const claimedAt = new Date(now).toISOString();
    const event = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      event_id: stableId('event', parentId, 'workflow.reserved', workflow.workflow_id, definitionDigest),
      session_id: parentId,
      sequence: state.current_sequence + 1,
      occurred_at: claimedAt,
      event_type: 'workflow.reserved',
      payload: {
        workflow_id: workflow.workflow_id,
        definition_digest: definitionDigest,
        claim_id: input.request_id,
        claim_expires_at: claimExpiresAt,
        step_count: childIds.length,
        child_session_ids: childIds,
      },
    };
    this.#store.append({ session_id: parentId, expected_version: state.current_sequence, events: [event] });
    return { ...event.payload, event_id: event.event_id, claim_ref: eventRef(event.event_id), released: null };
  }

  #release(input, workflow, status, claimRef) {
    const parentId = input.parent_session_id;
    const definitionDigest = digest(workflow);
    const state = this.#store.replay(parentId);
    const reservation = state.workflow_reservations[workflow.workflow_id];
    if (!reservation || reservation.definition_digest !== definitionDigest) {
      throw new WorkflowEngineError('workflow has no matching durable reservation', 'WORKFLOW_RESERVATION_MISSING');
    }
    if (reservation.claim_id !== input.request_id || reservation.claim_ref !== claimRef) {
      throw new WorkflowEngineError('workflow cannot release a claim owned by another run', 'WORKFLOW_CLAIM_LOST');
    }
    if (reservation.released) {
      if (reservation.released.status !== status) {
        throw new WorkflowEngineError('workflow release status conflicts with durable state', 'WORKFLOW_RELEASE_CONFLICT');
      }
      return reservation.released;
    }
    const event = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      event_id: stableId('event', parentId, 'workflow.released', workflow.workflow_id, definitionDigest),
      session_id: parentId,
      sequence: state.current_sequence + 1,
      occurred_at: input.occurred_at,
      event_type: 'workflow.released',
      payload: {
        workflow_id: workflow.workflow_id,
        definition_digest: definitionDigest,
        claim_ref: claimRef,
        status,
      },
    };
    this.#store.append({ session_id: parentId, expected_version: state.current_sequence, events: [event] });
    return { status, event_id: event.event_id };
  }

  #assertClaim(input, workflow, claimRef) {
    const reservation = this.#store.replay(input.parent_session_id).workflow_reservations[workflow.workflow_id];
    if (!reservation || reservation.claim_id !== input.request_id || reservation.claim_ref !== claimRef) {
      throw new WorkflowEngineError('workflow no longer owns the durable execution claim', 'WORKFLOW_CLAIM_LOST');
    }
    return reservation;
  }

  async #spawn(input, workflow, step, active) {
    if (active.cancelled) throw new WorkflowEngineError('workflow was cancelled', 'WORKFLOW_CANCELLED');
    this.#assertClaim(input, workflow, active.claimRef);
    const parent = this.#store.replay(input.parent_session_id);
    const spawnInput = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: workflow.subagent_provider_id,
      request_id: stableId('request', input.request_id, step.step_id, 'spawn'),
      parent_session_id: input.parent_session_id,
      parent_sequence: parent.current_sequence,
      child_spec: step.child_spec,
      turn_id: step.turn_id,
      message: step.message,
      occurred_at: input.occurred_at,
    };
    const operation = Promise.resolve(this.#provider.spawn(spawnInput));
    active.pending.add(operation);
    try {
      const result = await operation;
      validatePortResult('SubagentProvider', 'spawn', result, spawnInput);
      active.children.add(step.child_spec.session_id);
      if (active.cancelled) throw new WorkflowEngineError('workflow was cancelled during child spawn', 'WORKFLOW_CANCELLED');
      return result;
    } finally {
      active.pending.delete(operation);
    }
  }

  async #join(input, workflow, steps) {
    const joinInput = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: workflow.subagent_provider_id,
      request_id: stableId('request', input.request_id, steps.map((step) => step.step_id), 'join'),
      parent_session_id: input.parent_session_id,
      child_session_ids: steps.map((step) => step.child_spec.session_id),
      timeout_ms: workflow.join_timeout_ms,
    };
    const result = validatePortResult('SubagentProvider', 'join', await this.#provider.join(joinInput), joinInput);
    for (const child of result.children) {
      const durable = terminalChild(this.#store, child.child_session_id);
      if (!durable || JSON.stringify(durable) !== JSON.stringify(child)) {
        throw new WorkflowEngineError('provider child result differs from durable session state', 'WORKFLOW_CHILD_RESULT_CONFLICT', {
          child_session_id: child.child_session_id,
        });
      }
    }
    return result;
  }

  async #cancelChildren(input, workflow, active, reason) {
    if (!active.teardown) {
      active.teardown = (async () => {
        await Promise.allSettled([...active.pending]);
        const childIds = [...active.children].filter((childId) => !terminalChild(this.#store, childId));
        if (childIds.length === 0) return [];
        const cancelInput = {
          schema_version: CONTRACT_SCHEMA_VERSION,
          provider_id: workflow.subagent_provider_id,
          request_id: stableId('request', input.request_id, workflow.workflow_id, 'cancel'),
          parent_session_id: input.parent_session_id,
          child_session_ids: childIds,
          reason,
        };
        const result = await this.#provider.cancel(cancelInput);
        return validatePortResult('SubagentProvider', 'cancel', result, cancelInput).children;
      })();
    }
    return active.teardown;
  }

  async #execute(input) {
    const workflow = parseContract(WorkflowDefinitionSchema, input.workflow, 'workflow definition');
    const providerQuery = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      request_id: stableId('request', input.request_id, 'manifest'),
      provider_id: workflow.subagent_provider_id,
    };
    const manifest = validatePortResult(
      'SubagentProvider',
      'manifest',
      this.#provider.manifest(providerQuery),
      providerQuery,
    );
    const parent = this.#store.replay(input.parent_session_id);
    if (parent.terminal_event) throw new WorkflowEngineError('workflow parent is terminal', 'WORKFLOW_PARENT_TERMINAL');
    this.#validateScope(parent, workflow, manifest);
    const definitionDigest = digest(workflow);
    const durable = parent.workflow_checkpoints.filter((checkpoint) => checkpoint.workflow_id === workflow.workflow_id);
    if (durable.some((checkpoint) => checkpoint.definition_digest !== definitionDigest)) {
      throw new WorkflowEngineError('workflow identifier conflicts with a durable definition', 'WORKFLOW_DEFINITION_CONFLICT');
    }
    const claim = this.#reserve(input, workflow);
    const active = {
      input,
      workflow,
      claimRef: claim.claim_ref,
      cancelled: false,
      reason: null,
      children: new Set(),
      pending: new Set(),
      teardown: null,
    };
    this.#active.set(workflow.workflow_id, active);
    const phases = [];
    const children = [];
    const evidence = [];
    try {
      for (const phase of workflow.phases) {
        const checkpoint = durable.find((item) => item.phase_id === phase.phase_id);
        if (checkpoint) {
          const settled = checkpoint.child_session_ids.map((childId) => terminalChild(this.#store, childId));
          if (settled.some((child) => child === null)) {
            const resumed = await this.#join(input, workflow, phase.steps);
            children.push(...resumed.children);
          } else children.push(...settled);
          phases.push({ phase_id: phase.phase_id, mode: phase.mode, child_session_ids: checkpoint.child_session_ids, checkpoint_ref: checkpoint.checkpoint_ref });
          evidence.push(eventRef(checkpoint.event_id));
          continue;
        }
        if (phase.mode === 'pipeline') {
          for (const step of phase.steps) {
            await this.#spawn(input, workflow, step, active);
            const joined = await this.#join(input, workflow, [step]);
            children.push(...joined.children);
            if (joined.children.some((child) => child.status !== 'completed')) {
              throw new WorkflowEngineError('pipeline child did not complete', active.cancelled ? 'WORKFLOW_CANCELLED' : 'WORKFLOW_CHILD_FAILED');
            }
          }
        } else {
          for (let index = 0; index < phase.steps.length; index += workflow.max_parallelism) {
            const group = phase.steps.slice(index, index + workflow.max_parallelism);
            await Promise.all(group.map((step) => this.#spawn(input, workflow, step, active)));
            const joined = await this.#join(input, workflow, group);
            children.push(...joined.children);
            if (joined.children.some((child) => child.status !== 'completed')) {
              throw new WorkflowEngineError('parallel child did not complete', active.cancelled ? 'WORKFLOW_CANCELLED' : 'WORKFLOW_CHILD_FAILED');
            }
          }
        }
        this.#assertClaim(input, workflow, active.claimRef);
        const recorded = this.#checkpoint(input, workflow, phase, active.claimRef);
        phases.push({ phase_id: phase.phase_id, mode: phase.mode, child_session_ids: recorded.child_session_ids, checkpoint_ref: recorded.checkpoint_ref });
        evidence.push(eventRef(recorded.event_id));
      }
      const released = this.#release(input, workflow, 'completed', active.claimRef);
      evidence.push(eventRef(released.event_id));
      return { status: 'completed', phases, children, evidence };
    } catch (error) {
      if (error?.code === 'WORKFLOW_CLAIM_LOST') throw error;
      active.cancelled = active.cancelled || error?.code === 'WORKFLOW_CANCELLED';
      const cancelled = await this.#cancelChildren(input, workflow, active, active.reason || 'workflow teardown after failure');
      children.push(...cancelled);
      const orphan = [...active.children].find((childId) => !terminalChild(this.#store, childId));
      if (orphan) throw new WorkflowEngineError('workflow teardown left an orphan child', 'WORKFLOW_ORPHAN_CHILD', { child_session_id: orphan });
      const status = active.cancelled ? 'cancelled' : 'failed';
      const released = this.#release(input, workflow, status, active.claimRef);
      evidence.push(eventRef(released.event_id));
      return { status, phases, children, evidence };
    } finally {
      this.#active.delete(workflow.workflow_id);
    }
  }

  async run(value) {
    const input = validatePortInput('WorkflowEngine', 'run', value);
    if (input.engine_id !== this.#engineId) throw new WorkflowEngineError('workflow engine identity mismatch');
    if (this.#active.has(input.workflow.workflow_id)) {
      throw new WorkflowEngineError('workflow identifier is already active', 'WORKFLOW_ALREADY_ACTIVE');
    }
    if (this.#activeParents.has(input.parent_session_id)) {
      throw new WorkflowEngineError('parent already has an active workflow', 'WORKFLOW_PARENT_ALREADY_ACTIVE');
    }
    this.#activeParents.set(input.parent_session_id, input.workflow.workflow_id);
    let result;
    try {
      result = await this.#execute(input);
    } finally {
      if (this.#activeParents.get(input.parent_session_id) === input.workflow.workflow_id) {
        this.#activeParents.delete(input.parent_session_id);
      }
    }
    const uniqueChildren = [...new Map(result.children.map((child) => [child.child_session_id, child])).values()];
    return validatePortResult('WorkflowEngine', 'run', {
      schema_version: CONTRACT_SCHEMA_VERSION,
      engine_id: this.#engineId,
      request_id: input.request_id,
      parent_session_id: input.parent_session_id,
      workflow_id: input.workflow.workflow_id,
      status: result.status,
      phases: result.phases,
      children: uniqueChildren,
      evidence_refs: result.evidence,
    }, input);
  }

  async cancel(value) {
    const input = validatePortInput('WorkflowEngine', 'cancel', value);
    if (input.engine_id !== this.#engineId) throw new WorkflowEngineError('workflow engine identity mismatch');
    const active = this.#active.get(input.workflow_id);
    if (!active || active.input.parent_session_id !== input.parent_session_id) {
      throw new WorkflowEngineError('workflow is not active under this parent', 'WORKFLOW_NOT_ACTIVE');
    }
    active.cancelled = true;
    active.reason = input.reason;
    const children = await this.#cancelChildren(active.input, active.workflow, active, input.reason);
    return validatePortResult('WorkflowEngine', 'cancel', {
      schema_version: CONTRACT_SCHEMA_VERSION,
      engine_id: this.#engineId,
      request_id: input.request_id,
      parent_session_id: input.parent_session_id,
      workflow_id: input.workflow_id,
      status: 'cancelled',
      phases: [],
      children,
      evidence_refs: children.map((child) => child.outcome_ref),
    }, input);
  }

  async dispose(value) {
    const input = validatePortInput('WorkflowEngine', 'dispose', value);
    if (input.engine_id !== this.#engineId) throw new WorkflowEngineError('workflow engine identity mismatch');
    for (const active of [...this.#active.values()]) {
      active.cancelled = true;
      active.reason = input.reason;
      await this.#cancelChildren(active.input, active.workflow, active, input.reason);
    }
    return validatePortResult('WorkflowEngine', 'dispose', {
      schema_version: CONTRACT_SCHEMA_VERSION,
      request_id: input.request_id,
      provider_id: this.#engineId,
      accepted: true,
      evidence_refs: [],
    }, input);
  }
}

Object.freeze(WorkflowEngine.prototype);

module.exports = { WorkflowEngine, WorkflowEngineError };
