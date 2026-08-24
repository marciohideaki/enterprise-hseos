'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 120_000;
const BROKER_ROUTE = '/provider/chat/completions';

class ProviderEgressBrokerError extends Error {
  constructor(message, code = 'PROVIDER_EGRESS_BROKER_INVALID') {
    super(message);
    this.name = 'ProviderEgressBrokerError';
    this.code = code;
  }
}

function upstreamUrl(baseUrl) {
  const endpoint = new URL(baseUrl);
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

async function forward(request, response, { baseUrl, secret, fetchImpl, timeoutMs }) {
  if (request.method !== 'POST' || request.url !== BROKER_ROUTE) return sendError(response, 404, 'route_not_allowed');
  if (request.headers.authorization || request.headers['x-forwarded-host'] || request.headers['x-provider-url']) {
    return sendError(response, 400, 'credential_or_endpoint_override_rejected');
  }
  let body;
  try {
    body = await readBounded(request);
    JSON.parse(body.toString('utf8'));
  } catch (error) {
    const status = error?.code === 'PROVIDER_EGRESS_REQUEST_TOO_LARGE' ? 413 : 400;
    return sendError(response, status, status === 413 ? 'request_too_large' : 'invalid_json');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const upstream = await fetchImpl(upstreamUrl(baseUrl), {
      method: 'POST',
      headers: { accept: 'text/event-stream', authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      ...(upstream.headers.get('x-request-id') ? { 'x-request-id': upstream.headers.get('x-request-id') } : {}),
    });
    let size = 0;
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) throw new ProviderEgressBrokerError('broker response exceeds its byte limit');
        if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve));
      }
    }
    response.end();
  } catch {
    sendError(response, 502, 'provider_request_failed');
  } finally {
    clearTimeout(timer);
  }
}

async function startProviderEgressBroker({
  baseUrl,
  secret,
  fetchImpl = Reflect.get(globalThis, 'fetch'),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  directory,
}) {
  if (typeof secret !== 'string' || secret.length === 0 || typeof fetchImpl !== 'function') {
    throw new ProviderEgressBrokerError('broker requires an upstream secret and fetch implementation');
  }
  const ownsDirectory = directory === undefined;
  directory = directory || fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-provider-broker-'));
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProviderEgressBrokerError('broker directory must be a real directory');
  fs.chmodSync(directory, 0o700);
  const socketPath = path.join(directory, 'provider.sock');
  const server = http.createServer((request, response) => void forward(request, response, { baseUrl, secret, fetchImpl, timeoutMs }));
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
  let closed = false;
  return Object.freeze({
    directory,
    socketPath,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => server.close(resolve));
      if (ownsDirectory) fs.rmSync(directory, { recursive: true, force: true });
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
  ProviderEgressBrokerError,
  createUnixSocketFetch,
  startProviderEgressBroker,
  upstreamUrl,
};
