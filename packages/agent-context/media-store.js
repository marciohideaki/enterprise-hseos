'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const { MAX_MEDIA_ASSEMBLY_BYTES, MAX_MEDIA_ITEMS, MAX_MEDIA_ITEM_BYTES, deepFreeze } = require('../agent-runtime-contracts');

const DIRECTORY = 'context-media';
const DIGEST = /^[0-9a-f]{64}$/u;
const SIGNATURES = deepFreeze({
  'image/png': (buffer) =>
    buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (buffer) => buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/webp': (buffer) =>
    buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP',
});

class ContextMediaError extends Error {
  constructor(message, code = 'AGENT_CONTEXT_MEDIA_INVALID', details = {}) {
    super(message);
    this.name = 'ContextMediaError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function mismatch(message, details) {
  return new ContextMediaError(message, 'AGENT_CONTEXT_MEDIA_DIGEST_MISMATCH', details);
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// First start-of-frame segment (SOF0-SOF15 except DHT, JPG and DAC) carries precision, height and width.
function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (offset + 9 > buffer.length) return null;
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

// The first RIFF chunk decides the format: VP8 (lossy), VP8L (lossless) or VP8X (extended canvas).
function readWebpDimensions(buffer) {
  if (buffer.length < 20) return null;
  const kind = buffer.subarray(12, 16).toString('latin1');
  const data = 20;
  if (kind === 'VP8 ') {
    if (buffer.length < data + 10 || buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a) return null;
    return { width: buffer.readUInt16LE(data + 6) & 0x3f_ff, height: buffer.readUInt16LE(data + 8) & 0x3f_ff };
  }
  if (kind === 'VP8L') {
    if (buffer.length < data + 5 || buffer[data] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(data + 1);
    return { width: (bits & 0x3f_ff) + 1, height: ((bits >>> 14) & 0x3f_ff) + 1 };
  }
  if (kind === 'VP8X') {
    if (buffer.length < data + 10) return null;
    return { width: buffer.readUIntLE(data + 4, 3) + 1, height: buffer.readUIntLE(data + 7, 3) + 1 };
  }
  return null;
}

const DIMENSION_READERS = deepFreeze({
  'image/png': readPngDimensions,
  'image/jpeg': readJpegDimensions,
  'image/webp': readWebpDimensions,
});

function readDimensions(mediaType, buffer) {
  return DIMENSION_READERS[mediaType](buffer);
}

/** Item, count and total byte ceilings. The content never reaches an event; only these descriptors do. */
function assertMediaWithinLimits(media) {
  if (media.length > MAX_MEDIA_ITEMS) {
    throw new ContextMediaError('too many media items', 'AGENT_CONTEXT_MEDIA_TOO_LARGE', { items: media.length, limit: MAX_MEDIA_ITEMS });
  }
  let total = 0;
  for (const item of media) {
    if (item.bytes > MAX_MEDIA_ITEM_BYTES) {
      throw new ContextMediaError('media item exceeds the byte limit', 'AGENT_CONTEXT_MEDIA_TOO_LARGE', {
        source_ref: item.source_ref,
        bytes: item.bytes,
        limit: MAX_MEDIA_ITEM_BYTES,
      });
    }
    total += item.bytes;
  }
  if (total > MAX_MEDIA_ASSEMBLY_BYTES) {
    throw new ContextMediaError('media exceeds the total assembly byte limit', 'AGENT_CONTEXT_MEDIA_TOO_LARGE', {
      bytes: total,
      limit: MAX_MEDIA_ASSEMBLY_BYTES,
    });
  }
}

/** Recomputes size, SHA-256 and magic signature against the declared descriptor; any divergence is explicit. */
function verifyMediaBytes(buffer, descriptor) {
  if (!Buffer.isBuffer(buffer)) throw new ContextMediaError('media content must be a Buffer');
  if (buffer.length > MAX_MEDIA_ITEM_BYTES) {
    throw new ContextMediaError('media item exceeds the byte limit', 'AGENT_CONTEXT_MEDIA_TOO_LARGE', { bytes: buffer.length });
  }
  const signature = SIGNATURES[descriptor.media_type];
  if (!signature)
    throw new ContextMediaError('unsupported media type', 'AGENT_CONTEXT_MEDIA_INVALID', { media_type: descriptor.media_type });
  if (buffer.length !== descriptor.bytes)
    throw mismatch('media byte length differs from the declaration', { source_ref: descriptor.source_ref });
  if (sha256(buffer) !== descriptor.digest)
    throw mismatch('media digest differs from the declaration', { source_ref: descriptor.source_ref });
  if (!signature(buffer)) throw mismatch('media signature does not match its media type', { source_ref: descriptor.source_ref });
  // The declared size drives the token cost, so it must be the real one; a format whose size cannot be read is refused.
  const actual = readDimensions(descriptor.media_type, buffer);
  if (!actual) {
    throw new ContextMediaError('media dimensions cannot be read', 'AGENT_CONTEXT_MEDIA_INVALID', { source_ref: descriptor.source_ref });
  }
  if (actual.width !== descriptor.width || actual.height !== descriptor.height) {
    throw mismatch('media dimensions differ from the declaration', { source_ref: descriptor.source_ref });
  }
  return buffer;
}

class ContextMediaStore {
  #directory;

  constructor({ root }) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new ContextMediaError('media store root must be an absolute path');
    this.#directory = path.join(root, DIRECTORY);
    Object.freeze(this);
  }

  #target(digest) {
    if (!DIGEST.test(digest)) throw new ContextMediaError('media digest must be a SHA-256 hex string');
    return path.join(this.#directory, digest);
  }

  /** Stores the bytes content-addressed. Returns the descriptor fields that identify the artifact. */
  put(buffer, { media_type, width, height, source_ref }) {
    if (!Buffer.isBuffer(buffer)) throw new ContextMediaError('media content must be a Buffer');
    const digest = sha256(buffer);
    const descriptor = { source_ref, media_type, digest, bytes: buffer.length, width, height };
    verifyMediaBytes(buffer, descriptor);
    const target = this.#target(digest);
    fs.mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    let existing = null;
    try {
      existing = fs.lstatSync(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing) {
      try {
        this.load(descriptor);
        return deepFreeze({ digest, bytes: buffer.length, artifact_ref: `artifact://sha256/${digest}` });
      } catch (error) {
        if (!(error instanceof ContextMediaError)) throw error;
        // a damaged artifact occupies the content address: replace it atomically below
      }
    }
    const temporary = path.join(this.#directory, `.tmp-${randomUUID()}`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      let offset = 0;
      while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(temporary, target);
    } catch (error) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    return deepFreeze({ digest, bytes: buffer.length, artifact_ref: `artifact://sha256/${digest}` });
  }

  /** Reads the artifact without following links and re-verifies it against the descriptor before it is used. */
  load(descriptor) {
    const target = this.#target(descriptor.digest);
    let fd;
    try {
      fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ContextMediaError('media artifact is unavailable', 'AGENT_CONTEXT_MEDIA_UNAVAILABLE', {
          source_ref: descriptor.source_ref,
        });
      }
      throw mismatch('media artifact cannot be opened safely', { source_ref: descriptor.source_ref });
    }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== descriptor.bytes || stat.size > MAX_MEDIA_ITEM_BYTES) {
        throw mismatch('media artifact is not the declared regular file', { source_ref: descriptor.source_ref });
      }
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const read = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (read === 0) break;
        offset += read;
      }
      if (offset !== buffer.length) throw mismatch('media artifact is truncated', { source_ref: descriptor.source_ref });
      return verifyMediaBytes(buffer, descriptor);
    } finally {
      fs.closeSync(fd);
    }
  }
}

module.exports = { ContextMediaError, ContextMediaStore, assertMediaWithinLimits, verifyMediaBytes };
