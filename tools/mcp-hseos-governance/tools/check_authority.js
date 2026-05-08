'use strict';

const { readAuthority } = require('../lib/spec-reader');

module.exports = [
  {
    name: 'check_authority',
    description: 'Read authority and constraints for an HSEOS agent by code',
    inputSchema: {
      type: 'object',
      properties: {
        agent_code: {
          type: 'string',
          description: 'Agent code (e.g. GHOST, CIPHER, SWARM, BLITZ)',
        },
      },
      required: ['agent_code'],
    },
    handler(_db, args) {
      return readAuthority(args.agent_code);
    },
  },
];
