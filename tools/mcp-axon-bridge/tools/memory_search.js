'use strict';

const { callAxon } = require('../lib/axon-client');
const { noOpResponse } = require('../lib/no-op-fallback');
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
      if (!bin) return noOpResponse('memory_search');
      return callAxon(bin, 'mcp__axon__search_memory', { query: args.query });
    },
  },
];
