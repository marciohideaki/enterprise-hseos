const {
  recordApprovalDecision,
} = require('../lib/ops/approval-store');
const { buildOperationsSnapshot } = require('../lib/ops/console-read-model');

module.exports = {
  command: 'ops',
  description: 'Inspect HSEOS execution observability read models',
  arguments: [
    ['<action>', 'Operational action: summary, runs, evidence, blockers, approvals, approve, or revoke'],
    ['[target]', 'Optional blocker key for approve/revoke actions'],
  ],
  options: [
    ['--project-dir <path>', 'Project directory that owns the HSEOS operational data'],
    ['--reason <text>', 'Reason recorded for approval or revocation decisions'],
    ['--actor <name>', 'Operator identity recorded for approval or revocation decisions'],
  ],
  action: async (action, target, options) => {
    try {
      const projectDir = options.projectDir || process.cwd();
      const normalizedAction = String(action || '').trim().toLowerCase();

      if (normalizedAction === 'summary') {
        const snapshot = await buildOperationsSnapshot(projectDir);
        console.log(JSON.stringify(snapshot.summary, null, 2));
        return;
      }

      if (normalizedAction === 'runs') {
        const snapshot = await buildOperationsSnapshot(projectDir);
        console.log(JSON.stringify(snapshot.runs, null, 2));
        return;
      }

      if (normalizedAction === 'evidence') {
        const snapshot = await buildOperationsSnapshot(projectDir);
        console.log(JSON.stringify(snapshot.evidence, null, 2));
        return;
      }

      if (normalizedAction === 'blockers') {
        const snapshot = await buildOperationsSnapshot(projectDir);
        console.log(JSON.stringify(snapshot.blockers, null, 2));
        return;
      }

      if (normalizedAction === 'approvals') {
        const snapshot = await buildOperationsSnapshot(projectDir);
        console.log(JSON.stringify(snapshot.approvals, null, 2));
        return;
      }

      if (normalizedAction === 'approve' || normalizedAction === 'revoke') {
        const blockerKey = String(target || '').trim();
        if (blockerKey.length === 0) {
          throw new Error(`A blocker key is required for "${normalizedAction}".`);
        }

        const snapshot = await buildOperationsSnapshot(projectDir);
        const blocker = snapshot.blockers.find((entry) => entry.key === blockerKey);
        const currentDecision = snapshot.approvals.current.find((entry) => entry.blockerKey === blockerKey) || null;

        if (normalizedAction === 'approve') {
          if (!blocker) {
            throw new Error(`Blocker not found: ${blockerKey}`);
          }

          if (blocker.status === 'approved') {
            throw new Error(`Blocker already approved: ${blockerKey}`);
          }
        } else if (!currentDecision || currentDecision.action !== 'approve') {
          throw new Error(`No active approval found for blocker: ${blockerKey}`);
        }

        const decision = await recordApprovalDecision(projectDir, {
          action: normalizedAction,
          actor: options.actor,
          blocker: blocker || currentDecision?.blocker || null,
          blockerKey,
          reason: options.reason,
          source: 'ops.command',
        });

        console.log(JSON.stringify(decision, null, 2));
        return;
      }

      throw new Error(`Unsupported ops action: ${action}`);
    } catch (error) {
      console.error(`Execution observability command failed: ${error.message}`);
      process.exit(1);
    }
  },
};
