const fs = require('fs-extra');
const path = require('node:path');
const yaml = require('yaml');
const { resolveProjectPolicy, evaluateExecutionRequest } = require('../policy/engine');
const { retrieveContext } = require('../cortex/recall-intelligence');

const CLAIMABLE_STATUSES = new Set(['open', 'ready', 'queued', 'todo']);
const INVALIDATING_STATUSES = new Set(['blocked', 'cancelled', 'closed', 'done']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_RETRY_CLASSES = new Set(['none', 'transient', 'manual', 'policy']);

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

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
}

function normalizePriority(value) {
  const normalized = String(value || 'medium').trim().toLowerCase();
  return ALLOWED_PRIORITIES.has(normalized) ? normalized : 'medium';
}

function normalizeDeadline(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeRetryPolicy(item) {
  const maxAttempts = Number.isInteger(item.max_attempts) ? item.max_attempts : Number.parseInt(item.max_attempts || '1', 10);
  const retryClass = String(item.retry_class || 'none').trim().toLowerCase();

  return {
    max_attempts: Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1,
    retry_class: ALLOWED_RETRY_CLASSES.has(retryClass) ? retryClass : 'none',
  };
}

function deriveMissionModel(item) {
  const retryPolicy = normalizeRetryPolicy(item);

  return {
    owner: normalizeOptionalString(item.owner),
    priority: normalizePriority(item.priority),
    deadline_at: normalizeDeadline(item.deadline_at),
    mission_type: normalizeOptionalString(item.mission_type) || 'delivery',
    labels: normalizeOptionalArray(item.labels),
    dependencies: normalizeOptionalArray(item.dependencies),
    retry_policy: retryPolicy,
    attempt_count: 1,
    last_attempt_at: new Date().toISOString(),
    execution_phase: 'claimed',
    state_reason: 'claimed-from-source',
  };
}

async function writeWorkspaceManifest(workspacePath, item) {
  const missionModel = deriveMissionModel(item);
  const manifest = {
    id: item.id,
    title: item.title,
    status: 'claimed',
    created_at: new Date().toISOString(),
    directive: item.directive || null,
    syndicate: item.syndicate || null,
    circuit: item.circuit || null,
    owner: missionModel.owner,
    priority: missionModel.priority,
    deadline_at: missionModel.deadline_at,
    mission_type: missionModel.mission_type,
    labels: missionModel.labels,
    dependencies: missionModel.dependencies,
  };

  await fs.ensureDir(workspacePath);
  await fs.writeFile(path.join(workspacePath, 'mission.yaml'), yaml.stringify(manifest), 'utf8');
}

function buildMissionExecutionRequest(item, projectDir) {
  return {
    actionType: 'work-item',
    directory: projectDir,
    modules: Array.isArray(item.modules) ? item.modules : [],
    tools: Array.isArray(item.tools) ? item.tools : [],
    customContentSources: [],
    customContentIds: [],
  };
}

function buildEvidenceFileName(type, missionId) {
  const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const id = missionId || 'global';
  return `${timestamp}-${type}-${id}.json`;
}

async function writeEvidenceEvent(runtime, event) {
  await fs.ensureDir(runtime.evidenceDir);
  const fileName = buildEvidenceFileName(event.type, event.missionId);
  const payload = {
    timestamp: new Date().toISOString(),
    ...event,
  };

  await fs.writeJson(path.join(runtime.evidenceDir, fileName), payload, { spaces: 2 });
  return payload;
}

function deriveCortexQuery(item) {
  if (typeof item.context_query === 'string' && item.context_query.trim().length > 0) {
    return item.context_query.trim();
  }

  return [item.title, item.directive, item.circuit, item.syndicate].filter(Boolean).join(' ');
}

async function attachCortexContext(item, runtime, workspacePath) {
  const query = deriveCortexQuery(item);
  const retrieval = await retrieveContext(query, {
    layer: typeof item.context_layer === 'string' ? item.context_layer.trim() : undefined,
    projectDir: runtime.projectDir,
  });
  const contextArtifact = {
    query,
    layer: item.context_layer || null,
    retrieval,
  };

  await fs.writeJson(path.join(workspacePath, 'context.json'), contextArtifact, { spaces: 2 });

  return {
    cortex_query: query,
    cortex_trace: retrieval,
    cortex_context_ids: retrieval.results.map((entry) => entry.id),
  };
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

  const policyContext = await resolveProjectPolicy({
    projectDir: runtime.projectDir,
  });
  const policyDecision = evaluateExecutionRequest(
    buildMissionExecutionRequest(item, runtime.projectDir),
    policyContext.policy,
    policyContext.context,
  );

  if (!policyDecision.allowed) {
    await writeEvidenceEvent(runtime, {
      type: 'policy_denied',
      missionId: item.id,
      source: 'run.work-item',
      summary: `Mission claim denied for "${item.id}"`,
      details: {
        policyPack: policyContext.packName,
        violations: policyDecision.violations,
        warnings: policyDecision.warnings,
      },
    });
    throw new Error(
      `Structural execution governance denied mission "${item.id}": ${policyDecision.violations.join('; ')}`,
    );
  }

  const statePath = path.join(runtime.workItemsDir, `${item.id}.json`);
  const workspacePath = path.join(runtime.workspacesDir, item.id);
  await writeWorkspaceManifest(workspacePath, item);
  const cortexAttachment = await attachCortexContext(item, runtime, workspacePath);
  const missionModel = deriveMissionModel(item);

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
    owner: missionModel.owner,
    priority: missionModel.priority,
    deadline_at: missionModel.deadline_at,
    mission_type: missionModel.mission_type,
    labels: missionModel.labels,
    dependencies: missionModel.dependencies,
    retry_policy: missionModel.retry_policy,
    attempt_count: missionModel.attempt_count,
    last_attempt_at: missionModel.last_attempt_at,
    execution_phase: missionModel.execution_phase,
    state_reason: missionModel.state_reason,
    workspacePath,
    workspaceBranch: `mission/${item.id}`,
    policy_pack: policyContext.packName,
    policy_allowed: policyDecision.allowed,
    policy_summary: policyDecision.summary,
    claimed_at: new Date().toISOString(),
    last_reconciled_at: null,
    ...cortexAttachment,
  };

  await fs.writeJson(statePath, state, { spaces: 2 });
  await fs.writeFile(path.join(runtime.evidenceDir, `${item.id}.log`), `claimed ${item.id} from ${item.sourcePath}\n`, 'utf8');
  await writeEvidenceEvent(runtime, {
    type: 'mission_claimed',
    missionId: item.id,
    source: 'run.work-item',
    summary: `Mission "${item.id}" claimed`,
    details: {
      workspacePath,
      policyPack: policyContext.packName,
      cortexQuery: state.cortex_query,
      cortexContextIds: state.cortex_context_ids,
      priority: state.priority,
      owner: state.owner,
      deadlineAt: state.deadline_at,
    },
  });

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
    const previousStatus = state.status;

    if (await fs.pathExists(state.source_path)) {
      const sourceItem = await loadWorkItem(state.source_path);
      state.source_status = sourceItem.status;
      if (INVALIDATING_STATUSES.has(sourceItem.status)) {
        state.status = 'invalidated';
        state.reconcile_reason = `source-status:${sourceItem.status}`;
        state.execution_phase = 'invalidated';
        state.state_reason = state.reconcile_reason;
      }
    } else {
      state.status = 'invalidated';
      state.reconcile_reason = 'source-missing';
      state.execution_phase = 'invalidated';
      state.state_reason = state.reconcile_reason;
    }

    const nextAttemptCount = Number.isInteger(state.attempt_count) ? state.attempt_count : 1;
    state.attempt_count = nextAttemptCount;

    state.last_reconciled_at = new Date().toISOString();
    await fs.writeJson(statePath, state, { spaces: 2 });
    if (previousStatus !== 'invalidated' && state.status === 'invalidated') {
      await writeEvidenceEvent(runtime, {
        type: 'mission_invalidated',
        missionId: state.id,
        source: 'run.reconcile',
        summary: `Mission "${state.id}" invalidated`,
        details: {
          reconcileReason: state.reconcile_reason || 'invalidated',
          retryPolicy: state.retry_policy || null,
          attemptCount: state.attempt_count,
        },
      });
    }
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
