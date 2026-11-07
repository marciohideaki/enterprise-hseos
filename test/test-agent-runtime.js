'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { test } = require('node:test');

const Database = require('better-sqlite3');
const { z } = require('zod');
const {
  CompactionProviderRegistry,
  CompactionRuntime,
  DeterministicCompactionProvider,
  InMemoryCheckpointProvider,
} = require('../packages/agent-compaction');

const { ContextAssembler } = require('../packages/agent-context');
const { ContextBudgetError, ContextAssemblyError } = require('../packages/agent-context/context-assembler');
const { AgentRuntime, RUNTIME_CAPS, stableId } = require('../packages/agent-runtime');
const {
  CONTRACT_SCHEMA_VERSION,
  MAX_MODEL_EVENTS_PER_STEP,
  assertPortShape,
  validatePortResult,
} = require('../packages/agent-runtime-contracts');
const { RelationalSessionEventStore, canonicalJson } = require('../packages/agent-session-store');
const { ModelProviderRegistry, ScriptedModelProvider } = require('../packages/model-providers');
const { accountSessionTokens } = require('../packages/agent-context/token-counter');
const { ToolRuntime, ToolRuntimeRegistry, governanceRef } = require('../packages/tool-runtime');
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

function manifest() {
  return {
    schema_version: 1,
    provider_type: 'model',
    provider_id: 'model:loop-fixture',
    provider_version: '1.0.0',
    models: ['fixture/loop-model'],
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'usage', 'cancellation'],
    limits: { context_tokens: 2_000_000, max_output_tokens: 256, max_parallel_requests: 8 },
    secret_refs: [],
  };
}

function spec(sessionId, overrides = {}) {
  return {
    schema_version: 1,
    session_id: sessionId,
    agent_id: 'agent:loop-fixture',
    parent_session_id: null,
    authority_ref: 'authority://fixture/agent',
    policy_ref: 'policy://fixture/v1',
    execution: { mode: 'kernel', model_provider_id: 'model:loop-fixture', model: 'fixture/loop-model' },
    limits: {
      max_turns: 4,
      max_tokens: 2_000_000,
      max_duration_ms: 30_000,
      max_tool_calls: 4,
      max_children: 0,
      max_workflow_steps: 0,
      ...overrides,
    },
    metadata: { purpose: 'agent-loop-conformance' },
  };
}

function profile() {
  return {
    instructions: {
      constitution: [{ source_ref: 'governance://constitution', classification: 'internal', content: 'Obey governance.' }],
      project: [{ source_ref: 'project://fixture/instructions', classification: 'internal', content: 'Use tools when needed.' }],
      adapter: [],
      agent: [],
      skill: [],
    },
    runtime_context: [],
    references: [],
    memory: [],
    parameters: { max_output_tokens: 64, temperature: null, stop: [] },
    overflow_policy: 'reject',
  };
}

function executionContract() {
  const executable = (schema) => Object.freeze({ version: 1, safeParse: schema.safeParse.bind(schema) });
  return {
    name: 'fixture.echo',
    capability: 'fixture.echo',
    provider: 'fixture-provider',
    authority: 'fixture.execute',
    policy_version: 'policy-v1',
    reversibility: 'read_only',
    cancellation_policy: 'cooperative',
    failure_mode: 'fail_closed',
    timeout_ms: 500,
    requires_approval: false,
    exclusive: false,
    provider_accepts_idempotency: true,
    sandbox: null,
    prerequisites: [],
    input_schema: executable(z.object({ value: z.string() }).strict()),
    output_schema: executable(z.object({ echoed: z.string() }).strict()),
  };
}

function toolDefinition() {
  return {
    name: 'fixture.echo',
    description: 'Echo deterministic external state.',
    input_schema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    governance_ref: governanceRef('fixture.echo'),
  };
}

function modelRoutes({
  slow = false,
  calls = null,
  toolStepUsage = null,
  finalUsage = { input_tokens: 20, output_tokens: 3, cached_tokens: 0 },
} = {}) {
  return [
    {
      match: (request) => request.messages.at(-1).role === 'user',
      events: slow
        ? [
            { delay_ms: 5000, event_type: 'content.delta', payload: { text: 'late' } },
            { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://late' } },
          ]
        : [
            {
              event_type: 'tool_call.delta',
              payload: { tool_call_id: 'call:echo-1', name: 'fixture.echo', arguments_delta: '{"value":"durable"}' },
            },
            ...(toolStepUsage ? [{ event_type: 'usage', payload: toolStepUsage }] : []),
            { event_type: 'completed', payload: { finish_reason: 'tool_calls', provider_response_ref: 'scripted://tool' } },
          ],
    },
    {
      match: (request) => request.messages.at(-1).role === 'tool',
      events(request) {
        if (calls) calls.continuations++;
        assert.equal(request.messages.at(-2).role, 'assistant');
        assert.equal(request.messages.at(-2).tool_calls[0].name, 'fixture.echo');
        assert.match(request.messages.at(-1).content, /durable/);
        return [
          { event_type: 'content.delta', payload: { text: 'verified external state' } },
          { event_type: 'usage', payload: finalUsage },
          { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://done' } },
        ];
      },
    },
  ];
}

function setup({
  routes = modelRoutes(),
  limits = {},
  clock = Date,
  streamLimits = {},
  modelManifest = manifest(),
  contextProfileResolver = profile,
  compactionRuntime = null,
  toolResultBody = null,
} = {}) {
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
  const registered = contracts.register(executionContract());
  const external = { dispatches: 0, value: null };
  const governed = new GovernedExecutionRuntime({
    contracts,
    event_registry: eventRegistry,
    ledger: executionLedger,
    approval_store: new ExecutionApprovalStore(db),
    authority: {
      async evaluate() {
        return { allowed: true };
      },
    },
    policy: {
      async evaluate() {
        return { allowed: true, requires_approval: false, policy_version: registered.policy_version, warnings: [] };
      },
    },
    providers: new Map([
      [
        'fixture-provider',
        {
          async execute(input) {
            external.dispatches++;
            external.value = input.value;
            return { data: { echoed: toolResultBody ?? input.value }, evidence: ['evidence://external-read'] };
          },
        },
      ],
    ]),
    projector: projection,
    clock: { now: () => new Date(clock.now()).toISOString() },
    event_id_factory: randomUUID,
  });
  const toolRegistry = new ToolRuntimeRegistry({ contracts });
  toolRegistry.register(toolDefinition());
  const tools = new ToolRuntime({
    registry: toolRegistry,
    scheduler: new GovernedExecutionScheduler({ contracts, port: createGovernedExecutionPort(governed), maxConcurrency: 2 }),
  });

  const provider = new ScriptedModelProvider({ manifest: modelManifest, routes });
  const modelRegistry = new ModelProviderRegistry();
  modelRegistry.register(provider, modelManifest);
  const snapshot = modelRegistry.snapshot();
  const runtime = new AgentRuntime({
    session_store: sessionStore,
    model_provider_snapshot: snapshot,
    tool_runtime: tools,
    context_profile_resolver: contextProfileResolver,
    compaction_runtime: compactionRuntime,
    clock,
    stream_limits: streamLimits,
  });
  return { db, external, provider, runtime, sessionStore, snapshot, tools, sessionSpec: spec('session:loop', limits) };
}

function compactionRuntimeFixture() {
  const provider = new DeterministicCompactionProvider({ provider_id: 'compaction:runtime-fixture' });
  const registry = new CompactionProviderRegistry();
  const manifestInput = {
    schema_version: 1,
    request_id: 'request:runtime-compaction-manifest',
    provider_id: 'compaction:runtime-fixture',
  };
  registry.register(provider, provider.manifest(manifestInput));
  const checkpoint = new InMemoryCheckpointProvider({ provider_id: 'checkpoint:runtime-fixture' });
  return {
    checkpoint,
    runtime: new CompactionRuntime({
      compaction_provider_snapshot: registry.snapshot(),
      checkpoint_provider: checkpoint,
      checkpoint_provider_id: 'checkpoint:runtime-fixture',
    }),
  };
}

function createCommand(sessionSpec) {
  return { schema_version: 1, command: 'create', spec: sessionSpec };
}

function sendCommand(sessionId = 'session:loop') {
  return {
    schema_version: 1,
    command: 'send',
    session_id: sessionId,
    turn_id: 'turn:loop-1',
    message: { role: 'user', content: 'inspect external state' },
  };
}

function append(store, sessionId, eventType, payload, label) {
  const state = store.replay(sessionId);
  const event = {
    schema_version: 1,
    event_id: stableId('event', sessionId, label),
    session_id: sessionId,
    sequence: state.current_sequence + 1,
    occurred_at: new Date().toISOString(),
    event_type: eventType,
    payload,
  };
  store.append({ session_id: sessionId, expected_version: state.current_sequence, events: [event] });
  return event;
}

test('headless runtime satisfies the port and completes a durable multi-step governed tool journey', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  assert.deepEqual(assertPortShape('AgentRuntime', fixture.runtime).methods, ['create', 'resume', 'send', 'cancel', 'dispose']);
  const created = await fixture.runtime.create(createCommand(fixture.sessionSpec));
  assert.equal(created.terminal, false);
  const result = await fixture.runtime.send(sendCommand());
  assert.equal(result.terminal, true);
  assert.equal(fixture.external.dispatches, 1);
  assert.equal(fixture.external.value, 'durable');

  const state = fixture.sessionStore.replay('session:loop');
  assert.equal(state.status, 'completed');
  assert.equal(state.turns['turn:loop-1'].model_steps.length, 2);
  assert.equal(Object.keys(state.tool_invocations).length, 1);
  assert.equal(state.operation_ids.length, 1);
  assert.equal(state.turns['turn:loop-1'].model_steps[1].request.messages.at(-1).role, 'tool');
  const types = fixture.sessionStore.readSession('session:loop').map((event) => event.event_type);
  assert.ok(types.indexOf('model.request.started') < types.indexOf('model.streamed'));
  assert.ok(types.indexOf('tool.execution.started') < types.indexOf('tool.execution.completed'));
  assert.ok(types.indexOf('tool.execution.completed') < types.lastIndexOf('model.request.started'));
  assert.equal(types.at(-1), 'session.completed');

  const rows = fixture.db.prepare(`SELECT aggregate_type, event_type, position FROM execution_events ORDER BY position`).all();
  const toolIntent = rows.find(
    (row) =>
      row.aggregate_type === 'agent_session' &&
      row.event_type === 'AgentSessionEventRecorded' &&
      JSON.parse(
        fixture.db.prepare('SELECT payload_json FROM execution_events WHERE position = ?').get(row.position).payload_json,
      ).session_event_json.includes('tool.execution.started'),
  );
  const dispatchStart = rows.find((row) => row.aggregate_type === 'execution' && row.event_type === 'ExecutionStarted');
  assert.ok(toolIntent.position < dispatchStart.position, 'session tool intent is durable before governed dispatch');
});

test('tool-result pressure prunes bodies with lineage before a byte-exact continuation', async (context) => {
  const compaction = compactionRuntimeFixture();
  const boundedManifest = manifest();
  boundedManifest.limits.context_tokens = 4000;
  const largeResult = 'external result body '.repeat(600);
  const routes = [
    modelRoutes()[0],
    {
      match: (request) => request.messages.at(-1).role === 'tool',
      events(request) {
        const toolMessage = request.messages.at(-1);
        assert.equal(toolMessage.tool_call_id, 'call:echo-1');
        assert.match(toolMessage.content, /"pruned":true/);
        assert.match(toolMessage.content, /evidence:\/\/external-read/);
        assert.doesNotMatch(toolMessage.content, /external result body/);
        return [
          { event_type: 'content.delta', payload: { text: 'compacted continuation verified' } },
          { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://compact-done' } },
        ];
      },
    },
  ];
  const fixture = setup({
    routes,
    modelManifest: boundedManifest,
    toolResultBody: largeResult,
    compactionRuntime: compaction.runtime,
    contextProfileResolver: () => ({
      ...profile(),
      overflow_policy: 'compact',
      compaction_provider_id: 'compaction:runtime-fixture',
    }),
  });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const result = await fixture.runtime.send(sendCommand());
  assert.equal(result.terminal, true);
  const state = fixture.sessionStore.replay('session:loop');
  assert.equal(state.status, 'completed', JSON.stringify(fixture.sessionStore.readSession('session:loop')));
  const turn = state.turns['turn:loop-1'];
  assert.equal(turn.tool_compactions.length, 1);
  assert.equal(turn.model_steps.length, 2);
  assert.equal(turn.model_steps[1].request.messages.at(-1).tool_call_id, 'call:echo-1');
  assert.doesNotMatch(canonicalJson(turn.model_steps[1].request), /external result body/);
  const events = fixture.sessionStore.readSession('session:loop');
  const compactionIndex = events.findIndex((event) => event.event_type === 'compaction.completed');
  const continuationIndex = events.findIndex((event, index) => index > compactionIndex && event.event_type === 'model.request.started');
  assert.ok(compactionIndex > 0 && continuationIndex > compactionIndex);
  assert.deepEqual(turn.model_steps[1].source_event_ids, [turn.model_steps[0].terminal_event_id, events[compactionIndex].event_id]);
  assert.equal(events[compactionIndex].payload.source_event_ids[0], turn.tool_executions['call:echo-1'].completed_event_id);
});

test('a second runtime resumes after durable tool completion without redispatch', async (context) => {
  const calls = { continuations: 0 };
  const fixture = setup({ routes: modelRoutes({ calls }) });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const turn = append(
    fixture.sessionStore,
    'session:loop',
    'turn.started',
    { turn_id: 'turn:loop-1', input: sendCommand().message },
    'manual-turn',
  );
  const assembler = new ContextAssembler({ session_store: fixture.sessionStore, model_provider_snapshot: fixture.snapshot });
  const assembled = assembler.assembleAndRecord({
    schema_version: 1,
    request_id: stableId('request', 'session:loop', 'turn:loop-1', 0),
    turn_id: 'turn:loop-1',
    event_id: stableId('event', 'session:loop', 'manual-context'),
    occurred_at: new Date().toISOString(),
    expected_version: 2,
    session: fixture.sessionSpec,
    ...profile(),
    current_turn: { source_ref: `session-event://${turn.event_id}`, message: sendCommand().message },
    tools: [toolDefinition()],
  });
  const stepId = stableId('step', 'session:loop', 'turn:loop-1', 0);
  append(
    fixture.sessionStore,
    'session:loop',
    'model.request.started',
    { turn_id: 'turn:loop-1', step_id: stepId, request: assembled.request, source_event_ids: [assembled.event.event_id] },
    'manual-model-start',
  );
  for (const [sequence, event] of modelRoutes()[0].events.entries()) {
    append(
      fixture.sessionStore,
      'session:loop',
      'model.streamed',
      {
        turn_id: 'turn:loop-1',
        step_id: stepId,
        provider_id: 'model:loop-fixture',
        event: { schema_version: 1, provider_id: 'model:loop-fixture', request_id: assembled.request.request_id, sequence, ...event },
      },
      `manual-model-${sequence}`,
    );
  }
  const invocation = {
    schema_version: 1,
    invocation_id: stableId('invocation', 'session:loop', 'turn:loop-1', 'call:echo-1'),
    session_id: 'session:loop',
    turn_id: 'turn:loop-1',
    tool_call_id: 'call:echo-1',
    name: 'fixture.echo',
    input: { value: 'durable' },
    actor: { type: 'agent', id: 'agent:loop-fixture' },
    resource_scope: {
      session_id: 'session:loop',
      authority_ref: fixture.sessionSpec.authority_ref,
      policy_ref: fixture.sessionSpec.policy_ref,
    },
    idempotency_key: stableId('idempotency', 'session:loop', 'turn:loop-1', 'call:echo-1'),
    correlation_id: 'session:loop',
    causation_id: fixture.sessionStore.replay('session:loop').turns['turn:loop-1'].model_steps[0].request_event_id,
    approval_context: null,
  };
  append(
    fixture.sessionStore,
    'session:loop',
    'tool.execution.started',
    {
      turn_id: 'turn:loop-1',
      step_id: stepId,
      invocation_id: invocation.invocation_id,
      tool_call_id: 'call:echo-1',
      name: 'fixture.echo',
      input: invocation.input,
      idempotency_key: invocation.idempotency_key,
    },
    'manual-tool-start',
  );
  const outcome = await fixture.tools.execute(invocation);
  append(
    fixture.sessionStore,
    'session:loop',
    'tool.execution.completed',
    { turn_id: 'turn:loop-1', step_id: stepId, outcome },
    'manual-tool-complete',
  );
  append(
    fixture.sessionStore,
    'session:loop',
    'tool.operation_linked',
    { turn_id: 'turn:loop-1', tool_call_id: 'call:echo-1', operation_id: outcome.operation_id },
    'manual-link',
  );
  assert.equal(fixture.external.dispatches, 1);
  assert.equal(fixture.sessionStore.recoveryPlan('session:loop').next_action, 'continue_after_tools');

  const replacement = new AgentRuntime({
    session_store: fixture.sessionStore,
    model_provider_snapshot: fixture.snapshot,
    tool_runtime: fixture.tools,
    context_profile_resolver: profile,
  });
  const before = fixture.sessionStore.replay('session:loop').current_sequence;
  const resumed = await replacement.resume({ schema_version: 1, command: 'resume', session_id: 'session:loop', expected_sequence: before });
  assert.equal(resumed.terminal, true);
  assert.equal(fixture.external.dispatches, 1);
  assert.equal(calls.continuations, 1);
  assert.equal(fixture.sessionStore.replay('session:loop').status, 'completed');
});

test('resume fails closed instead of replaying a partially observed provider stream', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const turn = append(
    fixture.sessionStore,
    'session:loop',
    'turn.started',
    { turn_id: 'turn:loop-1', input: sendCommand().message },
    'partial-turn',
  );
  const assembler = new ContextAssembler({ session_store: fixture.sessionStore, model_provider_snapshot: fixture.snapshot });
  const assembled = assembler.assembleAndRecord({
    schema_version: 1,
    request_id: stableId('request', 'session:loop', 'turn:loop-1', 0),
    turn_id: 'turn:loop-1',
    event_id: stableId('event', 'session:loop', 'partial-context'),
    occurred_at: new Date().toISOString(),
    expected_version: 2,
    session: fixture.sessionSpec,
    ...profile(),
    current_turn: { source_ref: `session-event://${turn.event_id}`, message: sendCommand().message },
    tools: [toolDefinition()],
  });
  const stepId = stableId('step', 'session:loop', 'turn:loop-1', 0);
  append(
    fixture.sessionStore,
    'session:loop',
    'model.request.started',
    { turn_id: 'turn:loop-1', step_id: stepId, request: assembled.request, source_event_ids: [assembled.event.event_id] },
    'partial-start',
  );
  append(
    fixture.sessionStore,
    'session:loop',
    'model.streamed',
    {
      turn_id: 'turn:loop-1',
      step_id: stepId,
      provider_id: 'model:loop-fixture',
      event: {
        schema_version: 1,
        provider_id: 'model:loop-fixture',
        request_id: assembled.request.request_id,
        event_type: 'content.delta',
        sequence: 0,
        payload: { text: 'observed' },
      },
    },
    'partial-delta',
  );
  assert.throws(
    () =>
      append(
        fixture.sessionStore,
        'session:loop',
        'session.failed',
        { error_code: 'internal_error', message: 'forged early terminal', retryable: false },
        'forged-early-terminal',
      ),
    (error) => error.code === 'AGENT_SESSION_WORK_INCOMPLETE',
  );
  const before = fixture.sessionStore.replay('session:loop').current_sequence;
  assert.equal(fixture.sessionStore.recoveryPlan('session:loop').next_action, 'fail_interrupted_model');
  const result = await fixture.runtime.resume({
    schema_version: 1,
    command: 'resume',
    session_id: 'session:loop',
    expected_sequence: before,
  });
  assert.equal(result.terminal, true);
  const state = fixture.sessionStore.replay('session:loop');
  assert.equal(state.status, 'failed');
  assert.equal(state.terminal_event.payload.error_code, 'protocol_error');
  assert.equal(fixture.external.dispatches, 0);
});

test('cancel after restart settles a durable zero-event model step before the session terminal', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const turn = append(
    fixture.sessionStore,
    'session:loop',
    'turn.started',
    { turn_id: 'turn:loop-1', input: sendCommand().message },
    'cancel-recovery-turn',
  );
  const assembler = new ContextAssembler({ session_store: fixture.sessionStore, model_provider_snapshot: fixture.snapshot });
  const assembled = assembler.assembleAndRecord({
    schema_version: 1,
    request_id: stableId('request', 'session:loop', 'turn:loop-1', 0),
    turn_id: 'turn:loop-1',
    event_id: stableId('event', 'session:loop', 'cancel-recovery-context'),
    occurred_at: new Date().toISOString(),
    expected_version: 2,
    session: fixture.sessionSpec,
    ...profile(),
    current_turn: { source_ref: `session-event://${turn.event_id}`, message: sendCommand().message },
    tools: [toolDefinition()],
  });
  const stepId = stableId('step', 'session:loop', 'turn:loop-1', 0);
  append(
    fixture.sessionStore,
    'session:loop',
    'model.request.started',
    { turn_id: 'turn:loop-1', step_id: stepId, request: assembled.request, source_event_ids: [assembled.event.event_id] },
    'cancel-recovery-model-start',
  );
  const result = await fixture.runtime.cancel({
    schema_version: 1,
    command: 'cancel',
    session_id: 'session:loop',
    reason: 'cancel recovered session',
    cascade: true,
  });
  assert.equal(result.terminal, true);
  const events = fixture.sessionStore.readSession('session:loop');
  assert.deepEqual(
    events.slice(-3).map((event) => event.event_type),
    ['session.cancellation.requested', 'model.streamed', 'session.cancelled'],
  );
  assert.equal(events.at(-2).payload.event.payload.finish_reason, 'cancelled');
});

test('resume settles a terminal legacy stream without redispatching its request', async (context) => {
  const calls = { initial: 0 };
  const fixture = setup({
    routes: [
      {
        match: () => true,
        events() {
          calls.initial++;
          return [{ event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://unexpected' } }];
        },
      },
      { match: () => false, events: [] },
    ],
  });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const turn = append(
    fixture.sessionStore,
    'session:loop',
    'turn.started',
    { turn_id: 'turn:loop-1', input: sendCommand().message },
    'legacy-turn',
  );
  const assembler = new ContextAssembler({ session_store: fixture.sessionStore, model_provider_snapshot: fixture.snapshot });
  const assembled = assembler.assembleAndRecord({
    schema_version: 1,
    request_id: 'request:legacy-completed',
    turn_id: 'turn:loop-1',
    event_id: stableId('event', 'session:loop', 'legacy-context'),
    occurred_at: new Date().toISOString(),
    expected_version: 2,
    session: fixture.sessionSpec,
    ...profile(),
    current_turn: { source_ref: `session-event://${turn.event_id}`, message: sendCommand().message },
    tools: [toolDefinition()],
  });
  append(
    fixture.sessionStore,
    'session:loop',
    'model.streamed',
    {
      turn_id: 'turn:loop-1',
      provider_id: 'model:loop-fixture',
      event: {
        schema_version: 1,
        provider_id: 'model:loop-fixture',
        request_id: assembled.request.request_id,
        event_type: 'completed',
        sequence: 0,
        payload: { finish_reason: 'stop', provider_response_ref: 'scripted://legacy-done' },
      },
    },
    'legacy-completed',
  );
  const before = fixture.sessionStore.replay('session:loop').current_sequence;
  const result = await fixture.runtime.resume({
    schema_version: 1,
    command: 'resume',
    session_id: 'session:loop',
    expected_sequence: before,
  });
  assert.equal(result.terminal, true);
  assert.equal(calls.initial, 0);
  assert.equal(fixture.sessionStore.replay('session:loop').terminal_event.payload.outcome_ref, 'scripted://legacy-done');
});

test('resume terminalizes a partial legacy stream before failing the session', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const turn = append(
    fixture.sessionStore,
    'session:loop',
    'turn.started',
    { turn_id: 'turn:loop-1', input: sendCommand().message },
    'legacy-partial-turn',
  );
  const assembler = new ContextAssembler({ session_store: fixture.sessionStore, model_provider_snapshot: fixture.snapshot });
  const assembled = assembler.assembleAndRecord({
    schema_version: 1,
    request_id: 'request:legacy-partial',
    turn_id: 'turn:loop-1',
    event_id: stableId('event', 'session:loop', 'legacy-partial-context'),
    occurred_at: new Date().toISOString(),
    expected_version: 2,
    session: fixture.sessionSpec,
    ...profile(),
    current_turn: { source_ref: `session-event://${turn.event_id}`, message: sendCommand().message },
    tools: [toolDefinition()],
  });
  append(
    fixture.sessionStore,
    'session:loop',
    'model.streamed',
    {
      turn_id: 'turn:loop-1',
      provider_id: 'model:loop-fixture',
      event: {
        schema_version: 1,
        provider_id: 'model:loop-fixture',
        request_id: assembled.request.request_id,
        event_type: 'content.delta',
        sequence: 0,
        payload: { text: 'legacy partial output' },
      },
    },
    'legacy-partial-delta',
  );
  assert.throws(
    () =>
      append(
        fixture.sessionStore,
        'session:loop',
        'session.failed',
        { error_code: 'protocol_error', message: 'forged terminal', retryable: false },
        'legacy-partial-forged-terminal',
      ),
    (error) => error.code === 'AGENT_SESSION_WORK_INCOMPLETE',
  );
  const before = fixture.sessionStore.replay('session:loop').current_sequence;
  const result = await fixture.runtime.resume({
    schema_version: 1,
    command: 'resume',
    session_id: 'session:loop',
    expected_sequence: before,
  });
  assert.equal(result.terminal, true);
  const events = fixture.sessionStore.readSession('session:loop');
  assert.deepEqual(
    events.slice(-2).map((event) => event.event_type),
    ['model.streamed', 'session.failed'],
  );
  assert.equal(events.at(-2).payload.event.event_type, 'failed');
  assert.equal(events.at(-1).payload.error_code, 'protocol_error');
  assert.equal(fixture.external.dispatches, 0);
});

test('cumulative stream caps reserve room for a durable synthetic terminal event', async (context) => {
  const tightenedEventLimit = 8;
  const events = Array.from({ length: tightenedEventLimit }, () => ({
    event_type: 'content.delta',
    payload: { text: 'bounded' },
  }));
  const fixture = setup({
    routes: [
      { match: (request) => request.messages.at(-1).role === 'user', events },
      { match: () => false, events: [] },
    ],
    streamLimits: { max_events_per_step: tightenedEventLimit },
  });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const result = await fixture.runtime.send(sendCommand());
  assert.equal(result.terminal, true);
  const state = fixture.sessionStore.replay('session:loop');
  const step = state.turns['turn:loop-1'].model_steps[0];
  assert.equal(step.model_events.length, tightenedEventLimit);
  assert.equal(step.model_events.at(-1).event_type, 'failed');
  assert.equal(state.terminal_event.payload.error_code, 'internal_error');
  assert.ok(MAX_MODEL_EVENTS_PER_STEP > tightenedEventLimit);
});

// Debt 18: only the assembler's budget refusal is an exhausted budget; any other context defect stays an internal error.
for (const [name, error, expected] of [
  ['a context budget refusal', new ContextBudgetError('required model context exceeds the input budget'), 'budget_exceeded'],
  ['another context assembly error', new ContextAssemblyError('context source is invalid', 'AGENT_CONTEXT_INVALID'), 'internal_error'],
  [
    'a context error that only shares the budget prefix',
    new ContextAssemblyError('counter changed', 'AGENT_CONTEXT_BUDGET_COUNTER_CHANGED'),
    'internal_error',
  ],
  ['a context counter error', new ContextAssemblyError('counter failed', 'AGENT_CONTEXT_COUNTER_FAILED'), 'internal_error'],
])
  test(`the runtime reports ${name} as ${expected}`, async (context) => {
    const fixture = setup({ routes: modelRoutes() });
    context.after(() => fixture.db.close());
    context.mock.method(ContextAssembler.prototype, 'assembleAndRecord', () => {
      throw error;
    });
    await fixture.runtime.create(createCommand(fixture.sessionSpec));
    const result = await fixture.runtime.send(sendCommand());
    assert.equal(result.terminal, true);
    const failure = fixture.sessionStore.replay('session:loop').terminal_event.payload;
    assert.equal(failure.error_code, expected);
    if (expected === 'budget_exceeded') assert.equal(failure.message, error.message);
  });

test('cancellation is durable before provider interruption and every started unit settles', async (context) => {
  const fixture = setup({ routes: modelRoutes({ slow: true }) });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const pending = fixture.runtime.send(sendCommand());
  await new Promise((resolve) => setImmediate(resolve));
  const cancelled = await fixture.runtime.cancel({
    schema_version: 1,
    command: 'cancel',
    session_id: 'session:loop',
    reason: 'human interruption',
    cascade: true,
  });
  assert.equal(cancelled.accepted, true);
  await pending;
  const events = fixture.sessionStore.readSession('session:loop');
  const requested = events.findIndex((event) => event.event_type === 'session.cancellation.requested');
  const providerTerminal = events.findIndex(
    (event) => event.event_type === 'model.streamed' && event.payload.event.payload.finish_reason === 'cancelled',
  );
  assert.ok(requested !== -1 && requested < providerTerminal);
  assert.equal(events.at(-1).event_type, 'session.cancelled');
});

test('duration, token, tool and implementation caps terminate without unbounded work', async (context) => {
  assert.equal(Object.isFrozen(RUNTIME_CAPS), true);
  const deadline = setup({ routes: modelRoutes({ slow: true }), limits: { max_duration_ms: 20 } });
  context.after(() => deadline.db.close());
  await deadline.runtime.create(createCommand(deadline.sessionSpec));
  const timed = await deadline.runtime.send(sendCommand());
  assert.equal(timed.terminal, true);
  assert.equal(deadline.sessionStore.replay('session:loop').terminal_event.payload.error_code, 'timeout');

  const noTools = setup({ limits: { max_tool_calls: 0 } });
  context.after(() => noTools.db.close());
  await noTools.runtime.create(createCommand(noTools.sessionSpec));
  await noTools.runtime.send(sendCommand());
  assert.equal(noTools.external.dispatches, 0);
  assert.equal(noTools.sessionStore.replay('session:loop').terminal_event.payload.error_code, 'budget_exceeded');

  const oversized = setup();
  context.after(() => oversized.db.close());
  const invalid = spec('session:oversized', { max_tool_calls: RUNTIME_CAPS.max_tool_calls + 1 });
  await assert.rejects(() => oversized.runtime.create(createCommand(invalid)), /safety cap/);
});

test('a projected overflow fails before the step opens and reports the numbers', async (context) => {
  const fixture = setup({ limits: { max_tokens: 1500 } });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  await fixture.runtime.send(sendCommand());
  const failure = fixture.sessionStore.replay('session:loop').terminal_event.payload;
  assert.equal(failure.error_code, 'budget_exceeded');
  const numbers = /projected (\d+) > max 1500 \(used (\d+) \+ request (\d+) \+ reserve 64\)/.exec(failure.message);
  assert.ok(numbers, failure.message);
  const [projected, used, request] = numbers.slice(1).map(Number);
  assert.equal(projected, used + request + 64);
  assert.ok(projected > 1500);
});

// Debt 18: the first step of a turn is projected from the session's other usage, its own request and its reserve. The
// state is changed between create and send (a reconciliation reserve), so each component is observable on its own.
const plainRoutes = () => [
  {
    match: (request) => request.messages.at(-1).role === 'user',
    events: [
      { event_type: 'content.delta', payload: { text: 'noted' } },
      { event_type: 'usage', payload: { input_tokens: 20, output_tokens: 3, cached_tokens: 0 } },
      { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://plain' } },
    ],
  },
  { match: () => false, events: [] },
];
async function firstTurn(context, maxTokens, reservedElsewhere) {
  const fixture = setup({ routes: plainRoutes(), limits: { max_tokens: maxTokens } });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  if (reservedElsewhere > 0)
    append(
      fixture.sessionStore,
      'session:loop',
      'session.reconciled',
      { report_sha256: 'a'.repeat(64), reserved_tokens: reservedElsewhere },
      'reserve',
    );
  await fixture.runtime.send(sendCommand());
  const state = fixture.sessionStore.replay('session:loop');
  const assembled = fixture.sessionStore.readSession('session:loop').find((event) => event.event_type === 'context.assembled');
  return { state, step: state.turns['turn:loop-1'].model_steps.length, request: assembled?.payload.request };
}

for (const reservedElsewhere of [0, 777])
  test(`the first step is projected component by component (other usage ${reservedElsewhere})`, async (context) => {
    const open = await firstTurn(context, 1_000_000, reservedElsewhere);
    assert.equal(open.step, 1, 'with room the step opens');
    const requestBytes = Buffer.byteLength(canonicalJson(open.request), 'utf8');
    const reserve = open.request.parameters.max_output_tokens;
    assert.ok(reserve === 64 && requestBytes > reserve, 'the request carries its envelope and its reserve');
    const projected = reservedElsewhere + requestBytes + reserve;

    // One short: refused before the step opens, with every component exactly as measured here (none counted twice).
    const refused = await firstTurn(context, projected - 1, reservedElsewhere);
    assert.equal(refused.step, 0);
    assert.equal(refused.state.terminal_event.payload.error_code, 'budget_exceeded');
    assert.equal(
      refused.state.terminal_event.payload.message,
      `session token budget cannot reserve another model step: projected ${projected} > max ${projected - 1} (used ${reservedElsewhere} + request ${requestBytes} + reserve ${reserve})`,
    );
    // Exactly the projection: the step opens.
    const exact = await firstTurn(context, projected, reservedElsewhere);
    assert.equal(exact.step, 1, JSON.stringify(exact.state.terminal_event));
  });

test('a session that stops within its window completes even when reported usage passes the limit', async (context) => {
  const fixture = setup({
    routes: modelRoutes({ finalUsage: { input_tokens: 6000, output_tokens: 3, cached_tokens: 0 } }),
    limits: { max_tokens: 3000 },
  });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  await fixture.runtime.send(sendCommand());
  const done = fixture.sessionStore.replay('session:loop');
  assert.equal(done.status, 'completed', JSON.stringify(done.terminal_event));
  assert.ok(accountSessionTokens(done).total_tokens > 3000);
});

test('a step that needs another step fails when reported usage exhausted the budget', async (context) => {
  const fixture = setup({
    routes: modelRoutes({ toolStepUsage: { input_tokens: 6000, output_tokens: 3, cached_tokens: 0 } }),
    limits: { max_tokens: 3000 },
  });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  await fixture.runtime.send(sendCommand());
  const failed = fixture.sessionStore.replay('session:loop');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.terminal_event.payload.error_code, 'budget_exceeded');
  assert.match(failed.terminal_event.payload.message, /session token budget exhausted: used \d+ > max 3000/);
});

test('unknown sessions, delegated ownership, concurrent sends and stale resume fail closed', async (context) => {
  const fixture = setup({ routes: modelRoutes({ slow: true }) });
  context.after(() => fixture.db.close());
  await assert.rejects(() => fixture.runtime.send(sendCommand('session:missing')));
  const delegated = {
    ...fixture.sessionSpec,
    session_id: 'session:delegated',
    execution: { mode: 'delegated', runtime_provider_id: 'runtime:fixture', profile: 'default' },
  };
  await assert.rejects(() => fixture.runtime.create(createCommand(delegated)), /kernel execution ownership/);
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const pending = fixture.runtime.send(sendCommand());
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => fixture.runtime.send(sendCommand()), /active runtime work/);
  await fixture.runtime.cancel({ schema_version: 1, command: 'cancel', session_id: 'session:loop', reason: 'finish test', cascade: true });
  await pending;
  await assert.rejects(
    () => fixture.runtime.resume({ schema_version: 1, command: 'resume', session_id: 'session:loop', expected_sequence: 1 }),
    /resume sequence/,
  );
  const result = validatePortResult(
    'AgentRuntime',
    'dispose',
    await fixture.runtime.dispose({ schema_version: 1, command: 'dispose', session_id: 'session:loop' }),
    { schema_version: 1, command: 'dispose', session_id: 'session:loop' },
  );
  assert.equal(result.terminal, true);
});

test('runtime rejects forged and overridden durable session stores', (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  class OverriddenStore extends RelationalSessionEventStore {
    append() {}
  }
  for (const forged of [
    Object.create(RelationalSessionEventStore.prototype),
    new OverriddenStore({ ledger: fixture.sessionStore.ledger }),
  ]) {
    assert.throws(
      () =>
        new AgentRuntime({
          session_store: forged,
          model_provider_snapshot: fixture.snapshot,
          tool_runtime: fixture.tools,
          context_profile_resolver: profile,
        }),
      /nominal RelationalSessionEventStore/,
    );
  }
  assert.throws(() => {
    fixture.sessionStore.append = () => {};
  }, TypeError);
});

test('runtime configuration rejects malformed ports, limits and compaction profiles', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  const options = {
    session_store: fixture.sessionStore,
    model_provider_snapshot: fixture.snapshot,
    tool_runtime: fixture.tools,
    context_profile_resolver: profile,
  };
  for (const patch of [
    { model_provider_snapshot: {} },
    { tool_runtime: {} },
    { context_profile_resolver: null },
    { clock: {} },
    { stream_limits: { unknown: 3 } },
    { stream_limits: { max_events_per_step: 1 } },
    { stream_limits: { max_bytes_per_step: 2 } },
  ])
    assert.throws(() => new AgentRuntime({ ...options, ...patch }));
  const { AgentContextProfileSchema } = require('../packages/agent-runtime/schemas');
  assert.equal(AgentContextProfileSchema.safeParse({ ...profile(), overflow_policy: 'compact' }).success, false);
  assert.equal(AgentContextProfileSchema.safeParse({ ...profile(), compaction_provider_id: 'compaction:unexpected' }).success, false);
  const invalid = new AgentRuntime({
    ...options,
    context_profile_resolver() {
      throw new Error('not available');
    },
  });
  await assert.rejects(() => invalid.create({ schema_version: 1, command: 'create', spec: fixture.sessionSpec }), {
    code: 'AGENT_RUNTIME_CONTEXT_PROFILE_FAILED',
  });
  const missing = new AgentRuntime({
    ...options,
    context_profile_resolver: () => ({ ...profile(), overflow_policy: 'compact', compaction_provider_id: 'compaction:missing' }),
  });
  await assert.rejects(() => missing.create({ schema_version: 1, command: 'create', spec: fixture.sessionSpec }), {
    code: 'AGENT_RUNTIME_COMPACTION_UNAVAILABLE',
  });
  assert.deepEqual(fixture.sessionStore.readSession(fixture.sessionSpec.session_id), []);
});

test('create retries preserve identity and cannot replace an existing specification', async (context) => {
  const fixture = setup();
  context.after(() => fixture.db.close());
  const input = { schema_version: 1, command: 'create', spec: fixture.sessionSpec };
  await fixture.runtime.create(input);
  await fixture.runtime.create(input);
  assert.equal(fixture.sessionStore.readSession(input.spec.session_id).length, 1);
  await assert.rejects(
    () => fixture.runtime.create({ ...input, spec: { ...input.spec, authority_ref: 'authority://replacement' } }),
    /different specification/,
  );
});

for (const active of [false, true])
  test(`runtime disposal settles ${active ? 'active' : 'created'} sessions`, async (context) => {
    const fixture = setup({
      routes: [
        {
          match: () => true,
          events: [
            { delay_ms: 10_000, event_type: 'content.delta', payload: { text: 'late content' } },
            { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://disposed' } },
          ],
        },
        { match: () => false, events: [] },
      ],
    });
    context.after(() => fixture.db.close());
    await fixture.runtime.create({ schema_version: 1, command: 'create', spec: fixture.sessionSpec });
    const running = active ? fixture.runtime.send(sendCommand()) : null;
    if (active) {
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(fixture.runtime.snapshot().active_sessions, ['session:loop']);
    }
    await fixture.runtime.dispose({ schema_version: 1, command: 'dispose', session_id: 'session:loop' });
    if (running) await running;
    assert.equal(fixture.sessionStore.replay('session:loop').terminal_event.event_type, 'session.cancelled');
    assert.deepEqual(fixture.runtime.snapshot().active_sessions, []);
  });

for (const finishReason of ['cancelled', 'length'])
  test(`provider ${finishReason} cannot be misreported as successful task completion`, async (context) => {
    const fixture = setup({
      routes: [
        {
          match: () => true,
          events: [{ event_type: 'completed', payload: { finish_reason: finishReason, provider_response_ref: 'scripted://terminal' } }],
        },
        { match: () => false, events: [] },
      ],
    });
    context.after(() => fixture.db.close());
    await fixture.runtime.create({ schema_version: 1, command: 'create', spec: fixture.sessionSpec });
    await fixture.runtime.send(sendCommand());
    assert.equal(
      fixture.sessionStore.replay('session:loop').terminal_event.event_type,
      finishReason === 'cancelled' ? 'session.cancelled' : 'session.failed',
    );
  });

test('replay rejects altered model and tool intents before reproducing effects', async (context) => {
  const { replaySessionEvents } = require('../packages/agent-session-store');
  const fixture = setup();
  context.after(() => fixture.db.close());
  await fixture.runtime.create({ schema_version: 1, command: 'create', spec: fixture.sessionSpec });
  await fixture.runtime.send(sendCommand());
  const events = fixture.sessionStore.readSession('session:loop');
  const rejectAlteration = (type, mutate, code, occurrence = 0) => {
    const index = events.map((event, i) => (event.event_type === type ? i : -1)).filter((i) => i !== -1)[occurrence];
    assert.notEqual(index, undefined, type);
    const altered = structuredClone(events.slice(0, index + 1));
    mutate(altered.at(-1), altered);
    assert.throws(() => replaySessionEvents(altered), { code });
  };
  rejectAlteration(
    'model.request.started',
    (event) => {
      event.payload.request.model = 'forged/model';
    },
    'AGENT_SESSION_PROVIDER_MISMATCH',
  );
  rejectAlteration(
    'model.request.started',
    (event) => {
      event.payload.source_event_ids = [randomUUID()];
    },
    'AGENT_SESSION_SOURCE_MISMATCH',
  );
  rejectAlteration(
    'model.request.started',
    (event) => {
      event.payload.request.messages.at(-1).content = 'forged';
    },
    'AGENT_SESSION_REQUEST_MISMATCH',
  );
  rejectAlteration(
    'model.request.started',
    (event) => {
      event.payload.request.messages.at(-1).content = 'forged tool result';
    },
    'AGENT_SESSION_REQUEST_MISMATCH',
    1,
  );
  rejectAlteration(
    'tool.execution.started',
    (event) => {
      event.payload.step_id = 'step:unknown';
    },
    'AGENT_SESSION_TOOL_STEP_INVALID',
  );
  rejectAlteration(
    'tool.execution.started',
    (event) => {
      event.payload.input = { value: 'forged' };
    },
    'AGENT_SESSION_TOOL_CALL_MISMATCH',
  );
  rejectAlteration(
    'tool.execution.started',
    (event, all) => {
      all[0].payload.spec.limits.max_tool_calls = 0;
    },
    'AGENT_SESSION_TOOL_LIMIT_EXCEEDED',
  );
  for (const field of ['invocation_id', 'tool_call_id', 'name']) {
    rejectAlteration(
      'tool.execution.completed',
      (event) => {
        event.payload.outcome[field] = 'forged:identity';
      },
      'AGENT_SESSION_TOOL_OUTCOME_MISMATCH',
    );
  }
  for (const [type, code] of [
    ['model.request.started', 'AGENT_SESSION_DUPLICATE_MODEL_STEP'],
    ['tool.execution.started', 'AGENT_SESSION_DUPLICATE_TOOL_EXECUTION'],
    ['tool.execution.completed', 'AGENT_SESSION_TOOL_OUTCOME_MISMATCH'],
  ]) {
    const index = events.findIndex((event) => event.event_type === type);
    const prefix = structuredClone(events.slice(0, index + 1));
    prefix.push({ ...structuredClone(prefix.at(-1)), event_id: randomUUID(), sequence: index + 2 });
    assert.throws(() => replaySessionEvents(prefix), { code });
  }
  for (let boundary = 1; boundary < events.length; boundary++) {
    const checkpoint = replaySessionEvents(events.slice(0, boundary));
    assert.deepEqual(replaySessionEvents(events.slice(boundary), { from: checkpoint }), replaySessionEvents(events));
  }
  assert.equal(fixture.external.dispatches, 1);
});

test('reconciliation retains uncertain evidence and refuses identity substitution or a second settlement', async (context) => {
  const { replaySessionEvents } = require('../packages/agent-session-store');
  const fixture = setup();
  context.after(() => fixture.db.close());
  await fixture.runtime.create({ schema_version: 1, command: 'create', spec: fixture.sessionSpec });
  await fixture.runtime.send(sendCommand());
  const events = fixture.sessionStore.readSession('session:loop');
  const index = events.findIndex((event) => event.event_type === 'tool.execution.completed');
  const prefix = structuredClone(events.slice(0, index + 1));
  const completed = prefix.at(-1);
  const settlement = {
    ...structuredClone(completed),
    event_type: 'tool.execution.reconciled',
    event_id: randomUUID(),
    sequence: completed.sequence + 1,
  };
  settlement.payload.outcome.evidence_refs.push(`reconciliation://${'a'.repeat(64)}`);
  completed.payload.outcome = {
    ...completed.payload.outcome,
    status: 'uncertain',
    result: null,
    replayed: false,
    error: { code: 'EXECUTION_OUTCOME_IN_DOUBT', message: 'receipt lost', retryable: false },
  };
  const pending = replaySessionEvents(prefix);
  const resolved = replaySessionEvents([settlement], { from: pending });
  assert.deepEqual(resolved, replaySessionEvents([...prefix, settlement]));
  const execution = resolved.tool_invocations[settlement.payload.outcome.invocation_id];
  assert.equal(execution.outcome.status, 'succeeded');
  assert.deepEqual(execution.uncertain_outcome, completed.payload.outcome);
  assert.equal(execution.uncertain_event_id, completed.event_id);
  for (const mutate of [
    (event) => {
      event.payload.step_id = 'step:other';
    },
    (event) => {
      event.payload.outcome.invocation_id = 'invocation:other';
    },
    (event) => {
      event.payload.outcome.tool_call_id = 'call:other';
    },
    (event) => {
      event.payload.outcome.name = 'other.tool';
    },
    (event) => {
      event.payload.outcome.evidence_refs = ['reconciliation://invalid'];
    },
  ]) {
    const invalid = structuredClone(settlement);
    mutate(invalid);
    assert.throws(() => replaySessionEvents([invalid], { from: pending }), /pending uncertain execution/);
  }
  assert.throws(
    () => replaySessionEvents([{ ...settlement, event_id: randomUUID(), sequence: settlement.sequence + 1 }], { from: resolved }),
    /pending uncertain execution/,
  );
  assert.equal(fixture.external.dispatches, 1);
});

test('legacy terminal streams remain readable without dispatching old effects again', async (context) => {
  const source = setup();
  context.after(() => source.db.close());
  await source.runtime.create(createCommand(source.sessionSpec));
  await source.runtime.send(sendCommand());
  const original = source.sessionStore.readSession('session:loop');
  const prefix = original.slice(
    0,
    original.findIndex((event) => event.event_type === 'model.request.started'),
  );
  const template = original.find((event) => event.event_type === 'model.streamed');
  for (const reason of ['stop', 'failed', 'length', 'cancelled', 'tool_calls']) {
    const fixture = setup();
    try {
      const terminal = structuredClone(template);
      delete terminal.payload.step_id;
      terminal.sequence = prefix.length + 1;
      terminal.payload.event.sequence = 0;
      terminal.payload.event.event_type = reason === 'failed' ? 'failed' : 'completed';
      terminal.payload.event.payload =
        reason === 'failed'
          ? { error_code: 'provider_unavailable', message: 'legacy provider failed', retryable: false }
          : { finish_reason: reason, provider_response_ref: 'legacy://terminal' };
      fixture.sessionStore.append({ session_id: 'session:loop', expected_version: 0, events: [...prefix, terminal] });
      await fixture.runtime.resume({
        schema_version: 1,
        command: 'resume',
        session_id: 'session:loop',
        expected_sequence: terminal.sequence,
      });
      const state = fixture.sessionStore.replay('session:loop');
      assert.equal(state.status, reason === 'stop' ? 'completed' : 'failed');
      assert.equal(fixture.external.dispatches, 0);
      assert.deepEqual(fixture.sessionStore.readSession('session:loop').slice(0, terminal.sequence), [...prefix, terminal]);
    } finally {
      fixture.db.close();
    }
  }
});

// --- Tool-result pressure: older results are pruned first, the freshest ones stay verbatim while they fit. ---
const MULTI_BODY = 'external result body '.repeat(150);

function multiRoutes(seen, callCount = 2) {
  const toolCount = (request) => request.messages.filter((message) => message.role === 'tool').length;
  const requestBytes = (request) =>
    Buffer.byteLength(canonicalJson({ messages: request.messages, tools: request.tools, parameters: request.parameters }), 'utf8');
  const call = (id, value) => [
    { event_type: 'tool_call.delta', payload: { tool_call_id: id, name: 'fixture.echo', arguments_delta: JSON.stringify({ value }) } },
    { event_type: 'completed', payload: { finish_reason: 'tool_calls', provider_response_ref: `scripted://${id}` } },
  ];
  const routes = [];
  for (let index = 0; index < callCount; index++) {
    routes.push({
      match: (request) => toolCount(request) === index,
      events(request) {
        seen.push({ bytes: requestBytes(request), messages: request.messages });
        return call(`call:echo-${index + 1}`, `value-${index + 1}`);
      },
    });
  }
  routes.push({
    match: (request) => toolCount(request) === callCount,
    events(request) {
      seen.push({ bytes: requestBytes(request), messages: request.messages });
      return [
        { event_type: 'content.delta', payload: { text: 'multi done' } },
        { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://multi-done' } },
      ];
    },
  });
  return routes;
}

function multiFixture(contextTokens, callCount = 2) {
  const boundedManifest = manifest();
  boundedManifest.limits.context_tokens = contextTokens;
  const seen = [];
  const fixture = setup({
    routes: multiRoutes(seen, callCount),
    modelManifest: boundedManifest,
    toolResultBody: MULTI_BODY,
    compactionRuntime: compactionRuntimeFixture().runtime,
    contextProfileResolver: () => ({ ...profile(), overflow_policy: 'compact', compaction_provider_id: 'compaction:runtime-fixture' }),
  });
  return { ...fixture, seen };
}

async function runMulti(contextTokens, callCount = 2) {
  const fixture = multiFixture(contextTokens, callCount);
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  await fixture.runtime.send(sendCommand());
  return fixture;
}

// Measures the three request sizes of the scripted run with a window that never presses.
async function measureMulti(callCount = 2) {
  const fixture = await runMulti(2_000_000, callCount);
  const bytes = fixture.seen.map((entry) => entry.bytes);
  fixture.db.close();
  assert.equal(bytes.length, callCount + 1);
  return bytes;
}

const isStub = (message) => /"pruned":true/.test(message.content);
const toolMessage = (messages, id) => messages.find((message) => message.role === 'tool' && message.tool_call_id === id);
const sessionEvents = (fixture) => fixture.sessionStore.readSession('session:loop');

test('under pressure the older result is pruned and the freshest result reaches the model verbatim', async (context) => {
  const s3 = (await measureMulti())[2];
  const limit = Math.ceil(s3 * 1.03);
  const fixture = await runMulti(limit + 64);
  context.after(() => fixture.db.close());
  const state = fixture.sessionStore.replay('session:loop');
  assert.equal(state.status, 'completed', JSON.stringify(sessionEvents(fixture).at(-1)));
  const turn = state.turns['turn:loop-1'];
  const third = fixture.seen[2].messages;
  assert.equal(isStub(toolMessage(third, 'call:echo-1')), true, 'the older result is pruned');
  assert.doesNotMatch(toolMessage(third, 'call:echo-1').content, /external result body/);
  assert.match(toolMessage(third, 'call:echo-2').content, new RegExp(MULTI_BODY.slice(0, 40)), 'the latest result is verbatim');
  assert.equal(isStub(toolMessage(third, 'call:echo-2')), false);
  // The second request is an immutable prefix of history: its result stays verbatim there.
  assert.equal(isStub(toolMessage(fixture.seen[1].messages, 'call:echo-1')), false);
  assert.equal(turn.tool_compactions.length, 1);
  const events = sessionEvents(fixture);
  const record = events.find((event) => event.event_type === 'compaction.completed');
  assert.deepEqual(record.payload.source_event_ids, [turn.tool_executions['call:echo-1'].completed_event_id]);
  assert.equal(record.payload.strategy, 'tool_result_prune');
  assert.deepEqual(turn.model_steps[2].source_event_ids, [
    turn.model_steps[1].terminal_event_id,
    record.event_id,
    turn.tool_executions['call:echo-2'].completed_event_id,
  ]);
  // Replay is deterministic: the same events rebuild the same messages.
  const again = fixture.sessionStore.replay('session:loop');
  assert.equal(canonicalJson(again.turns['turn:loop-1'].model_steps[2].request.messages), canonicalJson(third));
});

test('when even the pruned older results exceed the limit the current result is pruned too', async (context) => {
  const s2 = (await measureMulti())[1];
  const fixture = await runMulti(s2 + 20 + 64);
  context.after(() => fixture.db.close());
  const state = fixture.sessionStore.replay('session:loop');
  assert.equal(state.status, 'completed', JSON.stringify(sessionEvents(fixture).at(-1)));
  const turn = state.turns['turn:loop-1'];
  assert.equal(turn.tool_compactions.length, 2);
  const third = fixture.seen[2].messages;
  assert.equal(isStub(toolMessage(third, 'call:echo-1')), true);
  assert.equal(isStub(toolMessage(third, 'call:echo-2')), true);
});

test('pressure with no older candidate and a fitting request keeps the result verbatim without compacting', async (context) => {
  const s2 = (await measureMulti())[1];
  const fixture = await runMulti(Math.ceil(s2 * 1.03) + 64);
  context.after(() => fixture.db.close());
  const events = sessionEvents(fixture);
  const secondStart = events.filter((event) => event.event_type === 'model.request.started')[1];
  assert.ok(secondStart);
  assert.equal(
    events.filter((event) => event.event_type === 'compaction.completed' && event.sequence < secondStart.sequence).length,
    0,
    'no compaction precedes the second request',
  );
  assert.match(toolMessage(fixture.seen[1].messages, 'call:echo-1').content, new RegExp(MULTI_BODY.slice(0, 40)));
});

function stored(event) {
  return {
    schema_version: event.schema_version,
    event_id: event.event_id,
    session_id: event.session_id,
    sequence: event.sequence,
    occurred_at: event.occurred_at,
    event_type: event.event_type,
    payload: structuredClone(event.payload),
  };
}

function replayInto(target, events, mutate = () => {}) {
  const copies = events.map(stored);
  mutate(copies);
  for (const event of copies) {
    target.sessionStore.append({ session_id: 'session:loop', expected_version: event.sequence - 1, events: [event] });
  }
}

test('replay accepts only an exact, durably recorded derivation of the older prefix', async (context) => {
  const s3 = (await measureMulti())[2];
  const source = await runMulti(Math.ceil(s3 * 1.03) + 64);
  context.after(() => source.db.close());
  const events = sessionEvents(source);
  const thirdStart = events.filter((event) => event.event_type === 'model.request.started')[2];
  const compactionAt = events.findIndex((event) => event.event_type === 'compaction.completed');
  const clean = multiFixture(2_000_000);
  context.after(() => clean.db.close());
  replayInto(clean, events);
  assert.equal(clean.sessionStore.replay('session:loop').status, 'completed');

  const rejects = async (mutate, code) => {
    const target = multiFixture(2_000_000);
    try {
      assert.throws(() => replayInto(target, events, mutate), code ? { code } : /./);
    } finally {
      target.db.close();
    }
  };
  const third = (copies) => copies.find((event) => event.event_id === thirdStart.event_id);
  // A stub that is not the recorded replacement.
  await rejects((copies) => {
    const message = toolMessage(third(copies).payload.request.messages, 'call:echo-1');
    message.content = message.content.replace('"pruned":true', '"pruned":true,"status":"forged"');
  }, 'AGENT_SESSION_REQUEST_MISMATCH');
  // A non-tool message altered while the stub stays correct.
  await rejects((copies) => {
    third(copies).payload.request.messages[1].content += ' tampered';
  }, 'AGENT_SESSION_REQUEST_MISMATCH');
  // A verbatim older result where the record demands the stub.
  await rejects((copies) => {
    const messages = third(copies).payload.request.messages;
    messages[messages.findIndex((message) => message.tool_call_id === 'call:echo-1')] = toolMessage(
      sessionEvents(source).filter((event) => event.event_type === 'model.request.started')[1].payload.request.messages,
      'call:echo-1',
    );
  }, 'AGENT_SESSION_REQUEST_MISMATCH');
  // Reordered messages.
  await rejects((copies) => {
    const messages = third(copies).payload.request.messages;
    const index = messages.findIndex((message) => message.tool_call_id === 'call:echo-1');
    [messages[index - 1], messages[index]] = [messages[index], messages[index - 1]];
  }, 'AGENT_SESSION_REQUEST_MISMATCH');
  // A record whose source is the result of the current step, or a result that does not exist.
  await rejects((copies) => {
    copies[compactionAt].payload.source_event_ids = [
      events.find((event) => event.event_type === 'tool.execution.completed' && event.payload.outcome.tool_call_id === 'call:echo-2')
        .event_id,
    ];
  });
  await rejects((copies) => {
    copies[compactionAt].payload.source_event_ids = ['event:from-another-turn'];
  });
});

test('a crash between the older-results record and the next step resumes without a second record', async (context) => {
  const s3 = (await measureMulti())[2];
  const source = await runMulti(Math.ceil(s3 * 1.03) + 64);
  context.after(() => source.db.close());
  const events = sessionEvents(source);
  const compactionAt = events.findIndex((event) => event.event_type === 'compaction.completed');
  const target = multiFixture(Math.ceil(s3 * 1.03) + 64);
  context.after(() => target.db.close());
  replayInto(target, events.slice(0, compactionAt + 1));
  assert.equal(target.sessionStore.recoveryPlan('session:loop').next_action, 'continue_after_tools');
  const before = target.sessionStore.replay('session:loop').current_sequence;
  const resumed = await target.runtime.resume({
    schema_version: 1,
    command: 'resume',
    session_id: 'session:loop',
    expected_sequence: before,
  });
  assert.equal(resumed.terminal, true);
  const after = sessionEvents(target);
  assert.equal(after.filter((event) => event.event_type === 'compaction.completed').length, 1);
  assert.equal(target.sessionStore.replay('session:loop').status, 'completed');
  assert.equal(
    canonicalJson(after.find((event) => event.event_type === 'compaction.completed').payload),
    canonicalJson(events[compactionAt].payload),
  );
  assert.equal(isStub(toolMessage(target.seen.at(-1).messages, 'call:echo-1')), true);
  assert.match(toolMessage(target.seen.at(-1).messages, 'call:echo-2').content, new RegExp(MULTI_BODY.slice(0, 40)));
});

// --- Forged logs: every guard of the older-results derivation is reached by a log that passes the guards before it. ---
const forgedScenarios = new Map();

// A: 2 tool calls, one older record at the second continuation.
// B: 3 tool calls, one older record at each continuation after the first.
// C: 3 tool calls, one older record with two sources at the last continuation.
// D: 2 tool calls, an older record followed by the current-results record at the same continuation.
async function forgedScenario(kind) {
  try {
    if (forgedScenarios.has(kind)) {
      const cached = forgedScenarios.get(kind);
      assert.equal(replayLog(cached).status, 'completed', `clean scenario ${kind} replays`);
      return structuredClone(cached);
    }
    const callCount = kind === 'B' || kind === 'C' ? 3 : 2;
    const sizes = await measureMulti(callCount);
    const limit = { A: Math.ceil(sizes[2] * 1.03), B: Math.ceil(sizes[2] * 1.03), C: Math.ceil(sizes[3] * 1.03), D: sizes[1] + 20 }[kind];
    const fixture = await runMulti(limit + 64, callCount);
    try {
      assert.equal(fixture.sessionStore.replay('session:loop').status, 'completed');
      const events = structuredClone(sessionEvents(fixture));
      const shape = compactionsOf(events).map((event) => event.payload.source_event_ids.length);
      assert.deepEqual(shape, { A: [1], B: [1, 1], C: [2], D: [1, 1] }[kind], `scenario ${kind}`);
      assert.equal(replayLog(events).status, 'completed', `clean scenario ${kind} replays`);
      forgedScenarios.set(kind, events);
      return structuredClone(events);
    } finally {
      fixture.db.close();
    }
  } catch (error) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    return assert.fail(`scenario ${kind} does not replay cleanly: ${error?.code} ${error?.message}`);
  }
}

const replayLog = (events) => require('../packages/agent-session-store').replaySessionEvents(structuredClone(events));
const compactionsOf = (events) => events.filter((event) => event.event_type === 'compaction.completed');
const completedIdOf = (events, toolCallId) =>
  events.find((event) => event.event_type === 'tool.execution.completed' && event.payload.outcome.tool_call_id === toolCallId).event_id;
const renumber = (events) => events.map((event, index) => ({ ...event, sequence: index + 1 }));

function restat(payload) {
  const bytes = Buffer.byteLength(canonicalJson(payload.replacement_messages), 'utf8');
  payload.after = { message_count: payload.replacement_messages.length, bytes, tokens: bytes };
  payload.pruned_tool_call_ids = payload.replacement_messages.map((message) => message.tool_call_id);
}

function cloneRecord(record, label, { id = true, ref = true } = {}) {
  const copy = structuredClone(record);
  copy.event_id = `event:forged-${label}`;
  if (id) copy.payload.compaction_id = `compaction:forged-${label}`;
  if (ref) copy.payload.checkpoint_ref = `${record.payload.checkpoint_ref}-forged-${label}`;
  return copy;
}

function insertAfter(events, anchor, ...added) {
  const index = events.indexOf(anchor);
  assert.ok(index !== -1);
  return renumber([...events.slice(0, index + 1), ...added, ...events.slice(index + 1)]);
}

function assertGuard(events, code, message) {
  assert.throws(
    () => replayLog(renumber(events)),
    (error) => error.code === code && message.test(error.message),
    `${code} ${message}`,
  );
}

const ORDER = 'AGENT_SESSION_COMPACTION_ORDER_INVALID';
const LINEAGE = 'AGENT_SESSION_COMPACTION_LINEAGE_INVALID';
const IDENTITY = 'AGENT_SESSION_COMPACTION_TOOL_IDENTITY_INVALID';

test('forged older-results guards: clean logs of every scenario replay', async () => {
  for (const kind of ['A', 'B', 'C', 'D']) await forgedScenario(kind);
});

test('forged older-results guard: a second pending record is refused', async () => {
  const events = await forgedScenario('C');
  const [older] = compactionsOf(events);
  const second = cloneRecord(older, 'pending');
  second.payload.source_event_ids = [older.payload.source_event_ids[0]];
  second.payload.replacement_messages = [older.payload.replacement_messages[0]];
  restat(second.payload);
  assertGuard(insertAfter(events, older, second), ORDER, /already pending/);
});

test('forged older-results guard: the record must prune tool results', async () => {
  const events = await forgedScenario('A');
  const [older] = compactionsOf(events);
  older.payload.strategy = 'history_summary';
  older.payload.replacement_messages = [{ role: 'assistant', content: 'summary' }];
  restat(older.payload);
  older.payload.pruned_tool_call_ids = [];
  assertGuard(events, ORDER, /must prune tool results/);
});

test('forged older-results guard: an older record cannot follow the current-results record', async () => {
  const events = await forgedScenario('D');
  const [older, current] = compactionsOf(events);
  const swapped = events.map((event) => (event === older ? current : event === current ? older : event));
  assertGuard(swapped, ORDER, /cannot follow the current-results record/);
});

test('forged older-results guard: a source must be a completed durable result', async () => {
  const events = await forgedScenario('A');
  compactionsOf(events)[0].payload.source_event_ids = ['event:unknown-result'];
  assertGuard(events, LINEAGE, /not a completed durable result/);
});

test('forged older-results guard: a source of the current step is refused', async () => {
  const events = await forgedScenario('B');
  const older = compactionsOf(events)[1];
  const current = completedIdOf(events, 'call:echo-3');
  older.payload.source_event_ids = [...older.payload.source_event_ids, current];
  older.payload.replacement_messages = [
    ...older.payload.replacement_messages,
    { ...older.payload.replacement_messages[0], tool_call_id: 'call:echo-3' },
  ];
  restat(older.payload);
  assertGuard(events, LINEAGE, /belongs to the current step/);
});

test('forged older-results guard: sources must follow the request order', async () => {
  const events = await forgedScenario('C');
  const older = compactionsOf(events)[0];
  older.payload.source_event_ids.reverse();
  older.payload.replacement_messages.reverse();
  restat(older.payload);
  assertGuard(events, LINEAGE, /not in request order/);
});

test('forged older-results guard: an already pruned source reapplied at a later step is refused', async () => {
  const events = await forgedScenario('B');
  const [first, second] = compactionsOf(events);
  second.payload.source_event_ids = [first.payload.source_event_ids[0], ...second.payload.source_event_ids];
  second.payload.replacement_messages = [first.payload.replacement_messages[0], ...second.payload.replacement_messages];
  restat(second.payload);
  assertGuard(events, LINEAGE, /not verbatim in the last request/);
});

test('forged older-results guard: a replacement cannot change the call identity', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  older.payload.replacement_messages[0].tool_call_id = 'call:other';
  restat(older.payload);
  assertGuard(events, IDENTITY, /changes call identity/);
});

test('forged older-results guard: a replacement cannot change the tool name', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  older.payload.replacement_messages[0].name = 'other.tool';
  assertGuard(events, IDENTITY, /changes the tool name/);
});

test('forged older-results guard: an extra replacement is refused', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  older.payload.replacement_messages.push({ ...older.payload.replacement_messages[0], tool_call_id: 'call:extra' });
  restat(older.payload);
  assertGuard(events, IDENTITY, /changed call identity or ordering/);
});

test('forged older-results guard: a stub with another digest is refused', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  const stub = JSON.parse(older.payload.replacement_messages[0].content);
  stub.result_digest = `sha256:${'0'.repeat(64)}`;
  older.payload.replacement_messages[0].content = canonicalJson(stub);
  restat(older.payload);
  assertGuard(events, 'AGENT_SESSION_COMPACTION_STUB_MISMATCH', /digest differs/);
});

test('forged older-results guard: a stub carrying the result body is refused', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  const stub = JSON.parse(older.payload.replacement_messages[0].content);
  stub.result = { body: 'x' };
  older.payload.replacement_messages[0].content = canonicalJson(stub);
  restat(older.payload);
  assertGuard(events, 'AGENT_SESSION_COMPACTION_STUB_MISMATCH', /carries a body field/);
});

test('forged older-results guard: a stub with other evidence references is refused', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  const stub = JSON.parse(older.payload.replacement_messages[0].content);
  stub.evidence_refs = ['evidence://forged'];
  older.payload.replacement_messages[0].content = canonicalJson(stub);
  restat(older.payload);
  assertGuard(events, 'AGENT_SESSION_COMPACTION_STUB_MISMATCH', /evidence_refs differs/);
});

test('forged compaction guard: a repeated compaction identifier is refused', async () => {
  const events = await forgedScenario('C');
  const older = compactionsOf(events)[0];
  const copy = cloneRecord(older, 'id', { id: false });
  copy.payload.source_event_ids = [older.payload.source_event_ids[0]];
  copy.payload.replacement_messages = [older.payload.replacement_messages[0]];
  restat(copy.payload);
  assertGuard(insertAfter(events, older, copy), 'AGENT_SESSION_DUPLICATE_COMPACTION', /already recorded/);
});

test('forged compaction guard: a repeated checkpoint reference is refused', async () => {
  const events = await forgedScenario('C');
  const older = compactionsOf(events)[0];
  const copy = cloneRecord(older, 'ref', { ref: false });
  copy.payload.source_event_ids = [older.payload.source_event_ids[0]];
  copy.payload.replacement_messages = [older.payload.replacement_messages[0]];
  restat(copy.payload);
  assertGuard(insertAfter(events, older, copy), 'AGENT_SESSION_DUPLICATE_COMPACTION', /already recorded/);
});

test('forged compaction guard: a repeated source set is refused', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  assertGuard(insertAfter(events, older, cloneRecord(older, 'sources')), 'AGENT_SESSION_DUPLICATE_COMPACTION', /already recorded/);
});

test('forged request guard: the continuation must cite the older record as a source', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  const third = events.filter((event) => event.event_type === 'model.request.started')[2];
  third.payload.source_event_ids = third.payload.source_event_ids.filter((id) => id !== older.event_id);
  assertGuard(events, 'AGENT_SESSION_REQUEST_MISMATCH', /continuation request differs from durable model and tool facts/);
});

test('forged request guard: the prefix must be the exact derivation of the previous request', async () => {
  const events = await forgedScenario('A');
  const third = events.filter((event) => event.event_type === 'model.request.started')[2];
  const stubIndex = third.payload.request.messages.findIndex((message) => message.tool_call_id === 'call:echo-1');
  const verbatim = events
    .filter((event) => event.event_type === 'model.request.started')[1]
    .payload.request.messages.find((message) => message.tool_call_id === 'call:echo-1');
  third.payload.request.messages[stubIndex] = verbatim;
  assertGuard(events, 'AGENT_SESSION_REQUEST_MISMATCH', /does not preserve its durable predecessor/);
});

test('forged request guard: a revision cannot follow an older-results record', async () => {
  const events = await forgedScenario('A');
  const older = compactionsOf(events)[0];
  const step = events.filter((event) => event.event_type === 'model.request.started')[1];
  const revision = {
    ...structuredClone(older),
    event_id: 'event:forged-revision',
    event_type: 'model.revision.requested',
    payload: { turn_id: step.payload.turn_id, step_id: step.payload.step_id, feedback: 'revise' },
  };
  assertGuard(insertAfter(events, older, revision), 'AGENT_SESSION_MODEL_STEP_ORDER_INVALID', /latest completed model response/);
});
