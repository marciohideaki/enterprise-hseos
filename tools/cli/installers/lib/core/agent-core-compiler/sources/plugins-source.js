'use strict';

const path = require('node:path');
const childProcess = require('node:child_process');
const fs = require('fs-extra');
const yaml = require('yaml');

async function writePluginRegistry(root, agentsDirName = '.agents') {
  const registryPath = path.join(root, agentsDirName, 'plugins', 'registry.yaml');
  if (!(await fs.pathExists(registryPath))) {
    return [];
  }
  const raw = await fs.readFile(registryPath, 'utf8');
  const registry = yaml.parse(raw) || {};
  return Array.isArray(registry.plugins) ? registry.plugins : [];
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
  const resolved = path.resolve(pluginDir, relativePath);
  const boundary = `${path.resolve(pluginDir)}${path.sep}`;
  if (!resolved.startsWith(boundary)) {
    throw new Error(`${label} escapes the plugin definition: ${relativePath}`);
  }
  return resolved;
}

async function loadActivePluginManifests(root, registryPlugins, agentsDirName = '.agents') {
  const activeEntries = registryPlugins.filter((plugin) => plugin && plugin.status === 'active');
  const manifests = [];

  for (const entry of activeEntries) {
    if (!entry.id || !entry.version) {
      throw new Error('Active plugin registry entries require id and version');
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) {
      throw new Error(`Active plugin has unsafe id: ${entry.id}`);
    }

    const pluginDir = path.join(root, agentsDirName, 'plugins', 'definitions', entry.id);
    const manifestPath = path.join(pluginDir, 'plugin.yaml');
    const readmePath = path.join(pluginDir, 'README.md');
    if (!(await fs.pathExists(manifestPath))) {
      throw new Error(`Active plugin ${entry.id} is missing definition: ${manifestPath}`);
    }
    if (!(await fs.pathExists(readmePath))) {
      throw new Error(`Active plugin ${entry.id} is missing README.md`);
    }

    let manifest;
    try {
      manifest = yaml.parse(await fs.readFile(manifestPath, 'utf8')) || {};
    } catch (error) {
      throw new Error(`Active plugin ${entry.id} has invalid plugin.yaml: ${error.message}`);
    }

    const missingKeys = ['id', 'version', 'description', 'license'].filter((key) => !manifest[key]);
    if (missingKeys.length > 0) {
      throw new Error(`Active plugin ${entry.id} is missing manifest keys: ${missingKeys.join(', ')}`);
    }
    if (manifest.id !== entry.id || String(manifest.version) !== String(entry.version)) {
      throw new Error(`Active plugin ${entry.id} registry and manifest identity/version differ`);
    }
    if (String(manifest.extends || '') !== String(entry.extends || '')) {
      throw new Error(`Active plugin ${entry.id} registry and manifest extends values differ`);
    }

    const surfaces = manifest.surfaces && typeof manifest.surfaces === 'object' ? manifest.surfaces : {};
    const surfaceFiles = Object.values(surfaces).flatMap((value) => (Array.isArray(value) ? value : []));
    if (surfaceFiles.length === 0) {
      throw new Error(`Active plugin ${entry.id} must declare at least one surface`);
    }
    for (const surfaceFile of surfaceFiles) {
      if (typeof surfaceFile !== 'string' || surfaceFile.length === 0) {
        throw new Error(`Active plugin ${entry.id} has an invalid surface path`);
      }
      const resolved = resolveInsidePlugin(pluginDir, surfaceFile, `Active plugin ${entry.id} surface`);
      if (!(await fs.pathExists(resolved))) {
        throw new Error(`Active plugin ${entry.id} surface does not exist: ${surfaceFile}`);
      }
    }

    const testsRef = manifest.verification && manifest.verification.conformance_tests;
    if (typeof testsRef !== 'string' || testsRef.length === 0) {
      throw new Error(`Active plugin ${entry.id} must declare verification.conformance_tests`);
    }
    const testsDir = resolveInsidePlugin(pluginDir, testsRef, `Active plugin ${entry.id} tests`);
    if (!(await fs.pathExists(testsDir)) || !(await fs.stat(testsDir)).isDirectory() || (await listBehaviorTests(testsDir)).length === 0) {
      throw new Error(`Active plugin ${entry.id} must provide non-empty behavior tests at ${testsRef}`);
    }

    manifests.push({ ...manifest, status: 'active' });
  }

  return manifests;
}

async function verifyActivePluginConformance(root, manifests, agentsDirName = '.agents') {
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

module.exports = { writePluginRegistry, loadActivePluginManifests, listBehaviorTests, verifyActivePluginConformance };
