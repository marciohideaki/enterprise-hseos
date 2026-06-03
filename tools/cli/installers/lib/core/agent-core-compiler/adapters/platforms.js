'use strict';

const { writePlatformAdapters: writeClaudeCodeAdapters } = require('./claude-code');
const { writeCodexAdapter } = require('./codex');
const { writeAgentsMdAdapter } = require('./agents-md');

async function writePlatformAdapters(root, hooks, platforms, options = {}) {
  await writeClaudeCodeAdapters(root, hooks, platforms);
  await writeCodexAdapter(root, hooks, platforms);
  // AGENTS.md is platform-neutral: any adapter that reads it (Codex today,
  // LF AAIF tomorrow) benefits, so emit unconditionally. The emitter is
  // idempotent and preserves any pre-existing file.
  await writeAgentsMdAdapter(root, { agentsDirName: options.agentsDirName });
}

module.exports = { writePlatformAdapters };
