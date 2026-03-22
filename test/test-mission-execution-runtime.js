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

  await fs.ensureDir(path.join(projectDir, '.hseos/config'));
  await fs.writeFile(
    path.join(projectDir, '.hseos/config/hseos.config.yaml'),
    'paths:\n  data: ".hseos/data"\n',
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
    ].join('\n'),
    'utf8',
  );

  const claimed = await claimWorkItem(workItemPath, { projectDir });
  assert.equal(claimed.status, 'claimed');
  assert.equal(await fs.pathExists(claimed.workspacePath), true);

  const status = await getMissionStatus(projectDir, 'mission-123');
  assert.equal(status.id, 'mission-123');
  assert.equal(status.status, 'claimed');

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

  console.log('test-mission-execution-runtime: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
