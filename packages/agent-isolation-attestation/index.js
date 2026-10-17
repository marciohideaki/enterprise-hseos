'use strict';

const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { deepFreeze } = require('../agent-runtime-contracts');
const {
  BROKER_SANDBOX_PATH,
  brokerBinding,
  registerLaunch,
  resolveCallLimits,
  resolveProfile,
  seccompNetworklessProgram,
  seccompProgramFor,
} = require('./profiles');

const REQUIRED_ACTORS = Object.freeze(['root', 'child_agent', 'workflow_worker', 'tool_provider', 'hosted_runtime']);
const POLICIES = new WeakSet();
const MAX_OUTPUT_BYTES = 65_536;
const SCRIPT = String.raw`
set -u
set -C
printf 'HSEOS_ATTESTATION_V1\n'
printf 'ACTOR=%s\n' "$HSEOS_ACTOR_TYPE"
printf 'CHALLENGE=%s\n' "$HSEOS_CHALLENGE"
printf 'PID=%s\n' "$$"
printf 'PPID=%s\n' "$PPID"
printf 'CWD=%s\n' "$(pwd -P)"
if test -e "$1" || test -r "$1"; then printf 'PROTECTED=reachable\n'; else printf 'PROTECTED=denied\n'; fi
if printf '%s' "$HSEOS_CHALLENGE" > ".hseos-isolation-$HSEOS_ACTOR_TYPE-$HSEOS_CHALLENGE"; then printf 'WRITE=allowed\n'; else printf 'WRITE=denied\n'; fi
if : > /dev/tcp/1.1.1.1/443 2>/dev/null; then printf 'NETWORK=reachable\n'; else printf 'NETWORK=denied\n'; fi
if /usr/bin/python3 -c 'import ctypes,errno,sys; libc=ctypes.CDLL(None,use_errno=True); result=libc.syscall(41,1,1,0); sys.exit(0 if result == -1 and ctypes.get_errno() == errno.EPERM else 1)'; then printf 'SOCKET_SYSCALL=denied\n'; else printf 'SOCKET_SYSCALL=reachable\n'; fi
if /usr/bin/python3 -c 'import ctypes,errno,sys; libc=ctypes.CDLL(None,use_errno=True); result=libc.syscall(425,1,0); sys.exit(0 if result == -1 and ctypes.get_errno() == errno.EPERM else 1)'; then printf 'IO_URING=denied\n'; else printf 'IO_URING=reachable\n'; fi
/usr/bin/python3 -c 'import ctypes; ctypes.CDLL(None).syscall(0x40000029,1,1,0)' >/dev/null 2>&1
x32_status=$?
if test "$x32_status" -eq 159; then printf 'X32_ABI=killed\n'; else printf 'X32_ABI=not_filtered\n'; fi
printf 'ENVIRONMENT='
/usr/bin/env | /usr/bin/cut -d= -f1 | /usr/bin/sort | /usr/bin/tr '\n' ','
printf '\n'
`;

class AgentIsolationAttestationError extends Error {
  constructor(message, code = 'AGENT_ISOLATION_ATTESTATION_INVALID', details = {}) {
    super(message);
    this.name = 'AgentIsolationAttestationError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AgentIsolationAttestationError(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new AgentIsolationAttestationError(`${label} has non-canonical fields`);
  }
}

function realDirectory(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new AgentIsolationAttestationError(`${label} must be absolute`);
  let stat;
  try {
    stat = fs.lstatSync(value);
  } catch {
    throw new AgentIsolationAttestationError(`${label} is unavailable`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AgentIsolationAttestationError(`${label} must be a real directory`);
  return { path: fs.realpathSync(value), dev: stat.dev, ino: stat.ino };
}

function executable(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new AgentIsolationAttestationError('bwrap binary must be absolute');
  let stat;
  try {
    stat = fs.lstatSync(value);
  } catch {
    throw new AgentIsolationAttestationError('bwrap binary is unavailable', 'AGENT_ISOLATION_BACKEND_UNAVAILABLE');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) {
    throw new AgentIsolationAttestationError('bwrap binary must be a real executable', 'AGENT_ISOLATION_BACKEND_UNAVAILABLE');
  }
  return { path: fs.realpathSync(value), dev: stat.dev, ino: stat.ino, size: stat.size, mtime_ms: stat.mtimeMs };
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertWorkspaceTypes(workspace) {
  const pending = [workspace];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if ((visited += 1) > 100_000) throw new AgentIsolationAttestationError('workspace type scan exceeds its bound');
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSocket() || stat.isFIFO() || stat.isBlockDevice() || stat.isCharacterDevice()) {
        throw new AgentIsolationAttestationError(
          'workspace contains an undeclared IPC or device node',
          'AGENT_ISOLATION_WORKSPACE_AUTHORITY',
        );
      }
      if (stat.isDirectory() && !stat.isSymbolicLink()) pending.push(candidate);
    }
  }
  const mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  for (const line of mountInfo.split('\n')) {
    const fields = line.split(' ');
    const mountPoint = fields[4]
      ?.replaceAll(String.raw`\040`, ' ')
      .replaceAll(String.raw`\011`, '\t')
      .replaceAll(String.raw`\012`, '\n')
      .replaceAll(String.raw`\134`, '\\');
    if (mountPoint && within(workspace, mountPoint)) {
      throw new AgentIsolationAttestationError('workspace contains a nested mount', 'AGENT_ISOLATION_WORKSPACE_AUTHORITY');
    }
  }
}

function createIsolationPolicy(value) {
  const optional = ['profile', 'broker_socket', 'toolchain_roots'].filter(
    (key) => value && typeof value === 'object' && Object.hasOwn(value, key),
  );
  exactKeys(value, ['backend', 'host_workspace', 'main_checkout', 'protected_paths', ...optional], 'isolation policy');
  // P0 is the default only when the controller names nothing; any other name must be known.
  const profile = resolveProfile(optional.includes('profile') ? value.profile : 'P0');
  if (optional.includes('broker_socket') !== profile.broker) {
    throw new AgentIsolationAttestationError('broker socket is required by P2 and forbidden elsewhere', 'AGENT_ISOLATION_PROFILE_INVALID');
  }
  if (value.backend !== 'bwrap') throw new AgentIsolationAttestationError('only the bwrap conformance backend is supported');
  const workspace = realDirectory(value.host_workspace, 'host_workspace');
  const main = realDirectory(value.main_checkout, 'main_checkout');
  if (!within(main.path, workspace.path))
    throw new AgentIsolationAttestationError('workspace must be an isolated descendant of main_checkout');
  if (
    ['/usr', '/bin', '/lib', '/lib64'].some(
      (root) => main.path === root || within(root, main.path) || within(main.path, fs.realpathSync(root)),
    )
  ) {
    throw new AgentIsolationAttestationError('main_checkout cannot overlap a sandbox system mount');
  }
  if (!Array.isArray(value.protected_paths) || value.protected_paths.length === 0 || value.protected_paths.length > 64) {
    throw new AgentIsolationAttestationError('protected_paths must be a non-empty bounded array');
  }
  const protectedBindings = value.protected_paths.map((entry) => {
    if (typeof entry !== 'string' || !path.isAbsolute(entry)) throw new AgentIsolationAttestationError('protected path must be absolute');
    const normalized = path.normalize(entry);
    if (!within(main.path, normalized) || normalized === workspace.path || within(workspace.path, normalized)) {
      throw new AgentIsolationAttestationError('protected paths must remain in main_checkout and outside the worktree');
    }
    let stat;
    try {
      stat = fs.lstatSync(normalized);
    } catch {
      throw new AgentIsolationAttestationError('protected path must exist before attestation');
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new AgentIsolationAttestationError('protected path must be a single-link regular file');
    }
    return {
      path: normalized,
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      nlink: stat.nlink,
      size: stat.size,
      mtime_ms: stat.mtimeMs,
      ctime_ms: stat.ctimeMs,
    };
  });
  if (new Set(protectedBindings.map((bindingValue) => bindingValue.path)).size !== protectedBindings.length) {
    throw new AgentIsolationAttestationError('protected paths must be unique');
  }
  const binding = executable('/usr/bin/bwrap');
  const unsigned = {
    schema_version: 1,
    backend: 'bwrap',
    backend_binding: binding,
    host_workspace: workspace.path,
    host_workspace_binding: { dev: workspace.dev, ino: workspace.ino },
    main_checkout: main.path,
    protected_paths: protectedBindings,
    sandbox_workspace: '/workspace',
    filesystem: { workspace: 'read_write', system: 'read_only', host_checkout: 'absent' },
    network: { mode: 'none', namespace: 'isolated' },
    environment: { inherited: false, allowed_names: ['HSEOS_ACTOR_TYPE', 'HSEOS_CHALLENGE', 'PATH', 'PWD', 'SHLVL', '_'] },
  };
  // P0 keeps its historical shape and digest. Wider profiles are explicit and digest-bound.
  // Controller allowlist of pinned toolchain roots. Without it no read-only mount is ever accepted.
  if (optional.includes('toolchain_roots')) {
    if (!Array.isArray(value.toolchain_roots) || value.toolchain_roots.length === 0 || value.toolchain_roots.length > 8) {
      throw new AgentIsolationAttestationError('toolchain_roots must be a non-empty bounded array');
    }
    unsigned.toolchain_roots = value.toolchain_roots.map((root) => realDirectory(root, 'toolchain root').path).sort();
  }
  if (profile.id !== 'P0') {
    unsigned.profile = profile.id;
    unsigned.network = { mode: profile.network, namespace: 'isolated' };
    if (profile.broker) unsigned.broker_binding = brokerBinding(value.broker_socket, workspace.path);
  }
  const policy = deepFreeze({ ...unsigned, policy_digest: createHash('sha256').update(stableJson(unsigned)).digest('hex') });
  POLICIES.add(policy);
  return policy;
}

function parseOutput(output, expectedActor, challenge) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
    throw new AgentIsolationAttestationError('sandbox attestation output is invalid');
  }
  const lines = output.trimEnd().split('\n');
  if (lines.shift() !== 'HSEOS_ATTESTATION_V1') throw new AgentIsolationAttestationError('sandbox attestation version is invalid');
  const values = {};
  for (const line of lines) {
    const index = line.indexOf('=');
    if (index < 1) throw new AgentIsolationAttestationError('sandbox attestation line is malformed');
    const key = line.slice(0, index);
    if (Object.hasOwn(values, key)) throw new AgentIsolationAttestationError('sandbox attestation field is duplicated');
    values[key] = line.slice(index + 1);
  }
  const required = [
    'ACTOR',
    'CHALLENGE',
    'PID',
    'PPID',
    'CWD',
    'PROTECTED',
    'WRITE',
    'NETWORK',
    'SOCKET_SYSCALL',
    'IO_URING',
    'X32_ABI',
    'ENVIRONMENT',
  ];
  if (Object.keys(values).length !== required.length || required.some((key) => !Object.hasOwn(values, key))) {
    throw new AgentIsolationAttestationError('sandbox attestation fields are incomplete');
  }
  if (values.ACTOR !== expectedActor || values.CHALLENGE !== challenge) {
    throw new AgentIsolationAttestationError('sandbox attestation challenge or actor is invalid');
  }
  if (values.PID !== '2' || values.PPID !== '1' || values.CWD !== '/workspace') {
    throw new AgentIsolationAttestationError('sandbox process lineage or workspace is invalid');
  }
  if (
    values.PROTECTED !== 'denied' ||
    values.WRITE !== 'allowed' ||
    values.NETWORK !== 'denied' ||
    values.SOCKET_SYSCALL !== 'denied' ||
    values.IO_URING !== 'denied' ||
    values.X32_ABI !== 'killed'
  ) {
    throw new AgentIsolationAttestationError('sandbox probes did not prove the required boundary', 'AGENT_ISOLATION_PROBE_FAILED', {
      protected: values.PROTECTED,
      write: values.WRITE,
      network: values.NETWORK,
      socket_syscall: values.SOCKET_SYSCALL,
      io_uring: values.IO_URING,
      x32_abi: values.X32_ABI,
    });
  }
  const environment = values.ENVIRONMENT.split(',').filter(Boolean);
  const expectedEnvironment = ['HSEOS_ACTOR_TYPE', 'HSEOS_CHALLENGE', 'PATH', 'PWD', 'SHLVL', '_'];
  if (stableJson(environment.sort()) !== stableJson(expectedEnvironment.sort())) {
    throw new AgentIsolationAttestationError('sandbox environment contains undeclared authority', 'AGENT_ISOLATION_CREDENTIAL_EXPOSURE');
  }
  return { sandbox_pid: 2, sandbox_parent_pid: 1, cwd: '/workspace' };
}

function assertBinding(policy) {
  const binary = executable(policy.backend_binding.path);
  const workspace = realDirectory(policy.host_workspace, 'host_workspace');
  if (
    binary.dev !== policy.backend_binding.dev ||
    binary.ino !== policy.backend_binding.ino ||
    binary.size !== policy.backend_binding.size ||
    binary.mtime_ms !== policy.backend_binding.mtime_ms ||
    workspace.dev !== policy.host_workspace_binding.dev ||
    workspace.ino !== policy.host_workspace_binding.ino
  ) {
    throw new AgentIsolationAttestationError('sandbox binding drifted before execution', 'AGENT_ISOLATION_BINDING_DRIFT');
  }
  for (const protectedBinding of policy.protected_paths) {
    let stat;
    try {
      stat = fs.lstatSync(protectedBinding.path);
    } catch {
      throw new AgentIsolationAttestationError('protected path drifted before execution', 'AGENT_ISOLATION_BINDING_DRIFT');
    }
    if (
      stat.isSymbolicLink() ||
      stat.dev !== protectedBinding.dev ||
      stat.ino !== protectedBinding.ino ||
      stat.mode !== protectedBinding.mode ||
      stat.nlink !== protectedBinding.nlink ||
      stat.size !== protectedBinding.size ||
      stat.mtimeMs !== protectedBinding.mtime_ms ||
      stat.ctimeMs !== protectedBinding.ctime_ms
    ) {
      throw new AgentIsolationAttestationError('protected path drifted before execution', 'AGENT_ISOLATION_BINDING_DRIFT');
    }
  }
  if (policy.broker_binding) {
    let stat;
    try {
      stat = fs.lstatSync(policy.broker_binding.path);
    } catch {
      throw new AgentIsolationAttestationError('broker socket drifted before execution', 'AGENT_ISOLATION_BINDING_DRIFT');
    }
    if (!stat.isSocket() || stat.isSymbolicLink() || stat.dev !== policy.broker_binding.dev || stat.ino !== policy.broker_binding.ino) {
      throw new AgentIsolationAttestationError('broker socket drifted before execution', 'AGENT_ISOLATION_BINDING_DRIFT');
    }
  }
  assertWorkspaceTypes(policy.host_workspace);
}

function profileArguments(policy, extras) {
  const args = [];
  if (extras.shm_bytes !== undefined) args.push('--size', String(extras.shm_bytes), '--tmpfs', '/dev/shm');
  if (extras.artifacts_directory !== undefined) args.push('--bind', extras.artifacts_directory, '/artifacts');
  for (const mount of extras.readonly_mounts ?? []) args.push('--ro-bind', mount.source, mount.target);
  if (policy.broker_binding) args.push('--bind', policy.broker_binding.path, BROKER_SANDBOX_PATH);
  return args;
}

function sandboxArguments(policy, environment, command, readonlyWorkspace = false, hostNode = false, extras = {}) {
  return [
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--seccomp',
    '3',
    ...['/usr', '/bin', '/lib', '/lib64'].flatMap((root) => ['--ro-bind', root, root]),
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    ...profileArguments(policy, extras),
    ...(hostNode ? ['--ro-bind', '/proc/self/fd/4', '/hseos-runtime/node'] : []),
    readonlyWorkspace ? '--ro-bind' : '--bind',
    policy.host_workspace,
    '/workspace',
    '--chdir',
    '/workspace',
    '--clearenv',
    '--setenv',
    'PATH',
    '/usr/bin:/bin',
    ...Object.entries(environment).flatMap(([key, value]) => ['--setenv', key, value]),
    ...command,
  ];
}

// This boundary accepts only nominal supervisor-created policies, never model mounts.
function prepareIsolatedExecution(policy, command, hostNode = false, terminal = false, extras = {}) {
  if (!POLICIES.has(policy)) throw new AgentIsolationAttestationError('isolation policy is not supervisor-owned');
  assertBinding(policy);
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string' || part.includes('\0'))) {
    throw new AgentIsolationAttestationError('invalid execution command');
  }
  if (typeof terminal !== 'boolean' || typeof hostNode !== 'boolean' || (hostNode && command[0] !== '/usr/bin/node'))
    throw new AgentIsolationAttestationError('invalid host runtime selection');
  const profile = resolveProfile(policy.profile ?? 'P0');
  const mounts = launchExtras(policy, extras);
  let executable = hostNode ? ['/hseos-runtime/node', ...command.slice(1)] : command;
  if (terminal)
    executable = [
      '/usr/bin/python3',
      '-I',
      '-c',
      'import os,sys,fcntl,termios\nif os.getsid(0) != os.getpid(): os.setsid()\nfcntl.ioctl(0,termios.TIOCSCTTY,0)\nos.execve(sys.argv[1],sys.argv[1:],dict(os.environ))',
      ...executable,
    ];
  return registerLaunch(
    Object.freeze({
      binary: policy.backend_binding.path,
      args: Object.freeze(sandboxArguments(policy, {}, executable, true, hostNode, mounts)),
      seccomp: seccompProgramFor(profile),
      policy_digest: policy.policy_digest,
      profile: profile.id,
    }),
  );
}

const MOUNT_TARGET = /^\/opt\/hseos\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

/** Toolchain pins mounted read-only under /opt/hseos/. The source is a real path, never a link. */
function readonlyMounts(policy, mounts) {
  if (!Array.isArray(mounts) || mounts.length > 8) throw new AgentIsolationAttestationError('readonly mounts must be a bounded list');
  const targets = new Set();
  return mounts.map((mount) => {
    exactKeys(mount, ['source', 'target'], 'readonly mount');
    if (typeof mount.target !== 'string' || !MOUNT_TARGET.test(mount.target) || mount.target.includes('..') || targets.has(mount.target)) {
      throw new AgentIsolationAttestationError('readonly mount target must be a distinct path under /opt/hseos');
    }
    targets.add(mount.target);
    if (typeof mount.source !== 'string' || !path.isAbsolute(mount.source) || mount.source.includes('\0')) {
      throw new AgentIsolationAttestationError('readonly mount source must be absolute');
    }
    let stat;
    try {
      stat = fs.lstatSync(mount.source);
    } catch {
      throw new AgentIsolationAttestationError('readonly mount source is unavailable');
    }
    if (
      stat.isSymbolicLink() ||
      (!stat.isDirectory() && !stat.isFile()) ||
      fs.realpathSync(mount.source) !== path.normalize(mount.source)
    ) {
      throw new AgentIsolationAttestationError('readonly mount source must be a real file or directory');
    }
    const source = fs.realpathSync(mount.source);
    for (const protectedRoot of [policy.host_workspace, policy.main_checkout]) {
      if (source === protectedRoot || within(protectedRoot, source) || within(source, protectedRoot)) {
        throw new AgentIsolationAttestationError('readonly mount cannot overlap the workspace or main checkout');
      }
    }
    if (!(policy.toolchain_roots ?? []).some((allowed) => source === allowed || within(allowed, source))) {
      throw new AgentIsolationAttestationError('readonly mount source is outside the controller allowlist');
    }
    return Object.freeze({ source, target: mount.target });
  });
}

/** Validate controller-only launch additions: /dev/shm size and the verified artifact directory. */
function launchExtras(policy, extras) {
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new AgentIsolationAttestationError('invalid launch extras');
  for (const key of Object.keys(extras)) {
    if (!['shm_bytes', 'memory_max_bytes', 'artifacts_directory', 'readonly_mounts'].includes(key))
      throw new AgentIsolationAttestationError('launch extra is not recognised');
  }
  const result = {};
  if (extras.shm_bytes !== undefined) {
    result.shm_bytes = resolveCallLimits({ shm_bytes: extras.shm_bytes, memory_max_bytes: extras.memory_max_bytes }).shm_bytes;
  }
  if (extras.artifacts_directory !== undefined) {
    const directory = realDirectory(extras.artifacts_directory, 'artifacts_directory');
    if (
      directory.path === policy.host_workspace ||
      within(policy.host_workspace, directory.path) ||
      within(directory.path, policy.host_workspace)
    ) {
      throw new AgentIsolationAttestationError('artifacts directory cannot overlap the workspace');
    }
    result.artifacts_directory = directory.path;
  }
  if (extras.readonly_mounts !== undefined) result.readonly_mounts = readonlyMounts(policy, extras.readonly_mounts);
  return result;
}

function runTransitiveIsolationJourney(policy) {
  if (!POLICIES.has(policy)) throw new AgentIsolationAttestationError('isolation policy is not supervisor-owned');
  assertBinding(policy);
  const challenge = randomBytes(32).toString('hex');
  const witnesses = [];
  const launcherPids = new Set();
  const seccompDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hseos-isolation-seccomp-'));
  const seccompPath = path.join(seccompDirectory, 'networkless.bpf');
  const seccompProgram = seccompNetworklessProgram();
  const seccompDigest = createHash('sha256').update(seccompProgram).digest('hex');
  const ownerFd = fs.openSync(
    seccompPath,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW,
    0o600,
  );
  fs.writeSync(ownerFd, seccompProgram, 0, seccompProgram.length, 0);
  fs.fsyncSync(ownerFd);
  fs.fchmodSync(ownerFd, 0o400);
  fs.unlinkSync(seccompPath);
  try {
    for (const [index, actor] of REQUIRED_ACTORS.entries()) {
      assertBinding(policy);
      const protectedPath = policy.protected_paths[index % policy.protected_paths.length].path;
      const args = sandboxArguments(
        policy,
        {
          HSEOS_ACTOR_TYPE: actor,
          HSEOS_CHALLENGE: challenge,
        },
        ['/bin/bash', '-c', SCRIPT, actor, protectedPath],
      );
      const anonymousPath = `/proc/self/fd/${ownerFd}`;
      const verifyFd = fs.openSync(anonymousPath, 'r');
      const observedProgram = Buffer.alloc(seccompProgram.length);
      const observedBytes = fs.readSync(verifyFd, observedProgram, 0, observedProgram.length, 0);
      fs.closeSync(verifyFd);
      if (observedBytes !== seccompProgram.length || createHash('sha256').update(observedProgram).digest('hex') !== seccompDigest) {
        throw new AgentIsolationAttestationError('anonymous seccomp program drifted', 'AGENT_ISOLATION_BINDING_DRIFT');
      }
      const seccompFd = fs.openSync(anonymousPath, 'r');
      let result;
      try {
        result = spawnSync(policy.backend_binding.path, args, {
          cwd: policy.host_workspace,
          env: {},
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: MAX_OUTPUT_BYTES,
          stdio: ['ignore', 'pipe', 'pipe', seccompFd],
        });
      } finally {
        fs.closeSync(seccompFd);
      }
      if (result.error || result.status !== 0 || !Number.isSafeInteger(result.pid) || launcherPids.has(result.pid)) {
        throw new AgentIsolationAttestationError('sandbox actor failed or reused launcher identity', 'AGENT_ISOLATION_PROBE_FAILED', {
          actor,
          status: result.status,
        });
      }
      launcherPids.add(result.pid);
      const parsed = parseOutput(result.stdout, actor, challenge);
      const writePath = path.join(policy.host_workspace, `.hseos-isolation-${actor}-${challenge}`);
      const writeStat = fs.lstatSync(writePath);
      if (!writeStat.isFile() || writeStat.isSymbolicLink() || writeStat.nlink !== 1 || fs.readFileSync(writePath, 'utf8') !== challenge) {
        throw new AgentIsolationAttestationError('sandbox write probe did not bind to the host worktree');
      }
      fs.unlinkSync(writePath);
      witnesses.push({ actor_type: actor, actor_id: `${actor}:${result.pid}:${challenge}`, launcher_pid: result.pid, ...parsed });
    }
  } finally {
    fs.closeSync(ownerFd);
    try {
      fs.rmdirSync(seccompDirectory);
    } catch {
      // A failed probe remains fail-closed even if temporary cleanup is incomplete.
    }
  }
  return deepFreeze({
    isolated: true,
    policy_digest: policy.policy_digest,
    challenge_digest: createHash('sha256').update(challenge).digest('hex'),
    witnesses,
  });
}

module.exports = {
  AgentIsolationAttestationError,
  REQUIRED_ACTORS,
  createIsolationPolicy,
  runTransitiveIsolationJourney,
  prepareIsolatedExecution,
};
