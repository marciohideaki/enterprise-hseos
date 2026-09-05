'use strict';

const { randomUUID } = require('node:crypto');
const { deepFreeze } = require('../../../../../packages/managed-governance-contracts');
const { buildImportReport } = require('../../application/catalog-parity');
const {
  GovernanceRepositoryError,
  artifactMaterialization,
  buildOrganizationMutation,
  parseRepositoryIdentifier,
  parseRepositoryUuid,
  prepareEnsureOrganizationCommand,
  prepareImportBatchCommand,
  prepareRecordNetworkAccessAuditCommand,
  prepareRecordPatchBundleCommand,
  prepareRecordReadinessEvaluationCommand,
  prepareRecordRecoveryRehearsalCommand,
  prepareRecordReleaseAttemptCommand,
  prepareRecordShadowReceiptCommand,
  prepareRollbackImportCommand,
} = require('../../domain/repository-port');

function freezeRows(rows) {
  return deepFreeze(
    rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])),
    ),
  );
}

function databaseError(error, fallbackCode = 'MANAGED_GOVERNANCE_DATABASE_FAILED') {
  if (error instanceof GovernanceRepositoryError) return error;
  const mapping = new Map([
    ['23503', 'MANAGED_GOVERNANCE_CONFLICT'],
    ['23505', 'MANAGED_GOVERNANCE_CONFLICT'],
    ['23514', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID'],
    ['40001', 'MANAGED_GOVERNANCE_DATABASE_RETRYABLE'],
    ['40P01', 'MANAGED_GOVERNANCE_DATABASE_RETRYABLE'],
    ['42501', 'MANAGED_GOVERNANCE_DATABASE_FORBIDDEN'],
  ]);
  return new GovernanceRepositoryError('PostgreSQL governance operation failed', mapping.get(error?.code) || fallbackCode, {
    database_code: typeof error?.code === 'string' ? error.code : null,
  });
}

class PostgresGovernanceRepository {
  constructor({ pool, clock, closePool = false }) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new GovernanceRepositoryError('a PostgreSQL pool is required', 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID');
    }
    this.pool = pool;
    this.clock = clock;
    this.closePool = closePool;
    this.closed = false;
  }

  _assertOpen() {
    if (this.closed) throw new GovernanceRepositoryError('governance repository is closed', 'MANAGED_GOVERNANCE_REPOSITORY_CLOSED');
  }

  async _transaction(organizationId, operation) {
    this._assertOpen();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE hseos_governance_application');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original error remains authoritative.
      }
      throw databaseError(error);
    } finally {
      client.release();
    }
  }

  async ensureOrganization(command) {
    const prepared = prepareEnsureOrganizationCommand(command, { clock: this.clock });
    return this._transaction(prepared.organization_id, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([prepared.organization_id, prepared.idempotency_key]),
      ]);
      const receiptResult = await client.query(
        'SELECT command_digest, result FROM hseos_governance.command_receipts WHERE organization_id = $1 AND idempotency_key = $2',
        [prepared.organization_id, prepared.idempotency_key],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (receipt.command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError(
            'idempotency key was already used for a different command',
            'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          );
        }
        return deepFreeze(structuredClone(receipt.result));
      }

      const existingResult = await client.query(
        'SELECT organization_pk, organization_id, slug, display_name, created_at FROM hseos_governance.organizations WHERE organization_id = $1',
        [prepared.organization_id],
      );
      const existing = freezeRows(existingResult.rows)[0] || null;
      if (existing && (existing.slug !== prepared.organization.slug || existing.display_name !== prepared.organization.display_name)) {
        throw new GovernanceRepositoryError('organization already exists with different data', 'MANAGED_GOVERNANCE_CONFLICT');
      }
      const mutation = buildOrganizationMutation(prepared, existing);
      if (!existing) {
        await client.query(
          'INSERT INTO hseos_governance.organizations(organization_pk, organization_id, slug, display_name, created_at) VALUES ($1, $2, $3, $4, $5)',
          [
            mutation.organization.organization_pk,
            mutation.organization.organization_id,
            mutation.organization.slug,
            mutation.organization.display_name,
            mutation.organization.created_at,
          ],
        );
      }
      await client.query(
        'INSERT INTO hseos_governance.audit_events(audit_event_id, organization_id, event_type, aggregate_type, aggregate_id, correlation_id, causation_id, actor, payload, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)',
        [
          mutation.auditEvent.audit_event_id,
          mutation.auditEvent.organization_id,
          mutation.auditEvent.event_type,
          mutation.auditEvent.aggregate_type,
          mutation.auditEvent.aggregate_id,
          mutation.auditEvent.correlation_id,
          mutation.auditEvent.causation_id,
          JSON.stringify(mutation.auditEvent.actor),
          JSON.stringify(mutation.auditEvent.payload),
          mutation.auditEvent.occurred_at,
        ],
      );
      await client.query(
        'INSERT INTO hseos_governance.outbox_messages(outbox_message_id, organization_id, topic, aggregate_type, aggregate_id, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
        [
          mutation.outboxMessage.outbox_message_id,
          mutation.outboxMessage.organization_id,
          mutation.outboxMessage.topic,
          mutation.outboxMessage.aggregate_type,
          mutation.outboxMessage.aggregate_id,
          JSON.stringify(mutation.outboxMessage.payload),
          mutation.outboxMessage.created_at,
        ],
      );
      await client.query(
        'INSERT INTO hseos_governance.command_receipts(command_receipt_id, organization_id, idempotency_key, command_digest, result, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
        [
          randomUUID(),
          prepared.organization_id,
          prepared.idempotency_key,
          prepared.command_digest,
          JSON.stringify(mutation.result),
          prepared.occurred_at,
        ],
      );
      return mutation.result;
    });
  }

  async _insertReceipt(client, prepared, result, organizationId = prepared.plan?.organization_id) {
    await client.query(
      'INSERT INTO hseos_governance.command_receipts(command_receipt_id, organization_id, idempotency_key, command_digest, result, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
      [randomUUID(), organizationId, prepared.idempotency_key, prepared.command_digest, JSON.stringify(result), prepared.occurred_at],
    );
  }

  async applyImportBatch(command) {
    const prepared = prepareImportBatchCommand(command, { clock: this.clock });
    const organizationId = prepared.plan.organization_id;
    return this._transaction(organizationId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([organizationId, prepared.plan.repository_id, 'catalog-import']),
      ]);
      const receiptResult = await client.query(
        'SELECT command_digest, result FROM hseos_governance.command_receipts WHERE organization_id = $1 AND idempotency_key = $2',
        [organizationId, prepared.idempotency_key],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (receipt.command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError(
            'idempotency key was already used for a different command',
            'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          );
        }
        return deepFreeze(structuredClone(receipt.result));
      }
      const existingBatchResult = await client.query(
        'SELECT import_batch_id, report, active FROM hseos_governance.import_batches WHERE organization_id = $1 AND batch_key = $2',
        [organizationId, prepared.plan.batch_key],
      );
      if (existingBatchResult.rows[0]) {
        const existingBatch = existingBatchResult.rows[0];
        const report = existingBatch.active
          ? buildImportReport({
              batchId: existingBatch.import_batch_id,
              plan: prepared.plan,
              status: 'completed',
              startedAt: new Date(existingBatch.report.started_at).toISOString(),
              completedAt: new Date(existingBatch.report.completed_at).toISOString(),
              activeBatch: true,
            })
          : deepFreeze(structuredClone(existingBatch.report));
        await this._insertReceipt(client, prepared, report);
        return report;
      }

      const repositoryResult = await client.query(
        'SELECT repository_pk, canonical_remote, active_batch_id, created_at FROM hseos_governance.repositories WHERE organization_id = $1 AND repository_id = $2 FOR UPDATE',
        [organizationId, prepared.plan.repository_id],
      );
      let repository = repositoryResult.rows[0];
      if (repository && repository.canonical_remote !== prepared.canonical_remote) {
        throw new GovernanceRepositoryError('repository remote differs from its durable identity', 'MANAGED_GOVERNANCE_CONFLICT');
      }
      if (!repository) {
        repository = {
          repository_pk: randomUUID(),
          canonical_remote: prepared.canonical_remote,
          active_batch_id: null,
          created_at: prepared.occurred_at,
        };
        await client.query(
          'INSERT INTO hseos_governance.repositories(repository_pk, organization_id, repository_id, canonical_remote, active_batch_id, created_at, updated_at) VALUES ($1, $2, $3, $4, NULL, $5, $5)',
          [repository.repository_pk, organizationId, prepared.plan.repository_id, prepared.canonical_remote, prepared.occurred_at],
        );
      }

      const previousSnapshotsResult = repository.active_batch_id
        ? await client.query(
            `SELECT s.source_path, s.artifact_id, s.artifact_type, s.classification_status,
                    s.content_digest, s.artifact_version_id, v.version
               FROM hseos_governance.catalog_source_snapshots s
               LEFT JOIN hseos_governance.artifact_versions v
                 ON v.organization_id = s.organization_id AND v.artifact_version_id = s.artifact_version_id
              WHERE s.organization_id = $1 AND s.import_batch_id = $2
              ORDER BY s.source_path`,
            [organizationId, repository.active_batch_id],
          )
        : { rows: [] };
      const previousSnapshots = freezeRows(previousSnapshotsResult.rows);
      const previousByPath = new Map(previousSnapshots.map((snapshot) => [snapshot.source_path, snapshot]));
      const entryByPath = new Map(prepared.entries.map((entry) => [entry.source_path, entry]));
      await client.query(
        `INSERT INTO hseos_governance.import_batches(
           import_batch_id, organization_id, repository_id, batch_key, idempotency_key, source_commit,
           importer_version, source_profile_digest, status, active, started_at, previous_batch_id, plan
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'applying', false, $9, $10, $11::jsonb)`,
        [
          prepared.batch_id,
          organizationId,
          prepared.plan.repository_id,
          prepared.plan.batch_key,
          prepared.idempotency_key,
          prepared.plan.source_commit,
          prepared.plan.importer_version,
          prepared.plan.source_profile_digest,
          prepared.occurred_at,
          repository.active_batch_id,
          JSON.stringify(prepared.plan),
        ],
      );

      const nextSnapshots = [];
      for (const item of prepared.plan.items) {
        const importBatchItemId = randomUUID();
        await client.query(
          `INSERT INTO hseos_governance.import_batch_items(
             import_batch_item_id, organization_id, import_batch_id, source_path, artifact_id,
             action, classification_status, content_digest, issues, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            importBatchItemId,
            organizationId,
            prepared.batch_id,
            item.source_path,
            item.artifact_id,
            item.action,
            item.classification_status,
            item.content_digest,
            JSON.stringify(item.issues),
            prepared.occurred_at,
          ],
        );
        if (item.action === 'deactivate') continue;
        const entry = entryByPath.get(item.source_path);
        const previous =
          previousByPath.get(item.source_path) ||
          (item.previous_source_path ? previousByPath.get(item.previous_source_path) : null) ||
          previousSnapshots.find(
            (snapshot) => snapshot.artifact_id === item.artifact_id && snapshot.content_digest === item.content_digest,
          );
        let artifactVersionId = null;
        if (['noop', 'rename'].includes(item.action)) {
          if (!previous?.artifact_version_id) {
            throw new GovernanceRepositoryError('import plan references missing prior content', 'MANAGED_GOVERNANCE_IMPORT_PLAN_STALE');
          }
          artifactVersionId = previous.artifact_version_id;
        } else if (item.artifact_id) {
          const materialization = artifactMaterialization(entry);
          const artifactResult = await client.query(
            'SELECT artifact_pk, slug, created_at, current_version FROM hseos_governance.governance_artifacts WHERE organization_id = $1 AND artifact_id = $2 FOR UPDATE',
            [organizationId, item.artifact_id],
          );
          const artifact = artifactResult.rows[0];
          if (!artifact) {
            await client.query(
              `INSERT INTO hseos_governance.governance_artifacts(
                 artifact_pk, organization_id, artifact_id, artifact_type, namespace, slug, title,
                 lifecycle_status, current_version, created_at, updated_at
               ) VALUES ($1, $2, $3, $4, 'imported', $5, $6, $7, NULL, $8, $8)`,
              [
                randomUUID(),
                organizationId,
                item.artifact_id,
                item.artifact_type,
                materialization.slug,
                materialization.title,
                item.action === 'review' ? 'draft' : 'published',
                prepared.occurred_at,
              ],
            );
          }
          const versionResult = await client.query(
            'SELECT artifact_version_id, version FROM hseos_governance.artifact_versions WHERE organization_id = $1 AND artifact_id = $2 AND content_digest = $3',
            [organizationId, item.artifact_id, item.content_digest],
          );
          let version = versionResult.rows[0];
          if (!version) {
            const maximumVersionResult = await client.query(
              'SELECT COALESCE(MAX(version), 0)::integer AS maximum_version FROM hseos_governance.artifact_versions WHERE organization_id = $1 AND artifact_id = $2',
              [organizationId, item.artifact_id],
            );
            const nextVersion = maximumVersionResult.rows[0].maximum_version + 1;
            version = { artifact_version_id: randomUUID(), version: nextVersion };
            await client.query(
              `INSERT INTO hseos_governance.artifact_versions(
                 artifact_version_id, organization_id, artifact_id, version, raw_content, structured_content,
                 content_digest, source_repository_id, source_path, source_commit, source_section,
                 classification_status, import_batch_id, active, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, NULL, $11, $12, true, $13)`,
              [
                version.artifact_version_id,
                organizationId,
                item.artifact_id,
                version.version,
                entry.raw_content,
                JSON.stringify(materialization.structured_content),
                item.content_digest,
                prepared.plan.repository_id,
                item.source_path,
                prepared.plan.source_commit,
                item.classification_status,
                prepared.batch_id,
                prepared.occurred_at,
              ],
            );
          }
          artifactVersionId = version.artifact_version_id;
          await client.query(
            `UPDATE hseos_governance.governance_artifacts
                SET artifact_type = $3, title = $4, lifecycle_status = $5, current_version = $6, updated_at = $7
              WHERE organization_id = $1 AND artifact_id = $2`,
            [
              organizationId,
              item.artifact_id,
              item.artifact_type,
              materialization.title,
              item.action === 'review' ? 'draft' : 'published',
              version.version,
              prepared.occurred_at,
            ],
          );
        }
        if (item.action === 'review') {
          await client.query(
            `INSERT INTO hseos_governance.review_queue(
               review_item_id, organization_id, import_batch_item_id, status, reason_code, resolution, created_at
             ) VALUES ($1, $2, $3, 'open', 'classification_required', NULL, $4)`,
            [randomUUID(), organizationId, importBatchItemId, prepared.occurred_at],
          );
        }
        const snapshot = {
          catalog_source_snapshot_id: randomUUID(),
          source_path: item.source_path,
          artifact_id: item.artifact_id,
          artifact_type: item.artifact_type,
          classification_status: item.classification_status,
          content_digest: item.content_digest,
          artifact_version_id: artifactVersionId,
        };
        nextSnapshots.push(snapshot);
        await client.query(
          `INSERT INTO hseos_governance.catalog_source_snapshots(
             catalog_source_snapshot_id, organization_id, repository_id, import_batch_id, source_path,
             artifact_id, artifact_type, classification_status, content_digest, artifact_version_id, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            snapshot.catalog_source_snapshot_id,
            organizationId,
            prepared.plan.repository_id,
            prepared.batch_id,
            snapshot.source_path,
            snapshot.artifact_id,
            snapshot.artifact_type,
            snapshot.classification_status,
            snapshot.content_digest,
            snapshot.artifact_version_id,
            prepared.occurred_at,
          ],
        );
      }

      const nextArtifactIds = new Set(nextSnapshots.map((snapshot) => snapshot.artifact_id).filter(Boolean));
      for (const snapshot of nextSnapshots) {
        if (!snapshot.artifact_id || !snapshot.artifact_version_id) continue;
        const version = previousSnapshots.find((previous) => previous.artifact_version_id === snapshot.artifact_version_id)?.version;
        const persistedVersion =
          version ||
          (
            await client.query(
              'SELECT version FROM hseos_governance.artifact_versions WHERE organization_id = $1 AND artifact_version_id = $2',
              [organizationId, snapshot.artifact_version_id],
            )
          ).rows[0]?.version;
        await client.query(
          `UPDATE hseos_governance.governance_artifacts
              SET current_version = $3, lifecycle_status = $4, updated_at = $5
            WHERE organization_id = $1 AND artifact_id = $2`,
          [
            organizationId,
            snapshot.artifact_id,
            persistedVersion,
            snapshot.classification_status === 'classified' ? 'published' : 'draft',
            prepared.occurred_at,
          ],
        );
      }
      for (const previous of previousSnapshots) {
        if (previous.artifact_id && !nextArtifactIds.has(previous.artifact_id)) {
          await client.query(
            "UPDATE hseos_governance.governance_artifacts SET lifecycle_status = 'deprecated', updated_at = $3 WHERE organization_id = $1 AND artifact_id = $2",
            [organizationId, previous.artifact_id, prepared.occurred_at],
          );
        }
      }
      if (repository.active_batch_id) {
        await client.query(
          'UPDATE hseos_governance.import_batches SET active = false WHERE organization_id = $1 AND import_batch_id = $2',
          [organizationId, repository.active_batch_id],
        );
      }
      const report = buildImportReport({
        batchId: prepared.batch_id,
        plan: prepared.plan,
        status: 'completed',
        startedAt: prepared.occurred_at,
        completedAt: prepared.occurred_at,
        activeBatch: true,
      });
      await client.query(
        "UPDATE hseos_governance.import_batches SET status = 'completed', active = true, completed_at = $3, report = $4::jsonb WHERE organization_id = $1 AND import_batch_id = $2",
        [organizationId, prepared.batch_id, prepared.occurred_at, JSON.stringify(report)],
      );
      await client.query(
        'UPDATE hseos_governance.repositories SET active_batch_id = $3, updated_at = $4 WHERE organization_id = $1 AND repository_id = $2',
        [organizationId, prepared.plan.repository_id, prepared.batch_id, prepared.occurred_at],
      );
      await client.query(
        'INSERT INTO hseos_governance.audit_events(audit_event_id, organization_id, event_type, aggregate_type, aggregate_id, correlation_id, causation_id, actor, payload, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)',
        [
          prepared.audit_event_id,
          organizationId,
          'catalog.import.completed',
          'import_batch',
          prepared.batch_id,
          prepared.correlation_id,
          prepared.causation_id,
          JSON.stringify(prepared.actor),
          JSON.stringify({ plan_id: prepared.plan.plan_id, batch_key: prepared.plan.batch_key }),
          prepared.occurred_at,
        ],
      );
      await client.query(
        'INSERT INTO hseos_governance.outbox_messages(outbox_message_id, organization_id, topic, aggregate_type, aggregate_id, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
        [
          prepared.outbox_message_id,
          organizationId,
          'governance.catalog.imported',
          'import_batch',
          prepared.batch_id,
          JSON.stringify({ audit_event_id: prepared.audit_event_id, plan_id: prepared.plan.plan_id }),
          prepared.occurred_at,
        ],
      );
      await this._insertReceipt(client, prepared, report);
      return report;
    });
  }

  async rollbackImportBatch(command) {
    const prepared = prepareRollbackImportCommand(command, { clock: this.clock });
    return this._transaction(prepared.organization_id, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([prepared.organization_id, prepared.repository_id, 'catalog-import']),
      ]);
      const receiptResult = await client.query(
        'SELECT command_digest, result FROM hseos_governance.command_receipts WHERE organization_id = $1 AND idempotency_key = $2',
        [prepared.organization_id, prepared.idempotency_key],
      );
      if (receiptResult.rows[0]) {
        if (receiptResult.rows[0].command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError('idempotency key conflicts with another command', 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT');
        }
        return deepFreeze(structuredClone(receiptResult.rows[0].result));
      }
      const repositoryResult = await client.query(
        'SELECT active_batch_id FROM hseos_governance.repositories WHERE organization_id = $1 AND repository_id = $2 FOR UPDATE',
        [prepared.organization_id, prepared.repository_id],
      );
      const batchResult = await client.query(
        'SELECT previous_batch_id, plan, report FROM hseos_governance.import_batches WHERE organization_id = $1 AND import_batch_id = $2 FOR UPDATE',
        [prepared.organization_id, prepared.batch_id],
      );
      const repository = repositoryResult.rows[0];
      const batch = batchResult.rows[0];
      if (!repository || !batch || repository.active_batch_id !== prepared.batch_id || !batch.previous_batch_id) {
        throw new GovernanceRepositoryError('active import batch cannot be rolled back', 'MANAGED_GOVERNANCE_CONFLICT');
      }
      const previousSnapshots = await client.query(
        `SELECT s.artifact_id, v.version
           FROM hseos_governance.catalog_source_snapshots s
           LEFT JOIN hseos_governance.artifact_versions v
             ON v.organization_id = s.organization_id AND v.artifact_version_id = s.artifact_version_id
          WHERE s.organization_id = $1 AND s.import_batch_id = $2`,
        [prepared.organization_id, batch.previous_batch_id],
      );
      const restoredArtifactIds = new Set();
      for (const snapshot of previousSnapshots.rows) {
        if (!snapshot.artifact_id || restoredArtifactIds.has(snapshot.artifact_id)) continue;
        restoredArtifactIds.add(snapshot.artifact_id);
        await client.query(
          "UPDATE hseos_governance.governance_artifacts SET current_version = $3, lifecycle_status = 'published', updated_at = $4 WHERE organization_id = $1 AND artifact_id = $2",
          [prepared.organization_id, snapshot.artifact_id, snapshot.version, prepared.occurred_at],
        );
      }
      const currentArtifacts = await client.query(
        'SELECT DISTINCT artifact_id FROM hseos_governance.catalog_source_snapshots WHERE organization_id = $1 AND import_batch_id = $2 AND artifact_id IS NOT NULL',
        [prepared.organization_id, prepared.batch_id],
      );
      for (const { artifact_id: artifactId } of currentArtifacts.rows) {
        if (!restoredArtifactIds.has(artifactId)) {
          await client.query(
            "UPDATE hseos_governance.governance_artifacts SET lifecycle_status = 'deprecated', updated_at = $3 WHERE organization_id = $1 AND artifact_id = $2",
            [prepared.organization_id, artifactId, prepared.occurred_at],
          );
        }
      }
      await client.query(
        "UPDATE hseos_governance.import_batches SET status = 'rolled-back', active = false WHERE organization_id = $1 AND import_batch_id = $2",
        [prepared.organization_id, prepared.batch_id],
      );
      await client.query('UPDATE hseos_governance.import_batches SET active = true WHERE organization_id = $1 AND import_batch_id = $2', [
        prepared.organization_id,
        batch.previous_batch_id,
      ]);
      await client.query(
        'UPDATE hseos_governance.repositories SET active_batch_id = $3, updated_at = $4 WHERE organization_id = $1 AND repository_id = $2',
        [prepared.organization_id, prepared.repository_id, batch.previous_batch_id, prepared.occurred_at],
      );
      const report = buildImportReport({
        batchId: prepared.batch_id,
        plan: batch.plan,
        status: 'rolled-back',
        startedAt: new Date(batch.report.started_at).toISOString(),
        completedAt: prepared.occurred_at,
        activeBatch: false,
      });
      await client.query(
        'UPDATE hseos_governance.import_batches SET report = $3::jsonb, completed_at = $4 WHERE organization_id = $1 AND import_batch_id = $2',
        [prepared.organization_id, prepared.batch_id, JSON.stringify(report), prepared.occurred_at],
      );
      await client.query(
        'INSERT INTO hseos_governance.audit_events(audit_event_id, organization_id, event_type, aggregate_type, aggregate_id, correlation_id, causation_id, actor, payload, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)',
        [
          prepared.audit_event_id,
          prepared.organization_id,
          'catalog.import.rolled-back',
          'import_batch',
          prepared.batch_id,
          prepared.correlation_id,
          prepared.causation_id,
          JSON.stringify(prepared.actor),
          JSON.stringify({ restored_batch_id: batch.previous_batch_id }),
          prepared.occurred_at,
        ],
      );
      await client.query(
        'INSERT INTO hseos_governance.outbox_messages(outbox_message_id, organization_id, topic, aggregate_type, aggregate_id, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
        [
          prepared.outbox_message_id,
          prepared.organization_id,
          'governance.catalog.rollback',
          'import_batch',
          prepared.batch_id,
          JSON.stringify({ audit_event_id: prepared.audit_event_id, restored_batch_id: batch.previous_batch_id }),
          prepared.occurred_at,
        ],
      );
      await this._insertReceipt(client, prepared, report, prepared.organization_id);
      return report;
    });
  }

  async _readTenant(organizationId, query, parameters) {
    return this._transaction(organizationId, async (client) => freezeRows((await client.query(query, parameters)).rows));
  }

  async getOrganization(organizationId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT organization_pk, organization_id, slug, display_name, created_at FROM hseos_governance.organizations WHERE organization_id = $1',
      [parsedOrganizationId],
    );
    return rows[0] || null;
  }

  async listMigrationVersions(organizationId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return this._readTenant(
      parsedOrganizationId,
      'SELECT version, name, checksum, applied_at FROM hseos_governance.schema_migrations ORDER BY version',
      [],
    );
  }

  async getCommandReceipt(organizationId, idempotencyKey) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const parsedIdempotencyKey = parseRepositoryIdentifier(idempotencyKey, 'idempotency key');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT organization_id, idempotency_key, command_digest, result, created_at FROM hseos_governance.command_receipts WHERE organization_id = $1 AND idempotency_key = $2',
      [parsedOrganizationId, parsedIdempotencyKey],
    );
    return rows[0] || null;
  }

  async listCatalogEntries(organizationId, repositoryId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const parsedRepositoryId = parseRepositoryUuid(repositoryId, 'repository id');
    return this._readTenant(
      parsedOrganizationId,
      `SELECT s.source_path, s.artifact_id, s.artifact_type, s.classification_status,
              s.content_digest, s.artifact_version_id
         FROM hseos_governance.repositories r
         JOIN hseos_governance.catalog_source_snapshots s
           ON s.organization_id = r.organization_id AND s.import_batch_id = r.active_batch_id
        WHERE r.organization_id = $1 AND r.repository_id = $2
        ORDER BY s.source_path`,
      [parsedOrganizationId, parsedRepositoryId],
    );
  }

  async getCatalogProjectionMetadata(organizationId, repositoryId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const parsedRepositoryId = parseRepositoryUuid(repositoryId, 'repository id');
    const rows = await this._readTenant(
      parsedOrganizationId,
      `SELECT b.import_batch_id AS batch_id, b.source_commit
         FROM hseos_governance.repositories r
         JOIN hseos_governance.import_batches b
           ON b.organization_id = r.organization_id AND b.import_batch_id = r.active_batch_id
        WHERE r.organization_id = $1 AND r.repository_id = $2`,
      [parsedOrganizationId, parsedRepositoryId],
    );
    return rows[0] || null;
  }

  async listAuditEvents(organizationId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return this._readTenant(
      parsedOrganizationId,
      'SELECT audit_event_id, organization_id, event_type, aggregate_type, aggregate_id, correlation_id, causation_id, actor, payload, occurred_at FROM hseos_governance.audit_events WHERE organization_id = $1 ORDER BY occurred_at, audit_event_id',
      [parsedOrganizationId],
    );
  }

  async listOutboxMessages(organizationId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return this._readTenant(
      parsedOrganizationId,
      'SELECT outbox_message_id, organization_id, topic, aggregate_type, aggregate_id, payload, created_at, delivered_at FROM hseos_governance.outbox_messages WHERE organization_id = $1 ORDER BY created_at, outbox_message_id',
      [parsedOrganizationId],
    );
  }

  async _insertAuditAndOutbox(client, prepared, eventType, aggregateType, topic) {
    await client.query(
      'INSERT INTO hseos_governance.audit_events(audit_event_id, organization_id, event_type, aggregate_type, aggregate_id, correlation_id, causation_id, actor, payload, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)',
      [
        prepared.audit_event_id,
        prepared.organization_id,
        eventType,
        aggregateType,
        prepared.record_id,
        prepared.correlation_id,
        prepared.causation_id,
        JSON.stringify(prepared.actor),
        JSON.stringify({ kind: aggregateType, record_id: prepared.record_id }),
        prepared.occurred_at,
      ],
    );
    await client.query(
      'INSERT INTO hseos_governance.outbox_messages(outbox_message_id, organization_id, topic, aggregate_type, aggregate_id, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [
        prepared.outbox_message_id,
        prepared.organization_id,
        topic,
        aggregateType,
        prepared.record_id,
        JSON.stringify({ audit_event_id: prepared.audit_event_id, record_id: prepared.record_id }),
        prepared.occurred_at,
      ],
    );
  }

  // Idempotency is resolved through the same command_receipts table ensureOrganization and
  // applyImportBatch use, keyed by the evidence's natural key instead of a caller-supplied
  // idempotency_key. The receipt stores the digest and result as originally computed, so a
  // retry never re-derives a digest from a row PostgreSQL has round-tripped (numeric columns
  // come back as strings, not numbers, which would otherwise make canonical re-digesting of a
  // fetched row silently diverge from the digest computed at write time).
  async _recordEvidenceRow({ prepared, table, columns, jsonColumns, eventType, aggregateType, topic }) {
    return this._transaction(prepared.organization_id, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [prepared.natural_key]);
      const receiptResult = await client.query(
        'SELECT command_digest, result FROM hseos_governance.command_receipts WHERE organization_id = $1 AND idempotency_key = $2',
        [prepared.organization_id, prepared.natural_key],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (receipt.command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError(
            'evidence was already recorded with different content',
            'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          );
        }
        return deepFreeze(structuredClone(receipt.result));
      }
      const values = columns.map((column) => {
        const value = prepared.record[column];
        return jsonColumns.has(column) ? JSON.stringify(value) : value;
      });
      const placeholders = columns.map((column, index) => (jsonColumns.has(column) ? `$${index + 1}::jsonb` : `$${index + 1}`));
      const insertResult = await client.query(
        `INSERT INTO hseos_governance.${table}(${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        values,
      );
      await this._insertAuditAndOutbox(client, prepared, eventType, aggregateType, topic);
      const record = freezeRows(insertResult.rows)[0];
      await client.query(
        'INSERT INTO hseos_governance.command_receipts(command_receipt_id, organization_id, idempotency_key, command_digest, result, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
        [randomUUID(), prepared.organization_id, prepared.natural_key, prepared.command_digest, JSON.stringify(record), prepared.occurred_at],
      );
      return record;
    });
  }

  async recordReleasePublicationAttempt(command) {
    const prepared = prepareRecordReleaseAttemptCommand(command, { clock: this.clock });
    return this._recordEvidenceRow({
      prepared,
      table: 'release_publication_attempts',
      columns: Object.keys(prepared.record),
      jsonColumns: new Set(),
      eventType: 'governance.release_publication_attempt.recorded',
      aggregateType: 'release_publication_attempt',
      topic: 'governance.release_publication_attempt.recorded',
    });
  }

  async getReleasePublicationAttempt(organizationId, releasePublicationAttemptId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT * FROM hseos_governance.release_publication_attempts WHERE organization_id = $1 AND release_publication_attempt_id = $2',
      [parsedOrganizationId, releasePublicationAttemptId],
    );
    return rows[0] || null;
  }

  async recordPatchPublicationBundle(command) {
    const prepared = prepareRecordPatchBundleCommand(command, { clock: this.clock });
    return this._recordEvidenceRow({
      prepared,
      table: 'patch_publication_bundles',
      columns: Object.keys(prepared.record),
      jsonColumns: new Set(['file_operations']),
      eventType: 'governance.patch_publication_bundle.generated',
      aggregateType: 'patch_publication_bundle',
      topic: 'governance.patch_publication_bundle.generated',
    });
  }

  async getPatchPublicationBundle(organizationId, patchPublicationBundleId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT * FROM hseos_governance.patch_publication_bundles WHERE organization_id = $1 AND patch_publication_bundle_id = $2',
      [parsedOrganizationId, patchPublicationBundleId],
    );
    return rows[0] || null;
  }

  async recordShadowReceipt(command) {
    const prepared = prepareRecordShadowReceiptCommand(command, { clock: this.clock });
    return this._recordEvidenceRow({
      prepared,
      table: 'shadow_receipts',
      columns: Object.keys(prepared.record),
      jsonColumns: new Set(),
      eventType: 'governance.shadow_receipt.recorded',
      aggregateType: 'shadow_receipt',
      topic: 'governance.shadow_receipt.recorded',
    });
  }

  async getShadowReceipt(organizationId, shadowReceiptId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT * FROM hseos_governance.shadow_receipts WHERE organization_id = $1 AND shadow_receipt_id = $2',
      [parsedOrganizationId, shadowReceiptId],
    );
    return rows[0] || null;
  }

  async recordReadinessEvaluation(command) {
    const prepared = prepareRecordReadinessEvaluationCommand(command, { clock: this.clock });
    return this._recordEvidenceRow({
      prepared,
      table: 'readiness_evaluations',
      columns: Object.keys(prepared.record),
      jsonColumns: new Set(['repositories_covered', 'repositories_missing_evidence', 'adapters_covered', 'adapters_missing_evidence']),
      eventType: 'governance.readiness_evaluated',
      aggregateType: 'readiness_evaluation',
      topic: 'governance.readiness_evaluated',
    });
  }

  async getReadinessEvaluation(organizationId, readinessEvaluationId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT * FROM hseos_governance.readiness_evaluations WHERE organization_id = $1 AND readiness_evaluation_id = $2',
      [parsedOrganizationId, readinessEvaluationId],
    );
    return rows[0] || null;
  }

  async recordRecoveryRehearsal(command) {
    const prepared = prepareRecordRecoveryRehearsalCommand(command, { clock: this.clock });
    return this._recordEvidenceRow({
      prepared,
      table: 'recovery_rehearsals',
      columns: Object.keys(prepared.record),
      jsonColumns: new Set(),
      eventType: 'governance.recovery_rehearsed',
      aggregateType: 'recovery_rehearsal',
      topic: 'governance.recovery_rehearsed',
    });
  }

  async getRecoveryRehearsal(organizationId, recoveryRehearsalId) {
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const rows = await this._readTenant(
      parsedOrganizationId,
      'SELECT * FROM hseos_governance.recovery_rehearsals WHERE organization_id = $1 AND recovery_rehearsal_id = $2',
      [parsedOrganizationId, recoveryRehearsalId],
    );
    return rows[0] || null;
  }

  async recordNetworkAccessAudit(command) {
    const prepared = prepareRecordNetworkAccessAuditCommand(command, { clock: this.clock });
    return this._recordEvidenceRow({
      prepared,
      table: 'network_access_audit',
      columns: Object.keys(prepared.record),
      jsonColumns: new Set(),
      eventType: 'governance.network_access.audited',
      aggregateType: 'network_access_audit',
      topic: 'governance.network_access.audited',
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.closePool && typeof this.pool.end === 'function') await this.pool.end();
  }
}

module.exports = {
  PostgresGovernanceRepository,
  databaseError,
};
