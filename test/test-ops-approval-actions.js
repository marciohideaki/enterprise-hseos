const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const { buildOperationsSnapshot } = require('../tools/cli/lib/ops/console-read-model');
const { recordApprovalDecision } = require('../tools/cli/lib/ops/approval-store');

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-ops-approval-'));
  const runtimeWorkItems = path.join(tempRoot, '.hseos/data/runtime/work-items');
  const runtimeEvidence = path.join(tempRoot, '.hseos/data/runtime/evidence');
  const validationDir = path.join(tempRoot, '.logs/validation');

  await fs.ensureDir(runtimeWorkItems);
  await fs.ensureDir(runtimeEvidence);
  await fs.ensureDir(validationDir);

  await fs.writeJson(path.join(runtimeWorkItems, 'mission-a.json'), {
    id: 'mission-a',
    title: 'Blocked mission',
    status: 'invalidated',
    reconcile_reason: 'source-status:blocked',
  });
  await fs.writeJson(path.join(runtimeEvidence, 'policy-event.json'), {
    type: 'policy_denied',
    missionId: 'mission-b',
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

  const before = await buildOperationsSnapshot(tempRoot);
  const policyBlocker = before.blockers.find((blocker) => blocker.key === 'policy:mission-b');
  assert.ok(policyBlocker);
  assert.equal(policyBlocker.status, 'open');
  assert.equal(before.summary.approvalEvents, 0);

  await recordApprovalDecision(tempRoot, {
    action: 'approve',
    actor: 'ops-lead',
    blocker: policyBlocker,
    blockerKey: policyBlocker.key,
    reason: 'Approved temporary override',
  });

  const approved = await buildOperationsSnapshot(tempRoot);
  const approvedPolicyBlocker = approved.blockers.find((blocker) => blocker.key === 'policy:mission-b');
  assert.ok(approvedPolicyBlocker);
  assert.equal(approved.summary.approvalEvents, 1);
  assert.equal(approved.summary.approvedBlockers, 1);
  assert.equal(approved.summary.openBlockers, 2);
  assert.equal(approvedPolicyBlocker.status, 'approved');
  assert.equal(approvedPolicyBlocker.approval.actor, 'ops-lead');
  assert.equal(approved.approvals.current[0].action, 'approve');

  await recordApprovalDecision(tempRoot, {
    action: 'revoke',
    actor: 'ops-lead',
    blocker: policyBlocker,
    blockerKey: policyBlocker.key,
    reason: 'Override withdrawn',
  });

  const revoked = await buildOperationsSnapshot(tempRoot);
  const revokedPolicyBlocker = revoked.blockers.find((blocker) => blocker.key === 'policy:mission-b');
  assert.ok(revokedPolicyBlocker);
  assert.equal(revoked.summary.approvalEvents, 2);
  assert.equal(revoked.summary.approvedBlockers, 0);
  assert.equal(revoked.summary.openBlockers, 3);
  assert.equal(revokedPolicyBlocker.status, 'open');
  assert.equal(revoked.approvals.current[0].action, 'revoke');

  console.log('test-ops-approval-actions: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
