'use strict';

const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');

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
      this.db.prepare("DELETE FROM mcp_legacy_observation_hourly WHERE substr(usage_hour, 1, 10) < ?").run(cutoffDay);
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
    const requestedHash = createHash('sha256').update(String(clientIdentity || 'unknown')).digest('hex');
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
      this.db.prepare(
        `INSERT INTO mcp_legacy_usage_daily
          (usage_day, server_id, client_hash, client_label, protocol_version, request_count, first_seen_at, last_seen_at, sunset)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(usage_day, server_id, client_hash, protocol_version) DO UPDATE SET
           request_count = request_count + 1,
           last_seen_at = excluded.last_seen_at,
           sunset = excluded.sunset`,
      ).run(occurredAt.slice(0, 10), serverId, clientHash, clientLabel, protocolVersion, occurredAt, occurredAt, sunset);
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
    if (!Array.isArray(serverIds) || serverIds.length === 0 || !Number.isInteger(days) || days < 1) {
      throw new TypeError('Readiness requires serverIds and a positive day window');
    }
    const end = new Date(`${new Date(asOf).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const requiredDays = [];
    for (let offset = days; offset >= 1; offset -= 1) {
      requiredDays.push(new Date(end.getTime() - offset * 86_400_000).toISOString().slice(0, 10));
    }
    const rows = this.db
      .prepare(
        `SELECT usage_day, server_id, heartbeat_count, legacy_request_count
         FROM mcp_legacy_observation_daily
         WHERE usage_day BETWEEN ? AND ?`,
      )
      .all(requiredDays[0], end.toISOString().slice(0, 10));
    const evidence = new Map(rows.map((row) => [`${row.usage_day}:${row.server_id}`, row]));
    const hourlyRows = this.db
      .prepare(
        `SELECT substr(usage_hour, 1, 10) AS usage_day, server_id, COUNT(*) AS covered_hours
         FROM mcp_legacy_observation_hourly
         WHERE substr(usage_hour, 1, 10) BETWEEN ? AND ?
         GROUP BY substr(usage_hour, 1, 10), server_id`,
      )
      .all(requiredDays[0], requiredDays.at(-1));
    const hourlyEvidence = new Map(hourlyRows.map((row) => [`${row.usage_day}:${row.server_id}`, row.covered_hours]));
    const gaps = [];
    const legacyUse = rows
      .filter((row) => row.legacy_request_count > 0)
      .map((row) => ({ day: row.usage_day, server_id: row.server_id, count: row.legacy_request_count }));
    for (const day of requiredDays) {
      for (const serverId of serverIds) {
        const row = evidence.get(`${day}:${serverId}`);
        const coveredHours = hourlyEvidence.get(`${day}:${serverId}`) || 0;
        if (!row || coveredHours !== 24) gaps.push({ day, server_id: serverId, covered_hours: coveredHours, required_hours: 24 });
      }
    }
    return Object.freeze({ days, gaps, legacy_use: legacyUse, ready: gaps.length === 0 && legacyUse.length === 0 });
  }

  close() {
    if (this.db.open) this.db.close();
  }
}

module.exports = { McpLegacyUsageStore };
