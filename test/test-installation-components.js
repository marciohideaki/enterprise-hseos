const assert = require('node:assert');
const path = require('node:path');

const {
  buildExecutionRequest,
  evaluateExecutionRequest,
  filterVisibleTools,
  loadPolicyFile,
} = require('../tools/cli/lib/policy/engine');

async function main() {
  const fixturePath = path.join(__dirname, '../.enterprise/policies/execution/foundation.policy.yaml');
  const { policy } = await loadPolicyFile(fixturePath);

  const request = buildExecutionRequest({
    actionType: 'install',
    directory: '/tmp/hseos-project',
    modules: ['bmm'],
    ides: ['codex', 'rovodev'],
    customContent: {
      sources: [{ path: '/tmp/hseos-project/modules/custom-bmm' }],
    },
  });

  const allowedDecision = evaluateExecutionRequest(request, policy, {
    projectRoot: '/tmp/hseos-project',
    frameworkRoot: path.join(__dirname, '..'),
    cwd: process.cwd(),
  });

  assert.equal(allowedDecision.allowed, true, 'foundation policy should allow a normal install request');
  assert.equal(allowedDecision.summary.mission, null);

  const restrictivePolicy = {
    ...policy,
    tools: {
      ...policy.tools,
      hidden: ['rovodev'],
    },
    custom_content: {
      allow: false,
      max_sources: 0,
    },
  };

  const deniedDecision = evaluateExecutionRequest(request, restrictivePolicy, {
    projectRoot: '/tmp/hseos-project',
    frameworkRoot: path.join(__dirname, '..'),
    cwd: process.cwd(),
  });

  assert.equal(deniedDecision.allowed, false, 'hidden tools and blocked custom content must deny execution');
  assert(deniedDecision.violations.some((entry) => entry.includes('rovodev')));
  assert(deniedDecision.violations.some((entry) => entry.includes('Custom content is disabled')));

  const catalog = [
    { value: 'codex', name: 'Codex' },
    { value: 'rovodev', name: 'Rovo Dev' },
  ];

  const visibility = filterVisibleTools(catalog, restrictivePolicy);
  assert.deepEqual(
    visibility.visible.map((tool) => tool.value),
    ['codex'],
    'hidden tools must be removed from interactive selection surfaces',
  );
  assert.deepEqual(visibility.hidden, ['rovodev']);

  const missionAwareDecision = evaluateExecutionRequest(
    {
      ...request,
      actionType: 'work-item',
      mission: {
        type: 'remediation',
        priority: 'critical',
        owner: null,
        deadlineAt: null,
        labels: ['runtime'],
        dependencies: ['policy-baseline'],
        retryClass: 'transient',
      },
    },
    policy,
    {
      projectRoot: '/tmp/hseos-project',
      frameworkRoot: path.join(__dirname, '..'),
      cwd: process.cwd(),
    },
  );

  assert.equal(missionAwareDecision.allowed, false, 'critical missions without owner and deadline must be denied');
  assert(missionAwareDecision.violations.some((entry) => entry.includes('requires an owner')));
  assert(missionAwareDecision.violations.some((entry) => entry.includes('requires a deadline')));

  const deniedMissionMetadata = evaluateExecutionRequest(
    {
      ...request,
      actionType: 'work-item',
      mission: {
        type: 'remediation',
        priority: 'high',
        owner: 'platform-ops',
        deadlineAt: '2026-03-31T12:00:00Z',
        labels: ['unknown-label'],
        dependencies: ['missing-dependency'],
        retryClass: 'policy',
      },
    },
    {
      ...policy,
      missions: {
        ...policy.missions,
        labels: {
          allow: ['runtime', 'governance'],
          deny: [],
        },
        dependencies: {
          allow: ['policy-baseline', 'runtime-baseline'],
          deny: [],
        },
      },
    },
    {
      projectRoot: '/tmp/hseos-project',
      frameworkRoot: path.join(__dirname, '..'),
      cwd: process.cwd(),
    },
  );

  assert.equal(deniedMissionMetadata.allowed, false, 'mission metadata outside governance envelope must be denied');
  assert(deniedMissionMetadata.violations.some((entry) => entry.includes('Mission label "unknown-label"')));
  assert(deniedMissionMetadata.violations.some((entry) => entry.includes('Mission dependency "missing-dependency"')));
  assert(deniedMissionMetadata.violations.some((entry) => entry.includes('requires at least one label: governance')));
  assert(deniedMissionMetadata.violations.some((entry) => entry.includes('requires at least one dependency: policy-baseline')));

  console.log('test-installation-components: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
