'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop']);
const CLEANUP_PREFIX = /^feature\//;
const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const MERGE_METHODS = new Set(['merge', 'squash', 'rebase']);
const DEFAULT_ENGINEERING_LEADERSHIP = Object.freeze(['marciohideaki']);
const DEFAULT_ENGINEERING_LEADERSHIP_PATHS = Object.freeze(['.enterprise/.specs/constitution/', '.enterprise/.specs/core/']);
const APPROVAL_MARKER = 'Engineering Leadership approval';

function runCommand(command, args, options = {}) {
  options = options || {};
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
  const raw = (options.run || runCommand)(
    'gh',
    [
      'pr',
      'view',
      String(number),
      '--json',
      'number,url,state,isDraft,mergeable,mergedAt,mergeCommit,baseRefName,headRefName,headRefOid,statusCheckRollup,files,comments',
    ],
    options,
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

function normalizeLogin(login) {
  return String(login || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function stringList(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : [...fallback];
}

/**
 * Read governance.engineering_leadership and governance.engineering_leadership_paths
 * from .hseos/config/hseos.config.yaml; fall back to defaults when absent or unreadable.
 */
function loadEngineeringLeadershipConfig(cwd = process.cwd()) {
  let governance = {};
  try {
    const yaml = require('js-yaml');
    const configPath = path.join(cwd, '.hseos', 'config', 'hseos.config.yaml');
    if (fs.existsSync(configPath)) {
      governance = yaml.load(fs.readFileSync(configPath, 'utf8'))?.governance || {};
    }
  } catch {
    governance = {};
  }
  return {
    logins: stringList(governance.engineering_leadership, DEFAULT_ENGINEERING_LEADERSHIP).map(normalizeLogin),
    paths: stringList(governance.engineering_leadership_paths, DEFAULT_ENGINEERING_LEADERSHIP_PATHS),
  };
}

const GH_FILES_CAP = 100;

function restrictedFiles(pr, paths) {
  const files = Array.isArray(pr.files) ? pr.files : [];
  const candidates = files.flatMap((file) => [file.path, file.previousPath]);
  return [...new Set(candidates.filter((file) => file && paths.some((prefix) => file.startsWith(prefix))))];
}

/**
 * Replace the (capped at 100) gh file list with the full paginated list, including rename
 * origins, so a restricted file cannot hide past the cap or behind a rename. Fails closed
 * when the complete list cannot be obtained and the capped list may be truncated.
 */
function withCompleteFiles(pr, options) {
  const files = Array.isArray(pr.files) ? pr.files : [];
  try {
    const raw = (options.run || runCommand)(
      'gh',
      [
        'api',
        '--paginate',
        `repos/{owner}/{repo}/pulls/${pr.number}/files`,
        '--jq',
        '.[] | {path: .filename, previousPath: .previous_filename}',
      ],
      options,
    );
    const full = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (full.length > 0 && full.every((file) => file && typeof file.path === 'string')) {
      return { ...pr, files: full };
    }
  } catch {
    // fall through to the capped list
  }
  if (files.length >= GH_FILES_CAP) {
    throw new Error(
      `PR #${pr.number} lists ${files.length}+ files and the complete file list could not be fetched; refusing closeout because a restricted path could be hidden`,
    );
  }
  return pr;
}

function restrictedDiff(base, sha, paths, options) {
  return (options.run || runCommand)('git', ['diff', `origin/${base}...${sha}`, '--', ...paths], options);
}

function approvalIsCurrent(pr, sha, config, options) {
  const head = String(pr.headRefOid || '').toLowerCase();
  if (!head) {
    return false;
  }
  if (head.startsWith(sha) || sha.startsWith(head)) {
    return true;
  }
  try {
    // The approved commit must be part of this PR's history, not an arbitrary object.
    (options.run || runCommand)('git', ['merge-base', '--is-ancestor', sha, head], options);
    return restrictedDiff(pr.baseRefName, sha, config.paths, options) === restrictedDiff(pr.baseRefName, head, config.paths, options);
  } catch {
    return false;
  }
}

/**
 * Enforce Engineering Leadership approval (Enterprise Constitution section 13) when the PR
 * touches restricted shard paths. Throws with exactly what is missing.
 */
function assertEngineeringLeadershipApproval(pr, config = loadEngineeringLeadershipConfig(), options = {}) {
  const touched = restrictedFiles(pr, config.paths);
  if (touched.length === 0) {
    return { required: false, files: [] };
  }

  const comments = Array.isArray(pr.comments) ? pr.comments : [];
  const approvals = comments.filter(
    (comment) => config.logins.includes(normalizeLogin(comment.author?.login)) && String(comment.body || '').includes(APPROVAL_MARKER),
  );
  const head = String(pr.headRefOid || '').slice(0, 12);
  const missing = `PR #${pr.number} touches Engineering Leadership paths (${touched.length} file(s), e.g. ${touched[0]}) and needs a comment from ${config.logins.map((l) => `@${l}`).join(' or ')} containing "${APPROVAL_MARKER}" and the approved head SHA (current head ${head}). Re-run with --engineering-leadership-approval as an authorized leader, or have one comment.`;

  if (approvals.length === 0) {
    throw new Error(missing);
  }
  for (const comment of approvals) {
    // Only SHAs labelled as the approved head count; stray hex tokens in quotes are ignored.
    const tokens = [
      ...String(comment.body)
        .toLowerCase()
        .matchAll(/\bhead(?: sha)?\b[\s:`]*([0-9a-f]{7,40})\b/g),
    ].map((m) => m[1]);
    if (tokens.some((sha) => approvalIsCurrent(pr, sha, config, options))) {
      return { required: true, files: touched, approvedBy: normalizeLogin(comment.author?.login) };
    }
  }
  throw new Error(`${missing} Existing approval(s) reference a stale head and the restricted paths changed since.`);
}

function approvalCommentBody(pr) {
  return `**${APPROVAL_MARKER} - recorded (Enterprise Constitution section 13)**\n\nApproved head: ${pr.headRefOid}`;
}

function safeDeleteBranch(branch, base, options = {}) {
  const exec = options.run || runCommand;
  if (!branch || PROTECTED_BRANCHES.has(branch)) {
    return { deleted: false, reason: 'protected-or-empty' };
  }
  if (!CLEANUP_PREFIX.test(branch)) {
    return { deleted: false, reason: 'unsupported-prefix' };
  }

  const localMerged = exec('git', ['branch', '--merged', base, '--list', branch], options)
    .split('\n')
    .map((line) => line.replace(/^[* ]+/, '').trim())
    .filter(Boolean)
    .includes(branch);

  const remoteRef = `origin/${branch}`;
  const remoteMerged = exec('git', ['branch', '-r', '--merged', `origin/${base}`], options)
    .split('\n')
    .map((line) => line.replace(/^[* ]+/, '').trim())
    .filter(Boolean)
    .includes(remoteRef);

  if (localMerged) {
    exec('git', ['branch', '-d', branch], options);
  }
  if (remoteMerged) {
    exec('git', ['push', 'origin', '--delete', branch], options);
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
  engineeringLeadershipApproval = false,
  run = runCommand,
} = {}) {
  if (!number) {
    throw new Error('PR number is required');
  }
  if (!MERGE_METHODS.has(mergeMethod)) {
    throw new Error(`Unsupported merge method: ${mergeMethod}`);
  }

  const options = { cwd, dryRun, run };
  let before = prView(number, options);

  if (before.state === 'MERGED') {
    if (dryRun) {
      return { action: 'already-merged', pr: before, cleanup: { deleted: false, reason: 'dry-run' } };
    }
    run('git', ['fetch', 'origin', before.baseRefName], options);
    run('git', ['switch', before.baseRefName], options);
    run('git', ['pull', '--ff-only', 'origin', before.baseRefName], options);
    const cleanup = deleteBranch
      ? safeDeleteBranch(before.headRefName, before.baseRefName, options)
      : { deleted: false, reason: 'disabled' };
    return { action: 'already-merged', pr: before, cleanup };
  }

  assertCanMerge(before, approved);

  before = withCompleteFiles(before, options);
  const elConfig = loadEngineeringLeadershipConfig(cwd);
  if (!dryRun && restrictedFiles(before, elConfig.paths).length > 0) {
    // Dry-run never fetches (no local ref changes). Best effort: make base and head objects available locally for the restricted-path diff.
    try {
      run('git', ['fetch', 'origin', before.baseRefName, `pull/${number}/head`], options);
    } catch {
      // diff comparison falls back to refusing when objects are unavailable
    }
  }
  let elPublish = false;
  if (engineeringLeadershipApproval) {
    const login = normalizeLogin(JSON.parse(run('gh', ['api', 'user'], options)).login);
    if (!elConfig.logins.includes(login)) {
      throw new Error(
        `Authenticated GitHub user @${login} is not in engineering_leadership (${elConfig.logins.join(', ')}); refusing --engineering-leadership-approval`,
      );
    }
    elPublish = restrictedFiles(before, elConfig.paths).length > 0;
  }
  if (elPublish) {
    if (!dryRun) {
      run('gh', ['pr', 'comment', String(number), '--body', approvalCommentBody(before)], options);
    }
  } else {
    assertEngineeringLeadershipApproval(before, elConfig, options);
  }

  if (dryRun) {
    return {
      action: 'would-merge',
      pr: before,
      engineeringLeadership: elPublish ? 'would-publish-approval' : 'ok',
      cleanup: { deleted: false, reason: 'dry-run' },
    };
  }

  run('gh', ['pr', 'merge', String(number), `--${mergeMethod}`], options);
  const after = prView(number, options);

  run('git', ['fetch', 'origin', before.baseRefName], options);
  run('git', ['switch', before.baseRefName], options);
  run('git', ['pull', '--ff-only', 'origin', before.baseRefName], options);

  const cleanup = deleteBranch ? safeDeleteBranch(before.headRefName, before.baseRefName, options) : { deleted: false, reason: 'disabled' };

  return { action: 'merged', pr: after, cleanup };
}

module.exports = {
  assertCanMerge,
  assertEngineeringLeadershipApproval,
  loadEngineeringLeadershipConfig,
  assertChecksPassing,
  closeoutPullRequest,
  safeDeleteBranch,
};
