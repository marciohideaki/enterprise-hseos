'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createEngineeringExample } = require('../tools/examples/engineering-task');
const { createEngineeringTools } = require('../tools/cli/lib/engineering-tools');
const { inspectReconciliation, readReconciliationDecision } = require('../tools/cli/lib/engineering-reconciliation');

function fixture(t, modify = () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-boundary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace');
  fs.mkdirSync(workspace);
  const contract = structuredClone(createEngineeringExample('addition').contract);
  modify(contract);
  // File tests exercise the workspace guard; this deliberately cannot attest execution.
  const policy = { host_workspace: workspace, policy_digest: 'file-boundary-test' };
  const options = { directory, contract, policy, deadline: Number.MAX_SAFE_INTEGER };
  return { directory, workspace, options, tools: createEngineeringTools(options) };
}
const execute = (tools, name, input) => tools.bundles.find((bundle) => bundle.definition.name === name).provider.execute(input, {});

test('engineering tools reject workspace substitution and forged execution policy', async (t) => {
  const f = fixture(t);
  assert.throws(() => createEngineeringTools({ ...f.options, policy: { host_workspace: f.directory } }), /Invalid engineering workspace/);
  assert.throws(() => createEngineeringTools({ ...f.options, deadline: 1.5 }), /Invalid engineering workspace/);
  await assert.rejects(() => execute(f.tools, 'engineering.command', { id: 'unauthorized' }), /not authorized/);
  await assert.rejects(() => execute(f.tools, 'engineering.command', { id: 'check' }));
  await f.tools.drain();
  assert.throws(() => f.tools.assertQuiescent(), { code: 'ENGINEERING_TEARDOWN_UNCERTAIN' });
  fs.renameSync(f.workspace, `${f.workspace}-old`);
  fs.mkdirSync(f.workspace);
  assert.throws(() => f.tools.snapshot(), /Workspace identity changed/);
});

test('scoped reads reject hard links, symbolic links, invalid UTF-8 and directories', (t) => {
  const f = fixture(t);
  const target = path.join(f.workspace, 'add.js');
  const external = path.join(f.directory, 'external');
  fs.writeFileSync(external, 'outside');
  const setups = [
    () => fs.linkSync(external, target),
    () => fs.symlinkSync(external, target),
    () => fs.writeFileSync(target, Buffer.from([255])),
    () => fs.mkdirSync(target),
  ];
  for (const setup of setups) {
    setup();
    assert.throws(() => f.tools.snapshot(), /safely read/);
    fs.rmSync(target, { recursive: true });
  }
  assert.deepEqual(f.tools.snapshot(), [{ path: 'add.js', content: null, sha256: null }]);
});

test('nested scope remains confined when its parent is replaced with a symlink', async (t) => {
  const f = fixture(t, (contract) => {
    contract.scope = { read: ['src/add.js'], write: ['src/add.js'] };
    contract.commands[0].entrypoint = 'src/add.js';
  });
  const parent = path.join(f.workspace, 'src');
  fs.mkdirSync(parent);
  const written = await execute(f.tools, 'engineering.write', { path: 'src/add.js', content: 'safe', expected_sha256: null });
  assert.equal(written.data.content, 'safe');
  fs.renameSync(parent, path.join(f.directory, 'moved'));
  fs.symlinkSync(path.join(f.directory, 'moved'), parent);
  assert.throws(() => f.tools.snapshot(), /unsafe parent/);
});

test('artifact budgets are aggregate and write preconditions cannot be bypassed', async (t) => {
  const f = fixture(t, (contract) => {
    contract.scope.read.push('second.js');
    contract.max_artifact_bytes = 5;
  });
  fs.writeFileSync(path.join(f.workspace, 'add.js'), 'abc');
  fs.writeFileSync(path.join(f.workspace, 'second.js'), 'def');
  assert.throws(() => f.tools.snapshot(), /Artifact budget exceeded/);
  fs.unlinkSync(path.join(f.workspace, 'second.js'));
  await assert.rejects(() => execute(f.tools, 'engineering.write', { path: 'add.js', content: 'x', expected_sha256: null }), {
    code: 'ENGINEERING_EFFECT_RECONCILIATION_REQUIRED',
  });
  const current = f.tools.snapshot()[0];
  await assert.rejects(
    () => execute(f.tools, 'engineering.write', { path: 'add.js', content: '123456', expected_sha256: current.sha256 }),
    /budget/,
  );
  await assert.rejects(() => execute(f.tools, 'engineering.read', { path: '../external' }), /outside/);
  await assert.rejects(() => execute(f.tools, 'engineering.diagnose', {}), /not configured/);
  const expired = createEngineeringTools({ ...f.options, deadline: 1 });
  await assert.rejects(() => execute(expired, 'engineering.read', { path: 'add.js' }), /duration budget/);
  f.tools.assertQuiescent();
});

test('decision reader accepts bounded explicit answers and rejects ambiguous files', (t) => {
  const f = fixture(t);
  const file = path.join(f.directory, 'decision.json');
  const answer = { report_sha256: 'a'.repeat(64), decision: 'continue-from-observed-state', answer: 'Reviewed observed state.' };
  fs.writeFileSync(file, JSON.stringify(answer));
  assert.deepEqual(readReconciliationDecision(file), answer);
  fs.writeFileSync(file, JSON.stringify({ task: answer }));
  assert.deepEqual(readReconciliationDecision(file, true), { task: answer });
  for (const bad of [
    { ...answer, answer: ' ' },
    { ...answer, approved: true },
    { ...answer, decision: 'retry-effect' },
  ]) {
    fs.writeFileSync(file, JSON.stringify(bad));
    assert.throws(() => readReconciliationDecision(file));
  }
  fs.writeFileSync(file, 'x'.repeat(16_385));
  assert.throws(() => readReconciliationDecision(file), /Invalid reconciliation/);
  fs.writeFileSync(file, JSON.stringify(answer));
  const link = path.join(f.directory, 'linked.json');
  fs.linkSync(file, link);
  assert.throws(() => readReconciliationDecision(file), /Invalid reconciliation/);
  fs.unlinkSync(link);
  fs.symlinkSync(file, link);
  assert.throws(() => readReconciliationDecision(link));
});

test('unknown owners, terminal tasks and exhausted budgets never permit automatic continuation', async () => {
  const contract = structuredClone(createEngineeringExample('addition').contract);
  const session = {
    session_id: 'session:boundary',
    current_sequence: 1,
    turn_order: [],
    turns: {},
    reconciliation_reserved_tokens: contract.limits.max_tokens,
    cancellation_request: null,
    terminal_event: null,
  };
  const state = {
    version: 1,
    created: { session_id: session.session_id, contract, contract_sha256: 'b'.repeat(64), deadline: 1 },
    owner: null,
    result: { approved: false },
  };
  const assembly = {
    sessionStore: { replay: () => session },
    tools: {
      snapshot() {
        assert.fail('owner not quiescent');
      },
    },
  };
  for (const owner of [null, { pid: Symbol('corrupt-owner') }]) {
    state.owner = owner;
    const { report } = await inspectReconciliation({ id: 'task:boundary', read: () => state }, assembly, () =>
      assert.fail('must not attest'),
    );
    assert.equal(report.prerequisites_verified, false);
    assert.ok(report.unresolved.includes('owner-not-quiescent'));
    assert.ok(report.unresolved.includes('terminal-or-cancelled'));
    assert.ok(report.unresolved.includes('budget-exhausted'));
    assert.equal(report.files, null);
  }
});
