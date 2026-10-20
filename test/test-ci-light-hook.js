'use strict';

// The full suite runs sharded in CI; the commit hook runs a light Gate 3. This file pins both halves:
// the shard split loses nothing, and the light hook selects exactly the checks it promises.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const SHARDS = path.join(ROOT, '.github/scripts/ci-test-shards.mjs');

test('shard plan is deterministic, places every item once and never leaves a shard empty', async () => {
  const { planShards, suiteItems } = await import(pathToFileURL(SHARDS).href);
  const { items } = suiteItems();
  const weights = JSON.parse(fs.readFileSync(path.join(ROOT, '.github/scripts/ci-test-shard-weights.json'), 'utf8'));
  for (const count of [1, 2, 6, 8]) {
    const first = planShards(items, count, weights);
    const second = planShards(items, count, weights);
    assert.deepEqual(first, second);
    const placed = first.flatMap((shard) => shard.items.map((entry) => entry.item));
    assert.equal(placed.length, items.length);
    assert.deepEqual([...placed].sort(), [...items].sort());
    for (const shard of first) assert.ok(shard.items.length > 0);
  }
});

test('the suite is scripts.test plus the kernel coverage run, and verify proves the split covers it', async () => {
  const { suiteItems } = await import(pathToFileURL(SHARDS).href);
  const { steps, items } = suiteItems();
  assert.equal(steps.join(' && '), require(path.join(ROOT, 'package.json')).scripts.test);
  assert.equal(items.at(-1), 'npm run test:kernel-coverage');
  for (const count of ['6', '8']) {
    const output = execFileSync('node', [SHARDS, 'verify', '--shards', count], { cwd: ROOT, encoding: 'utf8' });
    assert.match(output, /^OK \d+ items/);
  }
});

test('the CI fan-in keeps the check names that branch protection requires', () => {
  const yaml = require('yaml');
  const workflow = yaml.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yaml'), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['master', 'task/**', 'feature/**']);
  assert.deepEqual(workflow.jobs.test.strategy.matrix['node-version'], ['22.x', '24.x']);
  assert.equal(workflow.jobs.test.name, undefined, 'the default name `test (<node>)` is the required check');
  assert.equal(workflow.jobs.test.needs, 'shard');
  assert.equal(workflow.jobs.governance.needs, 'test');
  assert.equal(workflow.jobs.shard.strategy.matrix.shard.length, workflow.env.SHARD_COUNT);
});

const gateSource = fs.readFileSync(path.join(ROOT, 'scripts/governance/quality-gates.sh'), 'utf8');
const light = gateSource.slice(gateSource.indexOf('gate_code_light()'), gateSource.indexOf('\ngate_code() {'));

function runLight(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-light-hook-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    const write = (name, content) => {
      fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      fs.writeFileSync(path.join(directory, name), content);
    };
    write('test/test-package-surface.js', '');
    write('test/test-uses-lib.js', "require('../tools/lib/thing');\n");
    write('test/test-unrelated.js', '');
    write('tools/lib/thing.js', '');
    write('README.md', '');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    for (const [name, content] of files) write(name, content);
    git('add', '-A');
    const harness = `
set -euo pipefail
info() { printf 'INFO %s\\n' "$*"; }
warn() { :; }
pass() { printf 'PASS %s\\n' "$*"; }
record_fail() { printf 'FAIL %s\\n' "$*"; }
run_node_check() { printf 'CHECK %s\\n' "$*"; }
gate_passed=true
HSEOS_HOOK_MAX_TESTS=40
${light}
gate_code_light
`;
    return execFileSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: { ...process.env, REPO_ROOT: directory, LOG_FILE: path.join(directory, 'gate.log') },
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('light hook: a docs-only commit runs G3 and nothing else', () => {
  const output = runLight([['README.md', 'changed\n']]);
  assert.match(output, /CHECK node --test --test-concurrency=1 test\/test-package-surface\.js\n/);
  assert.doesNotMatch(output, /eslint|prettier|npm run lint|test-uses-lib|test-unrelated/);
});

test('light hook: a source file runs the tests that reference it, lint and format on it, and G3', () => {
  const output = runLight([['tools/lib/thing.js', '// changed\n']]);
  assert.match(output, /CHECK node_modules\/\.bin\/eslint .* tools\/lib\/thing\.js/);
  assert.match(output, /CHECK node_modules\/\.bin\/prettier .* tools\/lib\/thing\.js/);
  assert.match(output, /node --test --test-concurrency=1 test\/test-uses-lib\.js test\/test-package-surface\.js/);
  assert.doesNotMatch(output, /test-unrelated/);
});

test('light hook: a touched test file runs itself; config changes lint the whole tree', () => {
  const touched = runLight([['test/test-unrelated.js', '// changed\n']]);
  assert.match(touched, /node --test --test-concurrency=1 test\/test-unrelated\.js test\/test-package-surface\.js/);
  const config = runLight([['package.json', '{}\n']]);
  assert.match(config, /CHECK npm run lint --silent/);
});

test('light is the default only for the code phase; other phases and --full keep the complete Gate 3', () => {
  assert.match(gateSource, /HSEOS_HOOK_MODE="\$\{HSEOS_HOOK_MODE:-light\}"/);
  assert.match(gateSource, /code\)\n\s+GATE_CODE_MODE="\$\{HSEOS_HOOK_MODE\}"/);
  assert.match(gateSource, /GATE_CODE_MODE:-full/);
  assert.match(gateSource, /--full\) HSEOS_HOOK_MODE="full"/);
});
