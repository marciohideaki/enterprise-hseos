'use strict';

const { callAxon, unavailableError } = require('../lib/axon-client');
const { resolve } = require('../lib/binary-resolver');

module.exports = [
  {
    name: 'memory_search',
    description: 'Cross-session memory query via Axon',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Memory search query' },
      },
      required: ['query'],
    },
    async handler(_db, args) {
      const bin = resolve();
      if (!bin) throw unavailableError('memory_search');
      return callAxon(bin, 'search_memory', { query: args.query });
    },
  },
];
