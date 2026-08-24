'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  buildCompatibilityObservationSchedulePlan,
  systemdEscapeDirectiveValue,
  systemdQuote,
} = require('../tools/lib/compatibility-observation-plan');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'cli', 'hseos-cli.js');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-observation-plan-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const projectDirectory = path.join(directory, 'project');
  fs.mkdirSync(path.join(projectDirectory, '.hseos', 'state'), { recursive: true });
  return {
    directory,
    projectDirectory,
    evidenceDirectory: path.join(projectDirectory, '.hseos', 'evidence', 'compatibility'),
  };
}

test('schedule plan is deterministic, hardened, explicit, and side-effect free', (t) => {
  const paths = fixture(t);
  const input = {
    projectDirectory: paths.projectDirectory,
    evidenceDirectory: paths.evidenceDirectory,
    nodeExecutable: process.execPath,
    cliPath: CLI,
    minuteUtc: 20,
  };
  const before = fs.readdirSync(path.join(paths.projectDirectory, '.hseos'));
  const first = buildCompatibilityObservationSchedulePlan(input);
  const second = buildCompatibilityObservationSchedulePlan(input);

  assert.deepEqual(second, first);
  assert.deepEqual(fs.readdirSync(path.join(paths.projectDirectory, '.hseos')), before);
  assert.equal(fs.existsSync(paths.evidenceDirectory), false);
  assert.equal(first.plan_only, true);
  assert.equal(first.activation_authorized, false);
  assert.deepEqual(first.schedule, { kind: 'hourly', minute_utc: 20, persistent: true });
  assert.match(first.instance_id, /^[a-f0-9]{12}$/);
  assert.match(first.systemd.service_name, new RegExp(`^hseos-compatibility-observe-${first.instance_id}\\.service$`));
  assert.match(first.systemd.timer, /OnCalendar=\*-\*-\* \*:20:00 UTC/);
  assert.match(first.systemd.timer, /Persistent=true/);
  assert.match(first.systemd.service, /--require-current-hour/);
  assert.match(first.systemd.service, /--evidence-directory/);
  assert.match(first.systemd.service, /Environment=HSEOS_DISABLE_UPDATE_CHECK=1/);
  assert.match(first.systemd.service, /ProtectSystem=strict/);
  assert.match(first.systemd.service, /IPAddressDeny=any/);
  assert.match(first.systemd.service, /RestrictAddressFamilies=AF_UNIX/);
  assert.ok(first.prerequisites.some((item) => /explicit operational authorization/.test(item)));
  assert.ok(first.rollback.some((item) => /Preserve the evidence directory/.test(item)));
});

test('schedule plan rejects path, permission, executable, and schedule ambiguity', (t) => {
  const paths = fixture(t);
  const valid = {
    projectDirectory: paths.projectDirectory,
    evidenceDirectory: paths.evidenceDirectory,
    nodeExecutable: process.execPath,
    cliPath: CLI,
  };
  assert.throws(() => buildCompatibilityObservationSchedulePlan({ ...valid, evidenceDirectory: 'relative' }), /must be absolute/);
  assert.throws(
    () =>
      buildCompatibilityObservationSchedulePlan({
        ...valid,
        evidenceDirectory: path.join(paths.projectDirectory, '.hseos', 'state', 'evidence'),
      }),
    /outside the operational state directory/,
  );
  assert.throws(() => buildCompatibilityObservationSchedulePlan({ ...valid, minuteUtc: 60 }), /from 0 through 59/);

  const publicEvidence = path.join(paths.directory, 'public-evidence');
  fs.mkdirSync(publicEvidence, { mode: 0o755 });
  if (process.platform !== 'win32') {
    assert.throws(
      () => buildCompatibilityObservationSchedulePlan({ ...valid, evidenceDirectory: publicEvidence }),
      /must not be accessible by group or other users/,
    );
  }

  const evidenceTarget = path.join(paths.directory, 'evidence-target');
  fs.mkdirSync(evidenceTarget, { mode: 0o700 });
  const evidenceAlias = path.join(paths.directory, 'evidence-alias');
  fs.symlinkSync(evidenceTarget, evidenceAlias);
  assert.throws(
    () => buildCompatibilityObservationSchedulePlan({ ...valid, evidenceDirectory: evidenceAlias }),
    /must not traverse a symlink/,
  );

  if (process.platform !== 'win32') {
    const nonExecutable = path.join(paths.directory, 'node');
    fs.writeFileSync(nonExecutable, '#!/bin/sh\n', { mode: 0o600 });
    assert.throws(() => buildCompatibilityObservationSchedulePlan({ ...valid, nodeExecutable: nonExecutable }), /must be executable/);
  }
  assert.throws(() => systemdQuote('line\nbreak'), /without control characters/);
  assert.equal(systemdQuote('/path with/$cash%spec'), '"/path with/$$cash%%spec"');
  assert.equal(systemdEscapeDirectiveValue('/path with/$cash%spec'), String.raw`/path\x20with/\x24cash\x25spec`);
});

test('generated user units pass the host systemd verifier when available', (t) => {
  if (process.platform !== 'linux' || !fs.existsSync('/usr/bin/systemd-analyze')) return;
  const paths = fixture(t);
  fs.mkdirSync(paths.evidenceDirectory, { recursive: true, mode: 0o700 });
  const plan = buildCompatibilityObservationSchedulePlan({
    projectDirectory: paths.projectDirectory,
    evidenceDirectory: paths.evidenceDirectory,
    nodeExecutable: process.execPath,
    cliPath: CLI,
  });
  const servicePath = path.join(paths.directory, plan.systemd.service_name);
  const timerPath = path.join(paths.directory, plan.systemd.timer_name);
  fs.writeFileSync(servicePath, plan.systemd.service);
  fs.writeFileSync(timerPath, plan.systemd.timer);
  execFileSync('/usr/bin/systemd-analyze', ['verify', servicePath, timerPath], {
    stdio: 'pipe',
  });
});

test('public CLI emits a non-authorizing JSON plan without creating evidence or units', (t) => {
  const paths = fixture(t);
  const result = spawnSync(
    process.execPath,
    [CLI, 'compatibility-observe-plan', '--directory', paths.projectDirectory, '--evidence-directory', paths.evidenceDirectory, '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HSEOS_DISABLE_UPDATE_CHECK: '1' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.plan_only, true);
  assert.equal(plan.activation_authorized, false);
  assert.equal(fs.existsSync(paths.evidenceDirectory), false);
  assert.deepEqual(fs.readdirSync(paths.directory).sort(), ['project']);
});
