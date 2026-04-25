/**
 * MCP tools for `as_events` table — emit events and FTS5 search across history.
 */

module.exports = [
  {
    name: 'event_emit',
    description: 'Emit a structured event for an agent_run (start/heartbeat/checkpoint/complete/abort/tool_call/gate).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_run_id: { type: 'integer' },
        kind: {
          type: 'string',
          enum: ['start', 'heartbeat', 'checkpoint', 'complete', 'abort', 'tool_call', 'gate'],
        },
        payload: { type: 'object', description: 'Optional structured payload' },
      },
      required: ['agent_run_id', 'kind'],
    },
    handler: (db, args = {}, dal) => {
      if (!dal) throw new Error('DAL not available');
      if (args.kind === 'heartbeat') {
        return dal.recordHeartbeat(args.agent_run_id);
      }
      return dal.emitEvent({
        agent_run_id: args.agent_run_id,
        kind: args.kind,
        payload: args.payload || null,
      });
    },
  },
  {
    name: 'events_search',
    description:
      'Full-text search over events (FTS5 on kind + payload_json). Useful for cross-run queries like "which agent touched auth in the last 30 runs".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'FTS5 MATCH expression' },
        limit: { type: 'integer', default: 50 },
      },
      required: ['query'],
    },
    handler: (db, args = {}) => {
      const limit = Number.parseInt(args.limit ?? 50, 10) || 50;
      const rows = db
        .prepare(
          `SELECT e.id, e.agent_run_id, e.ts, e.kind, e.payload_json,
                  ar.agent_name, ar.task_id, ar.run_id
           FROM as_events_fts f
             JOIN as_events e ON e.id = f.rowid
             LEFT JOIN as_agent_runs ar ON ar.id = e.agent_run_id
           WHERE as_events_fts MATCH ?
           ORDER BY e.id DESC
           LIMIT ?`
        )
        .all(args.query, limit);
      return { hits: rows, count: rows.length, query: args.query };
    },
  },
];
