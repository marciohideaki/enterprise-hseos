'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const { BROKER_ROUTE, createUnixSocketFetch, startProviderEgressBroker } = require('../tools/cli/lib/provider-egress-broker');

async function upstream(t, observed) {
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      observed.push({ authorization: request.headers.authorization, body: JSON.parse(body), url: request.url });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'broker-test' });
      response.end('data: {"choices":[]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

function directRequest(socketPath, options, body = '{}') {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, ...options }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

test('Unix broker pins endpoint and injects the supervisor-owned credential', async (t) => {
  const observed = [];
  const port = await upstream(t, observed);
  const broker = await startProviderEgressBroker({ baseUrl: `http://127.0.0.1:${port}/v1`, secret: 'host-only-secret' });
  t.after(() => broker.close());
  const brokerFetch = createUnixSocketFetch(broker.socketPath);
  const response = await brokerFetch('https://attacker.invalid/override', {
    method: 'POST',
    headers: { authorization: 'Bearer worker-visible-secret', 'x-provider-url': 'https://attacker.invalid' },
    body: JSON.stringify({ model: 'fixed-by-binding', messages: [{ role: 'user', content: 'HSEOS_MASKED_SENTINEL' }] }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /\[DONE\]/);
  assert.deepEqual(observed, [
    {
      authorization: 'Bearer host-only-secret',
      body: { model: 'fixed-by-binding', messages: [{ role: 'user', content: 'HSEOS_MASKED_SENTINEL' }] },
      url: '/v1/chat/completions',
    },
  ]);
});

test('broker rejects credential-bearing endpoints, unsafe secrets, and upstream redirects', async (t) => {
  await assert.rejects(
    () => startProviderEgressBroker({ baseUrl: 'https://user:password@example.test/v1', secret: 'host-secret' }),
    /credential-free HTTP\(S\) endpoint/,
  );
  await assert.rejects(
    () => startProviderEgressBroker({ baseUrl: 'file:///tmp/provider', secret: 'host-secret' }),
    /credential-free HTTP\(S\) endpoint/,
  );
  await assert.rejects(
    () => startProviderEgressBroker({ baseUrl: 'https://example.test/v1', secret: 'unsafe\nheader' }),
    /upstream secret/,
  );
  await assert.rejects(
    () => startProviderEgressBroker({ baseUrl: 'https://example.test/v1', secret: 'host-secret', timeoutMs: 0 }),
    /timeout is invalid/,
  );

  const observed = [];
  const broker = await startProviderEgressBroker({
    baseUrl: 'https://provider.example/v1',
    secret: 'host-secret',
    fetchImpl: async (url, init) => {
      observed.push({ url, authorization: init.headers.authorization, redirect: init.redirect });
      return {
        status: 307,
        headers: { get: (name) => (name === 'location' ? 'https://attacker.invalid/collect' : null) },
        body: null,
      };
    },
  });
  t.after(() => broker.close());
  const result = await directRequest(
    broker.socketPath,
    { method: 'POST', path: BROKER_ROUTE, headers: { 'content-type': 'application/json' } },
    '{}',
  );
  assert.equal(result.status, 502);
  assert.deepEqual(observed, [
    {
      url: 'https://provider.example/v1/chat/completions',
      authorization: 'Bearer host-secret',
      redirect: 'manual',
    },
  ]);
});

test('broker close destroys a partial client instead of waiting without a bound', async () => {
  const broker = await startProviderEgressBroker({
    baseUrl: 'https://provider.example/v1',
    secret: 'host-secret',
    timeoutMs: 1000,
    fetchImpl: async () => {
      throw new Error('partial request must never reach upstream');
    },
  });
  const request = http.request({
    socketPath: broker.socketPath,
    path: BROKER_ROUTE,
    method: 'POST',
    headers: { 'content-length': '100', 'content-type': 'application/json' },
  });
  request.on('error', () => {});
  await new Promise((resolve) => request.once('socket', (socket) => (socket.connecting ? socket.once('connect', resolve) : resolve())));
  request.write('{');
  const result = await Promise.race([
    broker.close().then(() => 'closed'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 250)),
  ]);
  assert.equal(result, 'closed');
  await broker.close();
});

test('broker close directly aborts and settles an active upstream operation', async () => {
  let observedSignal;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const broker = await startProviderEgressBroker({
    baseUrl: 'https://provider.example/v1',
    secret: 'host-secret',
    fetchImpl: async (_url, init) => {
      observedSignal = init.signal;
      markStarted();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });
  const pendingRequest = directRequest(
    broker.socketPath,
    { method: 'POST', path: BROKER_ROUTE, headers: { 'content-type': 'application/json' } },
    '{}',
  );
  await started;
  await broker.close();
  assert.equal(observedSignal.aborted, true);
  await assert.rejects(pendingRequest);
});

test('broker blocks an echoed credential in response headers and across streaming chunks', async (t) => {
  let call = 0;
  const broker = await startProviderEgressBroker({
    baseUrl: 'https://provider.example/v1',
    secret: 'host-only-secret',
    fetchImpl: async () => {
      call += 1;
      if (call === 1) {
        return {
          status: 200,
          headers: { get: (name) => (name === 'x-request-id' ? 'echo-host-only-secret' : 'text/event-stream') },
          body: null,
        };
      }
      return {
        status: 200,
        headers: { get: (name) => (name === 'content-type' ? 'text/event-stream' : null) },
        body: (async function* body() {
          yield Buffer.from('host-only-');
          yield Buffer.from('secret');
        })(),
      };
    },
  });
  t.after(() => broker.close());
  const request = () =>
    directRequest(broker.socketPath, { method: 'POST', path: BROKER_ROUTE, headers: { 'content-type': 'application/json' } }, '{}');
  assert.equal((await request()).status, 502);
  assert.equal((await request()).status, 502);
});

test('Unix broker rejects unapproved routes and credential override headers', async (t) => {
  const observed = [];
  const port = await upstream(t, observed);
  const broker = await startProviderEgressBroker({ baseUrl: `http://127.0.0.1:${port}/v1`, secret: 'host-only-secret' });
  t.after(() => broker.close());
  const route = await directRequest(broker.socketPath, { method: 'POST', path: '/arbitrary' });
  assert.equal(route.status, 404);
  const credential = await directRequest(broker.socketPath, {
    method: 'POST',
    path: BROKER_ROUTE,
    headers: { authorization: 'Bearer forbidden' },
  });
  assert.equal(credential.status, 400);
  assert.equal(observed.length, 0);
});

test('Unix broker rejects malformed request bodies before upstream egress', async (t) => {
  const observed = [];
  const port = await upstream(t, observed);
  const broker = await startProviderEgressBroker({ baseUrl: `http://127.0.0.1:${port}/v1`, secret: 'host-only-secret' });
  t.after(() => broker.close());
  const result = await directRequest(broker.socketPath, { method: 'POST', path: BROKER_ROUTE }, '{');
  assert.equal(result.status, 400);
  const protectedValue = await directRequest(
    broker.socketPath,
    { method: 'POST', path: BROKER_ROUTE },
    JSON.stringify({ messages: [{ content: 'host-only-secret' }] }),
  );
  assert.equal(protectedValue.status, 400);
  assert.match(protectedValue.body, /protected_value_rejected/);
  assert.equal(observed.length, 0);
});
