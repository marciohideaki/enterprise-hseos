'use strict';

const prompts = require('../lib/prompts');
const { closeoutPullRequest } = require('../lib/pr-closeout');

const SUPPORTED_ACTIONS = new Set(['closeout']);

module.exports = {
  command: 'pr <action> [number]',
  description: 'Governed Pull Request closeout',
  options: [
    ['--approved', 'Confirm explicit human approval for governed merge'],
    [
      '--engineering-leadership-approval',
      'Publish the Engineering Leadership approval comment for the current head (requires the authenticated gh user to be in governance.engineering_leadership)',
    ],
    ['--dry-run', 'Validate and print the planned closeout without executing it'],
    ['--keep-branch', 'Do not delete the feature branch after a safe merge'],
    ['--merge-method <method>', 'Merge method: merge, squash, or rebase (default: merge)', 'merge'],
  ],
  action: async (action, number, options = {}) => {
    if (!SUPPORTED_ACTIONS.has(action)) {
      throw new Error(`Unsupported pr action: ${action}. Expected: closeout`);
    }

    const result = closeoutPullRequest({
      number,
      approved: Boolean(options.approved),
      dryRun: Boolean(options.dryRun),
      engineeringLeadershipApproval: Boolean(options.engineeringLeadershipApproval),
      deleteBranch: !options.keepBranch,
      mergeMethod: options.mergeMethod || 'merge',
    });

    const pr = result.pr;
    if (result.engineeringLeadership) {
      await prompts.log.message(`Engineering Leadership gate: ${result.engineeringLeadership}`);
    }
    await prompts.log.success(`PR #${pr.number} ${result.action}: ${pr.url}`);
    if (result.cleanup?.deleted) {
      await prompts.log.success(`Deleted branch: ${pr.headRefName}`);
    } else {
      await prompts.log.message(`Branch cleanup: ${result.cleanup?.reason || 'not requested'}`);
    }
  },
};
