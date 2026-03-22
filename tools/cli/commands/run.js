const {
  claimWorkItem,
  getMissionStatus,
  processRetryQueue,
  reconcileMissionRuntime,
  retryMission,
} = require('../lib/runtime/work-item-runner');
const {
  buildSessionSnapshot,
  completeWorker,
  createLocalSession,
  listSessionWorkers,
  readSession,
  recordWorkerHandoff,
  spawnWorker,
} = require('../lib/session/store');
const fs = require('fs-extra');
const path = require('node:path');
const yaml = require('yaml');

async function loadStructuredInput(inputPath) {
  const absolutePath = path.resolve(inputPath);
  const contents = await fs.readFile(absolutePath, 'utf8');
  return absolutePath.endsWith('.json') ? JSON.parse(contents) : yaml.parse(contents);
}

module.exports = {
  command: 'run',
  description: 'Claim, reconcile, and inspect HSEOS mission runtime work items',
  arguments: [
    ['<action>', 'Runtime action: work-item, reconcile, retry, retry-ready, status, orchestration, worker, or handoff'],
    ['[target]', 'Work item path, session action, worker action, mission id, or session id depending on the command'],
    ['[subtarget]', 'Optional file path, worker id, or limit depending on the command'],
    ['[detail]', 'Optional extra argument for worker id or handoff file'],
  ],
  options: [['--project-dir <path>', 'Project directory that owns the mission runtime data']],
  action: async (action, target, subtarget, detail, options) => {
    try {
      const normalizedAction = String(action || '').trim().toLowerCase();
      const projectDir = options.projectDir || process.cwd();

      if (normalizedAction === 'orchestration') {
        const subaction = String(target || '').trim().toLowerCase();
        if (subaction === 'create') {
          if (!subtarget) {
            throw new Error('A session spec file path is required.');
          }
          const session = await createLocalSession(await loadStructuredInput(subtarget), { projectDir });
          console.log(JSON.stringify(session, null, 2));
          return;
        }

        if (subaction === 'status') {
          if (!subtarget) {
            throw new Error('A session id is required.');
          }
          console.log(JSON.stringify(await readSession(projectDir, subtarget), null, 2));
          return;
        }

        if (subaction === 'snapshot') {
          if (!subtarget) {
            throw new Error('A session id is required.');
          }
          console.log(JSON.stringify(await buildSessionSnapshot(projectDir, subtarget), null, 2));
          return;
        }

        throw new Error(`Unsupported orchestration action: ${target}`);
      }

      if (normalizedAction === 'worker') {
        const subaction = String(target || '').trim().toLowerCase();
        if (!subtarget) {
          throw new Error('A session id is required.');
        }
        const workerId = detail || null;

        if (subaction === 'spawn') {
          if (!workerId) {
            throw new Error('A worker id is required.');
          }
          console.log(JSON.stringify(await spawnWorker(projectDir, subtarget, workerId), null, 2));
          return;
        }

        if (subaction === 'complete') {
          if (!workerId) {
            throw new Error('A worker id is required.');
          }
          console.log(JSON.stringify(await completeWorker(projectDir, subtarget, workerId), null, 2));
          return;
        }

        if (subaction === 'list') {
          console.log(JSON.stringify(await listSessionWorkers(projectDir, subtarget), null, 2));
          return;
        }

        throw new Error(`Unsupported worker action: ${target}`);
      }

      if (normalizedAction === 'handoff') {
        const sessionId = String(target || '').trim();
        const workerId = String(subtarget || '').trim();
        const handoffFile = detail || null;
        if (!sessionId || !workerId || !handoffFile) {
          throw new Error('Usage: hseos run handoff <session-id> <worker-id> <handoff-file>');
        }
        console.log(JSON.stringify(await recordWorkerHandoff(projectDir, sessionId, workerId, await loadStructuredInput(handoffFile)), null, 2));
        return;
      }

      if (normalizedAction === 'work-item') {
        if (!target) {
          throw new Error('A work item file path is required.');
        }

        const claimed = await claimWorkItem(target, { projectDir });
        console.log(`Mission claimed: ${claimed.id}`);
        console.log(`Workspace: ${claimed.workspacePath}`);
        return;
      }

      if (normalizedAction === 'reconcile') {
        const result = await reconcileMissionRuntime(projectDir);
        console.log(`Mission runtime reconciled: ${result.updated} state file(s) updated`);
        return;
      }

      if (normalizedAction === 'retry') {
        if (!target) {
          throw new Error('A mission id is required.');
        }

        const retried = await retryMission(projectDir, target);
        console.log(`Mission retried: ${retried.id}`);
        console.log(`Attempt count: ${retried.attempt_count}`);
        return;
      }

      if (normalizedAction === 'retry-ready') {
        const parsedLimit = target ? Number.parseInt(String(target), 10) : null;
        if (target && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
          throw new Error('retry-ready accepts only a positive numeric limit.');
        }

        const result = await processRetryQueue(projectDir, {
          limit: parsedLimit || undefined,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (normalizedAction === 'status') {
        if (!target) {
          throw new Error('A mission id is required.');
        }

        const status = await getMissionStatus(projectDir, target);
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      throw new Error(`Unsupported run action: ${action}`);
    } catch (error) {
      console.error(`Mission runtime command failed: ${error.message}`);
      process.exit(1);
    }
  },
};
