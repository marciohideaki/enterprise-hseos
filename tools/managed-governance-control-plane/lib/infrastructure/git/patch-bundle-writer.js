'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Produces a real, git-apply-compatible unified diff without ever touching a git repository's
// index, working tree or refs. `git diff --no-index` compares two arbitrary files and works
// outside any repository context — it is a diffing tool here, not a repository operation.
// Nothing in this module runs `git add`, `commit`, `push`, `merge` or `tag` (T06 constraint:
// "No commit, push, pull request, merge, tag or activation operation").

class PatchBundleWriterError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_PATCH_BUNDLE_INVALID', details = {}) {
    super(message);
    this.name = 'PatchBundleWriterError';
    this.code = code;
    this.details = details;
  }
}

function computeFileDiff(relativePath, before, after) {
  if (before === after) return '';
  const stagingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-patch-diff-'));
  try {
    const beforePath = path.join(stagingDirectory, 'before');
    const afterPath = path.join(stagingDirectory, 'after');
    fs.writeFileSync(beforePath, before ?? '', { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(afterPath, after ?? '', { encoding: 'utf8', mode: 0o600 });
    let diff;
    try {
      diff = execFileSync(
        'git',
        [
          '-c',
          'core.safecrlf=false',
          'diff',
          '--no-index',
          '--no-color',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          before === null ? '/dev/null' : beforePath,
          after === null ? '/dev/null' : afterPath,
        ],
        { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      // git diff --no-index exits 1 when the inputs differ — that is success, not a failure.
      if (error.status === 1 && typeof error.stdout === 'string') {
        diff = error.stdout;
      } else {
        throw new PatchBundleWriterError('unable to compute a diff for a file operation', 'MANAGED_GOVERNANCE_PATCH_DIFF_FAILED', {
          path: relativePath,
        });
      }
    }
    // Rewrite the temp-file paths in the diff header to the bundle-relative path so the patch
    // reads like a real repository change, not a reference to a directory that no longer exists.
    // git renders an absolute temp path after the prefix as "a" + "/tmp/.../before" (the
    // prefix's own trailing slash is the only slash — git does not add a second one before an
    // absolute path). Swap everything after that shared slash for the bundle-relative path, so
    // the prefix's slash is preserved exactly once: "a/tmp/.../before" -> "a/docs/existing.md".
    return diff.replaceAll(beforePath.slice(1), relativePath).replaceAll(afterPath.slice(1), relativePath);
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

function buildUnifiedPatch(fileChanges) {
  const sections = [];
  for (const change of fileChanges) {
    const diff = computeFileDiff(change.path, change.before, change.after);
    if (diff) sections.push(diff.endsWith('\n') ? diff : `${diff}\n`);
  }
  return sections.join('');
}

function assertSafeNewDirectory(target) {
  const resolved = path.resolve(target);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new PatchBundleWriterError('bundle destination could not be inspected', 'MANAGED_GOVERNANCE_PATCH_BUNDLE_UNSAFE');
    stat = null;
  }
  if (stat) {
    throw new PatchBundleWriterError('bundle destination already exists — refusing to overwrite', 'MANAGED_GOVERNANCE_PATCH_BUNDLE_EXISTS');
  }
  const parent = path.dirname(resolved);
  let parentStat;
  try {
    parentStat = fs.lstatSync(parent);
  } catch {
    throw new PatchBundleWriterError('bundle destination parent directory does not exist', 'MANAGED_GOVERNANCE_PATCH_BUNDLE_UNSAFE');
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new PatchBundleWriterError('bundle destination parent is not a real directory', 'MANAGED_GOVERNANCE_PATCH_BUNDLE_UNSAFE');
  }
  if (fs.realpathSync(parent) !== parent) {
    throw new PatchBundleWriterError('bundle destination parent traverses a symbolic link', 'MANAGED_GOVERNANCE_PATCH_BUNDLE_UNSAFE');
  }
  return resolved;
}

function writeSecureFile(target, content) {
  const descriptor = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(descriptor, content, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function writePatchBundle({ destination, manifest, patchText }) {
  const resolved = assertSafeNewDirectory(destination);
  fs.mkdirSync(resolved, { recursive: false, mode: 0o700 });
  try {
    writeSecureFile(path.join(resolved, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeSecureFile(path.join(resolved, 'patch.diff'), patchText);
    writeSecureFile(path.join(resolved, 'APPLY.md'), `${manifest.application_instructions}\n`);
    writeSecureFile(path.join(resolved, 'ROLLBACK.md'), `${manifest.rollback_instructions}\n`);
  } catch (error) {
    fs.rmSync(resolved, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({
    destination: resolved,
    manifest_path: path.join(resolved, 'manifest.json'),
    patch_path: path.join(resolved, 'patch.diff'),
    apply_path: path.join(resolved, 'APPLY.md'),
    rollback_path: path.join(resolved, 'ROLLBACK.md'),
  });
}

function digestPatchText(patchText) {
  return `sha256:${crypto.createHash('sha256').update(patchText, 'utf8').digest('hex')}`;
}

module.exports = {
  PatchBundleWriterError,
  buildUnifiedPatch,
  computeFileDiff,
  digestPatchText,
  writePatchBundle,
};
