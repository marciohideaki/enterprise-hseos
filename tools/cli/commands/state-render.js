/**
 * `hseos state-render` — regenerate PLAN.md / STATUS.md / RESUME-PROMPT.md from SQLite for a run.
 *
 * Read-only on SQLite. Output mirrors the artifact format used by the dev-squad skill.
 * In Sprint 1 (current) markdown is canonical and SQLite is projection — render is best-effort
 * preview. In Sprint 2 Wave 5 (inversion), this becomes the authoritative render path.
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

const { renderPlan, renderStatus, renderResumePrompt } = require('../lib/state-render-lib');

function openState(directory) {
  if (!Database) return null;
  const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true });
}

module.exports = {
  command: 'state-render <run-id>',
  description: 'Render PLAN/STATUS/RESUME-PROMPT markdown from SQLite for a run (read-only).',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--output <dir>', 'Output directory (default: stdout, prints PLAN only)'],
  ],
  action: (runId, options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const db = openState(directory);
    if (!db) {
      console.error('[state-render] no state db at', directory);
      process.exit(1);
    }
    const run = db.prepare(`SELECT * FROM as_runs WHERE id = ?`).get(runId);
    if (!run) {
      console.error(`[state-render] run not found: ${runId}`);
      process.exit(1);
    }
    const tasks = db.prepare(`SELECT * FROM as_tasks WHERE run_id = ? ORDER BY wave, id`).all(runId);
    const agentRuns = db.prepare(`SELECT * FROM as_agent_runs WHERE run_id = ? ORDER BY started_at`).all(runId);

    const plan = renderPlan(run, tasks);
    const status = renderStatus(run, tasks, agentRuns);
    const resume = renderResumePrompt(run);

    if (options.output) {
      const outDir = path.resolve(options.output);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'PLAN.md'), plan);
      fs.writeFileSync(path.join(outDir, 'STATUS.md'), status);
      fs.writeFileSync(path.join(outDir, 'RESUME-PROMPT.md'), resume);
      console.log(`[state-render] wrote PLAN.md, STATUS.md, RESUME-PROMPT.md to ${outDir}`);
    } else {
      process.stdout.write(plan);
    }
  },
};
