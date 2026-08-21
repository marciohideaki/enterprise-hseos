'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const prompts = require('../lib/prompts');
const {
  loadActivePluginManifests,
  verifyActivePluginConformance,
} = require('../installers/lib/core/agent-core-compiler/sources/plugins-source');

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
  if (entry.status !== 'active') {
    throw new Error(`Plugin is not installable: ${pluginId} has status ${entry.status || 'unspecified'}`);
  }
  const [validatedManifest] = await loadActivePluginManifests(projectDir, [entry]);
  const manifest = validatedManifest;
  await verifyActivePluginConformance(projectDir, [manifest]);

  const pluginSourceDir = path.join(projectDir, '.agents', 'plugins', 'definitions', pluginId);
  const surfaceFiles = Object.values(manifest.surfaces).flatMap((value) => (Array.isArray(value) ? value : []));

  async function prepare(vendorRoot) {
    const pluginsDir = path.join(projectDir, vendorRoot, 'plugins');
    const installedDir = path.join(pluginsDir, pluginId);
    await fs.ensureDir(pluginsDir);
    const stagingDir = await fs.mkdtemp(path.join(pluginsDir, `.${pluginId}-`));
    const artifact = {
      installedDir,
      stagingDir,
      backupDir: `${stagingDir}.previous`,
      previousMoved: false,
      committed: false,
    };
    try {
      await fs.writeFile(path.join(stagingDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
      await fs.copy(path.join(pluginSourceDir, 'README.md'), path.join(stagingDir, 'README.md'));
      for (const surfaceFile of surfaceFiles) {
        await fs.copy(path.join(pluginSourceDir, surfaceFile), path.join(stagingDir, surfaceFile));
      }
    } catch (error) {
      await fs.remove(stagingDir);
      throw error;
    }
    return artifact;
  }

  const artifacts = [];
  try {
    // Prepare both complete vendor trees before exposing either one.
    for (const vendorRoot of ['.claude-plugin', '.codex-plugin']) {
      artifacts.push(await prepare(vendorRoot));
    }

    // Swap both destinations while retaining their previous versions for rollback.
    for (const artifact of artifacts) {
      if (await fs.pathExists(artifact.installedDir)) {
        await fs.move(artifact.installedDir, artifact.backupDir);
        artifact.previousMoved = true;
      }
      await fs.move(artifact.stagingDir, artifact.installedDir);
      artifact.committed = true;
    }
  } catch (error) {
    let rollbackError;
    for (const artifact of artifacts.toReversed()) {
      try {
        if (artifact.committed && (await fs.pathExists(artifact.installedDir))) {
          await fs.remove(artifact.installedDir);
        }
        if (artifact.previousMoved && (await fs.pathExists(artifact.backupDir))) {
          await fs.move(artifact.backupDir, artifact.installedDir);
        }
        if (await fs.pathExists(artifact.stagingDir)) await fs.remove(artifact.stagingDir);
      } catch (error_) {
        rollbackError ||= error_;
      }
    }
    if (rollbackError) {
      throw new Error(`Plugin install failed (${error.message}) and rollback failed: ${rollbackError.message}`);
    }
    throw error;
  }

  // Both swaps are now committed. Backup cleanup is housekeeping: a cleanup
  // failure must never trigger a rollback after another backup was deleted.
  const cleanupFailures = [];
  for (const artifact of artifacts) {
    if (!artifact.previousMoved) continue;
    try {
      await fs.remove(artifact.backupDir);
    } catch (error) {
      cleanupFailures.push(`${artifact.backupDir}: ${error.message}`);
    }
  }
  if (cleanupFailures.length > 0) {
    await prompts.log.warn(`Plugin installed, but old backup cleanup requires attention: ${cleanupFailures.join('; ')}`);
  }

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

  let activeManifests;
  try {
    activeManifests = await loadActivePluginManifests(projectDir, registry.plugins);
    await verifyActivePluginConformance(projectDir, activeManifests);
  } catch (error) {
    await prompts.log.error(`✗ ${error.message}`);
    throw new Error(`plugin doctor: active plugin conformance failed: ${error.message}`);
  }

  const passed = activeManifests.length;
  let failed = 0;
  let skipped = 0;
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

    if (entry.status !== 'active') {
      await prompts.log.warn(`○ ${entry.id}@${manifest.version} — ${entry.status || 'inactive'}; behavior checks skipped`);
      skipped++;
      continue;
    }

    await prompts.log.success(`✓ ${entry.id}@${manifest.version} — conformance pass`);
  }

  if (failed > 0) {
    throw new Error(`plugin doctor: ${failed} plugin(s) failed conformance checks`);
  }
  await prompts.log.success(`plugin doctor: ${passed} active plugin(s) passed; ${skipped} inactive plugin(s) skipped.`);
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
