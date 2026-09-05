'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { test } = require('node:test');
const { RelativePathSchema, parseContract } = require('../../packages/managed-governance-contracts');
const {
  MemoryGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { buildEvidenceMutation } = require('../../tools/managed-governance-control-plane/lib/domain/repository-port');
const { secureReadRegularFile } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/governance-source');
const { createManagedGovernanceServer } = require('../../tools/managed-governance-control-plane/server');
const { createStaticAuth } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/auth');
const { createNetworkAuthentication } = require('../../tools/managed-governance-control-plane/lib/network/authentication');

const ACTOR = { type: 'automation', id: 'security-test', roles: [] };

function generateSelfSignedCertificate() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-tls-'));
  const keyPath = path.join(directory, 'key.pem');
  const certPath = path.join(directory, 'cert.pem');
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '1',
    '-subj',
    '/CN=hseos-governance-test',
  ]);
  const certificate = fs.readFileSync(certPath, 'utf8');
  const privateKey = fs.readFileSync(keyPath, 'utf8');
  fs.rmSync(directory, { recursive: true, force: true });
  return { certificate, privateKey };
}

function sharedNetworkProfile(overrides = {}) {
  return {
    profile: 'shared-network',
    listen_host: '::',
    port: 0,
    allowed_clients: ['127.0.0.1/32', '::1/128'],
    trusted_proxies: [],
    transport: { mode: 'direct-tls', certificate_ref_env: 'HSEOS_TEST_TLS_CERT', private_key_ref_env: 'HSEOS_TEST_TLS_KEY' },
    authentication: { query_token_env: 'HSEOS_TEST_QUERY_TOKEN', admin_token_env: 'HSEOS_TEST_ADMIN_TOKEN' },
    rate_limits: { query_requests_per_minute: 120, admin_requests_per_minute: 30 },
    ...overrides,
  };
}

function organizationCommand(organizationId, idempotencyKey, displayName = 'Security tenant') {
  return {
    organization_id: organizationId,
    idempotency_key: idempotencyKey,
    actor: { type: 'automation', id: 'security-test' },
    organization: { slug: organizationId, display_name: displayName },
  };
}

async function rawRequest(endpoint, pathname, body) {
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
  const response = await fetch(`${endpoint}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return { response, envelope: await response.json() };
}

test('tenant isolation and replay protection fail closed without cross-tenant mutation', async () => {
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-01T00:00:00.000Z') });
  try {
    const first = await repository.ensureOrganization(organizationCommand('tenant-a', 'create-a'));
    const replay = await repository.ensureOrganization(organizationCommand('tenant-a', 'create-a'));
    await repository.ensureOrganization(organizationCommand('tenant-b', 'create-b'));
    assert.deepEqual(replay, first);
    assert.equal((await repository.listAuditEvents('tenant-a')).length, 1);
    assert.equal((await repository.listAuditEvents('tenant-b')).length, 1);
    assert.equal((await repository.listAuditEvents('tenant-missing')).length, 0);
    await assert.rejects(
      repository.ensureOrganization(organizationCommand('tenant-a', 'create-a', 'Injected replay')),
      (error) => error.code === 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
    );
    await assert.rejects(
      repository.getOrganization("tenant-a' OR '1'='1"),
      (error) => error.code === 'MANAGED_GOVERNANCE_REPOSITORY_INPUT_INVALID',
    );
    assert.equal((await repository.listAuditEvents('tenant-a')).length, 1);
  } finally {
    await repository.close();
  }
});

test('source and contract paths reject traversal, symbolic links and external content', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-security-'));
  const outside = path.join(path.dirname(directory), `${path.basename(directory)}-outside.md`);
  const link = path.join(directory, 'linked.md');
  fs.writeFileSync(outside, 'external');
  fs.symlinkSync(outside, link);
  try {
    for (const candidate of ['../policy.md', '/absolute/policy.md', 'nested/../../policy.md', String.raw`nested\policy.md`]) {
      assert.throws(() => parseContract(RelativePathSchema, candidate, 'source path'));
    }
    await assert.rejects(
      secureReadRegularFile(directory, outside, '../outside.md', 1024),
      (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_ESCAPE',
    );
    await assert.rejects(
      secureReadRegularFile(directory, link, 'linked.md', 1024),
      (error) => error.code === 'MANAGED_GOVERNANCE_SOURCE_LINK',
    );
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP input limits, route injection and malformed JSON fail before application execution', async () => {
  let calls = 0;
  const server = createManagedGovernanceServer({
    auth: createStaticAuth(ACTOR),
    maximumBodyBytes: 1024,
    services: { evaluatePolicy: async () => (calls += 1) },
  });
  const address = await server.listen();
  const endpoint = `http://127.0.0.1:${address.port}`;
  try {
    const oversized = await rawRequest(endpoint, '/api/v1/policy/evaluate', JSON.stringify({ value: 'x'.repeat(1100) }));
    assert.equal(oversized.response.status, 413);
    assert.equal(oversized.envelope.error.code, 'request_too_large');
    const malformed = await rawRequest(endpoint, '/api/v1/policy/evaluate', '{"unterminated":');
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.envelope.error.code, 'invalid_request');
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
    const injected = await fetch(`${endpoint}/api/v1/artifacts/%2F..%2Fsecret`);
    assert.equal(injected.status, 400);
    assert.equal((await injected.json()).error.code, 'invalid_request');
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('control-plane refuses non-loopback exposure', async () => {
  const server = createManagedGovernanceServer({ services: {} });
  await assert.rejects(server.listen({ host: '0.0.0.0', port: 0 }), /loopback/);
  await server.close();
});

// Threat model trust boundary: network-to-sidecar. FR-020's "transport-protection contract" was
// a schema-validated field with no runtime effect until T12 -- a direct-tls deployment's bearer
// tokens would have travelled in clear text. These tests prove the listener is genuinely wrapped
// in TLS, not merely configured to claim it is.
test('a direct-tls shared-network profile actually wraps its listener in TLS, not merely declares it', async () => {
  const { certificate, privateKey } = generateSelfSignedCertificate();
  const environment = { HSEOS_TEST_TLS_CERT: certificate, HSEOS_TEST_TLS_KEY: privateKey };
  const server = createManagedGovernanceServer({
    services: { health: async () => ({ live: true }) },
    networkProfile: sharedNetworkProfile(),
    environment,
  });
  try {
    const address = await server.listen({ host: '::', port: 0 });
    // A raw TLS handshake against the port, independent of the HTTP layer entirely.
    const handshake = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', port: address.port, rejectUnauthorized: false }, () => {
        resolve(socket);
      });
      socket.once('error', reject);
    });
    assert.ok(handshake.encrypted, 'expected a genuine TLS socket, not a plain TCP one');
    assert.equal(handshake.getPeerCertificate().subject.CN, 'hseos-governance-test');
    handshake.destroy();

    // And the full request/response cycle over that same TLS listener.
    const body = await new Promise((resolve, reject) => {
      https.get({ host: '127.0.0.1', port: address.port, path: '/health', rejectUnauthorized: false }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
    assert.equal(JSON.parse(body).data.live, true);
  } finally {
    await server.close();
  }
});

test('direct-tls fails closed before any socket opens when the certificate or key is missing or invalid', () => {
  const { certificate, privateKey } = generateSelfSignedCertificate();
  assert.throws(
    () => createManagedGovernanceServer({ services: {}, networkProfile: sharedNetworkProfile(), environment: { HSEOS_TEST_TLS_KEY: privateKey } }),
    /certificate is required/,
  );
  assert.throws(
    () => createManagedGovernanceServer({ services: {}, networkProfile: sharedNetworkProfile(), environment: { HSEOS_TEST_TLS_CERT: certificate } }),
    /private key is required/,
  );
  const { privateKey: unrelatedKey } = generateSelfSignedCertificate();
  assert.throws(
    () =>
      createManagedGovernanceServer({
        services: {},
        networkProfile: sharedNetworkProfile(),
        environment: { HSEOS_TEST_TLS_CERT: certificate, HSEOS_TEST_TLS_KEY: unrelatedKey },
      }),
    /certificate\/key pair is invalid/,
  );
});

test('terminated-upstream deliberately keeps this server on plain HTTP -- TLS is an external reverse-proxy responsibility for that mode', async () => {
  const server = createManagedGovernanceServer({
    services: { health: async () => ({ live: true }) },
    networkProfile: sharedNetworkProfile({ transport: { mode: 'terminated-upstream', certificate_ref_env: 'HSEOS_TEST_TLS_CERT', private_key_ref_env: 'HSEOS_TEST_TLS_KEY' } }),
    environment: {},
  });
  try {
    const address = await server.listen({ host: '::', port: 0 });
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
  } finally {
    await server.close();
  }
});

// Threat model invariant: "Authentication, allowlisting and transport protection are independent
// controls; success in one never bypasses another" (design.md). This combines T09's admission
// with T10's authentication in one server, something neither task's own suite did alone.
test('a perfectly valid admin credential never substitutes for network admission -- the two controls are independent', async () => {
  const networkAuthentication = createNetworkAuthentication({ queryToken: 'q'.repeat(24), adminToken: 'a'.repeat(24) });
  const { certificate, privateKey } = generateSelfSignedCertificate();
  const server = createManagedGovernanceServer({
    services: { health: async () => ({ live: true }) },
    // 10.0.0.0/8 deliberately excludes the real test client (127.0.0.1/::1).
    networkProfile: sharedNetworkProfile({ allowed_clients: ['10.0.0.0/8'] }),
    networkAuthentication,
    environment: { HSEOS_TEST_TLS_CERT: certificate, HSEOS_TEST_TLS_KEY: privateKey },
  });
  try {
    const address = await server.listen({ host: '::', port: 0 });
    await assert.rejects(
      new Promise((resolve, reject) => {
        const socket = tls.connect({ host: '127.0.0.1', port: address.port, rejectUnauthorized: false }, () => resolve(socket));
        socket.once('error', reject);
      }),
      'admission must destroy the connection before a bearer token could ever be presented',
    );
  } finally {
    await server.close();
  }
});

// Threat model trust boundary: outbox-to-telemetry. FR-014 requires bounded payloads with no
// secret or governance-body fields, regardless of what the underlying record contains.
test('audit and outbox payloads are bounded to identifiers, never the record content, no matter how large or secret-shaped that content is', () => {
  const dangerousRecord = {
    shadow_receipt_id: crypto.randomUUID(),
    organization_id: 'outbox-bound-test',
    local_digest: `sha256:${'a'.repeat(64)}`,
    // A record can carry an arbitrarily large "document body" or something that merely looks
    // like a secret; buildEvidenceMutation must never let either leak into audit/outbox payloads.
    governance_document_body: '# Full Constitution\n'.repeat(10_000),
    api_token_lookalike: 'Bearer sk-live-not-a-real-secret-but-shaped-like-one',
  };
  const mutation = buildEvidenceMutation({
    kind: 'shadowReceipts',
    prepared: {
      audit_event_id: crypto.randomUUID(),
      organization_id: 'outbox-bound-test',
      record_id: dangerousRecord.shadow_receipt_id,
      correlation_id: crypto.randomUUID(),
      causation_id: null,
      actor: ACTOR,
      occurred_at: '2026-09-05T00:00:00.000Z',
      outbox_message_id: crypto.randomUUID(),
    },
    record: dangerousRecord,
    eventType: 'governance.shadow_receipt.recorded',
    aggregateType: 'shadow_receipt',
    topic: 'governance.shadow_receipt.recorded',
  });
  assert.deepEqual(Object.keys(mutation.auditEvent.payload).sort(), ['kind', 'record_id']);
  assert.deepEqual(Object.keys(mutation.outboxMessage.payload).sort(), ['audit_event_id', 'record_id']);
  const serializedAudit = JSON.stringify(mutation.auditEvent);
  const serializedOutbox = JSON.stringify(mutation.outboxMessage);
  assert.doesNotMatch(serializedAudit, /governance_document_body|api_token_lookalike|Bearer/);
  assert.doesNotMatch(serializedOutbox, /governance_document_body|api_token_lookalike|Bearer/);
});
