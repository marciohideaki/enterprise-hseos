'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const YAML = require('yaml');
const { canonicalJson } = require('../../../packages/agent-session-store');
const { PROJECT_LIMITS, isProjectPath, isStorePath } = require('./engineering-task-contract');

/**
 * Curated rejection: `reason` is a closed code and `message` a fixed string, both safe to return to API clients.
 * Anything not built here (raw fs/git errors) must never be echoed because it can embed host paths.
 */
function projectRejection(reason, message, file, field) {
  return Object.assign(new Error(message), { reason, ...(file ? { file } : {}), ...(field ? { field } : {}) });
}

const FS_REASONS = {
  ELOOP: ['PROJECT_FILE_UNSAFE', 'Unsafe project file'],
  ENOTDIR: ['PROJECT_FILE_UNSAFE', 'Unsafe project file'],
  EMLINK: ['PROJECT_FILE_UNSAFE', 'Unsafe project file'],
  EACCES: ['PROJECT_FILE_UNREADABLE', 'Project file is not readable'],
  EPERM: ['PROJECT_FILE_UNREADABLE', 'Project file is not readable'],
};

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
  if (/^filter\./im.test(keys)) throw projectRejection('PROJECT_GIT_FILTERS_UNSUPPORTED', 'Project Git conversion filters are unsupported');
  const top = execFileSync('git', [...base, 'rev-parse', '--show-toplevel'], options).trim();
  if (top !== root) throw projectRejection('PROJECT_GIT_ROOT_MISMATCH', 'Project Git root does not match workspace');
  return execFileSync('git', [...base, `--work-tree=${root}`, ...args], { ...options, input });
}

/** Filesystem failures on a store path are reported with a fixed message, never with the host path they came from. */
function storeFailure(error, name) {
  const [reason, message] = FS_REASONS[error?.code] || ['PROJECT_FILE_UNSAFE', 'Unsafe project file'];
  return projectRejection(reason, message, name);
}

/**
 * A pnpm virtual-store path may reach its file through symlinked package directories. Resolve it and
 * require the result to stay inside the real node_modules/.pnpm of the verified workspace root; the
 * caller then opens the resolved path without following any link.
 */
function resolveStoreTarget(root, name) {
  const storeRoot = path.join(root, 'node_modules', '.pnpm');
  for (const directory of [path.join(root, 'node_modules'), storeRoot]) {
    let stat;
    try {
      stat = fs.lstatSync(directory);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw storeFailure(error, name);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw projectRejection('PROJECT_FILE_UNSAFE', 'Unsafe project file', name);
  }
  let real;
  try {
    real = fs.realpathSync(path.join(root, name));
  } catch (error) {
    // Absent or dangling: the caller records an absent file exactly as for ordinary paths.
    if (error.code === 'ENOENT') return null;
    throw storeFailure(error, name);
  }
  const relative = path.relative(root, real);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !isStorePath(relative)) {
    throw projectRejection('PROJECT_STORE_LINK_ESCAPES', 'A pnpm store link resolves outside the verified store', name);
  }
  return relative;
}

const HSEOS_CONFIG = path.resolve(__dirname, '../../../.hseos/config/hseos.config.yaml');

const IGNORED_STORE_ENV = Object.freeze(['HSEOS_PNPM_STORE_DIRS', 'PNPM_STORE_DIR', 'npm_config_store_dir']);
const warnedStoreEnv = new Set();
let injectedStores = [];

/**
 * Internal controller API: trust these stores in addition to the controller files. Returns a function that restores
 * the previous list. Tests use it; nothing reads the environment, because a project script can set any variable and
 * npm exports a project .npmrc store-dir as npm_config_store_dir.
 */
function trustPnpmStores(directories) {
  const previous = injectedStores;
  injectedStores = directories.filter((value) => typeof value === 'string' && path.isAbsolute(value)).map((value) => path.normalize(value));
  return () => {
    injectedStores = previous;
  };
}

/**
 * The pnpm stores the controller trusts. Only files outside the project's control count: the HSEOS configuration of
 * the controller installation and of the user (toolchain.pnpm_store_dirs), the user's pnpm rc, and the pnpm
 * default. Environment variables are ignored for this purpose (with a warning when they are present), and so is
 * everything inside the project, including its .npmrc and .modules.yaml.
 */
function controllerStoreDirs({ home = os.userInfo().homedir } = {}) {
  for (const name of IGNORED_STORE_ENV) {
    if (process.env[name] !== undefined && !warnedStoreEnv.has(name)) {
      warnedStoreEnv.add(name);
      process.emitWarning(`${name} is ignored: pnpm stores are trusted only through controller files`, { code: 'HSEOS_PNPM_ENV_IGNORED' });
    }
  }
  const trusted = new Set();
  const add = (value) => {
    if (typeof value === 'string' && path.isAbsolute(value)) trusted.add(path.normalize(value).replace(/\/+$/, '') || '/');
  };
  for (const value of injectedStores) add(value);
  for (const file of [path.join(home, '.config', 'hseos', 'config.yaml'), HSEOS_CONFIG]) {
    try {
      for (const value of YAML.parse(fs.readFileSync(file, 'utf8'))?.toolchain?.pnpm_store_dirs ?? []) add(value);
    } catch {
      // An absent or unreadable configuration trusts nothing extra.
    }
  }
  try {
    add(/^\s*store-dir\s*=\s*(\S+)\s*$/m.exec(fs.readFileSync(path.join(home, '.config', 'pnpm', 'rc'), 'utf8'))?.[1]);
  } catch {
    // No user rc file.
  }
  add(path.join(home, '.local', 'share', 'pnpm', 'store'));
  return [...trusted];
}

/**
 * The pnpm content store of a project. The project only names it (.modules.yaml); the name is honoured when it
 * equals a controller-trusted store (or its v<N> directory) and is a real directory of the current user outside the
 * project. A name that is not trusted is refused, so a project cannot point the check at a store it forged.
 */
function pnpmStoreDirectory(root) {
  let declared;
  try {
    const filename = path.join(root, 'node_modules', '.modules.yaml');
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > 4_194_304) return null;
    declared = YAML.parse(fs.readFileSync(filename, 'utf8'))?.storeDir;
  } catch {
    return null;
  }
  if (typeof declared !== 'string' || !path.isAbsolute(declared) || path.normalize(declared) !== declared) return null;
  const trusted = controllerStoreDirs().some(
    (base) => declared === base || (declared.startsWith(`${base}/`) && /^v[0-9]+$/.test(declared.slice(base.length + 1))),
  );
  if (!trusted) throw projectRejection('PROJECT_STORE_DIR_NOT_ALLOWED', 'The pnpm store named by the project is not a trusted store');
  try {
    const directory = fs.lstatSync(declared);
    if (!directory.isDirectory() || directory.isSymbolicLink() || fs.realpathSync(declared) !== declared) return null;
    if (directory.uid !== process.getuid() || declared === root || declared.startsWith(`${root}${path.sep}`)) return null;
  } catch {
    return null;
  }
  return declared;
}

/**
 * A store file with several links is accepted only when it is the very inode pnpm keeps under its content
 * address (<storeDir>/files/<sha512[0..2]>/<rest>, with "-exec" for executables, also below v<N>/ roots).
 * Any other second link, for example to a user's private file, would otherwise copy that file into the snapshot.
 */
function assertContentAddressed(storeDir, stat, bytes, name) {
  assertContentAddressedByHash(storeDir, stat, createHash('sha512').update(bytes).digest('hex'), name);
}

function assertContentAddressedByHash(storeDir, stat, hex, name) {
  const unverified = () =>
    projectRejection(
      'PROJECT_STORE_HARDLINK_UNVERIFIED',
      'A pnpm store file with several links is not the pnpm content-addressed file',
      name,
    );
  if (!storeDir) throw unverified();
  const bases = [path.join(storeDir, 'files')];
  try {
    for (const entry of fs.readdirSync(storeDir)) if (/^v[0-9]+$/.test(entry)) bases.push(path.join(storeDir, entry, 'files'));
  } catch {
    throw unverified();
  }
  for (const base of bases) {
    for (const suffix of ['', '-exec']) {
      let candidate;
      try {
        candidate = fs.lstatSync(path.join(base, hex.slice(0, 2), hex.slice(2) + suffix));
      } catch {
        continue;
      }
      if (candidate.isFile() && !candidate.isSymbolicLink() && candidate.dev === stat.dev && candidate.ino === stat.ino) return;
    }
  }
  throw unverified();
}

function workspaceSnapshot(contract, root) {
  const identity = fs.lstatSync(root);
  if (!identity.isDirectory() || identity.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw projectRejection('PROJECT_WORKSPACE_UNSAFE', 'Unsafe project workspace');
  }
  let bytes = 0;
  const files = contract.scope.read.map((name) => {
    if (!isProjectPath(name)) throw projectRejection('PROJECT_PATH_INVALID', 'Invalid project path');
    const store = isStorePath(name);
    const target = store ? resolveStoreTarget(root, name) : name;
    if (target === null) return { path: name, content: null, sha256: null };
    const directories = [];
    let fd;
    try {
      directories.push(fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY));
      for (const segment of target.split('/').slice(0, -1)) {
        directories.push(
          fs.openSync(
            `/proc/self/fd/${directories.at(-1)}/${segment}`,
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY,
          ),
        );
      }
      const filename = `/proc/self/fd/${directories.at(-1)}/${target.split('/').at(-1)}`;
      fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const before = fs.fstatSync(fd);
      if (before.size > contract.max_artifact_bytes - bytes)
        throw projectRejection('PROJECT_FILE_TOO_LARGE', 'Project files exceed max_artifact_bytes', name);
      // pnpm hardlinks store files into the shared content store, so a store file may have several links.
      if (!before.isFile() || (!store && before.nlink !== 1)) throw projectRejection('PROJECT_FILE_UNSAFE', 'Unsafe project file', name);
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
        throw projectRejection('PROJECT_CHANGED_DURING_SNAPSHOT', 'Project changed during snapshot');
      bytes += length;
      if (store && before.nlink > 1) assertContentAddressed(pnpmStoreDirectory(root), before, buffer.subarray(0, length), name);
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
      // The contract holds a file whole or not at all: a longer file is refused, never cut.
      if (content.length > PROJECT_LIMITS.file_chars) {
        throw projectRejection('PROJECT_FILE_TOO_LARGE', `Project file exceeds ${PROJECT_LIMITS.file_chars} characters`, name);
      }
      return { path: name, content, sha256: digest(buffer.subarray(0, length)) };
    } catch (error) {
      if (error.code === 'ENOENT') return { path: name, content: null, sha256: null };
      if (error.reason) throw error;
      if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
        throw projectRejection('PROJECT_FILE_NOT_UTF8', 'Project file is not valid UTF-8', name);
      if (FS_REASONS[error.code]) throw projectRejection(...FS_REASONS[error.code], name);
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      for (const directory of directories.toReversed()) fs.closeSync(directory);
    }
  });
  const after = fs.lstatSync(root);
  if (after.ino !== identity.ino || after.dev !== identity.dev || after.isSymbolicLink())
    throw projectRejection('PROJECT_IDENTITY_CHANGED', 'Project identity changed');
  return { files, sha256: digest(canonicalJson(files.map(({ path: name, sha256 }) => ({ path: name, sha256 })))) };
}

function projectWorkspaceSnapshot(contract) {
  const root = contract.workspace.root;
  const gitHead = projectGit(root, ['rev-parse', '--verify', 'HEAD']).trim();
  if (gitHead !== contract.baseline_sha) throw projectRejection('PROJECT_BASELINE_CHANGED', 'Project Git baseline changed');
  return workspaceSnapshot(contract, root);
}

function hydrateProjectTask(contract) {
  const snapshot = projectWorkspaceSnapshot(contract);
  if (snapshot.sha256 !== contract.workspace.files_sha256)
    throw projectRejection('PROJECT_BASELINE_CHANGED', 'Project content baseline changed');
  if (contract.initial_files.length > 0) throw new Error('Project input must be read from its declared workspace');
  return { ...contract, initial_files: snapshot.files.filter((file) => file.content !== null) };
}

module.exports = {
  projectWorkspaceSnapshot,
  hydrateProjectTask,
  resolveStoreTarget,
  pnpmStoreDirectory,
  controllerStoreDirs,
  trustPnpmStores,
};

/** Finish an exact preparation snapshot without following links or overwriting divergent bytes. */
function materializeProjectSnapshot(root, relative, files, emptyDirectories = []) {
  const valid = isProjectPath;
  if (!valid(relative) || Object.keys(files).some((name) => !valid(name)) || emptyDirectories.some((name) => !valid(name)))
    throw new Error('Invalid preparation path');
  if (fs.realpathSync(root) !== root) throw new Error('Unsafe preparation root');
  const opened = new Map();
  const identities = new Map();
  const same = (a, b) => a.ino === b.ino && a.dev === b.dev;
  const directory = (name) => {
    if (opened.has(name)) return opened.get(name);
    const parts = name.split('/');
    const parent = name ? directory(parts.slice(0, -1).join('/')) : null;
    const target = name ? `/proc/self/fd/${parent}/${parts.at(-1)}` : root;
    if (name) {
      try {
        fs.mkdirSync(target, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
    opened.set(name, fd);
    const stat = fs.fstatSync(fd);
    if (stat.uid !== process.getuid()) throw new Error('Preparation directory owner changed');
    identities.set(name, stat);
    return fd;
  };
  const names = Object.keys(files);
  const expectedDirectories = new Set(['', ...emptyDirectories]);
  for (const name of [...names, ...emptyDirectories]) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) expectedDirectories.add(parts.slice(0, i).join('/'));
  }
  const fileIdentities = new Map();
  const validateFile = (name, create) => {
    const bytes = Buffer.from(files[name], 'utf8');
    const parts = name.split('/');
    const parent = directory([relative, ...parts.slice(0, -1)].join('/'));
    const filename = `/proc/self/fd/${parent}/${parts.at(-1)}`;
    let fd;
    try {
      if (create) {
        try {
          fd = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
          fs.writeFileSync(fd, bytes);
          fs.fsyncSync(fd);
          fs.closeSync(fd);
          fd = undefined;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const before = fs.fstatSync(fd);
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.uid !== process.getuid() ||
        before.size !== bytes.length ||
        (fileIdentities.has(name) && !same(fileIdentities.get(name), before))
      )
        throw new Error('Preparation file identity or size changed');
      const actual = Buffer.alloc(bytes.length + 1);
      const count = fs.readSync(fd, actual, 0, actual.length, 0);
      const after = fs.fstatSync(fd),
        linked = fs.lstatSync(filename);
      if (
        count !== bytes.length ||
        !actual.subarray(0, count).equals(bytes) ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        !same(linked, before) ||
        linked.isSymbolicLink()
      )
        throw new Error('Preparation file changed');
      // A previous process may have died after writing but before syncing this file.
      fs.fsyncSync(fd);
      fileIdentities.set(name, before);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };
  try {
    directory(relative);
    for (const name of expectedDirectories) directory(name ? `${relative}/${name}` : relative);
    for (const name of names) validateFile(name, true);
    for (const prefix of expectedDirectories) {
      const fd = directory(prefix ? `${relative}/${prefix}` : relative);
      const expected = [...names, ...expectedDirectories]
        .filter((name) => name && path.posix.dirname(name) === (prefix || '.'))
        .map((name) => path.posix.basename(name))
        .sort();
      const actual = fs.readdirSync(`/proc/self/fd/${fd}`).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Preparation entries changed');
    }
    for (const name of names) validateFile(name, false);
    // Check every anchored directory, including intermediates outside the snapshot.
    for (const [name, fd] of [...opened].toReversed()) {
      const parts = name.split('/');
      const target = name ? `/proc/self/fd/${opened.get(parts.slice(0, -1).join('/'))}/${parts.at(-1)}` : root;
      const linked = fs.lstatSync(target);
      if (!linked.isDirectory() || linked.isSymbolicLink() || !same(linked, identities.get(name)))
        throw new Error('Preparation directory changed');
      fs.fsyncSync(fd);
    }
    if (fs.realpathSync(root) !== root) throw new Error('Preparation root changed');
    return path.join(root, relative);
  } finally {
    for (const fd of [...opened.values()].toReversed()) fs.closeSync(fd);
  }
}
module.exports.materializeProjectSnapshot = materializeProjectSnapshot;

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
    if (!contract.scope.write.includes(file.path))
      throw projectRejection('PROJECT_PATCH_READ_ONLY_PATH', 'Patch would change a read-only path');
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
    throw projectRejection('PROJECT_RESULT_NOT_APPROVED', 'An approved project result is required');
  const candidate = workspaceSnapshot(contract, path.join(evidence.state, 'workspace'));
  if (digest(canonicalJson(candidate.files)) !== evidence.artifacts.files_sha256)
    throw projectRejection('PROJECT_CANDIDATE_CHANGED', 'Project candidate changed after verification');
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
  if (!review.baseline_valid || review.review_sha256 !== expectedReview)
    throw projectRejection('PROJECT_APPROVAL_STALE', 'Project approval is stale');
  const contract = evidence.contract;
  const git = (args, input) => projectGit(contract.workspace.root, args, input);
  // Git's index/worktree preconditions are mandatory. Never force or auto-commit.
  git(['diff', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--', ...contract.scope.read]);
  if (review.patch) {
    git(['apply', '--check', '--index', '--whitespace=nowarn', '-'], review.patch);
    if (projectWorkspaceSnapshot(contract).sha256 !== contract.workspace.files_sha256)
      throw projectRejection('PROJECT_CHANGED_BEFORE_APPLY', 'Project changed before application');
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

/**
 * Names the first violated scope rule of a rejected v2 contract. Only the scope field and a fixed message are
 * returned; the offending path is never echoed because it is caller-controlled text.
 */
function diagnoseScope(value) {
  const scope = value?.scope;
  if (!scope || typeof scope !== 'object') return null;
  for (const list of ['read', 'write']) {
    const paths = scope[list];
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > PROJECT_LIMITS.total_paths)
      return projectRejection(
        'PROJECT_SCOPE_INVALID',
        `scope.${list} must list 1 to ${PROJECT_LIMITS.total_paths} paths (${PROJECT_LIMITS.ordinary_paths} outside node_modules/.pnpm)`,
        undefined,
        `scope.${list}`,
      );
    const bad = paths.findIndex((entry) => !isProjectPath(entry));
    if (bad === -1 && paths.filter((entry) => !isStorePath(entry)).length > PROJECT_LIMITS.ordinary_paths)
      return projectRejection(
        'PROJECT_SCOPE_INVALID',
        `scope.${list} may list at most ${PROJECT_LIMITS.ordinary_paths} paths outside node_modules/.pnpm`,
        undefined,
        `scope.${list}`,
      );
    if (bad !== -1)
      return projectRejection(
        'PROJECT_PATH_INVALID',
        'Path must be relative, without ".." or hidden segments',
        undefined,
        `scope.${list}[${bad}]`,
      );
    if (new Set(paths).size !== paths.length)
      return projectRejection('PROJECT_SCOPE_INVALID', `scope.${list} must not repeat a path`, undefined, `scope.${list}`);
  }
  const all = [...new Set([...scope.read, ...scope.write])];
  if (all.some((entry) => all.some((other) => other.startsWith(`${entry}/`))))
    return projectRejection(
      'PROJECT_SCOPE_CONFLICT',
      'A scope path is a file and also the parent directory of another path',
      undefined,
      'scope',
    );
  if (scope.write.some((entry) => !scope.read.includes(entry)))
    return projectRejection('PROJECT_SCOPE_INVALID', 'Every scope.write path must also be listed in scope.read', undefined, 'scope.write');
  return null;
}

function prepareProjectTask(value) {
  try {
    return prepareProjectTaskUnchecked(value);
  } catch (error) {
    if (error.code === 'ENGINEERING_TASK_CONTRACT_INVALID') {
      const diagnosis = diagnoseScope(value);
      if (diagnosis) throw diagnosis;
    }
    throw error;
  }
}

function prepareProjectTaskUnchecked(value) {
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

const STORE_MOUNT_BUDGET = Object.freeze({ entries: 300_000, hashed_bytes: 2_147_483_648 });
const STORE_MOUNT_TARGET = '/opt/hseos/pnpm-store';
const STORE_LINK_BUDGET = 4096;

function hashedBytes(filename, size) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const hash = createHash('sha512');
    const buffer = Buffer.alloc(1_048_576);
    let total = 0;
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      total += length;
      if (total > size) break;
      hash.update(buffer.subarray(0, length));
    }
    return { total, hex: hash.digest('hex') };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * A cheap, content-free fingerprint of the mounted store: every entry as (path, dev, ino, size, mtime_ns, nlink,
 * type), sorted and hashed. It is pinned when the store is verified and recomputed before each launch, so an entry
 * added or relinked after the verification (a late hardlink, for example) is noticed without rereading any file.
 */
function summarizePnpmStore(root) {
  const store = path.join(root, 'node_modules', '.pnpm');
  const tuples = [];
  const pending = [store];
  const record = (filename, kind) => {
    const stat = fs.lstatSync(filename, { bigint: true });
    tuples.push(
      `${path.relative(store, filename)}\0${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.nlink}:${kind}`,
    );
  };
  record(store, 'd');
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw storeFailure(error);
    }
    // The budget is checked before any entry is touched, so an oversized directory is refused without walking it.
    if (tuples.length + entries.length > STORE_MOUNT_BUDGET.entries) {
      throw projectRejection('PROJECT_STORE_TOO_LARGE', 'The pnpm store exceeds the mount entry budget');
    }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(filename);
        record(filename, 'd');
      } else {
        record(filename, entry.isSymbolicLink() ? 'l' : entry.isFile() ? 'f' : 'o');
      }
    }
  }
  tuples.sort();
  return Object.freeze({ sha256: createHash('sha256').update(tuples.join('\n')).digest('hex'), entries: tuples.length });
}

const STORE_PINS = new WeakMap();

/** Remember what the controller verified for one isolation policy. */
function pinStoreMount(policy, root, mount) {
  STORE_PINS.set(policy, { root, summary: mount.summary });
}

/**
 * Called before every launch of a contract with a store mount. A policy that was never pinned is verified in full;
 * a pinned one only recomputes the fingerprint and refuses when it differs.
 */
function assertStoreMountUnchanged(policy, contract) {
  if (contract.schema_version !== 2 || !contract.workspace.store_mount) return;
  const root = contract.workspace.root;
  const pin = STORE_PINS.get(policy);
  if (!pin || pin.root !== root) {
    pinStoreMount(policy, root, verifyPnpmStoreMount(root));
    return;
  }
  if (summarizePnpmStore(root).sha256 !== pin.summary.sha256) {
    throw projectRejection('PROJECT_STORE_DRIFT', 'The pnpm store changed after it was verified');
  }
}

/**
 * Verify the project's own node_modules/.pnpm before the controller mounts it read-only into the sandbox.
 * The path is real and unlinked from the project root down; every symlink stays inside the store; every file with
 * several links is the pnpm content-addressed inode; nothing but directories, regular files and links exists.
 * Both budgets are finite: a larger store is refused, never sampled.
 */
function verifyPnpmStoreMount(root) {
  const fail = (reason, message) => projectRejection(reason, message);
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || fs.realpathSync(root) !== root) throw new Error('unsafe');
  } catch {
    throw fail('PROJECT_WORKSPACE_UNSAFE', 'Unsafe project workspace');
  }
  const store = path.join(root, 'node_modules', '.pnpm');
  try {
    for (const directory of [path.join(root, 'node_modules'), store]) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe');
    }
    if (fs.realpathSync(store) !== store) throw new Error('unsafe');
  } catch {
    throw fail('PROJECT_STORE_MOUNT_UNSAFE', 'The pnpm store is missing or is not a real directory inside the project');
  }
  const storeDir = pnpmStoreDirectory(root);
  const summary = summarizePnpmStore(root);
  // Workspace packages are linked into the store from the monorepo (../../packages/x). Such a link may point anywhere
  // inside the project root; in the sandbox it dangles, because only the store is mounted. Outside the root it is refused.
  const within = (target) => target === root || target.startsWith(`${root}${path.sep}`);
  const counts = { entries: 0, symlinks: 0, hardlinks: 0, hashed_bytes: 0 };
  const pending = [store];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw storeFailure(error);
    }
    for (const entry of entries) {
      if ((counts.entries += 1) > STORE_MOUNT_BUDGET.entries)
        throw fail('PROJECT_STORE_TOO_LARGE', 'The pnpm store exceeds the mount entry budget');
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(filename);
      } else if (entry.isSymbolicLink()) {
        counts.symlinks += 1;
        const target = fs.readlinkSync(filename);
        if (path.isAbsolute(target) || !within(path.resolve(directory, target))) {
          throw fail('PROJECT_STORE_LINK_ESCAPES', 'A pnpm store link resolves outside the verified store');
        }
      } else if (entry.isFile()) {
        const stat = fs.lstatSync(filename);
        if (stat.nlink > 1) {
          counts.hardlinks += 1;
          const { total, hex } = hashedBytes(filename, stat.size);
          counts.hashed_bytes += total;
          if (total !== stat.size || counts.hashed_bytes > STORE_MOUNT_BUDGET.hashed_bytes) {
            throw fail('PROJECT_STORE_TOO_LARGE', 'The pnpm store exceeds the mount hashing budget');
          }
          assertContentAddressedByHash(storeDir, stat, hex, path.relative(root, filename));
        }
      } else {
        throw fail('PROJECT_FILE_UNSAFE', 'Unsafe project file');
      }
    }
  }
  // The store must not move while it is being verified.
  if (summarizePnpmStore(root).sha256 !== summary.sha256)
    throw fail('PROJECT_STORE_DRIFT', 'The pnpm store changed while it was being verified');
  return Object.freeze({ source: store, target: STORE_MOUNT_TARGET, ...counts, summary });
}

/**
 * Recreate, inside the task workspace, the links a pnpm project resolves through: node_modules/.pnpm becomes the
 * read-only mount target and the top-level package links keep pointing into it. Only relative links that resolve
 * into the store are copied.
 */
function materializeStoreLinks(root, workspace) {
  const modules = path.join(workspace, 'node_modules');
  fs.mkdirSync(modules, { recursive: true, mode: 0o700 });
  fs.symlinkSync(STORE_MOUNT_TARGET, path.join(modules, '.pnpm'));
  const source = path.join(root, 'node_modules');
  let copied = 0;
  const copy = (relative) => {
    const from = path.join(source, relative);
    const target = fs.readlinkSync(from);
    const resolved = path.resolve(path.dirname(from), target);
    if (path.isAbsolute(target) || !resolved.startsWith(`${path.join(source, '.pnpm')}${path.sep}`)) return;
    if ((copied += 1) > STORE_LINK_BUDGET) throw projectRejection('PROJECT_STORE_TOO_LARGE', 'Too many top-level package links');
    fs.mkdirSync(path.dirname(path.join(modules, relative)), { recursive: true, mode: 0o700 });
    fs.symlinkSync(target, path.join(modules, relative));
  };
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) copy(entry.name);
    else if (entry.isDirectory() && entry.name.startsWith('@')) {
      for (const inner of fs.readdirSync(path.join(source, entry.name), { withFileTypes: true })) {
        if (inner.isSymbolicLink() && !inner.name.startsWith('.')) copy(path.join(entry.name, inner.name));
      }
    }
  }
  return copied;
}

module.exports.verifyPnpmStoreMount = verifyPnpmStoreMount;
module.exports.summarizePnpmStore = summarizePnpmStore;
module.exports.pinStoreMount = pinStoreMount;
module.exports.assertStoreMountUnchanged = assertStoreMountUnchanged;
module.exports.materializeStoreLinks = materializeStoreLinks;
module.exports.STORE_MOUNT_TARGET = STORE_MOUNT_TARGET;
module.exports.STORE_MOUNT_BUDGET = STORE_MOUNT_BUDGET;
