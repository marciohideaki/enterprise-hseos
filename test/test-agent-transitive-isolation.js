'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const test = require('node:test');

const {
  AgentIsolationAttestationError,
  REQUIRED_ACTORS,
  createIsolationPolicy,
  runTransitiveIsolationJourney,
} = require('../packages/agent-isolation-attestation');

function fixture() {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-isolation-main-'));
  const workspace = path.join(main, '.worktrees', 'task');
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const marker = path.join(main, 'main-checkout-marker');
  fs.writeFileSync(marker, 'must-not-cross');
  const policy = createIsolationPolicy({ backend: 'bwrap', host_workspace: workspace, main_checkout: main, protected_paths: [marker] });
  return { main, marker, policy, workspace };
}

test('five sandboxed process roles prove one transitive filesystem, network, and environment boundary', () => {
  const { main, marker, policy, workspace } = fixture();
  try {
    const result = runTransitiveIsolationJourney(policy);
    assert.equal(result.isolated, true);
    assert.deepEqual(
      result.witnesses.map((item) => item.actor_type),
      REQUIRED_ACTORS,
    );
    assert.equal(new Set(result.witnesses.map((item) => item.actor_id)).size, REQUIRED_ACTORS.length);
    assert.equal(new Set(result.witnesses.map((item) => item.launcher_pid)).size, REQUIRED_ACTORS.length);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'must-not-cross');
    assert.deepEqual(fs.readdirSync(workspace), []);
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('plain forged policies cannot invoke or claim the supervisor-owned journey', () => {
  const { main, policy } = fixture();
  try {
    assert.throws(() => runTransitiveIsolationJourney(structuredClone(policy)), AgentIsolationAttestationError);
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('a protected inode hard-linked into the worktree invalidates the binding before sandbox launch', () => {
  const { main, marker, policy, workspace } = fixture();
  try {
    fs.linkSync(marker, path.join(workspace, 'protected-alias'));
    assert.throws(
      () => runTransitiveIsolationJourney(policy),
      (error) => error instanceof AgentIsolationAttestationError && error.code === 'AGENT_ISOLATION_BINDING_DRIFT',
    );
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('a checkout root that overlaps required system mounts is rejected', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-isolation-root-overlap-'));
  try {
    assert.throws(
      () => createIsolationPolicy({ backend: 'bwrap', host_workspace: workspace, main_checkout: '/', protected_paths: ['/etc/passwd'] }),
      AgentIsolationAttestationError,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('a host Unix socket exposed inside the worktree fails before any sandbox role launches', async () => {
  const { main, policy, workspace } = fixture();
  const socketPath = path.join(workspace, 'authority.sock');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  try {
    assert.throws(
      () => runTransitiveIsolationJourney(policy),
      (error) => error instanceof AgentIsolationAttestationError && error.code === 'AGENT_ISOLATION_WORKSPACE_AUTHORITY',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('main checkout aliases, empty protection, unknown fields, and workspace protection fail closed', () => {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-isolation-invalid-'));
  const workspace = path.join(main, '.worktrees', 'task');
  fs.mkdirSync(workspace, { recursive: true });
  try {
    assert.throws(
      () => createIsolationPolicy({ backend: 'bwrap', host_workspace: main, main_checkout: main, protected_paths: [main] }),
      AgentIsolationAttestationError,
    );
    assert.throws(
      () => createIsolationPolicy({ backend: 'bwrap', host_workspace: workspace, main_checkout: main, protected_paths: [] }),
      AgentIsolationAttestationError,
    );
    assert.throws(
      () => createIsolationPolicy({ backend: 'bwrap', host_workspace: workspace, main_checkout: main, protected_paths: [workspace] }),
      AgentIsolationAttestationError,
    );
    assert.throws(
      () =>
        createIsolationPolicy({
          backend: 'bwrap',
          host_workspace: workspace,
          main_checkout: main,
          protected_paths: [main],
          extra: true,
        }),
      AgentIsolationAttestationError,
    );
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
  }
});
