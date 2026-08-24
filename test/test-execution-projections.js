'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { applyExecutionRun, ExecutionProjectionStore } = require('../tools/mcp-project-state/lib/execution-projections');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');

function eventId(label) {
  const hex = createHash('sha256').update(label).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function event(label, event_type = 'ExecutionStarted') {
  const payloadByType = {
    ExecutionStarted: {
      tool: 'fixture.echo',
      provider: 'fixture-provider',
      idempotency_key: `idempotency-${label}`,
      dispatch_attempt: 1,
      deadline: '2026-08-21T04:01:00.000Z',
    },
    ExecutionSucceeded: { result: { fixture: label }, output_schema_version: 1, warnings: [] },
  };
  return {
    event_id: eventId(label),
    event_type,
    schema_version: 1,
    occurred_at: '2026-08-21T04:00:00.000Z',
    correlation_id: 'projection-test',
    causation_id: `command-${label}`,
    actor: { id: 'fixture', type: 'test' },
    operation_id: `operation-${label}`,
    payload: payloadByType[event_type],
    evidence_refs: [],
  };
}

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const ledger = new ExecutionEventLedger(db);
  const projections = new ExecutionProjectionStore(db, ledger);
  return { db, ledger, projections };
}

function append(ledger, aggregate_id, expected_version, facts) {
  return ledger.append({ aggregate_type: 'execution', aggregate_id, expected_version, events: facts });
}

test('fixture schema includes projection migration 006 while operational runner remains v4', () => {
  const db = new Database(':memory:');
  try {
    runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
    assert.equal(db.pragma('user_version', { simple: true }), 4);
    applyExecutionLedgerFixtureSchema(db);
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'execution_projection_checkpoints'`).get().count, 1);
  } finally {
    db.close();
  }
});

test('execution applicator is pure and deterministic', () => {
  const fact = {
    aggregate_type: 'execution',
    aggregate_id: 'run-1',
    stream_sequence: 1,
    operation_id: 'operation-1',
    event_type: 'ExecutionStarted',
    occurred_at: '2026-08-21T04:00:00.000Z',
    position: 1,
  };
  const frozen = Object.freeze({ ...fact });
  assert.deepEqual(applyExecutionRun(null, frozen), applyExecutionRun(null, frozen));
  assert.equal(frozen.event_type, 'ExecutionStarted');
});

test('rebuild creates and atomically activates a complete generation', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('r1-start')]);
    append(ledger, 'run-1', 1, [event('r1-success', 'ExecutionSucceeded')]);
    append(ledger, 'run-2', 0, [event('r2-start')]);
    const rebuilt = projections.rebuild({ batch_size: 1 });
    assert.equal(rebuilt.generation, 1);
    assert.deepEqual(
      projections.listRuns().map((row) => [row.aggregate_id, row.status]),
      [
        ['run-2', 'running'],
        ['run-1', 'succeeded'],
      ],
    );
    assert.deepEqual(projections.health(), {
      healthy: true,
      reason: 'ok',
      generation: 1,
      ledger_high_water: 3,
      checkpoint: 3,
      lag: 0,
      source_count: 2,
      projected_count: 2,
      coverage_ratio: 1,
      mismatch_count: 0,
      last_error: null,
      schema_version: 1,
      expected_schema_version: 1,
    });
    assert.equal(projections.metrics().events_processed_by_projection['execution-runs'], 3);
    assert.ok(projections.metrics().processing_lag_ms_by_projection['execution-runs'] >= 0);
    assert.equal(projections.metrics().checkpoint_position_by_projection['execution-runs'], 3);
  } finally {
    db.close();
  }
});

test('crash after apply but before checkpoint rolls back and reconcile catches up exactly once', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('start')]);
    projections.rebuild();
    append(ledger, 'run-1', 1, [event('success', 'ExecutionSucceeded')]);
    assert.throws(
      () =>
        projections.reconcileActive({
          fault_injector(stage) {
            if (stage === 'before_checkpoint') throw new Error('injected crash');
          },
        }),
      /injected crash/,
    );
    assert.equal(projections.listRuns()[0].status, 'running');
    assert.equal(projections.health().reason, 'projection_error');
    assert.equal(projections.health().checkpoint, 1);

    const recovered = projections.reconcileActive();
    assert.equal(recovered.processed, 1);
    assert.equal(projections.listRuns()[0].status, 'succeeded');
    assert.equal(projections.listRuns()[0].aggregate_version, 2);
    assert.equal(projections.health().healthy, true);
    assert.equal(projections.reconcileActive().processed, 0);
    assert.equal(projections.metrics().projection_failures_by_projection['execution-runs'], 1);
  } finally {
    db.close();
  }
});

test('failed side-by-side rebuild leaves the previous active generation visible', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('start')]);
    projections.rebuild();
    assert.throws(
      () =>
        projections.rebuild({
          fault_injector(stage) {
            if (stage === 'after_event') throw new Error('rebuild failed');
          },
        }),
      /rebuild failed/,
    );
    assert.equal(projections.listRuns()[0].status, 'running');
    assert.equal(projections.health().generation, 1);
    const failed = db.prepare(`SELECT status FROM execution_projection_generations WHERE generation = 2`).get();
    assert.equal(failed.status, 'failed');
  } finally {
    db.close();
  }
});

test('a successful side-by-side rebuild switches generations only at full high-water', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('start')]);
    projections.rebuild();
    append(ledger, 'run-1', 1, [event('success', 'ExecutionSucceeded')]);
    const rebuilt = projections.rebuild({ batch_size: 1 });
    assert.equal(rebuilt.generation, 2);
    assert.equal(projections.listRuns()[0].status, 'succeeded');
    const statuses = db
      .prepare(`SELECT generation, status FROM execution_projection_generations ORDER BY generation`)
      .all();
    assert.deepEqual(statuses, [
      { generation: 1, status: 'retired' },
      { generation: 2, status: 'active' },
    ]);
  } finally {
    db.close();
  }
});

test('health rejects false-green coverage even when checkpoint reaches high-water', () => {
  const { db, ledger, projections } = setup();
  try {
    for (let index = 1; index <= 14; index++) append(ledger, `run-${index}`, 0, [event(`start-${index}`)]);
    projections.rebuild();
    db.prepare(`DELETE FROM execution_run_projection WHERE generation = 1 AND aggregate_id NOT IN ('run-1', 'run-2')`).run();
    const health = projections.health();
    assert.equal(health.healthy, false);
    assert.equal(health.reason, 'coverage_gap');
    assert.equal(health.checkpoint, 14);
    assert.equal(health.source_count, 14);
    assert.equal(health.projected_count, 2);
    assert.equal(health.coverage_ratio, 2 / 14);
    assert.equal(health.mismatch_count, 12);
  } finally {
    db.close();
  }
});

test('health rejects equal-count projections with stale aggregate versions', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('start')]);
    append(ledger, 'run-1', 1, [event('success', 'ExecutionSucceeded')]);
    projections.rebuild();
    db.prepare(`UPDATE execution_run_projection SET aggregate_version = 1 WHERE generation = 1`).run();
    const health = projections.health();
    assert.equal(health.source_count, 1);
    assert.equal(health.projected_count, 1);
    assert.equal(health.coverage_ratio, 1);
    assert.equal(health.mismatch_count, 1);
    assert.equal(health.healthy, false);
    assert.equal(health.reason, 'integrity_gap');
  } finally {
    db.close();
  }
});

test('health rejects semantically altered rows with matching version and position', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('start')]);
    projections.rebuild();
    db.prepare(
      `UPDATE execution_run_projection
       SET operation_id = 'operation-tampered', status = 'succeeded',
           last_event_type = 'ExecutionSucceeded', last_occurred_at = '2026-08-21T05:00:00.000Z'
       WHERE generation = 1 AND aggregate_id = 'run-1'`,
    ).run();
    const health = projections.health();
    assert.equal(health.healthy, false);
    assert.equal(health.reason, 'integrity_gap');
    assert.equal(health.coverage_ratio, 1);
    assert.equal(health.mismatch_count, 1);
  } finally {
    db.close();
  }
});

test('an ineligible candidate cannot retire the active generation', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('start')]);
    projections.rebuild();
    const candidate = projections.createGeneration();
    projections.reconcileGeneration(candidate);
    db.prepare(
      `UPDATE execution_projection_generations SET status = 'failed'
       WHERE projection_name = 'execution-runs' AND generation = ?`,
    ).run(candidate);

    assert.throws(
      () => projections._activate.immediate(candidate),
      (error) => error.code === 'EXECUTION_PROJECTION_NOT_ACTIVATABLE',
    );
    assert.deepEqual(
      db.prepare(`SELECT generation, status FROM execution_projection_generations ORDER BY generation`).all(),
      [
        { generation: 1, status: 'active' },
        { generation: 2, status: 'failed' },
      ],
    );
    assert.equal(projections.health().healthy, true);
  } finally {
    db.close();
  }
});

test('a stale worker batch cannot regress an advanced checkpoint', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('start')]);
    append(ledger, 'run-2', 0, [event('start-2')]);
    const generation = projections.createGeneration();
    const staleBatch = ledger.readGlobal({ after_position: 0, limit: 1 });
    projections.reconcileGeneration(generation);

    assert.throws(
      () => projections._applyBatch.immediate(generation, 0, staleBatch, null),
      (error) => error.code === 'EXECUTION_PROJECTION_CHECKPOINT_CONFLICT',
    );
    assert.equal(
      db.prepare(
        `SELECT last_position FROM execution_projection_checkpoints
         WHERE projection_name = 'execution-runs' AND generation = ?`,
      ).get(generation).last_position,
      2,
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM execution_run_projection WHERE generation = ?`).get(generation).count,
      2,
    );
  } finally {
    db.close();
  }
});

test('health reports a checkpoint ahead of the ledger instead of false ok', () => {
  const { db, projections } = setup();
  try {
    projections.rebuild();
    db.prepare(
      `UPDATE execution_projection_checkpoints SET last_position = 1
       WHERE projection_name = 'execution-runs' AND generation = 1`,
    ).run();
    const health = projections.health();
    assert.equal(health.healthy, false);
    assert.equal(health.reason, 'checkpoint_ahead');
    assert.equal(health.lag, -1);
  } finally {
    db.close();
  }
});

test('an incompatible active projection fails health and reads closed', () => {
  const { db, projections } = setup();
  try {
    projections.rebuild();
    db.prepare(
      `UPDATE execution_projection_generations SET schema_version = 999
       WHERE projection_name = 'execution-runs' AND generation = 1`,
    ).run();
    const health = projections.health();
    assert.equal(health.healthy, false);
    assert.equal(health.reason, 'schema_version_mismatch');
    assert.equal(health.schema_version, 999);
    assert.equal(health.expected_schema_version, 1);
    assert.throws(
      () => projections.listRuns(),
      (error) => error.code === 'EXECUTION_PROJECTION_SCHEMA_MISMATCH',
    );
    assert.throws(
      () => projections.reconcileActive(),
      (error) => error.code === 'EXECUTION_PROJECTION_SCHEMA_MISMATCH',
    );
  } finally {
    db.close();
  }
});

test('an incompatible candidate cannot be activated', () => {
  const { db, ledger, projections } = setup();
  try {
    append(ledger, 'run-1', 0, [event('start')]);
    projections.rebuild();
    const candidate = projections.createGeneration();
    projections.reconcileGeneration(candidate);
    db.prepare(
      `UPDATE execution_projection_generations SET schema_version = 999
       WHERE projection_name = 'execution-runs' AND generation = ?`,
    ).run(candidate);
    assert.throws(
      () => projections._activate.immediate(candidate),
      (error) => error.code === 'EXECUTION_PROJECTION_SCHEMA_MISMATCH',
    );
    assert.equal(
      db.prepare(
        `SELECT generation FROM execution_projection_generations
         WHERE projection_name = 'execution-runs' AND status = 'active'`,
      ).get().generation,
      1,
    );
  } finally {
    db.close();
  }
});
