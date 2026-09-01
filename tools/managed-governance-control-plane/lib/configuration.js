'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GovernanceRepositoryError } = require('./domain/repository-port');

const DEFAULT_CONFIG_PATH = path.join('.hseos', 'config', 'managed-governance-sidecar.json');
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const MAX_CONFIG_BYTES = 64 * 1024;

function configurationError(message) {
  return new GovernanceRepositoryError(message, 'MANAGED_GOVERNANCE_CONFIGURATION_INVALID');
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw configurationError(`${label} must be an object`);
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw configurationError(`${label} contains unknown fields`);
  return value;
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw configurationError(`${label} is outside its supported range`);
  }
  return value;
}

function environmentReference(value, label) {
  if (typeof value !== 'string' || !ENVIRONMENT_NAME.test(value)) throw configurationError(`${label} is invalid`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw configurationError(`${label} is invalid`);
  return value;
}

function readSecureJson(configPath) {
  const absolute = path.resolve(configPath);
  let metadata;
  try {
    metadata = fs.lstatSync(absolute);
  } catch {
    throw configurationError('managed governance sidecar configuration does not exist');
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > MAX_CONFIG_BYTES) {
    throw configurationError('managed governance sidecar configuration is unsafe');
  }
  if (fs.realpathSync(absolute) !== absolute) throw configurationError('managed governance sidecar configuration cannot traverse links');
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw configurationError('managed governance sidecar configuration changed during inspection');
    }
    try {
      return { absolute, value: JSON.parse(fs.readFileSync(descriptor, 'utf8')) };
    } catch (error) {
      if (error?.code === 'MANAGED_GOVERNANCE_CONFIGURATION_INVALID') throw error;
      throw configurationError('managed governance sidecar configuration is not valid JSON');
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function requiredEnvironment(environment, name, label, maximumBytes) {
  const value = environment[name];
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw configurationError(`${label} is required in ${name}`);
  }
  return value;
}

function loadSidecarConfiguration(configPath, options = {}) {
  const { absolute, value } = readSecureJson(configPath);
  const environment = options.environment || process.env;
  exactKeys(value, ['schema_version', 'mode', 'database', 'organization', 'control_plane', 'binding'], 'sidecar configuration');
  if (value.schema_version !== 1 || value.mode !== 'managed-shadow') {
    throw configurationError('sidecar configuration supports only schema version 1 in managed-shadow mode');
  }

  const database = exactKeys(
    value.database,
    [
      'connection_string_env',
      'migration_connection_string_env',
      'runtime_connection_string_env',
      'max_connections',
      'connection_timeout_ms',
      'idle_timeout_ms',
      'statement_timeout_ms',
      'ssl',
    ],
    'database configuration',
  );
  if (database.connection_string_env !== undefined) {
    throw configurationError('database connection_string_env is unsupported; use separate migration and runtime references');
  }
  const migrationConnectionEnvironment = environmentReference(
    database.migration_connection_string_env,
    'database migration connection environment reference',
  );
  const runtimeConnectionEnvironment = environmentReference(
    database.runtime_connection_string_env,
    'database runtime connection environment reference',
  );
  const migrationConnectionString = requiredEnvironment(
    environment,
    migrationConnectionEnvironment,
    'database migration connection string',
    8192,
  );
  const runtimeConnectionString = requiredEnvironment(
    environment,
    runtimeConnectionEnvironment,
    'database runtime connection string',
    8192,
  );
  if (database.ssl !== true && database.ssl !== false) throw configurationError('database ssl must be a boolean');

  const organization = exactKeys(value.organization, ['id', 'display_name'], 'organization configuration');
  const organizationId = identifier(organization.id, 'organization id');
  if (
    typeof organization.display_name !== 'string' ||
    Buffer.byteLength(organization.display_name, 'utf8') < 1 ||
    Buffer.byteLength(organization.display_name, 'utf8') > 512
  ) {
    throw configurationError('organization display name is invalid');
  }

  const controlPlane = exactKeys(value.control_plane, ['host', 'port', 'authentication_token_env'], 'control-plane configuration');
  if (!LOOPBACK_HOSTS.has(controlPlane.host)) throw configurationError('control-plane host must be loopback');
  const port = boundedInteger(controlPlane.port, 'control-plane port', 1, 65_535);
  const tokenEnvironment = environmentReference(controlPlane.authentication_token_env, 'authentication token environment reference');
  const token = requiredEnvironment(environment, tokenEnvironment, 'authentication token', 512);
  if (token.length < 16) throw configurationError('authentication token must contain at least 16 characters');

  const binding = exactKeys(
    value.binding,
    ['control_plane_ref', 'issuer', 'trusted_key_ids', 'max_snapshot_age_seconds'],
    'binding configuration',
  );
  if (!Array.isArray(binding.trusted_key_ids) || binding.trusted_key_ids.length === 0 || binding.trusted_key_ids.length > 32) {
    throw configurationError('binding trusted key ids are invalid');
  }
  const trustedKeyIds = binding.trusted_key_ids.map((keyId) => identifier(keyId, 'binding trusted key id'));
  if (new Set(trustedKeyIds).size !== trustedKeyIds.length) throw configurationError('binding trusted key ids contain duplicates');

  const endpointHost = controlPlane.host === '::1' ? '[::1]' : controlPlane.host;
  return Object.freeze({
    config_path: absolute,
    mode: value.mode,
    database: Object.freeze({
      migration_connection_string_env: migrationConnectionEnvironment,
      runtime_connection_string_env: runtimeConnectionEnvironment,
      migration: Object.freeze({
        connectionString: migrationConnectionString,
        max: 1,
        connectionTimeoutMillis: boundedInteger(database.connection_timeout_ms, 'database connection timeout', 100, 60_000),
        idleTimeoutMillis: boundedInteger(database.idle_timeout_ms, 'database idle timeout', 1000, 600_000),
        statementTimeoutMillis: boundedInteger(database.statement_timeout_ms, 'database statement timeout', 100, 300_000),
        ssl: database.ssl,
        applicationName: 'hseos-managed-governance-migrator',
      }),
      runtime: Object.freeze({
        connectionString: runtimeConnectionString,
        max: boundedInteger(database.max_connections, 'database max connections', 1, 100),
        connectionTimeoutMillis: boundedInteger(database.connection_timeout_ms, 'database connection timeout', 100, 60_000),
        idleTimeoutMillis: boundedInteger(database.idle_timeout_ms, 'database idle timeout', 1000, 600_000),
        statementTimeoutMillis: boundedInteger(database.statement_timeout_ms, 'database statement timeout', 100, 300_000),
        ssl: database.ssl,
        applicationName: 'hseos-managed-governance',
      }),
    }),
    organization: Object.freeze({ id: organizationId, display_name: organization.display_name }),
    control_plane: Object.freeze({
      host: controlPlane.host,
      port,
      endpoint: `http://${endpointHost}:${port}`,
      authentication_token_env: tokenEnvironment,
      token,
    }),
    binding: Object.freeze({
      control_plane_ref: identifier(binding.control_plane_ref, 'binding control-plane reference'),
      issuer: identifier(binding.issuer, 'binding issuer'),
      trusted_key_ids: Object.freeze(trustedKeyIds),
      max_snapshot_age_seconds: boundedInteger(binding.max_snapshot_age_seconds, 'binding snapshot age', 60, 604_800),
    }),
  });
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  ENVIRONMENT_NAME,
  LOOPBACK_HOSTS,
  MAX_CONFIG_BYTES,
  loadSidecarConfiguration,
  readSecureJson,
};
