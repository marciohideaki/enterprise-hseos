'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDraftManager } = require('../../tools/managed-governance-control-plane/lib/application/manage-draft');
const { createPublicationRequester } = require('../../tools/managed-governance-control-plane/lib/application/request-publication');
const { createDevelopmentAuth, createStaticAuth } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/auth');
const { ROUTES, mapError } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/router');
const { createManagedGovernanceServer } = require('../../tools/managed-governance-control-plane/server');

const ACTOR = { type: 'automation', id: 'http-test', roles: ['administrator'] };

function routeServices(overrides = {}) {
  return Object.fromEntries([
    ...[...new Set(ROUTES.map((route) => route.handler))].map((handler) => [
      handler,
      async (input, context) => ({ handler, input, actor: context.actor }),
    ]),
    ...Object.entries(overrides),
  ]);
}

async function startServer(options = {}) {
  const server = createManagedGovernanceServer({
    services: routeServices(options.services),
    auth: options.auth || createStaticAuth(ACTOR),
    repository: options.repository,
    maximumBodyBytes: options.maximumBodyBytes,
    timeoutMs: options.timeoutMs,
  });
  const address = await server.listen();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function request(baseUrl, method, pathname, body) {
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, envelope: await response.json() };
}

test('every designed endpoint returns the canonical v1 envelope', async () => {
  const { server, baseUrl } = await startServer();
  const endpoints = [
    ['GET', '/health'],
    ['GET', '/api/v1/artifacts?limit=10&cursor=abc&type=policy'],
    ['GET', '/api/v1/artifacts/policy%3Aone'],
    ['GET', '/api/v1/artifacts/policy%3Aone/versions?limit=10'],
    ['GET', '/api/v1/rules?limit=10'],
    ['POST', '/api/v1/policy/evaluate', {}],
    ['POST', '/api/v1/imports/plan', {}],
    ['POST', '/api/v1/imports', {}],
    ['POST', '/api/v1/drafts', {}],
    ['PATCH', '/api/v1/drafts/draft-1', { optimistic_version: 1 }],
    ['POST', '/api/v1/drafts/draft-1/submit', {}],
    ['POST', '/api/v1/drafts/draft-1/review', { decision: 'approved' }],
    ['POST', '/api/v1/drafts/draft-1/publication-request', {}],
    ['GET', '/api/v1/audit?limit=10'],
  ];
  try {
    for (const [method, pathname, body] of endpoints) {
      const { response, envelope } = await request(baseUrl, method, pathname, body);
      assert.equal(response.status, 200, `${method} ${pathname}`);
      assert.deepEqual(Object.keys(envelope), ['schema_version', 'ok', 'data', 'error', 'evidence', 'warnings']);
      assert.equal(envelope.schema_version, 1);
      assert.equal(envelope.ok, true);
      assert.equal(envelope.error, null);
    }
  } finally {
    await server.close();
  }
});

test('mutations and audit reject anonymous requests while read-only planning stays available', async () => {
  const server = createManagedGovernanceServer({ services: routeServices() });
  const address = await server.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const mutation = await request(baseUrl, 'POST', '/api/v1/imports', {});
    assert.equal(mutation.response.status, 401);
    assert.equal(mutation.envelope.error.code, 'unauthorized');
    const audit = await request(baseUrl, 'GET', '/api/v1/audit');
    assert.equal(audit.response.status, 401);
    const plan = await request(baseUrl, 'POST', '/api/v1/imports/plan', {});
    assert.equal(plan.response.status, 200);
    assert.equal(plan.envelope.data.actor, null);
  } finally {
    await server.close();
  }
});

test('routing, pagination, body limits and domain failures use stable error codes', async () => {
  const services = {
    applyImport: async (input) => {
      const error = new Error('conflicting import');
      error.code = input.failure;
      throw error;
    },
  };
  const { server, baseUrl } = await startServer({ services, maximumBodyBytes: 1024 });
  try {
    const unknown = await request(baseUrl, 'GET', '/api/v1/unknown');
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.envelope.error.code, 'not_found');
    const pagination = await request(baseUrl, 'GET', '/api/v1/artifacts?limit=101');
    assert.equal(pagination.response.status, 400);
    assert.equal(pagination.envelope.error.code, 'invalid_request');
    const oversized = await request(baseUrl, 'POST', '/api/v1/imports', { value: 'x'.repeat(1100) });
    assert.equal(oversized.response.status, 413);
    assert.equal(oversized.envelope.error.code, 'request_too_large');
    const conflict = await request(baseUrl, 'POST', '/api/v1/imports', {
      failure: 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.envelope.error.code, 'conflict');
    const unavailable = mapError({ code: 'MANAGED_GOVERNANCE_DATABASE_FAILED', message: 'connection details' });
    assert.deepEqual(unavailable, {
      code: 'database_unavailable',
      message: 'control-plane database is unavailable',
    });
    assert.equal(mapError(new Error('sensitive detail')).message, 'internal control-plane error');
  } finally {
    await server.close();
  }
});

test('health carries distinct migration and projection readiness without flattening state', async () => {
  const health = {
    live: true,
    ready: false,
    migration: { state: 'required', current: '0001', target: '0002' },
    projection: { state: 'stale', lag: 3 },
  };
  const { server, baseUrl } = await startServer({ services: { health: async () => health } });
  try {
    const response = await request(baseUrl, 'GET', '/health');
    assert.deepEqual(response.envelope.data, health);
  } finally {
    await server.close();
  }
});

test('deadline aborts a non-settling handler with a stable timeout', async () => {
  const { server, baseUrl } = await startServer({
    timeoutMs: 100,
    services: { evaluatePolicy: async () => new Promise(() => {}) },
  });
  try {
    const response = await request(baseUrl, 'POST', '/api/v1/policy/evaluate', {});
    assert.equal(response.response.status, 504);
    assert.equal(response.envelope.error.code, 'request_timeout');
  } finally {
    await server.close();
  }
});

test('invalid or cyclic service output fails as a sanitized internal error', async () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const { server, baseUrl } = await startServer({ services: { health: async () => cyclic } });
  try {
    const response = await request(baseUrl, 'GET', '/health');
    assert.equal(response.response.status, 500);
    assert.equal(response.envelope.error.code, 'internal_error');
    assert.equal(response.envelope.error.message, 'internal control-plane error');
  } finally {
    await server.close();
  }
});

test('graceful shutdown drains an active request and closes repository resources once', async () => {
  let release;
  let started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const repository = {
    closeCalls: 0,
    async close() {
      this.closeCalls += 1;
    },
  };
  const { server, baseUrl } = await startServer({
    repository,
    services: {
      health: async () => {
        started();
        return new Promise((resolve) => {
          release = () => resolve({ live: true, ready: true });
        });
      },
    },
  });
  const inFlight = request(baseUrl, 'GET', '/health');
  await startedPromise;
  const closing = server.close();
  assert.equal(server.state, 'draining');
  release();
  assert.equal((await inFlight).response.status, 200);
  await closing;
  await server.close();
  assert.equal(server.state, 'closed');
  assert.equal(repository.closeCalls, 1);
});

test('server refuses non-loopback binding', async () => {
  const server = createManagedGovernanceServer({ services: routeServices() });
  await assert.rejects(server.listen({ host: '0.0.0.0', port: 0 }), /loopback/);
  await server.close();
});

test('development authentication requires both explicit configuration and the environment gate', async () => {
  const previous = process.env.HSEOS_GOVERNANCE_DEV_AUTH;
  const requestFixture = {
    headers: {
      authorization: 'Bearer 1234567890abcdef',
      'x-hseos-actor-type': 'automation',
      'x-hseos-actor-id': 'development-test',
    },
  };
  try {
    delete process.env.HSEOS_GOVERNANCE_DEV_AUTH;
    const disabled = createDevelopmentAuth({ enabled: true, token: '1234567890abcdef' });
    await assert.rejects(disabled.authenticate(requestFixture), (error) => error.code === 'unauthorized');
    process.env.HSEOS_GOVERNANCE_DEV_AUTH = 'true';
    const enabled = createDevelopmentAuth({ enabled: true, token: '1234567890abcdef' });
    assert.equal((await enabled.authenticate(requestFixture)).id, 'development-test');
  } finally {
    if (previous === undefined) delete process.env.HSEOS_GOVERNANCE_DEV_AUTH;
    else process.env.HSEOS_GOVERNANCE_DEV_AUTH = previous;
  }
});

test('draft and publication application ports preserve authenticated context', async () => {
  const calls = [];
  const draftStore = Object.fromEntries(
    ['create', 'update', 'submit', 'review'].map((method) => [
      method,
      async (input, context) => {
        calls.push({ method, input, context });
        return { method };
      },
    ]),
  );
  const manager = createDraftManager(draftStore);
  const context = { actor: ACTOR };
  assert.deepEqual(await manager.create({ title: 'Draft' }, context), { method: 'create' });
  assert.deepEqual(await manager.update({ id: 'draft-1' }, context), { method: 'update' });
  assert.deepEqual(await manager.submit({ id: 'draft-1' }, context), { method: 'submit' });
  assert.deepEqual(await manager.review({ id: 'draft-1' }, context), { method: 'review' });
  const requester = createPublicationRequester({
    async request(input, requestContext) {
      calls.push({ method: 'publication', input, context: requestContext });
      return { status: 'requested' };
    },
  });
  assert.deepEqual(await requester.request({ id: 'draft-1' }, context), { status: 'requested' });
  assert.ok(calls.every((call) => call.context === context));
  assert.throws(() => createDraftManager({}), /requires create/);
  assert.throws(() => createPublicationRequester({}), /requires request/);
});
