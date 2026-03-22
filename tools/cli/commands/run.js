const { claimWorkItem, getMissionStatus, reconcileMissionRuntime, retryMission } = require('../lib/runtime/work-item-runner');

module.exports = {
  command: 'run',
  description: 'Claim, reconcile, and inspect HSEOS mission runtime work items',
  arguments: [
    ['<action>', 'Runtime action: work-item, reconcile, retry, or status'],
    ['[target]', 'Work item path for work-item, or mission id for retry/status'],
  ],
  options: [['--project-dir <path>', 'Project directory that owns the mission runtime data']],
  action: async (action, target, options) => {
    try {
      const normalizedAction = String(action || '').trim().toLowerCase();

      if (normalizedAction === 'work-item') {
        if (!target) {
          throw new Error('A work item file path is required.');
        }

        const claimed = await claimWorkItem(target, { projectDir: options.projectDir });
        console.log(`Mission claimed: ${claimed.id}`);
        console.log(`Workspace: ${claimed.workspacePath}`);
        return;
      }

      if (normalizedAction === 'reconcile') {
        const result = await reconcileMissionRuntime(options.projectDir || process.cwd());
        console.log(`Mission runtime reconciled: ${result.updated} state file(s) updated`);
        return;
      }

      if (normalizedAction === 'retry') {
        if (!target) {
          throw new Error('A mission id is required.');
        }

        const retried = await retryMission(options.projectDir || process.cwd(), target);
        console.log(`Mission retried: ${retried.id}`);
        console.log(`Attempt count: ${retried.attempt_count}`);
        return;
      }

      if (normalizedAction === 'status') {
        if (!target) {
          throw new Error('A mission id is required.');
        }

        const status = await getMissionStatus(options.projectDir || process.cwd(), target);
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
