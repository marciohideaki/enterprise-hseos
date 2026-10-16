'use strict';

// Offline toolchain pins for the environment capabilities. Pins are data: name, version, SHA-256 of the artifact, the
// licence text expected inside it (markers) and the SHA-256 of that whole text. Nothing is downloaded and no binary
// ever enters a tarball.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const MANIFEST_SCHEMA = 'hseos.toolchain-cache.v1';
const CACHE_ENV = 'HSEOS_TOOLCHAIN_CACHE';
const APACHE_MARKERS = ['Apache License', 'Version 2.0, January 2004'];
const MIT_MARKERS = ['Permission is hereby granted, free of charge'];
const BSD3_MARKERS = ['Redistribution and use in source and binary forms', 'Neither the name of Google LLC'];
const XDOTOOL_MARKERS = ['Redistribution and use in source and binary forms', 'Neither the name of the Jordan Sissel'];

const PINS = Object.freeze({
  'typescript-language-server': Object.freeze({
    version: '6.0.2',
    artifact: 'npm/typescript-language-server-6.0.2.tgz',
    sha256: 'd225b223a8a4764ecbd94bdba85d2ef185eaa7b9842a1a31c38c2bbe7f2fe9b9',
    license: 'Apache-2.0',
    license_file: 'package/LICENSE',
    license_sha256: '899d21038f87dd6243dd33b7ee82a078e639d4325a427c01e64d8116315b9680',
    license_markers: Object.freeze([...APACHE_MARKERS, ...MIT_MARKERS]),
  }),
  typescript: Object.freeze({
    version: '5.9.3',
    artifact: 'npm/typescript-5.9.3.tgz',
    sha256: '10e108c9cf7d5f2879053dff18515fb405abf2ccef63eaaf017d9c571687a1d3',
    license: 'Apache-2.0',
    license_file: 'package/LICENSE.txt',
    license_sha256: 'a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47',
    license_markers: Object.freeze(APACHE_MARKERS),
  }),
  pyright: Object.freeze({
    version: '1.1.414',
    artifact: 'npm/pyright-1.1.414.tgz',
    sha256: 'bf5f473f6167c0d14175492c3263d783b4489a6956e1c06c18e15228e3a3fa42',
    license: 'MIT',
    license_file: 'package/LICENSE.txt',
    license_sha256: 'f7c936bc43f132b08497ac952e9376cbc102e5eedb4bf6ec902ea8442bd9c68d',
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
    license_sha256: '649844f60da138e54b9bcc13338c62c5f97be8612cb6249ac10f84bbb97ffc88',
    license_markers: Object.freeze(MIT_MARKERS),
  }),
  'js-debug': Object.freeze({
    version: '1.140.0',
    artifact: 'github/js-debug-dap-v1.140.0.tar.gz',
    sha256: '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968',
    license: 'MIT',
    root: 'js-debug/',
    license_file: 'js-debug/LICENSE',
    license_sha256: 'dea9265341829002e2c23a7372393eb2ed6e26085fb623f38a4ba0af833f30a6',
    license_markers: Object.freeze(MIT_MARKERS),
  }),
  'playwright-core': Object.freeze({
    version: '1.61.0',
    artifact: 'npm/playwright-core-1.61.0.tgz',
    sha256: 'b5ab14f09f3aaacdedbc2cb1431b0552cec8995fba35d841779a4ed535ce0200',
    license: 'Apache-2.0',
    license_file: 'package/LICENSE',
    license_sha256: '45873d00a0dd243596deb4aa23b2493b3d1f0671921bf2538ea431d7380220eb',
    license_markers: Object.freeze(APACHE_MARKERS),
  }),
  // Chrome headless shell, Playwright revision 1228. The zip is far larger than the default zip ceilings, so the
  // pin declares its own finite ones; the binary inside is byte-identical to the one Playwright installs.
  'chrome-headless-shell': Object.freeze({
    version: '149.0.7827.55',
    artifact: 'playwright/chrome-headless-shell-linux64-149.0.7827.55.zip',
    sha256: '410c9407d5de3fea80d9398666be06f2aa09154a3fa7b327dc254e336bb4c4b7',
    size_bytes: 119_778_157,
    license: 'BSD-3-Clause',
    format: 'zip',
    license_file: 'chrome-headless-shell-linux64/LICENSE.headless_shell',
    license_sha256: 'a522f12bd149be8d77dd05b5bdb03ebd7ac759cca511190d158ced6d27b539ac',
    license_markers: Object.freeze(BSD3_MARKERS),
    zip_limits: Object.freeze({ entry_bytes: 201_326_592, total_bytes: 335_544_320 }),
  }),
  // A system package, pinned per distro: each variant fixes one .deb by digest and its licence is read inside it, but the
  // binary that runs is the host's own /usr/bin/xdotool, accepted only when the installed package version equals the
  // version of one variant (computer-use). No variant equal to the installed version means BLOCKED.
  xdotool: Object.freeze({
    system_package: 'xdotool',
    license: 'BSD-3-clause',
    format: 'deb',
    binary: Object.freeze({ in_artifact: './usr/bin/xdotool', on_host: '/usr/bin/xdotool' }),
    license_file: './usr/share/doc/xdotool/copyright',
    license_markers: Object.freeze(XDOTOOL_MARKERS),
    variants: Object.freeze([
      Object.freeze({
        distro: 'ubuntu-resolute',
        version: '1:3.20160805.1-5.1build1',
        artifact: 'apt/xdotool_3.20160805.1-5.1build1_amd64.deb',
        source_url: 'https://archive.ubuntu.com/ubuntu/pool/universe/x/xdotool/xdotool_3.20160805.1-5.1build1_amd64.deb',
        size_bytes: 42_984,
        sha256: 'fda12b12adf99fa7d93cbc89baf53def35449e9ea04ec0f34dc5a92042a6a68f',
        license_sha256: '7022c27d07a4777ff1e23a83274f6351d634d83053b46a7f5582a2c988ab4572',
      }),
      Object.freeze({
        distro: 'ubuntu-noble',
        version: '1:3.20160805.1-5build1',
        artifact: 'apt/xdotool_3.20160805.1-5build1_amd64.deb',
        source_url: 'https://archive.ubuntu.com/ubuntu/pool/universe/x/xdotool/xdotool_3.20160805.1-5build1_amd64.deb',
        size_bytes: 42_556,
        sha256: '58a202c74bce31ca2d72d4d514942a5ab6191932696adc5d21d909c9216b13cb',
        license_sha256: '7022c27d07a4777ff1e23a83274f6351d634d83053b46a7f5582a2c988ab4572',
      }),
    ]),
  }),
});
const MAX_DEB_MEMBERS = 16;
const AR_MAGIC = '!<arch>\n';
const AR_HEADER = 60;
const DEB_DATA_FLAGS = Object.freeze({ '.zst': '--zstd', '.xz': '-J', '.gz': '-z' });

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
function listZip(bytes, limits = {}) {
  const maxEntry = limits.entry_bytes ?? MAX_ZIP_ENTRY_BYTES;
  const maxTotal = limits.total_bytes ?? MAX_ZIP_TOTAL_BYTES;
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
    if (flags & 0x1 || ![0, 8].includes(method) || uncompressed > maxEntry || total > maxTotal) unsafe();
    if (mode !== 0 && mode !== (directory ? UNIX_DIRECTORY : UNIX_REGULAR)) unsafe();
    if (name.length === 0 || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) unsafe();
    entries.push({
      name,
      directory,
      method,
      crc,
      compressed,
      uncompressed,
      localOffset,
      executable: platform === 3 && !directory && ((attributes >>> 16) & 0o100) !== 0,
    });
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

function readZipEntry(bytes, entry, maxBytes = MAX_ZIP_ENTRY_BYTES) {
  const unsafe = () => blocked('artifact is not a safe zip', 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE');
  const at = entry.localOffset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== 0x04_03_4b_50) unsafe();
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const raw = bytes.subarray(start, start + entry.compressed);
  if (raw.length !== entry.compressed) unsafe();
  const data = entry.method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: maxBytes });
  if (data.length !== entry.uncompressed || crc32(data) !== entry.crc) unsafe();
  return data;
}

/** The data member of a .deb (an `ar` archive), read in memory: nothing is unpacked to disk. */
function debDataMember(bytes) {
  const unsafe = () => blocked('artifact is not a safe deb', 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE');
  if (bytes.length < AR_MAGIC.length || bytes.subarray(0, AR_MAGIC.length).toString('latin1') !== AR_MAGIC) unsafe();
  let cursor = AR_MAGIC.length;
  for (let member = 0; member < MAX_DEB_MEMBERS && cursor + AR_HEADER <= bytes.length; member += 1) {
    const header = bytes.subarray(cursor, cursor + AR_HEADER);
    const name = header.subarray(0, 16).toString('latin1').trim().replace(/\/$/u, '');
    const size = Number(header.subarray(48, 58).toString('latin1').trim());
    if (header.subarray(58, 60).toString('latin1') !== '`\n' || !Number.isSafeInteger(size) || size < 0) unsafe();
    const start = cursor + AR_HEADER;
    if (start + size > bytes.length) unsafe();
    const suffix = Object.keys(DEB_DATA_FLAGS).find((item) => name === `data.tar${item}`);
    if (suffix) return { data: bytes.subarray(start, start + size), flag: DEB_DATA_FLAGS[suffix] };
    cursor = start + size + (size % 2);
  }
  return unsafe();
}

/** One file of a .deb, read in memory from the hashed bytes. */
function readDebFile(bytes, file) {
  const { data, flag } = debDataMember(bytes);
  return tar([flag, '-xOf', '-', file], data);
}

function readLicense(want, bytes) {
  if (want.format === 'deb') {
    const { data, flag } = debDataMember(bytes);
    return tar([flag, '-xOf', '-', want.license_file], data).toString('utf8');
  }
  if (want.format === 'zip') {
    const entry = listZip(bytes, want.zip_limits).find((item) => item.name === want.license_file);
    if (!entry) throw new Error('licence file is absent');
    return readZipEntry(bytes, entry, want.zip_limits?.entry_bytes).toString('utf8');
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
  // The markers only prove that the right words are present; the digest proves that the whole text is the one pinned.
  if (typeof want.license_sha256 !== 'string' || createHash('sha256').update(licenseText, 'utf8').digest('hex') !== want.license_sha256) {
    blocked(`licence text of ${name} diverges from its pinned SHA-256`, 'ENV_TOOLCHAIN_LICENSE_DIGEST');
  }
  return Object.freeze({
    name,
    version: want.version,
    sha256: want.sha256,
    license: want.license,
    format: want.format ?? 'tgz',
    root: want.root ?? 'package/',
    zip_limits: want.zip_limits,
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
    fs.writeFileSync(destination, data, { flag: 'wx', mode: entry.executable ? 0o700 : 0o600 });
  }
}

/**
 * Verify every requested pin offline, then extract each one under `<destination>/<name>`. Nothing is downloaded.
 *
 * @param {object} options
 * @param {string} [options.cacheDirectory] Absolute path of the toolchain cache; falls back to `HSEOS_TOOLCHAIN_CACHE`.
 * @param {string} options.destination Directory that receives one sub-directory per pin. The caller owns it.
 * @param {string[]} [options.names] Pins to install. Defaults to every pin that is not a system pin.
 * @param {object} [options.expected] Pin table to verify against. Defaults to `PINS`.
 * @returns {Readonly<{status: 'ready', root: string, pins: ReadonlyArray<{name: string, version: string, sha256: string, license: string}>}>}
 *   `root` is `destination`. The extracted tree of a pin is `<root>/<name>/<pin root>`: `package/` for npm tarballs, the
 *   pin's own `root` for other tarballs, and the zip entry names as they are for zips.
 * @throws {ToolchainBlockedError} Every refusal carries a stable `code`: ENV_TOOLCHAIN_PIN_SYSTEM (a requested name is a
 *   system pin: those are verified, never installed, so the call fails and a system pin is never part of the default set),
 *   ENV_TOOLCHAIN_CACHE_UNSET, ENV_TOOLCHAIN_MANIFEST_MISSING, ENV_TOOLCHAIN_MANIFEST_INVALID, ENV_TOOLCHAIN_PIN_UNKNOWN,
 *   ENV_TOOLCHAIN_PIN_MISSING, ENV_TOOLCHAIN_PIN_DIVERGED, ENV_TOOLCHAIN_ARTIFACT_PATH, ENV_TOOLCHAIN_ARTIFACT_MISSING,
 *   ENV_TOOLCHAIN_DIGEST_MISMATCH, ENV_TOOLCHAIN_LICENSE_MISSING, ENV_TOOLCHAIN_LICENSE_MISMATCH,
 *   ENV_TOOLCHAIN_LICENSE_DIGEST, ENV_TOOLCHAIN_ARCHIVE_UNSAFE and ENV_TOOLCHAIN_INSTALL_FAILED.
 *
 * Effects on disk: before anything is written every requested pin is verified (artifact SHA-256, licence markers and
 * licence digest). Each pin is then checked (tar listing, or every zip member decoded and CRC-checked) and extracted into
 * a staging directory `<destination>/<name>.staging-<pid>`; only when that is complete is `<destination>/<name>` removed
 * and the staging directory renamed over it, so a previous install never leaks stale files into the new one. The staging
 * directory is removed on every failure. What is hashed is what is extracted: the artifact is read once and the same bytes
 * are handed to the extractor.
 *
 * Atomicity: verification of all pins happens first, so a cache divergence blocks the call before any write. The write
 * phase is per pin, not transactional across pins: if pin N cannot be extracted, pins 1..N-1 stay installed, the target of
 * pin N keeps its previous content, and the call throws (never `ready`). Within one pin the swap is remove-then-rename, so
 * a crash between the two steps can leave that pin absent, never half-written. Unsafe archives and any I/O failure while
 * extracting are reported as ToolchainBlockedError (ENV_TOOLCHAIN_ARCHIVE_UNSAFE and ENV_TOOLCHAIN_INSTALL_FAILED); no raw
 * error escapes.
 */
function installToolchain({
  cacheDirectory,
  destination,
  names = Object.keys(PINS).filter((name) => !PINS[name].system_package),
  expected = PINS,
}) {
  const cache = resolveCacheDirectory(cacheDirectory);
  if (names.some((name) => expected[name]?.system_package))
    blocked('system pins are verified, never installed', 'ENV_TOOLCHAIN_PIN_SYSTEM');
  const manifest = readManifest(cache);
  const verified = names.map((name) => verifyPin(cache, name, manifest, expected));
  for (const pin of verified) {
    const target = path.join(destination, pin.name);
    // Extraction happens in a staging directory beside the target; the target is replaced only once it is complete, so a
    // failed extraction never costs the previous install, and a previous install never leaks stale files into the new one.
    const staging = `${target}.staging-${process.pid}`;
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      if (pin.format === 'zip') {
        // Every member is decoded and checked before the first byte is written.
        const members = listZip(pin.bytes, pin.zip_limits).map((entry) => ({
          entry,
          data: entry.directory ? null : readZipEntry(pin.bytes, entry, pin.zip_limits?.entry_bytes),
        }));
        fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
        extractZip(members, staging);
      } else {
        assertSafeArchive(pin.bytes, pin.root);
        fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
        tar(['-xzf', '-', '-C', staging, '--no-same-owner', '--no-same-permissions'], pin.bytes);
      }
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      if (error instanceof ToolchainBlockedError) throw error;
      blocked(`toolchain ${pin.name} could not be extracted`, 'ENV_TOOLCHAIN_INSTALL_FAILED');
    }
  }
  return Object.freeze({
    status: 'ready',
    root: destination,
    pins: Object.freeze(verified.map(({ name, version, sha256, license }) => Object.freeze({ name, version, sha256, license }))),
  });
}

function installedPackageVersion(packageName) {
  return execFileSync('/usr/bin/dpkg-query', ['-W', '-f=${Version}', packageName], {
    env: { PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * A system pin has one variant per distro. The package installed on this host selects the variant whose version equals
 * it; that variant's artifact (digest, licence inside it) is then verified like any other. A missing package, or an
 * installed version that no variant names, is BLOCKED, never an approximation.
 */
function verifySystemPin({ cacheDirectory, name, expected = PINS, query = installedPackageVersion }) {
  const want = expected[name];
  if (!want?.system_package || !Array.isArray(want.variants)) blocked(`${name} is not a system pin`, 'ENV_TOOLCHAIN_PIN_UNKNOWN');
  const cache = resolveCacheDirectory(cacheDirectory);
  let installed;
  try {
    installed = query(want.system_package);
  } catch {
    blocked(`system package ${want.system_package} is not installed`, 'ENV_TOOLCHAIN_SYSTEM_MISSING');
  }
  const variant = want.variants.find((item) => item.version === installed);
  if (!variant) {
    blocked(
      `installed ${want.system_package} ${installed} is none of the pinned ${want.variants.map((item) => item.version).join(', ')}`,
      'ENV_TOOLCHAIN_SYSTEM_VERSION',
    );
  }
  const { variants: _variants, ...common } = want;
  const manifest = readManifest(cache);
  // Several manifest entries share the package name; only the one of the selected variant is looked at.
  const scoped = { ...manifest, pins: manifest.pins.filter((entry) => entry.name !== name || entry.version === variant.version) };
  const { bytes, ...verified } = verifyPin(cache, name, scoped, { [name]: { ...common, ...variant } });
  // Informational, never a criterion: a distro build may differ byte for byte while being the pinned version, so the
  // dpkg-query version decides and this only records whether the host binary equals the one inside the .deb.
  let binaryMatches = null;
  if (want.binary) {
    try {
      const inside = createHash('sha256').update(readDebFile(bytes, want.binary.in_artifact)).digest('hex');
      binaryMatches = inside === createHash('sha256').update(fs.readFileSync(want.binary.on_host)).digest('hex');
    } catch {
      binaryMatches = null;
    }
  }
  return Object.freeze({ ...verified, distro: variant.distro, installed_version: installed, binary_matches_artifact: binaryMatches });
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
  verifySystemPin,
};
