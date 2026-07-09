'use strict';

const path = require('node:path');
const fs = require('fs-extra');

const { writePlatformAdapters: writeClaudeCodeAdapters } = require('./claude-code');
const { writeCodexAdapter } = require('./codex');
const { writeAgentsMdAdapter } = require('./agents-md');
const { writeClaudeMdAdapter } = require('./claude-md');
const GooseAdapter = require('./goose');

// Platforms with a real emitter behind them. `agent-core compile --target`
// values outside this list are rejected by the CLI instead of silently
// producing nothing (cursor/continue/aider/cline remain ADR-0007 pending work
// and must not be advertised as emitted surfaces).
const SUPPORTED_PLATFORMS = ['claude-code', 'codex', 'goose'];

// Surfaces each platform emitter actually writes. Mirrored verbatim into the
// manifest `adapters{}` block so the instruction cascade never advertises
// paths the pipeline does not produce.
const PLATFORM_SURFACES = {
  'claude-code': {
    entrypoint: 'CLAUDE.md',
    hooks: '.claude/hooks.json',
  },
  codex: {
    entrypoint: 'AGENTS.md',
    skills: '.agents/skills',
    settings: '.codex/config.toml',
    hooks: '.codex/hseos-hooks.json',
  },
  goose: {
    config: '.goose/config.yaml',
    skills: '.goose/skills',
    agents: '.goose/agents',
    hooks_metadata: '.goose/hooks-metadata.json',
  },
};

async function writeGooseAdapter(root, hooks, platforms, sources = {}) {
  if (!platforms.includes('goose')) return;

  // Enrich compiled skill entries with their rendered content so the Goose
  // mirror carries the real skill text instead of a bare heading.
  const skills = [];
  for (const skill of sources.skills || []) {
    let content = null;
    if (skill.output) {
      const outputPath = path.join(root, skill.output);
      if (await fs.pathExists(outputPath)) {
        content = await fs.readFile(outputPath, 'utf8');
      }
    }
    skills.push(content ? { ...skill, content } : skill);
  }

  const adapter = new GooseAdapter();
  await adapter.emit(
    {
      skills,
      agents: sources.agents || [],
      hooks,
      mcpBundles: sources.mcpBundles || [],
    },
    root,
  );
}

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
  await writeGooseAdapter(root, hooks, platforms, options.sources);

  // The manifest records exactly this list: requested platforms that have a
  // real emitter.
  return platforms.filter((platform) => SUPPORTED_PLATFORMS.includes(platform));
}

module.exports = { PLATFORM_SURFACES, SUPPORTED_PLATFORMS, writePlatformAdapters };
