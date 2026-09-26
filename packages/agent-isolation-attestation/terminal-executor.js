'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { prepareIsolatedExecution } = require('./index');
const { createResourceGroup, removeDrainedGroup, EngineeringIsolationError } = require('./executor');

/** Controller-owned launch. No command or filesystem authority comes from the transport. */
function startIsolatedTerminal({
  policy,
  command,
  host_node = false,
  mode,
  rows = 24,
  cols = 80,
  timeout_ms,
  max_output_bytes,
  onOutput,
  onPrepared = () => {},
}) {
  if (
    !['pty', 'job'].includes(mode) ||
    ![rows, cols].every((v) => Number.isInteger(v) && v > 0 && v <= 500) ||
    !Number.isSafeInteger(timeout_ms) ||
    timeout_ms < 1 ||
    timeout_ms > 300_000 ||
    !Number.isSafeInteger(max_output_bytes) ||
    max_output_bytes < 1 ||
    max_output_bytes > 65_536 ||
    typeof onOutput !== 'function'
  )
    throw new EngineeringIsolationError('Invalid terminal limits');
  const launch = prepareIsolatedExecution(policy, command, host_node, mode === 'pty');
  const group = createResourceGroup();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-terminal-'));
  const filename = path.join(temp, 'seccomp');
  const fds = [];
  let child;
  const waiting = new Map();
  let buffer = '';
  let result;
  let failure;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Callers may inspect completion before readiness; avoid an unhandled rejection.
  ready.catch(() => {});
  let completionResolve, completionReject;
  const completion = new Promise((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });
  completion.catch(() => {});
  const stop = () => {
    try {
      fs.writeFileSync(path.join(group, 'cgroup.kill'), '1');
    } catch (error) {
      failure ||= error;
    }
    child?.stdin.destroy();
  };
  try {
    onPrepared(group);
    fs.writeFileSync(filename, launch.seccomp, { mode: 0o400, flag: 'wx' });
    fds.push(fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW));
    fs.unlinkSync(filename);
    if (host_node) fds.push(fs.openSync(fs.realpathSync(process.execPath), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW));
    const config = {
      group,
      binary: launch.binary,
      args: launch.args,
      fds: fds.map((_, i) => i + 3),
      mode,
      rows,
      cols,
      timeout_ms,
      max_output_bytes,
    };
    child = spawn('/usr/bin/python3', ['-I', path.join(__dirname, 'terminal-broker.py'), JSON.stringify(config)], {
      env: {},
      stdio: ['pipe', 'pipe', 'ignore', ...fds],
    });
    child.stdin.on('error', () => {});
    child.once('error', (error) => {
      failure = error;
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      try {
        if (buffer.length > 131_072) throw new Error('broker frame limit');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const frame = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          switch (frame.kind) {
            case 'ready': {
              readyResolve({ policy_digest: launch.policy_digest });
              break;
            }
            case 'output': {
              onOutput(frame);
              break;
            }
            case 'exit': {
              result = frame;
              break;
            }
            case 'ack': {
              waiting.get(frame.id)?.resolve(frame);
              waiting.delete(frame.id);

              break;
            }
            default: {
              throw new Error('invalid broker frame');
            }
          }
        }
      } catch (error) {
        failure = error;
        stop();
      }
    });
    child.once('close', async (code) => {
      try {
        await removeDrainedGroup(group);
        if (failure || code !== 0 || !result?.descendants_terminated)
          throw new EngineeringIsolationError('Terminal outcome uncertain', 'ENGINEERING_TERMINAL_UNCERTAIN');
        completionResolve(result);
      } catch (error) {
        completionReject(error);
      } finally {
        readyReject(new EngineeringIsolationError('Terminal closed before readiness'));
        for (const waiter of waiting.values()) waiter.reject(new EngineeringIsolationError('Terminal command outcome uncertain'));
        waiting.clear();
      }
    });
  } catch (error) {
    stop();
    if (!child) removeDrainedGroup(group).then(() => completionReject(error), completionReject);
    readyReject(error);
  } finally {
    for (const fd of fds) fs.closeSync(fd);
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return {
    ready,
    completion,
    group,
    async command(action, input = {}) {
      await ready;
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          stop();
          reject(new EngineeringIsolationError('Terminal acknowledgement deadline'));
        }, 5000);
        waiting.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        child.stdin.write(JSON.stringify({ ...input, action, id }) + '\n', (error) => {
          if (error) {
            waiting.get(id)?.reject(error);
            waiting.delete(id);
          }
        });
      });
    },
    async terminate() {
      stop();
      return completion;
    },
  };
}

module.exports = { startIsolatedTerminal };
