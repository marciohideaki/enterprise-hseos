'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { MemoryGovernanceRepository } = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { createManagedGovernanceServer } = require('../../tools/managed-governance-control-plane/server');
const { createStaticAuth } = require('../../tools/managed-governance-control-plane/lib/interfaces/http/auth');
const { getCurrentReadiness } = require('../../tools/managed-governance-control-plane/lib/application/query-readiness');
const { recordShadowReceipt } = require('../../tools/managed-governance-control-plane/lib/application/record-shadow-receipt');
const { evaluateShadowReadiness } = require('../../tools/managed-governance-control-plane/lib/application/evaluate-readiness');
const { createProjectGovernanceQueryAdapter } = require('../../tools/mcp-hseos-governance/lib/governance-query-adapter');
const { createManagedQueryTools } = require('../../tools/mcp-hseos-governance/tools/managed_queries');
const { runManagedGovernanceSessionPreflight } = require('../../packages/managed-governance-client/session-preflight');

const ACTOR = { type: 'automation', id: 'adapter-readiness-test' };
const DAY_MS = 24 * 60 * 60 * 1000;

function dayObservedAt(windowStart, day, hour = 12) {
  return new Date(Date.parse(windowStart) + day * DAY_MS + hour * 60 * 60 * 1000).toISOString();
}

async function startReadinessServer(organizationId) {
  const repository = new MemoryGovernanceRepository({ clock: () => new Date('2026-09-05T06:00:00.000Z') });
  await repository.ensureOrganization({
    organization_id: organizationId,
    idempotency_key: 'org-create',
    actor: ACTOR,
    organization: { slug: organizationId, display_name: 'Adapter Readiness Test' },
  });
  const server = createManagedGovernanceServer({
    services: {
      getReadiness: () => getCurrentReadiness({ organizationId, asOf: '2026-09-05T06:00:00.000Z' }, { repository }),
      recordReceipt: (input, context) =>
        recordShadowReceipt(
          {
            organizationId,
            actor: context.actor || ACTOR,
            repositoryId: input.repository_id,
            adapter: input.adapter,
            sessionFingerprint: input.session_fingerprint,
            localDigest: input.local_digest ?? null,
            remoteDigest: input.remote_digest ?? null,
            releaseDigest: input.release_digest ?? null,
            status: input.status,
            reasonCode: input.reason_code,
            observedAt: input.observed_at,
          },
          { repository },
        ),
    },
    auth: createStaticAuth(ACTOR),
  });
  const address = await server.listen();
  return { server, repository, baseUrl: `http://127.0.0.1:${address.port}` };
}

function writeProjectConfig(baseUrl) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-adapter-readiness-'));
  const configDirectory = path.join(projectRoot, '.hseos', 'config');
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(configDirectory, 'managed-governance.json'),
    JSON.stringify({ schema_version: 1, mode: 'managed-shadow', endpoint: baseUrl }),
  );
  return projectRoot;
}

test('CLI (HTTP fetch), the query adapter and the MCP tool all return the exact same readiness report', async (context) => {
  const organizationId = `adapter-readiness-${crypto.randomBytes(6).toString('hex')}`;
  const { server, repository, baseUrl } = await startReadinessServer(organizationId);
  const projectRoot = writeProjectConfig(baseUrl);
  context.after(async () => {
    await server.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const repositoryId = crypto.randomUUID();
  const windowStart = '2026-08-06T00:00:00.000Z';
  const receipts = [];
  for (let day = 0; day < 30; day += 1) {
    receipts.push(
      await recordShadowReceipt(
        {
          organizationId,
          actor: ACTOR,
          repositoryId,
          adapter: 'claude-code',
          sessionFingerprint: `sha256:${crypto.createHash('sha256').update(`s${day}`).digest('hex')}`,
          localDigest: `sha256:${'a'.repeat(64)}`,
          remoteDigest: `sha256:${'a'.repeat(64)}`,
          releaseDigest: null,
          status: 'equivalent',
          reasonCode: 'managed_shadow.constitution_equivalent',
          observedAt: dayObservedAt(windowStart, day),
        },
        { repository },
      ),
    );
  }
  await evaluateShadowReadiness(
    {
      organizationId,
      actor: ACTOR,
      windowStart,
      evaluatedAt: '2026-09-05T06:00:00.000Z',
      receipts,
      eligibleSessions: 30,
      activeRepositories: [repositoryId],
      enabledAdapters: ['claude-code'],
      preflightLatencySamplesMs: Array.from({ length: 30 }, () => 100),
      signerEvidenceCurrent: true,
      recoveryEvidenceCurrent: true,
      threatModelEvidenceCurrent: true,
      rollbackEvidenceCurrent: true,
    },
    { repository },
  );

  // Surface 1: direct HTTP (what the console and CLI's generic request() helper both call).
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
  const httpEnvelope = await (await fetch(`${baseUrl}/api/v1/readiness`)).json();
  assert.equal(httpEnvelope.ok, true);

  // Surface 2: the query adapter used by the CLI's own governance-query-adapter.js.
  const adapter = createProjectGovernanceQueryAdapter({ projectRoot });
  const adapterResult = await adapter.getGovernanceReadiness();

  // Surface 3: the MCP tool, through the exact same adapter port shape.
  const tools = createManagedQueryTools(() => adapter);
  const mcpTool = tools.find((entry) => entry.name === 'get_governance_readiness');
  const mcpResult = await mcpTool.handler(null, {});

  assert.deepEqual(httpEnvelope.data, adapterResult);
  assert.deepEqual(adapterResult, mcpResult);
  assert.equal(mcpResult.evaluated, true);
  assert.equal(mcpResult.ready, true);
  assert.equal(mcpResult.authorizes_enforcement, false);
});

test('an enabled adapter with no submitted receipt keeps the whole report not ready, across every surface', async (context) => {
  const organizationId = `adapter-readiness-missing-${crypto.randomBytes(6).toString('hex')}`;
  const { server, repository, baseUrl } = await startReadinessServer(organizationId);
  const projectRoot = writeProjectConfig(baseUrl);
  context.after(async () => {
    await server.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const repositoryId = crypto.randomUUID();
  const windowStart = '2026-08-06T00:00:00.000Z';
  const receipts = [];
  for (let day = 0; day < 30; day += 1) {
    receipts.push(
      await recordShadowReceipt(
        {
          organizationId,
          actor: ACTOR,
          repositoryId,
          adapter: 'claude-code',
          sessionFingerprint: `sha256:${crypto.createHash('sha256').update(`covered${day}`).digest('hex')}`,
          localDigest: `sha256:${'b'.repeat(64)}`,
          remoteDigest: `sha256:${'b'.repeat(64)}`,
          releaseDigest: null,
          status: 'equivalent',
          reasonCode: 'managed_shadow.constitution_equivalent',
          observedAt: dayObservedAt(windowStart, day),
        },
        { repository },
      ),
    );
  }
  // codex is enabled but never submits a receipt for any of the 30 days.
  await evaluateShadowReadiness(
    {
      organizationId,
      actor: ACTOR,
      windowStart,
      evaluatedAt: '2026-09-05T06:00:00.000Z',
      receipts,
      eligibleSessions: 30,
      activeRepositories: [repositoryId],
      enabledAdapters: ['claude-code', 'codex'],
      preflightLatencySamplesMs: Array.from({ length: 30 }, () => 100),
      signerEvidenceCurrent: true,
      recoveryEvidenceCurrent: true,
      threatModelEvidenceCurrent: true,
      rollbackEvidenceCurrent: true,
    },
    { repository },
  );

  const adapter = createProjectGovernanceQueryAdapter({ projectRoot });
  const tools = createManagedQueryTools(() => adapter);
  const mcpTool = tools.find((entry) => entry.name === 'get_governance_readiness');

  const viaAdapter = await adapter.getGovernanceReadiness();
  const viaMcp = await mcpTool.handler(null, {});
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is available throughout the supported Node 20 line
  const viaHttp = (await (await fetch(`${baseUrl}/api/v1/readiness`)).json()).data;

  for (const result of [viaAdapter, viaMcp, viaHttp]) {
    assert.equal(result.ready, false);
    assert.deepEqual(result.report.adapters_missing_evidence, ['codex']);
    assert.deepEqual(result.report.repositories_missing_evidence, []);
  }
});

test('a window with no evaluation at all is reported honestly as not-yet-evaluated, never guessed at', async (context) => {
  const organizationId = `adapter-readiness-unevaluated-${crypto.randomBytes(6).toString('hex')}`;
  const { server, baseUrl } = await startReadinessServer(organizationId);
  const projectRoot = writeProjectConfig(baseUrl);
  context.after(async () => {
    await server.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const adapter = createProjectGovernanceQueryAdapter({ projectRoot });
  const result = await adapter.getGovernanceReadiness();
  assert.equal(result.evaluated, false);
  assert.equal(result.ready, false);
  assert.equal(result.report, null);
});

test('the portable bootstrap emits a receipt for an adapter with no native session-start event, before any task action', async (context) => {
  const organizationId = `adapter-readiness-bootstrap-${crypto.randomBytes(6).toString('hex')}`;
  const { server, repository, baseUrl } = await startReadinessServer(organizationId);
  context.after(() => server.close());

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-bootstrap-'));
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectRoot, '.agents', 'capabilities'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.agents', 'capabilities', 'components.yaml'), 'schema_version: 1\n');
  const repositoryId = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(
    path.join(projectRoot, 'repository-contract.yaml'),
    `schema_version: repository-contract/v1\nrepository_id: ${repositoryId}\nidentity:\n  remotes:\n    - example.test/bootstrap\ncapabilities:\n  manifest: .agents/capabilities/components.yaml\n`,
  );
  fs.mkdirSync(path.join(projectRoot, '.hseos', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.hseos', 'config', 'managed-governance.json'),
    JSON.stringify({ schema_version: 1, mode: 'managed-shadow', endpoint: baseUrl }),
  );
  fs.writeFileSync(
    path.join(projectRoot, '.hseos', 'config', 'managed-governance-binding.json'),
    JSON.stringify({
      schema_version: 1,
      contract: 'managed-governance-binding/v1',
      binding_id: '33333333-3333-4333-8333-333333333333',
      mode: 'managed-shadow',
      repository_id: repositoryId,
      organization_id: organizationId,
      control_plane_ref: 'adapter-readiness-bootstrap',
      issuer: 'adapter-readiness-bootstrap',
      trusted_key_ids: ['governance-signing-2026'],
      failure_policy: 'cached-fail-closed',
      max_snapshot_age_seconds: 86_400,
      created_at: '2026-09-01T00:00:00Z',
    }),
  );
  const constitutionPath = path.join(projectRoot, '.enterprise', '.specs', 'constitution', 'Enterprise-Constitution.md');
  fs.mkdirSync(path.dirname(constitutionPath), { recursive: true });
  fs.writeFileSync(constitutionPath, '# Constitution\n\nBootstrap adapter authority.\n');

  const adapter = createProjectGovernanceQueryAdapter({ projectRoot });
  const result = await runManagedGovernanceSessionPreflight({
    projectRoot,
    persist: false,
    adapter: 'codex',
    receiptRecorder: adapter,
    queryAdapter: {
      getEffectiveGovernanceContext: async () => ({
        mode: 'managed-shadow',
        repository_id: repositoryId,
        source_commit: 'a'.repeat(40),
        artifacts: [{ source_path: '.enterprise/.specs/constitution/Enterprise-Constitution.md', content_digest: `sha256:${'c'.repeat(64)}` }],
      }),
    },
  });
  assert.equal(result.status, 'drift_detected');

  const stored = await repository.listAuditEvents(organizationId);
  const receiptEvent = stored.find((event) => event.aggregate_type === 'shadow_receipt');
  assert.ok(receiptEvent, 'expected the portable bootstrap to have submitted a shadow receipt');
  const receipt = await repository.getShadowReceipt(organizationId, receiptEvent.aggregate_id);
  assert.equal(receipt.adapter, 'codex');
  assert.equal(receipt.status, 'drift_detected');
});

test('receipt submission never blocks or fails the local preflight result when the receiptRecorder itself fails', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-bootstrap-outage-'));
  try {
    fs.mkdirSync(path.join(projectRoot, '.agents', 'capabilities'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.agents', 'capabilities', 'components.yaml'), 'schema_version: 1\n');
    const repositoryId = '22222222-2222-4222-8222-222222222222';
    fs.writeFileSync(
      path.join(projectRoot, 'repository-contract.yaml'),
      `schema_version: repository-contract/v1\nrepository_id: ${repositoryId}\nidentity:\n  remotes:\n    - example.test/outage\ncapabilities:\n  manifest: .agents/capabilities/components.yaml\n`,
    );
    fs.mkdirSync(path.join(projectRoot, '.hseos', 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.hseos', 'config', 'managed-governance.json'),
      '{"schema_version":1,"mode":"managed-shadow","endpoint":"http://127.0.0.1:4319"}\n',
    );
    fs.writeFileSync(
      path.join(projectRoot, '.hseos', 'config', 'managed-governance-binding.json'),
      JSON.stringify({
        schema_version: 1,
        contract: 'managed-governance-binding/v1',
        binding_id: '44444444-4444-4444-8444-444444444444',
        mode: 'managed-shadow',
        repository_id: repositoryId,
        organization_id: 'outage-test-org',
        control_plane_ref: 'outage-test',
        issuer: 'outage-test',
        trusted_key_ids: ['governance-signing-2026'],
        failure_policy: 'cached-fail-closed',
        max_snapshot_age_seconds: 86_400,
        created_at: '2026-09-01T00:00:00Z',
      }),
    );
    const constitutionPath = path.join(projectRoot, '.enterprise', '.specs', 'constitution', 'Enterprise-Constitution.md');
    fs.mkdirSync(path.dirname(constitutionPath), { recursive: true });
    fs.writeFileSync(constitutionPath, '# Constitution\n\nOutage test.\n');

    const brokenRecorder = {
      async submitShadowReceipt() {
        throw new Error('control plane unreachable');
      },
    };
    const result = await runManagedGovernanceSessionPreflight({
      projectRoot,
      persist: false,
      adapter: 'codex',
      receiptRecorder: brokenRecorder,
      queryAdapter: {
        async getEffectiveGovernanceContext() {
          throw new Error('remote is unreachable');
        },
      },
    });
    assert.equal(result.status, 'remote_unavailable');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
