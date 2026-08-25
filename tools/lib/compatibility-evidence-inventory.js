'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

const { validatePluginRegistryDocument } = require('../cli/installers/lib/core/agent-core-compiler/sources/plugins-source');
const { REQUIRED_DOWNSTREAM_SURFACES, readCanonicalEvidenceFile } = require('./compatibility-audit');
const { assertPackagingPlatform, assertPrivateOutputParent, validateObservationManifest } = require('./compatibility-evidence-pack');

const INVENTORY_COLLECTION_SCHEMA_VERSION = 1;
const INVENTORY_INDEX_FILENAME = 'downstream-inventory-index.json';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_CONSUMERS = 10_000;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const CONSUMER_REGISTRY_PATH = '.hseos/compatibility/downstream-consumers.json';
const SURFACE_EVIDENCE_PATHS = Object.freeze({
  'installer-v4-detection': '.hseos',
  'plugin-catalog-v1': '.agents/plugins/registry.yaml',
});

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isCanonicalUtcInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function assertRelativeGitPath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').includes('..') ||
    value.includes('\\') ||
    Buffer.byteLength(value) > 1024
  ) {
    throw new TypeError(`${label} must be a normalized relative Git path`);
  }
}

function normalizeRemote(value) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || /[\r\n\0]/.test(value)) {
    throw new TypeError('Repository remote must be a non-empty single-line string');
  }
  const scp = value.match(/^([^@/:\s]+)@([^:/\s]+):(.+)$/);
  if (scp) return `ssh://${scp[1]}@${scp[2].toLowerCase()}/${scp[3].replaceAll(/^\/+|\/+$/g, '').replace(/\.git$/, '')}`;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('Repository remote must be an explicit network URL, not a local path');
  }
  if (!['https:', 'ssh:', 'git:'].includes(parsed.protocol)) throw new TypeError('Repository remote protocol is unsupported');
  if (parsed.password || (parsed.protocol === 'https:' && parsed.username)) {
    throw new Error('Repository remote must not contain embedded credentials');
  }
  const pathname = parsed.pathname.replaceAll(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!parsed.hostname || !pathname) throw new TypeError('Repository remote must identify a host and repository path');
  const username = parsed.protocol === 'ssh:' && parsed.username ? `${parsed.username}@` : '';
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${username}${parsed.hostname.toLowerCase()}${port}/${pathname}`;
}

function runGit(repositoryPath, args, { allowMissing = false } = {}) {
  const result = childProcess.spawnSync('git', ['-C', repositoryPath, ...args], {
    encoding: null,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_NO_LAZY_FETCH: '1',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowMissing) return null;
    const stderr = Buffer.from(result.stderr || '')
      .toString('utf8')
      .trim();
    throw new Error(`Git evidence read failed${stderr ? `: ${stderr}` : ''}`);
  }
  return Buffer.from(result.stdout || '');
}

function gitText(repositoryPath, args, options) {
  const output = runGit(repositoryPath, args, options);
  return output === null ? null : output.toString('utf8').trim();
}

function gitObjectType(repositoryPath, commitSha, evidencePath) {
  return gitText(repositoryPath, ['cat-file', '-t', `${commitSha}:${evidencePath}`], { allowMissing: true });
}

function realDirectoryIdentity(directory, label) {
  const metadata = fs.lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || fs.realpathSync(directory) !== directory) {
    throw new Error(`${label} must be a real, non-symlink directory`);
  }
  return Object.freeze({ dev: metadata.dev, ino: metadata.ino });
}

function assertSameIdentity(before, after, label) {
  if (before.dev !== after.dev || before.ino !== after.ino) throw new Error(`${label} changed while evidence was collected`);
}

function gitEvidence(repositoryPath, commitSha, evidencePath, classification) {
  const kind = gitObjectType(repositoryPath, commitSha, evidencePath);
  if (!['blob', 'tree'].includes(kind)) throw new Error(`Git evidence path is missing or unsupported: ${evidencePath}`);
  const objectSha = gitText(repositoryPath, ['rev-parse', `${commitSha}:${evidencePath}`]);
  const contents =
    kind === 'blob'
      ? runGit(repositoryPath, ['cat-file', 'blob', `${commitSha}:${evidencePath}`])
      : runGit(repositoryPath, ['ls-tree', '-r', '-z', commitSha, '--', evidencePath]);
  return Object.freeze({
    kind: `git-${kind}`,
    path: evidencePath,
    object_sha: objectSha,
    content_sha256: sha256(contents),
    classification,
  });
}

function classifyPluginRegistry(repositoryPath, commitSha, evidencePath) {
  if (gitObjectType(repositoryPath, commitSha, evidencePath) !== 'blob') {
    throw new Error(`Plugin registry must be a Git blob: ${evidencePath}`);
  }
  const contents = runGit(repositoryPath, ['cat-file', 'blob', `${commitSha}:${evidencePath}`]);
  if (contents.includes(0)) throw new Error('Plugin registry must be UTF-8 text');
  const text = contents.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(contents)) throw new Error('Plugin registry must be valid UTF-8');
  const registry = yaml.parse(text);
  validatePluginRegistryDocument(registry);
  return String(registry.schema_version ?? 'legacy') === '2.0' ? 'migrated' : 'legacy';
}

function classifyInstallerLayout(repositoryPath, commitSha, evidencePath) {
  if (gitObjectType(repositoryPath, commitSha, evidencePath) !== 'tree') {
    throw new Error(`Installer evidence root must be a Git tree: ${evidencePath}`);
  }
  const legacy = gitObjectType(repositoryPath, commitSha, `${evidencePath}/_cfg`) !== null;
  const modern = gitObjectType(repositoryPath, commitSha, `${evidencePath}/_config`) !== null;
  return legacy || !modern ? 'legacy' : 'migrated';
}

function validateWindow(window, asOf) {
  if (!hasExactKeys(window, ['activation_release', 'compatibility_release', 'opened_at', 'closed_at'])) {
    throw new Error('Inventory release_window has unknown or missing fields');
  }
  for (const key of ['activation_release', 'compatibility_release']) {
    if (typeof window[key] !== 'string' || !/^[A-Za-z0-9._/@+-]{1,128}$/.test(window[key])) throw new Error(`${key} is invalid`);
  }
  if (window.activation_release === window.compatibility_release) throw new Error('Compatibility release must differ from activation');
  if (!isCanonicalUtcInstant(window.opened_at) || !isCanonicalUtcInstant(window.closed_at) || window.opened_at >= window.closed_at) {
    throw new Error('Inventory release window is invalid');
  }
  if (window.closed_at > asOf.toISOString()) throw new Error('Inventory release window cannot close in the future');
}

function validateManifest(manifest, asOf) {
  if (
    !hasExactKeys(manifest, [
      'schema_version',
      'evidence_only',
      'cutover_authorized',
      'observed_at',
      'release_window',
      'registry',
      'repository_bindings',
    ])
  ) {
    throw new Error('Inventory collection manifest has unknown or missing fields');
  }
  if (manifest.schema_version !== INVENTORY_COLLECTION_SCHEMA_VERSION) throw new Error('Inventory collection schema_version must be 1');
  if (manifest.evidence_only !== true || manifest.cutover_authorized !== false) {
    throw new Error('Inventory collection must remain evidence-only and cannot authorize cutover');
  }
  if (!isCanonicalUtcInstant(manifest.observed_at) || manifest.observed_at > asOf.toISOString()) {
    throw new Error('Inventory observed_at is invalid or in the future');
  }
  validateWindow(manifest.release_window, asOf);
  if (manifest.observed_at < manifest.release_window.opened_at || manifest.observed_at > manifest.release_window.closed_at) {
    throw new Error('Inventory observed_at must be inside the release window');
  }
  if (!hasExactKeys(manifest.registry, ['repository_path', 'remote_name', 'expected_remote', 'commit_sha', 'evidence_path'])) {
    throw new Error('Inventory registry has unknown or missing fields');
  }
  if (!Array.isArray(manifest.repository_bindings) || manifest.repository_bindings.length > MAX_CONSUMERS) {
    throw new Error('Inventory repository_bindings must be a bounded array');
  }
}

function validateRepositoryReference(reference, label, { commitRequired = true } = {}) {
  if (
    typeof reference.repository_path !== 'string' ||
    !path.isAbsolute(reference.repository_path) ||
    path.resolve(reference.repository_path) !== reference.repository_path
  ) {
    throw new TypeError(`${label} repository_path must be a normalized absolute path`);
  }
  if (typeof reference.remote_name !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(reference.remote_name)) {
    throw new Error(`${label} remote_name is invalid`);
  }
  if (commitRequired && !/^[a-f0-9]{40}$/.test(reference.commit_sha || '')) {
    throw new Error(`${label} commit_sha must be a full lowercase Git SHA`);
  }
  return normalizeRemote(reference.expected_remote);
}

function inspectRepository(reference, label, { commitSha = reference.commit_sha } = {}) {
  const expectedRemote = validateRepositoryReference(reference, label, { commitRequired: commitSha !== undefined });
  const worktreeIdentity = realDirectoryIdentity(reference.repository_path, `${label} worktree`);
  if (gitText(reference.repository_path, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    throw new Error(`${label} repository_path is not a Git worktree`);
  }
  const gitDirectory = gitText(reference.repository_path, ['rev-parse', '--absolute-git-dir']);
  if (!path.isAbsolute(gitDirectory) || path.resolve(gitDirectory) !== gitDirectory) {
    throw new Error(`${label} Git directory must be a normalized absolute path`);
  }
  const gitDirectoryIdentity = realDirectoryIdentity(gitDirectory, `${label} Git directory`);
  const actualRemote = normalizeRemote(gitText(reference.repository_path, ['remote', 'get-url', reference.remote_name]));
  if (actualRemote !== expectedRemote) throw new Error(`${label} repository remote does not match expected_remote`);
  if (commitSha !== undefined && gitText(reference.repository_path, ['cat-file', '-t', commitSha]) !== 'commit') {
    throw new Error(`${label} commit_sha does not identify a commit object`);
  }
  const treeSha = commitSha === undefined ? undefined : gitText(reference.repository_path, ['show', '-s', '--format=%T', commitSha]);
  if (treeSha !== undefined && !/^[a-f0-9]{40}$/.test(treeSha)) throw new Error(`${label} commit tree is invalid`);
  return Object.freeze({
    expectedRemote,
    remoteSha256: sha256(expectedRemote),
    worktreeIdentity,
    gitDirectory,
    gitDirectoryIdentity,
    treeSha,
    commitSha,
  });
}

function assertRepositoryStable(reference, before) {
  assertSameIdentity(
    before.worktreeIdentity,
    realDirectoryIdentity(reference.repository_path, 'Repository worktree'),
    'Repository worktree',
  );
  const gitDirectory = gitText(reference.repository_path, ['rev-parse', '--absolute-git-dir']);
  if (gitDirectory !== before.gitDirectory) throw new Error('Repository Git directory changed while evidence was collected');
  assertSameIdentity(
    before.gitDirectoryIdentity,
    realDirectoryIdentity(gitDirectory, 'Repository Git directory'),
    'Repository Git directory',
  );
  const remote = normalizeRemote(gitText(reference.repository_path, ['remote', 'get-url', reference.remote_name]));
  if (remote !== before.expectedRemote) throw new Error('Repository remote changed while evidence was collected');
  if (before.commitSha !== undefined) {
    const treeSha = gitText(reference.repository_path, ['show', '-s', '--format=%T', before.commitSha]);
    if (treeSha !== before.treeSha) throw new Error('Repository commit tree changed while evidence was collected');
  }
}

function readPinnedConsumerRegistry(reference) {
  if (reference.evidence_path !== CONSUMER_REGISTRY_PATH) {
    throw new Error(`Inventory registry evidence_path must be ${CONSUMER_REGISTRY_PATH}`);
  }
  const inspected = inspectRepository(reference, 'Inventory registry');
  if (gitObjectType(reference.repository_path, reference.commit_sha, reference.evidence_path) !== 'blob') {
    throw new Error('Inventory registry evidence_path must identify a Git blob');
  }
  const contents = runGit(reference.repository_path, ['cat-file', 'blob', `${reference.commit_sha}:${reference.evidence_path}`]);
  let registry;
  try {
    registry = JSON.parse(contents.toString('utf8'));
  } catch {
    throw new Error('Pinned consumer registry must be valid JSON');
  }
  const canonical = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`);
  if (!contents.equals(canonical)) throw new Error('Pinned consumer registry must use canonical JSON encoding');
  if (!hasExactKeys(registry, ['schema_version', 'scope', 'completeness_status', 'consumers'])) {
    throw new Error('Pinned consumer registry has unknown or missing fields');
  }
  if (registry.schema_version !== 1 || registry.scope !== 'hseos-downstream-compatibility') {
    throw new Error('Pinned consumer registry schema or scope is invalid');
  }
  if (registry.completeness_status !== 'complete') {
    throw new Error('Pinned consumer registry completeness_status must be complete before collection');
  }
  if (!Array.isArray(registry.consumers) || registry.consumers.length > MAX_CONSUMERS) {
    throw new Error('Pinned consumer registry consumers must be a bounded array');
  }
  const evidence = gitEvidence(reference.repository_path, reference.commit_sha, reference.evidence_path, 'registry');
  const registryEvidence = Object.freeze({
    kind: evidence.kind,
    path: evidence.path,
    object_sha: evidence.object_sha,
    content_sha256: evidence.content_sha256,
  });
  assertRepositoryStable(reference, inspected);
  return Object.freeze({
    registry,
    contents,
    provenance: Object.freeze({
      repository_remote_sha256: inspected.remoteSha256,
      commit_sha: reference.commit_sha,
      tree_sha: inspected.treeSha,
      evidence: registryEvidence,
    }),
  });
}

function writeExclusiveJson(filename, value) {
  writeExclusiveBuffer(filename, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function writeExclusiveBuffer(filename, contents) {
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

function collectCompatibilityInventory({ manifestPath, projectDirectory, outputDirectory, asOf = new Date() }) {
  assertPackagingPlatform();
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) throw new TypeError('asOf must be a valid Date');
  if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath) || path.resolve(manifestPath) !== manifestPath) {
    throw new TypeError('Inventory manifest path must be a normalized absolute path');
  }
  const observation = validateObservationManifest(projectDirectory);
  assertPrivateOutputParent(outputDirectory, observation.state_directory, [observation.release_path]);
  const { parsed: manifest, sha256: collectionManifestSha256 } = readCanonicalEvidenceFile(
    manifestPath,
    'Downstream inventory collection manifest',
    MAX_MANIFEST_BYTES,
  );
  validateManifest(manifest, asOf);
  if (
    outputDirectory === manifest.registry.repository_path ||
    outputDirectory.startsWith(`${manifest.registry.repository_path}${path.sep}`)
  ) {
    throw new Error('Output directory must be outside the pinned consumer registry repository');
  }
  const pinnedRegistry = readPinnedConsumerRegistry(manifest.registry);
  if (manifest.registry.commit_sha !== observation.release_sha) {
    throw new Error('Pinned consumer registry commit must equal the canonical observation release SHA');
  }

  const bindings = new Map();
  for (const binding of manifest.repository_bindings) {
    if (!hasExactKeys(binding, ['repository_path', 'remote_name', 'expected_remote'])) {
      throw new Error('Inventory repository binding has unknown or missing fields');
    }
    const normalizedRemote = validateRepositoryReference(binding, 'Consumer binding', { commitRequired: false });
    if (bindings.has(normalizedRemote)) throw new Error('Inventory repository binding has a duplicate remote');
    bindings.set(normalizedRemote, binding);
  }
  const registryRemotes = pinnedRegistry.registry.consumers.map((consumer) => normalizeRemote(consumer?.repository_remote));
  if (new Set(registryRemotes).size !== registryRemotes.length) throw new Error('Pinned consumer registry has duplicate remotes');
  if (JSON.stringify([...bindings.keys()].sort()) !== JSON.stringify([...registryRemotes].sort())) {
    throw new Error('Inventory repository bindings must exactly match the pinned consumer registry');
  }

  const repositoryPaths = new Set();
  const consumersBySurface = new Map(REQUIRED_DOWNSTREAM_SURFACES.map((surfaceId) => [surfaceId, []]));
  const attestationsBySurface = new Map(REQUIRED_DOWNSTREAM_SURFACES.map((surfaceId) => [surfaceId, []]));
  const consumerIds = new Set();

  for (const declaredConsumer of pinnedRegistry.registry.consumers) {
    if (!hasExactKeys(declaredConsumer, ['repository_remote', 'commit_sha', 'surfaces'])) {
      throw new Error('Pinned consumer registry entry has unknown or missing fields');
    }
    const normalizedRemote = normalizeRemote(declaredConsumer.repository_remote);
    const binding = bindings.get(normalizedRemote);
    const consumer = { ...binding, commit_sha: declaredConsumer.commit_sha, surfaces: declaredConsumer.surfaces };
    if (
      typeof consumer.repository_path !== 'string' ||
      !path.isAbsolute(consumer.repository_path) ||
      path.resolve(consumer.repository_path) !== consumer.repository_path
    ) {
      throw new TypeError('Consumer repository_path must be a normalized absolute path');
    }
    if (repositoryPaths.has(consumer.repository_path)) throw new Error('Consumer repository is declared more than once');
    repositoryPaths.add(consumer.repository_path);
    if (outputDirectory === consumer.repository_path || outputDirectory.startsWith(`${consumer.repository_path}${path.sep}`)) {
      throw new Error('Output directory must be outside consumer repositories');
    }
    if (!/^[a-f0-9]{40}$/.test(consumer.commit_sha || '')) throw new Error('Consumer commit_sha must be a full lowercase Git SHA');
    if (!Array.isArray(consumer.surfaces) || consumer.surfaces.length === 0) throw new Error('Consumer surfaces must be non-empty');
    const declaredSurfaceIds = consumer.surfaces.map((surface) => surface?.surface_id);
    if (new Set(declaredSurfaceIds).size !== declaredSurfaceIds.length) throw new Error('Consumer has duplicate surface declarations');
    if (declaredSurfaceIds.some((surfaceId) => !REQUIRED_DOWNSTREAM_SURFACES.includes(surfaceId))) {
      throw new Error('Consumer declares an unsupported compatibility surface');
    }

    const inspected = inspectRepository(consumer, 'Consumer repository');
    if (inspected.expectedRemote !== normalizedRemote) {
      throw new Error('Consumer binding remote does not match the pinned registry');
    }
    const repositoryRemoteSha256 = inspected.remoteSha256;
    if (consumerIds.has(repositoryRemoteSha256)) throw new Error('Consumer identity is duplicated across repository paths');
    consumerIds.add(repositoryRemoteSha256);
    const treeSha = inspected.treeSha;

    for (const surface of consumer.surfaces) {
      if (!hasExactKeys(surface, ['surface_id', 'evidence_path'])) throw new Error('Consumer surface has unknown or missing fields');
      assertRelativeGitPath(surface.evidence_path, `Surface ${surface.surface_id} evidence_path`);
      if (surface.evidence_path !== SURFACE_EVIDENCE_PATHS[surface.surface_id]) {
        throw new Error(`Surface ${surface.surface_id} evidence_path must be ${SURFACE_EVIDENCE_PATHS[surface.surface_id]}`);
      }
      const disposition =
        surface.surface_id === 'plugin-catalog-v1'
          ? classifyPluginRegistry(consumer.repository_path, consumer.commit_sha, surface.evidence_path)
          : classifyInstallerLayout(consumer.repository_path, consumer.commit_sha, surface.evidence_path);
      const evidence = gitEvidence(consumer.repository_path, consumer.commit_sha, surface.evidence_path, disposition);
      const base = {
        consumer_id_sha256: repositoryRemoteSha256,
        disposition,
        repository_remote_sha256: repositoryRemoteSha256,
        commit_sha: consumer.commit_sha,
        tree_sha: treeSha,
        evidence,
      };
      if (disposition === 'migrated') {
        const attestation = {
          schema_version: 2,
          surface_id: surface.surface_id,
          consumer_id_sha256: repositoryRemoteSha256,
          observed_at: manifest.observed_at,
          migration_verified: true,
          activation_release: manifest.release_window.activation_release,
          compatibility_release: manifest.release_window.compatibility_release,
          repository_remote_sha256: repositoryRemoteSha256,
          commit_sha: consumer.commit_sha,
          tree_sha: treeSha,
          evidence,
        };
        const contents = Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`);
        consumersBySurface.get(surface.surface_id).push({
          ...base,
          observed_at: manifest.observed_at,
          attestation_sha256: sha256(contents),
        });
        attestationsBySurface.get(surface.surface_id).push({ consumer_id_sha256: repositoryRemoteSha256, attestation, contents });
      } else {
        consumersBySurface.get(surface.surface_id).push(base);
      }
    }
    assertRepositoryStable(consumer, inspected);
  }

  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  let published = false;
  try {
    const artifactsDirectory = path.join(outputDirectory, 'artifacts');
    fs.mkdirSync(artifactsDirectory, { mode: 0o700 });
    const consumerRegistryPath = path.join(artifactsDirectory, 'downstream-consumers.json');
    writeExclusiveBuffer(consumerRegistryPath, pinnedRegistry.contents);
    const consumerRegistry = { source_path: consumerRegistryPath, media_type: 'application/json' };
    const surfaces = [];
    for (const surfaceId of REQUIRED_DOWNSTREAM_SURFACES) {
      const consumers = consumersBySurface
        .get(surfaceId)
        .sort((left, right) => left.consumer_id_sha256.localeCompare(right.consumer_id_sha256));
      const inventory = {
        schema_version: 2,
        surface_id: surfaceId,
        observed_at: manifest.observed_at,
        collection_method: 'git-pinned-v1',
        observation_release_sha: observation.release_sha,
        configuration_sha256: observation.configuration_sha256,
        consumer_registry: pinnedRegistry.provenance,
        consumers,
      };
      const inventoryPath = path.join(artifactsDirectory, `${surfaceId}-inventory.json`);
      writeExclusiveJson(inventoryPath, inventory);
      const attestations = [];
      for (const item of attestationsBySurface
        .get(surfaceId)
        .sort((left, right) => left.consumer_id_sha256.localeCompare(right.consumer_id_sha256))) {
        const attestationPath = path.join(artifactsDirectory, `${surfaceId}-consumer-${item.consumer_id_sha256}.json`);
        writeExclusiveBuffer(attestationPath, item.contents);
        attestations.push({ consumer_id_sha256: item.consumer_id_sha256, source_path: attestationPath });
      }
      surfaces.push({
        surface_id: surfaceId,
        inventory: { source_path: inventoryPath, media_type: 'application/json' },
        attestations,
        legacy_consumers: consumers.filter((consumer) => consumer.disposition === 'legacy').length,
        migrated_consumers: consumers.filter((consumer) => consumer.disposition === 'migrated').length,
      });
    }
    syncDirectory(artifactsDirectory);
    const index = {
      schema_version: 1,
      status: 'inventory-collected',
      evidence_only: true,
      cutover_authorized: false,
      final_evidence_ready: false,
      release_artifacts_required: true,
      local_git_verified: true,
      remote_reachability_verified: false,
      observation_release_sha: observation.release_sha,
      configuration_sha256: observation.configuration_sha256,
      collection_manifest_sha256: collectionManifestSha256,
      observed_at: manifest.observed_at,
      release_window: manifest.release_window,
      consumer_registry: consumerRegistry,
      surfaces,
    };
    const indexPath = path.join(outputDirectory, INVENTORY_INDEX_FILENAME);
    writeExclusiveJson(indexPath, index);
    syncDirectory(outputDirectory);
    published = true;
    return Object.freeze({ ...index, output_directory: outputDirectory, index_path: indexPath });
  } finally {
    if (!published && fs.existsSync(outputDirectory)) fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  INVENTORY_COLLECTION_SCHEMA_VERSION,
  INVENTORY_INDEX_FILENAME,
  CONSUMER_REGISTRY_PATH,
  SURFACE_EVIDENCE_PATHS,
  collectCompatibilityInventory,
  normalizeRemote,
};
