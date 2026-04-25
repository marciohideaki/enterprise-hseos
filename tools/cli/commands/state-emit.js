/**
 * `hseos state-emit` — emit a structured event into the agent-state SQLite store.
 * Best-effort write: idempotently runs migrations on first call. Used by hooks and skills.
 */

const path = require('node:path');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
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

function ensureAgentRun(dal, db, { run_id, task_id, agent_name }) {
  if (!task_id) return null;
  const row = db
    .prepare(
      `SELECT id FROM as_agent_runs WHERE run_id = ? AND task_id = ? AND agent_name = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`
    )
    .get(run_id, task_id, agent_name);
  if (row) return row.id;
  db.prepare(`INSERT INTO as_agent_runs (agent_name, task_id, run_id) VALUES (?, ?, ?)`).run(
    agent_name || 'unknown',
    task_id,
    run_id
  );
  return db.prepare(`SELECT last_insert_rowid() AS rowid`).get().rowid;
}

module.exports = {
  command: 'state-emit <kind>',
  description:
    'Emit an agent-state event (start/heartbeat/checkpoint/complete/abort/tool_call/gate). Best-effort write to SQLite.',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--run <id>', 'Run id'],
    ['--task <id>', 'Task id'],
    ['--agent <name>', 'Agent name'],
    ['--payload <json>', 'JSON payload (string)'],
    ['--silent', 'Suppress non-error output'],
  ],
  action: (kind, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const ctx = openState(directory);
    if (!ctx) {
      if (!options.silent) console.error('[state-emit] better-sqlite3 unavailable — event dropped');
      return;
    }
    const { db, dal } = ctx;
    const run_id = options.run || process.env.HSEOS_CURRENT_RUN_ID;
    const task_id = options.task || process.env.HSEOS_CURRENT_TASK;
    const agent_name = options.agent || process.env.HSEOS_CURRENT_AGENT || 'unknown';
    if (!run_id) {
      if (!options.silent) console.error('[state-emit] no run id — event dropped');
      return;
    }
    dal.createRun({ id: run_id, workflow_id: process.env.HSEOS_WORKFLOW || 'dev-squad', project: directory });
    const agent_run_id = ensureAgentRun(dal, db, { run_id, task_id, agent_name });

    let payload = null;
    if (options.payload) {
      try {
        payload = JSON.parse(options.payload);
      } catch {
        payload = { raw: options.payload };
      }
    }

    if (kind === 'heartbeat' && agent_run_id) {
      dal.recordHeartbeat(agent_run_id);
    } else if (agent_run_id) {
      dal.emitEvent({ agent_run_id, kind, payload });
    } else {
      db.prepare(`INSERT INTO as_events (agent_run_id, kind, payload_json) VALUES (NULL, ?, ?)`).run(
        kind,
        payload === null ? null : JSON.stringify(payload)
      );
    }

    if (!options.silent) console.log(`[state-emit] ${kind} run=${run_id} task=${task_id || '-'} agent=${agent_name}`);
  },
};
