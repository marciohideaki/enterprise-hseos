'use strict';

// Install over an existing adoption (F1/F7/F8 of the cambio-real-platforms battery).
//
// The installer must classify `.hseos/` from the installed manifest, not from the
// mere existence of the folder, and must never exit 0 without installing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const yaml = require('yaml');

const CLI = path.join(__dirname, '..', 'tools', 'cli', 'hseos-cli.js');
const PKG_VERSION = require('../package.json').version;

function hseos(args, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input: '',
    cwd,
    timeout: 120_000,
    killSignal: 'SIGKILL',
    env: { ...process.env, CI: '' },
  });
  assert.equal(result.error, undefined, 'must not hang or time out');
  return { ...result, output: result.stdout + result.stderr };
}

const install = (cwd, extra = []) => hseos(['install', '--yes', '--tools', 'none', ...extra], cwd);

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function manifestPath(dir) {
  return path.join(dir, '.hseos', '_config', 'manifest.yaml');
}

function installedAt(dir) {
  return yaml.parse(fs.readFileSync(manifestPath(dir), 'utf8')).installation.lastUpdated;
}

function installedVersion(dir) {
  return yaml.parse(fs.readFileSync(manifestPath(dir), 'utf8')).installation.version;
}

function setInstalledVersion(dir, version) {
  const doc = yaml.parse(fs.readFileSync(manifestPath(dir), 'utf8'));
  doc.installation.version = version;
  fs.writeFileSync(manifestPath(dir), yaml.stringify(doc));
}

function seedProjectState(dir) {
  fs.mkdirSync(path.join(dir, '.hseos', 'runs'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.hseos', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.hseos', 'runs', 'run-1.json'), '{"keep":"runs"}');
  fs.writeFileSync(path.join(dir, '.hseos', 'state', 'project.db'), 'keep-state');
}

function assertProjectStatePreserved(dir) {
  assert.equal(fs.readFileSync(path.join(dir, '.hseos', 'runs', 'run-1.json'), 'utf8'), '{"keep":"runs"}');
  assert.equal(fs.readFileSync(path.join(dir, '.hseos', 'state', 'project.db'), 'utf8'), 'keep-state');
}

test('state (a): no installation installs normally', (t) => {
  const dir = scratch(t);
  const result = install(dir);
  assert.equal(result.status, 0, result.output);
  assert.equal(installedVersion(dir), PKG_VERSION);
});

test('state (b): .hseos with only runs/ and state/ installs and preserves them', (t) => {
  const dir = scratch(t);
  seedProjectState(dir);
  const result = install(dir);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /legacy/i);
  assert.equal(installedVersion(dir), PKG_VERSION);
  assertProjectStatePreserved(dir);
});

test('state (c): reinstall over the same version is idempotent and non-interactive', (t) => {
  const dir = scratch(t);
  seedProjectState(dir);
  assert.equal(install(dir).status, 0);
  const before = installedAt(dir);
  const again = install(dir);
  assert.equal(again.status, 0, again.output);
  assert.doesNotMatch(again.output, /legacy/i);
  assert.notEqual(installedAt(dir), before, 'reinstall must actually run, not exit 0 without installing');
  assert.equal(installedVersion(dir), PKG_VERSION);
  assertProjectStatePreserved(dir);
});

test('state (d): an older supported version is upgraded non-interactively', (t) => {
  const dir = scratch(t);
  seedProjectState(dir);
  assert.equal(install(dir).status, 0);
  setInstalledVersion(dir, '3.9.0');
  const upgraded = install(dir);
  assert.equal(upgraded.status, 0, upgraded.output);
  assert.match(upgraded.output, /Quick update complete|Upgrading/i);
  assert.doesNotMatch(upgraded.output, /legacy/i);
  assert.equal(installedVersion(dir), PKG_VERSION);
  assertProjectStatePreserved(dir);
});

test('state (e): a real legacy layout fails closed with an actionable message and exit != 0', (t) => {
  const dir = scratch(t);
  seedProjectState(dir);
  fs.mkdirSync(path.join(dir, '.hseos', '_cfg'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.hseos', '_cfg', 'old.yaml'), 'v: 4');
  const result = install(dir);
  assert.notEqual(result.status, 0, 'must never exit 0 without installing');
  assert.match(result.output, /legacy/i);
  assert.match(result.output, /back ?up|rename|move/i);
  assert.doesNotMatch(result.output, /delete (your|the) .*\.hseos/i, 'must not recommend deleting project state');
  assert.ok(fs.existsSync(path.join(dir, '.hseos', '_cfg', 'old.yaml')), 'legacy files untouched');
  assertProjectStatePreserved(dir);
});

test('state (e): a .hseos with unknown content and no manifest is refused, not installed over', (t) => {
  const dir = scratch(t);
  fs.mkdirSync(path.join(dir, '.hseos', 'workflows'), { recursive: true });
  const result = install(dir);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /legacy|unrecogni[sz]ed|manifest/i);
  assert.ok(!fs.existsSync(manifestPath(dir)));
});

test('downgrade is refused with exit != 0', (t) => {
  const dir = scratch(t);
  assert.equal(install(dir).status, 0);
  setInstalledVersion(dir, '99.0.0');
  const result = install(dir);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /99\.0\.0/);
  assert.match(result.output, /newer|downgrade/i);
  assert.equal(installedVersion(dir), '99.0.0');
});

test('F7: --tools none writes no tool plugin directories', (t) => {
  const dir = scratch(t);
  const result = install(dir);
  assert.equal(result.status, 0, result.output);
  assert.ok(!fs.existsSync(path.join(dir, '.claude-plugin')), '.claude-plugin must not be written');
  assert.ok(!fs.existsSync(path.join(dir, '.codex-plugin')), '.codex-plugin must not be written');
});

test('F7: no inert pre-commit hook when the project has no quality-gates script', (t) => {
  const dir = scratch(t);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const result = install(dir);
  assert.equal(result.status, 0, result.output);
  assert.ok(!fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')), 'an inert hook must not be installed');
  assert.match(result.output, /quality-gates\.sh/);
  assert.match(result.output, /not installed|skipped/i);
});

test('F7: the pre-commit hook is installed when the project owns the gate script', (t) => {
  const dir = scratch(t);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'scripts', 'governance'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'governance', 'quality-gates.sh'), '#!/usr/bin/env bash\nexit 0\n');
  const result = install(dir);
  assert.equal(result.status, 0, result.output);
  assert.ok(fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')));
});

test('F8: install-plan --directory on a consumer explains the catalog requirement', (t) => {
  const dir = scratch(t);
  const result = hseos(['install-plan', '--directory', dir], os.tmpdir());
  assert.notEqual(result.status, 0);
  assert.match(result.output, /catalog/i);
  assert.match(result.output, /--directory/);
  assert.doesNotMatch(result.output, /Unsupported capability profiles schema/);
});

function sha(file) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('C2-1: the documented remedy (move everything except runs/ and state/) installs and never touches them', (t) => {
  const dir = scratch(t);
  seedProjectState(dir);
  fs.writeFileSync(path.join(dir, '.hseos', 'runs', 'config.yaml'), 'USER-RUNS\n');
  fs.writeFileSync(path.join(dir, '.hseos', 'state', 'config.yaml'), 'USER-STATE\n');
  assert.equal(install(dir).status, 0);
  // Simulate the remedy: back up everything except the project state folders.
  const backup = path.join(dir, '..', `${path.basename(dir)}-backup`);
  t.after(() => fs.rmSync(backup, { recursive: true, force: true }));
  fs.mkdirSync(backup);
  for (const name of fs.readdirSync(path.join(dir, '.hseos'))) {
    if (name !== 'runs' && name !== 'state') fs.renameSync(path.join(dir, '.hseos', name), path.join(backup, name));
  }
  const files = ['runs/run-1.json', 'runs/config.yaml', 'state/project.db', 'state/config.yaml'].map((f) => path.join(dir, '.hseos', f));
  const before = files.map(sha);
  const result = install(dir);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /Source for module/);
  assert.equal(installedVersion(dir), PKG_VERSION);
  assert.deepEqual(files.map(sha), before, 'project state files must be byte-identical');
  assert.equal(fs.readFileSync(files[1], 'utf8'), 'USER-RUNS\n');
});

test('C2-1: a fresh install never writes config.yaml into project state folders', (t) => {
  const dir = scratch(t);
  seedProjectState(dir);
  assert.equal(install(dir).status, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.hseos', 'runs', 'config.yaml')));
  assert.ok(!fs.existsSync(path.join(dir, '.hseos', 'state', 'config.yaml')));
  assert.ok(!fs.existsSync(path.join(dir, '.hseos', 'config', 'config.yaml')));
});

test('C2-3: dotfiles and unknown folders next to project state are not legacy', (t) => {
  const dir = scratch(t);
  seedProjectState(dir);
  fs.writeFileSync(path.join(dir, '.hseos', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, '.hseos', '.DS_Store'), 'x');
  fs.mkdirSync(path.join(dir, '.hseos', 'reports'));
  fs.writeFileSync(path.join(dir, '.hseos', 'reports', 'r.md'), 'keep');
  const result = install(dir);
  assert.equal(result.status, 0, result.output);
  assert.equal(fs.readFileSync(path.join(dir, '.hseos', 'reports', 'r.md'), 'utf8'), 'keep');
  assert.equal(installedVersion(dir), PKG_VERSION);
});

test('C2-2: a fresh install interrupted midway is repaired by the next run, not refused as legacy', (t) => {
  const dir = scratch(t);
  seedProjectState(dir);
  // .agents is written after .hseos: making it unwritable fails the install midway.
  fs.mkdirSync(path.join(dir, '.agents'));
  fs.chmodSync(path.join(dir, '.agents'), 0o500);
  let failed;
  try {
    failed = install(dir);
  } finally {
    fs.chmodSync(path.join(dir, '.agents'), 0o755);
  }
  assert.notEqual(failed.status, 0, 'the injected failure must fail the install');
  const retry = install(dir);
  assert.equal(retry.status, 0, retry.output);
  assert.doesNotMatch(retry.output, /legacy/i);
  assert.equal(installedVersion(dir), PKG_VERSION);
  assert.ok(!fs.existsSync(path.join(dir, '.hseos', '.install-in-progress')), 'marker removed on success');
  assertProjectStatePreserved(dir);
});

test('C2-4: expected failures print a clean message without a stack trace', (t) => {
  const dir = scratch(t);
  fs.mkdirSync(path.join(dir, '.hseos', '_cfg'), { recursive: true });
  const result = install(dir);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.output, /\n\s+at .*\(.*:\d+:\d+\)/);
  const asFile = scratch(t);
  fs.writeFileSync(path.join(asFile, '.hseos'), 'x');
  const second = install(asFile);
  assert.notEqual(second.status, 0);
  assert.match(second.output, /not a directory/);
  assert.doesNotMatch(second.output, /ENOTDIR/);
});
