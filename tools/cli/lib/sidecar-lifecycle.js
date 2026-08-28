'use strict';

const http = require('node:http');
const { execFileSync } = require('node:child_process');

function parsePort(value, fallback) {
  const candidate = value === undefined || value === null || value === '' ? fallback : value;
  const port = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('port must be an integer from 1 to 65535');
  return port;
}

function healthCheck({ port, token = null }) {
  return new Promise((resolve) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const request = http.get({ hostname: '127.0.0.1', port, path: '/health', headers, timeout: 2000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function stopPort(port) {
  let output;
  try {
    output = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8', timeout: 2000 });
  } catch {
    return 0;
  }
  const pids = [
    ...new Set(
      output
        .split(/\s+/)
        .filter((value) => /^[1-9][0-9]*$/.test(value))
        .map(Number),
    ),
  ];
  for (const pid of pids) process.kill(pid, 'SIGTERM');
  return pids.length;
}

module.exports = { healthCheck, parsePort, stopPort };
