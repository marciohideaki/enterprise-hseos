'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  LEGACY_SERVER_IDS,
  auditCompatibility,
  migrationDryRun,
  readDownstreamCompatibilityEvidence,
  scanInternalCompatibilityCallers,
} = require('../tools/lib/compatibility-audit');
const { McpLegacyUsageStore, readMcpLegacyActivationReadiness } = require('../tools/mcp-project-state/lib/mcp-legacy-usage-store');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');

const ROOT = path.join(__dirname, '..');
const AS_OF = new Date('2026-08-21T23:00:00.000Z');
const RELEASE_SHA = 'a'.repeat(40);
const CONFIGURATION_SHA256 = 'b'.repeat(64);

function sha256(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function writeCanonicalJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeArtifact(directory, filename, value) {
  const artifactDirectory = path.join(directory, 'artifacts');
  fs.mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  const artifactPath = path.join(artifactDirectory, filename);
  writeCanonicalJson(artifactPath, value);
  return {
    artifact_path: `artifacts/${filename}`,
    media_type: 'application/json',
    sha256: sha256(artifactPath),
  };
}

function downstreamEvidence(directory, overrides = {}) {
  const activationArtifact = writeArtifact(directory, 'release-r.json', {
    release_id: 'R',
    release_sha: RELEASE_SHA,
    published_at: '2026-07-01T00:00:00.000Z',
  });
  const compatibilityArtifact = writeArtifact(directory, 'release-r-plus-1.json', {
    release_id: 'R+1',
    predecessor_sha: RELEASE_SHA,
    published_at: '2026-08-20T23:59:59.000Z',
  });
  return {
    schema_version: 1,
    evidence_only: true,
    cutover_authorized: false,
    release_sha: RELEASE_SHA,
    configuration_sha256: CONFIGURATION_SHA256,
    release_window: {
      activation_release: 'R',
      compatibility_release: 'R+1',
      opened_at: '2026-07-01T00:00:00.000Z',
      closed_at: '2026-08-20T23:59:59.000Z',
      activation_artifact: activationArtifact,
      compatibility_artifact: compatibilityArtifact,
    },
    surfaces: ['installer-v4-detection', 'plugin-catalog-v1'].map((surfaceId, index) => {
      const inventoryArtifact = writeArtifact(directory, `${surfaceId}-inventory.json`, {
        surface_id: surfaceId,
        observed_legacy_consumers: 0,
        observed_migrated_consumers: 1,
      });
      const consumerArtifact = writeArtifact(directory, `${surfaceId}-consumer.json`, {
        surface_id: surfaceId,
        consumer_id_sha256: String(index + 1).repeat(64),
        migration_verified: true,
      });
      return {
        surface_id: surfaceId,
        legacy_consumers: 0,
        migrated_consumers: 1,
        inventory_artifact: inventoryArtifact,
        inventory_observed_at: '2026-08-20T12:00:00.000Z',
        attestations: [
          {
            consumer_id_sha256: String(index + 1).repeat(64),
            artifact: consumerArtifact,
            observed_at: '2026-08-20T12:00:00.000Z',
          },
        ],
      };
    }),
    ...overrides,
  };
}

function writeObservationScope(stateDirectory, databasePath, telemetryPath) {
  writeCanonicalJson(path.join(stateDirectory, 'harness-g9-observation-release.json'), {
    schema_version: 1,
    release_sha: RELEASE_SHA,
    configuration_sha256: CONFIGURATION_SHA256,
    telemetry_database: telemetryPath,
    state_database: databasePath,
    cutover_authorized: false,
    server_ids: LEGACY_SERVER_IDS,
    first_candidate_complete_utc_day: '2026-07-01',
  });
}

function createOperationalFixture(directory) {
  const stateDirectory = path.join(directory, '.hseos', 'state');
  fs.mkdirSync(stateDirectory, { recursive: true });
  const databasePath = path.join(stateDirectory, 'project.db');
  const db = new Database(databasePath);
  runMigrations(db, path.join(ROOT, 'tools', 'mcp-project-state', 'migrations'), { log: () => {} });
  db.prepare(`INSERT INTO as_runs (id, workflow_id, project) VALUES ('compat-run', 'fixture', '/fixture')`).run();
  db.close();
  return { databasePath, stateDirectory };
}

function fillCompleteTelemetry(databasePath) {
  const store = new McpLegacyUsageStore(databasePath);
  const end = new Date('2026-08-21T00:00:00.000Z');
  for (let daysAgo = 30; daysAgo >= 1; daysAgo -= 1) {
    const day = new Date(end.getTime() - daysAgo * 86_400_000);
    for (let hour = 0; hour < 24; hour += 1) {
      const observedAt = new Date(day.getTime() + hour * 3_600_000);
      for (const serverId of LEGACY_SERVER_IDS) store.markObservation(serverId, observedAt);
    }
  }
  store.close();
}

test('retired IDE compatibility has zero internal callers while gated runtime compatibility remains visible', () => {
  const callers = scanInternalCompatibilityCallers(ROOT);
  assert.deepEqual(callers.retired_internal_symbols, []);
  assert.equal(callers.retired_internal_symbols_zero, true);
  assert.equal(callers.legacy_runtime_zero, false);
  assert.ok(callers.active_legacy_mcp_entrypoints.length >= 4);
  assert.ok(callers.active_legacy_state_writes.length >= 3);
});

test('caller scan detects aliases, double-quoted state methods, and runtime callers under src', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-scan-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'tools', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'tools', 'windows'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'src', 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'tools', 'lib', 'legacy-mcp-server.js'), 'function startLegacyMcpServer() {}\n');
  fs.writeFileSync(
    path.join(directory, 'src', 'runtime', 'caller.js'),
    'const { startLegacyMcpServer: startOld } = require(\'../../../tools/lib/legacy-mcp-server\');\nstartOld();\ncase "state_write": break;\n',
  );
  fs.writeFileSync(path.join(directory, 'tools', 'windows', 'state.ps1'), 'sqlite3 $Db "UPDATE tasks SET status=done"\n');
  const callers = scanInternalCompatibilityCallers(directory);
  assert.equal(callers.legacy_runtime_zero, false);
  assert.deepEqual(callers.active_legacy_mcp_entrypoints, ['src/runtime/caller.js:1']);
  assert.deepEqual(callers.active_legacy_state_writes, ['tools/windows/state.ps1:1', 'src/runtime/caller.js:3']);
});

test('migration dry-run upgrades only a temporary copy and preserves every legacy table', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { databasePath } = createOperationalFixture(directory);
  const before = sha256(databasePath);
  const result = await migrationDryRun(databasePath, ROOT);
  assert.equal(result.ready, true);
  assert.equal(result.source_version, 4);
  assert.equal(result.target_version, 9);
  assert.deepEqual(result.applied, [
    '005-governed-execution-ledger-v2.sql',
    '006-execution-projections.sql',
    '007-execution-approvals.sql',
    '008-delegated-runtime-event-catalog.sql',
    '009-delegated-worker-lifecycle.sql',
  ]);
  assert.deepEqual(result.changed_legacy_tables, []);
  assert.equal(result.operational_unchanged, true);
  assert.equal(sha256(databasePath), before);
  const source = new Database(databasePath, { readonly: true });
  assert.equal(source.pragma('user_version', { simple: true }), 4);
  assert.equal(source.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'execution_events'").get().count, 0);
  assert.equal(source.prepare("SELECT COUNT(*) AS count FROM as_runs WHERE id = 'compat-run'").get().count, 1);
  source.close();
});

test('read-only telemetry evidence can become ready but never bypasses active callers or human authorization', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-ready-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { stateDirectory } = createOperationalFixture(directory);
  const telemetryPath = path.join(stateDirectory, 'mcp-legacy-usage.db');
  fillCompleteTelemetry(telemetryPath);
  const telemetryHash = sha256(telemetryPath);

  const direct = readMcpLegacyActivationReadiness(telemetryPath, { serverIds: LEGACY_SERVER_IDS, asOf: AS_OF, days: 30 });
  assert.equal(direct.ready, true);
  assert.equal(sha256(telemetryPath), telemetryHash);

  const report = await auditCompatibility({ repositoryRoot: ROOT, projectDirectory: directory, asOf: AS_OF });
  assert.equal(report.evidence.telemetry.ready, true);
  assert.equal(report.evidence.telemetry.unchanged, true);
  assert.equal(report.evidence.migration.ready, true);
  assert.equal(report.evidence.migration.operational_unchanged, true);
  assert.equal(report.evidence.callers.legacy_runtime_zero, false);
  assert.equal(report.evidence.downstream.ready, false);
  assert.equal(report.ready_for_human_gate, false);
  assert.equal(report.activation_authorized, false);
  assert.equal(report.status, 'blocked-on-evidence');
  assert.equal(sha256(telemetryPath), telemetryHash);
});

test('downstream release evidence is strict, scope-bound, integrity-checked, and never authorizes cutover', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-downstream-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const evidencePath = path.join(directory, 'downstream.json');
  const observationScope = {
    valid: true,
    release_sha: RELEASE_SHA,
    configuration_sha256: CONFIGURATION_SHA256,
  };
  writeCanonicalJson(evidencePath, downstreamEvidence(directory));
  const valid = readDownstreamCompatibilityEvidence(evidencePath, { asOf: AS_OF, observationScope });
  assert.equal(valid.ready, true);
  assert.equal(valid.evidence_only, true);
  assert.equal(valid.human_verification_required, true);
  assert.equal(valid.cutover_authorized, false);
  assert.match(valid.sha256, /^[a-f0-9]{64}$/);
  assert.equal(valid.verified_artifacts.length, 6);

  const tamperedArtifact = path.join(directory, valid.surfaces[0].inventory_artifact.artifact_path);
  writeCanonicalJson(tamperedArtifact, { forged: true });
  const tampered = readDownstreamCompatibilityEvidence(evidencePath, { asOf: AS_OF, observationScope });
  assert.equal(tampered.ready, false);
  assert.ok(tampered.errors.some((error) => error.includes('digest does not match')));

  const zeroConsumerEvidence = downstreamEvidence(directory);
  writeCanonicalJson(
    evidencePath,
    downstreamEvidence(directory, {
      surfaces: zeroConsumerEvidence.surfaces.map((surface) => ({ ...surface, migrated_consumers: 0, attestations: [] })),
    }),
  );
  const emptyInventory = readDownstreamCompatibilityEvidence(evidencePath, { asOf: AS_OF, observationScope });
  assert.equal(emptyInventory.ready, true);

  writeCanonicalJson(evidencePath, downstreamEvidence(directory, { release_sha: 'c'.repeat(40) }));
  const drifted = readDownstreamCompatibilityEvidence(evidencePath, { asOf: AS_OF, observationScope });
  assert.equal(drifted.ready, false);
  assert.ok(drifted.errors.includes('release_sha differs from observation scope'));

  writeCanonicalJson(evidencePath, downstreamEvidence(directory, { cutover_authorized: true }));
  const authorized = readDownstreamCompatibilityEvidence(evidencePath, { asOf: AS_OF, observationScope });
  assert.equal(authorized.ready, false);
  assert.ok(authorized.errors.includes('cutover_authorized must be false'));

  writeCanonicalJson(evidencePath, { ...downstreamEvidence(directory), unknown: true });
  const widened = readDownstreamCompatibilityEvidence(evidencePath, { asOf: AS_OF, observationScope });
  assert.equal(widened.ready, false);
  assert.ok(widened.errors.includes('downstream evidence envelope has unknown or missing fields'));

  const escapingEvidence = downstreamEvidence(directory);
  escapingEvidence.surfaces[0].inventory_artifact = {
    ...escapingEvidence.surfaces[0].inventory_artifact,
    artifact_path: 'artifacts/../outside.json',
  };
  writeCanonicalJson(evidencePath, escapingEvidence);
  const escaping = readDownstreamCompatibilityEvidence(evidencePath, { asOf: AS_OF, observationScope });
  assert.equal(escaping.ready, false);
  assert.ok(escaping.errors.some((error) => error.includes('normalized relative path')));

  const symbolic = path.join(directory, 'symbolic.json');
  fs.symlinkSync(evidencePath, symbolic);
  const aliased = readDownstreamCompatibilityEvidence(symbolic, { asOf: AS_OF, observationScope });
  assert.equal(aliased.ready, false);
  assert.ok(aliased.errors.some((error) => error.includes('must not traverse a symlink')));
});

test(
  'descriptor-bound evidence read rejects a pathname swapped during artifact verification',
  {
    skip: process.platform === 'win32',
  },
  (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-downstream-race-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const evidencePath = path.join(directory, 'downstream.json');
    const evidence = downstreamEvidence(directory);
    writeCanonicalJson(evidencePath, evidence);
    const target = path.join(directory, evidence.release_window.activation_artifact.artifact_path);
    const moved = `${target}.original`;
    const originalReadFileSync = fs.readFileSync;
    let descriptorReads = 0;
    fs.readFileSync = function readFileWithSwap(filename, ...args) {
      if (Number.isInteger(filename)) {
        descriptorReads += 1;
        if (descriptorReads === 2) {
          fs.renameSync(target, moved);
          writeCanonicalJson(target, { forged: true });
        }
      }
      return originalReadFileSync.call(this, filename, ...args);
    };
    let result;
    try {
      result = readDownstreamCompatibilityEvidence(evidencePath, {
        asOf: AS_OF,
        observationScope: { valid: true, release_sha: RELEASE_SHA, configuration_sha256: CONFIGURATION_SHA256 },
      });
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
    assert.equal(result.ready, false);
    assert.ok(result.errors.some((error) => error.includes('changed while it was being read')));
  },
);

test('audit reaches only the human gate when downstream evidence and every automated gate are ready', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-human-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const projectDirectory = path.join(directory, 'project');
  const repositoryRoot = path.join(directory, 'repository');
  const { databasePath, stateDirectory } = createOperationalFixture(projectDirectory);
  const telemetryPath = path.join(stateDirectory, 'mcp-legacy-usage.db');
  fillCompleteTelemetry(telemetryPath);
  writeObservationScope(stateDirectory, databasePath, telemetryPath);
  if (process.platform !== 'win32') fs.chmodSync(path.join(stateDirectory, 'harness-g9-observation-release.json'), 0o664);
  writeCanonicalJson(path.join(stateDirectory, 'harness-g9-downstream-evidence.json'), downstreamEvidence(stateDirectory));
  const pendingMigrations = path.join(repositoryRoot, 'tools', 'mcp-project-state', 'migrations-pending-activation');
  fs.mkdirSync(path.dirname(pendingMigrations), { recursive: true });
  fs.mkdirSync(pendingMigrations);
  const sourceMigrations = path.join(ROOT, 'tools', 'mcp-project-state', 'migrations-pending-activation');
  for (const filename of fs.readdirSync(sourceMigrations)) {
    fs.copyFileSync(path.join(sourceMigrations, filename), path.join(pendingMigrations, filename));
  }
  fs.mkdirSync(path.join(repositoryRoot, 'src'), { recursive: true });

  const report = await auditCompatibility({ repositoryRoot, projectDirectory, asOf: AS_OF });
  assert.equal(report.evidence.telemetry.ready, true);
  assert.equal(report.evidence.migration.ready, true);
  assert.equal(report.evidence.callers.legacy_runtime_zero, true);
  assert.equal(report.evidence.observation_scope.valid, true);
  assert.equal(report.evidence.downstream.ready, true);
  assert.equal(report.ready_for_human_gate, true);
  assert.equal(report.status, 'awaiting-human-authorization');
  assert.equal(report.activation_authorized, false);

  fs.unlinkSync(path.join(stateDirectory, 'harness-g9-downstream-evidence.json'));
  const absent = await auditCompatibility({ repositoryRoot, projectDirectory, asOf: AS_OF });
  assert.equal(absent.evidence.telemetry.ready, true);
  assert.equal(absent.evidence.migration.ready, true);
  assert.equal(absent.evidence.callers.legacy_runtime_zero, true);
  assert.equal(absent.evidence.downstream.ready, false);
  assert.equal(absent.ready_for_human_gate, false);
  assert.equal(absent.status, 'blocked-on-evidence');
});

test('sparse daily telemetry cannot produce a false green', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-sparse-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const telemetryPath = path.join(directory, 'legacy.db');
  const store = new McpLegacyUsageStore(telemetryPath);
  const end = new Date('2026-08-21T00:00:00.000Z');
  for (let daysAgo = 30; daysAgo >= 1; daysAgo -= 1) {
    const observedAt = new Date(end.getTime() - daysAgo * 86_400_000);
    for (const serverId of LEGACY_SERVER_IDS) store.markObservation(serverId, observedAt);
  }
  store.close();
  const readiness = readMcpLegacyActivationReadiness(telemetryPath, { serverIds: LEGACY_SERVER_IDS, asOf: AS_OF, days: 30 });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.gaps.length, 30 * LEGACY_SERVER_IDS.length);
  assert.ok(readiness.gaps.every((gap) => gap.covered_hours === 1));
});

test('invalid hour labels and direct usage rows cannot forge zero-use readiness', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-forged-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const invalidHourPath = path.join(directory, 'invalid-hour.db');
  fillCompleteTelemetry(invalidHourPath);
  const invalidHourDb = new Database(invalidHourPath);
  invalidHourDb.prepare("DELETE FROM mcp_legacy_observation_hourly WHERE usage_hour = '2026-08-20T23' AND server_id = 'swarm'").run();
  invalidHourDb
    .prepare(
      `INSERT INTO mcp_legacy_observation_hourly
       (usage_hour, server_id, first_observed_at, last_observed_at, heartbeat_count)
       VALUES ('2026-08-20T99', 'swarm', '2026-08-20T23:00:00.000Z', '2026-08-20T23:00:00.000Z', 1)`,
    )
    .run();
  invalidHourDb.close();
  const invalidHour = readMcpLegacyActivationReadiness(invalidHourPath, { serverIds: LEGACY_SERVER_IDS, asOf: AS_OF, days: 30 });
  assert.equal(invalidHour.ready, false);
  assert.ok(invalidHour.integrity_errors.some((error) => error.kind === 'invalid_usage_hour'));
  assert.ok(invalidHour.gaps.some((gap) => gap.day === '2026-08-20' && gap.server_id === 'swarm' && gap.covered_hours === 23));

  const directUsagePath = path.join(directory, 'direct-usage.db');
  fillCompleteTelemetry(directUsagePath);
  const directUsageDb = new Database(directUsagePath);
  directUsageDb
    .prepare(
      `INSERT INTO mcp_legacy_usage_daily
       (usage_day, server_id, client_hash, client_label, protocol_version, request_count, first_seen_at, last_seen_at, sunset)
       VALUES ('2026-08-20', 'swarm', ?, 'forged', '2024-11-05', 1, ?, ?, 'fixture')`,
    )
    .run('a'.repeat(64), '2026-08-20T23:00:00.000Z', '2026-08-20T23:00:00.000Z');
  directUsageDb.close();
  const directUsage = readMcpLegacyActivationReadiness(directUsagePath, { serverIds: LEGACY_SERVER_IDS, asOf: AS_OF, days: 30 });
  assert.equal(directUsage.ready, false);
  assert.deepEqual(directUsage.legacy_use, [{ count: 1, day: '2026-08-20', server_id: 'swarm' }]);
  assert.ok(directUsage.integrity_errors.some((error) => error.kind === 'usage_counter_mismatch'));
});

test('dry-run rejects links and live SQLite sidecars before opening operational state', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-links-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { databasePath } = createOperationalFixture(directory);
  const sourceHash = sha256(databasePath);
  const symbolic = path.join(directory, 'symbolic.db');
  const hard = path.join(directory, 'hard.db');
  fs.symlinkSync(databasePath, symbolic);
  await assert.rejects(() => migrationDryRun(symbolic, ROOT), /non-symlink/);
  fs.linkSync(databasePath, hard);
  await assert.rejects(() => migrationDryRun(databasePath, ROOT), /hard-linked/);
  fs.unlinkSync(hard);
  fs.writeFileSync(`${databasePath}-wal`, 'unstable');
  await assert.rejects(() => migrationDryRun(databasePath, ROOT), /SQLite sidecars/);
  fs.unlinkSync(`${databasePath}-wal`);
  const writer = new Database(databasePath);
  writer.exec('BEGIN IMMEDIATE');
  writer.prepare("UPDATE as_runs SET phase = 'study' WHERE id = 'compat-run'").run();
  assert.equal(fs.existsSync(`${databasePath}-journal`), true);
  await assert.rejects(() => migrationDryRun(databasePath, ROOT), /SQLite sidecars/);
  writer.exec('ROLLBACK');
  writer.close();
  assert.equal(sha256(databasePath), sourceHash);
});
