const fs = require('fs-extra');
const path = require('node:path');
const yaml = require('yaml');

const CLAIMABLE_STATUSES = new Set(['open', 'ready', 'queued', 'todo']);
const INVALIDATING_STATUSES = new Set(['blocked', 'cancelled', 'closed', 'done']);

async function loadYamlIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) {
    return null;
  }

  const contents = await fs.readFile(filePath, 'utf8');
  return yaml.parse(contents);
}

function getFrameworkRoot() {
  return path.resolve(__dirname, '../../../..');
}

async function resolveRuntimePaths(projectDir) {
  const frameworkRoot = getFrameworkRoot();
  const targetRoot = path.resolve(projectDir || process.cwd());
  const projectConfig = await loadYamlIfExists(path.join(targetRoot, '.hseos/config/hseos.config.yaml'));
  const frameworkConfig = await loadYamlIfExists(path.join(frameworkRoot, '.hseos/config/hseos.config.yaml'));
  const config = projectConfig || frameworkConfig || {};
  const dataRoot = config.paths?.data || '.hseos/data';
  const runtimeRoot = path.resolve(targetRoot, dataRoot, 'runtime');

  return {
    projectDir: targetRoot,
    runtimeRoot,
    workItemsDir: path.join(runtimeRoot, 'work-items'),
    workspacesDir: path.join(runtimeRoot, 'workspaces'),
    evidenceDir: path.join(runtimeRoot, 'evidence'),
  };
}

function loadStructuredFile(filePath, contents) {
  if (filePath.endsWith('.json')) {
    return JSON.parse(contents);
  }

  return yaml.parse(contents);
}

async function loadWorkItem(inputPath) {
  const absolutePath = path.resolve(inputPath);
  const contents = await fs.readFile(absolutePath, 'utf8');
  const item = loadStructuredFile(absolutePath, contents);

  if (!item || typeof item !== 'object') {
    throw new Error(`Invalid work item payload: ${absolutePath}`);
  }

  for (const field of ['id', 'title', 'status']) {
    if (!(field in item) || typeof item[field] !== 'string' || item[field].trim().length === 0) {
      throw new Error(`Work item is missing required field "${field}"`);
    }
  }

  return {
    ...item,
    id: item.id.trim(),
    title: item.title.trim(),
    status: item.status.trim().toLowerCase(),
    sourcePath: absolutePath,
  };
}

async function writeWorkspaceManifest(workspacePath, item) {
  const manifest = {
    id: item.id,
    title: item.title,
    status: 'claimed',
    created_at: new Date().toISOString(),
    directive: item.directive || null,
    syndicate: item.syndicate || null,
    circuit: item.circuit || null,
  };

  await fs.ensureDir(workspacePath);
  await fs.writeFile(path.join(workspacePath, 'mission.yaml'), yaml.stringify(manifest), 'utf8');
}

async function claimWorkItem(inputPath, options = {}) {
  const item = await loadWorkItem(inputPath);
  if (!CLAIMABLE_STATUSES.has(item.status)) {
    throw new Error(`Work item "${item.id}" is not claimable from status "${item.status}"`);
  }

  const runtime = await resolveRuntimePaths(options.projectDir);
  await fs.ensureDir(runtime.workItemsDir);
  await fs.ensureDir(runtime.workspacesDir);
  await fs.ensureDir(runtime.evidenceDir);

  const statePath = path.join(runtime.workItemsDir, `${item.id}.json`);
  const workspacePath = path.join(runtime.workspacesDir, item.id);

  const state = {
    id: item.id,
    title: item.title,
    status: 'claimed',
    source_status: item.status,
    source_path: item.sourcePath,
    tracker: item.tracker || 'unspecified',
    directive: item.directive || null,
    syndicate: item.syndicate || null,
    circuit: item.circuit || null,
    workspacePath,
    workspaceBranch: `mission/${item.id}`,
    claimed_at: new Date().toISOString(),
    last_reconciled_at: null,
  };

  await writeWorkspaceManifest(workspacePath, item);
  await fs.writeJson(statePath, state, { spaces: 2 });
  await fs.writeFile(
    path.join(runtime.evidenceDir, `${item.id}.log`),
    `claimed ${item.id} from ${item.sourcePath}\n`,
    'utf8',
  );

  return state;
}

async function getMissionStatus(projectDir, missionId) {
  const runtime = await resolveRuntimePaths(projectDir);
  const statePath = path.join(runtime.workItemsDir, `${missionId}.json`);

  if (!(await fs.pathExists(statePath))) {
    throw new Error(`Mission runtime state not found for "${missionId}"`);
  }

  return fs.readJson(statePath);
}

async function reconcileMissionRuntime(projectDir) {
  const runtime = await resolveRuntimePaths(projectDir);
  await fs.ensureDir(runtime.workItemsDir);

  const entries = await fs.readdir(runtime.workItemsDir);
  let updated = 0;

  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }

    const statePath = path.join(runtime.workItemsDir, entry);
    const state = await fs.readJson(statePath);

    if (await fs.pathExists(state.source_path)) {
      const sourceItem = await loadWorkItem(state.source_path);
      state.source_status = sourceItem.status;
      if (INVALIDATING_STATUSES.has(sourceItem.status)) {
        state.status = 'invalidated';
        state.reconcile_reason = `source-status:${sourceItem.status}`;
      }
    } else {
      state.status = 'invalidated';
      state.reconcile_reason = 'source-missing';
    }

    state.last_reconciled_at = new Date().toISOString();
    await fs.writeJson(statePath, state, { spaces: 2 });
    updated += 1;
  }

  return { updated };
}

module.exports = {
  claimWorkItem,
  getMissionStatus,
  reconcileMissionRuntime,
  resolveRuntimePaths,
};
