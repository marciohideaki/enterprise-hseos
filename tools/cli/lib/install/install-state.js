const fs = require('fs-extra');
const path = require('node:path');
const { resolveHseosDataPaths } = require('../hseos-data');

async function resolveInstallStatePath(projectDir = process.cwd()) {
  const paths = await resolveHseosDataPaths(projectDir);
  await fs.ensureDir(paths.installRoot);
  return path.join(paths.installRoot, 'install-state.json');
}

async function readInstallState(projectDir = process.cwd()) {
  const statePath = await resolveInstallStatePath(projectDir);
  if (!(await fs.pathExists(statePath))) {
    return null;
  }
  return fs.readJson(statePath);
}

async function writeInstallState(projectDir, state) {
  const statePath = await resolveInstallStatePath(projectDir);
  const payload = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeJson(statePath, payload, { spaces: 2 });
  return payload;
}

module.exports = {
  readInstallState,
  resolveInstallStatePath,
  writeInstallState,
};
