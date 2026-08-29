'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const {
  DOWNSTREAM_EVIDENCE_FILENAME,
  LEGACY_SERVER_IDS,
  OBSERVATION_MANIFEST_FILENAME,
  REQUIRED_DOWNSTREAM_SURFACES,
  readCanonicalEvidenceFile,
  readDownstreamCompatibilityEvidence,
  readStableRegularFile,
} = require('./compatibility-audit');

const COLLECTION_SCHEMA_VERSION = 2;
const MAX_COLLECTION_BYTES = 1024 * 1024;
const MAX_SOURCE_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_CONSUMERS_PER_SURFACE = 10_000;

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function isCanonicalUtcInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function assertAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new TypeError(`${label} must be a normalized absolute path`);
  }
}

function assertPackagingPlatform(platform = process.platform) {
  if (platform === 'win32') {
    throw new Error('Downstream evidence packaging is unavailable until Windows ACL privacy validation is implemented');
  }
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertPrivateOutputParent(outputDirectory, stateDirectory, forbiddenDirectories = []) {
  assertAbsolutePath(outputDirectory, 'Output directory');
  if (isWithin(stateDirectory, outputDirectory)) {
    throw new Error('Output directory must be outside the operational state directory');
  }
  for (const directory of forbiddenDirectories) {
    if (isWithin(directory, outputDirectory)) {
      throw new Error('Output directory must be outside the immutable observation release directory');
    }
  }
  if (fs.existsSync(outputDirectory)) throw new Error('Output directory already exists; evidence bundles are immutable');
  const parent = path.dirname(outputDirectory);
  if (!fs.existsSync(parent)) throw new Error('Output directory parent must already exist');
  if (fs.realpathSync(parent) !== parent) throw new Error('Output directory parent must not traverse a symlink');
  const metadata = fs.lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Output directory parent must be a real directory');
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error('Output directory parent must not be accessible by group or other users');
  }
}

function validateSourceReference(reference, label, { jsonOnly = false } = {}) {
  if (!hasExactKeys(reference, ['source_path', 'media_type'])) throw new Error(`${label} source has unknown or missing fields`);
  assertAbsolutePath(reference.source_path, `${label} source_path`);
  const allowed = jsonOnly ? ['application/json'] : ['application/json', 'text/plain'];
  if (!allowed.includes(reference.media_type)) throw new Error(`${label} source media_type is unsupported`);
  return reference;
}

function readSource(reference, label, { jsonOnly = false } = {}) {
  validateSourceReference(reference, label, { jsonOnly });
  const artifact = readStableRegularFile(reference.source_path, `${label} source`, MAX_SOURCE_ARTIFACT_BYTES);
  let parsed;
  if (reference.media_type === 'application/json') {
    parsed = JSON.parse(artifact.contents.toString('utf8'));
    const canonical = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
    if (!artifact.contents.equals(canonical)) throw new Error(`${label} source must use canonical JSON encoding`);
  }
  return Object.freeze({ ...artifact, parsed });
}

function validateObservationManifest(projectDirectory) {
  assertAbsolutePath(projectDirectory, 'Project directory');
  if (fs.realpathSync(projectDirectory) !== projectDirectory) throw new Error('Project directory must not traverse a symlink');
  const projectMetadata = fs.lstatSync(projectDirectory);
  if (!projectMetadata.isDirectory() || projectMetadata.isSymbolicLink()) throw new Error('Project directory must be a real directory');
  const stateDirectory = path.join(projectDirectory, '.hseos', 'state');
  const manifestPath = path.join(stateDirectory, OBSERVATION_MANIFEST_FILENAME);
  const { parsed, sha256 } = readCanonicalEvidenceFile(manifestPath, 'Observation manifest', 128 * 1024);
  if (
    !hasExactKeys(parsed, [
      'schema_version',
      'release_sha',
      'release_tree',
      'release_path',
      'deployed_at',
      'deployment_day_disposition',
      'first_candidate_complete_utc_day',
      'configuration_sha256',
      'state_database',
      'state_schema_version',
      'telemetry_database',
      'protocol_version',
      'server_ids',
      'persistent_services',
      'client_configuration',
      'rollback',
      'cutover_authorized',
    ])
  ) {
    throw new Error('Observation manifest has unknown or missing fields');
  }
  if (parsed.schema_version !== 1) throw new Error('Observation manifest schema_version must be 1');
  if (!/^[a-f0-9]{40}$/.test(parsed.release_sha || '')) throw new Error('Observation manifest release_sha must be a full Git SHA');
  if (!/^[a-f0-9]{40}$/.test(parsed.release_tree || '')) throw new Error('Observation manifest release_tree must be a full Git tree SHA');
  if (!/^[a-f0-9]{64}$/.test(parsed.configuration_sha256 || '')) {
    throw new Error('Observation manifest configuration_sha256 must be SHA-256');
  }
  if (!isCanonicalUtcInstant(parsed.deployed_at)) throw new Error('Observation manifest deployed_at must be a canonical UTC instant');
  if (parsed.deployment_day_disposition !== 'partial-excluded') {
    throw new Error('Observation manifest deployment day must remain partial-excluded');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.first_candidate_complete_utc_day || '')) {
    throw new Error('Observation manifest first_candidate_complete_utc_day is invalid');
  }
  if (parsed.first_candidate_complete_utc_day <= parsed.deployed_at.slice(0, 10)) {
    throw new Error('Observation manifest first candidate day must follow deployment');
  }
  assertAbsolutePath(parsed.release_path, 'Observation manifest release_path');
  if (path.basename(parsed.release_path) !== parsed.release_sha) throw new Error('Observation manifest release_path must be SHA-addressed');
  const releaseMetadata = fs.lstatSync(parsed.release_path);
  if (!releaseMetadata.isDirectory() || releaseMetadata.isSymbolicLink() || fs.realpathSync(parsed.release_path) !== parsed.release_path) {
    throw new Error('Observation manifest release_path must be a real, non-symlink directory');
  }
  if ((releaseMetadata.mode & 0o077) !== 0) throw new Error('Observation manifest release_path must be private');
  const releaseShaMarker = readStableRegularFile(path.join(parsed.release_path, 'RELEASE_SHA'), 'Observation release SHA marker', 128);
  if (!releaseShaMarker.contents.equals(Buffer.from(`${parsed.release_sha}\n`))) {
    throw new Error('Observation release SHA marker does not match the manifest');
  }
  if (path.resolve(parsed.state_database || '') !== path.join(stateDirectory, 'project.db')) {
    throw new Error('Observation manifest state_database does not match the project state path');
  }
  if (path.resolve(parsed.telemetry_database || '') !== path.join(stateDirectory, 'mcp-legacy-usage.db')) {
    throw new Error('Observation manifest telemetry_database does not match the project telemetry path');
  }
  if (parsed.state_schema_version !== 4) throw new Error('Observation manifest state_schema_version must remain 4');
  if (parsed.protocol_version !== '2024-11-05') throw new Error('Observation manifest protocol_version must remain legacy during G9');
  const declaredIds = Array.isArray(parsed.server_ids) ? [...parsed.server_ids].sort() : [];
  if (JSON.stringify(declaredIds) !== JSON.stringify([...LEGACY_SERVER_IDS].sort())) {
    throw new Error('Observation manifest server_ids do not match the required set');
  }
  if (
    !hasExactKeys(parsed.persistent_services, ['project_state', 'governance', 'swarm', 'axon_bridge']) ||
    Object.values(parsed.persistent_services).some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    throw new Error('Observation manifest persistent_services are incomplete');
  }
  if (
    !hasExactKeys(parsed.client_configuration, ['codex', 'claude']) ||
    typeof parsed.client_configuration.codex !== 'string' ||
    !path.isAbsolute(parsed.client_configuration.codex) ||
    !Array.isArray(parsed.client_configuration.claude) ||
    parsed.client_configuration.claude.length === 0 ||
    parsed.client_configuration.claude.some((value) => typeof value !== 'string' || !path.isAbsolute(value))
  ) {
    throw new Error('Observation manifest client_configuration is incomplete');
  }
  if (!hasExactKeys(parsed.rollback, ['codex_backup', 'claude_backups', 'service_action'])) {
    throw new Error('Observation manifest rollback contract is incomplete');
  }
  if (
    typeof parsed.rollback.codex_backup !== 'string' ||
    !path.isAbsolute(parsed.rollback.codex_backup) ||
    !Array.isArray(parsed.rollback.claude_backups) ||
    parsed.rollback.claude_backups.length === 0 ||
    parsed.rollback.claude_backups.some((value) => typeof value !== 'string' || !path.isAbsolute(value)) ||
    typeof parsed.rollback.service_action !== 'string' ||
    parsed.rollback.service_action.length === 0
  ) {
    throw new Error('Observation manifest rollback values are incomplete');
  }
  if (parsed.cutover_authorized !== false) throw new Error('Observation manifest cutover_authorized must be false');
  return Object.freeze({
    valid: true,
    path: manifestPath,
    sha256,
    release_sha: parsed.release_sha,
    configuration_sha256: parsed.configuration_sha256,
    state_directory: stateDirectory,
    release_path: parsed.release_path,
  });
}

function validateWindow(window, asOf) {
  if (
    !hasExactKeys(window, [
      'activation_release',
      'compatibility_release',
      'opened_at',
      'closed_at',
      'activation_artifact',
      'compatibility_artifact',
    ])
  ) {
    throw new Error('Collection release_window has unknown or missing fields');
  }
  for (const key of ['activation_release', 'compatibility_release']) {
    if (typeof window[key] !== 'string' || !/^[A-Za-z0-9._/@+-]{1,128}$/.test(window[key])) {
      throw new Error(`${key} is invalid`);
    }
  }
  if (window.activation_release === window.compatibility_release) {
    throw new Error('compatibility_release must differ from activation_release');
  }
  if (!isCanonicalUtcInstant(window.opened_at) || !isCanonicalUtcInstant(window.closed_at)) {
    throw new Error('Release window timestamps must be canonical UTC instants');
  }
  if (window.opened_at >= window.closed_at) throw new Error('Release window must advance');
  if (window.closed_at > new Date(asOf).toISOString()) throw new Error('Release window cannot close after the packaging instant');
  validateSourceReference(window.activation_artifact, 'Activation release artifact', { jsonOnly: true });
  validateSourceReference(window.compatibility_artifact, 'Compatibility release artifact', { jsonOnly: true });
}

function validateReleaseArtifacts(activation, compatibility, releaseWindow, observationScope) {
  if (!hasExactKeys(activation, ['release_id', 'release_sha', 'published_at'])) {
    throw new Error('Activation release artifact has unknown or missing fields');
  }
  if (!hasExactKeys(compatibility, ['release_id', 'release_sha', 'predecessor_sha', 'published_at'])) {
    throw new Error('Compatibility release artifact has unknown or missing fields');
  }
  if (activation.release_id !== releaseWindow.activation_release || compatibility.release_id !== releaseWindow.compatibility_release) {
    throw new Error('Release artifact identifiers do not match the collection window');
  }
  if (activation.release_sha !== observationScope.release_sha) {
    throw new Error('Activation release artifact does not match the observation release');
  }
  if (!/^[a-f0-9]{40}$/.test(compatibility.release_sha || '') || compatibility.release_sha === activation.release_sha) {
    throw new Error('Compatibility release artifact must identify a distinct full Git SHA');
  }
  if (compatibility.predecessor_sha !== activation.release_sha) {
    throw new Error('Compatibility release artifact predecessor does not match activation');
  }
  for (const [label, publishedAt] of [
    ['Activation', activation.published_at],
    ['Compatibility', compatibility.published_at],
  ]) {
    if (!isCanonicalUtcInstant(publishedAt) || publishedAt < releaseWindow.opened_at || publishedAt > releaseWindow.closed_at) {
      throw new Error(`${label} release artifact published_at is outside the release window`);
    }
  }
  if (compatibility.published_at <= activation.published_at) {
    throw new Error('Compatibility release artifact must follow activation');
  }
}

function validateInventory(inventory, surfaceId, releaseWindow) {
  if (
    !hasExactKeys(inventory, [
      'schema_version',
      'surface_id',
      'observed_at',
      'collection_method',
      'observation_release_sha',
      'configuration_sha256',
      'consumer_registry',
      'consumers',
    ])
  ) {
    throw new Error(`Surface ${surfaceId} inventory has unknown or missing fields`);
  }
  if (inventory.schema_version !== 2) throw new Error(`Surface ${surfaceId} inventory schema_version must be 2`);
  if (inventory.surface_id !== surfaceId) throw new Error(`Surface ${surfaceId} inventory surface_id does not match`);
  if (inventory.collection_method !== 'git-pinned-v1') {
    throw new Error(`Surface ${surfaceId} inventory must be collected from Git-pinned evidence`);
  }
  if (!/^[a-f0-9]{40}$/.test(inventory.observation_release_sha || '')) {
    throw new Error(`Surface ${surfaceId} inventory observation_release_sha is invalid`);
  }
  if (!/^[a-f0-9]{64}$/.test(inventory.configuration_sha256 || '')) {
    throw new Error(`Surface ${surfaceId} inventory configuration_sha256 is invalid`);
  }
  validateConsumerRegistryProvenance(inventory.consumer_registry, surfaceId);
  if (!isCanonicalUtcInstant(inventory.observed_at)) throw new Error(`Surface ${surfaceId} inventory observed_at is invalid`);
  if (inventory.observed_at < releaseWindow.opened_at || inventory.observed_at > releaseWindow.closed_at) {
    throw new Error(`Surface ${surfaceId} inventory is outside the release window`);
  }
  if (!Array.isArray(inventory.consumers) || inventory.consumers.length > MAX_CONSUMERS_PER_SURFACE) {
    throw new Error(`Surface ${surfaceId} inventory consumers must be a bounded array`);
  }
  const ids = new Set();
  const consumers = inventory.consumers.map((consumer) => {
    const migrated = consumer?.disposition === 'migrated';
    const expectedKeys = migrated
      ? [
          'consumer_id_sha256',
          'disposition',
          'repository_remote_sha256',
          'commit_sha',
          'tree_sha',
          'evidence',
          'observed_at',
          'attestation_sha256',
        ]
      : ['consumer_id_sha256', 'disposition', 'repository_remote_sha256', 'commit_sha', 'tree_sha', 'evidence'];
    if (!hasExactKeys(consumer, expectedKeys)) throw new Error(`Surface ${surfaceId} inventory consumer has unknown or missing fields`);
    if (!/^[a-f0-9]{64}$/.test(consumer.consumer_id_sha256 || '')) {
      throw new Error(`Surface ${surfaceId} inventory consumer_id_sha256 is invalid`);
    }
    if (ids.has(consumer.consumer_id_sha256)) throw new Error(`Surface ${surfaceId} inventory has a duplicate consumer`);
    ids.add(consumer.consumer_id_sha256);
    if (consumer.repository_remote_sha256 !== consumer.consumer_id_sha256) {
      throw new Error(`Surface ${surfaceId} consumer identity is not bound to its repository remote`);
    }
    if (!/^[a-f0-9]{40}$/.test(consumer.commit_sha || '') || !/^[a-f0-9]{40}$/.test(consumer.tree_sha || '')) {
      throw new Error(`Surface ${surfaceId} consumer Git provenance is invalid`);
    }
    validateGitEvidence(consumer.evidence, consumer.disposition, surfaceId);
    if (!['legacy', 'migrated'].includes(consumer.disposition)) {
      throw new Error(`Surface ${surfaceId} inventory disposition is invalid`);
    }
    if (migrated) {
      if (!isCanonicalUtcInstant(consumer.observed_at)) throw new Error(`Surface ${surfaceId} migrated consumer observed_at is invalid`);
      if (consumer.observed_at < releaseWindow.opened_at || consumer.observed_at > releaseWindow.closed_at) {
        throw new Error(`Surface ${surfaceId} migrated consumer is outside the release window`);
      }
      if (consumer.observed_at > inventory.observed_at) {
        throw new Error(`Surface ${surfaceId} migrated consumer observation is newer than the inventory`);
      }
      if (!/^[a-f0-9]{64}$/.test(consumer.attestation_sha256 || '')) {
        throw new Error(`Surface ${surfaceId} migrated consumer attestation_sha256 is invalid`);
      }
    }
    return consumer;
  });
  return Object.freeze({
    observed_at: inventory.observed_at,
    observation_release_sha: inventory.observation_release_sha,
    configuration_sha256: inventory.configuration_sha256,
    consumer_registry: inventory.consumer_registry,
    consumers,
  });
}

function validateConsumerRegistryProvenance(provenance, surfaceId) {
  if (!hasExactKeys(provenance, ['repository_remote_sha256', 'commit_sha', 'tree_sha', 'evidence'])) {
    throw new Error(`Surface ${surfaceId} consumer registry provenance has unknown or missing fields`);
  }
  if (
    !/^[a-f0-9]{64}$/.test(provenance.repository_remote_sha256 || '') ||
    !/^[a-f0-9]{40}$/.test(provenance.commit_sha || '') ||
    !/^[a-f0-9]{40}$/.test(provenance.tree_sha || '')
  ) {
    throw new Error(`Surface ${surfaceId} consumer registry Git provenance is invalid`);
  }
  if (!hasExactKeys(provenance.evidence, ['kind', 'path', 'object_sha', 'content_sha256'])) {
    throw new Error(`Surface ${surfaceId} consumer registry evidence has unknown or missing fields`);
  }
  if (
    provenance.evidence.kind !== 'git-blob' ||
    provenance.evidence.path !== '.hseos/compatibility/downstream-consumers.json' ||
    !/^[a-f0-9]{40}$/.test(provenance.evidence.object_sha || '') ||
    !/^[a-f0-9]{64}$/.test(provenance.evidence.content_sha256 || '')
  ) {
    throw new Error(`Surface ${surfaceId} consumer registry evidence is invalid`);
  }
}

function normalizeRegistryRemote(value) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || /[\r\n\0]/.test(value)) {
    throw new TypeError('Consumer registry remote must be a non-empty single-line string');
  }
  const scp = value.match(/^([^@/:\s]+)@([^:/\s]+):(.+)$/);
  if (scp) return `ssh://${scp[1]}@${scp[2].toLowerCase()}/${scp[3].replaceAll(/^\/+|\/+$/g, '').replace(/\.git$/, '')}`;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('Consumer registry remote must be an explicit network URL');
  }
  if (!['https:', 'ssh:', 'git:'].includes(parsed.protocol)) throw new TypeError('Consumer registry remote protocol is unsupported');
  if (parsed.password || (parsed.protocol === 'https:' && parsed.username)) {
    throw new Error('Consumer registry remote must not contain embedded credentials');
  }
  const pathname = parsed.pathname.replaceAll(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!parsed.hostname || !pathname) throw new TypeError('Consumer registry remote is incomplete');
  const username = parsed.protocol === 'ssh:' && parsed.username ? `${parsed.username}@` : '';
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${username}${parsed.hostname.toLowerCase()}${port}/${pathname}`;
}

function validateConsumerRegistryArtifact(registry, registrySource, preparedSurfaces) {
  if (!hasExactKeys(registry, ['schema_version', 'scope', 'completeness_status', 'consumers'])) {
    throw new Error('Consumer registry artifact has unknown or missing fields');
  }
  if (registry.schema_version !== 1 || registry.scope !== 'hseos-downstream-compatibility') {
    throw new Error('Consumer registry artifact schema or scope is invalid');
  }
  if (registry.completeness_status !== 'complete') {
    throw new Error('Consumer registry artifact completeness_status must be complete');
  }
  if (!Array.isArray(registry.consumers) || registry.consumers.length > MAX_CONSUMERS_PER_SURFACE) {
    throw new Error('Consumer registry artifact consumers must be a bounded array');
  }
  const expectedBySurface = new Map(REQUIRED_DOWNSTREAM_SURFACES.map((surfaceId) => [surfaceId, new Map()]));
  const registryIds = new Set();
  for (const consumer of registry.consumers) {
    if (!hasExactKeys(consumer, ['repository_remote', 'commit_sha', 'surfaces'])) {
      throw new Error('Consumer registry artifact entry has unknown or missing fields');
    }
    const consumerId = createHash('sha256').update(normalizeRegistryRemote(consumer.repository_remote)).digest('hex');
    if (registryIds.has(consumerId)) throw new Error('Consumer registry artifact has a duplicate repository');
    registryIds.add(consumerId);
    if (!/^[a-f0-9]{40}$/.test(consumer.commit_sha || '')) throw new Error('Consumer registry artifact commit_sha is invalid');
    if (!Array.isArray(consumer.surfaces) || consumer.surfaces.length === 0) {
      throw new Error('Consumer registry artifact surfaces must be non-empty');
    }
    const surfaceIds = new Set();
    for (const surface of consumer.surfaces) {
      if (!hasExactKeys(surface, ['surface_id', 'evidence_path'])) {
        throw new Error('Consumer registry artifact surface has unknown or missing fields');
      }
      if (surfaceIds.has(surface.surface_id)) throw new Error('Consumer registry artifact has a duplicate surface');
      surfaceIds.add(surface.surface_id);
      const expectedPath =
        surface.surface_id === 'plugin-catalog-v1'
          ? '.agents/plugins/registry.yaml'
          : surface.surface_id === 'installer-v4-detection'
            ? '.hseos'
            : null;
      if (surface.evidence_path !== expectedPath) throw new Error('Consumer registry artifact surface path is invalid');
      expectedBySurface.get(surface.surface_id).set(consumerId, consumer.commit_sha);
    }
  }
  const sharedProvenance = preparedSurfaces[0].inventory.consumer_registry;
  if (sharedProvenance.commit_sha !== preparedSurfaces[0].inventory.observation_release_sha) {
    throw new Error('Consumer registry commit does not match the observation release');
  }
  if (registrySource.sha256 !== sharedProvenance.evidence.content_sha256) {
    throw new Error('Consumer registry artifact digest does not match inventory provenance');
  }
  for (const surface of preparedSurfaces) {
    const expected = expectedBySurface.get(surface.surface_id);
    const observed = new Map(surface.inventory.consumers.map((consumer) => [consumer.consumer_id_sha256, consumer.commit_sha]));
    if (JSON.stringify([...expected.entries()].sort()) !== JSON.stringify([...observed.entries()].sort())) {
      throw new Error(`Surface ${surface.surface_id} inventory does not exactly match the pinned consumer registry`);
    }
  }
}

function validateGitEvidence(evidence, disposition, surfaceId) {
  if (!hasExactKeys(evidence, ['kind', 'path', 'object_sha', 'content_sha256', 'classification'])) {
    throw new Error(`Surface ${surfaceId} consumer evidence has unknown or missing fields`);
  }
  if (!['git-blob', 'git-tree'].includes(evidence.kind)) throw new Error(`Surface ${surfaceId} consumer evidence kind is invalid`);
  const requiredEvidence =
    surfaceId === 'plugin-catalog-v1' ? { kind: 'git-blob', path: '.agents/plugins/registry.yaml' } : { kind: 'git-tree', path: '.hseos' };
  if (evidence.kind !== requiredEvidence.kind || evidence.path !== requiredEvidence.path) {
    throw new Error(`Surface ${surfaceId} consumer evidence does not identify the canonical compatibility input`);
  }
  if (
    typeof evidence.path !== 'string' ||
    evidence.path.length === 0 ||
    path.posix.isAbsolute(evidence.path) ||
    path.posix.normalize(evidence.path) !== evidence.path ||
    evidence.path.split('/').includes('..') ||
    evidence.path.includes('\\')
  ) {
    throw new Error(`Surface ${surfaceId} consumer evidence path is invalid`);
  }
  if (!/^[a-f0-9]{40}$/.test(evidence.object_sha || '') || !/^[a-f0-9]{64}$/.test(evidence.content_sha256 || '')) {
    throw new Error(`Surface ${surfaceId} consumer evidence digest is invalid`);
  }
  if (evidence.classification !== disposition) {
    throw new Error(`Surface ${surfaceId} consumer evidence classification does not match disposition`);
  }
}

function validateAttestation(attestation, expected, surfaceId, releaseWindow) {
  if (
    !hasExactKeys(attestation, [
      'schema_version',
      'surface_id',
      'consumer_id_sha256',
      'observed_at',
      'migration_verified',
      'activation_release',
      'compatibility_release',
      'repository_remote_sha256',
      'commit_sha',
      'tree_sha',
      'evidence',
    ])
  ) {
    throw new Error(`Surface ${surfaceId} consumer attestation has unknown or missing fields`);
  }
  if (attestation.schema_version !== 2) throw new Error(`Surface ${surfaceId} consumer attestation schema_version must be 2`);
  if (attestation.surface_id !== surfaceId || attestation.consumer_id_sha256 !== expected.consumer_id_sha256) {
    throw new Error(`Surface ${surfaceId} consumer attestation identity does not match the inventory`);
  }
  if (attestation.observed_at !== expected.observed_at) {
    throw new Error(`Surface ${surfaceId} consumer attestation observed_at does not match the inventory`);
  }
  if (attestation.migration_verified !== true) throw new Error(`Surface ${surfaceId} consumer attestation must verify migration`);
  for (const key of ['repository_remote_sha256', 'commit_sha', 'tree_sha']) {
    if (attestation[key] !== expected[key]) {
      throw new Error(`Surface ${surfaceId} consumer attestation ${key} does not match the inventory`);
    }
  }
  if (JSON.stringify(attestation.evidence) !== JSON.stringify(expected.evidence)) {
    throw new Error(`Surface ${surfaceId} consumer attestation evidence does not match the inventory`);
  }
  if (
    attestation.activation_release !== releaseWindow.activation_release ||
    attestation.compatibility_release !== releaseWindow.compatibility_release
  ) {
    throw new Error(`Surface ${surfaceId} consumer attestation release window does not match`);
  }
}

function artifactFilename(label, mediaType) {
  return `artifacts/${label}.${mediaType === 'application/json' ? 'json' : 'txt'}`;
}

function writeExclusiveFile(filename, contents) {
  fs.writeFileSync(filename, contents, { flag: 'wx', mode: 0o600 });
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function copyArtifact(outputDirectory, relativePath, source, mediaType) {
  const filename = path.join(outputDirectory, ...relativePath.split('/'));
  writeExclusiveFile(filename, source.contents);
  return Object.freeze({ artifact_path: relativePath, media_type: mediaType, sha256: source.sha256 });
}

function packCompatibilityEvidence({ collectionManifestPath, projectDirectory, outputDirectory, asOf = new Date() }) {
  assertPackagingPlatform();
  assertAbsolutePath(collectionManifestPath, 'Collection manifest');
  const observationScope = validateObservationManifest(projectDirectory);
  assertPrivateOutputParent(outputDirectory, observationScope.state_directory, [observationScope.release_path]);
  const { parsed: request } = readCanonicalEvidenceFile(
    collectionManifestPath,
    'Downstream evidence collection manifest',
    MAX_COLLECTION_BYTES,
  );
  if (
    !hasExactKeys(request, ['schema_version', 'evidence_only', 'cutover_authorized', 'release_window', 'inventory_collection_manifest'])
  ) {
    throw new Error('Collection manifest has unknown or missing fields');
  }
  if (request.schema_version !== COLLECTION_SCHEMA_VERSION) {
    throw new Error(`Collection manifest schema_version must be ${COLLECTION_SCHEMA_VERSION}`);
  }
  if (request.evidence_only !== true) throw new Error('Collection manifest evidence_only must be true');
  if (request.cutover_authorized !== false) throw new Error('Collection manifest cutover_authorized must be false');
  validateWindow(request.release_window, asOf);
  validateSourceReference(request.inventory_collection_manifest, 'Git-pinned inventory collection manifest', { jsonOnly: true });

  const inventoryManifestSource = readSource(request.inventory_collection_manifest, 'Git-pinned inventory collection manifest', {
    jsonOnly: true,
  });
  const stagingRoot = fs.mkdtempSync(path.join(path.dirname(outputDirectory), '.hseos-inventory-recheck-'));
  fs.chmodSync(stagingRoot, 0o700);
  let collected;
  try {
    const { collectCompatibilityInventory } = require('./compatibility-evidence-inventory');
    collected = collectCompatibilityInventory({
      manifestPath: request.inventory_collection_manifest.source_path,
      projectDirectory,
      outputDirectory: path.join(stagingRoot, 'inventory'),
      asOf,
    });
    if (collected.collection_manifest_sha256 !== inventoryManifestSource.sha256) {
      throw new Error('Git-pinned inventory collection manifest changed while it was revalidated');
    }
    const requestedWindow = {
      activation_release: request.release_window.activation_release,
      compatibility_release: request.release_window.compatibility_release,
      opened_at: request.release_window.opened_at,
      closed_at: request.release_window.closed_at,
    };
    if (JSON.stringify(collected.release_window) !== JSON.stringify(requestedWindow)) {
      throw new Error('Git-pinned inventory release window does not match the packaging request');
    }
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }

  const collection = {
    release_window: request.release_window,
    consumer_registry: collected.consumer_registry,
    surfaces: collected.surfaces.map((surface) => ({
      surface_id: surface.surface_id,
      inventory: surface.inventory,
      attestations: surface.attestations,
    })),
  };

  try {
    const sourcePaths = new Set([collectionManifestPath, observationScope.path, request.inventory_collection_manifest.source_path]);
    const rememberSource = (sourcePath, label) => {
      if (sourcePaths.has(sourcePath)) throw new Error(`${label} reuses a source artifact`);
      sourcePaths.add(sourcePath);
    };
    const activationSource = readSource(collection.release_window.activation_artifact, 'Activation release artifact', { jsonOnly: true });
    rememberSource(collection.release_window.activation_artifact.source_path, 'Activation release artifact');
    const compatibilitySource = readSource(collection.release_window.compatibility_artifact, 'Compatibility release artifact', {
      jsonOnly: true,
    });
    rememberSource(collection.release_window.compatibility_artifact.source_path, 'Compatibility release artifact');
    if (activationSource.sha256 === compatibilitySource.sha256) {
      throw new Error('Activation and compatibility release artifacts must have distinct content');
    }
    validateReleaseArtifacts(activationSource.parsed, compatibilitySource.parsed, collection.release_window, observationScope);
    rememberSource(collection.consumer_registry.source_path, 'Consumer registry artifact');
    const consumerRegistrySource = readSource(collection.consumer_registry, 'Consumer registry artifact', { jsonOnly: true });

    const preparedSurfaces = collection.surfaces.map((surface) => {
      if (!hasExactKeys(surface, ['surface_id', 'inventory', 'attestations'])) {
        throw new Error(`Surface ${surface?.surface_id || '<unknown>'} collection has unknown or missing fields`);
      }
      validateSourceReference(surface.inventory, `Surface ${surface.surface_id} inventory`, { jsonOnly: true });
      rememberSource(surface.inventory.source_path, `Surface ${surface.surface_id} inventory`);
      const inventorySource = readSource(surface.inventory, `Surface ${surface.surface_id} inventory`, { jsonOnly: true });
      const inventory = validateInventory(inventorySource.parsed, surface.surface_id, collection.release_window);
      if (
        inventory.observation_release_sha !== observationScope.release_sha ||
        inventory.configuration_sha256 !== observationScope.configuration_sha256
      ) {
        throw new Error(`Surface ${surface.surface_id} inventory does not match the observation scope`);
      }
      if (!Array.isArray(surface.attestations)) throw new Error(`Surface ${surface.surface_id} attestations must be an array`);
      const attestationMap = new Map();
      for (const declaration of surface.attestations) {
        if (!hasExactKeys(declaration, ['consumer_id_sha256', 'source_path'])) {
          throw new Error(`Surface ${surface.surface_id} attestation declaration has unknown or missing fields`);
        }
        if (!/^[a-f0-9]{64}$/.test(declaration.consumer_id_sha256 || '')) {
          throw new Error(`Surface ${surface.surface_id} attestation consumer_id_sha256 is invalid`);
        }
        assertAbsolutePath(declaration.source_path, `Surface ${surface.surface_id} attestation source_path`);
        if (attestationMap.has(declaration.consumer_id_sha256))
          throw new Error(`Surface ${surface.surface_id} has a duplicate attestation declaration`);
        rememberSource(declaration.source_path, `Surface ${surface.surface_id} attestation`);
        attestationMap.set(declaration.consumer_id_sha256, declaration.source_path);
      }
      const migrated = inventory.consumers.filter((consumer) => consumer.disposition === 'migrated');
      if (attestationMap.size !== migrated.length) {
        throw new Error(`Surface ${surface.surface_id} attestation declarations must exactly match migrated consumers`);
      }
      const attestations = migrated.map((consumer) => {
        const sourcePath = attestationMap.get(consumer.consumer_id_sha256);
        if (!sourcePath) throw new Error(`Surface ${surface.surface_id} migrated consumer is missing an attestation`);
        const source = readSource(
          { source_path: sourcePath, media_type: 'application/json' },
          `Surface ${surface.surface_id} consumer attestation`,
          { jsonOnly: true },
        );
        if (source.sha256 !== consumer.attestation_sha256) {
          throw new Error(`Surface ${surface.surface_id} consumer attestation digest does not match the inventory`);
        }
        validateAttestation(source.parsed, consumer, surface.surface_id, collection.release_window);
        return Object.freeze({ consumer, source });
      });
      return Object.freeze({ surface_id: surface.surface_id, inventorySource, inventory, attestations });
    });
    const registryProvenance = preparedSurfaces[0].inventory.consumer_registry;
    if (preparedSurfaces.some((surface) => JSON.stringify(surface.inventory.consumer_registry) !== JSON.stringify(registryProvenance))) {
      throw new Error('Surface inventories do not share one pinned consumer registry');
    }
    validateConsumerRegistryArtifact(consumerRegistrySource.parsed, consumerRegistrySource, preparedSurfaces);

    fs.mkdirSync(outputDirectory, { mode: 0o700 });
    let published = false;
    try {
      const artifactDirectory = path.join(outputDirectory, 'artifacts');
      fs.mkdirSync(artifactDirectory, { mode: 0o700 });
      const activationArtifact = copyArtifact(
        outputDirectory,
        artifactFilename('release-activation', collection.release_window.activation_artifact.media_type),
        activationSource,
        collection.release_window.activation_artifact.media_type,
      );
      const compatibilityArtifact = copyArtifact(
        outputDirectory,
        artifactFilename('release-compatibility', collection.release_window.compatibility_artifact.media_type),
        compatibilitySource,
        collection.release_window.compatibility_artifact.media_type,
      );
      const consumerRegistryArtifact = copyArtifact(
        outputDirectory,
        artifactFilename('consumer-registry', collection.consumer_registry.media_type),
        consumerRegistrySource,
        collection.consumer_registry.media_type,
      );
      const inventoryCollectionManifestArtifact = copyArtifact(
        outputDirectory,
        artifactFilename('inventory-collection-manifest', request.inventory_collection_manifest.media_type),
        inventoryManifestSource,
        request.inventory_collection_manifest.media_type,
      );
      const surfaces = preparedSurfaces.map((surface) => {
        const inventoryArtifact = copyArtifact(
          outputDirectory,
          artifactFilename(`${surface.surface_id}-inventory`, 'application/json'),
          surface.inventorySource,
          'application/json',
        );
        const attestations = surface.attestations.map(({ consumer, source }) => ({
          consumer_id_sha256: consumer.consumer_id_sha256,
          artifact: copyArtifact(
            outputDirectory,
            artifactFilename(`${surface.surface_id}-consumer-${consumer.consumer_id_sha256}`, 'application/json'),
            source,
            'application/json',
          ),
          observed_at: consumer.observed_at,
        }));
        return {
          surface_id: surface.surface_id,
          legacy_consumers: surface.inventory.consumers.filter((consumer) => consumer.disposition === 'legacy').length,
          migrated_consumers: surface.attestations.length,
          inventory_artifact: inventoryArtifact,
          inventory_observed_at: surface.inventory.observed_at,
          attestations,
        };
      });
      const evidence = {
        schema_version: 1,
        evidence_only: true,
        cutover_authorized: false,
        release_sha: observationScope.release_sha,
        configuration_sha256: observationScope.configuration_sha256,
        inventory_collection_manifest_artifact: inventoryCollectionManifestArtifact,
        consumer_registry_artifact: consumerRegistryArtifact,
        release_window: {
          activation_release: collection.release_window.activation_release,
          compatibility_release: collection.release_window.compatibility_release,
          opened_at: collection.release_window.opened_at,
          closed_at: collection.release_window.closed_at,
          activation_artifact: activationArtifact,
          compatibility_artifact: compatibilityArtifact,
        },
        surfaces,
      };
      const evidencePath = path.join(outputDirectory, DOWNSTREAM_EVIDENCE_FILENAME);
      const temporaryEvidencePath = `${evidencePath}.tmp`;
      syncDirectory(artifactDirectory);
      writeExclusiveFile(temporaryEvidencePath, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
      fs.renameSync(temporaryEvidencePath, evidencePath);
      syncDirectory(outputDirectory);
      const verification = readDownstreamCompatibilityEvidence(evidencePath, { asOf, observationScope });
      if (verification.errors.some((error) => !error.includes('must have zero legacy consumers'))) {
        throw new Error(`Published evidence failed verification: ${verification.errors.join('; ')}`);
      }
      published = true;
      return Object.freeze({
        schema_version: 1,
        status: verification.ready ? 'available-for-human-verification' : 'incomplete-legacy-consumers',
        evidence_only: true,
        local_git_verified: true,
        remote_reachability_verified: false,
        human_verification_required: true,
        cutover_authorized: false,
        ready_for_human_verification: verification.ready,
        output_directory: outputDirectory,
        evidence_path: evidencePath,
        evidence_sha256: verification.sha256,
        artifact_count: verification.verified_artifacts.length,
        surfaces: surfaces.map((surface) => ({
          surface_id: surface.surface_id,
          legacy_consumers: surface.legacy_consumers,
          migrated_consumers: surface.migrated_consumers,
        })),
      });
    } finally {
      if (!published && fs.existsSync(outputDirectory)) fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

module.exports = {
  COLLECTION_SCHEMA_VERSION,
  MAX_CONSUMERS_PER_SURFACE,
  assertPrivateOutputParent,
  assertPackagingPlatform,
  packCompatibilityEvidence,
  validateObservationManifest,
};
