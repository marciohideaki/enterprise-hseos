/**
 * `hseos state-describe` — show a run or agent-run in detail (counts, last events).
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
  return new Database(dbPath, { readonly: true });
}

function describeRun(db, run_id) {
  const run = db.prepare(`SELECT * FROM as_runs WHERE id = ?`).get(run_id);
  if (!run) return null;
  const taskCounts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM as_tasks WHERE run_id = ? GROUP BY status`)
    .all(run_id);
  const agentRunCounts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM as_agent_runs WHERE run_id = ? GROUP BY status`)
    .all(run_id);
  const lastEvents = db
    .prepare(
      `SELECT e.id, e.kind, e.ts, ar.agent_name, ar.task_id
       FROM as_events e LEFT JOIN as_agent_runs ar ON ar.id = e.agent_run_id
       WHERE ar.run_id = ? OR e.agent_run_id IS NULL
       ORDER BY e.ts DESC LIMIT 10`
    )
    .all(run_id);
  return { kind: 'run', run, task_status_counts: taskCounts, agent_run_status_counts: agentRunCounts, last_events: lastEvents };
}

function describeAgentRun(db, agent_run_id) {
  const ar = db.prepare(`SELECT * FROM as_agent_runs WHERE id = ?`).get(agent_run_id);
  if (!ar) return null;
  const events = db
    .prepare(`SELECT id, kind, ts, payload_json FROM as_events WHERE agent_run_id = ? ORDER BY ts DESC LIMIT 50`)
    .all(agent_run_id);
  return { kind: 'agent_run', agent_run: ar, events };
}

module.exports = {
  command: 'state-describe <id>',
  description: 'Describe a run (text id) or agent-run (numeric id) — counts, statuses, last events.',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--json', 'Output as JSON'],
  ],
  action: (id, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const db = openState(directory);
    if (!db) {
      console.error('[state-describe] no state db at', directory);
      process.exit(1);
    }

    const numeric = /^\d+$/.test(id);
    const result = numeric ? describeAgentRun(db, parseInt(id, 10)) : describeRun(db, id);

    if (!result) {
      console.error(`[state-describe] not found: ${id}`);
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.kind === 'run') {
      const r = result.run;
      console.log(`Run ${r.id}`);
      console.log(`  workflow:    ${r.workflow_id}`);
      console.log(`  project:     ${r.project}`);
      console.log(`  phase:       ${r.phase}    gate: ${r.gate_status}    status: ${r.status}`);
      console.log(`  started_at:  ${r.started_at}    ended_at: ${r.ended_at || '-'}`);
      console.log(`  session_id:  ${r.session_id || '-'}    base_branch: ${r.base_branch || '-'}`);
      console.log(`  task statuses:`);
      for (const t of result.task_status_counts) console.log(`    ${t.status}: ${t.n}`);
      console.log(`  agent_run statuses:`);
      for (const a of result.agent_run_status_counts) console.log(`    ${a.status}: ${a.n}`);
      console.log(`  last 10 events:`);
      for (const e of result.last_events)
        console.log(`    [${e.ts}] ${e.kind.padEnd(11)} agent=${e.agent_name || '-'} task=${e.task_id || '-'}`);
    } else {
      const ar = result.agent_run;
      console.log(`AgentRun ${ar.id}`);
      console.log(`  agent:       ${ar.agent_name}`);
      console.log(`  task:        ${ar.task_id}    run: ${ar.run_id}`);
      console.log(`  started_at:  ${ar.started_at}    ended_at: ${ar.ended_at || '-'}`);
      console.log(`  status:      ${ar.status}    exit_reason: ${ar.exit_reason || '-'}`);
      console.log(`  heartbeat:   ${ar.last_heartbeat_at || '-'}`);
      console.log(`  events (last 50):`);
      for (const e of result.events) console.log(`    [${e.ts}] ${e.kind}    payload=${e.payload_json || '-'}`);
    }
  },
};
