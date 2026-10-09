'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { resolveRunDir, writeContained } = require('../lib/run-scope');

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
      const runId = args.run_id === undefined || args.run_id === null || args.run_id === '' ? generateRunId() : args.run_id;
      const runDir = resolveRunDir(runId);
      fs.mkdirSync(runDir, { recursive: true });

      const planMd = buildPlanMd(args.batch_description, args.tier_hints || null, runId);
      const planPath = path.join(runDir, 'PLAN.md');
      const statusPath = path.join(runDir, 'STATUS.md');

      writeContained(runDir, planPath, planMd);
      writeContained(runDir, statusPath, `# STATUS — ${runId}\n\n**Phase:** INTAKE\n**Created:** ${new Date().toISOString()}\n`);

      return { run_id: runId, run_dir: runDir, plan_md: planMd };
    },
  },
];
