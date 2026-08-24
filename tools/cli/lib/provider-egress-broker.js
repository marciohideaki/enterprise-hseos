'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const CLOSE_GRACE_MS = 1000;
const BROKER_ROUTE = '/provider/chat/completions';
const MAX_SECRET_BYTES = 16_384;

class ProviderEgressBrokerError extends Error {
  constructor(message, code = 'PROVIDER_EGRESS_BROKER_INVALID') {
    super(message);
    this.name = 'ProviderEgressBrokerError';
    this.code = code;
  }
}

function upstreamUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new ProviderEgressBrokerError('broker base URL is invalid');
  }
  let endpoint;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new ProviderEgressBrokerError('broker base URL is invalid');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new ProviderEgressBrokerError('broker base URL must be a credential-free HTTP(S) endpoint');
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/chat/completions`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.href;
}

async function readBounded(stream, limit = MAX_REQUEST_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new ProviderEgressBrokerError('broker request exceeds its byte limit', 'PROVIDER_EGRESS_REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendError(response, status, code) {
  if (response.headersSent) return response.destroy();
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(`${JSON.stringify({ error: { code } })}\n`);
}

async function settleBounded(operations, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      Promise.allSettled(operations),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function protectedHeader(headers, name, secretBytes) {
  const value = headers.get(name);
  if (value === null) return null;
  const normalized = String(value);
  if (Buffer.from(normalized, 'utf8').includes(secretBytes)) {
    throw new ProviderEgressBrokerError('provider response contains a protected value', 'PROVIDER_EGRESS_SECRET_EXPOSURE');
  }
  return normalized;
}

async function relayProtectedResponse(upstream, response, secret) {
  const secretBytes = Buffer.from(secret, 'utf8');
  const contentType = protectedHeader(upstream.headers, 'content-type', secretBytes) || 'application/octet-stream';
  const requestId = protectedHeader(upstream.headers, 'x-request-id', secretBytes);
  let headersWritten = false;
  const writeHeaders = () => {
    if (headersWritten) return;
    headersWritten = true;
    response.writeHead(upstream.status, {
      'content-type': contentType,
      ...(requestId ? { 'x-request-id': requestId } : {}),
    });
  };
  let size = 0;
  let pending = Buffer.alloc(0);
  if (upstream.body) {
    for await (const value of upstream.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) throw new ProviderEgressBrokerError('broker response exceeds its byte limit');
      const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      if (combined.includes(secretBytes)) {
        throw new ProviderEgressBrokerError('provider response contains a protected value', 'PROVIDER_EGRESS_SECRET_EXPOSURE');
      }
      const safeLength = Math.max(0, combined.length - (secretBytes.length - 1));
      if (safeLength > 0) {
        writeHeaders();
        if (!response.write(combined.subarray(0, safeLength))) {
          await new Promise((resolve) => response.once('drain', resolve));
        }
      }
      pending = Buffer.from(combined.subarray(safeLength));
    }
  }
  writeHeaders();
  if (pending.length > 0) response.write(pending);
  response.end();
}

async function forward(request, response, { endpointUrl, secret, fetchImpl, timeoutMs, activeControllers }) {
  if (request.method !== 'POST' || request.url !== BROKER_ROUTE) return sendError(response, 404, 'route_not_allowed');
  if (request.headers.authorization || request.headers['x-forwarded-host'] || request.headers['x-provider-url']) {
    return sendError(response, 400, 'credential_or_endpoint_override_rejected');
  }
  let body;
  try {
    body = await readBounded(request);
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid request envelope');
    if (body.includes(Buffer.from(secret, 'utf8'))) {
      throw new ProviderEgressBrokerError('broker request contains a protected value', 'PROVIDER_EGRESS_SECRET_EXPOSURE');
    }
  } catch (error) {
    const status = error?.code === 'PROVIDER_EGRESS_REQUEST_TOO_LARGE' ? 413 : 400;
    const code =
      status === 413
        ? 'request_too_large'
        : error?.code === 'PROVIDER_EGRESS_SECRET_EXPOSURE'
          ? 'protected_value_rejected'
          : 'invalid_json';
    return sendError(response, status, code);
  }
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortOnDisconnect = () => controller.abort();
  response.once('close', abortOnDisconnect);
  timer.unref?.();
  try {
    const upstream = await fetchImpl(endpointUrl, {
      method: 'POST',
      headers: { accept: 'text/event-stream', authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      throw new ProviderEgressBrokerError('provider redirect is forbidden');
    }
    await relayProtectedResponse(upstream, response, secret);
  } catch {
    sendError(response, 502, 'provider_request_failed');
  } finally {
    clearTimeout(timer);
    response.off('close', abortOnDisconnect);
    activeControllers.delete(controller);
  }
}

async function startProviderEgressBroker({
  baseUrl,
  secret,
  fetchImpl = Reflect.get(globalThis, 'fetch'),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  directory,
}) {
  const secretBytes = typeof secret === 'string' ? Buffer.byteLength(secret, 'utf8') : 0;
  if (
    secretBytes === 0 ||
    secretBytes > MAX_SECRET_BYTES ||
    [...secret].some((character) => character.codePointAt(0) <= 31 || character.codePointAt(0) === 127) ||
    typeof fetchImpl !== 'function'
  ) {
    throw new ProviderEgressBrokerError('broker requires an upstream secret and fetch implementation');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ProviderEgressBrokerError('broker timeout is invalid');
  }
  const endpointUrl = upstreamUrl(baseUrl);
  const ownsDirectory = directory === undefined;
  directory = directory || fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-provider-broker-'));
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProviderEgressBrokerError('broker directory must be a real directory');
  fs.chmodSync(directory, 0o700);
  const socketPath = path.join(directory, 'provider.sock');
  const activeControllers = new Set();
  const activeForwards = new Set();
  const server = http.createServer((request, response) => {
    const operation = forward(request, response, { endpointUrl, secret, fetchImpl, timeoutMs, activeControllers }).catch(() =>
      response.destroy(),
    );
    activeForwards.add(operation);
    void operation.finally(() => activeForwards.delete(operation));
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.maxConnections = 1;
  server.requestTimeout = timeoutMs;
  server.headersTimeout = Math.min(timeoutMs, 15_000);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    fs.chmodSync(socketPath, 0o600);
  } catch (error) {
    if (ownsDirectory) fs.rmSync(directory, { recursive: true, force: true });
    throw new ProviderEgressBrokerError('provider egress broker could not start', 'PROVIDER_EGRESS_BROKER_START_FAILED', { cause: error });
  }
  let closePromise = null;
  return Object.freeze({
    directory,
    socketPath,
    close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        try {
          await new Promise((resolve) => {
            server.close(resolve);
            for (const controller of activeControllers) controller.abort();
            for (const socket of sockets) socket.destroy();
            server.closeAllConnections?.();
          });
          await settleBounded(activeForwards, CLOSE_GRACE_MS);
        } finally {
          if (ownsDirectory) fs.rmSync(directory, { recursive: true, force: true });
        }
      })();
      return closePromise;
    },
  });
}

function createUnixSocketFetch(socketPath) {
  if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) {
    throw new ProviderEgressBrokerError('broker socket path must be absolute');
  }
  return async (_url, init = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath,
          path: BROKER_ROUTE,
          method: 'POST',
          headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
        },
        (response) => {
          const headers = { get: (name) => response.headers[String(name).toLowerCase()] || null };
          resolve({
            status: response.statusCode,
            statusText: response.statusMessage,
            ok: response.statusCode >= 200 && response.statusCode < 300,
            headers,
            body: response,
            async text() {
              return (await readBounded(response, MAX_RESPONSE_BYTES)).toString('utf8');
            },
          });
        },
      );
      request.once('error', reject);
      if (init.signal) {
        if (init.signal.aborted) request.destroy(new DOMException('aborted', 'AbortError'));
        else init.signal.addEventListener('abort', () => request.destroy(new DOMException('aborted', 'AbortError')), { once: true });
      }
      request.end(init.body);
    });
}

module.exports = {
  BROKER_ROUTE,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_SECRET_BYTES,
  MAX_TIMEOUT_MS,
  ProviderEgressBrokerError,
  createUnixSocketFetch,
  startProviderEgressBroker,
  upstreamUrl,
};
