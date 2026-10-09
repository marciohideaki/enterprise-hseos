'use strict';

const { callAxon, unavailableError } = require('../lib/axon-client');
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
      if (!bin) throw unavailableError('get_overview');
      return callAxon(bin, 'get_overview', {});
    },
  },
];
