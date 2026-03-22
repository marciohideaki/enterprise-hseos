const fs = require('fs-extra');
const path = require('node:path');
const {
  buildApprovalState,
  buildBlockerKey,
  readApprovalEvents,
} = require('./approval-store');
const { readInstallState } = require('../install/install-state');
const { readGovernanceEvents } = require('../governance/events/store');
const { listSessions } = require('../session/store');

async function readJsonFiles(directory, suffix = '.json') {
  if (!(await fs.pathExists(directory))) {
    return [];
  }

  const entries = await fs.readdir(directory);
  const records = [];

  for (const entry of entries) {
    if (!entry.endsWith(suffix)) {
      continue;
    }

    records.push(await fs.readJson(path.join(directory, entry)));
  }

  return records;
}

async function listFiles(directory, suffix) {
  if (!(await fs.pathExists(directory))) {
    return [];
  }

  const entries = await fs.readdir(directory);
  return entries.filter((entry) => (suffix ? entry.endsWith(suffix) : true)).map((entry) => path.join(directory, entry));
}

async function summarizeValidationLogs(validationDir) {
  const files = await listFiles(validationDir, '.log');
  const records = [];

  for (const filePath of files.sort().slice(-5)) {
    const content = await fs.readFile(filePath, 'utf8');
    records.push({
      file: path.basename(filePath),
      hasFailure: content.includes('[FAIL]'),
      hasWarning: content.includes('[WARN]'),
    });
  }

  return records;
}

async function readEvidenceEvents(evidenceDir) {
  const files = await listFiles(evidenceDir, '.json');
  const events = [];

  for (const filePath of files) {
    events.push(await fs.readJson(filePath));
  }

  return events.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
}

function countBy(records, selector) {
  const counts = {};

  for (const record of records) {
    const key = selector(record);
    if (!key) {
      continue;
    }

    counts[key] = (counts[key] || 0) + 1;
  }

  return counts;
}

async function buildOperationsSnapshot(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const runtimeWorkItems = path.join(root, '.hseos/data/runtime/work-items');
  const runtimeEvidence = path.join(root, '.hseos/data/runtime/evidence');
  const validationDir = path.join(root, '.logs/validation');

  const runs = await readJsonFiles(runtimeWorkItems);
  const evidenceFiles = await listFiles(runtimeEvidence);
  const evidenceEvents = await readEvidenceEvents(runtimeEvidence);
  const approvalEvents = await readApprovalEvents(root);
  const approvalState = buildApprovalState(approvalEvents);
  const validations = await summarizeValidationLogs(validationDir);
  const installState = await readInstallState(root);
  const governanceEvents = await readGovernanceEvents(root);
  const sessions = await listSessions(root);

  const invalidatedRuns = runs.filter((run) => run.status === 'invalidated');
  const policyDenials = evidenceEvents.filter((event) => event.type === 'policy_denied');
  const missionsWithCortex = runs.filter((run) => run.cortex_query && run.cortex_trace);
  const missionsWithImpact = runs.filter((run) => Array.isArray(run.cortex_impact?.matches) && run.cortex_impact.matches.length > 0);
  const criticalRuns = runs.filter((run) => run.priority === 'critical');
  const overdueRuns = runs.filter(
    (run) => typeof run.deadline_at === 'string' && run.deadline_at.length > 0 && Date.parse(run.deadline_at) < Date.now(),
  );
  const retryableInvalidations = runs.filter(
    (run) =>
      run.status === 'invalidated' &&
      run.retry_policy?.retry_class &&
      run.retry_policy.retry_class !== 'none' &&
      Number.isInteger(run.retry_policy.max_attempts) &&
      (run.attempt_count || 1) < run.retry_policy.max_attempts,
  );
  const exhaustedRetries = runs.filter(
    (run) =>
      run.status === 'invalidated' &&
      run.retry_policy?.retry_class &&
      run.retry_policy.retry_class !== 'none' &&
      Number.isInteger(run.retry_policy.max_attempts) &&
      (run.attempt_count || 1) >= run.retry_policy.max_attempts,
  );
  const blockers = [
    ...invalidatedRuns.map((run) => ({
      type: 'runtime',
      id: run.id,
      reason: run.reconcile_reason || 'invalidated',
    })),
    ...policyDenials.map((event) => ({
      type: 'policy',
      id: event.missionId || event.summary,
      reason: event.details?.violations?.join('; ') || event.summary,
    })),
    ...validations
      .filter((validation) => validation.hasFailure)
      .map((validation) => ({
        type: 'validation',
        id: validation.file,
        reason: 'validation-failure',
      })),
    ...governanceEvents
      .filter((event) => event.status === 'open' && ['warning', 'error'].includes(event.severity))
      .map((event) => ({
        type: 'governance-event',
        id: event.id,
        reason: event.summary || event.type,
      })),
  ].map((blocker) => {
    const key = buildBlockerKey(blocker);
    const decision = approvalState.get(key);
    const approved = decision?.action === 'approve';

    return {
      ...blocker,
      key,
      status: approved ? 'approved' : 'open',
      approval: approved ? decision : null,
    };
  });
  const approvedBlockers = blockers.filter((blocker) => blocker.status === 'approved');
  const openBlockers = blockers.filter((blocker) => blocker.status === 'open');
  const runtimeBlockersAwaitingApproval = openBlockers.filter((blocker) => blocker.type === 'runtime');
  const runsByPriority = countBy(runs, (run) => run.priority || 'unspecified');
  const runsByMissionType = countBy(runs, (run) => run.mission_type || 'unspecified');
  const runsByOwner = countBy(runs, (run) => run.owner || 'unassigned');
  const runsByPolicyPack = countBy(runs, (run) => run.policy_pack || 'unspecified');
  const sessionsByState = countBy(sessions, (session) => session.state || 'unspecified');
  const activeSessions = sessions.filter((session) => ['created', 'running'].includes(session.state));
  const pendingGovernanceEvents = governanceEvents.filter((event) => event.status === 'open');

  return {
    summary: {
      totalRuns: runs.length,
      invalidatedRuns: invalidatedRuns.length,
      evidenceFiles: evidenceFiles.length,
      validationLogs: validations.length,
      policyDenials: policyDenials.length,
      missionsWithCortex: missionsWithCortex.length,
      missionsWithImpact: missionsWithImpact.length,
      criticalRuns: criticalRuns.length,
      overdueRuns: overdueRuns.length,
      retryableInvalidations: retryableInvalidations.length,
      exhaustedRetries: exhaustedRetries.length,
      runtimeBlockersAwaitingApproval: runtimeBlockersAwaitingApproval.length,
      approvalEvents: approvalEvents.length,
      approvedBlockers: approvedBlockers.length,
      openBlockers: openBlockers.length,
      activeSessions: activeSessions.length,
      totalSessions: sessions.length,
      pendingGovernanceEvents: pendingGovernanceEvents.length,
      installStatePresent: Boolean(installState),
    },
    posture: {
      missionRuntime: {
        runsByPriority,
        runsByMissionType,
        runsByOwner,
        criticalRuns: criticalRuns.map((run) => run.id),
        overdueRuns: overdueRuns.map((run) => run.id),
        retryableInvalidations: retryableInvalidations.map((run) => run.id),
        exhaustedRetries: exhaustedRetries.map((run) => run.id),
      },
      governance: {
        runsByPolicyPack,
        eventsBySeverity: countBy(governanceEvents, (event) => event.severity || 'info'),
        policyDenials: policyDenials.map((event) => ({
          missionId: event.missionId || null,
          summary: event.summary,
          violations: event.details?.violations || [],
        })),
        blockers: {
          open: openBlockers.length,
          approved: approvedBlockers.length,
          runtimeAwaitingApproval: runtimeBlockersAwaitingApproval.map((blocker) => blocker.id),
        },
      },
      cortex: {
        missionsWithContext: missionsWithCortex.map((run) => run.id),
        missionsWithImpact: missionsWithImpact.map((run) => run.id),
        impactCoverage: runs
          .filter((run) => Array.isArray(run.cortex_impact?.matches))
          .map((run) => ({
            missionId: run.id,
            impactMatches: run.cortex_impact.matches.length,
            contextIds: Array.isArray(run.cortex_context_ids) ? run.cortex_context_ids.length : 0,
          })),
      },
      localOrchestration: {
        sessionsByState,
        activeSessions: activeSessions.map((session) => session.id),
      },
      install: installState
        ? {
            targetAdapter: installState.targetAdapter,
            selectedModules: installState.selectedModules || [],
            selectedIdes: installState.selectedIdes || [],
            health: installState.health || 'unknown',
            sourceVersion: installState.sourceVersion || null,
          }
        : null,
    },
    runs,
    sessions,
    evidence: {
      files: evidenceFiles.map((filePath) => path.basename(filePath)),
      events: evidenceEvents,
      validations,
    },
    install: installState,
    governanceEvents,
    approvals: {
      events: approvalEvents,
      current: [...approvalState.values()].sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp))),
    },
    blockers,
  };
}

module.exports = {
  buildOperationsSnapshot,
};
