'use strict';

/**
 * Claude Code platform adapter.
 *
 * API: writePlatformAdapters(root, hooks, platforms)
 *   hooks     — array of hook objects from writeHookRegistry (may include pending)
 *   platforms — string[] of active platform targets
 *
 * Emits .claude/hooks.json with only status=active hooks grouped by event/matcher.
 */

const path = require('node:path');
const fs = require('fs-extra');

function buildClaudeHooksJson(hooks) {
  const activeHooks = hooks.filter((h) => !h.status || h.status === 'active');
  const grouped = {};

  for (const hook of activeHooks) {
    const { event, matcher = '*', type = 'command', command, timeout } = hook;
    if (!event || !command) continue;

    if (!grouped[event]) grouped[event] = [];

    let group = grouped[event].find((g) => g.matcher === matcher);
    if (!group) {
      group = { matcher, hooks: [] };
      grouped[event].push(group);
    }

    const entry = { type, command };
    if (timeout) entry.timeout = timeout;
    if (hook.description) entry.description = hook.description;
    group.hooks.push(entry);
  }

  return { hooks: grouped };
}

async function writePlatformAdapters(root, hooks, platforms) {
  if (!platforms.includes('claude-code')) return;

  const claudeHooksJson = buildClaudeHooksJson(hooks);
  const targetHooksPath = path.join(root, '.claude', 'hooks.json');
  await fs.ensureDir(path.dirname(targetHooksPath));
  await fs.writeFile(targetHooksPath, JSON.stringify(claudeHooksJson, null, 2), 'utf8');
}

module.exports = { writePlatformAdapters, buildClaudeHooksJson };
