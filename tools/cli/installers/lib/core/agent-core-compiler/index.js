'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const { getProjectRoot } = require('../../../../lib/project-root');

const { writeInstructions } = require('./sources/instructions-source');
const { writeSkills, normalizeSkill } = require('./sources/skills-source');
const { writeHookRegistry } = require('./sources/hooks-source');
const { writeCommandRegistry } = require('./sources/commands-source');
const { collectAgents } = require('./sources/agents-source');
const { writePluginRegistry } = require('./sources/plugins-source');
const { collectMcp } = require('./sources/mcp-source');
const { writePlatformAdapters } = require('./adapters/platforms');
const { writeManifest } = require('./manifest/builder');
const { parseFrontmatter } = require('./lib/frontmatter');
const { slug } = require('./lib/slug');
const { hash } = require('./lib/hash');
const { displayPath, resolveHooksPath } = require('./lib/path-resolver');
const { findFiles } = require('./lib/find-files');

const DEFAULT_AGENTS_DIR = '.agents';
const ENTERPRISE_SKILLS_DIR = path.join('.enterprise', 'governance', 'agent-skills');

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
    const enterpriseSkillsDir = (await fs.pathExists(targetEnterpriseSkillsDir))
      ? targetEnterpriseSkillsDir
      : sourceEnterpriseSkillsDir;

    await fs.ensureDir(agentsDir);
    await writeInstructions(root, this.agentsDirName);
    const skills = await writeSkills(root, enterpriseSkillsDir, sourceRoot, this.agentsDirName);

    // Determine hook source: prefer neutral registry (target, then source), fall back to legacy hooks.json
    const targetRegistry = path.join(root, this.agentsDirName, 'hooks', 'registry.yaml');
    const sourceRegistry = path.join(sourceRoot, this.agentsDirName, 'hooks', 'registry.yaml');
    let hookSource;
    if (await fs.pathExists(targetRegistry)) {
      hookSource = targetRegistry;
    } else if (await fs.pathExists(sourceRegistry)) {
      hookSource = sourceRegistry;
    } else {
      hookSource = await resolveHooksPath(root, sourceRoot);
    }

    const hooks = await this.writeHookRegistry(root, hookSource, null);
    await this.writePlatformAdapters(root, hooks, options.platforms || [], {
      agentsDirName: this.agentsDirName,
    });
    const commands = await writeCommandRegistry(root, hseosDir, this.agentsDirName);
    const agents = await collectAgents(root);
    const plugins = (await writePluginRegistry(root, this.agentsDirName))
      .filter((plugin) => plugin && plugin.id && plugin.version)
      .map((plugin) => {
        const entry = { id: plugin.id, version: String(plugin.version) };
        if (plugin.extends) entry.extends = plugin.extends;
        return entry;
      });
    const mcp = await collectMcp(root, this.agentsDirName, hseosDir);
    const manifest = await writeManifest(root, {
      skills,
      hooks,
      commands,
      agents,
      plugins,
      mcp,
      platforms: options.platforms || [],
    }, this.agentsDirName);

    return {
      agentsDir,
      skills: skills.length,
      hooks: hooks.length,
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

  async writeSkills(root, enterpriseSkillsDir, sourceRoot) {
    return writeSkills(root, enterpriseSkillsDir, sourceRoot, this.agentsDirName);
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
