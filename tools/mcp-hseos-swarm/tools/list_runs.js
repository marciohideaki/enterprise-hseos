'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { runsDir, readContained, readdirContained } = require('../lib/run-scope');

module.exports = [
  {
    name: 'list_runs',
    description: 'List dev-squad runs with optional status filter',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status string found in STATUS.md' },
      },
    },
    handler(_db, args) {
      const RUNS_DIR = runsDir();
      if (!fs.existsSync(RUNS_DIR)) return { runs: [], total: 0 };
      const dirs = readdirContained(RUNS_DIR, RUNS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const runs = dirs.map((d) => {
        const statusPath = path.join(RUNS_DIR, d, 'STATUS.md');
        let statusText = '';
        try {
          statusText = readContained(path.join(RUNS_DIR, d), statusPath) ?? '';
        } catch {
          statusText = '';
        }
        const phaseMatch = statusText.match(/\*\*Phase[:\s]+([^\n*]+)/i);
        return {
          id: d,
          path: path.join(RUNS_DIR, d),
          status_snippet: phaseMatch ? phaseMatch[1].trim() : 'unknown',
        };
      });
      const filter = args.status;
      const filtered = filter ? runs.filter((r) => r.status_snippet.toLowerCase().includes(filter.toLowerCase())) : runs;
      return { runs: filtered, total: filtered.length };
    },
  },
];
