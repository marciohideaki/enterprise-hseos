'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { assertPackagingPlatform, packCompatibilityEvidence } = require('../tools/lib/compatibility-evidence-pack');
const { LEGACY_SERVER_IDS, readDownstreamCompatibilityEvidence } = require('../tools/lib/compatibility-audit');

const CLI = path.join(__dirname, '..', 'tools', 'cli', 'hseos-cli.js');
const AS_OF = new Date('2026-08-21T23:00:00.000Z');
const RELEASE_SHA = 'a'.repeat(40);
const CONFIGURATION_SHA256 = 'b'.repeat(64);

function sha256(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function writeCanonicalJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return filename;
}

function createFixture({ legacySurface } = {}) {
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
  const surfaces = ['installer-v4-detection', 'plugin-catalog-v1'].map((surfaceId, index) => {
    const consumerId = String(index + 1).repeat(64);
    const isLegacy = legacySurface === surfaceId;
    let attestationPath;
    let consumer;
    if (isLegacy) {
      consumer = { consumer_id_sha256: consumerId, disposition: 'legacy' };
    } else if (surfaceId === 'plugin-catalog-v1') {
      attestationPath = writeCanonicalJson(path.join(sources, `${surfaceId}-attestation.json`), {
        schema_version: 1,
        surface_id: surfaceId,
        consumer_id_sha256: consumerId,
        observed_at: '2026-08-20T12:00:00.000Z',
        migration_verified: true,
        activation_release: 'R',
        compatibility_release: 'R+1',
      });
      consumer = {
        consumer_id_sha256: consumerId,
        disposition: 'migrated',
        observed_at: '2026-08-20T12:00:00.000Z',
        attestation_sha256: sha256(attestationPath),
      };
    }
    const inventoryPath = writeCanonicalJson(path.join(sources, `${surfaceId}-inventory.json`), {
      schema_version: 1,
      surface_id: surfaceId,
      observed_at: '2026-08-20T12:00:00.000Z',
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
  assert.equal(report.cutover_authorized, false);
  assert.equal(report.artifact_count, 5);
  assert.deepEqual(report.surfaces, [
    { surface_id: 'installer-v4-detection', legacy_consumers: 0, migrated_consumers: 0 },
    { surface_id: 'plugin-catalog-v1', legacy_consumers: 0, migrated_consumers: 1 },
  ]);
  const evidence = JSON.parse(fs.readFileSync(report.evidence_path, 'utf8'));
  assert.equal(evidence.release_sha, RELEASE_SHA);
  assert.equal(evidence.configuration_sha256, CONFIGURATION_SHA256);
  assert.equal(evidence.evidence_only, true);
  assert.equal(evidence.cutover_authorized, false);
  const verification = readDownstreamCompatibilityEvidence(report.evidence_path, {
    asOf: AS_OF,
    observationScope: { valid: true, release_sha: RELEASE_SHA, configuration_sha256: CONFIGURATION_SHA256 },
  });
  assert.equal(verification.ready, true);
  assert.equal(verification.verified_artifacts.length, 5);
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

test('packer rejects a mismatched attestation and leaves no partial bundle', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const collection = JSON.parse(fs.readFileSync(fixture.collectionManifestPath, 'utf8'));
  const declaration = collection.surfaces.find((surface) => surface.surface_id === 'plugin-catalog-v1').attestations[0];
  writeCanonicalJson(declaration.source_path, { forged: true });
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: fixture.collectionManifestPath,
        projectDirectory: fixture.projectDirectory,
        outputDirectory: fixture.outputDirectory,
        asOf: AS_OF,
      }),
    /digest does not match the inventory/,
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
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

test('packer rejects source-role reuse and inventory observations that precede their attestations', (t) => {
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
  const surface = futureCollection.surfaces.find((item) => item.surface_id === 'plugin-catalog-v1');
  const inventory = JSON.parse(fs.readFileSync(surface.inventory.source_path, 'utf8'));
  inventory.observed_at = '2026-08-20T11:59:59.000Z';
  writeCanonicalJson(surface.inventory.source_path, inventory);
  assert.throws(
    () =>
      packCompatibilityEvidence({
        collectionManifestPath: future.collectionManifestPath,
        projectDirectory: future.projectDirectory,
        outputDirectory: future.outputDirectory,
        asOf: AS_OF,
      }),
    /observation is newer than the inventory/,
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
