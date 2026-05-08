'use strict';

/**
 * Hooks source — reads from the neutral .agents/hooks/registry.yaml.
 *
 * API change from monolith:
 *   old: writeHookRegistry(root, claudeHooksPath)  — read hooks.json, convert
 *   new: writeHookRegistry(root, sourcePath, _)    — read registry.yaml OR hooks.json
 *
 * When sourcePath ends with .yaml  → treat as neutral registry (preferred)
 * When sourcePath ends with .json  → read legacy hooks.json and convert (bootstrap only)
 * When sourcePath is null/absent   → write empty registry
 */

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { slug } = require('../lib/slug');

async function writeHookRegistry(root, sourcePath, _legacyFallback, agentsDirName = '.agents') {
  const outputDir = path.join(root, agentsDirName, 'hooks');
  await fs.ensureDir(outputDir);

  let hooks = [];

  if (sourcePath && (await fs.pathExists(sourcePath))) {
    if (sourcePath.endsWith('.yaml') || sourcePath.endsWith('.yml')) {
      const parsed = yaml.parse(await fs.readFile(sourcePath, 'utf8')) || {};
      hooks = parsed.hooks || [];
    } else {
      // Legacy bootstrap: convert hooks.json → neutral registry entries
      const parsed = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
      for (const [event, groups] of Object.entries(parsed.hooks || {})) {
        for (const group of groups || []) {
          for (const hook of group.hooks || []) {
            hooks.push({
              id: slug(`${event}-${group.matcher || 'all'}-${hook.description || hook.command}`),
              event,
              matcher: group.matcher || '*',
              type: hook.type || 'command',
              command: hook.command,
              timeout: hook.timeout || null,
              blocking: event === 'PreToolUse',
              status: 'active',
              description: hook.description || '',
              platform_support: ['claude-code'],
              fallback: 'Use repository scripts or quality gates when the target platform has no native hook event.',
            });
          }
        }
      }
    }
  }

  const registry = {
    version: '1.1',
    source: sourcePath ? path.relative(root, sourcePath).replaceAll(path.sep, '/') : 'none',
    hooks,
  };

  await fs.writeFile(path.join(outputDir, 'registry.yaml'), yaml.stringify(registry, { lineWidth: 0 }), 'utf8');
  return hooks;
}

module.exports = { writeHookRegistry };
