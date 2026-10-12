'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { startIsolatedTerminal } = require('../packages/agent-isolation-attestation/terminal-executor');
const { test, mock } = require('node:test');
const { randomUUID } = require('node:crypto');

const { createIsolationPolicy, prepareIsolatedExecution } = require('../packages/agent-isolation-attestation');
const { createArtifactChannel } = require('../packages/agent-isolation-attestation/artifact-channel');
const {
  EngineeringIsolationError,
  createResourceGroup,
  executeIsolatedCommand,
  executorOwner,
  reapExecutorOwner,
  reapTerminalGroup,
  removeDrainedGroup,
} = require('../packages/agent-isolation-attestation/executor');
const {
  IsolationProfileError,
  PROBE,
  PROFILES,
  checkObservations,
  chromiumSandboxFlags,
  evaluateSeccomp,
  profileRank,
  resolveCallLimits,
  registerLaunch,
  resolveProfile,
  runProfileProbe,
  seccompNetworkArgumentProgram,
  seccompNetworklessProgram,
  seccompProgramFor,
  verifiedSeccomp,
} = require('../packages/agent-isolation-attestation/profiles');

const EPERM = 0x00_05_00_01;
const ALLOW = 0x7f_ff_00_00;
const KILL = 0x80_00_00_00;
const NR = { socket: 41, connect: 42, bind: 49, socketpair: 53, io_uring_setup: 425, io_uring_enter: 426, io_uring_register: 427, read: 0 };
const AF = { UNIX: 1, INET: 2, INET6: 10, NETLINK: 16, PACKET: 17, VSOCK: 40, KEY: 15, BLUETOOTH: 31, RDS: 21, XDP: 44 };
const SOCK = { STREAM: 1, DGRAM: 2, RAW: 3, SEQPACKET: 5, NONBLOCK: 0x8_00, CLOEXEC: 0x8_00_00 };

function fixture(context, extra = {}) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-profiles-'));
  context.after(() => fs.rmSync(main, { recursive: true, force: true }));
  const workspace = path.join(main, 'workspace');
  fs.mkdirSync(workspace, { mode: 0o700 });
  const marker = path.join(main, 'protected');
  fs.writeFileSync(marker, 'protected');
  const input = { backend: 'bwrap', host_workspace: workspace, main_checkout: main, protected_paths: [marker], ...extra };
  return { main, workspace, marker, input, policy: createIsolationPolicy(input) };
}

async function broker(context, directory) {
  const socketPath = path.join(directory, 'broker.sock');
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(socketPath, resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return socketPath;
}

const decide = (program, nr, args = []) => evaluateSeccomp(program, { nr, args });

test('the profile table is closed: unknown names and inherited keys refuse, P0 stays the default', (context) => {
  assert.deepEqual(Object.keys(PROFILES), ['P0', 'P1', 'P2']);
  assert.equal(resolveProfile('P1').network, 'loopback');
  for (const bad of ['P3', 'p1', '', undefined, null, 1, 'constructor', '__proto__', 'toString']) {
    assert.throws(
      () => resolveProfile(bad),
      (error) => error instanceof IsolationProfileError && error.code === 'AGENT_ISOLATION_PROFILE_UNKNOWN',
    );
  }
  assert.deepEqual(['P0', 'P1', 'P2'].map(profileRank), [0, 1, 2]);
  const { policy, input } = fixture(context);
  assert.equal(policy.profile, undefined);
  assert.deepEqual(policy.network, { mode: 'none', namespace: 'isolated' });
  const explicit = createIsolationPolicy({ ...input, profile: 'P0' });
  assert.equal(explicit.policy_digest, policy.policy_digest, 'naming P0 does not change the P0 digest');
  assert.throws(() => createIsolationPolicy({ ...input, profile: 'P9' }), IsolationProfileError);
  assert.throws(() => createIsolationPolicy({ ...input, profile: undefined }), IsolationProfileError);
});

test('P1 is digest-bound, refuses a broker, and P2 demands a real owned socket outside the workspace', async (context) => {
  const base = fixture(context);
  const p1 = createIsolationPolicy({ ...base.input, profile: 'P1' });
  assert.equal(p1.profile, 'P1');
  assert.deepEqual(p1.network, { mode: 'loopback', namespace: 'isolated' });
  assert.notEqual(p1.policy_digest, base.policy.policy_digest);
  assert.throws(() => createIsolationPolicy({ ...base.input, profile: 'P1', broker_socket: '/tmp/x' }), /broker socket is required by P2/);
  assert.throws(() => createIsolationPolicy({ ...base.input, broker_socket: '/tmp/x' }), /broker socket is required by P2/);
  assert.throws(() => createIsolationPolicy({ ...base.input, profile: 'P2' }), /broker socket is required by P2/);

  const socketPath = await broker(context, base.main);
  const p2 = createIsolationPolicy({ ...base.input, profile: 'P2', broker_socket: socketPath });
  assert.equal(p2.profile, 'P2');
  assert.deepEqual(p2.network, { mode: 'loopback+broker', namespace: 'isolated' });
  assert.equal(p2.broker_binding.path, fs.realpathSync(socketPath));

  const invalid = async (broker_socket) =>
    assert.throws(
      () => createIsolationPolicy({ ...base.input, profile: 'P2', broker_socket }),
      (error) => error instanceof IsolationProfileError && error.code === 'AGENT_ISOLATION_BROKER_INVALID',
    );
  await invalid('relative.sock');
  await invalid(`${socketPath}/../broker.sock`);
  await invalid(path.join(base.main, 'missing.sock'));
  await invalid(base.marker);
  await invalid(7);
  const link = path.join(base.main, 'link.sock');
  fs.symlinkSync(socketPath, link);
  await invalid(link);
  // A socket inside the worktree would hand the plugin a live channel it created or was given.
  const inside = path.join(base.workspace, 'inside.sock');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(inside, resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await invalid(inside);
});

test('seccomp by argument: AF_UNIX and AF_INET* stream or datagram pass, every other family is refused', () => {
  const program = seccompNetworkArgumentProgram();
  for (const [family, types] of [
    [AF.UNIX, [SOCK.STREAM, SOCK.DGRAM, SOCK.SEQPACKET]],
    [AF.INET, [SOCK.STREAM, SOCK.DGRAM]],
    [AF.INET6, [SOCK.STREAM, SOCK.DGRAM]],
  ]) {
    for (const type of types) {
      assert.equal(decide(program, NR.socket, [family, type, 0]), ALLOW, `family ${family} type ${type}`);
      assert.equal(
        decide(program, NR.socket, [family, type | SOCK.NONBLOCK | SOCK.CLOEXEC, 0]),
        ALLOW,
        'flag bits do not defeat the type mask',
      );
    }
  }
  // Negative test per family (G2): netlink, packet and vsock, plus the raw and exotic families.
  for (const [name, family] of Object.entries(AF)) {
    if (['UNIX', 'INET', 'INET6'].includes(name)) continue;
    for (const type of [SOCK.STREAM, SOCK.DGRAM, SOCK.RAW]) {
      assert.equal(decide(program, NR.socket, [family, type, 0]), EPERM, `AF_${name} type ${type}`);
    }
  }
  for (const family of [AF.INET, AF.INET6]) {
    assert.equal(decide(program, NR.socket, [family, SOCK.RAW, 1]), EPERM, 'raw inet sockets stay refused');
    assert.equal(decide(program, NR.socket, [family, SOCK.SEQPACKET, 0]), EPERM);
  }
  assert.equal(decide(program, NR.socket, [AF.UNIX, SOCK.RAW, 0]), EPERM);
  assert.equal(
    decide(program, NR.socket, [2 ** 32 + AF.NETLINK, SOCK.STREAM, 0]),
    EPERM,
    'the filter reads the same 32 bits the kernel reads',
  );
});

test('seccomp by argument: socketpair is AF_UNIX only; io_uring, x32 and foreign architectures stay refused', () => {
  const program = seccompNetworkArgumentProgram();
  assert.equal(decide(program, NR.socketpair, [AF.UNIX, SOCK.STREAM, 0]), ALLOW);
  assert.equal(decide(program, NR.socketpair, [AF.UNIX, SOCK.RAW, 0]), EPERM);
  for (const family of [AF.INET, AF.INET6, AF.NETLINK, AF.PACKET, AF.VSOCK]) {
    assert.equal(decide(program, NR.socketpair, [family, SOCK.STREAM, 0]), EPERM, `socketpair family ${family}`);
  }
  for (const number of [NR.io_uring_setup, NR.io_uring_enter, NR.io_uring_register])
    assert.equal(decide(program, number), EPERM, `io_uring ${number}`);
  assert.equal(decide(program, 0x40_00_00_29), KILL, 'x32 ABI numbers are killed');
  assert.equal(evaluateSeccomp(program, { arch: 0x40_00_00_03, nr: NR.read }), KILL, 'a foreign architecture is killed');
  assert.equal(decide(program, NR.read), ALLOW);
  assert.equal(decide(program, NR.connect, [3]), ALLOW, 'connect on a descriptor the filter already allowed is not re-decided');
});

test('the seccomp evaluator and assembler refuse malformed programs instead of guessing', () => {
  assert.throws(() => evaluateSeccomp(Buffer.alloc(0), { nr: 0 }), IsolationProfileError);
  const unmodelled = Buffer.alloc(8);
  unmodelled.writeUInt16LE(0x99, 0);
  assert.throws(() => evaluateSeccomp(unmodelled, { nr: 0 }), /not modelled/);
  const loop = Buffer.alloc(8);
  loop.writeUInt16LE(0x15, 0);
  loop.writeUInt8(0xff, 2);
  loop.writeUInt8(0xff, 3);
  assert.throws(() => evaluateSeccomp(loop, { nr: 0 }), IsolationProfileError);
  assert.equal(seccompProgramFor('P1').length % 8, 0);
  assert.ok(seccompProgramFor(PROFILES.P2).equals(seccompProgramFor('P1')), 'P1 and P2 share one filter');
  assert.ok(seccompProgramFor('P0').equals(seccompNetworklessProgram()), 'P0 keeps its own filter');
  assert.ok(!seccompProgramFor('P0').equals(seccompProgramFor('P1')));
});

test('per-call limits stay inside 32-256 processes and 2 GiB, and shared memory never exceeds memory', () => {
  assert.deepEqual({ ...resolveCallLimits() }, { pids_max: 32, memory_max_bytes: 268_435_456, nofile: 64 });
  assert.deepEqual(
    { ...resolveCallLimits({ pids_max: 256, memory_max_bytes: 2_147_483_648, shm_bytes: 536_870_912 }) },
    {
      pids_max: 256,
      memory_max_bytes: 2_147_483_648,
      shm_bytes: 536_870_912,
      nofile: 64,
    },
  );
  const refuse = (value) => assert.throws(() => resolveCallLimits(value), IsolationProfileError, JSON.stringify(value));
  for (const value of [
    { pids_max: 31 },
    { pids_max: 257 },
    { pids_max: 32.5 },
    { memory_max_bytes: 268_435_455 },
    { memory_max_bytes: 2_147_483_649 },
    { shm_bytes: 1 },
    { shm_bytes: 536_870_913, memory_max_bytes: 2_147_483_648 },
    { shm_bytes: 300_000_000 },
    { cpu: 1 },
    { nofile: 63 },
    { nofile: 4097 },
    { nofile: 1.5 },
    null,
    [],
  ])
    refuse(value);
});

test('P0 launches are untouched and wider profiles are launched only from a supervisor policy', (context) => {
  const { policy, input } = fixture(context);
  const p0 = prepareIsolatedExecution(policy, ['/usr/bin/true']);
  assert.equal(p0.profile, 'P0');
  assert.ok(p0.seccomp.length > 0);
  assert.ok(!p0.args.includes('/dev/shm') && !p0.args.includes('/artifacts') && !p0.args.includes('/run/broker.sock'));
  const p1 = prepareIsolatedExecution(createIsolationPolicy({ ...input, profile: 'P1' }), ['/usr/bin/true']);
  assert.notDeepEqual([...p1.seccomp], [...p0.seccomp]);
  assert.throws(() => prepareIsolatedExecution(structuredClone(policy), ['/usr/bin/true']), /not supervisor-owned/);
  assert.throws(() => prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, { mount: '/' }), /launch extra is not recognised/);
  assert.throws(() => prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, null), /invalid launch extras/);
  assert.throws(
    () => prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, { artifacts_directory: input.host_workspace }),
    /overlap/,
  );
  assert.throws(
    () => prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, { artifacts_directory: input.main_checkout }),
    /overlap/,
  );
  assert.throws(() => prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, { artifacts_directory: 'relative' }), /absolute/);
  const sized = prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, { shm_bytes: 4_194_304 });
  const at = sized.args.indexOf('/dev/shm');
  assert.deepEqual(sized.args.slice(at - 3, at + 1), ['--size', '4194304', '--tmpfs', '/dev/shm']);
  assert.throws(() => prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, { shm_bytes: 1 }), IsolationProfileError);
});

test('P1 inside bwrap: loopback works, no external route, and the forbidden families are refused by the kernel path', (context) => {
  const { policy } = fixture(context, { profile: 'P1' });
  const launch = prepareIsolatedExecution(policy, ['/usr/bin/python3', '-I', '-c', PROBE]);
  const proof = runProfileProbe(launch);
  assert.equal(proof.profile, 'P1');
  assert.deepEqual(proof.observed.interfaces, ['lo']);
  assert.equal(proof.observed.loopback, 'connected');
  assert.equal(proof.observed.external, 'ENETUNREACH', 'external networks are unreachable');
  assert.equal(proof.observed.broker, 'ENOENT', 'P1 has no broker mount');
  for (const family of ['netlink', 'packet', 'vsock', 'inet_raw']) assert.equal(proof.observed.families[family], 'EPERM', family);
  assert.equal(proof.observed.io_uring, 'EPERM');
  assert.equal(proof.policy_digest, policy.policy_digest);
});

test('P2 inside bwrap: the broker socket is mounted at /run/broker.sock and is the only way out', async (context) => {
  const base = fixture(context);
  const socketPath = await broker(context, base.main);
  const policy = createIsolationPolicy({ ...base.input, profile: 'P2', broker_socket: socketPath });
  const launch = prepareIsolatedExecution(policy, ['/usr/bin/python3', '-I', '-c', PROBE]);
  const proof = runProfileProbe(launch);
  assert.equal(proof.profile, 'P2');
  assert.equal(proof.observed.broker, 'connected');
  assert.equal(proof.observed.external, 'ENETUNREACH');
  assert.deepEqual(proof.observed.interfaces, ['lo']);
});

test('a profile probe refuses forged launches, failed runs, malformed output and any divergent observation', (context) => {
  const { policy } = fixture(context, { profile: 'P1' });
  assert.throws(() => runProfileProbe({ ...prepareIsolatedExecution(policy, ['/usr/bin/true']) }), /not supervisor-owned/);
  const failing = prepareIsolatedExecution(policy, ['/usr/bin/false']);
  assert.throws(
    () => runProfileProbe(failing),
    (error) => error.code === 'AGENT_ISOLATION_PROBE_FAILED',
  );
  const garbage = prepareIsolatedExecution(policy, ['/usr/bin/echo', 'not json']);
  assert.throws(() => runProfileProbe(garbage), /malformed/);
  // A P0 launch refuses every socket, so it can never be accepted as a P1 observation set.
  const p0 = fixture(context).policy;
  const p0Launch = prepareIsolatedExecution(p0, ['/usr/bin/python3', '-I', '-c', PROBE]);
  assert.throws(
    () => runProfileProbe(p0Launch),
    (error) =>
      error.code === 'AGENT_ISOLATION_PROBE_FAILED' &&
      error.details.mismatches.includes('loopback') &&
      error.details.mismatches.includes('family:inet'),
  );
  const good = {
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
    broker: 'ENOENT',
  };
  assert.deepEqual(checkObservations(good, PROFILES.P1), []);
  assert.deepEqual(checkObservations({ ...good, broker: 'connected' }, PROFILES.P2), []);
  assert.deepEqual(checkObservations(good, PROFILES.P2), ['broker']);
  assert.deepEqual(checkObservations({ ...good, interfaces: ['lo', 'eth0'] }, PROFILES.P1), ['interfaces']);
  assert.deepEqual(checkObservations({ ...good, external: 'reachable' }, PROFILES.P1), ['external']);
  assert.deepEqual(checkObservations({ ...good, families: { ...good.families, vsock: 'allowed' } }, PROFILES.P1), ['family:vsock']);
  assert.deepEqual(checkObservations({ ...good, families: { ...good.families, netlink: 'allowed' } }, PROFILES.P1), ['family:netlink']);
  assert.deepEqual(checkObservations({ ...good, families: { ...good.families, packet: 'allowed' } }, PROFILES.P1), ['family:packet']);
  assert.deepEqual(checkObservations({ ...good, io_uring: 'reachable' }, PROFILES.P1), ['io_uring']);
  assert.deepEqual(checkObservations({}, PROFILES.P1).length > 0, true);
});

test('--no-sandbox is granted only for a supervisor bwrap launch of a wider profile', (context) => {
  const base = fixture(context);
  const p1 = prepareIsolatedExecution(createIsolationPolicy({ ...base.input, profile: 'P1' }), ['/usr/bin/true']);
  assert.deepEqual([...chromiumSandboxFlags(p1)], ['--no-sandbox']);
  const refuse = (value) =>
    assert.throws(
      () => chromiumSandboxFlags(value),
      (error) => error.code === 'AGENT_ISOLATION_BROWSER_REFUSED',
    );
  refuse(prepareIsolatedExecution(base.policy, ['/usr/bin/true']));
  refuse({ ...p1 });
  refuse(null);
  refuse({});
});

async function runCommand(policy, script, options = {}) {
  return executeIsolatedCommand({
    policy,
    command: ['/usr/bin/python3', '-I', '-c', script],
    timeout_ms: 20_000,
    max_output_bytes: 65_536,
    ...options,
  });
}

test('per-call process and memory limits are applied, reported with peaks, and the cgroup drains', async (context) => {
  const owner = executorOwner();
  const prefix = `hseos-executor-${owner.pid}-${owner.start_ticks}-`;
  const groups = () => fs.readdirSync(owner.resource_parent).filter((name) => name.startsWith(prefix));
  const before = groups();
  const { policy } = fixture(context, { profile: 'P1' });
  const spawnMany = `import subprocess,sys
procs=[]
for _ in range(int(sys.argv[1]) if len(sys.argv)>1 else 120):
    try: procs.append(subprocess.Popen(['/usr/bin/sleep','5']))
    except OSError: break
print(len(procs))
for p in procs: p.kill()
`;
  const small = await runCommand(policy, spawnMany);
  assert.equal(small.status, 'succeeded');
  const spawnedSmall = Number(small.stdout);
  assert.ok(spawnedSmall < 32, `32-process limit holds (spawned ${spawnedSmall})`);
  assert.equal(small.limits.processes, 32);
  assert.equal(small.limits.memory_bytes, 268_435_456);
  assert.ok(small.pids_peak >= 2 && small.pids_peak <= 32, `pids_peak ${small.pids_peak}`);
  assert.ok(small.memory_peak_bytes > 0 && small.memory_peak_bytes <= 268_435_456, `memory_peak_bytes ${small.memory_peak_bytes}`);
  assert.equal(small.profile, 'P1');

  const large = await runCommand(policy, spawnMany, { limits: { pids_max: 128, memory_max_bytes: 536_870_912 } });
  const spawnedLarge = Number(large.stdout);
  assert.ok(spawnedLarge > 32 && spawnedLarge < 128, `128-process limit holds (spawned ${spawnedLarge})`);
  assert.equal(large.limits.processes, 128);
  assert.equal(large.limits.memory_bytes, 536_870_912);
  assert.ok(large.pids_peak > 32 && large.pids_peak <= 128);

  const hungry = await runCommand(policy, "b = bytearray(400 * 1024 * 1024)\nfor i in range(0, len(b), 4096): b[i] = 1\nprint('survived')");
  assert.notEqual(hungry.stdout.trim(), 'survived', 'a 400 MiB touch under a 256 MiB limit does not survive');
  assert.ok(hungry.memory_peak_bytes <= 268_435_456);
  assert.deepEqual(groups(), before, 'every resource group was drained and removed');
});

test('descriptor limit is per call, finite, and applied to the sandboxed process', async (context) => {
  const { policy } = fixture(context);
  const read = 'import resource; print(resource.getrlimit(resource.RLIMIT_NOFILE)[0])';
  assert.equal(Number((await runCommand(policy, read)).stdout), 64);
  const wide = await runCommand(policy, read, { limits: { nofile: 1024 } });
  assert.equal(Number(wide.stdout), 1024);
  assert.equal(wide.limits.nofile, 1024);
});

test('out-of-range call limits refuse before a group is created', async (context) => {
  const { policy } = fixture(context);
  for (const limits of [
    { pids_max: 8 },
    { pids_max: 1000 },
    { memory_max_bytes: 1 },
    { memory_max_bytes: 4_294_967_296 },
    { shm_bytes: 1 },
  ]) {
    await assert.rejects(runCommand(policy, 'print(1)', { limits }), IsolationProfileError);
  }
});

test('/dev/shm is sized per call and the artifact channel is the only writable path out', async (context) => {
  const { policy } = fixture(context, { profile: 'P1' });
  const shm = await runCommand(policy, "import os; s=os.statvfs('/dev/shm'); print(s.f_blocks*s.f_frsize)", {
    limits: { memory_max_bytes: 536_870_912, shm_bytes: 8_388_608 },
  });
  assert.equal(Number(shm.stdout), 8_388_608);
  assert.equal(shm.limits.shm_bytes, 8_388_608);

  const channel = createArtifactChannel({
    limits: { max_files: 2, max_file_bytes: 4096, max_total_bytes: 8192 },
    media_types: ['image/png', 'text/plain'],
  });
  context.after(() => channel.dispose());
  const writer = `import hashlib, json
png = bytes([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) + b'frame'
open('/artifacts/frame.png','wb').write(png)
print(json.dumps([{'path':'/artifacts/frame.png','media_type':'image/png','bytes':len(png),'sha256':hashlib.sha256(png).hexdigest()}]))
`;
  const result = await runCommand(policy, writer, { artifact_channel: channel });
  assert.equal(result.status, 'succeeded');
  const [artifact] = channel.verify(result.stdout);
  assert.equal(artifact.sha256, createHash('sha256').update(artifact.content).digest('hex'));
  assert.equal(artifact.media_type, 'image/png');
  assert.equal(fs.readFileSync(path.join(policy.host_workspace, '..', 'protected'), 'utf8'), 'protected');

  // The same write without a channel has nowhere to go: /artifacts does not exist.
  const without = await runCommand(policy, "open('/artifacts/x','wb')");
  assert.notEqual(without.status, 'succeeded');
  // A per-file ceiling is enforced by RLIMIT_FSIZE while the plugin still runs: the write is cut short.
  await runCommand(policy, "print(open('/artifacts/big.bin','wb').write(b'x'*8192))", { artifact_channel: channel });
  assert.equal(fs.statSync(path.join(channel.directory, 'big.bin')).size, 4096);
  assert.throws(
    () => channel.verify(result.stdout),
    (error) => error.code === 'ARTIFACT_MANIFEST_DIVERGED',
    'an undeclared extra file is refused',
  );
});

test('read-only toolchain mounts appear under /opt/hseos and every unsafe source or target is refused', async (context) => {
  const toolchain = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-toolchain-'));
  context.after(() => fs.rmSync(toolchain, { recursive: true, force: true }));
  const { policy, main, input } = fixture(context, { profile: 'P1', toolchain_roots: [toolchain] });
  assert.deepEqual(policy.toolchain_roots, [fs.realpathSync(toolchain)]);
  fs.writeFileSync(path.join(toolchain, 'tool.txt'), 'pinned');
  const mount = { source: toolchain, target: '/opt/hseos/tool' };
  const ran = await runCommand(policy, "import os; print(open('/opt/hseos/tool/tool.txt').read()); open('/opt/hseos/tool/x','w')", {
    readonly_mounts: [mount],
  });
  assert.equal(ran.stdout.trim(), 'pinned');
  assert.notEqual(ran.status, 'succeeded', 'the mount is read-only');

  // Not on the allowlist, or no allowlist at all: refused even for a perfectly real directory.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-elsewhere-'));
  context.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  assert.throws(
    () =>
      prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, {
        readonly_mounts: [{ source: elsewhere, target: '/opt/hseos/a' }],
      }),
    /outside the controller allowlist/,
  );
  const bare = fixture(context, { profile: 'P1' }).policy;
  assert.throws(
    () => prepareIsolatedExecution(bare, ['/usr/bin/true'], false, false, { readonly_mounts: [mount] }),
    /outside the controller allowlist/,
  );
  for (const bad of [[], 'x', [7]])
    assert.throws(() => createIsolationPolicy({ ...input, toolchain_roots: bad }), /toolchain_roots|plain object|absolute/);
  const launch = (mounts) => () => prepareIsolatedExecution(policy, ['/usr/bin/true'], false, false, { readonly_mounts: mounts });
  assert.doesNotThrow(launch([mount, { source: path.join(toolchain, 'tool.txt'), target: '/opt/hseos/tool-file' }]));
  assert.throws(launch('x'), /bounded list/);
  assert.throws(launch(Array.from({ length: 9 }, (_, i) => ({ source: toolchain, target: `/opt/hseos/t${i}` }))), /bounded list/);
  assert.throws(launch([{ source: toolchain }]), /non-canonical/);
  for (const target of ['/etc/passwd', '/opt/hseos', '/opt/hseos/../etc', '/opt/hseos/A', '/opt/other/tool', 7]) {
    assert.throws(launch([{ source: toolchain, target }]), /distinct path under \/opt\/hseos/, String(target));
  }
  assert.throws(launch([mount, mount]), /distinct path/);
  assert.throws(launch([{ source: 'relative', target: '/opt/hseos/a' }]), /absolute/);
  assert.throws(launch([{ source: 7, target: '/opt/hseos/a' }]), /absolute/);
  assert.throws(launch([{ source: path.join(toolchain, 'missing'), target: '/opt/hseos/a' }]), /unavailable/);
  const link = path.join(toolchain, 'link');
  fs.symlinkSync('/etc', link);
  assert.throws(launch([{ source: link, target: '/opt/hseos/a' }]), /real file or directory/);
  const socketDirectory = path.join(toolchain, 'sock');
  fs.mkdirSync(socketDirectory);
  const nested = path.join(socketDirectory, 'real');
  fs.mkdirSync(nested);
  fs.symlinkSync(socketDirectory, path.join(toolchain, 'alias'));
  assert.throws(launch([{ source: path.join(toolchain, 'alias', 'real'), target: '/opt/hseos/a' }]), /real file or directory/);
  assert.throws(launch([{ source: policy.host_workspace, target: '/opt/hseos/a' }]), /overlap/);
  assert.throws(launch([{ source: main, target: '/opt/hseos/a' }]), /overlap/);
  assert.throws(launch([{ source: path.dirname(main), target: '/opt/hseos/a' }]), /overlap/);
  assert.throws(launch([{ source: path.join(main, 'protected'), target: '/opt/hseos/a' }]), /overlap/);
});

test('executor errors keep their types when limits or the channel are wrong', async (context) => {
  const { policy } = fixture(context);
  await assert.rejects(runCommand(policy, 'print(1)', { timeout_ms: 0 }), EngineeringIsolationError);
});

const deadOwner = () => ({ ...executorOwner(), pid: 2_147_483_000, start_ticks: '1' });
const groupFor = (owner) => path.join(owner.resource_parent, `hseos-executor-${owner.pid}-${owner.start_ticks}-${randomUUID()}`);

test('a dead executor owner is reconciled: only its own well-formed groups are drained and removed', async () => {
  const owner = deadOwner();
  const mine = groupFor(owner);
  fs.mkdirSync(mine);
  const stranger = path.join(owner.resource_parent, `hseos-executor-${owner.pid}-${owner.start_ticks}-not-a-uuid`);
  await reapExecutorOwner(owner);
  assert.equal(fs.existsSync(mine), false);
  assert.equal(fs.existsSync(stranger), false);
  await assert.rejects(reapExecutorOwner({ ...owner, pid: 0 }), EngineeringIsolationError);
  await assert.rejects(reapExecutorOwner({ ...owner, resource_parent: '/elsewhere' }), /cannot be reconciled/);
});

test('terminal groups are reaped only under the exact owner prefix and parent', async () => {
  const owner = deadOwner();
  const group = groupFor(owner);
  fs.mkdirSync(group);
  await reapTerminalGroup(owner, group);
  assert.equal(fs.existsSync(group), false);
  await reapTerminalGroup(owner, group);
  for (const directory of [path.join(owner.resource_parent, 'other-name'), path.join('/tmp', path.basename(group)), `${group}x`]) {
    await assert.rejects(reapTerminalGroup(owner, directory), /identity changed/, directory);
  }
  await assert.rejects(reapTerminalGroup({ ...owner, resource_parent: '/elsewhere' }, groupFor(owner)), /identity changed/);
  await assert.rejects(reapTerminalGroup({ pid: 'x', start_ticks: '1' }, group), /Invalid executor owner/);
});

test('resource groups reject out-of-range limits and a controller that does not accept its limit', (context) => {
  assert.throws(() => createResourceGroup({ pids_max: 8 }), /process limit/);
  assert.throws(() => createResourceGroup({ memory_max_bytes: 1 }), /memory limit/);
  const owner = executorOwner();
  const before = fs.readdirSync(owner.resource_parent).length;
  const original = fs.writeFileSync;
  mock.method(fs, 'writeFileSync', (file, value, ...rest) =>
    String(file).endsWith('/pids.max') ? undefined : original(file, value, ...rest),
  );
  context.after(() => mock.restoreAll());
  assert.throws(() => createResourceGroup(), /did not accept its limit/);
  mock.restoreAll();
  assert.equal(fs.readdirSync(owner.resource_parent).length, before, 'the half-built group was removed');
});

test('group removal tolerates a busy cgroup and a concurrent claimant, and gives up with an uncertain-teardown error', async (context) => {
  const group = createResourceGroup();
  const original = fs.rmdirSync;
  let busy = 2;
  mock.method(fs, 'rmdirSync', (target, ...rest) => {
    if (target === group && busy-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return original(target, ...rest);
  });
  context.after(() => mock.restoreAll());
  await removeDrainedGroup(group);
  assert.equal(fs.existsSync(group), false);
  mock.restoreAll();
  await removeDrainedGroup(group);
  const stuck = createResourceGroup();
  mock.method(fs, 'rmdirSync', (target, ...rest) => {
    if (target === stuck) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return original(target, ...rest);
  });
  const now = Date.now();
  let calls = 0;
  mock.method(Date, 'now', () => now + (calls++ > 3 ? 60_000 : 0));
  await assert.rejects(removeDrainedGroup(stuck), (error) => error.code === 'ENGINEERING_TEARDOWN_UNCERTAIN');
  mock.restoreAll();
  await removeDrainedGroup(stuck);
  const other = createResourceGroup();
  mock.method(fs, 'rmdirSync', () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  });
  await assert.rejects(removeDrainedGroup(other), (error) => error.code === 'EACCES');
  mock.restoreAll();
  await removeDrainedGroup(other);
});

test('timeouts, output floods, cancellation and undecodable output end with a distinct status and drained groups', async (context) => {
  const { policy } = fixture(context);
  const owner = executorOwner();
  const groups = () =>
    fs.readdirSync(owner.resource_parent).filter((name) => name.startsWith(`hseos-executor-${owner.pid}-${owner.start_ticks}-`));
  const before = groups();
  assert.equal((await runCommand(policy, 'import time; time.sleep(30)', { timeout_ms: 300 })).status, 'timed_out');
  const flood = await runCommand(policy, "import sys; sys.stdout.write('x' * 10000)", { max_output_bytes: 100 });
  assert.equal(flood.status, 'output_limit');
  assert.ok(flood.stdout.length <= 100);
  const bad = await runCommand(policy, String.raw`import sys; sys.stdout.buffer.write(b'\xff\xfe')`);
  assert.equal(bad.status, 'invalid_output');
  assert.equal(bad.stdout, '');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  assert.equal((await runCommand(policy, 'import time; time.sleep(30)', { signal: controller.signal })).status, 'cancelled');
  const aborted = AbortSignal.abort();
  assert.equal((await runCommand(policy, 'print(1)', { signal: aborted })).status, 'cancelled');
  assert.deepEqual(groups(), before);
});

test('a kill that cannot be written is reported as uncertain teardown, never as a clean cancellation', async (context) => {
  const { policy } = fixture(context);
  const original = fs.writeFileSync;
  let failed = false;
  mock.method(fs, 'writeFileSync', (file, ...rest) => {
    if (!failed && String(file).endsWith('/cgroup.kill')) {
      failed = true;
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    }
    return original(file, ...rest);
  });
  context.after(() => mock.restoreAll());
  await assert.rejects(
    runCommand(policy, 'import time; time.sleep(30)', { timeout_ms: 200 }),
    (error) => error.code === 'ENGINEERING_TEARDOWN_UNCERTAIN',
  );
  mock.restoreAll();
});

test('internet sockets are limited to the default, TCP and UDP protocols', () => {
  const program = seccompNetworkArgumentProgram();
  for (const family of [AF.INET, AF.INET6]) {
    for (const protocol of [0, 6]) assert.equal(decide(program, NR.socket, [family, SOCK.STREAM, protocol]), ALLOW, `stream ${protocol}`);
    for (const protocol of [0, 17])
      assert.equal(decide(program, NR.socket, [family, SOCK.DGRAM | SOCK.CLOEXEC, protocol]), ALLOW, `dgram ${protocol}`);
    // SCTP, MPTCP, UDPLite, ICMP (ping sockets) and raw IP are all refused.
    for (const [type, protocol] of [
      [SOCK.STREAM, 132],
      [SOCK.STREAM, 262],
      [SOCK.DGRAM, 136],
      [SOCK.DGRAM, 1],
      [SOCK.DGRAM, 58],
      [SOCK.STREAM, 255],
    ]) {
      assert.equal(decide(program, NR.socket, [family, type, protocol]), EPERM, `type ${type} protocol ${protocol}`);
    }
  }
  assert.equal(decide(program, NR.socket, [AF.UNIX, SOCK.STREAM, 0]), ALLOW);
});

test('a prepared launch is immutable and its registration cannot be forged from an editable record', (context) => {
  const { policy } = fixture(context, { profile: 'P1' });
  const launch = prepareIsolatedExecution(policy, ['/usr/bin/true']);
  assert.equal(Object.isFrozen(launch) && Object.isFrozen(launch.args), true);
  assert.throws(() => {
    launch.profile = 'P0';
  }, TypeError);
  assert.throws(() => launch.args.push('--share-net'), TypeError);
  assert.equal(launch.profile, 'P1');
  assert.throws(() => registerLaunch({ ...launch }), /immutable/);
  assert.throws(() => registerLaunch(Object.freeze({ ...launch, args: [...launch.args] })), /immutable/);
  assert.throws(() => registerLaunch(Object.freeze({ ...launch, args: Object.freeze([...launch.args]), profile: 'P9' })), /immutable/);
});

test('the broker socket is revalidated at launch: a swap, a symlink or a removal refuses the launch', async (context) => {
  const base = fixture(context);
  const socketPath = await broker(context, base.main);
  const policy = createIsolationPolicy({ ...base.input, profile: 'P2', broker_socket: socketPath });
  assert.doesNotThrow(() => prepareIsolatedExecution(policy, ['/usr/bin/true']));
  const drift = () =>
    assert.throws(
      () => prepareIsolatedExecution(policy, ['/usr/bin/true']),
      (error) => error.code === 'AGENT_ISOLATION_BINDING_DRIFT',
    );

  const other = path.join(base.main, 'other.sock');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(other, resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const parked = `${socketPath}.parked`;
  fs.renameSync(socketPath, parked);
  fs.symlinkSync(other, socketPath);
  drift();
  fs.rmSync(socketPath);
  fs.renameSync(other, socketPath);
  drift();
  fs.renameSync(socketPath, `${socketPath}.moved`);
  fs.renameSync(parked, socketPath);
  assert.doesNotThrow(() => prepareIsolatedExecution(policy, ['/usr/bin/true']), 'the original socket is accepted again');
  fs.rmSync(socketPath);
  drift();
});

test('an unreadable directory made by the plugin cannot keep the artifact channel from being removed', (context) => {
  const channel = createArtifactChannel({
    limits: { max_files: 2, max_file_bytes: 4096, max_total_bytes: 8192 },
    media_types: ['text/plain'],
  });
  context.after(() => channel.dispose());
  const nested = path.join(channel.directory, 'd', 'e');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'f'), 'x');
  fs.symlinkSync('/tmp', path.join(channel.directory, 'd', 'link'));
  fs.chmodSync(nested, 0);
  fs.chmodSync(path.join(channel.directory, 'd'), 0);
  assert.throws(
    () => channel.verify('[]'),
    (error) => error.code === 'ARTIFACT_MANIFEST_DIVERGED',
    'unreadable content is a divergence, not an I/O fault',
  );
  fs.chmodSync(channel.directory, 0);
  assert.throws(
    () => channel.verify('[]'),
    (error) => error.code === 'ARTIFACT_MANIFEST_DIVERGED',
  );
  assert.deepEqual(channel.dispose(), { disposed: true });
  assert.equal(fs.existsSync(channel.directory), false);
  assert.equal(fs.existsSync('/tmp'), true, 'links inside the channel are never followed');
  assert.deepEqual(channel.dispose(), { disposed: true });
});

test('a channel that cannot be removed reports the failure instead of throwing', (context) => {
  const channel = createArtifactChannel({ limits: { max_files: 1, max_file_bytes: 10, max_total_bytes: 10 }, media_types: ['text/plain'] });
  const original = fs.rmSync;
  mock.method(fs, 'rmSync', () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  });
  context.after(() => {
    mock.restoreAll();
    original(channel.directory, { recursive: true, force: true });
  });
  assert.deepEqual(channel.dispose(), { disposed: false, code: 'EACCES' });
  mock.restoreAll();
  mock.method(fs, 'rmSync', () => {
    throw new Error('no code');
  });
  assert.deepEqual(channel.dispose(), { disposed: false, code: 'UNKNOWN' });
});

async function terminalFixture(t, script, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-terminal-profile-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(root, 'private'), 'protected');
  fs.writeFileSync(path.join(workspace, 'main.py'), script);
  const policy = createIsolationPolicy({
    backend: 'bwrap',
    host_workspace: workspace,
    main_checkout: root,
    protected_paths: [path.join(root, 'private')],
    ...options.policy,
  });
  const frames = [];
  const terminal = startIsolatedTerminal({
    policy,
    command: ['/usr/bin/python3', '-I', '-u', 'main.py'],
    mode: 'job',
    timeout_ms: 5000,
    max_output_bytes: 4096,
    onOutput: (frame) => frames.push(frame),
    ...options.start,
  });
  t.after(async () => {
    await terminal.terminate().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  await terminal.ready;
  return { terminal, frames, text: () => frames.map((frame) => Buffer.from(frame.data, 'base64').toString()).join('') };
}

test('terminals take the profile from the policy and per-call limits, accept input and drain their group', async (context) => {
  const { terminal, text } = await terminalFixture(context, 'import sys\nprint(sys.stdin.read().upper(), flush=True)\n', {
    policy: { profile: 'P1' },
    start: { limits: { pids_max: 64, memory_max_bytes: 536_870_912 } },
  });
  assert.equal(fs.readFileSync(path.join(terminal.group, 'pids.max'), 'utf8').trim(), '64');
  assert.equal((await terminal.command('input', { data: Buffer.from('hello').toString('base64') })).bytes, 5);
  await terminal.command('eof');
  assert.equal((await terminal.completion).status, 'succeeded');
  assert.equal(text(), 'HELLO\n');
  assert.equal(fs.existsSync(terminal.group), false);
});

test('a PTY terminal reports its size and resizes; the host runtime descriptor stays read-only', async (context) => {
  const pty = await terminalFixture(
    context,
    'import os,sys\nprint(os.isatty(0), flush=True)\nsys.stdin.readline()\nprint(os.get_terminal_size(0), flush=True)\n',
    {
      start: { mode: 'pty' },
    },
  );
  const deadline = Date.now() + 5000;
  while (!pty.text().includes('True') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  await pty.terminal.command('resize', { rows: 40, cols: 100 });
  await pty.terminal.command('input', { data: Buffer.from('go\n').toString('base64') });
  assert.equal((await pty.terminal.completion).status, 'succeeded');
  assert.match(pty.text(), /columns=100, lines=40/);
  const node = await terminalFixture(context, '', {
    start: { host_node: true, command: ['/usr/bin/node', '-e', 'console.log(process.version)'] },
  });
  assert.equal((await node.terminal.completion).status, 'succeeded');
  assert.ok(node.text().includes(process.version));
});

test('terminal limits, forged policies, failed preparation and unknown control actions all fail closed', async (context) => {
  for (const start of [
    { mode: 'shell' },
    { rows: 0 },
    { cols: 501 },
    { timeout_ms: 0 },
    { max_output_bytes: 65_537 },
    { limits: { pids_max: 8 } },
  ]) {
    assert.throws(() =>
      startIsolatedTerminal({
        policy: {},
        command: ['/bin/true'],
        mode: 'job',
        timeout_ms: 10,
        max_output_bytes: 10,
        onOutput() {},
        ...start,
      }),
    );
  }
  assert.throws(
    () => startIsolatedTerminal({ policy: {}, command: ['/bin/true'], mode: 'job', timeout_ms: 10, max_output_bytes: 10, onOutput() {} }),
    /not supervisor-owned/,
  );
  let created;
  await assert.rejects(
    terminalFixture(context, 'print(1)', {
      start: {
        onPrepared: (group) => {
          created = group;
          throw new Error('intent persistence lost');
        },
      },
    }),
    /intent persistence lost/,
  );
  const deadline = Date.now() + 5000;
  while (fs.existsSync(created) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(created), false);
  const bad = await terminalFixture(context, 'import time\ntime.sleep(30)');
  await assert.rejects(bad.terminal.command('unsupported'));
  await assert.rejects(bad.terminal.completion, { code: 'ENGINEERING_TERMINAL_UNCERTAIN' });
  const flood = await terminalFixture(context, 'while True: print("x"*1000,flush=True)', { start: { max_output_bytes: 100 } });
  assert.equal((await flood.terminal.completion).status, 'output_limit');
  const slow = await terminalFixture(context, 'import time\ntime.sleep(30)', { start: { timeout_ms: 300 } });
  assert.equal((await slow.terminal.completion).status, 'timed_out');
});

test('a forged or edited launch is refused before it can be run, probed or granted the browser flag', (context) => {
  const { policy } = fixture(context, { profile: 'P1' });
  const real = prepareIsolatedExecution(policy, ['/usr/bin/true']);
  assert.ok(verifiedSeccomp(real).equals(real.seccomp));
  assert.notEqual(verifiedSeccomp(real), real.seccomp, 'callers get a private copy');
  // A record with the right shape and an empty filter registers (in-process trust) but is never used.
  const forged = registerLaunch(
    Object.freeze({ ...real, args: Object.freeze([...real.args]), seccomp: Buffer.alloc(real.seccomp.length) }),
  );
  const drift = (action) => assert.throws(action, (error) => error.code === 'AGENT_ISOLATION_BINDING_DRIFT');
  drift(() => verifiedSeccomp(forged));
  drift(() => chromiumSandboxFlags(forged));
  drift(() => runProfileProbe(forged));
  const other = registerLaunch(
    Object.freeze({ ...real, args: Object.freeze([...real.args]), seccomp: Buffer.from(seccompNetworklessProgram()) }),
  );
  drift(() => verifiedSeccomp(other));
  // Editing the buffer of a genuine launch after registration is caught the same way.
  const edited = prepareIsolatedExecution(policy, ['/usr/bin/true']);
  edited.seccomp[0] ^= 0xff;
  drift(() => verifiedSeccomp(edited));
  drift(() => chromiumSandboxFlags(edited));
  assert.throws(() => verifiedSeccomp(null), IsolationProfileError);
  assert.throws(
    () => verifiedSeccomp({ profile: 'P1', seccomp: 'text' }),
    (error) => error.code === 'AGENT_ISOLATION_BINDING_DRIFT',
  );
});
