'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CONSTITUTION_PATH,
  EVIDENCE_PATH,
  digestConstitution,
  runManagedGovernanceSessionPreflight,
} = require('../../packages/managed-governance-client/session-preflight');

const REPOSITORY_ID = '7f9f9b79-638c-4138-9a29-8a2406ad9fb8';
const CLOCK = () => new Date('2026-09-01T12:00:00.000Z');

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-session-preflight-'));
  fs.mkdirSync(path.join(root, '.agents', 'capabilities'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'capabilities', 'components.yaml'), 'schema_version: 1\n');
  fs.writeFileSync(
    path.join(root, 'repository-contract.yaml'),
    `schema_version: repository-contract/v1\nrepository_id: ${REPOSITORY_ID}\nidentity:\n  remotes:\n    - example.test/repository\ncapabilities:\n  manifest: .agents/capabilities/components.yaml\n`,
  );
  fs.mkdirSync(path.join(root, '.hseos', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.hseos', 'config', 'managed-governance.json'),
    '{"schema_version":1,"mode":"managed-shadow","endpoint":"http://127.0.0.1:4319"}\n',
  );
  fs.writeFileSync(
    path.join(root, '.hseos', 'config', 'managed-governance-binding.json'),
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
  const constitution = '# Constitution\r\n\r\nLocal authority.\r\n';
  fs.mkdirSync(path.join(root, path.dirname(CONSTITUTION_PATH)), { recursive: true });
  fs.writeFileSync(path.join(root, CONSTITUTION_PATH), constitution);
  return { root, digest: digestConstitution(constitution) };
}

function remoteContext(digest, repositoryId = REPOSITORY_ID) {
  return {
    mode: 'managed-shadow',
    repository_id: repositoryId,
    source_commit: 'a'.repeat(40),
    artifacts: [{ source_path: CONSTITUTION_PATH.split(path.sep).join('/'), content_digest: digest }],
  };
}

test('session preflight reports equivalence and atomically persists bounded evidence', async (context) => {
  const fixture = createProject();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = await runManagedGovernanceSessionPreflight({
    projectRoot: fixture.root,
    clock: CLOCK,
    queryAdapter: { getEffectiveGovernanceContext: async () => remoteContext(fixture.digest) },
  });
  assert.equal(result.status, 'equivalent');
  assert.equal(result.reason_code, 'managed_shadow.constitution_equivalent');
  assert.equal(result.blocking, false);
  assert.equal(result.authoritative_source, 'local');
  assert.equal(result.constitution.matched, true);
  assert.equal(result.evidence_path, EVIDENCE_PATH.split(path.sep).join('/'));
  const evidenceFile = path.join(fixture.root, EVIDENCE_PATH);
  assert.deepEqual(JSON.parse(fs.readFileSync(evidenceFile, 'utf8')), result);
  assert.equal(fs.statSync(evidenceFile).mode & 0o077, 0);
});

test('session preflight accepts the bounded full catalog projection', async (context) => {
  const fixture = createProject();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const remote = remoteContext(fixture.digest);
  remote.artifacts.push(
    ...Array.from({ length: 275 }, (_, index) => ({
      source_path: `.enterprise/policies/policy-${index}.md`,
      content_digest: `sha256:${'b'.repeat(64)}`,
    })),
  );
  const result = await runManagedGovernanceSessionPreflight({
    projectRoot: fixture.root,
    persist: false,
    clock: CLOCK,
    queryAdapter: { getEffectiveGovernanceContext: async () => remote },
  });
  assert.equal(result.status, 'equivalent');
});

test('session preflight distinguishes digest and repository identity drift', async (context) => {
  const fixture = createProject();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const digestDrift = await runManagedGovernanceSessionPreflight({
    projectRoot: fixture.root,
    persist: false,
    clock: CLOCK,
    queryAdapter: { getEffectiveGovernanceContext: async () => remoteContext(`sha256:${'b'.repeat(64)}`) },
  });
  assert.equal(digestDrift.status, 'drift_detected');
  assert.equal(digestDrift.reason_code, 'managed_shadow.constitution_drift');
  const identityDrift = await runManagedGovernanceSessionPreflight({
    projectRoot: fixture.root,
    persist: false,
    clock: CLOCK,
    queryAdapter: {
      getEffectiveGovernanceContext: async () => remoteContext(fixture.digest, '11111111-1111-4111-8111-111111111111'),
    },
  });
  assert.equal(identityDrift.status, 'drift_detected');
  assert.equal(identityDrift.reason_code, 'managed_shadow.repository_identity_drift');
});

test('session preflight degrades remote failures and malformed projections without blocking', async (context) => {
  const fixture = createProject();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  for (const queryAdapter of [
    {
      getEffectiveGovernanceContext: async () => {
        throw new Error('secret transport detail');
      },
    },
    { getEffectiveGovernanceContext: async () => ({ repository_id: REPOSITORY_ID, artifacts: [] }) },
    {
      getEffectiveGovernanceContext: async () => ({
        repository_id: REPOSITORY_ID,
        artifacts: [
          { source_path: CONSTITUTION_PATH, content_digest: fixture.digest },
          { source_path: CONSTITUTION_PATH, content_digest: fixture.digest },
        ],
      }),
    },
  ]) {
    const result = await runManagedGovernanceSessionPreflight({ projectRoot: fixture.root, persist: false, clock: CLOCK, queryAdapter });
    assert.equal(result.status, 'remote_unavailable');
    assert.equal(result.reason_code, 'managed_shadow.remote_unavailable');
    assert.equal(result.blocking, false);
    assert.doesNotMatch(JSON.stringify(result), /secret transport detail/);
  }
});

test('session preflight fails local identity divergence before querying remote', async (context) => {
  const fixture = createProject();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const bindingPath = path.join(fixture.root, '.hseos', 'config', 'managed-governance-binding.json');
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  binding.repository_id = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(bindingPath, `${JSON.stringify(binding)}\n`);
  let queried = false;
  const result = await runManagedGovernanceSessionPreflight({
    projectRoot: fixture.root,
    persist: false,
    clock: CLOCK,
    queryAdapter: { getEffectiveGovernanceContext: async () => (queried = true) },
  });
  assert.equal(result.status, 'invalid_local_contract');
  assert.equal(result.reason_code, 'managed_shadow.local_contract_invalid');
  assert.equal(queried, false);
});

test('session preflight rejects an unsafe query configuration before network access', async (context) => {
  const fixture = createProject();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(fixture.root, '.hseos', 'config', 'managed-governance.json'),
    '{"schema_version":1,"mode":"managed-shadow","endpoint":"https://external.example"}\n',
  );
  let queried = false;
  const result = await runManagedGovernanceSessionPreflight({
    projectRoot: fixture.root,
    persist: false,
    clock: CLOCK,
    queryAdapter: { getEffectiveGovernanceContext: async () => (queried = true) },
  });
  assert.equal(result.status, 'invalid_local_contract');
  assert.equal(queried, false);
});

test('session preflight rejects invalid UTF-8 Constitution bytes before network access', async (context) => {
  const fixture = createProject();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.root, CONSTITUTION_PATH), Buffer.from([0xc3, 0x28]));
  let queried = false;
  const result = await runManagedGovernanceSessionPreflight({
    projectRoot: fixture.root,
    persist: false,
    clock: CLOCK,
    queryAdapter: { getEffectiveGovernanceContext: async () => (queried = true) },
  });
  assert.equal(result.status, 'invalid_local_contract');
  assert.equal(queried, false);
});

test('session preflight never creates evidence through a symlinked runtime ancestor', async (context) => {
  const fixture = createProject();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-session-preflight-external-'));
  context.after(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  });
  fs.symlinkSync(external, path.join(fixture.root, '.hseos', 'state'));
  await assert.rejects(
    runManagedGovernanceSessionPreflight({
      projectRoot: fixture.root,
      clock: CLOCK,
      queryAdapter: { getEffectiveGovernanceContext: async () => remoteContext(fixture.digest) },
    }),
    /evidence directory is unsafe/,
  );
  assert.deepEqual(fs.readdirSync(external), []);
});

test('session preflight reports an unconfigured project without network access', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-session-preflight-empty-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await runManagedGovernanceSessionPreflight({ projectRoot: root, persist: false, clock: CLOCK });
  assert.equal(result.status, 'not_configured');
  assert.equal(result.reason_code, 'managed_shadow.not_configured');
});
