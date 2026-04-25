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

function openState(directory) {
  if (!Database) return null;
  const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true });
}

function renderPlan(run, tasks) {
  const lines = [];
  lines.push(`# PLAN — ${run.id}`, '', `**Workflow:** ${run.workflow_id}`, `**Project:** ${run.project}`, `**Phase:** ${run.phase}    Gate: ${run.gate_status}`, '');
  if (run.base_branch) lines.push(`**Base branch:** ${run.base_branch}`);
  if (run.session_id) lines.push(`**Session:** ${run.session_id}`);
  lines.push('', '## Tasks', '', '| ID | Wave | Effort | Tier | Status | Goal |', '|---|---|---|---|---|---|');
  for (const t of tasks) {
    lines.push(`| ${t.id} | ${t.wave} | ${t.effort || '-'} | ${t.model_tier || '-'} | ${t.status} | ${(t.goal || '').replace(/\|/g, '\\|')} |`);
  }
  return lines.join('\n') + '\n';
}

function renderStatus(run, tasks, agentRuns) {
  const lines = [];
  lines.push(`# STATUS — ${run.id}`, '', `**Phase:** ${run.phase}    Gate: ${run.gate_status}    Status: ${run.status}`, '', '## Tasks', '');
  for (const t of tasks) {
    const last = t.last_heartbeat_at ? `  (heartbeat: ${t.last_heartbeat_at})` : '';
    lines.push(`- ${t.id}: ${t.status}${last}`);
  }
  lines.push('', '## Agent runs', '');
  for (const a of agentRuns) {
    lines.push(`- #${a.id} agent=${a.agent_name} task=${a.task_id || '-'} status=${a.status}`);
  }
  return lines.join('\n') + '\n';
}

function renderResumePrompt(run) {
  return [
    `# RESUME-PROMPT — ${run.id}`,
    '',
    'Resuming after `/clear` or session kill: read PLAN.md + STATUS.md + handoffs/*.md only.',
    '',
    `Run id: ${run.id}`,
    `Workflow: ${run.workflow_id}`,
    `Project: ${run.project}`,
    run.session_id ? `Session: ${run.session_id}` : '',
    '',
    'Source of truth: SQLite via `hseos state-describe ' + run.id + '`.',
    '',
  ]
    .filter(Boolean)
    .join('\n');
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
