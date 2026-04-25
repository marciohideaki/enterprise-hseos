/**
 * MCP tools for `as_runs` table.
 *
 * Each tool exports `{ name, description, inputSchema, handler(db, args, dal) }`.
 * Loaded dynamically by `tools/mcp-project-state/index.js` at startup.
 */

module.exports = [
  {
    name: 'runs_list',
    description: 'List runs from the agent-state store.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Filter by status (active|completed|aborted|orphaned)" },
        project: { type: 'string', description: 'Filter by project path' },
        limit: { type: 'integer', default: 100 },
      },
    },
    handler: (db, args = {}) => {
      const conditions = [];
      const params = [];
      if (args.status) {
        conditions.push('status = ?');
        params.push(args.status);
      }
      if (args.project) {
        conditions.push('project = ?');
        params.push(args.project);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Number.parseInt(args.limit ?? 100, 10) || 100;
      const rows = db
        .prepare(
          `SELECT id, workflow_id, project, phase, gate_status, status, started_at, ended_at, session_id, base_branch
           FROM as_runs ${where} ORDER BY started_at DESC LIMIT ?`
        )
        .all(...params, limit);
      return { runs: rows, count: rows.length };
    },
  },
  {
    name: 'run_describe',
    description: 'Describe a single run with task/agent_run counts and last events.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
      },
      required: ['run_id'],
    },
    handler: (db, args = {}) => {
      const run = db.prepare(`SELECT * FROM as_runs WHERE id = ?`).get(args.run_id);
      if (!run) throw new Error(`Run not found: ${args.run_id}`);
      const taskCounts = db
        .prepare(`SELECT status, COUNT(*) AS n FROM as_tasks WHERE run_id = ? GROUP BY status`)
        .all(args.run_id);
      const agentRunCounts = db
        .prepare(`SELECT status, COUNT(*) AS n FROM as_agent_runs WHERE run_id = ? GROUP BY status`)
        .all(args.run_id);
      const lastEvents = db
        .prepare(
          `SELECT e.id, e.kind, e.ts, ar.agent_name, ar.task_id
           FROM as_events e LEFT JOIN as_agent_runs ar ON ar.id = e.agent_run_id
           WHERE ar.run_id = ?
           ORDER BY e.id DESC LIMIT 20`
        )
        .all(args.run_id);
      return { run, task_status_counts: taskCounts, agent_run_status_counts: agentRunCounts, last_events: lastEvents };
    },
  },
  {
    name: 'run_create',
    description: 'Create a new run (idempotent, INSERT OR IGNORE).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        workflow_id: { type: 'string' },
        project: { type: 'string' },
        phase: { type: 'string', default: 'intake' },
      },
      required: ['id', 'workflow_id', 'project'],
    },
    handler: (db, args = {}, dal) => {
      if (!dal) throw new Error('DAL not available');
      return dal.createRun({
        id: args.id,
        workflow_id: args.workflow_id,
        project: args.project,
        phase: args.phase || 'intake',
      });
    },
  },
];
