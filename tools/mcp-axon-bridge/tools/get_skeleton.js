'use strict';

const { callAxon, unavailableError } = require('../lib/axon-client');
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
      if (!bin) throw unavailableError('get_skeleton');
      return callAxon(bin, 'get_skeleton', { files: args.files });
    },
  },
];
