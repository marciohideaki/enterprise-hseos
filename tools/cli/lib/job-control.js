'use strict';

const { randomUUID } = require('node:crypto');
const { z, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { RelationalSessionEventStore } = require('../../../packages/agent-session-store');
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
    plan: z.unknown().optional(),
    plan_sha256: hash.optional(),
    parent_revision_event_id: z.string().optional(),
  })
  .strict();
function assertInitialWorkflow(input) {
  const definition = input.definition;
  if (definition?.schema_version === 2 && (definition.revision !== 1 || definition.previous_definition_sha256 !== null))
    reject('JOB_WORKFLOW_REVISION_INVALID');
}
function expandedDefinition(state, command) {
  if (
    !state ||
    state.kind !== 'workflow' ||
    state.cancellation_requested ||
    (!(state.status === 'queued' && !state.fence && !state.materialization && !state.execution) &&
      !(state.status === 'running' && state.materialization?.phase === 'ready' && state.execution?.phase === 'intent'))
  )
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
function comparableWorkflowDefinition(definition, previousPhaseCount) {
  const { canonicalJson } = require('../../../packages/agent-session-store');
  const canonicalContent = (content) => {
    try {
      return canonicalJson(JSON.parse(content));
    } catch {
      reject('JOB_EVENT_INVALID');
    }
  };
  return {
    ...definition,
    phases: definition.phases.map((phase, index) =>
      index < previousPhaseCount
        ? phase
        : {
            ...phase,
            steps: phase.steps.map((step) => ({
              ...step,
              message: { ...step.message, content: canonicalContent(step.message.content) },
            })),
          },
    ),
  };
}
function projectExpansion(state, row, receipts, control) {
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
    payload.at >= (state.execution_deadline_at || Date.parse(state.deadline_at))
  )
    reject('JOB_EVENT_INVALID');
  const definition = expandedDefinition(state, command);
  validateAdmission({ ...command, input: { kind: 'workflow', definition: { definition } } }, payload.admission);
  const running = state.status === 'running';
  if (
    running !== Boolean(payload.plan) ||
    running !== Boolean(payload.plan_sha256) ||
    running !== Boolean(payload.parent_revision_event_id)
  )
    reject('JOB_EVENT_INVALID');
  let materialization = state.materialization;
  if (running) {
    const oldPlan = state.materialization.plan;
    const plan = payload.plan;
    const digest = require('./engineering-task-state').engineeringDigest;
    if (
      digest(plan) !== payload.plan_sha256 ||
      plan.tasks.length !== definition.tasks.length ||
      digest(plan.tasks.slice(0, oldPlan.tasks.length)) !== digest(oldPlan.tasks) ||
      plan.manifest?.parent_session_id !== oldPlan.manifest.parent_session_id ||
      digest(plan.manifest.tasks.slice(0, oldPlan.manifest.tasks.length)) !== digest(oldPlan.manifest.tasks)
    )
      reject('JOB_EVENT_INVALID');
    const store = new RelationalSessionEventStore({ ledger: control.ledger });
    const revision = store
      .readSession(plan.manifest.parent_session_id)
      .find((event) => event.event_id === payload.parent_revision_event_id);
    if (
      revision?.event_type !== 'workflow.revised' ||
      revision.payload.revision !== definition.revision ||
      digest(comparableWorkflowDefinition(revision.payload.definition, revision.payload.previous_definition.phases.length)) !==
        digest(
          comparableWorkflowDefinition(
            require('./engineering-workflow-runtime').workflowDefinitionFromPlan(
              plan,
              revision.payload.previous_definition,
              oldPlan.tasks.length,
            ),
            revision.payload.previous_definition.phases.length,
          ),
        ) ||
      revision.payload.definition.phases.flatMap((phase) => phase.steps).length !== plan.tasks.length ||
      digest(revision.payload.definition.phases.flatMap((phase) => phase.steps).map((step) => step.child_spec.session_id)) !==
        digest(plan.tasks.map((entry) => entry.created.session_id))
    )
      reject('JOB_EVENT_INVALID');
    const boundaries = state.materialization.boundaries || [
      { count: oldPlan.tasks.length, at: state.first_started_at, plan_sha256: state.materialization.plan_sha256 },
    ];
    materialization = {
      ...state.materialization,
      original_plan_sha256: state.materialization.original_plan_sha256 || state.materialization.plan_sha256,
      original_plan: state.materialization.original_plan || oldPlan,
      plan,
      plan_sha256: payload.plan_sha256,
      boundaries: [...boundaries, { count: plan.tasks.length, at: payload.at, plan_sha256: payload.plan_sha256 }],
    };
  }
  const next = {
    ...state,
    definition: payload.admission.input,
    admission: payload.admission,
    admission_sha256: payload.admission_sha256,
    ...(running ? { materialization } : {}),
    current_sequence: row.stream_sequence,
    transition_at: payload.at,
  };
  if (running) require('./job-materialization').validatePlan(next, payload.plan);
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
        state = projectExpansion(state, row, receipts, this.control);
        continue;
      }
      if (row.event_type === 'JobExecutionRecorded') {
        state = require('./job-dispatch').projectJobExecution(state, row, receipts, this);
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
      if (command.action === 'link_retry') {
        const next = this.rows(command.input.retry_job_id)[0];
        const retry = next?.event_type === 'JobCommandRecorded' ? parseJobCommand(next.payload.command) : null;
        if (
          !state ||
          row.schema_version !== 1 ||
          row.stream_sequence !== state.current_sequence + 1 ||
          command.resource_id !== state.resource_id ||
          command.expected_sequence !== state.current_sequence ||
          payload.digest !== jobDigest(command) ||
          payload.admission ||
          payload.admission_sha256 ||
          !['failed', 'invalidated', 'cancelled', 'expired'].includes(state.status) ||
          state.retry_successor_id ||
          command.input.retry_job_id === state.resource_id ||
          Date.parse(row.occurred_at) < (state.transition_at || 0) ||
          retry?.action !== 'retry' ||
          retry.resource_id !== command.input.retry_job_id ||
          retry.input.retry_of !== state.resource_id ||
          retry.command_id !== command.input.retry_command_id ||
          next.payload.digest !== jobDigest(retry) ||
          jobDigest(retry) !== command.input.retry_digest
        )
          reject('JOB_EVENT_INVALID');
        state = { ...state, retry_successor_id: command.input.retry_job_id, current_sequence: row.stream_sequence };
        continue;
      }
      if (
        command.resource_id !== id ||
        command.expected_sequence !== row.stream_sequence - 1 ||
        jobDigest(command) !== payload.digest ||
        receipts.has(command.command_id)
      )
        reject('JOB_EVENT_INVALID');
      if (command.action === 'create' || command.action === 'retry') {
        if (state || row.stream_sequence !== 1 || !payload.admission || jobDigest(payload.admission) !== payload.admission_sha256)
          reject('JOB_EVENT_INVALID');
        validateAdmission(command, payload.admission);
        if (command.input.kind === 'workflow') assertInitialWorkflow(payload.admission.input);
        const retry = command.action === 'retry' ? this.retryPlan(command, payload.admission, true) : null;
        state = {
          schema_version: 1,
          resource_id: id,
          execution_resource_id: id,
          status: 'queued',
          current_sequence: row.stream_sequence,
          ...command.input,
          admission: payload.admission,
          admission_sha256: payload.admission_sha256,
          ...(retry ? { retry_of: command.input.retry_of, retry_root_id: retry.root.resource_id } : {}),
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
  retryPlan(command, admission, linked = false) {
    if (command.action !== 'retry' || command.input.kind !== 'workflow') reject('JOB_RETRY_INVALID');
    const history = [];
    const seen = new Set([command.resource_id]);
    let id = command.input.retry_of;
    while (id) {
      if (seen.has(id) || history.length >= 128) reject('JOB_RETRY_CYCLE');
      seen.add(id);
      const state = this.query(id);
      if (state.kind !== 'workflow' || !['failed', 'invalidated', 'cancelled', 'expired'].includes(state.status))
        reject('JOB_RETRY_NOT_TERMINAL');
      history.unshift(state);
      id = state.retry_of;
    }
    const prior = history.at(-1);
    if (linked ? prior.retry_successor_id !== command.resource_id : Boolean(prior.retry_successor_id)) reject('JOB_RETRY_CONFLICT');
    const root = history[0];
    const definition = admission.input.definition;
    const original = root.admission.input.definition;
    const deadline = Math.min(Date.parse(root.deadline_at), ...history.map((item) => item.execution_deadline_at || Infinity));
    if (
      (!linked && this.now() >= deadline) ||
      command.input.deadline_at !== new Date(deadline).toISOString() ||
      command.input.depends_on.some((dependency) => seen.has(dependency)) ||
      definition.max_parallelism > original.max_parallelism ||
      definition.limits.max_duration_ms > original.limits.max_duration_ms
    )
      reject('JOB_RETRY_BUDGET_EXCEEDED');
    const roots = new Set(original.tasks.map((task) => task.contract.workspace.root));
    if (definition.tasks.some((task) => !roots.has(task.contract.workspace.root))) reject('JOB_RETRY_SCOPE_DRIFT');
    const known = new Set(history.flatMap((item) => item.admission.input.definition.tasks.map((task) => task.id)));
    if (definition.tasks.some((task) => !known.has(task.id))) reject('JOB_RETRY_NODE_UNKNOWN');
    const usage = { max_tokens: 0, max_turns: 0, max_tool_calls: 0, max_children: 0, max_workflow_steps: 0 };
    const accepted = new Set();
    const store = new RelationalSessionEventStore({ ledger: this.control.ledger });
    const { EngineeringTaskState } = require('./engineering-task-state');
    const { tokenUsage } = require('../../../packages/agent-runtime');
    for (const item of history) {
      const plan = item.materialization?.plan;
      if (!plan) continue;
      for (const entry of plan.manifest.tasks) {
        const result = new EngineeringTaskState(this.control.handle.db, entry.task_run_id).read().result;
        if (result?.result === 'approved') accepted.add(entry.id);
      }
      const parent = store.replay(plan.manifest.parent_session_id);
      const visited = new Set();
      const visit = (sessionId) => {
        if (visited.has(sessionId)) reject('JOB_RETRY_CYCLE');
        visited.add(sessionId);
        const child = store.replay(sessionId);
        if (!child.terminal_event) reject('JOB_RETRY_UNSETTLED');
        usage.max_tokens += tokenUsage(child);
        usage.max_turns += child.turn_order.length;
        usage.max_tool_calls += Object.keys(child.tool_invocations).length;
        usage.max_children++;
        usage.max_workflow_steps++;
        for (const descendant of child.children) visit(descendant);
      };
      for (const child of parent.children) visit(child);
    }
    if (definition.tasks.some((task) => accepted.has(task.id))) reject('JOB_RETRY_ACCEPTED_NODE');
    for (const key of Object.keys(usage))
      if (definition.limits[key] > original.limits[key] - usage[key]) reject('JOB_RETRY_BUDGET_EXCEEDED');
    return { root, prior, usage, deadline };
  }
  check(command) {
    const { state, receipts } = this.project(command.resource_id);
    const previous = receipts.get(command.command_id);
    if (previous) {
      if (previous.digest !== jobDigest(command)) reject('CONTROL_IDEMPOTENCY_CONFLICT');
      return previous.result;
    }
    if ((state?.current_sequence || 0) !== command.expected_sequence) reject('CONTROL_SEQUENCE_CONFLICT');
    if (command.action === 'create' || command.action === 'retry') {
      if (state) reject('CONTROL_SEQUENCE_CONFLICT');
      if (command.input.kind === 'workflow') assertInitialWorkflow(command.input.definition);
      if (command.action === 'retry') {
        if (command.input.kind !== 'workflow') reject('JOB_RETRY_INVALID');
        const prior = this.query(command.input.retry_of);
        if (!['failed', 'invalidated', 'cancelled', 'expired'].includes(prior.status)) reject('JOB_RETRY_NOT_TERMINAL');
        if (prior.retry_successor_id) reject('JOB_RETRY_CONFLICT');
      }
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
    if (this.now() >= (state.execution_deadline_at || Date.parse(state.deadline_at))) reject('JOB_EXPIRED');
    if (state.status === 'running' && !require('../../../packages/agent-isolation-attestation/executor').isExecutorOwnerAlive(state.owner))
      reject('JOB_OWNER_MISMATCH');
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
    let plan;
    if (checked.state.status === 'running') {
      plan = this.materializer.expansionPlan(checked.state, command, admission.input.definition, this.now());
      this.materializer.materializeExpansion(checked.state, plan);
    }
    return this.control.handle.db
      .transaction(() => {
        const current = this.checkExpansion(command);
        if (current.replay) return current.replay;
        if (jobDigest(current.definition) !== jobDigest(admission.input.definition)) reject('JOB_DEFINITION_CONFLICT');
        for (const task of current.definition.tasks)
          if (require('./engineering-workspace').projectWorkspaceSnapshot(task.contract).sha256 !== task.contract.workspace.files_sha256)
            reject('JOB_BASELINE_DRIFT');
        const at = this.now();
        if (current.state.status === 'running' && (this.now() >= current.state.execution_deadline_at || !plan)) reject('JOB_EXPIRED');
        if (plan) plan = this.materializer.expansionPlan(current.state, command, admission.input.definition, at);
        let parentRevisionEventId;
        if (plan) {
          const parentId = plan.manifest.parent_session_id;
          const store = new RelationalSessionEventStore({ ledger: this.control.ledger });
          const parent = store.replay(parentId);
          const reservation = parent.workflow_reservations[current.definition.workflow_id];
          if (!reservation?.claim_ref || reservation.released || parent.cancellation_request) reject('JOB_EXPANSION_DENIED');
          const previous =
            reservation.revisions?.at(-1)?.definition ||
            require('./engineering-workflow-runtime').workflowDefinitionFromPlan(
              current.state.materialization.original_plan || current.state.materialization.plan,
            );
          const revised = require('./engineering-workflow-runtime').workflowDefinitionFromPlan(
            plan,
            previous,
            current.state.materialization.plan.tasks.length,
          );
          parentRevisionEventId = `event:${randomUUID()}`;
          store.append({
            session_id: parentId,
            expected_version: parent.current_sequence,
            events: [
              {
                schema_version: 1,
                event_id: parentRevisionEventId,
                session_id: parentId,
                sequence: parent.current_sequence + 1,
                occurred_at: new Date(at).toISOString(),
                event_type: 'workflow.revised',
                payload: {
                  workflow_id: current.definition.workflow_id,
                  claim_ref: reservation.claim_ref,
                  revision: (reservation.revision || 1) + 1,
                  previous_definition: previous,
                  definition: revised,
                },
              },
            ],
          });
        }
        const event = (type, body) => ({
          event_id: randomUUID(),
          event_type: type,
          schema_version: 1,
          occurred_at: new Date(at).toISOString(),
          correlation_id: command.resource_id,
          causation_id: command.command_id,
          actor: { type: 'hseos', id: 'local-job-control' },
          operation_id: null,
          evidence_refs: [],
          payload: body,
        });
        const requests = [
          {
            aggregate_type: 'control_job',
            aggregate_id: command.resource_id,
            expected_version: command.expected_sequence,
            events: [
              event('JobWorkflowExpanded', {
                command,
                digest: jobDigest(command),
                admission,
                admission_sha256: jobDigest(admission),
                at,
                ...(plan
                  ? {
                      plan,
                      plan_sha256: require('./engineering-task-state').engineeringDigest(plan),
                      parent_revision_event_id: parentRevisionEventId,
                    }
                  : {}),
              }),
            ],
          },
        ];
        if (plan) {
          const oldCount = current.state.materialization.plan.tasks.length;
          const planHash = require('./engineering-task-state').engineeringDigest(plan);
          for (const entry of plan.tasks.slice(oldCount)) {
            const directory = require('node:path').join(this.control.state, 'jobs', command.resource_id, 'tasks', entry.task_run_id);
            const base = { job_id: command.resource_id, resource_kind: 'task', state_directory: directory, plan_sha256: planHash };
            requests.push({
              aggregate_type: 'control_task',
              aggregate_id: entry.task_run_id,
              expected_version: 0,
              events: [
                event('ControlCommandRecorded', { ...base, kind: 'job_prepared' }),
                event('ControlCommandRecorded', { ...base, kind: 'registered' }),
              ],
            });
            new (require('./engineering-task-state').EngineeringTaskState)(this.control.handle.db, entry.task_run_id).append(
              entry.created,
              0,
            );
          }
        }
        this.control.ledger.appendBatch(requests);
        return this.query(command.resource_id);
      })
      .immediate();
  }
  async execute(raw) {
    const command = parseJobCommand(raw);
    if (command.action === 'link_retry') reject('JOB_COMMAND_INTERNAL');
    if (command.action === 'reconcile') {
      const projected = this.project(command.resource_id);
      const prior = this.rows(command.resource_id).find((row) => row.payload?.command?.command_id === command.command_id);
      if (prior) {
        const recorded = prior.payload.command;
        if (
          recorded.action !== 'reconcile' ||
          recorded.resource_id !== command.resource_id ||
          recorded.expected_sequence !== command.expected_sequence
        )
          reject('CONTROL_IDEMPOTENCY_CONFLICT');
        return 'lease_ms' in recorded ? this.worker.execute(recorded) : this.dispatcher.execute(recorded);
      }
      if (!projected.state) reject('JOB_NOT_FOUND');
      const internal = { ...command, fence: projected.state.fence || 0 };
      if (projected.state.execution) return this.dispatcher.execute(internal);
      return this.worker.execute({
        schema_version: internal.schema_version,
        command_id: internal.command_id,
        resource_id: internal.resource_id,
        expected_sequence: internal.expected_sequence,
        action: 'reconcile',
        fence: internal.fence,
        lease_ms: 1000,
      });
    }
    if (command.action === 'cancel') {
      const projected = this.project(command.resource_id);
      if (projected.state?.execution) return this.dispatcher.cancel({ ...command, fence: projected.state.fence });
    }
    const replay = this.check(command);
    if (replay) return deepFreeze(replay);
    let admission;
    if (command.action === 'create' || command.action === 'retry') {
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
        if (['create', 'retry'].includes(command.action) && this.control.rows(command.resource_id).length > 0)
          reject('JOB_RESOURCE_CONFLICT');
        const retry = command.action === 'retry' ? this.retryPlan(command, admission) : null;
        const at = this.now();
        const creation = {
          aggregate_type: 'control_job',
          aggregate_id: command.resource_id,
          expected_version: command.expected_sequence,
          events: [
            {
              event_id: randomUUID(),
              event_type: 'JobCommandRecorded',
              schema_version: 1,
              occurred_at: new Date(at).toISOString(),
              correlation_id: command.resource_id,
              causation_id: command.command_id,
              actor: { type: 'hseos', id: 'local-job-control' },
              operation_id: null,
              evidence_refs: [],
              payload: { command, digest: jobDigest(command), ...(admission ? { admission, admission_sha256: jobDigest(admission) } : {}) },
            },
          ],
        };
        if (retry) {
          const linkCommand = {
            schema_version: 1,
            command_id: command.command_id,
            resource_id: retry.prior.resource_id,
            expected_sequence: retry.prior.current_sequence,
            action: 'link_retry',
            input: { retry_job_id: command.resource_id, retry_command_id: command.command_id, retry_digest: jobDigest(command) },
          };
          const link = {
            event_id: randomUUID(),
            event_type: 'JobCommandRecorded',
            schema_version: 1,
            occurred_at: new Date(at).toISOString(),
            correlation_id: retry.prior.resource_id,
            causation_id: command.command_id,
            actor: { type: 'hseos', id: 'local-job-control' },
            operation_id: null,
            evidence_refs: [],
            payload: { command: linkCommand, digest: jobDigest(linkCommand) },
          };
          this.control.ledger.appendBatch([
            {
              aggregate_type: 'control_job',
              aggregate_id: retry.prior.resource_id,
              expected_version: retry.prior.current_sequence,
              events: [link],
            },
            creation,
          ]);
        } else this.control.ledger.append(creation);
        return this.query(command.resource_id);
      })
      .immediate();
  }
}
module.exports = { JobControl };
