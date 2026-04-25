/**
 * `hseos state-snapshot` — backup the agent-state SQLite db.
 *
 * Copies `.hseos/state/project.db` to `.hseos/state/snapshots/project-{ISO}.db`,
 * pruning to the last N (default 7). Useful before purge or schema migrations.
 */

const path = require('node:path');
const fs = require('node:fs');

module.exports = {
  command: 'state-snapshot',
  description: 'Snapshot the agent-state DB to .hseos/state/snapshots/.',
  options: [
    ['--directory <path>', 'Project directory (default: current)'],
    ['--keep <n>', 'Number of snapshots to retain', '7'],
    ['--json', 'Print result as JSON'],
  ],
  action: (options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
    if (!fs.existsSync(dbPath)) {
      console.error(`[state-snapshot] no db at ${dbPath}`);
      process.exit(1);
    }
    const { snapshotDb } = require('../../mcp-project-state/lib/snapshotter');
    const result = snapshotDb(dbPath, { keepN: options.keep });
    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`[state-snapshot] saved ${result.snapshot}`);
      console.log(`[state-snapshot] kept ${result.kept.length}, pruned ${result.pruned.length}`);
    }
  },
};
