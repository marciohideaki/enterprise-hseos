const fs = require('fs-extra');
const path = require('node:path');

function sanitizeSegment(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

function buildBlockerKey(blocker) {
  return `${blocker.type}:${blocker.id}`;
}

function resolveOperationsPaths(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const opsRoot = path.join(root, '.hseos/data/ops');

  return {
    projectDir: root,
    opsRoot,
    approvalsDir: path.join(opsRoot, 'approvals'),
  };
}

async function readApprovalEvents(projectDir = process.cwd()) {
  const { approvalsDir } = resolveOperationsPaths(projectDir);
  if (!(await fs.pathExists(approvalsDir))) {
    return [];
  }

  const entries = await fs.readdir(approvalsDir);
  const events = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }

    events.push(await fs.readJson(path.join(approvalsDir, entry)));
  }

  return events.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
}

function buildApprovalState(events) {
  const state = new Map();

  for (const event of [...events].sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)))) {
    if (!event?.blockerKey) {
      continue;
    }

    state.set(event.blockerKey, event);
  }

  return state;
}

async function recordApprovalDecision(projectDir, decision) {
  const { approvalsDir } = resolveOperationsPaths(projectDir);
  const action = String(decision.action || '').trim().toLowerCase();
  if (!['approve', 'revoke'].includes(action)) {
    throw new Error(`Unsupported approval decision action: ${decision.action}`);
  }

  const blockerKey = String(decision.blockerKey || '').trim();
  if (blockerKey.length === 0) {
    throw new Error('A blocker key is required to record an approval decision.');
  }

  await fs.ensureDir(approvalsDir);
  const timestamp = new Date().toISOString();
  const payload = {
    id: `${timestamp.replaceAll(':', '').replaceAll('.', '')}-${sanitizeSegment(blockerKey)}-${action}`,
    action,
    blockerKey,
    actor: String(decision.actor || 'operator').trim() || 'operator',
    reason: String(decision.reason || '').trim() || null,
    source: String(decision.source || 'ops.command'),
    blocker: decision.blocker || null,
    timestamp,
  };

  const fileName = `${payload.id}.json`;
  await fs.writeJson(path.join(approvalsDir, fileName), payload, { spaces: 2 });
  return payload;
}

module.exports = {
  buildApprovalState,
  buildBlockerKey,
  readApprovalEvents,
  recordApprovalDecision,
  resolveOperationsPaths,
};
