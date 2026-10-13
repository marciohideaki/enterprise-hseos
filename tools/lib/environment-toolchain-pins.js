'use strict';

// Offline toolchain pins for the environment capabilities. Pins are data: name, version, SHA-256 of the
// artifact and the licence text expected inside it. Nothing is downloaded and no binary ever enters a tarball.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
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
});

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
  if (!resolved.startsWith(`${path.resolve(cacheDirectory)}${path.sep}`)) blocked('artifact path leaves the cache', 'ENV_TOOLCHAIN_ARTIFACT_PATH');
  return resolved;
}

// The artifact bytes are read once, hashed, and handed to tar on stdin: what is verified is what is extracted.
function tar(args, input) {
  return execFileSync('tar', args, { env: { PATH: '/usr/bin:/bin' }, input, maxBuffer: 16_777_216, stdio: ['pipe', 'pipe', 'ignore'] });
}

/** Check one pin against the manifest entry and the artifact bytes. Returns the verified record. */
function verifyPin(cacheDirectory, name, manifest, expected = PINS) {
  const want = expected[name];
  if (!want) blocked(`unknown toolchain pin ${name}`, 'ENV_TOOLCHAIN_PIN_UNKNOWN');
  const entry = manifest.pins.find((pin) => pin.name === name);
  if (!entry) blocked(`pin ${name} is absent from the manifest`, 'ENV_TOOLCHAIN_PIN_MISSING');
  if (entry.version !== want.version || entry.artifact !== want.artifact || entry.sha256 !== want.sha256 || entry.license !== want.license) {
    blocked(`manifest entry for ${name} diverges from the pin`, 'ENV_TOOLCHAIN_PIN_DIVERGED');
  }
  const file = artifactPath(cacheDirectory, want.artifact);
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    blocked(`artifact for ${name} is absent`, 'ENV_TOOLCHAIN_ARTIFACT_MISSING');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== want.sha256) blocked(`artifact for ${name} fails its SHA-256`, 'ENV_TOOLCHAIN_DIGEST_MISMATCH');
  let licenseText;
  try {
    licenseText = tar(['-xzOf', '-', want.license_file], bytes).toString('utf8');
  } catch {
    blocked(`licence file of ${name} is absent from the artifact`, 'ENV_TOOLCHAIN_LICENSE_MISSING');
  }
  if (!want.license_markers.every((marker) => licenseText.includes(marker))) {
    blocked(`licence text of ${name} does not match ${want.license}`, 'ENV_TOOLCHAIN_LICENSE_MISMATCH');
  }
  return Object.freeze({ name, version: want.version, sha256: want.sha256, license: want.license, bytes });
}

function assertSafeArchive(bytes) {
  const listing = tar(['-tvzf', '-'], bytes).toString('utf8').split('\n').filter(Boolean);
  for (const line of listing) {
    const name = line.replace(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+/, '');
    if (!/^[-d]/.test(line) || name.startsWith('/') || name.split('/').includes('..') || !name.startsWith('package/')) {
      blocked('artifact holds links or entries outside package/', 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE');
    }
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
    assertSafeArchive(pin.bytes);
    // A previous install never leaks stale files into the new toolchain.
    const target = path.join(destination, pin.name);
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

module.exports = { CACHE_ENV, PINS, ToolchainBlockedError, installToolchain, readManifest, resolveCacheDirectory, verifyPin };
