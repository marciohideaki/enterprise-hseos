'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

function assertStableReadOnlyDatabase(databasePath) {
  const metadata = fs.lstatSync(databasePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Read-only compatibility evidence requires a regular, non-symlink database file');
  }
  if (metadata.nlink !== 1) throw new Error('Read-only compatibility evidence rejects hard-linked database files');
  const sidecars = [`${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`].filter((filename) => fs.existsSync(filename));
  if (sidecars.length > 0) {
    throw new Error('Read-only compatibility evidence requires writers to stop and SQLite sidecars to be checkpointed');
  }
}

function activationReadinessFromDatabase(db, { serverIds, asOf = new Date(), days = 30 }) {
  if (!Array.isArray(serverIds) || serverIds.length === 0 || !Number.isInteger(days) || days < 1) {
    throw new TypeError('Readiness requires serverIds and a positive day window');
  }
  const end = new Date(`${new Date(asOf).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const requiredDays = [];
  for (let offset = days; offset >= 1; offset -= 1) {
    requiredDays.push(new Date(end.getTime() - offset * 86_400_000).toISOString().slice(0, 10));
  }
  const rows = db
    .prepare(
      `SELECT usage_day, server_id, heartbeat_count, legacy_request_count
       FROM mcp_legacy_observation_daily
       WHERE usage_day BETWEEN ? AND ?`,
    )
    .all(requiredDays[0], end.toISOString().slice(0, 10));
  const evidence = new Map(rows.map((row) => [`${row.usage_day}:${row.server_id}`, row]));
  const hourlyRows = db
    .prepare(
      `SELECT usage_hour, server_id
       FROM mcp_legacy_observation_hourly
       WHERE substr(usage_hour, 1, 10) BETWEEN ? AND ?
       ORDER BY usage_hour, server_id`,
    )
    .all(requiredDays[0], requiredDays.at(-1));
  const validHour = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3])$/;
  const hourlyEvidence = new Set(
    hourlyRows.filter((row) => validHour.test(row.usage_hour)).map((row) => `${row.usage_hour}:${row.server_id}`),
  );
  const integrityErrors = hourlyRows
    .filter((row) => !validHour.test(row.usage_hour))
    .map((row) => ({ kind: 'invalid_usage_hour', server_id: row.server_id, usage_hour: row.usage_hour }));
  const gaps = [];
  const usageRows = db
    .prepare(
      `SELECT usage_day, server_id, SUM(request_count) AS request_count
       FROM mcp_legacy_usage_daily
       WHERE usage_day BETWEEN ? AND ?
       GROUP BY usage_day, server_id
       ORDER BY usage_day, server_id`,
    )
    .all(requiredDays[0], end.toISOString().slice(0, 10));
  const observedUse = new Map(rows.map((row) => [`${row.usage_day}:${row.server_id}`, row.legacy_request_count]));
  const recordedUse = new Map(usageRows.map((row) => [`${row.usage_day}:${row.server_id}`, row.request_count]));
  const usageKeys = new Set([...observedUse.keys(), ...recordedUse.keys()]);
  const legacyUse = [];
  for (const key of [...usageKeys].sort()) {
    const observed = observedUse.get(key) || 0;
    const recorded = recordedUse.get(key) || 0;
    const [day, serverId] = key.split(':');
    if (observed !== recorded) {
      integrityErrors.push({
        kind: 'usage_counter_mismatch',
        day,
        server_id: serverId,
        observed_count: observed,
        recorded_count: recorded,
      });
    }
    if (Math.max(observed, recorded) > 0) legacyUse.push({ count: Math.max(observed, recorded), day, server_id: serverId });
  }
  for (const day of requiredDays) {
    for (const serverId of serverIds) {
      const row = evidence.get(`${day}:${serverId}`);
      let coveredHours = 0;
      for (let hour = 0; hour < 24; hour += 1) {
        if (hourlyEvidence.has(`${day}T${String(hour).padStart(2, '0')}:${serverId}`)) coveredHours += 1;
      }
      if (!row || coveredHours !== 24) gaps.push({ day, server_id: serverId, covered_hours: coveredHours, required_hours: 24 });
    }
  }
  return Object.freeze({
    days,
    gaps,
    integrity_errors: integrityErrors,
    legacy_use: legacyUse,
    ready: gaps.length === 0 && legacyUse.length === 0 && integrityErrors.length === 0,
  });
}

function readMcpLegacyActivationReadiness(databasePath, options) {
  assertStableReadOnlyDatabase(databasePath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-legacy-readonly-'));
  fs.chmodSync(directory, 0o700);
  const snapshotPath = path.join(directory, 'telemetry.db');
  fs.copyFileSync(databasePath, snapshotPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(snapshotPath, 0o600);
  const db = new Database(snapshotPath, { fileMustExist: true, readonly: true });
  try {
    return activationReadinessFromDatabase(db, options);
  } finally {
    db.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
}

class McpLegacyUsageStore {
  constructor(databasePath, { maxIdentitiesPerDay = 1024, retentionDays = 45 } = {}) {
    if (!Number.isInteger(maxIdentitiesPerDay) || maxIdentitiesPerDay < 2) throw new TypeError('maxIdentitiesPerDay must be at least 2');
    if (!Number.isInteger(retentionDays) || retentionDays < 31) throw new TypeError('retentionDays must preserve the readiness window');
    this.maxIdentitiesPerDay = maxIdentitiesPerDay;
    this.retentionDays = retentionDays;
    this.lastPrunedDay = null;
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_legacy_observation_daily (
        usage_day TEXT NOT NULL CHECK(usage_day GLOB '????-??-??'),
        server_id TEXT NOT NULL CHECK(length(server_id) BETWEEN 1 AND 80),
        heartbeat_count INTEGER NOT NULL CHECK(heartbeat_count > 0),
        legacy_request_count INTEGER NOT NULL DEFAULT 0 CHECK(legacy_request_count >= 0),
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        PRIMARY KEY (usage_day, server_id)
      );
      CREATE TABLE IF NOT EXISTS mcp_legacy_usage_daily (
        usage_day TEXT NOT NULL CHECK(usage_day GLOB '????-??-??'),
        server_id TEXT NOT NULL CHECK(length(server_id) BETWEEN 1 AND 80),
        client_hash TEXT NOT NULL CHECK(length(client_hash) = 64),
        client_label TEXT NOT NULL CHECK(length(client_label) BETWEEN 1 AND 200),
        protocol_version TEXT NOT NULL CHECK(length(protocol_version) BETWEEN 1 AND 40),
        request_count INTEGER NOT NULL CHECK(request_count > 0),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        sunset TEXT NOT NULL,
        PRIMARY KEY (usage_day, server_id, client_hash, protocol_version)
      );
      CREATE TABLE IF NOT EXISTS mcp_legacy_observation_hourly (
        usage_hour TEXT NOT NULL CHECK(usage_hour GLOB '????-??-??T??'),
        server_id TEXT NOT NULL CHECK(length(server_id) BETWEEN 1 AND 80),
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        heartbeat_count INTEGER NOT NULL CHECK(heartbeat_count > 0),
        PRIMARY KEY (usage_hour, server_id)
      );
    `);
  }

  prune(now) {
    const usageDay = now.toISOString().slice(0, 10);
    if (this.lastPrunedDay === usageDay) return;
    const cutoff = new Date(`${usageDay}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - this.retentionDays);
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM mcp_legacy_usage_daily WHERE usage_day < ?').run(cutoffDay);
      this.db.prepare('DELETE FROM mcp_legacy_observation_daily WHERE usage_day < ?').run(cutoffDay);
      this.db.prepare('DELETE FROM mcp_legacy_observation_hourly WHERE substr(usage_hour, 1, 10) < ?').run(cutoffDay);
    });
    transaction();
    this.lastPrunedDay = usageDay;
  }

  markObservation(serverId, now = new Date()) {
    this.prune(now);
    const observedAt = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO mcp_legacy_observation_daily
          (usage_day, server_id, heartbeat_count, legacy_request_count, first_observed_at, last_observed_at)
         VALUES (?, ?, 1, 0, ?, ?)
         ON CONFLICT(usage_day, server_id) DO UPDATE SET
           heartbeat_count = heartbeat_count + 1,
           last_observed_at = excluded.last_observed_at`,
      )
      .run(observedAt.slice(0, 10), serverId, observedAt, observedAt);
    this.db
      .prepare(
        `INSERT INTO mcp_legacy_observation_hourly
          (usage_hour, server_id, first_observed_at, last_observed_at, heartbeat_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(usage_hour, server_id) DO UPDATE SET
           last_observed_at = excluded.last_observed_at,
           heartbeat_count = heartbeat_count + 1`,
      )
      .run(observedAt.slice(0, 13), serverId, observedAt, observedAt);
  }

  record({ client_identity: clientIdentity, protocol_version: protocolVersion, server_id: serverId, sunset }, now = new Date()) {
    this.prune(now);
    const occurredAt = now.toISOString();
    const requestedLabel = String(clientIdentity || 'unknown').slice(0, 200);
    const requestedHash = createHash('sha256')
      .update(String(clientIdentity || 'unknown'))
      .digest('hex');
    const transaction = this.db.transaction(() => {
      this.markObservation(serverId, now);
      const existing = this.db
        .prepare(
          `SELECT 1 FROM mcp_legacy_usage_daily
           WHERE usage_day = ? AND server_id = ? AND client_hash = ? AND protocol_version = ?`,
        )
        .get(occurredAt.slice(0, 10), serverId, requestedHash, protocolVersion);
      const identities = this.db
        .prepare('SELECT COUNT(*) AS count FROM mcp_legacy_usage_daily WHERE usage_day = ? AND server_id = ?')
        .get(occurredAt.slice(0, 10), serverId).count;
      const overflow = !existing && identities >= this.maxIdentitiesPerDay - 1;
      const clientLabel = overflow ? '__overflow__' : requestedLabel;
      const clientHash = overflow ? createHash('sha256').update('__overflow__').digest('hex') : requestedHash;
      this.db
        .prepare(
          `INSERT INTO mcp_legacy_usage_daily
          (usage_day, server_id, client_hash, client_label, protocol_version, request_count, first_seen_at, last_seen_at, sunset)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(usage_day, server_id, client_hash, protocol_version) DO UPDATE SET
           request_count = request_count + 1,
           last_seen_at = excluded.last_seen_at,
           sunset = excluded.sunset`,
        )
        .run(occurredAt.slice(0, 10), serverId, clientHash, clientLabel, protocolVersion, occurredAt, occurredAt, sunset);
      this.db
        .prepare(
          `UPDATE mcp_legacy_observation_daily SET legacy_request_count = legacy_request_count + 1
           WHERE usage_day = ? AND server_id = ?`,
        )
        .run(occurredAt.slice(0, 10), serverId);
    });
    transaction();
  }

  snapshot() {
    return this.db
      .prepare(
        `SELECT usage_day, server_id, client_hash, client_label, protocol_version, request_count, first_seen_at, last_seen_at, sunset
         FROM mcp_legacy_usage_daily ORDER BY usage_day, server_id, client_hash`,
      )
      .all();
  }

  activationReadiness({ serverIds, asOf = new Date(), days = 30 }) {
    return activationReadinessFromDatabase(this.db, { serverIds, asOf, days });
  }

  close() {
    if (this.db.open) this.db.close();
  }
}

module.exports = {
  McpLegacyUsageStore,
  activationReadinessFromDatabase,
  assertStableReadOnlyDatabase,
  readMcpLegacyActivationReadiness,
};
