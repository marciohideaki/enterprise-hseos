'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { resolveRunDir, readContained } = require('../lib/run-scope');

module.exports = [
  {
    name: 'get_run_state',
    description: 'Read STATUS.md and wave reports for a dev-squad run',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Run identifier' },
      },
      required: ['run_id'],
    },
    handler(_db, args) {
      const runDir = resolveRunDir(args.run_id);
      if (!fs.existsSync(runDir)) {
        return { error: `Run not found: ${args.run_id}`, run_dir: runDir };
      }
      const statusPath = path.join(runDir, 'STATUS.md');
      const statusText = readContained(runDir, statusPath);

      const files = fs.readdirSync(runDir);
      const reports = files
        .filter((f) => f.startsWith('WAVE-') || f.startsWith('wave-'))
        .map((f) => ({ file: f, text: readContained(runDir, path.join(runDir, f)) }));

      return {
        run_id: args.run_id,
        run_dir: runDir,
        status: statusText,
        wave_reports: reports,
      };
    },
  },
];
