'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { prepareIsolatedExecution } = require('./index');

// Trusted launcher joins the already bounded group before any task code starts.
const LAUNCHER = String.raw`
import os, sys
with open(sys.argv[1] + '/cgroup.procs', 'w') as target:
    target.write(str(os.getpid()))
os.execve(sys.argv[2], sys.argv[2:], {})
`;

class EngineeringIsolationError extends Error {
  constructor(message, code = 'ENGINEERING_ISOLATION_UNAVAILABLE') {
    super(message);
    this.name = 'EngineeringIsolationError';
    this.code = code;
  }
}

function resourceParent() {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new EngineeringIsolationError('Linux x64 is required');
  const entry = fs.readFileSync('/proc/self/cgroup', 'utf8').trim();
  if (!entry.startsWith('0::/') || entry.includes('\n')) throw new EngineeringIsolationError('A unified cgroup is required');
  const current = path.join('/sys/fs/cgroup', entry.slice(3));
  const parent = path.dirname(current);
  if (fs.statSync(parent).uid !== process.getuid()) throw new EngineeringIsolationError('A delegated parent cgroup is required');
  const enabled = fs.readFileSync(path.join(parent, 'cgroup.subtree_control'), 'utf8').trim().split(/\s+/);
  if (!['memory', 'pids'].every((name) => enabled.includes(name))) {
    throw new EngineeringIsolationError('Memory and process controllers must already be delegated');
  }
  return parent;
}

function executorOwner(pid = process.pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);
  if (!/^[0-9]+$/.test(fields[19])) throw new EngineeringIsolationError('Worker identity is unavailable');
  return { pid, start_ticks: fields[19], resource_parent: resourceParent() };
}

function isExecutorOwnerAlive(owner) {
  if (!owner) return true;
  try {
    return executorOwner(owner.pid).start_ticks === owner.start_ticks;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function ownerPrefix(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || !/^[0-9]+$/.test(owner.start_ticks))
    throw new EngineeringIsolationError('Invalid executor owner');
  return `hseos-executor-${owner.pid}-${owner.start_ticks}-`;
}

async function reapExecutorOwner(owner) {
  const parent = resourceParent();
  if (owner?.resource_parent !== parent || isExecutorOwnerAlive(owner))
    throw new EngineeringIsolationError('Previous executor ownership cannot be reconciled');
  const prefix = ownerPrefix(owner);
  for (const entry of fs.readdirSync(parent)) {
    if (!entry.startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(entry.slice(prefix.length))) continue;
    const directory = path.join(parent, entry);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid())
      throw new EngineeringIsolationError('Previous resource group identity changed');
    await removeDrainedGroup(directory);
  }
}

function createResourceGroup() {
  const parent = resourceParent();
  const directory = path.join(parent, `${ownerPrefix(executorOwner())}${randomUUID()}`);
  fs.mkdirSync(directory);
  try {
    for (const [name, limit] of [
      ['pids.max', '32'],
      ['memory.max', '268435456'],
      ['memory.swap.max', '0'],
    ]) {
      fs.writeFileSync(path.join(directory, name), limit);
      if (fs.readFileSync(path.join(directory, name), 'utf8').trim() !== limit) {
        throw new EngineeringIsolationError('Resource controller did not accept its limit');
      }
    }
    fs.accessSync(path.join(directory, 'cgroup.kill'), fs.constants.W_OK);
    return directory;
  } catch (error) {
    fs.rmdirSync(directory);
    throw error;
  }
}

async function drain(directory, deadline = Date.now() + 5000) {
  fs.writeFileSync(path.join(directory, 'cgroup.kill'), '1');
  while (/populated 1/.test(fs.readFileSync(path.join(directory, 'cgroup.events'), 'utf8'))) {
    if (Date.now() >= deadline) throw new EngineeringIsolationError('Descendants did not terminate', 'ENGINEERING_TEARDOWN_UNCERTAIN');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function removeDrainedGroup(directory) {
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      await drain(directory, deadline);
      fs.rmdirSync(directory);
      return;
    } catch (error) {
      // Another recovery claimant may already have removed the empty group.
      if (error.code === 'ENOENT') return;
      if (error.code !== 'EBUSY') throw error;
      if (Date.now() >= deadline)
        throw new EngineeringIsolationError('Resource group cleanup did not settle', 'ENGINEERING_TEARDOWN_UNCERTAIN');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/** Execute an exact contract command. Workspace mutations go through scoped tools. */
async function executeIsolatedCommand({ policy, command, timeout_ms, max_output_bytes, signal }) {
  if (
    !Number.isSafeInteger(timeout_ms) ||
    timeout_ms < 1 ||
    timeout_ms > 300_000 ||
    !Number.isSafeInteger(max_output_bytes) ||
    max_output_bytes < 1 ||
    max_output_bytes > 65_536
  ) {
    throw new EngineeringIsolationError('Finite execution limits are required');
  }
  if (signal?.aborted) return { status: 'cancelled', exit_code: null, stdout: '', stderr: '', descendants_terminated: true };
  const launch = prepareIsolatedExecution(policy, command);
  let group;
  let fd;
  let temporary;
  try {
    group = createResourceGroup();
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-executor-filter-'));
    const filename = path.join(temporary, 'filter');
    fs.writeFileSync(filename, launch.seccomp, { flag: 'wx', mode: 0o400 });
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    fs.unlinkSync(filename);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        '/usr/bin/python3',
        [
          '-I',
          '-c',
          LAUNCHER,
          group,
          '/usr/bin/prlimit',
          '--core=0:0',
          '--nofile=64:64',
          '--fsize=1048576:1048576',
          `--cpu=${Math.max(1, Math.ceil(timeout_ms / 1000))}:${Math.max(1, Math.ceil(timeout_ms / 1000))}`,
          '--',
          launch.binary,
          ...launch.args,
        ],
        {
          env: {},
          stdio: ['ignore', 'pipe', 'pipe', fd],
          detached: true,
        },
      );
      const chunks = { stdout: [], stderr: [] };
      let bytes = 0;
      let stopped = null;
      let teardownError;
      const stop = (reason) => {
        stopped ||= reason;
        try {
          fs.writeFileSync(path.join(group, 'cgroup.kill'), '1');
        } catch (error) {
          teardownError = error;
        }
        // Covers the trusted launcher before it has joined the resource group.
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') teardownError ||= error;
        }
      };
      const abort = () => stop('cancelled');
      const timer = setTimeout(() => stop('timed_out'), timeout_ms);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      for (const name of ['stdout', 'stderr'])
        child[name].on('data', (chunk) => {
          const remaining = max_output_bytes - bytes;
          bytes += chunk.length;
          if (remaining > 0) chunks[name].push(chunk.subarray(0, remaining));
          if (bytes > max_output_bytes) stop('output_limit');
        });
      child.once('error', (error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (teardownError)
          return reject(new EngineeringIsolationError('Cancellation could not be proved', 'ENGINEERING_TEARDOWN_UNCERTAIN'));
        let stdout = '';
        let stderr = '';
        let invalidOutput = false;
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          stdout = decoder.decode(Buffer.concat(chunks.stdout));
          stderr = decoder.decode(Buffer.concat(chunks.stderr));
        } catch {
          // Do not expand invalid bytes into replacement characters beyond the budget.
          stdout = '';
          stderr = '';
          invalidOutput = true;
        }
        resolve({
          status: stopped || (invalidOutput ? 'invalid_output' : code === 0 ? 'succeeded' : 'failed'),
          exit_code: code,
          stdout,
          stderr,
        });
      });
    });
    await drain(group);
    return {
      ...result,
      descendants_terminated: true,
      policy_digest: launch.policy_digest,
      workspace_access: 'read_only',
      limits: { processes: 32, memory_bytes: 268_435_456, output_bytes: max_output_bytes, duration_ms: timeout_ms },
    };
  } catch (error) {
    if (error instanceof EngineeringIsolationError) throw error;
    throw new EngineeringIsolationError('The isolated executor prerequisites or launch failed');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (temporary) fs.rmdirSync(temporary);
    if (group) {
      await removeDrainedGroup(group);
    }
  }
}

module.exports = { EngineeringIsolationError, executeIsolatedCommand, executorOwner, isExecutorOwnerAlive, reapExecutorOwner };
