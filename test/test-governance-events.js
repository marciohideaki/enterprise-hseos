const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const {
  acknowledgeGovernanceEvent,
  explainGovernanceEvent,
  findGovernanceEvent,
  readGovernanceEvents,
  writeGovernanceEvent,
} = require('../tools/cli/lib/governance/events/store');

async function main() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-governance-events-'));

  const created = await writeGovernanceEvent(projectDir, {
    type: 'worker_spawned',
    source: 'test',
    severity: 'warning',
    sessionId: 'session-1',
    workerId: 'worker-1',
    summary: 'Worker started',
    payload: { branch: 'local-session-1-worker-1' },
  });

  const listed = await readGovernanceEvents(projectDir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);

  const inspected = await findGovernanceEvent(projectDir, created.id);
  assert.equal(inspected.type, 'worker_spawned');

  const acknowledged = await acknowledgeGovernanceEvent(projectDir, created.id, {
    actor: 'ops-lead',
    reason: 'Observed',
  });
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.acknowledgedBy, 'ops-lead');

  const explanation = explainGovernanceEvent(acknowledged);
  assert(explanation.includes(`Event: ${created.id}`));
  assert(explanation.includes('Status: acknowledged'));

  console.log('test-governance-events: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
