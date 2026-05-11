'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');

async function writeManifest(root, data, agentsDirName = '.agents') {
  const manifest = {
    version: '1.0',
    generated_by: 'hseos-agent-core-compiler',
    source_of_truth: '.agents',
    adapters: {
      codex: {
        entrypoint: 'AGENTS.md',
        skills: '.agents/skills',
        settings: '.codex/config.toml',
        hooks: '.codex/hseos-hooks.json',
      },
      claude_code: {
        entrypoint: 'CLAUDE.md',
        commands: '.claude/commands',
        hooks: '.claude/hooks.json',
      },
    },
    platforms: data.platforms,
    counts: {
      skills: data.skills.length,
      hooks: data.hooks.length,
      commands: data.commands.length,
    },
    skills: data.skills,
    hooks: data.hooks.map((hook) => ({
      id: hook.id,
      event: hook.event,
      matcher: hook.matcher,
      platform_support: hook.platform_support,
    })),
    commands: data.commands,
  };

  const manifestPath = path.join(root, agentsDirName, 'manifest.yaml');
  await fs.writeFile(manifestPath, yaml.stringify(manifest, { lineWidth: 0 }), 'utf8');
  return path.relative(root, manifestPath).replaceAll(path.sep, '/');
}

module.exports = { writeManifest };
