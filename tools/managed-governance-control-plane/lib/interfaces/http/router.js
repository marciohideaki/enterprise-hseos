'use strict';

const { canonicalize } = require('../../../../../packages/managed-governance-contracts');
const { errorEnvelope, sendJson, statusForError, successEnvelope } = require('./envelope');
const { HttpAuthenticationError, denyAnonymousAuth } = require('./auth');

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const LIST_LIMIT = 100;

class HttpAdapterError extends Error {
  constructor(message, code = 'invalid_request') {
    super(message);
    this.name = 'HttpAdapterError';
    this.code = code;
  }
}

const ROUTES = Object.freeze([
  { method: 'GET', pattern: /^\/health$/, handler: 'health' },
  { method: 'GET', pattern: /^\/api\/v1\/artifacts$/, handler: 'listArtifacts', list: true },
  { method: 'GET', pattern: /^\/api\/v1\/artifacts\/([^/]+)\/versions$/, handler: 'listArtifactVersions', list: true, id: true },
  { method: 'GET', pattern: /^\/api\/v1\/artifacts\/([^/]+)$/, handler: 'getArtifact', id: true },
  { method: 'GET', pattern: /^\/api\/v1\/rules$/, handler: 'listRules', list: true },
  { method: 'GET', pattern: /^\/api\/v1\/context$/, handler: 'getEffectiveContext', list: true },
  { method: 'GET', pattern: /^\/api\/v1\/releases\/([^/]+)$/, handler: 'getRelease', id: true },
  { method: 'POST', pattern: /^\/api\/v1\/releases\/diff$/, handler: 'diffReleases', body: true },
  { method: 'POST', pattern: /^\/api\/v1\/snapshots\/verify$/, handler: 'verifySnapshot', body: true },
  { method: 'GET', pattern: /^\/api\/v1\/session\/status$/, handler: 'getSessionStatus' },
  { method: 'POST', pattern: /^\/api\/v1\/policy\/evaluate$/, handler: 'evaluatePolicy', body: true },
  { method: 'POST', pattern: /^\/api\/v1\/imports\/plan$/, handler: 'planImport', body: true },
  { method: 'POST', pattern: /^\/api\/v1\/imports$/, handler: 'applyImport', body: true, protected: true },
  { method: 'POST', pattern: /^\/api\/v1\/drafts$/, handler: 'createDraft', body: true, protected: true },
  { method: 'PATCH', pattern: /^\/api\/v1\/drafts\/([^/]+)$/, handler: 'updateDraft', body: true, protected: true, id: true },
  { method: 'POST', pattern: /^\/api\/v1\/drafts\/([^/]+)\/submit$/, handler: 'submitDraft', body: true, protected: true, id: true },
  { method: 'POST', pattern: /^\/api\/v1\/drafts\/([^/]+)\/review$/, handler: 'reviewDraft', body: true, protected: true, id: true },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/drafts\/([^/]+)\/publication-request$/,
    handler: 'requestPublication',
    body: true,
    protected: true,
    id: true,
  },
  { method: 'GET', pattern: /^\/api\/v1\/audit$/, handler: 'listAudit', list: true, protected: true },
]);

function boundedInteger(value, fallback) {
  if (value === null) return fallback;
  if (!/^[1-9]\d{0,2}$/.test(value)) throw new HttpAdapterError('pagination limit is invalid');
  const parsed = Number(value);
  if (parsed > LIST_LIMIT) throw new HttpAdapterError('pagination limit exceeds 100');
  return parsed;
}

function boundedCursor(value) {
  if (value === null) return null;
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpAdapterError('pagination cursor is invalid');
  return value;
}

async function readJsonBody(request, maximumBytes) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpAdapterError('content-type must be application/json');
  }
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new HttpAdapterError('request body exceeds the configured limit', 'request_too_large');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new HttpAdapterError('request body exceeds the configured limit', 'request_too_large');
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be an object');
    return value;
  } catch {
    throw new HttpAdapterError('request body is not a valid JSON object');
  }
}

function mapError(error) {
  if (error instanceof HttpAuthenticationError) return { code: 'unauthorized', message: error.message };
  if (error instanceof HttpAdapterError) return { code: error.code, message: error.message };
  const mappings = new Map([
    ['MANAGED_GOVERNANCE_CONFLICT', 'conflict'],
    ['MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT', 'conflict'],
    ['MANAGED_GOVERNANCE_NOT_FOUND', 'not_found'],
    ['MANAGED_GOVERNANCE_DATABASE_FAILED', 'database_unavailable'],
    ['MANAGED_GOVERNANCE_DATABASE_RETRYABLE', 'database_unavailable'],
    ['MANAGED_GOVERNANCE_MIGRATION_REQUIRED', 'migration_required'],
    ['MANAGED_GOVERNANCE_IMPORT_FAILED', 'import_failed'],
    ['MANAGED_GOVERNANCE_IMPORT_PLAN_INTEGRITY_FAILED', 'import_failed'],
    ['MANAGED_GOVERNANCE_IMPORT_DISCOVERY_MISMATCH', 'import_failed'],
    ['MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID', 'invalid_request'],
    ['MANAGED_GOVERNANCE_POLICY_INVALID', 'invalid_request'],
    ['MANAGED_GOVERNANCE_POLICY_DENIED', 'policy_denied'],
    ['MANAGED_GOVERNANCE_REPOSITORY_CLOSED', 'database_unavailable'],
    ['MANAGED_GOVERNANCE_SNAPSHOT_INVALID', 'invalid_request'],
    ['MANAGED_GOVERNANCE_SNAPSHOT_EXPIRED', 'invalid_request'],
    ['MANAGED_GOVERNANCE_SNAPSHOT_NOT_YET_VALID', 'invalid_request'],
    ['MANAGED_GOVERNANCE_SNAPSHOT_TAMPERED', 'invalid_request'],
    ['MANAGED_GOVERNANCE_SNAPSHOT_UNTRUSTED_SIGNER', 'invalid_request'],
  ]);
  const code = mappings.get(error?.code) || 'internal_error';
  const publicMessages = {
    database_unavailable: 'control-plane database is unavailable',
    migration_required: 'control-plane database migration is required',
    import_failed: 'governance import failed',
    internal_error: 'internal control-plane error',
  };
  return { code, message: publicMessages[code] || error.message };
}

function createHttpRouter(options = {}) {
  const services = options.services || {};
  const auth = options.auth || denyAnonymousAuth;
  const maximumBodyBytes = options.maximumBodyBytes || DEFAULT_BODY_LIMIT;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(maximumBodyBytes) || maximumBodyBytes < 1024 || maximumBodyBytes > 2 * 1024 * 1024) {
    throw new TypeError('maximumBodyBytes is invalid');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new TypeError('timeoutMs is invalid');

  return async function route(request, response) {
    const controller = new AbortController();
    const abortClient = () => {
      if (!controller.signal.aborted) controller.abort(new HttpAdapterError('client disconnected', 'invalid_request'));
    };
    request.once('aborted', abortClient);
    const timer = setTimeout(() => controller.abort(new HttpAdapterError('request deadline exceeded', 'request_timeout')), timeoutMs);
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const routeEntry = ROUTES.find((candidate) => candidate.method === request.method && candidate.pattern.test(url.pathname));
      if (!routeEntry) throw new HttpAdapterError('route was not found', 'not_found');
      const match = routeEntry.pattern.exec(url.pathname);
      let actor = null;
      if (routeEntry.protected) actor = await auth.authenticate(request);
      const body = routeEntry.body ? await readJsonBody(request, maximumBodyBytes) : null;
      const input = body ? { ...body } : {};
      if (routeEntry.id) {
        try {
          input.id = decodeURIComponent(match[1]);
        } catch {
          throw new HttpAdapterError('route identifier is invalid');
        }
        if (!input.id || Buffer.byteLength(input.id, 'utf8') > 1024 || input.id.includes('/')) {
          throw new HttpAdapterError('route identifier is invalid');
        }
      }
      if (routeEntry.list) {
        input.page = { cursor: boundedCursor(url.searchParams.get('cursor')), limit: boundedInteger(url.searchParams.get('limit'), 50) };
        input.filters = Object.fromEntries(
          [...url.searchParams.entries()]
            .filter(([key]) => !['cursor', 'limit'].includes(key))
            .sort(([left], [right]) => left.localeCompare(right)),
        );
      }
      const handler = services[routeEntry.handler];
      if (typeof handler !== 'function') throw new HttpAdapterError('control-plane capability is unavailable', 'database_unavailable');
      const context = Object.freeze({ actor, signal: controller.signal });
      const timeout = new Promise((resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      });
      const result = await Promise.race([Promise.resolve().then(() => handler(input, context)), timeout]);
      if (controller.signal.aborted) throw controller.signal.reason;
      const descriptor =
        result &&
        typeof result === 'object' &&
        !Array.isArray(result) &&
        Object.hasOwn(result, 'data') &&
        Object.keys(result).every((key) => ['data', 'evidence', 'warnings'].includes(key))
          ? result
          : { data: result === undefined ? null : result };
      const output = {
        data: descriptor.data,
        evidence: descriptor.evidence || [],
        warnings: descriptor.warnings || [],
      };
      if (Buffer.byteLength(canonicalize(output), 'utf8') > 2 * 1024 * 1024) {
        throw new HttpAdapterError('control-plane response exceeds the output limit', 'internal_error');
      }
      sendJson(response, 200, successEnvelope(output.data, output));
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const mapped = mapError(error);
      sendJson(response, statusForError(mapped.code), errorEnvelope(mapped.code, mapped.message));
    } finally {
      clearTimeout(timer);
      request.off('aborted', abortClient);
    }
  };
}

module.exports = {
  DEFAULT_BODY_LIMIT,
  DEFAULT_TIMEOUT_MS,
  HttpAdapterError,
  LIST_LIMIT,
  ROUTES,
  createHttpRouter,
  mapError,
  readJsonBody,
};
