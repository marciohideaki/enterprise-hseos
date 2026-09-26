'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { canonicalJson } = require('../../../packages/agent-session-store');

const digest = (value) => createHash('sha256').update(value).digest('hex');

// Git metadata may name executable extensions. Project code belongs in the sandbox.
function projectGit(root, args, input) {
  const base = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', root];
  const options = {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 65_536,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ATTR_NOSYSTEM: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  const keys = execFileSync('git', [...base, 'config', '--includes', '--name-only', '--list'], options);
  if (/^filter\./im.test(keys)) throw new Error('Project Git conversion filters are unsupported');
  const top = execFileSync('git', [...base, 'rev-parse', '--show-toplevel'], options).trim();
  if (top !== root) throw new Error('Project Git root does not match workspace');
  return execFileSync('git', [...base, `--work-tree=${root}`, ...args], { ...options, input });
}

function workspaceSnapshot(contract, root) {
  const identity = fs.lstatSync(root);
  if (!identity.isDirectory() || identity.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw new Error('Unsafe project workspace');
  }
  let bytes = 0;
  const files = contract.scope.read.map((name) => {
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9_][a-zA-Z0-9._-]*)*$/.test(name)) throw new Error('Invalid project path');
    const directories = [];
    let fd;
    try {
      directories.push(fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY));
      for (const segment of name.split('/').slice(0, -1)) {
        directories.push(
          fs.openSync(
            `/proc/self/fd/${directories.at(-1)}/${segment}`,
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY,
          ),
        );
      }
      const filename = `/proc/self/fd/${directories.at(-1)}/${name.split('/').at(-1)}`;
      fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || before.size > contract.max_artifact_bytes - bytes)
        throw new Error('Unsafe project file');
      const buffer = Buffer.alloc(before.size + 1);
      const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const after = fs.fstatSync(fd);
      const linked = fs.lstatSync(filename);
      if (
        length !== before.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        linked.ino !== before.ino ||
        linked.dev !== before.dev ||
        linked.isSymbolicLink()
      )
        throw new Error('Project changed during snapshot');
      bytes += length;
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
      return { path: name, content, sha256: digest(buffer.subarray(0, length)) };
    } catch (error) {
      if (error.code === 'ENOENT') return { path: name, content: null, sha256: null };
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      for (const directory of directories.toReversed()) fs.closeSync(directory);
    }
  });
  const after = fs.lstatSync(root);
  if (after.ino !== identity.ino || after.dev !== identity.dev || after.isSymbolicLink()) throw new Error('Project identity changed');
  return { files, sha256: digest(canonicalJson(files.map(({ path: name, sha256 }) => ({ path: name, sha256 })))) };
}

function projectWorkspaceSnapshot(contract) {
  const root = contract.workspace.root;
  const gitHead = projectGit(root, ['rev-parse', '--verify', 'HEAD']).trim();
  if (gitHead !== contract.baseline_sha) throw new Error('Project Git baseline changed');
  return workspaceSnapshot(contract, root);
}

function hydrateProjectTask(contract) {
  const snapshot = projectWorkspaceSnapshot(contract);
  if (snapshot.sha256 !== contract.workspace.files_sha256) throw new Error('Project content baseline changed');
  if (contract.initial_files.length > 0) throw new Error('Project input must be read from its declared workspace');
  return { ...contract, initial_files: snapshot.files.filter((file) => file.content !== null) };
}

module.exports = { projectWorkspaceSnapshot, hydrateProjectTask };

function projectPatch(contract, files) {
  const originals = new Map(contract.initial_files.map((file) => [file.path, file.content]));
  const block = (content, prefix) => {
    if (content === null || content === '') return [];
    const lines = content.split('\n');
    const newline = lines.at(-1) === '';
    if (newline) lines.pop();
    const result = lines.map((line) => prefix + line);
    if (!newline) result.push(String.raw`\ No newline at end of file`);
    return result;
  };
  const count = (content) => (content === null || content === '' ? 0 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0));
  const patches = [];
  for (const file of files) {
    const before = originals.get(file.path) ?? null;
    if (before === file.content) continue;
    if (!contract.scope.write.includes(file.path)) throw new Error('Patch would change a read-only path');
    const a = count(before),
      b = count(file.content);
    if (a === 0 && b === 0) {
      patches.push(
        `diff --git a/${file.path} b/${file.path}\n${before === null ? 'new' : 'deleted'} file mode 100644\nindex ${before === null ? '0000000..e69de29' : 'e69de29..0000000'}\n`,
      );
      continue;
    }
    patches.push(
      `diff --git a/${file.path} b/${file.path}\n${before === null ? 'new file mode 100644\n' : file.content === null ? 'deleted file mode 100644\n' : ''}--- ${before === null ? '/dev/null' : 'a/' + file.path}\n+++ ${file.content === null ? '/dev/null' : 'b/' + file.path}\n@@ -${a ? 1 : 0},${a} +${b ? 1 : 0},${b} @@\n${[...block(before, '-'), ...block(file.content, '+')].join('\n')}\n`,
    );
  }
  return patches.join('');
}

function reviewProjectResult(evidence) {
  const contract = evidence.contract;
  if (contract.schema_version !== 2 || evidence.task_result !== 'approved' || !evidence.artifacts)
    throw new Error('An approved project result is required');
  const candidate = workspaceSnapshot(contract, path.join(evidence.state, 'workspace'));
  if (digest(canonicalJson(candidate.files)) !== evidence.artifacts.files_sha256)
    throw new Error('Project candidate changed after verification');
  const current = projectWorkspaceSnapshot(contract);
  const patch = projectPatch(contract, evidence.artifacts.files);
  const review = {
    schema_version: 1,
    task_run_id: evidence.task_run_id,
    current_sequence: evidence.current_sequence,
    contract_sha256: evidence.contract_sha256,
    files_sha256: evidence.artifacts.files_sha256,
    baseline_sha: contract.baseline_sha,
    current_workspace_sha256: current.sha256,
    baseline_valid: current.sha256 === contract.workspace.files_sha256,
    patch,
  };
  return { ...review, review_sha256: digest(canonicalJson(review)) };
}

function applyProjectResult(evidence, expectedReview) {
  const review = reviewProjectResult(evidence);
  if (!review.baseline_valid || review.review_sha256 !== expectedReview) throw new Error('Project approval is stale');
  const contract = evidence.contract;
  const git = (args, input) => projectGit(contract.workspace.root, args, input);
  // Git's index/worktree preconditions are mandatory. Never force or auto-commit.
  git(['diff', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--', ...contract.scope.read]);
  if (review.patch) {
    git(['apply', '--check', '--index', '--whitespace=nowarn', '-'], review.patch);
    if (projectWorkspaceSnapshot(contract).sha256 !== contract.workspace.files_sha256)
      throw new Error('Project changed before application');
    git(['apply', '--index', '--whitespace=nowarn', '-'], review.patch);
  }
  const after = projectWorkspaceSnapshot(contract);
  if (after.sha256 !== digest(canonicalJson(evidence.artifacts.files.map(({ path: name, sha256 }) => ({ path: name, sha256 })))))
    throw new Error('Application outcome requires reconciliation');
  return { applied: true, task_run_id: evidence.task_run_id, review_sha256: expectedReview, workspace_sha256: after.sha256 };
}

module.exports.projectPatch = projectPatch;
module.exports.reviewProjectResult = reviewProjectResult;
module.exports.applyProjectResult = applyProjectResult;

function prepareProjectTask(value) {
  const { parseEngineeringTask } = require('./engineering-task-contract');
  const input = structuredClone(value);
  input.baseline_sha = '0'.repeat(40);
  input.workspace = { ...input.workspace, files_sha256: '0'.repeat(64) };
  input.verifier = { ...input.verifier, sha256: '0'.repeat(64) };
  input.initial_files = [];
  const parsed = parseEngineeringTask(input);
  if (parsed.schema_version !== 2) throw new Error('Project preparation requires contract v2');
  input.baseline_sha = projectGit(parsed.workspace.root, ['rev-parse', '--verify', 'HEAD']).trim();
  input.workspace.files_sha256 = projectWorkspaceSnapshot(input).sha256;
  input.verifier.sha256 = require('./engineering-project-verifier').projectVerifierDigest(input);
  const result = parseEngineeringTask(input);
  require('./engineering-project-verifier').attestEngineeringVerifier(result);
  return result;
}
module.exports.prepareProjectTask = prepareProjectTask;
