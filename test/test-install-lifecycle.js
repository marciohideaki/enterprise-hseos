const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const { Manifest } = require('../tools/cli/installers/lib/core/manifest');
const { buildInstallDoctorReport, captureInstalledState, repairInstallState } = require('../tools/cli/lib/install/lifecycle');
const { buildInstallPlan } = require('../tools/cli/lib/install/plan-runtime');
const { readInstallState } = require('../tools/cli/lib/install/install-state');

async function main() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-install-lifecycle-'));
  const hseosDir = path.join(projectDir, '.hseos');
  await fs.ensureDir(hseosDir);
  await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'install-lifecycle-test', version: '1.0.0' }, { spaces: 2 });

  const manifest = new Manifest();
  await manifest.create(hseosDir, {
    version: '1.0.0',
    modules: ['hsm'],
    ides: ['codex'],
  });

  const plan = await buildInstallPlan({
    projectDir,
    modules: 'hsm',
    tools: 'codex',
  });
  assert.equal(plan.selectedModules.includes('hsm'), true);
  assert.equal(plan.selectedIdes.includes('codex'), true);

  const state = await captureInstalledState(projectDir, plan);
  assert.equal(state.selectedModules.includes('hsm'), true);
  assert.equal(state.selectedIdes.includes('codex'), true);

  const healthyDoctor = await buildInstallDoctorReport(projectDir);
  assert.equal(healthyDoctor.status, 'ok');

  await manifest.update(hseosDir, { modules: ['hsm'], ides: [] });
  const driftDoctor = await buildInstallDoctorReport(projectDir);
  assert.equal(driftDoctor.status, 'warning');
  assert.equal(driftDoctor.issues.some((issue) => issue.code === 'ide_drift'), true);

  const repair = await repairInstallState(projectDir);
  assert.equal(repair.repaired.includes('install-state'), true);

  const repairedState = await readInstallState(projectDir);
  assert.deepEqual(repairedState.selectedIdes, []);

  console.log('test-install-lifecycle: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
