'use strict';

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SENSITIVE_KEYS = new Set([
  'access_token',
  'api_key',
  'approval_token',
  'authorization',
  'client_secret',
  'cookie',
  'credential',
  'credentials',
  'password',
  ['private', 'key'].join('_'),
  'refresh_token',
  'secret',
  'session_cookie',
  'token',
]);
const SENSITIVE_SUFFIX = /(?:^|_)(?:credential|credentials|password|secret|token)$/;

class ApprovalError extends Error {
  constructor(message, code = 'EXECUTION_APPROVAL_INVALID', details = {}) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.details = details;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function normalizeKey(key) {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[^a-zA-Z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .toLowerCase();
}

function assertStrictJson(value, path, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ApprovalError(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== 'object') throw new ApprovalError(`${path} contains a non-JSON value`);
  if (ancestors.has(value)) throw new ApprovalError(`${path} contains a cyclic reference`);
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new ApprovalError(`${path} must contain only plain objects`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new ApprovalError(`${path} contains a sparse array`);
      assertStrictJson(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeKey(key);
      if (SENSITIVE_KEYS.has(normalized) || SENSITIVE_SUFFIX.test(normalized)) {
        throw new ApprovalError(`Sensitive field is forbidden in ${path}: ${key}`, 'EXECUTION_APPROVAL_SENSITIVE_DATA');
      }
      assertStrictJson(nested, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function stableJson(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApprovalError(`${field} must be an object`);
  assertStrictJson(value, field);
  let encoded;
  try {
    encoded = JSON.stringify(stableValue(value));
  } catch (error) {
    throw new ApprovalError(`${field} must be strict JSON`, 'EXECUTION_APPROVAL_INVALID', { field, cause: error.message });
  }
  if (encoded === undefined) throw new ApprovalError(`${field} must be strict JSON`);
  return encoded;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new ApprovalError(`${field} must be a non-empty string`);
}

function requireTimestamp(value, field) {
  requireText(value, field);
  const parsed = new Date(value);
  if (!UTC_TIMESTAMP_PATTERN.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ApprovalError(`${field} must be a canonical UTC timestamp`);
  }
}

function hydrate(row) {
  if (!row) return null;
  return {
    approval_id: row.approval_id,
    operation_id: row.operation_id,
    authorizer: JSON.parse(row.authorizer_json),
    resource_scope: JSON.parse(row.resource_scope_json),
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    decision: row.decision,
    policy_version: row.policy_version,
    evidence_ref: row.evidence_ref,
  };
}

class ExecutionApprovalStore {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this.db = db;
    this._insert = db.prepare(
      `INSERT INTO execution_approvals (
         approval_id, operation_id, authorizer_json, resource_scope_json,
         issued_at, expires_at, decision, policy_version, evidence_ref
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this._get = db.prepare(`SELECT * FROM execution_approvals WHERE approval_id = ?`);
    this._getUse = db.prepare(`SELECT * FROM execution_approval_uses WHERE approval_id = ? OR operation_id = ?`);
    this._consume = db.prepare(
      `INSERT INTO execution_approval_uses (approval_id, operation_id, consumed_at) VALUES (?, ?, ?)`,
    );
    this._consumeTransaction = db.transaction((request, onConsumed) => {
      const row = this._get.get(request.approval_id);
      if (!row) throw new ApprovalError('Approval not found', 'EXECUTION_APPROVAL_NOT_FOUND');
      if (this._getUse.get(request.approval_id, request.operation_id)) {
        throw new ApprovalError('Approval or operation authorization was already consumed', 'EXECUTION_APPROVAL_REUSED');
      }
      if (row.decision !== 'approved') throw new ApprovalError('Approval decision is not approved', 'EXECUTION_APPROVAL_DENIED');
      if (row.operation_id !== request.operation_id) throw new ApprovalError('Approval operation scope mismatch', 'EXECUTION_APPROVAL_SCOPE_MISMATCH');
      if (row.policy_version !== request.policy_version) throw new ApprovalError('Approval policy version mismatch', 'EXECUTION_APPROVAL_POLICY_MISMATCH');
      if (row.resource_scope_json !== request.resource_scope_json) {
        throw new ApprovalError('Approval resource scope mismatch', 'EXECUTION_APPROVAL_SCOPE_MISMATCH');
      }
      if (request.now < row.issued_at) throw new ApprovalError('Approval is not active yet', 'EXECUTION_APPROVAL_NOT_ACTIVE');
      if (request.now >= row.expires_at) throw new ApprovalError('Approval expired', 'EXECUTION_APPROVAL_EXPIRED');
      this._consume.run(request.approval_id, request.operation_id, request.now);
      if (onConsumed) onConsumed();
      return hydrate(row);
    });
  }

  issue(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new ApprovalError('Approval must be an object');
    for (const field of ['approval_id', 'operation_id', 'policy_version', 'evidence_ref']) requireText(record[field], field);
    requireTimestamp(record.issued_at, 'issued_at');
    requireTimestamp(record.expires_at, 'expires_at');
    if (!['approved', 'denied'].includes(record.decision)) throw new ApprovalError('decision must be approved or denied');
    if (record.expires_at <= record.issued_at) throw new ApprovalError('expires_at must be after issued_at');
    const authorizerJson = stableJson(record.authorizer, 'authorizer');
    const resourceScopeJson = stableJson(record.resource_scope, 'resource_scope');
    for (const field of ['id', 'type']) requireText(record.authorizer[field], `authorizer.${field}`);
    if (Object.keys(record.resource_scope).length === 0) throw new ApprovalError('resource_scope must not be empty');
    try {
      this._insert.run(
        record.approval_id,
        record.operation_id,
        authorizerJson,
        resourceScopeJson,
        record.issued_at,
        record.expires_at,
        record.decision,
        record.policy_version,
        record.evidence_ref,
      );
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new ApprovalError('Approval identifier already exists', 'EXECUTION_APPROVAL_DUPLICATE');
      }
      throw error;
    }
    return this.get(record.approval_id);
  }

  get(approvalId) {
    requireText(approvalId, 'approval_id');
    return hydrate(this._get.get(approvalId));
  }

  consume({ approval_id, operation_id, resource_scope, policy_version, now }, onConsumed = null) {
    for (const [field, value] of Object.entries({ approval_id, operation_id, policy_version })) requireText(value, field);
    requireTimestamp(now, 'now');
    if (onConsumed !== null && typeof onConsumed !== 'function') throw new ApprovalError('onConsumed must be a function');
    return this._consumeTransaction.immediate(
      {
        approval_id,
        operation_id,
        policy_version,
        resource_scope_json: stableJson(resource_scope, 'resource_scope'),
        now,
      },
      onConsumed,
    );
  }
}

module.exports = { ApprovalError, ExecutionApprovalStore };
