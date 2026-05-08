'use strict';

const path = require('node:path');
const fs = require('fs-extra');

const BYOA_PACKAGE_PREFIX = '@hseos/adapter-';

async function discoverByoaAdapters(projectRoot) {
  const scopeDir = path.join(projectRoot, 'node_modules', '@hseos');
  const discovered = [];

  if (!(await fs.pathExists(scopeDir))) {
    return discovered;
  }

  let entries;
  try {
    entries = await fs.readdir(scopeDir);
  } catch {
    return discovered;
  }

  for (const entry of entries) {
    if (!entry.startsWith('adapter-')) continue;
    const packageName = `@hseos/${entry}`;
    const packageDir = path.join(scopeDir, entry);
    const packageJsonPath = path.join(packageDir, 'package.json');

    if (!(await fs.pathExists(packageJsonPath))) continue;

    let mainFile;
    try {
      const pkgJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      mainFile = path.join(packageDir, pkgJson.main || 'index.js');
    } catch {
      continue;
    }

    if (!(await fs.pathExists(mainFile))) continue;

    let AdapterClass;
    try {
      AdapterClass = require(mainFile);
      if (AdapterClass && AdapterClass.default) AdapterClass = AdapterClass.default;
    } catch {
      continue;
    }

    if (!AdapterClass || typeof AdapterClass.id !== 'string') continue;

    const id = entry.replace('adapter-', '');
    discovered.push({ id, packageName, adapterClass: AdapterClass });
  }

  return discovered;
}

async function buildAdapterRegistry(projectRoot, builtinAdapters = []) {
  const registry = new Map();

  for (const AdapterClass of builtinAdapters) {
    if (AdapterClass && typeof AdapterClass.id === 'string') {
      registry.set(AdapterClass.id, AdapterClass);
    }
  }

  const byoa = await discoverByoaAdapters(projectRoot);
  for (const { id, adapterClass } of byoa) {
    registry.set(id, adapterClass);
  }

  return registry;
}

module.exports = { discoverByoaAdapters, buildAdapterRegistry, BYOA_PACKAGE_PREFIX };
