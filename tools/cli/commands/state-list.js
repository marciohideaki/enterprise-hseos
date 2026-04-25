/**
 * `hseos state-list` — list runs, agent-runs, or orphans from the agent-state SQLite store.
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
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  return { db };
}

function tabulate(rows, columns) {
  if (rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '-').length)));
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  console.log(columns.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(sep);
  for (const r of rows) {
    console.log(columns.map((c, i) => String(r[c] ?? '-').padEnd(widths[i])).join('  '));
  }
}

module.exports = {
  command: 'state-list',
  description: 'List runs, agent-runs, or orphans from the agent-state store.',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--run <id>', 'Filter by run id'],
    ['--status <status>', 'Filter by status'],
    ['--orphans', 'Show running agent-runs without recent heartbeat'],
    ['--stale-minutes <n>', 'Threshold for orphan detection (default 10)', '10'],
    ['--json', 'Output as JSON'],
  ],
  action: (options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const ctx = openState(directory);
    if (!ctx) {
      if (options.json) console.log('[]');
      else console.log('(no state db; nothing to list)');
      return;
    }
    const { db } = ctx;

    let rows;
    let columns;
    if (options.orphans) {
      const stale = parseInt(options.staleMinutes, 10) || 10;
      rows = db
        .prepare(
          `SELECT id, agent_name, task_id, run_id, started_at, last_heartbeat_at, status
           FROM as_agent_runs
           WHERE status = 'running' AND last_heartbeat_at IS NOT NULL
             AND last_heartbeat_at < datetime('now', '-${stale} minutes')
           ORDER BY last_heartbeat_at DESC`
        )
        .all();
      columns = ['id', 'agent_name', 'task_id', 'run_id', 'last_heartbeat_at', 'status'];
    } else if (options.run) {
      rows = db
        .prepare(`SELECT id, agent_name, task_id, started_at, ended_at, status FROM as_agent_runs WHERE run_id = ? ORDER BY started_at`)
        .all(options.run);
      columns = ['id', 'agent_name', 'task_id', 'started_at', 'ended_at', 'status'];
    } else {
      const sql = options.status
        ? `SELECT id, workflow_id, project, phase, gate_status, status, started_at FROM as_runs WHERE status = ? ORDER BY started_at DESC LIMIT 100`
        : `SELECT id, workflow_id, project, phase, gate_status, status, started_at FROM as_runs ORDER BY started_at DESC LIMIT 100`;
      rows = options.status ? db.prepare(sql).all(options.status) : db.prepare(sql).all();
      columns = ['id', 'workflow_id', 'phase', 'gate_status', 'status', 'started_at'];
    }

    if (options.json) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      tabulate(rows, columns);
    }
  },
};
