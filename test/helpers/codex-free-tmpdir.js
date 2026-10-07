'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The production ACP validator rejects any directory whose ancestors contain `.codex`.
// Hosts may point TMPDIR below such a directory, so tests pick a base that has none.
function hasCodexAncestor(directory) {
  for (let current = fs.realpathSync(directory); ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.codex'))) return true;
    if (path.dirname(current) === current) return false;
  }
}

function codexFreeTmpdir() {
  const candidates = [os.tmpdir(), '/dev/shm', '/tmp', '/var/tmp'];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory() && !hasCodexAncestor(candidate)) return fs.realpathSync(candidate);
    } catch {
      // Unusable candidate; try the next one.
    }
  }
  throw new Error('no temporary base without a .codex ancestor is available');
}

module.exports = { codexFreeTmpdir, hasCodexAncestor };
