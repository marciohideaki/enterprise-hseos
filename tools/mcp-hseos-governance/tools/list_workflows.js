'use strict';

const { listWorkflows } = require('../lib/spec-reader');

module.exports = [
  {
    name: 'list_workflows',
    description: 'List HSEOS engineering workflows with optional profile filter',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: 'Filter by owner/profile keyword' },
      },
    },
    handler(_db, args) {
      return listWorkflows(args.profile || null);
    },
  },
];
