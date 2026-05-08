'use strict';

const { callAxon } = require('../lib/axon-client');
const { noOpResponse } = require('../lib/no-op-fallback');
const { resolve } = require('../lib/binary-resolver');

module.exports = [
  {
    name: 'dep_graph',
    description: 'Cross-file dependency analysis for a given file or symbol via Axon',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'File paths to analyse' },
      },
      required: ['files'],
    },
    async handler(_db, args) {
      const bin = resolve();
      if (!bin) return noOpResponse('dep_graph');
      return callAxon(bin, 'mcp__axon__get_impact_graph', { files: args.files });
    },
  },
];
