'use strict';

const LEGACY_TOOLS = Object.freeze([
  { name: 'state_read', description: 'Get current project state', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'state_write',
    description: 'Update state fields atomically',
    inputSchema: {
      type: 'object',
      properties: {
        fields: { type: 'object', description: 'Key-value pairs to write' },
        agent: { type: 'string', description: 'Agent code writing the state' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'tasks_list',
    description: 'List tasks with optional status filter',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['pending', 'done', 'blocked'] } },
    },
  },
  {
    name: 'tasks_add',
    description: 'Add a new task to the backlog',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        owner: { type: 'string' },
        description: { type: 'string' },
        depends: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'owner', 'description'],
    },
  },
  {
    name: 'tasks_update',
    description: 'Update task status',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'done', 'blocked'] },
        note: { type: 'string' },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'state_history',
    description: 'Get recent state change history',
    inputSchema: {
      type: 'object',
      properties: { n: { type: 'integer', description: 'Number of records (default 20)' } },
    },
  },
]);

module.exports = { LEGACY_TOOLS };
