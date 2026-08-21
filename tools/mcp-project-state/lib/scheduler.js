/**
 * In-process scheduler for the MCP project-state server.
 *
 * Currently schedules a single task: stale-heartbeat sweep every N minutes.
 * Uses `setInterval` (no `node-cron` dep) — sweep cadence is simple enough.
 *
 * Returns a stop function so the MCP server can clean up on SIGTERM.
 */

const { randomUUID } = require('node:crypto');
const path = require('node:path');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * @param {{execute: (request: object) => Promise<object>}} scheduler
 * @param {{ dbPath: string, project: string, intervalMs?: number, staleMinutes?: number, log?: (level: string, msg: string) => void }} options
 * @returns {() => void} stopper — call to cancel the schedule
 */
async function runStaleSweep(scheduler, options) {
  const staleMinutes = Number.parseInt(options.staleMinutes ?? 10, 10) || 10;
  const project = path.resolve(options.project);
  const outcome = await scheduler.execute({
    tool: 'scheduler_sweep_orphans',
    input: { stale_minutes: staleMinutes },
    actor: { id: 'hseos:project-state-scheduler', type: 'system' },
    resource_scope: { project, server: 'project_state', state_db: path.resolve(options.dbPath) },
    idempotency_key: randomUUID(),
  });
  if (!outcome.ok) {
    const error = new Error(outcome.error.message);
    error.code = outcome.error.code;
    throw error;
  }
  return outcome.data.result;
}

function startScheduler(scheduler, options = {}) {
  if (!scheduler || typeof scheduler.execute !== 'function') throw new TypeError('Governed execution scheduler is required');
  if (!options.dbPath || !options.project) throw new TypeError('Scheduler dbPath and project scope are required');
  const intervalMs = Number.parseInt(options.intervalMs ?? DEFAULT_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;
  const staleMinutes = Number.parseInt(options.staleMinutes ?? 10, 10) || 10;
  const log = options.log || ((level, msg) => console.log(`[scheduler:${level}] ${msg}`));

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runStaleSweep(scheduler, { ...options, staleMinutes });
      if (result.swept > 0) {
        log('info', `swept ${result.swept} orphan(s): ${result.ids.join(',')}`);
      }
    } catch (error) {
      log('error', `sweep failed: ${error.message}`);
    } finally {
      running = false;
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

module.exports = { startScheduler, runStaleSweep, DEFAULT_INTERVAL_MS };
