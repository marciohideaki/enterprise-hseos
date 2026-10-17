'use strict';

// Generic generator for environment capability packs (LSP, DAP, browser, ...). A pack directory versions only a
// manifest and the list of core files; the files are copied at pack time, so no code is duplicated in the repo.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');

const MANIFEST_SCHEMA = 'hseos.environment-plugin.v1';
const MAX_ENTRIES = 40;
const MAX_BYTES = 1_048_576;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// Binaries and pins are data kept outside every tarball.
const FORBIDDEN = /(?:^|\/)(?:node_modules|toolchain|\.git)(?:\/|$)|\.(?:tgz|whl|node|so|dll|exe|zip|tar|gz)$/;
const ID = /^[a-z][a-z0-9-]*$/;

class PluginPackError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PluginPackError';
    this.code = code;
  }
}

function refuse(message, code) {
  throw new PluginPackError(message, code);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readManifest(repoRoot, capability) {
  if (!ID.test(capability)) refuse('capability name is not valid', 'ENV_PACK_MANIFEST_INVALID');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'plugins', capability, 'plugin.json'), 'utf8'));
  } catch {
    refuse('plugin manifest is missing or unreadable', 'ENV_PACK_MANIFEST_INVALID');
  }
  const files = manifest?.core_files;
  if (
    manifest?.schema !== MANIFEST_SCHEMA ||
    !ID.test(manifest.id ?? '') ||
    manifest.capability !== capability ||
    !Array.isArray(files) ||
    files.length === 0
  ) {
    refuse('plugin manifest does not match the pack schema', 'ENV_PACK_MANIFEST_INVALID');
  }
  if (manifest.load?.strategy !== 'lazy' || !files.includes(manifest.load.entry))
    refuse('plugin must load lazily from a listed core file', 'ENV_PACK_NOT_LAZY');
  if (files.length + 1 > MAX_ENTRIES) refuse('plugin exceeds the entry limit', 'ENV_PACK_TOO_MANY_ENTRIES');
  if (new Set(files).size !== files.length) refuse('core file list has duplicates', 'ENV_PACK_MANIFEST_INVALID');
  return manifest;
}

function readCoreFile(repoRoot, relative) {
  if (typeof relative !== 'string' || !SAFE_PATH.test(relative) || relative.split('/').includes('..'))
    refuse('core file path is not safe', 'ENV_PACK_PATH_UNSAFE');
  if (FORBIDDEN.test(relative)) refuse('binaries and pins never enter a tarball', 'ENV_PACK_FORBIDDEN_CONTENT');
  const absolute = path.join(repoRoot, relative);
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    refuse(`core file ${relative} is missing`, 'ENV_PACK_FILE_MISSING');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) refuse(`core file ${relative} is not a regular file`, 'ENV_PACK_PATH_UNSAFE');
  return fs.readFileSync(absolute);
}

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(
    `${header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, '0')}\0 `,
    148,
  );
  return header;
}

/** Deterministic ustar archive: sorted entries, zero timestamps and owners. */
function buildTarball(entries) {
  const blocks = [];
  for (const { name, bytes } of entries) {
    if (Buffer.byteLength(name) > 100) refuse('entry name is too long', 'ENV_PACK_PATH_UNSAFE');
    blocks.push(tarHeader(name, bytes.length), bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
}

/**
 * Build the pack for `plugins/<capability>`. Optionally writes `<id>-<version>.tgz` and `.tgz.sha256` into
 * `outputDirectory`. The result lists every entry with the digest of the core file it copies.
 */
function packPlugin({ repoRoot, capability, outputDirectory }) {
  const manifest = readManifest(repoRoot, capability);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const files = manifest.core_files.map((relative) => ({
    name: `package/${relative}`,
    source: relative,
    bytes: readCoreFile(repoRoot, relative),
  }));
  const entries = [{ name: 'package/plugin.json', source: null, bytes: manifestBytes }, ...files].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  const total = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
  if (total > MAX_BYTES) refuse('plugin exceeds the size limit', 'ENV_PACK_TOO_LARGE');
  const tarball = buildTarball(entries);
  if (tarball.length > MAX_BYTES) refuse('plugin tarball exceeds the size limit', 'ENV_PACK_TOO_LARGE');
  const digest = sha256(tarball);
  const result = Object.freeze({
    id: manifest.id,
    version: manifest.version,
    filename: `${manifest.id}-${manifest.version}.tgz`,
    tarball,
    digest,
    unpacked_bytes: total,
    entries: Object.freeze(
      entries.map(({ name, source, bytes }) => Object.freeze({ path: name, source, bytes: bytes.length, sha256: sha256(bytes) })),
    ),
  });
  if (outputDirectory) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, result.filename), tarball);
    fs.writeFileSync(path.join(outputDirectory, `${result.filename}.sha256`), `${digest}  ${result.filename}\n`);
  }
  return result;
}

module.exports = { MANIFEST_SCHEMA, MAX_BYTES, MAX_ENTRIES, PluginPackError, buildTarball, packPlugin };
