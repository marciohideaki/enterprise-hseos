'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const { MemorySourceSchema, resolveSourceAuthority } = require('../packages/agent-context');
const environment = require('../packages/agent-environment');
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
const STAMP = '2026-10-14T12:00:00.000Z';

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

// `entry` is what a caller proposes; `host` is what only the trusted host supplies.
const entry = (overrides = {}) => ({
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
const host = (overrides = {}) => ({ rules: ALLOW, actor: OPERATOR, ...overrides });

const syntheticCredential = () => ['sk', 'proj', 'a'.repeat(30)].join('-');
const codeOf = (code, field) => (error) =>
  error instanceof AgentMemoryError && error.code === code && (field === undefined || error.details.field === field);
const invalidField = (field) => codeOf('AGENT_MEMORY_INVALID', field);

test('a write needs an admitting policy rule; ask passes only with approval and neither bypass nor an empty policy admits', () => {
  const { store } = setup();
  assert.throws(() => store.write(entry(), host({ rules: [] })), codeOf('AGENT_MEMORY_WRITE_DENIED'));
  assert.throws(() => store.write(entry(), host({ rules: ASK })), codeOf('AGENT_MEMORY_WRITE_DENIED'));
  assert.throws(
    () => store.write(entry(), host({ rules: [{ id: 'no', source: 'project', stage: 'deny', decision: 'deny' }] })),
    codeOf('AGENT_MEMORY_WRITE_DENIED'),
  );
  assert.throws(
    () => store.write(entry(), host({ rules: [], approved: true })),
    codeOf('AGENT_MEMORY_WRITE_DENIED'),
    'approval without a rule never admits',
  );
  assert.throws(
    () => store.write(entry(), host({ rules: [], execution_mode: 'bypass' })),
    codeOf('AGENT_MEMORY_WRITE_DENIED'),
    'bypass has no deciding rule',
  );
  assert.equal(store.write(entry(), host({ rules: ASK, approved: true })).write_policy_ref, 'rule:memory-ask');
  assert.equal(store.write(entry({ memory_id: 'note-2' }), host()).write_policy_ref, 'rule:memory-write');
});

test('rules, approval, actor, created_at and the policy reference are host-owned and refused inside the entry', () => {
  const { store, ledger } = setup();
  const forged = [
    ['rules', { rules: ALLOW }],
    ['approved', { approved: true }],
    ['actor', { actor: OPERATOR }],
    ['created_at', { created_at: '2099-01-01T00:00:00.000Z' }],
    ['write_policy_ref', { write_policy_ref: 'rule:self' }],
    ['expected_version', { expected_version: 0 }],
    ['unknown', { unknown: 1 }],
  ];
  for (const [field, patch] of forged) assert.throws(() => store.write(entry(patch), host()), invalidField(field), field);
  assert.throws(() => store.write(null, host()), invalidField('entry'));
  assert.equal(ledger.getVersion('agent_memory', 'alpha'), 0);
  store.write(entry(), host());
  const [stored] = ledger.readStream('agent_memory', 'alpha');
  assert.equal(stored.payload.entry.created_at, STAMP, 'created_at comes from the clock');
  assert.equal(stored.payload.entry.write_policy_ref, 'rule:memory-write');
});

test('origin operator needs an operator actor and the actor is validated and scanned', () => {
  const { store } = setup();
  assert.throws(
    () => store.write(entry(), host({ actor: { kind: 'agent', id: 'planner' } })),
    codeOf('AGENT_MEMORY_ORIGIN_ACTOR_MISMATCH'),
  );
  assert.throws(
    () => store.write(entry(), host({ actor: { kind: 'host', id: 'agent-memory' } })),
    codeOf('AGENT_MEMORY_ORIGIN_ACTOR_MISMATCH'),
  );
  const agentWrite = entry({ memory_id: 'agent-1', origin: 'agent', trust: 'untrusted' });
  assert.throws(() => store.write(agentWrite, host({ actor: { kind: 'robot', id: 'planner' } })), invalidField('actor'));
  assert.throws(() => store.write(agentWrite, host({ actor: null })), invalidField('actor'));
  assert.throws(() => store.write(agentWrite, host({ actor: { kind: 'agent', id: 'Not An Id' } })), invalidField('actor.id'));
  assert.throws(
    () => store.write(agentWrite, host({ actor: { kind: 'agent', id: syntheticCredential() } })),
    codeOf('AGENT_MEMORY_CREDENTIAL_DETECTED', 'actor'),
  );
  assert.equal(store.write(agentWrite, host({ actor: { kind: 'agent', id: 'planner' } })).memory_id, 'agent-1');
  assert.equal(
    store.write(entry({ memory_id: 'default-actor', origin: 'tool', trust: 'untrusted' }), { rules: ALLOW }).memory_id,
    'default-actor',
  );
});

test('authority is fixed to data and escalation is refused', () => {
  const { store } = setup();
  for (const authority of ['directive', 'operator']) {
    assert.throws(() => store.write(entry({ authority }), host()), codeOf('AGENT_MEMORY_AUTHORITY_ESCALATION'));
  }
  store.write(entry({ authority: 'data' }), host());
  const [source] = store.retrieve({ project_id: 'alpha', query: 'deploy' });
  assert.equal(source.authority, 'data');
  assert.equal(memory.AUTHORITY, 'data');
});

test('ttl is mandatory, bounded by the policy ceiling and expiry is verifiable with the injected clock', () => {
  const { store, clock, ledger } = setup();
  for (const ttl_seconds of [undefined, 0, -5, 1.5, '60', memory.MAX_TTL_SECONDS + 1]) {
    assert.throws(() => store.write(entry({ ttl_seconds }), host()), codeOf('AGENT_MEMORY_TTL_INVALID'), String(ttl_seconds));
  }
  store.write(entry({ ttl_seconds: 60 }), host());
  assert.deepEqual(store.sweepExpired('alpha'), [], 'a premature sweep expires nothing');
  assert.equal(ledger.readStream('agent_memory', 'alpha').length, 1);
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'deploy' }).length, 1);
  clock.ms += 59_999;
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'deploy' }).length, 1);
  assert.deepEqual(store.sweepExpired('alpha'), []);
  clock.ms += 1;
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'deploy' }).length, 0, 'expired at created_at + ttl');
  assert.deepEqual(store.list('alpha'), [{ memory_id: 'note-1', status: 'expired', trust: 'trusted' }]);
  assert.deepEqual(store.sweepExpired('alpha'), ['note-1']);
  assert.deepEqual(store.sweepExpired('alpha'), [], 'sweeping is idempotent');
  assert.equal(ledger.readStream('agent_memory', 'alpha').at(-1).event_type, EVENTS.EXPIRED);
  assert.throws(() => store.sweepExpired('alpha', { actor: { kind: 'robot', id: 'x' } }), invalidField('actor'));
});

test('credentials are refused in content and in the source reference', () => {
  const { store, ledger } = setup();
  assert.throws(
    () => store.write(entry({ content: `remember ${syntheticCredential()}` }), host()),
    codeOf('AGENT_MEMORY_CREDENTIAL_DETECTED', 'content'),
  );
  assert.throws(
    () => store.write(entry({ source_ref: `https://u:${'x'.repeat(8)}@host.invalid/p` }), host()),
    codeOf('AGENT_MEMORY_CREDENTIAL_DETECTED', 'source_ref'),
  );
  assert.equal(ledger.getVersion('agent_memory', 'alpha'), 0, 'nothing was persisted');
  const bare = new MemoryStore({ ledger, now: () => START });
  assert.throws(() => bare.write(entry(), host()), codeOf('AGENT_MEMORY_SCANNER_REQUIRED'));
  assert.throws(() => bare.forget({ project_id: 'alpha', memory_id: 'x' }, { actor: OPERATOR }), codeOf('AGENT_MEMORY_SCANNER_REQUIRED'));
});

test('each malformed field is refused for its own reason (one violation per case)', () => {
  const valid = { ...entry(), created_at: STAMP };
  assert.doesNotThrow(() => memory.normalizeEntry(valid));
  const cases = [
    ['scope.project_id', { scope: { project_id: 'Bad Id' } }],
    ['scope.project_id', { scope: undefined }],
    ['content', { content: '   ' }],
    ['content', { content: 7 }],
    ['content', { content: 'x'.repeat(memory.MAX_CONTENT_BYTES + 1) }],
    ['origin', { origin: 'unknown' }],
    ['trust', { trust: 'maybe' }],
    ['classification', { classification: 'secret' }],
    ['source_ref', { source_ref: 'has space' }],
    ['source_ref', { source_ref: 'x'.repeat(1025) }],
    ['source_digest', { source_digest: 'abc' }],
    ['source_digest', { source_digest: 7 }],
    ['memory_id', { memory_id: 'UPPER' }],
    ['supersedes', { supersedes: 'UPPER' }],
    ['write_policy_ref', { write_policy_ref: '' }],
    ['created_at', { created_at: 'nope' }],
    ['created_at', { created_at: 5 }],
  ];
  for (const [field, patch] of cases) {
    assert.throws(
      () => memory.normalizeEntry({ ...valid, ...patch }),
      invalidField(field),
      `${field}: ${JSON.stringify(patch).slice(0, 40)}`,
    );
  }
  assert.throws(() => memory.normalizeEntry(null), invalidField('entry'));
  assert.throws(() => memory.normalizeEntry([]), invalidField('entry'));
  assert.throws(() => memory.normalizeEntry({ ...valid, origin: 'tool', trust: 'trusted' }), codeOf('AGENT_MEMORY_TRUST_INVALID'));
  assert.doesNotThrow(() =>
    memory.normalizeEntry({ ...valid, content: 'x'.repeat(memory.MAX_CONTENT_BYTES), write_policy_ref: 'rule:x', supersedes: 'older' }),
  );
  const normalized = memory.normalizeEntry({ ...valid, created_at: '2026-10-14T12:00:00Z' });
  assert.equal(normalized.created_at, STAMP);
  assert.equal(normalized.source_digest, memory.sha256Text(valid.content));
});

test('source_digest must describe the content when the caller supplies it', () => {
  const { store } = setup();
  assert.throws(() => store.write(entry({ source_digest: '0'.repeat(64) }), host()), invalidField('source_digest'));
  const content = 'the deploy pipeline uses blue green rollouts';
  assert.equal(store.write(entry({ source_digest: memory.sha256Text(content) }), host()).memory_id, 'note-1');
});

test('untrusted origins are stored as untrusted and stay out of default retrieval', () => {
  const { store } = setup();
  assert.throws(() => store.write(entry({ origin: 'mcp', trust: 'trusted' }), host()), codeOf('AGENT_MEMORY_TRUST_INVALID'));
  store.write(entry({ memory_id: 'trusted-1', content: 'rollout notes from the operator' }), host());
  store.write(entry({ memory_id: 'tool-1', origin: 'tool', trust: 'untrusted', content: 'rollout notes scraped by a tool' }), host());
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
  store.write(entry({ memory_id: 'b-note', content: 'cache invalidation strategy' }), host());
  clock.ms += 1000;
  store.write(entry({ memory_id: 'a-note', content: 'cache invalidation strategy' }), host());
  store.write(entry({ memory_id: 'c-note', content: 'cache only' }), host());
  store.write(entry({ memory_id: 'd-note', content: 'cache invalidation strategy' }), host());
  store.write(entry({ scope: { project_id: 'beta' }, memory_id: 'other', content: 'cache invalidation strategy of beta' }), host());
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
      source.provenance.transform.map((item) => item.id),
      ['memory.write.operator', 'memory.retrieve'],
    );
  }
  assert.throws(() => store.retrieve({ project_id: 'alpha', query: ' ' }), invalidField('query'));
  assert.throws(() => store.retrieve({ project_id: 'alpha', query: 'cache', limit: 0 }), invalidField('limit'));
  assert.throws(() => store.retrieve({ project_id: 'alpha', query: 'cache', limit: 51 }), invalidField('limit'));
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'cache', limit: 50 }).length, 4);
  assert.deepEqual(store.retrieve({ project_id: 'empty', query: 'cache' }), []);
});

test('projects never share ids, events or projection: the same memory_id lives independently in two projects', () => {
  const { store, ledger } = setup();
  store.write(entry({ scope: { project_id: 'alpha' }, content: 'alpha only knowledge' }), host());
  store.write(entry({ scope: { project_id: 'beta' }, content: 'beta only knowledge' }), host());
  assert.equal(ledger.getVersion('agent_memory', 'alpha'), 1);
  assert.equal(ledger.getVersion('agent_memory', 'beta'), 1, 'both streams are at the same version');
  const alpha = store.retrieve({ project_id: 'alpha', query: 'knowledge' });
  const beta = store.retrieve({ project_id: 'beta', query: 'knowledge' });
  assert.deepEqual(
    alpha.map((source) => source.content),
    ['alpha only knowledge'],
  );
  assert.deepEqual(
    beta.map((source) => source.content),
    ['beta only knowledge'],
  );
  const ids = ledger.readGlobal({ limit: 10 }).map((event) => event.event_id);
  assert.equal(new Set(ids).size, 2);
  store.forget({ project_id: 'beta', memory_id: 'note-1' }, { actor: OPERATOR });
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'knowledge' }).length, 1, 'deleting in beta leaves alpha alone');
});

test('supersession and operator deletion are events and remove entries from retrieval', () => {
  const { store, ledger } = setup();
  store.write(entry({ content: 'first version of the rule' }), host());
  assert.throws(() => store.write(entry({ content: 'again' }), host()), codeOf('AGENT_MEMORY_DUPLICATE'));
  assert.throws(() => store.write(entry({ memory_id: 'note-2', supersedes: 'missing' }), host()), codeOf('AGENT_MEMORY_SUPERSEDE_INVALID'));
  store.write(entry({ memory_id: 'note-2', supersedes: 'note-1', content: 'second version of the rule' }), host());
  assert.deepEqual(
    store.retrieve({ project_id: 'alpha', query: 'rule' }).map((source) => source.source_ref),
    ['memory://alpha/note-2'],
  );
  assert.throws(() => store.write(entry({ memory_id: 'note-3', supersedes: 'note-1' }), host()), codeOf('AGENT_MEMORY_SUPERSEDE_INVALID'));
  const forget = (patch, actor = OPERATOR) => store.forget({ project_id: 'alpha', memory_id: 'note-2', ...patch }, { actor });
  assert.throws(() => forget({}, { kind: 'host', id: 'agent-memory' }), codeOf('AGENT_MEMORY_OPERATOR_REQUIRED'));
  assert.throws(() => forget({}, null), codeOf('AGENT_MEMORY_OPERATOR_REQUIRED'));
  assert.throws(() => forget({}, { kind: 'operator', id: syntheticCredential() }), codeOf('AGENT_MEMORY_CREDENTIAL_DETECTED', 'actor'));
  assert.throws(() => forget({ memory_id: 'ghost' }), codeOf('AGENT_MEMORY_NOT_FOUND'));
  assert.throws(() => forget({ reason: `because ${syntheticCredential()}` }), codeOf('AGENT_MEMORY_CREDENTIAL_DETECTED', 'reason'));
  assert.throws(() => forget({ reason: 'x'.repeat(memory.MAX_REASON_BYTES + 1) }), invalidField('reason'));
  assert.throws(() => forget({ reason: { huge: true } }), invalidField('reason'));
  assert.throws(() => forget({ reason: '  ' }), invalidField('reason'));
  assert.throws(() => forget({ project_id: 'Bad Id' }), invalidField('project_id'));
  assert.throws(() => forget({ memory_id: 'BAD' }), invalidField('memory_id'));
  forget({ reason: 'obsolete' });
  assert.throws(() => forget({}), codeOf('AGENT_MEMORY_NOT_FOUND'));
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'rule' }).length, 0);
  const events = ledger.readStream('agent_memory', 'alpha');
  assert.deepEqual(
    events.map((event) => event.event_type),
    [EVENTS.WRITTEN, EVENTS.WRITTEN, EVENTS.SUPERSEDED, EVENTS.DELETED],
  );
  assert.ok(events.every((event) => event.payload.contract === memory.CONTRACT));
  assert.deepEqual(events.at(-1).actor, OPERATOR);
  assert.equal(events.at(-1).payload.reason, 'obsolete');
});

test('every read and sweep validates the project identifier with the contract', () => {
  const { store } = setup();
  for (const projectId of [undefined, 'Bad Id', 7]) {
    assert.throws(() => store.retrieve({ project_id: projectId, query: 'x' }), invalidField('project_id'));
    assert.throws(() => store.list(projectId), invalidField('project_id'));
    assert.throws(() => store.sweepExpired(projectId), invalidField('project_id'));
  }
});

test('the projection is disposable: rebuilding from the events gives the same result, and writes use CAS', () => {
  const { store, ledger, db, clock } = setup();
  store.write(entry(), host());
  store.write(entry({ memory_id: 'note-2', content: 'second deploy note' }), host());
  const before = store.retrieve({ project_id: 'alpha', query: 'deploy', limit: 10 });
  store.rebuild();
  assert.deepEqual(store.retrieve({ project_id: 'alpha', query: 'deploy', limit: 10 }), before);
  const fresh = createGovernedMemory({ ledger, now: () => clock.ms });
  assert.deepEqual(fresh.retrieve({ project_id: 'alpha', query: 'deploy', limit: 10 }), before, 'a new process replays the same events');
  assert.throws(
    () => store.write(entry({ memory_id: 'note-3' }), host({ expected_version: 1 })),
    (error) => error.code === 'EXECUTION_STREAM_VERSION_CONFLICT',
  );
  store.write(entry({ memory_id: 'note-3' }), host({ expected_version: 2 }));
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
  const on = (type) => ({ event_type: type, payload: { memory_id: 'x' } });
  assert.throws(() => replay([{ event_type: 'memory.mystery', payload: {} }]).list('p'), codeOf('AGENT_MEMORY_EVENT_UNKNOWN'));
  assert.throws(() => replay([on(EVENTS.EXPIRED)]).list('p'), codeOf('AGENT_MEMORY_EVENT_INVALID'));
  assert.throws(() => replay([written, on(EVENTS.DELETED), on(EVENTS.EXPIRED)]).list('p'), codeOf('AGENT_MEMORY_EVENT_INVALID'));
  assert.throws(() => replay([written, on(EVENTS.DELETED), on(EVENTS.DELETED)]).list('p'), codeOf('AGENT_MEMORY_EVENT_INVALID'));
  assert.throws(() => replay([written, on(EVENTS.EXPIRED), on(EVENTS.EXPIRED)]).list('p'), codeOf('AGENT_MEMORY_EVENT_INVALID'));
  assert.deepEqual(
    replay([written, on(EVENTS.EXPIRED), on(EVENTS.DELETED)])
      .list('p')
      .map((item) => item.status),
    ['deleted'],
  );
});

test('the axon bridge is optional and read-only: absent, failing or empty is a no-op', async () => {
  const { store, clock } = setup();
  store.write(entry(), host());
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
  assert.equal(bridged.length, 3, 'duplicates, credentials, oversized and empty items are dropped');
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
  assert.equal(
    (await collectMemorySources({ ...request, query: `deploy ${syntheticCredential()}`, searchProvider: provider })).length,
    governed.length,
    'a credential-like query never reaches the bridge',
  );
  assert.equal(calls.length, 1);
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
  assert.match(mixed[governed.length].source_ref, /^axon:\/\/memory\/[0-9a-f]{16}$/);
  const many = Array.from({ length: 15 }, (_, index) => `deploy item ${index}`);
  const capped = await collectMemorySources({ ...request, limit: 50, searchProvider: async () => many });
  assert.equal(capped.length, governed.length + 10, 'the bridge contributes at most 10 results');
  const limited = await collectMemorySources({ ...request, limit: 2, searchProvider: async () => many });
  assert.equal(limited.length, 2, 'the limit applies to the merged set');
});

const ENVIRONMENT_EVENT_TYPES = [
  'environment.browser.blocked',
  'environment.browser.completed',
  'environment.browser.refused',
  'environment.computer.action_executed',
  'environment.computer.approval_outcome',
  'environment.computer.blocked',
  'environment.computer.refused',
  'environment.computer.screenshot',
  'environment.computer.session_closed',
  'environment.computer.session_expired',
  'environment.computer.session_opened',
  'environment.dap.blocked',
  'environment.dap.completed',
  'environment.dap.refused',
  'environment.lsp.blocked',
  'environment.lsp.completed',
  'environment.lsp.refused',
];

test('migration 017 registers exactly the four memory and seventeen environment events and the trigger still refuses any other type', () => {
  const { db, ledger } = setup();
  const registered = db
    .prepare(
      "SELECT event_type FROM execution_event_schemas WHERE event_type LIKE 'memory.%' OR event_type LIKE 'environment.%' ORDER BY event_type",
    )
    .all();
  assert.equal(registered.length, 21);
  assert.deepEqual(
    registered.map((row) => row.event_type),
    [...ENVIRONMENT_EVENT_TYPES, EVENTS.DELETED, EVENTS.EXPIRED, EVENTS.SUPERSEDED, EVENTS.WRITTEN].sort(),
  );
  assert.throws(
    () => db.prepare("INSERT INTO execution_event_schemas (event_type, schema_version) VALUES ('environment.lsp.unknown', 1)").run(),
    /require a migration/,
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
            occurred_at: STAMP,
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
  assert.throws(
    () =>
      ledger.append({
        aggregate_id: 'session-1',
        aggregate_type: 'environment_session',
        expected_version: 0,
        events: [
          {
            event_id: '00000000-0000-4000-8000-000000000002',
            event_type: 'environment.lsp.unknown',
            schema_version: 1,
            occurred_at: STAMP,
            correlation_id: 'c',
            causation_id: 'c',
            actor: OPERATOR,
            operation_id: null,
            payload: { code: 'x' },
          },
        ],
      }),
    (error) => error.code === 'SQLITE_CONSTRAINT_TRIGGER',
  );
});

const SINK_ACTOR = { type: 'host', id: 'env-host' };
const sinkOf = (ledger, overrides = {}) =>
  environment.createEnvironmentLedgerSink({ ledger, project_id: 'alpha', actor: SINK_ACTOR, session_id: 'session-1', ...overrides });

test('environment ledger sink appends service events to the environment_session stream in order', () => {
  const { ledger } = setup();
  const sink = sinkOf(ledger);
  sink({ contract: 'environment.lsp.v1', at: '2026-01-01T00:00:00.000Z', type: 'environment.lsp.completed', action: 'hover' });
  sink({ contract: 'environment.lsp.v1', at: '2026-01-01T00:00:01.000Z', type: 'environment.lsp.refused', code: 'ENV_X', cause: 'no' });
  assert.equal(ledger.getVersion('environment_session', 'session-1'), 2);
  const [first, second] = ledger.readStream('environment_session', 'session-1');
  assert.equal(first.event_type, 'environment.lsp.completed');
  assert.equal(first.schema_version, 1);
  assert.equal(first.occurred_at, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(first.actor, SINK_ACTOR);
  assert.equal(first.correlation_id, 'session-1');
  assert.deepEqual(first.payload, { project_id: 'alpha', contract: 'environment.lsp.v1', action: 'hover' });
  assert.equal(second.causation_id, first.event_id);
  assert.deepEqual(second.payload, { project_id: 'alpha', contract: 'environment.lsp.v1', code: 'ENV_X', cause: 'no' });
});

test('environment ledger sink carries operation, correlation and falls back to the clock for a bad timestamp', () => {
  const { ledger } = setup();
  const sink = sinkOf(ledger, { correlation_id: 'corr-1', operation_id: 'op-1', now: () => new Date('2026-02-02T00:00:00.000Z') });
  sink({ type: 'environment.dap.blocked', at: 'yesterday', code: 'C' });
  sink({ type: 'environment.dap.blocked' });
  const [event, bare] = ledger.readStream('environment_session', 'session-1');
  assert.equal(event.correlation_id, 'corr-1');
  assert.equal(event.operation_id, 'op-1');
  assert.equal(event.occurred_at, '2026-02-02T00:00:00.000Z');
  assert.equal(bare.occurred_at, '2026-02-02T00:00:00.000Z');
});

test('environment ledger sink redacts credentials in nested payloads and never writes them', () => {
  const { ledger } = setup();
  const leaked = `ghp_${'abcdefghijklmnopqrstuvwxyz0123456789'}`;
  const sink = sinkOf(ledger, { containsCredential: (text) => text.includes('ghp_') });
  sink({ type: 'environment.browser.refused', cause: `token ${leaked}`, nested: { list: [leaked, 'fine'] }, count: 3 });
  const [event] = ledger.readStream('environment_session', 'session-1');
  assert.equal(JSON.stringify(event).includes(leaked), false);
  assert.deepEqual(event.payload, { project_id: 'alpha', cause: '[redacted]', nested: { list: ['[redacted]', 'fine'] }, count: 3 });
});

test('environment ledger sink uses the repository credential scanner by default', () => {
  const { ledger } = setup();
  const leaked = `ghp_${'abcdefghijklmnopqrstuvwxyz0123456789'}`;
  sinkOf(ledger)({ type: 'environment.browser.refused', cause: `leaked ${leaked}` });
  const [event] = ledger.readStream('environment_session', 'session-1');
  assert.equal(JSON.stringify(event).includes(leaked), false);
});

test('environment ledger sink propagates every append failure instead of swallowing it', () => {
  const { ledger } = setup();
  const sink = sinkOf(ledger);
  // Unregistered type: the schema trigger refuses it and the sink does not hide that.
  assert.throws(
    () => sink({ type: 'environment.lsp.unknown' }),
    (error) => error.code === 'SQLITE_CONSTRAINT_TRIGGER',
  );
  // Sensitive key: the ledger refuses it.
  assert.throws(
    () => sink({ type: 'environment.lsp.completed', password: 'x' }),
    (error) => error.code === 'EXECUTION_EVENT_INVALID',
  );
  assert.equal(ledger.getVersion('environment_session', 'session-1'), 0);
  // Non-serializable payload.
  assert.throws(
    () => sink({ type: 'environment.lsp.completed', value: () => 1 }),
    (error) => error.code === 'EXECUTION_EVENT_INVALID',
  );
  // A missing type is a programming error, not a silent drop.
  assert.throws(
    () => sink({}),
    (error) => error.code === 'ENV_LEDGER_SINK_EVENT_INVALID',
  );
  assert.throws(
    () => sink(null),
    (error) => error.code === 'ENV_LEDGER_SINK_EVENT_INVALID',
  );
  // A ledger that fails to append surfaces its own error.
  const broken = sinkOf({
    getVersion: () => 0,
    append: () => {
      throw new Error('disk full');
    },
  });
  assert.throws(() => broken({ type: 'environment.lsp.completed' }), /disk full/);
});

test('environment ledger sink surfaces a concurrent writer as a version conflict', () => {
  const { ledger } = setup();
  const sink = sinkOf(ledger);
  const racing = {
    getVersion: (...args) => {
      const version = ledger.getVersion(...args);
      sinkOf(ledger, { actor: { type: 'host', id: 'other' } })({ type: 'environment.lsp.completed' });
      return version;
    },
    append: (request) => ledger.append(request),
  };
  assert.throws(
    () => sinkOf(racing)({ type: 'environment.lsp.blocked' }),
    (error) =>
      error.code === 'EXECUTION_STREAM_VERSION_CONFLICT' && error.details.expected_version === 0 && error.details.current_version === 1,
  );
  sink({ type: 'environment.lsp.blocked' });
  assert.equal(ledger.getVersion('environment_session', 'session-1'), 2);
});

test('environment ledger sink rejects an invalid construction', () => {
  const { ledger } = setup();
  for (const overrides of [
    { ledger: null },
    { ledger: { append() {} } },
    { project_id: '' },
    { session_id: 7 },
    { actor: null },
    { actor: [] },
    { correlation_id: '' },
    { operation_id: 4 },
    { containsCredential: 'no' },
    { now: 'no' },
  ]) {
    assert.throws(
      () => sinkOf(ledger, overrides),
      (error) => error.code === 'ENV_LEDGER_SINK_INVALID',
      JSON.stringify(Object.keys(overrides)),
    );
  }
});

test('environment ledger sink binds the project into every payload so projects never mix', () => {
  const { ledger } = setup();
  sinkOf(ledger, { session_id: 's-a', project_id: 'alpha' })({ type: 'environment.lsp.completed' });
  sinkOf(ledger, { session_id: 's-b', project_id: 'beta' })({ type: 'environment.lsp.completed' });
  assert.equal(ledger.readStream('environment_session', 's-a')[0].payload.project_id, 'alpha');
  assert.equal(ledger.readStream('environment_session', 's-b')[0].payload.project_id, 'beta');
});

test('environment ledger sink records the computer approval outcome event registered by migration 017', () => {
  const { ledger } = setup();
  sinkOf(ledger)({ type: 'environment.computer.approval_outcome', contract: 'environment.computer.v1', outcome: 'granted' });
  const [event] = ledger.readStream('environment_session', 'session-1');
  assert.equal(event.event_type, 'environment.computer.approval_outcome');
  assert.equal(event.payload.outcome, 'granted');
});

test('environment ledger sink never lets an event claim another project', () => {
  const { ledger } = setup();
  sinkOf(ledger)({ type: 'environment.lsp.completed', project_id: 'beta' });
  assert.equal(ledger.readStream('environment_session', 'session-1')[0].payload.project_id, 'alpha');
});
