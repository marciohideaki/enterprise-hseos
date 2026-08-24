'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');

const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const {
  applyExecutionLedgerFixtureSchema,
  createExecutionLedgerFileFixture,
  ExecutionLedgerActivationError,
} = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const {
  ConcurrencyConflictError,
  DuplicateEventError,
  ExecutionEventLedger,
  InvalidEventError,
} = require('../tools/mcp-project-state/lib/execution-event-ledger');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');
const LEDGER_MODULE = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'lib', 'execution-event-ledger.js');

function openDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  return db;
}

function eventId(label) {
  const hex = createHash('sha256').update(label).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function event(id, overrides = {}) {
  const eventType = overrides.event_type || 'ExecutionStarted';
  const payloadByType = {
    ExecutionStarted: {
      tool: 'fixture.echo',
      provider: 'fixture-provider',
      idempotency_key: `idempotency-${id}`,
      dispatch_attempt: 1,
      deadline: '2026-08-21T04:01:00.000Z',
    },
    ExecutionSucceeded: { result: { fixture: id }, output_schema_version: 1, warnings: [] },
  };
  return {
    event_id: eventId(id),
    event_type: eventType,
    schema_version: 1,
    occurred_at: '2026-08-21T04:00:00.000Z',
    correlation_id: 'corr-1',
    causation_id: `command-${id}`,
    actor: { id: 'human-1', type: 'human' },
    operation_id: `operation-${id}`,
    payload: payloadByType[eventType],
    evidence_refs: ['evidence://fixture'],
    ...overrides,
  };
}

test('operational runner stays at v4 and the gated fixture migration creates schema v2', () => {
  const db = new Database(':memory:');
  try {
    runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
    assert.equal(db.pragma('user_version', { simple: true }), 4);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'execution_events'`).get().count, 0);
    db.prepare(`INSERT INTO as_runs (id, workflow_id, project) VALUES ('legacy-run', 'fixture', '/tmp/project')`).run();
    applyExecutionLedgerFixtureSchema(db);
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM as_runs WHERE id = 'legacy-run'`).get().count, 1);
    const columns = new Set(db.prepare(`PRAGMA table_info(execution_events)`).all().map((column) => column.name));
    for (const field of [
      'position',
      'event_id',
      'event_type',
      'aggregate_id',
      'aggregate_type',
      'stream_sequence',
      'schema_version',
      'occurred_at',
      'correlation_id',
      'causation_id',
      'actor_json',
      'operation_id',
      'payload_json',
      'evidence_refs_json',
    ]) {
      assert.ok(columns.has(field), `missing ${field}`);
    }
  } finally {
    db.close();
  }
});

test('fixture schema gate rejects an operational database path', () => {
  assert.throws(() => applyExecutionLedgerFixtureSchema({ name: '/opt/hseos/project.db' }), ExecutionLedgerActivationError);
});

test('fixture schema gate rejects symlink and hardlink aliases under /tmp', () => {
  const outsideRoot = fs.mkdtempSync('/var/tmp/hseos-ledger-gate-target-');
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-ledger-gate-alias-'));
  const target = path.join(outsideRoot, 'operational.sqlite');
  const seed = new Database(target);
  seed.close();
  const aliases = [path.join(aliasRoot, 'symlink.sqlite'), path.join(aliasRoot, 'hardlink.sqlite')];
  fs.symlinkSync(target, aliases[0]);
  fs.linkSync(target, aliases[1]);
  try {
    for (const alias of aliases) {
      const db = new Database(alias);
      try {
        assert.throws(() => applyExecutionLedgerFixtureSchema(db), ExecutionLedgerActivationError);
      } finally {
        db.close();
      }
    }
    const verify = new Database(target, { readonly: true });
    try {
      assert.equal(verify.pragma('user_version', { simple: true }), 0);
      assert.equal(verify.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'execution_events'`).get().count, 0);
    } finally {
      verify.close();
    }
  } finally {
    fs.rmSync(aliasRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('compare-and-append produces monotonic stream versions and global positions', () => {
  const db = openDatabase();
  try {
    const ledger = new ExecutionEventLedger(db);
    const first = ledger.append({
      aggregate_type: 'execution',
      aggregate_id: 'run-1',
      expected_version: 0,
      events: [event('event-1'), event('event-2', { event_type: 'ExecutionSucceeded' })],
    });
    const second = ledger.append({
      aggregate_type: 'execution',
      aggregate_id: 'run-2',
      expected_version: 0,
      events: [event('event-3')],
    });

    assert.equal(first.current_version, 2);
    assert.deepEqual(first.events.map((item) => item.stream_sequence), [1, 2]);
    assert.deepEqual([...first.events, ...second.events].map((item) => item.position), [1, 2, 3]);
    assert.deepEqual(ledger.readStream('execution', 'run-1').map((item) => item.event_id), [eventId('event-1'), eventId('event-2')]);
    assert.deepEqual(ledger.readStream('execution', 'run-1', { from_version: 2, to_version: 2 }).map((item) => item.event_id), [
      eventId('event-2'),
    ]);
    assert.deepEqual(ledger.readGlobal({ after_position: 1 }).map((item) => item.event_id), [eventId('event-2'), eventId('event-3')]);
    assert.deepEqual(ledger.readGlobal({ after_position: 1, limit: 1 }).map((item) => item.event_id), [eventId('event-2')]);
  } finally {
    db.close();
  }
});

test('a failure on the second row rolls back the complete append batch', () => {
  const db = openDatabase();
  try {
    const ledger = new ExecutionEventLedger(db);
    const rejectedId = eventId('batch-second');
    db.exec(`
      CREATE TRIGGER reject_batch_second
      BEFORE INSERT ON execution_events WHEN NEW.event_id = '${rejectedId}'
      BEGIN SELECT RAISE(ABORT, 'injected second-row failure'); END;
    `);
    assert.throws(
      () =>
        ledger.append({
          aggregate_type: 'execution',
          aggregate_id: 'batch-run',
          expected_version: 0,
          events: [event('batch-first'), event('batch-second')],
        }),
      /injected second-row failure/,
    );
    assert.equal(ledger.getVersion('execution', 'batch-run'), 0);
    assert.equal(ledger.readGlobal().length, 0);
  } finally {
    db.close();
  }
});

test('stale expected_version fails with a typed conflict and no implicit retry', () => {
  const db = openDatabase();
  try {
    const ledger = new ExecutionEventLedger(db);
    ledger.append({ aggregate_type: 'execution', aggregate_id: 'run-1', expected_version: 0, events: [event('event-1')] });
    assert.throws(
      () =>
        ledger.append({ aggregate_type: 'execution', aggregate_id: 'run-1', expected_version: 0, events: [event('event-2')] }),
      (error) =>
        error instanceof ConcurrencyConflictError &&
        error.code === 'EXECUTION_STREAM_VERSION_CONFLICT' &&
        error.details.current_version === 1,
    );
    assert.equal(ledger.getVersion('execution', 'run-1'), 1);
    assert.equal(ledger.metrics().concurrency_conflicts, 1);
    assert.deepEqual(ledger.metrics().concurrency_conflicts_by_aggregate_type, { execution: 1 });
  } finally {
    db.close();
  }
});

test('an exact event-id retry is idempotent while changed or partial reuse fails', () => {
  const db = openDatabase();
  try {
    const ledger = new ExecutionEventLedger(db);
    const request = {
      aggregate_type: 'execution',
      aggregate_id: 'run-1',
      expected_version: 0,
      events: [event('event-1'), event('event-2')],
    };
    ledger.append(request);
    ledger.append({
      aggregate_type: 'execution',
      aggregate_id: 'run-1',
      expected_version: 2,
      events: [event('event-later')],
    });
    const replay = ledger.append(request);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.current_version, 3, 'late replay reports the stream current version, not the operation end version');
    assert.equal(ledger.getVersion('execution', 'run-1'), 3);
    assert.equal(ledger.metrics().idempotent_replays, 1);

    assert.throws(
      () =>
        ledger.append({
          ...request,
          events: [event('event-1', { payload: { ...event('event-1').payload, provider: 'changed-provider' } }), event('event-2')],
        }),
      DuplicateEventError,
    );
    assert.throws(
      () => ledger.append({ ...request, events: [event('event-1'), event('event-new')] }),
      DuplicateEventError,
    );
    assert.equal(ledger.getVersion('execution', 'run-1'), 3);
  } finally {
    db.close();
  }
});

test('append metrics are dimensioned by aggregate type and defensively copied', () => {
  const db = openDatabase();
  try {
    const ledger = new ExecutionEventLedger(db);
    const executionRequest = {
      aggregate_type: 'execution',
      aggregate_id: 'run-1',
      expected_version: 0,
      events: [event('metric-1'), event('metric-2')],
    };
    ledger.append(executionRequest);
    ledger.append(executionRequest);
    ledger.append({ aggregate_type: 'approval', aggregate_id: 'approval-1', expected_version: 0, events: [event('metric-3')] });

    const metrics = ledger.metrics();
    assert.deepEqual(metrics.append_count_by_aggregate_type, { execution: 2, approval: 1 });
    assert.deepEqual(metrics.events_appended_by_aggregate_type, { execution: 2, approval: 1 });
    assert.deepEqual(metrics.concurrency_conflicts_by_aggregate_type, {});
    metrics.events_appended_by_aggregate_type.execution = 999;
    assert.equal(ledger.metrics().events_appended_by_aggregate_type.execution, 2);
  } finally {
    db.close();
  }
});

test('ledger rows reject update/delete/replace and sensitive payload fields', () => {
  const db = openDatabase();
  try {
    const ledger = new ExecutionEventLedger(db);
    for (const sensitiveKey of ['api_key', 'apiKey', 'client-secret', 'authorization', 'token', 'cookie', 'nestedApprovalToken']) {
      assert.throws(
        () =>
          ledger.append({
            aggregate_type: 'fixture',
            aggregate_id: 'run-1',
            expected_version: 0,
            events: [event(`event-secret-${sensitiveKey}`, { payload: { nested: { [sensitiveKey]: 'must-not-persist' } } })],
          }),
        InvalidEventError,
        sensitiveKey,
      );
    }
    assert.doesNotThrow(() =>
      ledger.append({
        aggregate_type: 'fixture',
        aggregate_id: 'safe-run',
        expected_version: 0,
        events: [event('event-safe-counters', { payload: { idempotency_key: 'public-operation-id', token_count: 42 } })],
      }),
    );
    ledger.append({ aggregate_type: 'execution', aggregate_id: 'run-1', expected_version: 0, events: [event('event-1')] });
    assert.throws(() => db.prepare(`UPDATE execution_events SET event_type = 'Changed'`).run(), /append-only/);
    assert.throws(() => db.prepare(`DELETE FROM execution_events`).run(), /append-only/);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT OR REPLACE INTO execution_events (
               event_id, event_type, aggregate_id, aggregate_type, stream_sequence,
               schema_version, occurred_at, correlation_id, actor_json, operation_id,
               payload_json, evidence_refs_json
             ) VALUES (?, 'Tampered', 'run-1', 'execution', 1, 1, ?, 'corr-1', '{}', 'tampered', '{}', '[]')`,
          )
          .run(eventId('event-1'), '2026-08-21T04:00:00.000Z'),
      /identity is immutable/,
    );
    assert.equal(ledger.getVersion('execution', 'run-1'), 1);
    assert.equal(ledger.readStream('execution', 'run-1')[0].event_type, 'ExecutionStarted');
  } finally {
    db.close();
  }
});

test('payload and actor require strict lossless JSON values', () => {
  const db = openDatabase();
  try {
    const ledger = new ExecutionEventLedger(db);
    const cyclic = {};
    cyclic.self = cyclic;
    const sparse = [];
    sparse.length = 1;
    const invalidValues = [Number.NaN, Number.POSITIVE_INFINITY, undefined, () => true, 1n, new Date(), cyclic, sparse];
    for (const [index, invalid] of invalidValues.entries()) {
      assert.throws(
        () =>
          ledger.append({
            aggregate_type: 'fixture',
            aggregate_id: `invalid-${index}`,
            expected_version: 0,
            events: [event(`invalid-${index}`, { payload: { value: invalid } })],
          }),
        InvalidEventError,
      );
    }
    assert.throws(
      () =>
        ledger.append({
          aggregate_type: 'fixture',
          aggregate_id: 'invalid-actor',
          expected_version: 0,
          events: [event('invalid-actor', { actor: { id: 'human', metadata: { value: undefined } } })],
        }),
      InvalidEventError,
    );

    const payload = { amount: 10.5, flags: [true, false, null], nested: { unicode: 'ação' } };
    const result = ledger.append({
      aggregate_type: 'fixture',
      aggregate_id: 'lossless',
      expected_version: 0,
      events: [event('lossless', { payload })],
    });
    assert.deepEqual(result.events[0].payload, payload);
  } finally {
    db.close();
  }
});

test('ES-10 identifiers and timestamps fail closed', () => {
  const db = openDatabase();
  try {
    const ledger = new ExecutionEventLedger(db);
    for (const overrides of [
      { event_id: 'not-a-uuid' },
      { occurred_at: '2026-08-21' },
      { occurred_at: '2026-08-21T04:00:00+00:00' },
      { occurred_at: '2026-02-30T04:00:00.000Z' },
      { occurred_at: '2026-04-31T04:00:00.000Z' },
      { causation_id: null },
    ]) {
      assert.throws(
        () =>
          ledger.append({
            aggregate_type: 'execution',
            aggregate_id: 'invalid-es10',
            expected_version: 0,
            events: [event('invalid-es10', overrides)],
          }),
        InvalidEventError,
      );
    }
    assert.doesNotThrow(() =>
      ledger.append({
        aggregate_type: 'execution',
        aggregate_id: 'valid-leap-day',
        expected_version: 0,
        events: [event('valid-leap-day', { occurred_at: '2028-02-29T04:00:00.000Z' })],
      }),
    );
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO execution_events (
             event_id, event_type, aggregate_id, aggregate_type, stream_sequence, schema_version,
             occurred_at, correlation_id, causation_id, actor_json, operation_id, payload_json, evidence_refs_json
           ) VALUES (?, 'ExecutionStarted', 'raw-invalid', 'execution', 1, 1, ?, 'corr', 'cause', '{}', 'op', '{}', '[]')`,
        )
        .run('12345678-1234-1234-1234-12345678901-', '2026-08-21T04:00:00.000Z'),
    );
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO execution_events (
             event_id, event_type, aggregate_id, aggregate_type, stream_sequence, schema_version,
             occurred_at, correlation_id, causation_id, actor_json, operation_id, payload_json, evidence_refs_json
           ) VALUES (?, 'ExecutionStarted', 'raw-invalid-date', 'execution', 1, 1, ?, 'corr', 'cause', '{}', 'op', '{}', '[]')`,
        )
        .run(eventId('raw-invalid-date'), '2026-13-01T04:00:00.000Z'),
    );
  } finally {
    db.close();
  }
});

test('concurrent connections yield unique monotonic sequences with explicit caller retry', async () => {
  const fixture = createExecutionLedgerFileFixture();
  const { filename } = fixture;
  fixture.db.close();

  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require('better-sqlite3');
    const { ExecutionEventLedger, ConcurrencyConflictError } = require(workerData.modulePath);
    const db = new Database(workerData.filename);
    db.pragma('busy_timeout = 5000');
    const ledger = new ExecutionEventLedger(db);
    let conflicts = 0;
    for (;;) {
      const expected = ledger.getVersion('execution', workerData.aggregateId);
      try {
        const result = ledger.append({
          aggregate_type: 'execution', aggregate_id: workerData.aggregateId, expected_version: expected,
          events: [{
            event_id: workerData.eventId, event_type: 'ExecutionStarted', schema_version: 1,
            occurred_at: '2026-08-21T04:00:00.000Z', correlation_id: 'concurrent', causation_id: 'command-' + workerData.eventId,
            actor: { type: 'worker', id: workerData.eventId }, operation_id: workerData.eventId,
            payload: {
              tool: 'fixture.concurrent', provider: 'fixture-provider', idempotency_key: workerData.eventId,
              dispatch_attempt: 1, deadline: '2026-08-21T04:01:00.000Z'
            }, evidence_refs: []
          }]
        });
        parentPort.postMessage({ sequence: result.events[0].stream_sequence, position: result.events[0].position, conflicts });
        break;
      } catch (error) {
        if (error instanceof ConcurrencyConflictError || error.code === 'SQLITE_BUSY') { conflicts++; continue; }
        throw error;
      }
    }
    db.close();
  `;

  try {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(workerSource, {
            eval: true,
            workerData: { aggregateId: 'concurrent-run', eventId: eventId(`worker-${index}`), filename, modulePath: LEDGER_MODULE },
          });
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`worker exited ${code}`));
          });
        }),
      ),
    );
    const sequences = results.map((result) => result.sequence).sort((a, b) => a - b);
    const positions = results.map((result) => result.position).sort((a, b) => a - b);
    assert.deepEqual(sequences, Array.from({ length: 12 }, (_, index) => index + 1));
    assert.deepEqual(positions, Array.from({ length: 12 }, (_, index) => index + 1));

    const independentResults = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(workerSource, {
            eval: true,
            workerData: {
              aggregateId: `independent-run-${index}`,
              eventId: eventId(`independent-worker-${index}`),
              filename,
              modulePath: LEDGER_MODULE,
            },
          });
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`worker exited ${code}`));
          });
        }),
      ),
    );
    assert.deepEqual(
      independentResults.map((result) => result.position).sort((a, b) => a - b),
      Array.from({ length: 12 }, (_, index) => index + 13),
    );

    const verifyDb = new Database(filename, { readonly: true });
    try {
      const rows = new ExecutionEventLedger(verifyDb).readStream('execution', 'concurrent-run');
      assert.equal(rows.length, 12);
      assert.equal(new Set(rows.map((row) => row.event_id)).size, 12);
      assert.equal(new ExecutionEventLedger(verifyDb).readGlobal({ limit: 100 }).length, 24);
    } finally {
      verifyDb.close();
    }
  } finally {
    fixture.cleanup();
  }
});
