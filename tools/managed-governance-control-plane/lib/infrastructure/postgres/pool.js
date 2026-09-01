'use strict';

const { GovernanceRepositoryError } = require('../../domain/repository-port');

function loadPoolClass() {
  try {
    return require('pg').Pool;
  } catch {
    throw new GovernanceRepositoryError(
      'PostgreSQL support requires the sidecar database dependency',
      'MANAGED_GOVERNANCE_POSTGRES_DEPENDENCY_MISSING',
    );
  }
}

function createPostgresPool(options = {}, PoolClass = loadPoolClass()) {
  const allowed = new Set([
    'connectionString',
    'max',
    'connectionTimeoutMillis',
    'idleTimeoutMillis',
    'statementTimeoutMillis',
    'ssl',
    'applicationName',
  ]);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new GovernanceRepositoryError('PostgreSQL pool options must be an object');
  }
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw new GovernanceRepositoryError('PostgreSQL pool options contain unknown fields', 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID');
  }
  if (typeof options.connectionString !== 'string' || options.connectionString.length > 8192) {
    throw new GovernanceRepositoryError('PostgreSQL connectionString is required', 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID');
  }
  let parsed;
  try {
    parsed = new URL(options.connectionString);
  } catch {
    throw new GovernanceRepositoryError('PostgreSQL connectionString is invalid', 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new GovernanceRepositoryError(
      'PostgreSQL connectionString has an unsupported protocol',
      'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID',
    );
  }
  if (
    options.applicationName !== undefined &&
    (typeof options.applicationName !== 'string' ||
      !/^[a-zA-Z0-9._-]+$/.test(options.applicationName) ||
      options.applicationName.length > 63)
  ) {
    throw new GovernanceRepositoryError('PostgreSQL applicationName is invalid', 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID');
  }
  if (
    options.ssl !== undefined &&
    typeof options.ssl !== 'boolean' &&
    (!options.ssl || typeof options.ssl !== 'object' || Array.isArray(options.ssl))
  ) {
    throw new GovernanceRepositoryError('PostgreSQL ssl option is invalid', 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID');
  }
  const positiveInteger = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new GovernanceRepositoryError(
        'PostgreSQL pool numeric option is outside its bound',
        'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID',
      );
    }
    return value;
  };
  return new PoolClass({
    connectionString: options.connectionString,
    max: positiveInteger(options.max, 10, 100),
    connectionTimeoutMillis: positiveInteger(options.connectionTimeoutMillis, 5000, 60_000),
    idleTimeoutMillis: positiveInteger(options.idleTimeoutMillis, 30_000, 600_000),
    statement_timeout: positiveInteger(options.statementTimeoutMillis, 15_000, 300_000),
    application_name: options.applicationName || 'hseos-managed-governance',
    ssl: options.ssl,
  });
}

module.exports = {
  createPostgresPool,
  loadPoolClass,
};
