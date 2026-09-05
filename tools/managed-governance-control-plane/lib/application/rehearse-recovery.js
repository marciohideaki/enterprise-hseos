'use strict';

const { randomUUID } = require('node:crypto');
const { RecoveryProfileSchema, RecoveryRehearsalEvidenceSchema, digestCanonical, parseContract } = require('../../../../packages/managed-governance-contracts');
const { GovernanceRepositoryError, assertGovernanceRepository, parseRepositoryIdentifier, parseRepositoryUuid } = require('../domain/repository-port');

// FR-015: this module never creates a backup and never restores the operational database. The
// operator has already restored a backup onto a disposable target before calling this function;
// runRecoveryRehearsal only connects to that target to measure and verify it, then records the
// evidence. "No backup creation or production restore" is enforced structurally: nothing here
// ever opens a connection using an operational connection string for anything but comparison.
//
// Two different quantities are measured two different ways because only one of them is something
// HSEOS can actually observe on its own:
//   - measured_rto_seconds is the operator-supplied restoreStartedAt/restoreCompletedAt delta.
//     HSEOS did not perform the restore, so it cannot time it itself -- it can only compute the
//     duration from the bracketing timestamps the operator who ran the restore provides.
//   - measured_rpo_seconds is computed independently by HSEOS itself: the gap between the
//     operational database's most recent audit event and the disposable target's most recent
//     audit event. This needs no operator input and is not just a repeated operator claim.
//
// "operational target aliases fail before connection" (T08 acceptance criterion): every
// operational/disposable connection string is resolved from an environment variable reference
// (never a literal, per NFR-010) and every alias comparison below happens before
// disposableTargetInspector.inspect() is ever called -- so an operator who accidentally points
// the "disposable" target at the real database is rejected before a single socket opens on it.

const REQUIRED_INSPECTOR_METHODS = Object.freeze(['inspect']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

function invalid(message, code = 'MANAGED_GOVERNANCE_RECOVERY_INPUT_INVALID', details = {}) {
  return new GovernanceRepositoryError(message, code, details);
}

function assertDisposableTargetInspector(inspector) {
  if (!inspector || typeof inspector !== 'object') {
    throw invalid('a disposable target inspector is required', 'MANAGED_GOVERNANCE_RECOVERY_INSPECTOR_PORT_INVALID');
  }
  const missing = REQUIRED_INSPECTOR_METHODS.filter((method) => typeof inspector[method] !== 'function');
  if (missing.length > 0) {
    throw invalid('disposable target inspector does not implement the v1 port', 'MANAGED_GOVERNANCE_RECOVERY_INSPECTOR_PORT_INVALID', { missing });
  }
  return inspector;
}

function requireEnvironmentValue(environment, name, label) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) {
    throw invalid(`${label} environment reference is invalid`);
  }
  const value = environment ? environment[name] : undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    throw invalid(`${label} is required in environment variable ${name}`);
  }
  return value;
}

// Normalizes a PostgreSQL connection string to a bare host:port/database identity so that
// localhost, 127.0.0.1 and ::1 -- or a URL with and without an explicit default port -- all
// collapse to the same identity for the alias check. This never returns credentials.
function connectionIdentity(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw invalid('connection string is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw invalid('connection string has an unsupported protocol');
  }
  let host = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (LOOPBACK_HOSTS.has(host)) host = 'loopback';
  const port = parsed.port ? Number(parsed.port) : 5432;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase();
  return `${host}:${port}/${database}`;
}

function isoOrThrow(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(`${label} is invalid`);
  return value;
}

async function runRecoveryRehearsal(
  {
    organizationId,
    actor,
    repositoryId,
    profile,
    expectedReleaseId,
    disposableTarget,
    operationalConnectionStringEnvs,
    restoreStartedAt,
    restoreCompletedAt,
    rehearsedAt,
  },
  context,
) {
  const repository = assertGovernanceRepository(context?.repository);
  const inspector = assertDisposableTargetInspector(context?.disposableTargetInspector);
  const environment = context?.environment || process.env;

  const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
  const parsedRepositoryId = parseRepositoryUuid(repositoryId, 'repository id');
  const parsedProfile = parseContract(RecoveryProfileSchema, profile, 'recovery profile');

  if (!disposableTarget || typeof disposableTarget !== 'object') {
    throw invalid('a disposable target is required');
  }
  if (disposableTarget.confirmed !== true) {
    throw invalid('the disposable target must be explicitly confirmed disposable', 'MANAGED_GOVERNANCE_RECOVERY_TARGET_NOT_CONFIRMED');
  }
  if (!Array.isArray(operationalConnectionStringEnvs) || operationalConnectionStringEnvs.length === 0) {
    throw invalid('at least one operational connection string environment reference is required');
  }
  isoOrThrow(restoreStartedAt, 'restore started at');
  isoOrThrow(restoreCompletedAt, 'restore completed at');
  if (Date.parse(restoreCompletedAt) < Date.parse(restoreStartedAt)) {
    throw invalid('restore completed at cannot precede restore started at');
  }
  isoOrThrow(rehearsedAt, 'rehearsed at');

  const disposableConnectionString = requireEnvironmentValue(environment, disposableTarget.connectionStringEnv, 'disposable target connection string');
  const disposableIdentity = connectionIdentity(disposableConnectionString);

  for (const operationalEnvironmentName of operationalConnectionStringEnvs) {
    const operationalConnectionString = requireEnvironmentValue(environment, operationalEnvironmentName, 'operational connection string');
    if (connectionIdentity(operationalConnectionString) === disposableIdentity) {
      throw invalid(
        'the disposable target resolves to the same host, port and database as an operational connection -- refusing to connect',
        'MANAGED_GOVERNANCE_RECOVERY_TARGET_IS_OPERATIONAL',
      );
    }
  }

  const [operationalCatalog, operationalRelease, operationalAuditEvents] = await Promise.all([
    repository.getCatalogProjectionMetadata(parsedOrganizationId, parsedRepositoryId),
    expectedReleaseId ? repository.getPublishedRelease(parsedOrganizationId, expectedReleaseId) : Promise.resolve(null),
    repository.listAuditEvents(parsedOrganizationId),
  ]);
  const operationalLatestAuditAt = operationalAuditEvents.reduce(
    (latest, event) => (latest === null || Date.parse(event.occurred_at) > Date.parse(latest) ? event.occurred_at : latest),
    null,
  );

  const inspection = await inspector.inspect({
    connectionString: disposableConnectionString,
    organizationId: parsedOrganizationId,
    repositoryId: parsedRepositoryId,
  });

  if (!inspection || inspection.latest_audit_event_at === null || inspection.latest_audit_event_at === undefined) {
    throw invalid('the disposable target has no restored audit history for this organization', 'MANAGED_GOVERNANCE_RECOVERY_TARGET_EMPTY');
  }

  const tenantIsolationVerified = Array.isArray(inspection.tables_missing_rls) && inspection.tables_missing_rls.length === 0;
  const activeCatalogVerified = Boolean(
    operationalCatalog && inspection.active_batch_id === operationalCatalog.batch_id && inspection.catalog_entry_count > 0,
  );
  const releaseSignaturesVerified = expectedReleaseId
    ? Boolean(
        operationalRelease &&
          inspection.published_release &&
          inspection.published_release.signer_id === operationalRelease.signer_id &&
          inspection.published_release.signature_algorithm === operationalRelease.signature_algorithm &&
          inspection.published_release.signed_digest === operationalRelease.signed_digest,
      )
    : inspection.published_release === null;
  const auditHistoryAppendOnlyVerified = inspection.application_role_mutable_audit === false;

  const measuredRpoSeconds =
    operationalLatestAuditAt === null
      ? 0
      : Math.max(0, (Date.parse(operationalLatestAuditAt) - Date.parse(inspection.latest_audit_event_at)) / 1000);
  const measuredRtoSeconds = (Date.parse(restoreCompletedAt) - Date.parse(restoreStartedAt)) / 1000;

  const withinDeclaredProfile =
    measuredRpoSeconds <= parsedProfile.rpo_seconds &&
    measuredRtoSeconds <= parsedProfile.rto_seconds &&
    tenantIsolationVerified &&
    activeCatalogVerified &&
    releaseSignaturesVerified &&
    auditHistoryAppendOnlyVerified;

  const evidence = parseContract(
    RecoveryRehearsalEvidenceSchema,
    {
      schema_version: 1,
      contract: 'recovery-rehearsal-evidence/v1',
      rehearsal_id: randomUUID(),
      recovery_profile_digest: digestCanonical(parsedProfile),
      disposable_target_ref: `env:${disposableTarget.connectionStringEnv}`,
      disposable_target_confirmed: true,
      measured_rpo_seconds: measuredRpoSeconds,
      measured_rto_seconds: measuredRtoSeconds,
      tenant_isolation_verified: tenantIsolationVerified,
      active_catalog_verified: activeCatalogVerified,
      release_signatures_verified: releaseSignaturesVerified,
      audit_history_append_only_verified: auditHistoryAppendOnlyVerified,
      within_declared_profile: withinDeclaredProfile,
      rehearsed_at: rehearsedAt,
    },
    'recovery rehearsal evidence',
  );

  return repository.recordRecoveryRehearsal({ organization_id: parsedOrganizationId, actor, evidence });
}

// Real inspector for production use: connects only to the disposable target (never an
// operational connection string) with a single short-lived connection and inspects exactly the
// facts FR-015 requires survived restoration. Not exercised by the unit test suite (which injects
// a fake inspector) -- validated separately against a real, throwaway PostgreSQL instance.
function createPostgresDisposableTargetInspector() {
  const { createPostgresPool } = require('../infrastructure/postgres/pool');
  return {
    async inspect({ connectionString, organizationId, repositoryId }) {
      const pool = createPostgresPool({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 5000,
        statementTimeoutMillis: 10_000,
        applicationName: 'hseos-recovery-rehearsal',
      });
      try {
        const [rlsResult, grantResult, repositoryResult, auditResult] = await Promise.all([
          pool.query(
            `SELECT c.relname FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'hseos_governance' AND c.relkind = 'r'
                AND c.relname <> 'schema_migrations'
                AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
          ),
          pool.query(
            `SELECT privilege_type FROM information_schema.role_table_grants
              WHERE table_schema = 'hseos_governance' AND table_name = 'audit_events'
                AND grantee = 'hseos_governance_application'`,
          ),
          pool.query(
            'SELECT active_batch_id FROM hseos_governance.repositories WHERE organization_id = $1 AND repository_id = $2',
            [organizationId, repositoryId],
          ),
          pool.query('SELECT max(occurred_at) AS latest FROM hseos_governance.audit_events WHERE organization_id = $1', [organizationId]),
        ]);

        // "Append-only survived restoration" requires both halves: the application role must
        // still be ABLE to operate the table (SELECT + INSERT present -- a restore that dropped
        // every grant would otherwise read as falsely "safe" just because UPDATE/DELETE happen
        // to be absent too) and must still be UNABLE to mutate or erase existing rows.
        const auditGrantPrivileges = new Set(grantResult.rows.map((row) => row.privilege_type));
        const auditGrantsRestored = auditGrantPrivileges.has('SELECT') && auditGrantPrivileges.has('INSERT');
        const auditGrantsMutable = auditGrantPrivileges.has('UPDATE') || auditGrantPrivileges.has('DELETE');

        const activeBatchId = repositoryResult.rows[0]?.active_batch_id ?? null;
        const catalogCountResult = activeBatchId
          ? await pool.query(
              'SELECT count(*)::int AS entry_count FROM hseos_governance.catalog_source_snapshots WHERE organization_id = $1 AND import_batch_id = $2',
              [organizationId, activeBatchId],
            )
          : { rows: [{ entry_count: 0 }] };

        const releaseResult = await pool.query(
          `SELECT release_id, signer_id, signature_algorithm, signed_digest
             FROM hseos_governance.release_publication_attempts
            WHERE organization_id = $1 AND source_repository_id = $2 AND stage = 'published'
            ORDER BY sequence DESC LIMIT 1`,
          [organizationId, repositoryId],
        );

        return {
          tables_missing_rls: rlsResult.rows.map((row) => row.relname),
          application_role_mutable_audit: auditGrantsMutable || !auditGrantsRestored,
          active_batch_id: activeBatchId,
          catalog_entry_count: catalogCountResult.rows[0]?.entry_count ?? 0,
          published_release: releaseResult.rows[0]
            ? {
                release_id: releaseResult.rows[0].release_id,
                signer_id: releaseResult.rows[0].signer_id,
                signature_algorithm: releaseResult.rows[0].signature_algorithm,
                signed_digest: releaseResult.rows[0].signed_digest,
              }
            : null,
          latest_audit_event_at: auditResult.rows[0]?.latest ? new Date(auditResult.rows[0].latest).toISOString() : null,
        };
      } finally {
        await pool.end();
      }
    },
  };
}

module.exports = {
  connectionIdentity,
  createPostgresDisposableTargetInspector,
  runRecoveryRehearsal,
};
