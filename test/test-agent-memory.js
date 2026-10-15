'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const { MemorySourceSchema, resolveSourceAuthority } = require('../packages/agent-context');
const memory = require('../packages/agent-memory');
const { collectMemorySources, createGovernedMemory } = require('../tools/cli/lib/memory-context-source');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');

const { AgentMemoryError, EVENTS, MemoryStore } = memory;
const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');
const ALLOW = [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }];
const ASK = [{ id: 'memory-ask', source: 'project', stage: 'ask', decision: 'ask' }];
const OPERATOR = { kind: 'operator', id: 'owner' };
const START = Date.parse('2026-10-14T12:00:00.000Z');

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const ledger = new ExecutionEventLedger(db);
  const clock = { ms: START };
  const store = createGovernedMemory({ ledger, now: () => clock.ms });
  return { db, ledger, clock, store };
}

const base = (overrides = {}) => ({
  rules: ALLOW,
  scope: { project_id: 'alpha' },
  memory_id: 'note-1',
  content: 'the deploy pipeline uses blue green rollouts',
  origin: 'operator',
  trust: 'trusted',
  classification: 'internal',
  source_ref: 'doc://runbook/deploy',
  ttl_seconds: 3600,
  ...overrides,
});

const syntheticCredential = () => ['sk', 'proj', 'a'.repeat(30)].join('-');
const codeOf = (code) => (error) => error instanceof AgentMemoryError && error.code === code;

test('a write needs an admitting policy rule; ask passes only with approval and bypass never admits', () => {
  const { store } = setup();
  assert.throws(() => store.write(base({ rules: [] })), codeOf('AGENT_MEMORY_WRITE_DENIED'));
  assert.throws(() => store.write(base({ rules: ASK })), codeOf('AGENT_MEMORY_WRITE_DENIED'));
  assert.throws(
    () => store.write(base({ rules: [{ id: 'no', source: 'project', stage: 'deny', decision: 'deny' }] })),
    codeOf('AGENT_MEMORY_WRITE_DENIED'),
  );
  const written = store.write(base({ rules: ASK, approved: true }));
  assert.equal(written.write_policy_ref, 'rule:memory-ask');
  assert.equal(store.write(base({ memory_id: 'note-2' })).write_policy_ref, 'rule:memory-write');
});

test('authority is fixed to data and escalation is refused', () => {
  const { store } = setup();
  for (const authority of ['directive', 'operator']) {
    assert.throws(() => store.write(base({ authority })), codeOf('AGENT_MEMORY_AUTHORITY_ESCALATION'));
  }
  store.write(base({ authority: 'data' }));
  const [source] = store.retrieve({ project_id: 'alpha', query: 'deploy' });
  assert.equal(source.authority, 'data');
  assert.equal(memory.AUTHORITY, 'data');
});

test('ttl is mandatory, bounded by the policy ceiling and expiry is verifiable with the injected clock', () => {
  const { store, clock, ledger } = setup();
  for (const ttl_seconds of [undefined, 0, -5, 1.5, '60', memory.MAX_TTL_SECONDS + 1]) {
    assert.throws(() => store.write(base({ ttl_seconds })), codeOf('AGENT_MEMORY_TTL_INVALID'), String(ttl_seconds));
  }
  store.write(base({ ttl_seconds: 60 }));
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'deploy' }).length, 1);
  clock.ms += 59_999;
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'deploy' }).length, 1);
  clock.ms += 1;
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'deploy' }).length, 0, 'expired at created_at + ttl');
  assert.deepEqual(store.list('alpha'), [{ memory_id: 'note-1', status: 'expired', trust: 'trusted' }]);
  assert.deepEqual(store.sweepExpired('alpha'), ['note-1']);
  assert.deepEqual(store.sweepExpired('alpha'), [], 'sweeping is idempotent');
  assert.equal(ledger.readStream('agent_memory', 'alpha').at(-1).event_type, EVENTS.EXPIRED);
  assert.deepEqual(store.list('alpha'), [{ memory_id: 'note-1', status: 'expired', trust: 'trusted' }]);
});

test('credentials are refused in content and in the source reference', () => {
  const { store, ledger } = setup();
  assert.throws(() => store.write(base({ content: `remember ${syntheticCredential()}` })), codeOf('AGENT_MEMORY_CREDENTIAL_DETECTED'));
  assert.throws(
    () => store.write(base({ source_ref: `https://u:${'x'.repeat(8)}@host.invalid/p` })),
    codeOf('AGENT_MEMORY_CREDENTIAL_DETECTED'),
  );
  assert.equal(ledger.getVersion('agent_memory', 'alpha'), 0, 'nothing was persisted');
  const bare = new MemoryStore({ ledger, now: () => START });
  assert.throws(() => bare.write(base()), codeOf('AGENT_MEMORY_SCANNER_REQUIRED'));
});

test('entries are validated against the agent-memory.v1 shape', () => {
  const { store } = setup();
  const cases = [
    ['not an object', null],
    ['array', []],
    ['project id', { scope: { project_id: 'Bad Id' } }],
    ['missing scope', { scope: undefined }],
    ['empty content', { content: '   ' }],
    ['content type', { content: 7 }],
    ['content size', { content: 'x'.repeat(memory.MAX_CONTENT_BYTES + 1) }],
    ['origin', { origin: 'unknown' }],
    ['trust', { trust: 'maybe' }],
    ['classification', { classification: 'secret' }],
    ['source_ref', { source_ref: 'has space' }],
    ['source_digest', { source_digest: 'abc' }],
    ['memory_id', { memory_id: 'UPPER' }],
    ['supersedes', { supersedes: 'UPPER' }],
    ['write_policy_ref', { write_policy_ref: '' }],
  ];
  for (const [label, patch] of cases) {
    const input = patch === null || Array.isArray(patch) ? patch : base(patch);
    assert.throws(() => memory.normalizeEntry(input), codeOf('AGENT_MEMORY_INVALID'), label);
  }
  assert.throws(() => store.write(base({ content: 7 })), codeOf('AGENT_MEMORY_INVALID'));
  const normalized = memory.normalizeEntry({
    ...base(),
    created_at: '2026-10-14T12:00:00Z',
    write_policy_ref: 'rule:x',
    supersedes: 'older',
  });
  assert.equal(normalized.created_at, '2026-10-14T12:00:00.000Z');
  assert.equal(normalized.source_digest, memory.sha256Text(base().content));
  assert.throws(() => memory.normalizeEntry({ ...base(), created_at: 'nope' }), codeOf('AGENT_MEMORY_INVALID'));
  assert.throws(() => memory.normalizeEntry({ ...base(), created_at: 5 }), codeOf('AGENT_MEMORY_INVALID'));
});

test('untrusted origins are stored as untrusted and stay out of default retrieval', () => {
  const { store } = setup();
  assert.throws(() => store.write(base({ origin: 'mcp', trust: 'trusted' })), codeOf('AGENT_MEMORY_TRUST_INVALID'));
  store.write(base({ memory_id: 'trusted-1', content: 'rollout notes from the operator' }));
  store.write(base({ memory_id: 'tool-1', origin: 'tool', trust: 'untrusted', content: 'rollout notes scraped by a tool' }));
  const standard = store.retrieve({ project_id: 'alpha', query: 'rollout notes' });
  assert.deepEqual(
    standard.map((source) => source.source_ref),
    ['memory://alpha/trusted-1'],
  );
  const included = store.retrieve({ project_id: 'alpha', query: 'rollout notes', include_untrusted: true });
  assert.equal(included.length, 2);
  const untrusted = included.find((source) => source.source_ref.endsWith('tool-1'));
  assert.equal(untrusted.authority, 'data');
  assert.equal(untrusted.provenance.trust, 'untrusted');
});

test('retrieval is deterministic, scoped by project and feeds memory[] with provenance', () => {
  const { store, clock } = setup();
  store.write(base({ memory_id: 'b-note', content: 'cache invalidation strategy' }));
  clock.ms += 1000;
  store.write(base({ memory_id: 'a-note', content: 'cache invalidation strategy' }));
  store.write(base({ memory_id: 'c-note', content: 'cache only' }));
  store.write(base({ memory_id: 'd-note', content: 'cache invalidation strategy' }));
  store.write(base({ scope: { project_id: 'beta' }, memory_id: 'other', content: 'cache invalidation strategy of beta' }));
  const run = () => store.retrieve({ project_id: 'alpha', query: 'Cache invalidation strategy', limit: 10 });
  const sources = run();
  assert.deepEqual(
    sources.map((source) => source.source_ref),
    ['memory://alpha/a-note', 'memory://alpha/d-note', 'memory://alpha/b-note', 'memory://alpha/c-note'],
  );
  assert.deepEqual(run(), sources, 'same input, same output');
  assert.deepEqual(
    sources.map((source) => source.priority),
    [100, 99, 98, 97],
  );
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'cache', limit: 1 }).length, 1);
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'unrelated words' }).length, 0);
  assert.ok(store.retrieve({ project_id: 'beta', query: 'cache' }).every((source) => source.source_ref.startsWith('memory://beta/')));
  for (const source of sources) {
    assert.doesNotThrow(() => MemorySourceSchema.parse(source));
    const resolved = resolveSourceAuthority('memory', source, { retrieved_at: source.provenance.retrieved_at });
    assert.equal(resolved.authority, 'data');
    assert.equal(resolved.provenance.origin, 'memory');
    assert.equal(source.provenance.trust, 'untrusted', 'memory is never trusted at the context boundary');
    assert.deepEqual(
      source.provenance.transform.map((entry) => entry.id),
      ['memory.write.operator', 'memory.retrieve'],
    );
  }
  assert.throws(() => store.retrieve({ project_id: 'alpha', query: ' ' }), codeOf('AGENT_MEMORY_INVALID'));
  assert.throws(() => store.retrieve({ project_id: 'alpha', query: 'cache', limit: 0 }), codeOf('AGENT_MEMORY_INVALID'));
  assert.deepEqual(store.retrieve({ project_id: 'empty', query: 'cache' }), []);
});

test('supersession and operator deletion are events and remove entries from retrieval', () => {
  const { store, ledger } = setup();
  store.write(base({ content: 'first version of the rule' }));
  assert.throws(() => store.write(base({ content: 'again' })), codeOf('AGENT_MEMORY_DUPLICATE'));
  assert.throws(() => store.write(base({ memory_id: 'note-2', supersedes: 'missing' })), codeOf('AGENT_MEMORY_SUPERSEDE_INVALID'));
  store.write(base({ memory_id: 'note-2', supersedes: 'note-1', content: 'second version of the rule' }));
  assert.deepEqual(
    store.retrieve({ project_id: 'alpha', query: 'rule' }).map((source) => source.source_ref),
    ['memory://alpha/note-2'],
  );
  assert.throws(() => store.write(base({ memory_id: 'note-3', supersedes: 'note-1' })), codeOf('AGENT_MEMORY_SUPERSEDE_INVALID'));
  assert.throws(
    () => store.forget({ project_id: 'alpha', memory_id: 'note-2', actor: { kind: 'host', id: 'x' } }),
    codeOf('AGENT_MEMORY_OPERATOR_REQUIRED'),
  );
  assert.throws(() => store.forget({ project_id: 'alpha', memory_id: 'ghost', actor: OPERATOR }), codeOf('AGENT_MEMORY_NOT_FOUND'));
  store.forget({ project_id: 'alpha', memory_id: 'note-2', actor: OPERATOR, reason: 'obsolete' });
  assert.throws(() => store.forget({ project_id: 'alpha', memory_id: 'note-2', actor: OPERATOR }), codeOf('AGENT_MEMORY_NOT_FOUND'));
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'rule' }).length, 0);
  assert.deepEqual(
    ledger.readStream('agent_memory', 'alpha').map((event) => event.event_type),
    [EVENTS.WRITTEN, EVENTS.WRITTEN, EVENTS.SUPERSEDED, EVENTS.DELETED],
  );
  assert.ok(ledger.readStream('agent_memory', 'alpha').every((event) => event.payload.contract === memory.CONTRACT));
});

test('the projection is disposable: rebuilding from the events gives the same result, and writes use CAS', () => {
  const { store, ledger, db, clock } = setup();
  store.write(base());
  store.write(base({ memory_id: 'note-2', content: 'second deploy note' }));
  const before = store.retrieve({ project_id: 'alpha', query: 'deploy', limit: 10 });
  store.rebuild();
  assert.deepEqual(store.retrieve({ project_id: 'alpha', query: 'deploy', limit: 10 }), before);
  const fresh = createGovernedMemory({ ledger, now: () => clock.ms });
  assert.deepEqual(fresh.retrieve({ project_id: 'alpha', query: 'deploy', limit: 10 }), before, 'a new process replays the same events');
  assert.throws(
    () => store.write(base({ memory_id: 'note-3', expected_version: 1 })),
    (error) => error.code === 'EXECUTION_STREAM_VERSION_CONFLICT',
  );
  store.write(base({ memory_id: 'note-3', expected_version: 2 }));
  assert.equal(ledger.getVersion('agent_memory', 'alpha'), 3);
  assert.deepEqual(
    db
      .prepare('SELECT DISTINCT aggregate_type FROM execution_events')
      .all()
      .map((row) => row.aggregate_type),
    ['agent_memory'],
  );
});

test('the store fails closed on a foreign ledger, unknown events and impossible transitions', () => {
  assert.throws(() => new MemoryStore({ ledger: {}, scanCredential: () => false }), codeOf('AGENT_MEMORY_LEDGER_REQUIRED'));
  const replay = (events) =>
    new MemoryStore({
      ledger: { append() {}, getVersion: () => events.length, readStream: () => events },
      scanCredential: () => false,
      now: () => START,
    });
  const written = { event_type: EVENTS.WRITTEN, payload: { entry: { memory_id: 'x', content: 'x', trust: 'trusted' } } };
  assert.throws(() => replay([{ event_type: 'memory.mystery', payload: {} }]).list('p'), codeOf('AGENT_MEMORY_EVENT_UNKNOWN'));
  assert.throws(
    () => replay([{ event_type: EVENTS.EXPIRED, payload: { memory_id: 'x' } }]).list('p'),
    codeOf('AGENT_MEMORY_EVENT_INVALID'),
  );
  assert.throws(
    () =>
      replay([
        written,
        { event_type: EVENTS.DELETED, payload: { memory_id: 'x' } },
        { event_type: EVENTS.EXPIRED, payload: { memory_id: 'x' } },
      ]).list('p'),
    codeOf('AGENT_MEMORY_EVENT_INVALID'),
  );
});

test('the axon bridge is optional and read-only: absent, failing or empty is a no-op', async () => {
  const { store, clock } = setup();
  store.write(base());
  const request = { store, project_id: 'alpha', query: 'deploy', include_untrusted: true, now: () => clock.ms };
  const governed = await collectMemorySources({ ...request, include_untrusted: false });
  assert.equal(governed.length, 1);
  assert.deepEqual(await collectMemorySources(request), governed, 'no provider is a no-op');
  assert.deepEqual(
    await collectMemorySources({
      ...request,
      searchProvider: async () => {
        throw new Error('axon unavailable');
      },
    }),
    governed,
  );

  const calls = [];
  const provider = async (query) => {
    calls.push(query);
    return {
      results: [
        'axon remembered the deploy window',
        { text: 'structured deploy hint' },
        { summary: 'summary deploy hint' },
        { content: syntheticCredential() },
        { text: 'x'.repeat(memory.MAX_CONTENT_BYTES + 1) },
        { nothing: true },
        '   ',
      ],
    };
  };
  const mixed = await collectMemorySources({ ...request, searchProvider: provider });
  assert.deepEqual(calls, ['deploy']);
  const bridged = mixed.slice(governed.length);
  assert.equal(bridged.length, 3, 'credentials, oversized and empty items are dropped');
  for (const source of bridged) {
    assert.equal(source.authority, 'data');
    assert.equal(source.provenance.origin, 'mcp');
    assert.equal(source.provenance.trust, 'untrusted');
    assert.doesNotThrow(() => MemorySourceSchema.parse(source));
  }
  assert.deepEqual(
    await collectMemorySources({ ...request, include_untrusted: false, searchProvider: provider }),
    governed,
    'untrusted memory stays out by default',
  );
  assert.equal(calls.length, 1, 'the bridge is not even consulted by default');
  for (const result of [
    ['array item deploy'],
    'plain string deploy',
    { memories: ['m deploy'] },
    { items: ['i deploy'] },
    { results: 'not-a-list' },
    null,
    42,
  ]) {
    const out = await collectMemorySources({ ...request, searchProvider: async () => result });
    assert.ok(out.length >= governed.length);
  }
  assert.equal(
    (await collectMemorySources({ ...request, searchProvider: async () => ['a deploy', 'b deploy'] })).length,
    governed.length + 2,
  );
  const [axonSource] = mixed.slice(governed.length);
  assert.match(axonSource.source_ref, /^axon:\/\/memory\/[0-9a-f]{16}$/);
});

test('migration 017 registers exactly the four memory events and the trigger still refuses any other type', () => {
  const { db, ledger } = setup();
  const registered = db
    .prepare("SELECT event_type FROM execution_event_schemas WHERE event_type LIKE 'memory.%' ORDER BY event_type")
    .all();
  assert.deepEqual(
    registered.map((row) => row.event_type),
    [EVENTS.DELETED, EVENTS.EXPIRED, EVENTS.SUPERSEDED, EVENTS.WRITTEN],
  );
  assert.throws(
    () => db.prepare("INSERT INTO execution_event_schemas (event_type, schema_version) VALUES ('memory.rogue', 1)").run(),
    /require a migration/,
  );
  assert.throws(
    () =>
      ledger.append({
        aggregate_id: 'alpha',
        aggregate_type: 'agent_memory',
        expected_version: 0,
        events: [
          {
            event_id: '00000000-0000-4000-8000-000000000001',
            event_type: 'memory.unregistered',
            schema_version: 1,
            occurred_at: '2026-10-14T12:00:00.000Z',
            correlation_id: 'c',
            causation_id: 'c',
            actor: OPERATOR,
            operation_id: null,
            payload: { memory_id: 'x' },
          },
        ],
      }),
    (error) => error.code === 'SQLITE_CONSTRAINT_TRIGGER',
  );
});
