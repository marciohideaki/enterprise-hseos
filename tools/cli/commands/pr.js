'use strict';

const prompts = require('../lib/prompts');
const { closeoutPullRequest } = require('../lib/pr-closeout');

const SUPPORTED_ACTIONS = new Set(['closeout']);

module.exports = {
  command: 'pr <action> [number]',
  description: 'Governed Pull Request operations',
  options: [
    ['--approved', 'Confirm explicit human approval for governed merge'],
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
      deleteBranch: !options.keepBranch,
      mergeMethod: options.mergeMethod || 'merge',
    });

    const pr = result.pr;
    await prompts.log.success(`PR #${pr.number} ${result.action}: ${pr.url}`);
    if (result.cleanup?.deleted) {
      await prompts.log.success(`Deleted branch: ${pr.headRefName}`);
    } else {
      await prompts.log.message(`Branch cleanup: ${result.cleanup?.reason || 'not requested'}`);
    }
  },
};
