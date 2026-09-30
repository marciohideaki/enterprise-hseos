'use strict';

const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { z, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { RelationalSessionEventStore } = require('../../../packages/agent-session-store');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { executorOwner } = require('../../../packages/agent-isolation-attestation/executor');
const { EngineeringTaskState, engineeringDigest } = require('./engineering-task-state');
const { hydrateProjectTask, materializeProjectSnapshot } = require('./engineering-workspace');
const { parseEngineeringTask } = require('./engineering-task-contract');
const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commandSchema = z
  .object({
    schema_version: z.literal(1),
    command_id: z.string().uuid(),
    resource_id: z.string().uuid(),
    expected_sequence: integer,
    fence: integer.positive(),
    action: z.literal('materialize'),
  })
  .strict();
const planSchema = z
  .object({
    schema_version: z.literal(1),
    control_directory: z.string().min(1),
    tasks: z
      .array(z.object({ task_run_id: z.string().uuid(), created: z.record(z.string(), z.json()) }).strict())
      .min(1)
      .max(16),
    manifest: z.record(z.string(), z.json()).nullable(),
  })
  .strict();
const eventSchema = z
  .object({
    command: commandSchema,
    digest: hash,
    phase: z.enum(['planned', 'ready']),
    at: integer,
    plan: planSchema,
    plan_sha256: hash,
  })
  .strict();
function reject(code) {
  throw Object.assign(new Error(code), { code });
}
function equal(a, b) {
  return engineeringDigest(a) === engineeringDigest(b);
}
function validatePlan(state, plan) {
  const inputs = state.kind === 'task' ? [state.admission.input] : state.admission.input.definition.tasks;
  if (
    plan.tasks.length !== inputs.length ||
    new Set(plan.tasks.map((t) => t.task_run_id)).size !== inputs.length ||
    new Set(plan.tasks.map((t) => t.created.session_id)).size !== inputs.length
  )
    reject('JOB_PLAN_INVALID');
  for (const [index, entry] of plan.tasks.entries()) {
    const input = inputs[index];
    const created = entry.created;
    const contract = parseEngineeringTask(created.contract);
    if (!equal({ ...contract, initial_files: [] }, input.contract)) reject('JOB_PLAN_INVALID');
    const byPath = new Map(contract.initial_files.map((f) => [f.path, f]));
    const snapshot = contract.scope.read.map((name) => ({ path: name, sha256: byPath.get(name)?.sha256 ?? null }));
    if (
      engineeringDigest(snapshot) !== contract.workspace.files_sha256 ||
      contract.initial_files.some((f) => createHash('sha256').update(f.content).digest('hex') !== f.sha256)
    )
      reject('JOB_PLAN_INVALID');
    const admittedAt = state.materialization?.boundaries?.find((boundary) => index < boundary.count)?.at ?? state.first_started_at;
    const expected = {
      kind: 'created',
      contract,
      contract_sha256: engineeringDigest(contract),
      session_id: created.session_id,
      deadline: Math.min(state.execution_deadline_at, admittedAt + contract.limits.max_duration_ms),
      responses: input.responses || [],
      ...(state.kind === 'task' && state.admission.binding ? { binding: state.admission.binding } : {}),
      ...(state.kind === 'task' && state.admission.selection ? { extensions: state.admission.selection } : {}),
      ...(state.kind === 'task' && state.admission.plugin_model ? { plugin_model: state.admission.plugin_model } : {}),
    };
    z.string()
      .regex(/^session:[0-9a-f-]{36}$/)
      .parse(created.session_id);
    if (!equal(created, expected)) reject('JOB_PLAN_INVALID');
  }
  if (state.kind === 'task') {
    if (plan.manifest !== null || plan.tasks[0].task_run_id !== state.resource_id) reject('JOB_PLAN_INVALID');
  } else {
    const definition = {
      ...state.admission.input.definition,
      tasks: inputs.map((input, i) => ({ ...input, contract: plan.tasks[i].created.contract })),
    };
    const expected = {
      schema_version: 1,
      definition,
      definition_sha256: engineeringDigest(definition),
      parent_session_id: plan.manifest?.parent_session_id,
      tasks: plan.tasks.map((entry, i) => ({ id: inputs[i].id, task_run_id: entry.task_run_id, session_id: entry.created.session_id })),
    };
    z.string()
      .regex(/^session:[0-9a-f-]{36}$/)
      .parse(expected.parent_session_id);
    if (
      !equal(plan.manifest, expected) ||
      plan.tasks.some((t) => t.created.session_id === expected.parent_session_id || t.task_run_id === state.resource_id)
    )
      reject('JOB_PLAN_INVALID');
  }
}
function projectJobMaterialization(state, row, receipts) {
  const payload = eventSchema.parse(row.payload);
  const { command, phase, at, plan } = payload;
  const ready = phase === 'ready';
  const previous = receipts.get(command.command_id);
  if (
    !state ||
    row.schema_version !== 1 ||
    row.stream_sequence !== state.current_sequence + 1 ||
    state.status !== 'claimed' ||
    command.resource_id !== state.resource_id ||
    payload.digest !== engineeringDigest(command) ||
    command.fence !== state.fence ||
    command.expected_sequence + (ready ? 2 : 1) !== row.stream_sequence ||
    at < state.transition_at ||
    at >= state.execution_deadline_at ||
    engineeringDigest(plan) !== payload.plan_sha256 ||
    (ready ? !previous?.pending || previous.digest !== payload.digest : Boolean(previous))
  )
    reject('JOB_EVENT_INVALID');
  validatePlan(state, plan);
  if (
    state.materialization &&
    (!equal(state.materialization.plan, plan) ||
      state.materialization.phase === 'ready' ||
      (ready && state.materialization.command_id !== command.command_id))
  )
    reject('JOB_EVENT_INVALID');
  if (ready && !state.materialization) reject('JOB_EVENT_INVALID');
  const next = {
    ...state,
    current_sequence: row.stream_sequence,
    transition_at: at,
    materialization: { phase, plan, plan_sha256: payload.plan_sha256, command_id: command.command_id, fence: command.fence },
  };
  receipts.set(command.command_id, { digest: payload.digest, result: structuredClone(next), pending: !ready });
  return next;
}
function mappings(state) {
  const plan = state.materialization.plan;
  const directory = path.join(plan.control_directory, 'jobs', state.resource_id);
  return [
    { id: state.resource_id, resource_kind: state.kind, state_directory: directory },
    ...(state.kind === 'workflow'
      ? plan.tasks.map((task) => ({
          id: task.task_run_id,
          resource_kind: 'task',
          state_directory: path.join(directory, 'tasks', task.task_run_id),
        }))
      : []),
  ];
}
function assertPreparationOnly(control, state) {
  const plan = state.materialization?.plan;
  if (!plan || plan.control_directory !== control.state) reject('JOB_OUTCOME_UNCERTAIN');
  validatePlan(state, plan);
  for (const mapping of mappings(state)) {
    const rows = control.rows(mapping.id);
    const expected = {
      kind: 'job_prepared',
      job_id: state.resource_id,
      resource_kind: mapping.resource_kind,
      state_directory: mapping.state_directory,
      plan_sha256: state.materialization.plan_sha256,
    };
    if (
      rows.length === 0 ||
      !equal(rows[0].payload, expected) ||
      rows.length > 2 ||
      (rows[1] && !equal(rows[1].payload, { ...expected, kind: 'registered' }))
    )
      reject('JOB_OUTCOME_UNCERTAIN');
  }
  const store = new RelationalSessionEventStore({ ledger: control.ledger });
  for (const entry of plan.tasks) {
    const task = new EngineeringTaskState(control.handle.db, entry.task_run_id).read();
    if (task.version > 1 || (task.created && !equal(task.created, entry.created))) reject('JOB_OUTCOME_UNCERTAIN');
    if (state.kind === 'workflow' && store.readSession(entry.created.session_id).length > 0) reject('JOB_OUTCOME_UNCERTAIN');
  }
  const sessionId = plan.manifest?.parent_session_id || plan.tasks[0].created.session_id;
  const rows = store.readSession(sessionId);
  if (rows.length > 1 || rows.some((row) => row.event_type !== 'session.created')) reject('JOB_OUTCOME_UNCERTAIN');
}
function assertJobExecutionDenied(db, id, { directory, sessionId } = {}) {
  const ledger = new ExecutionEventLedger(db);
  if (ledger.readStream('control_task', id).some((row) => row.payload.kind === 'job_prepared')) reject('JOB_DISPATCH_REQUIRED');
  if (!directory && !sessionId) return;
  const actualDirectory = directory ? require('node:fs').realpathSync(directory) : null;
  let after = 0;
  while (true) {
    const rows = ledger.readGlobal({ aggregate_type: 'control_task', after_position: after, limit: 1000 });
    for (const row of rows) {
      if (row.payload.kind !== 'job_prepared') continue;
      if (actualDirectory === row.payload.state_directory) reject('JOB_DISPATCH_REQUIRED');
      if (sessionId) {
        const preparation = ledger
          .readStream('control_job', row.payload.job_id)
          .find((entry) => entry.event_type === 'JobMaterializationRecorded');
        if (
          preparation?.payload.plan.tasks.some((entry) => entry.created.session_id === sessionId) ||
          preparation?.payload.plan.manifest?.parent_session_id === sessionId
        )
          reject('JOB_DISPATCH_REQUIRED');
      }
    }
    if (rows.length < 1000) break;
    after = rows.at(-1).position;
  }
}

class JobMaterializer {
  #inflight = new Map();
  constructor(jobs) {
    this.jobs = jobs;
    this.control = jobs.control;
  }
  check(command) {
    const { state, receipts } = this.jobs.project(command.resource_id);
    const previous = receipts.get(command.command_id);
    if (previous && previous.digest !== engineeringDigest(command)) reject('CONTROL_IDEMPOTENCY_CONFLICT');
    if (previous && !previous.pending) return { replay: deepFreeze(previous.result) };
    if (!state || state.status !== 'claimed') reject('JOB_NOT_CLAIMED');
    if (state.current_sequence !== command.expected_sequence + (previous ? 1 : 0)) reject('CONTROL_SEQUENCE_CONFLICT');
    if (state.fence !== command.fence) reject('JOB_FENCE_CONFLICT');
    if (!equal(state.owner, executorOwner())) reject('JOB_OWNER_MISMATCH');
    if (this.jobs.now() >= state.execution_deadline_at) reject('JOB_EXPIRED');
    return { state, pending: Boolean(previous) };
  }
  async execute(raw) {
    const command = commandSchema.parse(raw);
    const digest = engineeringDigest(command);
    const running = this.#inflight.get(command.command_id);
    if (running) {
      if (running.digest !== digest) reject('CONTROL_IDEMPOTENCY_CONFLICT');
      return running.promise;
    }
    const promise = this.#execute(command);
    this.#inflight.set(command.command_id, { digest, promise });
    this.control.active.add(command.command_id);
    try {
      return await promise;
    } finally {
      this.#inflight.delete(command.command_id);
      this.control.active.delete(command.command_id);
    }
  }
  async #execute(command) {
    let checked = this.check(command);
    if (checked.replay) return checked.replay;
    await this.jobs.worker.admit(checked.state);
    checked = this.check(command);
    if (checked.replay) return checked.replay;
    const { state } = checked;
    if (!checked.pending) {
      const plan = state.materialization?.plan || this.#plan(state);
      this.#append(command, 'planned', plan);
    }
    const current = this.check(command).state;
    assertPreparationOnly(this.control, current);
    this.#files(current);
    for (const entry of current.materialization.plan.tasks) {
      const task = new EngineeringTaskState(this.control.handle.db, entry.task_run_id);
      if (!task.read().created) task.append(entry.created, 0);
    }
    await require('./engineering-task-runtime').initializeJobSession(this.control, current.resource_id);
    checked = this.check(command);
    if (checked.replay) return checked.replay;
    assertPreparationOnly(this.control, checked.state);
    this.#files(checked.state);
    return this.#append(command, 'ready', checked.state.materialization.plan);
  }
  #plan(state) {
    const inputs = state.kind === 'task' ? [state.admission.input] : state.admission.input.definition.tasks;
    const tasks = inputs.map((input) => {
      const contract = hydrateProjectTask(input.contract);
      return {
        task_run_id: state.kind === 'task' ? state.resource_id : randomUUID(),
        created: {
          kind: 'created',
          contract,
          contract_sha256: engineeringDigest(contract),
          session_id: `session:${randomUUID()}`,
          deadline: Math.min(state.execution_deadline_at, state.first_started_at + contract.limits.max_duration_ms),
          responses: input.responses || [],
          ...(state.kind === 'task' && state.admission.binding ? { binding: state.admission.binding } : {}),
          ...(state.kind === 'task' && state.admission.selection ? { extensions: state.admission.selection } : {}),
          ...(state.kind === 'task' && state.admission.plugin_model ? { plugin_model: state.admission.plugin_model } : {}),
        },
      };
    });
    let manifest = null;
    if (state.kind === 'workflow') {
      const definition = {
        ...state.admission.input.definition,
        tasks: inputs.map((input, i) => ({ ...input, contract: tasks[i].created.contract })),
      };
      manifest = {
        schema_version: 1,
        definition,
        definition_sha256: engineeringDigest(definition),
        parent_session_id: `session:${randomUUID()}`,
        tasks: tasks.map((task, i) => ({ id: inputs[i].id, task_run_id: task.task_run_id, session_id: task.created.session_id })),
      };
    }
    return planSchema.parse({ schema_version: 1, control_directory: this.control.state, tasks, manifest });
  }
  expansionPlan(state, command, definition, at) {
    if (state.status !== 'running' || state.materialization?.phase !== 'ready' || !state.materialization.plan.manifest)
      reject('JOB_EXPANSION_DENIED');
    const old = state.materialization.plan;
    const inputs = definition.tasks.slice(old.tasks.length);
    if (inputs.length !== command.input.nodes.length) reject('JOB_PLAN_INVALID');
    const stableUuid = (kind, id) => {
      const hex = createHash('sha256').update(`${command.resource_id}\0${command.command_id}\0${kind}\0${id}`).digest('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    };
    const added = inputs.map((input) => {
      const contract = hydrateProjectTask(input.contract);
      return {
        task_run_id: stableUuid('task', input.id),
        created: {
          kind: 'created',
          contract,
          contract_sha256: engineeringDigest(contract),
          session_id: `session:${stableUuid('session', input.id)}`,
          deadline: Math.min(state.execution_deadline_at, at + contract.limits.max_duration_ms),
          responses: input.responses || [],
        },
      };
    });
    const tasks = [...old.tasks, ...added];
    const hydrated = {
      ...definition,
      tasks: definition.tasks.map((input, index) => ({ ...input, contract: tasks[index].created.contract })),
    };
    const manifest = {
      ...old.manifest,
      definition: hydrated,
      definition_sha256: engineeringDigest(hydrated),
      tasks: tasks.map((entry, index) => ({
        id: definition.tasks[index].id,
        task_run_id: entry.task_run_id,
        session_id: entry.created.session_id,
      })),
    };
    return planSchema.parse({ schema_version: 1, control_directory: old.control_directory, tasks, manifest });
  }
  materializeExpandedChild(state, entry) {
    const current = this.jobs.query(state.resource_id);
    const index = current.materialization?.plan.tasks.findIndex((task) => task.task_run_id === entry.task_run_id) ?? -1;
    if (
      current.materialization?.plan.control_directory !== this.control.state ||
      index < (current.materialization.original_plan?.tasks.length ?? current.materialization.plan.tasks.length) ||
      !equal(current.materialization.plan.tasks[index], entry)
    )
      reject('JOB_PLAN_INVALID');
    const files = { 'engineering-task.json': JSON.stringify({ task_run_id: entry.task_run_id }) };
    const directories = ['workspace'];
    for (const name of entry.created.contract.scope.read) {
      const parent = path.posix.dirname(name);
      if (parent !== '.') directories.push(`workspace/${parent}`);
    }
    for (const file of entry.created.contract.initial_files) files[`workspace/${file.path}`] = file.content;
    const prepare = () =>
      materializeProjectSnapshot(this.control.state, `jobs/${state.resource_id}/tasks/${entry.task_run_id}`, files, [
        ...new Set(directories),
      ]);
    if (this.control.handle.db.inTransaction) prepare();
    else this.control.handle.db.transaction(prepare).immediate();
  }
  materializeExpansion(state) {
    const originalCount = state.materialization.original_plan?.tasks.length ?? state.materialization.plan.tasks.length;
    for (const entry of state.materialization.plan.tasks.slice(originalCount)) this.materializeExpandedChild(state, entry);
  }
  #files(state) {
    const files = {},
      empty = [];
    const plan = state.materialization.plan;
    if (plan.manifest) files['engineering-workflow.json'] = JSON.stringify(plan.manifest);
    for (const entry of plan.tasks) {
      const prefix = plan.manifest ? `tasks/${entry.task_run_id}/` : '';
      files[`${prefix}engineering-task.json`] = JSON.stringify({ task_run_id: entry.task_run_id });
      empty.push(`${prefix}workspace`);
      for (const name of entry.created.contract.scope.read) {
        const parent = path.posix.dirname(name);
        if (parent !== '.') empty.push(`${prefix}workspace/${parent}`);
      }
      for (const file of entry.created.contract.initial_files) files[`${prefix}workspace/${file.path}`] = file.content;
    }
    materializeProjectSnapshot(this.control.state, `jobs/${state.resource_id}`, files, [...new Set(empty)]);
  }
  #append(command, phase, plan) {
    return this.control.handle.db
      .transaction(() => {
        const checked = this.check(command);
        if (checked.replay) return checked.replay;
        const state = checked.state;
        const payload = {
          command,
          digest: engineeringDigest(command),
          phase,
          at: this.jobs.now(),
          plan,
          plan_sha256: engineeringDigest(plan),
        };
        const next = projectJobMaterialization(
          state,
          { payload, schema_version: 1, stream_sequence: state.current_sequence + 1 },
          this.jobs.project(state.resource_id).receipts,
        );
        const event = (type, body) => ({
          event_id: randomUUID(),
          event_type: type,
          schema_version: 1,
          occurred_at: new Date(payload.at).toISOString(),
          correlation_id: state.resource_id,
          causation_id: command.command_id,
          actor: { type: 'hseos', id: 'job-materializer' },
          operation_id: null,
          evidence_refs: [],
          payload: body,
        });
        const requests = [
          {
            aggregate_type: 'control_job',
            aggregate_id: state.resource_id,
            expected_version: state.current_sequence,
            events: [event('JobMaterializationRecorded', payload)],
          },
        ];
        if (phase === 'ready') assertPreparationOnly(this.control, state);
        for (const mapping of mappings(next)) {
          const rows = this.control.rows(mapping.id);
          if (phase === 'planned' && state.materialization) continue;
          if (rows.length !== (phase === 'planned' ? 0 : 1)) reject('JOB_RESOURCE_CONFLICT');
          requests.push({
            aggregate_type: 'control_task',
            aggregate_id: mapping.id,
            expected_version: rows.length,
            events: [
              event('ControlCommandRecorded', {
                kind: phase === 'planned' ? 'job_prepared' : 'registered',
                job_id: state.resource_id,
                resource_kind: mapping.resource_kind,
                state_directory: mapping.state_directory,
                plan_sha256: payload.plan_sha256,
              }),
            ],
          });
        }
        this.control.ledger.appendBatch(requests);
        return this.jobs.query(state.resource_id);
      })
      .immediate();
  }
}
function resolveJobView(control, id) {
  const binding = control.rows(id).find((row) => row.payload.kind === 'job_prepared')?.payload;
  if (!binding) return null;
  const state = control.jobs.query(binding.job_id);
  if (state.materialization?.phase !== 'ready') reject('JOB_PREPARATION_PENDING');
  const plan = state.materialization.plan;
  if (plan.control_directory !== control.state) reject('JOB_PLAN_INVALID');
  validatePlan(state, plan);
  const mapping = mappings(state).find((entry) => entry.id === id);
  const index = plan.tasks.findIndex((entry) => entry.task_run_id === id);
  const planHash =
    index === -1
      ? state.materialization.original_plan_sha256 || state.materialization.plan_sha256
      : state.materialization.boundaries?.find((boundary) => index < boundary.count)?.plan_sha256 || state.materialization.plan_sha256;
  if (
    !mapping ||
    !equal(binding, {
      kind: 'job_prepared',
      job_id: state.resource_id,
      resource_kind: mapping.resource_kind,
      state_directory: mapping.state_directory,
      plan_sha256: planHash,
    }) ||
    !control.rows(id).some((row) => equal(row.payload, { ...binding, kind: 'registered' }))
  )
    reject('JOB_PLAN_INVALID');
  if (index >= (state.materialization.original_plan?.tasks.length ?? plan.tasks.length))
    control.jobs.materializer.materializeExpandedChild(state, plan.tasks[index]);
  return {
    handle: { db: control.handle.db, directory: mapping.state_directory },
    state,
    manifest: mapping.resource_kind === 'workflow' ? plan.manifest : null,
    taskId: id,
  };
}
module.exports = {
  JobMaterializer,
  projectJobMaterialization,
  validatePlan,
  assertPreparationOnly,
  assertJobExecutionDenied,
  resolveJobView,
};
