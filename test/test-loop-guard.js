'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPTS = path.join(__dirname, '..', 'scripts', 'governance');

const cleanup = [];
test.after(() => {
  for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true });
});

function temp(prefix) {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), prefix));
  cleanup.push(directory);
  return fs.realpathSync(directory);
}

/** A copy of the guard scripts installed the way a dependency is: under <project>/node_modules/<pkg>/scripts/governance. */
function install(project) {
  const installed = path.join(project, 'node_modules', 'hseos', 'scripts', 'governance');
  fs.mkdirSync(installed, { recursive: true });
  for (const name of ['loop-guard.sh', 'anchor-guard.sh']) fs.copyFileSync(path.join(SCRIPTS, name), path.join(installed, name));
  return installed;
}

function init(cwd, installed, env = {}) {
  const scope = path.join(cwd, 'scope.txt');
  fs.writeFileSync(scope, 'src/\n');
  return spawnSync('bash', [path.join(installed, 'loop-guard.sh'), 'init', '--run', 'r1', '--scope', scope, '--budget', '3'], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: path.dirname(cwd), ...env },
  });
}

test('installed under node_modules, the guard works on the repository of the caller, not on its own package directory', () => {
  const project = temp('hseos-loop-guard-project-');
  assert.equal(spawnSync('git', ['init', '-q', project]).status, 0);
  const installed = install(project);
  const result = init(project, installed);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(project, '.hseos', 'loops', 'r1', 'budget.txt')), 'the loop state is in the caller repository');
  assert.equal(fs.existsSync(path.join(project, 'node_modules', 'hseos', '.hseos')), false, 'nothing is written into the package');
});

test('from a subdirectory of the repository the toplevel is used', () => {
  const project = temp('hseos-loop-guard-sub-');
  assert.equal(spawnSync('git', ['init', '-q', project]).status, 0);
  const installed = install(project);
  const sub = path.join(project, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  const result = init(sub, installed, { GIT_CEILING_DIRECTORIES: path.dirname(project) });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(project, '.hseos', 'loops', 'r1')));
  assert.equal(fs.existsSync(path.join(sub, '.hseos')), false);
});

test('without a repository it falls back to the working directory', () => {
  const plain = temp('hseos-loop-guard-plain-');
  const installed = install(temp('hseos-loop-guard-elsewhere-'));
  const result = init(plain, installed);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(fs.existsSync(path.join(plain, '.hseos', 'loops', 'r1')));
});

test('a root that resolves inside node_modules is refused, however it was reached', () => {
  const project = temp('hseos-loop-guard-nm-');
  const installed = install(project);
  const inside = path.join(project, 'node_modules', 'hseos');
  const byCwd = init(inside, installed);
  assert.equal(byCwd.status, 1, 'no repository: the working directory is the package itself');
  assert.match(byCwd.stderr, /node_modules/);
  assert.equal(fs.existsSync(path.join(inside, '.hseos')), false);
  const outside = temp('hseos-loop-guard-caller-');
  const explicit = init(outside, installed, { REPO_ROOT: inside });
  assert.equal(explicit.status, 1, 'an explicit REPO_ROOT inside node_modules is refused too');
  assert.match(explicit.stderr, /node_modules/);
  const missing = init(outside, installed, { REPO_ROOT: path.join(outside, 'does-not-exist') });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /REPO_ROOT/);
});
