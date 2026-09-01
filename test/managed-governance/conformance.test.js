'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createManagedGovernanceClient } = require('../../packages/managed-governance-client');
const { createManagedGovernanceAction } = require('../../tools/cli/lib/managed-governance/commands');
const { evaluatePolicy } = require('../../tools/managed-governance-control-plane/lib/application/evaluate-policy');
const { createStaticAuth } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/auth');
const { createManagedGovernanceServer } = require('../../tools/managed-governance-control-plane/server');
const { createManagedQueryTools } = require('../../tools/mcp-hseos-governance/tools/managed_queries');
const { REPOSITORY_ID } = require('./client-fixtures');

const ROOT = path.resolve(__dirname, '../..');
const ACTOR = { type: 'automation', id: 'conformance-test', roles: [] };

function binding(mode) {
  return {
    schema_version: 1,
    contract: 'managed-governance-binding/v1',
    binding_id: '00000000-0000-4000-8000-000000000010',
    mode,
    repository_id: REPOSITORY_ID,
    organization_id: 'hideaki-solutions',
    control_plane_ref: 'governance-control-plane',
    issuer: 'conformance-test',
    trusted_key_ids: ['test-key'],
    failure_policy: 'cached-fail-closed',
    max_snapshot_age_seconds: 3600,
    created_at: '2026-09-01T00:00:00.000Z',
  };
}

function policyDecision() {
  return evaluatePolicy({
    candidates: [],
    request: {
      organization_id: 'hideaki-solutions',
      actor: { type: 'agent', roles: [] },
      action: 'repository.push',
      resource: { type: 'repository', identifier: 'repository:enterprise-hseos' },
      scope: { repository: null, environment: 'test', branch: null, stack: 'node', capabilities: [] },
      facts: {},
      action_class: 'mutation',
    },
    policyVersion: 'policy:conformance-v1',
    releaseDigest: null,
    evaluatedAt: '2026-09-01T00:00:00.000Z',
  });
}

test('HTTP, CLI and MCP expose the same decision semantics from the shared application result', async () => {
  const expected = policyDecision();
  const server = createManagedGovernanceServer({
    auth: createStaticAuth(ACTOR),
    services: { evaluatePolicy: async () => expected },
  });
  const address = await server.listen();
  const endpoint = `http://127.0.0.1:${address.port}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-conformance-'));
  const contextPath = path.join(directory, 'context.json');
  fs.writeFileSync(contextPath, '{}\n');
  try {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
    const httpResponse = await fetch(`${endpoint}/api/v1/policy/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const httpEnvelope = await httpResponse.json();
    const cli = createManagedGovernanceAction();
    const cliResult = await cli('policy', 'evaluate', { endpoint, context: contextPath, json: true });
    const tools = createManagedQueryTools(() => ({
      evaluateGovernedAction: async () => structuredClone(expected),
    }));
    const mcp = tools.find((entry) => entry.name === 'evaluate_governed_action');
    const mcpResult = await mcp.handler(null, { context: {} });
    assert.deepEqual(httpEnvelope.data, expected);
    assert.deepEqual(cliResult.envelope.data, expected);
    assert.deepEqual(mcpResult, expected);
    assert.equal(expected.decision, 'input_required');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    await server.close();
  }
});

test('reserved managed enforcement remains an unavailable no-side-effect state', async () => {
  let effects = 0;
  const client = createManagedGovernanceClient({
    binding: binding('managed-enforced'),
    repositoryId: REPOSITORY_ID,
    endpoint: 'https://governance.example.invalid',
    snapshotStore: { load: () => (effects += 1) },
    fetchImpl: async () => (effects += 1),
  });
  const result = await client.resolveShadow({ localResult: { allowed: true }, policyInput: {} });
  assert.equal(result.status, 'enforcement_unavailable');
  assert.equal(result.authoritative_source, 'local');
  assert.equal(effects, 0);
});

test('verification matrix accounts for every functional and non-functional requirement', () => {
  const spec = fs.readFileSync(path.join(ROOT, '.enterprise/.specs/features/managed-governance-control-plane/spec.md'), 'utf8');
  const matrix = fs.readFileSync(
    path.join(ROOT, '.enterprise/.specs/features/managed-governance-control-plane/verification-matrix.md'),
    'utf8',
  );
  const identifiers = [...spec.matchAll(/\*\*((?:FR|NFR)-\d{3}):\*\*/g)].map((match) => match[1]);
  assert.equal(identifiers.length, 50);
  for (const identifier of identifiers) {
    assert.match(matrix, new RegExp(`\\| ${identifier} \\|`), `${identifier} is absent from the verification matrix`);
  }
  assert.doesNotMatch(matrix, /managed-enforced\s+active|managed-enforced\s+enabled/i);
});
