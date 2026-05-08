'use strict';

const path = require('node:path');
const fs = require('fs-extra');

function displayPath(root, sourceRoot, filePath) {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  const resolvedSourceRoot = path.resolve(sourceRoot);

  if (resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    return path.relative(resolvedRoot, resolved).replaceAll(path.sep, '/');
  }
  if (resolved.startsWith(`${resolvedSourceRoot}${path.sep}`)) {
    return path.relative(resolvedSourceRoot, resolved).replaceAll(path.sep, '/');
  }
  return resolved.replaceAll(path.sep, '/');
}

async function resolveHooksPath(root, sourceRoot) {
  const targetHooksPath = path.join(root, '.claude', 'hooks.json');
  if (await fs.pathExists(targetHooksPath)) return targetHooksPath;

  const sourceHooksPath = path.join(sourceRoot, '.claude', 'hooks.json');
  if (await fs.pathExists(sourceHooksPath)) return sourceHooksPath;

  return null;
}

module.exports = { displayPath, resolveHooksPath };
