'use strict';

const { writePlatformAdapters: writeClaudeCodeAdapters } = require('./claude-code');
const { writeCodexAdapter } = require('./codex');

async function writePlatformAdapters(root, hooks, platforms) {
  await writeClaudeCodeAdapters(root, hooks, platforms);
  await writeCodexAdapter(root, hooks, platforms);
}

module.exports = { writePlatformAdapters };
