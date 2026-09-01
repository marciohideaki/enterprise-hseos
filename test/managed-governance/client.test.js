'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { digestCanonical } = require('../../packages/managed-governance-contracts');
const {
  createManagedGovernanceClient,
  createSnapshotStore,
  loadManagedGovernanceBinding,
  readBoundedJson,
} = require('../../packages/managed-governance-client');
const { REPOSITORY_ID, decision, snapshot } = require('./client-fixtures');

let directory;
function binding(mode = 'managed-shadow') {
  return {
    schema_version: 1,
    contract: 'managed-governance-binding/v1',
    binding_id: '00000000-0000-4000-8000-000000000010',
    mode,
    repository_id: REPOSITORY_ID,
    organization_id: 'hideaki-solutions',
    control_plane_ref: 'governance-control-plane',
    issuer: 'governance-test',
    trusted_key_ids: ['test-key'],
    failure_policy: 'cached-fail-closed',
    max_snapshot_age_seconds: 86_400,
    created_at: '2026-09-01T00:00:00.000Z',
  };
}
function response(data) {
  const envelope = {
    schema_version: 1,
    ok: true,
    data,
    error: null,
    evidence: [],
    warnings: [],
  };
  return {
    ok: true,
    headers: { get: () => null },
    async text() {
      return JSON.stringify(envelope);
    },
  };
}
before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-client-'));
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('binding loader proves repository identity and rejects secret-bearing input before network access', () => {
  const bindingPath = path.join(directory, 'binding.json');
  fs.writeFileSync(bindingPath, JSON.stringify(binding()));
  const loaded = loadManagedGovernanceBinding({
    bindingPath,
    repositoryContractPath: path.resolve('repository-contract.yaml'),
    repositoryRoot: path.resolve('.'),
    expectedRepositoryId: REPOSITORY_ID,
  });
  assert.equal(loaded.binding.mode, 'managed-shadow');
  fs.writeFileSync(bindingPath, JSON.stringify({ ...binding(), bearer_token: 'forbidden' }));
  assert.throws(
    () =>
      loadManagedGovernanceBinding({
        bindingPath,
        repositoryContractPath: path.resolve('repository-contract.yaml'),
        repositoryRoot: path.resolve('.'),
        expectedRepositoryId: REPOSITORY_ID,
      }),
    /secret field/,
  );
  assert.throws(
    () => createManagedGovernanceClient({ binding: binding(), repositoryId: '00000000-0000-4000-8000-000000000099' }),
    /identity mismatch/,
  );
});

test('online shadow compares decisions while local authority remains unchanged', async () => {
  let calls = 0;
  const store = createSnapshotStore({ snapshotPath: path.join(directory, 'online.json') });
  const client = createManagedGovernanceClient({
    binding: binding(),
    repositoryId: REPOSITORY_ID,
    endpoint: 'https://governance.example.test',
    snapshotStore: store,
    fetchImpl: async () => {
      calls += 1;
      return response(decision('deny'));
    },
  });
  const result = await client.resolveShadow({ localResult: { allowed: true }, policyInput: { action: 'repository.push' } });
  assert.equal(result.result.allowed, true);
  assert.equal(result.parity.matched, false);
  assert.equal(result.transport.status, 'online');
  assert.equal(calls, 1);
});

test('valid last-known-good snapshot supports degraded shadow without blocking', async () => {
  const candidateBinding = binding();
  const bindingDigest = digestCanonical(candidateBinding);
  const store = createSnapshotStore({
    snapshotPath: path.join(directory, 'offline.json'),
    clock: () => new Date('2026-09-01T01:00:00.000Z'),
  });
  store.promote(snapshot({ binding_digest: bindingDigest }));
  const client = createManagedGovernanceClient({
    binding: candidateBinding,
    repositoryId: REPOSITORY_ID,
    endpoint: 'https://governance.example.test',
    snapshotStore: store,
    clock: () => new Date('2026-09-01T01:00:00.000Z'),
    maximumRetries: 0,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  const result = await client.resolveShadow({ localResult: { allowed: false }, policyInput: { action: 'repository.push' } });
  assert.equal(result.transport.status, 'degraded_snapshot');
  assert.equal(result.result.allowed, false);
  assert.equal(result.parity.matched, true);
});

test('reserved enforcement mode fails before network or cache access', async () => {
  let effects = 0;
  const client = createManagedGovernanceClient({
    binding: binding('managed-enforced'),
    repositoryId: REPOSITORY_ID,
    endpoint: 'https://governance.example.test',
    snapshotStore: {
      load() {
        effects += 1;
      },
    },
    fetchImpl: async () => {
      effects += 1;
    },
  });
  const result = await client.resolveShadow({ localResult: { allowed: true }, policyInput: {} });
  assert.equal(result.status, 'enforcement_unavailable');
  assert.equal(result.result.allowed, true);
  assert.equal(effects, 0);
});

test('bounded retries and circuit states produce typed degraded results', async () => {
  let calls = 0;
  const client = createManagedGovernanceClient({
    binding: binding(),
    repositoryId: REPOSITORY_ID,
    endpoint: 'https://governance.example.test',
    snapshotStore: {
      load() {
        const error = new Error('none');
        error.code = 'SNAPSHOT_NONE';
        throw error;
      },
    },
    maximumRetries: 1,
    circuitThreshold: 1,
    sleep: async () => {},
    random: () => 0,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('offline');
    },
  });
  const first = await client.resolveShadow({ localResult: { allowed: true }, policyInput: {} });
  const second = await client.resolveShadow({ localResult: { allowed: true }, policyInput: {} });
  assert.equal(calls, 2);
  assert.equal(first.transport.cause, 'circuit_opened');
  assert.equal(second.transport.cause, 'circuit_open');
  assert.deepEqual(client.getState(), { circuit: 'open', consecutive_failures: 1, opened_at: client.getState().opened_at });
});

test('timeout remains bounded when an injected transport ignores abort', async () => {
  const store = createSnapshotStore({ snapshotPath: path.join(directory, 'timeout.json') });
  const client = createManagedGovernanceClient({
    binding: binding(),
    repositoryId: REPOSITORY_ID,
    endpoint: 'https://governance.example.test',
    snapshotStore: store,
    timeoutMs: 100,
    maximumRetries: 0,
    fetchImpl: async () => new Promise(() => {}),
  });
  const startedAt = Date.now();
  const result = await client.resolveShadow({ localResult: { allowed: true }, policyInput: {} });
  assert.equal(result.transport.status, 'degraded_unavailable');
  assert.equal(result.transport.cause, 'query_failed');
  assert.ok(Date.now() - startedAt < 500);
});

test('chunked control-plane responses are bounded independently of content-length', async () => {
  const oversizedChunk = new Uint8Array(2 * 1024 * 1024 + 1);
  let consumed = false;
  const responseWithStream = {
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() {
            if (consumed) return { done: true, value: undefined };
            consumed = true;
            return { done: false, value: oversizedChunk };
          },
          async cancel() {},
        };
      },
    },
  };
  await assert.rejects(() => readBoundedJson(responseWithStream), /client limit/);
});
