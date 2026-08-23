'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');

const { LEGACY_SERVER_IDS } = require('./compatibility-audit');

const REQUIRED_TABLES = Object.freeze(['mcp_legacy_observation_daily', 'mcp_legacy_observation_hourly', 'mcp_legacy_usage_daily']);

function assertRegularFile(filename, label) {
  const metadata = fs.lstatSync(filename);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  return metadata;
}

function assertLiveTelemetryTarget(telemetryPath, stateDatabasePath) {
  const telemetryMetadata = assertRegularFile(telemetryPath, 'Live telemetry database');
  if (stateDatabasePath && fs.existsSync(stateDatabasePath)) {
    const stateMetadata = fs.statSync(stateDatabasePath);
    if (telemetryMetadata.dev === stateMetadata.dev && telemetryMetadata.ino === stateMetadata.ino) {
      throw new Error('Live telemetry database must be distinct from the operational state database');
    }
  }
  if (telemetryMetadata.nlink !== 1) throw new Error('Live telemetry database must not be hard-linked');
}

function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addUtcDays(day, count) {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + count * 86_400_000).toISOString().slice(0, 10);
}

function dateRange(firstDay, lastDay) {
  if (!firstDay || !lastDay || firstDay > lastDay) return [];
  const result = [];
  for (let day = firstDay; day <= lastDay; day = addUtcDays(day, 1)) result.push(day);
  return result;
}

function readManifest(manifestPath, telemetryPath, serverIds) {
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, path: manifestPath, errors: ['observation release manifest is absent'] };
  }
  const metadata = assertRegularFile(manifestPath, 'Observation release manifest');
  if (metadata.nlink !== 1) throw new Error('Observation release manifest must not be hard-linked');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errors = [];
  if (manifest.schema_version !== 1) errors.push('schema_version must be 1');
  if (!/^[a-f0-9]{40}$/.test(manifest.release_sha || '')) errors.push('release_sha must be a full Git SHA');
  if (!/^[a-f0-9]{64}$/.test(manifest.configuration_sha256 || '')) errors.push('configuration_sha256 must be SHA-256');
  if (path.resolve(manifest.telemetry_database || '') !== telemetryPath)
    errors.push('telemetry_database does not match the monitored path');
  if (path.resolve(manifest.state_database || '') === telemetryPath) errors.push('state_database aliases telemetry_database');
  if (manifest.cutover_authorized !== false) errors.push('cutover_authorized must remain false during observation');
  const declaredIds = Array.isArray(manifest.server_ids) ? [...manifest.server_ids].sort() : [];
  if (JSON.stringify(declaredIds) !== JSON.stringify([...serverIds].sort())) errors.push('server_ids do not match the required set');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.first_candidate_complete_utc_day || '')) {
    errors.push('first_candidate_complete_utc_day is invalid');
  }
  return {
    valid: errors.length === 0,
    path: manifestPath,
    errors,
    release_sha: manifest.release_sha,
    configuration_sha256: manifest.configuration_sha256,
    first_candidate_complete_utc_day: manifest.first_candidate_complete_utc_day,
  };
}

function sourceFingerprint(telemetryPath) {
  return Object.fromEntries(
    [telemetryPath, `${telemetryPath}-wal`, `${telemetryPath}-journal`]
      .filter((filename) => fs.existsSync(filename))
      .map((filename) => {
        const contents = fs.readFileSync(filename);
        return [path.basename(filename), { bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') }];
      }),
  );
}

function createLiveSnapshot(telemetryPath, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-observe-'));
    fs.chmodSync(directory, 0o700);
    const snapshotPath = path.join(directory, 'telemetry.db');
    let error;
    try {
      const before = sourceFingerprint(telemetryPath);
      fs.copyFileSync(telemetryPath, snapshotPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(snapshotPath, 0o600);
      for (const suffix of ['-wal', '-journal']) {
        const source = `${telemetryPath}${suffix}`;
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, `${snapshotPath}${suffix}`, fs.constants.COPYFILE_EXCL);
          fs.chmodSync(`${snapshotPath}${suffix}`, 0o600);
        }
      }
      const after = sourceFingerprint(telemetryPath);
      if (JSON.stringify(before) === JSON.stringify(after)) return { directory, snapshotPath };
    } catch (error_) {
      error = error_;
    }
    fs.rmSync(directory, { recursive: true, force: true });
    if (error && attempt === attempts) throw error;
  }
  throw new Error(`Live telemetry changed during ${attempts} snapshot attempts; retry when the writer is quiescent`);
}

function assertTelemetrySchema(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)").all(...REQUIRED_TABLES);
  const found = new Set(rows.map(({ name }) => name));
  const missing = REQUIRED_TABLES.filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`Live telemetry schema is incomplete: ${missing.join(', ')}`);
}

function legacyUseByDay(db, firstDay, lastDay) {
  if (!firstDay || !lastDay || firstDay > lastDay) return { counts: new Map(), integrityErrors: [] };
  const observed = db
    .prepare(
      `SELECT usage_day, server_id, legacy_request_count AS count
       FROM mcp_legacy_observation_daily WHERE usage_day BETWEEN ? AND ?`,
    )
    .all(firstDay, lastDay);
  const recorded = db
    .prepare(
      `SELECT usage_day, server_id, SUM(request_count) AS count
       FROM mcp_legacy_usage_daily WHERE usage_day BETWEEN ? AND ?
       GROUP BY usage_day, server_id`,
    )
    .all(firstDay, lastDay);
  const observedCounts = new Map(observed.map((row) => [`${row.usage_day}:${row.server_id}`, row.count]));
  const recordedCounts = new Map(recorded.map((row) => [`${row.usage_day}:${row.server_id}`, row.count]));
  const keys = new Set([...observedCounts.keys(), ...recordedCounts.keys()]);
  const counts = new Map();
  const integrityErrors = [];
  for (const key of keys) {
    const observedCount = observedCounts.get(key) || 0;
    const recordedCount = recordedCounts.get(key) || 0;
    counts.set(key, Math.max(observedCount, recordedCount));
    if (observedCount !== recordedCount) {
      const separator = key.indexOf(':');
      integrityErrors.push({
        kind: 'usage_counter_mismatch',
        day: key.slice(0, separator),
        server_id: key.slice(separator + 1),
        observed_count: observedCount,
        recorded_count: recordedCount,
      });
    }
  }
  return { counts, integrityErrors };
}

function observationProgress(db, { asOf, firstCandidateDay, serverIds }) {
  const today = utcDay(asOf);
  const yesterday = addUtcDays(today, -1);
  const completedDays = dateRange(firstCandidateDay, yesterday);
  const lastDay = completedDays.at(-1);
  const hourlyRows = lastDay
    ? db
        .prepare(
          `SELECT usage_hour, server_id FROM mcp_legacy_observation_hourly
           WHERE substr(usage_hour, 1, 10) BETWEEN ? AND ?`,
        )
        .all(firstCandidateDay, lastDay)
    : [];
  const validHour = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3])$/;
  const hours = new Set();
  const integrityErrors = [];
  for (const row of hourlyRows) {
    if (validHour.test(row.usage_hour)) {
      hours.add(`${row.usage_hour}:${row.server_id}`);
    } else {
      integrityErrors.push({ kind: 'invalid_usage_hour', server_id: row.server_id, usage_hour: row.usage_hour });
    }
  }
  const use = legacyUseByDay(db, firstCandidateDay, lastDay);
  integrityErrors.push(...use.integrityErrors);
  const evaluated = [];
  let currentStreak = 0;
  for (const day of completedDays) {
    const gaps = [];
    const legacyUse = [];
    for (const serverId of serverIds) {
      let coveredHours = 0;
      for (let hour = 0; hour < 24; hour += 1) {
        if (hours.has(`${day}T${String(hour).padStart(2, '0')}:${serverId}`)) coveredHours += 1;
      }
      if (coveredHours !== 24) gaps.push({ server_id: serverId, covered_hours: coveredHours, required_hours: 24 });
      const count = use.counts.get(`${day}:${serverId}`) || 0;
      if (count > 0) legacyUse.push({ server_id: serverId, count });
    }
    const complete = gaps.length === 0 && legacyUse.length === 0;
    currentStreak = complete ? currentStreak + 1 : 0;
    evaluated.push({ day, complete, gaps, legacy_use: legacyUse });
  }
  return {
    required_days: 30,
    first_candidate_day: firstCandidateDay,
    evaluated_complete_days: completedDays.length,
    current_consecutive_days: currentStreak,
    remaining_days: Math.max(0, 30 - currentStreak),
    window_complete: currentStreak >= 30 && integrityErrors.length === 0,
    last_evaluated_day: lastDay || null,
    invalid_days: evaluated.filter((day) => !day.complete),
    integrity_errors: integrityErrors,
  };
}

function currentObservation(db, { asOf, serverIds, maxStalenessMinutes }) {
  const currentHour = new Date(asOf).toISOString().slice(0, 13);
  const today = currentHour.slice(0, 10);
  const rows = db
    .prepare(
      `SELECT server_id, heartbeat_count, first_observed_at, last_observed_at
       FROM mcp_legacy_observation_hourly WHERE usage_hour = ? ORDER BY server_id`,
    )
    .all(currentHour);
  const byId = new Map(rows.map((row) => [row.server_id, row]));
  const servers = serverIds.map((serverId) => {
    const row = byId.get(serverId);
    if (!row) return { server_id: serverId, present: false, fresh: false, age_minutes: null };
    const ageMinutes = (new Date(asOf).getTime() - new Date(row.last_observed_at).getTime()) / 60_000;
    return {
      server_id: serverId,
      present: true,
      fresh: Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes <= maxStalenessMinutes,
      age_minutes: Number.isFinite(ageMinutes) ? Math.round(ageMinutes * 10) / 10 : null,
      heartbeat_count: row.heartbeat_count,
      last_observed_at: row.last_observed_at,
    };
  });
  const use = legacyUseByDay(db, today, today);
  const legacyUse = serverIds
    .map((serverId) => ({ server_id: serverId, count: use.counts.get(`${today}:${serverId}`) || 0 }))
    .filter(({ count }) => count > 0);
  return {
    usage_hour: currentHour,
    all_servers_present: servers.every(({ present }) => present),
    all_servers_fresh: servers.every(({ fresh }) => fresh),
    servers,
    legacy_use_today: legacyUse,
    integrity_errors: use.integrityErrors,
  };
}

function monitorCompatibilityObservation({
  projectDirectory,
  telemetryDatabase,
  manifestPath,
  asOf = new Date(),
  serverIds = LEGACY_SERVER_IDS,
  maxStalenessMinutes = 75,
}) {
  const resolvedProject = path.resolve(projectDirectory);
  const stateDirectory = path.join(resolvedProject, '.hseos', 'state');
  const telemetryPath = path.resolve(telemetryDatabase || path.join(stateDirectory, 'mcp-legacy-usage.db'));
  const stateDatabasePath = path.join(stateDirectory, 'project.db');
  const resolvedManifestPath = path.resolve(manifestPath || path.join(stateDirectory, 'harness-g9-observation-release.json'));
  const instant = new Date(asOf);
  if (Number.isNaN(instant.getTime())) throw new TypeError('asOf must be a valid timestamp');
  if (!Number.isInteger(maxStalenessMinutes) || maxStalenessMinutes < 1) {
    throw new TypeError('maxStalenessMinutes must be a positive integer');
  }
  assertLiveTelemetryTarget(telemetryPath, stateDatabasePath);
  const manifest = readManifest(resolvedManifestPath, telemetryPath, serverIds);
  const snapshot = createLiveSnapshot(telemetryPath);
  const db = new Database(snapshot.snapshotPath, { fileMustExist: true, timeout: 5000 });
  try {
    db.pragma('query_only = ON');
    assertTelemetrySchema(db);
    const current = currentObservation(db, { asOf: instant, serverIds, maxStalenessMinutes });
    const progress = observationProgress(db, {
      asOf: instant,
      firstCandidateDay: manifest.valid ? manifest.first_candidate_complete_utc_day : null,
      serverIds,
    });
    const observationHealthy =
      manifest.valid &&
      current.all_servers_present &&
      current.all_servers_fresh &&
      current.integrity_errors.length === 0 &&
      progress.integrity_errors.length === 0;
    const legacyUseObserved = current.legacy_use_today.length > 0;
    let status = 'observing-zero-use';
    if (observationHealthy && legacyUseObserved) status = 'legacy-use-observed';
    if (!observationHealthy) status = 'observation-degraded';
    return Object.freeze({
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      as_of: instant.toISOString(),
      status,
      monitor_only: true,
      database_mode: 'verified-read-snapshot-of-live-wal',
      observation_healthy: observationHealthy,
      ready_for_cutover: false,
      cutover_authorized: false,
      operational_paths: {
        telemetry_database: telemetryPath,
        state_database: stateDatabasePath,
        observation_manifest: resolvedManifestPath,
      },
      manifest,
      current,
      progress,
    });
  } finally {
    db.close();
    fs.rmSync(snapshot.directory, { recursive: true, force: true });
  }
}

module.exports = {
  REQUIRED_TABLES,
  assertLiveTelemetryTarget,
  createLiveSnapshot,
  monitorCompatibilityObservation,
  observationProgress,
};
