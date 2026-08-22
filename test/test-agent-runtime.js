'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { test } = require('node:test');

const Database = require('better-sqlite3');
const { z } = require('zod');

const { ContextAssembler } = require('../packages/agent-context');
const { AgentRuntime, RUNTIME_CAPS, stableId } = require('../packages/agent-runtime');
const {
  CONTRACT_SCHEMA_VERSION,
  MAX_MODEL_EVENTS_PER_STEP,
  assertPortShape,
  validatePortResult,
} = require('../packages/agent-runtime-contracts');
const { RelationalSessionEventStore } = require('../packages/agent-session-store');
const { ModelProviderRegistry, ScriptedModelProvider } = require('../packages/model-providers');
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

function modelRoutes({ slow = false, calls = null } = {}) {
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
          { event_type: 'usage', payload: { input_tokens: 20, output_tokens: 3, cached_tokens: 0 } },
          { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://done' } },
        ];
      },
    },
  ];
}

function setup({ routes = modelRoutes(), limits = {}, clock = Date, streamLimits = {} } = {}) {
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
    authority: { async evaluate() { return { allowed: true }; } },
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
            return { data: { echoed: input.value }, evidence: ['evidence://external-read'] };
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

  const provider = new ScriptedModelProvider({ manifest: manifest(), routes });
  const modelRegistry = new ModelProviderRegistry();
  modelRegistry.register(provider, manifest());
  const snapshot = modelRegistry.snapshot();
  const runtime = new AgentRuntime({
    session_store: sessionStore,
    model_provider_snapshot: snapshot,
    tool_runtime: tools,
    context_profile_resolver: profile,
    clock,
    stream_limits: streamLimits,
  });
  return { db, external, provider, runtime, sessionStore, snapshot, tools, sessionSpec: spec('session:loop', limits) };
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
  const toolIntent = rows.find((row) => row.aggregate_type === 'agent_session' && row.event_type === 'AgentSessionEventRecorded' &&
    JSON.parse(fixture.db.prepare('SELECT payload_json FROM execution_events WHERE position = ?').get(row.position).payload_json).session_event_json.includes('tool.execution.started'));
  const dispatchStart = rows.find((row) => row.aggregate_type === 'execution' && row.event_type === 'ExecutionStarted');
  assert.ok(toolIntent.position < dispatchStart.position, 'session tool intent is durable before governed dispatch');
});

test('a second runtime resumes after durable tool completion without redispatch', async (context) => {
  const calls = { continuations: 0 };
  const fixture = setup({ routes: modelRoutes({ calls }) });
  context.after(() => fixture.db.close());
  await fixture.runtime.create(createCommand(fixture.sessionSpec));
  const turn = append(fixture.sessionStore, 'session:loop', 'turn.started', { turn_id: 'turn:loop-1', input: sendCommand().message }, 'manual-turn');
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
    { turn_id: 'turn:loop-1', step_id: stepId, invocation_id: invocation.invocation_id, tool_call_id: 'call:echo-1', name: 'fixture.echo', input: invocation.input, idempotency_key: invocation.idempotency_key },
    'manual-tool-start',
  );
  const outcome = await fixture.tools.execute(invocation);
  append(fixture.sessionStore, 'session:loop', 'tool.execution.completed', { turn_id: 'turn:loop-1', step_id: stepId, outcome }, 'manual-tool-complete');
  append(fixture.sessionStore, 'session:loop', 'tool.operation_linked', { turn_id: 'turn:loop-1', tool_call_id: 'call:echo-1', operation_id: outcome.operation_id }, 'manual-link');
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
  const turn = append(fixture.sessionStore, 'session:loop', 'turn.started', { turn_id: 'turn:loop-1', input: sendCommand().message }, 'partial-turn');
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
  append(fixture.sessionStore, 'session:loop', 'model.request.started', { turn_id: 'turn:loop-1', step_id: stepId, request: assembled.request, source_event_ids: [assembled.event.event_id] }, 'partial-start');
  append(
    fixture.sessionStore,
    'session:loop',
    'model.streamed',
    {
      turn_id: 'turn:loop-1',
      step_id: stepId,
      provider_id: 'model:loop-fixture',
      event: { schema_version: 1, provider_id: 'model:loop-fixture', request_id: assembled.request.request_id, event_type: 'content.delta', sequence: 0, payload: { text: 'observed' } },
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
  const result = await fixture.runtime.resume({ schema_version: 1, command: 'resume', session_id: 'session:loop', expected_sequence: before });
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
  assert.deepEqual(events.slice(-3).map((event) => event.event_type), [
    'session.cancellation.requested',
    'model.streamed',
    'session.cancelled',
  ]);
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
  assert.deepEqual(events.slice(-2).map((event) => event.event_type), ['model.streamed', 'session.failed']);
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

test('unknown sessions, delegated ownership, concurrent sends and stale resume fail closed', async (context) => {
  const fixture = setup({ routes: modelRoutes({ slow: true }) });
  context.after(() => fixture.db.close());
  await assert.rejects(() => fixture.runtime.send(sendCommand('session:missing')));
  const delegated = { ...fixture.sessionSpec, session_id: 'session:delegated', execution: { mode: 'delegated', runtime_provider_id: 'runtime:fixture', profile: 'default' } };
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
  const result = validatePortResult('AgentRuntime', 'dispose', await fixture.runtime.dispose({ schema_version: 1, command: 'dispose', session_id: 'session:loop' }), { schema_version: 1, command: 'dispose', session_id: 'session:loop' });
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
