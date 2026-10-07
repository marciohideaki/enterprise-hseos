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
 * prevent. Decision: they stay unemitted until a rules/workflows source exists.
 *
 * MCP surfaces (ADR-0008, Wave 3): when the active MCP bundles contain
 * client-enabled stdio servers, the adapter emits
 *   - .mcp.json              `mcpServers` for those servers
 *   - .claude/settings.json  `allowedMcpServers` naming the same servers, so the
 *                            project never ships an empty allow-list that blocks
 *                            the compiled .mcp.json
 * Both files are user-shared: only the managed key is merged (existing user
 * keys and entries survive; same-id servers are refreshed). Without servers
 * nothing is written and existing files are left untouched. An unparseable
 * existing file is never overwritten.
 */

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { resolveServerCommand } = require('./codex');

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

async function loadClaudeMcpServers(root, sources) {
  const agentsDirName = sources.agentsDirName || '.agents';
  const registryPath = path.join(root, agentsDirName, 'mcp', 'registry.yaml');
  const enabled = (sources.mcpServers || []).filter((s) => s && s.id && s.client_enabled !== false);
  if (enabled.length === 0 || !(await fs.pathExists(registryPath))) return [];

  const registry = yaml.parse(await fs.readFile(registryPath, 'utf8')) || {};
  const bundleDefs = registry.bundles || {};
  const bundleCache = new Map();
  const servers = [];
  for (const entry of enabled) {
    const def = bundleDefs[entry.bundle];
    if (!def?.file) continue;
    if (!bundleCache.has(entry.bundle)) {
      const file = path.join(path.dirname(registryPath), def.file);
      bundleCache.set(entry.bundle, (await fs.pathExists(file)) ? yaml.parse(await fs.readFile(file, 'utf8')) || {} : {});
    }
    const server = (bundleCache.get(entry.bundle).servers || []).find((s) => s.id === entry.id);
    const spec = server && resolveServerCommand(server);
    if (!spec?.command) continue;
    const config = { command: spec.command, args: spec.args || [] };
    if (server.env && Object.keys(server.env).length > 0) config.env = server.env;
    servers.push({ id: entry.id, config });
  }
  return servers;
}

async function readJsonObject(file) {
  if (!(await fs.pathExists(file))) return {};
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Emit `.mcp.json` and `.claude/settings.json` for the active MCP servers,
 * merging only the managed keys into any existing user file.
 */
async function writeClaudeMcpSurfaces(root, sources = {}) {
  const servers = await loadClaudeMcpServers(root, sources);
  if (servers.length === 0) return [];

  const emitted = [];
  const mcpPath = path.join(root, '.mcp.json');
  const mcpDoc = await readJsonObject(mcpPath);
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const settingsDoc = await readJsonObject(settingsPath);

  if (mcpDoc) {
    const merged = { ...mcpDoc.mcpServers };
    for (const { id, config } of servers) merged[id] = config;
    await fs.writeFile(mcpPath, `${JSON.stringify({ ...mcpDoc, mcpServers: merged }, null, 2)}\n`, 'utf8');
    emitted.push('.mcp.json');
  } else {
    console.warn('[agent-core] .mcp.json is not a valid JSON object; left untouched');
  }

  if (settingsDoc) {
    const existing = Array.isArray(settingsDoc.allowedMcpServers) ? settingsDoc.allowedMcpServers : [];
    const names = new Set(existing.map((e) => e?.serverName).filter(Boolean));
    const merged = [...existing];
    for (const { id } of servers) {
      if (!names.has(id)) merged.push({ serverName: id });
    }
    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeFile(settingsPath, `${JSON.stringify({ ...settingsDoc, allowedMcpServers: merged }, null, 2)}\n`, 'utf8');
    emitted.push('.claude/settings.json');
  } else {
    console.warn('[agent-core] .claude/settings.json is not a valid JSON object; left untouched');
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
  await writeClaudeMcpSurfaces(root, sources);
}

module.exports = {
  writePlatformAdapters,
  buildClaudeHooksJson,
  writeClaudeSkills,
  writeClaudeAgents,
  writeClaudeMcpSurfaces,
};
