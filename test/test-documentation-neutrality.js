'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const DOCUMENT_EXTENSIONS = new Set(['.adoc', '.md', '.mdx', '.rst', '.txt']);
const SKIP_DIRECTORIES = new Set(['.git', '.worktrees', 'node_modules']);
const RESTRICTED_PROVIDER = /deepseek/i;
const EXTERNAL_DERIVATION =
  /\b(?:ported|adapted|copied|derived|absorbed)\s+(?:parts?\s+)?(?:of\s+|from\s+)?(?:an?\s+|the\s+)?(?:existing\s+)?(?:harness|framework)\b|\b(?:portado|portada|adaptado|adaptada|copiado|copiada|derivado|derivada)\s+(?:em\s+parte\s+)?(?:de|do|da)\s+(?:um|uma)?\s*(?:harness|framework)\b/i;

function collectDocumentation(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectDocumentation(absolutePath, files);
    } else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }
  return files;
}

test('documentation remains provider-neutral and HSEOS-owned', () => {
  const violations = [];

  for (const absolutePath of collectDocumentation(ROOT)) {
    const relativePath = path.relative(ROOT, absolutePath);
    const content = fs.readFileSync(absolutePath, 'utf8');

    if (RESTRICTED_PROVIDER.test(relativePath) || RESTRICTED_PROVIDER.test(content)) {
      violations.push(`${relativePath}: restricted provider reference`);
    }
    if (EXTERNAL_DERIVATION.test(content)) {
      violations.push(`${relativePath}: external harness/framework derivation claim`);
    }
  }

  assert.deepEqual(violations, []);
});
