'use strict';

const path = require('node:path');
const nodeFs = require('node:fs');
const fs = require('fs-extra');
const yaml = require('yaml');
const { canonicalize } = require('../../../packages/managed-governance-contracts/canonical-json');
const { readExecutionPluginBundle } = require('../../lib/execution-plugin-manifest');
const prompts = require('../lib/prompts');
const {
  loadActivePluginManifests,
  validatePluginRegistryDocument,
  verifyActivePluginConformance,
} = require('../installers/lib/core/agent-core-compiler/sources/plugins-source');

const SUPPORTED_ACTIONS = new Set(['list', 'install', 'remove', 'doctor']);
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function assertPluginId(pluginId) {
  if (!pluginId || !PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error(`Invalid plugin id: ${pluginId || '(missing)'}`);
  }
}

async function readRegistry(projectDir) {
  const registryPath = path.join(projectDir, '.agents', 'plugins', 'registry.yaml');
  if (!(await fs.pathExists(registryPath))) return null;
  const raw = await fs.readFile(registryPath, 'utf8');
  const registry = yaml.parse(raw) || null;
  const strict = validatePluginRegistryDocument(registry);
  Object.defineProperty(registry.plugins, 'schemaVersion', {
    value: strict ? String(registry.schema_version) : 'legacy',
    enumerable: false,
  });
  return registry;
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

/** Copy verified data into a content-addressed local store without loading plugin code. */
function installExecutionPlugin(projectDir, registry, entry) {
  const projectRoot = path.resolve(projectDir);
  if (nodeFs.realpathSync(projectRoot) !== projectRoot) throw new Error('Plugin project root must not be a symlink');
  const ordered = [];
  const resolved = new Set();
  const active = new Set();
  const resolve = (candidate) => {
    if (resolved.has(candidate.id)) return;
    if (active.has(candidate.id)) throw new Error('Execution plugin dependency cycle');
    if (candidate.status !== 'active' || candidate.type !== 'execution') throw new Error(`Execution plugin is not active: ${candidate.id}`);
    active.add(candidate.id);
    const source = path.join(projectRoot, '.agents', 'plugins', 'definitions', candidate.id);
    const bundle = readExecutionPluginBundle(source);
    if (
      bundle.manifest.id !== candidate.id ||
      bundle.manifest.version !== candidate.version ||
      bundle.manifest_sha256 !== candidate.execution.manifest_sha256
    )
      throw new Error(`Execution plugin ${candidate.id} differs from its catalog pin`);
    for (const dependency of bundle.manifest.dependencies) {
      const declared = registry.plugins.find((item) => item.id === dependency.id);
      if (!declared || declared.version !== dependency.version || declared.execution?.manifest_sha256 !== dependency.manifest_sha256)
        throw new Error(`Execution plugin dependency is not pinned: ${dependency.id}`);
      resolve(declared);
    }
    active.delete(candidate.id);
    resolved.add(candidate.id);
    ordered.push(bundle);
  };
  resolve(entry);

  const store = path.join(projectRoot, '.hseos', 'plugins', 'store');
  let cursor = projectRoot;
  const ancestors = [];
  for (const part of ['.hseos', 'plugins', 'store']) {
    cursor = path.join(cursor, part);
    if (!nodeFs.existsSync(cursor)) nodeFs.mkdirSync(cursor, { mode: 0o700 });
    const observed = nodeFs.lstatSync(cursor);
    if (!observed.isDirectory() || observed.uid !== process.getuid() || (observed.mode & 0o022) !== 0)
      throw new Error('Plugin store path is unsafe');
    ancestors.push({ path: cursor, dev: observed.dev, ino: observed.ino });
  }
  const identity = nodeFs.statSync(store);
  const storeFd = nodeFs.openSync(store, nodeFs.constants.O_RDONLY | nodeFs.constants.O_DIRECTORY | nodeFs.constants.O_NOFOLLOW);
  try {
    const opened = nodeFs.fstatSync(storeFd);
    if (identity.dev !== opened.dev || identity.ino !== opened.ino) throw new Error('Plugin store changed during installation');
    for (const ancestor of ancestors) {
      const current = nodeFs.lstatSync(ancestor.path);
      if (!current.isDirectory() || current.dev !== ancestor.dev || current.ino !== ancestor.ino)
        throw new Error('Plugin store changed during installation');
    }
    const anchoredStore = `/proc/self/fd/${storeFd}`;
    for (const bundle of ordered) {
      const destination = path.join(anchoredStore, bundle.manifest_sha256);
      const verifyInstalled = () => {
        const current = readExecutionPluginBundle(nodeFs.realpathSync(destination));
        if (current.manifest_sha256 !== bundle.manifest_sha256) throw new Error('Installed execution plugin identity drift');
      };
      if (nodeFs.existsSync(destination)) verifyInstalled();
      else {
        const staging = nodeFs.mkdtempSync(path.join(anchoredStore, '.staging-'));
        try {
          nodeFs.writeFileSync(path.join(staging, 'execution.json'), canonicalize(bundle.manifest), { flag: 'wx', mode: 0o400 });
          for (const [name, bytes] of bundle.files) {
            const filename = path.join(staging, name);
            nodeFs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
            nodeFs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o400 });
          }
          const staged = readExecutionPluginBundle(nodeFs.realpathSync(staging));
          if (staged.manifest_sha256 !== bundle.manifest_sha256) throw new Error('Staged execution plugin identity drift');
          nodeFs.renameSync(staging, destination);
        } catch (error) {
          if (!nodeFs.existsSync(destination)) throw error;
          verifyInstalled();
        } finally {
          nodeFs.rmSync(staging, { recursive: true, force: true });
        }
        verifyInstalled();
      }
    }
    const final = nodeFs.lstatSync(store);
    if (!final.isDirectory() || final.dev !== identity.dev || final.ino !== identity.ino)
      throw new Error('Plugin store changed during installation');
  } finally {
    nodeFs.closeSync(storeFd);
  }
  return path.join(store, ordered.at(-1).manifest_sha256);
}

async function runInstall(projectDir, pluginId) {
  if (!pluginId) {
    throw new Error('hseos plugin install requires a plugin id. Usage: hseos plugin install <id>');
  }
  assertPluginId(pluginId);
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
  if (entry.type === 'execution') {
    const installed = installExecutionPlugin(projectDir, registry, entry);
    await prompts.log.success(`Installed execution plugin: ${pluginId}@${entry.version} (${path.basename(installed)})`);
    return;
  }
  const selectedEntries = [entry];
  Object.defineProperty(selectedEntries, 'schemaVersion', {
    value: ['2.0', '3.0'].includes(String(registry.schema_version)) ? String(registry.schema_version) : 'legacy',
    enumerable: false,
  });
  const [validatedManifest] = await loadActivePluginManifests(projectDir, selectedEntries);
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
  assertPluginId(pluginId);
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

  let passed = activeManifests.length;
  let failed = 0;
  let skipped = 0;
  for (const entry of registry.plugins) {
    if (entry.type === 'execution') {
      if (entry.status !== 'active') {
        await prompts.log.warn(`○ ${entry.id}@${entry.version} — ${entry.status}; behavior checks skipped`);
        skipped++;
        continue;
      }
      const installed = path.join(projectDir, '.hseos', 'plugins', 'store', entry.execution.manifest_sha256);
      try {
        const bundle = readExecutionPluginBundle(installed);
        if (
          bundle.manifest_sha256 !== entry.execution.manifest_sha256 ||
          bundle.manifest.id !== entry.id ||
          bundle.manifest.version !== entry.version
        )
          throw new Error('installed identity mismatch');
        await prompts.log.success(`✓ ${entry.id}@${entry.version} — installed bytes verified`);
        passed++;
      } catch (error) {
        await prompts.log.error(`✗ ${entry.id} — ${error.code || error.message}`);
        failed++;
      }
      continue;
    }
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
  description: 'Manage HSEOS plugins (list, install, remove, doctor)',
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
