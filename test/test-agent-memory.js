'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const { MemorySourceSchema, resolveSourceAuthority } = require('../packages/agent-context');
const memory = require('../packages/agent-memory');
const { collectMemorySources, createGovernedMemory } = require('../tools/cli/lib/memory-context-source');
const { ExecutionApprovalStore } = require('../tools/mcp-project-state/lib/execution-approval-store');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');

const { AgentMemoryError, EVENTS, MemoryStore } = memory;
const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');
const APPROVALS_SQL = path.join(
  __dirname,
  '..',
  'tools',
  'mcp-project-state',
  'migrations-pending-activation',
  '007-execution-approvals.sql',
);
const POLICY_VERSION = 'hseos-operational-v1';
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
  db.exec(fs.readFileSync(APPROVALS_SQL, 'utf8'));
  const approvalStore = new ExecutionApprovalStore(db);
  // The host decides which approval backs a deletion; nothing the model sends reaches this slot.
  const host = { approvalId: null, onResolve: null };
  const approvalVerifier = memory.createExecutionApprovalVerifier({
    approvalStore,
    resolveApprovalId: () => {
      host.onResolve?.();
      return host.approvalId;
    },
    policyVersion: POLICY_VERSION,
    now: () => clock.ms,
  });
  const store = createGovernedMemory({ ledger, now: () => clock.ms, approvalVerifier });
  const approve = (
    projectId,
    memoryId,
    { approvalId = `appr-${projectId}-${memoryId}`, operationId, scope, decision = 'approved' } = {},
  ) => {
    const operation = memory.memoryDeleteOperation(projectId, memoryId);
    approvalStore.issue({
      approval_id: approvalId,
      operation_id: operationId ?? operation.operation_id,
      authorizer: { id: 'owner', type: 'operator' },
      resource_scope: scope ?? operation.resource_scope,
      issued_at: STAMP,
      expires_at: '2026-10-14T13:00:00.000Z',
      decision,
      policy_version: POLICY_VERSION,
      evidence_ref: 'hseos://test/approval',
    });
    host.approvalId = approvalId;
    return approvalId;
  };
  return { db, ledger, clock, store, approve, host, approvalStore };
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
  const { store, ledger, approve } = setup();
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
  approve('beta', 'note-1');
  store.forget({ project_id: 'beta', memory_id: 'note-1' }, { actor: OPERATOR });
  assert.equal(store.retrieve({ project_id: 'alpha', query: 'knowledge' }).length, 1, 'deleting in beta leaves alpha alone');
});

test('supersession and operator deletion are events and remove entries from retrieval', () => {
  const { store, ledger, approve } = setup();
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
  approve('alpha', 'note-2');
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
  assert.equal(
    ledger.readStream('agent_memory', 'alpha').length,
    3,
    'every refusal above left the approval unspent and the stream untouched',
  );
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
});

test('forget needs an operator and a single-use approval bound to the operation, issued by the host', () => {
  const { store, ledger, approve, host: hostSlot, approvalStore, db } = setup();
  store.write(entry(), host());
  store.write(entry({ memory_id: 'note-2' }), host());
  const forget = (patch = {}, actor = OPERATOR) => store.forget({ project_id: 'alpha', memory_id: 'note-1', ...patch }, { actor });
  const events = () => ledger.readStream('agent_memory', 'alpha').map((event) => event.event_type);
  const refused = (cause) => (error) =>
    codeOf('AGENT_MEMORY_APPROVAL_REQUIRED')(error) && (cause === undefined || error.details.cause === cause);

  assert.throws(() => forget(), refused(), 'no approval at all');
  assert.throws(() => store.forget({ project_id: 'alpha', memory_id: 'note-1' }), codeOf('AGENT_MEMORY_OPERATOR_REQUIRED'));

  approve('alpha', 'note-2', { approvalId: 'appr-other-memory' });
  assert.throws(() => forget(), refused('EXECUTION_APPROVAL_SCOPE_MISMATCH'), 'approval of another memory');
  approve('alpha', 'note-1', {
    approvalId: 'appr-wrong-scope',
    operationId: memory.memoryDeleteOperation('alpha', 'note-1').operation_id,
    scope: { project_id: 'beta', memory_id: 'note-1' },
  });
  assert.throws(() => forget(), refused('EXECUTION_APPROVAL_SCOPE_MISMATCH'), 'right operation, wrong resource scope');
  approve('alpha', 'note-1', { approvalId: 'appr-denied', decision: 'denied' });
  assert.throws(() => forget(), refused('EXECUTION_APPROVAL_DENIED'), 'a denied approval');
  hostSlot.approvalId = 'appr-unknown';
  assert.throws(() => forget(), refused('EXECUTION_APPROVAL_NOT_FOUND'), 'an approval that does not exist');

  approve('alpha', 'note-1');
  assert.throws(
    () => forget({}, { kind: 'agent', id: 'planner' }),
    codeOf('AGENT_MEMORY_OPERATOR_REQUIRED'),
    'agent actor even with approval',
  );
  assert.throws(
    () => forget({ approval_id: 'appr-alpha-note-1', approval: { approved: true } }, null),
    codeOf('AGENT_MEMORY_OPERATOR_REQUIRED'),
  );
  assert.equal(approvalStore.db.prepare('SELECT COUNT(*) AS n FROM execution_approval_uses').get().n, 0, 'refusals spent nothing');
  assert.deepEqual(events(), ['memory.written', 'memory.written']);

  // A model-supplied approval in the payload is ignored: the host slot decides.
  hostSlot.approvalId = null;
  assert.throws(() => forget({ approval_id: 'appr-alpha-note-1', approved: true, approval: { id: 'appr-alpha-note-1' } }), refused());

  hostSlot.approvalId = 'appr-alpha-note-1';
  forget({ reason: 'approved cleanup' });
  assert.deepEqual(events(), ['memory.written', 'memory.written', EVENTS.DELETED]);
  assert.equal(ledger.readStream('agent_memory', 'alpha').at(-1).payload.reason, 'approved cleanup');
  assert.equal(db.prepare('SELECT operation_id FROM execution_approval_uses').get().operation_id, 'memory.delete:alpha:note-1');

  // Single use: the same approval cannot delete again, nor can it be replayed for the same operation.
  assert.throws(() => forget(), codeOf('AGENT_MEMORY_NOT_FOUND'));
  assert.throws(
    () => store.forget({ project_id: 'alpha', memory_id: 'note-2' }, { actor: OPERATOR }),
    refused('EXECUTION_APPROVAL_REUSED'),
    'a spent approval cannot back another deletion',
  );
  assert.throws(() => approve('alpha', 'note-1', { approvalId: 'appr-alpha-note-1' }), /identity is immutable/);
  assert.equal(store.list('alpha').find((item) => item.memory_id === 'note-2').status, 'active');
});

test('forget fails closed when the host wired no verifier or the verifier misbehaves', () => {
  const { ledger } = setup();
  const make = (approvalVerifier) =>
    new MemoryStore({
      ledger,
      scanCredential: () => false,
      now: () => START,
      ...(approvalVerifier === undefined ? {} : { approvalVerifier }),
    });
  make().write(entry(), host());
  const call = (store) => store.forget({ project_id: 'alpha', memory_id: 'note-1' }, { actor: OPERATOR });
  const refused = codeOf('AGENT_MEMORY_APPROVAL_REQUIRED');
  assert.throws(() => call(make()), refused, 'no verifier');
  assert.throws(() => call(make('yes')), refused, 'verifier is not a function');
  assert.throws(() => call(make(() => 1)), refused, 'verifier that does not confirm true');
  assert.throws(() => call(make(() => 'true')), refused, 'only boolean true confirms');
  assert.throws(
    () =>
      call(
        make(() => {
          throw new Error('store down');
        }),
      ),
    refused,
    'verifier that throws',
  );
  assert.equal(ledger.readStream('agent_memory', 'alpha').length, 1);
  const seen = [];
  assert.throws(() => call(make(() => true)), refused, 'a verifier that confirms without running onConsumed');
  assert.equal(ledger.readStream('agent_memory', 'alpha').length, 1);
  call(
    make(({ onConsumed, ...request }) => {
      seen.push(request);
      onConsumed();
      return true;
    }),
  );
  assert.deepEqual(seen, [
    {
      operation: 'memory.delete',
      operation_id: 'memory.delete:alpha:note-1',
      resource_scope: { project_id: 'alpha', memory_id: 'note-1' },
      actor: OPERATOR,
    },
  ]);
});

test('the approval verifier helper refuses a missing store, resolver or approval id', () => {
  const { approvalStore } = setup();
  const resolveApprovalId = () => 'x';
  assert.throws(() => memory.createExecutionApprovalVerifier({ resolveApprovalId }), codeOf('AGENT_MEMORY_APPROVAL_REQUIRED'));
  assert.throws(() => memory.createExecutionApprovalVerifier({ approvalStore }), codeOf('AGENT_MEMORY_APPROVAL_REQUIRED'));
  const verifier = memory.createExecutionApprovalVerifier({ approvalStore, resolveApprovalId: () => '', now: () => START });
  assert.throws(() => verifier({ ...memory.memoryDeleteOperation('alpha', 'note-1') }), codeOf('AGENT_MEMORY_APPROVAL_REQUIRED'));
  assert.throws(
    () => memory.createExecutionApprovalVerifier({ approvalStore, resolveApprovalId, policyVersion: '' }),
    codeOf('AGENT_MEMORY_APPROVAL_REQUIRED'),
  );
});

test('the approval is consumed together with the deletion append: a failed append leaves it unspent', () => {
  const { store, ledger, db, approve, host: hostSlot, clock } = setup();
  store.write(entry(), host());
  const forget = () => store.forget({ project_id: 'alpha', memory_id: 'note-1' }, { actor: OPERATOR });
  const spent = () => db.prepare('SELECT COUNT(*) AS n FROM execution_approval_uses').get().n;
  approve('alpha', 'note-1');

  const realAppend = ledger.append.bind(ledger);
  ledger.append = () => {
    throw new Error('ledger down');
  };
  assert.throws(forget, /ledger down/);
  ledger.append = realAppend;
  assert.equal(spent(), 0, 'append threw, approval not consumed');
  assert.equal(store.list('alpha')[0].status, 'active');

  // A concurrent writer moves the stream between the read and the append (version conflict).
  const other = createGovernedMemory({ ledger, now: () => clock.ms });
  hostSlot.onResolve = () => {
    hostSlot.onResolve = null;
    other.write(entry({ memory_id: 'note-9' }), host());
  };
  assert.throws(forget, (error) => !(error instanceof AgentMemoryError && error.code === 'AGENT_MEMORY_APPROVAL_REQUIRED'));
  assert.equal(spent(), 0, 'version conflict, approval not consumed');
  assert.equal(store.list('alpha').find((item) => item.memory_id === 'note-1').status, 'active');

  forget();
  assert.equal(spent(), 1);
  const deleted = ledger.readStream('agent_memory', 'alpha').at(-1);
  assert.equal(deleted.event_type, EVENTS.DELETED);
  assert.equal(deleted.operation_id, 'memory.delete:alpha:note-1');
  assert.equal(deleted.payload.approval_id, 'appr-alpha-note-1');
  assert.deepEqual(Object.keys(deleted.payload).sort(), ['approval_id', 'contract', 'memory_id', 'reason']);
});

test('an expired approval cannot back a deletion', () => {
  const { store, approve, clock, db } = setup();
  store.write(entry(), host());
  approve('alpha', 'note-1');
  clock.ms = Date.parse('2026-10-14T13:00:00.000Z');
  assert.throws(
    () => store.forget({ project_id: 'alpha', memory_id: 'note-1' }, { actor: OPERATOR }),
    (error) => codeOf('AGENT_MEMORY_APPROVAL_REQUIRED')(error) && error.details.cause === 'EXECUTION_APPROVAL_EXPIRED',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM execution_approval_uses').get().n, 0);
  assert.equal(store.list('alpha')[0].status, 'expired', 'entry untouched (ttl also elapsed)');
});
