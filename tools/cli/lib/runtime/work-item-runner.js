const fs = require('fs-extra');
const path = require('node:path');
const yaml = require('yaml');
const { buildOperationsSnapshot } = require('../ops/console-read-model');
const { resolveProjectPolicy, evaluateExecutionRequest } = require('../policy/engine');
const { impactContext, retrieveContext } = require('../cortex/recall-intelligence');

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
    mission: {
      type: typeof item.mission_type === 'string' ? item.mission_type.trim() : null,
      priority: typeof item.priority === 'string' ? item.priority.trim().toLowerCase() : null,
      owner: typeof item.owner === 'string' ? item.owner.trim() : null,
      deadlineAt: typeof item.deadline_at === 'string' ? item.deadline_at.trim() : null,
    },
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

function uniq(values) {
  return [...new Set(values)];
}

function buildMissionContext(item) {
  return {
    type: normalizeOptionalString(item.mission_type) || 'delivery',
    priority: normalizePriority(item.priority),
    owner: normalizeOptionalString(item.owner),
    labels: normalizeOptionalArray(item.labels),
    dependencies: normalizeOptionalArray(item.dependencies),
    impactTerms: normalizeOptionalArray(item.impact_terms),
  };
}

async function attachCortexContext(item, runtime, workspacePath) {
  const query = deriveCortexQuery(item);
  const missionContext = buildMissionContext(item);
  const impact = await impactContext(query, {
    projectDir: runtime.projectDir,
    relatedTerms: [
      missionContext.type,
      missionContext.priority,
      ...missionContext.labels,
      ...missionContext.dependencies,
      ...missionContext.impactTerms,
    ],
  });
  const retrieval = await retrieveContext(query, {
    layer: typeof item.context_layer === 'string' ? item.context_layer.trim() : undefined,
    missionContext: {
      ...missionContext,
      impactTerms: uniq([
        ...missionContext.impactTerms,
        ...impact.matches.flatMap((entry) => entry.matchedTerms || []),
      ]),
    },
    projectDir: runtime.projectDir,
  });
  const contextArtifact = {
    query,
    layer: item.context_layer || null,
    missionContext,
    impact,
    retrieval,
  };

  await fs.writeJson(path.join(workspacePath, 'context.json'), contextArtifact, { spaces: 2 });

  return {
    cortex_query: query,
    cortex_impact: impact,
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
      cortexImpactMatches: state.cortex_impact?.matches?.length || 0,
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

async function retryMission(projectDir, missionId) {
  const runtime = await resolveRuntimePaths(projectDir);
  const statePath = path.join(runtime.workItemsDir, `${missionId}.json`);

  if (!(await fs.pathExists(statePath))) {
    throw new Error(`Mission runtime state not found for "${missionId}"`);
  }

  const state = await fs.readJson(statePath);
  if (state.status !== 'invalidated') {
    throw new Error(`Mission "${missionId}" is not retryable from status "${state.status}"`);
  }

  const retryPolicy = state.retry_policy || { max_attempts: 1, retry_class: 'none' };
  if (retryPolicy.retry_class === 'none') {
    throw new Error(`Mission "${missionId}" does not allow retries`);
  }

  if ((state.attempt_count || 1) >= retryPolicy.max_attempts) {
    throw new Error(`Mission "${missionId}" exceeded max_attempts=${retryPolicy.max_attempts}`);
  }

  if (!(await fs.pathExists(state.source_path))) {
    throw new Error(`Mission "${missionId}" source work item is missing and cannot be retried`);
  }

  const item = await loadWorkItem(state.source_path);
  if (!CLAIMABLE_STATUSES.has(item.status)) {
    throw new Error(`Mission "${missionId}" source status "${item.status}" is not retryable`);
  }

  const snapshot = await buildOperationsSnapshot(runtime.projectDir);
  const blockerKey = `runtime:${missionId}`;
  const runtimeBlocker = snapshot.blockers.find((blocker) => blocker.key === blockerKey);
  if (runtimeBlocker && runtimeBlocker.status !== 'approved') {
    throw new Error(`Mission "${missionId}" requires blocker approval before retry: ${blockerKey}`);
  }

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
      source: 'run.retry',
      summary: `Mission retry denied for "${item.id}"`,
      details: {
        policyPack: policyContext.packName,
        violations: policyDecision.violations,
        warnings: policyDecision.warnings,
      },
    });
    throw new Error(
      `Structural execution governance denied retry for mission "${item.id}": ${policyDecision.violations.join('; ')}`,
    );
  }

  const workspacePath = state.workspacePath || path.join(runtime.workspacesDir, item.id);
  await writeWorkspaceManifest(workspacePath, item);
  const cortexAttachment = await attachCortexContext(item, runtime, workspacePath);
  const missionModel = deriveMissionModel(item);
  const nextAttemptCount = (state.attempt_count || 1) + 1;
  const retriedAt = new Date().toISOString();

  const nextState = {
    ...state,
    title: item.title,
    status: 'claimed',
    source_status: item.status,
    source_path: item.sourcePath,
    tracker: item.tracker || state.tracker || 'unspecified',
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
    attempt_count: nextAttemptCount,
    last_attempt_at: retriedAt,
    execution_phase: 'retry-claimed',
    state_reason: 'manual-retry',
    workspacePath,
    workspaceBranch: state.workspaceBranch || `mission/${item.id}`,
    policy_pack: policyContext.packName,
    policy_allowed: policyDecision.allowed,
    policy_summary: policyDecision.summary,
    retried_at: retriedAt,
    ...cortexAttachment,
  };

  await fs.writeJson(statePath, nextState, { spaces: 2 });
  await writeEvidenceEvent(runtime, {
    type: 'mission_retried',
    missionId: item.id,
    source: 'run.retry',
    summary: `Mission "${item.id}" retried`,
    details: {
      attemptCount: nextAttemptCount,
      blockerKey,
      policyPack: policyContext.packName,
      cortexImpactMatches: nextState.cortex_impact?.matches?.length || 0,
    },
  });

  return nextState;
}

function isRetryableMission(run) {
  return (
    run.status === 'invalidated' &&
    run.retry_policy?.retry_class &&
    run.retry_policy.retry_class !== 'none' &&
    Number.isInteger(run.retry_policy.max_attempts) &&
    (run.attempt_count || 1) < run.retry_policy.max_attempts
  );
}

async function processRetryQueue(projectDir, options = {}) {
  const runtime = await resolveRuntimePaths(projectDir);
  const snapshot = await buildOperationsSnapshot(runtime.projectDir);
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : Number.POSITIVE_INFINITY;
  const retryableRuns = snapshot.runs.filter(isRetryableMission);
  const approvedQueue = retryableRuns
    .map((run) => {
      const blockerKey = `runtime:${run.id}`;
      const blocker = snapshot.blockers.find((entry) => entry.key === blockerKey) || null;
      return {
        missionId: run.id,
        blockerKey,
        approved: blocker ? blocker.status === 'approved' : false,
      };
    })
    .filter((entry) => entry.approved)
    .slice(0, limit);

  const result = {
    discovered: retryableRuns.length,
    eligible: approvedQueue.length,
    attempted: 0,
    succeeded: [],
    failed: [],
    skipped: retryableRuns
      .filter((run) => !approvedQueue.some((entry) => entry.missionId === run.id))
      .map((run) => ({
        missionId: run.id,
        blockerKey: `runtime:${run.id}`,
        reason: 'awaiting-approval',
      })),
  };

  for (const entry of approvedQueue) {
    result.attempted += 1;
    try {
      const retried = await retryMission(runtime.projectDir, entry.missionId);
      result.succeeded.push({
        missionId: retried.id,
        attemptCount: retried.attempt_count,
        executionPhase: retried.execution_phase,
      });
    } catch (error) {
      result.failed.push({
        missionId: entry.missionId,
        blockerKey: entry.blockerKey,
        reason: error.message,
      });
    }
  }

  await writeEvidenceEvent(runtime, {
    type: 'retry_queue_processed',
    missionId: null,
    source: 'run.retry-ready',
    summary: 'Governed retry queue processed',
    details: {
      discovered: result.discovered,
      eligible: result.eligible,
      attempted: result.attempted,
      succeeded: result.succeeded.map((entry) => entry.missionId),
      failed: result.failed,
      skipped: result.skipped,
    },
  });

  return result;
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
  processRetryQueue,
  reconcileMissionRuntime,
  retryMission,
  resolveRuntimePaths,
};
