'use strict';

const { z } = require('zod');
const { canonicalize } = require('./canonical-json');

const CONTRACT_SCHEMA_VERSION = 1;
const MAX_IDENTIFIER_BYTES = 160;
const MAX_REFERENCE_BYTES = 1024;
const MAX_RAW_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_STRUCTURED_CONTENT_BYTES = 1024 * 1024;
const MAX_COLLECTION_ITEMS = 10_000;
const MAX_IMPORT_ITEMS = 20_000;

const ARTIFACT_TYPES = Object.freeze([
  'constitution',
  'standard',
  'policy',
  'rule',
  'restriction',
  'pattern',
  'stack-profile',
  'contract',
  'schema',
  'adr',
  'authority',
  'capability',
  'hook',
  'workflow',
  'skill',
  'exception',
  'unclassified',
]);
const ARTIFACT_LIFECYCLE_STATUSES = Object.freeze(['draft', 'published', 'deprecated', 'superseded', 'archived']);
const CLASSIFICATION_STATUSES = Object.freeze(['classified', 'partial', 'unclassified']);
const RELATION_KINDS = Object.freeze(['contains', 'implements', 'constrains', 'supersedes', 'references', 'applies-to', 'conflicts-with']);
const RULE_KINDS = Object.freeze(['obligation', 'prohibition', 'permission', 'recommendation']);
const RULE_EFFECTS = Object.freeze(['allow', 'deny', 'input_required']);
const ACTOR_TYPES = Object.freeze(['human', 'agent', 'automation', 'service']);
const ENFORCEMENT_POINTS = Object.freeze(['preflight', 'hook', 'cli', 'runtime', 'compiler', 'quality-gate', 'control-plane']);
const GOVERNANCE_MODES = Object.freeze(['portable', 'managed-shadow', 'managed-enforced']);
const CHANGE_CLASSES = Object.freeze(['editorial', 'compatible', 'enforcement', 'emergency']);
const DECISIONS = Object.freeze(['allow', 'deny', 'input_required']);
const IMPORT_ACTIONS = Object.freeze(['create', 'version', 'noop', 'rename', 'deactivate', 'review']);
const IMPORT_STATUSES = Object.freeze(['planned', 'applying', 'completed', 'failed', 'rolled-back']);

class ManagedGovernanceContractError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_CONTRACT_INVALID', details = {}) {
    super(message);
    this.name = 'ManagedGovernanceContractError';
    this.code = code;
    this.details = details;
  }
}

function boundedString(maximumBytes, minimumBytes = 1) {
  return z.string().refine((value) => {
    const bytes = Buffer.byteLength(value, 'utf8');
    return bytes >= minimumBytes && bytes <= maximumBytes;
  }, `string must contain ${minimumBytes}-${maximumBytes} UTF-8 bytes`);
}

function strictObject(shape) {
  return z.object(shape).strict();
}

function uniqueArray(itemSchema, minimum = 0, maximum = 256) {
  return z
    .array(itemSchema)
    .min(minimum)
    .max(maximum)
    .superRefine((items, context) => {
      const seen = new Set();
      for (const [index, item] of items.entries()) {
        let key;
        try {
          key = typeof item === 'string' ? item : canonicalize(item);
        } catch {
          context.addIssue({ code: 'custom', path: [index], message: 'array item is not canonicalizable' });
          continue;
        }
        if (seen.has(key)) {
          context.addIssue({ code: 'custom', path: [index], message: 'duplicate array item' });
        }
        seen.add(key);
      }
    });
}

function canonicalJsonSize(value) {
  try {
    return Buffer.byteLength(canonicalize(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedJsonObject(maximumBytes = MAX_STRUCTURED_CONTENT_BYTES) {
  return z.record(z.string(), z.json()).refine((value) => canonicalJsonSize(value) <= maximumBytes, {
    message: `JSON object exceeds ${maximumBytes} canonical UTF-8 bytes or is not canonicalizable`,
  });
}

function temporalOrder(fields) {
  return (value, context) => {
    for (let index = 0; index < fields.length - 1; index += 1) {
      const earlier = value[fields[index]];
      const later = value[fields[index + 1]];
      if (earlier && later && Date.parse(earlier) > Date.parse(later)) {
        context.addIssue({ code: 'custom', path: [fields[index + 1]], message: `${fields[index + 1]} must not precede ${fields[index]}` });
      }
    }
  };
}

const IdentifierSchema = boundedString(MAX_IDENTIFIER_BYTES).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const SlugSchema = boundedString(MAX_IDENTIFIER_BYTES).regex(/^[a-z0-9][a-z0-9-]*$/);
const ReferenceSchema = boundedString(MAX_REFERENCE_BYTES);
const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const GitObjectIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const SemverSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
const RelativePathSchema = boundedString(MAX_REFERENCE_BYTES).superRefine((value, context) => {
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value) || value.includes('\\')) {
    context.addIssue({ code: 'custom', message: 'path must be project-relative POSIX format' });
  }
  if (value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    context.addIssue({ code: 'custom', message: 'path contains an empty or traversal segment' });
  }
  if (value.includes('\u0000')) context.addIssue({ code: 'custom', message: 'path contains NUL' });
});

const SourceReferenceSchema = strictObject({
  repository_id: UuidSchema,
  path: RelativePathSchema,
  commit: GitObjectIdSchema,
  section: ReferenceSchema.optional(),
});

const SIGNATURE_ALGORITHMS = Object.freeze(['ed25519', 'ecdsa-p256-sha256']);

const SignatureSchema = strictObject({
  algorithm: z.enum(SIGNATURE_ALGORITHMS),
  key_id: IdentifierSchema,
  value: boundedString(1024).regex(/^[A-Za-z0-9_-]+={0,2}$/),
});

const GovernanceArtifactSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  artifact_id: IdentifierSchema,
  organization_id: IdentifierSchema,
  artifact_type: z.enum(ARTIFACT_TYPES),
  namespace: IdentifierSchema,
  slug: SlugSchema,
  title: boundedString(512),
  lifecycle_status: z.enum(ARTIFACT_LIFECYCLE_STATUSES),
  current_version: z.number().int().positive().nullable(),
});

const ArtifactVersionSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  artifact_version_id: UuidSchema,
  artifact_id: IdentifierSchema,
  organization_id: IdentifierSchema,
  version: z.number().int().positive(),
  raw_content: boundedString(MAX_RAW_CONTENT_BYTES, 0),
  structured_content: boundedJsonObject(),
  content_digest: DigestSchema,
  source: SourceReferenceSchema,
  classification_status: z.enum(CLASSIFICATION_STATUSES),
  created_at: TimestampSchema,
});

const GovernanceRelationSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  relation_id: UuidSchema,
  organization_id: IdentifierSchema,
  source_artifact_id: IdentifierSchema,
  target_artifact_id: IdentifierSchema,
  relation_kind: z.enum(RELATION_KINDS),
  source: SourceReferenceSchema,
  created_at: TimestampSchema,
}).superRefine((value, context) => {
  if (value.source_artifact_id === value.target_artifact_id) {
    context.addIssue({ code: 'custom', path: ['target_artifact_id'], message: 'self-relations are not supported' });
  }
});

const RuleSubjectSchema = strictObject({
  actor_types: uniqueArray(z.enum(ACTOR_TYPES), 1, ACTOR_TYPES.length),
  roles: uniqueArray(IdentifierSchema, 0, 64),
});

const RuleResourceSchema = strictObject({
  type: IdentifierSchema,
  identifiers: uniqueArray(ReferenceSchema, 0, 256),
});

const RuleScopeSchema = strictObject({
  organizations: uniqueArray(IdentifierSchema, 0, 64),
  repositories: uniqueArray(ReferenceSchema, 0, 256),
  environments: uniqueArray(IdentifierSchema, 0, 64),
  branches: uniqueArray(ReferenceSchema, 0, 256),
  stacks: uniqueArray(IdentifierSchema, 0, 64),
  capabilities: uniqueArray(IdentifierSchema, 0, 256),
});

const RuleConditionSchema = strictObject({
  field: IdentifierSchema,
  operator: z.enum(['equals', 'not_equals', 'in', 'not_in', 'matches', 'exists']),
  value: z
    .json()
    .refine((value) => canonicalJsonSize(value) <= 64 * 1024, 'condition value exceeds 65536 canonical UTF-8 bytes')
    .optional(),
}).superRefine((value, context) => {
  if (value.operator === 'exists' && value.value !== undefined) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'exists condition does not accept a value' });
  }
  if (value.operator !== 'exists' && value.value === undefined) {
    context.addIssue({ code: 'custom', path: ['value'], message: `${value.operator} condition requires a value` });
  }
  if (value.operator === 'matches' && typeof value.value !== 'string') {
    context.addIssue({ code: 'custom', path: ['value'], message: 'matches condition requires a string pattern' });
  }
  if (['in', 'not_in'].includes(value.operator) && !Array.isArray(value.value)) {
    context.addIssue({ code: 'custom', path: ['value'], message: `${value.operator} condition requires an array` });
  }
});

const RuleObligationSchema = strictObject({
  code: IdentifierSchema,
  parameters: boundedJsonObject(64 * 1024),
});

const RuleSourceSchema = strictObject({
  artifact_id: IdentifierSchema,
  artifact_version: z.number().int().positive(),
  locator: ReferenceSchema,
});

const GovernanceRuleSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  rule_id: IdentifierSchema,
  organization_id: IdentifierSchema,
  kind: z.enum(RULE_KINDS),
  subject: RuleSubjectSchema,
  action: IdentifierSchema,
  resource: RuleResourceSchema,
  scope: RuleScopeSchema,
  conditions: uniqueArray(RuleConditionSchema, 0, 64),
  effect: z.enum(RULE_EFFECTS),
  priority: z.number().int().min(0).max(1000),
  obligations: uniqueArray(RuleObligationSchema, 0, 64),
  enforcement_points: uniqueArray(z.enum(ENFORCEMENT_POINTS), 1, ENFORCEMENT_POINTS.length),
  source: RuleSourceSchema,
});

const ManagedGovernanceBindingSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('managed-governance-binding/v1'),
  binding_id: UuidSchema,
  mode: z.enum(GOVERNANCE_MODES),
  repository_id: UuidSchema,
  organization_id: IdentifierSchema,
  control_plane_ref: IdentifierSchema,
  issuer: IdentifierSchema,
  trusted_key_ids: uniqueArray(IdentifierSchema, 1, 32),
  failure_policy: z.literal('cached-fail-closed'),
  max_snapshot_age_seconds: z.number().int().min(60).max(604_800),
  created_at: TimestampSchema,
});

const ManagedGovernanceSessionPreflightSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  mode: z.literal('managed-shadow'),
  status: z.enum(['equivalent', 'drift_detected', 'remote_unavailable', 'invalid_local_contract', 'not_configured']),
  reason_code: z.enum([
    'managed_shadow.constitution_equivalent',
    'managed_shadow.constitution_drift',
    'managed_shadow.repository_identity_drift',
    'managed_shadow.remote_unavailable',
    'managed_shadow.local_contract_invalid',
    'managed_shadow.not_configured',
  ]),
  blocking: z.literal(false),
  authoritative_source: z.literal('local'),
  repository_id: UuidSchema.nullable(),
  checked_at: TimestampSchema,
  constitution: strictObject({
    source_path: z.literal('.enterprise/.specs/constitution/Enterprise-Constitution.md'),
    local_digest: DigestSchema.nullable(),
    remote_digest: DigestSchema.nullable(),
    matched: z.boolean().nullable(),
  }),
  remote: strictObject({
    status: z.enum(['not_checked', 'available', 'unavailable']),
    source_commit: GitObjectIdSchema.nullable(),
  }),
  evidence_path: z.literal('.hseos/state/managed-governance/session-preflight.json').nullable(),
}).superRefine((value, context) => {
  const allowedReasons = {
    equivalent: ['managed_shadow.constitution_equivalent'],
    drift_detected: ['managed_shadow.constitution_drift', 'managed_shadow.repository_identity_drift'],
    remote_unavailable: ['managed_shadow.remote_unavailable'],
    invalid_local_contract: ['managed_shadow.local_contract_invalid'],
    not_configured: ['managed_shadow.not_configured'],
  };
  if (!allowedReasons[value.status].includes(value.reason_code)) {
    context.addIssue({ code: 'custom', path: ['reason_code'], message: 'reason code does not match preflight status' });
  }
  if (['equivalent', 'drift_detected'].includes(value.status)) {
    if (
      value.repository_id === null ||
      value.constitution.local_digest === null ||
      value.constitution.remote_digest === null ||
      value.constitution.matched === null ||
      value.remote.status !== 'available' ||
      value.remote.source_commit === null
    ) {
      context.addIssue({ code: 'custom', message: 'completed remote comparison requires identity, digests and source commit' });
    }
  }
  if (value.status === 'equivalent' && value.constitution.matched !== true) {
    context.addIssue({ code: 'custom', path: ['constitution', 'matched'], message: 'equivalent status requires a match' });
  }
  if (value.status === 'drift_detected' && value.constitution.matched !== false) {
    context.addIssue({ code: 'custom', path: ['constitution', 'matched'], message: 'drift status requires a mismatch' });
  }
  if (value.status === 'remote_unavailable' && value.remote.status !== 'unavailable') {
    context.addIssue({ code: 'custom', path: ['remote', 'status'], message: 'unavailable status requires degraded remote state' });
  }
  if (['invalid_local_contract', 'not_configured'].includes(value.status) && value.remote.status !== 'not_checked') {
    context.addIssue({ code: 'custom', path: ['remote', 'status'], message: 'local-only status cannot claim a remote query' });
  }
});

const GovernanceReleaseItemSchema = strictObject({
  artifact_id: IdentifierSchema,
  artifact_version_id: UuidSchema,
  artifact_type: z.enum(ARTIFACT_TYPES),
  content_digest: DigestSchema,
});

const GovernanceReleaseSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  release_id: IdentifierSchema,
  sequence: z.number().int().positive(),
  source_repository_id: UuidSchema,
  source_commit: GitObjectIdSchema,
  previous_release_digest: DigestSchema.nullable(),
  content_digest: DigestSchema,
  items: uniqueArray(GovernanceReleaseItemSchema, 1, MAX_COLLECTION_ITEMS),
  issued_at: TimestampSchema,
  effective_at: TimestampSchema,
  expires_at: TimestampSchema,
  sunset_at: TimestampSchema.nullable(),
  change_class: z.enum(CHANGE_CLASSES),
  runtime_min_version: SemverSchema,
  runtime_max_version: SemverSchema.nullable(),
  issuer: IdentifierSchema,
  signature: SignatureSchema,
}).superRefine(temporalOrder(['issued_at', 'effective_at', 'expires_at', 'sunset_at']));

const SnapshotArtifactSchema = strictObject({
  artifact_id: IdentifierSchema,
  artifact_version_id: UuidSchema,
  content_digest: DigestSchema,
});

const GovernanceSnapshotSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  snapshot_id: UuidSchema,
  organization_id: IdentifierSchema,
  repository_id: UuidSchema,
  release_id: IdentifierSchema,
  release_digest: DigestSchema,
  binding_digest: DigestSchema,
  policy_digest: DigestSchema,
  effective_scope: boundedJsonObject(256 * 1024),
  artifacts: uniqueArray(SnapshotArtifactSchema, 1, MAX_COLLECTION_ITEMS),
  rules: uniqueArray(GovernanceRuleSchema, 0, MAX_COLLECTION_ITEMS),
  adapter_digests: z.record(IdentifierSchema, DigestSchema),
  issued_at: TimestampSchema,
  expires_at: TimestampSchema,
  issuer: IdentifierSchema,
  signature: SignatureSchema,
}).superRefine(temporalOrder(['issued_at', 'expires_at']));

const GovernanceAcceptanceSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  acceptance_id: UuidSchema,
  organization_id: IdentifierSchema,
  repository_id: UuidSchema,
  subject_ref: ReferenceSchema,
  release_digest: DigestSchema,
  policy_digest: DigestSchema,
  diff_digest: DigestSchema,
  decision: z.enum(['accepted', 'declined']),
  method: z.enum(['interactive', 'administrative', 'service-assignment']),
  authentication_evidence_ref: ReferenceSchema,
  decided_at: TimestampSchema,
  expires_at: TimestampSchema,
}).superRefine(temporalOrder(['decided_at', 'expires_at']));

const LeaseRestrictionSchema = strictObject({
  code: IdentifierSchema,
  parameters: boundedJsonObject(64 * 1024),
});

const GovernanceSessionLeaseSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  lease_id: UuidSchema,
  organization_id: IdentifierSchema,
  repository_id: UuidSchema,
  subject_ref: ReferenceSchema,
  session_fingerprint: DigestSchema,
  release_digest: DigestSchema,
  policy_digest: DigestSchema,
  binding_digest: DigestSchema,
  issued_at: TimestampSchema,
  expires_at: TimestampSchema,
  enforcement_level: z.enum(['shadow', 'enforced']),
  capability_ceiling: uniqueArray(IdentifierSchema, 0, 512),
  restrictions: uniqueArray(LeaseRestrictionSchema, 0, 256),
  nonce: boundedString(256).regex(/^[A-Za-z0-9_-]+$/),
  issuer: IdentifierSchema,
  signature: SignatureSchema,
}).superRefine(temporalOrder(['issued_at', 'expires_at']));

const DecisionObligationSchema = strictObject({
  code: IdentifierSchema,
  parameters: boundedJsonObject(64 * 1024),
});

const DecisionEvidenceSchema = strictObject({
  code: IdentifierSchema,
  reference: ReferenceSchema,
  digest: DigestSchema.optional(),
});

const GovernanceDecisionSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  decision: z.enum(DECISIONS),
  reason_code: IdentifierSchema,
  policy_version: ReferenceSchema,
  release_digest: DigestSchema.nullable(),
  obligations: uniqueArray(DecisionObligationSchema, 0, 128),
  evidence: uniqueArray(DecisionEvidenceSchema, 0, 256),
  warnings: uniqueArray(IdentifierSchema, 0, 128),
});

const ImportIssueSchema = strictObject({
  code: IdentifierSchema,
  path: RelativePathSchema,
  message: boundedString(2048),
  severity: z.enum(['warning', 'error']),
});

const ImportPlanItemSchema = strictObject({
  source_path: RelativePathSchema,
  artifact_id: IdentifierSchema.nullable(),
  artifact_type: z.enum(ARTIFACT_TYPES),
  classification_status: z.enum(CLASSIFICATION_STATUSES),
  content_digest: DigestSchema,
  action: z.enum(IMPORT_ACTIONS),
  previous_source_path: RelativePathSchema.nullable(),
  issues: uniqueArray(ImportIssueSchema, 0, 64),
});

const ImportPlanSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  plan_id: DigestSchema,
  batch_key: DigestSchema,
  organization_id: IdentifierSchema,
  repository_id: UuidSchema,
  source_commit: GitObjectIdSchema,
  importer_version: SemverSchema,
  source_profile: IdentifierSchema,
  source_profile_digest: DigestSchema,
  generated_at: TimestampSchema,
  items: uniqueArray(ImportPlanItemSchema, 0, MAX_IMPORT_ITEMS),
  issues: uniqueArray(ImportIssueSchema, 0, MAX_IMPORT_ITEMS),
});

const ImportCountsSchema = strictObject({
  discovered: z.number().int().nonnegative(),
  classified: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  unclassified: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  versioned: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  review_required: z.number().int().nonnegative(),
});

const ImportReportSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  batch_id: UuidSchema,
  plan_id: DigestSchema,
  batch_key: DigestSchema,
  organization_id: IdentifierSchema,
  repository_id: UuidSchema,
  status: z.enum(IMPORT_STATUSES),
  started_at: TimestampSchema,
  completed_at: TimestampSchema.nullable(),
  active_batch: z.boolean(),
  counts: ImportCountsSchema,
  items: uniqueArray(ImportPlanItemSchema, 0, MAX_IMPORT_ITEMS),
  issues: uniqueArray(ImportIssueSchema, 0, MAX_IMPORT_ITEMS),
}).superRefine((value, context) => {
  if (value.completed_at && Date.parse(value.started_at) > Date.parse(value.completed_at)) {
    context.addIssue({ code: 'custom', path: ['completed_at'], message: 'completed_at must not precede started_at' });
  }
  const classifiedTotal = value.counts.classified + value.counts.partial + value.counts.unclassified;
  if (classifiedTotal !== value.counts.discovered || value.items.length !== value.counts.discovered) {
    context.addIssue({ code: 'custom', path: ['counts'], message: 'import counts must account for every discovered item' });
  }
});

// --- T02: strict shadow-readiness contracts (release signing, patch publication, ---
// --- shadow receipts, readiness, shared-network admission, recovery rehearsal). ---
// Additive to the schemas above; nothing here renames or narrows an existing export.

const ENV_VAR_REFERENCE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const EnvVarReferenceSchema = boundedString(256).regex(ENV_VAR_REFERENCE_PATTERN);

const IPV4_CIDR_PATTERN =
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/(3[0-2]|[12]?\d)$/;
const IPV6_CIDR_PATTERN = /^[0-9A-Fa-f:]+\/(12[0-8]|1[01]\d|[1-9]?\d)$/;
const ALLOW_ALL_CIDRS = Object.freeze(['0.0.0.0/0', '::/0']);

const CidrSchema = boundedString(64).superRefine((value, context) => {
  const isIpv4 = IPV4_CIDR_PATTERN.test(value);
  const isIpv6 = !isIpv4 && value.includes(':') && IPV6_CIDR_PATTERN.test(value);
  if (!isIpv4 && !isIpv6) {
    context.addIssue({ code: 'custom', message: 'value is not a valid IPv4 or IPv6 CIDR' });
    return;
  }
  if (ALLOW_ALL_CIDRS.includes(value)) {
    context.addIssue({ code: 'custom', message: 'wildcard allow-all CIDR is forbidden' });
  }
});

const HostAddressSchema = boundedString(255).regex(/^[A-Za-z0-9.:-]+$/);

const RECEIPT_STATUSES = Object.freeze(['equivalent', 'drift_detected', 'remote_unavailable', 'invalid_local_contract', 'not_configured']);
const NETWORK_PROFILES = Object.freeze(['loopback', 'shared-network']);
const TRANSPORT_MODES = Object.freeze(['direct-tls', 'terminated-upstream']);

const GovernanceReleaseManifestSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('governance-release-manifest/v1'),
  release_id: IdentifierSchema,
  sequence: z.number().int().positive(),
  source_repository_id: UuidSchema,
  source_commit: GitObjectIdSchema,
  approved_tag: ReferenceSchema,
  previous_release_digest: DigestSchema.nullable(),
  manifest_digest: DigestSchema,
  items: uniqueArray(GovernanceReleaseItemSchema, 1, MAX_COLLECTION_ITEMS),
  issued_at: TimestampSchema,
  effective_at: TimestampSchema,
  expires_at: TimestampSchema,
  sunset_at: TimestampSchema.nullable(),
  change_class: z.enum(CHANGE_CLASSES),
  runtime_min_version: SemverSchema,
  runtime_max_version: SemverSchema.nullable(),
  issuer: IdentifierSchema,
}).superRefine(temporalOrder(['issued_at', 'effective_at', 'expires_at', 'sunset_at']));

const ExternalSignerBindingSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('external-signer-binding/v1'),
  signer_id: IdentifierSchema,
  algorithm: z.enum(SIGNATURE_ALGORITHMS),
  key_id: IdentifierSchema,
  public_key_ref_env: EnvVarReferenceSchema,
});

const ExternalSignatureEvidenceSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('external-signature-evidence/v1'),
  signer_id: IdentifierSchema,
  algorithm: z.enum(SIGNATURE_ALGORITHMS),
  key_id: IdentifierSchema,
  signed_digest: DigestSchema,
  value: boundedString(1024).regex(/^[A-Za-z0-9_-]+={0,2}$/),
  signed_at: TimestampSchema,
});

const PatchFileOperationSchema = strictObject({
  operation: z.enum(['create', 'update', 'delete']),
  path: RelativePathSchema,
  content_digest: DigestSchema.nullable(),
});

const PatchPublicationBundleManifestSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('patch-publication-bundle-manifest/v1'),
  bundle_id: UuidSchema,
  publication_request_ref: ReferenceSchema,
  source_repository_id: UuidSchema,
  base_commit: GitObjectIdSchema,
  manifest_digest: DigestSchema,
  patch_digest: DigestSchema,
  file_operations: uniqueArray(PatchFileOperationSchema, 1, MAX_COLLECTION_ITEMS),
  application_instructions: boundedString(MAX_STRUCTURED_CONTENT_BYTES),
  rollback_instructions: boundedString(MAX_STRUCTURED_CONTENT_BYTES),
  generated_by: IdentifierSchema,
  generated_at: TimestampSchema,
}).superRefine((value, context) => {
  const seenPaths = new Set();
  for (const [index, op] of value.file_operations.entries()) {
    if (seenPaths.has(op.path)) {
      context.addIssue({ code: 'custom', path: ['file_operations', index, 'path'], message: 'duplicate file path in bundle' });
    }
    seenPaths.add(op.path);
    if (op.operation === 'delete' && op.content_digest !== null) {
      context.addIssue({ code: 'custom', path: ['file_operations', index, 'content_digest'], message: 'delete operation must not carry a content digest' });
    }
    if (op.operation !== 'delete' && op.content_digest === null) {
      context.addIssue({ code: 'custom', path: ['file_operations', index, 'content_digest'], message: `${op.operation} operation requires a content digest` });
    }
  }
});

const ShadowReceiptSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('shadow-receipt/v1'),
  receipt_id: UuidSchema,
  organization_id: IdentifierSchema,
  repository_id: UuidSchema,
  adapter: IdentifierSchema,
  session_fingerprint: DigestSchema,
  local_digest: DigestSchema.nullable(),
  remote_digest: DigestSchema.nullable(),
  release_digest: DigestSchema.nullable(),
  status: z.enum(RECEIPT_STATUSES),
  reason_code: IdentifierSchema,
  observed_at: TimestampSchema,
});

const ReadinessReportSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('readiness-report/v1'),
  report_id: UuidSchema,
  organization_id: IdentifierSchema,
  window_start: TimestampSchema,
  window_end: TimestampSchema,
  window_days: z.literal(30),
  eligible_sessions: z.number().int().nonnegative(),
  covered_sessions: z.number().int().nonnegative(),
  repositories_covered: uniqueArray(UuidSchema, 0, MAX_COLLECTION_ITEMS),
  repositories_missing_evidence: uniqueArray(UuidSchema, 0, MAX_COLLECTION_ITEMS),
  adapters_covered: uniqueArray(IdentifierSchema, 0, 64),
  adapters_missing_evidence: uniqueArray(IdentifierSchema, 0, 64),
  preflight_latency_p95_ms: z.number().nonnegative(),
  open_drift_count: z.number().int().nonnegative(),
  open_invalid_contract_count: z.number().int().nonnegative(),
  remote_unavailable_samples: z.number().int().nonnegative(),
  signer_evidence_current: z.boolean(),
  recovery_evidence_current: z.boolean(),
  threat_model_evidence_current: z.boolean(),
  rollback_evidence_current: z.boolean(),
  ready: z.boolean(),
  authorizes_enforcement: z.literal(false),
  evaluated_at: TimestampSchema,
}).superRefine((value, context) => {
  if (value.covered_sessions > value.eligible_sessions) {
    context.addIssue({ code: 'custom', path: ['covered_sessions'], message: 'covered sessions cannot exceed eligible sessions' });
  }
  if (Date.parse(value.window_start) > Date.parse(value.window_end)) {
    context.addIssue({ code: 'custom', path: ['window_end'], message: 'window_end must not precede window_start' });
  }
  if (!value.ready) return;
  const coverageRatio = value.eligible_sessions === 0 ? 1 : value.covered_sessions / value.eligible_sessions;
  const readyRequirements = [
    [coverageRatio >= 0.95, 'ready report requires at least 95% covered sessions'],
    [value.repositories_missing_evidence.length === 0, 'ready report cannot have repositories missing evidence'],
    [value.adapters_missing_evidence.length === 0, 'ready report cannot have adapters missing evidence'],
    [value.preflight_latency_p95_ms <= 500, 'ready report requires preflight p95 at or below 500ms'],
    [value.open_drift_count === 0, 'ready report cannot have open drift'],
    [value.open_invalid_contract_count === 0, 'ready report cannot have open invalid-contract outcomes'],
    [value.signer_evidence_current, 'ready report requires current signer evidence'],
    [value.recovery_evidence_current, 'ready report requires current recovery evidence'],
    [value.threat_model_evidence_current, 'ready report requires current threat-model evidence'],
    [value.rollback_evidence_current, 'ready report requires current rollback evidence'],
  ];
  for (const [satisfied, message] of readyRequirements) {
    if (!satisfied) context.addIssue({ code: 'custom', path: ['ready'], message });
  }
});

const ManagedNetworkTransportSchema = strictObject({
  mode: z.enum(TRANSPORT_MODES),
  certificate_ref_env: EnvVarReferenceSchema,
  private_key_ref_env: EnvVarReferenceSchema,
});

const ManagedNetworkAuthenticationSchema = strictObject({
  query_token_env: EnvVarReferenceSchema,
  admin_token_env: EnvVarReferenceSchema,
});

const ManagedNetworkRateLimitsSchema = strictObject({
  query_requests_per_minute: z.number().int().positive().max(100_000),
  admin_requests_per_minute: z.number().int().positive().max(100_000),
});

const ManagedNetworkProfileSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('managed-network-profile/v1'),
  profile: z.enum(NETWORK_PROFILES),
  listen_host: HostAddressSchema.nullable(),
  port: z.number().int().min(1).max(65_535).nullable(),
  allowed_clients: uniqueArray(CidrSchema, 0, MAX_COLLECTION_ITEMS),
  trusted_proxies: uniqueArray(CidrSchema, 0, MAX_COLLECTION_ITEMS),
  transport: ManagedNetworkTransportSchema.nullable(),
  authentication: ManagedNetworkAuthenticationSchema.nullable(),
  rate_limits: ManagedNetworkRateLimitsSchema.nullable(),
}).superRefine((value, context) => {
  if (value.profile !== 'shared-network') return;
  if (value.listen_host === null || value.port === null) {
    context.addIssue({ code: 'custom', message: 'shared-network profile requires an explicit listen host and port' });
  }
  if (value.allowed_clients.length === 0) {
    context.addIssue({ code: 'custom', path: ['allowed_clients'], message: 'shared-network profile requires a non-empty client allowlist' });
  }
  if (value.transport === null || value.authentication === null || value.rate_limits === null) {
    context.addIssue({ code: 'custom', message: 'shared-network profile requires transport, authentication and rate limits' });
  }
});

const RecoveryProfileSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('recovery-profile/v1'),
  profile_id: IdentifierSchema,
  rpo_seconds: z.number().int().positive(),
  rto_seconds: z.number().int().positive(),
  retention_days: z.number().int().positive(),
  declared_by: IdentifierSchema,
  declared_at: TimestampSchema,
});

const RecoveryRehearsalEvidenceSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  contract: z.literal('recovery-rehearsal-evidence/v1'),
  rehearsal_id: UuidSchema,
  recovery_profile_digest: DigestSchema,
  disposable_target_ref: ReferenceSchema,
  disposable_target_confirmed: z.literal(true),
  measured_rpo_seconds: z.number().nonnegative(),
  measured_rto_seconds: z.number().nonnegative(),
  tenant_isolation_verified: z.boolean(),
  active_catalog_verified: z.boolean(),
  release_signatures_verified: z.boolean(),
  audit_history_append_only_verified: z.boolean(),
  within_declared_profile: z.boolean(),
  rehearsed_at: TimestampSchema,
}).superRefine((value, context) => {
  if (!value.within_declared_profile) return;
  const verified = [
    value.tenant_isolation_verified,
    value.active_catalog_verified,
    value.release_signatures_verified,
    value.audit_history_append_only_verified,
  ];
  if (!verified.every(Boolean)) {
    context.addIssue({ code: 'custom', path: ['within_declared_profile'], message: 'within_declared_profile requires every evidence check to pass' });
  }
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function parseContract(schema, value, label = 'managed governance contract') {
  let parsed;
  try {
    parsed = schema.safeParse(value);
  } catch (error) {
    throw new ManagedGovernanceContractError(`${label} schema evaluation failed`, 'MANAGED_GOVERNANCE_SCHEMA_EVALUATION_FAILED', {
      label,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!parsed.success) {
    throw new ManagedGovernanceContractError(
      `${label} does not match schema v${CONTRACT_SCHEMA_VERSION}`,
      'MANAGED_GOVERNANCE_CONTRACT_INVALID',
      {
        label,
        schema_version: CONTRACT_SCHEMA_VERSION,
        issues: parsed.error.issues,
      },
    );
  }
  return deepFreeze(parsed.data);
}

module.exports = {
  ACTOR_TYPES,
  ARTIFACT_LIFECYCLE_STATUSES,
  ARTIFACT_TYPES,
  ArtifactVersionSchema,
  CHANGE_CLASSES,
  CLASSIFICATION_STATUSES,
  CONTRACT_SCHEMA_VERSION,
  DECISIONS,
  DigestSchema,
  ENFORCEMENT_POINTS,
  ExternalSignatureEvidenceSchema,
  ExternalSignerBindingSchema,
  GOVERNANCE_MODES,
  GovernanceAcceptanceSchema,
  GovernanceArtifactSchema,
  GovernanceDecisionSchema,
  GovernanceRelationSchema,
  GovernanceReleaseManifestSchema,
  GovernanceReleaseSchema,
  GovernanceRuleSchema,
  GovernanceSessionLeaseSchema,
  GovernanceSnapshotSchema,
  IMPORT_ACTIONS,
  IMPORT_STATUSES,
  IdentifierSchema,
  ImportPlanSchema,
  ImportReportSchema,
  ManagedGovernanceBindingSchema,
  ManagedGovernanceSessionPreflightSchema,
  ManagedGovernanceContractError,
  ManagedNetworkProfileSchema,
  MAX_COLLECTION_ITEMS,
  MAX_IDENTIFIER_BYTES,
  MAX_IMPORT_ITEMS,
  MAX_RAW_CONTENT_BYTES,
  MAX_REFERENCE_BYTES,
  MAX_STRUCTURED_CONTENT_BYTES,
  NETWORK_PROFILES,
  PatchPublicationBundleManifestSchema,
  RECEIPT_STATUSES,
  RELATION_KINDS,
  RULE_EFFECTS,
  RULE_KINDS,
  ReadinessReportSchema,
  RecoveryProfileSchema,
  RecoveryRehearsalEvidenceSchema,
  ReferenceSchema,
  RelativePathSchema,
  SIGNATURE_ALGORITHMS,
  SemverSchema,
  ShadowReceiptSchema,
  SignatureSchema,
  SourceReferenceSchema,
  TRANSPORT_MODES,
  TimestampSchema,
  UuidSchema,
  deepFreeze,
  parseContract,
};
