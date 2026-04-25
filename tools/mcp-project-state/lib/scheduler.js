/**
 * In-process scheduler for the MCP project-state server.
 *
 * Currently schedules a single task: stale-heartbeat sweep every N minutes.
 * Uses `setInterval` (no `node-cron` dep) — sweep cadence is simple enough.
 *
 * Returns a stop function so the MCP server can clean up on SIGTERM.
 */

const { sweepOrphans } = require('./stale-detector');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ intervalMs?: number, staleMinutes?: number, log?: (level: string, msg: string) => void }} [options]
 * @returns {() => void} stopper — call to cancel the schedule
 */
function startScheduler(db, options = {}) {
  const intervalMs = Number.parseInt(options.intervalMs ?? DEFAULT_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;
  const staleMinutes = Number.parseInt(options.staleMinutes ?? 10, 10) || 10;
  const log = options.log || ((level, msg) => console.log(`[scheduler:${level}] ${msg}`));

  const tick = () => {
    try {
      const result = sweepOrphans(db, staleMinutes);
      if (result.swept > 0) {
        log('info', `swept ${result.swept} orphan(s): ${result.ids.join(',')}`);
      }
    } catch (error) {
      log('error', `sweep failed: ${error.message}`);
    }
  };

  // Don't sweep immediately — wait one interval to avoid touching just-started runs.
  const timer = setInterval(tick, intervalMs);
  log('info', `started; sweeping every ${Math.round(intervalMs / 1000)}s, threshold ${staleMinutes}min`);

  return function stop() {
    clearInterval(timer);
    log('info', 'stopped');
  };
}

module.exports = { startScheduler, DEFAULT_INTERVAL_MS };
