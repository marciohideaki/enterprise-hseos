'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createManagedGovernanceServer, LOOPBACK_HOSTS } = require('../../../managed-governance-control-plane/server');
const { createDatabaseBackedControlPlane, installManagedGovernance } = require('../../../managed-governance-control-plane/composition');
const { runManagedGovernanceSessionPreflight } = require('../../../../packages/managed-governance-client/session-preflight');
const { commandError, renderEnvelope } = require('./output');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:4319';
const MAX_CONTEXT_BYTES = 1024 * 1024;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,159}$/;

class ManagedGovernanceCliError extends Error {
  constructor(message, code = 'invalid_request') {
    super(message);
    this.name = 'ManagedGovernanceCliError';
    this.code = code;
  }
}

function parseEndpoint(value = DEFAULT_ENDPOINT) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new ManagedGovernanceCliError('endpoint must be a valid loopback HTTP URL');
  }
  if (endpoint.protocol !== 'http:' || !LOOPBACK_HOSTS.has(endpoint.hostname) || endpoint.username || endpoint.password) {
    throw new ManagedGovernanceCliError('endpoint must be an unauthenticated loopback HTTP URL');
  }
  if (endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new ManagedGovernanceCliError('endpoint must not include a path, query, or fragment');
  }
  return endpoint.origin;
}

function parsePort(value = '4319') {
  const text = String(value);
  if (!/^[1-9]\d{0,4}$/.test(text)) throw new ManagedGovernanceCliError('port must be an integer from 1 to 65535');
  const port = Number(text);
  if (port > 65_535) throw new ManagedGovernanceCliError('port must be an integer from 1 to 65535');
  return port;
}

function parseIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new ManagedGovernanceCliError(`${label} is invalid`);
  return value;
}

function regularFile(filePath, label, maximumBytes = null, ownerOnly = false) {
  let metadata;
  try {
    metadata = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new ManagedGovernanceCliError(`${label} does not exist`);
    throw new ManagedGovernanceCliError(`${label} could not be inspected`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (maximumBytes !== null && metadata.size > maximumBytes)) {
    throw new ManagedGovernanceCliError(
      maximumBytes === null ? `${label} must be a regular file` : `${label} must be a regular file no larger than 1 MiB`,
    );
  }
  if (ownerOnly && typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new ManagedGovernanceCliError(`${label} must be owned by the current user`);
  }
  if (ownerOnly && (metadata.mode & 0o077) !== 0) {
    throw new ManagedGovernanceCliError(`${label} permissions must be owner-only`);
  }
  return metadata;
}

function readContext(contextPath) {
  if (!contextPath) throw new ManagedGovernanceCliError('--context is required');
  const absolute = path.resolve(contextPath);
  regularFile(absolute, 'context', MAX_CONTEXT_BYTES);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    throw new ManagedGovernanceCliError('context must contain valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManagedGovernanceCliError('context must contain a JSON object');
  }
  return value;
}

async function defaultRequest({ endpoint, method, pathname, body, token, actor }) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (actor) {
    headers['x-hseos-actor-id'] = actor;
    headers['x-hseos-actor-type'] = 'automation';
  }
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
  const response = await fetch(`${endpoint}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new ManagedGovernanceCliError('control-plane returned an invalid response', 'internal_error');
  }
  const expectedKeys = ['data', 'error', 'evidence', 'ok', 'schema_version', 'warnings'];
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(expectedKeys) ||
    envelope.schema_version !== 1 ||
    typeof envelope.ok !== 'boolean' ||
    !Array.isArray(envelope.evidence) ||
    !Array.isArray(envelope.warnings) ||
    (envelope.ok ? envelope.error !== null : !envelope.error || typeof envelope.error.code !== 'string') ||
    response.ok !== envelope.ok
  ) {
    throw new ManagedGovernanceCliError('control-plane returned an unsupported envelope', 'internal_error');
  }
  return envelope;
}

async function defaultStartServer({ host, port, configPath, projectRoot, environment }) {
  if (configPath) {
    const composition = await createDatabaseBackedControlPlane({
      projectRoot,
      configPath,
      environment,
    });
    const address = await composition.server.listen({
      host: composition.configuration.control_plane.host,
      port: composition.configuration.control_plane.port,
    });
    const stop = async () => composition.server.close();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return { address, server: composition.server };
  }
  const server = createManagedGovernanceServer({
    services: {
      health: async () => ({
        live: true,
        ready: false,
        migration: { state: 'configuration_required' },
        projection: { state: 'unavailable' },
      }),
    },
  });
  const address = await server.listen({ host, port });
  const stop = async () => server.close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return { address, server };
}

function mutationCredentials(options, environment) {
  if (!options.databaseConfig) throw new ManagedGovernanceCliError('--database-config is required with --apply');
  const configPath = path.resolve(options.databaseConfig);
  regularFile(configPath, '--database-config', null, true);
  const actor = parseIdentifier(options.actor, 'actor');
  const tokenName = options.tokenEnv || 'HSEOS_GOVERNANCE_TOKEN';
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(tokenName)) throw new ManagedGovernanceCliError('--token-env is invalid');
  const token = environment[tokenName];
  if (typeof token !== 'string' || token.length < 16 || token.length > 4096 || !/^[A-Za-z0-9._~+/-]+={0,2}$/.test(token)) {
    throw new ManagedGovernanceCliError(`authentication token is required in ${tokenName}`, 'unauthorized');
  }
  return { actor, token, database_config_ref: configPath };
}

function createManagedGovernanceAction(dependencies = {}) {
  const request = dependencies.request || defaultRequest;
  const startServer = dependencies.startServer || defaultStartServer;
  const sessionPreflight = dependencies.sessionPreflight || runManagedGovernanceSessionPreflight;
  const environment = dependencies.environment || process.env;

  return async function managedGovernanceAction(area, action, options = {}) {
    try {
      const endpoint = parseEndpoint(options.endpoint);
      let envelope;
      if (area === 'catalog' && action === 'import') {
        if (Boolean(options.plan) === Boolean(options.apply)) {
          throw new ManagedGovernanceCliError('catalog import requires exactly one of --plan or --apply');
        }
        const source = path.resolve(options.source || '.enterprise');
        if (options.plan) {
          envelope = await request({ endpoint, method: 'POST', pathname: '/api/v1/imports/plan', body: { source } });
        } else {
          const credentials = mutationCredentials(options, environment);
          envelope = await request({
            endpoint,
            method: 'POST',
            pathname: '/api/v1/imports',
            body: { source, database_config_ref: credentials.database_config_ref },
            token: credentials.token,
            actor: credentials.actor,
          });
        }
      } else if (area === 'catalog' && action === 'status') {
        envelope = await request({ endpoint, method: 'GET', pathname: '/health' });
      } else if (area === 'artifact' && action === 'list') {
        const type = options.type ? parseIdentifier(options.type, 'artifact type') : null;
        envelope = await request({
          endpoint,
          method: 'GET',
          pathname: `/api/v1/artifacts${type ? `?type=${encodeURIComponent(type)}` : ''}`,
        });
      } else if (area === 'policy' && action === 'evaluate') {
        envelope = await request({ endpoint, method: 'POST', pathname: '/api/v1/policy/evaluate', body: readContext(options.context) });
      } else if (area === 'session' && action === 'preflight') {
        const result = await sessionPreflight({ projectRoot: process.cwd(), persist: true });
        const warning = result.status === 'equivalent' || result.status === 'not_configured' ? [] : [result.reason_code];
        envelope = {
          schema_version: 1,
          ok: true,
          data: result,
          error: null,
          evidence: result.evidence_path ? [{ type: 'file', path: result.evidence_path }] : [],
          warnings: warning,
        };
      } else if (area === 'setup' && action === 'install') {
        if (!options.databaseConfig) throw new ManagedGovernanceCliError('--database-config is required for setup install');
        const configPath = path.resolve(options.databaseConfig);
        regularFile(configPath, '--database-config', MAX_CONTEXT_BYTES, true);
        const actor = parseIdentifier(options.actor, 'actor');
        const result = await installManagedGovernance({
          projectRoot: process.cwd(),
          configPath,
          environment,
          actorId: actor,
          canonicalRemote: options.canonicalRemote,
        });
        envelope = {
          schema_version: 1,
          ok: true,
          data: result,
          error: null,
          evidence: [],
          warnings: ['managed-shadow only; repository governance remains authoritative'],
        };
      } else if (area === 'server' && action === 'start') {
        const host = options.bind || '127.0.0.1';
        if (!LOOPBACK_HOSTS.has(host)) throw new ManagedGovernanceCliError('server bind must be a loopback address');
        const configPath = options.databaseConfig ? path.resolve(options.databaseConfig) : null;
        if (configPath) regularFile(configPath, '--database-config', MAX_CONTEXT_BYTES, true);
        const result = configPath
          ? await startServer({
              host,
              port: parsePort(options.port),
              configPath,
              projectRoot: process.cwd(),
              environment,
            })
          : await startServer({ host, port: parsePort(options.port) });
        envelope = {
          schema_version: 1,
          ok: true,
          data: { host, port: result.address.port, state: 'listening' },
          error: null,
          evidence: [],
          warnings: configPath ? [] : ['database-backed capabilities require explicit sidecar composition'],
        };
      } else {
        throw new ManagedGovernanceCliError('unsupported governance command');
      }
      return { envelope, output: renderEnvelope(envelope, options), exitCode: envelope.ok ? undefined : 1 };
    } catch (error) {
      const code = error instanceof ManagedGovernanceCliError ? error.code : 'internal_error';
      const message = error instanceof ManagedGovernanceCliError ? error.message : 'managed governance command failed';
      const envelope = commandError(code, message);
      return { envelope, output: renderEnvelope(envelope, options), exitCode: 1 };
    }
  };
}

module.exports = {
  DEFAULT_ENDPOINT,
  MAX_CONTEXT_BYTES,
  ManagedGovernanceCliError,
  createManagedGovernanceAction,
  defaultRequest,
  parseEndpoint,
  parsePort,
  regularFile,
  readContext,
};
