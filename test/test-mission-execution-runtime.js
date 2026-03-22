const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const {
  claimWorkItem,
  getMissionStatus,
  processRetryQueue,
  reconcileMissionRuntime,
  retryMission,
} = require('../tools/cli/lib/runtime/work-item-runner');
const { recordApprovalDecision } = require('../tools/cli/lib/ops/approval-store');
const { buildOperationsSnapshot } = require('../tools/cli/lib/ops/console-read-model');

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-mission-runtime-'));
  const workItemPath = path.join(tempRoot, 'mission.yaml');
  const projectDir = tempRoot;
  const evidenceDir = path.join(projectDir, '.hseos/data/runtime/evidence');

  await fs.ensureDir(path.join(projectDir, '.hseos/config'));
  await fs.ensureDir(path.join(projectDir, '.enterprise/policies/execution'));
  await fs.writeFile(
    path.join(projectDir, '.hseos/config/hseos.config.yaml'),
    'paths:\n  data: ".hseos/data"\n',
    'utf8',
  );

  await fs.writeFile(
    path.join(projectDir, '.enterprise/policies/execution/foundation.policy.yaml'),
    [
      'version: 1',
      'kind: structural_execution_policy',
      'name: foundation',
      'defaults:',
      '  fail_closed: true',
      'modules:',
      '  allow: []',
      '  deny: []',
      '  max_count: 12',
      'tools:',
      '  allow: []',
      '  deny: []',
      '  hidden: []',
      '  max_count: 8',
      'paths:',
      '  allowed_roots:',
      `    - "${projectDir}"`,
      '  denied_patterns:',
      '    - ".."',
      'custom_content:',
      '  allow: true',
      '  max_sources: 4',
      'budgets:',
      '  max_total_selections: 16',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(
    workItemPath,
    [
      'id: mission-123',
      'title: Runtime claim smoke test',
      'status: ready',
      'tracker: local',
      'directive: docs-refresh',
      'owner: platform-ops',
      'priority: critical',
      'deadline_at: 2026-03-31T12:00:00Z',
      'mission_type: remediation',
      'labels:',
      '  - runtime',
      '  - governance',
      'dependencies:',
      '  - policy-baseline',
      'impact_terms:',
      '  - runtime',
      '  - policy',
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: policy enforcement traceability',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(path.join(projectDir, 'context.txt'), 'policy enforcement traceability for runtime claims', 'utf8');
  await fs.writeFile(path.join(projectDir, 'runtime-impact.js'), 'const criticalRuntimePolicy = "runtime governance dependency";\n', 'utf8');
  await fs.ensureDir(path.join(projectDir, '.hseos/data/cortex/scoped'));
  await fs.writeJson(
    path.join(projectDir, '.hseos/data/cortex/scoped/context-a.json'),
    {
      id: 'context-a',
      layer: 'scoped',
      title: 'Runtime governance context',
      content: 'policy enforcement traceability for runtime claims',
      tags: ['policy', 'runtime'],
    },
    { spaces: 2 },
  );

  const claimed = await claimWorkItem(workItemPath, { projectDir });
  assert.equal(claimed.status, 'claimed');
  assert.equal(await fs.pathExists(claimed.workspacePath), true);
  assert.equal(claimed.policy_allowed, true);
  assert.equal(claimed.cortex_context_ids.length, 1);
  assert.equal(claimed.owner, 'platform-ops');
  assert.equal(claimed.priority, 'critical');
  assert.equal(claimed.deadline_at, '2026-03-31T12:00:00.000Z');
  assert.equal(claimed.mission_type, 'remediation');
  assert.deepEqual(claimed.labels, ['runtime', 'governance']);
  assert.deepEqual(claimed.dependencies, ['policy-baseline']);
  assert.equal(claimed.retry_policy.retry_class, 'transient');
  assert.equal(claimed.retry_policy.max_attempts, 3);
  assert.equal(claimed.attempt_count, 1);
  assert.equal(claimed.execution_phase, 'claimed');
  assert.ok(claimed.cortex_impact);
  assert(claimed.cortex_impact.matches.length > 0);
  assert.equal(await fs.pathExists(path.join(claimed.workspacePath, 'context.json')), true);
  const workspaceContext = await fs.readJson(path.join(claimed.workspacePath, 'context.json'));
  assert.equal(workspaceContext.missionContext.priority, 'critical');
  assert(workspaceContext.impact.matches.length > 0);
  const claimedEvidenceFiles = await fs.readdir(evidenceDir);
  const claimedEvents = await Promise.all(
    claimedEvidenceFiles
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => fs.readJson(path.join(evidenceDir, entry))),
  );
  assert.equal(claimedEvents.some((event) => event.type === 'mission_claimed' && event.missionId === 'mission-123'), true);

  const status = await getMissionStatus(projectDir, 'mission-123');
  assert.equal(status.id, 'mission-123');
  assert.equal(status.status, 'claimed');
  assert.equal(status.cortex_query, 'policy enforcement traceability');
  assert.equal(status.owner, 'platform-ops');
  assert.equal(status.priority, 'critical');

  await fs.writeFile(
    workItemPath,
    [
      'id: mission-123',
      'title: Runtime claim smoke test',
      'status: cancelled',
      'tracker: local',
    ].join('\n'),
    'utf8',
  );

  const reconciled = await reconcileMissionRuntime(projectDir);
  assert.equal(reconciled.updated, 1);

  const invalidated = await getMissionStatus(projectDir, 'mission-123');
  assert.equal(invalidated.status, 'invalidated');
  assert.equal(invalidated.execution_phase, 'invalidated');
  assert.equal(invalidated.state_reason, 'source-status:cancelled');

  await assert.rejects(
    retryMission(projectDir, 'mission-123'),
    /source status "cancelled" is not retryable/,
  );

  const retryablePath = path.join(projectDir, 'mission-retry.yaml');
  await fs.writeFile(
    retryablePath,
    [
      'id: mission-retry',
      'title: Retryable mission',
      'status: ready',
      'tracker: local',
      'owner: platform-ops',
      'priority: high',
      'mission_type: remediation',
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: runtime retry traceability',
    ].join('\n'),
    'utf8',
  );

  const retryClaimed = await claimWorkItem(retryablePath, { projectDir });
  assert.equal(retryClaimed.attempt_count, 1);

  await fs.writeFile(
    retryablePath,
    [
      'id: mission-retry',
      'title: Retryable mission',
      'status: blocked',
      'tracker: local',
      'owner: platform-ops',
      'priority: high',
      'mission_type: remediation',
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: runtime retry traceability',
    ].join('\n'),
    'utf8',
  );
  await reconcileMissionRuntime(projectDir);
  await assert.rejects(
    retryMission(projectDir, 'mission-retry'),
    /source status "blocked" is not retryable/,
  );

  await fs.writeFile(
    retryablePath,
    [
      'id: mission-retry',
      'title: Retryable mission',
      'status: ready',
      'tracker: local',
      'owner: platform-ops',
      'priority: high',
      'mission_type: remediation',
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: runtime retry traceability',
    ].join('\n'),
    'utf8',
  );
  await assert.rejects(
    retryMission(projectDir, 'mission-retry'),
    /requires blocker approval before retry/,
  );

  const blockedSnapshot = await buildOperationsSnapshot(projectDir);
  const runtimeBlocker = blockedSnapshot.blockers.find((blocker) => blocker.key === 'runtime:mission-retry');
  assert.ok(runtimeBlocker);
  await recordApprovalDecision(projectDir, {
    action: 'approve',
    actor: 'ops-lead',
    blocker: runtimeBlocker,
    blockerKey: runtimeBlocker.key,
    reason: 'Approved retry',
  });

  await fs.writeFile(
    retryablePath,
    [
      'id: mission-retry',
      'title: Retryable mission',
      'status: ready',
      'tracker: local',
      'owner: platform-ops',
      'priority: high',
      'mission_type: remediation',
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: runtime retry traceability',
    ].join('\n'),
    'utf8',
  );
  const retried = await retryMission(projectDir, 'mission-retry');
  assert.equal(retried.status, 'claimed');
  assert.equal(retried.execution_phase, 'retry-claimed');
  assert.equal(retried.state_reason, 'manual-retry');
  assert.equal(retried.attempt_count, 2);

  const automatedPath = path.join(projectDir, 'mission-auto.yaml');
  await fs.writeFile(
    automatedPath,
    [
      'id: mission-auto',
      'title: Automated retry mission',
      'status: ready',
      'tracker: local',
      'owner: platform-ops',
      'priority: medium',
      'mission_type: remediation',
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: automated retry governance',
    ].join('\n'),
    'utf8',
  );
  await claimWorkItem(automatedPath, { projectDir });
  await fs.writeFile(
    automatedPath,
    [
      'id: mission-auto',
      'title: Automated retry mission',
      'status: blocked',
      'tracker: local',
      'owner: platform-ops',
      'priority: medium',
      'mission_type: remediation',
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: automated retry governance',
    ].join('\n'),
    'utf8',
  );
  await reconcileMissionRuntime(projectDir);
  const automationBeforeApproval = await processRetryQueue(projectDir);
  assert.equal(automationBeforeApproval.discovered >= 1, true);
  assert.equal(automationBeforeApproval.attempted, 0);
  assert.equal(automationBeforeApproval.skipped.some((entry) => entry.missionId === 'mission-auto'), true);

  const automationSnapshot = await buildOperationsSnapshot(projectDir);
  const automationBlocker = automationSnapshot.blockers.find((blocker) => blocker.key === 'runtime:mission-auto');
  assert.ok(automationBlocker);
  await recordApprovalDecision(projectDir, {
    action: 'approve',
    actor: 'ops-lead',
    blocker: automationBlocker,
    blockerKey: automationBlocker.key,
    reason: 'Approved governed queue retry',
  });

  await fs.writeFile(
    automatedPath,
    [
      'id: mission-auto',
      'title: Automated retry mission',
      'status: ready',
      'tracker: local',
      'owner: platform-ops',
      'priority: medium',
      'mission_type: remediation',
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: automated retry governance',
    ].join('\n'),
    'utf8',
  );
  const automationResult = await processRetryQueue(projectDir, { limit: 1 });
  assert.equal(automationResult.attempted, 1);
  assert.equal(automationResult.succeeded.length, 1);
  assert.equal(automationResult.succeeded[0].missionId, 'mission-auto');
  const automationStatus = await getMissionStatus(projectDir, 'mission-auto');
  assert.equal(automationStatus.status, 'claimed');
  assert.equal(automationStatus.attempt_count, 2);

  const deniedWorkItemPath = path.join(projectDir, 'denied-mission.yaml');
  await fs.writeFile(
    path.join(projectDir, '.enterprise/policies/execution/foundation.policy.yaml'),
    [
      'version: 1',
      'kind: structural_execution_policy',
      'name: foundation',
      'defaults:',
      '  fail_closed: true',
      'modules:',
      '  allow: []',
      '  deny: []',
      '  max_count: 12',
      'tools:',
      '  allow: []',
      '  deny: []',
      '  hidden: []',
      '  max_count: 8',
      'paths:',
      '  allowed_roots:',
      `    - "${projectDir}/allowed-only"`,
      '  denied_patterns:',
      '    - ".."',
      'custom_content:',
      '  allow: true',
      '  max_sources: 4',
      'missions:',
      '  types:',
      '    allow: []',
      '    deny: []',
      '  priorities:',
      '    allow: []',
      '    deny: []',
      '  owners:',
      '    allow: []',
      '    deny: []',
      '  require_owner_for_priorities:',
      '    - critical',
      '  require_deadline_for_priorities:',
      '    - critical',
      'budgets:',
      '  max_total_selections: 16',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    deniedWorkItemPath,
    [
      'id: mission-denied',
      'title: Denied claim',
      'status: ready',
      'tracker: local',
      'priority: critical',
      'mission_type: remediation',
    ].join('\n'),
    'utf8',
  );

  await assert.rejects(
    claimWorkItem(deniedWorkItemPath, { projectDir }),
    /Mission priority "critical" requires an owner/,
  );
  assert.equal(await fs.pathExists(path.join(projectDir, '.hseos/data/runtime/workspaces/mission-denied')), false);
  const finalEvidenceFiles = await fs.readdir(evidenceDir);
  const finalEvents = await Promise.all(
    finalEvidenceFiles
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => fs.readJson(path.join(evidenceDir, entry))),
  );
  assert.equal(finalEvents.some((event) => event.type === 'policy_denied' && event.missionId === 'mission-denied'), true);
  assert.equal(finalEvents.some((event) => event.type === 'retry_queue_processed'), true);

  console.log('test-mission-execution-runtime: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
