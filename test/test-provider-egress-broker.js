'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const {
  BROKER_ROUTE,
  createUnixSocketFetch,
  startProviderEgressBroker,
} = require('../tools/cli/lib/provider-egress-broker');

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
    body: JSON.stringify({ model: 'fixed-by-binding', messages: [] }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /\[DONE\]/);
  assert.deepEqual(observed, [
    {
      authorization: 'Bearer host-only-secret',
      body: { model: 'fixed-by-binding', messages: [] },
      url: '/v1/chat/completions',
    },
  ]);
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
  assert.equal(observed.length, 0);
});
