'use strict';

const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNS_DIR = path.join(REPO_ROOT, '.hseos', 'runs', 'dev-squad');
const WORKTREES = path.join(REPO_ROOT, '.worktrees');

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
      const candidates = [
        path.join(WORKTREES, args.source_task, 'HANDOFF.md'),
        path.join(RUNS_DIR, args.run_id, `HANDOFF-${args.source_task}.md`),
        path.join(RUNS_DIR, args.run_id, args.source_task, 'HANDOFF.md'),
      ];

      let handoffText = null;
      let sourcePath = null;
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          handoffText = fs.readFileSync(c, 'utf8');
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
      const runDir = path.join(RUNS_DIR, args.run_id);
      fs.mkdirSync(runDir, { recursive: true });
      const outPath = path.join(runDir, outName);
      fs.writeFileSync(outPath, trimmed, 'utf8');

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
