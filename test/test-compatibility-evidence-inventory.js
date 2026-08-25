'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('yaml');

const { LEGACY_SERVER_IDS, readDownstreamCompatibilityEvidence } = require('../tools/lib/compatibility-audit');
const { collectCompatibilityInventory, normalizeRemote } = require('../tools/lib/compatibility-evidence-inventory');
const { packCompatibilityEvidence } = require('../tools/lib/compatibility-evidence-pack');

const ROOT = path.join(__dirname, '..');
const AS_OF = new Date('2026-08-21T23:00:00.000Z');
const CONFIGURATION_SHA256 = 'b'.repeat(64);
const CLI = path.join(ROOT, 'tools', 'cli', 'hseos-cli.js');

function runGit(repository, ...args) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-20T12:00:00Z', GIT_COMMITTER_DATE: '2026-08-20T12:00:00Z' },
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function writeCanonicalJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return filename;
}

function sha256File(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function createRepository(root, name, { legacy = false } = {}) {
  const repository = path.join(root, name);
  fs.mkdirSync(path.join(repository, '.hseos', legacy ? '_cfg' : '_config'), { recursive: true });
  fs.writeFileSync(path.join(repository, '.hseos', legacy ? '_cfg' : '_config', 'marker'), `${name}\n`);
  const registryPath = path.join(repository, '.agents', 'plugins', 'registry.yaml');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  if (legacy) {
    fs.writeFileSync(registryPath, yaml.stringify({ version: '1.0', schema_version: '1.0', plugins: [] }));
  } else {
    fs.copyFileSync(path.join(ROOT, '.enterprise', 'governance', 'plugins', 'registry.yaml'), registryPath);
  }
  spawnSync('git', ['init', '-q', repository]);
  runGit(repository, 'config', 'user.email', 'fixture@example.invalid');
  runGit(repository, 'config', 'user.name', 'Fixture');
  const remote = `https://github.com/example/${name}.git`;
  runGit(repository, 'remote', 'add', 'origin', remote);
  runGit(repository, 'add', '.');
  runGit(repository, 'commit', '-q', '-m', 'fixture');
  return { repository, remote, commitSha: runGit(repository, 'rev-parse', 'HEAD') };
}

function createObservation(root, releaseSha) {
  const projectDirectory = path.join(root, 'control-project');
  const stateDirectory = path.join(projectDirectory, '.hseos', 'state');
  const releaseDirectory = path.join(root, 'releases', releaseSha);
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(releaseDirectory, 'RELEASE_SHA'), `${releaseSha}\n`, { mode: 0o600 });
  const observationManifestPath = writeCanonicalJson(path.join(stateDirectory, 'harness-g9-observation-release.json'), {
    schema_version: 1,
    release_sha: releaseSha,
    release_tree: 'c'.repeat(40),
    release_path: releaseDirectory,
    deployed_at: '2026-06-30T23:00:00.000Z',
    deployment_day_disposition: 'partial-excluded',
    first_candidate_complete_utc_day: '2026-07-01',
    configuration_sha256: CONFIGURATION_SHA256,
    state_database: path.join(stateDirectory, 'project.db'),
    state_schema_version: 4,
    telemetry_database: path.join(stateDirectory, 'mcp-legacy-usage.db'),
    protocol_version: '2024-11-05',
    server_ids: LEGACY_SERVER_IDS,
    persistent_services: {
      project_state: 'hseos-project-state.service:3100',
      governance: 'hseos-governance.service:3101',
      swarm: 'hseos-swarm.service:3102',
      axon_bridge: 'hseos-axon-bridge.service:3103',
    },
    client_configuration: {
      codex: path.join(root, 'clients', 'codex.toml'),
      claude: [path.join(root, 'clients', 'claude.json')],
    },
    rollback: {
      codex_backup: path.join(root, 'backups', 'codex.toml'),
      claude_backups: [path.join(root, 'backups', 'claude.json')],
      service_action: 'disable observation services',
    },
    cutover_authorized: false,
  });
  return { projectDirectory, stateDirectory, observationManifestPath, releaseDirectory };
}

function registryConsumer(repository) {
  return {
    repository_remote: repository.remote,
    commit_sha: repository.commitSha,
    surfaces: [
      { surface_id: 'installer-v4-detection', evidence_path: '.hseos' },
      { surface_id: 'plugin-catalog-v1', evidence_path: '.agents/plugins/registry.yaml' },
    ],
  };
}

function repositoryBinding(repository) {
  return {
    repository_path: repository.repository,
    remote_name: 'origin',
    expected_remote: repository.remote,
  };
}

function createRegistryRepository(root, consumers) {
  const repository = path.join(root, 'consumer-registry');
  const registryPath = path.join(repository, '.hseos', 'compatibility', 'downstream-consumers.json');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  writeCanonicalJson(registryPath, {
    schema_version: 1,
    scope: 'hseos-downstream-compatibility',
    completeness_status: 'complete',
    consumers: consumers.map(registryConsumer),
  });
  spawnSync('git', ['init', '-q', repository]);
  runGit(repository, 'config', 'user.email', 'fixture@example.invalid');
  runGit(repository, 'config', 'user.name', 'Fixture');
  const remote = 'https://github.com/example/consumer-registry.git';
  runGit(repository, 'remote', 'add', 'origin', remote);
  runGit(repository, 'add', '.');
  runGit(repository, 'commit', '-q', '-m', 'registry fixture');
  return { repository, registryPath, remote, commitSha: runGit(repository, 'rev-parse', 'HEAD') };
}

function updateRegistry(fixture, mutate) {
  const registry = JSON.parse(fs.readFileSync(fixture.registry.registryPath, 'utf8'));
  mutate(registry);
  writeCanonicalJson(fixture.registry.registryPath, registry);
  runGit(fixture.registry.repository, 'add', '.');
  runGit(fixture.registry.repository, 'commit', '-q', '-m', 'mutate registry fixture');
  fixture.registry.commitSha = runGit(fixture.registry.repository, 'rev-parse', 'HEAD');
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
  manifest.registry.commit_sha = fixture.registry.commitSha;
  writeCanonicalJson(fixture.manifestPath, manifest);

  const observation = JSON.parse(fs.readFileSync(fixture.observationManifestPath, 'utf8'));
  const releaseDirectory = path.join(fixture.root, 'releases', fixture.registry.commitSha);
  fs.mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(releaseDirectory, 'RELEASE_SHA'), `${fixture.registry.commitSha}\n`, { mode: 0o600 });
  observation.release_sha = fixture.registry.commitSha;
  observation.release_path = releaseDirectory;
  writeCanonicalJson(fixture.observationManifestPath, observation);
  fixture.releaseSha = fixture.registry.commitSha;
  fixture.releaseDirectory = releaseDirectory;
}

function createFixture({ includeLegacy = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-git-inventory-'));
  const modern = createRepository(root, 'modern-consumer');
  const legacy = includeLegacy ? createRepository(root, 'legacy-consumer', { legacy: true }) : null;
  const consumers = [modern, legacy].filter(Boolean);
  const registry = createRegistryRepository(root, consumers);
  const observation = createObservation(root, registry.commitSha);
  const manifestPath = writeCanonicalJson(path.join(root, 'sources', 'inventory-manifest.json'), {
    schema_version: 1,
    evidence_only: true,
    cutover_authorized: false,
    observed_at: '2026-08-20T12:00:00.000Z',
    release_window: {
      activation_release: 'R',
      compatibility_release: 'R+1',
      opened_at: '2026-07-01T00:00:00.000Z',
      closed_at: '2026-08-20T23:59:59.000Z',
    },
    registry: {
      repository_path: registry.repository,
      remote_name: 'origin',
      expected_remote: registry.remote,
      commit_sha: registry.commitSha,
      evidence_path: '.hseos/compatibility/downstream-consumers.json',
    },
    repository_bindings: consumers.map(repositoryBinding),
  });
  return {
    root,
    ...observation,
    modern,
    legacy,
    registry,
    releaseSha: registry.commitSha,
    manifestPath,
    outputDirectory: path.join(root, 'inventory-output'),
  };
}

test('collector derives both compatibility surfaces from immutable Git commits', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const report = collectCompatibilityInventory({
    manifestPath: fixture.manifestPath,
    projectDirectory: fixture.projectDirectory,
    outputDirectory: fixture.outputDirectory,
    asOf: AS_OF,
  });
  assert.equal(report.status, 'inventory-collected');
  assert.equal(report.final_evidence_ready, false);
  assert.equal(report.release_artifacts_required, true);
  assert.equal(report.local_git_verified, true);
  assert.equal(report.remote_reachability_verified, false);
  assert.match(report.collection_manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.cutover_authorized, false);
  assert.deepEqual(
    report.surfaces.map(({ surface_id, legacy_consumers, migrated_consumers }) => ({
      surface_id,
      legacy_consumers,
      migrated_consumers,
    })),
    [
      { surface_id: 'installer-v4-detection', legacy_consumers: 1, migrated_consumers: 1 },
      { surface_id: 'plugin-catalog-v1', legacy_consumers: 1, migrated_consumers: 1 },
    ],
  );
  for (const surface of report.surfaces) {
    const inventory = JSON.parse(fs.readFileSync(surface.inventory.source_path, 'utf8'));
    assert.equal(inventory.schema_version, 2);
    assert.equal(inventory.collection_method, 'git-pinned-v1');
    assert.equal(inventory.observation_release_sha, fixture.releaseSha);
    assert.equal(inventory.configuration_sha256, CONFIGURATION_SHA256);
    assert.equal(inventory.consumer_registry.commit_sha, fixture.registry.commitSha);
    assert.equal(
      inventory.consumers.every((consumer) => consumer.consumer_id_sha256 === consumer.repository_remote_sha256),
      true,
    );
    assert.equal(
      inventory.consumers.every((consumer) => /^[a-f0-9]{40}$/.test(consumer.commit_sha)),
      true,
    );
  }
  assert.equal(fs.statSync(fixture.outputDirectory).mode & 0o777, 0o700);
  for (const filename of fs.readdirSync(path.join(fixture.outputDirectory, 'artifacts'))) {
    assert.equal(fs.statSync(path.join(fixture.outputDirectory, 'artifacts', filename)).mode & 0o777, 0o600);
  }
});

test('collector reads the pinned commit and ignores later worktree mutations', (t) => {
  const fixture = createFixture({ includeLegacy: false });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.rmSync(path.join(fixture.modern.repository, '.hseos', '_config'), { recursive: true });
  fs.mkdirSync(path.join(fixture.modern.repository, '.hseos', '_cfg'));
  fs.writeFileSync(path.join(fixture.modern.repository, '.hseos', '_cfg', 'marker'), 'uncommitted legacy mutation\n');
  fs.writeFileSync(
    path.join(fixture.modern.repository, '.agents', 'plugins', 'registry.yaml'),
    yaml.stringify({ version: '1.0', schema_version: '1.0', plugins: [] }),
  );
  runGit(fixture.modern.repository, 'add', '.');
  runGit(fixture.modern.repository, 'commit', '-q', '-m', 'legacy replacement');
  runGit(fixture.modern.repository, 'replace', fixture.modern.commitSha, runGit(fixture.modern.repository, 'rev-parse', 'HEAD'));
  const report = collectCompatibilityInventory({
    manifestPath: fixture.manifestPath,
    projectDirectory: fixture.projectDirectory,
    outputDirectory: fixture.outputDirectory,
    asOf: AS_OF,
  });
  assert.equal(
    report.surfaces.every((surface) => surface.legacy_consumers === 0 && surface.migrated_consumers === 1),
    true,
  );
});

test('collector output feeds the strict packer without losing Git provenance', (t) => {
  const fixture = createFixture({ includeLegacy: false });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const inventory = collectCompatibilityInventory({
    manifestPath: fixture.manifestPath,
    projectDirectory: fixture.projectDirectory,
    outputDirectory: fixture.outputDirectory,
    asOf: AS_OF,
  });
  const activationArtifact = writeCanonicalJson(path.join(fixture.root, 'sources', 'release-r.json'), {
    release_id: 'R',
    release_sha: fixture.releaseSha,
    published_at: '2026-07-01T00:00:00.000Z',
  });
  const compatibilityArtifact = writeCanonicalJson(path.join(fixture.root, 'sources', 'release-r-plus-1.json'), {
    release_id: 'R+1',
    release_sha: 'd'.repeat(40),
    predecessor_sha: fixture.releaseSha,
    published_at: '2026-08-20T23:59:59.000Z',
  });
  const collectionPath = writeCanonicalJson(path.join(fixture.root, 'sources', 'collection.json'), {
    schema_version: 2,
    evidence_only: true,
    cutover_authorized: false,
    release_window: {
      ...inventory.release_window,
      activation_artifact: { source_path: activationArtifact, media_type: 'application/json' },
      compatibility_artifact: { source_path: compatibilityArtifact, media_type: 'application/json' },
    },
    inventory_collection_manifest: { source_path: fixture.manifestPath, media_type: 'application/json' },
  });
  const bundle = packCompatibilityEvidence({
    collectionManifestPath: collectionPath,
    projectDirectory: fixture.projectDirectory,
    outputDirectory: path.join(fixture.root, 'bundle'),
    asOf: AS_OF,
  });
  assert.equal(bundle.ready_for_human_verification, true);
  const packedInventory = JSON.parse(
    fs.readFileSync(path.join(bundle.output_directory, 'artifacts', 'plugin-catalog-v1-inventory.json'), 'utf8'),
  );
  assert.equal(packedInventory.schema_version, 2);
  assert.equal(packedInventory.consumers[0].commit_sha, fixture.modern.commitSha);
  assert.equal(packedInventory.consumers[0].evidence.kind, 'git-blob');
  const revalidated = readDownstreamCompatibilityEvidence(bundle.evidence_path, {
    asOf: AS_OF,
    observationScope: {
      valid: true,
      release_sha: fixture.releaseSha,
      configuration_sha256: CONFIGURATION_SHA256,
    },
    revalidateGit: true,
    projectDirectory: fixture.projectDirectory,
  });
  assert.equal(revalidated.ready, true);
  assert.equal(revalidated.local_git_revalidated, true);
  assert.equal(revalidated.remote_reachability_verified, false);

  const evidence = JSON.parse(fs.readFileSync(bundle.evidence_path, 'utf8'));
  const activationPath = path.join(bundle.output_directory, evidence.release_window.activation_artifact.artifact_path);
  writeCanonicalJson(activationPath, { fabricated: true });
  evidence.release_window.activation_artifact.sha256 = sha256File(activationPath);
  writeCanonicalJson(bundle.evidence_path, evidence);
  const forgedRelease = readDownstreamCompatibilityEvidence(bundle.evidence_path, {
    asOf: AS_OF,
    observationScope: {
      valid: true,
      release_sha: fixture.releaseSha,
      configuration_sha256: CONFIGURATION_SHA256,
    },
    revalidateGit: true,
    projectDirectory: fixture.projectDirectory,
  });
  assert.equal(forgedRelease.ready, false);
  assert.ok(forgedRelease.errors.some((error) => error.includes('activation release artifact has unknown or missing fields')));
});

test('strict audit re-derives legacy counters from a genuine Git-pinned bundle', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const activationArtifact = writeCanonicalJson(path.join(fixture.root, 'sources', 'counter-r.json'), {
    release_id: 'R',
    release_sha: fixture.releaseSha,
    published_at: '2026-07-01T00:00:00.000Z',
  });
  const compatibilityArtifact = writeCanonicalJson(path.join(fixture.root, 'sources', 'counter-r-plus-1.json'), {
    release_id: 'R+1',
    release_sha: 'd'.repeat(40),
    predecessor_sha: fixture.releaseSha,
    published_at: '2026-08-20T23:59:59.000Z',
  });
  const collectionPath = writeCanonicalJson(path.join(fixture.root, 'sources', 'counter-collection.json'), {
    schema_version: 2,
    evidence_only: true,
    cutover_authorized: false,
    release_window: {
      activation_release: 'R',
      compatibility_release: 'R+1',
      opened_at: '2026-07-01T00:00:00.000Z',
      closed_at: '2026-08-20T23:59:59.000Z',
      activation_artifact: { source_path: activationArtifact, media_type: 'application/json' },
      compatibility_artifact: { source_path: compatibilityArtifact, media_type: 'application/json' },
    },
    inventory_collection_manifest: { source_path: fixture.manifestPath, media_type: 'application/json' },
  });
  const bundle = packCompatibilityEvidence({
    collectionManifestPath: collectionPath,
    projectDirectory: fixture.projectDirectory,
    outputDirectory: path.join(fixture.root, 'counter-bundle'),
    asOf: AS_OF,
  });
  assert.equal(bundle.ready_for_human_verification, false);
  const evidence = JSON.parse(fs.readFileSync(bundle.evidence_path, 'utf8'));
  for (const surface of evidence.surfaces) surface.legacy_consumers = 0;
  writeCanonicalJson(bundle.evidence_path, evidence);
  const forgedCounters = readDownstreamCompatibilityEvidence(bundle.evidence_path, {
    asOf: AS_OF,
    observationScope: {
      valid: true,
      release_sha: fixture.releaseSha,
      configuration_sha256: CONFIGURATION_SHA256,
    },
    revalidateGit: true,
    projectDirectory: fixture.projectDirectory,
  });
  assert.equal(forgedCounters.ready, false);
  assert.equal(forgedCounters.local_git_revalidated, false);
  assert.ok(forgedCounters.errors.some((error) => error.includes('summary differs from the bundle')));
});

test('public CLI emits only a non-authorizing inventory index', (t) => {
  const fixture = createFixture({ includeLegacy: false });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      CLI,
      'compatibility-evidence-inventory',
      '--manifest',
      fixture.manifestPath,
      '--directory',
      fixture.projectDirectory,
      '--output-directory',
      fixture.outputDirectory,
      '--as-of',
      AS_OF.toISOString(),
      '--json',
    ],
    { encoding: 'utf8', env: { ...process.env, HSEOS_DISABLE_UPDATE_CHECK: '1' } },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'inventory-collected');
  assert.equal(report.final_evidence_ready, false);
  assert.equal(report.cutover_authorized, false);
  assert.equal(fs.existsSync(report.index_path), true);
});

test('collector rejects substituted surface paths and output inside a consumer repository', (t) => {
  const fixture = createFixture({ includeLegacy: false });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  updateRegistry(fixture, (registry) => {
    registry.consumers[0].surfaces[1].evidence_path = '.enterprise/governance/plugins/registry.yaml';
  });
  assert.throws(
    () =>
      collectCompatibilityInventory({
        manifestPath: fixture.manifestPath,
        projectDirectory: fixture.projectDirectory,
        outputDirectory: fixture.outputDirectory,
        asOf: AS_OF,
      }),
    /evidence_path must be \.agents\/plugins\/registry\.yaml/,
  );
  updateRegistry(fixture, (registry) => {
    registry.consumers[0].surfaces[1].evidence_path = '.agents/plugins/registry.yaml';
  });
  fs.chmodSync(fixture.modern.repository, 0o700);
  assert.throws(
    () =>
      collectCompatibilityInventory({
        manifestPath: fixture.manifestPath,
        projectDirectory: fixture.projectDirectory,
        outputDirectory: path.join(fixture.modern.repository, 'evidence'),
        asOf: AS_OF,
      }),
    /outside consumer repositories/,
  );
  assert.throws(
    () =>
      collectCompatibilityInventory({
        manifestPath: fixture.manifestPath,
        projectDirectory: fixture.projectDirectory,
        outputDirectory: path.join(fixture.releaseDirectory, 'evidence'),
        asOf: AS_OF,
      }),
    /outside the immutable observation release directory/,
  );
});

test('collector and packer fail closed on unbound or manually fabricated evidence', (t) => {
  const fixture = createFixture({ includeLegacy: false });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
  manifest.repository_bindings[0].expected_remote = 'https://github.com/example/other.git';
  writeCanonicalJson(fixture.manifestPath, manifest);
  assert.throws(
    () =>
      collectCompatibilityInventory({
        manifestPath: fixture.manifestPath,
        projectDirectory: fixture.projectDirectory,
        outputDirectory: fixture.outputDirectory,
        asOf: AS_OF,
      }),
    /bindings must exactly match|remote does not match/,
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);

  assert.throws(() => normalizeRemote('https://token@github.com/example/private.git'), /embedded credentials/);
  assert.throws(() => normalizeRemote('/tmp/local-repository'), /network URL/);

  const legacyInventoryPath = writeCanonicalJson(path.join(fixture.root, 'sources', 'manual-inventory.json'), {
    schema_version: 1,
    surface_id: 'plugin-catalog-v1',
    observed_at: '2026-08-20T12:00:00.000Z',
    consumers: [],
  });
  const manualRegistryPath = writeCanonicalJson(path.join(fixture.root, 'sources', 'manual-registry.json'), {
    schema_version: 1,
    scope: 'hseos-downstream-compatibility',
    completeness_status: 'complete',
    consumers: [],
  });
  const activationArtifact = writeCanonicalJson(path.join(fixture.root, 'sources', 'manual-r.json'), {
    release_id: 'R',
    release_sha: fixture.releaseSha,
    published_at: '2026-07-01T00:00:00.000Z',
  });
  const compatibilityArtifact = writeCanonicalJson(path.join(fixture.root, 'sources', 'manual-r1.json'), {
    release_id: 'R+1',
    release_sha: 'd'.repeat(40),
    predecessor_sha: fixture.releaseSha,
    published_at: '2026-08-20T23:59:59.000Z',
  });
  const collectionPath = writeCanonicalJson(path.join(fixture.root, 'sources', 'manual-collection.json'), {
    schema_version: 1,
    evidence_only: true,
    cutover_authorized: false,
    release_window: {
      activation_release: 'R',
      compatibility_release: 'R+1',
      opened_at: '2026-07-01T00:00:00.000Z',
      closed_at: '2026-08-20T23:59:59.000Z',
      activation_artifact: { source_path: activationArtifact, media_type: 'application/json' },
      compatibility_artifact: { source_path: compatibilityArtifact, media_type: 'application/json' },
    },
    consumer_registry: { source_path: manualRegistryPath, media_type: 'application/json' },
    surfaces: ['installer-v4-detection', 'plugin-catalog-v1'].map((surfaceId) => ({
      surface_id: surfaceId,
      inventory: { source_path: legacyInventoryPath, media_type: 'application/json' },
      attestations: [],
    })),
  });
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: collectionPath,
        projectDirectory: fixture.projectDirectory,
        outputDirectory: path.join(fixture.root, 'manual-bundle'),
        asOf: AS_OF,
      }),
    /unknown or missing fields|schema_version must be 2|reuses a source artifact/,
  );
});
