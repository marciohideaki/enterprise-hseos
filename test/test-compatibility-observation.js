'use strict';

const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LEGACY_SERVER_IDS } = require('../tools/lib/compatibility-audit');
const { assertLiveTelemetryTarget, monitorCompatibilityObservation } = require('../tools/lib/compatibility-observation');
const { McpLegacyUsageStore } = require('../tools/mcp-project-state/lib/mcp-legacy-usage-store');

const AS_OF = new Date('2026-08-31T12:30:00.000Z');

function sha256(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function fingerprints(databasePath) {
  return Object.fromEntries(
    [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]
      .filter((filename) => fs.existsSync(filename))
      .map((filename) => [path.basename(filename), { bytes: fs.statSync(filename).size, sha256: sha256(filename) }]),
  );
}

function fixture(t, { firstCandidateDay = '2026-08-01' } = {}) {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-observe-'));
  t.after(() => fs.rmSync(projectDirectory, { recursive: true, force: true }));
  const stateDirectory = path.join(projectDirectory, '.hseos', 'state');
  fs.mkdirSync(stateDirectory, { recursive: true });
  const telemetryDatabase = path.join(stateDirectory, 'mcp-legacy-usage.db');
  const manifestPath = path.join(stateDirectory, 'harness-g9-observation-release.json');
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        release_sha: 'a'.repeat(40),
        configuration_sha256: 'b'.repeat(64),
        telemetry_database: telemetryDatabase,
        state_database: path.join(stateDirectory, 'project.db'),
        server_ids: LEGACY_SERVER_IDS,
        first_candidate_complete_utc_day: firstCandidateDay,
        cutover_authorized: false,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return { manifestPath, projectDirectory, stateDirectory, telemetryDatabase };
}

function markHour(store, instant) {
  for (const serverId of LEGACY_SERVER_IDS) store.markObservation(serverId, instant);
}

function fillDays(store, firstDay, count, { sparse = false } = {}) {
  const start = new Date(`${firstDay}T00:00:00.000Z`);
  for (let day = 0; day < count; day += 1) {
    const hours = sparse ? [0] : Array.from({ length: 24 }, (_, index) => index);
    for (const hour of hours) markHour(store, new Date(start.getTime() + day * 86_400_000 + hour * 3_600_000));
  }
}

test('monitor reads an active WAL without changing database bytes or claiming cutover authority', (t) => {
  const paths = fixture(t, { firstCandidateDay: '2026-08-31' });
  const store = new McpLegacyUsageStore(paths.telemetryDatabase);
  t.after(() => store.close());
  markHour(store, new Date('2026-08-31T12:05:00.000Z'));
  assert.equal(fs.existsSync(`${paths.telemetryDatabase}-wal`), true);
  const before = fingerprints(paths.telemetryDatabase);

  const report = monitorCompatibilityObservation({ projectDirectory: paths.projectDirectory, asOf: AS_OF });

  assert.deepEqual(fingerprints(paths.telemetryDatabase), before);
  assert.equal(report.status, 'observing-zero-use');
  assert.equal(report.database_mode, 'verified-read-snapshot-of-live-wal');
  assert.equal(report.monitor_only, true);
  assert.equal(report.observation_healthy, true);
  assert.equal(report.current.all_servers_present, true);
  assert.equal(report.current.all_servers_fresh, true);
  assert.equal(report.progress.current_consecutive_days, 0);
  assert.equal(report.ready_for_cutover, false);
  assert.equal(report.cutover_authorized, false);
});

test('missing and stale current-hour observations fail the monitor health check', (t) => {
  const missingPaths = fixture(t, { firstCandidateDay: '2026-08-31' });
  const missingStore = new McpLegacyUsageStore(missingPaths.telemetryDatabase);
  t.after(() => missingStore.close());
  for (const serverId of LEGACY_SERVER_IDS.slice(0, -1)) {
    missingStore.markObservation(serverId, new Date('2026-08-31T12:20:00.000Z'));
  }
  const missing = monitorCompatibilityObservation({ projectDirectory: missingPaths.projectDirectory, asOf: AS_OF });
  assert.equal(missing.status, 'observation-degraded');
  assert.equal(missing.current.all_servers_present, false);
  assert.deepEqual(
    missing.current.servers.filter(({ present }) => !present).map(({ server_id }) => server_id),
    ['swarm'],
  );

  const stalePaths = fixture(t, { firstCandidateDay: '2026-08-31' });
  const staleStore = new McpLegacyUsageStore(stalePaths.telemetryDatabase);
  t.after(() => staleStore.close());
  markHour(staleStore, new Date('2026-08-31T12:00:00.000Z'));
  const stale = monitorCompatibilityObservation({
    projectDirectory: stalePaths.projectDirectory,
    asOf: AS_OF,
    maxStalenessMinutes: 15,
  });
  assert.equal(stale.status, 'observation-degraded');
  assert.equal(stale.current.all_servers_present, true);
  assert.equal(stale.current.all_servers_fresh, false);
});

test('legacy use resets the consecutive complete-day sequence and remains visible today', (t) => {
  const paths = fixture(t);
  const store = new McpLegacyUsageStore(paths.telemetryDatabase);
  t.after(() => store.close());
  fillDays(store, '2026-08-01', 30);
  store.record(
    {
      client_identity: 'legacy-fixture',
      protocol_version: '2024-11-05',
      server_id: 'governance',
      sunset: 'fixture',
    },
    new Date('2026-08-16T10:00:00.000Z'),
  );
  markHour(store, new Date('2026-08-31T12:20:00.000Z'));
  store.record(
    {
      client_identity: 'legacy-today',
      protocol_version: '2024-11-05',
      server_id: 'swarm',
      sunset: 'fixture',
    },
    new Date('2026-08-31T12:25:00.000Z'),
  );

  const report = monitorCompatibilityObservation({ projectDirectory: paths.projectDirectory, asOf: AS_OF });
  assert.equal(report.status, 'legacy-use-observed');
  assert.equal(report.progress.current_consecutive_days, 14);
  assert.equal(report.progress.remaining_days, 16);
  assert.deepEqual(report.progress.invalid_days.at(-1).legacy_use, [{ server_id: 'governance', count: 1 }]);
  assert.deepEqual(report.current.legacy_use_today, [{ server_id: 'swarm', count: 1 }]);
  assert.equal(report.progress.window_complete, false);
  assert.equal(report.ready_for_cutover, false);
});

test('sparse daily heartbeats cannot produce false progress', (t) => {
  const paths = fixture(t);
  const store = new McpLegacyUsageStore(paths.telemetryDatabase);
  t.after(() => store.close());
  fillDays(store, '2026-08-01', 30, { sparse: true });
  markHour(store, new Date('2026-08-31T12:20:00.000Z'));

  const report = monitorCompatibilityObservation({ projectDirectory: paths.projectDirectory, asOf: AS_OF });
  assert.equal(report.progress.current_consecutive_days, 0);
  assert.equal(report.progress.invalid_days.length, 30);
  assert.ok(report.progress.invalid_days.every(({ gaps }) => gaps.every(({ covered_hours }) => covered_hours === 1)));
  assert.equal(report.progress.window_complete, false);
});

test('monitor rejects symlink, hardlink, state alias, and inconsistent manifest targets', (t) => {
  const paths = fixture(t, { firstCandidateDay: '2026-08-31' });
  const store = new McpLegacyUsageStore(paths.telemetryDatabase);
  store.close();
  const symbolic = path.join(paths.stateDirectory, 'symbolic.db');
  fs.symlinkSync(paths.telemetryDatabase, symbolic);
  assert.throws(() => assertLiveTelemetryTarget(symbolic), /non-symlink/);

  const hard = path.join(paths.stateDirectory, 'hard.db');
  fs.linkSync(paths.telemetryDatabase, hard);
  assert.throws(() => assertLiveTelemetryTarget(paths.telemetryDatabase), /hard-linked/);
  fs.unlinkSync(hard);

  const statePath = path.join(paths.stateDirectory, 'project.db');
  fs.linkSync(paths.telemetryDatabase, statePath);
  assert.throws(() => assertLiveTelemetryTarget(paths.telemetryDatabase, statePath), /distinct/);
  fs.unlinkSync(statePath);

  const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
  manifest.telemetry_database = path.join(paths.stateDirectory, 'different.db');
  fs.writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const report = monitorCompatibilityObservation({ projectDirectory: paths.projectDirectory, asOf: AS_OF });
  assert.equal(report.manifest.valid, false);
  assert.equal(report.observation_healthy, false);
  assert.equal(report.progress.current_consecutive_days, 0);
  assert.equal(report.ready_for_cutover, false);
});
