'use strict';

const { callAxon, unavailableError } = require('../lib/axon-client');
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
      if (!bin) throw unavailableError('run_pipeline');
      return callAxon(bin, 'run_pipeline', { root: args.project_path || process.cwd() }, { timeoutMs: 300_000 });
    },
  },
];
