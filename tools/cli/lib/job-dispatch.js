'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const { z, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { executorOwner, isExecutorOwnerAlive, reapExecutorOwner } = require('../../../packages/agent-isolation-attestation/executor');
const { EngineeringTaskState, engineeringDigest: digest } = require('./engineering-task-state');
const { RelationalSessionEventStore } = require('../../../packages/agent-session-store');
const authority = new AsyncLocalStorage();
const integer = z.number().int().nonnegative().safe();
const commandSchema = z
  .object({
    schema_version: z.literal(1),
    command_id: z.string().uuid(),
    resource_id: z.string().uuid(),
    expected_sequence: integer,
    fence: integer,
    action: z.enum(['dispatch', 'reconcile', 'expire', 'cancel_dependency', 'cancel']),
    input: z.object({}).strict().optional(),
  })
  .strict();
const proofSchema = z
  .object({
    task_id: z.string().uuid(),
    task_sequence: integer.positive(),
    result: z.enum(['approved', 'failed', 'blocked', 'not_executed']),
    result_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    session_id: z.string(),
    session_sequence: integer,
    terminal: z.string(),
    session_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const eventSchema = z
  .object({
    command: commandSchema,
    digest: z.string(),
    at: integer,
    phase: z.enum(['intent', 'settled', 'uncertain', 'expired', 'dependency_cancelled', 'cancelling']),
    outcome: z.enum(['running', 'succeeded', 'failed', 'cancelled', 'uncertain', 'expired', 'invalidated', 'cancelling']),
    proofs: z.array(proofSchema),
    reason: z.string().max(256),
  })
  .strict();
function reject(code) {
  throw Object.assign(new Error(code), { code });
}
function projectJobExecution(state, row, receipts, jobs) {
  const p = eventSchema.parse(row.payload),
    c = p.command;
  const previous = receipts.get(c.command_id);
  const completing = Boolean(previous?.pending);
  if (
    !state ||
    row.schema_version !== 1 ||
    c.resource_id !== state.resource_id ||
    p.digest !== digest(c) ||
    c.fence !== (state.fence || 0) ||
    (completing
      ? state.execution?.command_id !== c.command_id || row.stream_sequence !== state.current_sequence + 1
      : row.stream_sequence !== c.expected_sequence + 1) ||
    (previous && (!completing || previous.digest !== p.digest)) ||
    p.at < (state.transition_at || 0)
  )
    reject('JOB_EVENT_INVALID');
  if (p.phase === 'intent') {
    if (
      c.action !== 'dispatch' ||
      state.status !== 'claimed' ||
      state.materialization?.phase !== 'ready' ||
      state.execution ||
      p.at >= state.execution_deadline_at ||
      p.outcome !== 'running' ||
      p.proofs.length > 0
    )
      reject('JOB_EVENT_INVALID');
  } else if (p.phase === 'cancelling') {
    if (
      c.action !== 'cancel' ||
      !['running', 'uncertain'].includes(state.status) ||
      state.cancellation_requested ||
      p.outcome !== 'cancelling' ||
      p.proofs.length > 0
    )
      reject('JOB_EVENT_INVALID');
  } else if (['expired', 'dependency_cancelled'].includes(p.phase)) {
    if (
      state.status !== 'queued' ||
      p.outcome !== (p.phase === 'expired' ? 'expired' : 'cancelled') ||
      p.proofs.length > 0 ||
      (p.phase === 'expired' ? c.action !== 'expire' || p.at < Date.parse(state.deadline_at) : c.action !== 'cancel_dependency')
    )
      reject('JOB_EVENT_INVALID');
  } else {
    if (
      !state.execution ||
      !['running', 'uncertain', 'cancelling'].includes(state.status) ||
      !['dispatch', 'reconcile'].includes(c.action) ||
      (c.action === 'dispatch' && !completing)
    )
      reject('JOB_EVENT_INVALID');
    if (p.phase === 'uncertain') {
      if (p.outcome !== 'uncertain') reject('JOB_EVENT_INVALID');
    } else {
      const tasks = state.materialization.plan.tasks;
      if (
        p.proofs.length !== tasks.length ||
        new Set(p.proofs.map((x) => x.task_id)).size !== tasks.length ||
        p.proofs.some((x) => !tasks.some((t) => t.task_run_id === x.task_id && t.created.session_id === x.session_id))
      )
        reject('JOB_EVENT_INVALID');
      const approved = p.proofs.every((x) => x.result === 'approved' && x.terminal === 'completed');
      const parentTerminal =
        p.outcome === 'invalidated' &&
        state.kind === 'workflow' &&
        jobs &&
        new RelationalSessionEventStore({ ledger: jobs.control.ledger }).replay(state.materialization.plan.manifest.parent_session_id)
          .terminal_event;
      const provenDrift =
        p.outcome === 'invalidated' &&
        Boolean(parentTerminal) &&
        !p.proofs.some((proof) => proof.result === 'failed') &&
        p.proofs.some((proof) => {
          const task = new EngineeringTaskState(jobs.control.handle.db, proof.task_id).read();
          return (
            !task.started &&
            task.result?.result === 'not_executed' &&
            task.result.reason === 'JOB_BASELINE_DRIFT' &&
            proof.result_sha256 === digest(task.result)
          );
        });
      if (
        p.proofs.some((x) => x.result === 'blocked') ||
        (p.outcome === 'succeeded'
          ? !approved || state.cancellation_requested
          : p.outcome === 'cancelled'
            ? !state.cancellation_requested
            : p.outcome === 'invalidated'
              ? state.cancellation_requested || p.reason !== 'baseline-drift-drain-confirmed' || !provenDrift
              : p.outcome !== 'failed' || approved)
      )
        reject('JOB_EVENT_INVALID');
    }
  }
  const next = {
    ...state,
    status: p.outcome,
    ...(p.phase === 'cancelling' ? { cancellation_requested: true } : {}),
    current_sequence: row.stream_sequence,
    transition_at: p.at,
    execution: {
      ...state.execution,
      phase: p.phase,
      proofs: p.proofs,
      reason: p.reason,
      ...(p.phase === 'intent' ? { command_id: c.command_id, fence: c.fence } : {}),
    },
  };
  receipts.set(c.command_id, { digest: p.digest, result: structuredClone(next), pending: p.phase === 'intent' });
  return next;
}
function assertJobRuntimeAccess(db, id, options) {
  const a = authority.getStore();
  if (!a) return require('./job-materialization').assertJobExecutionDenied(db, id, options);
  const state = a.jobs.query(a.id);
  if (
    !a.active ||
    db !== a.jobs.control.handle.db ||
    state.status !== 'running' ||
    state.fence !== a.fence ||
    state.execution.command_id !== a.command ||
    state.cancellation_requested ||
    a.jobs.now() >= state.execution_deadline_at ||
    digest(state.owner) !== digest(executorOwner()) ||
    !state.materialization.plan.tasks.some((x) => x.task_run_id === id)
  )
    reject('JOB_DISPATCH_REQUIRED');
  const index = state.materialization.plan.tasks.findIndex((entry) => entry.task_run_id === id);
  const contract = state.kind === 'task' ? state.admission.input.contract : state.admission.input.definition.tasks[index].contract;
  if (
    !options?.allowBaselineDriftForWorkflowAssembly &&
    require('./engineering-workspace').projectWorkspaceSnapshot(contract).sha256 !== contract.workspace.files_sha256
  )
    reject('JOB_BASELINE_DRIFT');
  const pin = state.admission.plugin_model;
  if (pin) {
    const campaigns = a.jobs.control.providerCampaigns;
    const binding = campaigns.bindings.get(pin.binding_id);
    if (campaigns.closing || !binding || digest(binding.manifest) !== pin.binding_manifest_sha256) reject('CONTROL_PROVIDER_BINDING_DRIFT');
    const campaign = campaigns.query(pin.campaign_id);
    if (campaign.cancelled || campaigns.now() >= campaign.deadline) reject('CONTROL_CAMPAIGN_CANCELLED');
    if (campaign.unresolved_commands.length > 0) reject('CONTROL_OUTCOME_UNCERTAIN');
  }
  const view = require('./job-materialization').resolveJobView(a.jobs.control, id);
  require('../../mcp-project-state/lib/execution-ledger-schema').assertExecutionLedgerView(db, view.handle.directory);
}
function proofsFor(jobs, state) {
  const store = new RelationalSessionEventStore({ ledger: jobs.control.ledger });
  if (state.admission.plugin_model) {
    const campaignId = state.admission.plugin_model.campaign_id;
    const campaigns = jobs.control.providerCampaigns;
    const unresolved = new Set(campaigns.query(campaignId).unresolved_commands);
    const ids = new Set([state.resource_id, ...state.materialization.plan.tasks.map((t) => t.task_run_id)]);
    if (
      campaigns
        .rows(campaignId)
        .some((row) => row.payload.kind === 'reserved' && ids.has(row.payload.task_id) && unresolved.has(row.payload.command_id))
    )
      reject('JOB_OUTCOME_UNCERTAIN');
  }
  if (state.kind === 'workflow') {
    const plan = state.materialization.plan;
    const parent = store.replay(plan.manifest.parent_session_id);
    const reservation = parent.workflow_reservations[plan.manifest.definition.workflow_id];
    if (!reservation?.released || (state.cancellation_requested && parent.status !== 'cancelled')) reject('JOB_OUTCOME_UNCERTAIN');
  }
  return state.materialization.plan.tasks.map((entry) => {
    const task = new EngineeringTaskState(jobs.control.handle.db, entry.task_run_id).read();
    const rows = store.readSession(entry.created.session_id);
    const session = rows.length > 0 ? store.replay(entry.created.session_id) : null;
    const notStarted = rows.length === 0 && !task.started && task.result?.result === 'not_executed';
    if (!task.result || task.uncertainty || (!session?.terminal_event && !notStarted)) reject('JOB_OUTCOME_UNCERTAIN');
    return {
      task_id: entry.task_run_id,
      task_sequence: task.version,
      result: task.result.result,
      result_sha256: digest(task.result),
      session_id: entry.created.session_id,
      session_sequence: rows.length,
      terminal: session?.status || 'not_started',
      session_sha256: digest(rows),
    };
  });
}
class JobDispatcher {
  #jobs;
  #inflight = new Map();
  #closing = false;
  #dispatching = false;
  #running = new Set();
  #timer;
  #tick;
  #failure = null;
  constructor(jobs) {
    this.#jobs = jobs;
  }
  get failure() {
    return this.#failure;
  }
  get active() {
    return this.#inflight.size + (this.#tick ? 1 : 0);
  }
  #check(c) {
    const p = this.#jobs.project(c.resource_id),
      previous = p.receipts.get(c.command_id);
    if (previous && previous.digest !== digest(c)) reject('CONTROL_IDEMPOTENCY_CONFLICT');
    if (previous && !previous.pending) return { replay: deepFreeze(previous.result) };
    if (!p.state) reject('JOB_NOT_FOUND');
    if (
      previous?.pending
        ? p.state.execution?.command_id !== c.command_id || p.state.current_sequence < c.expected_sequence + 1
        : p.state.current_sequence !== c.expected_sequence
    )
      reject('CONTROL_SEQUENCE_CONFLICT');
    if ((p.state.fence || 0) !== c.fence) reject('JOB_FENCE_CONFLICT');
    return { state: p.state, pending: Boolean(previous?.pending) };
  }
  #append(c, phase, outcome, proofs = [], reason = '') {
    const jobs = this.#jobs;
    return jobs.control.handle.db
      .transaction(() => {
        const checked = this.#check(c);
        if (checked.replay) return checked.replay;
        const state = checked.state;
        if (phase === 'intent') {
          if (this.#closing) reject('JOB_WORKER_CLOSING');
          if (digest(state.owner) !== digest(executorOwner())) reject('JOB_OWNER_MISMATCH');
          require('./job-materialization').assertPreparationOnly(jobs.control, state);
          jobs.worker.campaign(state);
        }
        const payload = eventSchema.parse({ command: c, digest: digest(c), at: jobs.now(), phase, outcome, proofs, reason });
        projectJobExecution(
          state,
          { payload, schema_version: 1, stream_sequence: state.current_sequence + 1 },
          jobs.project(c.resource_id).receipts,
          jobs,
        );
        jobs.control.ledger.append({
          aggregate_type: 'control_job',
          aggregate_id: c.resource_id,
          expected_version: state.current_sequence,
          events: [
            {
              event_id: randomUUID(),
              event_type: 'JobExecutionRecorded',
              schema_version: 1,
              occurred_at: new Date(payload.at).toISOString(),
              correlation_id: c.resource_id,
              causation_id: c.command_id,
              actor: { type: 'hseos', id: 'job-dispatcher' },
              operation_id: null,
              evidence_refs: [],
              payload,
            },
          ],
        });
        return jobs.query(c.resource_id);
      })
      .immediate();
  }
  execute(raw) {
    const c = commandSchema.parse(raw),
      key = digest(c);
    if (this.#inflight.has(key)) return this.#inflight.get(key);
    if (this.#closing) return Promise.reject(Object.assign(new Error('JOB_WORKER_CLOSING'), { code: 'JOB_WORKER_CLOSING' }));
    if (c.action === 'dispatch' && this.#dispatching)
      return Promise.reject(Object.assign(new Error('JOB_WORKER_BUSY'), { code: 'JOB_WORKER_BUSY' }));
    if (c.action === 'dispatch') this.#dispatching = true;
    const operation = this.#execute(c).finally(() => {
      this.#inflight.delete(key);
      if (c.action === 'dispatch') this.#dispatching = false;
    });
    this.#inflight.set(key, operation);
    return operation;
  }
  async #execute(c) {
    const checked = this.#check(c);
    if (checked.replay) return checked.replay;
    const jobs = this.#jobs,
      state = checked.state;
    if (c.action === 'cancel') return this.cancel(c);
    if (c.action === 'expire') return this.#append(c, 'expired', 'expired');
    if (c.action === 'cancel_dependency') {
      if (!state.depends_on.some((id) => ['failed', 'cancelled', 'expired', 'invalidated'].includes(jobs.query(id).status)))
        reject('JOB_DEPENDENCY_PENDING');
      return this.#append(c, 'dependency_cancelled', 'cancelled', [], 'dependency-not-accepted');
    }
    if (c.action === 'reconcile') {
      if (!state.execution || isExecutorOwnerAlive(state.owner)) reject('JOB_OWNER_ALIVE');
      await reapExecutorOwner(state.owner);
      this.#check(c);
      return this.#settle(c);
    }
    if (checked.pending || state.execution) reject('JOB_OUTCOME_UNCERTAIN');
    if (state.status !== 'claimed' || state.materialization?.phase !== 'ready') reject('JOB_DISPATCH_REQUIRED');
    await jobs.worker.admit(state);
    this.#append(c, 'intent', 'running');
    this.#running.add(c.resource_id);
    const a = { jobs, id: c.resource_id, fence: c.fence, command: c.command_id, active: true };
    try {
      await authority.run(a, async () => {
        if (state.kind === 'workflow') await require('./engineering-workflow-runtime').executeJobWorkflow(jobs.control, c.resource_id);
        else await require('./engineering-task-runtime').executeJobTask(jobs.control, c.resource_id);
      });
    } catch {
      // Possible effects are never retried or rewritten as verified failure.
      return this.#append(c, 'uncertain', 'uncertain', [], 'execution-or-drain-unconfirmed');
    } finally {
      a.active = false;
      this.#running.delete(c.resource_id);
    }
    return this.#settle(c);
  }
  #settle(c) {
    const state = this.#check(c).state;
    try {
      const proofs = proofsFor(this.#jobs, state);
      if (proofs.some((p) => p.result === 'blocked')) reject('JOB_OUTCOME_UNCERTAIN');
      const baselineDrift = state.materialization.plan.tasks.some((entry) => {
        const task = new EngineeringTaskState(this.#jobs.control.handle.db, entry.task_run_id).read();
        return !task.started && task.result?.result === 'not_executed' && task.result.reason === 'JOB_BASELINE_DRIFT';
      });
      const outcome = state.cancellation_requested
        ? 'cancelled'
        : proofs.some((proof) => proof.result === 'failed')
          ? 'failed'
          : state.kind === 'workflow' && baselineDrift
            ? 'invalidated'
            : proofs.every((p) => p.result === 'approved')
              ? 'succeeded'
              : 'failed';
      if (outcome === 'invalidated') {
        const store = new RelationalSessionEventStore({ ledger: this.#jobs.control.ledger });
        if (!store.replay(state.materialization.plan.manifest.parent_session_id).terminal_event) reject('JOB_OUTCOME_UNCERTAIN');
      }
      return this.#append(
        c,
        'settled',
        outcome,
        proofs,
        baselineDrift ? 'baseline-drift-drain-confirmed' : c.action === 'reconcile' ? 'owner-drain-confirmed' : 'runtime-drain-confirmed',
      );
    } catch (error) {
      if (error.code !== 'JOB_OUTCOME_UNCERTAIN') throw error;
      return this.#append(c, 'uncertain', 'uncertain', [], 'acceptance-or-drain-unconfirmed');
    }
  }
  cancel(raw) {
    const c = commandSchema.parse(raw);
    if (c.action !== 'cancel') reject('JOB_EVENT_INVALID');
    const jobs = this.#jobs;
    return jobs.control.handle.db
      .transaction(() => {
        const checked = this.#check(c);
        if (checked.replay) return checked.replay;
        const result = this.#append(c, 'cancelling', 'cancelling');
        for (const entry of result.materialization.plan.tasks) {
          const task = new EngineeringTaskState(jobs.control.handle.db, entry.task_run_id);
          const state = task.read();
          if (!state.result && !state.cancellation) task.append({ kind: 'cancellation_requested' }, state.version);
        }
        return result;
      })
      .immediate();
  }
  async tick() {
    if (this.#tick) return this.#tick;
    if (this.#closing) return;
    this.#tick = this.#poll().finally(() => {
      this.#tick = null;
    });
    return this.#tick;
  }
  async #poll() {
    const jobs = this.#jobs;
    let after = 0;
    const seen = new Set();
    while (!this.#closing) {
      const rows = jobs.control.ledger.readGlobal({ aggregate_type: 'control_job', after_position: after, limit: 1000 });
      if (rows.length === 0) break;
      for (const row of rows) {
        if (this.#closing) break;
        if (seen.has(row.aggregate_id)) continue;
        seen.add(row.aggregate_id);
        const state = jobs.query(row.aggregate_id);
        if (state.status !== 'queued') continue;
        const command = (action) => ({
          schema_version: 1,
          command_id: randomUUID(),
          resource_id: state.resource_id,
          expected_sequence: jobs.query(state.resource_id).current_sequence,
          fence: jobs.query(state.resource_id).fence || 0,
          action,
        });
        try {
          if (jobs.now() >= Date.parse(state.deadline_at)) await this.execute(command('expire'));
          else if (state.depends_on.some((id) => ['failed', 'cancelled', 'expired', 'invalidated'].includes(jobs.query(id).status)))
            await this.execute(command('cancel_dependency'));
          else if (jobs.eligibility(state.resource_id).eligible) {
            await jobs.worker.execute({ ...command('claim'), lease_ms: 1000 });
            if (this.#closing) {
              const current = jobs.query(state.resource_id);
              await jobs.execute({
                schema_version: 1,
                command_id: randomUUID(),
                resource_id: state.resource_id,
                expected_sequence: current.current_sequence,
                action: 'cancel',
                input: {},
              });
              await jobs.worker.execute({ ...command('confirm_cancel'), lease_ms: 1000 });
              return;
            }
            await jobs.materializer.execute(command('materialize'));
            await this.execute(command('dispatch'));
          }
        } catch (error) {
          if (!['CONTROL_SEQUENCE_CONFLICT', 'JOB_NOT_ELIGIBLE', 'JOB_WORKER_CLOSING'].includes(error.code)) throw error;
        }
      }
      after = rows.at(-1).position;
    }
  }
  start({ interval_ms = 250, onError = () => {} } = {}) {
    if (typeof onError !== 'function') reject('JOB_POLL_INVALID');
    if (!Number.isInteger(interval_ms) || interval_ms < 25 || interval_ms > 60_000) reject('JOB_POLL_INVALID');
    if (this.#closing || this.#timer) reject('JOB_WORKER_CLOSING');
    this.#timer = setInterval(() => {
      this.tick().catch((error) => {
        clearInterval(this.#timer);
        this.#timer = null;
        this.#failure = Object.freeze({ code: error.code || 'JOB_POLL_FAILED' });
        onError(this.#failure);
      });
    }, interval_ms);
    this.#timer.unref();
  }
  async shutdown() {
    this.#closing = true;
    clearInterval(this.#timer);
    for (const id of this.#running) {
      const state = this.#jobs.query(id);
      if (!state.cancellation_requested)
        this.cancel({
          schema_version: 1,
          command_id: randomUUID(),
          resource_id: id,
          expected_sequence: state.current_sequence,
          fence: state.fence,
          action: 'cancel',
          input: {},
        });
    }
    await this.#tick;
    await Promise.allSettled(this.#inflight.values());
  }
}
module.exports = { JobDispatcher, projectJobExecution, assertJobRuntimeAccess };
