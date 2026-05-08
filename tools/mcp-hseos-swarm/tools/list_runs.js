'use strict';

const path = require('node:path');
const fs = require('node:fs');

// tools/ → mcp-hseos-swarm/ → tools/ → worktree root
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNS_DIR = path.join(REPO_ROOT, '.hseos', 'runs', 'dev-squad');

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
      if (!fs.existsSync(RUNS_DIR)) return { runs: [], total: 0 };
      const dirs = fs.readdirSync(RUNS_DIR).filter((d) => {
        return fs.statSync(path.join(RUNS_DIR, d)).isDirectory();
      });
      const runs = dirs.map((d) => {
        const statusPath = path.join(RUNS_DIR, d, 'STATUS.md');
        const statusText = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8') : '';
        const phaseMatch = statusText.match(/\*\*Phase[:\s]+([^\n*]+)/i);
        return {
          id: d,
          path: path.join(RUNS_DIR, d),
          status_snippet: phaseMatch ? phaseMatch[1].trim() : 'unknown',
        };
      });
      const filter = args.status;
      const filtered = filter
        ? runs.filter((r) => r.status_snippet.toLowerCase().includes(filter.toLowerCase()))
        : runs;
      return { runs: filtered, total: filtered.length };
    },
  },
];
