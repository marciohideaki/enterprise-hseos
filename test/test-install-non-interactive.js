'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'tools', 'cli', 'hseos-cli.js');

function install(args, cwd) {
  return spawnSync(process.execPath, [CLI, 'install', ...args], {
    encoding: 'utf8',
    input: '',
    cwd,
    timeout: 20_000,
    killSignal: 'SIGKILL',
    env: { ...process.env, CI: '' },
  });
}

test('install without --directory or --yes fails fast when stdin is not a terminal', () => {
  const result = install([], os.tmpdir());
  assert.equal(result.error, undefined, 'must not hang until the timeout');
  assert.notEqual(result.status, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /--directory/);
  assert.match(output, /stdin is not a terminal/);
});

test('install --yes without --directory assumes the current directory instead of prompting', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-install-yes-'));
  try {
    const result = install(['--yes'], cwd);
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /stdin is not a terminal/);
    assert.match(output, /Using current directory/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
