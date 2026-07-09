'use strict';

const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function resolve() {
  // 1. Repo-vendored binary
  const platform = process.platform;
  const arch = process.arch;
  const vendoredNames = [`axon-${platform}-${arch}`, `axon-${platform}`, 'axon'];
  for (const name of vendoredNames) {
    const candidate = path.join(REPO_ROOT, 'tools', 'vendor', 'axon', name);
    try {
      require('node:fs').accessSync(candidate, require('node:fs').constants.X_OK);
      return candidate;
    } catch {
      // not found or not executable
    }
  }

  // 2. Explicit env var override
  if (process.env.AXON_BIN) {
    try {
      require('node:fs').accessSync(process.env.AXON_BIN, require('node:fs').constants.X_OK);
      return process.env.AXON_BIN;
    } catch {
      // env var points to non-executable; fall through
    }
  }

  // 3. Global PATH
  try {
    const result = execSync('which axon 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
    if (result) return result;
  } catch {
    // not on PATH
  }

  // 4. No-op fallback
  return null;
}

module.exports = { resolve };
