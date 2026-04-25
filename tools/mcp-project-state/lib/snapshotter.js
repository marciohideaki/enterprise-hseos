/**
 * SQLite snapshot library — copies the canonical .db file into
 * `.hseos/state/snapshots/project-{ISO}.db`, with retention pruning.
 *
 * Use cases:
 *   - Pre-purge backup
 *   - Pre-schema-migration safety net
 *   - Daily cron snapshot
 *
 * Idempotent in the sense that each call creates a unique timestamped snapshot
 * (collisions only on sub-second clocks; ts has seconds precision).
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_KEEP = 7;

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').slice(0, 19);
}

/**
 * Create a snapshot of `dbPath` and prune older snapshots beyond `keepN`.
 *
 * @param {string} dbPath Absolute path to the source `.db`.
 * @param {{ keepN?: number, snapshotsDir?: string }} [options]
 * @returns {{ snapshot: string, kept: string[], pruned: string[] }}
 */
function snapshotDb(dbPath, options = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`db not found: ${dbPath}`);
  }
  const keepN = Number.parseInt(options.keepN ?? DEFAULT_KEEP, 10) || DEFAULT_KEEP;
  const dir = options.snapshotsDir || path.join(path.dirname(dbPath), 'snapshots');
  fs.mkdirSync(dir, { recursive: true });

  const target = path.join(dir, `project-${timestamp()}.db`);
  fs.copyFileSync(dbPath, target);

  const all = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('project-') && f.endsWith('.db'))
    .sort();
  const pruned = [];
  while (all.length > keepN) {
    const old = all.shift();
    const fullPath = path.join(dir, old);
    try {
      fs.rmSync(fullPath);
      pruned.push(fullPath);
    } catch {
      /* ignore */
    }
  }
  return { snapshot: target, kept: all.map((f) => path.join(dir, f)), pruned };
}

module.exports = { snapshotDb, DEFAULT_KEEP };
