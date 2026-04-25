/**
 * Pure render functions for agent-state markdown projection.
 *
 * Used by `tools/cli/commands/state-render.js` and exercised by tests.
 * Functions are deterministic given the same input — safe to snapshot.
 */

function renderPlan(run, tasks) {
  const lines = [];
  lines.push(
    `# PLAN — ${run.id}`,
    '',
    `**Workflow:** ${run.workflow_id}`,
    `**Project:** ${run.project}`,
    `**Phase:** ${run.phase}    Gate: ${run.gate_status}`,
    ''
  );
  if (run.base_branch) lines.push(`**Base branch:** ${run.base_branch}`);
  if (run.session_id) lines.push(`**Session:** ${run.session_id}`);
  lines.push('', '## Tasks', '', '| ID | Wave | Effort | Tier | Status | Goal |', '|---|---|---|---|---|---|');
  for (const t of tasks) {
    const goalEscaped = (t.goal || '').replaceAll('|', String.raw`\|`);
    lines.push(
      `| ${t.id} | ${t.wave} | ${t.effort || '-'} | ${t.model_tier || '-'} | ${t.status} | ${goalEscaped} |`
    );
  }
  return lines.join('\n') + '\n';
}

function renderStatus(run, tasks, agentRuns) {
  const lines = [];
  lines.push(
    `# STATUS — ${run.id}`,
    '',
    `**Phase:** ${run.phase}    Gate: ${run.gate_status}    Status: ${run.status}`,
    '',
    '## Tasks',
    ''
  );
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

module.exports = { renderPlan, renderStatus, renderResumePrompt };
