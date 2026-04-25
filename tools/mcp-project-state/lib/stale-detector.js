/**
 * Stale-heartbeat detector for `as_agent_runs`.
 *
 * Marks running agent_runs whose last_heartbeat_at is older than `staleMinutes`
 * as `orphaned`. Idempotent — already-orphaned rows are not touched.
 *
 * Used by:
 *   - The MCP server's in-process scheduler (lib/scheduler.js)
 *   - The CLI one-shot command (`hseos state-stale-sweep`)
 */

/**
 * Sweep orphaned agent runs.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} [staleMinutes=10] Threshold in minutes since last heartbeat.
 * @returns {{ swept: number, ids: number[], stale_minutes: number }}
 */
function sweepOrphans(db, staleMinutes = 10) {
  const stale = Number.parseInt(staleMinutes, 10) || 10;
  // SQLite RETURNING is supported as of 3.35 (2021); better-sqlite3 ships modern.
  const rows = db
    .prepare(
      `UPDATE as_agent_runs
       SET status = 'orphaned',
           exit_reason = COALESCE(exit_reason, 'stale-heartbeat'),
           ended_at = datetime('now')
       WHERE status = 'running'
         AND last_heartbeat_at IS NOT NULL
         AND last_heartbeat_at < datetime('now', '-${stale} minutes')
       RETURNING id`
    )
    .all();
  return { swept: rows.length, ids: rows.map((r) => r.id), stale_minutes: stale };
}

module.exports = { sweepOrphans };
