'use strict';

const { callAxon } = require('../lib/axon-client');
const { noOpResponse } = require('../lib/no-op-fallback');
const { resolve } = require('../lib/binary-resolver');

module.exports = [
  {
    name: 'get_skeleton',
    description: 'Extract signatures and structure of a file via Axon',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'File paths to skeleton' },
      },
      required: ['files'],
    },
    async handler(_db, args) {
      const bin = resolve();
      if (!bin) return noOpResponse('get_skeleton');
      return callAxon(bin, 'mcp__axon__get_skeleton', { files: args.files });
    },
  },
];
