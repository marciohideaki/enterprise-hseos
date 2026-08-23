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

async function lstatIfExists(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertSymlinkFreeTree(directory, label) {
  const rootStat = await lstatIfExists(directory);
  if (!rootStat) return false;
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`${label} must be a real directory`);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`${label} contains a symlink: ${entry.name}`);
    if (entry.isDirectory()) await assertSymlinkFreeTree(entryPath, label);
  }
  return true;
}

async function writePluginTree(root, stagedVendorRoot, manifest, agentsDirName) {
  const sourceDir = path.join(root, agentsDirName, 'plugins', 'definitions', manifest.id);
  const installedDir = path.join(stagedVendorRoot, 'plugins', manifest.id);
  await fs.remove(installedDir);
  await fs.ensureDir(installedDir);
  await fs.writeJson(path.join(installedDir, 'plugin.json'), manifest, { spaces: 2 });
  await fs.copy(path.join(sourceDir, 'README.md'), path.join(installedDir, 'README.md'), { dereference: true });
  const surfaceFiles = Object.values(manifest.surfaces || {}).flatMap((value) => (Array.isArray(value) ? value : []));
  for (const surfaceFile of surfaceFiles) {
    await fs.copy(path.join(sourceDir, surfaceFile), path.join(installedDir, surfaceFile), { dereference: true });
  }
}

async function stageVendorRoot(root, vendorRootName, emit, registryRaw, plugins, inactiveIds, agentsDirName) {
  const vendorRoot = path.join(root, vendorRootName);
  const vendorRootExists = await assertSymlinkFreeTree(vendorRoot, `${vendorRootName} plugin root`);
  if (!emit && !vendorRootExists) return null;

  const transactionDir = await fs.mkdtemp(path.join(root, `.${vendorRootName.slice(1)}-emit-`));
  const stagedRoot = path.join(transactionDir, 'next');
  try {
    if (vendorRootExists) await fs.copy(vendorRoot, stagedRoot);
    else await fs.ensureDir(stagedRoot);

    const activeIds = new Set(plugins.map((plugin) => plugin.id));
    const installedRoot = path.join(stagedRoot, 'plugins');
    if (await fs.pathExists(installedRoot)) {
      for (const entry of await fs.readdir(installedRoot, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (!entry.isDirectory()) throw new Error(`Installed plugin entry is not a directory: ${entry.name}`);
        if (!/^[a-z][a-z0-9-]*$/.test(entry.name)) throw new Error(`Installed plugin has unsafe id: ${entry.name}`);
        if (!activeIds.has(entry.name)) inactiveIds.add(entry.name);
      }
    }

    for (const pluginId of inactiveIds) {
      if (!/^[a-z][a-z0-9-]*$/.test(pluginId)) throw new Error(`Inactive plugin has unsafe id: ${pluginId}`);
      const installedDir = path.join(stagedRoot, 'plugins', pluginId);
      if (!(await fs.pathExists(installedDir))) continue;
      const disabledDir = path.join(stagedRoot, 'disabled', pluginId);
      await fs.remove(disabledDir);
      await fs.ensureDir(path.dirname(disabledDir));
      await fs.move(installedDir, disabledDir);
    }

    if (emit) {
      for (const manifest of plugins) {
        await fs.remove(path.join(stagedRoot, 'disabled', manifest.id));
        await writePluginTree(root, stagedRoot, manifest, agentsDirName);
      }
      if (vendorRootName === '.claude-plugin') {
        await fs.writeFile(
          path.join(stagedRoot, 'marketplace.json'),
          JSON.stringify(buildClaudePluginMarketplace(registryRaw, plugins), null, 2),
          'utf8',
        );
      } else {
        await fs.writeFile(
          path.join(stagedRoot, 'plugin.json'),
          JSON.stringify(buildCodexPluginIndex(registryRaw, plugins), null, 2),
          'utf8',
        );
      }
    }

    return {
      vendorRoot,
      transactionDir,
      stagedRoot,
      backupRoot: path.join(transactionDir, 'previous'),
      previousMoved: false,
      committed: false,
    };
  } catch (error) {
    await fs.remove(transactionDir);
    throw error;
  }
}

async function writePlatformPluginAdapters(root, registryPlugins, agentsDirName = '.agents', platforms = [], validatedManifests) {
  const registryPath = path.join(root, agentsDirName, 'plugins', 'registry.yaml');
  if (!(await fs.pathExists(registryPath))) return;

  const registryRaw = yaml.parse(await fs.readFile(registryPath, 'utf8')) || {};
  const plugins = validatedManifests || (await loadActivePluginManifests(root, registryPlugins, agentsDirName));
  const inactiveIds = new Set(
    registryPlugins.filter((plugin) => plugin && plugin.id && plugin.status !== 'active').map((plugin) => plugin.id),
  );
  const emitsClaude = platforms.includes('claude-code') || platforms.length === 0;
  const emitsCodex = platforms.includes('codex') || platforms.length === 0;
  const artifacts = [];

  try {
    for (const [vendorRootName, emit] of [
      ['.claude-plugin', emitsClaude],
      ['.codex-plugin', emitsCodex],
    ]) {
      const artifact = await stageVendorRoot(root, vendorRootName, emit, registryRaw, plugins, new Set(inactiveIds), agentsDirName);
      if (artifact) artifacts.push(artifact);
    }
    for (const artifact of artifacts) {
      if (await fs.pathExists(artifact.vendorRoot)) {
        await fs.move(artifact.vendorRoot, artifact.backupRoot);
        artifact.previousMoved = true;
      }
      await fs.move(artifact.stagedRoot, artifact.vendorRoot);
      artifact.committed = true;
    }
  } catch (error) {
    let rollbackError;
    for (const artifact of artifacts.toReversed()) {
      try {
        if (artifact.committed && (await fs.pathExists(artifact.vendorRoot))) await fs.remove(artifact.vendorRoot);
        if (artifact.previousMoved && (await fs.pathExists(artifact.backupRoot))) {
          await fs.move(artifact.backupRoot, artifact.vendorRoot);
        }
      } catch (error_) {
        rollbackError ||= error_;
      }
    }
    await Promise.allSettled(artifacts.map((artifact) => fs.remove(artifact.transactionDir)));
    if (rollbackError) throw new Error(`Plugin emission failed (${error.message}) and rollback failed: ${rollbackError.message}`);
    throw error;
  }

  await Promise.allSettled(artifacts.map((artifact) => fs.remove(artifact.transactionDir)));
}

module.exports = { writePlatformPluginAdapters };
