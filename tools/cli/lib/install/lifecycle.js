const path = require('node:path');
const { Manifest } = require('../../installers/lib/core/manifest');
const { buildInstallPlan, emitInstallEvent } = require('./plan-runtime');
const { readInstallState, writeInstallState } = require('./install-state');

async function captureInstalledState(projectDir, plan = null) {
  const targetPlan = plan || await buildInstallPlan({ projectDir });
  const manifest = new Manifest();
  const manifestData = await manifest.read(path.join(targetPlan.projectDir, '.hseos'));

  if (!manifestData) {
    throw new Error('No HSEOS installation manifest found. Run "hseos install" first.');
  }

  const state = await writeInstallState(targetPlan.projectDir, {
    sourceVersion: targetPlan.sourceVersion,
    targetAdapter: targetPlan.targetAdapter,
    targetRoot: targetPlan.targetRoot,
    hseosDir: targetPlan.hseosDir,
    mode: targetPlan.mode,
    requestedModules: targetPlan.requestedModules,
    requestedIdes: targetPlan.requestedIdes,
    selectedModules: manifestData.modules || [],
    selectedIdes: manifestData.ides || [],
    operations: targetPlan.operations,
    manifestVersion: manifestData.version || null,
    installDate: manifestData.installDate || null,
    lastUpdated: manifestData.lastUpdated || null,
    health: 'ok',
  });

  await emitInstallEvent(targetPlan.projectDir, 'install_state_applied', {
    selectedModules: state.selectedModules,
    selectedIdes: state.selectedIdes,
    targetAdapter: state.targetAdapter,
  });

  return state;
}

async function buildInstallDoctorReport(projectDir = process.cwd()) {
  const state = await readInstallState(projectDir);
  const manifest = new Manifest();
  const manifestData = await manifest.read(path.join(projectDir, '.hseos'));
  const issues = [];

  if (!state) {
    issues.push({
      severity: 'warning',
      code: 'install_state_missing',
      message: 'Canonical install-state is missing.',
    });
  }

  if (!manifestData) {
    issues.push({
      severity: 'error',
      code: 'install_manifest_missing',
      message: 'Installation manifest is missing under .hseos/_config/manifest.yaml.',
    });
  }

  if (state && manifestData) {
    const stateModules = state.selectedModules || [];
    const manifestModules = manifestData.modules || [];
    const stateIdes = state.selectedIdes || [];
    const manifestIdes = manifestData.ides || [];

    if (JSON.stringify(stateModules) !== JSON.stringify(manifestModules)) {
      issues.push({
        severity: 'warning',
        code: 'module_drift',
        message: `Install-state modules drift from manifest (${stateModules.join(', ') || '(none)'} != ${manifestModules.join(', ') || '(none)'})`,
      });
    }

    if (JSON.stringify(stateIdes) !== JSON.stringify(manifestIdes)) {
      issues.push({
        severity: 'warning',
        code: 'ide_drift',
        message: `Install-state IDEs drift from manifest (${stateIdes.join(', ') || '(none)'} != ${manifestIdes.join(', ') || '(none)'})`,
      });
    }

    if (state.manifestVersion && manifestData.version && state.manifestVersion !== manifestData.version) {
      issues.push({
        severity: 'warning',
        code: 'version_drift',
        message: `Install-state manifestVersion=${state.manifestVersion} differs from manifest version=${manifestData.version}`,
      });
    }
  }

  const status = issues.some((entry) => entry.severity === 'error')
    ? 'error'
    : issues.length > 0
      ? 'warning'
      : 'ok';

  return {
    status,
    projectDir: path.resolve(projectDir),
    issues,
  };
}

async function repairInstallState(projectDir = process.cwd(), options = {}) {
  const plan = await buildInstallPlan({ projectDir });
  const doctor = await buildInstallDoctorReport(projectDir);
  const dryRun = Boolean(options.dryRun);
  const repaired = [];

  if (doctor.issues.some((entry) => ['install_state_missing', 'module_drift', 'ide_drift', 'version_drift'].includes(entry.code))) {
    if (!dryRun) {
      await captureInstalledState(projectDir, plan);
    }
    repaired.push('install-state');
  }

  await emitInstallEvent(projectDir, dryRun ? 'install_repair_planned' : 'install_repair_completed', {
    repaired,
    dryRun,
  });

  return {
    dryRun,
    repaired,
    status: doctor.status,
  };
}

module.exports = {
  buildInstallDoctorReport,
  captureInstalledState,
  repairInstallState,
};
