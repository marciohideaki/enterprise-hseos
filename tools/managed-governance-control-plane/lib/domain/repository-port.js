'use strict';

const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const {
  IdentifierSchema,
  ImportPlanSchema,
  UuidSchema,
  canonicalize,
  deepFreeze,
  digestCanonical,
  parseContract,
} = require('../../../../packages/managed-governance-contracts');

const REQUIRED_METHODS = Object.freeze([
  'applyImportBatch',
  'ensureOrganization',
  'getOrganization',
  'getCommandReceipt',
  'listAuditEvents',
  'listCatalogEntries',
  'listOutboxMessages',
  'rollbackImportBatch',
  'close',
]);

class GovernanceRepositoryError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_REPOSITORY_INVALID', details = {}) {
    super(message);
    this.name = 'GovernanceRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GovernanceRepositoryError(`${label} must be an object`);
  }
  const allowed = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new GovernanceRepositoryError(`${label} contains unknown fields`, 'MANAGED_GOVERNANCE_REPOSITORY_UNKNOWN_FIELD', {
      fields: unknown.sort(),
    });
  }
}

function identifier(value, label) {
  try {
    return parseContract(IdentifierSchema, value, label);
  } catch (error) {
    throw new GovernanceRepositoryError(`${label} is invalid`, 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', {
      cause: error.code,
    });
  }
}

function parseRepositoryIdentifier(value, label = 'repository identifier') {
  return identifier(value, label);
}

function uuid(value, label) {
  try {
    return parseContract(UuidSchema, value, label);
  } catch (error) {
    throw new GovernanceRepositoryError(`${label} is invalid`, 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', {
      cause: error.code,
    });
  }
}

function parseRepositoryUuid(value, label = 'repository UUID') {
  return uuid(value, label);
}

function actor(value) {
  assertExactKeys(value, ['type', 'id'], 'actor');
  return { type: identifier(value.type, 'actor type'), id: identifier(value.id, 'actor id') };
}

function repositoryClock(options) {
  const now = options.clock ? options.clock() : new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new GovernanceRepositoryError('repository clock returned an invalid date');
  }
  return now.toISOString();
}

function boundedText(value, label, maximumBytes) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new GovernanceRepositoryError(`${label} is invalid`, 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  return value;
}

function boundedTitle(value) {
  let title = typeof value === 'string' && value.trim() ? value.trim() : 'Untitled governance artifact';
  while (Buffer.byteLength(title, 'utf8') > 512) title = title.slice(0, -1);
  return title;
}

function canonicalMatches(left, right) {
  try {
    return canonicalize(left) === canonicalize(right);
  } catch {
    return false;
  }
}

function artifactMaterialization(entry) {
  if (!entry?.classification?.structured_content || typeof entry.classification.structured_content !== 'object') {
    throw new GovernanceRepositoryError('discovery structured content is invalid', 'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH');
  }
  const slugBase = entry.source_path
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 130);
  const suffix = createHash('sha256').update(entry.source_path, 'utf8').digest('hex').slice(0, 12);
  let structuredContent = entry.classification.structured_content;
  let structuredBytes;
  try {
    structuredBytes = Buffer.byteLength(canonicalize(structuredContent), 'utf8');
  } catch (error) {
    throw new GovernanceRepositoryError(
      'discovery structured content is not canonical JSON',
      'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH',
      { cause: error.code || null },
    );
  }
  if (structuredBytes > 2 * 1024 * 1024) {
    throw new GovernanceRepositoryError(
      'discovery structured content exceeds the source limit',
      'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH',
    );
  }
  if (structuredBytes > 1024 * 1024) {
    structuredContent = { format: structuredContent.format || 'unknown', parse_status: 'structured_content_omitted' };
  }
  return deepFreeze({
    slug: `${slugBase || 'artifact'}-${suffix}`,
    title: boundedTitle(structuredContent.title || path.posix.basename(entry.source_path)),
    structured_content: structuredContent,
  });
}

function prepareEnsureOrganizationCommand(command, options = {}) {
  assertExactKeys(command, ['organization_id', 'idempotency_key', 'actor', 'organization'], 'organization command');
  assertExactKeys(command.actor, ['type', 'id'], 'actor');
  assertExactKeys(command.organization, ['slug', 'display_name'], 'organization');
  const prepared = {
    organization_id: identifier(command.organization_id, 'organization id'),
    idempotency_key: identifier(command.idempotency_key, 'idempotency key'),
    actor: actor(command.actor),
    organization: {
      slug: identifier(command.organization.slug, 'organization slug'),
      display_name: boundedText(command.organization.display_name, 'organization display name', 512),
    },
  };
  if (prepared.organization.slug !== prepared.organization_id) {
    throw new GovernanceRepositoryError(
      'organization slug must equal organization_id in v1',
      'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID',
    );
  }
  return deepFreeze({
    ...prepared,
    command_digest: digestCanonical(prepared),
    occurred_at: repositoryClock(options),
    audit_event_id: randomUUID(),
    outbox_message_id: randomUUID(),
  });
}

function prepareImportBatchCommand(command, options = {}) {
  assertExactKeys(command, ['discovery', 'plan', 'actor', 'idempotency_key', 'canonical_remote'], 'import batch command');
  let plan;
  try {
    plan = parseContract(ImportPlanSchema, command.plan, 'import plan');
  } catch (error) {
    throw new GovernanceRepositoryError('import plan is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', {
      cause: error.code,
    });
  }
  const unsignedPlan = {
    schema_version: plan.schema_version,
    batch_key: plan.batch_key,
    organization_id: plan.organization_id,
    repository_id: plan.repository_id,
    source_commit: plan.source_commit,
    importer_version: plan.importer_version,
    source_profile: plan.source_profile,
    source_profile_digest: plan.source_profile_digest,
    generated_at: plan.generated_at,
    items: plan.items,
    issues: plan.issues,
  };
  const expectedBatchKey = digestCanonical({
    repository_id: plan.repository_id,
    source_commit: plan.source_commit,
    importer_version: plan.importer_version,
    source_profile_digest: plan.source_profile_digest,
  });
  if (plan.batch_key !== expectedBatchKey || plan.plan_id !== digestCanonical(unsignedPlan)) {
    throw new GovernanceRepositoryError('import plan integrity check failed', 'MANAGED_GOVERNANCE_IMPORT_PLAN_INTEGRITY_FAILED');
  }
  if (Buffer.byteLength(canonicalize(plan), 'utf8') > 8 * 1024 * 1024) {
    throw new GovernanceRepositoryError('import plan exceeds the durable limit', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const discovery = command.discovery;
  if (
    !discovery ||
    typeof discovery !== 'object' ||
    discovery.schema_version !== 1 ||
    discovery.repository_id !== plan.repository_id ||
    discovery.source_commit !== plan.source_commit ||
    discovery.source_timestamp !== plan.generated_at ||
    discovery.source_profile !== plan.source_profile ||
    discovery.source_profile_digest !== plan.source_profile_digest ||
    !Array.isArray(discovery.entries)
  ) {
    throw new GovernanceRepositoryError('discovery does not match the import plan', 'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH');
  }
  const entriesByPath = new Map();
  for (const entry of discovery.entries) {
    const normalizedContent =
      typeof entry?.raw_content === 'string' ? entry.raw_content.replace(/^\uFEFF/, '').replaceAll(/\r\n?/g, '\n') : null;
    const actualDigest =
      normalizedContent === null ? null : `sha256:${createHash('sha256').update(normalizedContent, 'utf8').digest('hex')}`;
    if (
      !entry ||
      typeof entry.source_path !== 'string' ||
      typeof entry.raw_content !== 'string' ||
      typeof entry.normalized_content !== 'string' ||
      typeof entry.content_digest !== 'string' ||
      !entry.classification ||
      entriesByPath.has(entry.source_path) ||
      Buffer.byteLength(entry.raw_content, 'utf8') > 2 * 1024 * 1024 ||
      Buffer.byteLength(entry.normalized_content, 'utf8') > 2 * 1024 * 1024 ||
      entry.normalized_content !== normalizedContent ||
      entry.content_digest !== actualDigest
    ) {
      throw new GovernanceRepositoryError('discovery entry is invalid', 'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH');
    }
    entriesByPath.set(entry.source_path, entry);
  }
  for (const item of plan.items) {
    const entry = entriesByPath.get(item.source_path);
    if (item.action === 'deactivate') {
      if (entry)
        throw new GovernanceRepositoryError(
          'deactivate item cannot have discovered content',
          'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH',
        );
      continue;
    }
    if (
      !entry ||
      entry.content_digest !== item.content_digest ||
      (item.action !== 'rename' && entry.classification.artifact_id !== item.artifact_id) ||
      entry.classification.artifact_type !== item.artifact_type ||
      entry.classification.classification_status !== item.classification_status ||
      !canonicalMatches(entry.classification.issues, item.issues)
    ) {
      throw new GovernanceRepositoryError('import item does not match discovery', 'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH');
    }
    entriesByPath.delete(item.source_path);
  }
  if (entriesByPath.size > 0) {
    throw new GovernanceRepositoryError('discovery contains unplanned sources', 'MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH');
  }
  const prepared = {
    plan,
    entries: discovery.entries,
    actor: actor(command.actor),
    idempotency_key: identifier(command.idempotency_key, 'idempotency key'),
    canonical_remote: boundedText(command.canonical_remote, 'canonical remote', 1024),
  };
  return deepFreeze({
    ...prepared,
    command_digest: digestCanonical({
      plan_id: plan.plan_id,
      actor: prepared.actor,
      idempotency_key: prepared.idempotency_key,
      canonical_remote: prepared.canonical_remote,
    }),
    batch_id: randomUUID(),
    occurred_at: repositoryClock(options),
    audit_event_id: randomUUID(),
    outbox_message_id: randomUUID(),
  });
}

function prepareRollbackImportCommand(command, options = {}) {
  assertExactKeys(command, ['organization_id', 'repository_id', 'batch_id', 'actor', 'idempotency_key'], 'rollback command');
  const prepared = {
    organization_id: identifier(command.organization_id, 'organization id'),
    repository_id: uuid(command.repository_id, 'repository id'),
    batch_id: uuid(command.batch_id, 'batch id'),
    actor: actor(command.actor),
    idempotency_key: identifier(command.idempotency_key, 'idempotency key'),
  };
  return deepFreeze({
    ...prepared,
    command_digest: digestCanonical(prepared),
    occurred_at: repositoryClock(options),
    audit_event_id: randomUUID(),
    outbox_message_id: randomUUID(),
  });
}

function buildOrganizationMutation(prepared, existingOrganization = null) {
  const organization = existingOrganization || {
    organization_pk: randomUUID(),
    organization_id: prepared.organization_id,
    slug: prepared.organization.slug,
    display_name: prepared.organization.display_name,
    created_at: prepared.occurred_at,
  };
  const result = {
    schema_version: 1,
    operation: 'organization.ensure',
    organization,
  };
  const auditEvent = {
    audit_event_id: prepared.audit_event_id,
    organization_id: prepared.organization_id,
    event_type: 'organization.ensured',
    aggregate_type: 'organization',
    aggregate_id: prepared.organization_id,
    actor: prepared.actor,
    payload: { slug: organization.slug, display_name: organization.display_name },
    occurred_at: prepared.occurred_at,
  };
  const outboxMessage = {
    outbox_message_id: prepared.outbox_message_id,
    organization_id: prepared.organization_id,
    topic: 'governance.organization.ensured',
    aggregate_type: 'organization',
    aggregate_id: prepared.organization_id,
    payload: { audit_event_id: auditEvent.audit_event_id, organization },
    created_at: prepared.occurred_at,
    delivered_at: null,
  };
  canonicalize(result);
  canonicalize(auditEvent);
  canonicalize(outboxMessage);
  return deepFreeze({ organization, result, auditEvent, outboxMessage });
}

function assertGovernanceRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new GovernanceRepositoryError('governance repository is required');
  }
  const missing = REQUIRED_METHODS.filter((method) => typeof repository[method] !== 'function');
  if (missing.length > 0) {
    throw new GovernanceRepositoryError(
      'governance repository does not implement the v1 port',
      'MANAGED_GOVERNANCE_REPOSITORY_PORT_INVALID',
      {
        missing,
      },
    );
  }
  return repository;
}

module.exports = {
  GovernanceRepositoryError,
  REQUIRED_METHODS,
  assertGovernanceRepository,
  artifactMaterialization,
  buildOrganizationMutation,
  parseRepositoryIdentifier,
  parseRepositoryUuid,
  prepareEnsureOrganizationCommand,
  prepareImportBatchCommand,
  prepareRollbackImportCommand,
};
