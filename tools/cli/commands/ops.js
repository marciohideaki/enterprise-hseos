const { recordApprovalDecision } = require('../lib/ops/approval-store');
const { buildOperationsSnapshot } = require('../lib/ops/console-read-model');
const { buildInstallDoctorReport, captureInstalledState, repairInstallState } = require('../lib/install/lifecycle');
const { buildInstallPlan } = require('../lib/install/plan-runtime');
const { readInstallState } = require('../lib/install/install-state');
const { buildSessionSnapshot, listSessions, readSession } = require('../lib/session/store');

module.exports = {
  command: 'ops',
  description: 'Inspect HSEOS execution observability read models',
  arguments: [
    ['<action>', 'Operational action: summary, posture, runs, evidence, blockers, approvals, approve, revoke, install, or session'],
    ['[target]', 'Optional blocker key, install subaction, or session subaction'],
    ['[subtarget]', 'Optional install/session target'],
  ],
  options: [
    ['--project-dir <path>', 'Project directory that owns the HSEOS operational data'],
    ['--reason <text>', 'Reason recorded for approval or revocation decisions'],
    ['--actor <name>', 'Operator identity recorded for approval or revocation decisions'],
    ['--modules <ids>', 'Comma-separated module ids for ops install plan/apply'],
    ['--tools <ids>', 'Comma-separated tool/IDE ids for ops install plan/apply'],
    ['--dry-run', 'Dry-run repair operations where supported'],
  ],
  action: async (action, target, subtarget, options) => {
    try {
      const projectDir = options.projectDir || process.cwd();
      const normalizedAction = String(action || '').trim().toLowerCase();

      if (normalizedAction === 'install') {
        const installAction = String(target || '').trim().toLowerCase();
        const planOptions = {
          projectDir,
          directory: projectDir,
          modules: options.modules || subtarget || '',
          tools: options.tools || '',
        };

        if (installAction === 'plan') {
          console.log(JSON.stringify(await buildInstallPlan(planOptions), null, 2));
          return;
        }

        if (installAction === 'apply') {
          const plan = await buildInstallPlan(planOptions);
          console.log(JSON.stringify(await captureInstalledState(projectDir, plan), null, 2));
          return;
        }

        if (installAction === 'doctor') {
          console.log(JSON.stringify(await buildInstallDoctorReport(projectDir), null, 2));
          return;
        }

        if (installAction === 'repair') {
          console.log(JSON.stringify(await repairInstallState(projectDir, { dryRun: options.dryRun }), null, 2));
          return;
        }

        if (installAction === 'inspect' || installAction === 'summary') {
          console.log(JSON.stringify(await readInstallState(projectDir), null, 2));
          return;
        }

        throw new Error(`Unsupported install action: ${target}`);
      }

      if (normalizedAction === 'session') {
        const sessionAction = String(target || '').trim().toLowerCase();
        if (sessionAction === 'list') {
          console.log(JSON.stringify(await listSessions(projectDir), null, 2));
          return;
        }

        if (sessionAction === 'inspect') {
          if (!subtarget) {
            throw new Error('A session id is required.');
          }
          const session = await readSession(projectDir, subtarget);
          const snapshot = await buildSessionSnapshot(projectDir, subtarget);
          console.log(JSON.stringify({ session, snapshot }, null, 2));
          return;
        }

        throw new Error(`Unsupported session action: ${target}`);
      }

      if (normalizedAction === 'summary') {
        const snapshot = await buildOperationsSnapshot(projectDir);
        console.log(JSON.stringify(snapshot.summary, null, 2));
        return;
      }

      if (normalizedAction === 'posture') {
        const snapshot = await buildOperationsSnapshot(projectDir);
        console.log(JSON.stringify(snapshot.posture, null, 2));
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
