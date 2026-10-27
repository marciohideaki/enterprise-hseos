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
  assert.deepEqual(workflow.jobs.test.needs, ['plan', 'shard']);
  // A failed plan leaves full_node_versions empty; the fan-in must fail on it explicitly instead of reading fromJSON('').
  const [first] = workflow.jobs.test.steps;
  assert.equal(first.name, 'Require the plan job to have succeeded');
  assert.equal(first.if, "${{ needs.plan.result != 'success' }}");
  assert.match(first.run, /exit 1/);
  // Node 24 always gets the full suite; Node 22 gets it only on the nightly schedule and manual dispatch, and the
  // `test (22.x)` check runs the compatibility subset otherwise, so the required check name stays satisfiable.
  assert.equal(workflow.jobs.shard.strategy.matrix['node-version'], '${{ fromJSON(needs.plan.outputs.full_node_versions) }}');
  const planStep = workflow.jobs.plan.steps.find((step) => step.id === 'plan').run;
  assert.match(planStep, /full_node_versions=\["22\.x","24\.x"\]/);
  assert.match(planStep, /full_node_versions=\["24\.x"\]/);
  assert.ok(workflow.on.schedule.length > 0 && 'workflow_dispatch' in workflow.on);
  assert.match(workflow.jobs.test.steps.map((step) => step.run ?? '').join('\n'), /npm run test:node22-compat/);
  assert.equal(workflow.jobs.governance.needs, 'test');
  assert.equal(workflow.jobs.shard.strategy.matrix.shard.length, workflow.env.SHARD_COUNT);
});

const gateSource = fs.readFileSync(path.join(ROOT, 'scripts/governance/quality-gates.sh'), 'utf8');
const light = gateSource.slice(gateSource.indexOf('is_test_file()'), gateSource.indexOf('\ngate_code() {'));

function runLight(files, { max = 40 } = {}) {
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
    write('test/test-zzz.js', '');
    write('test/journeys/run.mjs', "import '../../tools/lib/thing.js';\n");
    write('test/helpers/helper.js', "require('../../tools/lib/thing');\n");
    write('test/sub/test-nested.js', "require('../../tools/lib/thing');\n");
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
HSEOS_HOOK_MAX_TESTS=${max}
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
  assert.match(
    output,
    /node --test --test-concurrency=1 test\/sub\/test-nested\.js test\/test-uses-lib\.js test\/test-package-surface\.js/,
  );
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

test('light hook: staged test files run before the tests that cite a staged source file', () => {
  const output = runLight([
    ['tools/lib/thing.js', '// changed\n'],
    ['test/test-zzz.js', '// changed\n'],
  ]);
  assert.match(output, /test\/test-zzz\.js test\/sub\/test-nested\.js test\/test-uses-lib\.js test\/test-package-surface\.js/);
});

test('light hook: past the ceiling it fails and points at --full instead of running a subset', () => {
  const files = [
    ['test/test-unrelated.js', '// changed\n'],
    ['test/test-zzz.js', '// changed\n'],
  ];
  const over = runLight(files, { max: 1 });
  assert.match(over, /FAIL Light hook: 2 test files .*ceiling 1.*--full/);
  assert.doesNotMatch(over, /CHECK node --test/);
  const atCeiling = runLight(files, { max: 2 });
  assert.doesNotMatch(atCeiling, /FAIL/);
  assert.match(atCeiling, /CHECK node --test/);
});

test('light mode with nothing staged runs the complete Gate 3', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-light-empty-'));
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), '{}');
    execFileSync('git', ['-C', directory, 'init', '-q']);
    const gate = gateSource.slice(gateSource.indexOf('is_test_file()'), gateSource.indexOf('gate_security()'));
    const harness = `
set -euo pipefail
info() { :; }
warn() { :; }
pass() { printf 'PASS %s\\n' "$*"; }
record_fail() { printf 'FAIL %s\\n' "$*"; }
run_node_check() { printf 'CHECK %s\\n' "$*"; }
node() { return 0; }
GATE_CODE_MODE=light
${gate}
gate_code
`;
    const output = execFileSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: { ...process.env, REPO_ROOT: directory, LOG_FILE: path.join(directory, 'gate.log') },
    });
    assert.match(output, /CHECK npm run lint/);
    assert.match(output, /CHECK npm test/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('light hook: journey CLIs and helpers that cite a staged file are never run as tests', () => {
  const output = runLight([['tools/lib/thing.js', '// changed\n']]);
  assert.doesNotMatch(output, /journeys|helpers/);
  assert.match(output, /test\/sub\/test-nested\.js/);
  assert.match(output, /test\/test-uses-lib\.js/);
});

// The supervisor must not hide process leaks: a descendant still alive after a command ends is killed, and the
// command fails naming the orphans. Fixtures leak real sleeps with a distinctive duration so assertions never match
// anything else on the machine.
const ORPHANS = path.join(ROOT, '.github/scripts/suite-orphans.mjs');
const LEAK_SECONDS = '4711';

// A killed process may linger as a zombie until its new parent reaps it; a zombie is dead for this purpose.
function alive(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return !/^\S+ \(.*\) [ZX]/.test(stat);
  } catch {
    return false;
  }
}

// SIGKILL is delivered asynchronously, so give the kernel a moment before calling a process alive.
function stillAlive(pid) {
  for (let attempt = 0; attempt < 40 && alive(pid); attempt += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  return alive(pid);
}

test('a command that leaves a child alive is killed and reported as an orphan with pid and command', async () => {
  const { runGuarded, describeOrphans } = await import(pathToFileURL(ORPHANS).href);
  const result = runGuarded(`sleep ${LEAK_SECONDS} & exit 0`, { cwd: ROOT, settleMs: 200 });
  assert.equal(result.status, 0);
  assert.equal(result.orphans.length, 1);
  assert.match(result.orphans[0].command, new RegExp(`sleep ${LEAK_SECONDS}`));
  assert.match(describeOrphans('fixture', result.orphans), new RegExp(`pid ${result.orphans[0].pid}: sleep ${LEAK_SECONDS}`));
  assert.equal(stillAlive(result.orphans[0].pid), false, 'the orphan must be killed');
});

test('a double-forked setsid orphan, which reparents to init, is still found', async () => {
  const { runGuarded } = await import(pathToFileURL(ORPHANS).href);
  const result = runGuarded(`setsid sleep ${LEAK_SECONDS} </dev/null >/dev/null 2>&1 & exit 0`, { cwd: ROOT, settleMs: 200 });
  assert.equal(result.orphans.length, 1);
  assert.equal(stillAlive(result.orphans[0].pid), false);
});

test('a clean command and a child that exits during the settle window are not orphans', async () => {
  const { runGuarded } = await import(pathToFileURL(ORPHANS).href);
  assert.deepEqual(runGuarded('true', { cwd: ROOT, settleMs: 200 }).orphans, []);
  const slow = runGuarded('(sleep 0.4 &) ; exit 0', { cwd: ROOT, settleMs: 2000 });
  assert.deepEqual(slow.orphans, []);
});

test('a failing command keeps its exit status and only the supervised command tree is inspected', async () => {
  const { runGuarded } = await import(pathToFileURL(ORPHANS).href);
  const bystander = require('node:child_process').spawn('sleep', [LEAK_SECONDS], { stdio: 'ignore' });
  try {
    const result = runGuarded('exit 3', { cwd: ROOT, settleMs: 200 });
    assert.equal(result.status, 3);
    assert.deepEqual(result.orphans, []);
    assert.equal(alive(bystander.pid), true, 'a process the command did not start must never be touched');
  } finally {
    bystander.kill('SIGKILL');
  }
});

test('an allowlisted segment is killed but not failed, and an allowlist entry needs a reason', async () => {
  const { runGuarded, loadAllowlist } = await import(pathToFileURL(ORPHANS).href);
  const command = `sleep ${LEAK_SECONDS} & exit 0`;
  const result = runGuarded(command, { cwd: ROOT, settleMs: 200, allowlist: { [command]: 'fixture' } });
  assert.deepEqual(result.orphans, []);
  assert.equal(result.allowed.length, 1);
  assert.equal(stillAlive(result.allowed[0].pid), false);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-allow-')), 'a.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ x: ' ' }));
    assert.throws(() => loadAllowlist(file), /needs a reason/);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
  assert.deepEqual(loadAllowlist(), {}, 'the shipped allowlist stays empty: leaks are fixed, not listed');
});

test('npm run steps split into per-file segments only when the chain is plain &&', async () => {
  const { segmentsOf } = await import(pathToFileURL(ORPHANS).href);
  const scripts = {
    'test:a': 'node test/a.js && node test/b.js',
    'test:b': 'node test/a.js || node test/b.js',
    'test:c': 'node test/a.js | cat',
    'test:d': 'npm run test:a && node x.js',
    'test:e': 'node --test test/a.js',
  };
  assert.deepEqual(segmentsOf('npm run test:a', scripts), ['node test/a.js', 'node test/b.js']);
  assert.deepEqual(segmentsOf('npm run test:b', scripts), ['npm run test:b']);
  assert.deepEqual(segmentsOf('npm run test:c', scripts), ['npm run test:c']);
  assert.deepEqual(segmentsOf('npm run test:d', scripts), ['npm run test:d']);
  assert.deepEqual(segmentsOf('npm run test:e', scripts), ['node --test test/a.js']);
  assert.deepEqual(segmentsOf('npm run missing', scripts), ['npm run missing']);
  // state carried between parts, quoting and npm pre/post hooks keep the item whole
  const stateful = {
    'test:cd': 'cd sub && node a.js',
    'test:env': 'FOO=1 && node a.js',
    'test:quote': 'node -e "a && b" && node c.js',
    'test:hooked': 'node a.js && node b.js',
    'pretest:hooked': 'node pre.js',
  };
  for (const name of ['test:cd', 'test:env', 'test:quote', 'test:hooked']) {
    assert.deepEqual(segmentsOf(`npm run ${name}`, stateful), [`npm run ${name}`]);
  }
});

test('the shard runner fails the item that leaks, names the segment, and stops at the first failure', async () => {
  const { runItem } = await import(pathToFileURL(SHARDS).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-root-'));
  try {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          'test:leak': `echo ok && (sleep ${LEAK_SECONDS} &) ; true`,
          'test:split': 'echo ok && node leak.js && touch after-leak',
          'test:ok': 'true && true',
        },
      }),
    );
    fs.writeFileSync(
      path.join(root, 'leak.js'),
      `require('node:child_process').spawn('sleep', ['${LEAK_SECONDS}'], { detached: true, stdio: 'ignore' }).unref();`,
    );
    assert.equal(runItem('npm run test:ok', { root, allowlist: {}, settleMs: 200 }).ok, true);
    // `;` keeps test:leak whole, so the whole item is the supervised segment
    assert.equal(runItem('npm run test:leak', { root, allowlist: {}, settleMs: 200 }).ok, false);
    const split = runItem('npm run test:split', { root, allowlist: {}, settleMs: 200 });
    assert.equal(split.ok, false);
    assert.equal(fs.existsSync(path.join(root, 'after-leak')), false, 'later segments must not run after a leak');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Regression: the scan once returned EVERY readable process (the token was never compared), and the reaper then
// SIGKILLed the whole user session. Matching must be by token only, and the reaper must never signal itself, its
// ancestors, pid 0 or pid 1, whatever a scan returned.
test('the orphan scan matches only processes that carry the token, and the reaper never signals protected pids', async () => {
  const { findTagged, reapOrphans, TOKEN_VAR } = await import(pathToFileURL(ORPHANS).href);
  const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-proc-'));
  const entry = (pid, environ, state = 'S') => {
    fs.mkdirSync(path.join(proc, String(pid)));
    fs.writeFileSync(path.join(proc, String(pid), 'environ'), environ);
    fs.writeFileSync(path.join(proc, String(pid), 'stat'), `${pid} (x) ${state} 1 1 1 0`);
    fs.writeFileSync(path.join(proc, String(pid), 'cmdline'), `cmd${pid}\0`);
  };
  const sent = [];
  const realKill = process.kill;
  try {
    entry(900_001, `A=1\0${TOKEN_VAR}=tok\0`);
    entry(900_002, 'A=1\0B=2\0');
    entry(900_003, `${TOKEN_VAR}=other\0`);
    entry(900_004, `X${TOKEN_VAR}=tok\0`);
    entry(900_005, `${TOKEN_VAR}=tok\0`, 'Z');
    assert.deepEqual(
      findTagged('tok', proc).map((p) => p.pid),
      [900_001],
    );

    process.kill = (pid, signal) => sent.push([pid, signal]);
    reapOrphans([{ pid: process.pid }, { pid: process.ppid }, { pid: 1 }, { pid: 0 }, { pid: -1 }, { pid: 900_001 }]);
    assert.deepEqual(sent, [[900_001, 'SIGKILL']]);
  } finally {
    process.kill = realKill;
    fs.rmSync(proc, { recursive: true, force: true });
  }
});

// Every tracked test file must be run by some suite step: the partition proof alone says nothing about files that no
// script names. The allowlist is the only exemption and every entry needs a reason.
const coverage = async () => import(pathToFileURL(SHARDS).href);
const COVERAGE_FILES = ['test/test-listed.js', 'test/test-unlisted.js', 'test/sub/other.test.cjs', 'test/helpers/h.js', 'README.md'];
const COVERAGE_SCRIPTS = {
  test: 'npm run test:a',
  'test:a': 'node test/test-listed.js && npm run test:b',
  'test:b': 'node test/sub/other.test.cjs && npm run test:a',
};

test('coverage: a tracked test file that no suite step references fails with its path; helpers are not tests', async () => {
  const { testCoverageProblems } = await coverage();
  const result = testCoverageProblems({ files: COVERAGE_FILES, items: ['npm run test:a'], scripts: COVERAGE_SCRIPTS, allowlist: {} });
  assert.deepEqual(result.problems, ['not run by any suite step: test/test-unlisted.js']);
  assert.equal(result.count, 3);
});

test('coverage: an allowlist entry needs a reason, a tracked file and a file that is really unreferenced', async () => {
  const { testCoverageProblems, loadTestAllowlist } = await coverage();
  const run = (allowlist) =>
    testCoverageProblems({ files: COVERAGE_FILES, items: ['npm run test:a'], scripts: COVERAGE_SCRIPTS, allowlist });
  assert.deepEqual(run({ 'test/test-unlisted.js': 'needs a database the CI does not have' }).problems, []);
  assert.match(run({ 'test/gone.js': 'x' }).problems.join('\n'), /not tracked: test\/gone\.js/);
  assert.match(run({ 'test/test-listed.js': 'x' }).problems.join('\n'), /already runs: test\/test-listed\.js/);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'test-allow-')), 'a.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ 'test/test-unlisted.js': ' ' }));
    assert.throws(() => loadTestAllowlist(file), /needs a reason/);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
  assert.deepEqual(loadTestAllowlist(), {}, 'the shipped test allowlist stays empty: unrun tests are wired in, not listed');
});

test('coverage: verify run end to end in a fixture repo fails on an unreferenced tracked test and passes once allowlisted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-coverage-'));
  try {
    const write = (name, content) => {
      fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      fs.writeFileSync(path.join(directory, name), content);
    };
    write('package.json', JSON.stringify({ scripts: { test: 'node test/test-a.js' } }));
    write('test/test-a.js', '');
    write('test/test-b.js', '');
    write('.github/scripts/ci-test-shard-weights.json', '{}');
    write('.github/scripts/suite-test-allowlist.json', '{}');
    for (const name of ['ci-test-shards.mjs', 'suite-orphans.mjs']) {
      fs.copyFileSync(path.join(ROOT, '.github/scripts', name), path.join(directory, '.github/scripts', name));
    }
    const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    const verify = () => {
      try {
        return {
          ok: true,
          output: execFileSync('node', [path.join(directory, '.github/scripts/ci-test-shards.mjs'), 'verify', '--shards', '1'], {
            encoding: 'utf8',
            stdio: 'pipe',
          }),
        };
      } catch (error) {
        return { ok: false, output: String(error.stderr) };
      }
    };
    const failing = verify();
    assert.equal(failing.ok, false);
    assert.match(failing.output, /not run by any suite step: test\/test-b\.js/);
    assert.doesNotMatch(failing.output, /test-a\.js/);
    write('.github/scripts/suite-test-allowlist.json', JSON.stringify({ 'test/test-b.js': 'fixture: intentionally not run' }));
    assert.equal(verify().ok, true);
    write('.github/scripts/suite-test-allowlist.json', JSON.stringify({ 'test/test-b.js': '' }));
    assert.equal(verify().ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('coverage: a path is referenced only as a whole token, and fixtures, helpers and journeys are never tests', async () => {
  const { testCoverageProblems, referencesPath, isTestFile } = await coverage();
  assert.equal(referencesPath('node test/test-zz.json', 'test/test-zz.js'), false);
  assert.equal(referencesPath('node test/test-zz.js', 'test/test-zz.js'), true);
  assert.equal(referencesPath('node --test "test/a.js";x', 'test/a.js'), true);
  assert.equal(referencesPath('node xtest/a.js', 'test/a.js'), false);
  const prefix = testCoverageProblems({
    files: ['test/test-zz.js', 'test/test-zz.json'],
    items: ['node test/test-zz.json'],
    scripts: {},
    allowlist: {},
  });
  assert.deepEqual(prefix.problems, ['not run by any suite step: test/test-zz.js']);
  for (const excluded of ['test/fixtures/test-a.js', 'test/helpers/test-a.js', 'test/journeys/test-a.js', 'test/fixtures/x.test.js']) {
    assert.equal(isTestFile(excluded), false, excluded);
  }
  assert.equal(isTestFile('test/sub/test-a.mjs'), true);
  const excluded = testCoverageProblems({
    files: ['test/fixtures/test-a.js', 'test/journeys/test-b.js'],
    items: [],
    scripts: {},
    allowlist: {},
  });
  assert.deepEqual(excluded, { problems: [], count: 0 });
});
