'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { projectWorkspaceSnapshot } = require('../tools/cli/lib/engineering-workspace');
const { projectVerifierDigest, attestEngineeringVerifier } = require('../tools/cli/lib/engineering-project-verifier');
const { readEngineeringTask } = require('../tools/cli/lib/engineering-task-contract');
const { runEngineeringTask, inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
const base = require('./fixtures/engineering-task/addition.json');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const { fixture } = require('./helpers/engineering-project');

test('v2 snapshots a Git project and preserves its immutable input after external edits', (t) => {
  const f = fixture(t);
  const read = readEngineeringTask(f.filename);
  assert.equal(read.contract.initial_files.length, 1);
  assert.equal(read.contract.initial_files[0].sha256, sha('module.exports = (n) => n + 1;\n'));
  fs.writeFileSync(path.join(f.root, 'index.js'), 'changed');
  assert.throws(() => readEngineeringTask(f.filename), { code: 'ENGINEERING_TASK_CONTRACT_INVALID' });
  assert.equal(read.contract.initial_files[0].content, 'module.exports = (n) => n + 1;\n');
});

test('v2 refuses links, invalid UTF-8, changed Git baseline and embedded substitution', (t) => {
  for (const kind of ['symlink', 'hardlink', 'utf8', 'head', 'embedded']) {
    const f = fixture(t);
    const file = path.join(f.root, 'index.js');
    if (kind === 'symlink' || kind === 'hardlink') {
      fs.renameSync(file, file + '.original');
      fs[kind === 'symlink' ? 'symlinkSync' : 'linkSync'](file + '.original', file);
    }
    if (kind === 'utf8') fs.writeFileSync(file, Buffer.from([0xff]));
    if (kind === 'head') {
      f.contract.baseline_sha = '0'.repeat(40);
      f.save();
    }
    if (kind === 'embedded') {
      const content = 'fake';
      f.contract.initial_files = [{ path: 'index.js', content, sha256: sha(content) }];
      f.save();
    }
    assert.throws(() => readEngineeringTask(f.filename), { code: 'ENGINEERING_TASK_CONTRACT_INVALID' }, kind);
  }
});

test('project acceptance and verifier inputs cannot drift after pinning', (t) => {
  const f = fixture(t);
  attestEngineeringVerifier(f.contract);
  f.contract.verifier.checks[0].expected = 99;
  assert.throws(() => attestEngineeringVerifier(f.contract), /pinned/);
  f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  f.contract.acceptance[0].description = 'Changed acceptance';
  assert.throws(() => attestEngineeringVerifier(f.contract), /pinned/);
});

for (const scenario of [
  {
    name: 'Node multi-file',
    files: { 'index.js': "module.exports = require('./lib/calc.js');", 'lib/calc.js': 'module.exports = (n) => n + 1;' },
  },
  {
    name: 'TypeScript',
    files: { 'index.ts': 'function calculate(n: number): number { return n + 1; } module.exports = calculate;' },
    entry: 'index.ts',
  },
  {
    name: 'Python multi-file',
    files: {
      'main.py': 'from helpers import increment\ndef calculate(n): return increment(n)\n',
      'helpers.py': 'def increment(n): return n + 1\n',
    },
    entry: 'main.py',
    runtime: 'python',
  },
  {
    name: 'web static content',
    files: { 'index.html': '<h1>Project</h1>' },
    entry: 'index.html',
    reference: 'verifier://project/web-content-v1',
    expected: '<h1>Project</h1>',
    args: [],
  },
  { name: 'incorrect delivery', expected: 99, outcome: 'failed' },
]) {
  test(`protected verifier executes ${scenario.name} inside isolation`, async (t) => {
    const f = fixture(t, scenario);
    const responses = path.join(f.directory, 'responses.json');
    fs.writeFileSync(responses, '[]');
    const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
    t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
    assert.equal(result.task_result, scenario.outcome || 'approved', JSON.stringify(result));
    assert.equal(result.profile, 'managed-project');
    assert.equal((await inspectEngineeringTask({ state: result.state })).task_result, result.task_result);
    const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
    assert.equal(evidence.verification.evidence.descendants_terminated, true);
  });
}

test('project search, preconditioned patch and diff share governed task execution', async (t) => {
  const f = fixture(t, { files: { 'index.js': 'module.exports = n => n - 1;' } });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(
    responses,
    JSON.stringify([
      { name: 'engineering.search', input: { text: 'n - 1', limit: 10 } },
      {
        name: 'engineering.patch',
        input: { path: 'index.js', expected_sha256: sha('module.exports = n => n - 1;'), before: 'n - 1', after: 'n + 1' },
      },
      { name: 'engineering.diff', input: {} },
    ]),
  );
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  assert.equal(fs.readFileSync(path.join(f.root, 'index.js'), 'utf8'), 'module.exports = n => n - 1;');
  const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
  assert.equal(evidence.artifacts.files[0].content, 'module.exports = n => n + 1;');
});

function acceptanceCommandFixture(t, script, { duration } = {}) {
  const f = fixture(t, { files: { 'index.js': 'module.exports = (n) => n + 1;\n', 'check.js': script } });
  f.contract.commands = [{ id: 'check', runtime: 'node', entrypoint: 'check.js', args: [] }];
  f.contract.verifier.command_checks = [{ command_id: 'check' }];
  f.contract.verifier.protected_paths = ['check.js'];
  f.contract.scope.write = ['index.js'];
  if (duration) f.contract.limits.max_duration_ms = duration;
  f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  f.save();
  return f;
}

const ACCEPTANCE_COMMANDS = [
  { name: 'exit zero', script: 'process.exit(0);', outcome: 'approved', status: 'succeeded' },
  { name: 'exit one', script: 'process.exit(1);', outcome: 'failed', status: 'failed' },
  { name: 'missing module', script: "require('hseos-absent-test-runner');", outcome: 'failed', status: 'failed' },
  { name: 'killed by signal', script: "process.kill(process.pid, 'SIGKILL');", outcome: 'failed' },
  { name: 'timeout', script: 'setInterval(() => {}, 1000);', outcome: 'failed', duration: 8000 },
];
for (const scenario of ACCEPTANCE_COMMANDS) {
  test(`declared acceptance command (${scenario.name}) gates approval`, async (t) => {
    const f = acceptanceCommandFixture(t, scenario.script, scenario);
    const responses = path.join(f.directory, 'responses.json');
    fs.writeFileSync(responses, '[]');
    const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
    t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
    assert.equal(result.task_result, scenario.outcome, JSON.stringify(result));
    const { verification } = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
    const [check] = verification.evidence.command_checks || [];
    // A timeout may exhaust the task budget before the command result is recorded; it still rejects.
    if (!scenario.duration) assert.equal(check.command_id, 'check');
    if (scenario.status) assert.equal(check.status, scenario.status);
    if (check) assert.equal(scenario.outcome === 'approved', check.status === 'succeeded' && check.exit_code === 0);
  });
}

test('acceptance commands are pinned, declared and optional', (t) => {
  const f = acceptanceCommandFixture(t, 'process.exit(0);');
  attestEngineeringVerifier(f.contract);
  f.contract.commands[0].args = ['--other'];
  assert.throws(() => attestEngineeringVerifier(f.contract), /pinned/);
  f.contract.verifier.command_checks = [{ command_id: 'ghost' }];
  f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  assert.throws(() => attestEngineeringVerifier(f.contract), /pinned/);
  const plain = fixture(t);
  assert.equal(plain.contract.verifier.command_checks, undefined);
  assert.doesNotThrow(() => readEngineeringTask(plain.filename));
});

test('a workflow child with a failing acceptance command is not approved and blocks its dependents', async (t) => {
  const { runEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
  const failing = acceptanceCommandFixture(t, "require('hseos-absent-test-runner');");
  const passing = acceptanceCommandFixture(t, 'process.exit(0);');
  const own = failing.contract.limits;
  const limits = {
    ...own,
    max_turns: own.max_turns * 2,
    max_tokens: own.max_tokens * 2,
    max_tool_calls: own.max_tool_calls * 2,
    max_children: 2,
    max_workflow_steps: 2,
    max_duration_ms: 120_000,
  };
  const result = await runEngineeringWorkflow({
    definition: {
      schema_version: 1,
      workflow_id: 'workflow:acceptance-command',
      max_parallelism: 1,
      limits,
      tasks: [
        { id: 'typecheck', contract: failing.contract, responses: [], depends_on: [] },
        { id: 'vitest', contract: passing.contract, responses: [], depends_on: ['typecheck'] },
      ],
    },
  });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.notEqual(result.status, 'completed', JSON.stringify(result));
  assert.deepEqual(
    result.tasks.map((task) => task.result),
    ['failed', 'not_executed'],
  );
});

test('the model cannot rewrite the acceptance command: writable entrypoints or arguments are refused at parse', (t) => {
  const writable = acceptanceCommandFixture(t, 'process.exit(1);');
  writable.contract.scope.write = ['index.js', 'check.js'];
  writable.contract.verifier.sha256 = projectVerifierDigest(writable.contract);
  writable.save();
  assert.throws(() => readEngineeringTask(writable.filename), { code: 'ENGINEERING_TASK_CONTRACT_INVALID' });
  const unprotected = acceptanceCommandFixture(t, 'process.exit(1);');
  delete unprotected.contract.verifier.protected_paths;
  unprotected.save();
  assert.throws(() => readEngineeringTask(unprotected.filename), { code: 'ENGINEERING_TASK_CONTRACT_INVALID' });
  for (const arg of [
    './index.js',
    '--config=index.js',
    '--config=./index.js',
    '../project/index.js',
    '../outside.js',
    '--x=../../etc/passwd',
  ]) {
    const argument = acceptanceCommandFixture(t, 'process.exit(0);');
    argument.contract.commands[0].args = [arg];
    argument.save();
    assert.throws(() => readEngineeringTask(argument.filename), { code: 'ENGINEERING_TASK_CONTRACT_INVALID' }, arg);
  }
  const harmless = acceptanceCommandFixture(t, 'process.exit(0);');
  harmless.contract.commands[0].args = ['--timeout=5', 'check.js'];
  harmless.save();
  assert.doesNotThrow(() => readEngineeringTask(harmless.filename));
});

test('patching the protected acceptance script is refused and the delivery stays failed', async (t) => {
  const f = acceptanceCommandFixture(t, 'process.exit(1);');
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(
    responses,
    JSON.stringify([
      {
        name: 'engineering.patch',
        input: { path: 'check.js', expected_sha256: sha('process.exit(1);'), before: 'exit(1)', after: 'exit(0)' },
      },
    ]),
  );
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.notEqual(result.task_result, 'approved', JSON.stringify(result));
  assert.equal(fs.readFileSync(path.join(f.root, 'check.js'), 'utf8'), 'process.exit(1);');
});

test('transitive test files declared in protected_paths are pinned and verified before the command runs', async (t) => {
  const f = fixture(t, {
    files: { 'index.js': 'module.exports = (n) => n + 1;\n', 'check.js': "require('./suite.js');", 'suite.js': 'process.exit(0);' },
  });
  f.contract.commands = [{ id: 'check', runtime: 'node', entrypoint: 'check.js', args: [] }];
  f.contract.verifier.command_checks = [{ command_id: 'check' }];
  f.contract.verifier.protected_paths = ['check.js', 'suite.js'];
  f.contract.scope.write = ['index.js'];
  f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  f.save();
  const { verifyEngineeringTask } = require('../tools/cli/lib/engineering-project-verifier');
  const loaded = readEngineeringTask(f.filename).contract;
  const stale = loaded.initial_files.map((item) => (item.path === 'suite.js' ? { ...item, sha256: '1'.repeat(64) } : item));
  const verdict = await verifyEngineeringTask({ contract: loaded, policy: {}, deadline: Date.now() + 5000, files: stale });
  assert.equal(verdict.approved, false);
  assert.equal(verdict.reason, 'protected-files-changed');
  const missing = await verifyEngineeringTask({ contract: loaded, policy: {}, deadline: Date.now() + 5000 });
  assert.equal(missing.reason, 'protected-files-changed');
});

test('the review event and correction prompt name the failed acceptance command', async (t) => {
  const f = acceptanceCommandFixture(t, 'process.exit(3);');
  f.contract.max_failed_corrections = 1;
  f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  f.save();
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'failed', JSON.stringify(result));
  const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
  assert.deepEqual(evidence.verification.evidence.command_checks, [{ command_id: 'check', status: 'failed', exit_code: 3 }]);
  const state = JSON.stringify(await inspectEngineeringTask({ state: result.state, action: 'evidence' }));
  assert.match(state, /"exit_code":3/);
});

test('reconciliation inspection never replays acceptance commands', async (t) => {
  const f = acceptanceCommandFixture(t, 'process.exit(0);');
  const { verifyEngineeringTask } = require('../tools/cli/lib/engineering-project-verifier');
  const loaded = readEngineeringTask(f.filename).contract;
  const verdict = await verifyEngineeringTask({
    contract: loaded,
    policy: {},
    deadline: Date.now() + 5000,
    files: loaded.initial_files,
    runCommandChecks: false,
  });
  assert.equal(verdict.approved, false);
  assert.equal(verdict.reason, 'command-checks-not-run');
});

test('a real acceptance command timeout rejects while the task budget is still available', async (t) => {
  const f = acceptanceCommandFixture(t, 'setInterval(() => {}, 1000);', { duration: 60_000 });
  f.contract.verifier.command_checks = [{ command_id: 'check', timeout_ms: 1500 }];
  f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  f.save();
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'failed', JSON.stringify(result));
  const { verification } = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
  assert.equal(verification.evidence.command_checks[0].status, 'timed_out');
});
