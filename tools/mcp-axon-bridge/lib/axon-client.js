'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 500;
const PROTOCOL_VERSION = '2024-11-05';

class AxonError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'AxonError';
    this.code = code;
    this.details = details;
  }
}

function unavailableError(toolName, reason = 'axon binary not found — install axon or set AXON_BIN env var') {
  return new AxonError('AXON_UNAVAILABLE', reason, { tool: toolName });
}

// Asynchronous and bounded: a hung `--version` must neither block the event loop nor outlive the call.
function detectVersion(binaryPath, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(binaryPath, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stdout.on('error', () => {});
    const done = () => {
      clearTimeout(timer);
      const line = out.trim().split('\n')[0];
      resolve(/\d+\.\d+\.\d+/.test(line) ? line : null);
    };
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', done);
  });
}

// SIGTERM first; a child that ignores it is SIGKILLed shortly after so it cannot be orphaned.
function terminate(child) {
  if (child.hseosTerminating) return;
  child.hseosTerminating = true;
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  const escalation = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, KILL_GRACE_MS);
  escalation.unref();
  child.once('exit', () => clearTimeout(escalation));
}

/**
 * Calls one Axon MCP tool through `axon serve` (stdio): initialize handshake,
 * then tools/call. Every failure is an AxonError; nothing degrades to an
 * empty-but-successful result.
 */
function callAxon(binaryPath, toolName, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!binaryPath) {
      reject(unavailableError(toolName));
      return;
    }

    let child;
    let settled = false;
    let buffer = '';
    let stderr = '';
    let initialized = false;

    let failing = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child) terminate(child);
      fn(value);
    };
    // Failures that benefit from the detected axon version: stop the child now, report once the probe returns.
    const fail = (code, reason, details = {}) => {
      if (settled || failing) return;
      failing = true;
      if (child) terminate(child);
      detectVersion(binaryPath).then((version) => {
        finish(
          reject,
          new AxonError(code, `${reason} (detected: ${version || 'unknown version'})`, {
            tool: toolName,
            axon_version: version,
            stderr: stderr.slice(-300),
            ...details,
          }),
        );
      });
    };
    const incompatible = (reason) => fail('AXON_INCOMPATIBLE', reason);

    const timer = setTimeout(() => fail('AXON_TIMEOUT', `axon did not answer within ${timeoutMs}ms`), timeoutMs);

    try {
      child = spawn(binaryPath, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      clearTimeout(timer);
      reject(unavailableError(toolName, `cannot execute axon binary: ${error.message}`));
      return;
    }

    const send = (message) => {
      if (failing || settled) return;
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        /* surfaced through the stdin error handler / close */
      }
    };

    const onMessage = (message) => {
      if (message.id === 1) {
        if (message.error || !message.result?.protocolVersion) {
          incompatible('axon serve rejected the MCP initialize handshake');
          return;
        }
        initialized = true;
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } });
        return;
      }
      if (message.id !== 2) return;
      if (message.error) {
        const code = message.error.code === -32_601 || message.error.code === -32_602 ? 'AXON_INCOMPATIBLE' : 'AXON_TOOL_ERROR';
        fail(code, message.error.message || 'axon returned an error');
        return;
      }
      const text = message.result?.content?.[0]?.text;
      let payload = message.result;
      if (typeof text === 'string') {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { text };
        }
      }
      if (message.result?.isError) {
        finish(
          reject,
          new AxonError('AXON_TOOL_ERROR', payload?.error || payload?.text || 'axon tool reported an error', {
            tool: toolName,
            detail: payload,
          }),
        );
        return;
      }
      finish(resolve, payload);
    };

    // An axon that exits early closes the pipe (EPIPE); that must not crash the bridge.
    child.stdin.on('error', (error) => incompatible(`axon closed its stdin early (${error.code || error.message})`));
    child.stdout.on('error', (error) => incompatible(`axon stdout failed (${error.code || error.message})`));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          onMessage(JSON.parse(line));
        } catch {
          if (!initialized) incompatible('axon serve did not speak JSON-RPC on stdout');
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.on('error', (error) => finish(reject, unavailableError(toolName, `cannot execute axon binary: ${error.message}`)));
    child.on('close', (code) => {
      if (!settled)
        incompatible(`axon serve exited (code=${code}) before answering; the installed axon may not support the MCP stdio interface`);
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'hseos-axon-bridge', version: '1.0.0' } },
    });
  });
}

module.exports = { callAxon, AxonError, unavailableError, detectVersion };
