'use strict';

// Behavioural coverage for the execution ledger, approval store, projections and migration runner: every refusal
// below is a guard that keeps a malformed, replayed or tampered record out of the durable state.

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const { listMigrations, runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const {
  ConcurrencyConflictError,
  DuplicateEventError,
  ExecutionEventLedger,
  ExecutionLedgerError,
  InvalidEventError,
} = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { ApprovalError, ExecutionApprovalStore } = require('../tools/mcp-project-state/lib/execution-approval-store');
const { applyExecutionRun, ExecutionProjectionStore } = require('../tools/mcp-project-state/lib/execution-projections');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');

function eventId(label) {
  const hex = createHash('sha256').update(label).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function started(label, overrides = {}) {
  return {
    event_id: eventId(label),
    event_type: 'ExecutionStarted',
    schema_version: 1,
    occurred_at: '2026-08-21T04:00:00.000Z',
    correlation_id: 'gate-corr',
    causation_id: `command-${label}`,
    actor: { id: 'human-1', type: 'human' },
    operation_id: `operation-${label}`,
    payload: {
      tool: 'fixture.echo',
      provider: 'fixture-provider',
      idempotency_key: `idempotency-${label}`,
      dispatch_attempt: 1,
      deadline: '2026-08-21T04:01:00.000Z',
    },
    evidence_refs: [],
    ...overrides,
  };
}

function memory(label, overrides = {}) {
  return { ...started(label), event_type: 'memory.written', payload: { a: 1 }, ...overrides };
}

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const ledger = new ExecutionEventLedger(db);
  return { db, ledger, projections: new ExecutionProjectionStore(db, ledger), approvals: new ExecutionApprovalStore(db) };
}

function appendStarted(ledger, id, version = 0, label = id) {
  return ledger.append({ aggregate_type: 'execution', aggregate_id: id, expected_version: version, events: [started(label)] });
}

function approval(overrides = {}) {
  return {
    approval_id: 'approval-1',
    operation_id: 'operation-1',
    authorizer: { id: 'owner', type: 'human' },
    resource_scope: { path: 'docs/readme.md', mode: 'write' },
    issued_at: '2026-08-21T04:00:00.000Z',
    expires_at: '2026-08-21T05:00:00.000Z',
    decision: 'approved',
    policy_version: 'policy-1',
    evidence_ref: 'evidence://approval-1',
    ...overrides,
  };
}

function consumeRequest(overrides = {}) {
  return {
    approval_id: 'approval-1',
    operation_id: 'operation-1',
    resource_scope: { path: 'docs/readme.md', mode: 'write' },
    policy_version: 'policy-1',
    now: '2026-08-21T04:30:00.000Z',
    ...overrides,
  };
}

function code(expected) {
  return (error) => {
    assert.equal(error.code, expected, error.message);
    return true;
  };
}

test('migrations: an empty directory applies nothing and a missing one lists nothing', () => {
  const db = new Database(':memory:');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gate-migrations-'));
  const messages = [];
  try {
    assert.deepEqual(listMigrations(path.join(dir, 'absent')), []);
    assert.deepEqual(runMigrations(db, dir, { log: (level, msg) => messages.push([level, msg]) }), { applied: [], current: 0 });
    assert.equal(messages[0][0], 'info');
    assert.match(messages[0][1], /no migrations found/);
    fs.writeFileSync(path.join(dir, 'README.md'), 'not a migration');
    assert.deepEqual(listMigrations(dir), []);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations: the default logger reports to the console and applied files are skipped on re-run', () => {
  const db = new Database(':memory:');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gate-migrations-'));
  const original = console.log;
  const lines = [];
  try {
    fs.writeFileSync(path.join(dir, '001-first.sql'), 'CREATE TABLE a (x INTEGER);');
    fs.writeFileSync(path.join(dir, '002-second.sql'), 'CREATE TABLE b (x INTEGER);');
    console.log = (line) => lines.push(line);
    const first = runMigrations(db, dir);
    console.log = original;
    assert.deepEqual(first, { applied: ['001-first.sql', '002-second.sql'], current: 2 });
    assert.ok(lines.some((line) => line.startsWith('[migrations:info] applied 001-first.sql')));
    assert.deepEqual(runMigrations(db, dir, { log: () => {} }), { applied: [], current: 2 });
  } finally {
    console.log = original;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations: inside an external transaction the caller decides the rollback and applied files are skipped', () => {
  const db = new Database(':memory:');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gate-migrations-'));
  const messages = [];
  const log = (level, msg) => messages.push([level, msg]);
  try {
    fs.writeFileSync(path.join(dir, '001-first.sql'), 'CREATE TABLE a (x INTEGER);');
    fs.writeFileSync(path.join(dir, '002-broken.sql'), 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL;');
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => runMigrations(db, dir, { log, externalTransaction: true }), /syntax error/);
    // the runner did not roll back: the first migration is still inside the caller's transaction
    assert.equal(db.inTransaction, true);
    assert.equal(db.pragma('user_version', { simple: true }), 1);
    assert.ok(messages.some(([level, msg]) => level === 'error' && msg.startsWith('failed 002-broken.sql')));
    db.exec('ROLLBACK');
    assert.equal(db.pragma('user_version', { simple: true }), 0);

    fs.rmSync(path.join(dir, '002-broken.sql'));
    db.exec('BEGIN IMMEDIATE');
    assert.deepEqual(runMigrations(db, dir, { log, externalTransaction: true }).applied, ['001-first.sql']);
    assert.deepEqual(runMigrations(db, dir, { log, externalTransaction: true }).applied, []);
    db.exec('COMMIT');
    assert.equal(db.pragma('user_version', { simple: true }), 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations: a failure rolls the migration back, keeps the earlier version and reports the failing file', () => {
  const db = new Database(':memory:');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gate-migrations-'));
  const messages = [];
  try {
    fs.writeFileSync(path.join(dir, '001-first.sql'), 'CREATE TABLE a (x INTEGER);');
    fs.writeFileSync(path.join(dir, '002-broken.sql'), 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL;');
    assert.throws(() => runMigrations(db, dir, { log: (level, msg) => messages.push([level, msg]) }), /syntax error/);
    assert.equal(db.pragma('user_version', { simple: true }), 1);
    assert.equal(db.inTransaction, false);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'b'`).get().n, 0);
    assert.ok(messages.some(([level, msg]) => level === 'error' && msg.startsWith('failed 002-broken.sql')));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations: a version that raced in between listing and the write lock is skipped without re-applying', () => {
  const db = new Database(':memory:');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gate-migrations-'));
  try {
    fs.writeFileSync(path.join(dir, '001-first.sql'), 'CREATE TABLE a (x INTEGER);');
    fs.writeFileSync(path.join(dir, '002-second.sql'), 'CREATE TABLE b (x INTEGER);');
    const realPragma = db.pragma.bind(db);
    let reads = 0;
    // The first user_version read per migration happens under BEGIN IMMEDIATE: report it as already applied for 002.
    db.pragma = (text, options) => {
      if (text === 'user_version' && options && options.simple) {
        reads += 1;
        if (reads === 2) return 2;
      }
      return realPragma(text, options);
    };
    const result = runMigrations(db, dir, { log: () => {} });
    assert.deepEqual(result.applied, ['001-first.sql']);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'b'`).get().n, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('approval store: malformed approvals are refused before touching the table', () => {
  const { db, approvals } = setup();
  try {
    assert.throws(() => approvals.issue(null), code('EXECUTION_APPROVAL_INVALID'));
    assert.throws(() => approvals.issue([]), code('EXECUTION_APPROVAL_INVALID'));
    assert.throws(() => approvals.issue(approval({ approval_id: '' })), /approval_id must be a non-empty string/);
    assert.throws(() => approvals.issue(approval({ issued_at: '2026-08-21 04:00:00' })), /canonical UTC timestamp/);
    assert.throws(() => approvals.issue(approval({ issued_at: '2026-02-31T04:00:00.000Z' })), /canonical UTC timestamp/);
    assert.throws(() => approvals.issue(approval({ decision: 'maybe' })), /approved or denied/);
    assert.throws(() => approvals.issue(approval({ expires_at: '2026-08-21T04:00:00.000Z' })), /after issued_at/);
    assert.throws(() => approvals.issue(approval({ authorizer: undefined })), /authorizer must be an object/);
    assert.throws(() => approvals.issue(approval({ authorizer: [] })), /authorizer must be an object/);
    assert.throws(() => approvals.issue(approval({ authorizer: { id: 'owner' } })), /authorizer.type/);
    assert.throws(() => approvals.issue(approval({ resource_scope: {} })), /must not be empty/);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_approvals`).get().n, 0);
  } finally {
    db.close();
  }
});

test('approval store: payloads that are not strict JSON are refused with the offending path', () => {
  const { db, approvals } = setup();
  try {
    const cyclic = { path: 'a' };
    cyclic.self = cyclic;
    const sparse = [1];
    sparse[2] = 3;
    class Custom {}
    const refused = (scope, pattern) => assert.throws(() => approvals.issue(approval({ resource_scope: scope })), pattern);
    refused({ n: Number.NaN }, /non-finite number/);
    refused({ n: Number.POSITIVE_INFINITY }, /non-finite number/);
    refused({ f: () => 1 }, /non-JSON value/);
    refused({ u: 1n }, /non-JSON value/);
    refused(cyclic, /cyclic reference/);
    refused({ o: new Custom() }, /only plain objects/);
    refused({ list: sparse }, /sparse array/);
    refused({ nested: { list: [{ deep: new Date() }] } }, /only plain objects/);
    // a value that is JSON-clean but whose serialisation yields nothing is refused as well
    assert.throws(() => approvals.issue(approval({ resource_scope: { toJSON: undefined, a: undefined } })), ApprovalError);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_approvals`).get().n, 0);
  } finally {
    db.close();
  }
});

test('approval store: sensitive keys are refused whatever their casing, separator or suffix', () => {
  const { db, approvals } = setup();
  try {
    for (const key of ['password', 'apiKey', 'Client-Secret', 'refresh token', 'sessionCookie', 'db_password', 'deploy_token']) {
      assert.throws(
        () => approvals.issue(approval({ resource_scope: { path: 'x', [key]: 'v' } })),
        code('EXECUTION_APPROVAL_SENSITIVE_DATA'),
        key,
      );
    }
    assert.throws(
      () => approvals.issue(approval({ authorizer: { id: 'owner', type: 'human', credentials: 'x' } })),
      code('EXECUTION_APPROVAL_SENSITIVE_DATA'),
    );
    assert.throws(
      () => approvals.issue(approval({ resource_scope: { items: [{ cookie: 'c' }] } })),
      code('EXECUTION_APPROVAL_SENSITIVE_DATA'),
    );
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_approvals`).get().n, 0);
  } finally {
    db.close();
  }
});

test('approval store: an approval identifier can never be reissued and get round-trips a canonical record', () => {
  const { db, approvals } = setup();
  try {
    const issued = approvals.issue(approval({ resource_scope: { mode: 'write', path: 'docs/readme.md' } }));
    assert.deepEqual(issued.resource_scope, { mode: 'write', path: 'docs/readme.md' });
    assert.equal(issued.decision, 'approved');
    // the immutability trigger refuses the replay before the primary key does, and the store does not disguise it
    assert.throws(() => approvals.issue(approval()), /identity is immutable/);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_approvals`).get().n, 1);
    assert.equal(approvals.get('missing'), null);
    assert.throws(() => approvals.get(''), /approval_id must be a non-empty string/);
  } finally {
    db.close();
  }
});

test('approval store: an unexpected storage error is not disguised as a duplicate', () => {
  const { db } = setup();
  try {
    const store = new ExecutionApprovalStore(db);
    db.exec('DROP TABLE execution_approvals');
    assert.throws(
      () => store.issue(approval()),
      (error) => !(error instanceof ApprovalError) && /no such table/.test(error.message),
    );
    assert.throws(
      () => new ExecutionApprovalStore(db),
      (error) => /no such table/.test(error.message),
    );
  } finally {
    db.close();
  }
});

test('approval store: consume validates its request and the callback type', () => {
  const { db, approvals } = setup();
  try {
    approvals.issue(approval());
    assert.throws(() => approvals.consume(consumeRequest({ approval_id: '' })), /approval_id must be a non-empty string/);
    assert.throws(() => approvals.consume(consumeRequest({ policy_version: '' })), /policy_version/);
    assert.throws(() => approvals.consume(consumeRequest({ now: 'yesterday' })), /canonical UTC timestamp/);
    assert.throws(() => approvals.consume(consumeRequest({ resource_scope: [] })), /resource_scope must be an object/);
    assert.throws(() => approvals.consume(consumeRequest(), 'not a function'), /onConsumed must be a function/);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_approval_uses`).get().n, 0);
  } finally {
    db.close();
  }
});

test('approval store: every authorization mismatch is refused and consumes nothing', () => {
  const { db, approvals } = setup();
  try {
    approvals.issue(approval());
    approvals.issue(approval({ approval_id: 'approval-denied', operation_id: 'operation-denied', decision: 'denied' }));
    const refusals = [
      [consumeRequest({ approval_id: 'ghost' }), 'EXECUTION_APPROVAL_NOT_FOUND'],
      [consumeRequest({ approval_id: 'approval-denied', operation_id: 'operation-denied' }), 'EXECUTION_APPROVAL_DENIED'],
      [consumeRequest({ operation_id: 'operation-other' }), 'EXECUTION_APPROVAL_SCOPE_MISMATCH'],
      [consumeRequest({ policy_version: 'policy-2' }), 'EXECUTION_APPROVAL_POLICY_MISMATCH'],
      [consumeRequest({ resource_scope: { path: 'docs/readme.md', mode: 'delete' } }), 'EXECUTION_APPROVAL_SCOPE_MISMATCH'],
      [consumeRequest({ now: '2026-08-21T03:59:59.999Z' }), 'EXECUTION_APPROVAL_NOT_ACTIVE'],
      [consumeRequest({ now: '2026-08-21T05:00:00.000Z' }), 'EXECUTION_APPROVAL_EXPIRED'],
    ];
    for (const [request, expected] of refusals) assert.throws(() => approvals.consume(request), code(expected));
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_approval_uses`).get().n, 0);
  } finally {
    db.close();
  }
});

test('approval store: an approval is consumed once, its callback runs in the same transaction and a failing callback rolls back', () => {
  const { db, approvals } = setup();
  try {
    approvals.issue(approval());
    assert.throws(
      () =>
        approvals.consume(consumeRequest(), () => {
          throw new Error('callback failed');
        }),
      /callback failed/,
    );
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_approval_uses`).get().n, 0);

    let observed = null;
    const consumed = approvals.consume(consumeRequest({ resource_scope: { mode: 'write', path: 'docs/readme.md' } }), () => {
      observed = db.prepare(`SELECT COUNT(*) AS n FROM execution_approval_uses`).get().n;
    });
    assert.equal(consumed.approval_id, 'approval-1');
    assert.equal(observed, 1);
    assert.throws(() => approvals.consume(consumeRequest()), code('EXECUTION_APPROVAL_REUSED'));
    // a second approval cannot authorise an operation that was already consumed
    approvals.issue(approval({ approval_id: 'approval-2' }));
    assert.throws(() => approvals.consume(consumeRequest({ approval_id: 'approval-2' })), code('EXECUTION_APPROVAL_REUSED'));
  } finally {
    db.close();
  }
});

test('ledger: a registry that is not the concrete fail-closed one is refused at construction', () => {
  const { db } = setup();
  try {
    assert.throws(
      () => new ExecutionEventLedger(db, { event_registry: { validateForAppend() {} } }),
      (error) => error instanceof ExecutionLedgerError && error.code === 'EXECUTION_EVENT_REGISTRY_BOUNDARY_MISSING',
    );
  } finally {
    db.close();
  }
});

test('ledger: append rejects malformed requests and events with InvalidEventError', () => {
  const { db, ledger } = setup();
  try {
    const bad = (events, pattern, request = {}) =>
      assert.throws(
        () => ledger.append({ aggregate_type: 'custom_stream', aggregate_id: 'run-1', expected_version: 0, events, ...request }),
        (error) => error instanceof InvalidEventError && pattern.test(error.message),
      );
    bad([memory('a')], /expected_version/, { expected_version: -1 });
    bad([memory('a')], /expected_version/, { expected_version: 1.5 });
    bad([], /non-empty array/);
    bad('nope', /non-empty array/);
    bad([memory('a')], /aggregate_id/, { aggregate_id: '' });
    bad([memory('a')], /aggregate_type/, { aggregate_type: '' });
    bad([null], /Each event must be an object/);
    bad([memory('a', { event_id: 'not-a-uuid' })], /event_id must be a UUID/);
    bad([memory('a', { event_id: '' })], /event_id/);
    bad([memory('a', { schema_version: 0 })], /schema_version/);
    bad([memory('a', { operation_id: '' })], /operation_id/);
    bad([memory('a', { occurred_at: '2026-08-21 04:00:00' })], /canonical UTC timestamp/);
    bad([memory('a', { occurred_at: '2026-02-31T04:00:00.000Z' })], /canonical UTC timestamp/);
    bad([memory('a', { actor: [] })], /actor must be an object/);
    bad([memory('a', { actor: null })], /actor must be an object/);
    bad([memory('a', { evidence_refs: 'x' })], /evidence_refs/);
    bad([memory('a', { evidence_refs: [1] })], /evidence_refs/);
    bad([memory('a'), memory('a')], /unique within an append/);
    assert.equal(ledger.getVersion('custom_stream', 'run-1'), 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_events`).get().n, 0);
  } finally {
    db.close();
  }
});

test('ledger: non-execution streams accept a null operation, strict JSON is enforced and sensitive keys are refused', () => {
  const { db, ledger } = setup();
  try {
    const other = (payload, overrides = {}) => ({
      aggregate_type: 'custom_stream',
      aggregate_id: 'stream-1',
      expected_version: 0,
      events: [{ ...started('custom'), event_type: 'memory.written', operation_id: null, payload, ...overrides }],
    });
    const refused = (request, pattern) =>
      assert.throws(
        () => ledger.append(request),
        (error) => error instanceof InvalidEventError && pattern.test(error.message),
      );
    const cyclic = {};
    cyclic.self = cyclic;
    const sparse = [1];
    sparse[2] = 3;
    class Custom {}
    refused(other({ n: Number.NaN }), /non-finite number/);
    refused(other({ f: () => 1 }), /non-JSON value/);
    refused(other(cyclic), /cyclic reference/);
    refused(other({ o: new Custom() }), /only plain JSON objects/);
    refused(other({ list: sparse }), /sparse array slot/);
    refused(other({ list: [{ auth: 'x' }] }), /Sensitive field is forbidden in event payload: payload\.list\[0\]\.auth/);
    refused(
      other({ ok: true }, { actor: { id: 'a', type: 't', apiKey: 'k' } }),
      /Sensitive field is forbidden in event payload: actor\.apiKey/,
    );
    refused(other({ db_password: 'x' }), /payload\.db_password/);

    const appended = ledger.append(other({ list: [1, { a: null }], flag: true }));
    assert.equal(appended.current_version, 1);
    assert.equal(appended.events[0].operation_id, null);
    assert.deepEqual(appended.events[0].payload, { flag: true, list: [1, { a: null }] });
  } finally {
    db.close();
  }
});

test('ledger: optimistic concurrency, idempotent replay and conflicting replay are told apart and counted', () => {
  const { db, ledger } = setup();
  try {
    const first = appendStarted(ledger, 'run-1');
    assert.equal(first.idempotent, false);
    assert.throws(
      () => appendStarted(ledger, 'run-1', 0, 'second'),
      (error) => error instanceof ConcurrencyConflictError,
    );

    const replay = appendStarted(ledger, 'run-1');
    assert.equal(replay.idempotent, true);
    assert.equal(replay.current_version, 1);

    // same event id with different content, and a batch that is only partly known, are both conflicts
    assert.throws(
      () =>
        ledger.append({
          aggregate_type: 'execution',
          aggregate_id: 'run-1',
          expected_version: 0,
          events: [started('run-1', { causation_id: 'command-changed' })],
        }),
      (error) => error instanceof DuplicateEventError && error.code === 'EXECUTION_EVENT_ID_CONFLICT',
    );
    assert.throws(
      () =>
        ledger.append({
          aggregate_type: 'execution',
          aggregate_id: 'run-1',
          expected_version: 0,
          events: [started('run-1'), started('run-1-extra')],
        }),
      DuplicateEventError,
    );

    const metrics = ledger.metrics();
    assert.equal(metrics.append_count, 5);
    assert.equal(metrics.events_appended, 1);
    assert.equal(metrics.idempotent_replays, 1);
    assert.equal(metrics.concurrency_conflicts, 1);
    assert.equal(metrics.concurrency_conflicts_by_aggregate_type.execution, 1);
    assert.equal(metrics.event_id_conflicts, 2);
    assert.ok(metrics.append_latency_ms > 0);
    // metrics are a copy: mutating it does not leak into the ledger
    metrics.append_count_by_aggregate_type.execution = 99;
    assert.equal(ledger.metrics().append_count_by_aggregate_type.execution, 5);
  } finally {
    db.close();
  }
});

test('ledger: appendBatch is atomic across streams and refuses an empty or invalid batch', () => {
  const { db, ledger } = setup();
  try {
    assert.throws(() => ledger.appendBatch([]), /non-empty array/);
    assert.throws(() => ledger.appendBatch('x'), /non-empty array/);
    const results = ledger.appendBatch([
      { aggregate_type: 'execution', aggregate_id: 'run-a', expected_version: 0, events: [started('a')] },
      { aggregate_type: 'execution', aggregate_id: 'run-b', expected_version: 0, events: [started('b')] },
    ]);
    assert.deepEqual(
      results.map((result) => result.current_version),
      [1, 1],
    );
    assert.equal(ledger.metrics().events_appended_by_aggregate_type.execution, 2);

    // the second stream conflicts, so the first stream of the batch must not be written
    assert.throws(
      () =>
        ledger.appendBatch([
          { aggregate_type: 'execution', aggregate_id: 'run-c', expected_version: 0, events: [started('c')] },
          { aggregate_type: 'execution', aggregate_id: 'run-b', expected_version: 0, events: [started('b2')] },
        ]),
      ConcurrencyConflictError,
    );
    assert.equal(ledger.getVersion('execution', 'run-c'), 0);
    assert.equal(ledger.metrics().concurrency_conflicts, 1);

    // an identical batch replays idempotently and writes nothing new
    const replay = ledger.appendBatch([
      { aggregate_type: 'execution', aggregate_id: 'run-a', expected_version: 0, events: [started('a')] },
    ]);
    assert.equal(replay[0].idempotent, true);
    assert.throws(
      () =>
        ledger.appendBatch([
          { aggregate_type: 'execution', aggregate_id: 'run-a', expected_version: 0, events: [started('a', { causation_id: 'x' })] },
        ]),
      DuplicateEventError,
    );
    assert.equal(ledger.metrics().event_id_conflicts, 1);
  } finally {
    db.close();
  }
});

test('ledger: reads validate their arguments and honour ranges, cursors, types and aggregate filters', () => {
  const { db, ledger } = setup();
  try {
    appendStarted(ledger, 'run-1');
    ledger.append({
      aggregate_type: 'execution',
      aggregate_id: 'run-1',
      expected_version: 1,
      events: [
        {
          ...started('run-1-done'),
          event_type: 'ExecutionSucceeded',
          payload: { result: { ok: true }, output_schema_version: 1, warnings: [] },
        },
      ],
    });
    appendStarted(ledger, 'run-2');
    ledger.append({
      aggregate_type: 'custom_stream',
      aggregate_id: 'stream-1',
      expected_version: 0,
      events: [{ ...started('custom'), event_type: 'memory.written', operation_id: null, payload: { a: 1 } }],
    });

    assert.throws(() => ledger.getVersion('', 'x'), /aggregate_type/);
    assert.throws(() => ledger.getVersion('execution', ''), /aggregate_id/);
    assert.throws(() => ledger.readStream('', 'x'), /aggregate_type/);
    assert.throws(() => ledger.readStream('execution', ''), /aggregate_id/);
    assert.throws(() => ledger.readStream('execution', 'run-1', { from_version: 0 }), /Invalid stream version range/);
    assert.throws(() => ledger.readStream('execution', 'run-1', { from_version: 2, to_version: 1 }), /Invalid stream version range/);
    assert.throws(() => ledger.readStream('execution', 'run-1', { to_version: 1.5 }), /Invalid stream version range/);
    assert.deepEqual(
      ledger.readStream('execution', 'run-1', { from_version: 2 }).map((fact) => fact.event_type),
      ['ExecutionSucceeded'],
    );
    assert.equal(ledger.readStream('execution', 'run-1').length, 2);

    for (const options of [{ after_position: -1 }, { after_position: 0.5 }, { limit: 0 }, { limit: 1001 }, { limit: 1.5 }]) {
      assert.throws(() => ledger.readGlobal(options), /Invalid global stream cursor or limit/);
      assert.throws(() => ledger.readAggregates({ ...options, aggregates: [] }), /Invalid global stream cursor or limit/);
    }
    assert.throws(() => ledger.readGlobal({ aggregate_type: '' }), /aggregate_type/);
    assert.equal(ledger.readGlobal().length, 4);
    assert.deepEqual(
      ledger.readGlobal({ aggregate_type: 'custom_stream' }).map((fact) => fact.aggregate_id),
      ['stream-1'],
    );
    assert.equal(ledger.readGlobal({ after_position: 2, limit: 1 })[0].position, 3);

    assert.throws(() => ledger.readAggregates({}), /aggregates must be an array/);
    assert.throws(() => ledger.readAggregates({ aggregates: [{ aggregate_type: '', aggregate_id: 'x' }] }), /aggregate_type/);
    assert.throws(() => ledger.readAggregates({ aggregates: [{ aggregate_type: 'execution', aggregate_id: '' }] }), /aggregate_id/);
    const merged = ledger.readAggregates({
      aggregates: [
        { aggregate_type: 'execution', aggregate_id: 'run-2' },
        { aggregate_type: 'execution', aggregate_id: 'run-1' },
      ],
    });
    assert.deepEqual(
      merged.map((fact) => fact.position),
      [1, 2, 3],
    );
    assert.deepEqual(
      ledger
        .readAggregates({ after_position: 1, limit: 1, aggregates: [{ aggregate_type: 'execution', aggregate_id: 'run-1' }] })
        .map((fact) => fact.position),
      [2],
    );
  } finally {
    db.close();
  }
});

test('projections: unsupported events, missing generations and stale schemas fail closed', () => {
  const { db, ledger, projections } = setup();
  try {
    assert.throws(() => projections.reconcileActive(), code('EXECUTION_PROJECTION_NOT_ACTIVE'));
    assert.deepEqual(projections.listRuns(), []);
    assert.throws(() => projections.reconcileGeneration(99), code('EXECUTION_PROJECTION_NOT_RECONCILABLE'));
    assert.throws(() => projections._activate.immediate(99), code('EXECUTION_PROJECTION_NOT_ACTIVATABLE'));

    const health = projections.health();
    assert.equal(health.reason, 'no_active_generation');
    assert.equal(health.coverage_ratio, 1);
    appendStarted(ledger, 'run-1');
    assert.equal(projections.health().coverage_ratio, 0);
    assert.equal(projections.health().lag, 1);
    assert.equal(projections.metrics().checkpoint_position_by_projection['execution-runs'], 0);

    const generation = projections.createGeneration();
    db.prepare(`UPDATE execution_projection_generations SET schema_version = 9 WHERE generation = ?`).run(generation);
    assert.throws(() => projections.reconcileGeneration(generation), code('EXECUTION_PROJECTION_SCHEMA_MISMATCH'));
    assert.throws(() => projections._activate.immediate(generation), code('EXECUTION_PROJECTION_SCHEMA_MISMATCH'));
  } finally {
    db.close();
  }
});

test('projections: the applicator rejects events outside its catalogue and never regresses a newer state', () => {
  const unsupported = { aggregate_type: 'execution', event_type: 'ExecutionMystery', stream_sequence: 1 };
  assert.throws(() => applyExecutionRun(null, unsupported), code('EXECUTION_PROJECTION_EVENT_UNSUPPORTED'));
  // events of other aggregate families pass through untouched
  assert.equal(applyExecutionRun('state', { aggregate_type: 'other' }), 'state');
  const current = { aggregate_version: 3 };
  assert.equal(applyExecutionRun(current, { aggregate_type: 'execution', event_type: 'ExecutionStarted', stream_sequence: 3 }), current);
});

test('projections: listRuns filters by status, validates the limit and refuses an incompatible schema', () => {
  const { db, ledger, projections } = setup();
  try {
    appendStarted(ledger, 'run-1');
    appendStarted(ledger, 'run-2');
    ledger.append({
      aggregate_type: 'execution',
      aggregate_id: 'run-2',
      expected_version: 1,
      events: [
        {
          ...started('run-2-done'),
          event_type: 'ExecutionSucceeded',
          payload: { result: { ok: true }, output_schema_version: 1, warnings: [] },
        },
      ],
    });
    projections.rebuild();
    assert.deepEqual(
      projections.listRuns({ status: 'succeeded' }).map((row) => row.aggregate_id),
      ['run-2'],
    );
    assert.equal(projections.listRuns({ limit: 1 }).length, 1);
    for (const limit of [0, 1001, 1.5]) assert.throws(() => projections.listRuns({ limit }), code('INVALID_LIMIT'));
    db.prepare(`UPDATE execution_projection_generations SET schema_version = 9 WHERE status = 'active'`).run();
    assert.throws(() => projections.listRuns(), code('EXECUTION_PROJECTION_SCHEMA_MISMATCH'));
    assert.equal(projections.health().reason, 'schema_version_mismatch');
    assert.equal(projections.health().healthy, false);
  } finally {
    db.close();
  }
});

test('projections: a rebuild that cannot catch a moving ledger is exhausted, recorded and leaves the old generation active', () => {
  const { db, ledger, projections } = setup();
  try {
    appendStarted(ledger, 'run-1');
    projections.rebuild();
    let counter = 0;
    assert.throws(
      () =>
        projections.rebuild({
          max_rounds: 2,
          fault_injector(stage) {
            // every round the ledger moves on after the batch was read, so the high-water never matches
            if (stage === 'after_event') appendStarted(ledger, `moving-${(counter += 1)}`);
          },
        }),
      code('EXECUTION_PROJECTION_CATCHUP_EXHAUSTED'),
    );
    assert.equal(projections.metrics().projection_failures_by_projection['execution-runs'], 1);
    assert.equal(db.prepare(`SELECT status FROM execution_projection_generations WHERE generation = 2`).get().status, 'failed');
    assert.equal(db.prepare(`SELECT status FROM execution_projection_generations WHERE generation = 1`).get().status, 'active');
    assert.equal(projections.health().generation, 1);
  } finally {
    db.close();
  }
});

test('projections: a tampered build is not activated and the failure is recorded on the checkpoint', () => {
  const { db, ledger, projections } = setup();
  try {
    appendStarted(ledger, 'run-1');
    assert.throws(
      () =>
        projections.rebuild({
          fault_injector(stage) {
            if (stage === 'before_checkpoint') {
              db.prepare(`UPDATE execution_run_projection SET status = 'failed' WHERE aggregate_id = 'run-1'`).run();
            }
          },
        }),
      code('EXECUTION_PROJECTION_INTEGRITY_FAILED'),
    );
    assert.equal(projections.metrics().projection_failures_by_projection['execution-runs'], 1);
    assert.equal(db.prepare(`SELECT status FROM execution_projection_generations WHERE generation = 1`).get().status, 'failed');
    assert.match(
      db.prepare(`SELECT last_error FROM execution_projection_checkpoints WHERE generation = 1`).get().last_error,
      /integrity comparison failed/,
    );
  } finally {
    db.close();
  }
});

test('projections: a retry after a lost checkpoint race re-reads the checkpoint and continues', () => {
  const { db, ledger, projections } = setup();
  try {
    appendStarted(ledger, 'run-1');
    appendStarted(ledger, 'run-2');
    const generation = projections.createGeneration();
    let raced = false;
    const result = projections.reconcileGeneration(generation, {
      batch_size: 1,
      fault_injector(stage) {
        if (stage === 'before_checkpoint' && !raced) {
          raced = true;
          // a competing worker advances the checkpoint first
          db.prepare(`UPDATE execution_projection_checkpoints SET last_position = 1 WHERE generation = ?`).run(generation);
        }
      },
    });
    assert.equal(raced, true);
    assert.equal(result.checkpoint, 2);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM execution_run_projection WHERE generation = ?`).get(generation).n, 2);
  } finally {
    db.close();
  }
});

test('projections: a lagging active generation reports the lag and a recorded error outranks it', () => {
  const { db, ledger, projections } = setup();
  try {
    appendStarted(ledger, 'run-1');
    projections.rebuild();
    appendStarted(ledger, 'run-2');
    const lagging = projections.health();
    assert.equal(lagging.reason, 'projection_lag');
    assert.equal(lagging.lag, 1);
    assert.equal(lagging.healthy, false);
    db.prepare(`UPDATE execution_projection_checkpoints SET last_error = 'boom' WHERE generation = 1`).run();
    assert.equal(projections.health().reason, 'projection_error');
    assert.equal(projections.health().last_error, 'boom');
  } finally {
    db.close();
  }
});

test('environment ledger sink: its configuration and every event are validated before the ledger is touched', () => {
  const { createEnvironmentLedgerSink } = require('../packages/agent-environment');
  const { db, ledger } = setup();
  try {
    const base = { ledger, project_id: 'project-1', actor: { id: 'agent', type: 'agent' }, session_id: 'session-1' };
    const refuses = (overrides, pattern) =>
      assert.throws(
        () => createEnvironmentLedgerSink({ ...base, ...overrides }),
        (error) => error.code === 'ENV_LEDGER_SINK_INVALID' && pattern.test(error.message),
      );
    refuses({ operation_id: '' }, /operation_id must be a non-empty string or null/);
    refuses({ operation_id: 7 }, /operation_id/);
    refuses({ containsCredential: 'yes' }, /containsCredential must be a function/);
    refuses({ now: 'later' }, /now must be a function/);
    refuses({ actor: [] }, /actor object/);
    refuses({ project_id: '' }, /non-empty project_id/);
    refuses({ ledger: {} }, /requires the execution ledger/);

    const sink = createEnvironmentLedgerSink({
      ...base,
      operation_id: 'operation-env',
      containsCredential: (value) => value === 'hunter2',
    });
    for (const event of [null, 'x', {}, { type: '' }]) {
      assert.throws(
        () => sink(event),
        (error) => error.code === 'ENV_LEDGER_SINK_EVENT_INVALID',
      );
    }
    assert.equal(ledger.getVersion('environment_session', 'session-1'), 0);

    const first = sink({ type: 'memory.written', note: 'hunter2', nested: [{ keep: 'fine' }], at: 'not-a-timestamp' });
    const second = sink({ type: 'memory.written', at: '2026-08-21T04:00:00.000Z' });
    assert.equal(first.current_version, 1);
    assert.deepEqual(first.events[0].payload, { note: '[redacted]', nested: [{ keep: 'fine' }], project_id: 'project-1' });
    assert.equal(second.events[0].occurred_at, '2026-08-21T04:00:00.000Z');
    // the causation chain follows the sink: each event is caused by the previous one
    assert.equal(first.events[0].causation_id, 'session-1');
    assert.equal(second.events[0].causation_id, first.events[0].event_id);
  } finally {
    db.close();
  }
});
