'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  SubagentProviderManifestSchema,
  assertPortShape,
  deepFreeze,
  parseContract,
  validatePortInput,
  validatePortResult,
} = require('../agent-runtime-contracts');
const { isRelationalSessionEventStore } = require('../agent-session-store');
const { canonicalJson, eventRef, stableId } = require('./utilities');

class SubagentProviderError extends Error {
  constructor(message, code = 'SUBAGENT_PROVIDER_INVALID', details = {}) {
    super(message);
    this.name = 'SubagentProviderError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function terminalChild(store, childId) {
  const state = store.replay(childId);
  if (!state.terminal_event) return null;
  const type = state.terminal_event.event_type;
  return {
    child_session_id: childId,
    status: type === 'session.completed' ? 'completed' : type === 'session.cancelled' ? 'cancelled' : 'failed',
    outcome_ref: eventRef(state.terminal_event.event_id),
  };
}

class LocalSubagentProvider {
  #active = new Map();
  #manifest;
  #runtime;
  #store;

  constructor({ session_store, agent_runtime, provider_id = 'subagent:local', provider_version = '1.0.0', max_parallel_children = 8 }) {
    if (!isRelationalSessionEventStore(session_store)) {
      throw new SubagentProviderError('local subagents require the nominal relational session store');
    }
    assertPortShape('AgentRuntime', agent_runtime);
    this.#store = session_store;
    this.#runtime = agent_runtime;
    this.#manifest = parseContract(SubagentProviderManifestSchema, {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id,
      provider_version,
      capabilities: ['spawn', 'join', 'cancel'],
      max_parallel_children,
    });
  }

  manifest(value) {
    const input = validatePortInput('SubagentProvider', 'manifest', value);
    return validatePortResult('SubagentProvider', 'manifest', this.#manifest, input);
  }

  async spawn(value) {
    const input = validatePortInput('SubagentProvider', 'spawn', value);
    if (input.provider_id !== this.#manifest.provider_id) throw new SubagentProviderError('provider identity mismatch');
    const existingEvents = this.#store.readSession(input.child_spec.session_id);
    const existingState = existingEvents.length ? this.#store.replay(input.child_spec.session_id) : null;
    const existingTerminal = existingState ? terminalChild(this.#store, input.child_spec.session_id) : null;
    const activeNonTerminal = [...this.#active.keys()].filter((childId) => !terminalChild(this.#store, childId)).length;
    if (!this.#active.has(input.child_spec.session_id) && !existingTerminal && activeNonTerminal >= this.#manifest.max_parallel_children) {
      throw new SubagentProviderError('parallel child cap is exhausted', 'SUBAGENT_PARALLEL_LIMIT_EXCEEDED');
    }
    const ids = {
      attached: stableId('event', input.parent_session_id, 'child.attached', input.child_spec.session_id),
      created: stableId('event', input.child_spec.session_id, 'session.created'),
      forked: stableId('event', input.child_spec.session_id, 'session.forked', input.parent_session_id),
      requested: stableId('event', input.child_spec.session_id, 'subagent.requested'),
    };
    const childRequest = { provider_id: input.provider_id, turn_id: input.turn_id, message: input.message };
    let fork;
    if (existingState) {
      const attachment = this.#store
        .readSession(input.parent_session_id)
        .find((event) => event.event_type === 'child.attached' && event.payload.child_session_id === input.child_spec.session_id);
      if (
        !attachment ||
        canonicalJson(existingState.spec) !== canonicalJson(input.child_spec) ||
        existingState.parent?.parent_session_id !== input.parent_session_id ||
        canonicalJson(
          existingState.subagent_request && {
            provider_id: existingState.subagent_request.provider_id,
            turn_id: existingState.subagent_request.turn_id,
            message: existingState.subagent_request.message,
          },
        ) !== canonicalJson(childRequest)
      ) {
        throw new SubagentProviderError('existing child identity or scope differs', 'SUBAGENT_CHILD_CONFLICT');
      }
      fork = {
        parent: { idempotent: true, events: [attachment] },
        child: { idempotent: true, events: existingEvents.slice(0, 3) },
      };
    } else {
      fork = this.#store.forkSession({
        parent_session_id: input.parent_session_id,
        parent_sequence: input.parent_sequence,
        child_spec: input.child_spec,
        child_request: childRequest,
        event_ids: ids,
        occurred_at: input.occurred_at,
      });
    }
    let task = this.#active.get(input.child_spec.session_id);
    if (!task && !terminalChild(this.#store, input.child_spec.session_id)) {
      const sendInput = {
        schema_version: CONTRACT_SCHEMA_VERSION,
        command: 'send',
        session_id: input.child_spec.session_id,
        turn_id: input.turn_id,
        message: input.message,
      };
      task = Promise.resolve()
        .then(() => this.#runtime.send(sendInput))
        .then((result) => validatePortResult('AgentRuntime', 'send', result, sendInput))
        .catch(async (error) => {
          const cancelInput = {
            schema_version: CONTRACT_SCHEMA_VERSION,
            command: 'cancel',
            session_id: input.child_spec.session_id,
            reason: 'subagent execution failed',
            cascade: true,
          };
          try {
            const result = await this.#runtime.cancel(cancelInput);
            validatePortResult('AgentRuntime', 'cancel', result, cancelInput);
          } catch (cancelError) {
            throw new SubagentProviderError('child failure could not be terminalized', 'SUBAGENT_ORPHAN_CHILD', {
              cause_code: cancelError?.code || error?.code || 'unknown',
            });
          }
          throw new SubagentProviderError('child runtime failed after terminal teardown', 'SUBAGENT_RUNTIME_FAILED', {
            cause_code: error?.code || 'unknown',
          });
        });
      this.#active.set(input.child_spec.session_id, task);
    }
    const result = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: this.#manifest.provider_id,
      request_id: input.request_id,
      parent_session_id: input.parent_session_id,
      child_session_id: input.child_spec.session_id,
      accepted: !fork.child.idempotent,
      terminal: Boolean(terminalChild(this.#store, input.child_spec.session_id)),
      event_refs: [...fork.parent.events, ...fork.child.events].map((event) => eventRef(event.event_id)),
    };
    return validatePortResult('SubagentProvider', 'spawn', result, input);
  }

  #assertChildren(parentId, childIds) {
    const parent = this.#store.replay(parentId);
    if (childIds.some((childId) => !parent.children.includes(childId))) {
      throw new SubagentProviderError('child is not attached to the requested parent', 'SUBAGENT_PARENT_MISMATCH');
    }
  }

  #cancellationOrder(childIds) {
    const visited = new Set();
    const ordered = [];
    const visit = (childId) => {
      if (visited.has(childId)) return;
      if (visited.size >= 4096) throw new SubagentProviderError('child tree exceeds the traversal bound', 'SUBAGENT_TREE_LIMIT_EXCEEDED');
      visited.add(childId);
      const state = this.#store.replay(childId);
      for (const descendantId of state.children) visit(descendantId);
      ordered.push(childId);
    };
    for (const childId of childIds) visit(childId);
    return ordered;
  }

  async #settle(input, cancelReason = null) {
    this.#assertChildren(input.parent_session_id, input.child_session_ids);
    const settleIds = cancelReason ? this.#cancellationOrder(input.child_session_ids) : input.child_session_ids;
    if (cancelReason) {
      await Promise.all(
        settleIds.map(async (childId) => {
          if (terminalChild(this.#store, childId)) return;
          const cancelInput = {
            schema_version: CONTRACT_SCHEMA_VERSION,
            command: 'cancel',
            session_id: childId,
            reason: cancelReason,
            cascade: true,
          };
          const result = await this.#runtime.cancel(cancelInput);
          validatePortResult('AgentRuntime', 'cancel', result, cancelInput);
        }),
      );
    }
    const tasks = settleIds.map((childId) => this.#active.get(childId)).filter(Boolean);
    const wait = Promise.allSettled(tasks);
    const timeoutMs = 'timeout_ms' in input ? input.timeout_ms : 5000;
    let timer;
    const timedOut = await Promise.race([
      wait.then(() => false),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (timedOut && !cancelReason) return this.#settle({ ...input, timeout_ms: 5000 }, 'subagent join deadline exceeded');
    const taskOutcomes = await wait;
    const settledTree = settleIds.map((childId) => terminalChild(this.#store, childId));
    if (settledTree.some((child) => child === null)) {
      throw new SubagentProviderError('child did not reach a terminal state', 'SUBAGENT_ORPHAN_CHILD');
    }
    for (const childId of settleIds) this.#active.delete(childId);
    const rejected = taskOutcomes.find((outcome) => outcome.status === 'rejected');
    if (rejected) throw rejected.reason;
    const children = input.child_session_ids.map((childId) => terminalChild(this.#store, childId));
    return {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: this.#manifest.provider_id,
      request_id: input.request_id,
      parent_session_id: input.parent_session_id,
      all_terminal: true,
      children,
      evidence_refs: settledTree.map((child) => child.outcome_ref),
    };
  }

  async join(value) {
    const input = validatePortInput('SubagentProvider', 'join', value);
    if (input.provider_id !== this.#manifest.provider_id) throw new SubagentProviderError('provider identity mismatch');
    const result = await this.#settle(input);
    return validatePortResult('SubagentProvider', 'join', result, input);
  }

  async cancel(value) {
    const input = validatePortInput('SubagentProvider', 'cancel', value);
    if (input.provider_id !== this.#manifest.provider_id) throw new SubagentProviderError('provider identity mismatch');
    const result = await this.#settle(input, input.reason);
    return validatePortResult('SubagentProvider', 'cancel', result, input);
  }

  async dispose(value) {
    const input = validatePortInput('SubagentProvider', 'dispose', value);
    if (input.provider_id !== this.#manifest.provider_id) throw new SubagentProviderError('provider identity mismatch');
    const groups = new Map();
    for (const childId of this.#active.keys()) {
      const parentId = this.#store.replay(childId).parent?.parent_session_id;
      if (parentId) groups.set(parentId, [...(groups.get(parentId) || []), childId]);
    }
    for (const [parentId, childIds] of groups) {
      await this.cancel({
        schema_version: CONTRACT_SCHEMA_VERSION,
        provider_id: input.provider_id,
        request_id: stableId('request', input.request_id, parentId),
        parent_session_id: parentId,
        child_session_ids: childIds,
        reason: input.reason,
      });
    }
    return validatePortResult(
      'SubagentProvider',
      'dispose',
      {
        schema_version: CONTRACT_SCHEMA_VERSION,
        request_id: input.request_id,
        provider_id: input.provider_id,
        accepted: true,
        evidence_refs: [],
      },
      input,
    );
  }
}

Object.freeze(LocalSubagentProvider.prototype);

module.exports = { LocalSubagentProvider, SubagentProviderError, terminalChild };
