'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrations } = require('../mcp-project-state/lib/migrations');
const { assertStableReadOnlyDatabase, readMcpLegacyActivationReadiness } = require('../mcp-project-state/lib/mcp-legacy-usage-store');

const LEGACY_SERVER_IDS = Object.freeze(['axon_bridge', 'governance', 'project_state', 'swarm']);
const RETIREMENT_DEADLINE = '2026-11-30';
const ACTIVATION_DEADLINE = '2026-10-31';
const DOWNSTREAM_EVIDENCE_SCHEMA_VERSION = 1;
const DOWNSTREAM_EVIDENCE_FILENAME = 'harness-g9-downstream-evidence.json';
const OBSERVATION_MANIFEST_FILENAME = 'harness-g9-observation-release.json';
const MAX_DOWNSTREAM_EVIDENCE_BYTES = 1024 * 1024;
const MAX_DOWNSTREAM_ARTIFACT_BYTES = 8 * 1024 * 1024;
const REQUIRED_DOWNSTREAM_SURFACES = Object.freeze(['installer-v4-detection', 'plugin-catalog-v1']);
const RETIRED_INTERNAL_SYMBOLS = Object.freeze([
  'toColonName',
  'toColonPath',
  'customAgentColonName',
  'isColonFormat',
  'parseColonName',
  'toUnderscoreName',
  'toUnderscorePath',
  'customAgentUnderscoreName',
  'isUnderscoreFormat',
  'parseUnderscoreName',
  'writeColonArtifacts',
  'generateColonTaskToolCommands',
  'getCustomAgentColonName',
]);

function sha256File(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

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

function sameFileMetadata(left, right) {
  return ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].every((key) => left[key] === right[key]);
}

function readStableRegularFile(filename, label, maxBytes, { rejectSharedWrites = true } = {}) {
  const resolved = path.resolve(filename);
  if (fs.realpathSync(resolved) !== resolved) throw new Error(`${label} must not traverse a symlink`);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(descriptor);
    const linkedBefore = fs.lstatSync(resolved);
    if (!before.isFile() || linkedBefore.isSymbolicLink() || before.dev !== linkedBefore.dev || before.ino !== linkedBefore.ino) {
      throw new Error(`${label} must be a stable regular, non-symlink file`);
    }
    if (before.nlink !== 1) throw new Error(`${label} must not be hard-linked`);
    if (before.size > maxBytes) throw new Error(`${label} exceeds the fixed size limit`);
    if (rejectSharedWrites && process.platform !== 'win32' && (before.mode & 0o022) !== 0) {
      throw new Error(`${label} must not be writable by group or other users`);
    }
    const contents = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const linkedAfter = fs.lstatSync(resolved);
    if (
      !sameFileMetadata(before, after) ||
      linkedAfter.isSymbolicLink() ||
      after.dev !== linkedAfter.dev ||
      after.ino !== linkedAfter.ino ||
      fs.realpathSync(resolved) !== resolved
    ) {
      throw new Error(`${label} changed while it was being read`);
    }
    return Object.freeze({ contents, sha256: createHash('sha256').update(contents).digest('hex') });
  } finally {
    fs.closeSync(descriptor);
  }
}

function readCanonicalEvidenceFile(filename, label, maxBytes, options) {
  const { contents, sha256 } = readStableRegularFile(filename, label, maxBytes, options);
  const parsed = JSON.parse(contents.toString('utf8'));
  const canonical = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  if (!contents.equals(canonical)) throw new Error(`${label} must use canonical JSON encoding`);
  return Object.freeze({ parsed, sha256 });
}

function verifyDownstreamArtifact(reference, evidenceDirectory, label) {
  if (!hasExactKeys(reference, ['artifact_path', 'media_type', 'sha256'])) {
    throw new Error(`${label} reference has unknown or missing fields`);
  }
  if (
    typeof reference.artifact_path !== 'string' ||
    reference.artifact_path.length > 240 ||
    !/^artifacts\/[A-Za-z0-9._/-]+$/.test(reference.artifact_path) ||
    reference.artifact_path.includes('/../') ||
    reference.artifact_path.endsWith('/..') ||
    path.posix.normalize(reference.artifact_path) !== reference.artifact_path
  ) {
    throw new Error(`${label} artifact_path must be a normalized relative path under artifacts/`);
  }
  if (!['application/json', 'text/plain'].includes(reference.media_type)) throw new Error(`${label} media_type is unsupported`);
  if (!/^[a-f0-9]{64}$/.test(reference.sha256 || '')) throw new Error(`${label} sha256 is invalid`);
  const artifactPath = path.resolve(evidenceDirectory, ...reference.artifact_path.split('/'));
  const relative = path.relative(evidenceDirectory, artifactPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} artifact escapes the evidence bundle`);
  const artifact = readStableRegularFile(artifactPath, label, MAX_DOWNSTREAM_ARTIFACT_BYTES);
  if (artifact.sha256 !== reference.sha256) throw new Error(`${label} digest does not match the referenced artifact`);
  if (reference.media_type === 'application/json') JSON.parse(artifact.contents.toString('utf8'));
  return Object.freeze({ artifact_path: reference.artifact_path, media_type: reference.media_type, sha256: artifact.sha256 });
}

function readObservationScopeForAudit(manifestPath, operationalDatabase, telemetryDatabase) {
  if (!fs.existsSync(manifestPath)) return Object.freeze({ valid: false, path: manifestPath, errors: ['observation manifest is absent'] });
  try {
    const { parsed: manifest, sha256 } = readCanonicalEvidenceFile(manifestPath, 'Observation release manifest', 128 * 1024, {
      rejectSharedWrites: false,
    });
    const errors = [];
    if (manifest.schema_version !== 1) errors.push('schema_version must be 1');
    if (!/^[a-f0-9]{40}$/.test(manifest.release_sha || '')) errors.push('release_sha must be a full Git SHA');
    if (!/^[a-f0-9]{64}$/.test(manifest.configuration_sha256 || '')) errors.push('configuration_sha256 must be SHA-256');
    if (path.resolve(manifest.telemetry_database || '') !== telemetryDatabase)
      errors.push('telemetry_database does not match the audit path');
    if (path.resolve(manifest.state_database || '') !== operationalDatabase) errors.push('state_database does not match the audit path');
    if (manifest.cutover_authorized !== false) errors.push('cutover_authorized must be false');
    return Object.freeze({
      valid: errors.length === 0,
      path: manifestPath,
      sha256,
      errors,
      release_sha: manifest.release_sha,
      configuration_sha256: manifest.configuration_sha256,
    });
  } catch (error) {
    return Object.freeze({ valid: false, path: manifestPath, errors: [error.message] });
  }
}

function artifactAbsolutePath(evidenceDirectory, reference) {
  return path.resolve(evidenceDirectory, ...reference.artifact_path.split('/'));
}

function readBundledJsonArtifact(evidenceDirectory, reference, label) {
  const artifact = readStableRegularFile(artifactAbsolutePath(evidenceDirectory, reference), label, MAX_DOWNSTREAM_ARTIFACT_BYTES);
  if (artifact.sha256 !== reference.sha256) throw new Error(`${label} digest does not match the referenced artifact`);
  const parsed = JSON.parse(artifact.contents.toString('utf8'));
  const canonical = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  if (!artifact.contents.equals(canonical)) throw new Error(`${label} must use canonical JSON encoding`);
  return Object.freeze({ parsed, sha256: artifact.sha256 });
}

function validateBundledReleaseArtifacts(evidence, evidenceDirectory) {
  const { release_window: releaseWindow } = evidence;
  const activation = readBundledJsonArtifact(evidenceDirectory, releaseWindow.activation_artifact, 'activation release artifact');
  const compatibility = readBundledJsonArtifact(evidenceDirectory, releaseWindow.compatibility_artifact, 'compatibility release artifact');
  if (!hasExactKeys(activation.parsed, ['release_id', 'release_sha', 'published_at'])) {
    throw new Error('activation release artifact has unknown or missing fields');
  }
  if (!hasExactKeys(compatibility.parsed, ['release_id', 'release_sha', 'predecessor_sha', 'published_at'])) {
    throw new Error('compatibility release artifact has unknown or missing fields');
  }
  if (
    activation.parsed.release_id !== releaseWindow.activation_release ||
    compatibility.parsed.release_id !== releaseWindow.compatibility_release
  ) {
    throw new Error('release artifact identifiers do not match the evidence window');
  }
  if (activation.parsed.release_sha !== evidence.release_sha) {
    throw new Error('activation release artifact does not match the observation release');
  }
  if (
    !/^[a-f0-9]{40}$/.test(compatibility.parsed.release_sha || '') ||
    compatibility.parsed.release_sha === activation.parsed.release_sha
  ) {
    throw new Error('compatibility release artifact must identify a distinct full Git SHA');
  }
  if (compatibility.parsed.predecessor_sha !== activation.parsed.release_sha) {
    throw new Error('compatibility release artifact predecessor does not match activation');
  }
  for (const [label, publishedAt] of [
    ['activation', activation.parsed.published_at],
    ['compatibility', compatibility.parsed.published_at],
  ]) {
    if (!isCanonicalUtcInstant(publishedAt) || publishedAt < releaseWindow.opened_at || publishedAt > releaseWindow.closed_at) {
      throw new Error(`${label} release artifact published_at is outside the release window`);
    }
  }
  if (compatibility.parsed.published_at <= activation.parsed.published_at) {
    throw new Error('compatibility release artifact must follow activation');
  }
  if (activation.sha256 === compatibility.sha256) throw new Error('release artifacts must have distinct content');
}

function revalidatePinnedBundle(evidence, evidenceDirectory, projectDirectory, asOf) {
  if (typeof projectDirectory !== 'string' || !path.isAbsolute(projectDirectory)) {
    throw new Error('projectDirectory is required for Git-pinned downstream revalidation');
  }
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-downstream-revalidate-'));
  fs.chmodSync(stagingRoot, 0o700);
  try {
    const { collectCompatibilityInventory } = require('./compatibility-evidence-inventory');
    const inventoryManifestPath = artifactAbsolutePath(evidenceDirectory, evidence.inventory_collection_manifest_artifact);
    const collected = collectCompatibilityInventory({
      manifestPath: inventoryManifestPath,
      projectDirectory,
      outputDirectory: path.join(stagingRoot, 'inventory'),
      asOf,
    });
    if (collected.collection_manifest_sha256 !== evidence.inventory_collection_manifest_artifact.sha256) {
      throw new Error('re-collected inventory manifest digest differs from the bundle');
    }
    const expectedWindow = {
      activation_release: evidence.release_window.activation_release,
      compatibility_release: evidence.release_window.compatibility_release,
      opened_at: evidence.release_window.opened_at,
      closed_at: evidence.release_window.closed_at,
    };
    if (JSON.stringify(collected.release_window) !== JSON.stringify(expectedWindow)) {
      throw new Error('re-collected inventory release window differs from the bundle');
    }
    if (sha256File(collected.consumer_registry.source_path) !== evidence.consumer_registry_artifact.sha256) {
      throw new Error('re-collected consumer registry differs from the bundle');
    }
    for (const surface of evidence.surfaces) {
      const recollected = collected.surfaces.find((candidate) => candidate.surface_id === surface.surface_id);
      if (!recollected || sha256File(recollected.inventory.source_path) !== surface.inventory_artifact.sha256) {
        throw new Error(`re-collected ${surface.surface_id} inventory differs from the bundle`);
      }
      const inventory = JSON.parse(fs.readFileSync(recollected.inventory.source_path, 'utf8'));
      const legacyConsumers = inventory.consumers.filter((consumer) => consumer.disposition === 'legacy').length;
      const migratedConsumers = inventory.consumers.filter((consumer) => consumer.disposition === 'migrated').length;
      if (
        surface.legacy_consumers !== legacyConsumers ||
        surface.migrated_consumers !== migratedConsumers ||
        surface.inventory_observed_at !== inventory.observed_at
      ) {
        throw new Error(`re-collected ${surface.surface_id} summary differs from the bundle`);
      }
      const expectedAttestations = new Map(
        surface.attestations.map((item) => [item.consumer_id_sha256, { sha256: item.artifact.sha256, observed_at: item.observed_at }]),
      );
      const observedAttestations = new Map(
        recollected.attestations.map((item) => {
          const attestation = JSON.parse(fs.readFileSync(item.source_path, 'utf8'));
          return [item.consumer_id_sha256, { sha256: sha256File(item.source_path), observed_at: attestation.observed_at }];
        }),
      );
      if (JSON.stringify([...expectedAttestations.entries()].sort()) !== JSON.stringify([...observedAttestations.entries()].sort())) {
        throw new Error(`re-collected ${surface.surface_id} attestations differ from the bundle`);
      }
    }
    return true;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function readDownstreamCompatibilityEvidence(
  evidencePath,
  { asOf = new Date(), observationScope, revalidateGit = false, projectDirectory } = {},
) {
  if (!fs.existsSync(evidencePath)) {
    return Object.freeze({
      ready: false,
      evidence_only: true,
      human_verification_required: true,
      cutover_authorized: false,
      path: evidencePath,
      errors: ['downstream compatibility evidence is absent'],
    });
  }
  try {
    const { parsed: evidence, sha256 } = readCanonicalEvidenceFile(
      evidencePath,
      'Downstream compatibility evidence',
      MAX_DOWNSTREAM_EVIDENCE_BYTES,
    );
    const errors = [];
    const verifiedArtifacts = [];
    const evidenceDirectory = path.dirname(path.resolve(evidencePath));
    if (
      !hasExactKeys(evidence, [
        'schema_version',
        'evidence_only',
        'cutover_authorized',
        'release_sha',
        'configuration_sha256',
        'inventory_collection_manifest_artifact',
        'consumer_registry_artifact',
        'release_window',
        'surfaces',
      ])
    ) {
      errors.push('downstream evidence envelope has unknown or missing fields');
    }
    if (evidence.schema_version !== DOWNSTREAM_EVIDENCE_SCHEMA_VERSION) errors.push('schema_version must be 1');
    if (evidence.evidence_only !== true) errors.push('evidence_only must be true');
    if (evidence.cutover_authorized !== false) errors.push('cutover_authorized must be false');
    if (!/^[a-f0-9]{40}$/.test(evidence.release_sha || '')) errors.push('release_sha must be a full Git SHA');
    if (!/^[a-f0-9]{64}$/.test(evidence.configuration_sha256 || '')) errors.push('configuration_sha256 must be SHA-256');
    if (!observationScope?.valid) errors.push('observation scope is absent or invalid');
    if (observationScope?.valid && evidence.release_sha !== observationScope.release_sha)
      errors.push('release_sha differs from observation scope');
    if (observationScope?.valid && evidence.configuration_sha256 !== observationScope.configuration_sha256) {
      errors.push('configuration_sha256 differs from observation scope');
    }
    try {
      verifiedArtifacts.push(
        verifyDownstreamArtifact(evidence.inventory_collection_manifest_artifact, evidenceDirectory, 'inventory collection manifest'),
        verifyDownstreamArtifact(evidence.consumer_registry_artifact, evidenceDirectory, 'consumer registry'),
      );
    } catch (error) {
      errors.push(error.message);
    }

    const releaseWindow = evidence.release_window;
    if (
      hasExactKeys(releaseWindow, [
        'activation_release',
        'compatibility_release',
        'opened_at',
        'closed_at',
        'activation_artifact',
        'compatibility_artifact',
      ])
    ) {
      for (const key of ['activation_release', 'compatibility_release']) {
        if (typeof releaseWindow[key] !== 'string' || !/^[A-Za-z0-9._/@+-]{1,128}$/.test(releaseWindow[key])) {
          errors.push(`${key} is invalid`);
        }
      }
      if (releaseWindow.activation_release === releaseWindow.compatibility_release) {
        errors.push('compatibility_release must differ from activation_release');
      }
      if (!isCanonicalUtcInstant(releaseWindow.opened_at) || !isCanonicalUtcInstant(releaseWindow.closed_at)) {
        errors.push('release window timestamps must be canonical UTC instants');
      } else {
        if (releaseWindow.opened_at >= releaseWindow.closed_at) errors.push('release window must advance');
        if (releaseWindow.closed_at > new Date(asOf).toISOString()) errors.push('release window cannot close after the audit instant');
      }
      for (const [key, label] of [
        ['activation_artifact', 'activation release'],
        ['compatibility_artifact', 'compatibility release'],
      ]) {
        try {
          verifiedArtifacts.push(verifyDownstreamArtifact(releaseWindow[key], evidenceDirectory, label));
        } catch (error) {
          errors.push(error.message);
        }
      }
      try {
        validateBundledReleaseArtifacts(evidence, evidenceDirectory);
      } catch (error) {
        errors.push(error.message);
      }
    } else {
      errors.push('release_window has unknown or missing fields');
    }

    const surfaces = Array.isArray(evidence.surfaces) ? evidence.surfaces : [];
    const declaredSurfaceIds = surfaces.map((surface) => surface?.surface_id).sort();
    if (JSON.stringify(declaredSurfaceIds) !== JSON.stringify([...REQUIRED_DOWNSTREAM_SURFACES])) {
      errors.push('surfaces must contain the exact required downstream compatibility set');
    }
    for (const surface of surfaces) {
      if (
        !hasExactKeys(surface, [
          'surface_id',
          'legacy_consumers',
          'migrated_consumers',
          'inventory_artifact',
          'inventory_observed_at',
          'attestations',
        ])
      ) {
        errors.push(`surface ${surface?.surface_id || '<unknown>'} has unknown or missing fields`);
        continue;
      }
      if (!Number.isSafeInteger(surface.legacy_consumers) || surface.legacy_consumers !== 0) {
        errors.push(`surface ${surface.surface_id} must have zero legacy consumers`);
      }
      if (!Number.isSafeInteger(surface.migrated_consumers) || surface.migrated_consumers < 0) {
        errors.push(`surface ${surface.surface_id} migrated_consumers must be a non-negative safe integer`);
      }
      try {
        verifiedArtifacts.push(
          verifyDownstreamArtifact(surface.inventory_artifact, evidenceDirectory, `surface ${surface.surface_id} inventory`),
        );
      } catch (error) {
        errors.push(error.message);
      }
      if (!isCanonicalUtcInstant(surface.inventory_observed_at)) {
        errors.push(`surface ${surface.surface_id} inventory_observed_at is invalid`);
      } else if (
        isCanonicalUtcInstant(releaseWindow?.opened_at) &&
        isCanonicalUtcInstant(releaseWindow?.closed_at) &&
        (surface.inventory_observed_at < releaseWindow.opened_at || surface.inventory_observed_at > releaseWindow.closed_at)
      ) {
        errors.push(`surface ${surface.surface_id} inventory is outside the release window`);
      }
      if (!Array.isArray(surface.attestations) || surface.attestations.length !== surface.migrated_consumers) {
        errors.push(`surface ${surface.surface_id} attestation count must equal migrated_consumers`);
        continue;
      }
      const consumerIds = new Set();
      for (const attestation of surface.attestations) {
        if (!hasExactKeys(attestation, ['consumer_id_sha256', 'artifact', 'observed_at'])) {
          errors.push(`surface ${surface.surface_id} attestation has unknown or missing fields`);
          continue;
        }
        if (!/^[a-f0-9]{64}$/.test(attestation.consumer_id_sha256 || '')) {
          errors.push(`surface ${surface.surface_id} consumer_id_sha256 is invalid`);
        }
        try {
          verifiedArtifacts.push(
            verifyDownstreamArtifact(attestation.artifact, evidenceDirectory, `surface ${surface.surface_id} consumer attestation`),
          );
        } catch (error) {
          errors.push(error.message);
        }
        if (consumerIds.has(attestation.consumer_id_sha256)) errors.push(`surface ${surface.surface_id} has a duplicate consumer`);
        consumerIds.add(attestation.consumer_id_sha256);
        if (!isCanonicalUtcInstant(attestation.observed_at)) {
          errors.push(`surface ${surface.surface_id} observed_at is invalid`);
        } else if (
          isCanonicalUtcInstant(releaseWindow?.opened_at) &&
          isCanonicalUtcInstant(releaseWindow?.closed_at) &&
          (attestation.observed_at < releaseWindow.opened_at || attestation.observed_at > releaseWindow.closed_at)
        ) {
          errors.push(`surface ${surface.surface_id} attestation is outside the release window`);
        }
      }
    }
    let localGitRevalidated = false;
    if (revalidateGit) {
      try {
        localGitRevalidated = revalidatePinnedBundle(evidence, evidenceDirectory, projectDirectory, asOf);
      } catch (error) {
        errors.push(`Git-pinned bundle revalidation failed: ${error.message}`);
      }
    }
    return Object.freeze({
      ready: errors.length === 0,
      evidence_only: true,
      human_verification_required: true,
      cutover_authorized: false,
      local_git_revalidated: localGitRevalidated,
      remote_reachability_verified: false,
      path: evidencePath,
      sha256,
      errors,
      release_sha: evidence.release_sha,
      configuration_sha256: evidence.configuration_sha256,
      release_window: releaseWindow,
      surfaces,
      verified_artifacts: verifiedArtifacts,
    });
  } catch (error) {
    return Object.freeze({
      ready: false,
      evidence_only: true,
      human_verification_required: true,
      cutover_authorized: false,
      path: evidencePath,
      errors: [error.message],
    });
  }
}

function databaseFingerprint(databasePath) {
  return Object.fromEntries(
    [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]
      .filter((filename) => fs.existsSync(filename))
      .map((filename) => [path.basename(filename), { bytes: fs.statSync(filename).size, sha256: sha256File(filename) }]),
  );
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeSqlValue(value) {
  if (Buffer.isBuffer(value)) return { $blob: value.toString('base64') };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  return value;
}

function tableDigest(db, tableName) {
  const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`).all();
  const normalized = rows
    .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)]))))
    .sort();
  const schema = db
    .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name = ? OR tbl_name = ? ORDER BY type, name')
    .all(tableName, tableName);
  return {
    rows: rows.length,
    data_sha256: createHash('sha256').update(normalized.join('\n')).digest('hex'),
    schema_sha256: createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
  };
}

function snapshotTables(db) {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(({ name }) => name);
  return Object.fromEntries(names.map((name) => [name, tableDigest(db, name)]));
}

async function migrationDryRun(databasePath, repositoryRoot) {
  assertStableReadOnlyDatabase(databasePath);
  const sourceFingerprintBefore = databaseFingerprint(databasePath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-dry-run-'));
  fs.chmodSync(directory, 0o700);
  const fixturePath = path.join(directory, 'project.db');
  let fixture;
  let result;
  try {
    fs.copyFileSync(databasePath, fixturePath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(fixturePath, 0o600);
    fixture = new Database(fixturePath);
    fixture.pragma('foreign_keys = ON');
    const sourceVersion = fixture.pragma('user_version', { simple: true });
    const before = snapshotTables(fixture);
    const migrationResult = runMigrations(
      fixture,
      path.join(repositoryRoot, 'tools', 'mcp-project-state', 'migrations-pending-activation'),
      { log: () => {} },
    );
    const integrity = fixture.pragma('integrity_check').map((row) => row.integrity_check);
    const after = snapshotTables(fixture);
    const changedLegacyTables = Object.entries(before)
      .filter(([name, digest]) => JSON.stringify(after[name]) !== JSON.stringify(digest))
      .map(([name]) => name);
    const targetVersion = fixture.pragma('user_version', { simple: true });
    result = {
      ready:
        sourceVersion === 4 && targetVersion === 9 && integrity.length === 1 && integrity[0] === 'ok' && changedLegacyTables.length === 0,
      source_version: sourceVersion,
      target_version: targetVersion,
      applied: migrationResult.applied,
      integrity,
      preserved_legacy_tables: Object.keys(before).length,
      changed_legacy_tables: changedLegacyTables,
    };
  } finally {
    if (fixture?.open) fixture.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
  const sourceFingerprintAfter = databaseFingerprint(databasePath);
  const operationalUnchanged = JSON.stringify(sourceFingerprintBefore) === JSON.stringify(sourceFingerprintAfter);
  return Object.freeze({
    ...result,
    ready: result.ready && operationalUnchanged,
    operational_files_before: sourceFingerprintBefore,
    operational_files_after: sourceFingerprintAfter,
    operational_unchanged: operationalUnchanged,
  });
}

function listRuntimeFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listRuntimeFiles(entryPath));
    else if (entry.isFile() && /\.(?:c?js|mjs|ps1|sh)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function lineMatches(root, filename, pattern) {
  const relative = path.relative(root, filename).replaceAll(path.sep, '/');
  return fs
    .readFileSync(filename, 'utf8')
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(({ text }) => pattern.test(text))
    .map(({ line }) => `${relative}:${line}`);
}

function scanInternalCompatibilityCallers(repositoryRoot) {
  const files = ['tools', 'src']
    .flatMap((runtimeRoot) => listRuntimeFiles(path.join(repositoryRoot, runtimeRoot)))
    .filter((filename) => filename !== __filename);
  const retiredSymbolPattern = new RegExp(`\\b(?:${RETIRED_INTERNAL_SYMBOLS.join('|')})\\b`);
  const retiredSymbolCallers = files.flatMap((filename) => lineMatches(repositoryRoot, filename, retiredSymbolPattern));
  const legacyMcpCallers = files
    .filter((filename) => !filename.endsWith(path.join('tools', 'lib', 'legacy-mcp-server.js')))
    .flatMap((filename) => lineMatches(repositoryRoot, filename, /\bstartLegacyMcpServer\b/));
  const legacyStatePattern =
    /(?:['"](?:state_write|tasks_add|tasks_update)['"]|\bcmd_(?:state_write|tasks_add)\b|\b(?:INSERT INTO|UPDATE) (?:state|tasks)\b)/;
  const legacyStateWrites = files.flatMap((filename) => lineMatches(repositoryRoot, filename, legacyStatePattern));
  return Object.freeze({
    retired_internal_symbols: retiredSymbolCallers,
    retired_internal_symbols_zero: retiredSymbolCallers.length === 0,
    active_legacy_mcp_entrypoints: legacyMcpCallers,
    active_legacy_state_writes: legacyStateWrites,
    legacy_runtime_zero: legacyMcpCallers.length === 0 && legacyStateWrites.length === 0,
  });
}

function summarizeTelemetry(readiness) {
  return Object.freeze({
    ready: readiness.ready,
    days: readiness.days,
    gap_count: readiness.gaps.length,
    gaps_sample: readiness.gaps.slice(0, 20),
    integrity_errors: readiness.integrity_errors,
    legacy_use: readiness.legacy_use,
  });
}

async function auditCompatibility({ repositoryRoot, projectDirectory = repositoryRoot, downstreamEvidencePath, asOf = new Date() }) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedProject = path.resolve(projectDirectory);
  const stateDirectory = path.join(resolvedProject, '.hseos', 'state');
  const operationalDatabase = path.join(stateDirectory, 'project.db');
  const telemetryDatabase = path.join(stateDirectory, 'mcp-legacy-usage.db');
  const observationManifest = path.join(stateDirectory, OBSERVATION_MANIFEST_FILENAME);
  const resolvedDownstreamEvidence = path.resolve(downstreamEvidencePath || path.join(stateDirectory, DOWNSTREAM_EVIDENCE_FILENAME));
  const callers = scanInternalCompatibilityCallers(resolvedRoot);
  const observationScope = readObservationScopeForAudit(observationManifest, operationalDatabase, telemetryDatabase);
  const downstream = readDownstreamCompatibilityEvidence(resolvedDownstreamEvidence, {
    asOf,
    observationScope,
    revalidateGit: true,
    projectDirectory: resolvedProject,
  });

  let telemetry;
  if (fs.existsSync(telemetryDatabase)) {
    const filesBefore = databaseFingerprint(telemetryDatabase);
    try {
      const readiness = summarizeTelemetry(
        readMcpLegacyActivationReadiness(telemetryDatabase, { serverIds: LEGACY_SERVER_IDS, asOf, days: 30 }),
      );
      const filesAfter = databaseFingerprint(telemetryDatabase);
      const unchanged = JSON.stringify(filesBefore) === JSON.stringify(filesAfter);
      telemetry = { ...readiness, ready: readiness.ready && unchanged, files_before: filesBefore, files_after: filesAfter, unchanged };
    } catch (error) {
      telemetry = {
        ready: false,
        error: error.message,
        files_before: filesBefore,
        files_after: databaseFingerprint(telemetryDatabase),
      };
    }
  } else {
    telemetry = { ready: false, error: 'legacy telemetry database is absent' };
  }

  let migration;
  if (fs.existsSync(operationalDatabase)) {
    try {
      migration = await migrationDryRun(operationalDatabase, resolvedRoot);
    } catch (error) {
      migration = { ready: false, error: error.message };
    }
  } else {
    migration = { ready: false, error: 'operational project database is absent' };
  }

  const evidenceReady =
    telemetry.ready &&
    migration.ready &&
    migration.operational_unchanged &&
    callers.retired_internal_symbols_zero &&
    callers.legacy_runtime_zero &&
    downstream.ready;
  return Object.freeze({
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    as_of: new Date(asOf).toISOString(),
    decision_authority: ['ADR-0022', 'ADR-0023'],
    deadlines: { activation_no_later_than: ACTIVATION_DEADLINE, compatibility_removal_by: RETIREMENT_DEADLINE },
    status: evidenceReady ? 'awaiting-human-authorization' : 'blocked-on-evidence',
    activation_authorized: false,
    ready_for_human_gate: evidenceReady,
    operational_paths: {
      project_database: operationalDatabase,
      telemetry_database: telemetryDatabase,
      observation_manifest: observationManifest,
      downstream_compatibility: resolvedDownstreamEvidence,
    },
    evidence: { telemetry, migration, callers, observation_scope: observationScope, downstream },
    retained_compatibility: [
      { id: 'mcp-2024-11-05', owner: 'platform-governance', reason: 'production entrypoints and zero-use evidence remain active' },
      { id: 'state-schema-v4', owner: 'platform-governance', reason: 'operational migration requires evidence and explicit authorization' },
      {
        id: 'plugin-catalog-v1',
        owner: 'platform-governance',
        reason: downstream.ready
          ? 'integrity-checked downstream evidence awaits human verification and explicit cutover'
          : 'downstream evidence is incomplete',
      },
      {
        id: 'installer-v4-detection',
        owner: 'platform-governance',
        reason: downstream.ready
          ? 'integrity-checked downstream evidence awaits human verification and explicit cutover'
          : 'downstream evidence is incomplete',
      },
    ],
    retired_compatibility: [{ id: 'ide-underscore-command-naming', owner: 'platform-governance' }],
  });
}

module.exports = {
  ACTIVATION_DEADLINE,
  DOWNSTREAM_EVIDENCE_FILENAME,
  DOWNSTREAM_EVIDENCE_SCHEMA_VERSION,
  LEGACY_SERVER_IDS,
  OBSERVATION_MANIFEST_FILENAME,
  RETIRED_INTERNAL_SYMBOLS,
  RETIREMENT_DEADLINE,
  REQUIRED_DOWNSTREAM_SURFACES,
  auditCompatibility,
  databaseFingerprint,
  migrationDryRun,
  readCanonicalEvidenceFile,
  readDownstreamCompatibilityEvidence,
  readStableRegularFile,
  scanInternalCompatibilityCallers,
  snapshotTables,
};
