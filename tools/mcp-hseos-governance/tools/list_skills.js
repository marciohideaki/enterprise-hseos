'use strict';

const { listSkills } = require('../lib/spec-reader');

module.exports = [
  {
    name: 'list_skills',
    description: 'List HSEOS skills from the registry with optional filter and tier',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Keyword to filter skill id or description' },
        tier: { type: 'integer', description: 'Tier level: 1 (quick) or 2 (full)', enum: [1, 2] },
      },
    },
    handler(_db, args) {
      return listSkills(args.filter || null, args.tier === undefined ? undefined : args.tier);
    },
  },
];
