'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { digestCanonical } = require('../../packages/managed-governance-contracts');
const {
  MemoryGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { classifySource } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/classifiers');
const { createDatabaseBackedControlPlane, installManagedGovernance } = require('../../tools/managed-governance-control-plane/composition');
const { loadSidecarConfiguration } = require('../../tools/managed-governance-control-plane/lib/configuration');
const { loadProjectConfiguration } = require('../../tools/mcp-hseos-governance/lib/governance-query-adapter');

const temporaryDirectories = [];
const REPOSITORY_ID = '00000000-0000-4000-8000-000000000321';
const ENVIRONMENT = {
  TEST_GOVERNANCE_MIGRATION_DATABASE_URL: 'postgresql://migrator:secret@database.example:5432/governance',
  TEST_GOVERNANCE_RUNTIME_DATABASE_URL: 'postgresql://runtime:secret@database.example:5432/governance',
  TEST_GOVERNANCE_TOKEN: '0123456789abcdef0123456789abcdef',
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-install-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, '.hseos', 'config'), { recursive: true });
  return root;
}

function writeConfiguration(root, overrides = {}) {
  const configuration = {
    schema_version: 1,
    mode: 'managed-shadow',
    database: {
      migration_connection_string_env: 'TEST_GOVERNANCE_MIGRATION_DATABASE_URL',
      runtime_connection_string_env: 'TEST_GOVERNANCE_RUNTIME_DATABASE_URL',
      max_connections: 4,
      connection_timeout_ms: 5000,
      idle_timeout_ms: 30_000,
      statement_timeout_ms: 15_000,
      ssl: false,
    },
    organization: { id: 'example-organization', display_name: 'Example Organization' },
    control_plane: {
      host: '127.0.0.1',
      port: 4319,
      authentication_token_env: 'TEST_GOVERNANCE_TOKEN',
    },
    binding: {
      control_plane_ref: 'example-control-plane',
      issuer: 'example-issuer',
      trusted_key_ids: ['example-key'],
      max_snapshot_age_seconds: 86_400,
    },
    ...overrides,
  };
  const filename = path.join(root, '.hseos', 'config', 'managed-governance-sidecar.json');
  fs.writeFileSync(filename, `${JSON.stringify(configuration, null, 2)}\n`, { mode: 0o600 });
  return filename;
}

function discovery() {
  const rawContent = '# Policy\n';
  const base = {
    source_path: '.enterprise/policies/example.md',
    source_kind: 'policy',
    raw_content: rawContent,
    normalized_content: rawContent,
    content_digest: `sha256:${crypto.createHash('sha256').update(rawContent).digest('hex')}`,
  };
  return {
    schema_version: 1,
    repository_id: REPOSITORY_ID,
    source_commit: 'a'.repeat(40),
    source_timestamp: '2026-09-01T00:00:00.000Z',
    source_profile: 'enterprise-hseos:v1',
    source_profile_digest: digestCanonical({ profile: 'enterprise-hseos:v1' }),
    entries: [{ ...base, classification: classifySource(base) }],
  };
}

function source(commitCharacter = 'a') {
  return {
    async discover() {
      return { ...structuredClone(discovery()), source_commit: commitCharacter.repeat(40) };
    },
  };
}

test('sidecar configuration is strict, environment-referenced and deployment-agnostic', () => {
  const root = project();
  const filename = writeConfiguration(root);
  const loaded = loadSidecarConfiguration(filename, { environment: ENVIRONMENT });
  assert.equal(loaded.database.migration.connectionString, ENVIRONMENT.TEST_GOVERNANCE_MIGRATION_DATABASE_URL);
  assert.equal(loaded.database.runtime.connectionString, ENVIRONMENT.TEST_GOVERNANCE_RUNTIME_DATABASE_URL);
  assert.equal(loaded.control_plane.endpoint, 'http://127.0.0.1:4319');
  assert.equal(loaded.organization.id, 'example-organization');

  const inlineSecret = JSON.parse(fs.readFileSync(filename, 'utf8'));
  inlineSecret.database.inline_credential = 'forbidden';
  fs.writeFileSync(filename, JSON.stringify(inlineSecret), { mode: 0o600 });
  assert.throws(() => loadSidecarConfiguration(filename, { environment: ENVIRONMENT }), /unknown fields/);
  writeConfiguration(root);
  assert.throws(() => loadSidecarConfiguration(filename, { environment: {} }), /required in TEST_GOVERNANCE_MIGRATION_DATABASE_URL/);
});

test('setup migrates, seeds and writes stable secret-free managed-shadow files', async () => {
  const root = project();
  const filename = writeConfiguration(root);
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-01T00:00:00.000Z') });
  const grants = [];
  const migrationPool = {
    async query(statement) {
      grants.push(statement);
    },
    async end() {},
  };
  const runtimePool = { async end() {} };
  let migrationCalls = 0;
  const options = {
    projectRoot: root,
    configPath: filename,
    environment: ENVIRONMENT,
    repository,
    migrationPool,
    runtimePool,
    source: source(),
    migrate: async () => ({ applied: migrationCalls++ === 0 ? ['0001_initial_control_plane.sql'] : [], current_version: '0004' }),
    actorId: 'setup-test',
    canonicalRemote: 'https://example.invalid/governance.git',
    clock: () => new Date('2026-09-01T00:00:00.000Z'),
  };
  const first = await installManagedGovernance(options);
  const second = await installManagedGovernance(options);
  const delegated = await installManagedGovernance({ ...options, actorId: 'replacement-operator' });
  assert.equal(first.status, 'ready');
  assert.equal(grants.length, 3);
  assert.ok(grants.every((statement) => statement === 'GRANT hseos_governance_application TO "runtime"'));
  assert.equal(first.artifact_count, 1);
  assert.deepEqual(second.migration.applied, []);
  assert.equal(second.import.counts.unchanged, 1);
  assert.equal(delegated.import.counts.unchanged, 1);

  const bindingPath = path.join(root, first.binding_path);
  const queryPath = path.join(root, first.query_config_path);
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  assert.equal(binding.mode, 'managed-shadow');
  assert.equal(binding.repository_id, REPOSITORY_ID);
  assert.deepEqual(loadProjectConfiguration(root), { endpoint: 'http://127.0.0.1:4319', mode: 'managed-shadow' });
  assert.equal(fs.statSync(bindingPath).mode & 0o077, 0);
  assert.equal(fs.statSync(queryPath).mode & 0o077, 0);
  const generated = `${fs.readFileSync(bindingPath, 'utf8')}\n${fs.readFileSync(queryPath, 'utf8')}`;
  assert.doesNotMatch(generated, /migrator:secret|runtime:secret|0123456789abcdef/);
});

test('database-backed composition reports ready health and serves the seeded catalog', async () => {
  const root = project();
  const filename = writeConfiguration(root);
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-01T00:00:00.000Z') });
  const importer = new (require('../../tools/managed-governance-control-plane/lib/application/import-catalog').ImportCatalogService)({
    repository,
    source: source(),
  });
  await importer.seedCurrent({
    organizationId: 'example-organization',
    organizationDisplayName: 'Example Organization',
    importerVersion: '1.0.0',
    actor: { type: 'automation', id: 'composition-test' },
    canonicalRemote: 'https://example.invalid/governance.git',
  });
  const pool = {
    async query() {
      return { rows: [{ version: '0001' }, { version: '0002' }, { version: '0003' }, { version: '0004' }, { version: '0005' }, { version: '0006' }] };
    },
  };
  const composition = await createDatabaseBackedControlPlane({
    projectRoot: root,
    configPath: filename,
    environment: ENVIRONMENT,
    repository,
    runtimePool: pool,
    source: source('b'),
    canonicalRemote: 'https://example.invalid/governance.git',
  });
  const address = await composition.server.listen();
  const endpoint = `http://127.0.0.1:${address.port}`;
  try {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
    const health = await (await fetch(`${endpoint}/health`)).json();
    assert.equal(health.data.ready, true);
    assert.equal(health.data.projection.artifacts, 1);
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
    const artifacts = await (await fetch(`${endpoint}/api/v1/artifacts?limit=50`)).json();
    assert.equal(artifacts.data.length, 1);
    assert.equal(artifacts.data[0].artifact_type, 'policy');
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
    const context = await (await fetch(`${endpoint}/api/v1/context?repository_id=${REPOSITORY_ID}`)).json();
    assert.equal(context.data.source_commit, 'a'.repeat(40));
  } finally {
    await composition.server.close();
  }
});
