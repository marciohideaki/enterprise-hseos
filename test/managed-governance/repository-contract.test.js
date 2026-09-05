'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { assertGovernanceRepository } = require('../../tools/managed-governance-control-plane/lib/domain/repository-port');
const {
  MemoryGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { readMigrations } = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/migrator');
const { createPostgresPool } = require('../../tools/managed-governance-control-plane/lib/infrastructure/postgres/pool');

function organizationCommand(organizationId, idempotencyKey, displayName = 'Managed Governance Test') {
  return {
    organization_id: organizationId,
    idempotency_key: idempotencyKey,
    actor: { type: 'automation', id: 'repository-contract-test' },
    organization: { slug: organizationId, display_name: displayName },
  };
}

const ACTOR = { type: 'automation', id: 'repository-contract-test' };

function digest(seed) {
  return `sha256:${crypto.createHash('sha256').update(seed, 'utf8').digest('hex')}`;
}

function releaseManifestFixture(organizationId, repositoryId, overrides = {}) {
  return {
    schema_version: 1,
    contract: 'governance-release-manifest/v1',
    release_id: 'governance-release-contract-test',
    sequence: 1,
    source_repository_id: repositoryId,
    source_commit: 'a'.repeat(40),
    approved_tag: 'v0.0.1-contract-test',
    previous_release_digest: null,
    manifest_digest: digest(`${organizationId}-manifest`),
    items: [
      {
        artifact_id: 'enterprise-constitution',
        artifact_version_id: crypto.randomUUID(),
        artifact_type: 'constitution',
        content_digest: digest(`${organizationId}-constitution`),
      },
    ],
    issued_at: '2026-09-05T00:00:00Z',
    effective_at: '2026-09-05T01:00:00Z',
    expires_at: '2027-09-05T00:00:00Z',
    sunset_at: null,
    change_class: 'compatible',
    runtime_min_version: '3.4.1',
    runtime_max_version: null,
    issuer: 'repository-contract-test',
    ...overrides,
  };
}

function shadowReceiptFixture(organizationId, repositoryId) {
  return {
    schema_version: 1,
    contract: 'shadow-receipt/v1',
    receipt_id: crypto.randomUUID(),
    organization_id: organizationId,
    repository_id: repositoryId,
    adapter: 'claude-code',
    session_fingerprint: digest(`${organizationId}-session`),
    local_digest: digest(`${organizationId}-local`),
    remote_digest: digest(`${organizationId}-local`),
    release_digest: null,
    status: 'equivalent',
    reason_code: 'managed_shadow.constitution_equivalent',
    observed_at: '2026-09-05T00:15:00Z',
  };
}

function readinessReportFixture(organizationId, repositoryId) {
  return {
    schema_version: 1,
    contract: 'readiness-report/v1',
    report_id: crypto.randomUUID(),
    organization_id: organizationId,
    window_start: '2026-08-06T00:00:00Z',
    window_end: '2026-09-05T00:00:00Z',
    window_days: 30,
    eligible_sessions: 100,
    covered_sessions: 98,
    repositories_covered: [repositoryId],
    repositories_missing_evidence: [],
    adapters_covered: ['claude-code'],
    adapters_missing_evidence: [],
    preflight_latency_p95_ms: 210,
    open_drift_count: 0,
    open_invalid_contract_count: 0,
    remote_unavailable_samples: 0,
    signer_evidence_current: true,
    recovery_evidence_current: true,
    threat_model_evidence_current: true,
    rollback_evidence_current: true,
    ready: true,
    authorizes_enforcement: false,
    evaluated_at: '2026-09-05T00:20:00Z',
  };
}

async function runRepositoryContract(context, createRepository, label) {
  const suffix = crypto.randomBytes(6).toString('hex');
  const organizationId = `${label}-${suffix}`;
  const otherOrganizationId = `${label}-other-${suffix}`;
  const repository = assertGovernanceRepository(await createRepository());

  await context.test('commits domain state, audit, outbox and receipt atomically', async () => {
    const result = await repository.ensureOrganization(organizationCommand(organizationId, 'organization-create'));
    assert.equal(result.operation, 'organization.ensure');
    assert.equal(result.organization.organization_id, organizationId);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(await repository.getOrganization(organizationId), result.organization);
    const auditEvents = await repository.listAuditEvents(organizationId);
    assert.equal(auditEvents.length, 1);
    assert.match(auditEvents[0].correlation_id, /^[a-f0-9-]{36}$/);
    assert.equal(auditEvents[0].causation_id, null);
    assert.equal((await repository.listOutboxMessages(organizationId)).length, 1);
    assert.equal((await repository.getCommandReceipt(organizationId, 'organization-create')).command_digest.length, 71);
  });

  await context.test('returns the original result for an exact idempotent retry', async () => {
    const command = organizationCommand(organizationId, 'organization-create');
    const first = await repository.ensureOrganization(command);
    const second = await repository.ensureOrganization(command);
    assert.deepEqual(second, first);
    assert.equal((await repository.listAuditEvents(organizationId)).length, 1);
    assert.equal((await repository.listOutboxMessages(organizationId)).length, 1);
  });

  await context.test('rejects conflicting idempotency reuse without partial writes', async () => {
    await assert.rejects(
      repository.ensureOrganization(organizationCommand(organizationId, 'organization-create', 'Changed Name')),
      (error) => error.code === 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
    );
    assert.equal((await repository.listAuditEvents(organizationId)).length, 1);
    assert.equal((await repository.listOutboxMessages(organizationId)).length, 1);
    assert.equal((await repository.getOrganization(organizationId)).display_name, 'Managed Governance Test');
  });

  await context.test('serializes concurrent retries to one committed mutation', async () => {
    const command = organizationCommand(otherOrganizationId, 'concurrent-create');
    const [left, right] = await Promise.all([repository.ensureOrganization(command), repository.ensureOrganization(command)]);
    assert.deepEqual(left, right);
    assert.equal((await repository.listAuditEvents(otherOrganizationId)).length, 1);
    assert.equal((await repository.listOutboxMessages(otherOrganizationId)).length, 1);
  });

  // readiness_evaluations, recovery_rehearsals and network_access_audit have no repository
  // foreign key (they are organization-scoped, not repository-scoped — see design.md Data
  // Model), so they run here against both adapters without extra repository setup.
  // release_publication_attempts, patch_publication_bundles and shadow_receipts DO reference
  // a repository row and are covered by adapter-specific tests instead (memory has no FK to
  // seed against; postgres.integration.test.js seeds a real repository row).

  await context.test('records a readiness evaluation idempotently and never authorizes enforcement', async () => {
    const report = readinessReportFixture(otherOrganizationId, crypto.randomUUID());
    const first = await repository.recordReadinessEvaluation({ organization_id: otherOrganizationId, actor: ACTOR, report });
    assert.equal(first.readiness_evaluation_id, report.report_id);
    assert.equal(first.authorizes_enforcement, false);
    assert.equal(Object.isFrozen(first), true);
    const second = await repository.recordReadinessEvaluation({ organization_id: otherOrganizationId, actor: ACTOR, report });
    assert.deepEqual(second, first);
    const fetched = await repository.getReadinessEvaluation(otherOrganizationId, report.report_id);
    assert.deepEqual(fetched, first);
    await assert.rejects(
      repository.recordReadinessEvaluation({
        organization_id: otherOrganizationId,
        actor: ACTOR,
        report: { ...report, evaluated_at: '2026-09-05T00:25:00Z' },
      }),
      (error) => error.code === 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
    );
    assert.equal(await repository.getReadinessEvaluation(organizationId, report.report_id), null);
  });

  await context.test('records a recovery rehearsal idempotently and requires a confirmed disposable target', async () => {
    const evidence = {
      schema_version: 1,
      contract: 'recovery-rehearsal-evidence/v1',
      rehearsal_id: crypto.randomUUID(),
      recovery_profile_digest: digest(`${otherOrganizationId}-recovery-profile`),
      disposable_target_ref: 'contract-test-disposable-target',
      disposable_target_confirmed: true,
      measured_rpo_seconds: 500,
      measured_rto_seconds: 1800,
      tenant_isolation_verified: true,
      active_catalog_verified: true,
      release_signatures_verified: true,
      audit_history_append_only_verified: true,
      within_declared_profile: true,
      rehearsed_at: '2026-09-05T00:30:00Z',
    };
    const first = await repository.recordRecoveryRehearsal({ organization_id: otherOrganizationId, actor: ACTOR, evidence });
    assert.equal(first.recovery_rehearsal_id, evidence.rehearsal_id);
    assert.equal(first.disposable_target_confirmed, true);
    const second = await repository.recordRecoveryRehearsal({ organization_id: otherOrganizationId, actor: ACTOR, evidence });
    assert.deepEqual(second, first);
    assert.deepEqual(await repository.getRecoveryRehearsal(otherOrganizationId, evidence.rehearsal_id), first);
  });

  await context.test('records network access audit events with a deny reason required only on denial', async () => {
    const allowed = await repository.recordNetworkAccessAudit({
      organization_id: otherOrganizationId,
      actor: ACTOR,
      client_identifier: 'contract-test-client',
      raw_client_ip: null,
      route_scope: 'query',
      matched_allowlist_rule: '192.168.5.0/24',
      outcome: 'allow',
      deny_reason: null,
      evidence_digest: digest('contract-test-allow'),
    });
    assert.equal(allowed.outcome, 'allow');
    assert.equal(allowed.deny_reason, null);
    await assert.rejects(
      repository.recordNetworkAccessAudit({
        organization_id: otherOrganizationId,
        actor: ACTOR,
        client_identifier: 'contract-test-client',
        raw_client_ip: null,
        route_scope: 'admin',
        matched_allowlist_rule: null,
        outcome: 'deny',
        deny_reason: null,
        evidence_digest: digest('contract-test-deny'),
      }),
      (error) => error.code === 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID',
    );
    const denied = await repository.recordNetworkAccessAudit({
      organization_id: otherOrganizationId,
      actor: ACTOR,
      client_identifier: 'contract-test-client',
      raw_client_ip: null,
      route_scope: 'admin',
      matched_allowlist_rule: null,
      outcome: 'deny',
      deny_reason: 'not_allowlisted',
      evidence_digest: digest('contract-test-deny'),
    });
    assert.equal(denied.outcome, 'deny');
    assert.equal(denied.deny_reason, 'not_allowlisted');
  });

  await context.test('keeps tenant reads isolated and closes explicitly', async () => {
    assert.equal(await repository.getOrganization(`${label}-absent-${suffix}`), null);
    assert.deepEqual(await repository.listAuditEvents(`${label}-absent-${suffix}`), []);
    await repository.close();
    await assert.rejects(repository.getOrganization(organizationId), (error) => error.code === 'MANAGED_GOVERNANCE_REPOSITORY_CLOSED');
  });
}

if (require.main === module) {
  test('in-memory governance repository satisfies the v1 port contract', async (context) => {
    await runRepositoryContract(
      context,
      async () => new MemoryGovernanceRepository({ clock: () => new Date('2026-09-01T00:00:00.000Z') }),
      'memory',
    );
  });

  test('in-memory repository records repository-scoped shadow-readiness evidence idempotently', async () => {
    const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-05T00:00:00.000Z') });
    const organizationId = `memory-evidence-${crypto.randomBytes(6).toString('hex')}`;
    const repositoryId = crypto.randomUUID();
    await repository.ensureOrganization(organizationCommand(organizationId, 'evidence-org-create'));

    const manifest = releaseManifestFixture(organizationId, repositoryId);
    const attempt = await repository.recordReleasePublicationAttempt({
      organization_id: organizationId,
      actor: ACTOR,
      manifest,
      stage: 'planned',
      signer_id: null,
      signature_algorithm: null,
      signed_digest: null,
      rejection_reason: null,
    });
    assert.equal(attempt.manifest_digest, manifest.manifest_digest);
    assert.deepEqual(
      await repository.recordReleasePublicationAttempt({
        organization_id: organizationId,
        actor: ACTOR,
        manifest,
        stage: 'planned',
        signer_id: null,
        signature_algorithm: null,
        signed_digest: null,
        rejection_reason: null,
      }),
      attempt,
    );
    assert.deepEqual(await repository.getReleasePublicationAttempt(organizationId, attempt.release_publication_attempt_id), attempt);

    const receipt = shadowReceiptFixture(organizationId, repositoryId);
    const recordedReceipt = await repository.recordShadowReceipt({ organization_id: organizationId, actor: ACTOR, receipt });
    assert.equal(recordedReceipt.shadow_receipt_id, receipt.receipt_id);
    assert.deepEqual(await repository.getShadowReceipt(organizationId, receipt.receipt_id), recordedReceipt);

    const bundle = {
      schema_version: 1,
      contract: 'patch-publication-bundle-manifest/v1',
      bundle_id: crypto.randomUUID(),
      publication_request_ref: 'memory-contract-test-request',
      source_repository_id: repositoryId,
      base_commit: 'b'.repeat(40),
      manifest_digest: digest(`${organizationId}-bundle-manifest`),
      patch_digest: digest(`${organizationId}-bundle-patch`),
      file_operations: [{ operation: 'create', path: 'docs/new-file.md', content_digest: digest(`${organizationId}-file`) }],
      application_instructions: 'Apply with git apply.',
      rollback_instructions: 'Revert with git apply --reverse.',
      generated_by: 'memory-contract-test',
      generated_at: '2026-09-05T00:10:00Z',
    };
    const recordedBundle = await repository.recordPatchPublicationBundle({ organization_id: organizationId, actor: ACTOR, bundle });
    assert.equal(recordedBundle.patch_publication_bundle_id, bundle.bundle_id);
    assert.deepEqual(await repository.getPatchPublicationBundle(organizationId, bundle.bundle_id), recordedBundle);
  });

  test('migration reader pins bounded regular files and rejects link aliases', async () => {
    const migrationsDirectory = path.resolve(__dirname, '../../tools/managed-governance-control-plane/migrations');
    const migrations = await readMigrations(migrationsDirectory);
    assert.deepEqual(
      migrations.map((migration) => migration.version),
      ['0001', '0002', '0003', '0004', '0005'],
    );
    assert.equal(Object.isFrozen(migrations), true);
    assert.match(migrations[0].checksum, /^sha256:[a-f0-9]{64}$/);

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-migrations-'));
    try {
      const target = path.join(fixture, 'target.sql');
      fs.writeFileSync(target, 'SELECT 1;');
      const hardDirectory = path.join(fixture, 'hard');
      fs.mkdirSync(hardDirectory);
      fs.linkSync(target, path.join(hardDirectory, '0001_hard.sql'));
      await assert.rejects(readMigrations(hardDirectory), (error) => error.code === 'MANAGED_GOVERNANCE_MIGRATION_INVALID');

      const symbolicDirectory = path.join(fixture, 'symbolic');
      fs.mkdirSync(symbolicDirectory);
      fs.symlinkSync(target, path.join(symbolicDirectory, '0001_symbolic.sql'));
      await assert.rejects(readMigrations(symbolicDirectory), (error) => error.code === 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('pool configuration is closed, bounded and does not load a driver when injected', () => {
    class FakePool {
      constructor(options) {
        this.options = options;
      }
    }
    const pool = createPostgresPool({ connectionString: 'postgresql://localhost/governance', max: 2 }, FakePool);
    assert.equal(pool.options.max, 2);
    assert.equal(pool.options.statement_timeout, 15_000);
    assert.throws(
      () => createPostgresPool({ connectionString: 'https://localhost/governance' }, FakePool),
      (error) => error.code === 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID',
    );
    assert.throws(
      () => createPostgresPool({ connectionString: 'postgresql://localhost/governance', unknown: true }, FakePool),
      (error) => error.code === 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID',
    );
  });
}

module.exports = {
  runRepositoryContract,
};
