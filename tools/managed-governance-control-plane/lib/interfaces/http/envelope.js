'use strict';

const { deepFreeze } = require('../../../../../packages/managed-governance-contracts');

const ERROR_STATUS = Object.freeze({
  invalid_request: 400,
  unauthorized: 401,
  policy_denied: 403,
  not_found: 404,
  conflict: 409,
  request_too_large: 413,
  rate_limited: 429,
  migration_required: 503,
  database_unavailable: 503,
  import_failed: 422,
  request_timeout: 504,
  internal_error: 500,
});

function successEnvelope(data, options = {}) {
  return deepFreeze({
    schema_version: 1,
    ok: true,
    data: data === undefined ? null : data,
    error: null,
    evidence: options.evidence || [],
    warnings: options.warnings || [],
  });
}

function errorEnvelope(code, message, options = {}) {
  return deepFreeze({
    schema_version: 1,
    ok: false,
    data: null,
    error: { code, message },
    evidence: options.evidence || [],
    warnings: options.warnings || [],
  });
}

function statusForError(code) {
  return ERROR_STATUS[code] || 500;
}

function sendJson(response, status, envelope) {
  const body = Buffer.from(JSON.stringify(envelope), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

module.exports = { ERROR_STATUS, errorEnvelope, sendJson, statusForError, successEnvelope };
