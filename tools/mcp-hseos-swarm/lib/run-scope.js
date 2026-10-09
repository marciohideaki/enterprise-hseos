'use strict';

const path = require('node:path');
const fs = require('node:fs');

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// The consuming project is the server's working directory (same convention as mcp-project-state).
function projectRoot() {
  return process.cwd();
}

function runsDir() {
  return path.join(projectRoot(), '.hseos', 'runs', 'dev-squad');
}

// Resolves symlinks of the deepest existing ancestor and re-appends the not-yet-created remainder.
function canonicalize(target) {
  let existing = path.resolve(target);
  const rest = [];
  while (!fs.existsSync(existing) && !isSymlink(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  // A dangling symlink has no realpath: treat it as escaping by resolving its link target.
  if (isSymlink(existing) && !fs.existsSync(existing)) {
    throw new Error(`Dangling symlink not allowed: ${path.basename(existing)}`);
  }
  return path.join(fs.realpathSync(existing), ...rest);
}

function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertIdentifier(value, field) {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new TypeError(`Invalid ${field}: must match ${RUN_ID_PATTERN}`);
  }
  return value;
}

// Fail-closed: strict identifier plus realpath containment inside the project's runs dir.
function resolveRunDir(runId, field = 'run_id') {
  assertIdentifier(runId, field);
  const root = runsDir();
  const runDir = path.join(root, runId);
  const canonicalRoot = canonicalize(root);
  const canonicalRun = canonicalize(runDir);
  if (!isInside(canonicalRoot, canonicalRun) || canonicalRun === canonicalRoot) {
    throw new Error(`Invalid ${field}: resolves outside the runs directory`);
  }
  return runDir;
}

// A path is safe when it is not itself a symlink and its real location stays inside base.
function assertFileInside(base, file) {
  if (isSymlink(file)) throw new Error(`Symlink not allowed: ${path.basename(file)}`);
  if (!isInside(canonicalize(base), canonicalize(file))) {
    throw new Error(`Path escapes allowed directory: ${path.basename(file)}`);
  }
  return file;
}

// Returns file text, or null when the file does not exist. Throws for symlinks/escapes.
function readContained(base, file) {
  assertFileInside(base, file);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

// Writes without following a final symlink (O_NOFOLLOW) after checking the parent is contained.
function writeContained(base, file, content) {
  assertFileInside(base, file);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(file, flags, 0o644);
  try {
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { projectRoot, runsDir, resolveRunDir, assertIdentifier, assertFileInside, readContained, writeContained };
