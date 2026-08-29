'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { after, before, test } = require('node:test');

const Database = require('better-sqlite3');
const { z } = require('zod');

const { AgentExecutionSupervisor, LocalSubagentProvider, WorkflowEngine } = require('../packages/agent-orchestration');
const { ContextAssembler } = require('../packages/agent-context');
const { AgentRuntime, stableId } = require('../packages/agent-runtime');
const { RelationalSessionEventStore, canonicalJson } = require('../packages/agent-session-store');
const { ModelProviderRegistry, OpenAICompatibleModelProvider, ScriptedModelProvider } = require('../packages/model-providers');
const { governanceRef, ToolRuntime, ToolRuntimeRegistry } = require('../packages/tool-runtime');
const { ExecutionContractRegistry } = require('../tools/lib/governed-execution/contract-registry');
const { createExecutionEventRegistry } = require('../tools/lib/governed-execution/event-registry');
const { createGovernedExecutionPort } = require('../tools/lib/governed-execution/execution-port');
const { GovernedExecutionRuntime } = require('../tools/lib/governed-execution/runtime');
const { GovernedExecutionScheduler } = require('../tools/lib/governed-execution/scheduler');
const { ExecutionApprovalStore } = require('../tools/mcp-project-state/lib/execution-approval-store');
const {
  applyExecutionLedgerFixtureSchema,
  createExecutionLedgerFileFixture,
  openExecutionLedgerFileFixture,
} = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { ExecutionProjectionStore } = require('../tools/mcp-project-state/lib/execution-projections');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');
const FIXED_TIME = Date.parse('2026-08-22T23:00:00.000Z');

function manifest(providerId, model) {
  return {
    schema_version: 1,
    provider_type: 'model',
    provider_id: providerId,
    provider_version: '1.0.0',
    models: [model],
    capabilities: ['text_generation', 'streaming', 'usage', 'cancellation'],
    limits: { context_tokens: 1_000_000, max_output_tokens: 256, max_parallel_requests: 4 },
    secret_refs: [],
  };
}

function profile() {
  return {
    instructions: {
      constitution: [
        {
          source_ref: 'governance://constitution',
          classification: 'internal',
          content: 'HSEOS governance remains authoritative.',
        },
      ],
      project: [
        {
          source_ref: 'project://completion-audit',
          classification: 'internal',
          content: 'Exercise the provider-neutral kernel contract.',
        },
      ],
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

function sessionSpec(providerId, model) {
  return {
    schema_version: 1,
    session_id: 'session:provider-substitution',
    agent_id: 'agent:completion-audit',
    parent_session_id: null,
    authority_ref: 'authority://audit/read-only',
    policy_ref: 'policy://audit/v1',
    execution: { mode: 'kernel', model_provider_id: providerId, model },
    limits: {
      max_turns: 2,
      max_tokens: 100_000,
      max_duration_ms: 30_000,
      max_tool_calls: 0,
      max_children: 0,
      max_workflow_steps: 0,
    },
    metadata: { purpose: 'provider-substitution-audit' },
  };
}

function scriptedProvider(providerManifest) {
  const success = [
    { event_type: 'content.delta', payload: { text: 'provider-neutral result' } },
    { event_type: 'usage', payload: { input_tokens: 11, output_tokens: 3, cached_tokens: 0 } },
    {
      event_type: 'completed',
      payload: { finish_reason: 'stop', provider_response_ref: 'scripted://completion-audit' },
    },
  ];
  return new ScriptedModelProvider({
    manifest: providerManifest,
    routes: [
      { match: (request) => request.messages.at(-1).content === 'prove substitution', events: success },
      { match: () => true, events: success },
    ],
  });
}

function toolRuntime(db) {
  const contracts = new ExecutionContractRegistry();
  const eventRegistry = createExecutionEventRegistry();
  const executionLedger = new ExecutionEventLedger(db, { event_registry: eventRegistry });
  const governed = new GovernedExecutionRuntime({
    contracts,
    event_registry: eventRegistry,
    ledger: executionLedger,
    approval_store: new ExecutionApprovalStore(db),
    authority: {
      async evaluate() {
        return { allowed: false };
      },
    },
    policy: {
      async evaluate() {
        return { allowed: false };
      },
    },
    providers: new Map(),
    clock: { now: () => new Date(FIXED_TIME) },
  });
  const registry = new ToolRuntimeRegistry({ contracts });
  return new ToolRuntime({
    registry,
    scheduler: new GovernedExecutionScheduler({
      contracts,
      port: createGovernedExecutionPort(governed),
      maxConcurrency: 1,
    }),
  });
}

function executable(schema) {
  return Object.freeze({ version: 1, safeParse: schema.safeParse.bind(schema) });
}

function cancellationToolContract() {
  return {
    name: 'audit.wait',
    capability: 'audit.wait',
    provider: 'audit-wait-provider',
    authority: 'audit.execute',
    policy_version: 'audit-policy-v1',
    reversibility: 'read_only',
    cancellation_policy: 'cooperative',
    failure_mode: 'fail_closed',
    timeout_ms: 10_000,
    requires_approval: false,
    exclusive: false,
    provider_accepts_idempotency: true,
    sandbox: null,
    prerequisites: [],
    input_schema: executable(z.object({ value: z.string() }).strict()),
    output_schema: executable(z.object({ observed: z.string() }).strict()),
  };
}

function cancellationToolDefinition() {
  return {
    name: 'audit.wait',
    description: 'Wait cooperatively until the governed root is cancelled.',
    input_schema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    governance_ref: governanceRef('audit.wait'),
  };
}

function cancellationSessionSpec(sessionId, parentSessionId = null, overrides = {}) {
  return {
    schema_version: 1,
    session_id: sessionId,
    agent_id: `agent:${sessionId.replaceAll(':', '-')}`,
    parent_session_id: parentSessionId,
    authority_ref: 'authority://audit/cancellation',
    policy_ref: 'policy://audit/cancellation-v1',
    execution: { mode: 'kernel', model_provider_id: 'model:audit-cancellation', model: 'audit/cancellation' },
    limits: {
      max_turns: 2,
      max_tokens: 100_000,
      max_duration_ms: 30_000,
      max_tool_calls: 1,
      max_children: 2,
      max_workflow_steps: 2,
      ...overrides,
    },
    metadata: { purpose: 'assembled-root-cancellation' },
  };
}

function waitFor(assertion, timeoutMs = 2000) {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      try {
        if (assertion()) return resolve();
      } catch {
        // The observed durable aggregate may not exist until the asynchronous fork completes.
      }
      if (performance.now() - startedAt >= timeoutMs) return reject(new Error('condition was not observed before timeout'));
      setImmediate(inspect);
    };
    inspect();
  });
}

function appendSessionEvent(store, sessionId, eventType, payload, label) {
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

function coordinatedCancellationFixture(toolStarted) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(db) });
  const eventRegistry = createExecutionEventRegistry();
  const ledger = new ExecutionEventLedger(db, { event_registry: eventRegistry });
  const projection = new ExecutionProjectionStore(db, ledger);
  projection.rebuild();
  const contracts = new ExecutionContractRegistry();
  const registered = contracts.register(cancellationToolContract());
  const governed = new GovernedExecutionRuntime({
    contracts,
    event_registry: eventRegistry,
    ledger,
    approval_store: new ExecutionApprovalStore(db),
    authority: { async evaluate() { return { allowed: true }; } },
    policy: { async evaluate() { return { allowed: true, requires_approval: false, policy_version: registered.policy_version, warnings: [] }; } },
    providers: new Map([['audit-wait-provider', {
      async execute(_input, { signal }) {
        toolStarted();
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('root cancellation reached governed tool');
            error.outcome = 'cancelled';
            reject(error);
          }, { once: true });
        });
      },
    }]]),
    projector: projection,
    clock: { now: () => new Date().toISOString() },
    event_id_factory: randomUUID,
  });
  const toolRegistry = new ToolRuntimeRegistry({ contracts });
  toolRegistry.register(cancellationToolDefinition());
  const tools = new ToolRuntime({
    registry: toolRegistry,
    scheduler: new GovernedExecutionScheduler({ contracts, port: createGovernedExecutionPort(governed), maxConcurrency: 2 }),
  });
  const providerManifest = {
    ...manifest('model:audit-cancellation', 'audit/cancellation'),
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'usage', 'cancellation'],
  };
  const provider = new ScriptedModelProvider({
    manifest: providerManifest,
    routes: [
      {
        match: (request) => request.session_id.endsWith('root') && request.messages.at(-1).role === 'user',
        events: [
          { event_type: 'tool_call.delta', payload: { tool_call_id: 'call:audit-wait', name: 'audit.wait', arguments_delta: '{"value":"root"}' } },
          { event_type: 'completed', payload: { finish_reason: 'tool_calls', provider_response_ref: 'scripted://root-tool' } },
        ],
      },
      {
        match: (request) => request.messages.at(-1).role === 'user',
        events: [
          { delay_ms: 10_000, event_type: 'content.delta', payload: { text: 'late child output' } },
          { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://late-child' } },
        ],
      },
      { match: () => true, events: [{ event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://unused' } }] },
    ],
  });
  const models = new ModelProviderRegistry();
  models.register(provider, providerManifest);
  const runtime = new AgentRuntime({
    session_store: store,
    model_provider_snapshot: models.snapshot(),
    tool_runtime: tools,
    context_profile_resolver: profile,
  });
  const subagents = new LocalSubagentProvider({
    session_store: store,
    agent_runtime: runtime,
    provider_id: 'subagent:audit-cancellation',
    max_parallel_children: 4,
  });
  const workflowEngine = new WorkflowEngine({
    engine_id: 'workflow:audit-cancellation',
    session_store: store,
    subagent_provider: subagents,
  });
  const supervisor = new AgentExecutionSupervisor({
    agent_runtime: runtime,
    session_store: store,
    workflow_engines: new Map([['workflow:audit-cancellation', workflowEngine]]),
    max_settlement_ms: 3000,
  });
  return { db, runtime, store, subagents, supervisor };
}

async function executeJourney(provider, providerManifest) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(db) });
  const registry = new ModelProviderRegistry();
  registry.register(provider, providerManifest);
  const runtime = new AgentRuntime({
    session_store: store,
    model_provider_snapshot: registry.snapshot(),
    tool_runtime: toolRuntime(db),
    context_profile_resolver: profile,
    clock: { now: () => FIXED_TIME },
  });
  const spec = sessionSpec(providerManifest.provider_id, providerManifest.models[0]);
  await runtime.create({ schema_version: 1, command: 'create', spec });
  const result = await runtime.send({
    schema_version: 1,
    command: 'send',
    session_id: spec.session_id,
    turn_id: 'turn:provider-substitution',
    message: { role: 'user', content: 'prove substitution' },
  });
  const state = store.replay(spec.session_id);
  return { db, result, runtime, state, store };
}

function normalizedLifecycle(state) {
  const step = state.turns['turn:provider-substitution'].model_steps[0];
  return step.model_events.map((event) => ({
    event_type: event.event_type,
    payload: event.event_type === 'completed' ? { finish_reason: event.payload.finish_reason } : event.payload,
  }));
}

let server;
let baseUrl;
let responseMode = 'success';

before(async () => {
  server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      assert.equal(request.url, '/chat/completions');
      assert.equal(parsed.messages.at(-1).content, 'prove substitution');
      response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'completion-audit' });
      if (responseMode === 'malformed') {
        response.end('data: {not-json}\n\n');
        return;
      }
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'provider-neutral result' }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 3 }, choices: [] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('scripted and OpenAI-compatible providers complete the same AgentRuntime lifecycle', async (context) => {
  responseMode = 'success';
  const scriptedManifest = manifest('model:audit-scripted', 'audit/scripted');
  const httpManifest = manifest('model:audit-openai-compatible', 'audit/openai-compatible');
  const scripted = await executeJourney(scriptedProvider(scriptedManifest), scriptedManifest);
  const compatible = await executeJourney(
    new OpenAICompatibleModelProvider({ manifest: httpManifest, base_url: baseUrl, max_attempts: 1 }),
    httpManifest,
  );
  context.after(() => {
    scripted.db.close();
    compatible.db.close();
  });

  assert.equal(scripted.result.terminal, true);
  assert.equal(compatible.result.terminal, true);
  assert.equal(scripted.state.status, 'completed');
  assert.equal(compatible.state.status, 'completed');
  assert.deepEqual(normalizedLifecycle(scripted.state), normalizedLifecycle(compatible.state));

  const scriptedRequest = scripted.store.reconstructRequest('session:provider-substitution');
  const compatibleRequest = compatible.store.reconstructRequest('session:provider-substitution');
  assert.equal(canonicalJson(scriptedRequest.request.messages), canonicalJson(compatibleRequest.request.messages));
  assert.equal(canonicalJson(scriptedRequest.request.tools), canonicalJson(compatibleRequest.request.tools));
  assert.equal(canonicalJson(scriptedRequest.request.parameters), canonicalJson(compatibleRequest.request.parameters));
  assert.equal(scriptedRequest.byte_length, Buffer.byteLength(scriptedRequest.canonical_json, 'utf8'));
  assert.equal(compatibleRequest.byte_length, Buffer.byteLength(compatibleRequest.canonical_json, 'utf8'));
});

test('malformed provider transport terminalizes without false success', async (context) => {
  responseMode = 'malformed';
  const providerManifest = manifest('model:audit-malformed', 'audit/malformed');
  const journey = await executeJourney(
    new OpenAICompatibleModelProvider({ manifest: providerManifest, base_url: baseUrl, max_attempts: 1 }),
    providerManifest,
  );
  context.after(() => journey.db.close());
  assert.equal(journey.result.terminal, true);
  assert.equal(journey.state.status, 'failed');
  assert.equal(journey.state.terminal_event.event_type, 'session.failed');
  assert.equal(journey.state.terminal_event.payload.error_code, 'protocol_error');
  assert.equal(
    journey.store.readSession('session:provider-substitution').some((event) => event.event_type === 'session.completed'),
    false,
  );
});

test('one root cancellation settles an active tool, workflow, model work, and every descendant', async (context) => {
  let markToolStarted;
  const toolStarted = new Promise((resolve) => {
    markToolStarted = resolve;
  });
  const fixture = coordinatedCancellationFixture(markToolStarted);
  context.after(() => fixture.db.close());
  const rootSpec = cancellationSessionSpec('session:cancel-root');
  await fixture.runtime.create({ schema_version: 1, command: 'create', spec: rootSpec });
  const workflowRun = fixture.supervisor.runWorkflow('workflow:audit-cancellation', {
    schema_version: 1,
    engine_id: 'workflow:audit-cancellation',
    request_id: 'request:audit-workflow-run',
    parent_session_id: rootSpec.session_id,
    occurred_at: new Date().toISOString(),
    workflow: {
      schema_version: 1,
      workflow_id: 'workflow:audit-root-tree',
      subagent_provider_id: 'subagent:audit-cancellation',
      max_parallelism: 1,
      join_timeout_ms: 20_000,
      phases: [{
        phase_id: 'phase:audit-cancel',
        mode: 'pipeline',
        steps: [{
          step_id: 'step:audit-child',
          child_spec: cancellationSessionSpec('session:cancel-child', rootSpec.session_id, { max_children: 1, max_workflow_steps: 0 }),
          turn_id: 'turn:audit-child',
          message: { role: 'user', content: 'wait as workflow child' },
        }],
      }],
    },
  });
  await waitFor(() => fixture.store.readSession('session:cancel-child').some((event) => event.event_type === 'model.request.started'));
  const childSequence = fixture.store.replay('session:cancel-child').current_sequence;
  await fixture.subagents.spawn({
    schema_version: 1,
    provider_id: 'subagent:audit-cancellation',
    request_id: 'request:audit-grandchild-spawn',
    parent_session_id: 'session:cancel-child',
    parent_sequence: childSequence,
    child_spec: cancellationSessionSpec('session:cancel-grandchild', 'session:cancel-child', { max_children: 0, max_workflow_steps: 0 }),
    turn_id: 'turn:audit-grandchild',
    message: { role: 'user', content: 'wait as model-active descendant' },
    occurred_at: new Date().toISOString(),
  });
  await waitFor(() => fixture.store.readSession('session:cancel-grandchild').some((event) => event.event_type === 'model.request.started'));
  const rootRun = fixture.supervisor.send({
    schema_version: 1,
    command: 'send',
    session_id: rootSpec.session_id,
    turn_id: 'turn:audit-root',
    message: { role: 'user', content: 'enter governed wait tool' },
  });
  await toolStarted;
  const startedAt = performance.now();
  const cancelled = await fixture.supervisor.cancelRoot({
    schema_version: 1,
    request_id: 'request:audit-root-cancel',
    root_session_id: rootSpec.session_id,
    reason: 'completion audit root cancellation',
    deadline_ms: 3000,
  });
  const elapsedMs = performance.now() - startedAt;
  const [rootResult, workflowResult] = await Promise.all([rootRun, workflowRun]);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(rootResult.terminal, true);
  assert.equal(workflowResult.status, 'cancelled');
  assert.ok(elapsedMs < 3000, `root cancellation took ${elapsedMs.toFixed(2)}ms`);
  assert.deepEqual(cancelled.descendant_session_ids, ['session:cancel-child', 'session:cancel-grandchild']);
  for (const sessionId of [rootSpec.session_id, ...cancelled.descendant_session_ids]) {
    assert.equal(fixture.store.replay(sessionId).terminal_event.event_type, 'session.cancelled');
  }
  const rootEvents = fixture.store.readSession(rootSpec.session_id);
  assert.equal(rootEvents.some((event) => event.event_type === 'tool.execution.completed'), true);
  assert.equal(rootEvents.at(-1).event_type, 'session.cancelled');
});

test('a non-settling workflow cancellation cannot block root runtime and tool interruption', async (context) => {
  let markToolStarted;
  const toolStarted = new Promise((resolve) => {
    markToolStarted = resolve;
  });
  const fixture = coordinatedCancellationFixture(markToolStarted);
  context.after(() => fixture.db.close());
  let workflowCancelCalls = 0;
  const never = new Promise(() => {});
  const blockedWorkflow = {
    run() { return never; },
    cancel() {
      workflowCancelCalls++;
      return never;
    },
    async dispose() { return { accepted: true }; },
  };
  const supervisor = new AgentExecutionSupervisor({
    agent_runtime: fixture.runtime,
    session_store: fixture.store,
    workflow_engines: new Map([['workflow:blocked-cancellation', blockedWorkflow]]),
    max_settlement_ms: 100,
  });
  const rootSpec = cancellationSessionSpec('session:blocked-workflow-root', null, { max_children: 0, max_workflow_steps: 0 });
  await fixture.runtime.create({ schema_version: 1, command: 'create', spec: rootSpec });
  supervisor.runWorkflow('workflow:blocked-cancellation', {
    parent_session_id: rootSpec.session_id,
    workflow: { workflow_id: 'workflow:blocked-forever' },
  });
  const rootRun = supervisor.send({
    schema_version: 1,
    command: 'send',
    session_id: rootSpec.session_id,
    turn_id: 'turn:blocked-workflow-root',
    message: { role: 'user', content: 'enter governed wait tool' },
  });
  await toolStarted;
  await assert.rejects(
    () => supervisor.cancelRoot({
      schema_version: 1,
      request_id: 'request:blocked-workflow-root-cancel',
      root_session_id: rootSpec.session_id,
      reason: 'workflow cancellation is non-cooperative',
      deadline_ms: 50,
    }),
    (error) => error.code === 'AGENT_EXECUTION_SETTLEMENT_TIMEOUT',
  );
  await rootRun;
  assert.equal(workflowCancelCalls, 1);
  assert.equal(fixture.store.replay(rootSpec.session_id).terminal_event.event_type, 'session.cancelled');
  assert.equal(
    fixture.store.readSession(rootSpec.session_id).some((event) => event.event_type === 'tool.execution.completed'),
    true,
  );
});

test('root cancellation cannot relabel a durable completed session as cancelled', async (context) => {
  const providerManifest = manifest('model:audit-terminal-correlation', 'audit/terminal-correlation');
  const journey = await executeJourney(scriptedProvider(providerManifest), providerManifest);
  context.after(() => journey.db.close());
  const inactiveWorkflow = {
    async run() { throw new Error('not invoked'); },
    async cancel() { throw new Error('not invoked'); },
    async dispose() { return { accepted: true }; },
  };
  const supervisor = new AgentExecutionSupervisor({
    agent_runtime: journey.runtime,
    session_store: journey.store,
    workflow_engines: new Map([['workflow:inactive-correlation', inactiveWorkflow]]),
    max_settlement_ms: 1000,
  });
  await assert.rejects(
    () => supervisor.cancelRoot({
      schema_version: 1,
      request_id: 'request:terminal-correlation',
      root_session_id: 'session:provider-substitution',
      reason: 'must not rewrite terminal truth',
      deadline_ms: 1000,
    }),
    (error) => error.code === 'AGENT_EXECUTION_TERMINAL_CONFLICT' && error.details.terminal_event_type === 'session.completed',
  );
  assert.equal(journey.store.replay('session:provider-substitution').terminal_event.event_type, 'session.completed');
});

test('a replacement runtime resumes the exact next model request from a reopened persistent ledger', async () => {
  const fixture = createExecutionLedgerFileFixture();
  const providerManifest = manifest('model:audit-resume', 'audit/resume');
  let observedRequest = null;
  const provider = new ScriptedModelProvider({
    manifest: providerManifest,
    routes: [
      {
        match: () => true,
        events(request) {
          observedRequest = request;
          return [
            { event_type: 'content.delta', payload: { text: 'resumed exactly once' } },
            { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://persistent-resume' } },
          ];
        },
      },
      { match: () => false, events: [] },
    ],
  });
  const models = new ModelProviderRegistry();
  models.register(provider, providerManifest);
  const snapshot = models.snapshot();
  const spec = {
    ...sessionSpec(providerManifest.provider_id, providerManifest.models[0]),
    session_id: 'session:persistent-resume',
    metadata: { purpose: 'persistent-exact-next-request' },
  };
  try {
    const initialStore = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(fixture.db) });
    const initialRuntime = new AgentRuntime({
      session_store: initialStore,
      model_provider_snapshot: snapshot,
      tool_runtime: toolRuntime(fixture.db),
      context_profile_resolver: profile,
    });
    await initialRuntime.create({ schema_version: 1, command: 'create', spec });
    const message = { role: 'user', content: 'resume this exact durable request' };
    const turn = appendSessionEvent(
      initialStore,
      spec.session_id,
      'turn.started',
      { turn_id: 'turn:persistent-resume', input: message },
      'persistent-resume-turn',
    );
    const assembler = new ContextAssembler({ session_store: initialStore, model_provider_snapshot: snapshot });
    const assembled = assembler.assembleAndRecord({
      schema_version: 1,
      request_id: stableId('request', spec.session_id, 'turn:persistent-resume', 0),
      turn_id: 'turn:persistent-resume',
      event_id: stableId('event', spec.session_id, 'persistent-resume-context'),
      occurred_at: new Date().toISOString(),
      expected_version: 2,
      session: spec,
      ...profile(),
      current_turn: { source_ref: `session-event://${turn.event_id}`, message },
      tools: [],
    });
    appendSessionEvent(
      initialStore,
      spec.session_id,
      'model.request.started',
      {
        turn_id: 'turn:persistent-resume',
        step_id: stableId('step', spec.session_id, 'turn:persistent-resume', 0),
        request: assembled.request,
        source_event_ids: [assembled.event.event_id],
      },
      'persistent-resume-model-start',
    );
    const beforeCrash = initialStore.reconstructRequest(spec.session_id);
    assert.equal(initialStore.recoveryPlan(spec.session_id).next_action, 'restart_model_request');
    fixture.db.close();

    const reopened = openExecutionLedgerFileFixture(fixture.directory);
    try {
      const recoveredStore = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(reopened.db) });
      const replacement = new AgentRuntime({
        session_store: recoveredStore,
        model_provider_snapshot: snapshot,
        tool_runtime: toolRuntime(reopened.db),
        context_profile_resolver: profile,
      });
      const expectedSequence = recoveredStore.replay(spec.session_id).current_sequence;
      const resumed = await replacement.resume({
        schema_version: 1,
        command: 'resume',
        session_id: spec.session_id,
        expected_sequence: expectedSequence,
      });
      assert.equal(resumed.terminal, true);
      assert.equal(recoveredStore.replay(spec.session_id).status, 'completed');
      assert.equal(canonicalJson(observedRequest), beforeCrash.canonical_json);
      assert.equal(recoveredStore.readSession(spec.session_id).filter((event) => event.event_type === 'model.request.started').length, 1);
    } finally {
      reopened.db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('persistent replay scales within explicit latency, storage, and memory bounds', async (context) => {
  const percentile = (samples, quantile) => [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * quantile) - 1];
  const volumes = [16, 128, 512];
  const metrics = [];
  const heapBefore = process.memoryUsage().heapUsed;
  for (const volume of volumes) {
    const fixture = createExecutionLedgerFileFixture();
    const sessionId = `session:persistent-performance-${volume}`;
    try {
      const providerManifest = manifest(`model:audit-performance-${volume}`, `audit/performance-${volume}`);
      const provider = new ScriptedModelProvider({
        manifest: providerManifest,
        routes: [
          {
            match: () => true,
            events: [
              ...Array.from({ length: volume }, (_, index) => ({
                event_type: 'content.delta',
                payload: { text: `bounded-${index};` },
              })),
              { event_type: 'usage', payload: { input_tokens: 20, output_tokens: volume, cached_tokens: 0 } },
              { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: `scripted://performance-${volume}` } },
            ],
          },
          { match: () => false, events: [] },
        ],
      });
      const models = new ModelProviderRegistry();
      models.register(provider, providerManifest);
      const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(fixture.db) });
      const runtime = new AgentRuntime({
        session_store: store,
        model_provider_snapshot: models.snapshot(),
        tool_runtime: toolRuntime(fixture.db),
        context_profile_resolver: profile,
      });
      const spec = {
        ...sessionSpec(providerManifest.provider_id, providerManifest.models[0]),
        session_id: sessionId,
        limits: { ...sessionSpec(providerManifest.provider_id, providerManifest.models[0]).limits, max_tokens: 2_000_000 },
        metadata: { purpose: 'persistent-volume-performance' },
      };
      await runtime.create({ schema_version: 1, command: 'create', spec });
      await runtime.send({
        schema_version: 1,
        command: 'send',
        session_id: sessionId,
        turn_id: `turn:persistent-performance-${volume}`,
        message: { role: 'user', content: `measure ${volume} durable stream events` },
      });
      const eventCount = store.readSession(sessionId).length;
      fixture.db.close();
      const reopened = openExecutionLedgerFileFixture(fixture.directory);
      try {
        const recovered = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(reopened.db) });
        const samples = [];
        for (let sample = 0; sample < 25; sample++) {
          const startedAt = performance.now();
          assert.equal(recovered.replay(sessionId).status, 'completed');
          assert.equal(recovered.reconstructRequest(sessionId).request.messages.at(-1).content, `measure ${volume} durable stream events`);
          samples.push(performance.now() - startedAt);
        }
        metrics.push({
          volume,
          event_count: eventCount,
          p50_ms: Number(percentile(samples, 0.5).toFixed(3)),
          p95_ms: Number(percentile(samples, 0.95).toFixed(3)),
          max_ms: Number(Math.max(...samples).toFixed(3)),
          database_bytes: fs.statSync(fixture.filename).size,
        });
      } finally {
        reopened.db.close();
      }
    } finally {
      fixture.cleanup();
    }
  }
  const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  for (const metric of metrics) {
    assert.ok(metric.event_count >= metric.volume + 6, JSON.stringify(metric));
    assert.ok(metric.p95_ms < 250, JSON.stringify(metric));
    assert.ok(metric.p95_ms < 5 + metric.event_count * 0.25, `p95 exceeded linear event-volume envelope: ${JSON.stringify(metric)}`);
    assert.ok(metric.database_bytes < 16 * 1024 * 1024, JSON.stringify(metric));
  }
  assert.ok(heapGrowthBytes < 128 * 1024 * 1024, `heap grew by ${heapGrowthBytes} bytes`);
  context.diagnostic(JSON.stringify({ metrics, heap_growth_bytes: heapGrowthBytes }));
});
