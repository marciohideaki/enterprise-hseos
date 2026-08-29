'use strict';

const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { createExecutionLedgerFileFixture, openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');

const REQUIRED_FILES = ['.hseos-ledger-fixture.json', 'bound-kernel-agent.json', 'ledger.sqlite'];
const OPTIONAL_FILES = ['workspace/world-state.json'];
const MAX_UNCOMPRESSED_BYTES = 4_194_304;
const MAX_COMPRESSED_BYTES = 786_432;

class BoundKernelStateSnapshotError extends Error {
  constructor(message, code = 'BOUND_KERNEL_STATE_SNAPSHOT_INVALID') {
    super(message);
    this.name = 'BoundKernelStateSnapshotError';
    this.code = code;
  }
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function safeFile(directory, relative) {
  const filename = path.join(directory, relative);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new BoundKernelStateSnapshotError('snapshot source contains an unsafe file');
  return fs.readFileSync(filename);
}

function captureStateSnapshot(directory) {
  const files = {};
  for (const relative of REQUIRED_FILES) files[relative] = safeFile(directory, relative).toString('base64');
  for (const relative of OPTIONAL_FILES) {
    if (fs.existsSync(path.join(directory, relative))) files[relative] = safeFile(directory, relative).toString('base64');
  }
  const raw = Buffer.from(JSON.stringify({ schema_version: 1, files }), 'utf8');
  if (raw.length > MAX_UNCOMPRESSED_BYTES) throw new BoundKernelStateSnapshotError('state snapshot exceeds its uncompressed byte limit');
  const compressed = zlib.gzipSync(raw, { level: 9 });
  if (compressed.length > MAX_COMPRESSED_BYTES) throw new BoundKernelStateSnapshotError('state snapshot exceeds its compressed byte limit');
  return Object.freeze({ schema_version: 1, encoding: 'gzip-base64', sha256: digest(raw), data: compressed.toString('base64') });
}

function decodeStateSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    JSON.stringify(Object.keys(snapshot).sort()) !== JSON.stringify(['data', 'encoding', 'schema_version', 'sha256']) ||
    snapshot.schema_version !== 1 ||
    snapshot.encoding !== 'gzip-base64' ||
    typeof snapshot.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
    typeof snapshot.data !== 'string' ||
    snapshot.data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(snapshot.data) ||
    Buffer.byteLength(snapshot.data, 'base64') > MAX_COMPRESSED_BYTES
  ) {
    throw new BoundKernelStateSnapshotError('state snapshot envelope is invalid');
  }
  let raw;
  try {
    raw = zlib.gunzipSync(Buffer.from(snapshot.data, 'base64'), { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  } catch {
    throw new BoundKernelStateSnapshotError('state snapshot compression is invalid');
  }
  if (digest(raw) !== snapshot.sha256) throw new BoundKernelStateSnapshotError('state snapshot digest does not match');
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new BoundKernelStateSnapshotError('state snapshot payload is invalid');
  }
  const files = payload?.files;
  const keys = files && typeof files === 'object' && !Array.isArray(files) ? Object.keys(files).sort() : [];
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(['files', 'schema_version']) ||
    payload?.schema_version !== 1 ||
    REQUIRED_FILES.some((name) => !keys.includes(name)) ||
    keys.some((name) => !REQUIRED_FILES.includes(name) && !OPTIONAL_FILES.includes(name)) ||
    keys.some(
      (name) =>
        typeof files[name] !== 'string' ||
        files[name].length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(files[name]) ||
        Buffer.from(files[name], 'base64').toString('base64') !== files[name],
    )
  ) {
    throw new BoundKernelStateSnapshotError('state snapshot file set is invalid');
  }
  return Object.fromEntries(keys.map((name) => [name, Buffer.from(files[name], 'base64')]));
}

function writeFiles(directory, files) {
  for (const [relative, contents] of Object.entries(files)) {
    const filename = path.join(directory, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filename, contents, { mode: 0o600 });
  }
  fs.mkdirSync(path.join(directory, 'workspace'), { recursive: true, mode: 0o700 });
}

function restoreStateSnapshot(snapshot) {
  const files = decodeStateSnapshot(snapshot);
  const handle = createExecutionLedgerFileFixture();
  const directory = handle.directory;
  handle.close();
  try {
    writeFiles(directory, files);
    const validation = openExecutionLedgerFileFixture(directory);
    validation.close();
    return directory;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function promoteStateSnapshot(snapshot, target, validate = () => {}) {
  const replacement = restoreStateSnapshot(snapshot);
  try {
    validate(replacement);
  } catch (error) {
    fs.rmSync(replacement, { recursive: true, force: true });
    throw error;
  }
  if (!target) return replacement;
  const current = openExecutionLedgerFileFixture(target);
  current.close();
  const backup = `${target}.previous-${randomUUID()}`;
  try {
    fs.renameSync(target, backup);
    fs.renameSync(replacement, target);
    fs.rmSync(backup, { recursive: true, force: true });
    return target;
  } catch (error) {
    if (fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target);
    if (fs.existsSync(replacement)) fs.rmSync(replacement, { recursive: true, force: true });
    throw new BoundKernelStateSnapshotError('state snapshot promotion failed', 'BOUND_KERNEL_STATE_SNAPSHOT_PROMOTION_FAILED', { cause: error });
  }
}

module.exports = {
  BoundKernelStateSnapshotError,
  MAX_COMPRESSED_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  captureStateSnapshot,
  decodeStateSnapshot,
  promoteStateSnapshot,
  restoreStateSnapshot,
};
