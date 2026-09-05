'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { digestCanonical } = require('../../packages/managed-governance-contracts');
const { createManagedGovernanceClient, createSnapshotStore } = require('../../packages/managed-governance-client');
const { REPOSITORY_ID, decision, snapshot } = require('./client-fixtures');
const { CONSTITUTION_PATH, digestConstitution, runManagedGovernanceSessionPreflight } = require('../../packages/managed-governance-client/session-preflight');

function binding() {
  return {
    schema_version: 1,
    contract: 'managed-governance-binding/v1',
    binding_id: '00000000-0000-4000-8000-000000000010',
    mode: 'managed-shadow',
    repository_id: REPOSITORY_ID,
    organization_id: 'hideaki-solutions',
    control_plane_ref: 'governance-control-plane',
    issuer: 'performance-test',
    trusted_key_ids: ['test-key'],
    failure_policy: 'cached-fail-closed',
    max_snapshot_age_seconds: 86_400,
    created_at: '2026-09-01T00:00:00.000Z',
  };
}

function percentile95(samples) {
  const sorted = samples.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function response(data) {
  const envelope = { schema_version: 1, ok: true, data, error: null, evidence: [], warnings: [] };
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(envelope) };
}

test('cached shadow preflight stays below the 250 ms p95 budget on the reference fixture', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-performance-'));
  const candidateBinding = binding();
  const store = createSnapshotStore({
    snapshotPath: path.join(directory, 'snapshot.json'),
    clock: () => new Date('2026-09-01T01:00:00.000Z'),
  });
  store.promote(snapshot({ binding_digest: digestCanonical(candidateBinding) }));
  const client = createManagedGovernanceClient({
    binding: candidateBinding,
    repositoryId: REPOSITORY_ID,
    endpoint: 'https://governance.example.invalid',
    snapshotStore: store,
    clock: () => new Date('2026-09-01T01:00:00.000Z'),
    maximumRetries: 0,
    fetchImpl: async () => {
      throw new Error('reference offline path');
    },
  });
  try {
    const samples = [];
    for (let index = 0; index < 50; index += 1) {
      const started = performance.now();
      const result = await client.resolveShadow({
        localResult: { allowed: false },
        policyInput: { action: 'repository.push' },
      });
      samples.push(performance.now() - started);
      assert.equal(result.transport.status, 'degraded_snapshot');
    }
    assert.ok(percentile95(samples) <= 250, `cached p95 ${percentile95(samples).toFixed(2)} ms exceeded 250 ms`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('online shadow resolution stays below the 2 s p95 budget on the reference fixture', async () => {
  const client = createManagedGovernanceClient({
    binding: binding(),
    repositoryId: REPOSITORY_ID,
    endpoint: 'https://governance.example.invalid',
    snapshotStore: { load: () => null, promote: () => null },
    maximumRetries: 0,
    fetchImpl: async () => response(decision('deny')),
  });
  const samples = [];
  for (let index = 0; index < 50; index += 1) {
    const started = performance.now();
    const result = await client.resolveShadow({ localResult: { allowed: false }, policyInput: { ordinal: index } });
    samples.push(performance.now() - started);
    assert.equal(result.transport.status, 'online');
  }
  assert.ok(percentile95(samples) <= 2000, `online p95 ${percentile95(samples).toFixed(2)} ms exceeded 2000 ms`);
});

// NFR-006's 500 ms p95 budget covers the actual entry point every adapter's session-start hook
// calls -- runManagedGovernanceSessionPreflight's full local-vs-remote comparison and evidence
// persistence -- not just the lower-level client transport the two tests above already cover.
test('session preflight stays below the 500 ms p95 budget on the reference fixture', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-preflight-performance-'));
  const constitution = '# Constitution\n\nLocal authority.\n';
  const digest = digestConstitution(constitution);
  fs.mkdirSync(path.join(directory, '.agents', 'capabilities'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.agents', 'capabilities', 'components.yaml'), 'schema_version: 1\n');
  fs.writeFileSync(
    path.join(directory, 'repository-contract.yaml'),
    `schema_version: repository-contract/v1\nrepository_id: ${REPOSITORY_ID}\nidentity:\n  remotes:\n    - example.test/repository\ncapabilities:\n  manifest: .agents/capabilities/components.yaml\n`,
  );
  fs.mkdirSync(path.join(directory, '.hseos', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, '.hseos', 'config', 'managed-governance.json'),
    '{"schema_version":1,"mode":"managed-shadow","endpoint":"http://127.0.0.1:4319"}\n',
  );
  fs.writeFileSync(
    path.join(directory, '.hseos', 'config', 'managed-governance-binding.json'),
    `${JSON.stringify({
      schema_version: 1,
      contract: 'managed-governance-binding/v1',
      binding_id: '33333333-3333-4333-8333-333333333333',
      mode: 'managed-shadow',
      repository_id: REPOSITORY_ID,
      organization_id: 'example-organization',
      control_plane_ref: 'managed-control-plane-primary',
      issuer: 'example-governance',
      trusted_key_ids: ['governance-signing-2026'],
      failure_policy: 'cached-fail-closed',
      max_snapshot_age_seconds: 86_400,
      created_at: '2026-09-01T00:00:00Z',
    })}\n`,
  );
  fs.mkdirSync(path.join(directory, path.dirname(CONSTITUTION_PATH)), { recursive: true });
  fs.writeFileSync(path.join(directory, CONSTITUTION_PATH), constitution);
  const remote = { mode: 'managed-shadow', repository_id: REPOSITORY_ID, source_commit: 'a'.repeat(40), artifacts: [{ source_path: CONSTITUTION_PATH.split(path.sep).join('/'), content_digest: digest }] };
  try {
    const samples = [];
    for (let index = 0; index < 50; index += 1) {
      const started = performance.now();
      const result = await runManagedGovernanceSessionPreflight({
        projectRoot: directory,
        clock: () => new Date('2026-09-05T12:00:00.000Z'),
        queryAdapter: { getEffectiveGovernanceContext: async () => remote },
      });
      samples.push(performance.now() - started);
      assert.equal(result.status, 'equivalent');
    }
    assert.ok(percentile95(samples) <= 500, `session preflight p95 ${percentile95(samples).toFixed(2)} ms exceeded 500 ms`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
