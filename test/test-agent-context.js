'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { test } = require('node:test');

const Database = require('better-sqlite3');

const {
  ConservativeUtf8TokenCounter,
  ContextAssembler,
  ContextAssemblyError,
  ContextBudgetError,
  TokenCounterError,
} = require('../packages/agent-context');
const {
  AgentContractError,
  CONTEXT_ASSEMBLY_CONTRACT,
  CONTEXT_PRECEDENCE_PREAMBLE,
  CONTEXT_PRECEDENCE_REF,
} = require('../packages/agent-runtime-contracts');
const { RelationalSessionEventStore, canonicalJson } = require('../packages/agent-session-store');
const { ModelProviderRegistry, ModelProviderRegistrySnapshot, ScriptedModelProvider } = require('../packages/model-providers');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const fixtures = require('./fixtures/agent-runtime-contracts');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');

function openStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  return { db, store: new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(db) }) };
}

function session(sessionId) {
  return {
    ...structuredClone(fixtures.kernelSession),
    session_id: sessionId,
    metadata: { purpose: 'context-assembly-test' },
  };
}

function providerManifest(contextTokens = 128_000) {
  const manifest = structuredClone(fixtures.modelManifest);
  manifest.limits.context_tokens = contextTokens;
  manifest.secret_refs = [];
  return manifest;
}

function providerSnapshot(manifest = providerManifest()) {
  const registry = new ModelProviderRegistry();
  const routes = [
    { match: () => true, events: [] },
    { match: () => false, events: [] },
  ];
  registry.register(new ScriptedModelProvider({ manifest, routes }), manifest);
  return registry.snapshot();
}

function assembler(store, { manifest = providerManifest(), counter } = {}) {
  return new ContextAssembler({
    session_store: store,
    model_provider_snapshot: providerSnapshot(manifest),
    ...(counter ? { token_counter: counter } : {}),
  });
}

function eventId(label) {
  return `event:${createHash('sha256').update(label).digest('hex').slice(0, 20)}`;
}

function prepareSession(store, spec, turnId = 'turn:context-1', turnEventId = 'event:context-turn') {
  const turnMessage = { role: 'user', content: 'implement the selected change' };
  store.append({
    session_id: spec.session_id,
    expected_version: 0,
    events: [
      {
        schema_version: 1,
        event_id: eventId(`${spec.session_id}:created`),
        session_id: spec.session_id,
        sequence: 1,
        occurred_at: '2026-08-22T02:10:00Z',
        event_type: 'session.created',
        payload: { spec },
      },
      {
        schema_version: 1,
        event_id: turnEventId,
        session_id: spec.session_id,
        sequence: 2,
        occurred_at: '2026-08-22T02:10:01Z',
        event_type: 'turn.started',
        payload: { turn_id: turnId, input: turnMessage },
      },
    ],
  });
  return turnMessage;
}

function prepareSessionWithHistory(store, spec) {
  const events = [
    {
      schema_version: 1,
      event_id: eventId(`${spec.session_id}:created`),
      session_id: spec.session_id,
      sequence: 1,
      occurred_at: '2026-08-22T02:10:00Z',
      event_type: 'session.created',
      payload: { spec },
    },
  ];
  let sequence = 1;
  for (const [label, answer] of [
    ['old', 'x'.repeat(5000)],
    ['recent', 'recent answer'],
  ]) {
    const turnId = `turn:history-${label}`;
    const input = { role: 'user', content: `${label} question` };
    const turnEventId = eventId(`${spec.session_id}:${label}:turn`);
    const turnEvent = {
      schema_version: 1,
      event_id: turnEventId,
      session_id: spec.session_id,
      sequence: ++sequence,
      occurred_at: `2026-08-22T02:10:0${sequence}Z`,
      event_type: 'turn.started',
      payload: { turn_id: turnId, input },
    };
    const requestId = `request:history-${label}`;
    const contextEvent = {
      schema_version: 1,
      event_id: eventId(`${spec.session_id}:${label}:context`),
      session_id: spec.session_id,
      sequence: ++sequence,
      occurred_at: `2026-08-22T02:10:0${sequence}Z`,
      event_type: 'context.assembled',
      payload: {
        assembly_contract: CONTEXT_ASSEMBLY_CONTRACT,
        turn_id: turnId,
        request: {
          schema_version: 1,
          request_id: requestId,
          session_id: spec.session_id,
          turn_id: turnId,
          provider_id: spec.execution.model_provider_id,
          model: spec.execution.model,
          messages: [
            { role: 'system', content: CONTEXT_PRECEDENCE_PREAMBLE },
            {
              role: 'system',
              content: '[HSEOS INSTRUCTION tier=constitution source="governance://constitution"]\nrule\n[END HSEOS INSTRUCTION]',
            },
            {
              role: 'system',
              content: '[HSEOS INSTRUCTION tier=project source="project://instructions"]\nrule\n[END HSEOS INSTRUCTION]',
            },
            input,
          ],
          tools: [],
          parameters: { max_output_tokens: 1, temperature: null, stop: [] },
        },
        source_refs: [
          CONTEXT_PRECEDENCE_REF,
          'governance://constitution',
          'project://instructions',
          `session-event://${turnEventId}`,
        ],
        budget: {
          counter_id: 'token-counter:history-fixture',
          context_limit_tokens: 1000,
          reserved_output_tokens: 1,
          input_limit_tokens: 999,
          input_tokens: 10,
          message_tokens: 8,
          tool_tokens: 0,
          parameter_tokens: 2,
          overflow_policy: 'reject',
          omitted_source_refs: [],
        },
      },
    };
    const contentEvent = {
      schema_version: 1,
      event_id: eventId(`${spec.session_id}:${label}:content`),
      session_id: spec.session_id,
      sequence: ++sequence,
      occurred_at: `2026-08-22T02:10:0${sequence}Z`,
      event_type: 'model.streamed',
      payload: {
        turn_id: turnId,
        provider_id: spec.execution.model_provider_id,
        event: {
          schema_version: 1,
          provider_id: spec.execution.model_provider_id,
          request_id: requestId,
          event_type: 'content.delta',
          sequence: 0,
          payload: { text: answer },
        },
      },
    };
    const completedEvent = {
      schema_version: 1,
      event_id: eventId(`${spec.session_id}:${label}:completed`),
      session_id: spec.session_id,
      sequence: ++sequence,
      occurred_at: `2026-08-22T02:10:0${sequence}Z`,
      event_type: 'model.streamed',
      payload: {
        turn_id: turnId,
        provider_id: spec.execution.model_provider_id,
        event: {
          schema_version: 1,
          provider_id: spec.execution.model_provider_id,
          request_id: requestId,
          event_type: 'completed',
          sequence: 1,
          payload: { finish_reason: 'stop', provider_response_ref: `provider-response://${label}` },
        },
      },
    };
    events.push(turnEvent, contextEvent, contentEvent, completedEvent);
  }
  const currentTurn = { role: 'user', content: 'implement the selected change' };
  const currentEventId = eventId(`${spec.session_id}:current:turn`);
  events.push({
    schema_version: 1,
    event_id: currentEventId,
    session_id: spec.session_id,
    sequence: ++sequence,
    occurred_at: '2026-08-22T02:10:10Z',
    event_type: 'turn.started',
    payload: { turn_id: 'turn:context-1', input: currentTurn },
  });
  store.append({ session_id: spec.session_id, expected_version: 0, events });
  return { turn: currentTurn, currentEventId, expectedVersion: sequence };
}

function source(sourceRef, content, classification = 'internal') {
  return { source_ref: sourceRef, classification, content };
}

function assemblyInput(spec, turnMessage, overrides = {}) {
  const turnId = overrides.turn_id || 'turn:context-1';
  return {
    schema_version: 1,
    request_id: `request:${spec.session_id.split(':').at(-1)}`,
    turn_id: turnId,
    event_id: eventId(`${spec.session_id}:context`),
    occurred_at: '2026-08-22T02:10:02Z',
    expected_version: 2,
    session: spec,
    instructions: {
      constitution: [
        source('governance://constitution/z', 'constitutional rule Z'),
        source('governance://constitution/a', 'constitutional rule A'),
      ],
      project: [source('project://instructions', 'project rule')],
      adapter: [source('adapter://portable', 'adapter rule')],
      agent: [source('agent://authority', 'agent rule')],
      skill: [source('skill://selected/b', 'skill rule B'), source('skill://selected/a', 'skill rule A')],
    },
    runtime_context: [source('runtime://environment', 'runtime fact')],
    references: [source('source://reference-b', 'reference B'), source('source://reference-a', 'reference A')],
    memory: [],
    current_turn: { source_ref: 'session-event://event:context-turn', message: turnMessage },
    tools: structuredClone(fixtures.modelRequest.tools),
    parameters: { max_output_tokens: 512, temperature: null, stop: [] },
    overflow_policy: 'reject',
    ...overrides,
  };
}

test('assembles canonical precedence and records every visible source before returning', () => {
  const { db, store } = openStore();
  try {
    const spec = session('session:context-precedence');
    const turnMessage = prepareSession(store, spec);
    const result = assembler(store).assembleAndRecord(assemblyInput(spec, turnMessage));
    const contents = result.request.messages.map((message) => message.content);

    assert.match(contents[0], /constitution > project > adapter > agent > skill/);
    assert.match(contents[1], /constitution\/a/);
    assert.match(contents[2], /constitution\/z/);
    assert.match(contents[3], /project rule/);
    assert.match(contents[4], /adapter rule/);
    assert.match(contents[5], /agent rule/);
    assert.match(contents[6], /selected\/a/);
    assert.match(contents[7], /selected\/b/);
    assert.match(contents[8], /RUNTIME_DATA/);
    assert.match(contents[9], /reference-a/);
    assert.match(contents[10], /reference-b/);
    assert.deepEqual(result.request.messages.at(-1), turnMessage);
    assert.equal(result.event.event_type, 'context.assembled');
    assert.equal(result.current_version, 3);
    assert.equal(result.reconstructed.canonical_json, canonicalJson(result.request));
    assert.deepEqual(result.reconstructed.budget, result.budget);
    assert.equal(Object.isFrozen(result.request), true);
    assert.deepEqual(store.reconstructRequest(spec.session_id).source_refs, result.source_refs);
  } finally {
    db.close();
  }
});

test('source order and tool order cannot change deterministic assembled messages', () => {
  const first = openStore();
  const second = openStore();
  try {
    const firstSpec = session('session:context-order-a');
    const secondSpec = session('session:context-order-b');
    const firstTurn = prepareSession(first.store, firstSpec);
    const secondTurn = prepareSession(second.store, secondSpec);
    const firstInput = assemblyInput(firstSpec, firstTurn);
    const secondInput = assemblyInput(secondSpec, secondTurn);
    secondInput.instructions.constitution.reverse();
    secondInput.instructions.skill.reverse();
    secondInput.references.reverse();
    secondInput.tools.reverse();
    const firstResult = assembler(first.store).assembleAndRecord(firstInput);
    const secondResult = assembler(second.store).assembleAndRecord(secondInput);
    assert.deepEqual(firstResult.request.messages, secondResult.request.messages);
    assert.deepEqual(firstResult.request.tools, secondResult.request.tools);
    assert.deepEqual(firstResult.budget, secondResult.budget);
  } finally {
    first.db.close();
    second.db.close();
  }
});

test('truncate_optional keeps recent history first and durably records whole omitted sources', () => {
  const baseline = openStore();
  const bounded = openStore();
  try {
    const baselineSpec = session('session:context-budget-base');
    const baselineTurn = prepareSession(baseline.store, baselineSpec);
    const baselineResult = assembler(baseline.store).assembleAndRecord(
      assemblyInput(baselineSpec, baselineTurn),
    );

    const boundedSpec = session('session:context-budget-bounded');
    const history = prepareSessionWithHistory(bounded.store, boundedSpec);
    const maxOutput = 512;
    const contextLimit = baselineResult.budget.input_tokens + maxOutput + 800;
    const input = assemblyInput(boundedSpec, history.turn, {
      expected_version: history.expectedVersion,
      current_turn: { source_ref: `session-event://${history.currentEventId}`, message: history.turn },
      overflow_policy: 'truncate_optional',
      memory: [source('memory://high', 'important memory'), { ...source('memory://low', 'y'.repeat(5000)), priority: 0 }].map(
        (entry, index) => ({ ...entry, priority: entry.priority ?? 100 - index }),
      ),
    });
    const result = assembler(bounded.store, { manifest: providerManifest(contextLimit) }).assembleAndRecord(input);
    assert.deepEqual(result.budget.omitted_source_refs, [
      'memory://low',
      `session-event://${eventId(`${boundedSpec.session_id}:old:completed`)}`,
      `session-event://${eventId(`${boundedSpec.session_id}:old:turn`)}`,
    ].sort());
    assert.equal(result.request.messages.some((message) => message.content === 'recent answer'), true);
    assert.equal(result.request.messages.some((message) => message.content === 'recent question'), true);
    assert.equal(result.request.messages.some((message) => message.content.includes('x'.repeat(100))), false);
    assert.equal(
      result.request.messages.some((message) => message.content.includes('important memory')),
      true,
    );
    assert.deepEqual(storeBudget(bounded.store, boundedSpec.session_id), result.budget);
  } finally {
    baseline.db.close();
    bounded.db.close();
  }
});

test('session budget reserves output when a provider emits no usage telemetry', () => {
  const { db, store } = openStore();
  try {
    const spec = session('session:context-no-usage');
    spec.limits = { ...spec.limits, max_tokens: 4000 };
    const history = prepareSessionWithHistory(store, spec);
    const manifest = providerManifest();
    manifest.capabilities = manifest.capabilities.filter((capability) => capability !== 'usage');
    const input = assemblyInput(spec, history.turn, {
      expected_version: history.expectedVersion,
      current_turn: { source_ref: `session-event://${history.currentEventId}`, message: history.turn },
      overflow_policy: 'truncate_optional',
    });
    const result = assembler(store, { manifest }).assembleAndRecord(input);
    assert.equal(result.budget.context_limit_tokens, 3978, 'two prior input/output reservations consume 22 tokens');
  } finally {
    db.close();
  }
});

function storeBudget(store, sessionId) {
  return store.readSession(sessionId).findLast((event) => event.event_type === 'context.assembled').payload.budget;
}

test('required or reject-policy overflow fails before any context event is appended', () => {
  for (const overflowPolicy of ['reject', 'truncate_optional']) {
    const { db, store } = openStore();
    try {
      const spec = session(`session:context-overflow-${overflowPolicy}`);
      const turn = prepareSession(store, spec);
      const input = assemblyInput(spec, turn, {
        overflow_policy: overflowPolicy,
        references: [source('source://required-large', 'r'.repeat(5000))],
        memory: [{ ...source('memory://optional-large', 'm'.repeat(5000)), priority: 100 }],
      });
      assert.throws(
        () => assembler(store, { manifest: providerManifest(700) }).assembleAndRecord(input),
        (error) => error instanceof ContextBudgetError && error.code === 'AGENT_CONTEXT_BUDGET_EXCEEDED',
      );
      assert.equal(store.readSession(spec.session_id).length, 2);
    } finally {
      db.close();
    }
  }
});

test('durable turn identity, source identity and provider ownership fail closed', () => {
  const { db, store } = openStore();
  try {
    const spec = session('session:context-correlation');
    const turn = prepareSession(store, spec);
    const contextAssembler = assembler(store);
    assert.throws(
      () => contextAssembler.assembleAndRecord(assemblyInput(spec, { ...turn, content: 'different input' })),
      (error) => error instanceof ContextAssemblyError && error.code === 'AGENT_CONTEXT_TURN_MISMATCH',
    );
    assert.throws(
      () =>
        contextAssembler.assembleAndRecord(assemblyInput(spec, turn, { current_turn: { source_ref: 'session-event://wrong', message: turn } })),
      (error) => error instanceof ContextAssemblyError && error.code === 'AGENT_CONTEXT_SOURCE_MISMATCH',
    );
    assert.equal(store.readSession(spec.session_id).length, 2);
  } finally {
    db.close();
  }
});

test('duplicate lineage, secret classification and nondeterministic token counters append nothing', () => {
  const { db, store } = openStore();
  try {
    const spec = session('session:context-invalid');
    const turn = prepareSession(store, spec);
    const duplicate = assemblyInput(spec, turn);
    duplicate.references[0].source_ref = duplicate.instructions.project[0].source_ref;
    assert.throws(
      () => assembler(store).assembleAndRecord(duplicate),
      (error) =>
        error instanceof AgentContractError && error.details.issues.some((issue) => issue.message.includes('duplicate source references')),
    );

    const classified = assemblyInput(spec, turn);
    classified.references[0].classification = 'secret';
    assert.throws(() => assembler(store).assembleAndRecord(classified), /does not match schema/);

    const secretSchema = assemblyInput(spec, turn);
    secretSchema.tools[0].input_schema = {
      type: 'object',
      properties: { authorization: { type: 'string' } },
      additionalProperties: false,
    };
    assert.throws(
      () => assembler(store).assembleAndRecord(secretSchema),
      (error) =>
        error instanceof AgentContractError && error.details.issues.some((issue) => issue.message.includes('credential-bearing field')),
    );

    let value = 0;
    const counter = { counter_id: 'token-counter:unstable', count: () => value++ };
    assert.throws(
      () => assembler(store, { counter }).assembleAndRecord(assemblyInput(spec, turn)),
      (error) => error instanceof TokenCounterError,
    );

    let pairedValue = 0;
    const pairedCounter = { counter_id: 'token-counter:paired-unstable', count: () => Math.floor(pairedValue++ / 2) + 1 };
    assert.throws(
      () => assembler(store, { counter: pairedCounter }).assembleAndRecord(assemblyInput(spec, turn)),
      (error) => error.code === 'AGENT_CONTEXT_COUNTER_NONDETERMINISTIC',
    );

    const oversizedStop = assemblyInput(spec, turn);
    oversizedStop.parameters.stop = ['s'.repeat(2_000_000)];
    assert.throws(() => assembler(store).assembleAndRecord(oversizedStop), /does not match schema/);

    const inflatedManifest = assemblyInput(spec, turn);
    inflatedManifest.provider_manifest = providerManifest(1_000_000);
    assert.throws(() => assembler(store).assembleAndRecord(inflatedManifest), /does not match schema/);

    const oversizedOutput = assemblyInput(spec, turn);
    oversizedOutput.parameters.max_output_tokens = 9000;
    assert.throws(
      () => assembler(store).assembleAndRecord(oversizedOutput),
      (error) => error instanceof ContextBudgetError,
    );
    assert.equal(store.readSession(spec.session_id).length, 2);
  } finally {
    db.close();
  }
});

test('requires nominal durable stores and registry-created provider snapshots', () => {
  const fakeStore = { append() {}, replay() {}, reconstructRequest() {} };
  assert.throws(
    () => new ContextAssembler({ session_store: fakeStore, model_provider_snapshot: providerSnapshot() }),
    /verified RelationalSessionEventStore/,
  );
  assert.throws(() => new ModelProviderRegistrySnapshot(new Map()), /created only from a provider map/);
});

test('exact retries are idempotent and conservative counter uses canonical UTF-8 bytes', () => {
  const { db, store } = openStore();
  try {
    const counter = new ConservativeUtf8TokenCounter();
    assert.equal(counter.count('á'), Buffer.byteLength('á', 'utf8'));
    const spec = session('session:context-idempotent');
    const turn = prepareSession(store, spec);
    const input = assemblyInput(spec, turn);
    const contextAssembler = assembler(store, { counter });
    const first = contextAssembler.assembleAndRecord(input);
    const retry = contextAssembler.assembleAndRecord(input);
    assert.equal(first.idempotent, false);
    assert.equal(retry.idempotent, true);
    assert.equal(store.readSession(spec.session_id).length, 3);
    assert.equal(retry.reconstructed.canonical_json, first.reconstructed.canonical_json);
  } finally {
    db.close();
  }
});
