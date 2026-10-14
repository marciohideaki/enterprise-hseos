'use strict';

// Runs inside the sandbox (or in-process in tests): one scripted debug session per call.
// It never validates scope; the controller (dap.js) treats everything printed here as untrusted.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createFrameParser, encodeMessage } = require('./framing');

const RUNTIMES = new Set(['node', 'python']);
const STEP_OPS = ['continue', 'next', 'stepIn', 'stepOut'];
// Allow-list, not deny-list: evaluate, setVariable, setExpression, restartFrame and every other request that could
// run code in the debuggee or change its state is simply not in this set.
const ALLOWED_REQUESTS = new Set([
  'initialize',
  'launch',
  'attach',
  'setBreakpoints',
  'configurationDone',
  'threads',
  'stackTrace',
  'scopes',
  'variables',
  'continue',
  'next',
  'stepIn',
  'stepOut',
  'disconnect',
]);
const MAX_STOPS = 25;
const MAX_FRAMES = 20;
const MAX_VARIABLES = 50;
const MAX_EXPANDED = 10;
// Shared with the controller (dap.js), which refuses a longer list of children than the host can produce.
const MAX_CHILDREN = 20;
const MAX_VALUE = 512;
const MAX_OUTPUT = 4096;
const INLINE_LIMIT_BYTES = 48_000;
const CONNECT_RETRY_MS = 100;
const EXIT_GRACE_MS = 500;

class DapHostError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DapHostError';
    this.code = code;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One DAP connection. Requests are checked against the allow-list before they reach the wire. */
function createClient({ socket, onReverseRequest, onEvent }) {
  const parser = createFrameParser();
  const pending = new Map();
  let seq = 1;
  let closed = false;
  const send = (message) => {
    if (!socket.destroyed) socket.write(encodeMessage({ seq: seq++, ...message }));
  };
  const settle = (error) => {
    closed = true;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  socket.on('data', (chunk) => {
    try {
      for (const message of parser.push(chunk)) {
        if (message.type === 'response' && pending.has(message.request_seq)) {
          const { resolve, reject } = pending.get(message.request_seq);
          pending.delete(message.request_seq);
          if (message.success) resolve(message.body ?? {});
          else reject(new DapHostError('adapter refused a request', 'ENV_DAP_ADAPTER_ERROR'));
        } else if (message.type === 'request') {
          const allowed = onReverseRequest(message, client);
          send({
            type: 'response',
            request_seq: message.seq,
            command: message.command,
            success: allowed,
            ...(allowed ? { body: {} } : { message: 'refused by contract' }),
          });
        } else if (message.type === 'event') {
          onEvent(message, client);
        }
      }
    } catch {
      settle(new DapHostError('adapter framing violation', 'ENV_DAP_PROTOCOL'));
      socket.destroy();
    }
  });
  socket.on('close', () => settle(new DapHostError('adapter connection closed', 'ENV_DAP_ADAPTER_EXITED')));
  socket.on('error', () => socket.destroy());
  const client = {
    request(command, args) {
      if (!ALLOWED_REQUESTS.has(command))
        return Promise.reject(new DapHostError('request is not allowed by the contract', 'ENV_DAP_FORBIDDEN_REQUEST'));
      if (closed) return Promise.reject(new DapHostError('adapter connection closed', 'ENV_DAP_ADAPTER_EXITED'));
      const id = seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ type: 'request', command, arguments: args });
      });
    },
    destroy: () => socket.destroy(),
  };
  return client;
}

async function connect(port, deadline) {
  for (;;) {
    const socket = await new Promise((resolve) => {
      const candidate = net.connect(port, '127.0.0.1');
      candidate.once('connect', () => resolve(candidate));
      candidate.once('error', () => resolve(null));
    });
    if (socket) return socket;
    if (Date.now() > deadline) throw new DapHostError('adapter did not accept a connection', 'ENV_DAP_ADAPTER_UNAVAILABLE');
    await delay(CONNECT_RETRY_MS);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const clip = (value, limit = MAX_VALUE) => {
  const text = String(value ?? '');
  return text.length > limit
    ? { value: text.slice(0, limit), truncated: true, original_length: text.length }
    : { value: text, truncated: false };
};

/** Adapter command per runtime. The adapter and, for Python, the debuggee live in the sandbox with the workspace read-only. */
function adapterFor({ runtime, launch, port, root, toolchain, scratch, node, python }) {
  const cwd = path.resolve(root, launch.cwd ?? '.');
  const env = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, PYTHONDONTWRITEBYTECODE: '1', PYDEVD_DISABLE_FILE_VALIDATION: '1' };
  if (runtime === 'python') {
    const target = launch.module ? ['-m', launch.module] : [path.resolve(root, launch.program)];
    return {
      command: python,
      args: [
        '-Xfrozen_modules=off',
        '-m',
        'debugpy',
        '--listen',
        `127.0.0.1:${port}`,
        '--wait-for-client',
        ...target,
        ...(launch.args ?? []),
      ],
      options: { cwd, env: { ...env, PYTHONPATH: path.join(toolchain, 'debugpy') } },
    };
  }
  return {
    command: node,
    args: [path.join(toolchain, 'js-debug/js-debug/src/dapDebugServer.js'), String(port), '127.0.0.1'],
    options: { cwd, env },
  };
}

function launchArguments({ runtime, launch, root, node }) {
  if (runtime === 'python') return ['attach', { type: 'python', request: 'attach', justMyCode: true }];
  const cwd = path.resolve(root, launch.cwd ?? '.');
  return [
    'launch',
    {
      type: 'pwa-node',
      request: 'launch',
      program: path.resolve(root, launch.program),
      args: launch.args ?? [],
      cwd,
      runtimeExecutable: node,
      console: 'internalConsole',
      stopOnEntry: false,
      skipFiles: ['<node_internals>/**'],
    },
  ];
}

// js-debug needs one child session per debug target. The configuration it asks for is accepted only when it is exactly
// that: the node launch type, a known request and the opaque target id, with no program, runtime or argument fields.
const CHILD_FIELDS = new Set(['type', 'request', 'name', '__pendingTargetId']);
function childConfiguration(configuration) {
  return (
    Boolean(configuration) &&
    typeof configuration === 'object' &&
    Object.keys(configuration).every((key) => CHILD_FIELDS.has(key)) &&
    configuration.type === 'pwa-node' &&
    (configuration.name === undefined || (typeof configuration.name === 'string' && configuration.name.length <= 256)) &&
    ['launch', 'attach'].includes(configuration.request ?? 'launch') &&
    /^[0-9a-f]{8,64}$/.test(configuration.__pendingTargetId ?? '')
  );
}

async function runSession(request) {
  const {
    runtime,
    launch,
    breakpoints = [],
    steps = [],
    capture = { stack: true, variables_depth: 1 },
    root,
    toolchain,
    scratch = os.tmpdir(),
    node = process.execPath,
    python = '/usr/bin/python3',
    timeout_ms: timeoutMs = 25_000,
  } = request;
  if (!RUNTIMES.has(runtime) || !launch || typeof launch !== 'object')
    throw new DapHostError('unsupported runtime or launch', 'ENV_DAP_INPUT');
  const deadline = Date.now() + timeoutMs;
  const port = await freePort();
  const adapter = adapterFor({ runtime, launch, port, root, toolchain, scratch, node, python });
  // For Python the debuggee is this process, so its own streams are the program output; js-debug reports Node output as events.
  const child = spawn(adapter.command, adapter.args, {
    ...adapter.options,
    stdio: ['ignore', runtime === 'python' ? 'pipe' : 'ignore', runtime === 'python' ? 'pipe' : 'ignore'],
  });
  let exitedAt = 0;
  const markExited = () => {
    exitedAt ||= Date.now();
  };
  child.once('error', markExited);
  child.once('close', markExited);
  const clients = new Set();
  const events = [];
  const waiters = [];
  const output = [];
  let outputLength = 0;
  let outputTruncated = false;
  const record = (event) => {
    events.push(event);
    for (const waiter of waiters.splice(0)) waiter();
  };
  const addOutput = (value) => {
    const text = String(value);
    const room = MAX_OUTPUT - outputLength;
    outputTruncated ||= text.length > room;
    if (room > 0) output.push(text.slice(0, room));
    outputLength += Math.min(text.length, Math.max(room, 0));
  };
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', addOutput);
  const onEvent = (message, source) => {
    if (message.event === 'output') {
      const category = message.body?.category;
      if (category === 'stdout' || category === 'stderr' || category === 'console') addOutput(message.body.output ?? '');
    } else if (['stopped', 'terminated', 'exited', 'initialized'].includes(message.event)) {
      record({ event: message.event, body: message.body ?? {}, source });
    }
  };
  const sessionRoot = path.resolve(root);
  const files = new Map();
  for (const item of breakpoints) {
    const key = path.resolve(sessionRoot, item.file);
    if (!files.has(key)) files.set(key, []);
    files.get(key).push({ line: item.line });
  }

  async function nextEvent(match, label) {
    for (;;) {
      const index = events.findIndex(match);
      if (index !== -1) return events.splice(index, 1)[0];
      // Events already on the wire when the process exits are still delivered, so the failure waits a moment.
      if (exitedAt && Date.now() - exitedAt > EXIT_GRACE_MS)
        throw new DapHostError(`adapter exited while waiting for ${label}`, 'ENV_DAP_ADAPTER_EXITED');
      if (Date.now() > deadline) throw new DapHostError('debug session timed out', 'ENV_DAP_TIMEOUT');
      await new Promise((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  // Configure one session: initialize, launch or attach, breakpoints, configurationDone.
  async function configure(client, command, args) {
    await client.request('initialize', {
      clientID: 'hseos',
      adapterID: runtime,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsStartDebuggingRequest: true,
    });
    const started = client.request(command, args);
    started.catch(() => {});
    await nextEvent((item) => item.event === 'initialized' && item.source === client, 'initialized');
    for (const [file, list] of files) await client.request('setBreakpoints', { source: { path: file }, breakpoints: list });
    await client.request('configurationDone', {});
    await started;
  }

  const sessions = [];
  const open = async () => {
    const socket = await connect(port, deadline);
    const client = createClient({
      socket,
      onEvent,
      onReverseRequest: (message) => {
        // Only js-debug's own child session is honoured; running anything in a terminal is refused.
        if (message.command === 'startDebugging' && runtime === 'node' && childConfiguration(message.arguments?.configuration)) {
          sessions.push(
            open()
              .then((next) => configure(next, 'launch', message.arguments.configuration))
              .catch(() => {}),
          );
          return true;
        }
        return false;
      },
    });
    clients.add(client);
    return client;
  };

  const stops = [];
  let terminated = false;
  let reason = 'completed';
  try {
    const root_client = await open();
    const [command, args] = launchArguments({ runtime, launch, root, node });
    await configure(root_client, command, args);

    const variablesOf = async (client, reference, depth, limit = MAX_VARIABLES) => {
      const body = await client.request('variables', { variablesReference: reference });
      const list = (body.variables ?? []).slice(0, limit);
      const result = [];
      let expanded = 0;
      for (const item of list) {
        const entry = { name: String(item.name), ...clip(item.value), type: item.type ?? null };
        if (depth > 1 && item.variablesReference > 0 && expanded < MAX_EXPANDED) {
          expanded += 1;
          entry.children = await variablesOf(client, item.variablesReference, depth - 1, MAX_CHILDREN);
        }
        result.push(entry);
      }
      return { variables: result, total: (body.variables ?? []).length, truncated: (body.variables ?? []).length > list.length };
    };

    const snapshot = async (client, body) => {
      const stop = { reason: String(body.reason ?? 'unknown'), stack: [], scopes: [] };
      if (!capture.stack) return stop;
      const frames = (await client.request('stackTrace', { threadId: body.threadId, levels: MAX_FRAMES })).stackFrames ?? [];
      stop.stack = frames
        .slice(0, MAX_FRAMES)
        .map((frame) => ({ name: String(frame.name), path: frame.source?.path ?? null, line: frame.line, column: frame.column ?? null }));
      stop.stack_truncated = frames.length > MAX_FRAMES;
      if (capture.variables_depth > 0 && frames.length > 0) {
        const scopes = (await client.request('scopes', { frameId: frames[0].id })).scopes ?? [];
        for (const scope of scopes.filter((item) => !item.expensive).slice(0, 4)) {
          stop.scopes.push({ name: String(scope.name), ...(await variablesOf(client, scope.variablesReference, capture.variables_depth)) });
        }
      }
      return stop;
    };

    const remaining = [...steps];
    for (;;) {
      const event = await nextEvent(
        (item) => ['stopped', 'terminated'].includes(item.event) && (item.event === 'stopped' || item.source === root_client),
        'a stop',
      );
      if (event.event === 'terminated') {
        terminated = true;
        // The program's last bytes may still be in the pipe when the event arrives.
        if (runtime === 'python') await Promise.race([new Promise((resolve) => child.once('close', resolve)), delay(EXIT_GRACE_MS * 2)]);
        break;
      }
      if (stops.length >= MAX_STOPS) {
        reason = 'stop_limit';
        break;
      }
      stops.push(await snapshot(event.source, event.body));
      const op = remaining.shift();
      if (!op) {
        reason = 'steps_exhausted';
        break;
      }
      await event.source.request(op.op ?? op, { threadId: event.body.threadId });
    }
    for (const client of clients)
      await Promise.race([client.request('disconnect', { terminateDebuggee: true }).catch(() => {}), delay(1500)]);
  } finally {
    await Promise.allSettled(sessions);
    for (const client of clients) client.destroy();
    child.kill('SIGKILL');
  }
  return { runtime, stops, terminated, reason, output: { text: output.join(''), truncated: outputTruncated } };
}

/** Print the result; a result too large for the stdout budget is handed over through /artifacts. */
function emit(result, write, artifactsDirectory) {
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized) <= INLINE_LIMIT_BYTES || !artifactsDirectory) {
    write(serialized);
    return;
  }
  const bytes = Buffer.from(serialized);
  fs.writeFileSync(path.join(artifactsDirectory, 'result.json'), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  write(JSON.stringify([{ path: '/artifacts/result.json', media_type: 'application/json', bytes: bytes.length, sha256 }]));
}

async function main(argv, write, artifactsDirectory) {
  try {
    emit({ ok: true, result: await runSession(JSON.parse(argv[0])) }, write, artifactsDirectory);
    return 0;
  } catch (error) {
    write(JSON.stringify({ ok: false, code: error.code || 'ENV_DAP_HOST_FAILURE' }));
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2), (line) => process.stdout.write(line), fs.existsSync('/artifacts') ? '/artifacts' : null).then((code) =>
    process.exit(code),
  );
}

module.exports = {
  MAX_CHILDREN,
  childConfiguration,
  ALLOWED_REQUESTS,
  DapHostError,
  STEP_OPS,
  clip,
  createClient,
  emit,
  main,
  runSession,
};
