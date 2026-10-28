'use strict';

const path = require('node:path');
const fs = require('node:fs');

const SCOPE_DENIED = 'MCP_SCOPE_DENIED';
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// Every refusal carries a stable code so the MCP gateway can record it as an out-of-scope denial.
function scopeError(message, ErrorType = Error) {
  return Object.assign(new ErrorType(message), { code: SCOPE_DENIED });
}

// The consuming project is the server's working directory (same convention as mcp-project-state).
// The directory must be a real, non-root directory: a deleted, replaced or root cwd would silently widen the scope.
function projectRoot() {
  let cwd;
  let metadata;
  try {
    cwd = process.cwd();
    metadata = fs.statSync(cwd);
  } catch {
    throw scopeError('Working directory is not accessible');
  }
  if (!metadata.isDirectory() || path.parse(cwd).root === cwd) throw scopeError('Working directory is not a valid project directory');
  return cwd;
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
    throw scopeError(`Dangling symlink not allowed: ${path.basename(existing)}`);
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
    throw scopeError(`Invalid ${field}: must match ${RUN_ID_PATTERN}`, TypeError);
  }
  return value;
}

// Fail-closed: strict identifier plus realpath containment inside the project's runs dir.
function resolveRunDir(runId, field = 'run_id') {
  assertIdentifier(runId, field);
  const root = runsDir();
  const canonicalProject = canonicalize(projectRoot());
  const runDir = path.join(root, runId);
  const canonicalRoot = canonicalize(root);
  const canonicalRun = canonicalize(runDir);
  if (!isInside(canonicalProject, canonicalRoot)) throw scopeError('The runs directory resolves outside the project directory');
  if (!isInside(canonicalRoot, canonicalRun) || canonicalRun === canonicalRoot) {
    throw scopeError(`Invalid ${field}: resolves outside the runs directory`);
  }
  return runDir;
}

// A path is safe when it is not itself a symlink and its real location stays inside base.
function assertFileInside(base, file) {
  if (isSymlink(file)) throw scopeError(`Symlink not allowed: ${path.basename(file)}`);
  if (!isInside(canonicalize(base), canonicalize(file))) {
    throw scopeError(`Path escapes allowed directory: ${path.basename(file)}`);
  }
  return file;
}

// Test seam: afterCheck runs between the path check and the open, where a racing process could swap the path;
// afterComponent runs inside the mkdirContained loop, before each missing component is created. Always null in production.
const hooks = { afterCheck: null, afterComponent: null };

// The descriptor, not the path, is checked: a hardlink (nlink > 1) aliases a file that may live outside the base, a
// non-regular file (FIFO, device) must never be read, and on Linux the real location of the opened descriptor must still
// be inside the base even when a parent directory was swapped for a symlink after the path check.
function assertOpenedInside(fd, canonicalBase, file) {
  const metadata = fs.fstatSync(fd);
  if (!metadata.isFile() || metadata.nlink !== 1) throw scopeError(`Not a regular, non-linked file: ${path.basename(file)}`);
  if (process.platform === 'linux') {
    let actual;
    try {
      actual = fs.realpathSync(`/proc/self/fd/${fd}`);
    } catch {
      throw scopeError(`Cannot resolve the opened file: ${path.basename(file)}`);
    }
    if (!isInside(canonicalBase, actual)) throw scopeError(`Path escapes allowed directory: ${path.basename(file)}`);
  }
}

// The parent directory is opened first (O_DIRECTORY | O_NOFOLLOW) and its real location validated from the descriptor; the
// file is then opened relative to that descriptor. A parent swapped for a symlink after the path check is rejected before
// anything is created, and nothing created later can land outside the base. Linux only; elsewhere the path is used as is.
function openContained(base, file, flags, mode) {
  assertFileInside(base, file);
  const canonicalBase = canonicalize(base);
  if (hooks.afterCheck) hooks.afterCheck(file);
  const fileFlags = flags | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  let parentFd = null;
  try {
    let target = file;
    if (process.platform === 'linux') {
      try {
        parentFd = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      } catch (error) {
        if (error.code === 'ELOOP' || error.code === 'ENOTDIR') throw scopeError(`Parent directory not allowed: ${path.basename(file)}`);
        throw error;
      }
      if (!isInside(canonicalBase, fs.realpathSync(`/proc/self/fd/${parentFd}`))) {
        throw scopeError(`Path escapes allowed directory: ${path.basename(file)}`);
      }
      target = `/proc/self/fd/${parentFd}/${path.basename(file)}`;
    }
    return { fd: fs.openSync(target, fileFlags, mode), canonicalBase };
  } catch (error) {
    if (error.code === 'ELOOP') throw scopeError(`Symlink not allowed: ${path.basename(file)}`);
    // A FIFO opened for writing without a reader fails with ENXIO: it is not a regular file.
    if (error.code === 'ENXIO') throw scopeError(`Not a regular, non-linked file: ${path.basename(file)}`);
    throw error;
  } finally {
    if (parentFd !== null) fs.closeSync(parentFd);
  }
}

// Returns file text, or null when the file does not exist. Throws for symlinks/escapes/hardlinks/non-regular files.
function readContained(base, file) {
  let opened;
  try {
    opened = openContained(base, file, fs.constants.O_RDONLY);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const { fd, canonicalBase } = opened;
  try {
    assertOpenedInside(fd, canonicalBase, file);
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Opens without following a final symlink and without truncating, validates the opened file, then truncates.
function writeContained(base, file, content) {
  const { fd, canonicalBase } = openContained(base, file, fs.constants.O_WRONLY | fs.constants.O_CREAT, 0o644);
  try {
    assertOpenedInside(fd, canonicalBase, file);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Opens a directory without following a final symlink and returns its descriptor. A swapped symlink or a non-directory
// is a scope denial; ENOENT and other errors propagate to the caller.
function openDirectoryFd(dir) {
  try {
    return fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ELOOP' || error.code === 'ENOTDIR') throw scopeError(`Parent directory not allowed: ${path.basename(dir)}`);
    throw error;
  }
}

// The real location of an open directory descriptor must still be inside the base, whatever happened to its path.
function assertFdInside(fd, canonicalBase, name) {
  let actual;
  try {
    actual = fs.realpathSync(`/proc/self/fd/${fd}`);
  } catch {
    throw scopeError(`Cannot resolve the opened directory: ${name}`);
  }
  if (!isInside(canonicalBase, actual)) throw scopeError(`Path escapes allowed directory: ${name}`);
}

// Creates dir (and missing ancestors) through descriptors: the deepest existing ancestor is opened (O_DIRECTORY | O_NOFOLLOW)
// and validated from the descriptor, then each missing component is created and reopened relative to the previous
// descriptor, so an ancestor swapped for a symlink after the path check creates nothing outside the base. base must be an
// ancestor of (or equal to) dir. Linux only; elsewhere there is no /proc/self/fd and the path is used as is.
function mkdirContained(base, dir) {
  assertFileInside(base, dir);
  if (process.platform !== 'linux') {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  const canonicalBase = canonicalize(base);
  let existing = path.resolve(dir);
  const rest = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  if (hooks.afterCheck) hooks.afterCheck(dir);
  let fd = openDirectoryFd(existing);
  try {
    let current = existing;
    for (const name of rest) {
      // The descriptor is revalidated right before each component is created in it: the previous one may have been
      // moved out of the base since it was opened.
      if (hooks.afterComponent) hooks.afterComponent(path.join(current, name));
      assertFdInside(fd, canonicalBase, path.basename(current));
      const child = `/proc/self/fd/${fd}/${name}`;
      try {
        fs.mkdirSync(child);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const next = openDirectoryFd(child);
      fs.closeSync(fd);
      fd = next;
      current = path.join(current, name);
    }
    assertFdInside(fd, canonicalBase, path.basename(current));
  } finally {
    fs.closeSync(fd);
  }
}

// Base for creating a run directory: the runs directory itself once it exists (it must not be a symlink), the project root
// until then, so a runs directory swapped for a link to another project directory is refused.
function runDirBase() {
  const runs = runsDir();
  if (!fs.existsSync(runs) && !isSymlink(runs)) return projectRoot();
  if (isSymlink(runs)) throw scopeError('The runs directory must not be a symlink');
  return runs;
}

// Lists dir through its descriptor: the directory is opened (O_DIRECTORY | O_NOFOLLOW), its real location validated, and
// the listing read from /proc/self/fd, so a directory swapped for a symlink after the path check is never listed. Returns
// names, or Dirents with { withFileTypes: true } (entries that are symlinks are reported as such, not followed).
// Linux only; elsewhere the path is used as is.
function readdirContained(base, dir, options) {
  assertFileInside(base, dir);
  if (process.platform !== 'linux') return fs.readdirSync(dir, options);
  const canonicalBase = canonicalize(base);
  if (hooks.afterCheck) hooks.afterCheck(dir);
  const fd = openDirectoryFd(dir);
  try {
    assertFdInside(fd, canonicalBase, path.basename(dir));
    return fs.readdirSync(`/proc/self/fd/${fd}`, options);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  hooks,
  SCOPE_DENIED,
  projectRoot,
  runsDir,
  resolveRunDir,
  assertIdentifier,
  assertFileInside,
  readContained,
  writeContained,
  mkdirContained,
  runDirBase,
  readdirContained,
};
