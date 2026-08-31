'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const { getProjectRoot } = require('../../../../lib/project-root');

const { writeInstructions } = require('./sources/instructions-source');
const { writeSkills, normalizeSkill } = require('./sources/skills-source');
const { syncHandlers, writeHookRegistry } = require('./sources/hooks-source');
const { writeCommandRegistry } = require('./sources/commands-source');
const { collectAgents } = require('./sources/agents-source');
const { syncAdapterCatalog, syncCapabilityCatalog } = require('./sources/capabilities-source');
const {
  writePluginRegistry,
  loadActivePluginManifests,
  syncPluginCatalog,
  verifyActivePluginConformance,
} = require('./sources/plugins-source');
const { collectMcp } = require('./sources/mcp-source');
const { writePlatformAdapters } = require('./adapters/platforms');
const { writePlatformPluginAdapters } = require('./adapters/plugins-emit');
const { writeManifest } = require('./manifest/builder');
const { parseFrontmatter } = require('./lib/frontmatter');
const { slug } = require('./lib/slug');
const { hash } = require('./lib/hash');
const { displayPath, resolveHooksPath } = require('./lib/path-resolver');
const { findFiles } = require('./lib/find-files');

const DEFAULT_AGENTS_DIR = '.agents';
const ENTERPRISE_SKILLS_DIR = path.join('.enterprise', 'governance', 'agent-skills');
const ENTERPRISE_HOOKS_DIR = path.join('.enterprise', 'governance', 'hooks');

class AgentCoreCompiler {
  constructor(options = {}) {
    this.agentsDirName = options.agentsDirName || DEFAULT_AGENTS_DIR;
  }

  async compile(projectDir, hseosDir, options = {}) {
    const root = path.resolve(projectDir);
    const sourceRoot = path.resolve(options.sourceRoot || getProjectRoot());
    const agentsDir = path.join(root, this.agentsDirName);
    const targetEnterpriseSkillsDir = path.join(root, ENTERPRISE_SKILLS_DIR);
    const sourceEnterpriseSkillsDir = path.join(sourceRoot, ENTERPRISE_SKILLS_DIR);
    const enterpriseSkillsDir = (await fs.pathExists(targetEnterpriseSkillsDir)) ? targetEnterpriseSkillsDir : sourceEnterpriseSkillsDir;
    await syncCapabilityCatalog(root, sourceRoot, this.agentsDirName);
    await syncAdapterCatalog(root, sourceRoot, this.agentsDirName);
    await syncPluginCatalog(root, sourceRoot, this.agentsDirName);
    const registryPlugins = await writePluginRegistry(root, this.agentsDirName);
    const activePluginManifests = await loadActivePluginManifests(root, registryPlugins, this.agentsDirName);
    await verifyActivePluginConformance(root, activePluginManifests, this.agentsDirName);

    await fs.ensureDir(agentsDir);
    await writeInstructions(root, this.agentsDirName);
    const selectedSkills = Array.isArray(options.selectedSkills) ? [...new Set(options.selectedSkills)].sort() : null;
    const skills = await writeSkills(root, enterpriseSkillsDir, sourceRoot, this.agentsDirName, selectedSkills);
    if (selectedSkills) {
      const emittedSkills = skills.map((skill) => skill.name).sort();
      if (JSON.stringify(emittedSkills) !== JSON.stringify(selectedSkills)) {
        throw new Error(
          `Capability materialization mismatch: selected [${selectedSkills.join(', ')}], emitted [${emittedSkills.join(', ')}]`,
        );
      }
    }

    // Determine hook source. Canonical: .enterprise/governance/hooks/registry.yaml
    // (target, then source root). Compatibility fallbacks: the previously compiled
    // .agents/hooks/registry.yaml (target, then source root), then legacy hooks.json.
    const targetEnterpriseHooks = path.join(root, ENTERPRISE_HOOKS_DIR, 'registry.yaml');
    const sourceEnterpriseHooks = path.join(sourceRoot, ENTERPRISE_HOOKS_DIR, 'registry.yaml');
    const targetRegistry = path.join(root, this.agentsDirName, 'hooks', 'registry.yaml');
    const sourceRegistry = path.join(sourceRoot, this.agentsDirName, 'hooks', 'registry.yaml');
    let hookSource;
    if (await fs.pathExists(targetEnterpriseHooks)) {
      hookSource = targetEnterpriseHooks;
    } else if (await fs.pathExists(sourceEnterpriseHooks)) {
      hookSource = sourceEnterpriseHooks;
    } else if (await fs.pathExists(targetRegistry)) {
      hookSource = targetRegistry;
    } else if (await fs.pathExists(sourceRegistry)) {
      hookSource = sourceRegistry;
    } else {
      hookSource = await resolveHooksPath(root, sourceRoot);
    }

    const hooks = await this.writeHookRegistry(root, hookSource, null);

    // Sync handler scripts from the enterprise source into the compiled tree and
    // hash-pin them (skills-style). Projects without the enterprise handlers dir
    // skip this step entirely, keeping pre-migration installs byte-for-byte compatible.
    const targetHandlersDir = path.join(root, ENTERPRISE_HOOKS_DIR, 'handlers');
    const sourceHandlersDir = path.join(sourceRoot, ENTERPRISE_HOOKS_DIR, 'handlers');
    const handlersSourceDir = (await fs.pathExists(targetHandlersDir)) ? targetHandlersDir : sourceHandlersDir;
    const handlers = await syncHandlers(root, handlersSourceDir, this.agentsDirName);
    const commands = await writeCommandRegistry(root, hseosDir, this.agentsDirName);
    const agents = await collectAgents(root);
    const plugins = activePluginManifests.map((plugin) => {
      const entry = { id: plugin.id, version: String(plugin.version) };
      if (plugin.extends) entry.extends = plugin.extends;
      return entry;
    });
    const mcp = await collectMcp(root, this.agentsDirName, hseosDir);

    // Adapters run after all sources are collected so cross-surface emitters
    // (Goose mirrors skills/agents/MCP bundles) receive real data. Returns the
    // requested platforms that actually have an emitter — the manifest records
    // exactly that list, never an aspirational one.
    const emittedPlatforms = await this.writePlatformAdapters(root, hooks, options.platforms || [], {
      agentsDirName: this.agentsDirName,
      sources: { skills, agents, mcpBundles: mcp.bundles || [] },
    });
    await writePlatformPluginAdapters(root, registryPlugins, this.agentsDirName, emittedPlatforms, activePluginManifests);

    const manifest = await writeManifest(
      root,
      {
        skills,
        hooks,
        handlers,
        commands,
        agents,
        plugins,
        mcp,
        platforms: emittedPlatforms,
      },
      this.agentsDirName,
    );

    return {
      agentsDir,
      skills: skills.length,
      hooks: hooks.length,
      handlers: handlers.length,
      commands: commands.length,
      agents: agents.length,
      plugins: plugins.length,
      mcpServers: mcp.servers.length,
      manifest,
    };
  }

  // Delegating methods kept for backward compatibility and direct test usage
  async writeInstructions(root) {
    return writeInstructions(root, this.agentsDirName);
  }

  async writeSkills(root, enterpriseSkillsDir, sourceRoot, selectedSkillIds = null) {
    return writeSkills(root, enterpriseSkillsDir, sourceRoot, this.agentsDirName, selectedSkillIds);
  }

  async writeHookRegistry(root, sourcePath, legacyFallback) {
    return writeHookRegistry(root, sourcePath, legacyFallback, this.agentsDirName);
  }

  async writePlatformAdapters(root, hooks, platforms, options = {}) {
    return writePlatformAdapters(root, hooks, platforms, {
      agentsDirName: this.agentsDirName,
      ...options,
    });
  }

  async writeCommandRegistry(root, hseosDir) {
    return writeCommandRegistry(root, hseosDir, this.agentsDirName);
  }

  async writeManifest(root, data) {
    return writeManifest(root, data, this.agentsDirName);
  }

  // Pure utilities kept as instance methods for callers that used them directly
  normalizeSkill(sourceContent, quickContent, metadata) {
    return normalizeSkill(sourceContent, quickContent, metadata);
  }

  parseFrontmatter(content) {
    return parseFrontmatter(content);
  }

  async resolveHooksPath(root, sourceRoot) {
    return resolveHooksPath(root, sourceRoot);
  }

  displayPath(root, sourceRoot, filePath) {
    return displayPath(root, sourceRoot, filePath);
  }

  async findFiles(dir, filename) {
    return findFiles(dir, filename);
  }

  hash(content) {
    return hash(content);
  }

  slug(value) {
    return slug(value);
  }
}

module.exports = { AgentCoreCompiler };
