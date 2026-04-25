/**
 * `hseos state-stale-sweep` — one-shot orphan sweep.
 *
 * Useful for OS-level cron when MCP server is not running (or when you want a
 * manual sweep). Idempotent.
 */

const path = require('node:path');
const fs = require('node:fs');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

module.exports = {
  command: 'state-stale-sweep',
  description: 'Mark running agent_runs whose heartbeat is older than --stale-minutes as orphaned.',
  options: [
    ['--directory <path>', 'Project directory (default: current)'],
    ['--stale-minutes <n>', 'Threshold in minutes', '10'],
    ['--json', 'Print result as JSON'],
  ],
  action: (options) => {
    if (!Database) {
      console.error('[state-stale-sweep] better-sqlite3 not installed');
      process.exit(1);
    }
    const directory = path.resolve(options.directory || process.cwd());
    const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
    if (!fs.existsSync(dbPath)) {
      console.error(`[state-stale-sweep] no state db at ${dbPath}`);
      process.exit(1);
    }
    const { sweepOrphans } = require('../../mcp-project-state/lib/stale-detector');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    try {
      const result = sweepOrphans(db, options.staleMinutes);
      if (options.json) {
        console.log(JSON.stringify(result));
      } else if (result.swept === 0) {
        console.log('[state-stale-sweep] no orphans');
      } else {
        console.log(`[state-stale-sweep] swept ${result.swept} orphan(s): ${result.ids.join(', ')}`);
      }
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  },
};
