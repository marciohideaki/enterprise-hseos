'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join('.hseos', 'config', 'managed-governance.json');
const LOOPBACK = new Set(['127.0.0.1', '::1']);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class GovernanceQueryError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_QUERY_UNAVAILABLE') {
    super(message);
    this.name = 'GovernanceQueryError';
    this.code = code;
  }
}

function loadProjectConfiguration(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const configPath = path.join(root, CONFIG_PATH);
  let metadata;
  try {
    metadata = fs.lstatSync(configPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new GovernanceQueryError('managed governance is not configured for this project');
    throw new GovernanceQueryError('managed governance configuration could not be inspected');
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 16 * 1024) {
    throw new GovernanceQueryError('managed governance configuration is unsafe');
  }
  let realPath;
  try {
    realPath = fs.realpathSync(configPath);
  } catch {
    throw new GovernanceQueryError('managed governance configuration could not be resolved');
  }
  if (realPath !== configPath) throw new GovernanceQueryError('managed governance configuration cannot traverse links');
  let config;
  let descriptor;
  try {
    descriptor = fs.openSync(configPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new GovernanceQueryError('managed governance configuration changed during inspection');
    }
    config = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } catch {
    throw new GovernanceQueryError('managed governance configuration is invalid');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (
    !config ||
    Object.keys(config).sort().join(',') !== 'endpoint,mode,schema_version' ||
    config.schema_version !== 1 ||
    config.mode !== 'managed-shadow'
  ) {
    throw new GovernanceQueryError('managed governance configuration contract is unsupported');
  }
  let endpoint;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw new GovernanceQueryError('managed governance endpoint is invalid');
  }
  if (
    endpoint.protocol !== 'http:' ||
    !LOOPBACK.has(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new GovernanceQueryError('managed governance endpoint must be loopback HTTP');
  }
  return Object.freeze({ endpoint: endpoint.origin, mode: config.mode });
}

async function requestJson(endpoint, method, pathname, body) {
  let response;
  try {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
    response = await fetch(`${endpoint}${pathname}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new GovernanceQueryError('managed governance endpoint is unavailable');
  }
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new GovernanceQueryError('managed governance response exceeds the query limit');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_RESPONSE_BYTES) throw new GovernanceQueryError('managed governance response exceeds the query limit');
    chunks.push(chunk);
  }
  let envelope;
  try {
    envelope = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    throw new GovernanceQueryError('managed governance response is invalid');
  }
  const keys = ['data', 'error', 'evidence', 'ok', 'schema_version', 'warnings'];
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(keys) ||
    envelope.schema_version !== 1 ||
    !Array.isArray(envelope.evidence) ||
    !Array.isArray(envelope.warnings) ||
    response.ok !== envelope.ok
  ) {
    throw new GovernanceQueryError('managed governance response contract is invalid');
  }
  if (!envelope.ok) {
    throw new GovernanceQueryError(envelope.error?.message || 'managed governance query failed');
  }
  return envelope.data;
}

function createProjectGovernanceQueryAdapter(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const transport = options.transport || requestJson;
  const query = async (method, pathname, body) => {
    const config = loadProjectConfiguration(projectRoot);
    return transport(config.endpoint, method, pathname, body);
  };
  const adapter = {
    getEffectiveGovernanceContext: (input) =>
      query('GET', `/api/v1/context?limit=100&repository_id=${encodeURIComponent(input.repository_id)}`),
    evaluateGovernedAction: (input) => query('POST', '/api/v1/policy/evaluate', input.context),
    explainGovernanceDecision: (input) => query('POST', '/api/v1/policy/evaluate', input.context),
    getGovernanceArtifact: (input) => query('GET', `/api/v1/artifacts/${encodeURIComponent(input.artifact_id)}`),
    getGovernanceRelease: (input) => query('GET', `/api/v1/releases/${encodeURIComponent(input.release_id)}`),
    diffGovernanceReleases: (input) => query('POST', '/api/v1/releases/diff', input),
    verifyGovernanceSnapshot: (input) => query('POST', '/api/v1/snapshots/verify', input),
    getGovernanceSessionStatus: () => query('GET', '/api/v1/session/status'),
    getGovernanceSessionPreflight: () =>
      require('../../../packages/managed-governance-client/session-preflight').runManagedGovernanceSessionPreflight({
        projectRoot,
        persist: false,
        queryAdapter: adapter,
        // Deliberately no receiptRecorder: MCP stays read-only (FR-006/ADR-0023) even though
        // this adapter object also implements submitShadowReceipt for the CLI/hook path below --
        // the two capabilities are opted into separately by different callers, never coupled.
      }),
    getGovernanceReadiness: () => query('GET', '/api/v1/readiness'),
    submitShadowReceipt: (receipt) => query('POST', '/api/v1/shadow-receipts', receipt),
  };
  return Object.freeze(adapter);
}

module.exports = {
  CONFIG_PATH,
  MAX_RESPONSE_BYTES,
  GovernanceQueryError,
  createProjectGovernanceQueryAdapter,
  loadProjectConfiguration,
  requestJson,
};
