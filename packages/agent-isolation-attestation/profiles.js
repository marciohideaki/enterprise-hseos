'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deepFreeze } = require('../agent-runtime-contracts');

// Profiles are a closed table chosen by the controller. A plugin only references a name.
const PROFILES = deepFreeze({
  P0: { id: 'P0', rank: 0, network: 'none', seccomp: 'networkless', broker: false },
  P1: { id: 'P1', rank: 1, network: 'loopback', seccomp: 'network-arguments', broker: false },
  P2: { id: 'P2', rank: 2, network: 'loopback+broker', seccomp: 'network-arguments', broker: true },
});
const BROKER_SANDBOX_PATH = '/run/broker.sock';
const LIMIT_FLOOR = Object.freeze({ pids_max: 32, memory_max_bytes: 268_435_456, nofile: 64 });
const LIMIT_CEILING = Object.freeze({ pids_max: 256, memory_max_bytes: 2_147_483_648, shm_bytes: 536_870_912, nofile: 4096 });

const NETWORK_SYSCALLS_X64 = Object.freeze([41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 53, 288, 299, 307, 425, 426, 427]);

const AF_UNIX = 1;
const AF_INET = 2;
const AF_INET6 = 10;
const IPPROTO_TCP = 6;
const IPPROTO_UDP = 17;
const SOCK_STREAM = 1;
const SOCK_DGRAM = 2;
const SOCK_SEQPACKET = 5;
const EPERM_RETURN = 0x00_05_00_01;
const NR_SOCKET = 41;
const NR_SOCKETPAIR = 53;
const IO_URING_X64 = Object.freeze([425, 426, 427]);

class IsolationProfileError extends Error {
  constructor(message, code = 'AGENT_ISOLATION_PROFILE_INVALID', details = {}) {
    super(message);
    this.name = 'IsolationProfileError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

/** Unknown names fail closed. There is no default and no fallback to another profile. */
function resolveProfile(name) {
  if (typeof name !== 'string' || !Object.hasOwn(PROFILES, name)) {
    throw new IsolationProfileError('isolation profile is unknown', 'AGENT_ISOLATION_PROFILE_UNKNOWN');
  }
  return PROFILES[name];
}

function profileRank(name) {
  return resolveProfile(name).rank;
}

/** Validate per-call resource limits. Ceilings are never raised by the caller. */
function resolveCallLimits(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IsolationProfileError('call limits must be an object');
  for (const key of Object.keys(value)) {
    if (!['pids_max', 'memory_max_bytes', 'shm_bytes', 'nofile'].includes(key))
      throw new IsolationProfileError('call limit is not recognised');
  }
  const limits = {
    pids_max: value.pids_max ?? LIMIT_FLOOR.pids_max,
    memory_max_bytes: value.memory_max_bytes ?? LIMIT_FLOOR.memory_max_bytes,
  };
  if (!Number.isSafeInteger(limits.pids_max) || limits.pids_max < LIMIT_FLOOR.pids_max || limits.pids_max > LIMIT_CEILING.pids_max) {
    throw new IsolationProfileError('pids_max is outside 32-256', 'AGENT_ISOLATION_LIMIT_INVALID');
  }
  if (
    !Number.isSafeInteger(limits.memory_max_bytes) ||
    limits.memory_max_bytes < LIMIT_FLOOR.memory_max_bytes ||
    limits.memory_max_bytes > LIMIT_CEILING.memory_max_bytes
  ) {
    throw new IsolationProfileError('memory_max_bytes is outside 256 MiB-2 GiB', 'AGENT_ISOLATION_LIMIT_INVALID');
  }
  // Browsers need far more descriptors than the 64 default; the ceiling is still finite.
  const nofile = value.nofile ?? LIMIT_FLOOR.nofile;
  if (!Number.isSafeInteger(nofile) || nofile < LIMIT_FLOOR.nofile || nofile > LIMIT_CEILING.nofile) {
    throw new IsolationProfileError('nofile is outside 64-4096', 'AGENT_ISOLATION_LIMIT_INVALID');
  }
  limits.nofile = nofile;
  if (value.shm_bytes !== undefined) {
    // Shared memory is charged to the same cgroup, so it can never exceed the memory limit.
    if (
      !Number.isSafeInteger(value.shm_bytes) ||
      value.shm_bytes < 1_048_576 ||
      value.shm_bytes > LIMIT_CEILING.shm_bytes ||
      value.shm_bytes > limits.memory_max_bytes
    ) {
      throw new IsolationProfileError('shm_bytes is outside 1 MiB-512 MiB or exceeds memory', 'AGENT_ISOLATION_LIMIT_INVALID');
    }
    limits.shm_bytes = value.shm_bytes;
  }
  return Object.freeze(limits);
}

function seccompNetworklessProgram() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new IsolationProfileError('networkless seccomp is unavailable on this platform', 'AGENT_ISOLATION_BACKEND_UNAVAILABLE');
  }
  const instructions = [
    [0x20, 0, 0, 4],
    [0x15, 1, 0, 0xc0_00_00_3e],
    [0x06, 0, 0, 0x80_00_00_00],
    [0x20, 0, 0, 0],
    [0x45, 0, 1, 0x40_00_00_00],
    [0x06, 0, 0, 0x80_00_00_00],
    ...NETWORK_SYSCALLS_X64.flatMap((number) => [
      [0x15, 0, 1, number],
      [0x06, 0, 0, 0x00_05_00_01],
    ]),
    [0x06, 0, 0, 0x7f_ff_00_00],
  ];
  const buffer = Buffer.alloc(instructions.length * 8);
  for (const [index, [code, jumpTrue, jumpFalse, value]] of instructions.entries()) {
    const offset = index * 8;
    buffer.writeUInt16LE(code, offset);
    buffer.writeUInt8(jumpTrue, offset + 2);
    buffer.writeUInt8(jumpFalse, offset + 3);
    buffer.writeUInt32LE(value, offset + 4);
  }
  return buffer;
}

/**
 * Minimal BPF assembler with forward labels. Jump offsets are resolved here so the filter
 * stays reviewable instead of hand-counted.
 */
function assemble(steps) {
  const labels = new Map();
  const instructions = [];
  for (const step of steps) {
    if (step.label) labels.set(step.label, instructions.length);
    else instructions.push(step);
  }
  const target = (reference, index) => {
    if (typeof reference === 'number') return reference;
    if (!labels.has(reference)) throw new IsolationProfileError('seccomp label is undefined');
    const distance = labels.get(reference) - index - 1;
    if (distance < 0 || distance > 255) throw new IsolationProfileError('seccomp jump is out of range');
    return distance;
  };
  const buffer = Buffer.alloc(instructions.length * 8);
  for (const [index, step] of instructions.entries()) {
    const offset = index * 8;
    buffer.writeUInt16LE(step.code, offset);
    buffer.writeUInt8(step.jt === undefined ? 0 : target(step.jt, index), offset + 2);
    buffer.writeUInt8(step.jf === undefined ? 0 : target(step.jf, index), offset + 3);
    buffer.writeUInt32LE(step.k >>> 0, offset + 4);
  }
  return buffer;
}

const load = (offset) => ({ code: 0x20, k: offset });
const jumpEqual = (k, jt, jf) => ({ code: 0x15, k, jt, jf });
const returns = (k) => ({ code: 0x06, k });
const label = (name) => ({ label: name });

/**
 * P1 and P2 filter. socket() and socketpair() are decided by argument: only AF_UNIX and
 * AF_INET* with stream or datagram types pass. AF_NETLINK, AF_PACKET, AF_VSOCK, raw sockets
 * and io_uring stay refused, as does the x32 ABI. Other socket calls are only reachable on a
 * descriptor that the filter already allowed to exist.
 */
function seccompNetworkArgumentProgram() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new IsolationProfileError('network seccomp is unavailable on this platform', 'AGENT_ISOLATION_BACKEND_UNAVAILABLE');
  }
  const unixTypes = [SOCK_STREAM, SOCK_DGRAM, SOCK_SEQPACKET];
  const inetTypes = [SOCK_STREAM, SOCK_DGRAM];
  const typeCheck = (prefix, types, onMatch) => [
    label(prefix),
    load(24),
    { code: 0x54, k: 0x0f },
    ...types.map((type) => jumpEqual(type, onMatch, 0)),
    returns(EPERM_RETURN),
  ];
  // Internet sockets: only the default, TCP and UDP protocols. SCTP, MPTCP, UDPLite and ICMP stay out.
  const protocolCheck = [
    label('proto'),
    load(32),
    jumpEqual(0, 'allow', 0),
    jumpEqual(IPPROTO_TCP, 'allow', 0),
    jumpEqual(IPPROTO_UDP, 'allow', 0),
    returns(EPERM_RETURN),
  ];
  return assemble([
    load(4),
    jumpEqual(0xc0_00_00_3e, 1, 0),
    returns(0x80_00_00_00),
    load(0),
    { code: 0x45, k: 0x40_00_00_00, jt: 0, jf: 1 },
    returns(0x80_00_00_00),
    ...IO_URING_X64.flatMap((number) => [jumpEqual(number, 0, 1), returns(EPERM_RETURN)]),
    jumpEqual(NR_SOCKET, 'socket', 0),
    jumpEqual(NR_SOCKETPAIR, 'pair', 0),
    returns(0x7f_ff_00_00),
    label('socket'),
    load(16),
    jumpEqual(AF_UNIX, 'unix', 0),
    jumpEqual(AF_INET, 'inet', 0),
    jumpEqual(AF_INET6, 'inet', 0),
    returns(EPERM_RETURN),
    label('pair'),
    load(16),
    jumpEqual(AF_UNIX, 'unix', 0),
    returns(EPERM_RETURN),
    ...typeCheck('unix', unixTypes, 'allow'),
    ...typeCheck('inet', inetTypes, 'proto'),
    ...protocolCheck,
    label('allow'),
    returns(0x7f_ff_00_00),
  ]);
}

/** Evaluate a classic BPF program on a seccomp_data record. Used by tests to cover every family. */
function evaluateSeccomp(program, { arch = 0xc0_00_00_3e, nr, args = [] }) {
  const data = Buffer.alloc(64);
  data.writeUInt32LE(nr >>> 0, 0);
  data.writeUInt32LE(arch >>> 0, 4);
  for (const [index, value] of args.entries()) data.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value)), 16 + index * 8);
  let accumulator = 0;
  let counter = 0;
  for (let steps = 0; steps < 4096; steps += 1) {
    const offset = counter * 8;
    if (offset + 8 > program.length) throw new IsolationProfileError('seccomp program ran off its end');
    const code = program.readUInt16LE(offset);
    const jt = program.readUInt8(offset + 2);
    const jf = program.readUInt8(offset + 3);
    const k = program.readUInt32LE(offset + 4);
    counter += 1;
    switch (code) {
      case 0x20: {
        accumulator = data.readUInt32LE(k);
        break;
      }
      case 0x54: {
        accumulator = (accumulator & k) >>> 0;
        break;
      }
      case 0x15: {
        counter += accumulator === k ? jt : jf;
        break;
      }
      case 0x45: {
        counter += (accumulator & k) === 0 ? jf : jt;
        break;
      }
      case 0x06: {
        return k;
      }
      default: {
        throw new IsolationProfileError('seccomp opcode is not modelled');
      }
    }
  }
  throw new IsolationProfileError('seccomp program did not terminate');
}

function seccompProgramFor(profile) {
  const resolved = typeof profile === 'string' ? resolveProfile(profile) : profile;
  return resolved.seccomp === 'networkless' ? seccompNetworklessProgram() : seccompNetworkArgumentProgram();
}

/**
 * Private copy of a launch's filter, checked against the filter its profile requires. A launch
 * that was forged or whose buffer was edited after registration is refused before argv is built.
 */
function verifiedSeccomp(launch) {
  const profile = resolveProfile(launch?.profile);
  const expected = seccompProgramFor(profile);
  if (!Buffer.isBuffer(launch.seccomp) || !launch.seccomp.equals(expected)) {
    throw new IsolationProfileError('launch filter does not match its profile', 'AGENT_ISOLATION_BINDING_DRIFT');
  }
  return Buffer.from(expected);
}

/** The broker socket is controller-owned. It must be a real socket outside the workspace. */
function brokerBinding(socketPath, workspace) {
  if (
    typeof socketPath !== 'string' ||
    !path.isAbsolute(socketPath) ||
    socketPath.includes('\0') ||
    path.normalize(socketPath) !== socketPath
  ) {
    throw new IsolationProfileError('broker socket must be a normalised absolute path', 'AGENT_ISOLATION_BROKER_INVALID');
  }
  let stat;
  try {
    stat = fs.lstatSync(socketPath);
  } catch {
    throw new IsolationProfileError('broker socket is unavailable', 'AGENT_ISOLATION_BROKER_INVALID');
  }
  if (!stat.isSocket() || stat.isSymbolicLink() || stat.uid !== process.getuid()) {
    throw new IsolationProfileError('broker socket must be an owned, real socket', 'AGENT_ISOLATION_BROKER_INVALID');
  }
  const real = fs.realpathSync(socketPath);
  if (real === workspace || real.startsWith(`${workspace}${path.sep}`)) {
    throw new IsolationProfileError('broker socket cannot live in the workspace', 'AGENT_ISOLATION_BROKER_INVALID');
  }
  return { path: real, dev: stat.dev, ino: stat.ino };
}

// Launch records produced by the supervisor boundary; only these may carry the browser flag.
const LAUNCHES = new WeakSet();
function registerLaunch(launch) {
  // Only an immutable record of a known profile is accepted, so a registered launch cannot be edited later.
  if (!Object.isFrozen(launch) || !Object.isFrozen(launch.args) || !Object.hasOwn(PROFILES, launch.profile)) {
    throw new IsolationProfileError('launch record must be immutable', 'AGENT_ISOLATION_PROFILE_INVALID');
  }
  LAUNCHES.add(launch);
  return launch;
}

/** Chromium has no usable user-namespace sandbox here; bwrap is the sandbox. Never grant the flag elsewhere. */
function chromiumSandboxFlags(launch) {
  if (!LAUNCHES.has(launch) || launch.profile === 'P0' || !Array.isArray(launch.args) || !launch.args.includes('--unshare-all')) {
    throw new IsolationProfileError('--no-sandbox is only valid inside a supervisor bwrap launch', 'AGENT_ISOLATION_BROWSER_REFUSED');
  }
  verifiedSeccomp(launch);
  return Object.freeze(['--no-sandbox']);
}

/** Anonymous, unlinked descriptor holding a seccomp program for bwrap --seccomp. */
function openSeccompDescriptor(program) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-profile-filter-'));
  const filename = path.join(directory, 'filter');
  try {
    fs.writeFileSync(filename, program, { flag: 'wx', mode: 0o400 });
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    fs.unlinkSync(filename);
    return fd;
  } finally {
    fs.rmdirSync(directory);
  }
}

const PROBE = String.raw`
import socket, ctypes, errno, json, os
out = {}
out['interfaces'] = sorted(l.split(':')[0].strip() for l in open('/proc/net/dev').read().splitlines()[2:] if ':' in l)
def attempt(*args):
    try:
        s = socket.socket(*args); s.close(); return 'allowed'
    except OSError as e:
        return errno.errorcode.get(e.errno, str(e.errno))
out['families'] = {
    'unix': attempt(1, 1), 'inet': attempt(2, 1), 'inet6': attempt(10, 1),
    'netlink': attempt(16, 3, 0), 'packet': attempt(17, 3, 0), 'vsock': attempt(40, 1, 0),
    'inet_raw': attempt(2, 3, 1), 'unix_pair': 'allowed',
}
try:
    a, b = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM); a.close(); b.close()
except OSError as e:
    out['families']['unix_pair'] = errno.errorcode.get(e.errno, str(e.errno))
libc = ctypes.CDLL(None, use_errno=True)
r = libc.syscall(425, 1, 0)
out['io_uring'] = errno.errorcode.get(ctypes.get_errno(), 'OK') if r == -1 else 'reachable'
try:
    srv = socket.socket(2, 1); srv.bind(('127.0.0.1', 0)); srv.listen(1)
    cli = socket.socket(2, 1); cli.settimeout(2); cli.connect(srv.getsockname())
    conn, _ = srv.accept(); cli.sendall(b'ok'); out['loopback'] = 'connected' if conn.recv(2) == b'ok' else 'mismatch'
except OSError as e:
    out['loopback'] = errno.errorcode.get(e.errno, str(e.errno))
try:
    ext = socket.socket(2, 1); ext.settimeout(2); ext.connect(('1.1.1.1', 443)); out['external'] = 'reachable'
except OSError as e:
    out['external'] = errno.errorcode.get(e.errno, str(e.errno))
try:
    brk = socket.socket(1, 1); brk.settimeout(2); brk.connect('/run/broker.sock'); out['broker'] = 'connected'
except OSError as e:
    out['broker'] = errno.errorcode.get(e.errno, str(e.errno))
print(json.dumps(out))
`;

/** Required observations per profile. Anything else, including a missing key, fails the profile. */
function expectedObservations(profile) {
  return {
    interfaces: ['lo'],
    families: {
      unix: 'allowed',
      inet: 'allowed',
      inet6: 'allowed',
      netlink: 'EPERM',
      packet: 'EPERM',
      vsock: 'EPERM',
      inet_raw: 'EPERM',
      unix_pair: 'allowed',
    },
    io_uring: 'EPERM',
    loopback: 'connected',
    external: 'ENETUNREACH',
    broker: profile.broker ? 'connected' : 'ENOENT',
  };
}

function checkObservations(observed, profile) {
  const expected = expectedObservations(profile);
  const mismatches = [];
  if (JSON.stringify(observed.interfaces) !== JSON.stringify(expected.interfaces)) mismatches.push('interfaces');
  for (const [key, value] of Object.entries(expected.families)) if (observed.families?.[key] !== value) mismatches.push(`family:${key}`);
  for (const key of ['io_uring', 'loopback', 'external', 'broker']) if (observed[key] !== expected[key]) mismatches.push(key);
  return mismatches;
}

/**
 * Run the network probe through a supervisor launch of the profile. The probe is evidence:
 * an observation that differs from the profile table refuses the profile.
 */
function runProfileProbe(launch, { timeout_ms = 15_000, fds = [] } = {}) {
  if (!LAUNCHES.has(launch)) throw new IsolationProfileError('launch is not supervisor-owned', 'AGENT_ISOLATION_PROFILE_UNKNOWN');
  const profile = resolveProfile(launch.profile);
  const seccompFd = openSeccompDescriptor(verifiedSeccomp(launch));
  let result;
  try {
    result = spawnSync(launch.binary, launch.args, {
      env: {},
      encoding: 'utf8',
      timeout: timeout_ms,
      maxBuffer: 65_536,
      stdio: ['ignore', 'pipe', 'pipe', seccompFd, ...fds],
    });
  } finally {
    fs.closeSync(seccompFd);
  }
  if (result.error || result.status !== 0) {
    throw new IsolationProfileError('profile probe failed to run', 'AGENT_ISOLATION_PROBE_FAILED', { status: result.status });
  }
  let observed;
  try {
    observed = JSON.parse(result.stdout);
  } catch {
    throw new IsolationProfileError('profile probe output is malformed', 'AGENT_ISOLATION_PROBE_FAILED');
  }
  const mismatches = checkObservations(observed, profile);
  if (mismatches.length > 0) {
    throw new IsolationProfileError('profile probe did not prove the boundary', 'AGENT_ISOLATION_PROBE_FAILED', { mismatches });
  }
  return deepFreeze({ profile: profile.id, observed, policy_digest: launch.policy_digest });
}

module.exports = {
  BROKER_SANDBOX_PATH,
  IsolationProfileError,
  LIMIT_CEILING,
  LIMIT_FLOOR,
  PROBE,
  PROFILES,
  brokerBinding,
  checkObservations,
  chromiumSandboxFlags,
  evaluateSeccomp,
  profileRank,
  registerLaunch,
  resolveCallLimits,
  resolveProfile,
  runProfileProbe,
  seccompNetworkArgumentProgram,
  seccompNetworklessProgram,
  verifiedSeccomp,
  seccompProgramFor,
};
