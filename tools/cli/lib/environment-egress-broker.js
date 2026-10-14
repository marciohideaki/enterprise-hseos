'use strict';

// Mediated egress for the sandboxed browser. The browser only ever reaches a Unix socket (bound into the sandbox);
// this broker, running outside it, is an HTTP proxy that forwards to an explicit host:port allowlist. Anything else
// is refused and recorded. DNS resolution happens here, never inside the sandbox. It follows the provider egress
// broker's pattern (Unix socket, finite request/response ceilings), but it is a separate, generic-proxy-shaped
// broker because the provider one only serves a single POST route.
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 16_777_216;
const MAX_CONNECTIONS = 64;
const IDLE_TIMEOUT_MS = 30_000;
// Allowed traffic and refusals are bounded separately, so a flood of allowed requests can never push out a refusal.
const MAX_EVENTS = 1000;
const MAX_DENIED_EVENTS = 1000;
/** Set on every refusal so the browser host can tell a broker refusal from a page that happens to answer 403. */
const DENIED_HEADER = 'x-hseos-egress';
const MAX_ALLOWLIST = 32;
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u;
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

class EnvironmentEgressBrokerError extends Error {
  constructor(message, code = 'ENV_BROWSER_EGRESS_INVALID', options) {
    super(message, options);
    this.name = 'EnvironmentEgressBrokerError';
    this.code = code;
  }
}

function invalid(message) {
  throw new EnvironmentEgressBrokerError(message);
}

/** `host:port` entries only: no wildcard, no scheme, no path. */
function parseAllowlist(allow) {
  if (!Array.isArray(allow) || allow.length === 0 || allow.length > MAX_ALLOWLIST) invalid('allowlist must be a bounded, non-empty list');
  const entries = new Set();
  for (const item of allow) {
    const match = typeof item === 'string' ? /^([^:]+):(\d{1,5})$/u.exec(item) : null;
    const port = match ? Number(match[2]) : 0;
    if (!match || !HOST.test(match[1]) || port < 1 || port > 65_535) invalid('allowlist entry must be host:port');
    entries.add(`${match[1]}:${port}`);
  }
  return Object.freeze([...entries].sort());
}

/** The project's own dev server: loopback names on one port. */
const localhostAllowlist = (port) => [`localhost:${port}`, `127.0.0.1:${port}`];

function authority(host, port) {
  return `${host.toLowerCase()}:${port}`;
}

function parseTarget(value, scheme) {
  try {
    const url = new URL(scheme === 'connect' ? `https://${value}` : value);
    if (scheme === 'http' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    const port = url.port ? Number(url.port) : scheme === 'connect' ? 443 : 80;
    return { host: url.hostname.toLowerCase(), port, path: `${url.pathname}${url.search}` };
  } catch {
    return null;
  }
}

function forwardHeaders(headers) {
  const kept = {};
  for (const [name, value] of Object.entries(headers)) if (!HOP_BY_HOP.has(name)) kept[name] = value;
  return kept;
}

async function startEnvironmentEgressBroker({
  allow,
  directory,
  maxConnections = MAX_CONNECTIONS,
  maxRequestBytes = MAX_REQUEST_BYTES,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  const allowlist = parseAllowlist(allow);
  const allowed = new Set(allowlist);
  const ownsDirectory = directory === undefined;
  const root = ownsDirectory ? fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-browser-egress-')) : directory;
  fs.chmodSync(root, 0o700);
  const socketPath = path.join(root, 'egress.sock');
  const events = [];
  const counts = { allowed: 0, denied: 0 };
  const lost = { allowed: 0, denied: 0 };
  const record = (event) => {
    const kind = event.decision === 'denied' ? 'denied' : 'allowed';
    if (counts[kind] >= (kind === 'denied' ? MAX_DENIED_EVENTS : MAX_EVENTS)) {
      lost[kind] += 1;
      return;
    }
    counts[kind] += 1;
    events.push(Object.freeze({ at: now().toISOString(), ...event }));
  };
  const decide = (method, target) => {
    if (!target) {
      record({ decision: 'denied', method, reason: 'malformed_target' });
      return false;
    }
    if (!allowed.has(authority(target.host, target.port))) {
      record({ decision: 'denied', method, host: target.host, port: target.port, reason: 'host_not_allowed' });
      return false;
    }
    return true;
  };

  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  const server = http.createServer((request, response) => {
    const target = parseTarget(request.url, 'http');
    if (!decide(request.method, target)) {
      response.writeHead(403, { 'content-type': 'application/json', [DENIED_HEADER]: 'denied' });
      response.end('{"error":"egress_denied"}');
      request.resume();
      return;
    }
    if (Number(request.headers['content-length'] ?? 0) > maxRequestBytes) {
      record({ decision: 'denied', method: request.method, host: target.host, port: target.port, reason: 'request_too_large' });
      response.writeHead(413).end();
      request.resume();
      return;
    }
    const upstream = http.request({
      host: target.host,
      port: target.port,
      method: request.method,
      path: target.path,
      // The Host header is rewritten from the validated target: the client cannot pick the virtual host.
      headers: { ...forwardHeaders(request.headers), host: target.port === 80 ? target.host : `${target.host}:${target.port}` },
      timeout: idleTimeoutMs,
    });
    let received = 0;
    request.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxRequestBytes) upstream.destroy();
    });
    upstream.once('response', (answer) => {
      response.writeHead(answer.statusCode, forwardHeaders(answer.headers));
      let sent = 0;
      answer.on('data', (chunk) => {
        sent += chunk.length;
        if (sent > maxResponseBytes) {
          record({
            decision: 'allowed',
            method: request.method,
            host: target.host,
            port: target.port,
            reason: 'response_cut',
            bytes: sent,
          });
          answer.destroy();
          response.destroy();
        } else {
          response.write(chunk);
        }
      });
      answer.once('end', () => {
        record({
          decision: 'allowed',
          method: request.method,
          host: target.host,
          port: target.port,
          status: answer.statusCode,
          bytes: sent,
        });
        response.end();
      });
    });
    upstream.once('timeout', () => upstream.destroy());
    upstream.once('error', () => {
      record({ decision: 'allowed', method: request.method, host: target.host, port: target.port, reason: 'upstream_failed' });
      if (response.headersSent) response.destroy();
      else response.writeHead(502).end();
    });
    request.pipe(upstream);
  });

  server.on('connect', (request, clientSocket, head) => {
    const target = parseTarget(request.url, 'connect');
    if (!decide('CONNECT', target)) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n');
      return;
    }
    const upstream = net.connect(target.port, target.host);
    let bytes = 0;
    const finish = () => {
      clientSocket.destroy();
      upstream.destroy();
    };
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
      record({ decision: 'allowed', method: 'CONNECT', host: target.host, port: target.port });
    });
    for (const socket of [upstream, clientSocket]) {
      socket.setTimeout(idleTimeoutMs, finish);
      socket.once('error', finish);
      socket.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxResponseBytes + maxRequestBytes) finish();
      });
    }
  });

  server.on('connection', track);
  server.maxConnections = maxConnections;
  server.requestTimeout = idleTimeoutMs;
  server.headersTimeout = Math.min(idleTimeoutMs, 15_000);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    fs.chmodSync(socketPath, 0o600);
  } catch (error) {
    if (ownsDirectory) fs.rmSync(root, { recursive: true, force: true });
    throw new EnvironmentEgressBrokerError('egress broker could not start', 'ENV_BROWSER_EGRESS_START_FAILED', { cause: error });
  }

  let closing = null;
  return Object.freeze({
    directory: root,
    socketPath,
    allow: allowlist,
    /** Events recorded since the last drain, oldest first. */
    drain() {
      counts.allowed = 0;
      counts.denied = 0;
      return events.splice(0);
    },
    /** Events that exceeded their ceiling since the last call, per kind: a cut is visible, never silent. */
    dropped() {
      const report = { ...lost };
      lost.allowed = 0;
      lost.denied = 0;
      return Object.freeze(report);
    },
    close() {
      closing ||= new Promise((resolve) => {
        server.close(resolve);
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
      }).finally(() => {
        if (ownsDirectory) fs.rmSync(root, { recursive: true, force: true });
      });
      return closing;
    },
  });
}

module.exports = {
  EnvironmentEgressBrokerError,
  DENIED_HEADER,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  localhostAllowlist,
  parseAllowlist,
  startEnvironmentEgressBroker,
};
