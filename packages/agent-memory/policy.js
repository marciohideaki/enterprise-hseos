'use strict';

const { createHash } = require('node:crypto');

const { evaluatePermissionLattice } = require('../agent-policy-lattice');

const CONTRACT = 'agent-memory.v1';
const AUTHORITY = 'data';
const MAX_CONTENT_BYTES = 8192;
const MAX_TTL_SECONDS = 90 * 86_400;
const CLASSIFICATIONS = Object.freeze(['public', 'internal']);
const TRUSTS = Object.freeze(['trusted', 'untrusted']);
const ORIGINS = Object.freeze(['operator', 'agent', 'tool', 'plugin', 'lsp', 'dap', 'browser', 'display', 'mcp']);
// Everything except the operator is untrusted: such an entry can only be stored as untrusted.
const UNTRUSTED_ORIGINS = Object.freeze(ORIGINS.filter((origin) => origin !== 'operator'));
const ACTOR_KINDS = Object.freeze(['host', 'operator', 'agent']);
const MAX_REASON_BYTES = 256;
// Fields a caller may put in an entry. Everything else (rules, approval, actor, created_at, write_policy_ref) is
// host-owned and travels in a separate parameter.
const ENTRY_INPUT_FIELDS = Object.freeze([
  'memory_id',
  'scope',
  'content',
  'authority',
  'origin',
  'trust',
  'classification',
  'source_ref',
  'source_digest',
  'ttl_seconds',
  'supersedes',
]);
const DELETE_OPERATION = 'memory.delete';
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const SHA256 = /^[0-9a-f]{64}$/;
// eslint-disable-next-line no-control-regex -- Reject control characters at the untrusted protocol boundary.
const SAFE_REFERENCE = /^[^\s\u0000-\u001F\u007F]{1,1024}$/u;

class AgentMemoryError extends Error {
  constructor(message, code = 'AGENT_MEMORY_INVALID', details = {}) {
    super(message);
    this.name = 'AgentMemoryError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const sha256Text = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function invalid(message, field) {
  throw new AgentMemoryError(message, 'AGENT_MEMORY_INVALID', { field });
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) invalid(`${field} must be a lowercase identifier`, field);
  return value;
}

function canonicalTimestamp(value, field) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime())) invalid(`${field} must be a valid timestamp`, field);
  return parsed.toISOString();
}

function assertEntryInputFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('memory entry must be an object', 'entry');
  const unknown = Object.keys(input).filter((field) => !ENTRY_INPUT_FIELDS.includes(field));
  if (unknown.length > 0) {
    throw new AgentMemoryError('the entry carries host-owned or unknown fields', 'AGENT_MEMORY_INVALID', { field: unknown[0] });
  }
}

/** The host names who acts; the actor is validated and scanned because it is persisted on every event. */
function normalizeActor(actor, scanCredential) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor) || !ACTOR_KINDS.includes(actor.kind))
    invalid('actor.kind is not allowed', 'actor');
  const id = requireIdentifier(actor.id, 'actor.id');
  if (typeof scanCredential === 'function' && scanCredential(id) === true) {
    throw new AgentMemoryError('actor contains a credential pattern', 'AGENT_MEMORY_CREDENTIAL_DETECTED', { field: 'actor' });
  }
  return Object.freeze({ kind: actor.kind, id });
}

function normalizeReason(reason, scanCredential) {
  if (typeof reason !== 'string' || reason.trim().length === 0 || Buffer.byteLength(reason, 'utf8') > MAX_REASON_BYTES) {
    invalid('reason must be a short non-empty string', 'reason');
  }
  if (typeof scanCredential !== 'function') {
    throw new AgentMemoryError('a credential scanner is required to write memory', 'AGENT_MEMORY_SCANNER_REQUIRED');
  }
  if (scanCredential(reason) === true) {
    throw new AgentMemoryError('reason contains a credential pattern', 'AGENT_MEMORY_CREDENTIAL_DETECTED', { field: 'reason' });
  }
  return reason;
}

/**
 * Validates one memory entry against `agent-memory.v1` and returns its normalized form. Authority is a constant:
 * memory is data and can never carry directive or operator authority.
 */
function normalizeEntry(input, { maxTtlSeconds = MAX_TTL_SECONDS } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('memory entry must be an object', 'entry');
  if (input.authority !== undefined && input.authority !== AUTHORITY) {
    throw new AgentMemoryError('memory can only carry data authority', 'AGENT_MEMORY_AUTHORITY_ESCALATION', {
      authority: String(input.authority),
    });
  }
  const projectId = requireIdentifier(input.scope?.project_id, 'scope.project_id');
  const content = input.content;
  if (typeof content !== 'string' || content.trim().length === 0) invalid('content must be a non-empty string', 'content');
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) invalid('content exceeds the byte limit', 'content');
  if (!ORIGINS.includes(input.origin)) invalid('origin is not allowed for memory', 'origin');
  if (!TRUSTS.includes(input.trust)) invalid('trust must be trusted or untrusted', 'trust');
  if (UNTRUSTED_ORIGINS.includes(input.origin) && input.trust !== 'untrusted') {
    throw new AgentMemoryError('an untrusted origin can only be stored as untrusted', 'AGENT_MEMORY_TRUST_INVALID', {
      origin: input.origin,
    });
  }
  if (!CLASSIFICATIONS.includes(input.classification)) invalid('classification is not allowed', 'classification');
  if (typeof input.source_ref !== 'string' || !SAFE_REFERENCE.test(input.source_ref))
    invalid('source_ref must be a safe reference', 'source_ref');
  const sourceDigest = input.source_digest ?? sha256Text(content);
  if (typeof sourceDigest !== 'string' || !SHA256.test(sourceDigest))
    invalid('source_digest must be a sha-256 hex digest', 'source_digest');
  const ttl = input.ttl_seconds;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > maxTtlSeconds) {
    throw new AgentMemoryError('ttl_seconds is required and bounded by the policy ceiling', 'AGENT_MEMORY_TTL_INVALID', {
      ttl_seconds: ttl,
      max: maxTtlSeconds,
    });
  }
  const entry = {
    memory_id: requireIdentifier(input.memory_id, 'memory_id'),
    scope: { project_id: projectId },
    content,
    authority: AUTHORITY,
    origin: input.origin,
    trust: input.trust,
    classification: input.classification,
    source_ref: input.source_ref,
    source_digest: sourceDigest,
    created_at: canonicalTimestamp(input.created_at, 'created_at'),
    ttl_seconds: ttl,
  };
  if (input.write_policy_ref !== undefined) {
    if (typeof input.write_policy_ref !== 'string' || input.write_policy_ref.length === 0)
      invalid('write_policy_ref must be a string', 'write_policy_ref');
    entry.write_policy_ref = input.write_policy_ref;
  }
  if (input.supersedes !== undefined) entry.supersedes = requireIdentifier(input.supersedes, 'supersedes');
  return entry;
}

/** Credential scan on everything that persists. The scanner is injected so this package imports nothing from tools. */
function assertNoCredential(entry, scanCredential) {
  if (typeof scanCredential !== 'function') {
    throw new AgentMemoryError('a credential scanner is required to write memory', 'AGENT_MEMORY_SCANNER_REQUIRED');
  }
  for (const field of ['content', 'source_ref']) {
    if (scanCredential(entry[field]) === true) {
      throw new AgentMemoryError(`memory ${field} contains a credential pattern`, 'AGENT_MEMORY_CREDENTIAL_DETECTED', { field });
    }
  }
}

/**
 * `memory.write` is a capability decided by the permission lattice. Without an admitting rule the write is denied;
 * `ask` only passes with an explicit approval. Returns the reference of the rule that admitted the write.
 */
function admitWrite({ rules = [], approved = false, execution_mode = 'default' } = {}) {
  const outcome = evaluatePermissionLattice({ rules, execution_mode });
  const admitted = outcome.decision === 'allow' || (outcome.decision === 'ask' && approved === true);
  if (!admitted || outcome.deciding_rule_id === null) {
    throw new AgentMemoryError('no admitting policy for memory.write', 'AGENT_MEMORY_WRITE_DENIED', { decision: outcome.decision });
  }
  return `rule:${outcome.deciding_rule_id}`;
}

/** The operation a deletion approval is bound to: the contract name plus the exact project and memory. */
function memoryDeleteOperation(projectId, memoryId) {
  requireIdentifier(projectId, 'project_id');
  requireIdentifier(memoryId, 'memory_id');
  return Object.freeze({
    operation: DELETE_OPERATION,
    operation_id: `${DELETE_OPERATION}:${projectId}:${memoryId}`,
    resource_scope: Object.freeze({ project_id: projectId, memory_id: memoryId }),
  });
}

/**
 * Host-side verifier for `forget`: consumes, once, the approval the host resolved for this exact operation from an
 * `ExecutionApprovalStore`. `resolveApprovalId` is host code; the model never supplies the approval id.
 */
function createExecutionApprovalVerifier({ approvalStore, resolveApprovalId, policyVersion = 'hseos-operational-v1', now = Date.now }) {
  if (typeof approvalStore?.consume !== 'function' || typeof resolveApprovalId !== 'function') {
    throw new AgentMemoryError('the verifier needs an approval store and a host resolver', 'AGENT_MEMORY_APPROVAL_REQUIRED');
  }
  if (typeof policyVersion !== 'string' || policyVersion.length === 0) {
    throw new AgentMemoryError('the verifier needs a policy version', 'AGENT_MEMORY_APPROVAL_REQUIRED');
  }
  return ({ operation_id: operationId, resource_scope: resourceScope, actor, onConsumed = null }) => {
    const approvalId = resolveApprovalId({ operation_id: operationId, resource_scope: resourceScope, actor });
    if (typeof approvalId !== 'string' || approvalId.length === 0) {
      throw new AgentMemoryError('no approval was issued for this operation', 'AGENT_MEMORY_APPROVAL_REQUIRED');
    }
    // `onConsumed` runs inside the store's consuming transaction: if it throws, the approval stays unspent.
    approvalStore.consume(
      {
        approval_id: approvalId,
        operation_id: operationId,
        resource_scope: resourceScope,
        policy_version: policyVersion,
        now: new Date(now()).toISOString(),
      },
      typeof onConsumed === 'function' ? () => onConsumed({ approval_id: approvalId }) : null,
    );
    return true;
  };
}

module.exports = {
  AUTHORITY,
  createExecutionApprovalVerifier,
  memoryDeleteOperation,
  AgentMemoryError,
  CLASSIFICATIONS,
  CONTRACT,
  MAX_CONTENT_BYTES,
  MAX_TTL_SECONDS,
  ORIGINS,
  UNTRUSTED_ORIGINS,
  ACTOR_KINDS,
  MAX_REASON_BYTES,
  admitWrite,
  assertEntryInputFields,
  normalizeActor,
  normalizeReason,
  requireIdentifier,
  assertNoCredential,
  normalizeEntry,
  sha256Text,
};
