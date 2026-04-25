/**
 * MCP tools for `as_handoffs` table — Commander-extracted summaries between tasks.
 */

module.exports = [
  {
    name: 'handoffs_list',
    description: 'List handoffs flowing into a task (filter by dst_task) or from a task (filter by src_task).',
    inputSchema: {
      type: 'object',
      properties: {
        src_task: { type: 'string' },
        dst_task: { type: 'string' },
        limit: { type: 'integer', default: 100 },
      },
    },
    handler: (db, args = {}) => {
      const conditions = [];
      const params = [];
      if (args.src_task) {
        conditions.push('src_task = ?');
        params.push(args.src_task);
      }
      if (args.dst_task) {
        conditions.push('dst_task = ?');
        params.push(args.dst_task);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Number.parseInt(args.limit ?? 100, 10) || 100;
      const rows = db
        .prepare(
          `SELECT id, src_task, dst_task, version, created_at,
                  substr(content, 1, 200) AS content_preview
           FROM as_handoffs ${where}
           ORDER BY created_at DESC, version DESC
           LIMIT ?`
        )
        .all(...params, limit);
      return { handoffs: rows, count: rows.length };
    },
  },
  {
    name: 'handoff_get',
    description: 'Get full handoff content by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
    handler: (db, args = {}) => {
      const row = db.prepare(`SELECT * FROM as_handoffs WHERE id = ?`).get(args.id);
      if (!row) throw new Error(`Handoff not found: ${args.id}`);
      return { handoff: row };
    },
  },
];
