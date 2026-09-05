'use strict';

const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { createHttpRouter } = require('./lib/interfaces/http/router');
const { createStaticAssetHandler } = require('./lib/interfaces/http/static-assets');
const { createNetworkAdmission } = require('./lib/network/admission');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const MAX_PEM_BYTES = 32 * 1024;

// FR-020's "transport-protection contract" is a real control, not a declared-but-inert config
// field: a shared-network profile whose transport.mode is 'direct-tls' gets its listener actually
// wrapped in TLS using the certificate and private key the referenced environment variables hold
// (never a literal in configuration -- NFR-010). 'terminated-upstream' keeps this server on plain
// HTTP deliberately: that mode declares TLS is terminated by an operator-controlled reverse proxy
// in front of it, a topology this process cannot see or enforce itself.
function resolveTlsCredentials(transport, environment) {
  const certificatePem = environment[transport.certificate_ref_env];
  const privateKeyPem = environment[transport.private_key_ref_env];
  if (typeof certificatePem !== 'string' || certificatePem.length === 0 || Buffer.byteLength(certificatePem, 'utf8') > MAX_PEM_BYTES) {
    throw new Error(`managed governance direct-tls certificate is required in ${transport.certificate_ref_env}`);
  }
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length === 0 || Buffer.byteLength(privateKeyPem, 'utf8') > MAX_PEM_BYTES) {
    throw new Error(`managed governance direct-tls private key is required in ${transport.private_key_ref_env}`);
  }
  try {
    // Fails closed on a malformed PEM pair or a certificate/key that don't match -- exactly the
    // class of misconfiguration that must never reach an actual open socket.
    tls.createSecureContext({ cert: certificatePem, key: privateKeyPem });
  } catch (error) {
    throw new Error(`managed governance direct-tls certificate/key pair is invalid: ${error.message}`);
  }
  return { cert: certificatePem, key: privateKeyPem };
}

// Portable and managed-shadow installations bind to loopback by default (FR-019); a caller must
// pass an explicit shared-network options.networkProfile to change that. Never a package CIDR
// default -- this is the ONLY built-in profile, and it carries no allowlist at all because
// loopback admission never consults one (see lib/network/admission.js).
const DEFAULT_LOOPBACK_PROFILE = Object.freeze({
  profile: 'loopback',
  listen_host: null,
  port: null,
  allowed_clients: [],
  trusted_proxies: [],
  transport: null,
  authentication: null,
  rate_limits: null,
});

function createManagedGovernanceServer(options = {}) {
  // Validated -- and therefore able to throw on an incomplete or wildcard shared-network profile,
  // or an invalid direct-tls certificate/key pair -- before this function does anything else:
  // before http.createServer()/https.createServer() is even called, let alone before listen()
  // could open a socket.
  const networkProfile = options.networkProfile || DEFAULT_LOOPBACK_PROFILE;
  const admission = createNetworkAdmission(networkProfile);
  const transport = admission.profile === 'shared-network' ? networkProfile.transport : null;
  const tlsCredentials = transport?.mode === 'direct-tls' ? resolveTlsCredentials(transport, options.environment || process.env) : null;
  const repository = options.repository || null;
  const router = createHttpRouter(options);
  const serveStatic = options.serveStatic || createStaticAssetHandler(options);
  const sockets = new Map();
  let state = 'created';
  let closePromise = null;
  const serverOptions = tlsCredentials
    ? { requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5000, ...tlsCredentials }
    : { requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5000 };
  const createServer = tlsCredentials ? https.createServer : http.createServer;
  const server = createServer(serverOptions, (request, response) => {
    try {
      if (serveStatic(request, response)) return;
    } catch {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
      response.end('Console asset unavailable');
      return;
    }
    const socket = request.socket;
    sockets.set(socket, (sockets.get(socket) || 0) + 1);
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      const remaining = Math.max(0, (sockets.get(socket) || 1) - 1);
      sockets.set(socket, remaining);
      if (state === 'draining' && remaining === 0) socket.destroy();
    };
    response.once('finish', settle);
    response.once('close', settle);
    router(request, response).catch(() => response.destroy());
  });
  // Admission runs on the raw TCP connection, before any HTTP request line is even parsed --
  // "disallowed peers never reach handlers" (T09 acceptance criterion) means never, not "never
  // past routing." A denied peer's socket never enters the bookkeeping map at all.
  server.on('connection', (socket) => {
    const decision = admission.admit(socket.remoteAddress);
    if (!decision.allow) {
      socket.destroy();
      return;
    }
    sockets.set(socket, 0);
    socket.once('close', () => sockets.delete(socket));
  });

  return Object.freeze({
    get state() {
      return state;
    },
    address() {
      return server.address();
    },
    async listen(listenOptions = {}) {
      if (state !== 'created') throw new Error('managed governance server can only listen once');
      const host = listenOptions.host || '127.0.0.1';
      const port = listenOptions.port === undefined ? 0 : listenOptions.port;
      if (admission.profile === 'loopback') {
        if (!LOOPBACK_HOSTS.has(host)) throw new Error('managed governance server requires a loopback host');
      } else if (host !== admission.listenHost || listenOptions.port !== admission.listenPort) {
        // 0.0.0.0 is accepted here on exactly the same terms as any other shared-network host --
        // it is never a shortcut past the profile's own validated listen_host/port.
        throw new Error('managed governance server host and port must match the shared-network profile listener');
      }
      if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('managed governance server port is invalid');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host, port, exclusive: true }, () => {
          server.off('error', reject);
          resolve();
        });
      });
      state = 'listening';
      return server.address();
    },
    async close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        state = 'draining';
        for (const [socket, activeRequests] of sockets) {
          if (activeRequests === 0) socket.destroy();
        }
        server.closeIdleConnections?.();
        if (server.listening) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        if (repository && typeof repository.close === 'function') await repository.close();
        state = 'closed';
      })();
      return closePromise;
    },
  });
}

module.exports = { DEFAULT_LOOPBACK_PROFILE, LOOPBACK_HOSTS, createManagedGovernanceServer };
