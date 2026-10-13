'use strict';

// Offline toolchain pins for the environment capabilities. Pins are data: name, version, SHA-256 of the
// artifact and the licence text expected inside it. Nothing is downloaded and no binary ever enters a tarball.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const MANIFEST_SCHEMA = 'hseos.toolchain-cache.v1';
const CACHE_ENV = 'HSEOS_TOOLCHAIN_CACHE';
const APACHE_MARKERS = ['Apache License', 'Version 2.0, January 2004'];
const MIT_MARKERS = ['Permission is hereby granted, free of charge'];

const PINS = Object.freeze({
  'typescript-language-server': Object.freeze({
    version: '6.0.2',
    artifact: 'npm/typescript-language-server-6.0.2.tgz',
    sha256: 'd225b223a8a4764ecbd94bdba85d2ef185eaa7b9842a1a31c38c2bbe7f2fe9b9',
    license: 'Apache-2.0',
    license_file: 'package/LICENSE',
    license_markers: Object.freeze([...APACHE_MARKERS, ...MIT_MARKERS]),
  }),
  typescript: Object.freeze({
    version: '5.9.3',
    artifact: 'npm/typescript-5.9.3.tgz',
    sha256: '10e108c9cf7d5f2879053dff18515fb405abf2ccef63eaaf017d9c571687a1d3',
    license: 'Apache-2.0',
    license_file: 'package/LICENSE.txt',
    license_markers: Object.freeze(APACHE_MARKERS),
  }),
  pyright: Object.freeze({
    version: '1.1.414',
    artifact: 'npm/pyright-1.1.414.tgz',
    sha256: 'bf5f473f6167c0d14175492c3263d783b4489a6956e1c06c18e15228e3a3fa42',
    license: 'MIT',
    license_file: 'package/LICENSE.txt',
    license_markers: Object.freeze(MIT_MARKERS),
  }),
  // The wheel is a zip: it is read from the same verified bytes by the in-process reader below.
  debugpy: Object.freeze({
    version: '1.8.22',
    artifact: 'pypi/debugpy-1.8.22-py2.py3-none-any.whl',
    sha256: 'a9e9d3550e15ca479c59333e90845029190531f0cacfedab3b815a57bd913947',
    license: 'MIT',
    format: 'zip',
    license_file: 'debugpy-1.8.22.dist-info/licenses/LICENSE',
    license_markers: Object.freeze(MIT_MARKERS),
  }),
  'js-debug': Object.freeze({
    version: '1.140.0',
    artifact: 'github/js-debug-dap-v1.140.0.tar.gz',
    sha256: '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968',
    license: 'MIT',
    root: 'js-debug/',
    license_file: 'js-debug/LICENSE',
    license_markers: Object.freeze(MIT_MARKERS),
  }),
});

const MAX_ZIP_ENTRY_BYTES = 67_108_864;
const MAX_ZIP_TOTAL_BYTES = 268_435_456;
const MAX_ZIP_ENTRIES = 4096;
const UNIX_TYPE_MASK = 0o17_0000;
const UNIX_REGULAR = 0o10_0000;
const UNIX_DIRECTORY = 0o04_0000;

class ToolchainBlockedError extends Error {
  constructor(message, code = 'ENV_TOOLCHAIN_BLOCKED') {
    super(message);
    this.name = 'ToolchainBlockedError';
    this.code = code;
  }
}

function blocked(message, code) {
  throw new ToolchainBlockedError(message, code);
}

/** The cache location is configuration, never a compiled-in path. */
function resolveCacheDirectory(cacheDirectory) {
  const value = cacheDirectory ?? process.env[CACHE_ENV];
  if (typeof value !== 'string' || !path.isAbsolute(value)) blocked('toolchain cache is not configured', 'ENV_TOOLCHAIN_CACHE_UNSET');
  return value;
}

function readManifest(cacheDirectory) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(cacheDirectory, 'toolchain-manifest.json'), 'utf8'));
  } catch {
    blocked('toolchain manifest is missing or unreadable', 'ENV_TOOLCHAIN_MANIFEST_MISSING');
  }
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || !Array.isArray(manifest.pins) || manifest.runtime_download !== false) {
    blocked('toolchain manifest does not match the cache schema', 'ENV_TOOLCHAIN_MANIFEST_INVALID');
  }
  return manifest;
}

function artifactPath(cacheDirectory, artifact) {
  const resolved = path.resolve(cacheDirectory, artifact);
  if (!resolved.startsWith(`${path.resolve(cacheDirectory)}${path.sep}`))
    blocked('artifact path leaves the cache', 'ENV_TOOLCHAIN_ARTIFACT_PATH');
  return resolved;
}

// The artifact bytes are read once, hashed, and handed to tar on stdin: what is verified is what is extracted.
function tar(args, input) {
  return execFileSync('tar', args, { env: { PATH: '/usr/bin:/bin' }, input, maxBuffer: 16_777_216, stdio: ['pipe', 'pipe', 'ignore'] });
}

// CRC-32 (IEEE) computed here: zlib.crc32 only exists from Node 22.2 and the supported range starts at 22.0.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let value = 0xff_ff_ff_ff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}

/** List the central directory of a zip held in memory. Anything unusual is refused, never skipped. */
function listZip(bytes) {
  const unsafe = () => blocked('artifact is not a safe zip', 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE');
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]), bytes.length - 22);
  if (end === -1 || bytes.length - end < 22) unsafe();
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (count > MAX_ZIP_ENTRIES || offset + size > end || bytes.readUInt16LE(end + 4) !== 0) unsafe();
  const entries = [];
  let total = 0;
  let cursor = offset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02_01_4b_50) unsafe();
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const platform = bytes.readUInt8(cursor + 5);
    const attributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
    const mode = platform === 3 ? (attributes >>> 16) & UNIX_TYPE_MASK : 0;
    const directory = name.endsWith('/');
    total += uncompressed;
    // Encrypted entries, exotic methods, links, special files and oversize entries are never extracted.
    if (flags & 0x1 || ![0, 8].includes(method) || uncompressed > MAX_ZIP_ENTRY_BYTES || total > MAX_ZIP_TOTAL_BYTES) unsafe();
    if (mode !== 0 && mode !== (directory ? UNIX_DIRECTORY : UNIX_REGULAR)) unsafe();
    if (name.length === 0 || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) unsafe();
    entries.push({ name, directory, method, crc, compressed, uncompressed, localOffset });
  }
  assertCoherentNames(entries, unsafe);
  return entries;
}

/**
 * The names must describe a tree: written in normal form (no `.` or empty segments), no duplicates, no file that is also
 * a directory. Names that differ only by case are refused as well, whatever this filesystem does with them: a toolchain
 * must unpack the same everywhere, and a case collision would silently overwrite on a case-insensitive one.
 */
function assertCoherentNames(entries, unsafe) {
  const seen = new Set();
  const files = new Set();
  for (const { name, directory } of entries) {
    const bare = directory ? name.slice(0, -1) : name;
    if (bare.length === 0 || bare.split('/').some((segment) => segment === '' || segment === '.')) unsafe();
    const folded = bare.toLowerCase();
    if (seen.has(folded)) unsafe();
    seen.add(folded);
    if (!directory) files.add(folded);
  }
  for (const folded of seen) {
    const parts = folded.split('/');
    for (let index = 1; index < parts.length; index += 1) if (files.has(parts.slice(0, index).join('/'))) unsafe();
  }
}

function readZipEntry(bytes, entry) {
  const unsafe = () => blocked('artifact is not a safe zip', 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE');
  const at = entry.localOffset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== 0x04_03_4b_50) unsafe();
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const raw = bytes.subarray(start, start + entry.compressed);
  if (raw.length !== entry.compressed) unsafe();
  const data = entry.method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
  if (data.length !== entry.uncompressed || crc32(data) !== entry.crc) unsafe();
  return data;
}

function readLicense(want, bytes) {
  if (want.format === 'zip') {
    const entry = listZip(bytes).find((item) => item.name === want.license_file);
    if (!entry) throw new Error('licence file is absent');
    return readZipEntry(bytes, entry).toString('utf8');
  }
  return tar(['-xzOf', '-', want.license_file], bytes).toString('utf8');
}

/** Check one pin against the manifest entry and the artifact bytes. Returns the verified record. */
function verifyPin(cacheDirectory, name, manifest, expected = PINS) {
  const want = expected[name];
  if (!want) blocked(`unknown toolchain pin ${name}`, 'ENV_TOOLCHAIN_PIN_UNKNOWN');
  const entry = manifest.pins.find((pin) => pin.name === name);
  if (!entry) blocked(`pin ${name} is absent from the manifest`, 'ENV_TOOLCHAIN_PIN_MISSING');
  if (
    entry.version !== want.version ||
    entry.artifact !== want.artifact ||
    entry.sha256 !== want.sha256 ||
    entry.license !== want.license
  ) {
    blocked(`manifest entry for ${name} diverges from the pin`, 'ENV_TOOLCHAIN_PIN_DIVERGED');
  }
  const file = artifactPath(cacheDirectory, want.artifact);
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    blocked(`artifact for ${name} is absent`, 'ENV_TOOLCHAIN_ARTIFACT_MISSING');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== want.sha256)
    blocked(`artifact for ${name} fails its SHA-256`, 'ENV_TOOLCHAIN_DIGEST_MISMATCH');
  let licenseText;
  try {
    licenseText = readLicense(want, bytes);
  } catch (error) {
    if (error instanceof ToolchainBlockedError) throw error;
    blocked(`licence file of ${name} is absent from the artifact`, 'ENV_TOOLCHAIN_LICENSE_MISSING');
  }
  if (!want.license_markers.every((marker) => licenseText.includes(marker))) {
    blocked(`licence text of ${name} does not match ${want.license}`, 'ENV_TOOLCHAIN_LICENSE_MISMATCH');
  }
  return Object.freeze({
    name,
    version: want.version,
    sha256: want.sha256,
    license: want.license,
    format: want.format ?? 'tgz',
    root: want.root ?? 'package/',
    bytes,
  });
}

function assertSafeArchive(bytes, root = 'package/') {
  const listing = tar(['-tvzf', '-'], bytes).toString('utf8').split('\n').filter(Boolean);
  for (const line of listing) {
    const name = line.replace(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+/, '');
    if (!/^[-d]/.test(line) || name.startsWith('/') || name.split('/').includes('..') || !name.startsWith(root)) {
      blocked('artifact holds links or entries outside its root', 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE');
    }
  }
}

function extractZip(members, target) {
  const base = path.resolve(target);
  for (const { entry, data } of members) {
    const destination = path.resolve(base, entry.name);
    if (destination !== base && !destination.startsWith(`${base}${path.sep}`))
      blocked('artifact path leaves its root', 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE');
    if (entry.directory) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, data, { flag: 'wx', mode: 0o600 });
  }
}

/**
 * Verify every requested pin, then extract each to `<destination>/<name>/package`. Any divergence blocks the
 * whole install: a partial toolchain is never reported as ready.
 */
function installToolchain({ cacheDirectory, destination, names = Object.keys(PINS), expected = PINS }) {
  const cache = resolveCacheDirectory(cacheDirectory);
  const manifest = readManifest(cache);
  const verified = names.map((name) => verifyPin(cache, name, manifest, expected));
  for (const pin of verified) {
    // A previous install never leaks stale files into the new toolchain.
    const target = path.join(destination, pin.name);
    if (pin.format === 'zip') {
      // Every member is decoded and checked before the first byte is written.
      const members = listZip(pin.bytes).map((entry) => ({ entry, data: entry.directory ? null : readZipEntry(pin.bytes, entry) }));
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      extractZip(members, target);
      continue;
    }
    assertSafeArchive(pin.bytes, pin.root);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    tar(['-xzf', '-', '-C', target, '--no-same-owner', '--no-same-permissions'], pin.bytes);
  }
  return Object.freeze({
    status: 'ready',
    root: destination,
    pins: Object.freeze(verified.map(({ name, version, sha256, license }) => Object.freeze({ name, version, sha256, license }))),
  });
}

module.exports = {
  CACHE_ENV,
  PINS,
  ToolchainBlockedError,
  crc32,
  installToolchain,
  listZip,
  readManifest,
  readZipEntry,
  resolveCacheDirectory,
  verifyPin,
};
