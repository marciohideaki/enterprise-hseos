'use strict';
/**
 * W5-CO1 — activity store behind one interface:
 *   register, heartbeat, declare, end, reserve, release, listActive, listClaims, sweepOverdue, eventsAfter.
 * `MachineStore` (default) is a machine-wide SQLite WAL database with its own migration; it is the reference and the
 * only source of truth for reservations (fence + TTL, W4 lease model: expiry yields `claim_overdue`, never takeover).
 * `ProjectAggregateStore` only reads the existing per-project stores; its reservations are advisory.
 */
const fs = require('node:fs');
const path = require('node:path');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

const MIGRATIONS = [
  `CREATE TABLE activities (
     id TEXT PRIMARY KEY, tool TEXT NOT NULL, host TEXT, repo TEXT, worktree TEXT, branch TEXT, base TEXT, intent TEXT,
     paths_declared TEXT NOT NULL DEFAULT '[]', identifiers_declared TEXT NOT NULL DEFAULT '[]',
     started_ms INTEGER NOT NULL, heartbeat_ms INTEGER NOT NULL, ended_ms INTEGER
   );
   CREATE INDEX idx_activities_repo ON activities(repo) WHERE ended_ms IS NULL;
   CREATE TABLE claims (
     fence INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, kind TEXT NOT NULL, owner TEXT NOT NULL,
     acquired_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, overdue_ms INTEGER, released_ms INTEGER
   );
   CREATE UNIQUE INDEX idx_claims_active_key ON claims(key) WHERE released_ms IS NULL;
   CREATE TABLE events (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL, type TEXT NOT NULL, reason_code TEXT NOT NULL,
     activity_id TEXT, dedupe_key TEXT, payload TEXT NOT NULL DEFAULT '{}'
   );
   CREATE INDEX idx_events_dedupe ON events(dedupe_key) WHERE dedupe_key IS NOT NULL;`,
];

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

function toActivity(row) {
  return (
    row && {
      id: row.id,
      tool: row.tool,
      host: row.host,
      repo: row.repo,
      worktree: row.worktree,
      branch: row.branch,
      base: row.base,
      intent: row.intent,
      paths_declared: parseJson(row.paths_declared, []),
      identifiers_declared: parseJson(row.identifiers_declared, []),
      started_at: new Date(row.started_ms).toISOString(),
      heartbeat_at: new Date(row.heartbeat_ms).toISOString(),
      ended_at: row.ended_ms ? new Date(row.ended_ms).toISOString() : null,
    }
  );
}

function toClaim(row) {
  return (
    row && {
      key: row.key,
      kind: row.kind,
      owner: row.owner,
      fence: row.fence,
      acquired_at: new Date(row.acquired_ms).toISOString(),
      expires_at: new Date(row.expires_ms).toISOString(),
      overdue: row.overdue_ms != null,
      released: row.released_ms != null,
    }
  );
}

class MachineStore {
  constructor({ dbPath, now = Date.now, busyTimeoutMs = 5000, staleMs = null }) {
    if (!Database) throw new Error('better-sqlite3 is not installed');
    const directory = path.dirname(dbPath);
    const directoryExisted = fs.existsSync(directory);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!directoryExisted) fs.chmodSync(directory, 0o700);
    if (!fs.existsSync(dbPath)) fs.closeSync(fs.openSync(dbPath, 'a', 0o600));
    fs.chmodSync(dbPath, 0o600);
    this.dbPath = dbPath;
    this.now = now;
    this.staleMs = staleMs;
    this.db = new Database(dbPath, { timeout: busyTimeoutMs });
    this.db.pragma('journal_mode = WAL');
    this.migrate();
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.chmodSync(dbPath + suffix, 0o600);
      } catch {
        /* sidecar not created yet */
      }
    }
  }

  migrate() {
    if (this.db.pragma('user_version', { simple: true }) >= MIGRATIONS.length) return;
    // BEGIN IMMEDIATE serializes concurrent first-open of the same file across processes.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let current = this.db.pragma('user_version', { simple: true });
      for (; current < MIGRATIONS.length; current += 1) {
        this.db.exec(MIGRATIONS[current]);
        this.db.pragma(`user_version = ${current + 1}`);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  tx(fn) {
    return this.db.transaction(fn).immediate();
  }

  event(type, reasonCode, activityId, payload = {}, dedupeKey = null) {
    if (dedupeKey && this.db.prepare('SELECT 1 FROM events WHERE dedupe_key = ?').get(dedupeKey)) return null;
    const info = this.db
      .prepare('INSERT INTO events (ts_ms, type, reason_code, activity_id, dedupe_key, payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.now(), type, reasonCode, activityId, dedupeKey, JSON.stringify(payload));
    return Number(info.lastInsertRowid);
  }

  /** Records an externally derived event (overlap, conflict) once per dedupe key. */
  recordEvent(type, reasonCode, activityId, payload, dedupeKey) {
    return this.tx(() => this.event(type, reasonCode, activityId, payload, dedupeKey));
  }

  register(activity) {
    const now = this.now();
    return this.tx(() => {
      const existing = this.db.prepare('SELECT id FROM activities WHERE id = ?').get(activity.id);
      this.db
        .prepare(
          `INSERT INTO activities (id, tool, host, repo, worktree, branch, base, intent, paths_declared, identifiers_declared, started_ms, heartbeat_ms)
           VALUES (@id, @tool, @host, @repo, @worktree, @branch, @base, @intent, @paths, @identifiers, @now, @now)
           ON CONFLICT(id) DO UPDATE SET tool=@tool, host=@host, repo=@repo, worktree=@worktree, branch=@branch, base=@base,
             intent=COALESCE(@intent, intent), heartbeat_ms=@now, ended_ms=NULL`,
        )
        .run({
          id: activity.id,
          tool: activity.tool,
          host: activity.host ?? null,
          repo: activity.repo ?? null,
          worktree: activity.worktree ?? null,
          branch: activity.branch ?? null,
          base: activity.base ?? null,
          intent: activity.intent ?? null,
          paths: JSON.stringify(activity.paths_declared || []),
          identifiers: JSON.stringify(activity.identifiers_declared || []),
          now,
        });
      this.event('activity_registered', existing ? 'reregistered' : 'registered', activity.id, {
        tool: activity.tool,
        repo: activity.repo,
        branch: activity.branch,
      });
      return this.get(activity.id);
    });
  }

  get(id) {
    return toActivity(this.db.prepare('SELECT * FROM activities WHERE id = ?').get(id));
  }

  heartbeat(id, ttlS) {
    const now = this.now();
    return this.tx(() => {
      const row = this.db.prepare('SELECT heartbeat_ms FROM activities WHERE id = ? AND ended_ms IS NULL').get(id);
      if (!row) return { ok: false, reason_code: 'unknown_activity' };
      this.db.prepare('UPDATE activities SET heartbeat_ms = ? WHERE id = ?').run(now, id);
      const renewed = this.db
        .prepare('UPDATE claims SET expires_ms = ?, overdue_ms = NULL WHERE owner = ? AND released_ms IS NULL')
        .run(now + ttlS * 1000, id).changes;
      // A heartbeat only updates the row; an event is recorded just when a stale session comes back.
      if (this.staleMs != null && now - row.heartbeat_ms > this.staleMs)
        this.event('activity_heartbeat', 'resumed', id, { claims_renewed: renewed });
      return { ok: true, claims_renewed: renewed };
    });
  }

  declare(id, { paths = [], identifiers = [], intent } = {}) {
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM activities WHERE id = ? AND ended_ms IS NULL').get(id);
      if (!row) return { ok: false, reason_code: 'unknown_activity' };
      const merge = (current, extra) => [...new Set([...parseJson(current, []), ...extra])];
      this.db
        .prepare(
          'UPDATE activities SET paths_declared = ?, identifiers_declared = ?, intent = COALESCE(?, intent), heartbeat_ms = ? WHERE id = ?',
        )
        .run(
          JSON.stringify(merge(row.paths_declared, paths)),
          JSON.stringify(merge(row.identifiers_declared, identifiers)),
          intent ?? null,
          this.now(),
          id,
        );
      this.event('activity_declared', 'declared', id, { paths, identifiers });
      return { ok: true, activity: this.get(id) };
    });
  }

  end(id) {
    const now = this.now();
    return this.tx(() => {
      const info = this.db.prepare('UPDATE activities SET ended_ms = ? WHERE id = ? AND ended_ms IS NULL').run(now, id);
      if (info.changes === 0) return { ok: false, reason_code: 'unknown_activity' };
      const held = this.db.prepare('SELECT * FROM claims WHERE owner = ? AND released_ms IS NULL').all(id);
      this.db.prepare('UPDATE claims SET released_ms = ? WHERE owner = ? AND released_ms IS NULL').run(now, id);
      for (const claim of held) this.event('claim_released', 'owner_ended', id, { key: claim.key, fence: claim.fence });
      this.event('activity_ended', 'ended', id, { claims_released: held.length });
      return { ok: true, claims_released: held.length };
    });
  }

  /**
   * Acquires `key` for `owner`. A key held by another owner is a conflict even when its lease is overdue (no takeover).
   * The fence is the monotonic claim id: only the holder of the current fence can release.
   */
  reserve({ owner, kind, key, ttlS }) {
    const now = this.now();
    return this.tx(() => {
      if (!this.db.prepare('SELECT 1 FROM activities WHERE id = ? AND ended_ms IS NULL').get(owner))
        return { ok: false, reason_code: 'unknown_activity' };
      const held = this.db.prepare('SELECT * FROM claims WHERE key = ? AND released_ms IS NULL').get(key);
      if (held && held.owner !== owner) {
        const holder = toClaim(held);
        this.event(
          'reservation_conflict',
          'claim_held',
          owner,
          { key, source: 'claim', held_by: held.owner, fence: held.fence, overdue: holder.overdue },
          `conflict:${key}:${owner}:${held.fence}`,
        );
        return {
          ok: false,
          reason_code: 'claim_held',
          conflict: { source: 'claim', held_by: held.owner, fence: held.fence, overdue: holder.overdue, expires_at: holder.expires_at },
        };
      }
      if (held) {
        this.db.prepare('UPDATE claims SET expires_ms = ?, overdue_ms = NULL WHERE fence = ?').run(now + ttlS * 1000, held.fence);
        return { ok: true, renewed: true, claim: toClaim(this.db.prepare('SELECT * FROM claims WHERE fence = ?').get(held.fence)) };
      }
      const info = this.db
        .prepare('INSERT INTO claims (key, kind, owner, acquired_ms, expires_ms) VALUES (?, ?, ?, ?, ?)')
        .run(key, kind, owner, now, now + ttlS * 1000);
      this.event('claim_acquired', 'acquired', owner, { key, kind, fence: Number(info.lastInsertRowid) });
      return {
        ok: true,
        renewed: false,
        claim: toClaim(this.db.prepare('SELECT * FROM claims WHERE fence = ?').get(info.lastInsertRowid)),
      };
    });
  }

  /** A release carries the fence it was granted; a stale fence never removes a newer reservation. */
  release({ key, fence }) {
    return this.tx(() => {
      const info = this.db
        .prepare('UPDATE claims SET released_ms = ? WHERE key = ? AND fence = ? AND released_ms IS NULL')
        .run(this.now(), key, fence);
      if (info.changes === 0) {
        const current = this.db.prepare('SELECT fence FROM claims WHERE key = ? AND released_ms IS NULL').get(key);
        return { ok: false, reason_code: 'stale_fence', current_fence: current ? current.fence : null };
      }
      this.event('claim_released', 'released', null, { key, fence });
      return { ok: true };
    });
  }

  /** Open activities with a fresh heartbeat; sessions silent for longer than the TTL are `listStale` (kept, never deleted). */
  listActive({ repo } = {}) {
    const floor = this.staleMs == null ? 0 : this.now() - this.staleMs;
    const rows = repo
      ? this.db
          .prepare('SELECT * FROM activities WHERE ended_ms IS NULL AND heartbeat_ms >= ? AND repo = ? ORDER BY started_ms')
          .all(floor, repo)
      : this.db.prepare('SELECT * FROM activities WHERE ended_ms IS NULL AND heartbeat_ms >= ? ORDER BY started_ms').all(floor);
    return rows.map(toActivity);
  }

  listStale() {
    if (this.staleMs == null) return [];
    const rows = this.db
      .prepare('SELECT * FROM activities WHERE ended_ms IS NULL AND heartbeat_ms < ? ORDER BY started_ms')
      .all(this.now() - this.staleMs);
    return rows.map((row) => ({ ...toActivity(row), stale: true }));
  }

  listClaims() {
    return this.db.prepare('SELECT * FROM claims WHERE released_ms IS NULL ORDER BY fence').all().map(toClaim);
  }

  /** Flags expired leases once (`claim_overdue`); the claim stays held. */
  sweepOverdue() {
    const now = this.now();
    return this.tx(() => {
      const rows = this.db.prepare('SELECT * FROM claims WHERE released_ms IS NULL AND overdue_ms IS NULL AND expires_ms < ?').all(now);
      for (const row of rows) {
        this.db.prepare('UPDATE claims SET overdue_ms = ? WHERE fence = ?').run(now, row.fence);
        this.event('claim_overdue', 'ttl_expired', row.owner, {
          key: row.key,
          fence: row.fence,
          expires_at: new Date(row.expires_ms).toISOString(),
        });
      }
      return rows.map(toClaim);
    });
  }

  eventsAfter(cursor = 0, limit = 500) {
    return this.db
      .prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?')
      .all(cursor, limit)
      .map((row) => ({
        seq: row.seq,
        ts: new Date(row.ts_ms).toISOString(),
        type: row.type,
        reason_code: row.reason_code,
        activity_id: row.activity_id,
        ...parseJson(row.payload, {}),
      }));
  }
}

/** Read-only view over existing per-project stores (`<dir>/.hseos/state/project.db`). No global fence. */
class ProjectAggregateStore {
  constructor({ projectDirs = [], now = Date.now }) {
    if (!Database) throw new Error('better-sqlite3 is not installed');
    this.projectDirs = projectDirs;
    this.now = now;
    this.advisoryOnly = true;
    this.persistsEvents = false;
    this.warnings = [];
  }

  readProject(dir) {
    const dbPath = path.join(dir, '.hseos', 'state', 'project.db');
    if (!fs.existsSync(dbPath)) {
      this.warnings.push(`no project store at ${dbPath}`);
      return { sessions: [], claims: [] };
    }
    let db;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 2000 });
      const sessions = db
        .prepare(
          `SELECT s.id, s.host, s.started_at, s.last_seen_at, r.project, r.repo_url, r.base_branch
           FROM as_sessions s LEFT JOIN as_runs r ON r.session_id = s.id WHERE s.status = 'active' GROUP BY s.id`,
        )
        .all();
      const claims = db
        .prepare(
          'SELECT branch_name, base_branch, claimed_by_session, claimed_at FROM as_worktree_state WHERE removed_at IS NULL AND claimed_by_session IS NOT NULL',
        )
        .all();
      return { sessions: sessions.map((row) => ({ ...row, project_dir: dir })), claims };
    } catch (error) {
      this.warnings.push(`project store ${dbPath} unreadable: ${error.message.split('\n')[0]}`);
      return { sessions: [], claims: [] };
    } finally {
      if (db) db.close();
    }
  }

  listActive() {
    this.warnings = [];
    const out = [];
    for (const dir of this.projectDirs) {
      const { sessions, claims } = this.readProject(dir);
      for (const row of sessions) {
        const claim = claims.find((item) => item.claimed_by_session === row.id);
        out.push({
          id: row.id,
          tool: 'claude-code',
          host: row.host,
          repo: row.repo_url || row.project || dir,
          worktree: dir,
          branch: claim ? claim.branch_name : null,
          base: claim ? claim.base_branch : row.base_branch,
          intent: null,
          paths_declared: [],
          identifiers_declared: [],
          started_at: row.started_at,
          heartbeat_at: row.last_seen_at,
          ended_at: null,
          source: 'project-aggregate',
        });
      }
    }
    return out;
  }

  listStale() {
    return [];
  }

  listClaims() {
    this.warnings = [];
    const out = [];
    for (const dir of this.projectDirs) {
      for (const claim of this.readProject(dir).claims) {
        out.push({
          key: `path:${dir}:${claim.branch_name}`,
          kind: 'path',
          owner: claim.claimed_by_session,
          fence: null,
          advisory: true,
          released: false,
          overdue: false,
        });
      }
    }
    return out;
  }

  /** No global fence: a reservation here is a warning, never an exclusive lease. */
  reserve({ owner, key }) {
    const conflict = this.listClaims().find((claim) => claim.key === key && claim.owner !== owner);
    if (conflict)
      return { ok: false, reason_code: 'claim_held', advisory: true, conflict: { source: 'claim', held_by: conflict.owner, fence: null } };
    return {
      ok: true,
      advisory: true,
      claim: null,
      warning: 'project-aggregate has no global fence: the reservation is advisory only and was not recorded',
    };
  }

  readOnly() {
    return { ok: false, reason_code: 'read_only_backend', advisory: true };
  }

  register() {
    return this.readOnly();
  }
  heartbeat() {
    return this.readOnly();
  }
  declare() {
    return this.readOnly();
  }
  end() {
    return this.readOnly();
  }
  release() {
    return this.readOnly();
  }
  sweepOverdue() {
    return [];
  }
  recordEvent() {
    return null;
  }
  eventsAfter() {
    return [];
  }
  close() {}
}

function openStore(config, options = {}) {
  if (config.store.backend === 'project-aggregate') {
    return new ProjectAggregateStore({ projectDirs: config.store.project_dirs, now: options.now });
  }
  return new MachineStore({ dbPath: options.dbPath || config.store.path, now: options.now, staleMs: config.reservations.ttl_s * 1000 });
}

module.exports = { MachineStore, ProjectAggregateStore, openStore, MIGRATIONS };
