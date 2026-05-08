'use strict';

/**
 * Goose adapter — reference BYOA implementation for ADR-0007.
 *
 * Goose (by Block, LF AAIF reference impl) does not have a hooks system.
 * This adapter:
 *   - emits .goose/config.yaml with MCP server registrations
 *   - emits .goose/skills/<skill-id>.md for each HSEOS skill
 *   - emits .goose/agents/<agent-id>.yaml for each HSEOS agent
 *   - emits .goose/hooks-metadata.json as advisory (Goose-native hooks unsupported)
 */

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');

const HOOK_EVENT_MAP = {
  PostToolUse: null,
  PreToolUse: null,
  UserPromptSubmit: null,
  PreCompact: null,
  Stop: null,
};

class GooseAdapter {
  static get id() {
    return 'goose';
  }

  static get version() {
    return '1.0';
  }

  static get capabilities() {
    return ['slash_commands', 'mcp_stdio', 'skill_markdown'];
  }

  async validate(sources) {
    const warnings = [];
    const activeHooks = (sources.hooks || []).filter((h) => !h.status || h.status === 'active');
    if (activeHooks.length > 0) {
      warnings.push(
        `Goose does not support hooks natively. ${activeHooks.length} hook(s) documented in .goose/hooks-metadata.json.`,
      );
    }
    return { ok: true, warnings, errors: [] };
  }

  async emit(sources, outputDir) {
    await fs.ensureDir(path.join(outputDir, '.goose', 'skills'));
    await fs.ensureDir(path.join(outputDir, '.goose', 'agents'));

    await this._emitConfig(sources, outputDir);
    await this._emitSkills(sources, outputDir);
    await this._emitAgents(sources, outputDir);
    await this._emitHooksMeta(sources, outputDir);
  }

  async _emitConfig(sources, outputDir) {
    const mcpServers = {};
    for (const bundle of sources.mcpBundles || []) {
      for (const server of bundle.servers || []) {
        mcpServers[server.id] = {
          transport: 'stdio',
          command: server.command,
          args: server.args || [],
          envs: server.env || {},
        };
      }
    }

    const config = {
      version: '1.0',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      mcp_servers: mcpServers,
      extensions: {
        hseos: {
          skills_dir: '.goose/skills',
          agents_dir: '.goose/agents',
        },
      },
    };

    await fs.writeFile(
      path.join(outputDir, '.goose', 'config.yaml'),
      yaml.stringify(config),
      'utf8',
    );
  }

  async _emitSkills(sources, outputDir) {
    for (const skill of sources.skills || []) {
      const skillId = skill.name || skill.id;
      if (!skillId) continue;
      const content = skill.content || `# ${skillId}\n\n${skill.description || ''}\n`;
      await fs.writeFile(
        path.join(outputDir, '.goose', 'skills', `${skillId}.md`),
        content,
        'utf8',
      );
    }
  }

  async _emitAgents(sources, outputDir) {
    for (const agent of sources.agents || []) {
      const agentId = agent.id || agent.code;
      if (!agentId) continue;
      const agentYaml = yaml.stringify({
        id: agentId,
        name: agent.name || agentId,
        description: agent.description || '',
        model: 'claude-sonnet-4-6',
        tools: agent.tool_policy?.allowed_tools || [],
      });
      await fs.writeFile(
        path.join(outputDir, '.goose', 'agents', `${agentId}.yaml`),
        agentYaml,
        'utf8',
      );
    }
  }

  async _emitHooksMeta(sources, outputDir) {
    const activeHooks = (sources.hooks || []).filter((h) => !h.status || h.status === 'active');
    const meta = {
      _notice: 'Goose does not support hooks natively. This file documents hook intent for manual implementation.',
      hooks: activeHooks.map((h) => ({
        id: h.id,
        event: h.event,
        matcher: h.matcher,
        command: h.command,
        blocking: h.blocking,
        description: h.description,
        goose_equivalent: HOOK_EVENT_MAP[h.event] ?? 'unsupported',
      })),
    };
    await fs.writeFile(
      path.join(outputDir, '.goose', 'hooks-metadata.json'),
      JSON.stringify(meta, null, 2),
      'utf8',
    );
  }

  async verify(outputDir) {
    const configPath = path.join(outputDir, '.goose', 'config.yaml');
    const exists = await fs.pathExists(configPath);
    if (!exists) {
      return { ok: false, drift: ['.goose/config.yaml missing — run compile'] };
    }
    return { ok: true, drift: [] };
  }

  async clean(outputDir) {
    const gooseDir = path.join(outputDir, '.goose');
    const removed = [];
    if (await fs.pathExists(gooseDir)) {
      await fs.remove(gooseDir);
      removed.push('.goose/');
    }
    return { removed };
  }

  mapHookEvent(neutralEvent) {
    return HOOK_EVENT_MAP[neutralEvent] ?? null;
  }

  mapToolName(neutralName) {
    return neutralName;
  }

  resolvePath(neutralPath) {
    return neutralPath.replace(/^\.claude\//, '.goose/');
  }
}

module.exports = GooseAdapter;
