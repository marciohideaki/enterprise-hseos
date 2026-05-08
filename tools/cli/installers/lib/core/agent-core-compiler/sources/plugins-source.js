'use strict';

const path = require('node:path');
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

module.exports = { writePluginRegistry };
