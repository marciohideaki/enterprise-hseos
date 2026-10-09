'use strict';

const path = require('node:path');

const { resolveRunDir, projectRoot, readContained } = require('../lib/run-scope');

module.exports = [
  {
    name: 'dispatch_wave',
    description: 'Read wave tasks from a run PLAN.md and return worktree paths + subagent prompts',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Run identifier' },
        wave_index: { type: 'integer', description: 'Zero-based wave index', default: 0 },
      },
      required: ['run_id'],
    },
    handler(_db, args) {
      const runDir = resolveRunDir(args.run_id);
      const planPath = path.join(runDir, 'PLAN.md');
      const planText = readContained(runDir, planPath);
      if (planText === null) {
        return { error: `PLAN.md not found for run: ${args.run_id}`, run_dir: runDir };
      }

      const waveIndex = args.wave_index ?? 0;

      // Extract wave sections (## Wave N: ...)
      const waveSections = [...planText.matchAll(/^## Wave \d+:(.+)$/gm)];
      if (waveSections.length === 0) {
        return { wave_index: waveIndex, worktree_paths: [], subagent_prompts: [], note: 'no waves defined in PLAN.md' };
      }

      const waveHeader = waveSections[waveIndex];
      if (!waveHeader) {
        return { error: `Wave index ${waveIndex} not found; plan has ${waveSections.length} wave(s)` };
      }

      // Extract task items from the wave section
      const waveStart = waveHeader.index + waveHeader[0].length;
      const nextWave = waveSections[waveIndex + 1];
      const waveEnd = nextWave ? nextWave.index : planText.length;
      const waveBody = planText.slice(waveStart, waveEnd);
      const tasks = [...waveBody.matchAll(/^-\s+\[[ x]\]\s+(.+)$/gm)].map((m) => m[1].trim());

      const worktreePaths = tasks.map((t, i) => path.join(projectRoot(), '.worktrees', `T${waveIndex + 1}-${i + 1}`));
      const subagentPrompts = tasks.map((t, i) => `Task T${waveIndex + 1}-${i + 1}: ${t}`);

      return { run_id: args.run_id, wave_index: waveIndex, tasks, worktree_paths: worktreePaths, subagent_prompts: subagentPrompts };
    },
  },
];
