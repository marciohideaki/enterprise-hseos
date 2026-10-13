'use strict';

// Controller side of environment.dap.v1: a scripted, bounded debug session. The adapter and the debuggee run inside
// the P1 sandbox against a read-only workspace; everything they report is validated here before it becomes data.
// Out of contract by design: evaluate, setVariable, setExpression, restartFrame and conditional breakpoints (a
// condition is an expression the debuggee would execute), so none of them can be requested.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { canonical, resolveReal, LspError } = require('./lsp');

const CONTRACT = 'environment.dap.v1';
const RUNTIMES = new Set(['node', 'python']);
const STEP_OPS = new Set(['continue', 'next', 'stepIn', 'stepOut']);
const EXTENSIONS = { node: /\.(?:js|mjs|cjs)$/, python: /\.py$/ };
const ADAPTER_ENTRIES = {
  node: ['js-debug/js-debug/src/dapDebugServer.js'],
  python: ['debugpy/debugpy/__init__.py'],
};
const HOST_FILES = ['dap-host.js', 'framing.js'];
const SANDBOX_ROOT = '/workspace';
const SANDBOX_TOOLCHAIN = '/opt/hseos/toolchain';
const SANDBOX_SCRATCH = '/dev/shm';
const MODULE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,7}$/;
const MAX_BREAKPOINTS = 20;
const MAX_STEPS = 20;
const MAX_ARGS = 16;
const MAX_TEXT = 512;
const MAX_STOPS = 25;
const MAX_FRAMES = 20;
const MAX_SCOPES = 4;
const MAX_VARIABLES = 50;
const MAX_OUTPUT_TEXT = 4096;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120_000;
// Time the sandbox gets beyond the host's own deadline to report and be reaped before the executor kills it.
const GRACE_MS = 10_000;

class DapError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DapError';
    this.code = code;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const within = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
const isLine = (value) => Number.isSafeInteger(value) && value >= 1 && value <= 10_000_000;
const isText = (value, limit = 1024) => typeof value === 'string' && value.length > 0 && value.length <= limit && !value.includes('\0');

/** Shape check only; scope is checked separately because it needs the filesystem. */
function parseInput(input) {
  const issue = (message) => ({ success: false, error: { hseos_code: 'ENV_DAP_INPUT_INVALID', issues: [{ message }] } });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return issue('input must be an object');
  const exact = (value, allowed) =>
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key));
  if (!exact(input, ['runtime', 'launch', 'breakpoints', 'steps', 'capture', 'timeout_ms'])) return issue('input has an unknown field');
  if (!RUNTIMES.has(input.runtime)) return issue('runtime is not supported');
  const { launch } = input;
  if (!exact(launch, ['program', 'module', 'args', 'cwd'])) return issue('launch is invalid');
  if ((launch.program === undefined) === (launch.module === undefined)) return issue('launch needs exactly one of program or module');
  if (launch.module !== undefined && (input.runtime !== 'python' || !MODULE.test(launch.module)))
    return issue('module is only valid for python and must be a dotted name');
  if (launch.program !== undefined && (!isText(launch.program) || !EXTENSIONS[input.runtime].test(launch.program)))
    return issue('program does not match the runtime');
  if (launch.cwd !== undefined && !isText(launch.cwd)) return issue('cwd must be a path');
  if (
    launch.args !== undefined &&
    (!Array.isArray(launch.args) ||
      launch.args.length > MAX_ARGS ||
      !launch.args.every((item) => typeof item === 'string' && item.length <= 256 && !item.includes('\0')))
  ) {
    return issue('args must be a short list of strings');
  }
  const breakpoints = input.breakpoints ?? [];
  if (!Array.isArray(breakpoints) || breakpoints.length > MAX_BREAKPOINTS) return issue('breakpoints must be a short list');
  for (const item of breakpoints) {
    if (!exact(item, ['file', 'line'])) return issue('a breakpoint takes only file and line (conditions would run code in the debuggee)');
    if (!isText(item.file) || !EXTENSIONS[input.runtime].test(item.file) || !isLine(item.line)) return issue('breakpoint is invalid');
  }
  const steps = input.steps ?? [];
  if (!Array.isArray(steps) || steps.length > MAX_STEPS) return issue('steps must be a short list');
  for (const item of steps) if (!exact(item, ['op']) || !STEP_OPS.has(item.op)) return issue('step operation is not supported');
  const capture = input.capture ?? { stack: true, variables_depth: 1 };
  if (!exact(capture, ['stack', 'variables_depth']) || typeof capture.stack !== 'boolean' || ![0, 1, 2].includes(capture.variables_depth))
    return issue('capture is invalid');
  const timeout = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) return issue('timeout_ms is out of range');
  return { success: true, data: { ...input, breakpoints, steps, capture, timeout_ms: timeout } };
}

const DAP_INPUT_SCHEMA = Object.freeze({ version: 1, safeParse: parseInput });
const DAP_OUTPUT_SCHEMA = Object.freeze({
  version: 1,
  safeParse: (value) =>
    value && value.contract === CONTRACT && value.source?.authority === 'data' && value.source?.provenance?.trust === 'untrusted'
      ? { success: true, data: value }
      : { success: false, error: { hseos_code: 'ENV_DAP_OUTPUT_INVALID', issues: [{ message: 'output is not untrusted data' }] } },
});

/**
 * Install the hseos host files next to the pins so the sandbox mounts one read-only directory.
 * The installer is injected so the controller never pulls pin code unless a toolchain is requested.
 */
function prepareDapToolchain({ install, cacheDirectory, destination }) {
  let installed;
  try {
    installed = install({ cacheDirectory, destination, names: ['debugpy', 'js-debug'] });
  } catch (error) {
    return Object.freeze({ status: 'blocked', code: error.code || 'ENV_TOOLCHAIN_BLOCKED', cause: error.message });
  }
  fs.mkdirSync(path.join(destination, 'host'), { recursive: true, mode: 0o700 });
  for (const name of HOST_FILES) fs.copyFileSync(path.join(__dirname, name), path.join(destination, 'host', name));
  return Object.freeze({ status: 'ready', root: destination, pins: installed.pins });
}

function createDapService({ policy, toolchain, execute, createChannel, ledger = () => {}, now = () => new Date() }) {
  const workspace = fs.realpathSync(policy.host_workspace);
  const record = (event) => ledger(Object.freeze({ contract: CONTRACT, at: now().toISOString(), ...event }));
  const refuse = (code, cause, extra = {}) => {
    record({ type: 'environment.dap.refused', code, cause, ...extra });
    return Object.freeze({ contract: CONTRACT, status: 'refused', code, cause, ...extra });
  };
  const blocked = (code, cause) => {
    record({ type: 'environment.dap.blocked', code, cause });
    return Object.freeze({ contract: CONTRACT, status: 'blocked', code, cause });
  };

  /**
   * Map a user path (workspace-relative, or absolute under /workspace) to its real in-root location. A parent-directory
   * segment is refused in the raw text, before any normalisation could hide it.
   */
  function scopePath(text) {
    let decoded;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      decoded = text;
    }
    if ([text, decoded].some((item) => item.split(/[/\\]/).includes('..')))
      throw new DapError('path has a parent-directory segment', 'ENV_DAP_OUT_OF_SCOPE');
    let host;
    if (path.isAbsolute(text)) {
      const lexical = path.normalize(text);
      if (!within(SANDBOX_ROOT, lexical)) throw new DapError('path is outside the workspace root', 'ENV_DAP_OUT_OF_SCOPE');
      host = path.join(workspace, path.relative(SANDBOX_ROOT, lexical));
    } else {
      host = path.join(workspace, text);
    }
    let real;
    try {
      real = resolveReal(host);
    } catch (error) {
      throw new DapError(error.message, error instanceof LspError ? 'ENV_DAP_OUT_OF_SCOPE' : 'ENV_DAP_INPUT_INVALID');
    }
    if (!within(workspace, real)) throw new DapError('path resolves outside the workspace root', 'ENV_DAP_OUT_OF_SCOPE');
    return { host: real, relative: path.relative(workspace, real) || '.' };
  }

  const existingFile = (resolved) => {
    if (!fs.existsSync(resolved.host) || !fs.statSync(resolved.host).isFile())
      throw new DapError('file does not exist', 'ENV_DAP_INPUT_INVALID');
    return resolved.relative;
  };

  // Text is never cut silently: the structure says it was cut and how long it was.
  const clip = (value) => {
    const text = String(value ?? '');
    return text.length > MAX_TEXT
      ? { value: `${text.slice(0, MAX_TEXT)}...[truncated]`, truncated: true, original_length: text.length }
      : { value: text, truncated: false };
  };

  /** Host path of a reported frame: in-root files become relative; everything else is withheld, never echoed. */
  function frameLocation(reported) {
    if (typeof reported !== 'string' || !path.isAbsolute(reported)) return { path: null, external: reported != null };
    try {
      const mapped = scopePath(reported);
      return { path: mapped.relative, external: false };
    } catch {
      return { path: null, external: true };
    }
  }

  // Anything the host reports is checked again here: shapes, counts and depth, with every cut marked.
  const invalid = () => {
    throw new DapError('adapter result does not match the contract', 'ENV_DAP_RESULT_INVALID');
  };
  const count = (value, limit) => {
    if (!Array.isArray(value) || value.length > limit) invalid();
    return value;
  };
  const natural = (value) => Number.isSafeInteger(value) && value >= 0;
  /** Text bounded to `limit`; the flag is added only when something was cut. */
  const bounded = (value, key, limit) => {
    const text = String(value ?? '');
    return text.length > limit
      ? { [key]: text.slice(0, limit), [`${key}_truncated`]: true, [`${key}_original_length`]: text.length }
      : { [key]: text };
  };

  function variables(list, depth) {
    return {
      variables: count(list.variables, MAX_VARIABLES).map((item) => {
        if (item.children && depth < 2) invalid();
        return {
          ...bounded(item.name, 'name', 256),
          ...clip(item.value),
          ...(item.type == null ? { type: null } : bounded(item.type, 'type', 128)),
          ...(item.children ? { children: variables(item.children, depth - 1) } : {}),
        };
      }),
      total: Number.isSafeInteger(list.total) ? list.total : list.variables.length,
      truncated: list.truncated === true,
    };
  }

  function normalize(raw, capture) {
    return {
      stops: count(raw.stops, MAX_STOPS).map((stop) => {
        const stack = count(stop.stack, MAX_FRAMES);
        const scopes = count(stop.scopes, MAX_SCOPES);
        if ((!capture.stack && stack.length > 0) || (capture.variables_depth === 0 && scopes.length > 0)) invalid();
        return {
          ...bounded(stop.reason, 'reason', 64),
          stack: stack.map((frame) => {
            if (!natural(frame.line) || !(frame.column === null || natural(frame.column))) invalid();
            return { ...bounded(frame.name, 'name', 256), ...frameLocation(frame.path), line: frame.line, column: frame.column };
          }),
          stack_truncated: stop.stack_truncated === true,
          scopes: scopes.map((scope) => ({ ...bounded(scope.name, 'name', 128), ...variables(scope, capture.variables_depth) })),
        };
      }),
      terminated: raw.terminated === true,
      ...bounded(raw.reason, 'reason', 64),
      output: { ...bounded(raw.output.text, 'text', MAX_OUTPUT_TEXT), truncated: raw.output.truncated === true },
    };
  }

  async function readHostOutput(execution, channel) {
    const text = execution.stdout.trim();
    if (text.startsWith('[')) {
      const [artifact] = channel.verify(text);
      return JSON.parse(artifact.content.toString('utf8'));
    }
    return JSON.parse(text);
  }

  async function run(input) {
    const parsed = parseInput(input);
    if (!parsed.success) return refuse(parsed.error.hseos_code, parsed.error.issues[0].message);
    const request = parsed.data;
    const inputDigest = sha256(canonical(request));
    const scoped = { breakpoints: [] };
    try {
      if (request.launch.program !== undefined) scoped.program = existingFile(scopePath(request.launch.program));
      if (request.launch.cwd !== undefined) {
        const cwd = scopePath(request.launch.cwd);
        if (!fs.existsSync(cwd.host) || !fs.statSync(cwd.host).isDirectory())
          throw new DapError('cwd does not exist', 'ENV_DAP_INPUT_INVALID');
        scoped.cwd = cwd.relative;
      }
      for (const item of request.breakpoints) scoped.breakpoints.push({ file: existingFile(scopePath(item.file)), line: item.line });
    } catch (error) {
      return refuse(error.code === 'ENV_DAP_OUT_OF_SCOPE' ? error.code : 'ENV_DAP_INPUT_INVALID', error.message, {
        input_digest: inputDigest,
      });
    }
    // The adapter and the debuggee need loopback sockets and child pipes, which the P0 filter denies.
    if (!['P1', 'P2'].includes(policy.profile))
      return blocked('ENV_DAP_PROFILE_INSUFFICIENT', 'the debug adapter needs a loopback profile (P1)');
    if (toolchain.status !== 'ready') return blocked(toolchain.code, toolchain.cause);
    for (const entry of ADAPTER_ENTRIES[request.runtime]) {
      if (!fs.existsSync(path.join(toolchain.root, entry)))
        return blocked('ENV_DAP_ADAPTER_UNAVAILABLE', `debug adapter for ${request.runtime} is not installed`);
    }
    const channel = createChannel();
    try {
      const hostRequest = {
        runtime: request.runtime,
        launch: {
          ...request.launch,
          ...(scoped.program === undefined ? {} : { program: scoped.program }),
          ...(scoped.cwd === undefined ? {} : { cwd: scoped.cwd }),
        },
        breakpoints: scoped.breakpoints,
        steps: request.steps,
        capture: request.capture,
        root: SANDBOX_ROOT,
        toolchain: SANDBOX_TOOLCHAIN,
        scratch: SANDBOX_SCRATCH,
        node: '/usr/bin/node',
        python: '/usr/bin/python3',
        timeout_ms: request.timeout_ms,
      };
      const execution = await execute({
        policy,
        command: ['/usr/bin/node', `${SANDBOX_TOOLCHAIN}/host/dap-host.js`, JSON.stringify(hostRequest)],
        host_node: true,
        timeout_ms: request.timeout_ms + GRACE_MS,
        max_output_bytes: 65_536,
        limits: { pids_max: 128, memory_max_bytes: 2_147_483_648, shm_bytes: 67_108_864 },
        artifact_channel: channel,
        readonly_mounts: [{ source: toolchain.root, target: SANDBOX_TOOLCHAIN }],
      });
      const drained = { descendants_terminated: execution.descendants_terminated === true, pids_peak: execution.pids_peak };
      let host;
      try {
        host = await readHostOutput(execution, channel);
      } catch {
        host = null;
      }
      if (execution.status !== 'succeeded' || !host?.ok) {
        const code =
          host?.code || (execution.status === 'succeeded' ? 'ENV_DAP_OUTPUT_INVALID' : `ENV_DAP_${String(execution.status).toUpperCase()}`);
        const unavailable = ['ENV_DAP_ADAPTER_UNAVAILABLE', 'ENV_DAP_ADAPTER_EXITED'].includes(code);
        return unavailable
          ? blocked(code, 'debug adapter could not run')
          : refuse(code, 'debug session did not succeed', { input_digest: inputDigest, execution: drained });
      }
      let result;
      try {
        result = normalize(host.result, request.capture);
      } catch {
        return refuse('ENV_DAP_RESULT_INVALID', 'adapter result could not be validated', { input_digest: inputDigest });
      }
      const digest = sha256(canonical(result));
      const sourceRef = `environment.dap.${request.runtime}`;
      const output = Object.freeze({
        contract: CONTRACT,
        status: 'ok',
        runtime: request.runtime,
        result,
        source: Object.freeze({
          source_ref: sourceRef,
          authority: 'data',
          provenance: Object.freeze({
            origin: 'dap',
            source_ref: sourceRef,
            digest: `sha256:${digest}`,
            retrieved_at: now().toISOString(),
            trust: 'untrusted',
            transform: [],
          }),
        }),
        execution: Object.freeze({
          profile: execution.profile,
          limits: execution.limits,
          pids_peak: execution.pids_peak,
          memory_peak_bytes: execution.memory_peak_bytes,
          workspace_access: execution.workspace_access,
          descendants_terminated: execution.descendants_terminated,
        }),
      });
      record({
        type: 'environment.dap.completed',
        runtime: request.runtime,
        input_digest: inputDigest,
        output_digest: digest,
        stops: result.stops.length,
        pids_peak: execution.pids_peak,
      });
      return output;
    } finally {
      channel.dispose();
    }
  }

  return Object.freeze({ run });
}

module.exports = { CONTRACT, DAP_INPUT_SCHEMA, DAP_OUTPUT_SCHEMA, DapError, createDapService, parseInput, prepareDapToolchain };
