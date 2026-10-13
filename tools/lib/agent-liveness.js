'use strict';

/**
 * Agent liveness core ("no silent idle"): ledger, classifier, watchdog cycle,
 * foreground await and the systemd timer template.
 *
 * Design constraints (spec .specs/features/harness-w5/liveness.md):
 *  - Liveness events live in their own additive table (`as_liveness_events`),
 *    created idempotently without bumping `PRAGMA user_version`: the operational
 *    state boundary (schema v4) and `as_events` (closed `kind` CHECK) stay untouched,
 *    and `state-list --orphans` keeps reading `as_agent_runs.last_heartbeat_at` as before.
 *  - `turn_end` is its own event and never counts as a heartbeat.
 *  - An expired lease never proves death: it yields `overdue` and escalation to the
 *    human, never takeover or kill.
 *  - The watchdog reconciles against the source of truth (worktree HEAD, pid, status
 *    file) before it acts.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const { REASON_CODES, STATE_REASON_CODES, parseLivenessLine } = require('./agent-liveness-contract');

const EVENT_KINDS = Object.freeze(['heartbeat', 'turn_end', 'wait_declared', 'report', 'wake_sent', 'idle_violation', 'overdue']);
const AGENT_KINDS = new Set(['heartbeat', 'turn_end', 'wait_declared', 'report']);
const ACTIVITY_KINDS = new Set(['heartbeat', 'wait_declared', 'report']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEAD_PATTERN = /^[0-9a-f]{40,64}$/;
const LOOKBACK_S = 7 * 86_400;
const WAKE_BACKOFF_BASE_S = 60;
const WAKE_BACKOFF_MAX_S = 300;
const INERT_IO = Object.freeze({
  readHead: () => null,
  isPidAlive: () => true,
  statFile: () => ({ exists: false, modified_at: null }),
});
const TERMINAL_NOTICE_STATES = new Set(['blocked', 'failed']);
const ENDED_AGENT_STATUSES = new Set(['completed', 'aborted', 'killed']);
const ENDED_RUN_STATUSES = new Set(['completed', 'aborted']);

const LIVENESS_DIR_PARTS = ['.hseos', 'state', 'liveness'];

function livenessDir(directory) {
  return path.join(directory, ...LIVENESS_DIR_PARTS);
}

function inboxDir(directory) {
  return path.join(livenessDir(directory), 'inbox');
}

function assertSafeId(label, value) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} must match ${SAFE_ID} (got ${JSON.stringify(value)})`);
  }
  return value;
}

// ---------------------------------------------------------------- ledger ----

// Expected shape of each table as PRAGMA table_info reports it: [name, type, notnull, pk, default].
const SCHEMA = Object.freeze({
  as_liveness_events: {
    columns: [
      ['id', 'INTEGER', 0, 1, null],
      ['session', 'TEXT', 1, 0, null],
      ['agent', 'TEXT', 1, 0, null],
      ['kind', 'TEXT', 1, 0, null],
      ['ts', 'TEXT', 1, 0, null],
      ['payload_json', 'TEXT', 0, 0, null],
    ],
    indexes: { idx_as_liveness_run: ['session', 'agent', 'id'] },
  },
  as_liveness_outbox: {
    columns: [
      ['id', 'INTEGER', 0, 1, null],
      ['kind', 'TEXT', 1, 0, null],
      ['session', 'TEXT', 1, 0, null],
      ['agent', 'TEXT', 1, 0, null],
      ['payload_json', 'TEXT', 1, 0, null],
      ['created_at', 'TEXT', 1, 0, null],
      ['delivered_at', 'TEXT', 0, 0, null],
      ['attempts', 'INTEGER', 1, 0, '0'],
      ['next_attempt_at', 'TEXT', 0, 0, null],
      ['gave_up_at', 'TEXT', 0, 0, null],
      ['last_error', 'TEXT', 0, 0, null],
    ],
    indexes: { idx_as_liveness_outbox_pending: ['delivered_at', 'gave_up_at', 'id'] },
  },
  as_liveness_meta: {
    columns: [
      ['key', 'TEXT', 0, 1, null],
      ['value', 'TEXT', 1, 0, null],
    ],
    indexes: {},
  },
});
const MARKED_TABLES = ['as_liveness_events', 'as_liveness_outbox'];

function schemaDrift(message) {
  const error = new Error(`liveness schema drift: ${message}`);
  error.code = 'LIVENESS_SCHEMA_DRIFT';
  return error;
}

function existingTables(db) {
  return new Set(
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((row) => row.name),
  );
}

function schemaMarked(db, tables) {
  return tables.has('as_liveness_meta') && Boolean(db.prepare(`SELECT 1 FROM as_liveness_meta WHERE key = 'schema'`).get());
}

/**
 * Create the liveness tables idempotently. They live outside numbered migrations because the
 * operational boundary is schema v4 (`OPERATIONAL_SCHEMA_VERSION`) and `as_events` has a closed
 * `kind` CHECK. Once the schema marker exists, a missing table is data loss, not a fresh start:
 * it fails closed instead of recreating an empty table that would drop pending escalations.
 */
function ensureLivenessSchema(db) {
  const tables = existingTables(db);
  if (schemaMarked(db, tables)) {
    for (const table of MARKED_TABLES) if (!tables.has(table)) throw schemaDrift(`${table} is missing while the schema marker exists`);
  } else if (tables.has('as_liveness_outbox')) {
    // A ledger written before the delivery counters existed.
    const present = new Set(
      db
        .prepare(`PRAGMA table_info(as_liveness_outbox)`)
        .all()
        .map((column) => column.name),
    );
    if (!present.has('attempts')) db.exec(`ALTER TABLE as_liveness_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`);
    if (!present.has('next_attempt_at')) db.exec(`ALTER TABLE as_liveness_outbox ADD COLUMN next_attempt_at TEXT`);
    if (!present.has('gave_up_at')) db.exec(`ALTER TABLE as_liveness_outbox ADD COLUMN gave_up_at TEXT`);
    if (!present.has('last_error')) db.exec(`ALTER TABLE as_liveness_outbox ADD COLUMN last_error TEXT`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS as_liveness_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT NOT NULL,
      agent TEXT NOT NULL,
      kind TEXT NOT NULL,
      ts TEXT NOT NULL,
      payload_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_as_liveness_run ON as_liveness_events(session, agent, id);
    CREATE TABLE IF NOT EXISTS as_liveness_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      session TEXT NOT NULL,
      agent TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      gave_up_at TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_as_liveness_outbox_pending ON as_liveness_outbox(delivered_at, gave_up_at, id);
    CREATE TABLE IF NOT EXISTS as_liveness_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO as_liveness_meta (key, value) VALUES ('schema', '1');
  `);
}

/**
 * Fail closed when a liveness table diverges from the shape this module writes: columns (name, type,
 * NOT NULL, primary key, default) and the expected indexes. Absent tables are fine on a ledger that
 * never carried the schema marker; with the marker, a missing table is drift.
 */
function assertLivenessSchema(db) {
  const tables = existingTables(db);
  if (schemaMarked(db, tables)) {
    for (const table of MARKED_TABLES) if (!tables.has(table)) throw schemaDrift(`${table} is missing while the schema marker exists`);
  }
  for (const [table, spec] of Object.entries(SCHEMA)) {
    if (!tables.has(table)) continue;
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => [column.name, column.type, column.notnull, column.pk, column.dflt_value]);
    if (JSON.stringify(columns) !== JSON.stringify(spec.columns)) {
      throw schemaDrift(`${table} columns [${columns.map((column) => column.join(':'))}]`);
    }
    const indexes = db
      .prepare(`PRAGMA index_list(${table})`)
      .all()
      .filter((index) => index.origin === 'c')
      .map((index) => [
        index.name,
        db
          .prepare(`PRAGMA index_info(${index.name})`)
          .all()
          .map((column) => column.name),
      ])
      .sort((left, right) => left[0].localeCompare(right[0]));
    const expected = Object.entries(spec.indexes).sort((left, right) => left[0].localeCompare(right[0]));
    if (JSON.stringify(indexes) !== JSON.stringify(expected)) throw schemaDrift(`${table} indexes ${JSON.stringify(indexes)}`);
  }
}

function hasLivenessTable(db) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'as_liveness_events'`).get());
}

/**
 * Open the project state DB for liveness.
 * @param {string} directory
 * @param {{ write?: boolean }} [options] read-only opens never create or alter anything
 * @returns {import('better-sqlite3').Database|null} null when a read-only open finds no DB
 */
function openLivenessDb(directory, { write = false } = {}) {
  const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
  if (!write) {
    if (!fs.existsSync(dbPath)) return null;
    const Database = require('better-sqlite3');
    return new Database(dbPath, { readonly: true });
  }
  const { openOperationalStateDatabase } = require('../mcp-project-state/lib/operational-state-db');
  const db = openOperationalStateDatabase(dbPath);
  try {
    ensureLivenessSchema(db);
    assertLivenessSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function recordEvent(db, { session, agent, kind, payload = null, now = Date.now() }) {
  assertSafeId('session', session);
  assertSafeId('agent', agent);
  if (!EVENT_KINDS.includes(kind)) throw new TypeError(`unknown liveness event kind: ${kind}`);
  const ts = new Date(now).toISOString();
  const info = db
    .prepare(`INSERT INTO as_liveness_events (session, agent, kind, ts, payload_json) VALUES (?, ?, ?, ?, ?)`)
    .run(session, agent, kind, ts, payload === null ? null : JSON.stringify(payload));
  return { id: Number(info.lastInsertRowid), ts };
}

function parsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function loadRuns(db, now, lookbackS = LOOKBACK_S) {
  assertLivenessSchema(db);
  if (!hasLivenessTable(db)) return [];
  const cutoff = new Date(now - lookbackS * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT id, session, agent, kind, ts, payload_json FROM as_liveness_events
       WHERE (session, agent) IN (
         SELECT session, agent FROM as_liveness_events GROUP BY session, agent HAVING MAX(ts) >= ?
       )
       ORDER BY id`,
    )
    .all(cutoff);
  const runs = new Map();
  for (const row of rows) {
    const key = `${row.session}\u0000${row.agent}`;
    if (!runs.has(key)) runs.set(key, { session: row.session, agent: row.agent, events: [] });
    runs.get(key).events.push({ id: row.id, kind: row.kind, ts: row.ts, payload: parsePayload(row.payload_json) });
  }
  return [...runs.values()];
}

/**
 * Record a validated LIVENESS declaration (plus `wait_declared` for WAITING_ON), atomically.
 * @returns {{ ids: number[], ts: string }}
 */
function recordReport(db, { session, agent, value, truth = null, extra = null, reasonCode = null, now = Date.now() }) {
  const expected = STATE_REASON_CODES[value.state];
  const code = reasonCode ?? expected;
  if (!REASON_CODES.includes(code)) throw new TypeError(`unknown reason_code: ${code}`);
  if (code !== expected) throw new TypeError(`reason_code ${code} is not coherent with state ${value.state} (expected ${expected})`);
  const run = db.transaction(() => {
    const payload = { state: value.state, reason: value.reason, reason_code: code };
    if (value.evidence) payload.evidence = value.evidence;
    if (value.waiting_on) payload.waiting_on = value.waiting_on;
    if (truth) payload.truth = truth;
    Object.assign(payload, extra);
    const report = recordEvent(db, { session, agent, kind: 'report', payload, now });
    const ids = [report.id];
    if (value.waiting_on) {
      const waitPayload = { ...value.waiting_on, reason_code: 'waiting_on_declared' };
      ids.push(recordEvent(db, { session, agent, kind: 'wait_declared', payload: waitPayload, now }).id);
    }
    return { ids, ts: report.ts };
  });
  return run.immediate();
}

// ------------------------------------------------------------ classifier ----

function findLast(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function seconds(ms) {
  return Math.max(0, Math.floor(ms / 1000));
}

/**
 * Classify one run from its events. Pure: no clock, no I/O.
 * @returns {object|null} null when the run has no agent-originated event
 */
function classifyCore({ session, agent, events }, config, now) {
  const agentEvents = events.filter((event) => AGENT_KINDS.has(event.kind));
  if (agentEvents.length === 0) return null;
  const lastAgent = agentEvents.at(-1);
  const lastActivity = findLast(events, (event) => ACTIVITY_KINDS.has(event.kind));
  const lastTurnEnd = findLast(events, (event) => event.kind === 'turn_end');
  const lastReport = findLast(events, (event) => event.kind === 'report');
  const lastDecl = findLast(events, (event) => event.kind === 'report' || event.kind === 'wait_declared');
  const lastHeartbeat = findLast(events, (event) => event.kind === 'heartbeat');
  const lastWait = findLast(events, (event) => event.kind === 'wait_declared');
  const declCurrent = Boolean(lastDecl) && !(lastHeartbeat && lastHeartbeat.id > lastDecl.id);

  // Incident model. Within an incident the wake count is reset only by a valid LIVENESS report
  // (not by activity, turn_end or heartbeat), so an agent that keeps ending turns without a state
  // still escalates. The escalation to the human closes the incident; any agent event after it
  // (heartbeat, turn_end, HEAD change recorded as a heartbeat) opens a new one with a zeroed count.
  const lastEscalation = findLast(events, (event) => event.kind === 'overdue' && event.payload?.escalated === true);
  const incidentClosed = Boolean(lastEscalation) && !agentEvents.some((event) => event.id > lastEscalation.id);
  const episode = events.filter((event) => event.id > Math.max(lastReport ? lastReport.id : 0, lastEscalation ? lastEscalation.id : 0));
  const wakes = episode.filter((event) => event.kind === 'wake_sent');
  const run = {
    session,
    agent,
    state: 'running',
    reported: lastReport ? (lastReport.payload?.state ?? null) : null,
    last_event_at: lastAgent.ts,
    last_activity_at: lastActivity ? lastActivity.ts : null,
    last_turn_end_at: lastTurnEnd ? lastTurnEnd.ts : null,
    lease_expires_at: lastActivity ? new Date(Date.parse(lastActivity.ts) + config.heartbeat_ttl_s * 1000).toISOString() : null,
    overdue: false,
    violation: false,
    deadline_at: null,
    wait: null,
    detail: '',
    attempts: wakes.length,
    last_wake_at: wakes.length > 0 ? wakes.at(-1).ts : null,
    escalated: incidentClosed,
    violation_recorded: episode.some((event) => event.kind === 'idle_violation'),
    idle_for_s: seconds(now - Date.parse(lastAgent.ts)),
    blocked_age_s: null,
    terminal_notified: false,
    stalled_after_turn_end: false,
    wake_codes: events.filter((event) => event.kind === 'wake_sent').map((event) => event.payload?.reason_code ?? 'declared'),
    last_wake: wakes.length > 0 ? wakes.at(-1) : null,
    lease_overdue_recorded: episode.some((event) => event.kind === 'overdue' && event.payload?.reason === 'lease_expired'),
  };

  if (declCurrent) {
    if (run.reported !== 'WAITING_ON') {
      run.state = run.reported === 'BLOCKED' ? 'blocked' : run.reported === 'FAILED' ? 'failed' : 'done';
      run.detail = `declared ${run.reported}`;
      if (TERMINAL_NOTICE_STATES.has(run.state)) {
        run.blocked_age_s = seconds(now - Date.parse(lastReport.ts));
        run.terminal_notified = events.some(
          (event) => event.id > lastDecl.id && event.kind === 'overdue' && event.payload?.notified === true,
        );
        run.detail = `declared ${run.reported} ${run.blocked_age_s}s ago`;
      }
      return run;
    }
    const wait = lastWait?.payload ?? lastReport.payload?.waiting_on ?? null;
    run.wait = wait;
    run.deadline_at = wait ? wait.deadline_at : null;
    const deadline = wait ? Date.parse(wait.deadline_at) : Number.NaN;
    if (Number.isFinite(deadline) && now < deadline) {
      run.state = 'waiting_ok';
      run.detail = `waiting on "${wait.condition}" until ${wait.deadline_at}`;
      return run;
    }
    run.state = 'waiting_overdue';
    run.overdue = true;
    run.violation = true;
    run.detail = `WAITING_ON "${wait ? wait.condition : '?'}" is ${Number.isFinite(deadline) ? `${seconds(now - deadline)}s past` : 'missing'} its deadline`;
    return run;
  }

  if (lastTurnEnd && (!lastActivity || lastTurnEnd.id > lastActivity.id)) {
    const idleS = seconds(now - Date.parse(lastTurnEnd.ts));
    run.violation = true;
    if (idleS > config.stall_timeout_s) {
      run.state = 'stalled';
      run.overdue = true;
      run.stalled_after_turn_end = true;
      run.detail = `no new event for ${idleS}s after the turn ended (stall_timeout_s=${config.stall_timeout_s})`;
    } else {
      run.state = 'idle_no_state';
      run.detail = `turn ended ${idleS}s ago without a valid LIVENESS declaration`;
    }
    return run;
  }

  const reference = lastActivity ?? agentEvents[0];
  const silentS = seconds(now - Date.parse(reference.ts));
  if (silentS > config.stall_timeout_s) {
    run.state = 'stalled';
    run.overdue = true;
    run.violation = true;
    run.detail = `no activity for ${silentS}s mid-turn (stall_timeout_s=${config.stall_timeout_s})`;
  } else if (silentS > config.heartbeat_ttl_s) {
    run.overdue = true;
    run.violation = true;
    run.detail = `heartbeat lease lapsed ${silentS - config.heartbeat_ttl_s}s ago (heartbeat_ttl_s=${config.heartbeat_ttl_s}); not proof of death`;
  } else {
    run.detail = `active ${silentS}s ago`;
  }
  return run;
}

function reasonCodeFor(run) {
  switch (run.state) {
    case 'idle_no_state': {
      return 'no_state_at_stop';
    }
    case 'waiting_overdue': {
      return 'wait_deadline_exceeded';
    }
    case 'blocked': {
      return 'blocked_pending';
    }
    case 'stalled': {
      return run.stalled_after_turn_end ? 'no_state_at_stop' : 'stall_no_activity';
    }
    case 'waiting_ok': {
      return 'waiting_on_declared';
    }
    default: {
      return run.overdue ? 'heartbeat_lease_expired' : 'declared';
    }
  }
}

/**
 * Classify one run from its events: running, waiting_ok, waiting_overdue, stalled,
 * idle_no_state, blocked, failed or done. Pure: no clock, no I/O.
 * @returns {object|null}
 */
function classifyRun(raw, config, now) {
  const run = classifyCore(raw, config, now);
  if (run) run.reason_code = reasonCodeFor(run);
  return run;
}

function wakeDelayS(attempts) {
  return Math.min(WAKE_BACKOFF_MAX_S, WAKE_BACKOFF_BASE_S * 2 ** Math.max(0, attempts - 1));
}

/**
 * Decide what the watchdog may do for a classified run: nothing, ask the commander to
 * wake the agent, or escalate to the human. Never kill, never take over.
 * @returns {'none'|'wake'|'escalate'|'notify'}
 */
function planAction(run, config, now) {
  if (TERMINAL_NOTICE_STATES.has(run.state)) return run.terminal_notified ? 'none' : 'notify';
  if (!run.violation || run.escalated) return 'none';
  if (run.wait && run.wait.wake_via === 'human') return 'escalate';
  const sinceWakeS = run.last_wake_at ? seconds(now - Date.parse(run.last_wake_at)) : Infinity;
  if (run.attempts < config.max_wake_attempts) {
    return run.attempts === 0 || sinceWakeS >= wakeDelayS(run.attempts) ? 'wake' : 'none';
  }
  return sinceWakeS >= wakeDelayS(run.attempts) ? 'escalate' : 'none';
}

// ---------------------------------------------------------- reconciliation ----

function defaultReadHead(worktree) {
  try {
    const head = childProcess
      .execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .trim();
    return HEAD_PATTERN.test(head) ? head : null;
  } catch {
    return null;
  }
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function defaultStatFile(file) {
  try {
    const stat = fs.statSync(file);
    return { exists: true, modified_at: stat.mtime.toISOString() };
  } catch {
    return { exists: false, modified_at: null };
  }
}

function findTruth(events) {
  const event = findLast(events, (candidate) => candidate.payload && typeof candidate.payload === 'object' && candidate.payload.truth);
  return event ? event.payload.truth : null;
}

/**
 * Compare the ledger with the source of truth. Only a moved worktree HEAD is proof the
 * agent progressed after its last event; pid and status file describe the awaited
 * condition and enrich the wake reason (a satisfied condition is the best reason to wake).
 */
function reconcileRun(truth, io) {
  const result = { active: false, condition_met: false, observations: {} };
  if (!truth) return result;
  if (truth.worktree && truth.head) {
    const current = io.readHead(truth.worktree);
    result.observations.head = { recorded: truth.head, current };
    if (current && current !== truth.head) result.active = true;
  }
  if (Number.isInteger(truth.pid)) {
    const alive = io.isPidAlive(truth.pid);
    result.observations.pid = { pid: truth.pid, alive };
    if (!alive) result.condition_met = true;
  }
  if (truth.status_file) {
    const stat = io.statFile(truth.status_file);
    result.observations.status_file = { path: truth.status_file, ...stat };
    if (stat.exists) result.condition_met = true;
  }
  return result;
}

/**
 * Existing path for `evidence`, resolved through realpath and contained in `base` (never the
 * base itself). Anything else (absolute paths elsewhere, `.`, `..` escapes, symlink escapes)
 * is not evidence.
 */
function defaultEvidencePath(base, evidence) {
  try {
    const root = fs.realpathSync(base);
    const target = fs.realpathSync(path.resolve(root, evidence));
    const relative = path.relative(root, target);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

/**
 * Commit reachable from the worktree HEAD. The prefix (>= 7 hex) must resolve to exactly one commit.
 */
function defaultCommitInHead(worktree, commit) {
  try {
    const full = childProcess
      .execFileSync('git', ['-C', worktree, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .trim();
    if (!HEAD_PATTERN.test(full)) return false;
    childProcess.execFileSync('git', ['-C', worktree, 'merge-base', '--is-ancestor', full, 'HEAD'], { timeout: 5000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function withDefaultIo(io = {}) {
  return {
    readHead: defaultReadHead,
    isPidAlive: defaultIsPidAlive,
    statFile: defaultStatFile,
    evidencePath: defaultEvidencePath,
    commitInHead: defaultCommitInHead,
    ...io,
  };
}

/**
 * Check the declared evidence against the world: an existing path, a commit contained in
 * the worktree HEAD, or a run id known to the ledger. The result is an alert only
 * (`evidence_unverified`); a report is never refused because of it.
 * @returns {{ verified: boolean|null, checks: Array<{ kind: string, ok: boolean }> }}
 */
function verifyEvidence(evidence, { db, directory, worktree, io }) {
  if (!evidence) return { verified: null, checks: [] };
  const effectiveIo = withDefaultIo(io);
  const base = worktree ?? directory;
  const checks = [];
  if (!evidence.includes('\u0000')) checks.push({ kind: 'path', ok: effectiveIo.evidencePath(base, evidence) });
  if (/^[\da-f]{7,64}$/i.test(evidence)) checks.push({ kind: 'commit', ok: effectiveIo.commitInHead(base, evidence) });
  let known = false;
  try {
    known = Boolean(db.prepare(`SELECT 1 FROM as_runs WHERE id = ?`).get(evidence));
  } catch {
    /* ledger without workflow runs */
  }
  checks.push({ kind: 'run_id', ok: known });
  return { verified: checks.some((check) => check.ok), checks };
}

/**
 * Status of the workflow run behind a liveness run, from the agent-state ledger.
 * @returns {string|null} a terminal description when the run already ended
 */
function endedRunStatus(db, session, agent) {
  try {
    const row = db
      .prepare(
        `SELECT ar.status AS agent_status, r.status AS run_status
         FROM as_agent_runs ar JOIN as_runs r ON r.id = ar.run_id
         WHERE ar.agent_name = ? AND r.session_id = ? ORDER BY ar.id DESC LIMIT 1`,
      )
      .get(agent, session);
    if (!row) return null;
    if (ENDED_AGENT_STATUSES.has(row.agent_status)) return `agent run ${row.agent_status}`;
    if (ENDED_RUN_STATUSES.has(row.run_status)) return `run ${row.run_status}`;
    return null;
  } catch {
    return null;
  }
}

/**
 * Classify every recent run and reconcile violating ones against the source of truth.
 * @returns {object[]} classified runs with `action`, `reconcile` and `truth`
 */
function evaluateRuns(db, config, now, io, reconcileCache = null) {
  const effectiveIo = withDefaultIo(io);
  const evaluated = [];
  for (const raw of loadRuns(db, now)) {
    const run = classifyRun(raw, config, now);
    if (!run) continue;
    run.truth = findTruth(raw.events);
    run.reconcile = null;
    if (run.violation) {
      const cached = reconcileCache?.get(`${run.session}\u0000${run.agent}`);
      run.reconcile = reconcileRun(run.truth, reconcileCache ? INERT_IO : effectiveIo);
      if (cached) run.reconcile = cached;
      const ended = endedRunStatus(db, run.session, run.agent);
      if (ended) {
        run.reconcile.run_status = ended;
        run.state = 'done';
        run.overdue = false;
        run.violation = false;
        run.detail = `reconciled: ${ended} in the agent-state ledger; not woken`;
      } else if (run.reconcile.active) {
        run.state = 'running';
        run.overdue = false;
        run.violation = false;
        run.detail = 'reconciled: worktree HEAD moved since the last event, so the agent progressed';
      }
    }
    run.action = planAction(run, config, now);
    evaluated.push(run);
  }
  return evaluated;
}

function summarizeRun(run) {
  const summary = {
    session: run.session,
    agent: run.agent,
    state: run.state,
    last_event_at: run.last_event_at,
    overdue: run.overdue,
    violation: run.violation,
    reported: run.reported,
    deadline_at: run.deadline_at,
    wake_attempts: run.attempts,
    escalated: run.escalated,
    action: run.action,
    detail: run.detail,
    reason_code: run.reason_code,
    idle_for_s: run.idle_for_s,
  };
  if (run.blocked_age_s !== null) summary.blocked_age_s = run.blocked_age_s;
  if (run.reconcile) summary.reconcile = run.reconcile;
  return summary;
}

// ------------------------------------------------------------------ inbox ----

// The inbox directory is shared with the coordination track (`kind: 'coordination'`,
// `coordination-inbox/v1`). A wake request has no `kind`; any typed entry belongs to someone else
// and is neither read, rewritten nor pruned here.
const WAKE_KIND = 'wake';

function readInboxFiles(directory) {
  const dir = inboxDir(directory);
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const body = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (body && typeof body === 'object' && !Array.isArray(body)) entries.push({ file: name, body });
    } catch {
      /* a corrupt entry is ignored, never fatal */
    }
  }
  return entries;
}

function readInbox(directory) {
  return readInboxFiles(directory)
    .filter(
      ({ body }) =>
        (body.kind === undefined || body.kind === WAKE_KIND) && typeof body.session === 'string' && typeof body.agent === 'string',
    )
    .map(({ file, body }) => ({ file, ...body }));
}

/**
 * Pending coordination events (read-only): the watchdog reports them, it never consumes or prunes them.
 */
function readCoordinationInbox(directory) {
  return readInboxFiles(directory)
    .filter(({ body }) => body.kind === 'coordination' && body.schema === 'coordination-inbox/v1' && typeof body.recipient === 'string')
    .map(({ file, body }) => ({ file, recipient: body.recipient, reason_code: body.reason_code, created_at: body.created_at }));
}

function writeInboxRequest(directory, { session, agent, seq, reason, createdAt, attempt }) {
  const dir = inboxDir(directory);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const previous of readInbox(directory)) {
    if (previous.session === session && previous.agent === agent) fs.rmSync(path.join(dir, previous.file), { force: true });
  }
  const name = `${session}-${agent}-${seq}.json`;
  const target = path.join(dir, name);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify({ session, agent, reason, created_at: createdAt, attempt })}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return name;
}

function pruneInbox(directory, runsByKey) {
  const removed = [];
  for (const request of readInbox(directory)) {
    const run = runsByKey.get(`${request.session}\u0000${request.agent}`);
    if (!run || !run.violation || run.escalated) {
      fs.rmSync(path.join(inboxDir(directory), request.file), { force: true });
      removed.push(request.file);
    }
  }
  return removed;
}

function wakeRequestFrom(run) {
  const event = run.last_wake;
  return {
    file: `${run.session}-${run.agent}-${event.id}.json`,
    session: run.session,
    agent: run.agent,
    reason: event.payload?.reason ?? `${event.payload?.state ?? run.state}: wake requested`,
    created_at: event.ts,
    attempt: event.payload?.attempt ?? run.attempts,
  };
}

/**
 * Wake requests still pending according to the ledger (the inbox directory is only a cache of this).
 */
function pendingWakeRequests(runs) {
  return runs.filter((run) => run.violation && !run.escalated && run.last_wake).map((run) => wakeRequestFrom(run));
}

/**
 * Recreate inbox files the ledger says are pending but the directory lost.
 * @returns {string[]} files written
 */
function rebuildInbox(directory, runs) {
  const rebuilt = [];
  for (const request of pendingWakeRequests(runs)) {
    if (fs.existsSync(path.join(inboxDir(directory), request.file))) continue;
    const seq = request.file.slice(`${request.session}-${request.agent}-`.length, -'.json'.length);
    rebuilt.push(
      writeInboxRequest(directory, {
        session: request.session,
        agent: request.agent,
        seq,
        reason: request.reason,
        createdAt: request.created_at,
        attempt: request.attempt,
      }),
    );
  }
  return rebuilt;
}

/**
 * Show a desktop notification. It throws when nothing was shown (notify-send missing, failing or
 * timed out) so the outbox keeps the row pending and retries it.
 */
function defaultNotify({ title, body }) {
  const result = childProcess.spawnSync('notify-send', ['--', title, body], { timeout: 3000, stdio: 'ignore' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`notify-send exited with status ${result.status}`);
}

function wakeReason(run, config, attemptNumber) {
  const parts = [`${run.state}: ${run.detail}`];
  if (run.reconcile?.condition_met) parts.push('the awaited condition appears satisfied (pid exited or status file present)');
  parts.push(
    `attempt ${attemptNumber}/${config.max_wake_attempts}`,
    'message the agent asking it to continue or to declare DONE|BLOCKED|FAILED|WAITING_ON in a LIVENESS line',
  );
  return parts.join('; ');
}

// ----------------------------------------------------------------- watch ----

/**
 * Queue an escalation or notification in the ledger (same transaction as the decision).
 */
function enqueue(db, kind, entry, title, now) {
  const body = `${entry.state} (${entry.cause}): ${entry.detail}`;
  db.prepare(`INSERT INTO as_liveness_outbox (kind, session, agent, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    kind,
    entry.session,
    entry.agent,
    JSON.stringify({ entry, title, body }),
    new Date(now).toISOString(),
  );
}

function escalationLineExists(directory, outboxId) {
  try {
    return fs
      .readFileSync(path.join(livenessDir(directory), 'escalations.jsonl'), 'utf8')
      .split('\n')
      .some((line) => {
        try {
          return JSON.parse(line).outbox_id === outboxId;
        } catch {
          return false;
        }
      });
  } catch {
    return false;
  }
}

const NOTIFY_BATCH = 10;
const NOTIFY_BACKOFF_BASE_S = 60;
const NOTIFY_BACKOFF_MAX_S = 3600;
const OUTBOX_RETENTION_S = 7 * 86_400;

/**
 * Deliver queued escalations after the decision committed. Per row: the jsonl line is written once
 * per outbox id (the durable channel), then the human is notified, then the row is marked delivered.
 * A failed notification counts an attempt and is retried with exponential backoff; after
 * `max_notify_attempts` the row is marked `gave_up` and escalations.jsonl stays the durable record.
 * Work per cycle is bounded (a batch and a time budget of half the watch interval) so a backlog
 * cannot stretch a cycle. Rows delivered or given up more than 7 days ago are pruned.
 * The notification is at-least-once; the jsonl line is exactly once.
 * @returns {number} rows delivered
 */
function deliverOutbox(db, directory, notify, { now = Date.now(), config = {} } = {}) {
  const maxAttempts = config.max_notify_attempts ?? 10;
  const budgetMs = (config.watch_interval_s ?? 120) * 500;
  const startedAt = Date.now();
  const stamp = new Date(now).toISOString();
  let delivered = 0;
  const cutoff = new Date(now - OUTBOX_RETENTION_S * 1000).toISOString();
  db.prepare(
    `DELETE FROM as_liveness_outbox WHERE (delivered_at IS NOT NULL AND delivered_at < ?) OR (gave_up_at IS NOT NULL AND gave_up_at < ?)`,
  ).run(cutoff, cutoff);
  const pending = db
    .prepare(
      `SELECT id, payload_json, attempts FROM as_liveness_outbox
       WHERE delivered_at IS NULL AND gave_up_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY id LIMIT ?`,
    )
    .all(stamp, NOTIFY_BATCH);
  for (const row of pending) {
    if (Date.now() - startedAt > budgetMs) break;
    try {
      const item = JSON.parse(row.payload_json);
      const line = { outbox_id: row.id, ...item.entry };
      if (!escalationLineExists(directory, row.id)) appendEscalationLine(directory, line);
      notify({ title: item.title, body: item.body, escalation: line });
      db.prepare(`UPDATE as_liveness_outbox SET delivered_at = ?, last_error = NULL WHERE id = ?`).run(stamp, row.id);
      delivered += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const message = String(error?.message ?? error).slice(0, 300);
      if (attempts >= maxAttempts) {
        db.prepare(`UPDATE as_liveness_outbox SET attempts = ?, gave_up_at = ?, last_error = ? WHERE id = ?`).run(
          attempts,
          stamp,
          message,
          row.id,
        );
      } else {
        const delayS = Math.min(NOTIFY_BACKOFF_MAX_S, NOTIFY_BACKOFF_BASE_S * 2 ** (attempts - 1));
        db.prepare(`UPDATE as_liveness_outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`).run(
          attempts,
          new Date(now + delayS * 1000).toISOString(),
          message,
          row.id,
        );
      }
    }
  }
  return delivered;
}

/**
 * Outbox backlog for `check`: rows still being retried and rows that gave up.
 */
function outboxStats(db) {
  if (!existingTables(db).has('as_liveness_outbox')) return { pending: 0, gave_up: 0 };
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(delivered_at IS NULL AND gave_up_at IS NULL), 0) AS pending, COALESCE(SUM(gave_up_at IS NOT NULL), 0) AS gave_up
       FROM as_liveness_outbox`,
    )
    .get();
  return { pending: row.pending, gave_up: row.gave_up };
}

function appendEscalationLine(directory, entry) {
  fs.mkdirSync(livenessDir(directory), { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(livenessDir(directory), 'escalations.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

const PENDING_REPORTS = 'pending-reports.jsonl';
const DRAINING_PREFIX = 'pending-reports.draining-';

function safeKey(value) {
  return String(value || 'unknown')
    .replaceAll(/[^\w.-]/g, '_')
    .slice(0, 80);
}

/**
 * Record one line the stop guard parked in pending-reports.jsonl when `hseos liveness report` was
 * unavailable. Each line is keyed by the hash of its text; the key is stored on the report event, so
 * consuming it twice is a no-op. The line is validated as of its own timestamp (a deadline that has
 * passed since is still a valid declaration).
 * @returns {{ status: 'consumed'|'duplicate'|'invalid', reason?: string }}
 */
function consumePendingReport(db, text, config, now) {
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return { status: 'invalid', reason: 'not JSON' };
  }
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.session !== 'string' ||
    typeof record.agent !== 'string' ||
    typeof record.line !== 'string'
  ) {
    return { status: 'invalid', reason: 'expected {session, agent, line}' };
  }
  const key = crypto.createHash('sha256').update(text).digest('hex');
  const seen = db
    .prepare(
      `SELECT 1 FROM as_liveness_events WHERE kind = 'report'
       AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.source_key') END = ? LIMIT 1`,
    )
    .get(key);
  if (seen) return { status: 'duplicate' };
  const session = safeKey(record.session);
  const agent = safeKey(record.agent);
  if (!SAFE_ID.test(session) || !SAFE_ID.test(agent)) return { status: 'invalid', reason: 'session or agent is not a safe id' };
  const at = Date.parse(record.at);
  const when = Number.isFinite(at) ? at : now;
  const parsed = parseLivenessLine(record.line, {
    now: when,
    stallTimeoutS: config.stall_timeout_s,
    maxWaitDeadlineS: config.max_wait_deadline_s,
  });
  if (!parsed.ok) return { status: 'invalid', reason: parsed.errors.join('; ') };
  try {
    recordReport(db, {
      session,
      agent,
      value: parsed.value,
      extra: { source: PENDING_REPORTS, source_key: key },
      reasonCode: typeof record.reason_code === 'string' ? record.reason_code : null,
      now: when,
    });
  } catch (error) {
    return { status: 'invalid', reason: error.message };
  }
  return { status: 'consumed' };
}

/**
 * Drain pending-reports.jsonl. The file is renamed first (atomic), so lines the guard appends while
 * draining go to a fresh file; the renamed file is deleted only after every line was handled, and a
 * crash in between is repaired by the per-line key. Invalid lines are preserved in
 * pending-reports.invalid.jsonl and reported as warnings.
 */
function drainPendingReports({ db, directory, config, now = Date.now() }) {
  const result = { consumed: 0, duplicates: 0, invalid: 0, warnings: [] };
  const dir = livenessDir(directory);
  if (!fs.existsSync(dir)) return result;
  const parked = path.join(dir, PENDING_REPORTS);
  if (fs.existsSync(parked)) fs.renameSync(parked, path.join(dir, `${DRAINING_PREFIX}${process.pid}-${now}`));
  for (const name of fs
    .readdirSync(dir)
    .filter((entry) => entry.startsWith(DRAINING_PREFIX))
    .sort()) {
    const file = path.join(dir, name);
    for (const [index, text] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      const outcome = consumePendingReport(db, trimmed, config, now);
      if (outcome.status === 'consumed') result.consumed += 1;
      else if (outcome.status === 'duplicate') result.duplicates += 1;
      else {
        result.invalid += 1;
        result.warnings.push(
          `pending report line ${index + 1} of ${name} is invalid (${outcome.reason}); kept in pending-reports.invalid.jsonl`,
        );
        fs.appendFileSync(path.join(dir, 'pending-reports.invalid.jsonl'), `${trimmed}\n`, { mode: 0o600 });
      }
    }
    fs.rmSync(file, { force: true });
  }
  return result;
}

/**
 * One watchdog cycle: classify, reconcile, then write wake requests / escalations.
 * Reconciliation (git, pid, status file) runs first, outside any lock. The decision and its
 * ledger writes then happen in one IMMEDIATE transaction over the already-gathered
 * observations, so two concurrent watchers cannot send the same wake twice and no subprocess
 * runs under the write lock. Files (inbox, escalations.jsonl) are written after the commit;
 * a lost inbox file is rebuilt from the ledger on the next cycle.
 * @param {{ db: object, directory: string, config: object, now?: number, io?: object, notify?: Function }} options
 */
function runWatchCycle({ db, directory, config, now = Date.now(), io, notify = defaultNotify }) {
  const result = {
    at: new Date(now).toISOString(),
    runs: [],
    wake_requests: [],
    deferred: [],
    escalations: [],
    notifications: [],
    overdue: [],
    reconciled: [],
    rebuilt: [],
    pruned: [],
  };
  result.pending_reports = drainPendingReports({ db, directory, config, now });
  const observed = new Map();
  for (const run of evaluateRuns(db, config, now, io)) {
    if (run.reconcile) observed.set(`${run.session}\u0000${run.agent}`, run.reconcile);
  }

  let wakesThisCycle = 0;
  const inboxWrites = [];
  let runs = [];
  const cycle = db.transaction(() => {
    runs = evaluateRuns(db, config, now, io, observed).sort((a, b) => a.last_event_at.localeCompare(b.last_event_at));
    for (const run of runs) {
      const key = { session: run.session, agent: run.agent, now };
      if (run.reconcile?.active) {
        const truth = { ...run.truth, head: run.reconcile.observations.head.current };
        recordEvent(db, { ...key, kind: 'heartbeat', payload: { source: 'reconcile', truth } });
        result.reconciled.push({ session: run.session, agent: run.agent });
        continue;
      }
      if (run.state === 'running' && run.overdue && !run.lease_overdue_recorded) {
        recordEvent(db, {
          ...key,
          kind: 'overdue',
          payload: { reason: 'lease_expired', reason_code: run.reason_code, lease_expires_at: run.lease_expires_at, escalated: false },
        });
        result.overdue.push({ session: run.session, agent: run.agent, lease_expires_at: run.lease_expires_at });
      }
      if (run.violation && !run.violation_recorded) {
        recordEvent(db, {
          ...key,
          kind: 'idle_violation',
          payload: { state: run.state, reason_code: run.reason_code, detail: run.detail },
        });
        run.violation_recorded = true;
      }
      if (run.action === 'wake' && wakesThisCycle >= config.max_wakes_per_cycle) {
        result.deferred.push({ session: run.session, agent: run.agent });
        run.action = 'deferred';
      } else
        switch (run.action) {
          case 'wake': {
            wakesThisCycle += 1;
            const attempt = run.attempts + 1;
            const reason = wakeReason(run, config, attempt);
            const event = recordEvent(db, {
              ...key,
              kind: 'wake_sent',
              payload: { attempt, state: run.state, reason_code: run.reason_code, reason },
            });
            run.last_wake = { id: event.id, ts: event.ts, payload: { attempt, state: run.state, reason } };
            inboxWrites.push({ session: run.session, agent: run.agent, seq: event.id, reason, createdAt: event.ts, attempt });
            result.wake_requests.push({
              file: `${run.session}-${run.agent}-${event.id}.json`,
              session: run.session,
              agent: run.agent,
              attempt,
              reason,
            });
            run.attempts = attempt;

            break;
          }
          case 'escalate': {
            const cause = run.wait && run.wait.wake_via === 'human' ? 'waiting_on_human' : 'wake_exhausted';
            const escalation = {
              session: run.session,
              agent: run.agent,
              state: run.state,
              cause,
              escalate_to: config.escalate_to,
              detail: run.detail,
              created_at: new Date(now).toISOString(),
            };
            recordEvent(db, {
              ...key,
              kind: 'overdue',
              payload: {
                reason: cause,
                reason_code: cause === 'wake_exhausted' ? 'wake_exhausted' : 'wait_deadline_exceeded',
                escalated: true,
                escalate_to: config.escalate_to,
              },
            });
            enqueue(db, 'escalation', escalation, `HSEOS liveness: ${escalation.agent} needs a human`, now);
            run.escalated = true;
            result.escalations.push(escalation);

            break;
          }
          case 'notify': {
            const notice = {
              session: run.session,
              agent: run.agent,
              state: run.state,
              cause: run.state,
              escalate_to: config.escalate_to,
              detail: run.detail,
              blocked_age_s: run.blocked_age_s,
              created_at: new Date(now).toISOString(),
            };
            recordEvent(db, {
              ...key,
              kind: 'overdue',
              payload: {
                reason: run.state,
                reason_code: run.reason_code,
                notified: true,
                escalated: false,
                escalate_to: config.escalate_to,
              },
            });
            enqueue(db, 'notification', notice, `HSEOS liveness: ${run.agent} is ${run.state}`, now);
            run.terminal_notified = true;
            result.notifications.push(notice);

            break;
          }
          // No default
        }
    }
  });
  cycle.immediate();

  for (const write of inboxWrites) writeInboxRequest(directory, write);
  result.rebuilt = rebuildInbox(directory, runs);
  result.pruned = pruneInbox(directory, new Map(runs.map((run) => [`${run.session}\u0000${run.agent}`, run])));
  result.coordination_pending = readCoordinationInbox(directory).length;
  result.runs = runs.map((run) => summarizeRun(run));
  result.delivered = deliverOutbox(db, directory, notify, { now, config });
  return result;
}

/**
 * Watchdog loop. `once` runs a single cycle. The contract is re-read every cycle, so
 * disabling it takes effect without restarting the watcher.
 * @param {{ directory: string, loadConfig: Function, once?: boolean, maxCycles?: number, sleep?: Function, now?: Function, io?: object, notify?: Function, shouldStop?: Function }} options
 */
async function runWatch({
  directory,
  loadConfig,
  once = false,
  maxCycles = Infinity,
  sleep,
  now = Date.now,
  io,
  notify,
  shouldStop = () => false,
}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cycles = [];
  for (let index = 0; index < maxCycles && !shouldStop(); index += 1) {
    const loaded = loadConfig(directory);
    if (!loaded.valid) {
      cycles.push({ at: new Date(now()).toISOString(), enabled: false, errors: loaded.errors });
    } else if (loaded.enabled) {
      const db = openLivenessDb(directory, { write: true });
      try {
        cycles.push({ enabled: true, ...runWatchCycle({ db, directory, config: loaded.config, now: now(), io, notify }) });
      } finally {
        db.close();
      }
    } else {
      cycles.push({ at: new Date(now()).toISOString(), enabled: false });
    }
    if (once || index + 1 >= maxCycles) break;
    await wait((loaded.config.watch_interval_s || 120) * 1000);
  }
  return cycles;
}

/**
 * Counts per enumerated reason_code: current runs and every wake sent so far.
 */
function reasonCodeMetrics(runs) {
  const metrics = { runs_by_reason_code: {}, wakes_by_reason_code: {} };
  for (const run of runs) {
    metrics.runs_by_reason_code[run.reason_code] = (metrics.runs_by_reason_code[run.reason_code] ?? 0) + 1;
    for (const code of run.wake_codes) metrics.wakes_by_reason_code[code] = (metrics.wakes_by_reason_code[code] ?? 0) + 1;
  }
  return metrics;
}

/**
 * Classification rows for the state-ui snapshot (read-only).
 */
function snapshotLiveness(db, config, now = Date.now(), io) {
  try {
    return evaluateRuns(db, config, now, io).map((run) => ({
      session: run.session,
      agent: run.agent,
      class: run.state,
      reason_code: run.reason_code,
      idle_for_s: run.idle_for_s,
      wake_attempts: run.attempts,
      ...(run.blocked_age_s === null ? {} : { blocked_age_s: run.blocked_age_s }),
    }));
  } catch {
    return [];
  }
}

/**
 * Read-only status for `hseos liveness check`.
 */
function checkRuns({ directory, config, now = Date.now(), io }) {
  const db = openLivenessDb(directory);
  const runs = [];
  let evaluated = [];
  let outbox = { pending: 0, gave_up: 0 };
  if (db) {
    try {
      evaluated = evaluateRuns(db, config, now, io);
      for (const run of evaluated) runs.push(summarizeRun(run));
      outbox = outboxStats(db);
    } finally {
      db.close();
    }
  }
  return { runs, wake_requests: pendingWakeRequests(evaluated), metrics: reasonCodeMetrics(evaluated), outbox };
}

// ----------------------------------------------------------------- await ----

function parseStatusFile(file) {
  try {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    return body && Number.isInteger(body.exit_code) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Foreground wait that keeps the turn alive. Never waits longer than
 * `foregroundMaxS`; when the condition is still pending it says "ainda rodando,
 * chame de novo" so the agent calls it again instead of ending its turn.
 * @param {{ pid?: number, file?: string, cmdStatus?: string, maxS?: number, foregroundMaxS: number, pollMs?: number, now?: Function, sleep?: Function, isPidAlive?: Function, onTick?: Function, tickEveryS?: number }} options
 */
async function awaitCondition(options) {
  const {
    pid,
    file,
    cmdStatus,
    foregroundMaxS,
    pollMs = 1000,
    now = Date.now,
    isPidAlive = defaultIsPidAlive,
    onTick,
    tickEveryS = 0,
  } = options;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const selected = [pid !== undefined, file !== undefined, cmdStatus !== undefined].filter(Boolean).length;
  if (selected !== 1) throw new TypeError('await requires exactly one of --pid, --file or --cmd-status');
  if (pid !== undefined && !(Number.isInteger(pid) && pid > 0)) throw new TypeError('--pid must be a positive integer');
  if (file !== undefined && !path.isAbsolute(file)) throw new TypeError('--file must be an absolute path');
  if (cmdStatus !== undefined && !path.isAbsolute(cmdStatus)) throw new TypeError('--cmd-status must be an absolute path');
  const requested = options.maxS === undefined ? foregroundMaxS : options.maxS;
  if (!Number.isFinite(requested) || requested <= 0) throw new TypeError('--max must be a positive number of seconds');
  const maxS = Math.min(requested, foregroundMaxS);
  const condition = pid === undefined ? (file === undefined ? 'cmd-status' : 'file') : 'pid';

  const probe = () => {
    if (condition === 'pid') return isPidAlive(pid) ? null : {};
    if (condition === 'file') return fs.existsSync(file) ? {} : null;
    const status = parseStatusFile(cmdStatus);
    return status ? { exit_code: status.exit_code, finished_at: status.finished_at ?? null } : null;
  };

  const started = now();
  let lastTick = -Infinity;
  for (;;) {
    const elapsedMs = now() - started;
    if (onTick && tickEveryS > 0 && elapsedMs - lastTick >= tickEveryS * 1000) {
      lastTick = elapsedMs;
      onTick();
    }
    const outcome = probe();
    if (outcome) {
      return {
        status: 'done',
        condition,
        waited_s: seconds(now() - started),
        max_s: maxS,
        clamped: requested > foregroundMaxS,
        ...outcome,
      };
    }
    if (elapsedMs >= maxS * 1000) {
      return {
        status: 'running',
        condition,
        waited_s: seconds(elapsedMs),
        max_s: maxS,
        clamped: requested > foregroundMaxS,
        message: 'ainda rodando, chame de novo (do not end the turn)',
      };
    }
    await sleep(Math.min(pollMs, Math.max(1, maxS * 1000 - elapsedMs)));
  }
}

// ---------------------------------------------------------------- systemd ----

function assertUnitValue(label, value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    [...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)
  ) {
    throw new TypeError(`${label} must be a non-empty single-line string`);
  }
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('$', '$$$$')
    .replaceAll('%', '%%')
    .replaceAll('"', String.raw`\"`);
}

/**
 * Render the `systemd --user` units that run `hseos liveness watch --once`, so the
 * watchdog does not depend on any agent session. Printed, never installed.
 */
function renderSystemdUnits({ directory, nodePath, cliPath, intervalS }) {
  const dir = assertUnitValue('directory', directory);
  const node = assertUnitValue('nodePath', nodePath);
  const cli = assertUnitValue('cliPath', cliPath);
  const interval = Number.isInteger(intervalS) && intervalS >= 5 ? intervalS : 120;
  const service = `[Unit]
Description=HSEOS agent liveness watchdog (one cycle)

[Service]
Type=oneshot
WorkingDirectory="${dir}"
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=%t/bus
ExecStart="${node}" "${cli}" liveness watch --once --directory "${dir}"
Nice=10
`;
  const timer = `[Unit]
Description=HSEOS agent liveness watchdog timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=${interval}s
AccuracySec=10s

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

module.exports = {
  EVENT_KINDS,
  SAFE_ID,
  WAKE_BACKOFF_BASE_S,
  WAKE_BACKOFF_MAX_S,
  assertSafeId,
  awaitCondition,
  checkRuns,
  classifyRun,
  defaultNotify,
  deliverOutbox,
  drainPendingReports,
  outboxStats,
  defaultReadHead,
  assertLivenessSchema,
  ensureLivenessSchema,
  INERT_IO,
  evaluateRuns,
  inboxDir,
  loadRuns,
  openLivenessDb,
  pendingWakeRequests,
  planAction,
  readInbox,
  readCoordinationInbox,
  rebuildInbox,
  reasonCodeMetrics,
  snapshotLiveness,
  verifyEvidence,
  reconcileRun,
  recordEvent,
  recordReport,
  renderSystemdUnits,
  runWatch,
  runWatchCycle,
  wakeDelayS,
};
