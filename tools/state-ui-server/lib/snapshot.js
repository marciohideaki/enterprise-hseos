/**
 * Pure snapshot reader for the agent-state SQLite store.
 *
 * Consumed by both the web side-car (tools/state-ui-server/index.js) and
 * the CLI ASCII renderer (tools/cli/commands/kanban.js). Single source of
 * truth for the kanban shape.
 *
 * Read-only — never writes or mutates the DB.
 */

const TASK_PENDING = new Set(['PENDING_G2', 'PENDING_EXECUTION']);
const TASK_ABORTED = new Set(['BLOCKED', 'FAILED']);

/**
 * @typedef {Object} SnapshotOptions
 * @property {number} [staleMinutes=10] Threshold for orphan classification.
 * @property {string|null} [run=null] Filter to a single run id.
 * @property {string|null} [project=null] Filter to a single project path.
 * @property {number} [eventLimit=100] How many recent events to include.
 */

/**
 * Take a structured snapshot of the agent-state store.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {SnapshotOptions} [opts]
 * @returns {{
 *   ts: string,
 *   runs: Array<object>,
 *   tasks: Array<object>,
 *   agentRuns: Array<object>,
 *   events: Array<object>,
 *   orphans: number[],
 *   counts: { pending: number, running: number, completed: number, aborted: number, orphaned: number },
 *   stale_minutes: number
 * }}
 */
function takeSnapshot(db, opts = {}) {
  const stale = Number.parseInt(opts.staleMinutes ?? 10, 10) || 10;
  const runFilter = opts.run || null;
  const projectFilter = opts.project || null;
  const eventLimit = Number.parseInt(opts.eventLimit ?? 100, 10) || 100;

  const runWhere = [];
  const runParams = [];
  if (runFilter) {
    runWhere.push('id = ?');
    runParams.push(runFilter);
  }
  if (projectFilter) {
    runWhere.push('project = ?');
    runParams.push(projectFilter);
  }
  const runWhereClause = runWhere.length > 0 ? `WHERE ${runWhere.join(' AND ')}` : '';

  const runs = db
    .prepare(
      `SELECT id, workflow_id, project, phase, gate_status, status, started_at, ended_at, session_id, base_branch
       FROM as_runs ${runWhereClause} ORDER BY started_at DESC LIMIT 100`
    )
    .all(...runParams);

  const runIds = runs.map((r) => r.id);
  const placeholders = runIds.length > 0 ? runIds.map(() => '?').join(',') : "''";

  const tasks =
    runIds.length > 0
      ? db
          .prepare(
            `SELECT id, run_id, wave, effort, model_tier, status, goal, branch, last_heartbeat_at
             FROM as_tasks WHERE run_id IN (${placeholders}) ORDER BY run_id, wave, id`
          )
          .all(...runIds)
      : [];

  const agentRuns =
    runIds.length > 0
      ? db
          .prepare(
            `SELECT id, agent_name, task_id, run_id, started_at, last_heartbeat_at, ended_at, status, exit_reason
             FROM as_agent_runs WHERE run_id IN (${placeholders}) ORDER BY id DESC`
          )
          .all(...runIds)
      : [];

  const events =
    agentRuns.length > 0
      ? db
          .prepare(
            `SELECT id, agent_run_id, ts, kind FROM as_events
             WHERE agent_run_id IN (${agentRuns.map(() => '?').join(',')})
             ORDER BY id DESC LIMIT ?`
          )
          .all(...agentRuns.map((a) => a.id), eventLimit)
      : [];

  const orphans = db
    .prepare(
      `SELECT id FROM as_agent_runs
       WHERE status = 'running'
         AND last_heartbeat_at IS NOT NULL
         AND last_heartbeat_at < datetime('now', '-${stale} minutes')`
    )
    .all()
    .map((row) => row.id);
  const orphanSet = new Set(orphans);

  const counts = { pending: 0, running: 0, completed: 0, aborted: 0, orphaned: 0 };
  for (const ar of agentRuns) {
    if (orphanSet.has(ar.id)) {
      counts.orphaned += 1;
      continue;
    }
    switch (ar.status) {
      case 'running': {
        counts.running += 1;
        break;
      }
      case 'completed': {
        counts.completed += 1;
        break;
      }
      case 'aborted':
      case 'killed': {
        counts.aborted += 1;
        break;
      }
      default: {
        break;
      }
    }
  }
  for (const t of tasks) {
    if (TASK_PENDING.has(t.status)) counts.pending += 1;
    else if (TASK_ABORTED.has(t.status)) counts.aborted += 1;
  }

  return {
    ts: new Date().toISOString(),
    runs,
    tasks,
    agentRuns,
    events,
    orphans,
    counts,
    stale_minutes: stale,
  };
}

module.exports = { takeSnapshot };
