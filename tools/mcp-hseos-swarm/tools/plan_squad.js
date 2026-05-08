'use strict';

const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNS_DIR = path.join(REPO_ROOT, '.hseos', 'runs', 'dev-squad');

function generateRunId() {
  const now = new Date();
  const ts = now.toISOString().replaceAll(/[-:T]/g, '').slice(0, 12);
  return `${ts}-squad`;
}

function buildPlanMd(batchDescription, tierHints, runId) {
  const lines = [
    `# SWARM Squad Plan — ${runId}`,
    '',
    `**Description:** ${batchDescription}`,
    `**Created:** ${new Date().toISOString()}`,
    '',
    '## Tier Hints',
    '',
    tierHints ? JSON.stringify(tierHints, null, 2) : '_none provided_',
    '',
    '## Waves',
    '',
    '<!-- Populate waves after task decomposition -->',
    '- [ ] Wave 1: (tasks TBD)',
    '',
    '## Status',
    '',
    '**Phase:** INTAKE',
  ];
  return lines.join('\n');
}

module.exports = [
  {
    name: 'plan_squad',
    description: 'Create a new dev-squad run plan and directory scaffold',
    inputSchema: {
      type: 'object',
      properties: {
        batch_description: { type: 'string', description: 'Description of the batch to execute' },
        tier_hints: { type: 'object', description: 'Optional model tier hints per task' },
        run_id: { type: 'string', description: 'Optional run ID override; auto-generated if omitted' },
      },
      required: ['batch_description'],
    },
    handler(_db, args) {
      const runId = args.run_id || generateRunId();
      const runDir = path.join(RUNS_DIR, runId);
      fs.mkdirSync(runDir, { recursive: true });

      const planMd = buildPlanMd(args.batch_description, args.tier_hints || null, runId);
      const planPath = path.join(runDir, 'PLAN.md');
      const statusPath = path.join(runDir, 'STATUS.md');

      fs.writeFileSync(planPath, planMd, 'utf8');
      fs.writeFileSync(statusPath, `# STATUS — ${runId}\n\n**Phase:** INTAKE\n**Created:** ${new Date().toISOString()}\n`, 'utf8');

      return { run_id: runId, run_dir: runDir, plan_md: planMd };
    },
  },
];
