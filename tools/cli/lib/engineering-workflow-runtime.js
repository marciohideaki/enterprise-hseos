'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { tokenUsage } = require('../../../packages/agent-runtime');
const { executorOwner, isExecutorOwnerAlive, reapExecutorOwner } = require('../../../packages/agent-isolation-attestation/executor');
const { z, AgentLimitsSchema, IdentifierSchema } = require('../../../packages/agent-runtime-contracts');
const { LocalSubagentProvider, WorkflowEngine, AgentExecutionSupervisor, terminalChild } = require('../../../packages/agent-orchestration');
const { createExecutionLedgerFileFixture, openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');
const { RelationalSessionEventStore } = require('../../../packages/agent-session-store');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { parseEngineeringTask } = require('./engineering-task-contract');
const { attestEngineeringVerifier } = require('./engineering-verifier');
const { EngineeringTaskState, engineeringDigest } = require('./engineering-task-state');
const {
  createEngineeringTaskWorkspace,
  engineeringSessionSpec,
  assembleEngineeringTask,
  attestEngineeringExecutor,
  executeEngineeringTask,
} = require('./engineering-task-runtime');

const definitionSchema = z
  .object({
    schema_version: z.literal(1),
    workflow_id: IdentifierSchema,
    limits: AgentLimitsSchema,
    max_parallelism: z.number().int().min(1).max(8),
    tasks: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            contract: z.unknown(),
            responses: z
              .array(z.object({ name: z.string().min(1).max(160), input: z.record(z.string(), z.json()) }).strict())
              .max(64)
              .default([]),
            binding: z.unknown().optional(),
            depends_on: z.array(IdentifierSchema).max(16),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

function parseEngineeringWorkflow(value) {
  const definition = definitionSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(definition)) > 1_048_576) throw new Error('Workflow definition exceeds its byte budget');
  const ids = new Set(definition.tasks.map((task) => task.id));
  if (ids.size !== definition.tasks.length) throw new Error('Workflow task ids must be unique');
  for (const task of definition.tasks) {
    task.contract = parseEngineeringTask(task.contract);
    attestEngineeringVerifier(task.contract);
    if (task.binding !== undefined) {
      task.binding = require('./engineering-model').validateEngineeringBinding(task.binding);
      if (task.responses.length > 0) throw new Error('Workflow tasks must select exactly one model source');
    }
    if (new Set(task.depends_on).size !== task.depends_on.length || task.depends_on.some((id) => !ids.has(id) || id === task.id))
      throw new Error('Workflow dependencies must name distinct other tasks');
  }
  const phases = [];
  const completed = new Set();
  while (completed.size < ids.size) {
    const ready = definition.tasks.filter((task) => !completed.has(task.id) && task.depends_on.every((id) => completed.has(id)));
    if (ready.length === 0) throw new Error('Workflow dependency cycle');
    phases.push(ready.map((task) => task.id));
    for (const task of ready) completed.add(task.id);
  }
  for (const limit of ['max_turns', 'max_tool_calls', 'max_tokens']) {
    if (definition.tasks.reduce((sum, task) => sum + task.contract.limits[limit], 0) > definition.limits[limit])
      throw new Error(`Aggregate task reservations exceed workflow ${limit}`);
  }
  if (definition.tasks.length > definition.limits.max_children || definition.tasks.length > definition.limits.max_workflow_steps)
    throw new Error('Workflow task count exceeds its tree budget');
  const joinTimeout = Math.max(...definition.tasks.map((task) => task.contract.limits.max_duration_ms));
  const windows = phases.reduce((count, phase) => count + Math.ceil(phase.length / definition.max_parallelism), 0);
  if (windows * joinTimeout > definition.limits.max_duration_ms) throw new Error('Workflow duration budget is insufficient');
  return { definition, phases, joinTimeout };
}

function workflowSummary(handle, manifest, store) {
  const parent = store.replay(manifest.parent_session_id);
  const reservation = parent.workflow_reservations[manifest.definition.workflow_id];
  let settled = true;
  let blocked = false;
  const spent = { max_tokens: 0, max_tool_calls: 0, max_turns: 0 };
  const allocated = { max_tokens: 0, max_tool_calls: 0, max_turns: 0 };
  const tasks = manifest.tasks.map(({ task_run_id: id, session_id: sessionId, id: stepId }) => {
    const state = new EngineeringTaskState(handle.db, id).read();
    for (const key of Object.keys(allocated)) allocated[key] += state.created.contract.limits[key];
    if (parent.children.includes(sessionId)) {
      const child = store.replay(sessionId);
      spent.max_tokens += tokenUsage(child);
      spent.max_tool_calls += Object.keys(child.tool_invocations).length;
      spent.max_turns += child.turn_order.length;
      settled &&= Boolean(state.result && store.replay(sessionId).terminal_event);
      blocked ||= state.result?.result === 'blocked';
    }
    return {
      id: stepId,
      session_id: sessionId,
      task_run_id: id,
      result: state.result?.result || 'not_executed',
      reason: state.result?.reason || 'awaiting-execution',
      questions: state.uncertainty ? [state.uncertainty.question] : [],
    };
  });
  const cancellation = parent.status === 'cancelled' || reservation?.released?.status === 'cancelled';
  return {
    schema_version: 1,
    profile: 'disposable-engineering-candidate',
    workflow_id: manifest.definition.workflow_id,
    state: handle.directory,
    session_id: manifest.parent_session_id,
    current_sequence: parent.current_sequence,
    status: cancellation
      ? !settled || !parent.terminal_event
        ? 'cancelling'
        : blocked
          ? 'blocked'
          : 'cancelled'
      : reservation?.released?.status || (reservation ? 'running' : 'not_executed'),
    tasks,
    questions: tasks.flatMap((task) => task.questions),
    budget: Object.fromEntries(
      Object.keys(spent).map((key) => [
        key,
        {
          ceiling: manifest.definition.limits[key],
          spent: spent[key],
          reserved: reservation && !reservation.released ? Math.max(0, allocated[key] - spent[key]) : 0,
          released: reservation?.released ? Math.max(0, allocated[key] - spent[key]) : 0,
        },
      ]),
    ),
    operational_authorized: false,
  };
}

function assembleEngineeringWorkflow(handle, manifest, modelOptions = {}) {
  const assemblies = new Map();
  for (const entry of manifest.tasks) {
    const task = new EngineeringTaskState(handle.db, entry.task_run_id);
    const childHandle = { db: handle.db, directory: path.join(handle.directory, 'tasks', entry.task_run_id) };
    assemblies.set(entry.session_id, {
      id: entry.id,
      handle: childHandle,
      task,
      assembly: assembleEngineeringTask(childHandle, task.read().created, modelOptions),
    });
  }
  const first = assemblies.values().next().value.assembly;
  const store = first.sessionStore;
  const resolveChild = (sessionStore, sessionId) => {
    const sessionOutcome = terminalChild(sessionStore, sessionId);
    if (!sessionOutcome) return null;
    const child = assemblies.get(sessionId);
    if (!child) return sessionOutcome;
    const task = child.task.read();
    if (!task.result) return null;
    const event = child.task.ledger.readStream('engineering_task', child.task.id).at(-1);
    return {
      child_session_id: sessionId,
      status: task.result.result === 'approved' ? 'completed' : task.result.reason === 'cancelled' ? 'cancelled' : 'failed',
      outcome_ref: `execution-event://${event.event_id}`,
    };
  };
  const runtime = {
    create: (input) => first.runtime.create(input),
    resume: () => {
      throw new Error('Engineering workflows require reconciliation before resuming interrupted task effects');
    },
    dispose: (input) => first.runtime.dispose(input),
    async send(input) {
      const child = assemblies.get(input.session_id);
      if (!child) throw new Error('Workflow controller does not execute model turns');
      const created = child.task.read().created;
      try {
        const state = child.task.read();
        const verificationOnly = state.started;
        if (state.started) {
          const { inspectReconciliation, applyReconciliation } = require('./engineering-reconciliation');
          const inspected = await inspectReconciliation(child.task, child.assembly, attestEngineeringExecutor);
          const decision = modelOptions.reconciliationDecisions?.[child.id];
          const message = handle.db.transaction(() => applyReconciliation(child.task, child.assembly, inspected, decision))();
          if (inspected.session.status === 'completed') {
            await executeEngineeringTask(child.handle, child.task, child.assembly, created, true, input);
            return child.assembly.runtime.send(input);
          }
          const result = await executeEngineeringTask(child.handle, child.task, child.assembly, created, 'reconciled', {
            ...input,
            turn_id: `turn:${randomUUID()}`,
            message,
          });
          return result;
        }
        await attestEngineeringExecutor(child.assembly.policy, created.deadline);
        const result = await executeEngineeringTask(child.handle, child.task, child.assembly, created, verificationOnly, input);
        // A completed session returns its existing receipt without any new model/tool event.
        return verificationOnly ? child.assembly.runtime.send(input) : result;
      } catch (error) {
        const state = child.task.read();
        if (!state.result)
          child.task.append(
            { kind: 'result', result: 'blocked', reason: error.code || 'engineering-execution-blocked', evidence: {} },
            state.version,
          );
        throw error;
      }
    },
    async cancel(input) {
      const child = assemblies.get(input.session_id);
      if (!child) return first.runtime.cancel(input);
      const state = child.task.read();
      if (!state.result && !state.cancellation) child.task.append({ kind: 'cancellation_requested' }, state.version);
      const interrupted = state.started && state.owner && !isExecutorOwnerAlive(state.owner);
      if (interrupted) await reapExecutorOwner(state.owner);
      const result = await child.assembly.runtime.cancel(input);
      if ((!state.started || interrupted) && !state.result)
        child.task.append({ kind: 'result', result: 'not_executed', reason: 'cancelled', evidence: {} }, child.task.read().version);
      return result;
    },
  };
  const provider = new LocalSubagentProvider({
    session_store: store,
    agent_runtime: runtime,
    max_parallel_children: manifest.definition.max_parallelism,
    resolve_child_outcome: resolveChild,
  });
  const engine = new WorkflowEngine({
    session_store: store,
    subagent_provider: provider,
    resolve_child_outcome: resolveChild,
    claim_lease_ms: 1000,
  });
  const supervisor = new AgentExecutionSupervisor({
    agent_runtime: runtime,
    session_store: store,
    workflow_engines: new Map([['workflow:local', engine]]),
    max_settlement_ms: 10_000,
  });
  const byId = new Map(manifest.tasks.map((task) => [task.id, task]));
  const parsed = parseEngineeringWorkflow(manifest.definition);
  const workflow = {
    schema_version: 1,
    workflow_id: manifest.definition.workflow_id,
    subagent_provider_id: 'subagent:local',
    max_parallelism: manifest.definition.max_parallelism,
    join_timeout_ms: parsed.joinTimeout,
    phases: parsed.phases.map((ids, index) => ({
      phase_id: `phase:${index}`,
      mode: 'parallel',
      steps: ids.map((id) => {
        const entry = byId.get(id);
        const created = assemblies.get(entry.session_id).task.read().created;
        return {
          step_id: id,
          child_spec: engineeringSessionSpec(created, entry.task_run_id, manifest.parent_session_id),
          turn_id: `turn:${entry.task_run_id}`,
          message: {
            role: 'user',
            content: JSON.stringify({
              sources: created.contract.sources,
              requirements: created.contract.requirements,
              acceptance: created.contract.acceptance,
              scope: created.contract.scope,
            }),
          },
        };
      }),
    })),
  };
  return {
    store,
    runtime,
    engine,
    supervisor,
    workflow,
    children: assemblies,
    async drain() {
      for (const child of assemblies.values()) {
        await child.assembly.tools.drain();
        await child.assembly.modelConnection?.close();
      }
    },
  };
}

async function runEngineeringWorkflow({ definition: value, createOnly = false, environment, fetchImpl }) {
  const { definition } = parseEngineeringWorkflow(value);
  const handle = createExecutionLedgerFileFixture();
  let assembly;
  try {
    const started = Date.now();
    const parentId = `session:${randomUUID()}`;
    const manifest = {
      schema_version: 1,
      definition,
      definition_sha256: engineeringDigest(definition),
      parent_session_id: parentId,
      tasks: [],
    };
    fs.mkdirSync(path.join(handle.directory, 'tasks'), { mode: 0o700 });
    for (const entry of definition.tasks) {
      const id = randomUUID();
      const sessionId = `session:${randomUUID()}`;
      const directory = path.join(handle.directory, 'tasks', id);
      fs.mkdirSync(directory, { mode: 0o700 });
      createEngineeringTaskWorkspace(
        { db: handle.db, directory },
        {
          kind: 'created',
          contract: entry.contract,
          contract_sha256: engineeringDigest(entry.contract),
          session_id: sessionId,
          deadline: started + entry.contract.limits.max_duration_ms,
          responses: entry.responses,
          ...(entry.binding ? { binding: entry.binding } : {}),
        },
        id,
      );
      manifest.tasks.push({ id: entry.id, task_run_id: id, session_id: sessionId });
    }
    fs.writeFileSync(path.join(handle.directory, 'engineering-workflow.json'), JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
    assembly = assembleEngineeringWorkflow(handle, manifest, { environment, fetchImpl });
    const first = new EngineeringTaskState(handle.db, manifest.tasks[0].task_run_id).read().created;
    const spec = engineeringSessionSpec(first, randomUUID());
    spec.session_id = parentId;
    spec.limits = definition.limits;
    spec.metadata = {
      profile_id: 'engineering-workflow-candidate',
      definition_sha256: manifest.definition_sha256,
      manifest_sha256: engineeringDigest(manifest),
      operational: false,
    };
    await assembly.runtime.create({ schema_version: 1, command: 'create', spec });
    if (!createOnly) await executeWorkflow(assembly, manifest);
    return workflowSummary(handle, manifest, assembly.store);
  } finally {
    await assembly?.drain();
    handle.close();
  }
}

async function executeWorkflow(assembly, manifest, resumeFromRef) {
  let cancellation;
  const requestCancellation = () => {
    if (!cancellation && assembly.store.replay(manifest.parent_session_id).cancellation_request) {
      cancellation = assembly.supervisor.cancelRoot({
        schema_version: 1,
        request_id: `cancel:${randomUUID()}`,
        root_session_id: manifest.parent_session_id,
        reason: 'Workflow cancelled',
        deadline_ms: 10_000,
      });
      cancellation.catch(() => {});
    }
  };
  const timer = setInterval(requestCancellation, 25);
  try {
    const owner = executorOwner();
    await assembly.supervisor.runWorkflow('workflow:local', {
      schema_version: 1,
      engine_id: 'workflow:local',
      request_id: `request:engineering-${owner.pid}-${owner.start_ticks}-${randomUUID()}`,
      ...(resumeFromRef ? { resume_from_ref: resumeFromRef } : {}),
      parent_session_id: manifest.parent_session_id,
      workflow: assembly.workflow,
      occurred_at: new Date().toISOString(),
    });
    requestCancellation();
    if (cancellation) await cancellation;
  } finally {
    clearInterval(timer);
  }
}

function readDefinitionFile(filename, { yaml = false, maxBytes = 1_048_576 } = {}) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error('Invalid workflow definition file');
    const buffer = Buffer.alloc(maxBytes + 1);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const after = fs.fstatSync(fd);
    const current = fs.lstatSync(filename);
    if (
      count !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.isSymbolicLink()
    )
      throw new Error('Workflow definition changed');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count));
    return yaml ? require('yaml').parse(text, { maxAliasCount: 0, uniqueKeys: true }) : JSON.parse(text);
  } finally {
    fs.closeSync(fd);
  }
}

function migrateEngineeringWorkflow({ source, output }) {
  // Only complete definitions are eligible. Legacy run state and methodological recipes fail the strict schema.
  const { definition } = parseEngineeringWorkflow(readDefinitionFile(source, { yaml: true }));
  fs.writeFileSync(output, `${JSON.stringify(definition, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return {
    schema_version: 1,
    workflow_id: definition.workflow_id,
    status: 'definition-migrated',
    definition: path.resolve(output),
    execution_authorized: false,
  };
}

function workflowClaimOwner(reservation) {
  const match = /^request:engineering-([0-9]+)-([0-9]+)-[a-f0-9-]{36}$/.exec(reservation.claim_id);
  return match ? { ...executorOwner(), pid: Number(match[1]), start_ticks: match[2] } : null;
}

async function inspectEngineeringWorkflow({
  state: directory,
  action = 'status',
  expectedSequence,
  environment,
  fetchImpl,
  reconciliationDecisions,
}) {
  const handle = openExecutionLedgerFileFixture(path.resolve(directory));
  let assembly;
  try {
    const manifest = readDefinitionFile(path.join(handle.directory, 'engineering-workflow.json'), { maxBytes: 2_097_152 });
    const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
    const parent = store.replay(manifest.parent_session_id);
    if (parent.spec.metadata.manifest_sha256 !== engineeringDigest(manifest)) throw new Error('Workflow manifest digest mismatch');
    const reservation = parent.workflow_reservations[manifest.definition.workflow_id];
    if (action === 'status' || reservation?.released || parent.terminal_event) return workflowSummary(handle, manifest, store);
    const inspectInterrupted = async () => {
      assembly ||= assembleEngineeringWorkflow(handle, manifest, { environment, fetchImpl, reconciliationDecisions });
      const reports = {};
      if (reconciliationDecisions && Object.keys(reconciliationDecisions).some((id) => !manifest.tasks.some((entry) => entry.id === id)))
        throw new Error('Reconciliation decisions reference an unknown workflow task');
      for (const entry of manifest.tasks) {
        const child = assembly.children.get(entry.session_id);
        const state = child.task.read();
        if (!state.started || state.result) continue;
        const inspected = await require('./engineering-reconciliation').inspectReconciliation(
          child.task,
          child.assembly,
          attestEngineeringExecutor,
        );
        reports[entry.id] = inspected.report;
      }
      return reports;
    };
    if (action === 'reconcile') {
      const reports = await inspectInterrupted();
      return {
        ...workflowSummary(handle, manifest, store),
        reconciliations: reports,
        questions: Object.values(reports).flatMap((report) => report.questions),
      };
    }
    if (action === 'resume') {
      if (expectedSequence !== parent.current_sequence) throw new Error('Expected workflow sequence is required');
      if (reservation) {
        const owner = workflowClaimOwner(reservation);
        if (!owner) return { ...workflowSummary(handle, manifest, store), status: 'blocked', reason: 'workflow-owner-unproven' };
        if (isExecutorOwnerAlive(owner))
          return { ...workflowSummary(handle, manifest, store), status: 'blocked', reason: 'workflow-owner-active' };
        if (parent.cancellation_request)
          return { ...workflowSummary(handle, manifest, store), status: 'blocked', reason: 'workflow-cancellation-requires-settlement' };
        for (const entry of manifest.tasks) {
          const task = new EngineeringTaskState(handle.db, entry.task_run_id).read();
          if (!parent.children.includes(entry.session_id)) continue;
          const child = store.replay(entry.session_id);
          if (!task.started && child.turn_order.length > 0)
            return {
              ...workflowSummary(handle, manifest, store),
              status: 'blocked',
              reason: 'workflow-effect-reconciliation-required',
              questions: ['Há execução sem registro de início da tarefa. Qual evidência deve ser reconciliada antes de continuar?'],
            };
        }
        const reports = await inspectInterrupted();
        const pending = Object.entries(reports).filter(
          ([id, report]) =>
            !report.prerequisites_verified ||
            (report.questions.length > 0 &&
              (!reconciliationDecisions?.[id]?.answer?.trim() || reconciliationDecisions[id].report_sha256 !== report.sha256)),
        );
        if (pending.length > 0)
          return {
            ...workflowSummary(handle, manifest, store),
            status: 'blocked',
            reason: 'workflow-effect-reconciliation-required',
            reconciliations: reports,
            questions: pending.flatMap(([, report]) => report.questions),
          };
        await reapExecutorOwner(owner);
        const waitMs = Date.parse(reservation.claim_expires_at) - Date.now() + 1;
        if (waitMs > 1500) return { ...workflowSummary(handle, manifest, store), status: 'blocked', reason: 'workflow-claim-not-expired' };
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        if (store.replay(parent.session_id).current_sequence !== expectedSequence) throw new Error('Workflow changed during recovery');
      }
      assembly ||= assembleEngineeringWorkflow(handle, manifest, { environment, fetchImpl, reconciliationDecisions });
      await executeWorkflow(assembly, manifest, reservation?.claim_ref);
    } else if (action === 'cancel') {
      if (reservation) {
        const owner = workflowClaimOwner(reservation);
        if (!owner) return { ...workflowSummary(handle, manifest, store), status: 'blocked', reason: 'workflow-owner-unproven' };
        const interrupted = !isExecutorOwnerAlive(owner);
        if (interrupted) {
          await reapExecutorOwner(owner);
          const waitMs = Date.parse(reservation.claim_expires_at) - Date.now() + 1;
          if (waitMs > 1500)
            return { ...workflowSummary(handle, manifest, store), status: 'blocked', reason: 'workflow-claim-not-expired' };
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
          if (store.replay(parent.session_id).current_sequence !== parent.current_sequence)
            throw new Error('Workflow changed during cancellation');
        }
        if (!parent.cancellation_request)
          store.append({
            session_id: parent.session_id,
            expected_version: parent.current_sequence,
            events: [
              {
                schema_version: 1,
                event_id: `event:${randomUUID()}`,
                session_id: parent.session_id,
                sequence: parent.current_sequence + 1,
                occurred_at: new Date().toISOString(),
                event_type: 'session.cancellation.requested',
                payload: { reason: 'Workflow cancelled', cascade: true, source: 'user' },
              },
            ],
          });
        if (interrupted) {
          assembly = assembleEngineeringWorkflow(handle, manifest, { environment, fetchImpl });
          await executeWorkflow(assembly, manifest, reservation.claim_ref);
        }
        const deadline = Date.now() + 10_000;
        while (
          (!store.replay(parent.session_id).terminal_event || workflowSummary(handle, manifest, store).status === 'cancelling') &&
          Date.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 25));
        if (!store.replay(parent.session_id).terminal_event || workflowSummary(handle, manifest, store).status === 'cancelling')
          return { ...workflowSummary(handle, manifest, store), status: 'blocked', reason: 'workflow-cancellation-unconfirmed' };
      } else {
        assembly = assembleEngineeringWorkflow(handle, manifest, { environment, fetchImpl });
        await assembly.runtime.cancel({
          schema_version: 1,
          command: 'cancel',
          session_id: manifest.parent_session_id,
          reason: 'Workflow cancelled before execution',
          cascade: true,
        });
      }
    } else throw new Error('Unsupported workflow operation');
    return workflowSummary(handle, manifest, store);
  } finally {
    await assembly?.drain();
    handle.close();
  }
}

module.exports = {
  parseEngineeringWorkflow,
  migrateEngineeringWorkflow,
  readEngineeringWorkflow: readDefinitionFile,
  runEngineeringWorkflow,
  inspectEngineeringWorkflow,
};
