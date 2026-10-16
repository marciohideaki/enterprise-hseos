'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { before, after, test } = require('node:test');

const environment = require('../packages/agent-environment');
const host = require('../packages/agent-environment/dap-host');
const { createFrameParser, encodeMessage } = require('../packages/agent-environment/framing');
const { executeIsolatedCommand } = require('../packages/agent-isolation-attestation/executor');
const { createIsolationPolicy } = require('../packages/agent-isolation-attestation');
const pins = require('../tools/lib/environment-toolchain-pins');

const CACHE = process.env.HSEOS_TOOLCHAIN_CACHE || '/build/cache/hseos-toolchain';
const FIXTURE = path.join(__dirname, 'fixtures', 'dap', 'workspace');
const scratch = [];
let toolchain;

function temp(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(directory);
  return directory;
}

before(() => {
  toolchain = environment.prepareDapToolchain({
    install: environment.loadPins().installToolchain,
    cacheDirectory: CACHE,
    destination: temp('hseos-dap-toolchain-'),
  });
  assert.equal(toolchain.status, 'ready', 'the pinned toolchain cache must be provisioned for the real-adapter acceptance');
});

after(() => {
  for (const directory of scratch) fs.rmSync(directory, { recursive: true, force: true });
});

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    if (entry.isDirectory()) copyTree(from, path.join(target, entry.name));
    else fs.copyFileSync(from, path.join(target, entry.name));
  }
}

function workspace(extra = () => {}) {
  const main = temp('hseos-dap-main-');
  const root = path.join(main, 'workspace');
  copyTree(FIXTURE, root);
  fs.writeFileSync(path.join(main, 'protected'), 'protected');
  fs.writeFileSync(path.join(main, 'outside.py'), 'x = 1\n');
  fs.writeFileSync(path.join(main, 'outside.js'), 'const x = 1;\n');
  extra(root, main);
  return { main, root };
}

function policyFor({ main, root }, profile = 'P1') {
  return createIsolationPolicy({
    backend: 'bwrap',
    host_workspace: root,
    main_checkout: main,
    protected_paths: [path.join(main, 'protected')],
    profile,
    toolchain_roots: [toolchain.root],
  });
}

function hashTree(directory) {
  const hash = createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      hash.update(`${path.relative(directory, full)}\0${fs.lstatSync(full).mode}\0`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(fs.readFileSync(full));
    }
  };
  walk(directory);
  return hash.digest('hex');
}

function realService(spaces, extra = {}, profile = 'P1') {
  const events = [];
  const service = environment.createDefaultDapService({
    policy: policyFor(spaces, profile),
    toolchain,
    ledger: (event) => events.push(event),
    ...extra,
  });
  return { service, events };
}

const FILES = { python: 'app.py', node: 'app.js' };

/** Every process whose command line mentions the marker, read from /proc (the kernel's view, not the executor's). */
function processesMentioning(marker) {
  const found = [];
  for (const entry of fs.readdirSync('/proc').filter((name) => /^[0-9]+$/.test(name))) {
    try {
      if (fs.readFileSync(`/proc/${entry}/cmdline`, 'latin1').includes(marker)) found.push(Number(entry));
    } catch {
      // The process ended while it was being read.
    }
  }
  return found.filter((pid) => pid !== process.pid);
}

/** Resource groups left behind by this process's executor, read from the delegated cgroup parent. */
function leftoverGroups() {
  const current = path.join('/sys/fs/cgroup', fs.readFileSync('/proc/self/cgroup', 'utf8').trim().slice(3));
  return fs.readdirSync(path.dirname(current)).filter((name) => name.startsWith(`hseos-executor-${process.pid}-`));
}

// ---------------------------------------------------------------------------------------------------------------
// Real adapters (debugpy 1.8.22, js-debug 1.140.0) inside the sandbox: breakpoints, stack, variables, step, end.
// ---------------------------------------------------------------------------------------------------------------

for (const runtime of ['python', 'node']) {
  test(`real ${runtime} adapter: breakpoint, stack, variables, step and termination, workspace untouched`, async () => {
    const spaces = workspace();
    const { service, events } = realService(spaces);
    const before = hashTree(spaces.root);
    const file = FILES[runtime];
    const output = await service.run({
      runtime,
      launch: { program: file },
      breakpoints: [{ file, line: 2 }],
      steps: [{ op: 'next' }, { op: 'continue' }],
      capture: { stack: true, variables_depth: 1 },
    });
    assert.equal(output.status, 'ok', JSON.stringify(output));
    const [first, second] = output.result.stops;
    assert.equal(output.result.stops.length, 2);
    assert.equal(first.reason, 'breakpoint');
    assert.deepEqual([first.stack[0].path, first.stack[0].line, first.stack[0].external], [file, 2, false]);
    assert.match(first.stack[0].name, /add/);
    const locals = first.scopes[0].variables;
    assert.deepEqual(
      locals.filter((item) => ['a', 'b'].includes(item.name)).map((item) => [item.name, item.value]),
      [
        ['a', '1'],
        ['b', '2'],
      ],
    );
    assert.equal(second.reason, 'step');
    assert.equal(second.stack[0].line, 3, 'next moved to the following line');
    // Stepping reached `total`, so the new local is visible; the run then continued to the end.
    assert.ok(second.scopes[0].variables.some((item) => item.name === 'total'));
    assert.equal(output.result.terminated, true);
    assert.match(output.result.output.text, /result 3/);
    assert.equal(hashTree(spaces.root), before, 'workspace hash is identical before and after');
    assert.equal(output.source.authority, 'data');
    assert.equal(output.source.provenance.origin, 'dap');
    assert.equal(output.source.provenance.trust, 'untrusted');
    assert.match(output.source.provenance.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(output.execution.profile, 'P1');
    assert.equal(output.execution.workspace_access, 'read_only');
    assert.equal(output.execution.descendants_terminated, true);
    assert.ok(
      output.execution.pids_peak >= 2 && output.execution.pids_peak < output.execution.limits.processes,
      `pids_peak ${output.execution.pids_peak} of ${output.execution.limits.processes}`,
    );
    assert.equal(events.at(-1).type, 'environment.dap.completed');
    assert.equal(environment.DAP_OUTPUT_SCHEMA.safeParse(output).success, true);
    console.log(`measured ${runtime}: pids_peak=${output.execution.pids_peak} memory_peak_bytes=${output.execution.memory_peak_bytes}`);
  });
}

test('real adapters: stepIn, stepOut, depth 2 children, a program without breakpoints, a module launch and stack-less capture', async () => {
  const spaces = workspace();
  const { service } = realService(spaces);
  const python = await service.run({
    runtime: 'python',
    launch: { program: 'app.py' },
    breakpoints: [{ file: 'app.py', line: 7 }],
    steps: [{ op: 'stepIn' }, { op: 'stepOut' }],
    capture: { stack: true, variables_depth: 2 },
  });
  assert.equal(python.status, 'ok', JSON.stringify(python));
  assert.equal(python.result.stops[1].stack[0].name, 'add', 'stepIn entered the function');
  assert.ok(
    python.result.stops[0].scopes.some((scope) => scope.variables.some((item) => item.children)),
    'depth 2 expands structured values',
  );
  const finished = await service.run({ runtime: 'python', launch: { program: 'tail.py' } });
  assert.deepEqual(
    [finished.status, finished.result.stops.length, finished.result.terminated, finished.result.reason],
    ['ok', 0, true, 'completed'],
  );
  assert.match(finished.result.output.text, /tick 2/);
  const module = await service.run({
    runtime: 'python',
    launch: { module: 'pkg.mod', args: ['one', 'two'] },
    breakpoints: [{ file: 'pkg/mod.py', line: 4 }],
    steps: [],
    capture: { stack: false, variables_depth: 0 },
  });
  assert.equal(module.status, 'ok', JSON.stringify(module));
  assert.deepEqual(
    module.result.stops.map((stop) => [stop.reason, stop.stack.length, stop.scopes.length]),
    [['breakpoint', 0, 0]],
  );
  const inDirectory = await service.run({
    runtime: 'node',
    launch: { program: 'app.js', cwd: '.' },
    breakpoints: [{ file: '/workspace/app.js', line: 7 }],
    steps: [{ op: 'stepIn' }],
    capture: { stack: true, variables_depth: 0 },
  });
  assert.equal(inDirectory.status, 'ok', JSON.stringify(inDirectory));
  assert.equal(inDirectory.result.stops[1].stack[0].line, 2);
  assert.deepEqual(inDirectory.result.stops[0].scopes, []);
});

// ---------------------------------------------------------------------------------------------------------------
// Contract: evaluate, setVariable, setExpression, restartFrame and conditions are refused, never sent.
// ---------------------------------------------------------------------------------------------------------------

function scripted(spaces, reply, options = {}) {
  const events = [];
  const calls = [];
  const channel = {
    directory: '/unused',
    max_file_bytes: 1,
    verify: options.verify || (() => assert.fail('no artifact expected')),
    dispose: () => {},
  };
  const service = environment.createDapService({
    policy: policyFor(spaces),
    toolchain: options.toolchain || toolchain,
    ledger: (event) => events.push(event),
    createChannel: () => channel,
    now: () => new Date('2026-01-01T00:00:00Z'),
    execute: async (call) => {
      calls.push(call);
      return typeof reply === 'function' ? reply(call) : reply;
    },
  });
  return { service, events, calls };
}

const execution = (stdout, status = 'succeeded') => ({
  status,
  exit_code: status === 'succeeded' ? 0 : 1,
  stdout,
  stderr: '',
  profile: 'P1',
  limits: {},
  pids_peak: 3,
  memory_peak_bytes: 1,
  workspace_access: 'read_only',
  descendants_terminated: true,
});
const hostOk = (result) => execution(JSON.stringify({ ok: true, result }));
const rawStop = (extra = {}) => ({
  reason: 'breakpoint',
  stack: [{ name: 'f', path: '/workspace/app.py', line: 2, column: 1 }],
  scopes: [],
  ...extra,
});
const rawResult = (extra = {}) => ({
  stops: [rawStop()],
  terminated: false,
  reason: 'steps_exhausted',
  output: { text: '', truncated: false },
  ...extra,
});
const base = { runtime: 'python', launch: { program: 'app.py' } };

test('input validation refuses malformed requests, and everything that would run code in the debuggee, before anything runs', async () => {
  const spaces = workspace();
  const { service, calls, events } = scripted(spaces, hostOk(rawResult()));
  const bad = [
    null,
    [],
    { ...base, extra: 1 },
    { ...base, runtime: 'ruby' },
    { runtime: 'python' },
    { runtime: 'python', launch: null },
    { runtime: 'python', launch: { program: 'app.py', module: 'pkg.mod' } },
    { runtime: 'python', launch: {} },
    { runtime: 'node', launch: { module: 'pkg.mod' } },
    { runtime: 'python', launch: { module: 'pkg mod; rm' } },
    { runtime: 'python', launch: { program: 'app.js' } },
    { runtime: 'node', launch: { program: 'app.py' } },
    { runtime: 'python', launch: { program: '' } },
    { runtime: 'python', launch: { program: 'app.py', cwd: 5 } },
    { runtime: 'python', launch: { program: 'app.py', args: 'x' } },
    { runtime: 'python', launch: { program: 'app.py', args: Array.from({ length: 17 }).fill('x') } },
    { runtime: 'python', launch: { program: 'app.py', args: [1] } },
    { ...base, breakpoints: 'x' },
    { ...base, breakpoints: Array.from({ length: 21 }).fill({ file: 'app.py', line: 1 }) },
    { ...base, breakpoints: [{ file: 'app.py', line: 0 }] },
    { ...base, breakpoints: [{ file: 'app.js', line: 1 }] },
    { ...base, breakpoints: [{ file: 'app.py', line: 1, condition: 'os.system("x")' }] },
    { ...base, breakpoints: [{ file: 'app.py', line: 1, hitCondition: '1' }] },
    { ...base, breakpoints: [{ file: 'app.py', line: 1, logMessage: '{x}' }] },
    { ...base, steps: 'x' },
    { ...base, steps: Array.from({ length: 21 }).fill({ op: 'next' }) },
    { ...base, steps: [{ op: 'evaluate' }] },
    { ...base, steps: [{ op: 'setVariable' }] },
    { ...base, steps: [{ op: 'setExpression' }] },
    { ...base, steps: [{ op: 'restartFrame' }] },
    { ...base, steps: [{ op: 'next', expression: '1+1' }] },
    { ...base, evaluate: '1+1' },
    { ...base, capture: { stack: true, variables_depth: 3 } },
    { ...base, capture: { stack: 'yes', variables_depth: 1 } },
    { ...base, capture: { stack: true, variables_depth: 1, evaluate: true } },
    { ...base, timeout_ms: 10 },
    { ...base, timeout_ms: 1_000_000 },
    { ...base, timeout_ms: 1.5 },
  ];
  for (const input of bad) assert.equal((await service.run(input)).code, 'ENV_DAP_INPUT_INVALID', JSON.stringify(input));
  assert.equal(calls.length, 0, 'nothing reached the sandbox');
  assert.equal(events.length, bad.length);
  assert.equal(environment.DAP_INPUT_SCHEMA.safeParse(base).success, true);
  assert.equal(environment.DAP_INPUT_SCHEMA.safeParse({ ...base, steps: [{ op: 'evaluate' }] }).success, false);
  assert.equal(environment.DAP_OUTPUT_SCHEMA.safeParse({}).success, false);
  assert.equal(environment.parseDapInput(base).data.timeout_ms, 30_000);
});

/** A minimal DAP server on loopback: records every request and answers success, so the allow-list is observable. */
async function loopbackServer(handler) {
  const received = [];
  const sockets = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    const parser = createFrameParser();
    socket.on('data', (chunk) => {
      for (const message of parser.push(chunk)) {
        received.push(message);
        handler(message, socket);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  return { port: server.address().port, received, close, sockets };
}

test('the host client only ever sends allow-listed requests: evaluate, setVariable, setExpression, restartFrame never reach the wire', async () => {
  const answer = (message, socket) =>
    socket.write(
      encodeMessage({
        seq: 1,
        type: 'response',
        request_seq: message.seq,
        command: message.command,
        success: message.command !== 'fail',
        body: {},
      }),
    );
  const server = await loopbackServer(answer);
  const reverse = [];
  const socket = net.connect(server.port, '127.0.0.1');
  await new Promise((resolve) => socket.once('connect', resolve));
  const client = host.createClient({
    socket,
    onEvent: () => {},
    onReverseRequest: (message) => (reverse.push(message.command), message.command === 'startDebugging'),
  });
  try {
    for (const command of [
      'evaluate',
      'setVariable',
      'setExpression',
      'restartFrame',
      'completions',
      'source',
      'setFunctionBreakpoints',
      'setExceptionBreakpoints',
      'dataBreakpointInfo',
      'modules',
      'goto',
      'runInTerminal',
      'terminate',
    ]) {
      await assert.rejects(client.request(command, {}), { code: 'ENV_DAP_FORBIDDEN_REQUEST' }, command);
    }
    assert.equal(server.received.length, 0, 'none of them was sent');
    await client.request('threads', {});
    assert.deepEqual(
      server.received.map((message) => message.command),
      ['threads'],
    );
    for (const command of host.ALLOWED_REQUESTS) assert.ok(!['evaluate', 'setVariable', 'setExpression', 'restartFrame'].includes(command));
    await assert.rejects(client.request('fail', {}), { code: 'ENV_DAP_FORBIDDEN_REQUEST' });
    // Reverse requests: only startDebugging is honoured (and only for node); anything that would run code is answered with a refusal.
    server.sockets[0].write(encodeMessage({ seq: 9, type: 'request', command: 'runInTerminal', arguments: {} }));
    server.sockets[0].write(encodeMessage({ seq: 10, type: 'request', command: 'startDebugging', arguments: {} }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(reverse, ['runInTerminal', 'startDebugging']);
    const replies = server.received.filter((message) => message.type === 'response');
    assert.deepEqual(
      replies.map((reply) => [reply.command, reply.success]),
      [
        ['runInTerminal', false],
        ['startDebugging', true],
      ],
    );
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assert.rejects(client.request('threads', {}), { code: 'ENV_DAP_ADAPTER_EXITED' });
  } finally {
    // A failed assertion must not leave the loopback server or the client socket holding the runner open.
    server.close();
    client.destroy();
  }
});

test('the host client reports a failed response, a framing violation and a vanished adapter with stable codes', async () => {
  const run = async (script) => {
    const server = await loopbackServer(script);
    const socket = net.connect(server.port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    const client = host.createClient({ socket, onEvent: () => {}, onReverseRequest: () => false });
    try {
      return await client.request('threads', {});
    } catch (error) {
      return error.code;
    } finally {
      server.close();
      client.destroy();
    }
  };
  assert.equal(
    await run((message, socket) => socket.write(encodeMessage({ seq: 1, type: 'response', request_seq: message.seq, success: false }))),
    'ENV_DAP_ADAPTER_ERROR',
  );
  assert.equal(await run((message, socket) => socket.write('garbage\r\n\r\n')), 'ENV_DAP_PROTOCOL');
  assert.equal(await run((message, socket) => socket.destroy()), 'ENV_DAP_ADAPTER_EXITED');
  assert.deepEqual(
    await run((message, socket) => socket.write(encodeMessage({ seq: 1, type: 'response', request_seq: message.seq, success: true }))),
    {},
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Scope: breakpoints, program and cwd must resolve inside /workspace, exactly as the kernel resolves them.
// ---------------------------------------------------------------------------------------------------------------

test('files outside the root (.., absolute, symlink, encoded) are refused as ENV_DAP_OUT_OF_SCOPE and recorded, without a sandbox', async () => {
  const spaces = workspace((root, main) => {
    fs.symlinkSync(path.join(main, 'outside.py'), path.join(root, 'link.py'));
    fs.symlinkSync(path.join(root, 'app.py'), path.join(root, 'inside.py'));
    fs.mkdirSync(path.join(main, 'outside-dir'));
    fs.symlinkSync(path.join(main, 'outside-dir'), path.join(root, 'linkdir'));
    fs.symlinkSync(path.join(main, 'not-yet.py'), path.join(root, 'dangling.py'));
    fs.mkdirSync(path.join(root, 'dir.py'));
  });
  const { service, calls, events } = scripted(spaces, hostOk(rawResult()));
  const outside = [
    '../outside.py',
    'sub/../../outside.py',
    '%2e%2e/outside.py',
    '..%2foutside.py',
    String.raw`..\outside.py`,
    path.join(spaces.main, 'outside.py'),
    '/etc/passwd.py',
    '/workspacefoo/app.py',
    '/workspace/../etc/passwd.py',
    'link.py',
    'linkdir/new.py',
    'linkdir/deeper/still/new.py',
    'dangling.py',
  ];
  for (const file of outside) {
    const asBreakpoint = await service.run({ ...base, breakpoints: [{ file, line: 1 }] });
    assert.deepEqual([asBreakpoint.status, asBreakpoint.code], ['refused', 'ENV_DAP_OUT_OF_SCOPE'], `breakpoint ${file}`);
    const asProgram = await service.run({ runtime: 'python', launch: { program: file } });
    assert.deepEqual([asProgram.status, asProgram.code], ['refused', 'ENV_DAP_OUT_OF_SCOPE'], `program ${file}`);
  }
  for (const cwd of ['..', '../', '/', '/etc', 'linkdir', path.join(spaces.main, 'outside-dir')]) {
    assert.equal((await service.run({ ...base, launch: { program: 'app.py', cwd } })).code, 'ENV_DAP_OUT_OF_SCOPE', `cwd ${cwd}`);
  }
  assert.equal(calls.length, 0);
  assert.equal(events.filter((event) => event.code === 'ENV_DAP_OUT_OF_SCOPE').length, outside.length * 2 + 6);
  assert.equal((await service.run({ ...base, breakpoints: [{ file: 'missing.py', line: 1 }] })).code, 'ENV_DAP_INPUT_INVALID');
  assert.equal((await service.run({ ...base, breakpoints: [{ file: 'dir.py', line: 1 }] })).code, 'ENV_DAP_INPUT_INVALID');
  assert.equal((await service.run({ ...base, launch: { program: 'app.py', cwd: 'app.py' } })).code, 'ENV_DAP_INPUT_INVALID');
  assert.equal((await service.run({ ...base, launch: { program: 'app.py', cwd: 'missing' } })).code, 'ENV_DAP_INPUT_INVALID');
  assert.equal(calls.length, 0);
  // A symlink that stays inside the root is allowed and is sent by its real in-root path; /workspace-absolute paths are mapped.
  const ok = await service.run({
    ...base,
    launch: { program: 'inside.py', cwd: '.' },
    breakpoints: [{ file: '/workspace/inside.py', line: 2 }],
  });
  assert.equal(ok.status, 'ok');
  const sent = JSON.parse(calls[0].command[2]);
  assert.deepEqual([sent.launch.program, sent.breakpoints[0].file, sent.launch.cwd], ['app.py', 'app.py', '.']);
  assert.deepEqual([sent.scratch, sent.root, sent.toolchain], ['/dev/shm', '/workspace', '/opt/hseos/toolchain']);
  assert.equal(
    sent.node,
    '/hseos-runtime/node',
    'the debuggee runs on the runtime the isolation layer binds, not on a guessed system path',
  );
  assert.equal(calls[0].limits.shm_bytes, 67_108_864);
  assert.equal(calls[0].timeout_ms, 40_000, 'the sandbox gets the request timeout plus a reaping grace');
});

function materialiseMatrix(root, main) {
  const abs = (...parts) => path.join(root, ...parts);
  fs.mkdirSync(path.join(main, 'outside'));
  fs.writeFileSync(path.join(main, 'outside/real.py'), '');
  fs.mkdirSync(abs('realdir'));
  fs.writeFileSync(abs('realdir/real.py'), '');
  fs.mkdirSync(abs('top'));
  const link = (name, target) => fs.symlinkSync(target, abs('top', name));
  link('d_in_abs', abs('realdir'));
  link('d_in_rel', '../realdir');
  link('d_out_abs', path.join(main, 'outside'));
  link('d_out_rel', '../../outside');
  link('f_in.py', '../realdir/real.py');
  link('f_out.py', '../../outside/real.py');
  link('pend_in_rel.py', '../realdir/none.py');
  link('pend_in_abs.py', abs('realdir/none.py'));
  link('pend_out_rel.py', '../../outside/none.py');
  link('pend_out_abs.py', path.join(main, 'outside/none.py'));
  link('pend_via_dir.py', 'd_out_rel/none.py');
  link('pend_via_dir_in.py', 'd_in_rel/none.py');
  link('pend_up.py', '../../escape.py');
  fs.writeFileSync(path.join(main, 'escape.py'), '');
  fs.mkdirSync(abs('p/q'), { recursive: true });
  fs.symlinkSync('../../top', abs('p/q/via'));
}

/** Kernel oracle: realpath if it exists; otherwise create the pending target for a moment, ask realpath, remove it. */
function oracle(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch (error) {
    assert.equal(error.code, 'ENOENT', candidate);
  }
  const createdDirectory = fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.writeFileSync(candidate, '');
  const truth = fs.realpathSync(candidate);
  fs.rmSync(truth);
  if (createdDirectory) fs.rmSync(createdDirectory, { recursive: true });
  return truth;
}

test('generated matrix: the scope verdict equals the kernel for every link/parent combination, for breakpoints, program and cwd', async () => {
  const spaces = workspace(materialiseMatrix);
  const root = fs.realpathSync(spaces.root);
  const names = ['d_in_abs', 'd_in_rel', 'd_out_abs', 'd_out_rel'];
  const relatives = [];
  for (const prefix of ['top', 'p/q/via']) {
    for (const name of names) relatives.push(`${prefix}/${name}/real.py`, `${prefix}/${name}/new.py`, `${prefix}/${name}/sub/dir/new.py`);
    for (const name of [
      'f_in.py',
      'f_out.py',
      'pend_in_rel.py',
      'pend_in_abs.py',
      'pend_out_rel.py',
      'pend_out_abs.py',
      'pend_via_dir.py',
      'pend_via_dir_in.py',
      'pend_up.py',
    ])
      relatives.push(`${prefix}/${name}`);
  }
  let outside = 0;
  let inside = 0;
  const { service, calls } = scripted(spaces, hostOk(rawResult()));
  for (const relative of relatives) {
    const truth = oracle(path.join(spaces.root, ...relative.split('/')));
    const expectedInside = truth === root || truth.startsWith(`${root}${path.sep}`);
    for (const shape of [
      (file) => ({ ...base, breakpoints: [{ file, line: 1 }] }),
      (file) => ({ runtime: 'python', launch: { program: file } }),
    ]) {
      const output = await service.run(shape(relative));
      if (expectedInside) {
        // Inside: it must be accepted when the file exists, and only then (a missing file is an input error, not a scope error).
        assert.ok(output.status === 'ok' || output.code === 'ENV_DAP_INPUT_INVALID', `${relative} -> ${truth}: ${JSON.stringify(output)}`);
        assert.equal(output.status === 'ok', fs.existsSync(truth), relative);
      } else {
        assert.equal(output.code, 'ENV_DAP_OUT_OF_SCOPE', `${relative} -> ${truth}`);
      }
    }
    if (expectedInside) inside += 1;
    else outside += 1;
  }
  assert.ok(inside >= 10 && outside >= 10, `matrix exercises both verdicts (${inside} in, ${outside} out)`);
  // The same combinations as a working directory: existing directories are checked against the kernel too.
  let cwdInside = 0;
  let cwdOutside = 0;
  for (const prefix of ['top', 'p/q/via']) {
    for (const name of names) {
      for (const relative of [`${prefix}/${name}`, `${prefix}/${name}/sub/dir`]) {
        const truth = oracle(path.join(spaces.root, ...relative.split('/')));
        const output = await service.run({ runtime: 'python', launch: { program: 'app.py', cwd: relative } });
        if (truth === root || truth.startsWith(`${root}${path.sep}`)) {
          cwdInside += 1;
          assert.equal(
            output.status === 'ok',
            fs.existsSync(truth) && fs.statSync(truth).isDirectory(),
            `${relative} -> ${truth}: ${JSON.stringify(output)}`,
          );
          if (output.status !== 'ok') assert.equal(output.code, 'ENV_DAP_INPUT_INVALID', relative);
        } else {
          cwdOutside += 1;
          assert.equal(output.code, 'ENV_DAP_OUT_OF_SCOPE', `${relative} -> ${truth}`);
        }
      }
    }
  }
  assert.ok(cwdInside >= 4 && cwdOutside >= 4, `cwd matrix exercises both verdicts (${cwdInside} in, ${cwdOutside} out)`);
  // Loops and chains over the hop limit are refused rather than followed.
  const { service: loops } = scripted(
    workspace((r) => {
      fs.symlinkSync('b.py', path.join(r, 'a.py'));
      fs.symlinkSync('a.py', path.join(r, 'b.py'));
    }),
    hostOk(rawResult()),
  );
  assert.equal((await loops.run({ runtime: 'python', launch: { program: 'a.py' } })).code, 'ENV_DAP_OUT_OF_SCOPE');
  // An uninspectable component fails closed: the file cannot be told apart from an escape.
  assert.notEqual(process.getuid(), 0, 'must run unprivileged');
  const locked = workspace((r) => fs.mkdirSync(path.join(r, 'closed')));
  const { service: closed } = scripted(locked, hostOk(rawResult()));
  fs.chmodSync(path.join(locked.root, 'closed'), 0o000);
  try {
    assert.equal((await closed.run({ runtime: 'python', launch: { program: 'closed/x.py' } })).code, 'ENV_DAP_OUT_OF_SCOPE');
  } finally {
    fs.chmodSync(path.join(locked.root, 'closed'), 0o700);
  }
});

test('a workspace root that is itself a symlink is resolved first: inside stays inside, escapes stay out', async () => {
  const main = temp('hseos-dap-rootlink-');
  const real = path.join(main, 'real-ws');
  copyTree(FIXTURE, real);
  fs.writeFileSync(path.join(main, 'protected'), 'protected');
  fs.writeFileSync(path.join(main, 'outside.py'), 'x = 1\n');
  const link = path.join(main, 'ws-link');
  fs.symlinkSync(real, link);
  fs.symlinkSync(path.join(link, 'app.py'), path.join(real, 'alias.py'));
  fs.symlinkSync('../ws-link/app.py', path.join(real, 'viaroot.py'));
  fs.symlinkSync(path.join(main, 'outside.py'), path.join(real, 'esc.py'));
  fs.symlinkSync('../outside.py', path.join(real, 'esc-rel.py'));
  fs.symlinkSync('../ws-link/../outside.py', path.join(real, 'esc-via.py'));
  // createIsolationPolicy itself refuses a symlinked root; the service still canonicalises defensively, so it is driven with a bare policy.
  const calls = [];
  const service = environment.createDapService({
    policy: { host_workspace: link, profile: 'P1' },
    toolchain,
    createChannel: () => ({
      directory: '/unused',
      max_file_bytes: 1,
      verify: () => assert.fail('no artifact expected'),
      dispose: () => {},
    }),
    execute: async (call) => {
      calls.push(call);
      return hostOk(rawResult());
    },
  });
  for (const file of ['app.py', 'alias.py', 'viaroot.py', '/workspace/viaroot.py']) {
    assert.equal((await service.run({ ...base, breakpoints: [{ file, line: 2 }] })).status, 'ok', file);
  }
  assert.equal(JSON.parse(calls[1].command[2]).breakpoints[0].file, 'app.py', 'an alias is sent by its real in-root path');
  for (const file of ['esc.py', 'esc-rel.py', 'esc-via.py', '../real-ws/app.py', '../ws-link/app.py', path.join(link, 'app.py')]) {
    const output = await service.run({ ...base, breakpoints: [{ file, line: 2 }] });
    assert.deepEqual([output.status, output.code], ['refused', 'ENV_DAP_OUT_OF_SCOPE'], file);
  }
  assert.equal((await service.run({ ...base, launch: { program: 'app.py', cwd: '.' } })).status, 'ok');
});

test('a breakpoint outside /workspace is refused by the real service too, and the sandbox is never entered', async () => {
  const spaces = workspace((root, main) => fs.symlinkSync(path.join(main, 'outside.js'), path.join(root, 'escape.js')));
  const { service, events } = realService(spaces);
  for (const file of ['../outside.js', 'escape.js', '/etc/hosts.js']) {
    const output = await service.run({ runtime: 'node', launch: { program: 'app.js' }, breakpoints: [{ file, line: 1 }] });
    assert.deepEqual([output.status, output.code], ['refused', 'ENV_DAP_OUT_OF_SCOPE'], file);
  }
  assert.deepEqual(new Set(events.map((event) => event.type)), new Set(['environment.dap.refused']));
});

// ---------------------------------------------------------------------------------------------------------------
// Profiles, EROFS, BLOCKED.
// ---------------------------------------------------------------------------------------------------------------

test('a P0 policy cannot host an adapter and is reported as blocked, with the real denial as evidence', async () => {
  const spaces = workspace();
  const { service, events } = realService(spaces, {}, 'P0');
  const output = await service.run({ ...base });
  assert.deepEqual([output.status, output.code], ['blocked', 'ENV_DAP_PROFILE_INSUFFICIENT']);
  assert.equal(events.at(-1).type, 'environment.dap.blocked');
  // The reason, observed in the sandbox: P0 forbids a child with pipes (spawn EPERM) and loopback sockets; P1 allows them.
  const probe =
    "const c=require('child_process').spawn('/usr/bin/cat',[],{stdio:['pipe','pipe','ignore']});c.on('error',e=>console.log('ERR',e.code));c.stdout.on('data',d=>{console.log('ECHO',String(d));c.kill()});c.stdin.write('hi')";
  const outcome = (profile) =>
    executeIsolatedCommand({
      policy: policyFor(workspace(), profile),
      command: ['/usr/bin/node', '-e', probe],
      host_node: true,
      timeout_ms: 20_000,
      max_output_bytes: 65_536,
    });
  const p0 = await outcome('P0');
  assert.equal(p0.status, 'failed');
  assert.match(p0.stderr, /spawn EPERM/);
  console.log(`P0 evidence: status=${p0.status} stderr=${JSON.stringify(p0.stderr.split('\n')[0])}`);
  const p1 = await outcome('P1');
  assert.equal(p1.status, 'succeeded');
  assert.match(p1.stdout, /ECHO hi/);
});

test('the sandbox really mounts the workspace and the toolchain read-only (EROFS), and the scratch tmpfs stays writable', async () => {
  const spaces = workspace();
  const policy = policyFor(spaces);
  const before = hashTree(spaces.root);
  const attempt = (target) =>
    executeIsolatedCommand({
      policy,
      command: ['/usr/bin/python3', '-I', '-c', `open(${JSON.stringify(target)}, 'w').write('x')`],
      timeout_ms: 20_000,
      max_output_bytes: 65_536,
      readonly_mounts: [{ source: toolchain.root, target: '/opt/hseos/toolchain' }],
    });
  for (const target of ['/workspace/created-by-debuggee.txt', '/workspace/app.py', '/opt/hseos/toolchain/host/dap-host.js']) {
    const result = await attempt(target);
    assert.equal(result.status, 'failed', target);
    assert.match(result.stderr, /Read-only file system/, target);
  }
  assert.equal(hashTree(spaces.root), before);
  const writable = await executeIsolatedCommand({
    policy,
    command: ['/usr/bin/python3', '-I', '-c', "open('/dev/shm/ok', 'w').write('x')"],
    timeout_ms: 20_000,
    max_output_bytes: 65_536,
    limits: { shm_bytes: 67_108_864 },
  });
  assert.equal(writable.status, 'succeeded');
});

test('a missing toolchain, pin or adapter is BLOCKED with its cause, never an empty result', async () => {
  const spaces = workspace();
  const input = { ...base };
  const unready = scripted(spaces, hostOk({}), {
    toolchain: { status: 'blocked', code: 'ENV_TOOLCHAIN_ARTIFACT_MISSING', cause: 'artifact for debugpy is absent' },
  });
  const blockedOutput = await unready.service.run(input);
  assert.deepEqual(
    [blockedOutput.status, blockedOutput.code, blockedOutput.cause],
    ['blocked', 'ENV_TOOLCHAIN_ARTIFACT_MISSING', 'artifact for debugpy is absent'],
  );
  for (const runtime of ['python', 'node']) {
    const absent = scripted(spaces, hostOk({}), { toolchain: { status: 'ready', root: temp('hseos-dap-empty-') } });
    const output = await absent.service.run({ runtime, launch: { program: FILES[runtime] } });
    assert.deepEqual([output.status, output.code], ['blocked', 'ENV_DAP_ADAPTER_UNAVAILABLE'], runtime);
    assert.equal(absent.calls.length, 0);
  }
  for (const code of ['ENV_DAP_ADAPTER_UNAVAILABLE', 'ENV_DAP_ADAPTER_EXITED']) {
    const exited = scripted(spaces, execution(JSON.stringify({ ok: false, code }), 'failed'));
    assert.equal((await exited.service.run(input)).status, 'blocked');
  }
  const missing = environment.prepareDapToolchain({
    install: () => {
      throw Object.assign(new Error('cache is not configured'), { code: 'ENV_TOOLCHAIN_CACHE_UNSET' });
    },
    destination: temp('hseos-dap-blocked-'),
  });
  assert.deepEqual([missing.status, missing.code], ['blocked', 'ENV_TOOLCHAIN_CACHE_UNSET']);
  const generic = environment.prepareDapToolchain({
    install: () => {
      throw new Error('boom');
    },
    destination: temp('hseos-dap-blocked-'),
  });
  assert.equal(generic.code, 'ENV_TOOLCHAIN_BLOCKED');
  // The real cache with the adapter removed: a real BLOCKED from a real service.
  const stripped = temp('hseos-dap-stripped-');
  copyTree(toolchain.root, stripped);
  fs.rmSync(path.join(stripped, 'js-debug'), { recursive: true });
  const { service, events } = realService(spaces, { toolchain: { ...toolchain, root: stripped } });
  const real = await service.run({ runtime: 'node', launch: { program: 'app.js' } });
  assert.deepEqual([real.status, real.code], ['blocked', 'ENV_DAP_ADAPTER_UNAVAILABLE']);
  assert.equal(events.at(-1).type, 'environment.dap.blocked');
});

test('executor failures and unreadable host output are refused with a stable code, and the drain evidence is kept', async () => {
  const spaces = workspace();
  for (const [reply, code] of [
    [execution('', 'timed_out'), 'ENV_DAP_TIMED_OUT'],
    [execution('not json'), 'ENV_DAP_OUTPUT_INVALID'],
    [execution(JSON.stringify({ ok: false, code: 'ENV_DAP_TIMEOUT' }), 'failed'), 'ENV_DAP_TIMEOUT'],
    [execution(JSON.stringify({ ok: false }), 'failed'), 'ENV_DAP_FAILED'],
  ]) {
    const output = await scripted(spaces, reply).service.run(base);
    assert.deepEqual([output.status, output.code], ['refused', code]);
    assert.deepEqual(output.execution, { descendants_terminated: true, pids_peak: 3 });
  }
  const undrained = await scripted(spaces, { ...execution('', 'timed_out'), descendants_terminated: undefined }).service.run(base);
  assert.equal(undrained.execution.descendants_terminated, false);
});

test('a large host result arrives through the artifact channel and only a verified manifest is accepted', async () => {
  const spaces = workspace();
  const body = Buffer.from(JSON.stringify({ ok: true, result: rawResult({ reason: 'from the artifact' }) }));
  const manifest = JSON.stringify([{ path: '/artifacts/result.json', media_type: 'application/json', bytes: body.length, sha256: 'x' }]);
  let verified;
  const good = scripted(spaces, execution(manifest), {
    verify: (text) => {
      verified = text;
      return [{ content: body }];
    },
  });
  assert.equal((await good.service.run(base)).result.reason, 'from the artifact');
  assert.equal(verified, manifest);
  const diverged = scripted(spaces, execution(manifest), {
    verify: () => {
      throw new Error('digest diverges');
    },
  });
  assert.equal((await diverged.service.run(base)).code, 'ENV_DAP_OUTPUT_INVALID');
});

test('results are normalised: paths are root-relative or withheld, values are truncated with a marker, malformed results are refused', async () => {
  const spaces = workspace((root, main) => fs.symlinkSync(path.join(main, 'outside.py'), path.join(root, 'escape.py')));
  const long = 'x'.repeat(2000);
  const frames = [
    { name: 'in', path: '/workspace/app.py', line: 2, column: 1 },
    { name: 'link', path: '/workspace/escape.py', line: 1, column: 1 },
    { name: 'etc', path: '/etc/passwd', line: 1, column: 1 },
    { name: 'dotdot', path: '/workspace/../etc/passwd', line: 1, column: 1 },
    { name: 'internal', path: '<node_internals>/loader', line: 1, column: 1 },
    { name: 'native', line: 1, column: null },
    { name: long, path: '/workspace/app.py', line: 9, column: null },
  ];
  const scope = {
    name: 'Locals',
    variables: [
      { name: 'v', value: long, type: 'str', truncated: true },
      { name: 'n', value: '1', type: null, children: { variables: [{ name: 'c', value: '2', type: 'int' }], total: 1, truncated: false } },
    ],
    total: 120,
    truncated: true,
  };
  const output = await scripted(
    spaces,
    hostOk(
      rawResult({
        stops: [rawStop({ stack: frames, scopes: [scope], stack_truncated: true })],
        output: { text: 'out', truncated: true },
        terminated: true,
      }),
    ),
  ).service.run({ ...base, capture: { stack: true, variables_depth: 2 } });
  assert.equal(output.status, 'ok', JSON.stringify(output));
  const [stop] = output.result.stops;
  assert.deepEqual(
    stop.stack.map((frame) => [frame.path, frame.external]),
    [
      ['app.py', false],
      [null, true],
      [null, true],
      [null, true],
      [null, true],
      [null, false],
      ['app.py', false],
    ],
  );
  assert.equal(stop.stack_truncated, true);
  assert.deepEqual([stop.stack[6].name.length, stop.stack[6].name_truncated, stop.stack[6].name_original_length], [256, true, 2000]);
  assert.equal(stop.stack[0].name_truncated, undefined, 'an uncut name carries no marker');
  const [variable, structured] = stop.scopes[0].variables;
  assert.deepEqual([variable.truncated, variable.original_length], [true, 2000]);
  assert.ok(variable.value.endsWith('[truncated]') && variable.value.length < 600);
  assert.deepEqual([structured.type, structured.children.variables[0].value, structured.children.total], [null, '2', 1]);
  assert.deepEqual([stop.scopes[0].total, stop.scopes[0].truncated], [120, true]);
  assert.deepEqual([output.result.output, output.result.terminated], [{ text: 'out', truncated: true }, true]);
  const plain = await scripted(
    spaces,
    hostOk(rawResult({ stops: [rawStop({ stack: [], scopes: [{ name: 's', variables: [{ name: 'k', value: 'v' }] }] })] })),
  ).service.run(base);
  assert.deepEqual(
    [plain.result.stops[0].scopes[0].total, plain.result.stops[0].scopes[0].truncated, plain.result.stops[0].stack_truncated],
    [1, false, false],
  );
  const broken = await scripted(spaces, hostOk({ stops: 'nope' })).service.run(base);
  assert.equal(broken.code, 'ENV_DAP_RESULT_INVALID');

  // The controller re-checks what the host reported: marked cuts for reason/type/output, shapes, counts and depth.
  const wide = 'w'.repeat(300);
  const marked = await scripted(
    spaces,
    hostOk(
      rawResult({
        reason: wide,
        output: { text: 'o'.repeat(5000), truncated: false },
        stops: [rawStop({ reason: wide, scopes: [{ name: wide, variables: [{ name: wide, value: '1', type: wide }] }] })],
      }),
    ),
  ).service.run(base);
  assert.equal(marked.status, 'ok', JSON.stringify(marked));
  const [cutStop] = marked.result.stops;
  assert.deepEqual([cutStop.reason.length, cutStop.reason_truncated, cutStop.reason_original_length], [64, true, 300]);
  assert.deepEqual([marked.result.reason.length, marked.result.reason_truncated], [64, true]);
  assert.deepEqual(
    [marked.result.output.text.length, marked.result.output.text_truncated, marked.result.output.text_original_length],
    [4096, true, 5000],
  );
  const [cutVariable] = cutStop.scopes[0].variables;
  assert.deepEqual(
    [
      cutVariable.type.length,
      cutVariable.type_truncated,
      cutVariable.type_original_length,
      cutVariable.name.length,
      cutVariable.name_truncated,
    ],
    [128, true, 300, 256, true],
  );
  assert.deepEqual([cutStop.scopes[0].name.length, cutStop.scopes[0].name_truncated], [128, true]);
  const child = { name: 'c', value: '1', type: 'int' };
  const nested = { name: 'n', value: '1', type: 'x', children: { variables: [{ ...child, children: { variables: [child] } }] } };
  const deep = (capture, variablesList = [nested]) =>
    scripted(spaces, hostOk(rawResult({ stops: [rawStop({ scopes: [{ name: 's', variables: variablesList }] })] }))).service.run({
      ...base,
      capture,
    });
  assert.equal((await deep({ stack: true, variables_depth: 2 })).code, 'ENV_DAP_RESULT_INVALID', 'children of children exceed depth 2');
  assert.equal(
    (await deep({ stack: true, variables_depth: 1 }, [{ ...nested, children: { variables: [child] } }])).code,
    'ENV_DAP_RESULT_INVALID',
    'children at depth 1',
  );
  assert.equal((await deep({ stack: true, variables_depth: 2 }, [{ ...nested, children: { variables: [child] } }])).status, 'ok');
  const childList = (size) => Array.from({ length: size }, () => child);
  const withChildren = (size) => [{ ...nested, children: { variables: childList(size) } }];
  assert.equal(host.MAX_CHILDREN, 20, 'the host and the controller share one ceiling for children');
  assert.equal((await deep({ stack: true, variables_depth: 2 }, withChildren(host.MAX_CHILDREN))).status, 'ok', 'a full list of children');
  assert.equal(
    (await deep({ stack: true, variables_depth: 2 }, withChildren(host.MAX_CHILDREN + 1))).code,
    'ENV_DAP_RESULT_INVALID',
    'more children than the host can produce',
  );
  const invalidResult = async (stop, result = {}, capture) =>
    (
      await scripted(spaces, hostOk(rawResult({ stops: [rawStop(stop)], ...result }))).service.run({
        ...base,
        ...(capture ? { capture } : {}),
      })
    ).code;
  for (const frame of [
    { name: 'f', path: '/workspace/app.py', line: -1, column: 1 },
    { name: 'f', path: '/workspace/app.py', line: 1.5, column: 1 },
    { name: 'f', path: '/workspace/app.py', line: '2', column: 1 },
    { name: 'f', path: '/workspace/app.py', line: 2, column: -3 },
    { name: 'f', path: '/workspace/app.py', line: 2, column: 'x' },
    { name: 'f', path: '/workspace/app.py', line: 2 },
  ]) {
    assert.equal(await invalidResult({ stack: [frame] }), 'ENV_DAP_RESULT_INVALID', JSON.stringify(frame));
  }
  assert.equal(
    await invalidResult({ stack: Array.from({ length: 21 }).fill({ name: 'f', line: 1, column: null }) }),
    'ENV_DAP_RESULT_INVALID',
  );
  assert.equal(await invalidResult({ scopes: Array.from({ length: 5 }).fill({ name: 's', variables: [] }) }), 'ENV_DAP_RESULT_INVALID');
  assert.equal(
    await invalidResult({ scopes: [{ name: 's', variables: Array.from({ length: 51 }).fill({ name: 'v', value: '1' }) }] }),
    'ENV_DAP_RESULT_INVALID',
  );
  assert.equal(await invalidResult({}, { stops: Array.from({ length: 26 }).fill(rawStop()) }), 'ENV_DAP_RESULT_INVALID');
  assert.equal(
    await invalidResult({}, {}, { stack: false, variables_depth: 1 }),
    'ENV_DAP_RESULT_INVALID',
    'a stack arrived although none was requested',
  );
  assert.equal(
    await invalidResult({ stack: [], scopes: [{ name: 's', variables: [] }] }, {}, { stack: true, variables_depth: 0 }),
    'ENV_DAP_RESULT_INVALID',
    'scopes arrived at depth 0',
  );
});

test('the default service wires the real executor and artifact channel lazily', () => {
  const { service } = realService(workspace());
  assert.equal(typeof service.run, 'function');
  assert.equal(Object.isFrozen(service), true);
  assert.equal(new environment.DapError('m', 'C').code, 'C');
  assert.equal(environment.DAP_CONTRACT, 'environment.dap.v1');
  assert.equal(environment.CONTRACT, 'environment.lsp.v1');
});

// ---------------------------------------------------------------------------------------------------------------
// Timeout: end and drain, with zero surviving descendants proved by the cgroup and by /proc.
// ---------------------------------------------------------------------------------------------------------------

for (const runtime of ['python', 'node']) {
  test(`${runtime}: a debuggee that never stops ends at the timeout and drains, leaving no descendant in the cgroup or in /proc`, async () => {
    const spaces = workspace();
    const marker = `hseos-dap-marker-${randomUUID()}`;
    const { service, events } = realService(spaces);
    const groupsBefore = leftoverGroups();
    const file = runtime === 'python' ? 'loop.py' : 'loop.js';
    // The breakpoint sits on the line that spawns the detached grandchild; continuing then loops until the deadline.
    const output = await service.run({
      runtime,
      launch: { program: file, args: [marker] },
      breakpoints: [{ file, line: runtime === 'python' ? 5 : 3 }],
      steps: [{ op: 'continue' }],
      capture: { stack: false, variables_depth: 0 },
      timeout_ms: 6000,
    });
    assert.deepEqual([output.status, output.code], ['refused', 'ENV_DAP_TIMEOUT'], JSON.stringify(output));
    assert.equal(output.execution.descendants_terminated, true);
    assert.ok(output.execution.pids_peak >= 3, `the detached grandchild existed (pids_peak ${output.execution.pids_peak})`);
    assert.deepEqual(processesMentioning(marker), [], 'no process mentions the marker after the run (/proc)');
    assert.deepEqual(leftoverGroups(), groupsBefore, 'the resource group was drained and removed (cgroup)');
    assert.equal(events.at(-1).code, 'ENV_DAP_TIMEOUT');
  });
}

test('the executor timeout itself (a host that cannot answer) kills and drains the whole cgroup, detached descendants included', async () => {
  const spaces = workspace();
  const marker = `hseos-dap-executor-${randomUUID()}`;
  const groupsBefore = leftoverGroups();
  const result = await executeIsolatedCommand({
    policy: policyFor(spaces),
    command: [
      '/usr/bin/python3',
      '-I',
      '-c',
      "import subprocess, sys, time\nsubprocess.Popen(['/usr/bin/python3', '-c', 'import time; time.sleep(600)', sys.argv[1]], start_new_session=True)\nwhile True:\n    time.sleep(0.05)",
      marker,
    ],
    timeout_ms: 3000,
    max_output_bytes: 65_536,
  });
  assert.equal(result.status, 'timed_out');
  assert.equal(result.descendants_terminated, true);
  assert.ok(result.pids_peak >= 2);
  assert.deepEqual(processesMentioning(marker), []);
  assert.deepEqual(leftoverGroups(), groupsBefore);
});

// ---------------------------------------------------------------------------------------------------------------
// Host process against scripted adapters: protocol failures, limits and truncation (acceptance uses the real ones above).
// ---------------------------------------------------------------------------------------------------------------

const FAKE_ADAPTER = `#!/usr/bin/env node
'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const behavior = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'behavior.json'), 'utf8'));
const argv = process.argv;
const listen = argv.indexOf('--listen');
const port = Number(listen >= 0 ? argv[listen + 1].split(':')[1] : argv[2]);
const frame = (m) => { const b = Buffer.from(JSON.stringify(m)); return Buffer.concat([Buffer.from('Content-Length: ' + b.length + '\\r\\n\\r\\n'), b]); };
let connections = 0;
if (behavior.mode === 'never') setInterval(() => {}, 1000);
else if (behavior.mode === 'exit-early') process.exit(0);
else net.createServer((socket) => {
  connections += 1;
  const first = connections === 1;
  let seq = 100;
  const send = (m) => socket.write(frame({ seq: seq++, ...m }));
  const event = (name, body = {}) => send({ type: 'event', event: name, body });
  const respond = (m, body = {}, success = true) => send({ type: 'response', request_seq: m.seq, command: m.command, success, body });
  let buffer = Buffer.alloc(0);
  let stops = 0;
  const stopped = () => { stops += 1; event('stopped', { reason: stops === 1 ? 'breakpoint' : 'step', threadId: 1 }); };
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf('\\r\\n\\r\\n');
      if (end < 0) return;
      const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1]);
      if (buffer.length < end + 4 + length) return;
      const m = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
      buffer = buffer.subarray(end + 4 + length);
      if (!first) fs.appendFileSync(path.join(process.env.HOME, 'child.log'), m.command + '\\n');
      if (behavior.mode === 'garbage') return socket.write('garbage\\r\\n\\r\\n');
      if (behavior.mode === 'die') return process.exit(0);
      if (behavior.mode === 'refuse' && m.command === 'initialize') return respond(m, {}, false);
      if (m.command === 'initialize') { respond(m, {}); }
      else if (m.command === 'attach' || m.command === 'launch') {
        event('initialized');
        for (const category of ['stdout', 'stderr', 'console', 'telemetry']) event('output', { category, output: category + ' ' + 'z'.repeat(behavior.output || 10) + '\\n' });
        event('output', { category: 'stdout' });
        if (first) {
          send({ type: 'request', command: 'runInTerminal', arguments: {} });
          send({
            type: 'request',
            command: 'startDebugging',
            arguments: {
              ...(behavior.childRequest ? { request: behavior.childRequest } : {}),
              configuration: { type: 'pwa-node', name: 'child', ...(behavior.configRequest ? { request: behavior.configRequest } : {}), __pendingTargetId: 'abcdef0123456789' },
            },
          });
        }
        globalThis.pendingLaunch = m;
      }
      else if (m.command === 'configurationDone') {
        respond(m);
        respond(globalThis.pendingLaunch);
        if (behavior.mode === 'hang') return;
        stopped();
        if (behavior.mode === 'terminate-now') { event('terminated'); }
      }
      else if (m.command === 'stackTrace') respond(m, { stackFrames: Array.from({ length: behavior.frames ?? 2 }, (_, i) => ({ id: i + 1, name: 'f' + i, line: 2, column: 1, source: { path: '/workspace/app.py' } })) });
      else if (m.command === 'scopes') respond(m, { scopes: [{ name: 'Locals', variablesReference: 1, expensive: false }, { name: 'Globals', variablesReference: 1, expensive: true }, ...[1, 2, 3, 4, 5].map((i) => ({ name: 'S' + i, variablesReference: 2, expensive: false }))] });
      else if (m.command === 'variables') respond(m, { variables: Array.from({ length: behavior.variables ?? 3 }, (_, i) => ({ name: 'v' + i, value: i === 0 ? 'y'.repeat(900) : String(i), variablesReference: m.arguments.variablesReference === 1 ? 2 : 0 })) });
      else if (['next', 'stepIn', 'stepOut', 'continue'].includes(m.command)) { respond(m); if (behavior.mode === 'loop' || behavior.mode === 'script') stopped(); else event('terminated'); }
      else if (m.command === 'disconnect') { respond(m); socket.end(); }
      else respond(m);
    }
  });
}).listen(port, '127.0.0.1');
`;

/** A toolchain whose adapters are the scripted fake: debugpy via the python command, js-debug via the entry script. */
function fakeToolchain() {
  const root = temp('hseos-dap-fake-');
  const entry = path.join(root, 'js-debug/js-debug/src/dapDebugServer.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, FAKE_ADAPTER);
  const python = path.join(root, 'fake-python');
  fs.writeFileSync(python, FAKE_ADAPTER, { mode: 0o755 });
  return { root, python };
}

function fakeRun(behavior, extra = {}, home = temp('hseos-dap-home-')) {
  const fake = fakeToolchain();
  fs.writeFileSync(path.join(home, 'behavior.json'), JSON.stringify(behavior));
  const { root } = workspace();
  const runtime = extra.runtime ?? 'python';
  return host.runSession({
    runtime,
    launch: { program: FILES[runtime] },
    breakpoints: [{ file: FILES[runtime], line: 2 }],
    steps: [],
    capture: { stack: true, variables_depth: 1 },
    root,
    toolchain: fake.root,
    scratch: home,
    python: fake.python,
    timeout_ms: 5000,
    ...extra,
  });
}

const codeOf = async (promise) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error.code;
  }
};

test('a js-debug child session is configured with the request kind js-debug named, and never with a default', async () => {
  const childCommands = async (behavior) => {
    const home = temp('hseos-dap-home-');
    await fakeRun({ mode: 'script', ...behavior }, { runtime: 'node', steps: [] }, home);
    const log = path.join(home, 'child.log');
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  };
  const attach = await childCommands({ childRequest: 'attach' });
  assert.ok(attach.includes('attach') && !attach.includes('launch'), `attach is what the child receives: ${attach}`);
  const launch = await childCommands({ childRequest: 'launch' });
  assert.ok(launch.includes('launch') && !launch.includes('attach'), `launch is what the child receives: ${launch}`);
  assert.deepEqual(await childCommands({}), [], 'no request in the arguments: no child session, no default');
  assert.deepEqual(
    await childCommands({ configRequest: 'launch' }),
    [],
    'a request only inside the configuration does not stand in for the explicit one',
  );
  assert.deepEqual(await childCommands({ childRequest: 'evaluate' }), [], 'an unknown request kind is refused');
  assert.deepEqual(await childCommands({ childRequest: 'attach', configRequest: 'launch' }), [], 'disagreeing requests are refused');
});

test('the host refuses a step it does not know, before any adapter is started', async () => {
  for (const steps of [[{ op: 'evaluate' }], [{ op: 'next' }, { op: 'setVariable' }], ['next'], [null], [{}], 'next']) {
    await assert.rejects(
      host.runSession({ runtime: 'python', launch: { program: 'app.py' }, steps, root: '/workspace', toolchain: '/nonexistent' }),
      { code: 'ENV_DAP_INPUT' },
      JSON.stringify(steps),
    );
  }
});

test('host protocol failures have stable codes: refused initialize, garbage framing, a dying adapter, no listener, a silent adapter, bad input', async () => {
  assert.equal(await codeOf(fakeRun({ mode: 'refuse' })), 'ENV_DAP_ADAPTER_ERROR');
  assert.equal(await codeOf(fakeRun({ mode: 'garbage' })), 'ENV_DAP_PROTOCOL');
  assert.equal(await codeOf(fakeRun({ mode: 'die' })), 'ENV_DAP_ADAPTER_EXITED');
  assert.equal(await codeOf(fakeRun({ mode: 'exit-early' }, { timeout_ms: 1500 })), 'ENV_DAP_ADAPTER_UNAVAILABLE');
  assert.equal(await codeOf(fakeRun({ mode: 'never' }, { timeout_ms: 1200 })), 'ENV_DAP_ADAPTER_UNAVAILABLE');
  assert.equal(await codeOf(fakeRun({ mode: 'hang' }, { timeout_ms: 1500 })), 'ENV_DAP_TIMEOUT');
  assert.equal(await codeOf(fakeRun({ mode: 'script' }, { runtime: 'ruby' })), 'ENV_DAP_INPUT');
  assert.equal(await codeOf(host.runSession({ runtime: 'python' })), 'ENV_DAP_INPUT');
});

test('host drives a scripted adapter: reverse requests are refused, output is bounded, lists and frames are cut, stops are limited', async () => {
  const result = await fakeRun(
    { mode: 'script', frames: 25, variables: 70, output: 3000 },
    { steps: [{ op: 'next' }], capture: { stack: true, variables_depth: 2 } },
  );
  assert.equal(result.reason, 'steps_exhausted');
  assert.equal(result.stops.length, 2);
  assert.equal(result.stops[0].stack.length, 20);
  assert.equal(result.stops[0].stack_truncated, true);
  const [locals] = result.stops[0].scopes;
  assert.equal(locals.name, 'Locals');
  assert.equal(result.stops[0].scopes.length, 4, 'expensive scopes are skipped and the scope list is bounded');
  assert.equal(locals.variables.length, 50);
  assert.deepEqual(
    [locals.total, locals.truncated, locals.variables[0].truncated, locals.variables[0].original_length],
    [70, true, true, 900],
  );
  assert.equal(locals.variables.filter((item) => item.children).length, 10, 'at most 10 values are expanded per list');
  assert.equal(locals.variables[0].children.variables.length, 20);
  assert.equal(result.output.truncated, true);
  assert.ok(result.output.text.length <= 4096);
  assert.ok(!result.output.text.includes('telemetry'));
  const limited = await fakeRun(
    { mode: 'loop' },
    { steps: Array.from({ length: 30 }).fill({ op: 'next' }), capture: { stack: false, variables_depth: 0 }, timeout_ms: 15_000 },
  );
  assert.deepEqual([limited.reason, limited.stops.length], ['stop_limit', 25]);
  const done = await fakeRun({ mode: 'terminate-now' }, { steps: [{ op: 'continue' }], capture: { stack: false, variables_depth: 0 } });
  assert.deepEqual([done.terminated, done.stops.length], [true, 1]);
  const viaJsDebug = await fakeRun({ mode: 'script' }, { runtime: 'node', steps: [], capture: { stack: false, variables_depth: 0 } });
  assert.equal(viaJsDebug.runtime, 'node');
});

test("only js-debug's own child configuration is honoured for startDebugging; anything with program, runtime or arguments is refused", () => {
  const ok = { type: 'pwa-node', name: 'app.js [1]', __pendingTargetId: '101e9b709185c03d4048f6ad' };
  assert.equal(host.childConfiguration(ok, 'launch'), true);
  assert.equal(host.childConfiguration(ok, 'attach'), true);
  assert.equal(host.childConfiguration({ ...ok, request: 'attach' }, 'attach'), true, 'the configuration may only agree with the request');
  assert.equal(
    host.childConfiguration({ ...ok, request: 'launch' }),
    false,
    'a request inside the configuration never replaces the explicit one',
  );
  assert.equal(host.childConfiguration(ok), false, 'there is no default request');
  assert.equal(host.childConfiguration(ok, 'evaluate'), false);
  assert.equal(host.childConfiguration({ ...ok, request: 'attach' }, 'launch'), false, 'the two requests must agree');
  assert.equal(host.childConfiguration({ ...ok, name: undefined }, 'launch'), true, 'the name is optional');
  assert.equal(host.childConfiguration({ ...ok, name: 'n'.repeat(256) }, 'launch'), true, 'a name of exactly 256 characters is accepted');
  for (const bad of [
    null,
    undefined,
    'x',
    {},
    { ...ok, program: '/etc/passwd' },
    { ...ok, runtimeExecutable: '/bin/sh' },
    { ...ok, args: ['x'] },
    { ...ok, type: 'pwa-chrome' },
    { ...ok, request: 'evaluate' },
    { ...ok, __pendingTargetId: undefined },
    { ...ok, __pendingTargetId: 'not-hex!' },
    { ...ok, __pendingTargetId: 'ab' },
    { ...ok, name: 7 },
    { ...ok, name: { toString: 'x' } },
    { ...ok, name: 'n'.repeat(257) },
  ]) {
    assert.equal(host.childConfiguration(bad, 'launch'), false, JSON.stringify(bad));
  }
});

test('host output is inline when small and a verified artifact manifest when large', () => {
  const lines = [];
  const small = { ok: true, result: { text: 'x' } };
  host.emit(small, (line) => lines.push(line), null);
  assert.deepEqual(JSON.parse(lines[0]), small);
  const large = { ok: true, result: { text: 'y'.repeat(60_000) } };
  host.emit(large, (line) => lines.push(line), null);
  assert.equal(JSON.parse(lines[1]).result.text.length, 60_000, 'without an artifact directory the host cannot offload');
  const directory = temp('hseos-dap-artifacts-');
  host.emit(large, (line) => lines.push(line), directory);
  const [entry] = JSON.parse(lines[2]);
  const bytes = fs.readFileSync(path.join(directory, 'result.json'));
  assert.deepEqual(entry, {
    path: '/artifacts/result.json',
    media_type: 'application/json',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  assert.deepEqual(JSON.parse(bytes), large);
  assert.deepEqual(host.clip('abc'), { value: 'abc', truncated: false });
  assert.deepEqual(host.clip(null), { value: '', truncated: false });
  assert.deepEqual(host.clip('abcdef', 3), { value: 'abc', truncated: true, original_length: 6 });
});

test('host main prints ok on success and a stable code on failure', async () => {
  const lines = [];
  const write = (line) => lines.push(JSON.parse(line));
  const { root } = workspace();
  const request = {
    runtime: 'python',
    launch: { program: 'tail.py' },
    root,
    toolchain: toolchain.root,
    scratch: temp('hseos-dap-home-'),
    python: '/usr/bin/python3',
    timeout_ms: 20_000,
  };
  assert.equal(await host.main([JSON.stringify(request)], write, null), 0);
  assert.equal(lines[0].ok, true);
  assert.equal(lines[0].result.terminated, true);
  assert.equal(await host.main(['{"runtime":"ruby","launch":{}}'], write, null), 1);
  assert.deepEqual(lines[1], { ok: false, code: 'ENV_DAP_INPUT' });
  assert.equal(await host.main(['not json'], write, null), 1);
  assert.equal(lines[2].code, 'ENV_DAP_HOST_FAILURE');
});

// ---------------------------------------------------------------------------------------------------------------
// Toolchain pins: the real cache verifies debugpy (zip) and js-debug (tgz); crafted archives exercise every refusal.
// ---------------------------------------------------------------------------------------------------------------

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MIT = 'Permission is hereby granted, free of charge';

test('crc32 matches the published check values', () => {
  assert.equal(pins.crc32(Buffer.alloc(0)), 0);
  assert.equal(pins.crc32(Buffer.from('a')), 0xe8_b7_be_43);
  assert.equal(pins.crc32(Buffer.from('123456789')), 0xcb_f4_39_26);
});

test('the real cache verifies SHA-256 and the licence text inside debugpy and js-debug, and installs offline', () => {
  assert.deepEqual(
    toolchain.pins.map((pin) => [pin.name, pin.version, pin.license]),
    [
      ['debugpy', '1.8.22', 'MIT'],
      ['js-debug', '1.140.0', 'MIT'],
    ],
  );
  for (const entry of [
    'debugpy/debugpy/__init__.py',
    'debugpy/debugpy/adapter/__init__.py',
    'js-debug/js-debug/src/dapDebugServer.js',
    'js-debug/js-debug/LICENSE',
    'host/dap-host.js',
    'host/framing.js',
  ]) {
    assert.ok(fs.existsSync(path.join(toolchain.root, entry)), entry);
  }
  const manifest = pins.readManifest(CACHE);
  for (const name of ['debugpy', 'js-debug']) {
    const pin = pins.PINS[name];
    const verified = pins.verifyPin(CACHE, name, manifest);
    assert.equal(verified.sha256, pin.sha256);
    assert.equal(sha(fs.readFileSync(path.join(CACHE, pin.artifact))), pin.sha256, 'the pinned digest is the digest of the artifact bytes');
    assert.equal(manifest.pins.find((item) => item.name === name).license, 'MIT');
  }
  // The licence text read from the artifacts themselves.
  const debugpyLicense = pins.readZipEntry(
    fs.readFileSync(path.join(CACHE, pins.PINS.debugpy.artifact)),
    pins
      .listZip(fs.readFileSync(path.join(CACHE, pins.PINS.debugpy.artifact)))
      .find((entry) => entry.name === pins.PINS.debugpy.license_file),
  );
  assert.match(debugpyLicense.toString('utf8'), /MIT License/);
  assert.match(
    execFileSync('tar', ['-xzOf', path.join(CACHE, pins.PINS['js-debug'].artifact), 'js-debug/LICENSE']).toString('utf8'),
    /MIT License/,
  );
  assert.throws(() => pins.installToolchain({ cacheDirectory: CACHE, destination: temp('hseos-dap-x-'), names: ['nope'] }), {
    code: 'ENV_TOOLCHAIN_PIN_UNKNOWN',
  });
});

/** Minimal zip writer with knobs for every property the reader must refuse. */
function buildZip(entries, { comment = Buffer.alloc(0), eocd = true } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data ?? '');
    const method = entry.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = entry.crc ?? pins.crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04_03_4b_50, 0);
    header.writeUInt16LE(entry.flags ?? 0, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(entry.size ?? data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([header, name, body]);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02_01_4b_50, 0);
    record.writeUInt8(entry.platform ?? 3, 5);
    record.writeUInt16LE(entry.flags ?? 0, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(entry.size ?? data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((entry.mode ?? (entry.name.endsWith('/') ? 0o04_0755 : 0o10_0644)) << 16) >>> 0, 38);
    record.writeUInt32LE(entry.offset ?? offset, 42);
    central.push(Buffer.concat([record, name]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(0x06_05_4b_50, 0);
  tail.writeUInt16LE(entries.length, 8);
  tail.writeUInt16LE(entries.length, 10);
  tail.writeUInt32LE(directory.length, 12);
  tail.writeUInt32LE(offset, 16);
  tail.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, directory, ...(eocd ? [tail, comment] : [])]);
}

const LICENSE_FILE = 'pkg-1.0.dist-info/LICENSE';

/** A one-pin zip cache whose manifest matches, unless a case says otherwise. */
function zipCache(zipBytes, { mutate = (manifest) => manifest } = {}) {
  const cache = temp('hseos-dap-zipcache-');
  fs.mkdirSync(path.join(cache, 'pypi'));
  fs.writeFileSync(path.join(cache, 'pypi/zipfixture-1.0.0.whl'), zipBytes);
  const digest = sha(zipBytes);
  const expected = {
    zipfixture: {
      version: '1.0.0',
      artifact: 'pypi/zipfixture-1.0.0.whl',
      sha256: digest,
      license: 'MIT',
      format: 'zip',
      license_file: LICENSE_FILE,
      license_markers: [MIT],
      license_sha256: sha(MIT),
    },
  };
  fs.writeFileSync(
    path.join(cache, 'toolchain-manifest.json'),
    JSON.stringify(
      mutate({
        schema: 'hseos.toolchain-cache.v1',
        runtime_download: false,
        pins: [{ name: 'zipfixture', version: '1.0.0', artifact: 'pypi/zipfixture-1.0.0.whl', license: 'MIT', sha256: digest }],
      }),
    ),
  );
  return { cache, expected };
}
const installZip = ({ cache, expected }, destination = temp('hseos-dap-zipdest-')) =>
  pins.installToolchain({ cacheDirectory: cache, destination, names: ['zipfixture'], expected });
const good = (extra = []) => [
  { name: LICENSE_FILE, data: MIT },
  { name: 'pkg/', data: '' },
  { name: 'pkg/mod.py', data: 'x = 1\n' },
  { name: 'pkg/stored.txt', data: 'plain', method: 0 },
  ...extra,
];

test('a coherent zip installs from the verified bytes; stored and deflated members are both extracted, with their CRC checked', () => {
  const fixture = zipCache(buildZip(good()));
  const destination = temp('hseos-dap-zipdest-');
  const result = installZip(fixture, destination);
  assert.equal(result.status, 'ready');
  assert.equal(fs.readFileSync(path.join(destination, 'zipfixture/pkg/mod.py'), 'utf8'), 'x = 1\n');
  assert.equal(fs.readFileSync(path.join(destination, 'zipfixture/pkg/stored.txt'), 'utf8'), 'plain');
  // A re-install starts clean.
  fs.writeFileSync(path.join(destination, 'zipfixture/stale.txt'), 'old');
  installZip(fixture, destination);
  assert.equal(fs.existsSync(path.join(destination, 'zipfixture/stale.txt')), false);
  // A zip with a trailing comment is still found.
  assert.equal(installZip(zipCache(buildZip(good(), { comment: Buffer.from('built by hand') }))).status, 'ready');
});

test('every unsafe or inconsistent zip (links, traversal, duplicates, file/directory clashes, bad sizes) is BLOCKED before anything is touched', () => {
  const unsafe = (entries, options) => {
    const destination = temp('hseos-dap-zipdest-');
    assert.throws(
      () => installZip(zipCache(buildZip(entries, options)), destination),
      { code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE' },
      JSON.stringify(entries.map((e) => e.name)),
    );
    assert.deepEqual(fs.readdirSync(destination), [], 'nothing was extracted');
  };
  unsafe(good([{ name: '../evil.txt', data: 'x' }]));
  unsafe(good([{ name: 'pkg/../../evil.txt', data: 'x' }]));
  unsafe(good([{ name: '/abs-evil.txt', data: 'x' }]));
  unsafe(good([{ name: String.raw`back\slash.txt`, data: 'x' }]));
  unsafe(good([{ name: 'nul\0byte.txt', data: 'x' }]));
  unsafe(good([{ name: 'link', data: '/etc/passwd', mode: 0o12_0777 }]));
  unsafe(good([{ name: 'fifo', data: '', mode: 0o01_0644 }]));
  unsafe(good([{ name: 'dir-as-file/', data: '', mode: 0o10_0644 }]));
  unsafe(good([{ name: 'secret.txt', data: 'x', flags: 1 }]));
  unsafe(good([{ name: 'bzip.txt', data: 'x', method: 12 }]));
  unsafe(good([{ name: 'huge.bin', data: 'x', size: 100_000_000 }]));
  unsafe(
    good([
      { name: 'a.bin', data: 'x', size: 60_000_000 },
      { name: 'b.bin', data: 'x', size: 60_000_000 },
      { name: 'c.bin', data: 'x', size: 60_000_000 },
      { name: 'd.bin', data: 'x', size: 60_000_000 },
      { name: 'e.bin', data: 'x', size: 60_000_000 },
    ]),
  );
  unsafe(good([{ name: 'bad-crc.txt', data: 'abc', crc: 1 }]));
  unsafe(good([{ name: 'bad-size.txt', data: 'abc', method: 0, size: 99 }]));
  unsafe(good([{ name: 'wild.txt', data: 'abc', offset: 5 }]));
  unsafe(good([{ name: 'wild.txt', data: 'abc', offset: 10_000_000 }]));
  unsafe([], { eocd: false });
  unsafe(
    good([
      { name: 'a.txt', data: '1' },
      { name: 'a.txt', data: '2' },
    ]),
  );
  unsafe(
    good([
      { name: 'a.txt', data: '1' },
      { name: './a.txt', data: '2' },
    ]),
  );
  unsafe(good([{ name: 'a/./b.txt', data: '1' }]));
  unsafe(good([{ name: 'a//b.txt', data: '1' }]));
  unsafe(good([{ name: './', data: '' }]));
  unsafe(good([{ name: 'pkg/mod.py', data: 'again' }]));
  unsafe(
    good([
      { name: 'dup/', data: '' },
      { name: 'dup/', data: '' },
    ]),
  );
  unsafe(
    good([
      { name: 'dup', data: '1' },
      { name: 'dup/', data: '' },
    ]),
  );
  unsafe(
    good([
      { name: 'Case.txt', data: '1' },
      { name: 'case.TXT', data: '2' },
    ]),
  );
  unsafe(
    good([
      { name: 'd', data: 'file' },
      { name: 'd/x', data: 'inside' },
    ]),
  );
  unsafe(
    good([
      { name: 'd/x', data: 'inside' },
      { name: 'd', data: 'file' },
    ]),
  );
  unsafe(
    good([
      { name: 'p/q', data: 'file' },
      { name: 'p/q/r/s.txt', data: 'deep' },
    ]),
  );
  unsafe([{ name: '', data: 'x' }]);
  const truncated = buildZip(good());
  assert.throws(() => installZip(zipCache(truncated.subarray(0, -10))), { code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE' });
  const shortLocal = buildZip([{ name: LICENSE_FILE, data: MIT }]);
  const tooShort = Buffer.from(shortLocal);
  tooShort.writeUInt32LE(0, 0);
  assert.throws(() => installZip(zipCache(tooShort)), { code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE' });
  // Central directory claiming more entries than fit.
  const lying = Buffer.from(buildZip(good()));
  lying.writeUInt16LE(5000, lying.length - 22 + 10);
  assert.throws(() => installZip(zipCache(lying)), { code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE' });
  // Wrong central directory signature and a multi-disk archive.
  const wrongSignature = Buffer.from(buildZip(good()));
  wrongSignature.writeUInt32LE(0, wrongSignature.readUInt32LE(wrongSignature.length - 22 + 16));
  assert.throws(() => installZip(zipCache(wrongSignature)), { code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE' });
  const multiDisk = Buffer.from(buildZip(good()));
  multiDisk.writeUInt16LE(1, multiDisk.length - 22 + 4);
  assert.throws(() => installZip(zipCache(multiDisk)), { code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE' });
  // The previous destination is left intact when the replacement archive is refused.
  const keep = temp('hseos-dap-zipkeep-');
  installZip(zipCache(buildZip(good())), keep);
  const before = hashTree(keep);
  assert.throws(
    () =>
      installZip(
        zipCache(
          buildZip(
            good([
              { name: 'a.txt', data: '1' },
              { name: 'a.txt', data: '2' },
            ]),
          ),
        ),
        keep,
      ),
    { code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE' },
  );
  assert.throws(() => installZip(zipCache(buildZip(good([{ name: 'bad-crc.txt', data: 'abc', crc: 1 }]))), keep), {
    code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE',
  });
  assert.equal(hashTree(keep), before, 'a refused re-install does not touch the existing toolchain');
  // A non-unix member (platform 0) carries no mode and is accepted as a plain file.
  assert.equal(installZip(zipCache(buildZip(good([{ name: 'dos.txt', data: 'x', platform: 0 }])))).status, 'ready');
});

test('zip pins diverge, go missing or fail the licence check with their own codes', () => {
  const fixture = zipCache(buildZip(good()));
  const cases = [
    ['ENV_TOOLCHAIN_LICENSE_MISSING', zipCache(buildZip([{ name: 'pkg/mod.py', data: 'x' }]))],
    ['ENV_TOOLCHAIN_LICENSE_MISSING', zipCache(buildZip([{ name: `${LICENSE_FILE}/`, data: '' }]))],
    ['ENV_TOOLCHAIN_LICENSE_MISMATCH', zipCache(buildZip([{ name: LICENSE_FILE, data: 'All rights reserved' }]))],
    ['ENV_TOOLCHAIN_LICENSE_DIGEST', zipCache(buildZip([{ name: LICENSE_FILE, data: `${MIT}, to anyone, for any use at all` }]))],
    ['ENV_TOOLCHAIN_PIN_DIVERGED', zipCache(buildZip(good()), { mutate: (m) => ({ ...m, pins: [{ ...m.pins[0], license: 'GPL-3.0' }] }) })],
    [
      'ENV_TOOLCHAIN_ARTIFACT_MISSING',
      (() => {
        const f = zipCache(buildZip(good()));
        fs.rmSync(path.join(f.cache, 'pypi/zipfixture-1.0.0.whl'));
        return f;
      })(),
    ],
    [
      'ENV_TOOLCHAIN_DIGEST_MISMATCH',
      (() => {
        const f = zipCache(buildZip(good()));
        fs.appendFileSync(path.join(f.cache, 'pypi/zipfixture-1.0.0.whl'), 'x');
        return f;
      })(),
    ],
  ];
  for (const [code, candidate] of cases) assert.throws(() => installZip(candidate), { code }, code);
  assert.equal(installZip(fixture).status, 'ready');
});

/** A real tar.gz whose members are written verbatim, under a chosen root. */
function craftedTgz(names, files = {}) {
  const script = `import io, sys, tarfile
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
    for name in sys.argv[1:]:
        data = b'Permission is hereby granted, free of charge'
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
sys.stdout.buffer.write(buffer.getvalue())`;
  return execFileSync('python3', ['-I', '-c', script, ...names, ...Object.keys(files)]);
}

function tgzCache(bytes) {
  const cache = temp('hseos-dap-tgzcache-');
  fs.mkdirSync(path.join(cache, 'github'));
  fs.writeFileSync(path.join(cache, 'github/rooted-1.0.0.tar.gz'), bytes);
  const digest = sha(bytes);
  const expected = {
    rooted: {
      version: '1.0.0',
      artifact: 'github/rooted-1.0.0.tar.gz',
      sha256: digest,
      license: 'MIT',
      root: 'rooted/',
      license_file: 'rooted/LICENSE',
      license_markers: [MIT],
      license_sha256: sha(MIT),
    },
  };
  fs.writeFileSync(
    path.join(cache, 'toolchain-manifest.json'),
    JSON.stringify({
      schema: 'hseos.toolchain-cache.v1',
      runtime_download: false,
      pins: [{ name: 'rooted', version: '1.0.0', artifact: 'github/rooted-1.0.0.tar.gz', license: 'MIT', sha256: digest }],
    }),
  );
  return { cache, expected };
}

test('a tar pin may use its own root prefix, and a member outside that root is refused', () => {
  const ok = tgzCache(craftedTgz(['rooted/LICENSE', 'rooted/src/a.js']));
  const result = pins.installToolchain({
    cacheDirectory: ok.cache,
    destination: temp('hseos-dap-tgzdest-'),
    names: ['rooted'],
    expected: ok.expected,
  });
  assert.equal(result.status, 'ready');
  const stray = tgzCache(craftedTgz(['rooted/LICENSE', 'package/other.js']));
  const destination = temp('hseos-dap-tgzdest-');
  assert.throws(() => pins.installToolchain({ cacheDirectory: stray.cache, destination, names: ['rooted'], expected: stray.expected }), {
    code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE',
  });
  assert.deepEqual(fs.readdirSync(destination), []);
  const escaping = tgzCache(craftedTgz(['rooted/LICENSE', 'rooted/../../evil.txt']));
  assert.throws(
    () =>
      pins.installToolchain({
        cacheDirectory: escaping.cache,
        destination: temp('hseos-dap-tgzdest-'),
        names: ['rooted'],
        expected: escaping.expected,
      }),
    { code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE' },
  );
});
