'use strict';

const { execFileSync } = require('node:child_process');

const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop']);
const CLEANUP_PREFIX = /^feature\//;
const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const MERGE_METHODS = new Set(['merge', 'squash', 'rebase']);

function runCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseJson(raw, description) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse ${description}: ${error.message}`);
  }
}

function prView(number, options = {}) {
  const raw = runCommand(
    'gh',
    [
      'pr',
      'view',
      String(number),
      '--json',
      'number,url,state,isDraft,mergeable,mergedAt,mergeCommit,baseRefName,headRefName,statusCheckRollup',
    ],
    options
  );
  return parseJson(raw, `PR #${number}`);
}

function assertChecksPassing(pr) {
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  if (checks.length === 0) {
    throw new Error(`PR #${pr.number} has no status checks; refusing governed closeout`);
  }

  const failing = checks.filter((check) => {
    if (check.status !== 'COMPLETED') {
      return true;
    }
    return !PASSING_CONCLUSIONS.has(check.conclusion);
  });

  if (failing.length > 0) {
    const names = failing.map((check) => `${check.name}:${check.status}/${check.conclusion || 'PENDING'}`).join(', ');
    throw new Error(`PR #${pr.number} has non-passing checks: ${names}`);
  }
}

function assertCanMerge(pr, approved) {
  if (!approved) {
    throw new Error('Explicit human approval is required. Re-run with --approved after review.');
  }
  if (pr.state !== 'OPEN') {
    throw new Error(`PR #${pr.number} is ${pr.state}; expected OPEN`);
  }
  if (pr.isDraft) {
    throw new Error(`PR #${pr.number} is a draft`);
  }
  if (pr.mergeable !== 'MERGEABLE') {
    throw new Error(`PR #${pr.number} is not mergeable: ${pr.mergeable}`);
  }
  if (PROTECTED_BRANCHES.has(pr.headRefName)) {
    throw new Error(`Refusing to merge from protected head branch: ${pr.headRefName}`);
  }
  assertChecksPassing(pr);
}

function safeDeleteBranch(branch, base, options = {}) {
  if (!branch || PROTECTED_BRANCHES.has(branch)) {
    return { deleted: false, reason: 'protected-or-empty' };
  }
  if (!CLEANUP_PREFIX.test(branch)) {
    return { deleted: false, reason: 'unsupported-prefix' };
  }

  const localMerged = runCommand('git', ['branch', '--merged', base, '--list', branch], options)
    .split('\n')
    .map((line) => line.replace(/^[* ]+/, '').trim())
    .filter(Boolean)
    .includes(branch);

  const remoteRef = `origin/${branch}`;
  const remoteMerged = runCommand('git', ['branch', '-r', '--merged', `origin/${base}`], options)
    .split('\n')
    .map((line) => line.replace(/^[* ]+/, '').trim())
    .filter(Boolean)
    .includes(remoteRef);

  if (localMerged) {
    runCommand('git', ['branch', '-d', branch], options);
  }
  if (remoteMerged) {
    runCommand('git', ['push', 'origin', '--delete', branch], options);
  }

  if (!localMerged && !remoteMerged) {
    return { deleted: false, reason: 'not-merged' };
  }

  return { deleted: true, local: localMerged, remote: remoteMerged };
}

function closeoutPullRequest({
  number,
  cwd = process.cwd(),
  approved = false,
  mergeMethod = 'merge',
  deleteBranch = true,
  dryRun = false,
} = {}) {
  if (!number) {
    throw new Error('PR number is required');
  }
  if (!MERGE_METHODS.has(mergeMethod)) {
    throw new Error(`Unsupported merge method: ${mergeMethod}`);
  }

  const options = { cwd, dryRun };
  const before = prView(number, options);

  if (before.state === 'MERGED') {
    if (dryRun) {
      return { action: 'already-merged', pr: before, cleanup: { deleted: false, reason: 'dry-run' } };
    }
    runCommand('git', ['fetch', 'origin', before.baseRefName], options);
    runCommand('git', ['switch', before.baseRefName], options);
    runCommand('git', ['pull', '--ff-only', 'origin', before.baseRefName], options);
    const cleanup = deleteBranch
      ? safeDeleteBranch(before.headRefName, before.baseRefName, options)
      : { deleted: false, reason: 'disabled' };
    return { action: 'already-merged', pr: before, cleanup };
  }

  assertCanMerge(before, approved);

  if (dryRun) {
    return { action: 'would-merge', pr: before, cleanup: { deleted: false, reason: 'dry-run' } };
  }

  runCommand('gh', ['pr', 'merge', String(number), `--${mergeMethod}`], options);
  const after = prView(number, options);

  runCommand('git', ['fetch', 'origin', before.baseRefName], options);
  runCommand('git', ['switch', before.baseRefName], options);
  runCommand('git', ['pull', '--ff-only', 'origin', before.baseRefName], options);

  const cleanup = deleteBranch
    ? safeDeleteBranch(before.headRefName, before.baseRefName, options)
    : { deleted: false, reason: 'disabled' };

  return { action: 'merged', pr: after, cleanup };
}

module.exports = {
  assertCanMerge,
  assertChecksPassing,
  closeoutPullRequest,
  safeDeleteBranch,
};
