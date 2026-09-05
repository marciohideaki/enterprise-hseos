'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { MemoryGovernanceRepository } = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { ImportCatalogService } = require('../../tools/managed-governance-control-plane/lib/application/import-catalog');
const { classifySource } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/classifiers');
const { planGovernanceRelease } = require('../../tools/managed-governance-control-plane/lib/application/plan-release');
const { publishGovernanceRelease, requestExternalSignature } = require('../../tools/managed-governance-control-plane/lib/application/publish-release');
const { ExternalSignerError } = require('../../tools/managed-governance-control-plane/lib/domain/external-signer-port');

function contentDigest(content) {
  return `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function discoveredEntry(sourcePath, rawContent) {
  const normalizedContent = rawContent.replaceAll(/\r\n?/g, '\n');
  const base = {
    source_path: sourcePath,
    source_kind: 'policy',
    raw_content: rawContent,
    normalized_content: normalizedContent,
    content_digest: contentDigest(normalizedContent),
  };
  return { ...base, classification: classifySource(base) };
}

async function seededRelease(overrides = {}) {
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-05T00:00:00.000Z') });
  const repositoryId = overrides.repositoryId || crypto.randomUUID();
  const sourceCommit = overrides.sourceCommit || 'a'.repeat(40);
  const source = {
    async discover() {
      return {
        schema_version: 1,
        repository_id: repositoryId,
        source_commit: sourceCommit,
        source_timestamp: '2026-09-05T00:00:00.000Z',
        source_profile: 'enterprise-hseos:v1',
        source_profile_digest: contentDigest('release-publication-test-profile'),
        entries: [discoveredEntry('policies/a.md', '# Policy A\n')],
      };
    },
  };
  const organizationId = overrides.organizationId || `release-test-${crypto.randomBytes(6).toString('hex')}`;
  const actor = { type: 'automation', id: 'release-publication-test' };
  const importer = new ImportCatalogService({ repository, source });
  await importer.seedCurrent({
    organizationId,
    organizationDisplayName: 'Release Publication Test',
    importerVersion: '1.0.0',
    actor,
    canonicalRemote: 'https://example.invalid/release-publication-test.git',
  });
  return { repository, repositoryId, organizationId, sourceCommit, actor };
}

function planInput({ organizationId, repositoryId, sourceCommit }, overrides = {}) {
  return {
    organizationId,
    repositoryId,
    releaseId: 'release-publication-test-1',
    sequence: 1,
    sourceCommit,
    approvedTag: 'v1.0.0-test',
    previousReleaseDigest: null,
    issuedAt: '2026-09-05T01:00:00Z',
    effectiveAt: '2026-09-05T01:05:00Z',
    expiresAt: '2027-09-05T01:00:00Z',
    sunsetAt: null,
    changeClass: 'compatible',
    runtimeMinVersion: '3.4.1',
    runtimeMaxVersion: null,
    issuer: 'release-publication-test',
    ...overrides,
  };
}

function fakeSigner(onSign) {
  return {
    async sign(digest, binding) {
      onSign?.(digest, binding);
      return { value: Buffer.from(`fake-signature-${digest}`).toString('base64url') };
    },
  };
}

function binding(overrides = {}) {
  return {
    schema_version: 1,
    contract: 'external-signer-binding/v1',
    signer_id: 'test-signer',
    algorithm: 'ed25519',
    key_id: 'test-key-2026',
    public_key_ref_env: 'HSEOS_RELEASE_TEST_SIGNER_PUBLIC_KEY',
    ...overrides,
  };
}

test('planGovernanceRelease produces a byte-identical manifest for the same input', async () => {
  const seed = await seededRelease();
  const input = planInput(seed);
  const first = await planGovernanceRelease(input, { repository: seed.repository });
  const second = await planGovernanceRelease({ ...input }, { repository: seed.repository });
  assert.deepEqual(second, first);
  assert.equal(first.manifest_digest, second.manifest_digest);
  assert.equal(first.items.length, 1);
  assert.equal(typeof first.items[0].artifact_id, 'string');
  assert.ok(first.items[0].artifact_id.length > 0);
});

test('planGovernanceRelease rejects a source commit that is not the active imported catalog', async () => {
  const seed = await seededRelease();
  await assert.rejects(
    planGovernanceRelease(planInput(seed, { sourceCommit: 'b'.repeat(40) }), { repository: seed.repository }),
    (error) => error.code === 'MANAGED_GOVERNANCE_RELEASE_PLAN_COMMIT_MISMATCH',
  );
});

test('planGovernanceRelease rejects an organization with no active imported catalog', async () => {
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-05T00:00:00.000Z') });
  await assert.rejects(
    planGovernanceRelease(
      planInput({ organizationId: 'no-catalog-org', repositoryId: crypto.randomUUID(), sourceCommit: 'a'.repeat(40) }),
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_RELEASE_PLAN_NOT_READY',
  );
});

test('requestExternalSignature passes only the digest and public binding to the signer, never the manifest', async () => {
  const seed = await seededRelease();
  const manifest = await planGovernanceRelease(planInput(seed), { repository: seed.repository });
  let received;
  const signer = fakeSigner((digest, boundBinding) => {
    received = { digest, boundBinding };
  });
  const evidence = await requestExternalSignature(manifest, signer, binding());
  assert.equal(received.digest, manifest.manifest_digest);
  assert.match(received.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(received.boundBinding.signer_id, 'test-signer');
  assert.equal(Object.keys(received).length, 2, 'signer must receive exactly {digest, binding} — nothing else');
  assert.equal(evidence.signed_digest, manifest.manifest_digest);
  assert.equal(evidence.algorithm, 'ed25519');
  assert.equal(Object.isFrozen(evidence), true);
});

test('the signature evidence always echoes the requested algorithm, never whatever the signer claims', async () => {
  const seed = await seededRelease();
  const manifest = await planGovernanceRelease(planInput(seed), { repository: seed.repository });
  const signer = {
    async sign(digest) {
      // A misbehaving or compromised signer tries to claim a different algorithm.
      return { value: Buffer.from(`fake-signature-${digest}`).toString('base64url'), algorithm: 'ecdsa-p256-sha256' };
    },
  };
  const evidence = await requestExternalSignature(manifest, signer, binding({ algorithm: 'ed25519' }));
  assert.equal(evidence.algorithm, 'ed25519', 'evidence must use the requested binding algorithm, not the signer response');
});

test('requestExternalSignature rejects a signer that does not implement sign()', async () => {
  const seed = await seededRelease();
  const manifest = await planGovernanceRelease(planInput(seed), { repository: seed.repository });
  await assert.rejects(
    requestExternalSignature(manifest, {}, binding()),
    (error) => error instanceof ExternalSignerError && error.code === 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_PORT_INVALID',
  );
});

test('requestExternalSignature rejects a malformed signer response', async () => {
  const seed = await seededRelease();
  const manifest = await planGovernanceRelease(planInput(seed), { repository: seed.repository });
  const signer = { async sign() { return { value: 42 }; } };
  await assert.rejects(
    requestExternalSignature(manifest, signer, binding()),
    (error) => error.code === 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_INVALID_RESPONSE',
  );
});

test('publishGovernanceRelease records a published attempt bound to the manifest and signer', async () => {
  const seed = await seededRelease();
  const manifest = await planGovernanceRelease(planInput(seed), { repository: seed.repository });
  const usedBinding = binding();
  const evidence = await requestExternalSignature(manifest, fakeSigner(), usedBinding);
  const published = await publishGovernanceRelease(
    { organizationId: seed.organizationId, actor: seed.actor, manifest, evidence, binding: usedBinding },
    { repository: seed.repository },
  );
  assert.equal(published.stage, 'published');
  assert.equal(published.manifest_digest, manifest.manifest_digest);
  assert.equal(published.signed_digest, evidence.signed_digest);
  assert.equal(published.signature_algorithm, 'ed25519');
  const fetched = await seed.repository.getReleasePublicationAttempt(seed.organizationId, published.release_publication_attempt_id);
  assert.deepEqual(fetched, published);
});

test('publishGovernanceRelease persists nothing when the signature does not verify', async () => {
  const seed = await seededRelease();
  const manifest = await planGovernanceRelease(planInput(seed), { repository: seed.repository });
  const usedBinding = binding();
  const evidence = await requestExternalSignature(manifest, fakeSigner(), usedBinding);
  const tampered = { ...evidence, signed_digest: contentDigest('tampered-manifest') };

  await assert.rejects(
    publishGovernanceRelease(
      { organizationId: seed.organizationId, actor: seed.actor, manifest, evidence: tampered, binding: usedBinding },
      { repository: seed.repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_MISMATCH',
  );
  const releaseEvents = (await seed.repository.listAuditEvents(seed.organizationId)).filter(
    (event) => event.event_type === 'governance.release_publication_attempt.recorded',
  );
  assert.deepEqual(releaseEvents, [], 'no release_publication_attempt row or audit event may exist for a signature that failed verification');
});

test('publishGovernanceRelease rejects evidence signed for a different binding', async () => {
  const seed = await seededRelease();
  const manifest = await planGovernanceRelease(planInput(seed), { repository: seed.repository });
  const requestedBinding = binding();
  const evidence = await requestExternalSignature(manifest, fakeSigner(), requestedBinding);
  const differentBinding = binding({ signer_id: 'a-different-signer', key_id: 'a-different-key' });

  await assert.rejects(
    publishGovernanceRelease(
      { organizationId: seed.organizationId, actor: seed.actor, manifest, evidence, binding: differentBinding },
      { repository: seed.repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_MISMATCH',
  );
});

test('publishing the same manifest and evidence twice is idempotent, and a different manifest at the same stage conflicts', async () => {
  const seed = await seededRelease();
  const manifest = await planGovernanceRelease(planInput(seed), { repository: seed.repository });
  const usedBinding = binding();
  const evidence = await requestExternalSignature(manifest, fakeSigner(), usedBinding);
  const first = await publishGovernanceRelease(
    { organizationId: seed.organizationId, actor: seed.actor, manifest, evidence, binding: usedBinding },
    { repository: seed.repository },
  );
  const second = await publishGovernanceRelease(
    { organizationId: seed.organizationId, actor: seed.actor, manifest, evidence, binding: usedBinding },
    { repository: seed.repository },
  );
  assert.deepEqual(second, first);

  const otherManifest = await planGovernanceRelease(planInput(seed, { sequence: 2 }), { repository: seed.repository });
  const otherEvidence = await requestExternalSignature(otherManifest, fakeSigner(), usedBinding);
  await assert.rejects(
    publishGovernanceRelease(
      { organizationId: seed.organizationId, actor: seed.actor, manifest: { ...otherManifest, manifest_digest: manifest.manifest_digest }, evidence: otherEvidence, binding: usedBinding },
      { repository: seed.repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_EXTERNAL_SIGNER_MISMATCH' || error.code === 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID',
  );
});
