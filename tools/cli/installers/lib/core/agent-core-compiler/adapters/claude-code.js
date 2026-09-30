'use strict';

/**
 * Claude Code platform adapter.
 *
 * API: writePlatformAdapters(root, hooks, platforms, sources)
 *   hooks     — array of hook objects from writeHookRegistry (may include pending)
 *   platforms — string[] of active platform targets
 *   sources   — { skills, agents } compiled by the agent-core pipeline
 *
 * Emits, per `.agents/adapters/claude-code.yaml`:
 *   - .claude/hooks.json      active hooks grouped by event/matcher
 *   - .claude/skills/<n>/SKILL.md   the `skills_link` surface
 *   - .claude/agents/<n>.md         the `subagents` surface
 *
 * Why the skill and subagent surfaces exist here: Claude Code discovers skills
 * under `.claude/skills/` and subagents under `.claude/agents/`. The compiler
 * writes the vendor-neutral copies to `.agents/`, which Claude Code does not
 * read. Before this emitter the adapter manifest declared both surfaces and the
 * pipeline produced neither, so every governed skill — `hseos-goal-loop`
 * included — was installed to disk and invocable by nothing. The Goose adapter
 * already mirrored both surfaces; this brings Claude Code to parity.
 *
 * Surfaces NOT emitted here, and why: `.claude/rules/` and `.claude/workflows/`
 * are declared in the binding but have no source in this pipeline — there is no
 * rules-source or workflows-source to compile from. Emitting empty directories
 * would advertise a surface with no content, which `PLATFORM_SURFACES` exists to
 * prevent. `.claude/settings.json` and `.mcp.json` remain open.
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

function portableName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

/**
 * Mirror compiled skills into `.claude/skills/<name>/SKILL.md`.
 *
 * The directory is compiler-owned and reconciled on every compile: a narrower
 * capability profile must not leave a previously emitted skill behind, or the
 * agent keeps invoking a procedure the profile no longer grants.
 */
async function writeClaudeSkills(root, skills) {
  const outputDir = path.join(root, '.claude', 'skills');
  await fs.remove(outputDir);
  if (!skills || skills.length === 0) return [];
  await fs.ensureDir(outputDir);

  const emitted = [];
  const seen = new Set();
  for (const skill of skills) {
    const name = portableName(skill.id || skill.name);
    if (!name) continue;
    if (seen.has(name)) {
      throw new Error(`Skill identifiers must produce unique portable names: duplicate "${name}"`);
    }
    seen.add(name);

    // Prefer the rendered content the pipeline already wrote to `.agents`; fall
    // back to an in-memory body. A skill with neither is skipped rather than
    // emitted empty — an empty SKILL.md is worse than an absent one, because it
    // resolves and teaches nothing.
    let content = skill.content ?? null;
    if (!content && skill.output) {
      const src = path.join(root, skill.output);
      if (await fs.pathExists(src)) content = await fs.readFile(src, 'utf8');
    }
    if (!content) continue;

    const target = path.join(outputDir, name, 'SKILL.md');
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, content, 'utf8');
    emitted.push(path.relative(root, target).replaceAll(path.sep, '/'));
  }
  return emitted;
}

/**
 * Mirror compiled agents into `.claude/agents/<name>.md`.
 *
 * Claude Code subagents are markdown with YAML frontmatter — the format the
 * adapter manifest already declares (`subagents.format: markdown_with_frontmatter`).
 */
async function writeClaudeAgents(root, agents) {
  const outputDir = path.join(root, '.claude', 'agents');
  await fs.remove(outputDir);
  if (!agents || agents.length === 0) return [];
  await fs.ensureDir(outputDir);

  const emitted = [];
  const seen = new Set();
  for (const agent of agents) {
    const id = agent.id || agent.code;
    const name = portableName(id);
    if (!name) continue;
    if (seen.has(name)) {
      throw new Error(`Agent identifiers must produce unique portable names: duplicate "${name}"`);
    }
    seen.add(name);

    const description = String(agent.description || '')
      .replaceAll('\n', ' ')
      .trim();
    const tools = agent.tool_policy?.allowed_tools || [];

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      ...(tools.length > 0 ? [`tools: ${tools.join(', ')}`] : []),
      '---',
      '',
    ].join('\n');

    const body = agent.content || `# ${agent.name || id}\n\n${description}\n`;
    await fs.writeFile(path.join(outputDir, `${name}.md`), `${frontmatter}${body}`, 'utf8');
    emitted.push(`.claude/agents/${name}.md`);
  }
  return emitted;
}

async function writePlatformAdapters(root, hooks, platforms, sources = {}) {
  if (!platforms.includes('claude-code')) return;

  const claudeHooksJson = buildClaudeHooksJson(hooks);
  const targetHooksPath = path.join(root, '.claude', 'hooks.json');
  await fs.ensureDir(path.dirname(targetHooksPath));
  await fs.writeFile(targetHooksPath, JSON.stringify(claudeHooksJson, null, 2), 'utf8');

  await writeClaudeSkills(root, sources.skills);
  await writeClaudeAgents(root, sources.agents);
}

module.exports = {
  writePlatformAdapters,
  buildClaudeHooksJson,
  writeClaudeSkills,
  writeClaudeAgents,
};
