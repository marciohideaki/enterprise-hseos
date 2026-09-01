'use strict';

const { digestCanonical } = require('../../packages/managed-governance-contracts');

const REPOSITORY_ID = '7f9f9b79-638c-4138-9a29-8a2406ad9fb8';
const BINDING_DIGEST = `sha256:${'b'.repeat(64)}`;

function decision(value = 'deny') {
  return {
    schema_version: 1,
    decision: value,
    reason_code: `policy.${value}`,
    policy_version: 'policy:v1',
    release_digest: `sha256:${'a'.repeat(64)}`,
    obligations: [],
    evidence: [],
    warnings: [],
  };
}

function snapshot(overrides = {}) {
  const policyInput = { action: 'repository.push' };
  return {
    schema_version: 1,
    snapshot_id: '00000000-0000-4000-8000-000000000001',
    organization_id: 'hideaki-solutions',
    repository_id: REPOSITORY_ID,
    release_id: 'release-1',
    release_digest: `sha256:${'a'.repeat(64)}`,
    binding_digest: BINDING_DIGEST,
    policy_digest: `sha256:${'c'.repeat(64)}`,
    effective_scope: {
      cached_decisions: [{ request_digest: digestCanonical(policyInput), decision: decision() }],
    },
    artifacts: [
      {
        artifact_id: 'enterprise-constitution',
        artifact_version_id: '00000000-0000-4000-8000-000000000002',
        content_digest: `sha256:${'d'.repeat(64)}`,
      },
    ],
    rules: [],
    adapter_digests: {},
    issued_at: '2026-09-01T00:00:00.000Z',
    expires_at: '2026-09-02T00:00:00.000Z',
    issuer: 'governance-test',
    signature: { algorithm: 'ed25519', key_id: 'test-key', value: 'dGVzdA==' },
    ...overrides,
  };
}

module.exports = { BINDING_DIGEST, REPOSITORY_ID, decision, snapshot };
