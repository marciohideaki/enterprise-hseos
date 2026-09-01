'use strict';

const http = require('node:http');
const { createHttpRouter } = require('./lib/interfaces/http/router');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

function createManagedGovernanceServer(options = {}) {
  const repository = options.repository || null;
  const router = createHttpRouter(options);
  const sockets = new Map();
  let state = 'created';
  let closePromise = null;
  const server = http.createServer({ requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5000 }, (request, response) => {
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
  server.on('connection', (socket) => {
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
      if (!LOOPBACK_HOSTS.has(host)) throw new Error('managed governance server requires a loopback host');
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

module.exports = { LOOPBACK_HOSTS, createManagedGovernanceServer };
