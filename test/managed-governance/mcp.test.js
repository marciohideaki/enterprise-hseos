'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const {
  createProjectGovernanceQueryAdapter,
  loadProjectConfiguration,
} = require('../../tools/mcp-hseos-governance/lib/governance-query-adapter');
const managedQueryModule = require('../../tools/mcp-hseos-governance/tools/managed_queries');
const { createManagedGovernanceAction } = require('../../tools/cli/lib/managed-governance/commands');

const { createManagedQueryTools } = managedQueryModule;
let projectRoot;

before(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-managed-mcp-'));
  const configDirectory = path.join(projectRoot, '.hseos', 'config');
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(configDirectory, 'managed-governance.json'),
    '{"schema_version":1,"mode":"managed-shadow","endpoint":"http://127.0.0.1:4319"}\n',
  );
});

after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

test('managed MCP catalog is read-only, strict and complete', () => {
  const names = managedQueryModule.map((entry) => entry.name);
  assert.deepEqual(names, [
    'get_effective_governance_context',
    'evaluate_governed_action',
    'explain_governance_decision',
    'get_governance_artifact',
    'get_governance_release',
    'diff_governance_releases',
    'verify_governance_snapshot',
    'get_governance_session_status',
  ]);
  for (const entry of managedQueryModule) {
    assert.equal(entry.inputSchema.additionalProperties, false);
    assert.doesNotMatch(entry.name, /create|update|delete|publish|import|apply|command/);
  }
});

test('query adapter loads only project-local managed-shadow configuration and maps read routes', async () => {
  assert.deepEqual(loadProjectConfiguration(projectRoot), { endpoint: 'http://127.0.0.1:4319', mode: 'managed-shadow' });
  const calls = [];
  const adapter = createProjectGovernanceQueryAdapter({
    projectRoot,
    transport: async (endpoint, method, pathname, body) => {
      calls.push({ endpoint, method, pathname, body });
      return { route: pathname };
    },
  });
  await adapter.getEffectiveGovernanceContext({ repository_id: 'repository-1' });
  await adapter.evaluateGovernedAction({ context: { action: 'read' } });
  await adapter.getGovernanceArtifact({ artifact_id: 'policy:one' });
  await adapter.getGovernanceSessionStatus({});
  assert.deepEqual(
    calls.map(({ method, pathname }) => [method, pathname]),
    [
      ['GET', '/api/v1/context?limit=100&repository_id=repository-1'],
      ['POST', '/api/v1/policy/evaluate'],
      ['GET', '/api/v1/artifacts/policy%3Aone'],
      ['GET', '/api/v1/session/status'],
    ],
  );
  assert.deepEqual(calls[1].body, { action: 'read' });
});

test('MCP and CLI preserve the same managed-shadow decision without retaining request state', async () => {
  const decision = { decision: 'deny', reason_code: 'policy.deny', local_authority_changed: false };
  let factoryCalls = 0;
  const tools = createManagedQueryTools(() => {
    factoryCalls += 1;
    return {
      evaluateGovernedAction: async () => structuredClone(decision),
      explainGovernanceDecision: async () => structuredClone(decision),
    };
  });
  const evaluate = tools.find((entry) => entry.name === 'evaluate_governed_action');
  const first = await evaluate.handler(null, { context: { action: 'repository.push' } });
  const second = await evaluate.handler(null, { context: { action: 'repository.push' } });
  const cli = createManagedGovernanceAction({
    request: async () => ({ schema_version: 1, ok: true, data: decision, error: null, evidence: [], warnings: [] }),
  });
  const contextPath = path.join(projectRoot, 'context.json');
  fs.writeFileSync(contextPath, '{"action":"repository.push"}\n');
  const cliResult = await cli('policy', 'evaluate', { context: contextPath, json: true });
  assert.deepEqual(first, decision);
  assert.deepEqual(second, decision);
  assert.deepEqual(cliResult.envelope.data, decision);
  assert.equal(factoryCalls, 2);
});

test('unsafe, external and non-shadow configurations fail before network access', () => {
  const configPath = path.join(projectRoot, '.hseos', 'config', 'managed-governance.json');
  fs.writeFileSync(configPath, '{"schema_version":1,"mode":"managed-shadow","endpoint":"https://example.test"}\n');
  assert.throws(() => loadProjectConfiguration(projectRoot), /loopback HTTP/);
  fs.writeFileSync(configPath, '{"schema_version":1,"mode":"managed-enforced","endpoint":"http://127.0.0.1:4319"}\n');
  assert.throws(() => loadProjectConfiguration(projectRoot), /unsupported/);
});
