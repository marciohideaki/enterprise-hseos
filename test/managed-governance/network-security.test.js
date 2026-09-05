'use strict';

/* eslint-disable n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ROUTES } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/router');
const { createManagedGovernanceServer } = require('../../tools/managed-governance-control-plane/server');
const { createNetworkAuthentication } = require('../../tools/managed-governance-control-plane/lib/network/authentication');
const { createRateLimiter } = require('../../tools/managed-governance-control-plane/lib/network/rate-limit');
const { AmbiguousForwardingChainError, resolveClientAddress } = require('../../tools/managed-governance-control-plane/lib/network/trusted-proxy');

const QUERY_TOKEN = `query-token-${'q'.repeat(24)}`;
const ADMIN_TOKEN = `admin-token-${'a'.repeat(24)}`;
const ACTOR_HEADERS = { 'x-hseos-actor-type': 'automation', 'x-hseos-actor-id': 'network-security-test' };

function routeServices(overrides = {}) {
  return Object.fromEntries([
    ...[...new Set(ROUTES.map((route) => route.handler))].map((handler) => [handler, async (input, context) => ({ handler, input, actor: context.actor })]),
    ...Object.entries(overrides),
  ]);
}

async function startHardenedServer(hardeningOverrides = {}) {
  const audited = [];
  const networkAuthentication = createNetworkAuthentication({ queryToken: QUERY_TOKEN, adminToken: ADMIN_TOKEN });
  const server = createManagedGovernanceServer({
    services: routeServices(),
    networkAuthentication,
    onNetworkAccessAudit: async (fact) => {
      audited.push(fact);
    },
    ...hardeningOverrides,
  });
  const address = await server.listen();
  return { server, audited, networkAuthentication, baseUrl: `http://127.0.0.1:${address.port}` };
}

function bearer(token) {
  return { authorization: `Bearer ${token}`, ...ACTOR_HEADERS };
}

function jsonBearer(token) {
  return { ...bearer(token), 'content-type': 'application/json' };
}

test('a query-scoped route accepts only the query token, never the admin token', async () => {
  const { server, baseUrl } = await startHardenedServer();
  try {
    const withQuery = await fetch(`${baseUrl}/health`, { headers: bearer(QUERY_TOKEN) });
    assert.equal(withQuery.status, 200);
    const withAdmin = await fetch(`${baseUrl}/health`, { headers: bearer(ADMIN_TOKEN) });
    assert.equal(withAdmin.status, 401);
    const withNothing = await fetch(`${baseUrl}/health`);
    assert.equal(withNothing.status, 401);
  } finally {
    await server.close();
  }
});

test('an admin-scoped route accepts only the admin token, never the query token -- scope confusion fails both ways', async () => {
  const { server, baseUrl, networkAuthentication } = await startHardenedServer();
  try {
    const withAdmin = await fetch(`${baseUrl}/api/v1/drafts`, {
      method: 'POST',
      headers: { ...jsonBearer(ADMIN_TOKEN), 'x-hseos-csrf-token': networkAuthentication.csrfTokenForScope('admin') },
      body: JSON.stringify({ artifact_type: 'standard' }),
    });
    assert.equal(withAdmin.status, 200, await withAdmin.text());
    const withQuery = await fetch(`${baseUrl}/api/v1/drafts`, {
      method: 'POST',
      headers: jsonBearer(QUERY_TOKEN),
      body: JSON.stringify({ artifact_type: 'standard' }),
    });
    assert.equal(withQuery.status, 401);
  } finally {
    await server.close();
  }
});

test('admin mutations require a valid CSRF token; admin reads do not', async () => {
  const { server, baseUrl, networkAuthentication } = await startHardenedServer();
  try {
    const noCsrf = await fetch(`${baseUrl}/api/v1/drafts`, { method: 'POST', headers: jsonBearer(ADMIN_TOKEN), body: JSON.stringify({ artifact_type: 'standard' }) });
    assert.equal(noCsrf.status, 403);
    const wrongCsrf = await fetch(`${baseUrl}/api/v1/drafts`, {
      method: 'POST',
      headers: { ...jsonBearer(ADMIN_TOKEN), 'x-hseos-csrf-token': 'not-the-right-token' },
      body: JSON.stringify({ artifact_type: 'standard' }),
    });
    assert.equal(wrongCsrf.status, 403);
    const correctCsrf = await fetch(`${baseUrl}/api/v1/drafts`, {
      method: 'POST',
      headers: { ...jsonBearer(ADMIN_TOKEN), 'x-hseos-csrf-token': networkAuthentication.csrfTokenForScope('admin') },
      body: JSON.stringify({ artifact_type: 'standard' }),
    });
    assert.equal(correctCsrf.status, 200, await correctCsrf.text());
    // listAudit is GET + protected: an admin read, exempt from CSRF entirely.
    const adminRead = await fetch(`${baseUrl}/api/v1/audit`, { headers: bearer(ADMIN_TOKEN) });
    assert.equal(adminRead.status, 200);
  } finally {
    await server.close();
  }
});

test('the CSRF token is only ever issued to the admin scope, never to query traffic', async () => {
  const { server, baseUrl } = await startHardenedServer();
  try {
    const response = await fetch(`${baseUrl}/health`, { headers: bearer(QUERY_TOKEN) });
    assert.equal(response.headers.get('x-hseos-csrf-token'), null);
  } finally {
    await server.close();
  }
});

test('rate-limit denial is enforced per scope and audited without leaking any secret', async () => {
  const rateLimiter = createRateLimiter({ limitsByScope: { query: 1, admin: 100 } });
  const { server, baseUrl, audited } = await startHardenedServer({ rateLimiter });
  try {
    const first = await fetch(`${baseUrl}/health`, { headers: bearer(QUERY_TOKEN) });
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/health`, { headers: bearer(QUERY_TOKEN) });
    assert.equal(second.status, 429);
    const denied = audited.find((fact) => fact.deny_reason === 'rate_limited');
    assert.ok(denied, 'expected a rate_limited audit fact');
    assert.equal(denied.outcome, 'deny');
    assert.equal(denied.route_scope, 'query');
    const serialized = JSON.stringify(denied);
    assert.doesNotMatch(serialized, new RegExp(QUERY_TOKEN));
    assert.doesNotMatch(serialized, new RegExp(ADMIN_TOKEN));
    assert.doesNotMatch(serialized, /authorization/i);
  } finally {
    await server.close();
  }
});

test('rate limits are tracked independently per scope, so exhausting query never blocks admin', async () => {
  const rateLimiter = createRateLimiter({ limitsByScope: { query: 1, admin: 1 } });
  const { server, baseUrl, networkAuthentication } = await startHardenedServer({ rateLimiter });
  try {
    await fetch(`${baseUrl}/health`, { headers: bearer(QUERY_TOKEN) });
    const queryDenied = await fetch(`${baseUrl}/health`, { headers: bearer(QUERY_TOKEN) });
    assert.equal(queryDenied.status, 429);
    const adminStillAllowed = await fetch(`${baseUrl}/api/v1/drafts`, {
      method: 'POST',
      headers: { ...jsonBearer(ADMIN_TOKEN), 'x-hseos-csrf-token': networkAuthentication.csrfTokenForScope('admin') },
      body: JSON.stringify({ artifact_type: 'standard' }),
    });
    assert.equal(adminStillAllowed.status, 200, await adminStillAllowed.text());
  } finally {
    await server.close();
  }
});

test('no response ever carries a wildcard or reflected CORS header', async () => {
  const { server, baseUrl } = await startHardenedServer({ publicOrigin: 'https://192.168.5.70:4319' });
  try {
    const response = await fetch(`${baseUrl}/health`, { headers: { ...bearer(QUERY_TOKEN), origin: 'https://evil.example' } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const allowed = await fetch(`${baseUrl}/health`, { headers: bearer(QUERY_TOKEN) });
    assert.equal(allowed.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
  }
});

test('a request whose Origin disagrees with the configured public origin is denied', async () => {
  const { server, baseUrl } = await startHardenedServer({ publicOrigin: 'https://192.168.5.70:4319' });
  try {
    const spoofedOrigin = await fetch(`${baseUrl}/health`, { headers: { ...bearer(QUERY_TOKEN), origin: 'https://evil.example' } });
    assert.equal(spoofedOrigin.status, 403);
    const noOrigin = await fetch(`${baseUrl}/health`, { headers: bearer(QUERY_TOKEN) });
    assert.equal(noOrigin.status, 200);
  } finally {
    await server.close();
  }
});

test('end to end: a spoofed X-Forwarded-For from an untrusted real peer never escapes its own rate-limit bucket', async () => {
  // trustedProxyCidrs deliberately excludes the real test client (127.0.0.1) -- every claimed
  // identity below is bogus and must be ignored, attributing both requests to the one real peer.
  const rateLimiter = createRateLimiter({ limitsByScope: { query: 1, admin: 100 } });
  const { server, baseUrl } = await startHardenedServer({ rateLimiter, trustedProxyCidrs: ['10.0.0.0/8'] });
  try {
    const first = await fetch(`${baseUrl}/health`, { headers: { ...bearer(QUERY_TOKEN), 'x-forwarded-for': '203.0.113.1' } });
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/health`, { headers: { ...bearer(QUERY_TOKEN), 'x-forwarded-for': '203.0.113.2' } });
    assert.equal(second.status, 429, 'a different spoofed identity must not buy a fresh rate-limit bucket from an untrusted peer');
  } finally {
    await server.close();
  }
});

test('end to end: distinct clients behind a genuinely trusted proxy each get their own rate-limit bucket', async () => {
  const rateLimiter = createRateLimiter({ limitsByScope: { query: 1, admin: 100 } });
  const { server, baseUrl } = await startHardenedServer({ rateLimiter, trustedProxyCidrs: ['127.0.0.1/32', '::1/128'] });
  try {
    const first = await fetch(`${baseUrl}/health`, { headers: { ...bearer(QUERY_TOKEN), 'x-forwarded-for': '203.0.113.1' } });
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/health`, { headers: { ...bearer(QUERY_TOKEN), 'x-forwarded-for': '203.0.113.2' } });
    assert.equal(second.status, 200, 'a distinct real client behind a trusted proxy must not share the first client\'s bucket');
    const third = await fetch(`${baseUrl}/health`, { headers: { ...bearer(QUERY_TOKEN), 'x-forwarded-for': '203.0.113.1' } });
    assert.equal(third.status, 429, 'the first client\'s own second request must still hit its own limit');
  } finally {
    await server.close();
  }
});

test('end to end: a multi-hop X-Forwarded-For behind a trusted proxy is denied outright, not guessed at', async () => {
  const { server, baseUrl } = await startHardenedServer({ trustedProxyCidrs: ['127.0.0.1/32', '::1/128'] });
  try {
    const response = await fetch(`${baseUrl}/health`, { headers: { ...bearer(QUERY_TOKEN), 'x-forwarded-for': '203.0.113.1, 198.51.100.9' } });
    assert.equal(response.status, 403);
  } finally {
    await server.close();
  }
});

test('an unconfigured hardening pipeline (no networkAuthentication) preserves the pre-T10 loopback behavior exactly', async () => {
  const server = createManagedGovernanceServer({ services: routeServices() });
  const address = await server.listen();
  try {
    const anonymousRead = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(anonymousRead.status, 200);
    const anonymousMutation = await fetch(`http://127.0.0.1:${address.port}/api/v1/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(anonymousMutation.status, 401);
  } finally {
    await server.close();
  }
});

test('resolveClientAddress ignores a forwarded claim from an untrusted direct peer entirely', () => {
  const resolved = resolveClientAddress({ directPeer: '198.51.100.7', forwardedForHeader: '203.0.113.5', trustedProxyCidrs: ['10.0.0.0/8'] });
  assert.equal(resolved.address, '198.51.100.7');
  assert.equal(resolved.trusted, false);
});

test('resolveClientAddress trusts a single-hop forwarded claim only from a trusted proxy', () => {
  const resolved = resolveClientAddress({ directPeer: '10.0.0.5', forwardedForHeader: '203.0.113.5', trustedProxyCidrs: ['10.0.0.0/8'] });
  assert.equal(resolved.address, '203.0.113.5');
  assert.equal(resolved.trusted, true);
});

test('resolveClientAddress fails closed on an ambiguous multi-hop chain, even behind a trusted proxy', () => {
  assert.throws(
    () => resolveClientAddress({ directPeer: '10.0.0.5', forwardedForHeader: '203.0.113.5, 198.51.100.9', trustedProxyCidrs: ['10.0.0.0/8'] }),
    AmbiguousForwardingChainError,
  );
  assert.throws(
    () => resolveClientAddress({ directPeer: '10.0.0.5', forwardedForHeader: ['203.0.113.5', '198.51.100.9'], trustedProxyCidrs: ['10.0.0.0/8'] }),
    AmbiguousForwardingChainError,
  );
});

test('createNetworkAuthentication refuses to construct with identical query and admin tokens', () => {
  assert.throws(() => createNetworkAuthentication({ queryToken: ADMIN_TOKEN, adminToken: ADMIN_TOKEN }), TypeError);
});

test('createRateLimiter bounds tracked-key cardinality regardless of how many distinct keys are seen', () => {
  const rateLimiter = createRateLimiter({ limitsByScope: { query: 1000 }, maxTrackedKeys: 5 });
  for (let index = 0; index < 50; index += 1) rateLimiter.check('query', `client-${index}`);
  assert.equal(rateLimiter.trackedKeyCount, 5);
});
