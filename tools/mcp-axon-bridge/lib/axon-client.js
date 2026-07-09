'use strict';

const { spawn } = require('node:child_process');
const { noOpResponse } = require('./no-op-fallback');

const TIMEOUT_MS = 5000;

function callAxon(binaryPath, method, params) {
  return new Promise((resolve) => {
    if (!binaryPath) {
      resolve(noOpResponse(method));
      return;
    }

    let timedOut = false;
    let child;
    try {
      child = spawn(binaryPath, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve(noOpResponse(method));
      return;
    }

    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: `tools/call`, params: { name: method, arguments: params } });

    let stdout = '';
    let didResolve = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      if (!didResolve) {
        didResolve = true;
        resolve(noOpResponse(method));
      }
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut || didResolve) return;
      didResolve = true;
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.result?.content?.[0]?.text) {
          resolve(JSON.parse(parsed.result.content[0].text));
        } else if (parsed.result) {
          resolve(parsed.result);
        } else {
          resolve(noOpResponse(method));
        }
      } catch {
        resolve(noOpResponse(method));
      }
    });

    child.on('error', () => {
      clearTimeout(timer);
      if (!didResolve) {
        didResolve = true;
        resolve(noOpResponse(method));
      }
    });

    try {
      child.stdin.write(request + '\n');
      child.stdin.end();
    } catch {
      clearTimeout(timer);
      if (!didResolve) {
        didResolve = true;
        resolve(noOpResponse(method));
      }
    }
  });
}

module.exports = { callAxon };
