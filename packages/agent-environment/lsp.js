'use strict';

// Controller side of environment.lsp.v1. The language server runs inside the P0 sandbox against a read-only
// workspace; everything it returns is validated here before it becomes untrusted data.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fileURLToPath } = require('node:url');

const CONTRACT = 'environment.lsp.v1';
const ACTIONS = new Set(['diagnostics', 'definition', 'references', 'hover', 'rename_preview']);
const EXTENSIONS = { typescript: /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, python: /\.pyi?$/ };
const SERVER_ENTRIES = {
  typescript: ['typescript-language-server/package/lib/cli.mjs', 'typescript/package/lib/tsserver.js'],
  python: ['pyright/package/langserver.index.js'],
};
const HOST_FILES = ['lsp-host.js', 'framing.js'];
const SANDBOX_ROOT = '/workspace';
const SANDBOX_TOOLCHAIN = '/opt/hseos/toolchain';
// Private tmpfs of the sandbox (size set by the controller); HOME and TMPDIR of the server point here.
const SANDBOX_SCRATCH = '/dev/shm';
const NEW_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_EDITS = 2000;
const MAX_TEXT = 4096;
const TIMEOUT_MS = 60_000;

class LspError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LspError';
    this.code = code;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isPosition(value) {
  return value && typeof value === 'object' && Number.isSafeInteger(value.line) && value.line >= 0 && Number.isSafeInteger(value.character) && value.character >= 0;
}

/** Shape check only; scope is checked separately because it needs the filesystem. */
function parseInput(input) {
  const issue = (message) => ({ success: false, error: { hseos_code: 'ENV_LSP_INPUT_INVALID', issues: [{ message }] } });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return issue('input must be an object');
  const allowed = new Set(['action', 'language', 'file', 'position', 'new_name']);
  if (Object.keys(input).some((key) => !allowed.has(key))) return issue('input has an unknown field');
  if (!ACTIONS.has(input.action)) return issue('action is not supported');
  if (!Object.hasOwn(EXTENSIONS, input.language)) return issue('language is not supported');
  if (typeof input.file !== 'string' || input.file.length === 0 || input.file.length > 1024 || input.file.includes('\0')) return issue('file must be a path');
  if (!EXTENSIONS[input.language].test(input.file)) return issue('file does not match the language');
  if (input.action !== 'diagnostics' && !isPosition(input.position)) return issue('position is required');
  if (input.action === 'rename_preview' && !NEW_NAME.test(input.new_name ?? '')) return issue('new_name must be an identifier');
  if (input.action !== 'rename_preview' && input.new_name !== undefined) return issue('new_name is only valid for rename_preview');
  return { success: true, data: input };
}

const LSP_INPUT_SCHEMA = Object.freeze({ version: 1, safeParse: parseInput });
const LSP_OUTPUT_SCHEMA = Object.freeze({
  version: 1,
  safeParse: (value) =>
    value && value.contract === CONTRACT && value.source?.authority === 'data' && value.source?.provenance?.trust === 'untrusted'
      ? { success: true, data: value }
      : { success: false, error: { hseos_code: 'ENV_LSP_OUTPUT_INVALID', issues: [{ message: 'output is not untrusted data' }] } },
});

const within = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

const MAX_LINK_HOPS = 40;

/**
 * Canonicalise an absolute path component by component, the way the kernel does, but tolerating a tail that does
 * not exist yet. Every symlink target is resolved against the REAL directory reached so far (an absolute target
 * restarts at the filesystem root), `..` always climbs from that real directory, and missing components are
 * appended as they are. So `linkdir/new.py`, a dangling link and a link seen through a symlinked parent all land
 * where a create or rename would really put them. At most 40 links are followed.
 */
function resolveReal(candidate) {
  const pending = candidate.split('/').filter(Boolean).toReversed();
  let real = '/';
  let hops = 0;
  while (pending.length > 0) {
    const part = pending.pop();
    if (part === '.') continue;
    if (part === '..') {
      real = path.dirname(real);
      continue;
    }
    const next = path.join(real, part);
    let stat;
    try {
      stat = fs.lstatSync(next);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw new LspError('path cannot be inspected', 'ENV_LSP_OUT_OF_SCOPE');
      real = next;
      continue;
    }
    if (!stat.isSymbolicLink()) {
      real = next;
      continue;
    }
    hops += 1;
    if (hops > MAX_LINK_HOPS) throw new LspError('too many symbolic links', 'ENV_LSP_OUT_OF_SCOPE');
    const target = fs.readlinkSync(next);
    if (path.isAbsolute(target)) real = '/';
    pending.push(...target.split('/').filter(Boolean).toReversed());
  }
  return real;
}

/**
 * Install the hseos host files next to the pins so the sandbox mounts one read-only directory.
 * The installer is injected so the controller never pulls pin code unless a toolchain is requested.
 */
function prepareLspToolchain({ install, cacheDirectory, destination }) {
  let installed;
  try {
    installed = install({ cacheDirectory, destination, names: ['typescript-language-server', 'typescript', 'pyright'] });
  } catch (error) {
    return Object.freeze({ status: 'blocked', code: error.code || 'ENV_TOOLCHAIN_BLOCKED', cause: error.message });
  }
  fs.mkdirSync(path.join(destination, 'host'), { recursive: true, mode: 0o700 });
  for (const name of HOST_FILES) fs.copyFileSync(path.join(__dirname, name), path.join(destination, 'host', name));
  return Object.freeze({ status: 'ready', root: destination, pins: installed.pins });
}

function createLspService({ policy, toolchain, execute, createChannel, ledger = () => {}, now = () => new Date(), timeoutMs = TIMEOUT_MS }) {
  const workspace = fs.realpathSync(policy.host_workspace);
  const record = (event) => ledger(Object.freeze({ contract: CONTRACT, at: now().toISOString(), ...event }));
  const refuse = (code, cause, extra = {}) => {
    record({ type: 'environment.lsp.refused', code, cause, ...extra });
    return Object.freeze({ contract: CONTRACT, status: 'refused', code, cause });
  };
  const blocked = (code, cause) => {
    record({ type: 'environment.lsp.blocked', code, cause });
    return Object.freeze({ contract: CONTRACT, status: 'blocked', code, cause });
  };

  /** Host path of a location reported by the server; anything outside the workspace root is out of scope. */
  function scoped(location) {
    // A parent-directory segment is never collapsed (the URL parser would do it silently, so the raw text is checked):
    // servers report canonical paths, so one is a refusal, not a shortcut.
    let decoded;
    try {
      decoded = decodeURIComponent(location);
    } catch {
      throw new LspError('location is not valid text', 'ENV_LSP_OUT_OF_SCOPE');
    }
    if (decoded.split(/[/\\]/).includes('..')) throw new LspError('location has a parent-directory segment', 'ENV_LSP_OUT_OF_SCOPE');
    let absolute;
    try {
      absolute = location.startsWith('file:') ? fileURLToPath(location) : location;
    } catch {
      throw new LspError('location is not a file URI', 'ENV_LSP_OUT_OF_SCOPE');
    }
    const lexical = path.normalize(absolute);
    const mapped = within(SANDBOX_ROOT, lexical) ? path.join(workspace, path.relative(SANDBOX_ROOT, lexical)) : null;
    if (!mapped) throw new LspError('location is outside the workspace root', 'ENV_LSP_OUT_OF_SCOPE');
    const real = resolveReal(mapped);
    if (!within(workspace, real)) throw new LspError('location resolves outside the workspace root', 'ENV_LSP_OUT_OF_SCOPE');
    return path.relative(workspace, real) || '.';
  }

  const range = (value) => ({ start: { ...value.start }, end: { ...value.end } });
  const location = (item) => ({ path: scoped(item.uri ?? item.targetUri), range: range(item.range ?? item.targetSelectionRange) });
  // Text is never cut silently: the structure says it was cut and how long it was.
  const clip = (value, key) => {
    const text = String(value);
    return text.length > MAX_TEXT
      ? { [key]: `${text.slice(0, MAX_TEXT)}...[truncated]`, truncated: true, original_length: text.length }
      : { [key]: text, truncated: false };
  };
  // The host bounds lists; `total` is what the server returned, so a cut list is visible too.
  const listed = (items, total) => ({ total: Number.isSafeInteger(total) ? total : items.length, truncated: Number.isSafeInteger(total) && total > items.length });

  function renameEdit(edit) {
    const files = new Map();
    const operations = [];
    const add = (uri, edits) => {
      const target = scoped(uri);
      if (!files.has(target)) files.set(target, []);
      for (const item of edits) files.get(target).push({ range: range(item.range), ...clip(item.newText, 'new_text') });
    };
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits);
    for (const change of edit.documentChanges ?? []) {
      if (change.kind) {
        operations.push({ kind: change.kind, path: scoped(change.uri ?? change.oldUri), ...(change.newUri ? { new_path: scoped(change.newUri) } : {}) });
      } else {
        add(change.textDocument.uri, change.edits);
      }
    }
    const total = [...files.values()].reduce((sum, edits) => sum + edits.length, 0);
    if (total > MAX_EDITS) throw new LspError('rename preview exceeds its edit budget', 'ENV_LSP_RESULT_TOO_LARGE');
    return {
      applied: false,
      truncated: [...files.values()].some((edits) => edits.some((item) => item.truncated)),
      files: [...files].map(([target, edits]) => ({ path: target, edits })),
      resource_operations: operations,
    };
  }

  const NORMALIZERS = {
    diagnostics: (raw) => ({
      diagnostics: raw.diagnostics.map((item) => ({
        range: range(item.range),
        severity: item.severity ?? null,
        code: item.code ?? null,
        source: item.source ?? null,
        ...clip(item.message, 'message'),
      })),
      ...listed(raw.diagnostics, raw.total),
    }),
    definition: (raw) => ({ locations: raw.locations.map(location), ...listed(raw.locations, raw.total) }),
    references: (raw) => ({ locations: raw.locations.map(location), ...listed(raw.locations, raw.total) }),
    hover: (raw) => clip(raw.hover, 'hover'),
    rename_preview: (raw) => ({ rename: renameEdit(raw.edit) }),
  };

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
    if (path.isAbsolute(request.file) || request.file.split(/[\\/]/).includes('..')) {
      return refuse('ENV_LSP_OUT_OF_SCOPE', 'file escapes the workspace root', { input_digest: inputDigest });
    }
    let target;
    try {
      target = resolveReal(path.join(workspace, request.file));
    } catch (error) {
      return refuse(error.code === 'ENV_LSP_OUT_OF_SCOPE' ? error.code : 'ENV_LSP_INPUT_INVALID', error.message, { input_digest: inputDigest });
    }
    if (!within(workspace, target)) return refuse('ENV_LSP_OUT_OF_SCOPE', 'file resolves outside the workspace root', { input_digest: inputDigest });
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return refuse('ENV_LSP_INPUT_INVALID', 'file does not exist', { input_digest: inputDigest });
    // Node children need AF_UNIX socketpairs (stdio pipes, tsserver IPC); P0 seccomp denies them, so P0 cannot host a server.
    if (!['P1', 'P2'].includes(policy.profile)) return blocked('ENV_LSP_PROFILE_INSUFFICIENT', 'the language server needs a loopback profile (P1)');
    if (toolchain.status !== 'ready') return blocked(toolchain.code, toolchain.cause);
    for (const entry of SERVER_ENTRIES[request.language]) {
      if (!fs.existsSync(path.join(toolchain.root, entry))) return blocked('ENV_LSP_SERVER_UNAVAILABLE', `language server for ${request.language} is not installed`);
    }
    const channel = createChannel();
    try {
      const hostRequest = { ...request, file: path.relative(workspace, target), root: SANDBOX_ROOT, toolchain: SANDBOX_TOOLCHAIN, timeout_ms: timeoutMs - 10_000, scratch: SANDBOX_SCRATCH };
      const execution = await execute({
        policy,
        command: ['/usr/bin/node', `${SANDBOX_TOOLCHAIN}/host/lsp-host.js`, JSON.stringify(hostRequest)],
        host_node: true,
        timeout_ms: timeoutMs,
        max_output_bytes: 65_536,
        limits: { pids_max: 128, memory_max_bytes: 2_147_483_648, shm_bytes: 67_108_864 },
        artifact_channel: channel,
        readonly_mounts: [{ source: toolchain.root, target: SANDBOX_TOOLCHAIN }],
      });
      let host;
      try {
        host = await readHostOutput(execution, channel);
      } catch {
        host = null;
      }
      if (execution.status !== 'succeeded' || !host?.ok) {
        const code = host?.code || (execution.status === 'succeeded' ? 'ENV_LSP_OUTPUT_INVALID' : `ENV_LSP_${String(execution.status).toUpperCase()}`);
        const unavailable = ['ENV_LSP_SERVER_UNAVAILABLE', 'ENV_LSP_SERVER_EXITED'].includes(code);
        return unavailable ? blocked(code, 'language server could not run') : refuse(code, 'language server call did not succeed', { input_digest: inputDigest });
      }
      let result;
      try {
        result = NORMALIZERS[request.action](host.result);
      } catch (error) {
        return refuse(error.code || 'ENV_LSP_RESULT_INVALID', error.message, { input_digest: inputDigest });
      }
      const digest = sha256(canonical(result));
      const sourceRef = `environment.lsp.${request.action}`;
      const output = Object.freeze({
        contract: CONTRACT,
        status: 'ok',
        action: request.action,
        language: request.language,
        result,
        source: Object.freeze({
          source_ref: sourceRef,
          authority: 'data',
          provenance: Object.freeze({ origin: 'lsp', source_ref: sourceRef, digest: `sha256:${digest}`, retrieved_at: now().toISOString(), trust: 'untrusted', transform: [] }),
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
      record({ type: 'environment.lsp.completed', action: request.action, language: request.language, input_digest: inputDigest, output_digest: digest, pids_peak: execution.pids_peak });
      return output;
    } finally {
      channel.dispose();
    }
  }

  return Object.freeze({ run });
}

module.exports = { CONTRACT, resolveReal, LSP_INPUT_SCHEMA, LSP_OUTPUT_SCHEMA, LspError, canonical, createLspService, parseInput, prepareLspToolchain };
