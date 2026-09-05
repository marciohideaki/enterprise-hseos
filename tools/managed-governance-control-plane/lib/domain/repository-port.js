'use strict';

const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const {
  GovernanceReleaseManifestSchema,
  IdentifierSchema,
  ImportPlanSchema,
  PatchPublicationBundleManifestSchema,
  ReadinessReportSchema,
  RecoveryRehearsalEvidenceSchema,
  ShadowReceiptSchema,
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
  'recordReleasePublicationAttempt',
  'getReleasePublicationAttempt',
  'recordPatchPublicationBundle',
  'getPatchPublicationBundle',
  'recordShadowReceipt',
  'getShadowReceipt',
  'recordReadinessEvaluation',
  'getReadinessEvaluation',
  'recordRecoveryRehearsal',
  'getRecoveryRehearsal',
  'recordNetworkAccessAudit',
  'close',
]);

const RELEASE_ATTEMPT_STAGES = Object.freeze(['planned', 'signed', 'published', 'rejected']);
const NETWORK_ROUTE_SCOPES = Object.freeze(['query', 'admin']);
const NETWORK_OUTCOMES = Object.freeze(['allow', 'deny']);
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IPV4_LITERAL_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_LITERAL_PATTERN = /^[0-9A-Fa-f:]+$/;

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
    correlation_id: randomUUID(),
    causation_id: null,
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
    correlation_id: randomUUID(),
    causation_id: null,
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
    correlation_id: randomUUID(),
    causation_id: null,
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
    correlation_id: prepared.correlation_id,
    causation_id: prepared.causation_id,
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

function sha256Digest(value, label) {
  if (typeof value !== 'string' || !SHA256_DIGEST_PATTERN.test(value)) {
    throw new GovernanceRepositoryError(`${label} is invalid`, 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  return value;
}

function optionalSha256Digest(value, label) {
  return value === null || value === undefined ? null : sha256Digest(value, label);
}

function ipLiteral(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || (!IPV4_LITERAL_PATTERN.test(value) && !(value.includes(':') && IPV6_LITERAL_PATTERN.test(value)))) {
    throw new GovernanceRepositoryError(`${label} is invalid`, 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  return value;
}

function optionalBoundedText(value, label, maximumBytes) {
  return value === null || value === undefined ? null : boundedText(value, label, maximumBytes);
}

function buildEvidenceMutation({ kind, prepared, record, eventType, aggregateType, topic }) {
  const auditEvent = {
    audit_event_id: prepared.audit_event_id,
    organization_id: prepared.organization_id,
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: prepared.record_id,
    correlation_id: prepared.correlation_id,
    causation_id: prepared.causation_id,
    actor: prepared.actor,
    payload: { kind, record_id: prepared.record_id },
    occurred_at: prepared.occurred_at,
  };
  const outboxMessage = {
    outbox_message_id: prepared.outbox_message_id,
    organization_id: prepared.organization_id,
    topic,
    aggregate_type: aggregateType,
    aggregate_id: prepared.record_id,
    payload: { audit_event_id: auditEvent.audit_event_id, record_id: prepared.record_id },
    created_at: prepared.occurred_at,
    delivered_at: null,
  };
  canonicalize(auditEvent);
  canonicalize(outboxMessage);
  return deepFreeze({ record, auditEvent, outboxMessage });
}

function prepareRecordReleaseAttemptCommand(command, options = {}) {
  assertExactKeys(
    command,
    ['organization_id', 'actor', 'manifest', 'stage', 'signer_id', 'signature_algorithm', 'signed_digest', 'rejection_reason'],
    'release attempt command',
  );
  const organizationId = identifier(command.organization_id, 'organization id');
  let manifest;
  try {
    manifest = parseContract(GovernanceReleaseManifestSchema, command.manifest, 'release manifest');
  } catch (error) {
    throw new GovernanceRepositoryError('release manifest is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', {
      cause: error.code,
    });
  }
  const stage = command.stage;
  if (!RELEASE_ATTEMPT_STAGES.includes(stage)) {
    throw new GovernanceRepositoryError('release attempt stage is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const signerId = optionalBoundedText(command.signer_id, 'signer id', 160);
  const signatureAlgorithm = command.signature_algorithm ?? null;
  if (signatureAlgorithm !== null && !['ed25519', 'ecdsa-p256-sha256'].includes(signatureAlgorithm)) {
    throw new GovernanceRepositoryError('signature algorithm is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const signedDigest = optionalSha256Digest(command.signed_digest, 'signed digest');
  const rejectionReason = optionalBoundedText(command.rejection_reason, 'rejection reason', 2048);
  const hasSignerEvidence = signerId !== null && signatureAlgorithm !== null && signedDigest !== null;
  if (['signed', 'published'].includes(stage) && !hasSignerEvidence) {
    throw new GovernanceRepositoryError('signed or published attempts require signer evidence', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  if (stage === 'planned' && hasSignerEvidence) {
    throw new GovernanceRepositoryError('a planned attempt cannot carry signer evidence', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  if (stage === 'rejected' && rejectionReason === null) {
    throw new GovernanceRepositoryError('a rejected attempt requires a rejection reason', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  if (stage !== 'rejected' && rejectionReason !== null) {
    throw new GovernanceRepositoryError('only a rejected attempt may carry a rejection reason', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const occurredAt = repositoryClock(options);
  const contentSubject = {
    organization_id: organizationId,
    source_repository_id: manifest.source_repository_id,
    release_id: manifest.release_id,
    sequence: manifest.sequence,
    source_commit: manifest.source_commit,
    approved_tag: manifest.approved_tag,
    manifest_digest: manifest.manifest_digest,
    previous_release_digest: manifest.previous_release_digest,
    stage,
    signer_id: signerId,
    signature_algorithm: signatureAlgorithm,
    signed_digest: signedDigest,
    rejection_reason: rejectionReason,
  };
  const record = {
    release_publication_attempt_id: randomUUID(),
    ...contentSubject,
    attempted_at: occurredAt,
  };
  return deepFreeze({
    organization_id: organizationId,
    actor: actor(command.actor),
    record,
    record_id: record.release_publication_attempt_id,
    natural_key: `${organizationId}::${manifest.manifest_digest}::${stage}`,
    command_digest: digestCanonical(contentSubject),
    occurred_at: occurredAt,
    audit_event_id: randomUUID(),
    correlation_id: randomUUID(),
    causation_id: null,
    outbox_message_id: randomUUID(),
  });
}

function prepareRecordPatchBundleCommand(command, options = {}) {
  assertExactKeys(command, ['organization_id', 'actor', 'bundle'], 'patch bundle command');
  const organizationId = identifier(command.organization_id, 'organization id');
  let bundle;
  try {
    bundle = parseContract(PatchPublicationBundleManifestSchema, command.bundle, 'patch publication bundle');
  } catch (error) {
    throw new GovernanceRepositoryError('patch publication bundle is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', {
      cause: error.code,
    });
  }
  const record = {
    patch_publication_bundle_id: bundle.bundle_id,
    organization_id: organizationId,
    publication_request_ref: bundle.publication_request_ref,
    source_repository_id: bundle.source_repository_id,
    base_commit: bundle.base_commit,
    manifest_digest: bundle.manifest_digest,
    patch_digest: bundle.patch_digest,
    file_operations: bundle.file_operations,
    application_instructions: bundle.application_instructions,
    rollback_instructions: bundle.rollback_instructions,
    generated_by: bundle.generated_by,
    generated_at: bundle.generated_at,
  };
  return deepFreeze({
    organization_id: organizationId,
    actor: actor(command.actor),
    record,
    record_id: record.patch_publication_bundle_id,
    natural_key: `${organizationId}::${bundle.bundle_id}`,
    command_digest: digestCanonical(record),
    occurred_at: repositoryClock(options),
    audit_event_id: randomUUID(),
    correlation_id: randomUUID(),
    causation_id: null,
    outbox_message_id: randomUUID(),
  });
}

function prepareRecordShadowReceiptCommand(command, options = {}) {
  assertExactKeys(command, ['organization_id', 'actor', 'receipt'], 'shadow receipt command');
  const organizationId = identifier(command.organization_id, 'organization id');
  let receipt;
  try {
    receipt = parseContract(ShadowReceiptSchema, command.receipt, 'shadow receipt');
  } catch (error) {
    throw new GovernanceRepositoryError('shadow receipt is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', { cause: error.code });
  }
  if (receipt.organization_id !== organizationId) {
    throw new GovernanceRepositoryError('shadow receipt organization does not match the command', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const record = {
    shadow_receipt_id: receipt.receipt_id,
    organization_id: organizationId,
    repository_id: receipt.repository_id,
    adapter: receipt.adapter,
    session_fingerprint: receipt.session_fingerprint,
    local_digest: receipt.local_digest,
    remote_digest: receipt.remote_digest,
    release_digest: receipt.release_digest,
    status: receipt.status,
    reason_code: receipt.reason_code,
    observed_at: receipt.observed_at,
  };
  return deepFreeze({
    organization_id: organizationId,
    actor: actor(command.actor),
    record,
    record_id: record.shadow_receipt_id,
    natural_key: `${organizationId}::${receipt.receipt_id}`,
    command_digest: digestCanonical(record),
    occurred_at: repositoryClock(options),
    audit_event_id: randomUUID(),
    correlation_id: randomUUID(),
    causation_id: null,
    outbox_message_id: randomUUID(),
  });
}

function prepareRecordReadinessEvaluationCommand(command, options = {}) {
  assertExactKeys(command, ['organization_id', 'actor', 'report'], 'readiness evaluation command');
  const organizationId = identifier(command.organization_id, 'organization id');
  let report;
  try {
    report = parseContract(ReadinessReportSchema, command.report, 'readiness report');
  } catch (error) {
    throw new GovernanceRepositoryError('readiness report is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', { cause: error.code });
  }
  if (report.organization_id !== organizationId) {
    throw new GovernanceRepositoryError('readiness report organization does not match the command', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const record = {
    readiness_evaluation_id: report.report_id,
    organization_id: organizationId,
    window_start: report.window_start,
    window_end: report.window_end,
    window_days: report.window_days,
    eligible_sessions: report.eligible_sessions,
    covered_sessions: report.covered_sessions,
    repositories_covered: report.repositories_covered,
    repositories_missing_evidence: report.repositories_missing_evidence,
    adapters_covered: report.adapters_covered,
    adapters_missing_evidence: report.adapters_missing_evidence,
    preflight_latency_p95_ms: report.preflight_latency_p95_ms,
    open_drift_count: report.open_drift_count,
    open_invalid_contract_count: report.open_invalid_contract_count,
    remote_unavailable_samples: report.remote_unavailable_samples,
    signer_evidence_current: report.signer_evidence_current,
    recovery_evidence_current: report.recovery_evidence_current,
    threat_model_evidence_current: report.threat_model_evidence_current,
    rollback_evidence_current: report.rollback_evidence_current,
    ready: report.ready,
    authorizes_enforcement: report.authorizes_enforcement,
    evaluated_at: report.evaluated_at,
  };
  return deepFreeze({
    organization_id: organizationId,
    actor: actor(command.actor),
    record,
    record_id: record.readiness_evaluation_id,
    natural_key: `${organizationId}::${report.report_id}`,
    command_digest: digestCanonical(record),
    occurred_at: repositoryClock(options),
    audit_event_id: randomUUID(),
    correlation_id: randomUUID(),
    causation_id: null,
    outbox_message_id: randomUUID(),
  });
}

function prepareRecordRecoveryRehearsalCommand(command, options = {}) {
  assertExactKeys(command, ['organization_id', 'actor', 'evidence'], 'recovery rehearsal command');
  const organizationId = identifier(command.organization_id, 'organization id');
  let evidence;
  try {
    evidence = parseContract(RecoveryRehearsalEvidenceSchema, command.evidence, 'recovery rehearsal evidence');
  } catch (error) {
    throw new GovernanceRepositoryError('recovery rehearsal evidence is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', {
      cause: error.code,
    });
  }
  const record = {
    recovery_rehearsal_id: evidence.rehearsal_id,
    organization_id: organizationId,
    recovery_profile_digest: evidence.recovery_profile_digest,
    disposable_target_ref: evidence.disposable_target_ref,
    disposable_target_confirmed: evidence.disposable_target_confirmed,
    measured_rpo_seconds: evidence.measured_rpo_seconds,
    measured_rto_seconds: evidence.measured_rto_seconds,
    tenant_isolation_verified: evidence.tenant_isolation_verified,
    active_catalog_verified: evidence.active_catalog_verified,
    release_signatures_verified: evidence.release_signatures_verified,
    audit_history_append_only_verified: evidence.audit_history_append_only_verified,
    within_declared_profile: evidence.within_declared_profile,
    rehearsed_at: evidence.rehearsed_at,
  };
  return deepFreeze({
    organization_id: organizationId,
    actor: actor(command.actor),
    record,
    record_id: record.recovery_rehearsal_id,
    natural_key: `${organizationId}::${evidence.rehearsal_id}`,
    command_digest: digestCanonical(record),
    occurred_at: repositoryClock(options),
    audit_event_id: randomUUID(),
    correlation_id: randomUUID(),
    causation_id: null,
    outbox_message_id: randomUUID(),
  });
}

function prepareRecordNetworkAccessAuditCommand(command, options = {}) {
  assertExactKeys(
    command,
    ['organization_id', 'actor', 'client_identifier', 'raw_client_ip', 'route_scope', 'matched_allowlist_rule', 'outcome', 'deny_reason', 'evidence_digest'],
    'network access audit command',
  );
  const organizationId = identifier(command.organization_id, 'organization id');
  const routeScope = command.route_scope;
  if (!NETWORK_ROUTE_SCOPES.includes(routeScope)) {
    throw new GovernanceRepositoryError('route scope is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const outcome = command.outcome;
  if (!NETWORK_OUTCOMES.includes(outcome)) {
    throw new GovernanceRepositoryError('outcome is invalid', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const denyReason = optionalBoundedText(command.deny_reason, 'deny reason', 256);
  if (outcome === 'deny' && denyReason === null) {
    throw new GovernanceRepositoryError('a denied outcome requires a deny reason', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  if (outcome === 'allow' && denyReason !== null) {
    throw new GovernanceRepositoryError('an allowed outcome must not carry a deny reason', 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID');
  }
  const occurredAt = repositoryClock(options);
  const record = {
    network_access_audit_id: randomUUID(),
    organization_id: organizationId,
    client_identifier: boundedText(command.client_identifier, 'client identifier', 256),
    raw_client_ip: ipLiteral(command.raw_client_ip, 'raw client ip'),
    route_scope: routeScope,
    matched_allowlist_rule: optionalBoundedText(command.matched_allowlist_rule, 'matched allowlist rule', 256),
    outcome,
    deny_reason: denyReason,
    evidence_digest: sha256Digest(command.evidence_digest, 'evidence digest'),
    occurred_at: occurredAt,
  };
  return deepFreeze({
    organization_id: organizationId,
    actor: actor(command.actor),
    record,
    record_id: record.network_access_audit_id,
    natural_key: `${organizationId}::${record.network_access_audit_id}`,
    command_digest: digestCanonical(record),
    occurred_at: occurredAt,
    audit_event_id: randomUUID(),
    correlation_id: randomUUID(),
    causation_id: null,
    outbox_message_id: randomUUID(),
  });
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
  buildEvidenceMutation,
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
};
