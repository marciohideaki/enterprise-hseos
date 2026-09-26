'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { checkEngineeringSandbox } = require('../tools/cli/lib/engineering-sandbox-check');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-engineering-backend-test-'));
  fs.writeFileSync(path.join(directory, 'ai-jail'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { env: { PATH: directory, SECRET_CANARY: 'must-not-inherit' } };
}

function claimedSuccess() {
  return { status: 0, stdout: JSON.stringify({ write: true, protected_visible: false }), stderr: '' };
}

test('missing backend fails before any probe', () => {
  const report = checkEngineeringSandbox({ env: { PATH: '' }, launch: () => assert.fail('must not launch') });
  assert.equal(report.blocker, 'sandbox-backend-unavailable');
  assert.equal(report.ready, false);
});

test('exit zero and claimed writes do not prove an effect', (t) => {
  const report = checkEngineeringSandbox({ ...fixture(t), launch: claimedSuccess });
  assert.equal(report.status, 'blocked');
  assert.equal(report.checks.length, 2);
  assert.ok(report.checks.every((check) => !check.workspace_write_confirmed && !check.ok));
});

test('confirmed effects pass only prerequisites with fixed commands and cleared environment', (t) => {
  const workspaces = [];
  const report = checkEngineeringSandbox({
    ...fixture(t),
    launch(binary, args, options) {
      workspaces.push(options.cwd);
      assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH']);
      for (const flag of ['--clean', '--lockdown', '--no-network', '--no-inherit-env', '--private-home']) {
        assert.ok(args.includes(flag));
      }
      assert.equal(options.killSignal, 'SIGKILL');
      assert.equal(options.timeout, 10_000);
      assert.equal(args[args.indexOf('--rw-map') + 1], options.cwd);
      assert.ok(['/usr/bin/node', '/usr/bin/python3'].includes(args[args.indexOf('--') + 1]));
      fs.writeFileSync(path.join(options.cwd, 'effect'), args.at(-1));
      return claimedSuccess();
    },
  });
  assert.equal(report.status, 'prerequisites-passed');
  assert.equal(report.ready, false);
  assert.equal(report.operational_authorized, false);
  assert.ok(report.remaining_gates.includes('descendant-cancellation'));
  assert.ok(workspaces.every((directory) => !fs.existsSync(directory)));
});

for (const attack of ['symlink', 'hardlink', 'control-modification', 'visible-control', 'invalid-report', 'timeout']) {
  test(`rejects ${attack} despite a successful-looking effect`, (t) => {
    const report = checkEngineeringSandbox({
      ...fixture(t),
      launch(binary, args, options) {
        const artifact = path.join(options.cwd, 'effect');
        const marker = args.at(-2);
        if (attack === 'symlink') fs.symlinkSync(marker, artifact);
        else if (attack === 'hardlink') fs.linkSync(marker, artifact);
        else fs.writeFileSync(artifact, args.at(-1));
        const result = claimedSuccess();
        if (attack === 'control-modification') fs.writeFileSync(marker, 'tampered');
        if (attack === 'visible-control') result.stdout = JSON.stringify({ write: true, protected_visible: true });
        if (attack === 'invalid-report') result.stdout = '{"write":true}';
        if (attack === 'timeout') result.error = new Error('ETIMEDOUT');
        return result;
      },
    });
    assert.equal(report.status, 'blocked');
    assert.ok(report.checks.every((check) => !check.ok));
  });
}

test('public CLI fails closed against a backend that merely exits zero', (t) => {
  const { env } = fixture(t);
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, '../tools/cli/hseos-cli.js'), 'sandbox', 'engineering-check', '--json'],
    {
      env: { ...process.env, ...env, HSEOS_DISABLE_UPDATE_CHECK: '1' },
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'blocked');
  assert.equal(report.ready, false);
});
