<<<<<<< Updated upstream
// Shim: delegates to the modular implementation.
// All callers import AgentCoreCompiler from this path — backward-compat preserved.
module.exports = require('./agent-core-compiler/index');
=======
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('fs-extra');
const yaml = require('yaml');
const csv = require('csv-parse/sync');
const { getProjectRoot } = require('../../../lib/project-root');

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
    const enterpriseSkillsDir = (await fs.pathExists(targetEnterpriseSkillsDir)) ? targetEnterpriseSkillsDir : sourceEnterpriseSkillsDir;
    const sourceHooksPath = await this.resolveHooksPath(root, sourceRoot);
    const sourceHookRegistryPath = await this.resolveHookRegistryPath(root, sourceRoot);

    await fs.ensureDir(agentsDir);
    await this.writeInstructions(root);
    const skills = await this.writeSkills(root, enterpriseSkillsDir, sourceRoot);
    const hooks = await this.writeHookRegistry(root, sourceHookRegistryPath, sourceHooksPath);
    await this.writePlatformAdapters(root, hooks, options.platforms || []);
    const commands = await this.writeCommandRegistry(root, hseosDir);
    const manifest = await this.writeManifest(root, {
      skills,
      hooks,
      commands,
      platforms: options.platforms || [],
    });

    return {
      agentsDir,
      skills: skills.length,
      hooks: hooks.length,
      commands: commands.length,
      manifest,
    };
  }

  async writeInstructions(root) {
    const instructionsDir = path.join(root, this.agentsDirName, 'instructions');
    await fs.ensureDir(instructionsDir);

    const content = `# HSEOS Agent Core

This directory is the vendor-neutral source for HSEOS agent behavior.

## Instruction Cascade

1. Enterprise constitution: \`.enterprise/.specs/constitution/Enterprise-Constitution.md\`
2. Project-neutral agent rules: this file and \`${this.agentsDirName}/manifest.yaml\`
3. Tool adapter: \`AGENTS.md\`, \`CLAUDE.md\`, or another platform entrypoint
4. Agent authority: \`.enterprise/agents/<code>/authority.md\`
5. Triggered skill: \`${this.agentsDirName}/skills/<skill>/SKILL.md\`
6. User instruction in the active conversation

If two instructions conflict, stop and ask for a human decision. Do not average standards.

## Operating Rules

- Load only the minimum matching skills for the task.
- Prefer \`${this.agentsDirName}/skills\` for portable skills; use \`.enterprise/governance/agent-skills\` as the governance source.
- Treat non-\`hseos-*\` skills as governance/check modules and \`hseos-*\` skills as executable agent, task, or workflow launchers. Do not activate both for the same request unless the user explicitly asks for a workflow plus its governance review.
- Treat \`${this.agentsDirName}/hooks/registry.yaml\` as the neutral hook registry. Platform-specific hook files are compiled adapters.
- Never commit directly to \`main\`, \`master\`, or \`develop\`.
- Never add AI attribution or co-author trailers to commits.
- Run repository quality gates before any commit.

## Platform Adapters

- Codex reads \`AGENTS.md\` and discovers skills under \`${this.agentsDirName}/skills\`.
- Claude Code reads \`CLAUDE.md\`, \`.claude/commands\`, and \`.claude/hooks.json\`.
- Command-only tools receive generated command files from the same HSEOS artifacts.
`;

    await fs.writeFile(path.join(instructionsDir, 'PROJECT.md'), content, 'utf8');
  }

  async writeSkills(root, enterpriseSkillsDir, sourceRoot) {
    const outputDir = path.join(root, this.agentsDirName, 'skills');
    await fs.ensureDir(outputDir);

    if (!(await fs.pathExists(enterpriseSkillsDir))) {
      return [];
    }

    const skillFiles = await this.findFiles(enterpriseSkillsDir, 'SKILL.md');
    const skills = [];

    for (const skillFile of skillFiles) {
      const relativeSource = path.relative(enterpriseSkillsDir, skillFile).replaceAll(path.sep, '/');
      const skillName = path.dirname(relativeSource).replaceAll('/', '-');
      if (!skillName || skillName === '.') continue;

      const quickFile = path.join(path.dirname(skillFile), 'SKILL-QUICK.md');
      const sourceContent = await fs.readFile(skillFile, 'utf8');
      const quickContent = (await fs.pathExists(quickFile)) ? await fs.readFile(quickFile, 'utf8') : '';
      const normalized = this.normalizeSkill(sourceContent, quickContent, {
        name: skillName,
        sourcePath: this.displayPath(root, sourceRoot, skillFile),
        quickPath: (await fs.pathExists(quickFile)) ? this.displayPath(root, sourceRoot, quickFile) : null,
      });

      const skillDir = path.join(outputDir, skillName);
      await fs.ensureDir(skillDir);
      const outputPath = path.join(skillDir, 'SKILL.md');
      await fs.writeFile(outputPath, normalized.content, 'utf8');

      if (quickContent) {
        await fs.writeFile(path.join(skillDir, 'QUICK.md'), quickContent.replaceAll('\r\n', '\n'), 'utf8');
      }

      skills.push({
        name: skillName,
        source: normalized.metadata.source,
        quick: normalized.metadata.quick,
        output: path.relative(root, outputPath).replaceAll(path.sep, '/'),
        hash: this.hash(normalized.content),
      });
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  normalizeSkill(sourceContent, quickContent, metadata) {
    const source = sourceContent.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const quick = quickContent.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const parsedSource = this.parseFrontmatter(source);
    const parsedQuick = this.parseFrontmatter(quick);
    const sourceFm = parsedSource.frontmatter || {};
    const quickFm = parsedQuick.frontmatter || {};

    const frontmatter = {
      name: sourceFm.name || quickFm.name || metadata.name,
      description: sourceFm.description || quickFm.description || `Use when ${metadata.name} is required`,
      version: String(sourceFm.version || quickFm.version || '1.0'),
      owner: sourceFm.metadata?.owner || sourceFm.owner || 'platform-governance',
      tier: 'full',
      source: metadata.sourcePath,
      quick: metadata.quickPath,
      portable: true,
    };

    if (sourceFm.license) {
      frontmatter.license = sourceFm.license;
    }

    const body = parsedSource.body.trimStart();
    const quickSection = quick
      ? `\n\n## Quick Mode\n\nFor low-context activation, load \`${metadata.quickPath}\` or \`QUICK.md\` first. Load this full skill for deep analysis, violation fixing, or formal review gates.\n`
      : '';

    return {
      metadata: frontmatter,
      content: `---\n${yaml.stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${body}${quickSection}\n`,
    };
  }

  async writeHookRegistry(root, hookRegistryPath, claudeHooksPath) {
    const outputDir = path.join(root, this.agentsDirName, 'hooks');
    await fs.ensureDir(outputDir);
    const outputPath = path.join(outputDir, 'registry.yaml');

    if (hookRegistryPath && (await fs.pathExists(hookRegistryPath))) {
      const registry = yaml.parse(await fs.readFile(hookRegistryPath, 'utf8')) || {};
      const hooks = Array.isArray(registry.hooks) ? registry.hooks : [];

      if (path.resolve(hookRegistryPath) !== path.resolve(outputPath)) {
        await fs.writeFile(outputPath, yaml.stringify(registry, { lineWidth: 0 }), 'utf8');
      }

      return hooks;
    }

    const hooks = [];

    if (await fs.pathExists(claudeHooksPath)) {
      const parsed = JSON.parse(await fs.readFile(claudeHooksPath, 'utf8'));
      for (const [event, groups] of Object.entries(parsed.hooks || {})) {
        for (const group of groups || []) {
          for (const hook of group.hooks || []) {
            hooks.push({
              id: this.slug(`${event}-${group.matcher || 'all'}-${hook.description || hook.command}`),
              event,
              matcher: group.matcher || '*',
              type: hook.type || 'command',
              command: hook.command,
              timeout: hook.timeout || null,
              blocking: event === 'PreToolUse',
              description: hook.description || '',
              platform_support: ['claude-code'],
              status: 'active',
              fallback: 'Use repository scripts or quality gates when the target platform has no native hook event.',
            });
          }
        }
      }
    }

    const registry = {
      version: '1.0',
      source: '.claude/hooks.json',
      hooks,
    };

    await fs.writeFile(outputPath, yaml.stringify(registry, { lineWidth: 0 }), 'utf8');
    return hooks;
  }

  async writeCommandRegistry(root, hseosDir) {
    const outputDir = path.join(root, this.agentsDirName, 'commands');
    await fs.ensureDir(outputDir);

    const commands = [];
    const workflowRegistry = path.join(hseosDir, 'workflows', 'registry.yaml');
    if (await fs.pathExists(workflowRegistry)) {
      const parsed = yaml.parse(await fs.readFile(workflowRegistry, 'utf8')) || {};
      const workflows = Array.isArray(parsed.workflows) ? parsed.workflows : [];
      for (const workflow of workflows) {
        if (!workflow.id && !workflow.name) continue;
        commands.push({
          name: this.slug(`hseos-workflow-${workflow.id || workflow.name}`),
          type: 'workflow',
          source: workflow.path || null,
          description: workflow.description || workflow.name || workflow.id,
        });
      }
    }

    const workflowManifest = path.join(hseosDir, '_config', 'workflow-manifest.csv');
    if (commands.length === 0 && (await fs.pathExists(workflowManifest))) {
      const records = csv.parse(await fs.readFile(workflowManifest, 'utf8'), {
        columns: true,
        skip_empty_lines: true,
      });

      for (const workflow of records) {
        if (!workflow.name) continue;
        commands.push({
          name: this.slug(`hseos-workflow-${workflow.module}-${workflow.name}`),
          type: 'workflow',
          source: workflow.path || null,
          description: workflow.description || workflow.name,
        });
      }
    }

    const manifestPath = path.join(hseosDir, 'AGENT-MANIFEST.md');
    if (await fs.pathExists(manifestPath)) {
      commands.push({
        name: 'hseos-agent-manifest',
        type: 'agent-index',
        source: path.relative(root, manifestPath).replaceAll(path.sep, '/'),
        description: 'HSEOS installed agent manifest',
      });
    }

    const registry = {
      version: '1.0',
      commands,
    };

    await fs.writeFile(path.join(outputDir, 'registry.yaml'), yaml.stringify(registry, { lineWidth: 0 }), 'utf8');
    return commands;
  }

  async writePlatformAdapters(root, hooks, platforms) {
    if (!platforms.includes('claude-code')) {
      return;
    }

    const activeClaudeHooks = hooks.filter((hook) => {
      const status = hook.status || 'active';
      const platformSupport = hook.platform_support || [];
      return status === 'active' && platformSupport.includes('claude-code');
    });

    const claudeHooks = { hooks: {} };
    for (const hook of activeClaudeHooks) {
      if (!hook.event || !hook.command) continue;
      const matcher = hook.matcher === '*' ? '' : (hook.matcher || '');
      const hookConfig = {
        type: hook.type || 'command',
        command: hook.command,
      };

      if (hook.timeout !== undefined && hook.timeout !== null) {
        hookConfig.timeout = hook.timeout;
      }

      if (hook.description) {
        hookConfig.description = hook.description;
      }

      if (!claudeHooks.hooks[hook.event]) {
        claudeHooks.hooks[hook.event] = [];
      }

      let group = claudeHooks.hooks[hook.event].find((entry) => entry.matcher === matcher);
      if (!group) {
        group = { matcher, hooks: [] };
        claudeHooks.hooks[hook.event].push(group);
      }

      group.hooks.push(hookConfig);
    }

    const targetHooksPath = path.join(root, '.claude', 'hooks.json');
    await fs.ensureDir(path.dirname(targetHooksPath));
    await fs.writeJson(targetHooksPath, claudeHooks, { spaces: 2 });
  }

  async writeManifest(root, data) {
    const manifest = {
      version: '1.0',
      generated_by: 'hseos-agent-core-compiler',
      source_of_truth: '.agents',
      adapters: {
        codex: {
          entrypoint: 'AGENTS.md',
          skills: '.agents/skills',
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

    const manifestPath = path.join(root, this.agentsDirName, 'manifest.yaml');
    await fs.writeFile(manifestPath, yaml.stringify(manifest, { lineWidth: 0 }), 'utf8');
    return path.relative(root, manifestPath).replaceAll(path.sep, '/');
  }

  parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) {
      return { frontmatter: {}, body: content };
    }

    try {
      return {
        frontmatter: yaml.parse(match[1]) || {},
        body: match[2],
      };
    } catch {
      return { frontmatter: {}, body: content };
    }
  }

  async resolveHooksPath(root, sourceRoot) {
    const targetHooksPath = path.join(root, '.claude', 'hooks.json');
    if (await fs.pathExists(targetHooksPath)) {
      return targetHooksPath;
    }

    const sourceHooksPath = path.join(sourceRoot, '.claude', 'hooks.json');
    if (await fs.pathExists(sourceHooksPath)) {
      return sourceHooksPath;
    }

    return null;
  }

  async resolveHookRegistryPath(root, sourceRoot) {
    const targetRegistryPath = path.join(root, this.agentsDirName, 'hooks', 'registry.yaml');
    if (await fs.pathExists(targetRegistryPath)) {
      return targetRegistryPath;
    }

    const sourceRegistryPath = path.join(sourceRoot, this.agentsDirName, 'hooks', 'registry.yaml');
    if (await fs.pathExists(sourceRegistryPath)) {
      return sourceRegistryPath;
    }

    return null;
  }

  displayPath(root, sourceRoot, filePath) {
    const resolved = path.resolve(filePath);
    const resolvedRoot = path.resolve(root);
    const resolvedSourceRoot = path.resolve(sourceRoot);

    if (resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      return path.relative(resolvedRoot, resolved).replaceAll(path.sep, '/');
    }

    if (resolved.startsWith(`${resolvedSourceRoot}${path.sep}`)) {
      return path.relative(resolvedSourceRoot, resolved).replaceAll(path.sep, '/');
    }

    return resolved.replaceAll(path.sep, '/');
  }

  async findFiles(dir, filename) {
    const results = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.findFiles(fullPath, filename)));
      } else if (entry.name === filename) {
        results.push(fullPath);
      }
    }

    return results;
  }

  hash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  slug(value) {
    return String(value)
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '');
  }
}

module.exports = { AgentCoreCompiler };
>>>>>>> Stashed changes
