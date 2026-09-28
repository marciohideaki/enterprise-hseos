'use strict';

const { randomUUID } = require('node:crypto');
const { z, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { parseJobCommand, parseJobExpansion, jobDigest } = require('../../lib/job-contract');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const admissionSchema = z
  .object({
    input: z.record(z.string(), z.json()),
    selection: z.unknown().optional(),
    plugin_model: z.unknown().optional(),
    binding: z.unknown().optional(),
    binding_sha256: hash.optional(),
  })
  .strict();
const eventSchema = z
  .object({
    command: z.unknown(),
    digest: hash,
    admission: admissionSchema.optional(),
    admission_sha256: hash.optional(),
  })
  .strict();
function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateAdmission(command, admission) {
  const input = require('./engineering-control').parseCreationInput(
    command.input.kind === 'task' ? 'create' : 'create_workflow',
    command.input.definition,
  );
  if (jobDigest(input) !== jobDigest(admission.input)) reject('JOB_EVENT_INVALID');
  if (Boolean(input.binding_id) !== Boolean(admission.binding) || Boolean(admission.binding) !== Boolean(admission.binding_sha256))
    reject('JOB_EVENT_INVALID');
  if (admission.binding) {
    const binding = require('./engineering-model').validateEngineeringBinding(admission.binding);
    if (jobDigest(binding) !== admission.binding_sha256) reject('JOB_EVENT_INVALID');
  }
  const selected = [...(input.extension_ids || []), ...(input.plugin_model ? [input.plugin_model.selection_id] : [])];
  if (selected.length > 0 !== Boolean(admission.selection)) reject('JOB_EVENT_INVALID');
  if (admission.selection) {
    const selection = require('../../lib/execution-plugin-selection').parseExecutionPluginSelection(admission.selection);
    if (jobDigest([...new Set(selected)].sort()) !== jobDigest([...selection.selected].sort())) reject('JOB_EVENT_INVALID');
  }
  if (Boolean(input.plugin_model) !== Boolean(admission.plugin_model)) reject('JOB_EVENT_INVALID');
  if (admission.plugin_model) {
    const model = require('./engineering-plugin-model').parseTaskPluginModel(admission.plugin_model, admission.selection);
    if (
      model.resource_id !== command.resource_id ||
      model.selection_id !== input.plugin_model.selection_id ||
      model.campaign_id !== input.plugin_model.campaign_id
    )
      reject('JOB_EVENT_INVALID');
  }
}

const expansionEventSchema = z
  .object({
    command: z.unknown(),
    digest: hash,
    admission: admissionSchema,
    admission_sha256: hash,
    at: z.number().int().nonnegative().safe(),
  })
  .strict();
function assertInitialWorkflow(input) {
  const definition = input.definition;
  if (definition?.schema_version === 2 && (definition.revision !== 1 || definition.previous_definition_sha256 !== null))
    reject('JOB_WORKFLOW_REVISION_INVALID');
}
function expandedDefinition(state, command) {
  if (!state || state.kind !== 'workflow' || state.status !== 'queued' || state.fence || state.materialization || state.execution)
    reject('JOB_EXPANSION_DENIED');
  const previous = state.admission.input.definition;
  if (previous.schema_version !== 2) reject('JOB_EXPANSION_DENIED');
  if (jobDigest(previous) !== command.input.definition_sha256) reject('JOB_DEFINITION_CONFLICT');
  return require('./engineering-workflow-runtime').parseEngineeringWorkflow({
    ...previous,
    revision: previous.revision + 1,
    previous_definition_sha256: jobDigest(previous),
    tasks: [...previous.tasks, ...command.input.nodes],
  }).definition;
}
function projectExpansion(state, row, receipts) {
  const payload = expansionEventSchema.parse(row.payload);
  const command = parseJobExpansion(payload.command);
  if (
    !state ||
    row.schema_version !== 1 ||
    command.resource_id !== state.resource_id ||
    row.stream_sequence !== state.current_sequence + 1 ||
    command.expected_sequence !== state.current_sequence ||
    receipts.has(command.command_id) ||
    payload.digest !== jobDigest(command) ||
    payload.admission_sha256 !== jobDigest(payload.admission) ||
    payload.at !== Date.parse(row.occurred_at) ||
    payload.at < (state.transition_at || 0) ||
    payload.at >= Date.parse(state.deadline_at)
  )
    reject('JOB_EVENT_INVALID');
  const definition = expandedDefinition(state, command);
  validateAdmission({ ...command, input: { kind: 'workflow', definition: { definition } } }, payload.admission);
  const next = {
    ...state,
    definition: payload.admission.input,
    admission: payload.admission,
    admission_sha256: payload.admission_sha256,
    current_sequence: row.stream_sequence,
    transition_at: payload.at,
  };
  receipts.set(command.command_id, { digest: payload.digest, result: structuredClone(next) });
  return next;
}

/** Durable data-only queue. Dispatch and ownership are separate governed transitions. */
class JobControl {
  constructor(control, { now = Date.now } = {}) {
    this.control = control;
    this.now = now;
    this.worker = new (require('./job-worker').JobWorker)(this);
    this.dispatcher = new (require('./job-dispatch').JobDispatcher)(this);
    this.materializer = new (require('./job-materialization').JobMaterializer)(this);
  }
  rows(id) {
    z.string().uuid().parse(id);
    return this.control.ledger.readStream('control_job', id);
  }
  project(id, rows = this.rows(id)) {
    let state;
    const receipts = new Map();
    for (const row of rows) {
      if (row.event_type === 'JobWorkflowExpanded') {
        state = projectExpansion(state, row, receipts);
        continue;
      }
      if (row.event_type === 'JobExecutionRecorded') {
        state = require('./job-dispatch').projectJobExecution(state, row, receipts);
        continue;
      }
      if (row.event_type === 'JobMaterializationRecorded') {
        state = require('./job-materialization').projectJobMaterialization(state, row, receipts);
        continue;
      }
      if (row.event_type === 'JobLifecycleRecorded') {
        state = require('./job-worker').projectJobLifecycle(state, row, receipts);
        continue;
      }
      if (row.event_type !== 'JobCommandRecorded' || row.schema_version !== 1) reject('JOB_EVENT_INVALID');
      const payload = eventSchema.parse(row.payload);
      const command = parseJobCommand(payload.command);
      if (
        command.resource_id !== id ||
        command.expected_sequence !== row.stream_sequence - 1 ||
        jobDigest(command) !== payload.digest ||
        receipts.has(command.command_id)
      )
        reject('JOB_EVENT_INVALID');
      if (command.action === 'create') {
        if (state || row.stream_sequence !== 1 || !payload.admission || jobDigest(payload.admission) !== payload.admission_sha256)
          reject('JOB_EVENT_INVALID');
        validateAdmission(command, payload.admission);
        if (command.input.kind === 'workflow') assertInitialWorkflow(payload.admission.input);
        state = {
          schema_version: 1,
          resource_id: id,
          execution_resource_id: id,
          status: 'queued',
          current_sequence: row.stream_sequence,
          ...command.input,
          admission: payload.admission,
          admission_sha256: payload.admission_sha256,
        };
      } else {
        if (!state || !['queued', 'claimed', 'recovering'].includes(state.status) || payload.admission || payload.admission_sha256)
          reject('JOB_EVENT_INVALID');
        state = {
          ...state,
          status: state.status === 'queued' ? 'cancelled' : 'cancelling',
          cancellation_requested: true,
          current_sequence: row.stream_sequence,
        };
      }
      receipts.set(command.command_id, { digest: payload.digest, result: structuredClone(state) });
    }
    return { state, receipts };
  }
  query(id) {
    const { state } = this.project(id);
    if (!state) reject('JOB_NOT_FOUND');
    return deepFreeze(state);
  }
  eligibility(id, now = this.now()) {
    z.number().int().nonnegative().safe().parse(now);
    const state = this.query(id);
    if (state.status !== 'queued') return { eligible: false, reason: 'terminal' };
    if (now >= Date.parse(state.deadline_at)) return { eligible: false, reason: 'expired' };
    if (now < Date.parse(state.not_before)) return { eligible: false, reason: 'scheduled' };
    if (state.depends_on.some((id) => this.query(id).status !== 'succeeded')) return { eligible: false, reason: 'dependencies' };
    return { eligible: true, reason: 'admission-required' };
  }
  events(id, { after = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) reject('CONTROL_QUERY_INVALID');
    this.query(id);
    const events = this.rows(id)
      .filter((row) => row.stream_sequence > after)
      .slice(0, limit);
    return { resource_id: id, events, next_cursor: events.at(-1)?.stream_sequence || after };
  }
  check(command) {
    const { state, receipts } = this.project(command.resource_id);
    const previous = receipts.get(command.command_id);
    if (previous) {
      if (previous.digest !== jobDigest(command)) reject('CONTROL_IDEMPOTENCY_CONFLICT');
      return previous.result;
    }
    if ((state?.current_sequence || 0) !== command.expected_sequence) reject('CONTROL_SEQUENCE_CONFLICT');
    if (command.action === 'create') {
      if (state) reject('CONTROL_SEQUENCE_CONFLICT');
      if (command.input.kind === 'workflow') assertInitialWorkflow(command.input.definition);
      for (const dependency of command.input.depends_on) {
        if (dependency === command.resource_id) reject('JOB_DEPENDENCY_INVALID');
        this.query(dependency);
      }
      // Existing immutable dependencies cannot point to a job not yet created.
    } else if (!state) reject('JOB_NOT_FOUND');
    else if (!['queued', 'claimed', 'recovering'].includes(state.status)) reject('JOB_TERMINAL');
    return null;
  }
  checkExpansion(command) {
    const { state, receipts } = this.project(command.resource_id);
    const previous = receipts.get(command.command_id);
    if (previous) {
      if (previous.digest !== jobDigest(command)) reject('CONTROL_IDEMPOTENCY_CONFLICT');
      return { replay: deepFreeze(previous.result) };
    }
    if (!state) reject('JOB_NOT_FOUND');
    if (state.current_sequence !== command.expected_sequence) reject('CONTROL_SEQUENCE_CONFLICT');
    if (this.now() >= Date.parse(state.deadline_at)) reject('JOB_EXPIRED');
    return { state, definition: expandedDefinition(state, command) };
  }
  async expand(raw) {
    const command = parseJobExpansion(raw);
    const checked = this.checkExpansion(command);
    if (checked.replay) return checked.replay;
    const admission = await this.control.admitCreation(
      'create_workflow',
      { definition: checked.definition },
      command.resource_id,
      Date.parse(checked.state.deadline_at),
    );
    return this.control.handle.db
      .transaction(() => {
        const current = this.checkExpansion(command);
        if (current.replay) return current.replay;
        if (jobDigest(current.definition) !== jobDigest(admission.input.definition)) reject('JOB_DEFINITION_CONFLICT');
        for (const task of current.definition.tasks)
          if (require('./engineering-workspace').projectWorkspaceSnapshot(task.contract).sha256 !== task.contract.workspace.files_sha256)
            reject('JOB_BASELINE_DRIFT');
        const at = this.now();
        this.control.ledger.append({
          aggregate_type: 'control_job',
          aggregate_id: command.resource_id,
          expected_version: command.expected_sequence,
          events: [
            {
              event_id: randomUUID(),
              event_type: 'JobWorkflowExpanded',
              schema_version: 1,
              occurred_at: new Date(at).toISOString(),
              correlation_id: command.resource_id,
              causation_id: command.command_id,
              actor: { type: 'hseos', id: 'local-job-control' },
              operation_id: null,
              evidence_refs: [],
              payload: { command, digest: jobDigest(command), admission, admission_sha256: jobDigest(admission), at },
            },
          ],
        });
        return this.query(command.resource_id);
      })
      .immediate();
  }
  async execute(raw) {
    const command = parseJobCommand(raw);
    if (command.action === 'cancel') {
      const projected = this.project(command.resource_id);
      if (projected.state?.execution) return this.dispatcher.cancel({ ...command, fence: projected.state.fence });
    }
    const replay = this.check(command);
    if (replay) return deepFreeze(replay);
    let admission;
    if (command.action === 'create') {
      if (this.control.rows(command.resource_id).length > 0) reject('JOB_RESOURCE_CONFLICT');
      admission = await this.control.admitCreation(
        command.input.kind === 'task' ? 'create' : 'create_workflow',
        command.input.definition,
        command.resource_id,
        Date.parse(command.input.deadline_at),
      );
    }
    return this.control.handle.db
      .transaction(() => {
        const concurrent = this.check(command);
        if (concurrent) return deepFreeze(concurrent);
        if (command.action === 'create' && this.control.rows(command.resource_id).length > 0) reject('JOB_RESOURCE_CONFLICT');
        this.control.ledger.append({
          aggregate_type: 'control_job',
          aggregate_id: command.resource_id,
          expected_version: command.expected_sequence,
          events: [
            {
              event_id: randomUUID(),
              event_type: 'JobCommandRecorded',
              schema_version: 1,
              occurred_at: new Date(this.now()).toISOString(),
              correlation_id: command.resource_id,
              causation_id: command.command_id,
              actor: { type: 'hseos', id: 'local-job-control' },
              operation_id: null,
              evidence_refs: [],
              payload: { command, digest: jobDigest(command), ...(admission ? { admission, admission_sha256: jobDigest(admission) } : {}) },
            },
          ],
        });
        return this.query(command.resource_id);
      })
      .immediate();
  }
}
module.exports = { JobControl };
