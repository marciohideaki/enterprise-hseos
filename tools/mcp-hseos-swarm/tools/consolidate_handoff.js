'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { resolveRunDir, assertIdentifier, readContained, writeContained, projectRoot } = require('../lib/run-scope');

const MAX_LINES = 40;

module.exports = [
  {
    name: 'consolidate_handoff',
    description: 'Read a task HANDOFF.md, trim to ≤40 lines, write to run dir, return bundle',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Run identifier' },
        source_task: { type: 'string', description: 'Source task directory name (under .worktrees/ or run dir)' },
        target_task: { type: 'string', description: 'Target task identifier for the handoff filename' },
      },
      required: ['run_id', 'source_task', 'target_task'],
    },
    handler(_db, args) {
      const runDir = resolveRunDir(args.run_id);
      assertIdentifier(args.source_task, 'source_task');
      assertIdentifier(args.target_task, 'target_task');
      const worktrees = path.join(projectRoot(), '.worktrees');
      const candidates = [
        path.join(worktrees, args.source_task, 'HANDOFF.md'),
        path.join(runDir, `HANDOFF-${args.source_task}.md`),
        path.join(runDir, args.source_task, 'HANDOFF.md'),
      ];
      const bases = [worktrees, runDir, runDir];

      let handoffText = null;
      let sourcePath = null;
      for (const [i, c] of candidates.entries()) {
        const text = readContained(bases[i], c);
        if (text !== null) {
          handoffText = text;
          sourcePath = c;
          break;
        }
      }

      if (!handoffText) {
        return { error: `HANDOFF.md not found for source_task: ${args.source_task}`, searched: candidates };
      }

      const lines = handoffText.split('\n');
      const trimmed = lines.slice(0, MAX_LINES).join('\n');
      const truncated = lines.length > MAX_LINES;

      const outName = `handoff-${args.source_task}-to-${args.target_task}.md`;
      fs.mkdirSync(runDir, { recursive: true });
      const outPath = path.join(runDir, outName);
      writeContained(runDir, outPath, trimmed);

      return {
        run_id: args.run_id,
        source_task: args.source_task,
        target_task: args.target_task,
        handoff_path: outPath,
        lines_written: Math.min(lines.length, MAX_LINES),
        truncated,
        handoff_bundle: trimmed,
        source_path: sourcePath,
      };
    },
  },
];
