/**
 * Run archiver — exports a complete run (runs+tasks+agentRuns+events+handoffs)
 * to a JSON-fronted markdown file in the second-brain vault before purge.
 *
 * Used by `hseos state-purge --archive` to preserve history before deletion.
 */

const fs = require('node:fs');
const path = require('node:path');

function snapshotRun(db, run_id) {
  const run = db.prepare('SELECT * FROM as_runs WHERE id = ?').get(run_id);
  if (!run) throw new Error(`Run not found: ${run_id}`);
  const tasks = db.prepare('SELECT * FROM as_tasks WHERE run_id = ? ORDER BY wave, id').all(run_id);
  const agentRuns = db
    .prepare('SELECT * FROM as_agent_runs WHERE run_id = ? ORDER BY started_at')
    .all(run_id);
  const arIds = agentRuns.map((a) => a.id);
  const events =
    arIds.length > 0
      ? db
          .prepare(
            `SELECT * FROM as_events WHERE agent_run_id IN (${arIds.map(() => '?').join(',')}) ORDER BY ts`
          )
          .all(...arIds)
      : [];
  const taskIds = tasks.map((t) => t.id);
  const handoffs =
    taskIds.length > 0
      ? db
          .prepare(
            `SELECT * FROM as_handoffs WHERE src_task IN (${taskIds.map(() => '?').join(',')})
                OR dst_task IN (${taskIds.map(() => '?').join(',')})`
          )
          .all(...taskIds, ...taskIds)
      : [];
  const waveExecs = db
    .prepare(`SELECT * FROM as_wave_executions WHERE task_id IN (${taskIds.map(() => '?').join(',') || "''"})`)
    .all(...taskIds);
  return { run, tasks, agentRuns, events, handoffs, waveExecutions: waveExecs };
}

function renderArchiveMd(archive) {
  const { run, tasks, agentRuns, events, handoffs } = archive;
  const lines = [
    `# Archive — ${run.id}`,
    '',
    `**Workflow:** ${run.workflow_id} · **Project:** ${run.project}`,
    `**Started:** ${run.started_at} · **Ended:** ${run.ended_at || '(open)'} · **Status:** ${run.status}`,
    `**Phase:** ${run.phase} · **Gate:** ${run.gate_status}`,
    '',
    '## Tasks',
    '',
    '| ID | Wave | Effort | Tier | Status | Goal |',
    '|---|---|---|---|---|---|',
    ...tasks.map(
      (t) =>
        `| ${t.id} | ${t.wave} | ${t.effort || '-'} | ${t.model_tier || '-'} | ${t.status} | ${(t.goal || '').replaceAll('|', String.raw`\|`)} |`
    ),
    '',
    '## Agent Runs',
    '',
    '| ID | Agent | Task | Status | Started | Ended | Tokens In/Out | Cost USD |',
    '|---|---|---|---|---|---|---|---|',
    ...agentRuns.map(
      (a) =>
        `| ${a.id} | ${a.agent_name} | ${a.task_id || '-'} | ${a.status} | ${a.started_at} | ${a.ended_at || '-'} | ${a.tokens_in || '-'}/${a.tokens_out || '-'} | ${a.cost_usd || '-'} |`
    ),
    '',
    '## Events Timeline',
    '',
    ...events.map((e) => `- \`${e.ts}\` **${e.kind}** (agent_run=${e.agent_run_id}) ${e.payload_json || ''}`),
    '',
    '## Handoffs',
    '',
    ...handoffs.map((h) => `### ${h.src_task} → ${h.dst_task} (v${h.version})\n\n${h.content}\n`),
    '',
    '---',
    `_Archived ${new Date().toISOString()} by hseos state-purge --archive._`,
  ];
  return lines.join('\n') + '\n';
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} run_id
 * @param {{ secondBrainPath?: string, outputPath?: string }} [options]
 * @returns {{ archive: object, archive_path: string|null }}
 */
function archiveRun(db, run_id, options = {}) {
  const archive = snapshotRun(db, run_id);
  let archive_path = null;
  if (options.outputPath || options.secondBrainPath) {
    const target =
      options.outputPath ||
      path.join(options.secondBrainPath, '_sessions', 'runs', `${run_id}.md`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderArchiveMd(archive), 'utf8');
    archive_path = target;
  }
  return { archive, archive_path };
}

module.exports = { archiveRun, snapshotRun, renderArchiveMd };
