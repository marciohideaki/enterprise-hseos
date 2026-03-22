const fs = require('fs-extra');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveHseosDataPaths } = require('../hseos-data');
const { writeGovernanceEvent } = require('../governance/events/store');

function slugify(value, fallback = 'session') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeSeedPaths(seedPaths, repoRoot) {
  const entries = Array.isArray(seedPaths) ? seedPaths : [];
  const seen = new Set();
  const normalized = [];
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      continue;
    }
    const absolutePath = path.resolve(repoRoot, entry);
    const relativePath = path.relative(repoRoot, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`Seed path must stay inside repo root: ${entry}`);
    }
    const portablePath = relativePath.split(path.sep).join('/');
    if (!seen.has(portablePath)) {
      seen.add(portablePath);
      normalized.push(portablePath);
    }
  }
  return normalized;
}

async function overlaySeedPaths(repoRoot, worktreePath, seedPaths) {
  for (const seedPath of normalizeSeedPaths(seedPaths, repoRoot)) {
    const sourcePath = path.join(repoRoot, seedPath);
    const targetPath = path.join(worktreePath, seedPath);
    if (!(await fs.pathExists(sourcePath))) {
      throw new Error(`Seed path does not exist: ${seedPath}`);
    }
    await fs.ensureDir(path.dirname(targetPath));
    await fs.remove(targetPath);
    await fs.copy(sourcePath, targetPath, { overwrite: true, recursive: true });
  }
}

function buildTaskMarkdown(session, worker) {
  const seeded = worker.seedPaths.length > 0
    ? ['', '## Seeded Local Overlays', ...worker.seedPaths.map((seedPath) => `- \`${seedPath}\``)]
    : [];

  return [
    `# Worker Task: ${worker.name}`,
    '',
    `- Session: \`${session.id}\``,
    `- Repo root: \`${session.repoRoot}\``,
    `- Worktree: \`${worker.worktreePath}\``,
    `- Branch: \`${worker.branchName}\``,
    ...seeded,
    '',
    '## Objective',
    worker.task,
  ].join('\n');
}

function buildStatusMarkdown(worker) {
  return [
    `# Status: ${worker.name}`,
    '',
    `- State: ${worker.state}`,
    `- Branch: ${worker.branchName}`,
    `- Worktree: \`${worker.worktreePath}\``,
    `- Handoff file: \`${worker.handoffPath}\``,
  ].join('\n');
}

function buildHandoffMarkdown(worker) {
  return [
    `# Handoff: ${worker.name}`,
    '',
    '## Summary',
    '- Pending',
    '',
    '## Validation',
    '- Pending',
    '',
    '## Remaining Risks',
    '- Pending',
  ].join('\n');
}

async function resolveSessionDirectory(projectDir, sessionId) {
  const paths = await resolveHseosDataPaths(projectDir);
  return path.join(paths.sessionRoot, sessionId);
}

async function readSession(projectDir, sessionId) {
  const sessionDir = await resolveSessionDirectory(projectDir, sessionId);
  const sessionPath = path.join(sessionDir, 'session.json');
  if (!(await fs.pathExists(sessionPath))) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return fs.readJson(sessionPath);
}

async function listSessions(projectDir = process.cwd()) {
  const paths = await resolveHseosDataPaths(projectDir);
  if (!(await fs.pathExists(paths.sessionRoot))) {
    return [];
  }

  const entries = await fs.readdir(paths.sessionRoot);
  const sessions = [];
  for (const entry of entries) {
    const sessionPath = path.join(paths.sessionRoot, entry, 'session.json');
    if (!(await fs.pathExists(sessionPath))) {
      continue;
    }
    sessions.push(await fs.readJson(sessionPath));
  }
  return sessions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function createGitWorktree(repoRoot, worktreePath, branchName, baseRef) {
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branchName, worktreePath, baseRef], {
    stdio: 'pipe',
  });
}

async function createLocalSession(spec, options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const repoRoot = path.resolve(spec.repoRoot || projectDir);
  const sessionId = slugify(spec.sessionName || path.basename(repoRoot), 'session');
  const sessionDir = await resolveSessionDirectory(projectDir, sessionId);
  const sessionPath = path.join(sessionDir, 'session.json');
  const coordinationDir = path.join(sessionDir, 'coordination');
  const snapshotsDir = path.join(sessionDir, 'snapshots');

  if (await fs.pathExists(sessionPath)) {
    throw new Error(`Session already exists: ${sessionId}`);
  }

  const workers = Array.isArray(spec.workers) ? spec.workers : [];
  if (workers.length === 0) {
    throw new Error('Local orchestration requires at least one worker');
  }

  await fs.ensureDir(coordinationDir);
  await fs.ensureDir(snapshotsDir);

  const session = {
    id: sessionId,
    state: 'created',
    repoRoot,
    baseRef: spec.baseRef || 'HEAD',
    launcherAdapter: spec.launcherAdapter || 'local-shell',
    coordinationDir,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workers: [],
  };

  for (const [index, workerSpec] of workers.entries()) {
    const workerSlug = slugify(workerSpec.name || `worker-${index + 1}`, `worker-${index + 1}`);
    const branchName = `local-${sessionId}-${workerSlug}`;
    const worktreePath = path.join(repoRoot, '.hseos', 'worktrees', `${sessionId}-${workerSlug}`);
    const workerDir = path.join(coordinationDir, workerSlug);
    const taskPath = path.join(workerDir, 'task.md');
    const statusPath = path.join(workerDir, 'status.md');
    const handoffPath = path.join(workerDir, 'handoff.md');
    const worker = {
      id: workerSlug,
      name: workerSpec.name || workerSlug,
      slug: workerSlug,
      branchName,
      worktreePath,
      task: String(workerSpec.task || '').trim(),
      seedPaths: normalizeSeedPaths(workerSpec.seedPaths || spec.seedPaths || [], repoRoot),
      state: 'not-started',
      launcherAdapter: workerSpec.launcherAdapter || session.launcherAdapter,
      taskPath,
      statusPath,
      handoffPath,
      startedAt: null,
      completedAt: null,
    };

    if (!worker.task) {
      throw new Error(`Worker ${worker.name} is missing a task`);
    }

    await fs.ensureDir(workerDir);
    createGitWorktree(repoRoot, worktreePath, branchName, session.baseRef);
    await overlaySeedPaths(repoRoot, worktreePath, worker.seedPaths);
    await fs.writeFile(taskPath, buildTaskMarkdown(session, worker), 'utf8');
    await fs.writeFile(statusPath, buildStatusMarkdown(worker), 'utf8');
    await fs.writeFile(handoffPath, buildHandoffMarkdown(worker), 'utf8');

    session.workers.push(worker);
  }

  await fs.writeJson(sessionPath, session, { spaces: 2 });
  await writeGovernanceEvent(projectDir, {
    type: 'session_created',
    source: 'run.orchestration.create',
    severity: 'info',
    status: 'open',
    sessionId: session.id,
    summary: `Local orchestration session "${session.id}" created`,
    payload: {
      workerCount: session.workers.length,
      launcherAdapter: session.launcherAdapter,
    },
  });
  return session;
}

async function listSessionWorkers(projectDir, sessionId) {
  const session = await readSession(projectDir, sessionId);
  return session.workers || [];
}

async function writeSession(projectDir, session) {
  const sessionDir = await resolveSessionDirectory(projectDir, session.id);
  await fs.ensureDir(sessionDir);
  session.updatedAt = new Date().toISOString();
  await fs.writeJson(path.join(sessionDir, 'session.json'), session, { spaces: 2 });
  return session;
}

async function updateWorkerState(projectDir, sessionId, workerId, patch, eventType, eventSource) {
  const session = await readSession(projectDir, sessionId);
  const worker = session.workers.find((entry) => entry.id === workerId);
  if (!worker) {
    throw new Error(`Worker not found: ${workerId}`);
  }

  Object.assign(worker, patch);
  await fs.writeFile(worker.statusPath, buildStatusMarkdown(worker), 'utf8');
  await writeSession(projectDir, session);
  await writeGovernanceEvent(projectDir, {
    type: eventType,
    source: eventSource,
    severity: 'info',
    status: 'open',
    sessionId,
    workerId,
    summary: `Worker "${workerId}" updated in session "${sessionId}"`,
    payload: patch,
  });
  return worker;
}

async function spawnWorker(projectDir, sessionId, workerId) {
  return updateWorkerState(projectDir, sessionId, workerId, {
    state: 'running',
    startedAt: new Date().toISOString(),
  }, 'worker_spawned', 'run.worker.spawn');
}

async function completeWorker(projectDir, sessionId, workerId) {
  return updateWorkerState(projectDir, sessionId, workerId, {
    state: 'completed',
    completedAt: new Date().toISOString(),
  }, 'worker_completed', 'run.worker.complete');
}

async function recordWorkerHandoff(projectDir, sessionId, workerId, handoff) {
  const session = await readSession(projectDir, sessionId);
  const worker = session.workers.find((entry) => entry.id === workerId);
  if (!worker) {
    throw new Error(`Worker not found: ${workerId}`);
  }

  const payload = {
    summary: Array.isArray(handoff.summary) ? handoff.summary : ['Pending'],
    validation: Array.isArray(handoff.validation) ? handoff.validation : [],
    remainingRisks: Array.isArray(handoff.remainingRisks) ? handoff.remainingRisks : [],
  };

  const markdown = [
    `# Handoff: ${worker.name}`,
    '',
    '## Summary',
    ...payload.summary.map((line) => `- ${line}`),
    '',
    '## Validation',
    ...(payload.validation.length > 0 ? payload.validation.map((line) => `- ${line}`) : ['- Pending']),
    '',
    '## Remaining Risks',
    ...(payload.remainingRisks.length > 0 ? payload.remainingRisks.map((line) => `- ${line}`) : ['- Pending']),
  ].join('\n');

  await fs.writeFile(worker.handoffPath, markdown, 'utf8');
  await writeGovernanceEvent(projectDir, {
    type: 'worker_handoff_recorded',
    source: 'run.worker.handoff',
    severity: 'info',
    status: 'open',
    sessionId,
    workerId,
    summary: `Worker "${workerId}" handoff recorded`,
    payload,
  });
  return payload;
}

async function buildSessionSnapshot(projectDir, sessionId) {
  const session = await readSession(projectDir, sessionId);
  const snapshot = {
    sessionId: session.id,
    sessionActive: ['created', 'running'].includes(session.state),
    launcherAdapter: session.launcherAdapter,
    workerCount: session.workers.length,
    workerStates: session.workers.reduce((accumulator, worker) => {
      accumulator[worker.state] = (accumulator[worker.state] || 0) + 1;
      return accumulator;
    }, {}),
    workers: session.workers,
    createdAt: new Date().toISOString(),
  };

  const sessionDir = await resolveSessionDirectory(projectDir, sessionId);
  const snapshotsDir = path.join(sessionDir, 'snapshots');
  await fs.ensureDir(snapshotsDir);
  await fs.writeJson(path.join(snapshotsDir, `${snapshot.createdAt.replaceAll(':', '').replaceAll('.', '')}.json`), snapshot, { spaces: 2 });
  await writeGovernanceEvent(projectDir, {
    type: 'session_snapshot_created',
    source: 'run.orchestration.snapshot',
    severity: 'info',
    status: 'open',
    sessionId,
    summary: `Snapshot created for session "${sessionId}"`,
    payload: {
      workerCount: snapshot.workerCount,
      workerStates: snapshot.workerStates,
    },
  });
  return snapshot;
}

module.exports = {
  buildSessionSnapshot,
  completeWorker,
  createLocalSession,
  listSessionWorkers,
  listSessions,
  readSession,
  recordWorkerHandoff,
  spawnWorker,
};
