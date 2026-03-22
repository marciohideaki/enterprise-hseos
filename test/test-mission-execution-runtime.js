const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const {
  claimWorkItem,
  getMissionStatus,
  reconcileMissionRuntime,
} = require('../tools/cli/lib/runtime/work-item-runner');

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
      'retry_class: transient',
      'max_attempts: 3',
      'context_query: policy enforcement traceability',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(path.join(projectDir, 'context.txt'), 'policy enforcement traceability for runtime claims', 'utf8');
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
  assert.equal(await fs.pathExists(path.join(claimed.workspacePath, 'context.json')), true);
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

  console.log('test-mission-execution-runtime: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
