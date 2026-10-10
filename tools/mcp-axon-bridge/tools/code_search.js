'use strict';

const { callAxon, unavailableError } = require('../lib/axon-client');
const { resolve } = require('../lib/binary-resolver');

module.exports = [
  {
    name: 'code_search',
    description: 'Semantic + keyword search across the indexed codebase via Axon',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    async handler(_db, args) {
      const bin = resolve();
      if (!bin) throw unavailableError('code_search');
      return callAxon(bin, 'get_context_capsule', { query: args.query });
    },
  },
];
