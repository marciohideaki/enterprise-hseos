'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, mock } = require('node:test');
const childProcess = require('node:child_process');

// Inject only failed subprocess receipts. Real isolation is exercised in the transitive suite.
const spawn = mock.method(childProcess, 'spawnSync');
const {
  createIsolationPolicy,
  runTransitiveIsolationJourney,
  prepareIsolatedExecution,
} = require('../packages/agent-isolation-attestation');
mock.restoreAll();

function fixture(context) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-witness-fault-'));
  context.after(() => fs.rmSync(main, { recursive: true, force: true }));
  const workspace = path.join(main, 'workspace');
  fs.mkdirSync(workspace);
  const marker = path.join(main, 'protected');
  fs.writeFileSync(marker, 'protected');
  const input = { backend: 'bwrap', host_workspace: workspace, main_checkout: main, protected_paths: [marker] };
  return { main, workspace, marker, input, policy: createIsolationPolicy(input) };
}

function witness(args) {
  const environment = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--setenv') environment[args[index + 1]] = args[index + 2];
  }
  return [
    'HSEOS_ATTESTATION_V1',
    `ACTOR=${environment.HSEOS_ACTOR_TYPE}`,
    `CHALLENGE=${environment.HSEOS_CHALLENGE}`,
    'PID=2',
    'PPID=1',
    'CWD=/workspace',
    'PROTECTED=denied',
    'WRITE=allowed',
    'NETWORK=denied',
    'SOCKET_SYSCALL=denied',
    'IO_URING=denied',
    'X32_ABI=killed',
    'ENVIRONMENT=HSEOS_ACTOR_TYPE,HSEOS_CHALLENGE,PATH,PWD,SHLVL,_,',
  ].join('\n');
}

test('malformed or overprivileged subprocess witnesses never certify isolation', (context) => {
  const { policy } = fixture(context);
  for (const alter of [
    () => null,
    () => 'x'.repeat(65_537),
    (text) => text.replace('HSEOS_ATTESTATION_V1', 'VERSION_0'),
    (text) => `${text}\nmalformed`,
    (text) => `${text}\nPID=2`,
    (text) => text.replace('PPID=1\n', ''),
    (text) => text.replace('ACTOR=root', 'ACTOR=other'),
    (text) => text.replace(/CHALLENGE=[^\n]+/, 'CHALLENGE=forged'),
    (text) => text.replace('PID=2', 'PID=3'),
    (text) => text.replace('PPID=1', 'PPID=9'),
    (text) => text.replace('CWD=/workspace', 'CWD=/'),
    ...['PROTECTED', 'NETWORK', 'SOCKET_SYSCALL', 'IO_URING'].map((key) => (text) => text.replace(`${key}=denied`, `${key}=reachable`)),
    (text) => text.replace('WRITE=allowed', 'WRITE=denied'),
    (text) => text.replace('X32_ABI=killed', 'X32_ABI=not_filtered'),
    (text) => text.replace('ENVIRONMENT=', 'ENVIRONMENT=SECRET,'),
  ]) {
    spawn.mock.mockImplementation((binary, args) => ({ status: 0, pid: 12_345, stdout: alter(witness(args)) }));
    assert.throws(() => runTransitiveIsolationJourney(policy), /sandbox/);
  }
  for (const result of [{ status: 1 }, { error: new Error('spawn failed'), status: 0 }, { status: 0, pid: NaN }]) {
    spawn.mock.mockImplementation(() => result);
    assert.throws(() => runTransitiveIsolationJourney(policy), { code: 'AGENT_ISOLATION_PROBE_FAILED' });
  }
});

test('policy input and execution commands fail closed before launching a process', (context) => {
  const { input, policy, main, workspace, marker } = fixture(context);
  for (const candidate of [
    null,
    [],
    Object.create(null),
    { ...input, backend: 'other' },
    { ...input, host_workspace: 'relative' },
    { ...input, host_workspace: path.join(main, 'missing') },
    { ...input, host_workspace: marker },
    { ...input, protected_paths: [marker, marker] },
    { ...input, protected_paths: ['relative'] },
    { ...input, protected_paths: [path.join(main, 'missing')] },
    { ...input, protected_paths: [workspace] },
    { ...input, protected_paths: [main] },
  ]) {
    assert.throws(() => createIsolationPolicy(candidate));
  }
  for (const command of [null, [], [1], ['echo', 'bad\0input']])
    assert.throws(() => prepareIsolatedExecution(policy, command), /invalid execution command/);
  assert.throws(() => prepareIsolatedExecution(structuredClone(policy), ['/bin/true']), /supervisor-owned/);
  const prepared = prepareIsolatedExecution(policy, ['/bin/true']);
  assert.ok(prepared.args.includes('--ro-bind'));
  fs.renameSync(workspace, `${workspace}-previous`);
  fs.mkdirSync(workspace);
  assert.throws(() => prepareIsolatedExecution(policy, ['/bin/true']), { code: 'AGENT_ISOLATION_BINDING_DRIFT' });
});

test('executor ownership cannot be inferred from missing or mismatched process facts', async () => {
  const { executorOwner, isExecutorOwnerAlive, reapExecutorOwner } = require('../packages/agent-isolation-attestation/executor');
  const owner = executorOwner();
  assert.equal(isExecutorOwnerAlive(owner), true);
  assert.equal(isExecutorOwnerAlive(null), true);
  assert.equal(isExecutorOwnerAlive({ ...owner, start_ticks: `${owner.start_ticks}0` }), false);
  assert.equal(isExecutorOwnerAlive({ ...owner, pid: 2_147_483_647 }), false);
  await assert.rejects(() => reapExecutorOwner(owner), /cannot be reconciled/);
  await assert.rejects(() => reapExecutorOwner({ ...owner, resource_parent: '/unknown' }), /cannot be reconciled/);
  await assert.rejects(() => reapExecutorOwner({ ...owner, pid: 2_147_483_647, start_ticks: 'invalid' }), /Invalid executor owner/);
});

for (const [label, target, replacement, expected] of [
  ['non-unified cgroup', '/proc/self/cgroup', '1:memory:/other', /unified cgroup/],
  ['missing controllers', 'cgroup.subtree_control', 'cpu', /controllers must already be delegated/],
  ['invalid process identity', `/proc/${process.pid}/stat`, '1 (worker) S', /Worker identity is unavailable/],
])
  test(`executor rejects ${label}`, (context) => {
    const { executorOwner } = require('../packages/agent-isolation-attestation/executor');
    const original = fs.readFileSync;
    context.mock.method(fs, 'readFileSync', function (filename, ...args) {
      return String(filename).endsWith(target) ? replacement : original.call(this, filename, ...args);
    });
    assert.throws(() => executorOwner(), expected);
  });
