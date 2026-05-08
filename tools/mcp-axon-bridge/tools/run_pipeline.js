'use strict';

const { callAxon } = require('../lib/axon-client');
const { noOpResponse } = require('../lib/no-op-fallback');
const { resolve } = require('../lib/binary-resolver');

module.exports = [
  {
    name: 'run_pipeline',
    description: 'Refresh the Axon code index',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Project root path; defaults to cwd' },
      },
    },
    async handler(_db, args) {
      const bin = resolve();
      if (!bin) return noOpResponse('run_pipeline');
      return callAxon(bin, 'mcp__axon__run_pipeline', { project_path: args.project_path || process.cwd() });
    },
  },
];
