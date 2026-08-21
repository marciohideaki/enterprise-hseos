'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { loadActivePluginManifests } = require('../sources/plugins-source');

function buildClaudePluginMarketplace(registryRaw, plugins) {
  return {
    schema_version: registryRaw.schema_version || '1.0',
    marketplace: registryRaw.marketplace || {},
    plugins: plugins.map((p) => ({
      id: p.id,
      version: p.version,
      description: p.description,
      license: p.license,
      authors: p.authors || [],
      extends: p.extends || null,
      requires_bundles: p.requires_bundles || [],
      surfaces: p.surfaces || {},
    })),
  };
}

function buildCodexPluginIndex(registryRaw, plugins) {
  return {
    version: '1.0',
    marketplace_id: (registryRaw.marketplace || {}).id || 'hseos',
    plugins: plugins.map((p) => ({
      id: p.id,
      version: p.version,
      description: p.description,
      skills: Array.isArray((p.surfaces || {}).skills) ? p.surfaces.skills : [],
      commands: Array.isArray((p.surfaces || {}).commands) ? p.surfaces.commands : [],
      hooks: Array.isArray((p.surfaces || {}).hooks) ? p.surfaces.hooks : [],
      agents: Array.isArray((p.surfaces || {}).agents) ? p.surfaces.agents : [],
    })),
  };
}

async function writePlatformPluginAdapters(root, registryPlugins, agentsDirName = '.agents', platforms = [], validatedManifests) {
  const registryPath = path.join(root, agentsDirName, 'plugins', 'registry.yaml');
  if (!(await fs.pathExists(registryPath))) return;

  const registryRaw = yaml.parse(await fs.readFile(registryPath, 'utf8')) || {};
  const plugins = validatedManifests || (await loadActivePluginManifests(root, registryPlugins, agentsDirName));
  const inactiveIds = registryPlugins.filter((plugin) => plugin && plugin.id && plugin.status !== 'active').map((plugin) => plugin.id);

  // Registry status is vendor-neutral. Deactivation therefore applies to every
  // vendor installation even when this compile emits only one target.
  const pluginRoots = [path.join(root, '.claude-plugin'), path.join(root, '.codex-plugin')];

  for (const pluginRoot of pluginRoots) {
    for (const pluginId of inactiveIds) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginId)) {
        throw new Error(`Inactive plugin has unsafe id: ${pluginId}`);
      }
      const installedDir = path.join(pluginRoot, 'plugins', pluginId);
      if (!(await fs.pathExists(installedDir))) continue;

      const disabledDir = path.join(pluginRoot, 'disabled', pluginId);
      if (await fs.pathExists(disabledDir)) {
        throw new Error(`Cannot disable stale plugin ${pluginId}: quarantine already exists at ${disabledDir}`);
      }
      await fs.ensureDir(path.dirname(disabledDir));
      await fs.move(installedDir, disabledDir);
    }
  }

  if (platforms.includes('claude-code') || platforms.length === 0) {
    const claudePluginDir = path.join(root, '.claude-plugin');
    await fs.ensureDir(claudePluginDir);
    const marketplace = buildClaudePluginMarketplace(registryRaw, plugins);
    await fs.writeFile(path.join(claudePluginDir, 'marketplace.json'), JSON.stringify(marketplace, null, 2), 'utf8');
  }

  if (platforms.includes('codex') || platforms.length === 0) {
    const codexPluginDir = path.join(root, '.codex-plugin');
    await fs.ensureDir(codexPluginDir);
    const index = buildCodexPluginIndex(registryRaw, plugins);
    await fs.writeFile(path.join(codexPluginDir, 'plugin.json'), JSON.stringify(index, null, 2), 'utf8');
  }
}

module.exports = { writePlatformPluginAdapters };
