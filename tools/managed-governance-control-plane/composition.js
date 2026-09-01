'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseContract, ManagedGovernanceBindingSchema } = require('../../packages/managed-governance-contracts');
const { ImportCatalogService } = require('./lib/application/import-catalog');
const { evaluatePolicy } = require('./lib/application/evaluate-policy');
const { loadSidecarConfiguration } = require('./lib/configuration');
const { GitGovernanceSource } = require('./lib/infrastructure/git/governance-source');
const { PostgresGovernanceRepository } = require('./lib/infrastructure/postgres/governance-repository');
const { migrate, readMigrations } = require('./lib/infrastructure/postgres/migrator');
const { createPostgresPool } = require('./lib/infrastructure/postgres/pool');
const { createBearerAuth } = require('./lib/interfaces/http/auth');
const { createManagedGovernanceServer } = require('./server');

const BINDING_PATH = path.join('.hseos', 'config', 'managed-governance-binding.json');
const QUERY_CONFIG_PATH = path.join('.hseos', 'config', 'managed-governance.json');

function assertProjectRoot(projectRoot) {
  const root = path.resolve(projectRoot);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw new Error('managed governance project root must be a canonical real directory');
  }
  return root;
}

function atomicWriteProjectJson(projectRoot, relativePath, value) {
  const target = path.join(projectRoot, relativePath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || fs.realpathSync(directory) !== directory) {
    throw new Error('managed governance configuration directory is unsafe');
  }
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 1) {
      throw new Error('managed governance configuration target is unsafe');
    }
  }
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
  return target;
}

function existingBinding(projectRoot) {
  const target = path.join(projectRoot, BINDING_PATH);
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 64 * 1024) {
    throw new Error('managed governance binding is unsafe');
  }
  return parseContract(ManagedGovernanceBindingSchema, JSON.parse(fs.readFileSync(target, 'utf8')), 'managed governance binding');
}

function buildBinding(configuration, repositoryId, previous = null, clock = () => new Date()) {
  const candidate = {
    schema_version: 1,
    contract: 'managed-governance-binding/v1',
    binding_id: previous?.binding_id || crypto.randomUUID(),
    mode: 'managed-shadow',
    repository_id: repositoryId,
    organization_id: configuration.organization.id,
    control_plane_ref: configuration.binding.control_plane_ref,
    issuer: configuration.binding.issuer,
    trusted_key_ids: [...configuration.binding.trusted_key_ids],
    failure_policy: 'cached-fail-closed',
    max_snapshot_age_seconds: configuration.binding.max_snapshot_age_seconds,
    created_at: previous?.created_at || clock().toISOString(),
  };
  const parsed = parseContract(ManagedGovernanceBindingSchema, candidate, 'managed governance binding');
  if (previous && JSON.stringify(previous) !== JSON.stringify(parsed)) {
    throw new Error('existing managed governance binding conflicts with sidecar configuration');
  }
  return parsed;
}

async function grantRuntimeRole(migrationPool, runtimeConnectionString) {
  let username;
  try {
    username = decodeURIComponent(new URL(runtimeConnectionString).username);
  } catch {
    throw new Error('runtime database connection does not contain a valid user');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(username)) {
    throw new Error('runtime database user is not a supported PostgreSQL role identifier');
  }
  const quoted = `"${username.replaceAll('"', '""')}"`;
  await migrationPool.query(`GRANT hseos_governance_application TO ${quoted}`);
}

async function installManagedGovernance(options = {}) {
  const projectRoot = assertProjectRoot(options.projectRoot || process.cwd());
  const configuration = loadSidecarConfiguration(options.configPath, { environment: options.environment });
  const migrationPool = options.migrationPool || createPostgresPool(configuration.database.migration);
  const runtimePool = options.runtimePool || createPostgresPool(configuration.database.runtime);
  const repository = options.repository || new PostgresGovernanceRepository({ pool: runtimePool });
  const source = options.source || new GitGovernanceSource({ repositoryRoot: projectRoot });
  const importer = new ImportCatalogService({ repository, source });
  const migrateDatabase = options.migrate || migrate;
  const actorId = options.actorId;
  if (typeof actorId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,159}$/.test(actorId)) throw new Error('setup actor is invalid');
  try {
    const migration = await migrateDatabase(migrationPool);
    await grantRuntimeRole(migrationPool, configuration.database.runtime.connectionString);
    const seed = await importer.seedCurrent({
      organizationId: configuration.organization.id,
      organizationDisplayName: configuration.organization.display_name,
      importerVersion: options.importerVersion || '1.0.0',
      actor: { type: 'automation', id: actorId },
      canonicalRemote: options.canonicalRemote || `repository:${configuration.binding.control_plane_ref}`,
    });
    const binding = buildBinding(configuration, seed.discovery.repository_id, existingBinding(projectRoot), options.clock);
    const bindingPath = atomicWriteProjectJson(projectRoot, BINDING_PATH, binding);
    const queryConfigPath = atomicWriteProjectJson(projectRoot, QUERY_CONFIG_PATH, {
      schema_version: 1,
      mode: 'managed-shadow',
      endpoint: configuration.control_plane.endpoint,
    });
    return Object.freeze({
      status: 'ready',
      mode: 'managed-shadow',
      migration,
      import: seed.report,
      parity: seed.parity,
      repository_id: seed.discovery.repository_id,
      source_commit: seed.discovery.source_commit,
      artifact_count: seed.discovery.entries.length,
      endpoint: configuration.control_plane.endpoint,
      binding_path: path.relative(projectRoot, bindingPath).split(path.sep).join('/'),
      query_config_path: path.relative(projectRoot, queryConfigPath).split(path.sep).join('/'),
      database_migration_connection_env: configuration.database.migration_connection_string_env,
      database_runtime_connection_env: configuration.database.runtime_connection_string_env,
      authentication_token_env: configuration.control_plane.authentication_token_env,
    });
  } finally {
    if (!options.repository && typeof repository.close === 'function') await repository.close();
    if (!options.migrationPool && typeof migrationPool.end === 'function') await migrationPool.end();
    if (!options.runtimePool && typeof runtimePool.end === 'function') await runtimePool.end();
  }
}

async function databaseHealth(pool, repository, configuration, repositoryId) {
  const migrations = await readMigrations(path.resolve(__dirname, 'migrations'));
  const receipts =
    typeof repository.listMigrationVersions === 'function'
      ? await repository.listMigrationVersions(configuration.organization.id)
      : (await pool.query('SELECT version FROM hseos_governance.schema_migrations ORDER BY version')).rows;
  const current = receipts.at(-1)?.version || null;
  const target = migrations.at(-1).version;
  const entries = await repository.listCatalogEntries(configuration.organization.id, repositoryId);
  return {
    live: true,
    ready: current === target && entries.length > 0,
    mode: 'managed-shadow',
    migration: { state: current === target ? 'current' : 'required', current, target },
    projection: { state: entries.length > 0 ? 'current' : 'empty', artifacts: entries.length },
    repository_id: repositoryId,
  };
}

async function createDatabaseBackedControlPlane(options = {}) {
  const projectRoot = assertProjectRoot(options.projectRoot || process.cwd());
  const configuration = loadSidecarConfiguration(options.configPath, { environment: options.environment });
  const source = options.source || new GitGovernanceSource({ repositoryRoot: projectRoot });
  const discovery = await source.discover();
  const pool = options.runtimePool || createPostgresPool(configuration.database.runtime);
  const repository = options.repository || new PostgresGovernanceRepository({ pool, closePool: !options.runtimePool });
  const importer = new ImportCatalogService({ repository, source });
  const entries = () => repository.listCatalogEntries(configuration.organization.id, discovery.repository_id);
  const services = {
    health: () => databaseHealth(pool, repository, configuration, discovery.repository_id),
    listArtifacts: async (input) => (await entries()).slice(0, input.page.limit),
    getArtifact: async (input) => (await entries()).find((entry) => entry.artifact_id === input.id) || null,
    listArtifactVersions: async (input) => (await entries()).filter((entry) => entry.artifact_id === input.id).slice(0, input.page.limit),
    listRules: async () => [],
    getEffectiveContext: async () => ({
      mode: 'managed-shadow',
      repository_id: discovery.repository_id,
      source_commit: discovery.source_commit,
      artifacts: await entries(),
    }),
    getRelease: async () => null,
    diffReleases: async () => ({ status: 'unavailable', reason_code: 'release.not_published' }),
    verifySnapshot: async () => ({ status: 'unavailable', reason_code: 'snapshot.not_supplied' }),
    getSessionStatus: () => databaseHealth(pool, repository, configuration, discovery.repository_id),
    evaluatePolicy: async (input) =>
      evaluatePolicy({
        candidates: [],
        request: input,
        policyVersion: discovery.source_commit,
        evaluatedAt: new Date().toISOString(),
      }),
    planImport: () => importer.plan({ organizationId: configuration.organization.id, importerVersion: '1.0.0' }),
    applyImport: async (_input, context) => {
      const planned = await importer.plan({ organizationId: configuration.organization.id, importerVersion: '1.0.0' });
      return importer.apply({
        ...planned,
        actor: { type: context.actor.type, id: context.actor.id },
        canonicalRemote: options.canonicalRemote || `repository:${configuration.binding.control_plane_ref}`,
      });
    },
    listAudit: async (input) => (await repository.listAuditEvents(configuration.organization.id)).slice(0, input.page.limit),
  };
  const server = createManagedGovernanceServer({
    services,
    auth: createBearerAuth({ token: configuration.control_plane.token }),
    repository,
  });
  return Object.freeze({ configuration, discovery, repository, server });
}

module.exports = {
  BINDING_PATH,
  QUERY_CONFIG_PATH,
  atomicWriteProjectJson,
  buildBinding,
  createDatabaseBackedControlPlane,
  databaseHealth,
  grantRuntimeRole,
  installManagedGovernance,
};
