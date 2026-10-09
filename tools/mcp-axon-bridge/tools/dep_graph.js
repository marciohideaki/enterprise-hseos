'use strict';

const { callAxon, unavailableError } = require('../lib/axon-client');
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
      if (!bin) throw unavailableError('dep_graph');
      return callAxon(bin, 'get_impact_graph', { files: args.files });
    },
  },
];
