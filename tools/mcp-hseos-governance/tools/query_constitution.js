'use strict';

const { readConstitution } = require('../lib/spec-reader');

module.exports = [
  {
    name: 'query_constitution',
    description: 'Read Enterprise Constitution articles by name or keyword',
    inputSchema: {
      type: 'object',
      properties: {
        article: { type: 'string', description: 'Article name or keyword to match; omit for full text' },
      },
    },
    handler(_db, args) {
      return readConstitution(args.article || null);
    },
  },
];
