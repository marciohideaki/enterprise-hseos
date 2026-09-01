'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { RelativePathSchema, parseContract } = require('../../packages/managed-governance-contracts');
const {
  MemoryGovernanceRepository,
} = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { secureReadRegularFile } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/governance-source');
const { createManagedGovernanceServer } = require('../../tools/managed-governance-control-plane/server');
const { createStaticAuth } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/auth');

const ACTOR = { type: 'automation', id: 'security-test', roles: [] };

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
