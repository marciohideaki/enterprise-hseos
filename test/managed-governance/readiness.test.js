'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { MemoryGovernanceRepository } = require('../../tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository');
const { deterministicReceiptId, recordShadowReceipt } = require('../../tools/managed-governance-control-plane/lib/application/record-shadow-receipt');
const { evaluateShadowReadiness, percentile95 } = require('../../tools/managed-governance-control-plane/lib/application/evaluate-readiness');
const { digestCanonical } = require('../../packages/managed-governance-contracts');

const WINDOW_START = '2026-08-01T00:00:00.000Z';
const WINDOW_END = '2026-08-31T00:00:00.000Z';
const EVALUATED_AT = '2026-08-31T06:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTOR = { type: 'automation', id: 'readiness-test' };

function digestFor(label) {
  return `sha256:${crypto.createHash('sha256').update(label).digest('hex')}`;
}

async function newOrganization(organizationId) {
  const repository = new MemoryGovernanceRepository({ clock: () => new Date(EVALUATED_AT) });
  await repository.ensureOrganization({
    organization_id: organizationId,
    idempotency_key: 'org-create',
    actor: ACTOR,
    organization: { slug: organizationId, display_name: 'Readiness Test' },
  });
  return repository;
}

function dayObservedAt(day, hour = 12) {
  return new Date(Date.parse(WINDOW_START) + day * DAY_MS + hour * 60 * 60 * 1000).toISOString();
}

async function recordDailyReceipts({ repository, organizationId, repositoryId, adapter, statusForDay, skipDays = [] }) {
  const recorded = [];
  for (let day = 0; day < 30; day += 1) {
    if (skipDays.includes(day)) continue;
    const status = typeof statusForDay === 'function' ? statusForDay(day) : statusForDay;
    const receipt = await recordShadowReceipt(
      {
        organizationId,
        actor: ACTOR,
        repositoryId,
        adapter,
        sessionFingerprint: digestFor(`session:${repositoryId}:${adapter}:${day}`),
        localDigest: digestFor(`local:${day}`),
        remoteDigest: status === 'remote_unavailable' ? null : digestFor(`local:${day}`),
        releaseDigest: null,
        status,
        reasonCode: `managed_shadow.${status}`,
        observedAt: dayObservedAt(day),
      },
      { repository },
    );
    recorded.push(receipt);
  }
  return recorded;
}

function readinessInput(overrides) {
  return {
    actor: ACTOR,
    windowStart: WINDOW_START,
    evaluatedAt: EVALUATED_AT,
    activeRepositories: [],
    enabledAdapters: [],
    receipts: [],
    eligibleSessions: 0,
    preflightLatencySamplesMs: [],
    signerEvidenceCurrent: true,
    recoveryEvidenceCurrent: true,
    threatModelEvidenceCurrent: true,
    rollbackEvidenceCurrent: true,
    ...overrides,
  };
}

test('recordShadowReceipt is idempotent by adapter/session identity, not by receipt content', async () => {
  const organizationId = 'readiness-org-receipt-idempotency';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const base = {
    organizationId,
    actor: ACTOR,
    repositoryId,
    adapter: 'claude-code',
    sessionFingerprint: digestFor('session-1'),
    localDigest: digestFor('local'),
    remoteDigest: digestFor('local'),
    releaseDigest: null,
    status: 'equivalent',
    reasonCode: 'managed_shadow.constitution_equivalent',
    observedAt: dayObservedAt(0),
  };

  const first = await recordShadowReceipt(base, { repository });
  const second = await recordShadowReceipt(base, { repository });
  assert.equal(first.shadow_receipt_id, second.shadow_receipt_id);
  assert.equal(
    first.shadow_receipt_id,
    deterministicReceiptId(
      digestCanonical({
        organization_id: organizationId,
        repository_id: repositoryId,
        adapter: base.adapter,
        session_fingerprint: base.sessionFingerprint,
      }),
    ),
  );

  await assert.rejects(
    recordShadowReceipt({ ...base, status: 'drift_detected', reasonCode: 'managed_shadow.constitution_drift' }, { repository }),
    (error) => error.code === 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
  );
  await assert.rejects(
    recordShadowReceipt({ ...base, observedAt: dayObservedAt(1) }, { repository }),
    (error) => error.code === 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
  );
});

test('recordShadowReceipt derives receipt_id from identity, independent of digests or status', async () => {
  const organizationId = 'readiness-org-receipt-identity';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const identity = { organizationId, repositoryId, adapter: 'codex', sessionFingerprint: digestFor('session-2') };
  const equivalent = await recordShadowReceipt(
    {
      ...identity,
      actor: ACTOR,
      localDigest: digestFor('a'),
      remoteDigest: digestFor('a'),
      releaseDigest: null,
      status: 'equivalent',
      reasonCode: 'managed_shadow.constitution_equivalent',
      observedAt: dayObservedAt(0),
    },
    { repository },
  );
  assert.match(equivalent.shadow_receipt_id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('evaluateShadowReadiness reports ready when every day has conclusive evidence', async () => {
  const organizationId = 'readiness-org-happy-path';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';
  const receipts = await recordDailyReceipts({ repository, organizationId, repositoryId, adapter, statusForDay: 'equivalent' });

  const input = readinessInput({
    organizationId,
    activeRepositories: [repositoryId],
    enabledAdapters: [adapter],
    receipts,
    eligibleSessions: 30,
    preflightLatencySamplesMs: Array.from({ length: 30 }, () => 150),
  });
  const report = await evaluateShadowReadiness(input, { repository });
  assert.equal(report.ready, true);
  assert.equal(report.window_days, 30);
  assert.equal(report.window_start, WINDOW_START);
  assert.equal(report.window_end, WINDOW_END);
  assert.equal(report.covered_sessions, 30);
  assert.deepEqual(report.repositories_missing_evidence, []);
  assert.deepEqual(report.adapters_missing_evidence, []);
  assert.equal(report.open_drift_count, 0);
  assert.equal(report.remote_unavailable_samples, 0);
  assert.equal(report.authorizes_enforcement, false);

  const stored = await repository.getReadinessEvaluation(organizationId, report.readiness_evaluation_id);
  assert.deepEqual(stored, report);

  const second = await evaluateShadowReadiness(input, { repository });
  assert.equal(second.readiness_evaluation_id, report.readiness_evaluation_id);
});

test('a re-evaluation of the same window with different evidence is a real conflict, not a silent overwrite', async () => {
  const organizationId = 'readiness-org-conflict';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';
  const receipts = await recordDailyReceipts({ repository, organizationId, repositoryId, adapter, statusForDay: 'equivalent' });
  const input = readinessInput({
    organizationId,
    activeRepositories: [repositoryId],
    enabledAdapters: [adapter],
    receipts,
    eligibleSessions: 30,
    preflightLatencySamplesMs: Array.from({ length: 30 }, () => 150),
  });
  await evaluateShadowReadiness(input, { repository });
  await assert.rejects(
    evaluateShadowReadiness({ ...input, eligibleSessions: 31 }, { repository }),
    (error) => error.code === 'MANAGED_GOVERNANCE_IDEMPOTENCY_CONFLICT',
  );
});

test('missing days are explicit and block readiness even when the aggregate ratio looks fine', async () => {
  const organizationId = 'readiness-org-missing-days';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';
  const receipts = await recordDailyReceipts({
    repository,
    organizationId,
    repositoryId,
    adapter,
    statusForDay: 'equivalent',
    skipDays: [5, 17],
  });

  const report = await evaluateShadowReadiness(
    readinessInput({
      organizationId,
      activeRepositories: [repositoryId],
      enabledAdapters: [adapter],
      receipts,
      eligibleSessions: 28,
      preflightLatencySamplesMs: Array.from({ length: 28 }, () => 150),
    }),
    { repository },
  );
  assert.equal(report.covered_sessions, 28);
  assert.equal(report.eligible_sessions, 28);
  assert.deepEqual(report.repositories_missing_evidence, [repositoryId]);
  assert.deepEqual(report.adapters_missing_evidence, [adapter]);
  assert.equal(report.ready, false);
});

test('adapters missing evidence block readiness independent of repository coverage', async () => {
  const organizationId = 'readiness-org-missing-adapter';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const coveredAdapter = 'claude-code';
  const missingAdapter = 'codex';
  const receipts = await recordDailyReceipts({ repository, organizationId, repositoryId, adapter: coveredAdapter, statusForDay: 'equivalent' });

  const report = await evaluateShadowReadiness(
    readinessInput({
      organizationId,
      activeRepositories: [repositoryId],
      enabledAdapters: [coveredAdapter, missingAdapter],
      receipts,
      eligibleSessions: 30,
      preflightLatencySamplesMs: Array.from({ length: 30 }, () => 150),
    }),
    { repository },
  );
  assert.deepEqual(report.repositories_missing_evidence, []);
  assert.deepEqual(report.adapters_missing_evidence, [missingAdapter]);
  assert.equal(report.ready, false);
});

test('remote-unavailable receipts are recorded and reported but never count as coverage or equivalence', async () => {
  const organizationId = 'readiness-org-unavailable';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';
  const unavailableDays = new Set([3, 21]);
  const receipts = await recordDailyReceipts({
    repository,
    organizationId,
    repositoryId,
    adapter,
    statusForDay: (day) => (unavailableDays.has(day) ? 'remote_unavailable' : 'equivalent'),
  });

  const report = await evaluateShadowReadiness(
    readinessInput({
      organizationId,
      activeRepositories: [repositoryId],
      enabledAdapters: [adapter],
      receipts,
      eligibleSessions: 30,
      preflightLatencySamplesMs: Array.from({ length: 28 }, () => 150),
    }),
    { repository },
  );
  assert.equal(report.remote_unavailable_samples, 2);
  assert.equal(report.covered_sessions, 28);
  assert.equal(report.open_drift_count, 0);
  assert.equal(report.open_invalid_contract_count, 0);
  // 28/30 falls below the 95% bar and the two unavailable days are not conclusive evidence,
  // so this window is explicitly not ready — unavailability never buys coverage.
  assert.deepEqual(report.repositories_missing_evidence, [repositoryId]);
  assert.equal(report.ready, false);
});

test('a window where every session is remote-unavailable is never ready, regardless of every other flag', async () => {
  const organizationId = 'readiness-org-all-unavailable';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';
  const receipts = await recordDailyReceipts({ repository, organizationId, repositoryId, adapter, statusForDay: 'remote_unavailable' });

  const report = await evaluateShadowReadiness(
    readinessInput({
      organizationId,
      activeRepositories: [repositoryId],
      enabledAdapters: [adapter],
      receipts,
      eligibleSessions: 30,
      preflightLatencySamplesMs: [],
    }),
    { repository },
  );
  assert.equal(report.covered_sessions, 0);
  assert.equal(report.remote_unavailable_samples, 30);
  assert.deepEqual(report.repositories_missing_evidence, [repositoryId]);
  assert.deepEqual(report.adapters_missing_evidence, [adapter]);
  assert.equal(report.ready, false);
});

test('open drift and invalid-contract outcomes block readiness even with full coverage', async () => {
  const organizationId = 'readiness-org-drift';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';
  const receipts = await recordDailyReceipts({
    repository,
    organizationId,
    repositoryId,
    adapter,
    statusForDay: (day) => (day === 10 ? 'drift_detected' : day === 20 ? 'invalid_local_contract' : 'equivalent'),
  });

  const report = await evaluateShadowReadiness(
    readinessInput({
      organizationId,
      activeRepositories: [repositoryId],
      enabledAdapters: [adapter],
      receipts,
      eligibleSessions: 30,
      preflightLatencySamplesMs: Array.from({ length: 30 }, () => 150),
    }),
    { repository },
  );
  // Drift and invalid-contract receipts are still conclusive evidence — every day is covered —
  // but readiness is blocked anyway because the outcome itself is unresolved.
  assert.deepEqual(report.repositories_missing_evidence, []);
  assert.equal(report.open_drift_count, 1);
  assert.equal(report.open_invalid_contract_count, 1);
  assert.equal(report.ready, false);
});

test('p95 preflight latency above 500ms fails readiness even with perfect coverage', async () => {
  const organizationId = 'readiness-org-latency';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';
  const receipts = await recordDailyReceipts({ repository, organizationId, repositoryId, adapter, statusForDay: 'equivalent' });

  const slowSamples = Array.from({ length: 30 }, (_, index) => (index < 28 ? 100 : 900));
  const report = await evaluateShadowReadiness(
    readinessInput({
      organizationId,
      activeRepositories: [repositoryId],
      enabledAdapters: [adapter],
      receipts,
      eligibleSessions: 30,
      preflightLatencySamplesMs: slowSamples,
    }),
    { repository },
  );
  assert.ok(report.preflight_latency_p95_ms > 500, `expected p95 above 500ms, got ${report.preflight_latency_p95_ms}`);
  assert.equal(report.ready, false);
});

test('missing latency telemetry for a covered window fails closed instead of reporting an implausible 0ms p95', async () => {
  const organizationId = 'readiness-org-no-telemetry';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';
  const receipts = await recordDailyReceipts({ repository, organizationId, repositoryId, adapter, statusForDay: 'equivalent' });

  await assert.rejects(
    evaluateShadowReadiness(
      readinessInput({
        organizationId,
        activeRepositories: [repositoryId],
        enabledAdapters: [adapter],
        receipts,
        eligibleSessions: 30,
        preflightLatencySamplesMs: [],
      }),
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_READINESS_INPUT_INVALID',
  );
});

test('stale supporting evidence (signer, recovery, threat-model, rollback) blocks readiness independently', async () => {
  const flags = [
    ['signerEvidenceCurrent', 'signer'],
    ['recoveryEvidenceCurrent', 'recovery'],
    ['threatModelEvidenceCurrent', 'threat-model'],
    ['rollbackEvidenceCurrent', 'rollback'],
  ];
  for (const [flag, slug] of flags) {
    const organizationId = `readiness-org-stale-${slug}`;
    const repository = await newOrganization(organizationId);
    const repositoryId = crypto.randomUUID();
    const adapter = 'claude-code';
    const receipts = await recordDailyReceipts({ repository, organizationId, repositoryId, adapter, statusForDay: 'equivalent' });
    const report = await evaluateShadowReadiness(
      readinessInput({
        organizationId,
        activeRepositories: [repositoryId],
        enabledAdapters: [adapter],
        receipts,
        eligibleSessions: 30,
        preflightLatencySamplesMs: Array.from({ length: 30 }, () => 150),
        [flag]: false,
      }),
      { repository },
    );
    assert.equal(report.ready, false, `${flag} should have blocked readiness`);
  }
});

test('the window must be exactly 30 consecutive completed UTC days', async () => {
  const organizationId = 'readiness-org-window';
  const repository = await newOrganization(organizationId);
  const repositoryId = crypto.randomUUID();
  const adapter = 'claude-code';

  await assert.rejects(
    evaluateShadowReadiness(
      readinessInput({
        organizationId,
        windowStart: '2026-08-01T00:00:00.500Z',
        activeRepositories: [repositoryId],
        enabledAdapters: [adapter],
      }),
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_READINESS_WINDOW_INVALID',
  );

  await assert.rejects(
    evaluateShadowReadiness(
      readinessInput({
        organizationId,
        evaluatedAt: '2026-08-30T23:59:59.000Z',
        activeRepositories: [repositoryId],
        enabledAdapters: [adapter],
      }),
      { repository },
    ),
    (error) => error.code === 'MANAGED_GOVERNANCE_READINESS_WINDOW_INCOMPLETE',
  );
});

test('percentile95 is exact at small sample sizes', () => {
  assert.equal(percentile95([100]), 100);
  assert.equal(percentile95([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]), 1000);
  assert.equal(percentile95([10, 20, 30, 40]), 40);
});
