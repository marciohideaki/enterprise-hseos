'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const MAX_HEALTH_BYTES = 16 * 1024;

function parsePort(value, fallback) {
  const candidate = value === undefined || value === null || value === '' ? fallback : value;
  const text = String(candidate).trim();
  if (!/^[0-9]+$/.test(text)) throw new Error('port must be an integer from 1 to 65535');
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('port must be an integer from 1 to 65535');
  return port;
}

function instanceRecordPath(directory, name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new TypeError('side-car name must contain only lowercase letters, digits, and hyphens');
  return path.join(path.resolve(directory), '.hseos', 'state', `${name}.instance.json`);
}

function createInstanceRecord({ server, entrypoint, port, host = '127.0.0.1' }) {
  if (typeof server !== 'string' || !server) throw new TypeError('server identity is required');
  if (typeof entrypoint !== 'string' || !path.isAbsolute(entrypoint)) throw new TypeError('entrypoint must be absolute');
  return Object.freeze({
    version: 1,
    server,
    instanceId: randomUUID(),
    entrypoint: path.normalize(entrypoint),
    port: parsePort(port),
    host,
    pid: null,
    startedAt: new Date().toISOString(),
  });
}

function writeInstanceRecord(recordPath, record) {
  const directory = path.dirname(recordPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${recordPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, recordPath);
    fs.chmodSync(recordPath, 0o600);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup; preserve the original write/rename result.
    }
  }
}

function readInstanceRecord(recordPath) {
  let metadata;
  try {
    metadata = fs.lstatSync(recordPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`unsafe side-car instance record: ${recordPath}`);
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new Error(`side-car instance record is owned by another user: ${recordPath}`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`side-car instance record permissions are not owner-only: ${recordPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  if (
    parsed?.version !== 1 ||
    typeof parsed.server !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parsed.instanceId || '') ||
    !Number.isSafeInteger(parsed.pid) ||
    parsed.pid < 1 ||
    typeof parsed.entrypoint !== 'string' ||
    !path.isAbsolute(parsed.entrypoint)
  ) {
    throw new Error(`invalid side-car instance record: ${recordPath}`);
  }
  parsed.port = parsePort(parsed.port);
  return parsed;
}

function removeInstanceRecord(recordPath) {
  try {
    fs.unlinkSync(recordPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function processIdentity(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return null;
    throw new Error(`cannot inspect side-car process ${pid}: ${error.message}`);
  }
  try {
    const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const uid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
    return { commandLine, uid };
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw new Error(`cannot inspect side-car process ${pid}: ${error.message}`);
  }
  try {
    const output = execFileSync('ps', ['-o', 'uid=', '-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    const match = /^(\d+)\s+(.+)$/.exec(output);
    return match ? { uid: Number(match[1]), commandLine: match[2].split(/\s+/) } : null;
  } catch {
    return null;
  }
}

function processMatches(record) {
  const identity = processIdentity(record.pid);
  if (!identity) return false;
  if (typeof process.getuid === 'function' && identity.uid !== process.getuid()) return false;
  return identity.commandLine.includes(record.entrypoint) && identity.commandLine.includes(`--instance-id=${record.instanceId}`);
}

function healthCheck({ port, server, instanceId }) {
  if (typeof server !== 'string' || !server || typeof instanceId !== 'string' || !instanceId) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port: parsePort(port), path: '/health', timeout: 2000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_HEALTH_BYTES) request.destroy();
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve(false);
        try {
          const result = JSON.parse(body);
          resolve(result?.status === 'ok' && result.server === server && result.instance_id === instanceId);
        } catch {
          resolve(false);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function inspectInstance(recordPath, expected) {
  const record = readInstanceRecord(recordPath);
  if (!record) return { state: 'absent', record: null };
  if (record.server !== expected.server || path.normalize(record.entrypoint) !== path.normalize(expected.entrypoint)) {
    throw new Error(`side-car instance record does not match ${expected.server}`);
  }
  if (!processMatches(record)) {
    removeInstanceRecord(recordPath);
    return { state: 'stale', record };
  }
  const healthy = await healthCheck(record);
  return { state: healthy ? 'running' : 'unhealthy', record };
}

async function stopInstance(recordPath, expected) {
  const instance = await inspectInstance(recordPath, expected);
  if (!instance.record || instance.state === 'stale') return 0;
  if (!processMatches(instance.record)) throw new Error('side-car process identity could not be verified');
  process.kill(instance.record.pid, 'SIGTERM');
  removeInstanceRecord(recordPath);
  return 1;
}

module.exports = {
  createInstanceRecord,
  healthCheck,
  inspectInstance,
  instanceRecordPath,
  parsePort,
  processMatches,
  readInstanceRecord,
  stopInstance,
  writeInstanceRecord,
};
