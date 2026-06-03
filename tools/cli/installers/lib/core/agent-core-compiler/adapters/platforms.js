'use strict';

const { writePlatformAdapters: writeClaudeCodeAdapters } = require('./claude-code');
const { writeCodexAdapter } = require('./codex');
const { writeAgentsMdAdapter } = require('./agents-md');
const { writeClaudeMdAdapter } = require('./claude-md');

async function writePlatformAdapters(root, hooks, platforms, options = {}) {
  await writeClaudeCodeAdapters(root, hooks, platforms);
  await writeCodexAdapter(root, hooks, platforms);
  // AGENTS.md is platform-neutral: any adapter that reads it (Codex today,
  // LF AAIF tomorrow) benefits, so emit unconditionally. The emitter is
  // idempotent and preserves any pre-existing file.
  await writeAgentsMdAdapter(root, { agentsDirName: options.agentsDirName });
  // CLAUDE.md is the Claude Code entrypoint declared in the manifest. Emit a
  // thin pointer to AGENTS.md when claude-code is active; idempotent and
  // preserves any pre-existing file.
  await writeClaudeMdAdapter(root, platforms);
}

module.exports = { writePlatformAdapters };
