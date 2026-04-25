/**
 * `hseos state-purge` — archive (optional) then delete an entire run from the
 * agent-state store.
 *
 * Default is `--dry-run` printing counts. Pass `--force` to actually delete.
 * Pass `--archive` to write a markdown archive to second-brain vault before purge.
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

function countRows(db, run_id) {
  const taskIds = db.prepare('SELECT id FROM as_tasks WHERE run_id = ?').all(run_id).map((t) => t.id);
  const arIds = db.prepare('SELECT id FROM as_agent_runs WHERE run_id = ?').all(run_id).map((a) => a.id);
  return {
    runs: db.prepare('SELECT COUNT(*) AS n FROM as_runs WHERE id = ?').get(run_id).n,
    tasks: taskIds.length,
    agent_runs: arIds.length,
    events:
      arIds.length > 0
        ? db
            .prepare(
              `SELECT COUNT(*) AS n FROM as_events WHERE agent_run_id IN (${arIds.map(() => '?').join(',')})`
            )
            .get(...arIds).n
        : 0,
    handoffs:
      taskIds.length > 0
        ? db
            .prepare(
              `SELECT COUNT(*) AS n FROM as_handoffs WHERE src_task IN (${taskIds.map(() => '?').join(',')})
                  OR dst_task IN (${taskIds.map(() => '?').join(',')})`
            )
            .get(...taskIds, ...taskIds).n
        : 0,
    wave_executions:
      taskIds.length > 0
        ? db
            .prepare(
              `SELECT COUNT(*) AS n FROM as_wave_executions WHERE task_id IN (${taskIds.map(() => '?').join(',')})`
            )
            .get(...taskIds).n
        : 0,
    worktree_state:
      taskIds.length > 0
        ? db
            .prepare(
              `SELECT COUNT(*) AS n FROM as_worktree_state WHERE task_id IN (${taskIds.map(() => '?').join(',')})`
            )
            .get(...taskIds).n
        : 0,
  };
}

function purgeRun(db, run_id) {
  const taskIds = db.prepare('SELECT id FROM as_tasks WHERE run_id = ?').all(run_id).map((t) => t.id);
  const arIds = db.prepare('SELECT id FROM as_agent_runs WHERE run_id = ?').all(run_id).map((a) => a.id);

  const tx = db.transaction(() => {
    if (arIds.length > 0) {
      db.prepare(`DELETE FROM as_events WHERE agent_run_id IN (${arIds.map(() => '?').join(',')})`).run(...arIds);
    }
    if (taskIds.length > 0) {
      db.prepare(
        `DELETE FROM as_handoffs WHERE src_task IN (${taskIds.map(() => '?').join(',')})
            OR dst_task IN (${taskIds.map(() => '?').join(',')})`
      ).run(...taskIds, ...taskIds);
      db.prepare(
        `DELETE FROM as_wave_executions WHERE task_id IN (${taskIds.map(() => '?').join(',')})`
      ).run(...taskIds);
      db.prepare(
        `DELETE FROM as_worktree_state WHERE task_id IN (${taskIds.map(() => '?').join(',')})`
      ).run(...taskIds);
    }
    db.prepare('DELETE FROM as_agent_runs WHERE run_id = ?').run(run_id);
    db.prepare('DELETE FROM as_tasks WHERE run_id = ?').run(run_id);
    db.prepare('DELETE FROM as_runs WHERE id = ?').run(run_id);
  });
  tx();
}

module.exports = {
  command: 'state-purge <run-id>',
  description:
    'Archive (optional) and delete a run from the agent-state store. Default is --dry-run.',
  options: [
    ['--directory <path>', 'Project directory (default: current)'],
    ['--archive', 'Archive run to second-brain vault before purging'],
    ['--archive-path <path>', 'Override archive output path'],
    ['--second-brain-path <path>', 'Second-brain vault root (default: $SECOND_BRAIN_PATH or skipped)'],
    ['--force', 'Actually delete (default is dry-run)'],
    ['--json', 'Print result as JSON'],
  ],
  action: (run_id, options) => {
    if (!Database) {
      console.error('[state-purge] better-sqlite3 not installed');
      process.exit(1);
    }
    const directory = path.resolve(options.directory || process.cwd());
    const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
    if (!fs.existsSync(dbPath)) {
      console.error(`[state-purge] no db at ${dbPath}`);
      process.exit(1);
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    try {
      const counts = countRows(db, run_id);
      if (counts.runs === 0) {
        console.error(`[state-purge] run not found: ${run_id}`);
        process.exit(1);
      }

      let archive_path = null;
      if (options.archive) {
        const { archiveRun } = require('../../mcp-project-state/lib/archiver');
        const sbPath = options.secondBrainPath || process.env.SECOND_BRAIN_PATH;
        const result = archiveRun(db, run_id, {
          outputPath: options.archivePath,
          secondBrainPath: sbPath,
        });
        archive_path = result.archive_path;
        if (!archive_path) {
          console.error('[state-purge] --archive specified but no output path resolvable (need --archive-path or --second-brain-path or SECOND_BRAIN_PATH env)');
          process.exit(1);
        }
        if (!fs.existsSync(archive_path)) {
          console.error(`[state-purge] archive verify failed: ${archive_path}`);
          process.exit(1);
        }
      }

      const result = { run_id, counts, archive_path, force: !!options.force };

      if (!options.force) {
        result.dry_run = true;
        if (options.json) console.log(JSON.stringify(result));
        else {
          console.log(`[state-purge] DRY RUN — would delete:`);
          for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
          if (archive_path) console.log(`[state-purge] archive: ${archive_path}`);
          console.log('[state-purge] re-run with --force to actually delete');
        }
        return;
      }

      purgeRun(db, run_id);
      result.purged = true;
      if (options.json) console.log(JSON.stringify(result));
      else {
        console.log(`[state-purge] purged ${run_id}: ${JSON.stringify(counts)}`);
        if (archive_path) console.log(`[state-purge] archive preserved: ${archive_path}`);
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
