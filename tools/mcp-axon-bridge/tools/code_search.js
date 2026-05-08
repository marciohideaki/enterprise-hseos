'use strict';

const { callAxon } = require('../lib/axon-client');
const { noOpResponse } = require('../lib/no-op-fallback');
const { resolve } = require('../lib/binary-resolver');

module.exports = [
  {
    name: 'code_search',
    description: 'Semantic + keyword search across the indexed codebase via Axon',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'integer', description: 'Max results', default: 10 },
      },
      required: ['query'],
    },
    async handler(_db, args) {
      const bin = resolve();
      if (!bin) return noOpResponse('code_search');
      return callAxon(bin, 'mcp__axon__search', { query: args.query, limit: args.limit || 10 });
    },
  },
];
