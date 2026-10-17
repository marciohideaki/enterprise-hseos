'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const SANDBOX_DIRECTORY = '/artifacts';
const TMPFS_MAGIC = 0x01_02_19_94;
const MANIFEST_MAX_BYTES = 65_536;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const HARD = Object.freeze({ max_files: 32, max_file_bytes: 16_777_216, max_total_bytes: 67_108_864 });

// Signature checks per media type. Text types are validated by decoding instead of by prefix.
const MAGIC = Object.freeze({
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
  'image/webp': (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
  'application/json': (b) => {
    try {
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b));
      return true;
    } catch {
      return false;
    }
  },
  'text/plain': (b) => {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(b);
      return !b.includes(0);
    } catch {
      return false;
    }
  },
});

class ArtifactChannelError extends Error {
  constructor(message, code = 'ARTIFACT_CHANNEL_REJECTED') {
    super(message);
    this.name = 'ArtifactChannelError';
    this.code = code;
  }
}

function reject(message, code) {
  throw new ArtifactChannelError(message, code);
}

const errorCode = (error) => (typeof error?.code === 'string' ? error.code : 'UNKNOWN');

function resolveLimits(value = {}) {
  const limits = { ...HARD, ...value };
  for (const [key, ceiling] of Object.entries(HARD)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > ceiling) {
      reject(`${key} must be within 1-${ceiling}`, 'ARTIFACT_CHANNEL_LIMIT_INVALID');
    }
  }
  if (limits.max_file_bytes > limits.max_total_bytes) reject('max_file_bytes exceeds max_total_bytes', 'ARTIFACT_CHANNEL_LIMIT_INVALID');
  const unknown = Object.keys(limits).filter((key) => !Object.hasOwn(HARD, key));
  if (unknown.length > 0) reject('artifact limit is not recognised', 'ARTIFACT_CHANNEL_LIMIT_INVALID');
  return Object.freeze(limits);
}

function resolveMediaTypes(types) {
  if (!Array.isArray(types) || types.length === 0 || types.length > 16) {
    reject('media types must be a non-empty list', 'ARTIFACT_CHANNEL_LIMIT_INVALID');
  }
  for (const type of types) if (!Object.hasOwn(MAGIC, type)) reject('media type is not allowed', 'ARTIFACT_CHANNEL_LIMIT_INVALID');
  return Object.freeze([...new Set(types)]);
}

/**
 * Check a plugin manifest against the files really present. Pure over a directory: nothing is
 * trusted from the manifest except the claim to be checked, and nothing is promoted on mismatch.
 */
function verifyArtifacts(directory, manifestText, options) {
  try {
    return verifyArtifactFiles(directory, manifestText, options);
  } catch (error) {
    if (error instanceof ArtifactChannelError) throw error;
    // The plugin owns this directory while it runs: unreadable entries are its doing, not an I/O fault.
    reject('artifact directory could not be read', 'ARTIFACT_MANIFEST_DIVERGED');
  }
}

function verifyArtifactFiles(directory, manifestText, { limits, media_types }) {
  if (typeof manifestText !== 'string' || Buffer.byteLength(manifestText) > MANIFEST_MAX_BYTES) {
    reject('artifact manifest exceeds its ceiling', 'ARTIFACT_MANIFEST_INVALID');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    reject('artifact manifest is not JSON', 'ARTIFACT_MANIFEST_INVALID');
  }
  if (!Array.isArray(manifest) || manifest.length > limits.max_files)
    reject('artifact manifest is not a bounded list', 'ARTIFACT_MANIFEST_INVALID');
  const claims = new Map();
  for (const entry of manifest) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) reject('artifact entry is malformed', 'ARTIFACT_MANIFEST_INVALID');
    const keys = Object.keys(entry).sort();
    if (keys.join(',') !== 'bytes,media_type,path,sha256') reject('artifact entry has non-canonical fields', 'ARTIFACT_MANIFEST_INVALID');
    if (typeof entry.path !== 'string' || !entry.path.startsWith(`${SANDBOX_DIRECTORY}/`)) {
      reject('artifact path is outside /artifacts', 'ARTIFACT_PATH_REJECTED');
    }
    const name = entry.path.slice(SANDBOX_DIRECTORY.length + 1);
    if (!NAME.test(name) || name.includes('..')) reject('artifact name is not a flat safe name', 'ARTIFACT_PATH_REJECTED');
    if (claims.has(name)) reject('artifact path is duplicated', 'ARTIFACT_MANIFEST_INVALID');
    if (!media_types.includes(entry.media_type)) reject('artifact media type is not allowed', 'ARTIFACT_MEDIA_REJECTED');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > limits.max_file_bytes) {
      reject('artifact size claim exceeds its ceiling', 'ARTIFACT_SIZE_REJECTED');
    }
    if (typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256))
      reject('artifact digest claim is malformed', 'ARTIFACT_MANIFEST_INVALID');
    claims.set(name, entry);
  }
  // The directory must hold exactly what the manifest declares: no extras, no links, no subtrees.
  const present = fs.readdirSync(directory, { withFileTypes: true });
  if (present.length !== claims.size || present.some((item) => !claims.has(item.name))) {
    reject('artifact directory diverges from the manifest', 'ARTIFACT_MANIFEST_DIVERGED');
  }
  let total = 0;
  const verified = [];
  for (const [name, claim] of claims) {
    const filename = path.join(directory, name);
    const link = fs.lstatSync(filename);
    if (link.isSymbolicLink() || !link.isFile() || link.nlink !== 1)
      reject('artifact is not a single-link regular file', 'ARTIFACT_LINK_REJECTED');
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== link.dev || stat.ino !== link.ino) {
        reject('artifact changed during verification', 'ARTIFACT_LINK_REJECTED');
      }
      if (stat.size !== claim.bytes) reject('artifact size diverges from the manifest', 'ARTIFACT_SIZE_REJECTED');
      total += stat.size;
      if (total > limits.max_total_bytes) reject('artifact total exceeds its quota', 'ARTIFACT_SIZE_REJECTED');
      // Read one byte past the claim so a file that grew after fstat is still caught.
      const buffer = Buffer.alloc(claim.bytes + 1);
      let size = 0;
      while (size < buffer.length) {
        const count = fs.readSync(fd, buffer, size, buffer.length - size, size);
        if (count === 0) break;
        size += count;
      }
      if (size !== claim.bytes) reject('artifact size diverges from the manifest', 'ARTIFACT_SIZE_REJECTED');
      const content = buffer.subarray(0, size);
      if (createHash('sha256').update(content).digest('hex') !== claim.sha256)
        reject('artifact digest diverges from the manifest', 'ARTIFACT_DIGEST_REJECTED');
      if (!MAGIC[claim.media_type](content)) reject('artifact signature does not match its media type', 'ARTIFACT_MEDIA_REJECTED');
      verified.push({ name, path: claim.path, media_type: claim.media_type, bytes: size, sha256: claim.sha256, content });
    } finally {
      fs.closeSync(fd);
    }
  }
  // Buffers cannot be frozen; the list and each record are.
  return Object.freeze(verified.map((item) => Object.freeze(item)));
}

// Time, not node count, bounds the repair: the plugin can create as many entries as tmpfs and the
// cgroup allow, and every one of them still has to be reachable for the removal to finish.
const REPAIR_BUDGET_MS = 120_000;

/** The plugin shares our uid, so it can leave unreadable directories behind. Reopen them, never following links. */
function makeRemovable(root) {
  const deadline = Date.now() + REPAIR_BUDGET_MS;
  const pending = [root];
  while (pending.length > 0) {
    if (Date.now() > deadline) return false;
    const current = pending.pop();
    try {
      fs.chmodSync(current, 0o700);
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        // Dirent reports the link itself, so symbolic links are never entered.
        if (entry.isDirectory()) pending.push(path.join(current, entry.name));
      }
    } catch {
      // The removal below reports what could not be repaired.
    }
  }
  return true;
}

/**
 * Per-execution writable directory for the plugin, verified by the controller afterwards.
 * It lives on tmpfs so its pages are charged to the execution cgroup: the cgroup memory limit,
 * not the plugin, bounds what can be written while the plugin runs.
 */
function createArtifactChannel({ limits, media_types, parent = '/dev/shm' } = {}) {
  const effective = resolveLimits(limits);
  const types = resolveMediaTypes(media_types);
  let real;
  try {
    real = fs.realpathSync(parent);
    if (fs.statfsSync(real).type !== TMPFS_MAGIC) throw new Error('not tmpfs');
  } catch {
    reject('artifact channel needs a tmpfs parent', 'ARTIFACT_CHANNEL_UNAVAILABLE');
  }
  const directory = fs.mkdtempSync(path.join(real, 'hseos-artifacts-'));
  fs.chmodSync(directory, 0o700);
  let disposed = false;
  return Object.freeze({
    directory,
    sandbox_path: SANDBOX_DIRECTORY,
    limits: effective,
    media_types: types,
    max_file_bytes: effective.max_file_bytes,
    verify(manifestText) {
      if (disposed) reject('artifact channel is disposed', 'ARTIFACT_CHANNEL_DISPOSED');
      return verifyArtifacts(directory, manifestText, { limits: effective, media_types: types });
    },
    /** Never throws: the caller records the outcome next to the execution result. */
    dispose() {
      disposed = true;
      try {
        const complete = makeRemovable(directory);
        try {
          // Even after the budget is spent the removal is still attempted once.
          fs.rmSync(directory, { recursive: true, force: true });
        } catch (error) {
          return Object.freeze({ disposed: false, code: complete ? errorCode(error) : 'REPAIR_BUDGET_EXHAUSTED' });
        }
        return Object.freeze({ disposed: true });
      } catch (error) {
        return Object.freeze({ disposed: false, code: errorCode(error) });
      }
    },
  });
}

module.exports = { REPAIR_BUDGET_MS, ArtifactChannelError, HARD, MAGIC, SANDBOX_DIRECTORY, createArtifactChannel, verifyArtifacts };
