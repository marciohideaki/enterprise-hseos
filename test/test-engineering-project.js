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
  const [check] = evidence.verification.evidence.command_checks;
  assert.deepEqual(
    { command_id: check.command_id, status: check.status, exit_code: check.exit_code },
    { command_id: 'check', status: 'failed', exit_code: 3 },
  );
  // Measured resource use is evidence, not part of the pinned review event.
  assert.ok(check.pids_peak >= 1 && check.memory_peak_bytes > 0 && check.limits.processes === 32);
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

const { pnpmProject } = require('./helpers/pnpm-store');

test('a native test runner from a pnpm virtual store gates approval inside the isolated executor', async (t) => {
  const f = pnpmProject(t, { limits: { pids_max: 64, memory_max_bytes: 536_870_912, nofile: 256 } });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  const { verification } = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
  const [check] = verification.evidence.command_checks;
  assert.equal(check.command_id, 'native');
  assert.equal(check.exit_code, 0);
  // The measured peaks and the effective limits are part of the evidence.
  assert.ok(Number.isInteger(check.pids_peak) && check.pids_peak >= 2 && check.pids_peak <= 64, `pids_peak ${check.pids_peak}`);
  assert.ok(check.memory_peak_bytes > 0 && check.memory_peak_bytes <= 536_870_912, `memory ${check.memory_peak_bytes}`);
  assert.equal(check.limits.processes, 64);
  assert.equal(check.limits.memory_bytes, 536_870_912);
  assert.equal(check.limits.nofile, 256);
  // The sandbox received the store files at their declared paths, resolved through symlinks.
  const workspace = path.join(result.state, 'workspace');
  assert.ok(fs.existsSync(path.join(workspace, 'node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-assert/index.js')));
  assert.equal(fs.readFileSync(path.join(f.root, 'src/sum.js'), 'utf8'), 'module.exports = (a, b) => a + b;\n');
});

test('a failing native test run rejects the delivery even when the module probe passes', async (t) => {
  // The probe sums 2 + 3 with the right result for 5 only; the native suite also checks zero.
  const f = pnpmProject(t, { sum: 'module.exports = (a, b) => (a === 0 && b === 0 ? 1 : a + b);\n' });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'failed', JSON.stringify(result));
  const { verification } = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
  assert.equal(verification.evidence.command_checks[0].exit_code, 1);
});

test('a read-only pnpm store mount lets a native runner reach its dependencies without copying them into the task', async (t) => {
  const f = pnpmProject(t, { mounted: true, limits: { pids_max: 64, memory_max_bytes: 536_870_912, nofile: 256 } });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  const { verification, contract } = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
  const [check] = verification.evidence.command_checks;
  assert.equal(check.exit_code, 0);
  assert.ok(check.pids_peak >= 2 && check.memory_peak_bytes > 0);
  assert.equal(contract.workspace.store_mount, 'pnpm-virtual-store');
  assert.deepEqual(contract.initial_files.map((file) => file.path).sort(), ['scripts/run-native.cjs', 'src/sum.js', 'test/sum.test.js']);
  const modules = path.join(result.state, 'workspace', 'node_modules');
  assert.equal(fs.readlinkSync(path.join(modules, '.pnpm')), '/opt/hseos/pnpm-store');
  assert.equal(fs.readlinkSync(path.join(modules, 'mini-test')), '.pnpm/mini-test@1.0.0/node_modules/mini-test');
});

test('a failing native suite behind the store mount rejects the delivery', async (t) => {
  const f = pnpmProject(t, { mounted: true, sum: 'module.exports = (a, b) => (a === 0 && b === 0 ? 1 : a + b);\n' });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'failed', JSON.stringify(result));
});

test('a store mount over an unsafe store blocks the task before any model turn', async (t) => {
  const f = pnpmProject(t, { mounted: true });
  fs.symlinkSync('/etc', path.join(f.root, 'node_modules/.pnpm/mini-test@1.0.0/node_modules/leak'));
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'blocked', JSON.stringify(result));
});

function paddedStoreProject(t, { count = 20, size = 60_000 } = {}) {
  const f = pnpmProject(t);
  for (let index = 0; index < count; index += 1) {
    const relative = `node_modules/.pnpm/pad@1.0.0/node_modules/pad/f${index}.js`;
    fs.mkdirSync(path.dirname(path.join(f.root, relative)), { recursive: true });
    fs.writeFileSync(path.join(f.root, relative), `${'x'.repeat(size - 1)}\n`);
    f.contract.scope.read.push(relative);
  }
  f.git('add', '.');
  f.git('commit', '-m', 'padding');
  f.contract.baseline_sha = f.git('rev-parse', 'HEAD');
  f.contract.max_artifact_bytes = 2_097_152;
  f.seal();
  f.save();
  return f;
}

test('more than 1 MiB of project files is accepted when the contract carries store paths, and refused without them', async (t) => {
  const withStore = paddedStoreProject(t);
  const loaded = readEngineeringTask(withStore.filename);
  assert.ok(loaded.contract.initial_files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) > 1_048_576);
  const responses = path.join(withStore.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const result = await runEngineeringTask({ taskContract: withStore.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));

  // The same bytes as ordinary files, with no store path anywhere in the contract, keep the original 1 MiB ceilings.
  const plain = fixture(t);
  const padding = Array.from({ length: 20 }, (_, index) => `pad${index}.js`);
  for (const name of padding) fs.writeFileSync(path.join(plain.root, name), `${'x'.repeat(59_999)}\n`);
  execFileSync('git', ['-C', plain.root, 'add', '.']);
  execFileSync('git', ['-C', plain.root, 'commit', '-q', '-m', 'padding']);
  plain.contract.baseline_sha = execFileSync('git', ['-C', plain.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  plain.contract.scope.read.push(...padding);
  plain.contract.max_artifact_bytes = 2_097_152;
  plain.contract.workspace.files_sha256 = projectWorkspaceSnapshot(plain.contract).sha256;
  plain.contract.verifier.sha256 = projectVerifierDigest(plain.contract);
  plain.save();
  assert.throws(() => readEngineeringTask(plain.filename), { code: 'ENGINEERING_TASK_CONTRACT_INVALID' });
  plain.contract.max_artifact_bytes = 1_048_576;
  plain.contract.verifier.sha256 = projectVerifierDigest(plain.contract);
  plain.save();
  assert.throws(
    () => readEngineeringTask(plain.filename),
    { code: 'ENGINEERING_TASK_CONTRACT_INVALID' },
    'the 1 MiB budget refuses the same bytes at snapshot time',
  );
});

test('a command the model invokes sees the same read-only store mount as the protected verifier', async (t) => {
  const f = pnpmProject(t, { mounted: true });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, JSON.stringify([{ name: 'engineering.command', input: { id: 'native' } }]));
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  const handle = require('../tools/mcp-project-state/lib/execution-ledger-schema').openExecutionLedgerFileFixture(result.state);
  try {
    const { RelationalSessionEventStore } = require('../packages/agent-session-store');
    const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
    const session = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }).replay(result.session_id);
    const invocation = Object.values(session.tool_invocations).find((entry) => entry.name === 'engineering.command');
    assert.equal(invocation.outcome.status, 'succeeded', JSON.stringify(invocation.outcome));
    assert.match(JSON.stringify(invocation.outcome), /ok adds two numbers/, 'the runner ran against the mounted dependencies');
  } finally {
    handle.close();
  }
});

test('a store changed after assembly stops a model-invoked command before it runs', async (t) => {
  const f = pnpmProject(t, { mounted: true });
  const secret = path.join(f.directory, 'private-key');
  fs.writeFileSync(secret, 'TOPSECRET-D\n');
  const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
  const original = EngineeringTaskState.prototype.append;
  let injected = false;
  t.mock.method(EngineeringTaskState.prototype, 'append', function (event, version) {
    const receipt = original.call(this, event, version);
    if (event.kind === 'execution_started' && !injected) {
      injected = true;
      fs.linkSync(secret, path.join(f.root, 'node_modules/.pnpm/mini-test@1.0.0/late.js'));
    }
    return receipt;
  });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, JSON.stringify([{ name: 'engineering.command', input: { id: 'native' } }]));
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(injected, true);
  assert.notEqual(result.task_result, 'approved', JSON.stringify(result));
  const handle = require('../tools/mcp-project-state/lib/execution-ledger-schema').openExecutionLedgerFileFixture(result.state);
  try {
    const { RelationalSessionEventStore } = require('../packages/agent-session-store');
    const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
    const session = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }).replay(result.session_id);
    const invocation = Object.values(session.tool_invocations).find((entry) => entry.name === 'engineering.command');
    assert.notEqual(invocation.outcome?.status, 'succeeded', 'the command never ran against the changed store');
    assert.doesNotMatch(JSON.stringify(invocation.outcome), /ok adds two numbers/);
  } finally {
    handle.close();
  }
});

function driftFixture(t, name) {
  const f = pnpmProject(t, { mounted: true });
  const secret = path.join(f.directory, 'private-key');
  fs.writeFileSync(secret, `TOPSECRET-${name}\n`);
  const intrude = () => fs.linkSync(secret, path.join(f.root, `node_modules/.pnpm/mini-test@1.0.0/${name}.js`));
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, '[]');
  const reviews = async (result) => {
    const handle = require('../tools/mcp-project-state/lib/execution-ledger-schema').openExecutionLedgerFileFixture(result.state);
    try {
      const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
      return new EngineeringTaskState(handle.db, result.task_run_id).read().reviews;
    } finally {
      handle.close();
    }
  };
  return { f, intrude, responses, reviews };
}
const fromVerifier = () => new Error('trace').stack.includes('verifyEngineeringTask');

test('a store that changes while the verifier probe runs discards the probe result', async (t) => {
  const { f, intrude, responses, reviews } = driftFixture(t, 'probe');
  const original = fs.writeFileSync;
  let launches = 0;
  t.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    const result = original(file, ...rest);
    if (String(file).endsWith('/memory.swap.max') && fromVerifier() && ++launches === 1) intrude();
    return result;
  });
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(launches, 1, 'only the probe launched');
  assert.equal(result.task_result, 'failed', JSON.stringify(result));
  const [review] = await reviews(result);
  assert.equal(review.approved, false);
  assert.equal(review.reason, 'store-drift');
  assert.equal(review.command_checks, undefined, 'the acceptance command never ran');
});

test('a store that changes while an acceptance command runs discards that command result', async (t) => {
  const { f, intrude, responses, reviews } = driftFixture(t, 'during');
  const original = fs.writeFileSync;
  let launches = 0;
  t.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    const result = original(file, ...rest);
    if (String(file).endsWith('/memory.swap.max') && fromVerifier() && ++launches === 2) intrude();
    return result;
  });
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(launches, 2, 'the probe and the acceptance command launched');
  assert.equal(result.task_result, 'failed', JSON.stringify(result));
  const [review] = await reviews(result);
  assert.equal(review.command_checks[0].status, 'store_drift', 'a passing result is rejected when the store moved while it ran');
});

test('a store that changes between the probe and the acceptance command stops that command before it launches', async (t) => {
  const { f, intrude, responses, reviews } = driftFixture(t, 'between');
  const original = fs.writeFileSync;
  const clock = Date.now;
  let launches = 0;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    const result = original(file, ...rest);
    if (String(file).endsWith('/memory.swap.max') && fromVerifier()) launches += 1;
    return result;
  });
  // The first clock read made by the verifier itself after its probe returned, before the command guard.
  t.mock.method(Date, 'now', () => {
    if (launches === 1 && !injected && new Error('trace').stack.split('\n')[3].includes('at verifyEngineeringTask')) {
      injected = true;
      intrude();
    }
    return clock();
  });
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(injected, true);
  assert.equal(launches, 1, 'the acceptance command never launched');
  const [review] = await reviews(result);
  assert.equal(review.command_checks[0].status, 'store_drift');
});

test('a model-invoked command whose store changed while it ran returns no result', async (t) => {
  const f = pnpmProject(t, { mounted: true });
  const secret = path.join(f.directory, 'private-key');
  fs.writeFileSync(secret, 'TOPSECRET-F\n');
  const original = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    const result = original(file, ...rest);
    if (String(file).endsWith('/memory.swap.max') && new Error('trace').stack.includes('engineering-tools') && !injected) {
      injected = true;
      fs.linkSync(secret, path.join(f.root, 'node_modules/.pnpm/mini-test@1.0.0/model.js'));
    }
    return result;
  });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responses, JSON.stringify([{ name: 'engineering.command', input: { id: 'native' } }]));
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(injected, true);
  const handle = require('../tools/mcp-project-state/lib/execution-ledger-schema').openExecutionLedgerFileFixture(result.state);
  try {
    const { RelationalSessionEventStore } = require('../packages/agent-session-store');
    const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
    const session = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }).replay(result.session_id);
    const invocation = Object.values(session.tool_invocations).find((entry) => entry.name === 'engineering.command');
    assert.notEqual(invocation.outcome?.status, 'succeeded');
    assert.doesNotMatch(JSON.stringify(invocation.outcome), /ok adds two numbers/, 'the command output is not handed to the model');
  } finally {
    handle.close();
  }
});
