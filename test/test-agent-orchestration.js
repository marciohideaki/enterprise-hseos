'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { test } = require('node:test');

const Database = require('better-sqlite3');
const { LocalSubagentProvider, WorkflowEngine, digest } = require('../packages/agent-orchestration');
const { AgentRuntime } = require('../packages/agent-runtime');
const { assertPortShape } = require('../packages/agent-runtime-contracts');
const { RelationalSessionEventStore } = require('../packages/agent-session-store');
const { ModelProviderRegistry, ScriptedModelProvider } = require('../packages/model-providers');
const { ToolRuntime, ToolRuntimeRegistry } = require('../packages/tool-runtime');
const { ExecutionContractRegistry } = require('../tools/lib/governed-execution/contract-registry');
const { createExecutionEventRegistry } = require('../tools/lib/governed-execution/event-registry');
const { createGovernedExecutionPort } = require('../tools/lib/governed-execution/execution-port');
const { GovernedExecutionRuntime } = require('../tools/lib/governed-execution/runtime');
const { GovernedExecutionScheduler } = require('../tools/lib/governed-execution/scheduler');
const { ExecutionApprovalStore } = require('../tools/mcp-project-state/lib/execution-approval-store');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { ExecutionProjectionStore } = require('../tools/mcp-project-state/lib/execution-projections');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');

function modelManifest() {
  return {
    schema_version: 1,
    provider_type: 'model',
    provider_id: 'model:orchestration',
    provider_version: '1.0.0',
    models: ['fixture/orchestration'],
    capabilities: ['text_generation', 'streaming', 'usage', 'cancellation'],
    limits: { context_tokens: 100_000, max_output_tokens: 64, max_parallel_requests: 16 },
    secret_refs: [],
  };
}

function limits(overrides = {}) {
  return {
    max_turns: 2,
    max_tokens: 100_000,
    max_duration_ms: 10_000,
    max_tool_calls: 0,
    max_children: 8,
    max_workflow_steps: 8,
    ...overrides,
  };
}

function sessionSpec(sessionId, parentId = null, overrides = {}) {
  return {
    schema_version: 1,
    session_id: sessionId,
    agent_id: `agent:${sessionId.replaceAll(':', '-')}`,
    parent_session_id: parentId,
    authority_ref: 'authority://fixture/orchestration',
    policy_ref: 'policy://fixture/orchestration-v1',
    execution: { mode: 'kernel', model_provider_id: 'model:orchestration', model: 'fixture/orchestration' },
    limits: limits(overrides),
    metadata: { purpose: 'orchestration-conformance' },
  };
}

function contextProfile() {
  return {
    instructions: {
      constitution: [{ source_ref: 'governance://constitution', classification: 'internal', content: 'Obey governance.' }],
      project: [{ source_ref: 'project://fixture/instructions', classification: 'internal', content: 'Complete the bounded task.' }],
      adapter: [], agent: [], skill: [],
    },
    runtime_context: [], references: [], memory: [],
    parameters: { max_output_tokens: 32, temperature: null, stop: [] },
    overflow_policy: 'reject',
  };
}

function setup({ delayMs = 0, providerEvents = null } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const sessionStore = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(db) });
  const eventRegistry = createExecutionEventRegistry();
  const executionLedger = new ExecutionEventLedger(db, { event_registry: eventRegistry });
  const projection = new ExecutionProjectionStore(db, executionLedger);
  projection.rebuild();
  const contracts = new ExecutionContractRegistry();
  const governed = new GovernedExecutionRuntime({
    contracts,
    event_registry: eventRegistry,
    ledger: executionLedger,
    approval_store: new ExecutionApprovalStore(db),
    authority: { async evaluate() { return { allowed: true }; } },
    policy: { async evaluate() { return { allowed: true, requires_approval: false, policy_version: 'fixture', warnings: [] }; } },
    providers: new Map(),
    projector: projection,
    clock: { now: () => new Date().toISOString() },
    event_id_factory: randomUUID,
  });
  const toolRegistry = new ToolRuntimeRegistry({ contracts });
  const tools = new ToolRuntime({
    registry: toolRegistry,
    scheduler: new GovernedExecutionScheduler({ contracts, port: createGovernedExecutionPort(governed), maxConcurrency: 2 }),
  });
  const manifest = modelManifest();
  const provider = new ScriptedModelProvider({
    manifest,
    routes: [
      {
        match: () => true,
        events: providerEvents || [
          ...(delayMs ? [{ delay_ms: delayMs, event_type: 'content.delta', payload: { text: 'done' } }] : []),
          { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://orchestration-done' } },
        ],
      },
      { match: () => false, events: [] },
    ],
  });
  const registry = new ModelProviderRegistry();
  registry.register(provider, manifest);
  const runtime = new AgentRuntime({
    session_store: sessionStore,
    model_provider_snapshot: registry.snapshot(),
    tool_runtime: tools,
    context_profile_resolver: contextProfile,
  });
  const subagents = new LocalSubagentProvider({
    session_store: sessionStore,
    agent_runtime: runtime,
    provider_id: 'subagent:fixture',
    max_parallel_children: 4,
  });
  const workflows = new WorkflowEngine({
    engine_id: 'workflow:fixture',
    session_store: sessionStore,
    subagent_provider: subagents,
  });
  return { db, runtime, sessionStore, subagents, workflows };
}

async function createParent(fixture, overrides = {}) {
  const spec = sessionSpec('session:parent', null, overrides);
  await fixture.runtime.create({ schema_version: 1, command: 'create', spec });
  return spec;
}

function spawnInput(childId = 'session:child-1', overrides = {}) {
  return {
    schema_version: 1,
    provider_id: 'subagent:fixture',
    request_id: `request:spawn-${childId.replaceAll(':', '-')}`,
    parent_session_id: 'session:parent',
    parent_sequence: 1,
    child_spec: sessionSpec(childId, 'session:parent', { max_children: 0, max_workflow_steps: 0 }),
    turn_id: `turn:${childId.replaceAll(':', '-')}`,
    message: { role: 'user', content: 'complete bounded child work' },
    occurred_at: new Date().toISOString(),
    ...overrides,
  };
}

function workflow(phases, overrides = {}) {
  return {
    schema_version: 1,
    workflow_id: 'workflow:fixture-1',
    subagent_provider_id: 'subagent:fixture',
    max_parallelism: 2,
    join_timeout_ms: 2000,
    phases,
    ...overrides,
  };
}

function step(id) {
  return {
    step_id: `step:${id}`,
    child_spec: sessionSpec(`session:child-${id}`, 'session:parent', { max_children: 0, max_workflow_steps: 0 }),
    turn_id: `turn:child-${id}`,
    message: { role: 'user', content: `execute step ${id}` },
  };
}

function runInput(definition) {
  return {
    schema_version: 1,
    engine_id: 'workflow:fixture',
    request_id: 'request:workflow-run-1',
    parent_session_id: 'session:parent',
    workflow: definition,
    occurred_at: new Date().toISOString(),
  };
}

test('local provider forks exact scope and joins a terminal child', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await createParent(fixture);
  assert.deepEqual(assertPortShape('SubagentProvider', fixture.subagents).methods, ['manifest', 'spawn', 'join', 'cancel', 'dispose']);
  const spawned = await fixture.subagents.spawn(spawnInput());
  assert.equal(spawned.accepted, true);
  const joined = await fixture.subagents.join({
    schema_version: 1,
    provider_id: 'subagent:fixture',
    request_id: 'request:join-child-1',
    parent_session_id: 'session:parent',
    child_session_ids: ['session:child-1'],
    timeout_ms: 2000,
  });
  assert.equal(joined.all_terminal, true);
  assert.equal(joined.children[0].status, 'completed', JSON.stringify(fixture.sessionStore.replay('session:child-1').terminal_event));
  assert.deepEqual(fixture.sessionStore.replay('session:child-1').parent, { parent_session_id: 'session:parent', parent_sequence: 1 });
});

test('authority and resource widening fail before a child can exist', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const authority = spawnInput('session:child-authority');
  authority.child_spec.authority_ref = 'authority://forged/admin';
  await assert.rejects(() => fixture.subagents.spawn(authority), /authority|policy/);
  const resource = spawnInput('session:child-resource');
  resource.child_spec.limits.max_tokens = 100_001;
  await assert.rejects(() => fixture.subagents.spawn(resource), /resource limits/);
  assert.deepEqual(fixture.sessionStore.readSession('session:child-authority'), []);
  assert.deepEqual(fixture.sessionStore.readSession('session:child-resource'), []);
});

test('provider identity fails before effects and a pre-checkpoint crash resumes the existing child', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const forged = spawnInput('session:child-forged', { provider_id: 'subagent:forged' });
  await assert.rejects(() => fixture.subagents.spawn(forged), /identity mismatch/);
  assert.deepEqual(fixture.sessionStore.readSession('session:child-forged'), []);

  const child = step('crash-gap');
  const definition = workflow([{ phase_id: 'phase:crash-gap', mode: 'pipeline', steps: [child] }]);
  const definitionDigest = digest(definition);
  fixture.sessionStore.append({
    session_id: 'session:parent',
    expected_version: 1,
    events: [{
      schema_version: 1,
      event_id: 'event:crash-gap-reservation',
      session_id: 'session:parent',
      sequence: 2,
      occurred_at: new Date().toISOString(),
      event_type: 'workflow.reserved',
      payload: {
        workflow_id: definition.workflow_id,
        definition_digest: definitionDigest,
        claim_id: 'request:crashed-original',
        claim_expires_at: '2026-01-01T00:00:00.000Z',
        step_count: 1,
        child_session_ids: [child.child_spec.session_id],
      },
    }],
  });
  await fixture.subagents.spawn({
    ...spawnInput(child.child_spec.session_id),
    parent_sequence: 2,
    child_spec: child.child_spec,
    turn_id: child.turn_id,
    message: child.message,
  });
  await fixture.subagents.join({
    schema_version: 1,
    provider_id: 'subagent:fixture',
    request_id: 'request:crash-gap-join',
    parent_session_id: 'session:parent',
    child_session_ids: [child.child_spec.session_id],
    timeout_ms: 2000,
  });
  assert.equal(fixture.sessionStore.replay('session:parent').workflow_checkpoints.length, 0);
  const drifted = structuredClone(definition);
  drifted.phases[0].steps[0].message.content = 'replace the already durable child input';
  await assert.rejects(() => fixture.subagents.spawn({
    ...spawnInput(child.child_spec.session_id),
    child_spec: child.child_spec,
    turn_id: child.turn_id,
    message: drifted.phases[0].steps[0].message,
  }), /identity or scope differs/);
  assert.equal(fixture.sessionStore.replay('session:parent').workflow_checkpoints.length, 0);
  const competing = workflow([{ phase_id: 'phase:competing', mode: 'pipeline', steps: [step('competing')] }], {
    workflow_id: 'workflow:competing-after-crash',
  });
  await assert.rejects(() => fixture.workflows.run({
    ...runInput(competing),
    request_id: 'request:competing-after-crash',
  }), /step limit|active durable workflow/);
  assert.deepEqual(fixture.sessionStore.readSession('session:child-competing'), []);
  const resumeInput = { ...runInput(definition), resume_from_ref: 'session-event://event:crash-gap-reservation' };
  const resumedRun = fixture.workflows.run(resumeInput);
  const competingResumeEngine = new WorkflowEngine({
    engine_id: 'workflow:competing-resumer',
    session_store: new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(fixture.db) }),
    subagent_provider: fixture.subagents,
  });
  await assert.rejects(
    () => competingResumeEngine.run({ ...resumeInput, engine_id: 'workflow:competing-resumer' }),
    (error) => ['WORKFLOW_ALREADY_ACTIVE', 'WORKFLOW_PARENT_ALREADY_ACTIVE', 'WORKFLOW_RESUME_CLAIM_STALE'].includes(error.code),
  );
  const resumed = await resumedRun;
  assert.equal(resumed.status, 'completed');
  assert.equal(fixture.sessionStore.replay('session:parent').workflow_checkpoints.length, 1);
  assert.equal(fixture.sessionStore.readSession(child.child_spec.session_id).filter((event) => event.event_type === 'turn.started').length, 1);
});

test('workflow executes bounded parallel and pipeline phases with durable exact checkpoints', async (context) => {
  const fixture = setup({ delayMs: 5 });
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const definition = workflow([
    { phase_id: 'phase:parallel', mode: 'parallel', steps: [step('p1'), step('p2'), step('p3')] },
    { phase_id: 'phase:pipeline', mode: 'pipeline', steps: [step('s1'), step('s2')] },
  ]);
  const result = await fixture.workflows.run(runInput(definition));
  assert.equal(result.status, 'completed');
  assert.equal(result.children.length, 5);
  assert.equal(result.children.every((child) => child.status === 'completed'), true);
  const parent = fixture.sessionStore.replay('session:parent');
  assert.deepEqual(parent.workflows['workflow:fixture-1'].phases, ['phase:parallel', 'phase:pipeline']);
  assert.deepEqual(parent.workflow_checkpoints.map((item) => item.completed_step_ids.length), [3, 2]);
  const retried = await fixture.workflows.run(runInput(definition));
  assert.equal(retried.status, 'completed');
  assert.equal(fixture.sessionStore.replay('session:parent').workflow_checkpoints.length, 2);
});

test('workflow identifier cannot drift and caps fail before dispatch', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await createParent(fixture, { max_children: 2, max_workflow_steps: 2 });
  const accepted = workflow([{ phase_id: 'phase:first', mode: 'pipeline', steps: [step('one')] }]);
  assert.equal((await fixture.workflows.run(runInput(accepted))).status, 'completed');
  const drifted = workflow([{ phase_id: 'phase:changed', mode: 'pipeline', steps: [step('two')] }]);
  await assert.rejects(() => fixture.workflows.run(runInput(drifted)), /durable definition/);
  const oversized = workflow([{ phase_id: 'phase:large', mode: 'parallel', steps: [step('x'), step('y'), step('z')] }], {
    workflow_id: 'workflow:too-large',
  });
  await assert.rejects(() => fixture.workflows.run(runInput(oversized)), /step limit|child count/);
  const overParallel = workflow([{ phase_id: 'phase:parallel-cap', mode: 'parallel', steps: [step('parallel-cap')] }], {
    workflow_id: 'workflow:over-parallel',
    max_parallelism: 5,
  });
  await assert.rejects(() => fixture.workflows.run(runInput(overParallel)), /parallelism exceeds/);
  assert.deepEqual(fixture.sessionStore.readSession('session:child-x'), []);
  assert.deepEqual(fixture.sessionStore.readSession('session:child-parallel-cap'), []);
});

test('workflow cancellation cascades and returns with no orphan child', async (context) => {
  const fixture = setup({ delayMs: 5000 });
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const definition = workflow([{ phase_id: 'phase:slow', mode: 'parallel', steps: [step('slow1'), step('slow2')] }]);
  const running = fixture.workflows.run(runInput(definition));
  await assert.rejects(() => fixture.workflows.run(runInput(definition)), /already active/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(() => fixture.workflows.dispose({
    schema_version: 1,
    engine_id: 'workflow:forged',
    request_id: 'request:forged-dispose',
    reason: 'must fail before effects',
  }), /identity mismatch/);
  assert.equal(fixture.sessionStore.replay('session:child-slow1').terminal_event, null);
  const cancelled = await fixture.workflows.cancel({
    schema_version: 1,
    engine_id: 'workflow:fixture',
    request_id: 'request:workflow-cancel-1',
    parent_session_id: 'session:parent',
    workflow_id: 'workflow:fixture-1',
    reason: 'operator cancelled workflow',
  });
  assert.equal(cancelled.status, 'cancelled');
  const final = await running;
  assert.equal(final.status, 'cancelled');
  for (const childId of ['session:child-slow1', 'session:child-slow2']) {
    assert.equal(Boolean(fixture.sessionStore.replay(childId).terminal_event), true);
  }
});

test('workflow verifies provider join claims against durable child state', async (context) => {
  const fixture = setup({ delayMs: 5000 });
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const provider = {
    manifest: fixture.subagents.manifest.bind(fixture.subagents),
    spawn: fixture.subagents.spawn.bind(fixture.subagents),
    async join(input) {
      return {
        schema_version: 1,
        provider_id: input.provider_id,
        request_id: input.request_id,
        parent_session_id: input.parent_session_id,
        all_terminal: true,
        children: input.child_session_ids.map((child_session_id) => ({
          child_session_id,
          status: 'completed',
          outcome_ref: 'event://forged-terminal',
        })),
        evidence_refs: ['event://forged-terminal'],
      };
    },
    cancel: fixture.subagents.cancel.bind(fixture.subagents),
    dispose: fixture.subagents.dispose.bind(fixture.subagents),
  };
  const engine = new WorkflowEngine({
    engine_id: 'workflow:durable-verifier',
    session_store: fixture.sessionStore,
    subagent_provider: provider,
  });
  const definition = workflow([{ phase_id: 'phase:forged-join', mode: 'pipeline', steps: [step('forged-join')] }]);
  const result = await engine.run({ ...runInput(definition), engine_id: 'workflow:durable-verifier' });
  assert.equal(result.status, 'failed');
  assert.equal(fixture.sessionStore.replay('session:parent').workflow_checkpoints.length, 0);
  assert.equal(fixture.sessionStore.replay('session:child-forged-join').terminal_event.event_type, 'session.cancelled');
});

test('one parent cannot dispatch concurrent workflows across engine instances beyond its durable caps', async (context) => {
  const fixture = setup({ delayMs: 50 });
  context.after(() => fixture.db.close());
  await createParent(fixture, { max_children: 2, max_workflow_steps: 1 });
  const first = workflow([{ phase_id: 'phase:concurrent-one', mode: 'pipeline', steps: [step('concurrent-one')] }], {
    workflow_id: 'workflow:concurrent-one',
  });
  const second = workflow([{ phase_id: 'phase:concurrent-two', mode: 'pipeline', steps: [step('concurrent-two')] }], {
    workflow_id: 'workflow:concurrent-two',
  });
  const secondEngine = new WorkflowEngine({
    engine_id: 'workflow:fixture-second',
    session_store: new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(fixture.db) }),
    subagent_provider: fixture.subagents,
  });
  const firstRun = fixture.workflows.run({ ...runInput(first), request_id: 'request:concurrent-one' });
  await assert.rejects(
    () => secondEngine.run({
      ...runInput(second),
      engine_id: 'workflow:fixture-second',
      request_id: 'request:concurrent-two',
    }),
    (error) => ['WORKFLOW_PARENT_ALREADY_ACTIVE', 'WORKFLOW_STEP_LIMIT_EXCEEDED'].includes(error.code),
  );
  assert.equal((await firstRun).status, 'completed');
  assert.deepEqual(fixture.sessionStore.readSession('session:child-concurrent-two'), []);
});

test('an exact reclaim cannot preempt a live workflow on the same durable authority', async (context) => {
  const fixture = setup({ delayMs: 50 });
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const definition = workflow([{ phase_id: 'phase:same-claim', mode: 'pipeline', steps: [step('same-claim')] }], {
    workflow_id: 'workflow:same-claim',
  });
  const secondStore = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(fixture.db) });
  const secondProvider = new LocalSubagentProvider({
    session_store: secondStore,
    agent_runtime: fixture.runtime,
    provider_id: 'subagent:fixture',
    max_parallel_children: 4,
  });
  const secondEngine = new WorkflowEngine({
    engine_id: 'workflow:same-claim-second',
    session_store: secondStore,
    subagent_provider: secondProvider,
  });
  const firstRun = fixture.workflows.run({ ...runInput(definition), request_id: 'request:same-claim-first' });
  const liveClaim = fixture.sessionStore.replay('session:parent').workflow_reservations['workflow:same-claim'].claim_ref;
  await assert.rejects(
    () => secondEngine.run({
      ...runInput(definition),
      engine_id: 'workflow:same-claim-second',
      request_id: 'request:same-claim-second',
      resume_from_ref: liveClaim,
    }),
    (error) => ['WORKFLOW_ALREADY_ACTIVE', 'WORKFLOW_PARENT_ALREADY_ACTIVE'].includes(error.code),
  );
  assert.equal((await firstRun).status, 'completed');
  assert.equal(fixture.sessionStore.readSession('session:child-same-claim').filter((event) => event.event_type === 'turn.started').length, 1);
});

test('provider cancellation terminalizes the complete descendant tree', async (context) => {
  const fixture = setup({ delayMs: 5000 });
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const childId = 'session:child-tree-root';
  const grandchildId = 'session:child-tree-leaf';
  await fixture.subagents.spawn(spawnInput(childId, {
    child_spec: sessionSpec(childId, 'session:parent', { max_children: 1, max_workflow_steps: 1 }),
  }));
  const childSequence = fixture.sessionStore.replay(childId).current_sequence;
  await fixture.subagents.spawn({
    schema_version: 1,
    provider_id: 'subagent:fixture',
    request_id: 'request:spawn-tree-leaf',
    parent_session_id: childId,
    parent_sequence: childSequence,
    child_spec: sessionSpec(grandchildId, childId, { max_children: 0, max_workflow_steps: 0 }),
    turn_id: 'turn:child-tree-leaf',
    message: { role: 'user', content: 'remain bounded beneath the direct child' },
    occurred_at: new Date().toISOString(),
  });

  const cancelled = await fixture.subagents.cancel({
    schema_version: 1,
    provider_id: 'subagent:fixture',
    request_id: 'request:cancel-tree',
    parent_session_id: 'session:parent',
    child_session_ids: [childId],
    reason: 'operator cancelled the complete child tree',
  });
  assert.deepEqual(cancelled.children.map((child) => child.child_session_id), [childId]);
  assert.equal(cancelled.evidence_refs.length, 2);
  assert.equal(fixture.sessionStore.replay(childId).terminal_event.event_type, 'session.cancelled');
  assert.equal(fixture.sessionStore.replay(grandchildId).terminal_event.event_type, 'session.cancelled');
});

test('join deadline cancels every child and provider parallel caps reject before fork', async (context) => {
  const fixture = setup({ delayMs: 5000 });
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const ids = ['cap1', 'cap2', 'cap3', 'cap4'];
  await Promise.all(ids.map((id) => fixture.subagents.spawn(spawnInput(`session:child-${id}`))));
  await assert.rejects(
    () => fixture.subagents.spawn(spawnInput('session:child-cap5')),
    (error) => error.code === 'SUBAGENT_PARALLEL_LIMIT_EXCEEDED',
  );
  assert.deepEqual(fixture.sessionStore.readSession('session:child-cap5'), []);
  const joined = await fixture.subagents.join({
    schema_version: 1,
    provider_id: 'subagent:fixture',
    request_id: 'request:join-deadline',
    parent_session_id: 'session:parent',
    child_session_ids: ids.map((id) => `session:child-${id}`),
    timeout_ms: 10,
  });
  assert.equal(joined.all_terminal, true);
  assert.equal(joined.children.every((child) => child.status === 'cancelled'), true);
});

test('terminal unjoined children no longer consume the live parallel cap', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const childIds = ['released1', 'released2', 'released3', 'released4'].map((id) => `session:child-${id}`);
  await Promise.all(childIds.map((childId) => fixture.subagents.spawn(spawnInput(childId))));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(childIds.every((childId) => Boolean(fixture.sessionStore.replay(childId).terminal_event)), true);
  const fifth = 'session:child-released5';
  assert.equal((await fixture.subagents.spawn(spawnInput(fifth))).accepted, true);
  await fixture.subagents.join({
    schema_version: 1,
    provider_id: 'subagent:fixture',
    request_id: 'request:join-released-cap',
    parent_session_id: 'session:parent',
    child_session_ids: [...childIds, fifth],
    timeout_ms: 2000,
  });
});

test('malformed runtime result is rejected only after the child is terminalized', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await createParent(fixture);
  const runtime = fixture.runtime;
  const malformed = {
    create: runtime.create.bind(runtime),
    resume: runtime.resume.bind(runtime),
    async send(input) {
      const result = await runtime.send(input);
      return { ...result, session_id: 'session:forged-result' };
    },
    cancel: runtime.cancel.bind(runtime),
    dispose: runtime.dispose.bind(runtime),
  };
  const provider = new LocalSubagentProvider({
    session_store: fixture.sessionStore,
    agent_runtime: malformed,
    provider_id: 'subagent:malformed-runtime',
    max_parallel_children: 1,
  });
  const input = spawnInput('session:child-malformed-runtime', { provider_id: 'subagent:malformed-runtime' });
  await provider.spawn(input);
  await assert.rejects(
    () => provider.join({
      schema_version: 1,
      provider_id: 'subagent:malformed-runtime',
      request_id: 'request:join-malformed-runtime',
      parent_session_id: 'session:parent',
      child_session_ids: ['session:child-malformed-runtime'],
      timeout_ms: 2000,
    }),
    (error) => error.code === 'SUBAGENT_RUNTIME_FAILED',
  );
  assert.equal(Boolean(fixture.sessionStore.replay('session:child-malformed-runtime').terminal_event), true);
});
