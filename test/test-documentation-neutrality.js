'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const DOCUMENT_EXTENSIONS = new Set(['.adoc', '.md', '.mdx', '.rst', '.txt']);
const SKIP_DIRECTORIES = new Set(['.git', '.worktrees', 'node_modules']);
const RESTRICTED_PROVIDER = /deepseek/i;
// The owner's 2026-09-25 evolution plan explicitly requires these comparison records.
// Keep this exception file-specific; ownership/derivation rules still apply.
const COMPARISON_RECORDS = new Set(['docs/evolution/COMPARISON-2026-09-25.md', 'docs/evolution/PLAN.md']);
const EXTERNAL_DERIVATION =
  /\b(?:ported|adapted|copied|derived|absorbed)\s+(?:parts?\s+)?(?:of\s+|from\s+)?(?:an?\s+|the\s+)?(?:existing\s+)?(?:harness|framework)\b|\b(?:portado|portada|adaptado|adaptada|copiado|copiada|derivado|derivada)\s+(?:em\s+parte\s+)?(?:de|do|da)\s+(?:um|uma)?\s*(?:harness|framework)\b/i;

function walkDocumentation(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkDocumentation(absolutePath, files);
    } else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }
  return files;
}

// Respect .gitignore by asking git for tracked plus untracked-not-ignored files.
// Fallback (not a git checkout, or git unavailable): walk the disk, skipping SKIP_DIRECTORIES.
function collectDocumentation(root) {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (listed.status !== 0 || typeof listed.stdout !== 'string') return walkDocumentation(root);
  return listed.stdout
    .split('\0')
    .filter((relative) => relative && DOCUMENT_EXTENSIONS.has(path.extname(relative).toLowerCase()))
    .map((relative) => path.join(root, relative))
    .filter((absolute) => {
      try {
        return fs.statSync(absolute).isFile();
      } catch {
        return false; // listed but deleted in the working tree
      }
    });
}

function documentationViolations(relativePath, content) {
  const violations = [];
  if (RESTRICTED_PROVIDER.test(relativePath) || (RESTRICTED_PROVIDER.test(content) && !COMPARISON_RECORDS.has(relativePath))) {
    violations.push(`${relativePath}: restricted provider reference`);
  }
  if (EXTERNAL_DERIVATION.test(content)) {
    violations.push(`${relativePath}: external harness/framework derivation claim`);
  }
  return violations;
}

test('comparison exception remains bounded and never permits derivation claims', () => {
  for (const file of COMPARISON_RECORDS) {
    assert.ok(fs.statSync(path.join(ROOT, file)).isFile());
    assert.deepEqual(documentationViolations(file, 'DeepSeek'), []);
    assert.equal(documentationViolations(file, 'derived from a harness').length, 1);
  }
  for (const file of ['README.md', 'docs/evolution/OTHER.md', 'docs/evolution/deepseek.md']) {
    assert.equal(documentationViolations(file, 'DeepSeek').length, 1);
  }
});

test('documentation remains provider-neutral and HSEOS-owned', () => {
  const violations = [];
  for (const absolutePath of collectDocumentation(ROOT)) {
    const relativePath = path.relative(ROOT, absolutePath).split(path.sep).join('/');
    violations.push(...documentationViolations(relativePath, fs.readFileSync(absolutePath, 'utf8')));
  }
  assert.deepEqual(violations, []);
});
