'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('yaml');

const { assertPackagingPlatform, packCompatibilityEvidence } = require('../tools/lib/compatibility-evidence-pack');
const { LEGACY_SERVER_IDS, readDownstreamCompatibilityEvidence } = require('../tools/lib/compatibility-audit');

const CLI = path.join(__dirname, '..', 'tools', 'cli', 'hseos-cli.js');
const ROOT = path.join(__dirname, '..');
const AS_OF = new Date('2026-08-21T23:00:00.000Z');
const RELEASE_SHA = 'a'.repeat(40);
const CONFIGURATION_SHA256 = 'b'.repeat(64);

function sha256(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function sha256Value(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeCanonicalJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return filename;
}

function createUntrustedFixture({ legacySurface } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-pack-'));
  const sources = path.join(root, 'sources');
  fs.mkdirSync(sources, { mode: 0o700 });
  const projectDirectory = path.join(root, 'project');
  const stateDirectory = path.join(projectDirectory, '.hseos', 'state');
  const releaseDirectory = path.join(root, 'releases', RELEASE_SHA);
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(releaseDirectory, 'RELEASE_SHA'), `${RELEASE_SHA}\n`, { mode: 0o600 });
  const observationManifestPath = writeCanonicalJson(path.join(stateDirectory, 'harness-g9-observation-release.json'), {
    schema_version: 1,
    release_sha: RELEASE_SHA,
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
  const activationArtifact = writeCanonicalJson(path.join(sources, 'release-r.json'), {
    release_id: 'R',
    release_sha: RELEASE_SHA,
    published_at: '2026-07-01T00:00:00.000Z',
  });
  const compatibilityArtifact = writeCanonicalJson(path.join(sources, 'release-r-plus-1.json'), {
    release_id: 'R+1',
    release_sha: 'd'.repeat(40),
    predecessor_sha: RELEASE_SHA,
    published_at: '2026-08-20T23:59:59.000Z',
  });
  const consumerSpecs = [
    ...(legacySurface === 'installer-v4-detection'
      ? [
          {
            surfaceId: 'installer-v4-detection',
            remote: 'https://github.com/example/installer-consumer.git',
            commitSha: '4'.repeat(40),
            disposition: 'legacy',
          },
        ]
      : []),
    {
      surfaceId: 'plugin-catalog-v1',
      remote: 'https://github.com/example/plugin-consumer.git',
      commitSha: '5'.repeat(40),
      disposition: legacySurface === 'plugin-catalog-v1' ? 'legacy' : 'migrated',
    },
  ];
  const consumerRegistryPath = writeCanonicalJson(path.join(sources, 'downstream-consumers.json'), {
    schema_version: 1,
    scope: 'hseos-downstream-compatibility',
    completeness_status: 'complete',
    consumers: consumerSpecs.map((spec) => ({
      repository_remote: spec.remote,
      commit_sha: spec.commitSha,
      surfaces: [
        {
          surface_id: spec.surfaceId,
          evidence_path: spec.surfaceId === 'plugin-catalog-v1' ? '.agents/plugins/registry.yaml' : '.hseos',
        },
      ],
    })),
  });
  const consumerRegistry = Object.freeze({
    repository_remote_sha256: 'e'.repeat(64),
    commit_sha: RELEASE_SHA,
    tree_sha: 'f'.repeat(40),
    evidence: {
      kind: 'git-blob',
      path: '.hseos/compatibility/downstream-consumers.json',
      object_sha: '1'.repeat(40),
      content_sha256: sha256(consumerRegistryPath),
    },
  });
  const surfaces = ['installer-v4-detection', 'plugin-catalog-v1'].map((surfaceId, index) => {
    const spec = consumerSpecs.find((candidate) => candidate.surfaceId === surfaceId);
    const consumerId = spec ? sha256Value(spec.remote.replace(/\.git$/, '')) : undefined;
    const isLegacy = spec?.disposition === 'legacy';
    const commitSha = spec?.commitSha;
    const treeSha = String(index + 6).repeat(40);
    const evidence = {
      kind: surfaceId === 'plugin-catalog-v1' ? 'git-blob' : 'git-tree',
      path: surfaceId === 'plugin-catalog-v1' ? '.agents/plugins/registry.yaml' : '.hseos',
      object_sha: String(index + 8).repeat(40),
      content_sha256: String(index + 3).repeat(64),
      classification: isLegacy ? 'legacy' : 'migrated',
    };
    let attestationPath;
    let consumer;
    if (spec && isLegacy) {
      consumer = {
        consumer_id_sha256: consumerId,
        disposition: 'legacy',
        repository_remote_sha256: consumerId,
        commit_sha: commitSha,
        tree_sha: treeSha,
        evidence,
      };
    } else if (spec) {
      attestationPath = writeCanonicalJson(path.join(sources, `${surfaceId}-attestation.json`), {
        schema_version: 2,
        surface_id: surfaceId,
        consumer_id_sha256: consumerId,
        observed_at: '2026-08-20T12:00:00.000Z',
        migration_verified: true,
        activation_release: 'R',
        compatibility_release: 'R+1',
        repository_remote_sha256: consumerId,
        commit_sha: commitSha,
        tree_sha: treeSha,
        evidence,
      });
      consumer = {
        consumer_id_sha256: consumerId,
        disposition: 'migrated',
        repository_remote_sha256: consumerId,
        commit_sha: commitSha,
        tree_sha: treeSha,
        evidence,
        observed_at: '2026-08-20T12:00:00.000Z',
        attestation_sha256: sha256(attestationPath),
      };
    }
    const inventoryPath = writeCanonicalJson(path.join(sources, `${surfaceId}-inventory.json`), {
      schema_version: 2,
      surface_id: surfaceId,
      observed_at: '2026-08-20T12:00:00.000Z',
      collection_method: 'git-pinned-v1',
      observation_release_sha: RELEASE_SHA,
      configuration_sha256: CONFIGURATION_SHA256,
      consumer_registry: consumerRegistry,
      consumers: consumer ? [consumer] : [],
    });
    return {
      surface_id: surfaceId,
      inventory: { source_path: inventoryPath, media_type: 'application/json' },
      attestations: attestationPath ? [{ consumer_id_sha256: consumerId, source_path: attestationPath }] : [],
    };
  });
  const collectionManifestPath = writeCanonicalJson(path.join(sources, 'collection.json'), {
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
    consumer_registry: { source_path: consumerRegistryPath, media_type: 'application/json' },
    surfaces,
  });
  return {
    root,
    sources,
    projectDirectory,
    stateDirectory,
    collectionManifestPath,
    observationManifestPath,
    outputDirectory: path.join(root, 'bundle'),
  };
}

function runGit(repository, ...args) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-20T12:00:00Z', GIT_COMMITTER_DATE: '2026-08-20T12:00:00Z' },
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function initializeRepository(repository, remote) {
  spawnSync('git', ['init', '-q', repository]);
  runGit(repository, 'config', 'user.email', 'fixture@example.invalid');
  runGit(repository, 'config', 'user.name', 'Fixture');
  runGit(repository, 'remote', 'add', 'origin', remote);
  runGit(repository, 'add', '.');
  runGit(repository, 'commit', '-q', '-m', 'fixture');
  return {
    repository,
    remote,
    commitSha: runGit(repository, 'rev-parse', 'HEAD'),
    treeSha: runGit(repository, 'show', '-s', '--format=%T', 'HEAD'),
  };
}

function createFixture({ legacySurface } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-pack-git-'));
  const sources = path.join(root, 'sources');
  fs.mkdirSync(sources, { mode: 0o700 });

  const consumerPath = path.join(root, 'consumer');
  const installerDirectory = path.join(consumerPath, '.hseos', legacySurface === 'installer-v4-detection' ? '_cfg' : '_config');
  fs.mkdirSync(installerDirectory, { recursive: true });
  fs.writeFileSync(path.join(installerDirectory, 'marker'), 'fixture\n');
  const pluginRegistryPath = path.join(consumerPath, '.agents', 'plugins', 'registry.yaml');
  fs.mkdirSync(path.dirname(pluginRegistryPath), { recursive: true });
  if (legacySurface === 'plugin-catalog-v1') {
    fs.writeFileSync(pluginRegistryPath, yaml.stringify({ version: '1.0', schema_version: '1.0', plugins: [] }));
  } else {
    fs.copyFileSync(path.join(ROOT, '.enterprise', 'governance', 'plugins', 'registry.yaml'), pluginRegistryPath);
  }
  const consumer = initializeRepository(consumerPath, 'https://github.com/example/consumer.git');

  const registryPath = path.join(root, 'registry');
  const registryArtifactPath = path.join(registryPath, '.hseos', 'compatibility', 'downstream-consumers.json');
  fs.mkdirSync(path.dirname(registryArtifactPath), { recursive: true });
  writeCanonicalJson(registryArtifactPath, {
    schema_version: 1,
    scope: 'hseos-downstream-compatibility',
    completeness_status: 'complete',
    consumers: [
      {
        repository_remote: consumer.remote,
        commit_sha: consumer.commitSha,
        surfaces: [
          { surface_id: 'installer-v4-detection', evidence_path: '.hseos' },
          { surface_id: 'plugin-catalog-v1', evidence_path: '.agents/plugins/registry.yaml' },
        ],
      },
    ],
  });
  const registry = initializeRepository(registryPath, 'https://github.com/example/hseos-governance.git');
  const releaseSha = registry.commitSha;

  const projectDirectory = path.join(root, 'project');
  const stateDirectory = path.join(projectDirectory, '.hseos', 'state');
  const releaseDirectory = path.join(root, 'releases', releaseSha);
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(releaseDirectory, 'RELEASE_SHA'), `${releaseSha}\n`, { mode: 0o600 });
  const observationManifestPath = writeCanonicalJson(path.join(stateDirectory, 'harness-g9-observation-release.json'), {
    schema_version: 1,
    release_sha: releaseSha,
    release_tree: registry.treeSha,
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
  const inventoryManifestPath = writeCanonicalJson(path.join(sources, 'inventory-collection.json'), {
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
    repository_bindings: [{ repository_path: consumer.repository, remote_name: 'origin', expected_remote: consumer.remote }],
  });
  const activationArtifact = writeCanonicalJson(path.join(sources, 'release-r.json'), {
    release_id: 'R',
    release_sha: releaseSha,
    published_at: '2026-07-01T00:00:00.000Z',
  });
  const compatibilityArtifact = writeCanonicalJson(path.join(sources, 'release-r-plus-1.json'), {
    release_id: 'R+1',
    release_sha: 'd'.repeat(40),
    predecessor_sha: releaseSha,
    published_at: '2026-08-20T23:59:59.000Z',
  });
  const collectionManifestPath = writeCanonicalJson(path.join(sources, 'collection.json'), {
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
    inventory_collection_manifest: { source_path: inventoryManifestPath, media_type: 'application/json' },
  });
  return {
    root,
    sources,
    projectDirectory,
    stateDirectory,
    releaseDirectory,
    releaseSha,
    consumer,
    registry,
    inventoryManifestPath,
    collectionManifestPath,
    observationManifestPath,
    outputDirectory: path.join(root, 'bundle'),
  };
}

test('packer publishes a byte-verified bundle derived from inventories and the observation scope', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const report = packCompatibilityEvidence({
    collectionManifestPath: fixture.collectionManifestPath,
    projectDirectory: fixture.projectDirectory,
    outputDirectory: fixture.outputDirectory,
    asOf: AS_OF,
  });
  assert.equal(report.status, 'available-for-human-verification');
  assert.equal(report.ready_for_human_verification, true);
  assert.equal(report.local_git_verified, true);
  assert.equal(report.remote_reachability_verified, false);
  assert.equal(report.cutover_authorized, false);
  assert.equal(report.artifact_count, 8);
  assert.deepEqual(report.surfaces, [
    { surface_id: 'installer-v4-detection', legacy_consumers: 0, migrated_consumers: 1 },
    { surface_id: 'plugin-catalog-v1', legacy_consumers: 0, migrated_consumers: 1 },
  ]);
  const evidence = JSON.parse(fs.readFileSync(report.evidence_path, 'utf8'));
  assert.equal(evidence.release_sha, fixture.releaseSha);
  assert.equal(evidence.configuration_sha256, CONFIGURATION_SHA256);
  assert.equal(evidence.evidence_only, true);
  assert.equal(evidence.cutover_authorized, false);
  const verification = readDownstreamCompatibilityEvidence(report.evidence_path, {
    asOf: AS_OF,
    observationScope: { valid: true, release_sha: fixture.releaseSha, configuration_sha256: CONFIGURATION_SHA256 },
  });
  assert.equal(verification.ready, true);
  assert.equal(verification.verified_artifacts.length, 8);
  assert.equal(fs.statSync(fixture.outputDirectory).mode & 0o777, 0o700);
  for (const artifact of verification.verified_artifacts) {
    assert.equal(fs.statSync(path.join(fixture.outputDirectory, artifact.artifact_path)).mode & 0o777, 0o600);
  }
});

test('packer derives legacy consumers from the inventory and never upgrades them to ready evidence', (t) => {
  const fixture = createFixture({ legacySurface: 'installer-v4-detection' });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const report = packCompatibilityEvidence({
    collectionManifestPath: fixture.collectionManifestPath,
    projectDirectory: fixture.projectDirectory,
    outputDirectory: fixture.outputDirectory,
    asOf: AS_OF,
  });
  assert.equal(report.status, 'incomplete-legacy-consumers');
  assert.equal(report.ready_for_human_verification, false);
  assert.equal(report.surfaces.find((surface) => surface.surface_id === 'installer-v4-detection').legacy_consumers, 1);
  const evidence = JSON.parse(fs.readFileSync(report.evidence_path, 'utf8'));
  assert.equal(evidence.surfaces.find((surface) => surface.surface_id === 'installer-v4-detection').legacy_consumers, 1);
});

test('packer rejects manually fabricated schema-v2 inventories instead of normalizing their claims', (t) => {
  const fixture = createUntrustedFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const collection = JSON.parse(fs.readFileSync(fixture.collectionManifestPath, 'utf8'));
  collection.schema_version = 2;
  writeCanonicalJson(fixture.collectionManifestPath, collection);
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: fixture.collectionManifestPath,
        projectDirectory: fixture.projectDirectory,
        outputDirectory: fixture.outputDirectory,
        asOf: AS_OF,
      }),
    /unknown or missing fields/,
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test('packer reopens Git repositories and rejects registry or configured-remote drift', (t) => {
  const releaseDrift = createFixture();
  const remoteDrift = createFixture();
  t.after(() => {
    fs.rmSync(releaseDrift.root, { recursive: true, force: true });
    fs.rmSync(remoteDrift.root, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(releaseDrift.registry.repository, 'release-drift'), 'drift\n');
  runGit(releaseDrift.registry.repository, 'add', '.');
  runGit(releaseDrift.registry.repository, 'commit', '-q', '-m', 'release drift');
  const releaseDriftManifest = JSON.parse(fs.readFileSync(releaseDrift.inventoryManifestPath, 'utf8'));
  releaseDriftManifest.registry.commit_sha = runGit(releaseDrift.registry.repository, 'rev-parse', 'HEAD');
  writeCanonicalJson(releaseDrift.inventoryManifestPath, releaseDriftManifest);
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: releaseDrift.collectionManifestPath,
        projectDirectory: releaseDrift.projectDirectory,
        outputDirectory: releaseDrift.outputDirectory,
        asOf: AS_OF,
      }),
    /must equal the canonical observation release SHA/,
  );

  runGit(remoteDrift.consumer.repository, 'remote', 'set-url', 'origin', 'https://github.com/example/substituted.git');
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: remoteDrift.collectionManifestPath,
        projectDirectory: remoteDrift.projectDirectory,
        outputDirectory: remoteDrift.outputDirectory,
        asOf: AS_OF,
      }),
    /repository remote does not match expected_remote/,
  );
});

test('packer binds to the complete canonical project observation scope and excludes operational state', (t) => {
  const operational = createFixture();
  const incomplete = createFixture();
  const emptyRelease = createFixture();
  t.after(() => {
    fs.rmSync(operational.root, { recursive: true, force: true });
    fs.rmSync(incomplete.root, { recursive: true, force: true });
    fs.rmSync(emptyRelease.root, { recursive: true, force: true });
  });
  const operationalOutput = path.join(operational.stateDirectory, 'downstream-bundle');
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: operational.collectionManifestPath,
        projectDirectory: operational.projectDirectory,
        outputDirectory: operationalOutput,
        asOf: AS_OF,
      }),
    /outside the operational state directory/,
  );
  assert.equal(fs.existsSync(operationalOutput), false);

  const immutableReleaseOutput = path.join(operational.releaseDirectory, 'downstream-bundle');
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: operational.collectionManifestPath,
        projectDirectory: operational.projectDirectory,
        outputDirectory: immutableReleaseOutput,
        asOf: AS_OF,
      }),
    /outside the immutable observation release directory/,
  );
  assert.equal(fs.existsSync(immutableReleaseOutput), false);

  writeCanonicalJson(incomplete.observationManifestPath, {
    schema_version: 1,
    release_sha: RELEASE_SHA,
    configuration_sha256: CONFIGURATION_SHA256,
    cutover_authorized: false,
  });
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: incomplete.collectionManifestPath,
        projectDirectory: incomplete.projectDirectory,
        outputDirectory: incomplete.outputDirectory,
        asOf: AS_OF,
      }),
    /Observation manifest has unknown or missing fields/,
  );

  const collection = JSON.parse(fs.readFileSync(emptyRelease.collectionManifestPath, 'utf8'));
  writeCanonicalJson(collection.release_window.activation_artifact.source_path, {});
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: emptyRelease.collectionManifestPath,
        projectDirectory: emptyRelease.projectDirectory,
        outputDirectory: emptyRelease.outputDirectory,
        asOf: AS_OF,
      }),
    /Activation release artifact has unknown or missing fields/,
  );
});

test('packer fails closed for shared-writable observation anchors and platforms without ACL validation', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.throws(() => assertPackagingPlatform('win32'), /Windows ACL privacy validation/);
  if (process.platform !== 'win32') {
    fs.chmodSync(fixture.observationManifestPath, 0o664);
    assert.throws(
      () =>
        packCompatibilityEvidence({
          collectionManifestPath: fixture.collectionManifestPath,
          projectDirectory: fixture.projectDirectory,
          outputDirectory: fixture.outputDirectory,
          asOf: AS_OF,
        }),
      /must not be writable by group or other users/,
    );
  }
});

test('packer refuses overwrite and non-private output parents', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.mkdirSync(fixture.outputDirectory, { mode: 0o700 });
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: fixture.collectionManifestPath,
        projectDirectory: fixture.projectDirectory,
        outputDirectory: fixture.outputDirectory,
        asOf: AS_OF,
      }),
    /already exists/,
  );
  fs.rmdirSync(fixture.outputDirectory);
  if (process.platform !== 'win32') {
    fs.chmodSync(fixture.root, 0o755);
    assert.throws(
      () =>
        packCompatibilityEvidence({
          collectionManifestPath: fixture.collectionManifestPath,
          projectDirectory: fixture.projectDirectory,
          outputDirectory: fixture.outputDirectory,
          asOf: AS_OF,
        }),
      /must not be accessible/,
    );
  }
});

test('packer rejects source-role reuse and a release window that differs from the Git-pinned collection', (t) => {
  const reused = createFixture();
  const future = createFixture();
  t.after(() => {
    fs.rmSync(reused.root, { recursive: true, force: true });
    fs.rmSync(future.root, { recursive: true, force: true });
  });
  const reusedCollection = JSON.parse(fs.readFileSync(reused.collectionManifestPath, 'utf8'));
  reusedCollection.release_window.activation_artifact.source_path = reused.collectionManifestPath;
  writeCanonicalJson(reused.collectionManifestPath, reusedCollection);
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: reused.collectionManifestPath,
        projectDirectory: reused.projectDirectory,
        outputDirectory: reused.outputDirectory,
        asOf: AS_OF,
      }),
    /reuses a source artifact/,
  );

  const futureCollection = JSON.parse(fs.readFileSync(future.collectionManifestPath, 'utf8'));
  futureCollection.release_window.closed_at = '2026-08-21T00:00:00.000Z';
  writeCanonicalJson(future.collectionManifestPath, futureCollection);
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: future.collectionManifestPath,
        projectDirectory: future.projectDirectory,
        outputDirectory: future.outputDirectory,
        asOf: AS_OF,
      }),
    /release window does not match the packaging request/,
  );
});

test('CLI packages a ready bundle and --require-ready fails for truthful legacy inventory', (t) => {
  const ready = createFixture();
  const legacy = createFixture({ legacySurface: 'installer-v4-detection' });
  t.after(() => {
    fs.rmSync(ready.root, { recursive: true, force: true });
    fs.rmSync(legacy.root, { recursive: true, force: true });
  });
  const run = (fixture) =>
    spawnSync(
      process.execPath,
      [
        CLI,
        'compatibility-evidence-pack',
        '--manifest',
        fixture.collectionManifestPath,
        '--directory',
        fixture.projectDirectory,
        '--output-directory',
        fixture.outputDirectory,
        '--as-of',
        AS_OF.toISOString(),
        '--json',
        '--require-ready',
      ],
      { encoding: 'utf8', env: { ...process.env, HSEOS_DISABLE_UPDATE_CHECK: '1' } },
    );
  const readyResult = run(ready);
  assert.equal(readyResult.status, 0, readyResult.stderr);
  assert.equal(JSON.parse(readyResult.stdout).ready_for_human_verification, true);
  const legacyResult = run(legacy);
  assert.equal(legacyResult.status, 2, legacyResult.stderr);
  assert.equal(JSON.parse(legacyResult.stdout).ready_for_human_verification, false);
});
