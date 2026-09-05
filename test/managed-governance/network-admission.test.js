'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { buildAllowlist, ipFamily, parseCidr } = require('../../tools/managed-governance-control-plane/lib/network/ip');
const { NetworkAdmissionError, assertNetworkProfile, createNetworkAdmission } = require('../../tools/managed-governance-control-plane/lib/network/admission');
const { createManagedGovernanceServer } = require('../../tools/managed-governance-control-plane/server');
const { loadSidecarConfiguration } = require('../../tools/managed-governance-control-plane/lib/configuration');
const { createStaticAuth } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/auth');
const { ROUTES } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/router');

const ACTOR = { type: 'automation', id: 'network-admission-test', roles: ['administrator'] };

function routeServices() {
  return Object.fromEntries(
    [...new Set(ROUTES.map((route) => route.handler))].map((handler) => [handler, async (input, context) => ({ handler, input, actor: context.actor })]),
  );
}

function sharedNetworkProfile(overrides = {}) {
  return {
    profile: 'shared-network',
    listen_host: '192.168.5.70',
    port: 4319,
    allowed_clients: ['192.168.5.0/24'],
    trusted_proxies: [],
    transport: { mode: 'direct-tls', certificate_ref_env: 'HSEOS_TEST_TLS_CERT', private_key_ref_env: 'HSEOS_TEST_TLS_KEY' },
    authentication: { query_token_env: 'HSEOS_TEST_QUERY_TOKEN', admin_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    rate_limits: { query_requests_per_minute: 120, admin_requests_per_minute: 30 },
    ...overrides,
  };
}

test('parseCidr accepts valid IPv4 and IPv6 CIDRs and rejects malformed ones', () => {
  assert.deepEqual(parseCidr('192.168.5.0/24'), { cidr: '192.168.5.0/24', base: '192.168.5.0', prefix: 24, family: 'ipv4' });
  assert.deepEqual(parseCidr('2001:db8::/32'), { cidr: '2001:db8::/32', base: '2001:db8::', prefix: 32, family: 'ipv6' });
  for (const bad of ['192.168.5.0', '192.168.5.0/33', '2001:db8::/129', 'not-an-ip/24', '192.168.5.0/-1', '192.168.5.0/abc']) {
    assert.throws(() => parseCidr(bad), /CIDR/, bad);
  }
});

test('ipFamily classifies IPv4, IPv6 and IPv4-mapped IPv6 addresses, and rejects garbage', () => {
  assert.equal(ipFamily('192.168.5.10'), 'ipv4');
  assert.equal(ipFamily('2001:db8::1'), 'ipv6');
  assert.equal(ipFamily('::ffff:192.168.5.10'), 'ipv6');
  assert.equal(ipFamily('not-an-address'), null);
  assert.equal(ipFamily(''), null);
});

test('buildAllowlist matches an IPv4 CIDR against the IPv4-mapped IPv6 form of the same address', () => {
  const allowlist = buildAllowlist(['192.168.5.0/24']);
  assert.equal(allowlist.matches('192.168.5.10'), true);
  assert.equal(allowlist.matches('::ffff:192.168.5.10'), true);
  assert.equal(allowlist.matches('192.168.6.10'), false);
  assert.equal(allowlist.matches('::ffff:192.168.6.10'), false);
});

test('buildAllowlist keeps IPv4 and IPv6 rules family-isolated outside the mapped-address bridge', () => {
  const allowlist = buildAllowlist(['2001:db8::/32']);
  assert.equal(allowlist.matches('2001:db8::1'), true);
  assert.equal(allowlist.matches('192.168.5.10'), false);
  assert.equal(allowlist.matches('::ffff:192.168.5.10'), false);
});

test('buildAllowlist fails closed on an unparseable peer address instead of throwing', () => {
  const allowlist = buildAllowlist(['192.168.5.0/24']);
  assert.equal(allowlist.matches('garbage'), false);
});

test('assertNetworkProfile forbids an empty allowlist and a wildcard allow-all entry', () => {
  assert.throws(
    () => assertNetworkProfile(sharedNetworkProfile({ allowed_clients: [] })),
    (error) => error instanceof NetworkAdmissionError && error.code === 'MANAGED_GOVERNANCE_NETWORK_ALLOWLIST_EMPTY',
  );
  for (const wildcard of ['0.0.0.0/0', '::/0']) {
    assert.throws(
      () => assertNetworkProfile(sharedNetworkProfile({ allowed_clients: ['192.168.5.0/24', wildcard] })),
      (error) => error instanceof NetworkAdmissionError && error.code === 'MANAGED_GOVERNANCE_NETWORK_ALLOWLIST_ALLOW_ALL',
      wildcard,
    );
  }
});

test('assertNetworkProfile forbids an incomplete listener even when bound to 0.0.0.0', () => {
  const base = sharedNetworkProfile({ listen_host: '0.0.0.0' });
  assert.doesNotThrow(() => assertNetworkProfile(base));
  for (const missing of ['transport', 'authentication', 'rate_limits']) {
    assert.throws(
      () => assertNetworkProfile({ ...base, [missing]: null }),
      (error) => error instanceof NetworkAdmissionError && error.code === 'MANAGED_GOVERNANCE_NETWORK_CONTROLS_INCOMPLETE',
      missing,
    );
  }
  assert.throws(
    () => assertNetworkProfile({ ...base, listen_host: null }),
    (error) => error instanceof NetworkAdmissionError && error.code === 'MANAGED_GOVERNANCE_NETWORK_LISTENER_INVALID',
  );
});

test('createNetworkAdmission for the loopback profile admits only loopback peers, including the mapped form', () => {
  const admission = createNetworkAdmission({ profile: 'loopback' });
  assert.equal(admission.admit('127.0.0.1').allow, true);
  assert.equal(admission.admit('::1').allow, true);
  assert.equal(admission.admit('::ffff:127.0.0.1').allow, true);
  const denied = admission.admit('203.0.113.5');
  assert.equal(denied.allow, false);
  assert.equal(denied.deny_reason, 'not_loopback');
});

test('createNetworkAdmission for a shared-network profile admits allowlisted peers and denies everyone else', () => {
  const admission = createNetworkAdmission(sharedNetworkProfile());
  assert.equal(admission.admit('192.168.5.42').allow, true);
  assert.equal(admission.admit('::ffff:192.168.5.42').allow, true);
  const denied = admission.admit('203.0.113.5');
  assert.equal(denied.allow, false);
  assert.equal(denied.deny_reason, 'not_allowlisted');
  assert.equal(admission.admit('not-an-address').deny_reason, 'peer_address_invalid');
});

test('createManagedGovernanceServer refuses to construct at all on an invalid shared-network profile', () => {
  assert.throws(
    () => createManagedGovernanceServer({ services: routeServices(), networkProfile: sharedNetworkProfile({ allowed_clients: [] }) }),
    (error) => error.code === 'MANAGED_GOVERNANCE_NETWORK_ALLOWLIST_EMPTY',
  );
  assert.throws(
    () => createManagedGovernanceServer({ services: routeServices(), networkProfile: sharedNetworkProfile({ allowed_clients: ['0.0.0.0/0'] }) }),
    (error) => error.code === 'MANAGED_GOVERNANCE_NETWORK_ALLOWLIST_ALLOW_ALL',
  );
});

test('listen() still requires a loopback host under the default profile', async () => {
  const server = createManagedGovernanceServer({ services: routeServices(), auth: createStaticAuth(ACTOR) });
  await assert.rejects(server.listen({ host: '192.168.5.70', port: 4319 }), /loopback/);
});

test('listen() requires the shared-network host and port to match the validated profile exactly', async () => {
  const server = createManagedGovernanceServer({
    services: routeServices(),
    auth: createStaticAuth(ACTOR),
    networkProfile: sharedNetworkProfile({ listen_host: '::', port: 0 }),
  });
  await assert.rejects(server.listen({ host: '127.0.0.1', port: 0 }), /must match the shared-network profile listener/);
  await server.close();
});

test('a peer outside the allowlist is destroyed at the socket before any HTTP handler runs', async (context) => {
  const server = createManagedGovernanceServer({
    services: routeServices(),
    auth: createStaticAuth(ACTOR),
    networkProfile: sharedNetworkProfile({ listen_host: '::', port: 0, allowed_clients: ['10.0.0.0/8'] }),
  });
  context.after(() => server.close());
  const address = await server.listen({ host: '::', port: 0 });
  await assert.rejects(
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
    fetch(`http://127.0.0.1:${address.port}/health`, { signal: AbortSignal.timeout(2000) }),
  );
});

test('a peer inside the allowlist reaches the real HTTP handler, including via the IPv4-mapped IPv6 form', async (context) => {
  const server = createManagedGovernanceServer({
    services: routeServices(),
    auth: createStaticAuth(ACTOR),
    networkProfile: sharedNetworkProfile({ listen_host: '::', port: 0, allowed_clients: ['127.0.0.1/32'] }),
  });
  context.after(() => server.close());
  const address = await server.listen({ host: '::', port: 0 });
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
  const response = await fetch(`http://127.0.0.1:${address.port}/health`, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
});

function writeSidecarConfig(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-network-admission-config-'));
  const configPath = path.join(root, 'sidecar.json');
  const config = {
    schema_version: 1,
    mode: 'managed-shadow',
    database: {
      migration_connection_string_env: 'HSEOS_TEST_MIGRATION_URL',
      runtime_connection_string_env: 'HSEOS_TEST_RUNTIME_URL',
      max_connections: 5,
      connection_timeout_ms: 5000,
      idle_timeout_ms: 30_000,
      statement_timeout_ms: 15_000,
      ssl: false,
    },
    organization: { id: 'network-admission-test', display_name: 'Network Admission Test' },
    control_plane: { host: '127.0.0.1', port: 4319, authentication_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    binding: { control_plane_ref: 'network-admission-test', issuer: 'network-admission-test', trusted_key_ids: ['key-1'], max_snapshot_age_seconds: 3600 },
    ...overrides,
  };
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  return { root, configPath };
}

function testEnvironment() {
  return {
    HSEOS_TEST_MIGRATION_URL: 'postgresql://u:p@localhost:5432/db',
    HSEOS_TEST_RUNTIME_URL: 'postgresql://u:p@localhost:5432/db',
    HSEOS_TEST_ADMIN_TOKEN: crypto.randomBytes(16).toString('hex'),
  };
}

test('loadSidecarConfiguration defaults to the loopback profile when no network section is present', () => {
  const { root, configPath } = writeSidecarConfig();
  try {
    const configuration = loadSidecarConfiguration(configPath, { environment: testEnvironment() });
    assert.equal(configuration.network.profile, 'loopback');
    assert.deepEqual(configuration.network.allowed_clients, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadSidecarConfiguration accepts a shared-network section whose control_plane host and port agree with it', () => {
  const { root, configPath } = writeSidecarConfig({
    control_plane: { host: '192.168.5.70', port: 4319, authentication_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    network: sharedNetworkProfile(),
  });
  try {
    const configuration = loadSidecarConfiguration(configPath, { environment: testEnvironment() });
    assert.equal(configuration.network.profile, 'shared-network');
    assert.deepEqual(configuration.network.allowed_clients, ['192.168.5.0/24']);
    assert.equal(configuration.control_plane.host, '192.168.5.70');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadSidecarConfiguration rejects a control_plane host that disagrees with the shared-network listener', () => {
  const { root, configPath } = writeSidecarConfig({
    control_plane: { host: '192.168.5.99', port: 4319, authentication_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    network: sharedNetworkProfile(),
  });
  try {
    assert.throws(
      () => loadSidecarConfiguration(configPath, { environment: testEnvironment() }),
      (error) => error.code === 'MANAGED_GOVERNANCE_CONFIGURATION_INVALID' && /must match/.test(error.message),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadSidecarConfiguration rejects an empty or wildcard allowlist and an incomplete shared-network listener', () => {
  const { root, configPath } = writeSidecarConfig({
    control_plane: { host: '192.168.5.70', port: 4319, authentication_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    network: sharedNetworkProfile({ allowed_clients: [] }),
  });
  try {
    assert.throws(() => loadSidecarConfiguration(configPath, { environment: testEnvironment() }), (error) => error.code === 'MANAGED_GOVERNANCE_CONFIGURATION_INVALID');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const { root: root2, configPath: configPath2 } = writeSidecarConfig({
    control_plane: { host: '192.168.5.70', port: 4319, authentication_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    network: sharedNetworkProfile({ allowed_clients: ['192.168.5.0/24', '0.0.0.0/0'] }),
  });
  try {
    assert.throws(() => loadSidecarConfiguration(configPath2, { environment: testEnvironment() }), (error) => error.code === 'MANAGED_GOVERNANCE_CONFIGURATION_INVALID');
  } finally {
    fs.rmSync(root2, { recursive: true, force: true });
  }

  const { root: root3, configPath: configPath3 } = writeSidecarConfig({
    control_plane: { host: '0.0.0.0', port: 4319, authentication_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    network: sharedNetworkProfile({ listen_host: '0.0.0.0', transport: null }),
  });
  try {
    assert.throws(() => loadSidecarConfiguration(configPath3, { environment: testEnvironment() }), (error) => error.code === 'MANAGED_GOVERNANCE_CONFIGURATION_INVALID');
  } finally {
    fs.rmSync(root3, { recursive: true, force: true });
  }
});

test('loadSidecarConfiguration rejects an unknown field inside the network section', () => {
  const { root, configPath } = writeSidecarConfig({
    control_plane: { host: '192.168.5.70', port: 4319, authentication_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    network: { ...sharedNetworkProfile(), unexpected_field: true },
  });
  try {
    assert.throws(
      () => loadSidecarConfiguration(configPath, { environment: testEnvironment() }),
      (error) => error.code === 'MANAGED_GOVERNANCE_CONFIGURATION_INVALID' && /unknown fields/.test(error.message),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
