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
  prepareRollbackImportCommand,
} = require('../../domain/repository-port');

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

class MemoryGovernanceRepository {
  constructor(options = {}) {
    this.clock = options.clock;
    this.organizations = new Map();
    this.receipts = new Map();
    this.auditEvents = [];
    this.outboxMessages = [];
    this.repositories = new Map();
    this.artifacts = new Map();
    this.artifactVersions = new Map();
    this.importBatches = new Map();
    this.batchKeys = new Map();
    this.catalogSnapshots = new Map();
    this.closed = false;
    this.queue = Promise.resolve();
  }

  _assertOpen() {
    if (this.closed) throw new GovernanceRepositoryError('governance repository is closed', 'MANAGED_GOVERNANCE_REPOSITORY_CLOSED');
  }

  _receiptKey(organizationId, idempotencyKey) {
    return `${organizationId}\0${idempotencyKey}`;
  }

  _repositoryKey(organizationId, repositoryId) {
    return `${organizationId}\0${repositoryId}`;
  }

  _artifactKey(organizationId, artifactId) {
    return `${organizationId}\0${artifactId}`;
  }

  _enqueue(execute) {
    const operation = this.queue.then(execute, execute);
    this.queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  async ensureOrganization(command) {
    this._assertOpen();
    const prepared = prepareEnsureOrganizationCommand(command, { clock: this.clock });
    const execute = async () => {
      this._assertOpen();
      const receiptKey = this._receiptKey(prepared.organization_id, prepared.idempotency_key);
      const receipt = this.receipts.get(receiptKey);
      if (receipt) {
        if (receipt.command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError(
            'idempotency key was already used for a different command',
            'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          );
        }
        return deepFreeze(clone(receipt.result));
      }

      const existing = this.organizations.get(prepared.organization_id);
      if (existing && (existing.slug !== prepared.organization.slug || existing.display_name !== prepared.organization.display_name)) {
        throw new GovernanceRepositoryError('organization already exists with different data', 'MANAGED_GOVERNANCE_CONFLICT');
      }
      const mutation = buildOrganizationMutation(prepared, existing || null);
      this.organizations.set(prepared.organization_id, clone(mutation.organization));
      this.auditEvents.push(clone(mutation.auditEvent));
      this.outboxMessages.push(clone(mutation.outboxMessage));
      this.receipts.set(receiptKey, {
        organization_id: prepared.organization_id,
        idempotency_key: prepared.idempotency_key,
        command_digest: prepared.command_digest,
        result: clone(mutation.result),
        created_at: prepared.occurred_at,
      });
      return deepFreeze(clone(mutation.result));
    };
    return this._enqueue(execute);
  }

  async applyImportBatch(command) {
    this._assertOpen();
    const prepared = prepareImportBatchCommand(command, { clock: this.clock });
    return this._enqueue(async () => {
      this._assertOpen();
      const receiptKey = this._receiptKey(prepared.plan.organization_id, prepared.idempotency_key);
      const receipt = this.receipts.get(receiptKey);
      if (receipt) {
        if (receipt.command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError(
            'idempotency key was already used for a different command',
            'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          );
        }
        return deepFreeze(clone(receipt.result));
      }
      if (!this.organizations.has(prepared.plan.organization_id)) {
        throw new GovernanceRepositoryError('organization must exist before import', 'MANAGED_GOVERNANCE_NOT_FOUND');
      }
      const batchKey = this._receiptKey(prepared.plan.organization_id, prepared.plan.batch_key);
      const existingBatchId = this.batchKeys.get(batchKey);
      if (existingBatchId) {
        const existingBatch = this.importBatches.get(existingBatchId);
        const existingReport = existingBatch.active
          ? buildImportReport({
              batchId: existingBatchId,
              plan: prepared.plan,
              status: 'completed',
              startedAt: existingBatch.report.started_at,
              completedAt: existingBatch.report.completed_at,
              activeBatch: true,
            })
          : clone(existingBatch.report);
        this.receipts.set(receiptKey, {
          organization_id: prepared.plan.organization_id,
          idempotency_key: prepared.idempotency_key,
          command_digest: prepared.command_digest,
          result: clone(existingReport),
          created_at: prepared.occurred_at,
        });
        return deepFreeze(clone(existingReport));
      }

      const organizations = structuredClone(this.organizations);
      const repositories = structuredClone(this.repositories);
      const artifacts = structuredClone(this.artifacts);
      const artifactVersions = structuredClone(this.artifactVersions);
      const importBatches = structuredClone(this.importBatches);
      const batchKeys = structuredClone(this.batchKeys);
      const catalogSnapshots = structuredClone(this.catalogSnapshots);
      const receipts = structuredClone(this.receipts);
      const auditEvents = structuredClone(this.auditEvents);
      const outboxMessages = structuredClone(this.outboxMessages);
      const repositoryKey = this._repositoryKey(prepared.plan.organization_id, prepared.plan.repository_id);
      const repository = repositories.get(repositoryKey) || {
        repository_pk: randomUUID(),
        organization_id: prepared.plan.organization_id,
        repository_id: prepared.plan.repository_id,
        canonical_remote: prepared.canonical_remote,
        active_batch_id: null,
        created_at: prepared.occurred_at,
        updated_at: prepared.occurred_at,
      };
      if (repository.canonical_remote !== prepared.canonical_remote) {
        throw new GovernanceRepositoryError('repository remote differs from its durable identity', 'MANAGED_GOVERNANCE_CONFLICT');
      }
      const previousBatchId = repository.active_batch_id;
      const previousSnapshots = previousBatchId ? catalogSnapshots.get(previousBatchId) || [] : [];
      const previousByPath = new Map(previousSnapshots.map((snapshot) => [snapshot.source_path, snapshot]));
      const entryByPath = new Map(prepared.entries.map((entry) => [entry.source_path, entry]));
      const nextSnapshots = [];

      for (const item of prepared.plan.items) {
        if (item.action === 'deactivate') continue;
        const entry = entryByPath.get(item.source_path);
        let artifactVersion = null;
        let artifactId = item.artifact_id;
        const previous =
          previousByPath.get(item.source_path) ||
          (item.previous_source_path ? previousByPath.get(item.previous_source_path) : null) ||
          previousSnapshots.find((snapshot) => snapshot.artifact_id === artifactId && snapshot.content_digest === item.content_digest);
        if (['noop', 'rename'].includes(item.action)) {
          if (!previous?.artifact_version_id) {
            throw new GovernanceRepositoryError('import plan references missing prior content', 'MANAGED_GOVERNANCE_IMPORT_PLAN_STALE');
          }
          artifactVersion = (artifactVersions.get(this._artifactKey(prepared.plan.organization_id, artifactId)) || []).find(
            (version) => version.artifact_version_id === previous.artifact_version_id,
          );
        } else if (artifactId) {
          const artifactKey = this._artifactKey(prepared.plan.organization_id, artifactId);
          const versions = artifactVersions.get(artifactKey) || [];
          artifactVersion = versions.find((version) => version.content_digest === item.content_digest) || null;
          const materialization = artifactMaterialization(entry);
          if (!artifactVersion) {
            artifactVersion = {
              artifact_version_id: randomUUID(),
              organization_id: prepared.plan.organization_id,
              artifact_id: artifactId,
              version: versions.length + 1,
              raw_content: entry.raw_content,
              structured_content: materialization.structured_content,
              content_digest: item.content_digest,
              source_repository_id: prepared.plan.repository_id,
              source_path: item.source_path,
              source_commit: prepared.plan.source_commit,
              source_section: null,
              classification_status: item.classification_status,
              import_batch_id: prepared.batch_id,
              active: true,
              created_at: prepared.occurred_at,
            };
            versions.push(artifactVersion);
            artifactVersions.set(artifactKey, versions);
          }
          const existingArtifact = artifacts.get(artifactKey);
          artifacts.set(artifactKey, {
            artifact_pk: existingArtifact?.artifact_pk || randomUUID(),
            organization_id: prepared.plan.organization_id,
            artifact_id: artifactId,
            artifact_type: item.artifact_type,
            namespace: 'imported',
            slug: existingArtifact?.slug || materialization.slug,
            title: materialization.title,
            lifecycle_status: item.action === 'review' ? 'draft' : 'published',
            current_version: artifactVersion.version,
            created_at: existingArtifact?.created_at || prepared.occurred_at,
            updated_at: prepared.occurred_at,
          });
        }
        nextSnapshots.push({
          catalog_source_snapshot_id: randomUUID(),
          organization_id: prepared.plan.organization_id,
          repository_id: prepared.plan.repository_id,
          import_batch_id: prepared.batch_id,
          source_path: item.source_path,
          artifact_id: artifactId,
          artifact_type: item.artifact_type,
          classification_status: item.classification_status,
          content_digest: item.content_digest,
          artifact_version_id: artifactVersion?.artifact_version_id || null,
          created_at: prepared.occurred_at,
        });
      }

      const activeVersionIds = new Set(nextSnapshots.map((snapshot) => snapshot.artifact_version_id).filter(Boolean));
      for (const [artifactKey, versions] of artifactVersions) {
        const artifact = artifacts.get(artifactKey);
        for (const version of versions) version.active = activeVersionIds.has(version.artifact_version_id);
        const activeVersion = versions.find((version) => version.active);
        if (artifact) {
          artifact.current_version = activeVersion?.version || artifact.current_version;
          artifact.lifecycle_status = activeVersion
            ? nextSnapshots.some(
                (snapshot) => snapshot.artifact_id === artifact.artifact_id && snapshot.classification_status !== 'classified',
              )
              ? 'draft'
              : 'published'
            : 'deprecated';
          artifact.updated_at = prepared.occurred_at;
        }
      }

      if (previousBatchId) importBatches.get(previousBatchId).active = false;
      repository.active_batch_id = prepared.batch_id;
      repository.updated_at = prepared.occurred_at;
      repositories.set(repositoryKey, repository);
      catalogSnapshots.set(prepared.batch_id, nextSnapshots);
      const report = buildImportReport({
        batchId: prepared.batch_id,
        plan: prepared.plan,
        status: 'completed',
        startedAt: prepared.occurred_at,
        completedAt: prepared.occurred_at,
        activeBatch: true,
      });
      importBatches.set(prepared.batch_id, {
        import_batch_id: prepared.batch_id,
        organization_id: prepared.plan.organization_id,
        repository_id: prepared.plan.repository_id,
        batch_key: prepared.plan.batch_key,
        idempotency_key: prepared.idempotency_key,
        previous_batch_id: previousBatchId,
        status: 'completed',
        active: true,
        plan: prepared.plan,
        report,
      });
      batchKeys.set(batchKey, prepared.batch_id);
      auditEvents.push({
        audit_event_id: prepared.audit_event_id,
        organization_id: prepared.plan.organization_id,
        event_type: 'catalog.import.completed',
        aggregate_type: 'import_batch',
        aggregate_id: prepared.batch_id,
        correlation_id: prepared.correlation_id,
        causation_id: prepared.causation_id,
        actor: prepared.actor,
        payload: { plan_id: prepared.plan.plan_id, batch_key: prepared.plan.batch_key },
        occurred_at: prepared.occurred_at,
      });
      outboxMessages.push({
        outbox_message_id: prepared.outbox_message_id,
        organization_id: prepared.plan.organization_id,
        topic: 'governance.catalog.imported',
        aggregate_type: 'import_batch',
        aggregate_id: prepared.batch_id,
        payload: { audit_event_id: prepared.audit_event_id, plan_id: prepared.plan.plan_id },
        created_at: prepared.occurred_at,
        delivered_at: null,
      });
      receipts.set(receiptKey, {
        organization_id: prepared.plan.organization_id,
        idempotency_key: prepared.idempotency_key,
        command_digest: prepared.command_digest,
        result: clone(report),
        created_at: prepared.occurred_at,
      });

      this.organizations = organizations;
      this.repositories = repositories;
      this.artifacts = artifacts;
      this.artifactVersions = artifactVersions;
      this.importBatches = importBatches;
      this.batchKeys = batchKeys;
      this.catalogSnapshots = catalogSnapshots;
      this.receipts = receipts;
      this.auditEvents = auditEvents;
      this.outboxMessages = outboxMessages;
      return report;
    });
  }

  async rollbackImportBatch(command) {
    this._assertOpen();
    const prepared = prepareRollbackImportCommand(command, { clock: this.clock });
    return this._enqueue(async () => {
      const receiptKey = this._receiptKey(prepared.organization_id, prepared.idempotency_key);
      const receipt = this.receipts.get(receiptKey);
      if (receipt) {
        if (receipt.command_digest !== prepared.command_digest) {
          throw new GovernanceRepositoryError('idempotency key conflicts with another command', 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT');
        }
        return deepFreeze(clone(receipt.result));
      }
      const repositories = structuredClone(this.repositories);
      const artifacts = structuredClone(this.artifacts);
      const artifactVersions = structuredClone(this.artifactVersions);
      const importBatches = structuredClone(this.importBatches);
      const receipts = structuredClone(this.receipts);
      const auditEvents = structuredClone(this.auditEvents);
      const outboxMessages = structuredClone(this.outboxMessages);
      const repositoryKey = this._repositoryKey(prepared.organization_id, prepared.repository_id);
      const repository = repositories.get(repositoryKey);
      const batch = importBatches.get(prepared.batch_id);
      if (!repository || !batch || repository.active_batch_id !== prepared.batch_id || !batch.previous_batch_id) {
        throw new GovernanceRepositoryError('active import batch cannot be rolled back', 'MANAGED_GOVERNANCE_CONFLICT');
      }
      const previousBatch = importBatches.get(batch.previous_batch_id);
      const previousSnapshots = this.catalogSnapshots.get(previousBatch.import_batch_id) || [];
      const activeVersionIds = new Set(previousSnapshots.map((snapshot) => snapshot.artifact_version_id).filter(Boolean));
      for (const [artifactKey, versions] of artifactVersions) {
        const artifact = artifacts.get(artifactKey);
        for (const version of versions) version.active = activeVersionIds.has(version.artifact_version_id);
        const activeVersion = versions.find((version) => version.active);
        if (artifact) {
          artifact.current_version = activeVersion?.version || artifact.current_version;
          artifact.lifecycle_status = activeVersion
            ? previousSnapshots.some(
                (snapshot) => snapshot.artifact_id === artifact.artifact_id && snapshot.classification_status !== 'classified',
              )
              ? 'draft'
              : 'published'
            : 'deprecated';
          artifact.updated_at = prepared.occurred_at;
        }
      }
      batch.status = 'rolled-back';
      batch.active = false;
      previousBatch.active = true;
      repository.active_batch_id = previousBatch.import_batch_id;
      repository.updated_at = prepared.occurred_at;
      const report = buildImportReport({
        batchId: batch.import_batch_id,
        plan: batch.plan,
        status: 'rolled-back',
        startedAt: batch.report.started_at,
        completedAt: prepared.occurred_at,
        activeBatch: false,
      });
      batch.report = report;
      auditEvents.push({
        audit_event_id: prepared.audit_event_id,
        organization_id: prepared.organization_id,
        event_type: 'catalog.import.rolled-back',
        aggregate_type: 'import_batch',
        aggregate_id: prepared.batch_id,
        correlation_id: prepared.correlation_id,
        causation_id: prepared.causation_id,
        actor: prepared.actor,
        payload: { restored_batch_id: previousBatch.import_batch_id },
        occurred_at: prepared.occurred_at,
      });
      outboxMessages.push({
        outbox_message_id: prepared.outbox_message_id,
        organization_id: prepared.organization_id,
        topic: 'governance.catalog.rollback',
        aggregate_type: 'import_batch',
        aggregate_id: prepared.batch_id,
        payload: { audit_event_id: prepared.audit_event_id, restored_batch_id: previousBatch.import_batch_id },
        created_at: prepared.occurred_at,
        delivered_at: null,
      });
      receipts.set(receiptKey, {
        organization_id: prepared.organization_id,
        idempotency_key: prepared.idempotency_key,
        command_digest: prepared.command_digest,
        result: clone(report),
        created_at: prepared.occurred_at,
      });
      this.repositories = repositories;
      this.artifacts = artifacts;
      this.artifactVersions = artifactVersions;
      this.importBatches = importBatches;
      this.receipts = receipts;
      this.auditEvents = auditEvents;
      this.outboxMessages = outboxMessages;
      return deepFreeze(clone(report));
    });
  }

  async listCatalogEntries(organizationId, repositoryId) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const parsedRepositoryId = parseRepositoryUuid(repositoryId, 'repository id');
    const repository = this.repositories.get(this._repositoryKey(parsedOrganizationId, parsedRepositoryId));
    const snapshots = repository?.active_batch_id ? this.catalogSnapshots.get(repository.active_batch_id) || [] : [];
    return deepFreeze(
      clone(
        snapshots.map((snapshot) => ({
          source_path: snapshot.source_path,
          artifact_id: snapshot.artifact_id,
          artifact_type: snapshot.artifact_type,
          classification_status: snapshot.classification_status,
          content_digest: snapshot.content_digest,
          artifact_version_id: snapshot.artifact_version_id,
        })),
      ),
    );
  }

  async getCatalogProjectionMetadata(organizationId, repositoryId) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const parsedRepositoryId = parseRepositoryUuid(repositoryId, 'repository id');
    const repository = this.repositories.get(this._repositoryKey(parsedOrganizationId, parsedRepositoryId));
    const batch = repository?.active_batch_id ? this.importBatches.get(repository.active_batch_id) : null;
    return batch ? deepFreeze({ batch_id: batch.import_batch_id, source_commit: batch.plan.source_commit }) : null;
  }

  async getOrganization(organizationId) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const value = this.organizations.get(parsedOrganizationId);
    return value ? deepFreeze(clone(value)) : null;
  }

  async getCommandReceipt(organizationId, idempotencyKey) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    const parsedIdempotencyKey = parseRepositoryIdentifier(idempotencyKey, 'idempotency key');
    const value = this.receipts.get(this._receiptKey(parsedOrganizationId, parsedIdempotencyKey));
    return value ? deepFreeze(clone(value)) : null;
  }

  async listAuditEvents(organizationId) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return deepFreeze(clone(this.auditEvents.filter((event) => event.organization_id === parsedOrganizationId)));
  }

  async listOutboxMessages(organizationId) {
    this._assertOpen();
    const parsedOrganizationId = parseRepositoryIdentifier(organizationId, 'organization id');
    return deepFreeze(clone(this.outboxMessages.filter((message) => message.organization_id === parsedOrganizationId)));
  }

  async close() {
    this.closed = true;
  }
}

module.exports = {
  MemoryGovernanceRepository,
};
