'use strict';

const path = require('node:path');
const childProcess = require('node:child_process');
const fs = require('fs-extra');
const yaml = require('yaml');

const CANONICAL_PLUGINS_DIR = path.join('.enterprise', 'governance', 'plugins');
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SEMVER_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*)|[0-9]*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:(?:0|[1-9][0-9]*)|[0-9]*[a-zA-Z-][a-zA-Z0-9-]*))*)?(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/;
const EXTENDS_PATTERN = /^(?:(?:official|community):[a-z][a-z0-9-]*@[0-9]+\.[0-9]+\.[0-9]+)?$/;
const PLUGIN_STATUSES = new Set(['active', 'scaffolded', 'disabled']);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, keys, label) {
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

function validatePluginRegistryDocument(registry) {
  assertPlainObject(registry, 'Plugin registry');
  const schemaVersion = registry.schema_version === undefined ? 'legacy' : String(registry.schema_version);
  if (!['legacy', '1.0', '2.0', '3.0'].includes(schemaVersion)) {
    throw new Error(`Unsupported plugin registry schema_version: ${schemaVersion}`);
  }
  const strict = ['2.0', '3.0'].includes(schemaVersion);
  if (strict) {
    assertExactKeys(
      registry,
      new Set(['version', 'schema_version', 'source_of_truth', 'marketplace', 'conformance', 'resolution', 'plugins', 'emit_targets']),
      'Plugin registry',
    );
    if (String(registry.version) !== schemaVersion) {
      throw new Error('Plugin registry version must match schema_version');
    }
    if (registry.source_of_truth !== CANONICAL_PLUGINS_DIR.replaceAll(path.sep, '/')) {
      throw new Error(`Plugin registry source_of_truth must be ${CANONICAL_PLUGINS_DIR.replaceAll(path.sep, '/')}`);
    }
    assertPlainObject(registry.marketplace, 'Plugin registry marketplace');
    assertExactKeys(
      registry.marketplace,
      new Set(['id', 'name', 'description', 'homepage', 'license', 'authors']),
      'Plugin registry marketplace',
    );
    if (
      !['id', 'name', 'description', 'homepage', 'license'].every(
        (key) => typeof registry.marketplace[key] === 'string' && registry.marketplace[key].length > 0,
      ) ||
      !Array.isArray(registry.marketplace.authors) ||
      registry.marketplace.authors.some((author) => typeof author !== 'string' || author.length === 0)
    ) {
      throw new TypeError('Plugin registry marketplace metadata is incomplete');
    }
    assertPlainObject(registry.conformance, 'Plugin registry conformance');
    assertExactKeys(
      registry.conformance,
      new Set(['required_files', 'required_manifest_keys', 'reserved_id_prefix']),
      'Plugin registry conformance',
    );
    if (
      !Array.isArray(registry.conformance.required_files) ||
      registry.conformance.required_files.length === 0 ||
      new Set(registry.conformance.required_files).size !== registry.conformance.required_files.length ||
      registry.conformance.required_files.some((file) => typeof file !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file)) ||
      !['plugin.yaml', 'README.md'].every((file) => registry.conformance.required_files.includes(file)) ||
      !Array.isArray(registry.conformance.required_manifest_keys) ||
      registry.conformance.required_manifest_keys.length === 0 ||
      new Set(registry.conformance.required_manifest_keys).size !== registry.conformance.required_manifest_keys.length ||
      registry.conformance.required_manifest_keys.some((key) => typeof key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(key)) ||
      !['id', 'version', 'description', 'license'].every((key) => registry.conformance.required_manifest_keys.includes(key)) ||
      typeof registry.conformance.reserved_id_prefix !== 'string' ||
      !/^[a-z][a-z0-9-]*-$/.test(registry.conformance.reserved_id_prefix)
    ) {
      throw new TypeError('Plugin registry conformance policy is invalid');
    }
    assertPlainObject(registry.resolution, 'Plugin registry resolution');
    assertExactKeys(registry.resolution, new Set(['duplicate_id_strategy', 'extends_strategy']), 'Plugin registry resolution');
    if (registry.resolution.duplicate_id_strategy !== 'error' || registry.resolution.extends_strategy !== 'metadata_only') {
      throw new Error('Plugin registry resolution policy is unsupported');
    }
    assertPlainObject(registry.emit_targets, 'Plugin registry emit_targets');
    assertExactKeys(registry.emit_targets, new Set(['claude-code', 'codex']), 'Plugin registry emit_targets');
    const requiredEmitTargets = new Map([
      ['claude-code', '.claude-plugin/marketplace.json'],
      ['codex', '.codex-plugin/plugin.json'],
    ]);
    for (const [adapter, target] of Object.entries(registry.emit_targets)) {
      if (
        typeof target !== 'string' ||
        target !== requiredEmitTargets.get(adapter) ||
        path.isAbsolute(target) ||
        path.win32.isAbsolute(target) ||
        path.normalize(target).startsWith(`..${path.sep}`) ||
        path.win32.normalize(target).startsWith('..\\')
      ) {
        throw new Error(`Plugin registry emit target for ${adapter} is unsafe`);
      }
    }
  }
  if (!Array.isArray(registry.plugins)) throw new Error('Plugin registry plugins must be an array');

  const ids = new Set();
  for (const [index, entry] of registry.plugins.entries()) {
    const label = `Plugin registry entry ${index}`;
    assertPlainObject(entry, label);
    if (strict) {
      assertExactKeys(
        entry,
        new Set([
          'id',
          'version',
          'status',
          'description',
          'extends',
          'requires_bundles',
          ...(schemaVersion === '3.0' ? ['type', 'execution'] : []),
        ]),
        label,
      );
    }
    if (schemaVersion === '3.0') {
      if (!['compilation', 'execution'].includes(entry.type)) throw new Error(`${label} requires an explicit plugin type`);
      if (entry.type === 'execution') {
        assertPlainObject(entry.execution, `${label} execution`);
        assertExactKeys(entry.execution, new Set(['manifest_sha256']), `${label} execution`);
        if (!/^[a-f0-9]{64}$/.test(entry.execution.manifest_sha256 || '') || entry.extends)
          throw new Error(`${label} requires a pinned execution descriptor without compilation inheritance`);
      } else if (entry.execution !== undefined) throw new Error(`${label} compilation cannot declare execution`);
    } else if (entry.type === 'execution' || entry.execution !== undefined) {
      throw new Error(`${label} execution requires registry schema_version 3.0`);
    }
    if (typeof entry.id !== 'string' || !PLUGIN_ID_PATTERN.test(entry.id)) throw new Error(`${label} has unsafe id`);
    if (ids.has(entry.id)) throw new Error(`Plugin registry has duplicate id: ${entry.id}`);
    ids.add(entry.id);
    if (typeof entry.version !== 'string' || !SEMVER_PATTERN.test(entry.version)) {
      throw new Error(`Plugin registry entry ${entry.id} has invalid semver`);
    }
    if (!PLUGIN_STATUSES.has(entry.status)) throw new Error(`Plugin registry entry ${entry.id} has invalid status`);
    if (strict && (typeof entry.description !== 'string' || entry.description.length < 10)) {
      throw new Error(`Plugin registry entry ${entry.id} requires a description`);
    }
    if (entry.extends !== undefined && (typeof entry.extends !== 'string' || !EXTENDS_PATTERN.test(entry.extends))) {
      throw new Error(`Plugin registry entry ${entry.id} has invalid extends reference`);
    }
    if (
      entry.requires_bundles !== undefined &&
      (!Array.isArray(entry.requires_bundles) ||
        new Set(entry.requires_bundles).size !== entry.requires_bundles.length ||
        entry.requires_bundles.some((bundle) => !['core', 'extended', 'enterprise'].includes(bundle)))
    ) {
      throw new Error(`Plugin registry entry ${entry.id} has invalid requires_bundles`);
    }
  }
  return strict;
}

async function syncPluginCatalog(root, sourceRoot, agentsDirName = '.agents') {
  const target = path.join(root, agentsDirName, 'plugins');
  const targetCanonical = path.join(root, CANONICAL_PLUGINS_DIR);
  const sourceCanonical = path.join(sourceRoot, CANONICAL_PLUGINS_DIR);

  let source;
  let mode;
  if (await fs.pathExists(targetCanonical)) {
    source = targetCanonical;
    mode = 'canonical-target';
  } else if (await fs.pathExists(target)) {
    // Bounded compatibility for projects authored before the canonical-source
    // migration. G9 owns retirement after internal callers reach zero.
    return { mode: 'legacy-generated-source', source: target, target };
  } else if (await fs.pathExists(sourceCanonical)) {
    source = sourceCanonical;
    mode = 'canonical-source-root';
  } else {
    const legacySource = path.join(sourceRoot, agentsDirName, 'plugins');
    if (!(await fs.pathExists(legacySource))) return { mode: 'absent', source: null, target };
    source = legacySource;
    mode = 'legacy-source-root';
  }

  const parent = path.dirname(target);
  await fs.ensureDir(parent);
  const transactionDir = await fs.mkdtemp(path.join(parent, '.plugins-sync-'));
  const validationRoot = path.join(transactionDir, 'validation-root');
  const staged = path.join(validationRoot, agentsDirName, 'plugins');
  const previous = path.join(transactionDir, 'previous');
  let previousMoved = false;

  try {
    await fs.copy(source, staged, { overwrite: true, errorOnExist: false });
    const stagedRegistry = await writePluginRegistry(validationRoot, agentsDirName);
    if (mode.startsWith('canonical-') && !['2.0', '3.0'].includes(stagedRegistry.schemaVersion)) {
      throw new Error('Canonical plugin catalog requires schema_version 2.0 or 3.0');
    }
    const stagedManifests = await loadActivePluginManifests(validationRoot, stagedRegistry, agentsDirName);
    await verifyActivePluginConformance(validationRoot, stagedManifests, agentsDirName);
    if (await fs.pathExists(target)) {
      await fs.move(target, previous);
      previousMoved = true;
    }
    await fs.move(staged, target);
    if (previousMoved) await fs.remove(previous);
  } catch (error) {
    if (previousMoved && (await fs.pathExists(target))) await fs.remove(target);
    if (previousMoved && (await fs.pathExists(previous))) await fs.move(previous, target);
    throw new Error(`Plugin catalog synchronization failed: ${error.message}`);
  } finally {
    await fs.remove(transactionDir);
  }

  return { mode, source, target };
}

async function writePluginRegistry(root, agentsDirName = '.agents') {
  const registryPath = path.join(root, agentsDirName, 'plugins', 'registry.yaml');
  if (!(await fs.pathExists(registryPath))) {
    return [];
  }
  const raw = await fs.readFile(registryPath, 'utf8');
  const registry = yaml.parse(raw) || {};
  const strict = validatePluginRegistryDocument(registry);
  const plugins = registry.plugins;
  Object.defineProperty(plugins, 'schemaVersion', { value: strict ? String(registry.schema_version) : 'legacy', enumerable: false });
  return plugins;
}

async function listBehaviorTests(directory) {
  const tests = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && /\.test\.(?:c?js|mjs)$/.test(entry.name)) tests.push(entryPath);
    if (entry.isDirectory()) tests.push(...(await listBehaviorTests(entryPath)));
  }
  return tests.sort();
}

function resolveInsidePlugin(pluginDir, relativePath, label) {
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative: ${relativePath}`);
  }
  if (path.win32.normalize(relativePath) === '..' || path.win32.normalize(relativePath).startsWith('..\\')) {
    throw new Error(`${label} escapes the plugin definition: ${relativePath}`);
  }
  const resolved = path.resolve(pluginDir, relativePath);
  const boundary = `${path.resolve(pluginDir)}${path.sep}`;
  if (!resolved.startsWith(boundary)) {
    throw new Error(`${label} escapes the plugin definition: ${relativePath}`);
  }
  return resolved;
}

async function assertRealPathInsidePlugin(pluginDir, resolved, label) {
  const [realPluginDir, realResolved] = await Promise.all([fs.realpath(pluginDir), fs.realpath(resolved)]);
  const boundary = `${realPluginDir}${path.sep}`;
  if (!realResolved.startsWith(boundary)) throw new Error(`${label} resolves outside the plugin definition`);
}

async function loadActivePluginManifests(root, registryPlugins, agentsDirName = '.agents') {
  const strict = ['2.0', '3.0'].includes(registryPlugins.schemaVersion);
  const entries = strict ? registryPlugins : registryPlugins.filter((plugin) => plugin && plugin.status === 'active');
  const manifests = [];

  for (const entry of entries) {
    const active = entry.status === 'active';
    if (!entry.id || !entry.version) {
      throw new Error('Plugin registry entries require id and version');
    }
    if (!PLUGIN_ID_PATTERN.test(entry.id)) {
      throw new Error(`Plugin has unsafe id: ${entry.id}`);
    }

    const pluginDir = path.join(root, agentsDirName, 'plugins', 'definitions', entry.id);
    if (entry.type === 'execution' || entry.execution !== undefined) {
      if (registryPlugins.schemaVersion !== '3.0' || entry.type !== 'execution')
        throw new Error('Execution plugins require registry schema_version 3.0');
      if (!active) continue;
      const { inspectExecutionPlugin } = require('../../../../../../lib/execution-plugin-manifest');
      const inspected = inspectExecutionPlugin(pluginDir);
      if (
        inspected.manifest.id !== entry.id ||
        inspected.manifest.version !== entry.version ||
        inspected.manifest_sha256 !== entry.execution?.manifest_sha256
      )
        throw new Error(`Execution plugin ${entry.id} differs from its catalog pin`);
      // Compilation adapters never emit or run execution-plugin code. The local
      // execution installer uses this verified catalog entry through its own port.
      continue;
    }
    const manifestPath = path.join(pluginDir, 'plugin.yaml');
    const readmePath = path.join(pluginDir, 'README.md');
    if (!(await fs.pathExists(manifestPath))) {
      throw new Error(`Plugin ${entry.id} is missing definition: ${manifestPath}`);
    }
    if (!(await fs.pathExists(readmePath))) {
      throw new Error(`Plugin ${entry.id} is missing README.md`);
    }
    await assertRealPathInsidePlugin(pluginDir, readmePath, `Plugin ${entry.id} README.md`);

    let manifest;
    try {
      manifest = yaml.parse(await fs.readFile(manifestPath, 'utf8')) || {};
    } catch (error) {
      throw new Error(`Plugin ${entry.id} has invalid plugin.yaml: ${error.message}`);
    }

    const missingKeys = ['id', 'version', 'description', 'license'].filter((key) => !manifest[key]);
    if (missingKeys.length > 0) {
      throw new Error(`Plugin ${entry.id} is missing manifest keys: ${missingKeys.join(', ')}`);
    }
    if (manifest.id !== entry.id || String(manifest.version) !== String(entry.version)) {
      throw new Error(`Plugin ${entry.id} registry and manifest identity/version differ`);
    }
    if (String(manifest.extends || '') !== String(entry.extends || '')) {
      throw new Error(`Plugin ${entry.id} registry and manifest extends values differ`);
    }
    if (strict) {
      assertExactKeys(
        manifest,
        new Set(['id', 'version', 'description', 'license', 'authors', 'extends', 'requires_bundles', 'surfaces', 'verification']),
        `Plugin manifest ${entry.id}`,
      );
      if (!SEMVER_PATTERN.test(String(manifest.version)) || typeof manifest.description !== 'string' || manifest.description.length < 10) {
        throw new Error(`Plugin manifest ${entry.id} has invalid version or description`);
      }
      if (typeof manifest.license !== 'string' || manifest.license.length === 0) {
        throw new Error(`Plugin manifest ${entry.id} has invalid license`);
      }
      if (
        manifest.authors !== undefined &&
        (!Array.isArray(manifest.authors) || manifest.authors.some((author) => typeof author !== 'string' || author.length === 0))
      ) {
        throw new Error(`Plugin manifest ${entry.id} has invalid authors`);
      }
      if (manifest.extends !== undefined && (typeof manifest.extends !== 'string' || !EXTENDS_PATTERN.test(manifest.extends))) {
        throw new Error(`Plugin manifest ${entry.id} has invalid extends reference`);
      }
      if (
        !Array.isArray(manifest.requires_bundles) ||
        new Set(manifest.requires_bundles).size !== manifest.requires_bundles.length ||
        manifest.requires_bundles.some((bundle) => !['core', 'extended', 'enterprise'].includes(bundle)) ||
        JSON.stringify([...manifest.requires_bundles].sort()) !== JSON.stringify([...(entry.requires_bundles || [])].sort())
      ) {
        throw new Error(`Plugin manifest ${entry.id} requires_bundles differs from registry or is invalid`);
      }
      assertPlainObject(manifest.verification, `Plugin manifest ${entry.id} verification`);
      assertExactKeys(manifest.verification, new Set(['conformance_tests']), `Plugin manifest ${entry.id} verification`);
      if (
        manifest.verification.conformance_tests !== undefined &&
        (typeof manifest.verification.conformance_tests !== 'string' || manifest.verification.conformance_tests.length === 0)
      ) {
        throw new Error(`Plugin manifest ${entry.id} has invalid verification.conformance_tests`);
      }
    }

    const surfaces = manifest.surfaces && typeof manifest.surfaces === 'object' ? manifest.surfaces : {};
    if (strict) {
      assertExactKeys(surfaces, new Set(['skills', 'hooks', 'commands', 'agents', 'mcp']), `Plugin manifest ${entry.id} surfaces`);
      for (const [surfaceType, surfacePaths] of Object.entries(surfaces)) {
        if (!Array.isArray(surfacePaths) || new Set(surfacePaths).size !== surfacePaths.length) {
          throw new Error(`Plugin manifest ${entry.id} surface ${surfaceType} must be a duplicate-free array`);
        }
      }
    }
    const surfaceFiles = Object.values(surfaces).flatMap((value) => (Array.isArray(value) ? value : []));
    if (surfaceFiles.length === 0) {
      throw new Error(`Plugin ${entry.id} must declare at least one surface`);
    }
    for (const surfaceFile of surfaceFiles) {
      if (typeof surfaceFile !== 'string' || surfaceFile.length === 0) {
        throw new Error(`Plugin ${entry.id} has an invalid surface path`);
      }
      const resolved = resolveInsidePlugin(pluginDir, surfaceFile, `Plugin ${entry.id} surface`);
      if (!(await fs.pathExists(resolved))) {
        throw new Error(`Plugin ${entry.id} surface does not exist: ${surfaceFile}`);
      }
      await assertRealPathInsidePlugin(pluginDir, resolved, `Plugin ${entry.id} surface ${surfaceFile}`);
    }

    const testsRef = manifest.verification && manifest.verification.conformance_tests;
    if (active && (typeof testsRef !== 'string' || testsRef.length === 0)) {
      throw new Error(`Active plugin ${entry.id} must declare verification.conformance_tests`);
    }
    if (active) {
      const testsDir = resolveInsidePlugin(pluginDir, testsRef, `Active plugin ${entry.id} tests`);
      if (!(await fs.pathExists(testsDir)) || !(await fs.stat(testsDir)).isDirectory()) {
        throw new Error(`Active plugin ${entry.id} must provide a behavior tests directory at ${testsRef}`);
      }
      await assertRealPathInsidePlugin(pluginDir, testsDir, `Active plugin ${entry.id} tests`);
      if ((await listBehaviorTests(testsDir)).length === 0) {
        throw new Error(`Active plugin ${entry.id} must provide non-empty behavior tests at ${testsRef}`);
      }
      manifests.push({ ...manifest, status: 'active' });
    }
  }

  return manifests;
}

async function verifyActivePluginConformance(root, manifests, agentsDirName = '.agents') {
  if (manifests.some((manifest) => manifest.type === 'execution' || manifest.execution !== undefined))
    throw new Error('Execution plugin conformance requires the isolated execution port');
  for (const manifest of manifests) {
    const pluginDir = path.join(root, agentsDirName, 'plugins', 'definitions', manifest.id);
    const testsDir = resolveInsidePlugin(pluginDir, manifest.verification.conformance_tests, `Active plugin ${manifest.id} tests`);
    const behaviorTests = await listBehaviorTests(testsDir);
    childProcess.execFileSync(process.execPath, ['--test', ...behaviorTests], {
      cwd: pluginDir,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    });
  }
}

module.exports = {
  CANONICAL_PLUGINS_DIR,
  validatePluginRegistryDocument,
  writePluginRegistry,
  loadActivePluginManifests,
  listBehaviorTests,
  syncPluginCatalog,
  verifyActivePluginConformance,
};
