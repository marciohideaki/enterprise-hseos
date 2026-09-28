'use strict';

const { randomUUID } = require('node:crypto');
const { z, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { executorOwnerSchema } = require('./engineering-task-state');
const { executorOwner, isExecutorOwnerAlive, reapExecutorOwner } = require('../../../packages/agent-isolation-attestation/executor');
const { jobDigest } = require('../../lib/job-contract');
const { projectWorkspaceSnapshot } = require('./engineering-workspace');
const integer = z.number().int().nonnegative().safe();
const ownerSchema = executorOwnerSchema.extend({ pid: integer.positive(), resource_parent: z.string().min(1) });
const commandSchema = z
  .object({
    schema_version: z.literal(1),
    command_id: z.string().uuid(),
    resource_id: z.string().uuid(),
    expected_sequence: integer,
    fence: integer,
    action: z.enum(['claim', 'renew', 'reconcile', 'confirm_cancel']),
    lease_ms: integer.positive().max(60_000),
  })
  .strict();
const eventSchema = z
  .object({
    command: commandSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    phase: z.enum(['claimed', 'renewed', 'recovering', 'recovered', 'cancelled']),
    at: integer,
    owner: ownerSchema,
  })
  .strict();
function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function duration(state) {
  return state.kind === 'task'
    ? state.admission.input.contract.limits.max_duration_ms
    : state.admission.input.definition.limits.max_duration_ms;
}
function sameOwner(a, b) {
  return jobDigest(a) === jobDigest(b);
}

/** Pure replay: no process inspection, filesystem admission or effects. */
function projectJobLifecycle(state, row, receipts) {
  const payload = eventSchema.parse(row.payload);
  const { command, phase, at, owner } = payload;
  const previous = receipts.get(command.command_id);
  const completing = phase === 'recovered';
  if (
    !state ||
    row.schema_version !== 1 ||
    command.resource_id !== state.resource_id ||
    payload.digest !== jobDigest(command) ||
    at < (state.transition_at || 0) ||
    command.fence !== (state.fence || 0) ||
    command.expected_sequence + (completing ? 2 : 1) !== row.stream_sequence ||
    (completing ? !previous?.pending || previous.digest !== payload.digest : Boolean(previous))
  )
    reject('JOB_EVENT_INVALID');
  if (completing && (state.recovery_command_id !== command.command_id || !['recovering', 'cancelling'].includes(state.status)))
    reject('JOB_EVENT_INVALID');
  let next = { ...state, current_sequence: row.stream_sequence, transition_at: at };
  switch (phase) {
    case 'claimed': {
      if (
        command.action !== 'claim' ||
        state.status !== 'queued' ||
        at < Date.parse(state.not_before) ||
        at >= Date.parse(state.deadline_at)
      )
        reject('JOB_EVENT_INVALID');
      next = {
        ...next,
        status: 'claimed',
        fence: 1,
        owner,
        first_started_at: at,
        execution_deadline_at: Math.min(Date.parse(state.deadline_at), at + duration(state)),
      };

      break;
    }
    case 'renewed': {
      if (command.action !== 'renew' || state.status !== 'claimed' || !sameOwner(owner, state.owner) || at >= state.execution_deadline_at)
        reject('JOB_EVENT_INVALID');

      break;
    }
    case 'recovering': {
      if (command.action !== 'reconcile' || !['claimed', 'recovering', 'cancelling'].includes(state.status)) reject('JOB_EVENT_INVALID');
      next.status = state.cancellation_requested ? 'cancelling' : 'recovering';
      next.recovery_command_id = command.command_id;

      break;
    }
    case 'recovered': {
      if (command.action !== 'reconcile') reject('JOB_EVENT_INVALID');
      next.status = state.cancellation_requested ? 'cancelled' : at >= state.execution_deadline_at ? 'expired' : 'claimed';
      next.fence = state.fence + 1;
      if (!Number.isSafeInteger(next.fence)) reject('JOB_EVENT_INVALID');
      next.owner = owner;
      delete next.recovery_command_id;

      break;
    }
    default: {
      if (command.action !== 'confirm_cancel' || state.status !== 'cancelling' || !sameOwner(owner, state.owner))
        reject('JOB_EVENT_INVALID');
      next.status = 'cancelled';
    }
  }
  if (['claimed', 'renewed', 'recovered'].includes(phase)) next.lease_until = Math.min(at + command.lease_ms, next.execution_deadline_at);
  receipts.set(command.command_id, { digest: payload.digest, result: structuredClone(next), pending: phase === 'recovering' });
  return next;
}

/** Claims own the queue only. Materialization remains a separately fenced operation. */
class JobWorker {
  constructor(jobs) {
    this.jobs = jobs;
    this.control = jobs.control;
  }
  inspect(command) {
    const projected = this.jobs.project(command.resource_id);
    const previous = projected.receipts.get(command.command_id);
    if (previous && previous.digest !== jobDigest(command)) reject('CONTROL_IDEMPOTENCY_CONFLICT');
    if (previous && !previous.pending) return { replay: deepFreeze(previous.result) };
    const state = projected.state;
    if (!state) reject('JOB_NOT_FOUND');
    if (state.current_sequence !== command.expected_sequence + (previous?.pending ? 1 : 0)) reject('CONTROL_SEQUENCE_CONFLICT');
    if ((state.fence || 0) !== command.fence) reject('JOB_FENCE_CONFLICT');
    if (previous?.pending && state.recovery_command_id !== command.command_id) reject('JOB_FENCE_CONFLICT');
    return { state, pending: Boolean(previous?.pending) };
  }
  unmaterialized(state) {
    // This queue-only recovery cannot certify effects owned by the execution aggregate.
    if (this.control.rows(state.resource_id).length > 0) require('./job-materialization').assertPreparationOnly(this.control, state);
  }
  campaign(state) {
    const pin = state.admission.plugin_model;
    if (!pin) return;
    const campaigns = this.control.providerCampaigns;
    const binding = campaigns.bindings.get(pin.binding_id);
    if (campaigns.closing || !binding || jobDigest(binding.manifest) !== pin.binding_manifest_sha256)
      reject('CONTROL_PROVIDER_BINDING_DRIFT');
    campaigns.admitDispatch(pin.campaign_id, { binding_id: pin.binding_id, task_id: state.resource_id }, binding);
  }
  async admit(state) {
    const admission = await this.control.admitCreation(
      state.kind === 'task' ? 'create' : 'create_workflow',
      state.definition,
      state.resource_id,
      state.execution_deadline_at || Date.parse(state.deadline_at),
    );
    if (jobDigest(admission) !== state.admission_sha256) reject('JOB_ADMISSION_DRIFT');
    const contracts = state.kind === 'task' ? [admission.input.contract] : admission.input.definition.tasks.map((entry) => entry.contract);
    for (const contract of contracts)
      if (projectWorkspaceSnapshot(contract).sha256 !== contract.workspace.files_sha256) reject('JOB_BASELINE_DRIFT');
    this.campaign(state);
  }
  #append(command, phase, owner) {
    return this.control.handle.db
      .transaction(() => {
        const checked = this.inspect(command);
        if (checked.replay) return checked.replay;
        const { state } = checked;
        this.unmaterialized(state);
        const at = this.jobs.now();
        if (phase === 'claimed') {
          if (!this.jobs.eligibility(state.resource_id, at).eligible) reject('JOB_NOT_ELIGIBLE');
          this.campaign(state);
        }
        if (phase === 'renewed' && at >= state.execution_deadline_at) reject('JOB_EXPIRED');
        if (phase === 'recovered') {
          if (isExecutorOwnerAlive(state.owner)) reject('JOB_OWNER_ALIVE');
          if (!state.cancellation_requested && at < state.execution_deadline_at) this.campaign(state);
        }
        const payload = eventSchema.parse({ command, digest: jobDigest(command), phase, at, owner });
        const row = { payload, schema_version: 1, stream_sequence: state.current_sequence + 1 };
        projectJobLifecycle(state, row, this.jobs.project(state.resource_id).receipts);
        this.control.ledger.append({
          aggregate_type: 'control_job',
          aggregate_id: state.resource_id,
          expected_version: state.current_sequence,
          events: [
            {
              event_id: randomUUID(),
              event_type: 'JobLifecycleRecorded',
              schema_version: 1,
              occurred_at: new Date(at).toISOString(),
              correlation_id: state.resource_id,
              causation_id: command.command_id,
              actor: { type: 'hseos', id: 'local-job-worker' },
              operation_id: null,
              evidence_refs: [],
              payload,
            },
          ],
        });
        return this.jobs.query(state.resource_id);
      })
      .immediate();
  }
  async execute(raw) {
    const command = commandSchema.parse(raw);
    const checked = this.inspect(command);
    if (checked.replay) return checked.replay;
    const { state } = checked;
    this.unmaterialized(state);
    const owner = ownerSchema.parse(executorOwner());
    if (command.action === 'claim') {
      if (!this.jobs.eligibility(state.resource_id).eligible) {
        const concurrent = this.inspect(command);
        if (concurrent.replay) return concurrent.replay;
        reject('JOB_NOT_ELIGIBLE');
      }
      await this.admit(state);
      return this.#append(command, 'claimed', owner);
    }
    if (command.action === 'reconcile') {
      if (!['claimed', 'recovering', 'cancelling'].includes(state.status)) reject('JOB_TERMINAL');
      if (isExecutorOwnerAlive(state.owner)) reject('JOB_OWNER_ALIVE');
      if (!checked.pending) this.#append(command, 'recovering', owner);
      await reapExecutorOwner(state.owner);
      // Cancellation/deadline/sequence/owner are checked again after asynchronous drain.
      const afterDrain = this.inspect(command);
      if (afterDrain.replay) return afterDrain.replay;
      const current = afterDrain.state;
      if (!sameOwner(current.owner, state.owner) || isExecutorOwnerAlive(current.owner)) reject('JOB_OWNER_CHANGED');
      if (!current.cancellation_requested && this.jobs.now() < current.execution_deadline_at) await this.admit(current);
      return this.#append(command, 'recovered', owner);
    }
    if (!sameOwner(owner, state.owner)) reject('JOB_OWNER_MISMATCH');
    return this.#append(command, command.action === 'renew' ? 'renewed' : 'cancelled', owner);
  }
}
module.exports = { JobWorker, projectJobLifecycle };
