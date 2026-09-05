'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { digestCanonical } = require('../../packages/managed-governance-contracts');
const { createSnapshotStore } = require('../../packages/managed-governance-client');
const { BINDING_DIGEST, REPOSITORY_ID, snapshot } = require('./client-fixtures');
const { verifyGovernanceSnapshot } = require('../../tools/managed-governance-control-plane/lib/application/verify-snapshot');
const { MemoryGovernanceRepository } = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { ImportCatalogService } = require('../../tools/managed-governance-control-plane/lib/application/import-catalog');
const { classifySource } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/classifiers');
const { planGovernanceRelease } = require('../../tools/managed-governance-control-plane/lib/application/plan-release');
const { publishGovernanceRelease, requestExternalSignature } = require('../../tools/managed-governance-control-plane/lib/application/publish-release');
let directory;
let snapshotPath;

before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-snapshot-'));
  snapshotPath = path.join(directory, '.hseos', 'state', 'snapshot.json');
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('promotion is atomic, private and digest-verified', () => {
  const store = createSnapshotStore({ snapshotPath, clock: () => new Date('2026-09-01T01:00:00.000Z') });
  const candidate = snapshot();
  const digest = digestCanonical(candidate);
  assert.deepEqual(store.promote(candidate, digest), { status: 'promoted', digest, snapshot_id: candidate.snapshot_id });
  assert.equal(fs.statSync(snapshotPath).mode & 0o077, 0);
  assert.equal(
    fs.readdirSync(path.dirname(snapshotPath)).some((name) => name.endsWith('.tmp')),
    false,
  );
  const loaded = store.load({ maximumAgeSeconds: 86_400, repositoryId: REPOSITORY_ID, bindingDigest: BINDING_DIGEST });
  assert.equal(loaded.status, 'valid');
  assert.equal(loaded.age_seconds, 3600);
  assert.throws(() => store.promote(candidate, `sha256:${'e'.repeat(64)}`), /digest/);
});

test('corrupt, expired and identity-mismatched snapshots are never valid', () => {
  const store = createSnapshotStore({ snapshotPath, clock: () => new Date('2026-09-03T00:00:00.000Z') });
  store.promote(snapshot());
  assert.throws(() => store.load({ maximumAgeSeconds: 86_400, repositoryId: REPOSITORY_ID, bindingDigest: BINDING_DIGEST }), /expired/);
  const envelope = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  envelope.snapshot.organization_id = 'tampered';
  fs.writeFileSync(snapshotPath, JSON.stringify(envelope));
  assert.throws(() => store.load({ maximumAgeSeconds: 86_400, repositoryId: REPOSITORY_ID, bindingDigest: BINDING_DIGEST }), /integrity/);
});

// --- Server-side verifyGovernanceSnapshot (T05, FR-005) --------------------------------
// Distinct from the client-side store above: this is the control plane confirming a release
// it actually published is still one it currently trusts, not the client's local cache logic.

function contentDigest(content) {
  return `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function discoveredSource(repositoryId) {
  const raw = '# Policy A\n';
  const normalized = raw.replaceAll(/\r\n?/g, '\n');
  const base = { source_path: 'policies/a.md', source_kind: 'policy', raw_content: raw, normalized_content: normalized, content_digest: contentDigest(normalized) };
  return {
    async discover() {
      return {
        schema_version: 1,
        repository_id: repositoryId,
        source_commit: 'a'.repeat(40),
        source_timestamp: '2026-09-05T00:00:00.000Z',
        source_profile: 'enterprise-hseos:v1',
        source_profile_digest: contentDigest('snapshot-test-profile'),
        entries: [{ ...base, classification: classifySource(base) }],
      };
    },
  };
}

async function publishedFixture({ organizationId, releaseId, issuedAt, effectiveAt, expiresAt, sunsetAt = null }) {
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-05T00:00:00.000Z') });
  const repositoryId = crypto.randomUUID();
  const actor = { type: 'automation', id: 'snapshot-verify-test' };
  await new ImportCatalogService({ repository, source: discoveredSource(repositoryId) }).seedCurrent({
    organizationId,
    organizationDisplayName: 'Snapshot Verify Test',
    importerVersion: '1.0.0',
    actor,
    canonicalRemote: 'https://example.invalid/snapshot-verify-test.git',
  });
  const binding = {
    schema_version: 1,
    contract: 'external-signer-binding/v1',
    signer_id: 'snapshot-test-signer',
    algorithm: 'ed25519',
    key_id: 'snapshot-test-key-2026',
    public_key_ref_env: 'HSEOS_SNAPSHOT_TEST_SIGNER_PUBLIC_KEY',
  };
  const manifest = await planGovernanceRelease(
    {
      organizationId,
      repositoryId,
      releaseId,
      sequence: 1,
      sourceCommit: 'a'.repeat(40),
      approvedTag: 'v1.0.0-snapshot-test',
      previousReleaseDigest: null,
      issuedAt,
      effectiveAt,
      expiresAt,
      sunsetAt,
      changeClass: 'compatible',
      runtimeMinVersion: '3.4.1',
      runtimeMaxVersion: null,
      issuer: 'snapshot-verify-test',
    },
    { repository },
  );
  const evidence = await requestExternalSignature(
    manifest,
    { async sign(digest) { return { value: Buffer.from(`fake-${digest}`).toString('base64url') }; } },
    binding,
  );
  await publishGovernanceRelease({ organizationId, actor, manifest, evidence, binding }, { repository });
  return { repository, binding };
}

test('verifyGovernanceSnapshot accepts a currently valid, trusted, unexpired release', async () => {
  const organizationId = `snapshot-valid-${crypto.randomBytes(6).toString('hex')}`;
  const { repository, binding } = await publishedFixture({
    organizationId,
    releaseId: 'snapshot-valid',
    issuedAt: '2026-09-05T00:00:00Z',
    effectiveAt: '2026-09-05T00:00:00Z',
    expiresAt: '2027-09-05T00:00:00Z',
  });
  const result = await verifyGovernanceSnapshot(
    { organizationId, snapshotId: 'snapshot-valid', binding, clock: () => new Date('2026-09-05T12:00:00.000Z') },
    { repository },
  );
  assert.equal(result.valid, true);
  assert.equal(result.release_id, 'snapshot-valid');
});

test('verifyGovernanceSnapshot fails closed for a missing release', async () => {
  const organizationId = `snapshot-missing-${crypto.randomBytes(6).toString('hex')}`;
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-05T00:00:00.000Z') });
  await assert.rejects(
    verifyGovernanceSnapshot({ organizationId, snapshotId: 'never-published' }, { repository }),
    (error) => error.code === 'MANAGED_GOVERNANCE_NOT_FOUND',
  );
});

test('verifyGovernanceSnapshot rejects replay of an expired release', async () => {
  const organizationId = `snapshot-expired-${crypto.randomBytes(6).toString('hex')}`;
  const { repository, binding } = await publishedFixture({
    organizationId,
    releaseId: 'snapshot-expired',
    issuedAt: '2026-08-01T00:00:00Z',
    effectiveAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-15T00:00:00Z',
  });
  await assert.rejects(
    verifyGovernanceSnapshot(
      { organizationId, snapshotId: 'snapshot-expired', binding, clock: () => new Date('2026-09-05T00:00:00.000Z') },
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_SNAPSHOT_EXPIRED',
  );
});

test('verifyGovernanceSnapshot rejects a release that is not yet effective', async () => {
  const organizationId = `snapshot-future-${crypto.randomBytes(6).toString('hex')}`;
  const { repository, binding } = await publishedFixture({
    organizationId,
    releaseId: 'snapshot-future',
    issuedAt: '2026-09-05T00:00:00Z',
    effectiveAt: '2026-12-01T00:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z',
  });
  await assert.rejects(
    verifyGovernanceSnapshot(
      { organizationId, snapshotId: 'snapshot-future', binding, clock: () => new Date('2026-09-05T00:00:00.000Z') },
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_SNAPSHOT_NOT_YET_VALID',
  );
});

test('verifyGovernanceSnapshot rejects a signer that is not in the trusted binding', async () => {
  const organizationId = `snapshot-untrusted-${crypto.randomBytes(6).toString('hex')}`;
  const { repository } = await publishedFixture({
    organizationId,
    releaseId: 'snapshot-untrusted',
    issuedAt: '2026-09-05T00:00:00Z',
    effectiveAt: '2026-09-05T00:00:00Z',
    expiresAt: '2027-09-05T00:00:00Z',
  });
  await assert.rejects(
    verifyGovernanceSnapshot(
      { organizationId, snapshotId: 'snapshot-untrusted', binding: { trusted_key_ids: ['a-different-signer'] } },
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_SNAPSHOT_UNTRUSTED_SIGNER',
  );
});

test('verifyGovernanceSnapshot rejects a substituted signed digest that does not bind to the manifest', async () => {
  const organizationId = `snapshot-substituted-${crypto.randomBytes(6).toString('hex')}`;
  const { repository } = await publishedFixture({
    organizationId,
    releaseId: 'snapshot-substituted',
    issuedAt: '2026-09-05T00:00:00Z',
    effectiveAt: '2026-09-05T00:00:00Z',
    expiresAt: '2027-09-05T00:00:00Z',
  });
  // Simulate a record whose signed_digest was substituted after the fact (e.g. a compromised
  // write path) — verification must still catch it independently of how it got there.
  for (const entry of repository.releasePublicationAttempts.values()) {
    if (entry.record.release_id === 'snapshot-substituted') entry.record.signed_digest = contentDigest('substituted');
  }
  await assert.rejects(
    verifyGovernanceSnapshot({ organizationId, snapshotId: 'snapshot-substituted' }, { repository }),
    (error) => error.code === 'MANAGED_GOVERNANCE_SNAPSHOT_TAMPERED',
  );
});
