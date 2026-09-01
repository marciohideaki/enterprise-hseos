'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { GovernanceSnapshotSchema, deepFreeze, digestCanonical, parseContract } = require('../managed-governance-contracts');

class SnapshotError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_SNAPSHOT_INVALID') {
    super(message);
    this.name = 'SnapshotError';
    this.code = code;
  }
}

function createSnapshotStore(options) {
  if (!options || typeof options !== 'object') {
    throw new SnapshotError('snapshot options are required');
  }
  const { snapshotPath, clock = () => new Date() } = options;
  if (!snapshotPath || !path.isAbsolute(snapshotPath)) throw new SnapshotError('snapshot path must be explicit and absolute');
  if (typeof clock !== 'function') throw new SnapshotError('snapshot clock is invalid');
  const target = path.normalize(snapshotPath);

  function now() {
    const value = clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new SnapshotError('snapshot clock returned an invalid date');
    }
    return value;
  }

  function verifyDirectory(directory) {
    const metadata = fs.lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || fs.realpathSync(directory) !== directory) {
      throw new SnapshotError('snapshot directory is unsafe');
    }
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
      throw new SnapshotError('snapshot directory has an unexpected owner');
    }
  }

  function promote(snapshot, expectedDigest = null) {
    const parsed = parseContract(GovernanceSnapshotSchema, snapshot, 'governance snapshot');
    const digest = digestCanonical(parsed);
    if (expectedDigest !== null && digest !== expectedDigest) throw new SnapshotError('snapshot digest does not match promotion evidence');
    const envelope = { schema_version: 1, snapshot_digest: digest, snapshot: parsed };
    const directory = path.dirname(target);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    verifyDirectory(directory);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(envelope)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
      const directoryDescriptor = fs.openSync(directory, 'r');
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return deepFreeze({ status: 'promoted', digest, snapshot_id: parsed.snapshot_id });
  }

  function load({ maximumAgeSeconds, repositoryId, bindingDigest }) {
    if (!Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 60 || maximumAgeSeconds > 604_800) {
      throw new SnapshotError('snapshot maximum age is invalid');
    }
    let metadata;
    try {
      metadata = fs.lstatSync(target);
    } catch (error) {
      if (error.code === 'ENOENT') throw new SnapshotError('snapshot is unavailable', 'MANAGED_GOVERNANCE_SNAPSHOT_UNAVAILABLE');
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 4 * 1024 * 1024) {
      throw new SnapshotError('snapshot file is unsafe');
    }
    let descriptor;
    let envelope;
    try {
      descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(descriptor);
      if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
        throw new SnapshotError('snapshot changed during inspection');
      }
      envelope = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } catch (error) {
      if (error instanceof SnapshotError) throw error;
      throw new SnapshotError('snapshot file is corrupt');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    if (
      !envelope ||
      Object.keys(envelope).sort().join(',') !== 'schema_version,snapshot,snapshot_digest' ||
      envelope.schema_version !== 1
    ) {
      throw new SnapshotError('snapshot envelope is invalid');
    }
    const snapshot = parseContract(GovernanceSnapshotSchema, envelope.snapshot, 'cached governance snapshot');
    const digest = digestCanonical(snapshot);
    if (digest !== envelope.snapshot_digest) throw new SnapshotError('snapshot integrity check failed');
    if (snapshot.repository_id !== repositoryId || snapshot.binding_digest !== bindingDigest) {
      throw new SnapshotError('snapshot identity does not match the binding');
    }
    const currentTime = now();
    const issued = new Date(snapshot.issued_at);
    const expires = new Date(snapshot.expires_at);
    const ageSeconds = Math.floor((currentTime.getTime() - issued.getTime()) / 1000);
    if (ageSeconds < 0 || ageSeconds > maximumAgeSeconds || currentTime >= expires) throw new SnapshotError('snapshot is expired');
    return deepFreeze({ status: 'valid', digest, age_seconds: ageSeconds, snapshot });
  }

  return Object.freeze({ load, promote, path: target });
}

module.exports = { SnapshotError, createSnapshotStore };
