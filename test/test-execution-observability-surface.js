const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const {
  buildOperationsSnapshot,
} = require('../tools/cli/lib/ops/console-read-model');

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-ops-surface-'));
  const runtimeWorkItems = path.join(tempRoot, '.hseos/data/runtime/work-items');
  const runtimeEvidence = path.join(tempRoot, '.hseos/data/runtime/evidence');
  const validationDir = path.join(tempRoot, '.logs/validation');

  await fs.ensureDir(runtimeWorkItems);
  await fs.ensureDir(runtimeEvidence);
  await fs.ensureDir(validationDir);

  await fs.writeJson(path.join(runtimeWorkItems, 'mission-a.json'), {
    id: 'mission-a',
    title: 'Healthy mission',
    status: 'claimed',
    owner: 'platform-ops',
    priority: 'critical',
    mission_type: 'remediation',
    policy_pack: 'foundation',
    deadline_at: '2026-03-21T00:00:00Z',
    cortex_query: 'runtime policy',
    cortex_trace: { query: 'runtime policy', results: [{ id: 'ctx-1' }] },
    cortex_impact: { matches: [{ file: 'src/runtime.js', matchedTerms: ['runtime', 'policy'] }] },
  });
  await fs.writeJson(path.join(runtimeWorkItems, 'mission-b.json'), {
    id: 'mission-b',
    title: 'Blocked mission',
    status: 'invalidated',
    reconcile_reason: 'source-status:blocked',
    owner: 'unassigned',
    priority: 'medium',
    mission_type: 'delivery',
    policy_pack: 'foundation',
  });
  await fs.writeFile(path.join(runtimeEvidence, 'mission-a.log'), 'claimed mission-a\n', 'utf8');
  await fs.writeJson(path.join(runtimeEvidence, 'event-1.json'), {
    type: 'policy_denied',
    missionId: 'mission-c',
    timestamp: '2026-03-22T00:00:01Z',
    summary: 'Mission claim denied',
    details: {
      violations: ['Path denied'],
    },
  });
  await fs.writeFile(
    path.join(validationDir, 'gate-20260322T000000.log'),
    ['[PASS] lint', '[FAIL] tests'].join('\n'),
    'utf8',
  );

  const snapshot = await buildOperationsSnapshot(tempRoot);
  assert.equal(snapshot.summary.totalRuns, 2);
  assert.equal(snapshot.summary.invalidatedRuns, 1);
  assert.equal(snapshot.summary.evidenceFiles, 2);
  assert.equal(snapshot.summary.policyDenials, 1);
  assert.equal(snapshot.summary.missionsWithCortex, 1);
  assert.equal(snapshot.summary.missionsWithImpact, 1);
  assert.equal(snapshot.summary.criticalRuns, 1);
  assert.equal(snapshot.summary.overdueRuns, 1);
  assert.equal(snapshot.summary.approvalEvents, 0);
  assert.equal(snapshot.summary.approvedBlockers, 0);
  assert.equal(snapshot.summary.openBlockers, 3);
  assert.equal(snapshot.blockers.length, 3);
  assert.equal(snapshot.runs.length, 2);
  assert.equal(snapshot.evidence.events.length, 1);
  assert.equal(snapshot.blockers.every((blocker) => typeof blocker.key === 'string' && blocker.status === 'open'), true);
  assert.equal(snapshot.posture.missionRuntime.runsByPriority.critical, 1);
  assert.equal(snapshot.posture.missionRuntime.runsByMissionType.remediation, 1);
  assert.equal(snapshot.posture.governance.runsByPolicyPack.foundation, 2);
  assert.equal(snapshot.posture.cortex.missionsWithContext.includes('mission-a'), true);
  assert.equal(snapshot.posture.cortex.impactCoverage[0].impactMatches, 1);

  console.log('test-execution-observability-surface: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
