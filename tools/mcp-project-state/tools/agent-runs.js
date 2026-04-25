/**
 * MCP tools for `as_agent_runs` table — running agents and orphan detection.
 */

module.exports = [
  {
    name: 'agent_runs_list',
    description: 'List agent_runs filtered by run, status, or agent name.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        status: { type: 'string' },
        agent_name: { type: 'string' },
        limit: { type: 'integer', default: 100 },
      },
    },
    handler: (db, args = {}) => {
      const conditions = [];
      const params = [];
      if (args.run_id) {
        conditions.push('run_id = ?');
        params.push(args.run_id);
      }
      if (args.status) {
        conditions.push('status = ?');
        params.push(args.status);
      }
      if (args.agent_name) {
        conditions.push('agent_name = ?');
        params.push(args.agent_name);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Number.parseInt(args.limit ?? 100, 10) || 100;
      const rows = db
        .prepare(
          `SELECT id, agent_name, task_id, run_id, started_at, last_heartbeat_at, ended_at, status, exit_reason, tokens_in, tokens_out, cost_usd
           FROM as_agent_runs ${where} ORDER BY id DESC LIMIT ?`
        )
        .all(...params, limit);
      return { agent_runs: rows, count: rows.length };
    },
  },
  {
    name: 'orphans_list',
    description: 'List running agent_runs whose last_heartbeat_at is older than stale_minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        stale_minutes: { type: 'integer', default: 10 },
      },
    },
    handler: (db, args = {}) => {
      const stale = Number.parseInt(args.stale_minutes ?? 10, 10) || 10;
      const rows = db
        .prepare(
          `SELECT id, agent_name, task_id, run_id, started_at, last_heartbeat_at, status
           FROM as_agent_runs
           WHERE status = 'running'
             AND last_heartbeat_at IS NOT NULL
             AND last_heartbeat_at < datetime('now', '-${stale} minutes')
           ORDER BY last_heartbeat_at`
        )
        .all();
      return { orphans: rows, count: rows.length, stale_minutes: stale };
    },
  },
];
