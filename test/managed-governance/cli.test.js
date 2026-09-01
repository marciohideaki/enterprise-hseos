'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { after, before, test } = require('node:test');
const { canonicalize } = require('../../packages/managed-governance-contracts');
const { createManagedGovernanceAction, parseEndpoint, parsePort } = require('../../tools/cli/lib/managed-governance/commands');

let temporaryDirectory;
let contextPath;
let databaseConfigPath;

before(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-cli-'));
  contextPath = path.join(temporaryDirectory, 'context.json');
  databaseConfigPath = path.join(temporaryDirectory, 'database.json');
  fs.writeFileSync(contextPath, '{"action":"git.commit","branch":"feature/example"}\n');
  fs.writeFileSync(databaseConfigPath, '{"profile":"managed-shadow"}\n', { mode: 0o600 });
});

after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

function success(data) {
  return { schema_version: 1, ok: true, data, error: null, evidence: [], warnings: [] };
}

test('all documented read commands map to their versioned HTTP application ports', async () => {
  const calls = [];
  const run = createManagedGovernanceAction({
    request: async (request) => {
      calls.push(request);
      return success({ ordinal: calls.length });
    },
  });
  const plan = await run('catalog', 'import', { plan: true, source: '.enterprise', json: true });
  const status = await run('catalog', 'status', { json: true });
  const artifacts = await run('artifact', 'list', { type: 'policy', json: true });
  const policy = await run('policy', 'evaluate', { context: contextPath, json: true });
  assert.deepEqual(
    calls.map(({ method, pathname }) => [method, pathname]),
    [
      ['POST', '/api/v1/imports/plan'],
      ['GET', '/health'],
      ['GET', '/api/v1/artifacts?type=policy'],
      ['POST', '/api/v1/policy/evaluate'],
    ],
  );
  assert.equal(calls[0].body.source, path.resolve('.enterprise'));
  assert.deepEqual(calls[3].body, { action: 'git.commit', branch: 'feature/example' });
  assert.equal(plan.output, canonicalize(plan.envelope));
  assert.equal(status.envelope.ok, true);
  assert.equal(artifacts.envelope.ok, true);
  assert.equal(policy.envelope.ok, true);
});

test('plan is deterministic and performs no local mutation', async () => {
  const requests = [];
  const run = createManagedGovernanceAction({
    request: async (request) => {
      requests.push(structuredClone(request));
      return success({ plan_id: 'sha256:deterministic' });
    },
  });
  const before = fs.readFileSync(contextPath, 'utf8');
  const first = await run('catalog', 'import', { plan: true, source: '.enterprise', json: true });
  const second = await run('catalog', 'import', { plan: true, source: '.enterprise', json: true });
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(first.output, second.output);
  assert.equal(fs.readFileSync(contextPath, 'utf8'), before);
});

test('apply requires explicit database reference, actor and authentication and repeats the same request', async () => {
  const requests = [];
  const run = createManagedGovernanceAction({
    environment: { HSEOS_GOVERNANCE_TOKEN: '0123456789abcdef' },
    request: async (request) => {
      requests.push(structuredClone(request));
      return success({ import_batch_id: 'batch-1', status: 'completed' });
    },
  });
  const options = {
    apply: true,
    source: '.enterprise',
    databaseConfig: databaseConfigPath,
    actor: 'operator-1',
    json: true,
  };
  const first = await run('catalog', 'import', options);
  const second = await run('catalog', 'import', options);
  assert.equal(first.output, second.output);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].token, '0123456789abcdef');
  assert.equal(requests[0].actor, 'operator-1');
  for (const invalid of [
    { apply: true, actor: 'operator-1' },
    { apply: true, databaseConfig: databaseConfigPath },
  ]) {
    const result = await run('catalog', 'import', { ...invalid, json: true });
    assert.equal(result.envelope.ok, false);
    assert.equal(result.exitCode, 1);
  }
});

test('server start defaults to loopback and port 4319', async () => {
  let received;
  const run = createManagedGovernanceAction({
    startServer: async (input) => {
      received = input;
      return { address: { address: input.host, port: input.port } };
    },
  });
  const result = await run('server', 'start', { json: true });
  assert.deepEqual(received, { host: '127.0.0.1', port: 4319 });
  assert.equal(result.envelope.data.state, 'listening');
  assert.match(result.output, /^\{"data":/);
});

test('invalid commands, modes, files, filters and network boundaries fail closed', async () => {
  const run = createManagedGovernanceAction({ request: async () => success(null) });
  const cases = [
    ['catalog', 'import', { json: true }],
    ['catalog', 'import', { plan: true, apply: true, json: true }],
    ['policy', 'evaluate', { context: path.join(temporaryDirectory, 'missing.json'), json: true }],
    ['artifact', 'list', { type: '../policy', json: true }],
    ['server', 'start', { bind: '0.0.0.0', json: true }],
    ['unknown', 'command', { json: true }],
  ];
  for (const [area, action, options] of cases) {
    const result = await run(area, action, options);
    assert.equal(result.envelope.ok, false, `${area} ${action}`);
    assert.equal(result.exitCode, 1);
    assert.doesNotThrow(() => JSON.parse(result.output));
  }
  assert.throws(() => parseEndpoint('https://127.0.0.1:4319'), /loopback HTTP/);
  assert.throws(() => parseEndpoint('http://example.test:4319'), /loopback HTTP/);
  assert.throws(() => parsePort('0'), /1 to 65535/);
});

test('human output projects the same envelope and retains remote error codes', async () => {
  const remote = {
    schema_version: 1,
    ok: false,
    data: null,
    error: { code: 'database_unavailable', message: 'control-plane database is unavailable' },
    evidence: [],
    warnings: [],
  };
  const run = createManagedGovernanceAction({ request: async () => remote });
  const result = await run('catalog', 'status', {});
  assert.equal(result.output, 'ERROR database_unavailable: control-plane database is unavailable');
  assert.equal(result.exitCode, 1);
});

test('session preflight keeps every managed-shadow outcome advisory', async () => {
  for (const status of ['equivalent', 'drift_detected', 'remote_unavailable', 'invalid_local_contract', 'not_configured']) {
    const run = createManagedGovernanceAction({
      sessionPreflight: async () => ({
        schema_version: 1,
        mode: 'managed-shadow',
        status,
        reason_code: `managed_shadow.${status}`,
        blocking: false,
        authoritative_source: 'local',
        evidence_path: '.hseos/state/managed-governance/session-preflight.json',
      }),
    });
    const result = await run('session', 'preflight', { json: true });
    assert.equal(result.envelope.ok, true);
    assert.equal(result.exitCode, undefined);
    assert.equal(result.envelope.data.status, status);
    assert.equal(result.envelope.data.blocking, false);
  }
});

test('database configuration rejects unsafe permissions and token header characters', async () => {
  const unsafeConfig = path.join(temporaryDirectory, 'unsafe-database.json');
  fs.writeFileSync(unsafeConfig, '{}\n', { mode: 0o644 });
  const unsafeConfigRun = createManagedGovernanceAction({
    environment: { HSEOS_GOVERNANCE_TOKEN: '0123456789abcdef' },
    request: async () => success(null),
  });
  const unsafeConfigResult = await unsafeConfigRun('catalog', 'import', {
    apply: true,
    databaseConfig: unsafeConfig,
    actor: 'operator-1',
    json: true,
  });
  assert.equal(unsafeConfigResult.envelope.error.code, 'invalid_request');

  const unsafeTokenRun = createManagedGovernanceAction({
    environment: { HSEOS_GOVERNANCE_TOKEN: 'invalid token value' },
    request: async () => success(null),
  });
  const unsafeTokenResult = await unsafeTokenRun('catalog', 'import', {
    apply: true,
    databaseConfig: databaseConfigPath,
    actor: 'operator-1',
    json: true,
  });
  assert.equal(unsafeTokenResult.envelope.error.code, 'unauthorized');
});

test('the main CLI exposes managed governance help without update-network access', () => {
  const output = execFileSync(process.execPath, ['tools/cli/hseos-cli.js', 'governance', '--help'], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    env: { ...process.env, HSEOS_DISABLE_UPDATE_CHECK: '1' },
  });
  assert.match(output, /governance \[options\] <area> <action>/);
  assert.match(output, /--database-config <path>/);
});
