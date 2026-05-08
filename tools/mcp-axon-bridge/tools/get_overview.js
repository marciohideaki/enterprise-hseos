'use strict';

const { callAxon } = require('../lib/axon-client');
const { noOpResponse } = require('../lib/no-op-fallback');
const { resolve } = require('../lib/binary-resolver');

module.exports = [
  {
    name: 'get_overview',
    description: 'Project-wide overview via Axon',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async handler(_db, _args) {
      const bin = resolve();
      if (!bin) return noOpResponse('get_overview');
      return callAxon(bin, 'mcp__axon__get_overview', {});
    },
  },
];
