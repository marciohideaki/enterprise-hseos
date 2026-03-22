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
  });
  await fs.writeJson(path.join(runtimeWorkItems, 'mission-b.json'), {
    id: 'mission-b',
    title: 'Blocked mission',
    status: 'invalidated',
    reconcile_reason: 'source-status:blocked',
  });
  await fs.writeFile(path.join(runtimeEvidence, 'mission-a.log'), 'claimed mission-a\n', 'utf8');
  await fs.writeFile(
    path.join(validationDir, 'gate-20260322T000000.log'),
    ['[PASS] lint', '[FAIL] tests'].join('\n'),
    'utf8',
  );

  const snapshot = await buildOperationsSnapshot(tempRoot);
  assert.equal(snapshot.summary.totalRuns, 2);
  assert.equal(snapshot.summary.invalidatedRuns, 1);
  assert.equal(snapshot.summary.evidenceFiles, 1);
  assert.equal(snapshot.blockers.length, 2);
  assert.equal(snapshot.runs.length, 2);

  console.log('test-execution-observability-surface: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
