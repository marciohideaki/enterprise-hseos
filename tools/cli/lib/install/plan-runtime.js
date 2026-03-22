const path = require('node:path');
const { ModuleManager } = require('../../installers/lib/modules/manager');
const { IdeManager } = require('../../installers/lib/ide/manager');
const { Manifest } = require('../../installers/lib/core/manifest');
const { resolveInstallStatePath } = require('./install-state');
const { writeGovernanceEvent } = require('../governance/events/store');

function normalizeCsv(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeCsv(entry));
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

async function getCurrentManifest(projectDir) {
  const manifest = new Manifest();
  const hseosDir = path.join(projectDir, '.hseos');
  return manifest.read(hseosDir);
}

async function buildInstallPlan(options = {}) {
  const projectDir = path.resolve(options.projectDir || options.directory || process.cwd());
  const moduleManager = new ModuleManager();
  const ideManager = new IdeManager();
  await ideManager.ensureInitialized();

  const availableModules = await moduleManager.listAvailable();
  const allModuleIds = new Set(availableModules.modules.map((entry) => entry.id));
  const allIdeIds = new Set(ideManager.getAvailableIdes().map((entry) => entry.value));
  const requestedModules = normalizeCsv(options.modules);
  const requestedIdes = normalizeCsv(options.tools);

  const invalidModules = requestedModules.filter((entry) => !allModuleIds.has(entry));
  const invalidIdes = requestedIdes.filter((entry) => !allIdeIds.has(entry));

  if (invalidModules.length > 0) {
    throw new Error(`Unknown modules: ${invalidModules.join(', ')}`);
  }
  if (invalidIdes.length > 0) {
    throw new Error(`Unknown tools: ${invalidIdes.join(', ')}`);
  }

  const manifest = await getCurrentManifest(projectDir);
  const selectedModules = requestedModules.length > 0 ? requestedModules : manifest?.modules || [];
  const selectedIdes = requestedIdes.length > 0 ? requestedIdes : manifest?.ides || [];
  const installStatePath = await resolveInstallStatePath(projectDir);

  return {
    mode: requestedModules.length > 0 || requestedIdes.length > 0 ? 'explicit' : 'current-installation',
    projectDir,
    hseosDir: path.join(projectDir, '.hseos'),
    targetAdapter: 'project',
    targetRoot: projectDir,
    sourceVersion: require(path.join(__dirname, '../../../../package.json')).version,
    installStatePath,
    requestedModules,
    requestedIdes,
    selectedModules,
    selectedIdes,
    operations: [
      ...selectedModules.map((moduleId) => ({
        kind: 'module',
        moduleId,
        targetRoot: projectDir,
        ownership: 'managed',
      })),
      ...selectedIdes.map((ideId) => ({
        kind: 'ide',
        ideId,
        targetRoot: projectDir,
        ownership: 'managed',
      })),
    ],
  };
}

async function emitInstallEvent(projectDir, type, payload) {
  await writeGovernanceEvent(projectDir, {
    type,
    source: 'ops.install',
    severity: 'info',
    status: 'open',
    summary: `Install lifecycle event: ${type}`,
    payload,
  });
}

module.exports = {
  buildInstallPlan,
  emitInstallEvent,
};
