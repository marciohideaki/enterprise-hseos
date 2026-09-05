'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { MemoryGovernanceRepository } = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { ImportCatalogService } = require('../../tools/managed-governance-control-plane/lib/application/import-catalog');
const { classifySource } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/classifiers');
const { planGovernanceRelease } = require('../../tools/managed-governance-control-plane/lib/application/plan-release');
const { publishGovernanceRelease, requestExternalSignature } = require('../../tools/managed-governance-control-plane/lib/application/publish-release');
const { connectionIdentity, runRecoveryRehearsal } = require('../../tools/managed-governance-control-plane/lib/application/rehearse-recovery');

const ACTOR = { type: 'automation', id: 'recovery-rehearsal-test' };
const DISPOSABLE_ENV = 'HSEOS_TEST_DISPOSABLE_TARGET_URL';
const OPERATIONAL_MIGRATION_ENV = 'HSEOS_TEST_OPERATIONAL_MIGRATION_URL';
const OPERATIONAL_RUNTIME_ENV = 'HSEOS_TEST_OPERATIONAL_RUNTIME_URL';

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

async function seededOrganization(overrides = {}) {
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
        source_profile_digest: contentDigest('recovery-rehearsal-test-profile'),
        entries: [discoveredEntry('policies/a.md', '# Policy A\n')],
      };
    },
  };
  const organizationId = overrides.organizationId || `recovery-test-${crypto.randomBytes(6).toString('hex')}`;
  const importer = new ImportCatalogService({ repository, source });
  await importer.seedCurrent({
    organizationId,
    organizationDisplayName: 'Recovery Rehearsal Test',
    importerVersion: '1.0.0',
    actor: ACTOR,
    canonicalRemote: 'https://example.invalid/recovery-rehearsal-test.git',
  });
  const projection = await repository.getCatalogProjectionMetadata(organizationId, repositoryId);
  return { repository, repositoryId, organizationId, sourceCommit, batchId: projection.batch_id };
}

async function publishTestRelease(seed) {
  const manifest = await planGovernanceRelease(
    {
      organizationId: seed.organizationId,
      repositoryId: seed.repositoryId,
      releaseId: 'recovery-rehearsal-release-1',
      sequence: 1,
      sourceCommit: seed.sourceCommit,
      approvedTag: 'v1.0.0-test',
      previousReleaseDigest: null,
      issuedAt: '2026-09-05T01:00:00Z',
      effectiveAt: '2026-09-05T01:05:00Z',
      expiresAt: '2027-09-05T01:00:00Z',
      sunsetAt: null,
      changeClass: 'compatible',
      runtimeMinVersion: '3.4.1',
      runtimeMaxVersion: null,
      issuer: 'recovery-rehearsal-test',
    },
    { repository: seed.repository },
  );
  const binding = {
    schema_version: 1,
    contract: 'external-signer-binding/v1',
    signer_id: 'test-signer',
    algorithm: 'ed25519',
    key_id: 'test-key-2026',
    public_key_ref_env: 'HSEOS_RECOVERY_TEST_SIGNER_PUBLIC_KEY',
  };
  const signer = { async sign(digest) { return { value: Buffer.from(`fake-signature-${digest}`).toString('base64url') }; } };
  const evidence = await requestExternalSignature(manifest, signer, binding);
  return publishGovernanceRelease({ organizationId: seed.organizationId, actor: ACTOR, manifest, evidence, binding }, { repository: seed.repository });
}

function fakeInspector(result) {
  const calls = [];
  return {
    calls,
    async inspect(input) {
      calls.push(input);
      return typeof result === 'function' ? result(input) : result;
    },
  };
}

function passingInspection(seed, overrides = {}) {
  return {
    tables_missing_rls: [],
    application_role_mutable_audit: false,
    active_batch_id: seed.batchId,
    catalog_entry_count: 1,
    published_release: null,
    latest_audit_event_at: '2026-09-05T00:30:00.000Z',
    ...overrides,
  };
}

function recoveryProfile(overrides = {}) {
  return {
    schema_version: 1,
    contract: 'recovery-profile/v1',
    profile_id: 'recovery-rehearsal-test-profile',
    rpo_seconds: 3600,
    rto_seconds: 7200,
    retention_days: 30,
    declared_by: 'recovery-rehearsal-test',
    declared_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function baseEnvironment(overrides = {}) {
  return {
    [DISPOSABLE_ENV]: 'postgresql://app:secret@disposable-host:5432/disposable_db',
    [OPERATIONAL_MIGRATION_ENV]: 'postgresql://app:secret@operational-host:5432/operational_db',
    [OPERATIONAL_RUNTIME_ENV]: 'postgresql://app:secret@operational-host:5432/operational_db',
    ...overrides,
  };
}

function baseInput(seed, overrides = {}) {
  return {
    organizationId: seed.organizationId,
    actor: ACTOR,
    repositoryId: seed.repositoryId,
    profile: recoveryProfile(),
    expectedReleaseId: null,
    disposableTarget: { connectionStringEnv: DISPOSABLE_ENV, confirmed: true },
    operationalConnectionStringEnvs: [OPERATIONAL_MIGRATION_ENV, OPERATIONAL_RUNTIME_ENV],
    restoreStartedAt: '2026-09-05T00:00:00.000Z',
    restoreCompletedAt: '2026-09-05T00:10:00.000Z',
    rehearsedAt: '2026-09-05T00:15:00.000Z',
    ...overrides,
  };
}

test('runRecoveryRehearsal refuses an unconfirmed disposable target before touching the environment or the inspector', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(passingInspection(seed));
  await assert.rejects(
    runRecoveryRehearsal(baseInput(seed, { disposableTarget: { connectionStringEnv: DISPOSABLE_ENV, confirmed: false } }), {
      repository: seed.repository,
      disposableTargetInspector: inspector,
      environment: baseEnvironment(),
    }),
    (error) => error.code === 'MANAGED_GOVERNANCE_RECOVERY_TARGET_NOT_CONFIRMED',
  );
  assert.equal(inspector.calls.length, 0);
});

test('runRecoveryRehearsal rejects an operational-target alias before ever calling the inspector', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(passingInspection(seed));
  const cases = [
    // exact same connection string
    { [DISPOSABLE_ENV]: 'postgresql://app:secret@operational-host:5432/operational_db' },
    // loopback synonyms
    {
      [DISPOSABLE_ENV]: 'postgresql://app:secret@localhost:5432/prod',
      [OPERATIONAL_MIGRATION_ENV]: 'postgresql://app:secret@127.0.0.1:5432/prod',
      [OPERATIONAL_RUNTIME_ENV]: 'postgresql://app:secret@127.0.0.1:5432/prod',
    },
    // default port omitted on one side
    {
      [DISPOSABLE_ENV]: 'postgresql://app:secret@operational-host/operational_db',
      [OPERATIONAL_MIGRATION_ENV]: 'postgresql://app:secret@operational-host:5432/operational_db',
      [OPERATIONAL_RUNTIME_ENV]: 'postgresql://app:secret@operational-host:5432/operational_db',
    },
  ];
  for (const environmentOverrides of cases) {
    await assert.rejects(
      runRecoveryRehearsal(baseInput(seed), {
        repository: seed.repository,
        disposableTargetInspector: inspector,
        environment: baseEnvironment(environmentOverrides),
      }),
      (error) => error.code === 'MANAGED_GOVERNANCE_RECOVERY_TARGET_IS_OPERATIONAL',
    );
  }
  assert.equal(inspector.calls.length, 0);
});

test('connectionIdentity normalizes loopback hosts and default ports', () => {
  assert.equal(connectionIdentity('postgresql://u:p@localhost/db'), connectionIdentity('postgresql://u:p@127.0.0.1:5432/db'));
  assert.equal(connectionIdentity('postgresql://u:p@[::1]:5432/db'), connectionIdentity('postgresql://u:p@localhost/db'));
  assert.notEqual(connectionIdentity('postgresql://u:p@host-a:5432/db'), connectionIdentity('postgresql://u:p@host-b:5432/db'));
  assert.notEqual(connectionIdentity('postgresql://u:p@host:5432/db-a'), connectionIdentity('postgresql://u:p@host:5432/db-b'));
});

test('a fully verified rehearsal within the declared profile is ready and persisted', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(passingInspection(seed));
  const evidence = await runRecoveryRehearsal(baseInput(seed), {
    repository: seed.repository,
    disposableTargetInspector: inspector,
    environment: baseEnvironment(),
  });
  assert.equal(evidence.within_declared_profile, true);
  assert.equal(evidence.tenant_isolation_verified, true);
  assert.equal(evidence.active_catalog_verified, true);
  assert.equal(evidence.release_signatures_verified, true);
  assert.equal(evidence.audit_history_append_only_verified, true);
  assert.equal(evidence.disposable_target_confirmed, true);
  assert.equal(evidence.disposable_target_ref, `env:${DISPOSABLE_ENV}`);
  assert.doesNotMatch(evidence.disposable_target_ref, /postgresql:/);
  assert.equal(evidence.measured_rto_seconds, 600);
  assert.equal(inspector.calls.length, 1);
  assert.equal(inspector.calls[0].connectionString, baseEnvironment()[DISPOSABLE_ENV]);

  const stored = await seed.repository.getRecoveryRehearsal(seed.organizationId, evidence.recovery_rehearsal_id);
  assert.deepEqual(stored, evidence);
});

test('measured_rpo_seconds reflects the gap between the operational and disposable audit history', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(passingInspection(seed, { latest_audit_event_at: '2026-09-04T23:00:00.000Z' }));
  const evidence = await runRecoveryRehearsal(baseInput(seed), {
    repository: seed.repository,
    disposableTargetInspector: inspector,
    environment: baseEnvironment(),
  });
  const operationalAuditEvents = await seed.repository.listAuditEvents(seed.organizationId);
  const operationalLatest = operationalAuditEvents.reduce(
    (latest, event) => (latest === null || Date.parse(event.occurred_at) > Date.parse(latest) ? event.occurred_at : latest),
    null,
  );
  const expected = Math.max(0, (Date.parse(operationalLatest) - Date.parse('2026-09-04T23:00:00.000Z')) / 1000);
  assert.equal(evidence.measured_rpo_seconds, expected);
  assert.ok(expected > 0, 'the operational fixture must have audit history newer than the disposable snapshot for this test to mean anything');
});

test('a disposable target with no restored audit history fails closed instead of reporting a fabricated measurement', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(passingInspection(seed, { latest_audit_event_at: null }));
  await assert.rejects(
    runRecoveryRehearsal(baseInput(seed), { repository: seed.repository, disposableTargetInspector: inspector, environment: baseEnvironment() }),
    (error) => error.code === 'MANAGED_GOVERNANCE_RECOVERY_TARGET_EMPTY',
  );
});

test('tenant isolation, active catalog and audit append-only failures each independently block within_declared_profile', async () => {
  const seed = await seededOrganization();
  const failureCases = [
    { tables_missing_rls: ['governance_artifacts'] },
    { active_batch_id: crypto.randomUUID() },
    { catalog_entry_count: 0 },
    { application_role_mutable_audit: true },
  ];
  for (const overrides of failureCases) {
    const inspector = fakeInspector(passingInspection(seed, overrides));
    const evidence = await runRecoveryRehearsal(baseInput(seed), {
      repository: seed.repository,
      disposableTargetInspector: inspector,
      environment: baseEnvironment(),
    });
    assert.equal(evidence.within_declared_profile, false, JSON.stringify(overrides));
  }
});

test('release signature verification compares the disposable target against the operational published release', async () => {
  const seed = await seededOrganization();
  const published = await publishTestRelease(seed);

  const matchingInspector = fakeInspector(
    passingInspection(seed, {
      published_release: {
        release_id: published.release_id,
        signer_id: published.signer_id,
        signature_algorithm: published.signature_algorithm,
        signed_digest: published.signed_digest,
      },
    }),
  );
  const matching = await runRecoveryRehearsal(baseInput(seed, { expectedReleaseId: published.release_id }), {
    repository: seed.repository,
    disposableTargetInspector: matchingInspector,
    environment: baseEnvironment(),
  });
  assert.equal(matching.release_signatures_verified, true);
  assert.equal(matching.within_declared_profile, true);

  const corruptedInspector = fakeInspector(
    passingInspection(seed, {
      published_release: { release_id: published.release_id, signer_id: published.signer_id, signature_algorithm: published.signature_algorithm, signed_digest: `sha256:${'0'.repeat(64)}` },
    }),
  );
  const corrupted = await runRecoveryRehearsal(baseInput(seed, { expectedReleaseId: published.release_id }), {
    repository: seed.repository,
    disposableTargetInspector: corruptedInspector,
    environment: baseEnvironment(),
  });
  assert.equal(corrupted.release_signatures_verified, false);
  assert.equal(corrupted.within_declared_profile, false);

  const missingInspector = fakeInspector(passingInspection(seed, { published_release: null }));
  const missing = await runRecoveryRehearsal(baseInput(seed, { expectedReleaseId: published.release_id }), {
    repository: seed.repository,
    disposableTargetInspector: missingInspector,
    environment: baseEnvironment(),
  });
  assert.equal(missing.release_signatures_verified, false);
});

test('an unexpected published release on the disposable target when none was expected fails verification', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(
    passingInspection(seed, {
      published_release: { release_id: 'unexpected-release', signer_id: 'x', signature_algorithm: 'ed25519', signed_digest: `sha256:${'1'.repeat(64)}` },
    }),
  );
  const evidence = await runRecoveryRehearsal(baseInput(seed, { expectedReleaseId: null }), {
    repository: seed.repository,
    disposableTargetInspector: inspector,
    environment: baseEnvironment(),
  });
  assert.equal(evidence.release_signatures_verified, false);
});

test('measured values exceeding the declared profile block within_declared_profile even when every check passes', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(passingInspection(seed));
  const evidence = await runRecoveryRehearsal(
    baseInput(seed, { profile: recoveryProfile({ rto_seconds: 60 }), restoreStartedAt: '2026-09-05T00:00:00.000Z', restoreCompletedAt: '2026-09-05T00:10:00.000Z' }),
    { repository: seed.repository, disposableTargetInspector: inspector, environment: baseEnvironment() },
  );
  assert.equal(evidence.measured_rto_seconds, 600);
  assert.equal(evidence.within_declared_profile, false);
  assert.equal(evidence.tenant_isolation_verified, true);
});

test('restore completed at cannot precede restore started at', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(passingInspection(seed));
  await assert.rejects(
    runRecoveryRehearsal(baseInput(seed, { restoreStartedAt: '2026-09-05T00:10:00.000Z', restoreCompletedAt: '2026-09-05T00:00:00.000Z' }), {
      repository: seed.repository,
      disposableTargetInspector: inspector,
      environment: baseEnvironment(),
    }),
    (error) => error.code === 'MANAGED_GOVERNANCE_RECOVERY_INPUT_INVALID',
  );
});

test('each rehearsal is a fresh, independently recorded event -- rerunning is not idempotent-deduplicated', async () => {
  const seed = await seededOrganization();
  const inspector = fakeInspector(passingInspection(seed));
  const first = await runRecoveryRehearsal(baseInput(seed), { repository: seed.repository, disposableTargetInspector: inspector, environment: baseEnvironment() });
  const second = await runRecoveryRehearsal(baseInput(seed), { repository: seed.repository, disposableTargetInspector: inspector, environment: baseEnvironment() });
  assert.notEqual(first.recovery_rehearsal_id, second.recovery_rehearsal_id);
});
