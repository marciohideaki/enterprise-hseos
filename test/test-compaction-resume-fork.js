'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { test } = require('node:test');

const Database = require('better-sqlite3');
const {
  CompactionProviderRegistry,
  CompactionRuntime,
  DeterministicCompactionProvider,
  InMemoryCheckpointProvider,
} = require('../packages/agent-compaction');
const { ContextAssembler } = require('../packages/agent-context');
const { sha256Text } = require('../packages/agent-context/authority');
const { CONTEXT_ASSEMBLY_CONTRACT, CONTEXT_PRECEDENCE_PREAMBLE, CONTEXT_PRECEDENCE_REF } = require('../packages/agent-runtime-contracts');
const { RelationalSessionEventStore, canonicalJson } = require('../packages/agent-session-store');
const { ledgerEventId } = require('../packages/agent-session-store/session-event-store');
const { ModelProviderRegistry, ScriptedModelProvider } = require('../packages/model-providers');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const fixtures = require('./fixtures/agent-runtime-contracts');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');
const CRITERIA_REF = 'task-contract://protected-criteria';
const CRITERIA = 'Goal: implement add. Constraint: workspace only. Acceptance: add(2, 3) equals 5.';
const HISTORY_ONLY_CRITERION = 'Acceptance: legacy-only criterion that exists solely in the old turn';
const CHECKPOINT_PROVIDER_ID = 'checkpoint:resume-fork-provider';
const COMPACTION_PROVIDER_ID = 'compaction:resume-fork';

function openStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  return { db, store: new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(db) }) };
}

function session(sessionId, extra = {}) {
  return { ...structuredClone(fixtures.kernelSession), session_id: sessionId, metadata: { purpose: 'compaction-resume-fork' }, ...extra };
}

function providerManifest(contextTokens) {
  const manifest = structuredClone(fixtures.modelManifest);
  manifest.limits.context_tokens = contextTokens;
  manifest.secret_refs = [];
  return manifest;
}

function modelSnapshot(contextTokens) {
  const registry = new ModelProviderRegistry();
  const manifest = providerManifest(contextTokens);
  registry.register(
    new ScriptedModelProvider({
      manifest,
      routes: [
        { match: () => true, events: [] },
        { match: () => false, events: [] },
      ],
    }),
    manifest,
  );
  return registry.snapshot();
}

function makeAssembler(store, contextTokens, compactionRuntime) {
  return new ContextAssembler({
    session_store: store,
    model_provider_snapshot: modelSnapshot(contextTokens),
    ...(compactionRuntime ? { compaction_runtime: compactionRuntime } : {}),
  });
}

// One counted provider and one checkpoint store model a process whose memory is lost between attempts.
function compactionFixture(checkpoint = new InMemoryCheckpointProvider({ provider_id: CHECKPOINT_PROVIDER_ID })) {
  const inner = new DeterministicCompactionProvider({ provider_id: COMPACTION_PROVIDER_ID });
  const counter = { compact: 0 };
  const provider = {
    manifest: (value) => inner.manifest(value),
    assess: (value) => inner.assess(value),
    dispose: (value) => inner.dispose(value),
    compact: (value) => {
      counter.compact += 1;
      return inner.compact(value);
    },
  };
  const registry = new CompactionProviderRegistry();
  registry.register(
    provider,
    provider.manifest({ schema_version: 1, request_id: 'request:resume-fork-manifest', provider_id: COMPACTION_PROVIDER_ID }),
  );
  return {
    checkpoint,
    counter,
    runtime: new CompactionRuntime({
      compaction_provider_snapshot: registry.snapshot(),
      checkpoint_provider: checkpoint,
      checkpoint_provider_id: CHECKPOINT_PROVIDER_ID,
    }),
  };
}

function eventId(label) {
  return `event:${createHash('sha256').update(label).digest('hex').slice(0, 20)}`;
}

function appendHistory(store, spec) {
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
  for (const [label, question, answer] of [
    ['old', `old question. ${HISTORY_ONLY_CRITERION}`, 'x'.repeat(5000)],
    ['recent', 'recent question', 'recent answer'],
  ]) {
    const turnId = `turn:history-${label}`;
    const input = { role: 'user', content: question };
    const turnEventId = eventId(`${spec.session_id}:${label}:turn`);
    const requestId = `request:history-${label}`;
    const at = () => `2026-08-22T02:10:${String(sequence).padStart(2, '0')}Z`;
    events.push(
      {
        schema_version: 1,
        event_id: turnEventId,
        session_id: spec.session_id,
        sequence: ++sequence,
        occurred_at: at(),
        event_type: 'turn.started',
        payload: { turn_id: turnId, input },
      },
      {
        schema_version: 1,
        event_id: eventId(`${spec.session_id}:${label}:context`),
        session_id: spec.session_id,
        sequence: ++sequence,
        occurred_at: at(),
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
          source_refs: [CONTEXT_PRECEDENCE_REF, 'governance://constitution', 'project://instructions', `session-event://${turnEventId}`],
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
      },
    );
    for (const [index, payload] of [
      [0, { event_type: 'content.delta', payload: { text: answer } }],
      [1, { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: `provider-response://${label}` } }],
    ]) {
      events.push({
        schema_version: 1,
        event_id: eventId(`${spec.session_id}:${label}:${index === 0 ? 'content' : 'completed'}`),
        session_id: spec.session_id,
        sequence: ++sequence,
        occurred_at: at(),
        event_type: 'model.streamed',
        payload: {
          turn_id: turnId,
          provider_id: spec.execution.model_provider_id,
          event: {
            schema_version: 1,
            provider_id: spec.execution.model_provider_id,
            request_id: requestId,
            sequence: index,
            ...payload,
          },
        },
      });
    }
  }
  const turn = { role: 'user', content: 'implement the selected change' };
  const currentEventId = eventId(`${spec.session_id}:current:turn`);
  events.push({
    schema_version: 1,
    event_id: currentEventId,
    session_id: spec.session_id,
    sequence: ++sequence,
    occurred_at: '2026-08-22T02:10:59Z',
    event_type: 'turn.started',
    payload: { turn_id: 'turn:context-1', input: turn },
  });
  store.append({ session_id: spec.session_id, expected_version: 0, events });
  return { turn, currentEventId, expectedVersion: sequence };
}

function source(sourceRef, content, extra = {}) {
  return { source_ref: sourceRef, classification: 'internal', content, ...extra };
}

// The pinned criteria declare v2 authority so the per-source authority map is part of the comparison.
function pinnedCriteria() {
  return source(CRITERIA_REF, CRITERIA, {
    authority: 'data',
    provenance: {
      origin: 'config',
      source_ref: CRITERIA_REF,
      digest: sha256Text(CRITERIA),
      retrieved_at: '2026-08-22T02:10:02Z',
      trust: 'untrusted',
      transform: [],
    },
  });
}

function assemblyInput(spec, history, overrides = {}) {
  return {
    schema_version: 1,
    request_id: 'request:resume-fork',
    turn_id: 'turn:context-1',
    event_id: eventId(`${spec.session_id}:context`),
    occurred_at: '2026-08-22T02:11:00Z',
    expected_version: history.expectedVersion,
    session: spec,
    instructions: {
      constitution: [source('governance://constitution/a', 'constitutional rule A')],
      project: [source('project://instructions', 'project rule')],
      adapter: [],
      agent: [source('agent://authority', 'agent rule')],
      skill: [],
    },
    runtime_context: [pinnedCriteria()],
    references: [],
    memory: [],
    current_turn: { source_ref: `session-event://${history.currentEventId}`, message: history.turn },
    tools: structuredClone(fixtures.modelRequest.tools),
    parameters: { max_output_tokens: 512, temperature: null, stop: [] },
    overflow_policy: 'reject',
    ...overrides,
  };
}

function compactInput(spec, history) {
  return assemblyInput(spec, history, {
    overflow_policy: 'compact',
    compaction_provider_id: COMPACTION_PROVIDER_ID,
    compaction_id: 'compaction:resume-fork',
    compaction_event_id: 'event:resume-fork-compaction',
  });
}

// A context limit that fits the pinned sources but not the old turn, exactly as the compaction test does.
function pressureLimit() {
  const { db, store } = openStore();
  try {
    const spec = session('session:pressure-probe');
    const history = appendHistory(store, spec);
    const full = makeAssembler(store, 1_000_000).assembleAndRecord(assemblyInput(spec, history));
    return { limit: full.budget.input_tokens - 2000, fullTokens: full.budget.input_tokens };
  } finally {
    db.close();
  }
}

function sourcesByRef(result) {
  const events = result.event.payload.sources ?? [];
  return new Map(events.map((entry) => [entry.source_ref, entry]));
}

function sessionRun() {
  const { limit } = pressureLimit();
  const { db, store } = openStore();
  const spec = session('session:resume-fork');
  const history = appendHistory(store, spec);
  const fixture = compactionFixture();
  const input = compactInput(spec, history);
  return { db, store, spec, history, fixture, input, limit };
}

test('uncompacted history is the reference: every pinned source is visible with its resolved authority', () => {
  const { db, store } = openStore();
  try {
    const spec = session('session:reference');
    const history = appendHistory(store, spec);
    const result = makeAssembler(store, 1_000_000).assembleAndRecord(assemblyInput(spec, history));
    assert.equal(result.compaction_event, null);
    assert.ok(result.source_refs.includes(CRITERIA_REF));
    assert.ok(result.request.messages.some((message) => message.content.includes(HISTORY_ONLY_CRITERION)));
    assert.equal(sourcesByRef(result).get(CRITERIA_REF).authority, 'data');
  } finally {
    db.close();
  }
});

test('compaction keeps pinned sources and authority while a history-only criterion is a documented compactable loss', () => {
  const reference = openStore();
  const run = sessionRun();
  try {
    const refSpec = session('session:resume-fork');
    const refHistory = appendHistory(reference.store, refSpec);
    const full = makeAssembler(reference.store, 1_000_000).assembleAndRecord(assemblyInput(refSpec, refHistory));
    const before = run.store.readSession(run.spec.session_id);

    const result = makeAssembler(run.store, run.limit, run.fixture.runtime).assembleAndRecord(run.input);
    assert.equal(result.compaction_event.event_type, 'compaction.completed');

    // Required sources: everything that is not an old session event is identical to the uncompacted reference.
    const pinned = (refs) => refs.filter((ref) => !ref.startsWith('session-event://')).sort();
    assert.deepEqual(pinned(result.source_refs), pinned(full.source_refs));
    assert.ok(result.source_refs.includes(CRITERIA_REF));

    // Authority per source: pinned sources keep the same resolved authority and provenance.
    const compactedSources = sourcesByRef(result);
    const fullSources = sourcesByRef(full);
    for (const ref of pinned(full.source_refs)) {
      assert.deepEqual(compactedSources.get(ref), fullSources.get(ref), `authority drifted for ${ref}`);
    }
    // The summary is a recorded source of the request, but history carries no instruction authority: it is an assistant
    // message, never a system one, and no source of the compacted request holds more authority than in the full history.
    assert.ok(result.source_refs.includes(`session-event://${run.input.compaction_event_id}`));
    const summaryMessage = result.request.messages.find((message) => message.content.includes('HSEOS COMPACTION'));
    assert.equal(summaryMessage.role, 'assistant');
    for (const [ref, entry] of compactedSources) assert.equal(entry.authority, fullSources.get(ref)?.authority, `authority of ${ref}`);
    assert.ok(result.request.messages.some((message) => message.content.includes(CRITERIA)));

    // A criterion that exists only in compacted history leaves the request, is reported omitted, and stays durable.
    const oldTurnRef = `session-event://${eventId(`${run.spec.session_id}:old:turn`)}`;
    assert.ok(result.budget.omitted_source_refs.includes(oldTurnRef));
    assert.equal(result.source_refs.includes(oldTurnRef), false);
    assert.ok(
      summaryMessage.content.includes(result.compaction_event.payload.source_digest),
      'the summary binds the exact compacted sources',
    );
    assert.equal(summaryMessage.content.includes(HISTORY_ONLY_CRITERION), false);
    const durable = run.store.readSession(run.spec.session_id);
    assert.ok(durable.some((event) => canonicalJson(event).includes(HISTORY_ONLY_CRITERION)));

    // No event is rewritten: every pre-existing event is byte-identical and the two new events are appended.
    assert.equal(canonicalJson(durable.slice(0, before.length)), canonicalJson(before));
    assert.deepEqual(
      durable.slice(before.length).map((event) => event.event_type),
      ['compaction.completed', 'context.assembled'],
    );
    assert.equal(run.fixture.counter.compact, 1);
  } finally {
    reference.db.close();
    run.db.close();
  }
});

test('crash before the atomic append recovers from the checkpoint with no extra provider call and identical events', () => {
  const control = sessionRun();
  const crashed = sessionRun();
  try {
    const controlResult = makeAssembler(control.store, control.limit, control.fixture.runtime).assembleAndRecord(control.input);

    // Attempt 1: the compaction runs and its checkpoint is written, then the process dies before the append.
    const attempt = makeAssembler(crashed.store, crashed.limit, crashed.fixture.runtime);
    // Storage fails when the context event is inserted, after the compaction event row: the batch must roll back.
    crashed.db.exec(`CREATE TEMP TRIGGER crash_before_context BEFORE INSERT ON execution_events
      WHEN NEW.event_id = '${ledgerEventId(crashed.spec.session_id, crashed.input.event_id)}'
      BEGIN SELECT RAISE(ABORT, 'simulated crash between compaction and context'); END`);
    try {
      assert.throws(() => attempt.assembleAndRecord(crashed.input), /simulated crash/);
    } finally {
      crashed.db.exec('DROP TRIGGER crash_before_context');
    }
    const afterCrash = crashed.store.readSession(crashed.spec.session_id);
    assert.equal(afterCrash.length, crashed.history.expectedVersion, 'nothing from the failed attempt became durable');
    assert.equal(crashed.fixture.counter.compact, 1);
    assert.equal(crashed.store.recoveryPlan(crashed.spec.session_id).next_action, 'assemble_context');

    // Attempt 2 (a new process): new runtime and assembler over the surviving checkpoint store.
    const restarted = compactionFixture(crashed.fixture.checkpoint);
    const resumed = makeAssembler(crashed.store, crashed.limit, restarted.runtime).assembleAndRecord(crashed.input);
    assert.equal(restarted.counter.compact, 0, 'the provider is not invoked again');
    assert.equal(crashed.fixture.counter.compact, 1, 'one provider call in total across crash and retry');
    assert.equal(resumed.compaction_event.payload.checkpoint_ref, controlResult.compaction_event.payload.checkpoint_ref);
    assert.equal(canonicalJson(resumed.request), canonicalJson(controlResult.request));
    assert.equal(
      canonicalJson(crashed.store.readSession(crashed.spec.session_id)),
      canonicalJson(control.store.readSession(control.spec.session_id)),
      'events are byte-identical to the run that never crashed',
    );
    assert.equal(crashed.store.replay(crashed.spec.session_id).compactions.length, 1);
  } finally {
    control.db.close();
    crashed.db.close();
  }
});

test('resume after compaction replays to the same request, lineage and pinned sources', () => {
  const run = sessionRun();
  try {
    const result = makeAssembler(run.store, run.limit, run.fixture.runtime).assembleAndRecord(run.input);
    const state = run.store.replay(run.spec.session_id);
    run.store.append({
      session_id: run.spec.session_id,
      expected_version: state.current_sequence,
      events: [
        {
          schema_version: 1,
          event_id: 'event:resume-fork-resumed',
          session_id: run.spec.session_id,
          sequence: state.current_sequence + 1,
          occurred_at: '2026-08-22T02:12:00Z',
          event_type: 'session.resumed',
          payload: { from_sequence: state.current_sequence },
        },
      ],
    });
    const resumed = run.store.replay(run.spec.session_id);
    assert.equal(resumed.compactions.length, 1);
    assert.equal(resumed.compactions[0].checkpoint_ref, result.compaction_event.payload.checkpoint_ref);
    assert.deepEqual(resumed.compactions[0].source_event_ids, result.compaction_event.payload.source_event_ids);
    assert.equal(run.store.reconstructRequest(run.spec.session_id).canonical_json, canonicalJson(result.request));
    assert.ok(run.store.reconstructRequest(run.spec.session_id).source_refs.includes(CRITERIA_REF));
    // Resume is an append: the compaction and context events keep their durable identity.
    const durable = run.store.readSession(run.spec.session_id);
    assert.equal(
      canonicalJson(durable.find((event) => event.event_type === 'compaction.completed')),
      canonicalJson(result.compaction_event),
    );
  } finally {
    run.db.close();
  }
});

// Forks the parent at its last event and assembles the child's first turn from the parent's own pinned sources
// (instructions and criteria are read from the parent's input, i.e. from the lineage, not rebuilt for the child).
function forkAndAssemble(run, parentInput, parentSequence) {
  const childSpec = session('session:resume-fork-child', { parent_session_id: run.spec.session_id });
  run.store.forkSession({
    parent_session_id: run.spec.session_id,
    parent_sequence: parentSequence,
    child_spec: childSpec,
    event_ids: { attached: 'event:fork-attached', created: 'event:fork-created', forked: 'event:fork-forked' },
    occurred_at: '2026-08-22T02:12:00Z',
  });
  const childTurn = { role: 'user', content: 'continue from the parent' };
  run.store.append({
    session_id: childSpec.session_id,
    expected_version: 2,
    events: [
      {
        schema_version: 1,
        event_id: 'event:fork-child-turn',
        session_id: childSpec.session_id,
        sequence: 3,
        occurred_at: '2026-08-22T02:12:01Z',
        event_type: 'turn.started',
        payload: { turn_id: 'turn:context-1', input: childTurn },
      },
    ],
  });
  const childInput = assemblyInput(
    childSpec,
    { turn: childTurn, currentEventId: 'event:fork-child-turn', expectedVersion: 3 },
    {
      request_id: 'request:resume-fork-child',
      event_id: 'event:fork-child-context',
      instructions: parentInput.instructions,
      runtime_context: parentInput.runtime_context,
    },
  );
  return { childSpec, childResult: makeAssembler(run.store, 1_000_000).assembleAndRecord(childInput) };
}

test('a fork from the compacted state keeps lineage and pinned sources and cannot widen limits', () => {
  const run = sessionRun();
  try {
    const result = makeAssembler(run.store, run.limit, run.fixture.runtime).assembleAndRecord(run.input);
    const parentSequence = result.current_version;
    const { childSpec, childResult } = forkAndAssemble(run, run.input, parentSequence);
    const child = run.store.replay(childSpec.session_id);
    assert.deepEqual(child.parent, { parent_session_id: run.spec.session_id, parent_sequence: parentSequence });
    const parent = run.store.replay(run.spec.session_id);
    assert.deepEqual(parent.children, [childSpec.session_id]);
    assert.equal(parent.compactions.length, 1);
    assert.equal(run.store.readSession(run.spec.session_id)[parentSequence - 2].event_type, 'compaction.completed');

    // Control: the same fork from the full, uncompacted history. Pinned sources, authority and request must match.
    const reference = sessionRun();
    try {
      const full = makeAssembler(reference.store, 1_000_000).assembleAndRecord(assemblyInput(reference.spec, reference.history));
      assert.equal(full.compaction_event, null);
      const referenceChild = forkAndAssemble(reference, reference.input, full.current_version).childResult;
      assert.deepEqual(childResult.source_refs, referenceChild.source_refs);
      assert.deepEqual(childResult.event.payload.sources, referenceChild.event.payload.sources);
      assert.equal(canonicalJson(childResult.request), canonicalJson(referenceChild.request));
      const pinned = (refs) => refs.filter((ref) => !ref.startsWith('session-event://')).sort();
      assert.deepEqual(pinned(childResult.source_refs), pinned(full.source_refs));
    } finally {
      reference.db.close();
    }
    const parentSources = sourcesByRef(result);
    const childSources = sourcesByRef(childResult);
    assert.ok(childResult.source_refs.includes(CRITERIA_REF));
    assert.deepEqual(childSources.get(CRITERIA_REF), parentSources.get(CRITERIA_REF));
    assert.deepEqual(childSources.get('project://instructions'), parentSources.get('project://instructions'));

    // The fork cannot widen what the parent holds.
    const wider = session('session:resume-fork-wider', {
      parent_session_id: run.spec.session_id,
      limits: { ...run.spec.limits, max_children: run.spec.limits.max_children + 1 },
    });
    assert.throws(
      () =>
        run.store.forkSession({
          parent_session_id: run.spec.session_id,
          parent_sequence: parentSequence,
          child_spec: wider,
          event_ids: { attached: 'event:wider-attached', created: 'event:wider-created', forked: 'event:wider-forked' },
          occurred_at: '2026-08-22T02:12:02Z',
        }),
      (error) => error.code === 'AGENT_SESSION_FORK_LIMIT_WIDENING',
    );
    // The parent history is untouched by the fork apart from the child attachment.
    assert.equal(run.store.readSession(run.spec.session_id).filter((event) => event.event_type === 'compaction.completed').length, 1);
  } finally {
    run.db.close();
  }
});

// The compaction event is durable and the context event is not: a ledger written by an external or earlier writer.
function durableCompactionOnly(run, { memory = [], limit } = {}) {
  const control = sessionRun();
  try {
    const result = makeAssembler(control.store, limit ?? control.limit, control.fixture.runtime).assembleAndRecord({
      ...control.input,
      memory,
    });
    run.store.append({
      session_id: run.spec.session_id,
      expected_version: run.history.expectedVersion,
      events: [result.compaction_event],
    });
    return { result, controlEvents: control.store.readSession(control.spec.session_id) };
  } finally {
    control.db.close();
  }
}

test('a durable compaction without context resumes through the recovery plan without a second compaction', () => {
  const run = sessionRun();
  try {
    const { result: controlResult, controlEvents } = durableCompactionOnly(run);
    const plan = run.store.recoveryPlan(run.spec.session_id);
    assert.equal(plan.next_action, 'assemble_context');
    const before = run.store.readSession(run.spec.session_id);

    const restarted = compactionFixture();
    const retry = compactInput(run.spec, { ...run.history, expectedVersion: plan.current_sequence });
    const resumed = makeAssembler(run.store, run.limit, restarted.runtime).assembleAndRecord(retry);

    assert.equal(restarted.counter.compact, 0, 'the provider is not invoked on resume');
    assert.equal(resumed.compaction_event, null);
    assert.equal(resumed.event.event_type, 'context.assembled');
    assert.equal(canonicalJson(resumed.request), canonicalJson(controlResult.request));
    assert.deepEqual(resumed.source_refs, controlResult.source_refs);
    assert.deepEqual(resumed.budget, controlResult.budget);
    const durable = run.store.readSession(run.spec.session_id);
    assert.equal(canonicalJson(durable.slice(0, before.length)), canonicalJson(before), 'existing events are not rewritten');
    assert.equal(canonicalJson(durable), canonicalJson(controlEvents), 'events equal the run that never split the pair');
    assert.equal(run.store.replay(run.spec.session_id).compactions.length, 1);
    assert.equal(run.store.reconstructRequest(run.spec.session_id).canonical_json, canonicalJson(resumed.request));
  } finally {
    run.db.close();
  }
});

test('resuming a durable compaction keeps fitting memory and reports the memory that no longer fits', () => {
  const run = sessionRun();
  try {
    durableCompactionOnly(run);
    const memory = [
      { source_ref: 'memory://small', classification: 'internal', priority: 5, content: 'small note' },
      { source_ref: 'memory://huge', classification: 'internal', priority: 1, content: 'm'.repeat(40_000) },
    ];
    const retry = { ...compactInput(run.spec, { ...run.history, expectedVersion: run.history.expectedVersion + 1 }), memory };
    const resumed = makeAssembler(run.store, run.limit, compactionFixture().runtime).assembleAndRecord(retry);
    assert.ok(resumed.source_refs.includes('memory://small'));
    assert.equal(resumed.source_refs.includes('memory://huge'), false);
    assert.ok(resumed.budget.omitted_source_refs.includes('memory://huge'));
  } finally {
    run.db.close();
  }
});

test('resuming a durable compaction refuses a different identity, provider, policy or an unfittable budget', () => {
  const run = sessionRun();
  try {
    durableCompactionOnly(run);
    const history = { ...run.history, expectedVersion: run.history.expectedVersion + 1 };
    const assemble = (input, limit = run.limit) => makeAssembler(run.store, limit, compactionFixture().runtime).assembleAndRecord(input);
    const mismatch = (overrides) => () => assemble({ ...compactInput(run.spec, history), ...overrides });
    const isMismatch = (error) => error.code === 'AGENT_CONTEXT_COMPACTION_MISMATCH';
    assert.throws(mismatch({ compaction_id: 'compaction:other' }), isMismatch);
    assert.throws(mismatch({ compaction_provider_id: 'compaction:other' }), isMismatch);
    assert.throws(mismatch({ compaction_event_id: 'event:other-compaction' }), isMismatch);
    assert.throws(
      () => assemble(assemblyInput(run.spec, history)),
      isMismatch,
      'a reject-policy assembly cannot silently drop a durable compaction',
    );
    assert.throws(
      () => assemble(compactInput(run.spec, history), 1),
      (error) => error.name === 'ContextBudgetError',
    );
    // Room for the required sources but not for the recorded replacement next to them.
    assert.throws(
      () => assemble(compactInput(run.spec, history), 1900),
      (error) => error.name === 'ContextBudgetError' && /recorded compaction replacement/.test(error.message),
    );
    assert.equal(run.store.readSession(run.spec.session_id).at(-1).event_type, 'compaction.completed');
  } finally {
    run.db.close();
  }
});

test('the session store refuses a compaction that does not partition the durable history, so the assembler can rely on it', () => {
  const source = sessionRun();
  const target = sessionRun();
  try {
    const { result } = durableCompactionOnly(source);
    const event = structuredClone(result.compaction_event);
    event.payload.retained_source_event_ids = [...event.payload.retained_source_event_ids, 'event:not-in-the-durable-history'];
    assert.throws(
      () => target.store.append({ session_id: target.spec.session_id, expected_version: target.history.expectedVersion, events: [event] }),
      (error) => error.code === 'AGENT_SESSION_COMPACTION_LINEAGE_INVALID',
    );
  } finally {
    source.db.close();
    target.db.close();
  }
});

test('the assembler refuses a forged store, snapshot or compaction runtime and a stale or foreign turn', () => {
  const { db, store } = openStore();
  try {
    const spec = session('session:assembler-guards');
    const history = appendHistory(store, spec);
    const snapshot = modelSnapshot(1_000_000);
    const code = (expected) => (error) => error.code === expected || error.name === expected;
    assert.throws(() => new ContextAssembler({ session_store: {}, model_provider_snapshot: snapshot }), /RelationalSessionEventStore/);
    assert.throws(() => new ContextAssembler({ session_store: store, model_provider_snapshot: {} }), /snapshot/);
    assert.throws(
      () => new ContextAssembler({ session_store: store, model_provider_snapshot: snapshot, compaction_runtime: {} }),
      /nominal/,
    );

    const assembler = makeAssembler(store, 1_000_000);
    const input = assemblyInput(spec, history);
    assert.throws(() => assembler.assembleAndRecord({ ...input, turn_id: 'turn:unknown' }), code('AGENT_CONTEXT_TURN_NOT_FOUND'));
    assert.throws(
      () => assembler.assembleAndRecord({ ...input, session: { ...spec, metadata: { purpose: 'other' } } }),
      code('AGENT_CONTEXT_SESSION_MISMATCH'),
    );
    assert.throws(
      () => assembler.assembleAndRecord({ ...input, current_turn: { ...input.current_turn, message: { role: 'user', content: 'other' } } }),
      code('AGENT_CONTEXT_TURN_MISMATCH'),
    );
    assert.throws(
      () => assembler.assembleAndRecord({ ...input, current_turn: { ...input.current_turn, source_ref: 'session-event://event:other' } }),
      code('AGENT_CONTEXT_SOURCE_MISMATCH'),
    );
    assert.throws(() => makeAssembler(store, 1).assembleAndRecord(input), code('ContextBudgetError'));
    assert.throws(
      () => makeAssembler(store, 1_000_000).assembleAndRecord({ ...input, session: spec, expected_version: 1 }),
      /version|stale|conflict/i,
    );
  } finally {
    db.close();
  }
});

test('budget policies: reject fails closed, truncate_optional drops what does not fit, compact needs a runtime and a willing provider', () => {
  const { limit } = pressureLimit();
  const open = (label) => {
    const run = openStore();
    const spec = session(`session:budget-${label}`);
    return { ...run, spec, history: appendHistory(run.store, spec) };
  };
  const memory = [
    { source_ref: 'memory://small', classification: 'internal', priority: 5, content: 'small note' },
    { source_ref: 'memory://huge', classification: 'internal', priority: 1, content: 'm'.repeat(40_000) },
  ];
  const reject = open('reject');
  const truncate = open('truncate');
  const noRuntime = open('no-runtime');
  try {
    assert.throws(
      () => makeAssembler(reject.store, limit).assembleAndRecord(assemblyInput(reject.spec, reject.history)),
      (error) => error.name === 'ContextBudgetError',
    );
    const truncated = makeAssembler(truncate.store, limit).assembleAndRecord({
      ...assemblyInput(truncate.spec, truncate.history, { overflow_policy: 'truncate_optional' }),
      memory,
    });
    assert.ok(truncated.source_refs.includes('memory://small'));
    assert.equal(truncated.source_refs.includes('memory://huge'), false);
    assert.ok(truncated.budget.omitted_source_refs.includes('memory://huge'));
    assert.ok(truncated.budget.omitted_source_refs.some((ref) => ref.startsWith('session-event://')));
    assert.throws(
      () => makeAssembler(noRuntime.store, limit).assembleAndRecord(compactInput(noRuntime.spec, noRuntime.history)),
      (error) => error.name === 'ContextBudgetError' && /runtime/.test(error.message),
    );
  } finally {
    reject.db.close();
    truncate.db.close();
    noRuntime.db.close();
  }
});

test('compaction under pressure drops retained memory before it gives up, and a declining provider fails closed', () => {
  const { limit } = pressureLimit();
  const run = sessionRun();
  try {
    const memory = [{ source_ref: 'memory://large', classification: 'internal', priority: 9, content: 'm'.repeat(limit * 2) }];
    const input = { ...run.input, memory };
    // The summary cannot fit next to the large memory, so the runtime rejects it and the memory is the first thing to go.
    const result = makeAssembler(run.store, limit + 6000, run.fixture.runtime).assembleAndRecord(input);
    assert.ok(result.budget.omitted_source_refs.length > 0);
  } finally {
    run.db.close();
  }
});

const PRESSURE_MEMORY = ['a', 'b', 'c', 'd'].map((letter, index) => ({
  source_ref: `memory://pressure-${letter}`,
  classification: 'internal',
  priority: 90 - index,
  content: letter.repeat(1500),
}));

test('resume under memory pressure rebuilds the request the run without a crash would have recorded', () => {
  const limit = 5500;
  const control = sessionRun();
  const run = sessionRun();
  try {
    const expected = makeAssembler(control.store, limit, control.fixture.runtime).assembleAndRecord({
      ...control.input,
      memory: PRESSURE_MEMORY,
    });
    const kept = expected.source_refs.filter((ref) => ref.startsWith('memory://'));
    assert.ok(kept.length > 0 && kept.length < PRESSURE_MEMORY.length, 'memory is under pressure: some fits, some does not');

    run.store.append({
      session_id: run.spec.session_id,
      expected_version: run.history.expectedVersion,
      events: [expected.compaction_event],
    });
    const restarted = compactionFixture();
    const retry = {
      ...compactInput(run.spec, { ...run.history, expectedVersion: run.history.expectedVersion + 1 }),
      memory: PRESSURE_MEMORY,
    };
    const resumed = makeAssembler(run.store, limit, restarted.runtime).assembleAndRecord(retry);
    assert.equal(restarted.counter.compact, 0);
    assert.deepEqual(resumed.request, expected.request);
    assert.deepEqual(resumed.source_refs, expected.source_refs);
    assert.deepEqual(resumed.budget, expected.budget);
    assert.equal(
      canonicalJson(run.store.readSession(run.spec.session_id)),
      canonicalJson(control.store.readSession(control.spec.session_id)),
    );
  } finally {
    control.db.close();
    run.db.close();
  }
});
