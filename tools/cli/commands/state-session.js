/**
 * `hseos state-session` — always-on session tracking (any agent, any launcher).
 *
 * Feeds `as_sessions` (migrations 003/004) for EVERY Claude/Codex session, not
 * just hseos-orchestrated runs — plain terminal sessions register here via the
 * session-track.sh hook so kanban/fleet views can show all activity.
 *
 * Session state is project-scoped by default. Cross-project fleet aggregation
 * belongs to the optional central side-car and its explicit registry.
 */

const os = require('node:os');
const path = require('node:path');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

function openState(directory) {
  if (!Database) return null;
  const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
  const fs = require('node:fs');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  const { runMigrations } = require('../../mcp-project-state/lib/migrations');
  runMigrations(db, path.join(__dirname, '..', '..', 'mcp-project-state', 'migrations'), { log: () => {} });
  const { AgentStateDAL } = require('../../mcp-project-state/lib/agent-state-dal');
  return { db, dal: new AgentStateDAL(db) };
}

function tabulate(rows, columns) {
  if (rows.length === 0) {
    console.log('(no sessions)');
    return;
  }
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '-').length)));
  console.log(columns.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log(columns.map((c, i) => String(r[c] ?? '-').padEnd(widths[i])).join('  '));
  }
}

module.exports = {
  command: 'state-session <action>',
  description: 'Track live agent sessions in a project store (register/heartbeat/end/list/sweep).',
  options: [
    ['--directory <path>', 'Project store root (default: current directory)'],
    ['--session <id>', 'Session id (UUID from the agent harness)'],
    ['--parent <id>', 'Parent session id (subagent dispatch)'],
    ['--cwd <path>', 'Working directory of the session'],
    ['--service <name>', 'Agent service name (claude-code | codex-cli | ...)'],
    ['--host <name>', 'Host identity (default: os.hostname())'],
    ['--status <status>', 'End status: completed | killed | orphaned (default completed)'],
    ['--stale-minutes <n>', 'sweep: orphan active sessions idle longer than this (default 1440)'],
    ['--all', 'list: include ended sessions'],
    ['--limit <n>', 'list: max rows (default 50)'],
    ['--json', 'Output as JSON'],
    ['--silent', 'Suppress non-error output'],
  ],
  action: (action, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const ctx = openState(directory);
    if (!ctx) {
      if (!options.silent) console.log('(better-sqlite3 not installed; state-session is a no-op)');
      return;
    }
    const { db, dal } = ctx;
    const out = (obj) => {
      if (options.silent) return;
      if (options.json) console.log(JSON.stringify(obj));
      else console.log(typeof obj === 'string' ? obj : JSON.stringify(obj));
    };

    try {
      switch (action) {
        case 'register':
        case 'heartbeat': {
          // Both are the same idempotent upsert: register-if-missing + touch
          // last_seen. A heartbeat for an unknown session (hook installed
          // mid-session) must still create the row.
          if (!options.session) throw new Error('--session <id> is required');
          dal.registerSession({
            id: options.session,
            parent_id: options.parent || null,
            host: options.host || os.hostname(),
            cwd: options.cwd || null,
            service: options.service || null,
          });
          out({ ok: true, action, session: options.session });
          break;
        }
        case 'end': {
          if (!options.session) throw new Error('--session <id> is required');
          const status = options.status || 'completed';
          const { changes } = dal.endSession(options.session, status);
          out({ ok: true, action: 'end', session: options.session, status, changes });
          break;
        }
        case 'sweep': {
          const stale = parseInt(options.staleMinutes, 10) || 1440;
          const { changes } = dal.sweepOrphanSessions(stale);
          out({ ok: true, action: 'sweep', stale_minutes: stale, orphaned: changes });
          break;
        }
        case 'list': {
          const rows = dal.listSessions({
            all: Boolean(options.all),
            limit: parseInt(options.limit, 10) || 50,
          });
          if (options.json) console.log(JSON.stringify(rows));
          else tabulate(rows, ['id', 'service', 'host', 'cwd', 'status', 'started_at', 'last_seen_at']);
          break;
        }
        default: {
          throw new Error(`unknown action "${action}" (expected register|heartbeat|end|list|sweep)`);
        }
      }
    } catch (error) {
      console.error(`state-session: ${error.message}`);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  },
};
