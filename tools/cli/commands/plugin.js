'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const prompts = require('../lib/prompts');

const SUPPORTED_ACTIONS = new Set(['list', 'install', 'remove', 'doctor']);

async function readRegistry(projectDir) {
  const registryPath = path.join(projectDir, '.agents', 'plugins', 'registry.yaml');
  if (!(await fs.pathExists(registryPath))) return null;
  const raw = await fs.readFile(registryPath, 'utf8');
  return yaml.parse(raw) || null;
}

async function runList(projectDir) {
  const registry = await readRegistry(projectDir);
  if (!registry || !Array.isArray(registry.plugins) || registry.plugins.length === 0) {
    await prompts.log.warn('No plugins declared in .agents/plugins/registry.yaml');
    return;
  }
  await prompts.log.message(`HSEOS Plugin Marketplace — ${registry.plugins.length} plugin(s):\n`);
  for (const p of registry.plugins) {
    const statusMark = p.status === 'active' ? '✓' : '○';
    await prompts.log.message(`  ${statusMark} ${p.id}@${p.version} — ${p.description}`);
  }
}

async function runInstall(projectDir, pluginId) {
  if (!pluginId) {
    throw new Error('hseos plugin install requires a plugin id. Usage: hseos plugin install <id>');
  }
  const registry = await readRegistry(projectDir);
  if (!registry) {
    throw new Error('No plugin registry found. Run `hseos agent-core compile` first.');
  }
  const entry = (registry.plugins || []).find((p) => p.id === pluginId);
  if (!entry) {
    throw new Error(`Plugin not found in registry: ${pluginId}`);
  }

  const manifestPath = path.join(projectDir, '.agents', 'plugins', 'definitions', pluginId, 'plugin.yaml');
  if (!(await fs.pathExists(manifestPath))) {
    throw new Error(`Plugin definition not found: ${manifestPath}`);
  }
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = yaml.parse(raw) || {};

  // Emit to claude-plugin
  const claudePluginDir = path.join(projectDir, '.claude-plugin', 'plugins', pluginId);
  await fs.ensureDir(claudePluginDir);
  await fs.writeFile(path.join(claudePluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // Emit to codex-plugin
  const codexPluginDir = path.join(projectDir, '.codex-plugin', 'plugins', pluginId);
  await fs.ensureDir(codexPluginDir);
  await fs.writeFile(path.join(codexPluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');

  await prompts.log.success(`Installed plugin: ${pluginId}@${manifest.version}`);
}

async function runRemove(projectDir, pluginId) {
  if (!pluginId) {
    throw new Error('hseos plugin remove requires a plugin id. Usage: hseos plugin remove <id>');
  }
  const claudePluginDir = path.join(projectDir, '.claude-plugin', 'plugins', pluginId);
  const codexPluginDir = path.join(projectDir, '.codex-plugin', 'plugins', pluginId);

  let removed = 0;
  if (await fs.pathExists(claudePluginDir)) {
    await fs.remove(claudePluginDir);
    removed++;
  }
  if (await fs.pathExists(codexPluginDir)) {
    await fs.remove(codexPluginDir);
    removed++;
  }
  if (removed === 0) {
    await prompts.log.warn(`Plugin not installed: ${pluginId}`);
    return;
  }
  await prompts.log.success(`Removed plugin: ${pluginId}`);
}

async function runDoctor(projectDir) {
  const registry = await readRegistry(projectDir);
  if (!registry || !Array.isArray(registry.plugins)) {
    await prompts.log.warn('No plugin registry found.');
    return;
  }

  let passed = 0;
  let failed = 0;
  for (const entry of registry.plugins) {
    const manifestPath = path.join(projectDir, '.agents', 'plugins', 'definitions', entry.id, 'plugin.yaml');
    const readmePath = path.join(projectDir, '.agents', 'plugins', 'definitions', entry.id, 'README.md');
    const manifestExists = await fs.pathExists(manifestPath);
    const readmeExists = await fs.pathExists(readmePath);

    if (!manifestExists || !readmeExists) {
      const missingFile = manifestExists ? 'README.md' : 'plugin.yaml';
      await prompts.log.error(`✗ ${entry.id} — missing ${missingFile}`);
      failed++;
      continue;
    }

    let manifest;
    try {
      manifest = yaml.parse(await fs.readFile(manifestPath, 'utf8')) || {};
    } catch {
      await prompts.log.error(`✗ ${entry.id} — plugin.yaml parse error`);
      failed++;
      continue;
    }

    const requiredKeys = ['id', 'version', 'description', 'license'];
    const missingKeys = requiredKeys.filter((k) => !manifest[k]);
    if (missingKeys.length > 0) {
      await prompts.log.error(`✗ ${entry.id} — plugin.yaml missing: ${missingKeys.join(', ')}`);
      failed++;
      continue;
    }

    await prompts.log.success(`✓ ${entry.id}@${manifest.version} — conformance pass`);
    passed++;
  }

  if (failed > 0) {
    throw new Error(`plugin doctor: ${failed} plugin(s) failed conformance checks`);
  }
  await prompts.log.success(`plugin doctor: all ${passed} plugin(s) passed.`);
}

module.exports = {
  command: 'plugin <action> [plugin-id]',
  description: 'Manage HSEOS plugins',
  options: [['--directory <path>', 'Project directory (default: current directory)']],
  action: async (action, pluginId, options = {}) => {
    if (!SUPPORTED_ACTIONS.has(action)) {
      throw new Error(`Unsupported plugin action: ${action}. Expected one of: ${[...SUPPORTED_ACTIONS].join(', ')}`);
    }
    const projectDir = path.resolve(options.directory || process.cwd());
    if (action === 'list') {
      await runList(projectDir);
      return;
    }
    if (action === 'install') {
      await runInstall(projectDir, pluginId);
      return;
    }
    if (action === 'remove') {
      await runRemove(projectDir, pluginId);
      return;
    }
    if (action === 'doctor') {
      await runDoctor(projectDir);
    }
  },
};
