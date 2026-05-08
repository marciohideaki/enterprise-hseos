'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');

async function readPluginManifest(root, agentsDirName, pluginId) {
  const manifestPath = path.join(root, agentsDirName, 'plugins', 'definitions', pluginId, 'plugin.yaml');
  if (!(await fs.pathExists(manifestPath))) return null;
  const raw = await fs.readFile(manifestPath, 'utf8');
  return yaml.parse(raw) || null;
}

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

async function writePlatformPluginAdapters(root, registryPlugins, agentsDirName = '.agents', platforms = []) {
  if (registryPlugins.length === 0) return;

  const registryPath = path.join(root, agentsDirName, 'plugins', 'registry.yaml');
  let registryRaw = {};
  if (await fs.pathExists(registryPath)) {
    registryRaw = yaml.parse(await fs.readFile(registryPath, 'utf8')) || {};
  }

  const manifests = await Promise.all(
    registryPlugins.map((p) => readPluginManifest(root, agentsDirName, p.id)),
  );
  const plugins = manifests.filter(Boolean);

  if (platforms.includes('claude-code') || platforms.length === 0) {
    const claudePluginDir = path.join(root, '.claude-plugin');
    await fs.ensureDir(claudePluginDir);
    const marketplace = buildClaudePluginMarketplace(registryRaw, plugins);
    await fs.writeFile(
      path.join(claudePluginDir, 'marketplace.json'),
      JSON.stringify(marketplace, null, 2),
      'utf8',
    );
  }

  if (platforms.includes('codex') || platforms.length === 0) {
    const codexPluginDir = path.join(root, '.codex-plugin');
    await fs.ensureDir(codexPluginDir);
    const index = buildCodexPluginIndex(registryRaw, plugins);
    await fs.writeFile(
      path.join(codexPluginDir, 'plugin.json'),
      JSON.stringify(index, null, 2),
      'utf8',
    );
  }
}

module.exports = { writePlatformPluginAdapters };
