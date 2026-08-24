'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const yaml = require('yaml');

const { canonicalJson } = require('../../../packages/agent-session-store');
const { DelegatedRuntimeHost, DelegatedRuntimeStore } = require('../../../packages/delegated-runtime-host');
const { CodexAppServerDriver, CodexRuntimeProvider } = require('../../../packages/runtime-providers');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { createExecutionLedgerFileFixture, openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');

const PROFILE_ID = 'agent-codex-delegated-candidate';
const PROVIDER_ID = 'runtime:codex-app-server';
const MANIFEST_FILE = 'delegated-codex.json';

class DelegatedCodexError extends Error {
  constructor(message, code = 'DELEGATED_CODEX_INVALID') {
    super(message);
    this.name = 'DelegatedCodexError';
    this.code = code;
  }
}

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DelegatedCodexError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new DelegatedCodexError(`${label} has an invalid shape`);
}

function text(value, label, maximum = 4096) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximum || value.includes('\u0000')) {
    throw new DelegatedCodexError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function digestFile(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function validateBinding(value) {
  exact(
    value,
    ['schema_version', 'profile_id', 'runtime_provider_id', 'executable', 'args', 'cwd', 'env_names', 'secret_refs'],
    'delegated Codex binding',
  );
  if (value.schema_version !== 1 || value.profile_id !== PROFILE_ID || value.runtime_provider_id !== PROVIDER_ID) {
    throw new DelegatedCodexError('delegated Codex binding selects an unsupported capability');
  }
  if (!path.isAbsolute(value.executable) || !path.isAbsolute(value.cwd)) {
    throw new DelegatedCodexError('delegated Codex executable and cwd must be absolute');
  }
  const executable = fs.realpathSync(value.executable);
  const cwd = fs.realpathSync(value.cwd);
  if (!fs.statSync(executable).isFile() || !fs.statSync(cwd).isDirectory()) {
    throw new DelegatedCodexError('delegated Codex executable or cwd has the wrong type');
  }
  if (!Array.isArray(value.args) || value.args.length > 16) throw new DelegatedCodexError('delegated Codex args are invalid');
  const args = value.args.map((entry) => text(entry, 'delegated Codex argument', 1024));
  if (!Array.isArray(value.env_names) || value.env_names.length > 64 || new Set(value.env_names).size !== value.env_names.length) {
    throw new DelegatedCodexError('delegated Codex env_names are invalid');
  }
  for (const name of value.env_names) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) {
      throw new DelegatedCodexError('delegated Codex environment name is invalid');
    }
  }
  if (!Array.isArray(value.secret_refs) || value.secret_refs.some((entry) => typeof entry !== 'string' || !entry.startsWith('secret://'))) {
    throw new DelegatedCodexError('delegated Codex secret_refs are invalid');
  }
  return Object.freeze({
    schema_version: 1,
    profile_id: PROFILE_ID,
    runtime_provider_id: PROVIDER_ID,
    executable,
    executable_sha256: digestFile(executable),
    args: Object.freeze(args),
    cwd,
    env_names: Object.freeze([...value.env_names]),
    secret_refs: Object.freeze([...value.secret_refs]),
  });
}

function readBinding(filename) {
  const resolved = path.resolve(text(filename, 'binding path'));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new DelegatedCodexError('delegated Codex binding must be a single regular file');
  }
  try {
    return validateBinding(yaml.parse(fs.readFileSync(resolved, 'utf8')));
  } catch (error) {
    if (error instanceof DelegatedCodexError) throw error;
    throw new DelegatedCodexError('delegated Codex binding is malformed');
  }
}

function validateManifest(value) {
  exact(
    value,
    [
      'schema_version',
      'profile_id',
      'runtime_provider_id',
      'session_id',
      'executable',
      'executable_sha256',
      'args',
      'cwd',
      'env_names',
      'secret_refs',
    ],
    'delegated Codex manifest',
  );
  if (
    value.schema_version !== 1 ||
    value.profile_id !== PROFILE_ID ||
    value.runtime_provider_id !== PROVIDER_ID ||
    !path.isAbsolute(value.executable) ||
    !path.isAbsolute(value.cwd) ||
    !/^[a-f0-9]{64}$/.test(value.executable_sha256) ||
    digestFile(fs.realpathSync(value.executable)) !== value.executable_sha256
  ) {
    throw new DelegatedCodexError('delegated Codex manifest or executable binding drifted');
  }
  text(value.session_id, 'delegated Codex session id', 1024);
  if (
    !Array.isArray(value.args) ||
    value.args.length > 16 ||
    !Array.isArray(value.env_names) ||
    value.env_names.length > 64 ||
    new Set(value.env_names).size !== value.env_names.length ||
    !Array.isArray(value.secret_refs)
  ) {
    throw new DelegatedCodexError('delegated Codex manifest lists are malformed');
  }
  const args = value.args.map((entry) => text(entry, 'delegated Codex manifest argument', 1024));
  for (const name of value.env_names) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) {
      throw new DelegatedCodexError('delegated Codex manifest environment name is invalid');
    }
  }
  if (value.secret_refs.some((entry) => typeof entry !== 'string' || !entry.startsWith('secret://'))) {
    throw new DelegatedCodexError('delegated Codex manifest secret_refs are invalid');
  }
  return Object.freeze({
    ...value,
    executable: fs.realpathSync(value.executable),
    cwd: fs.realpathSync(value.cwd),
    args: Object.freeze(args),
    env_names: Object.freeze([...value.env_names]),
    secret_refs: Object.freeze([...value.secret_refs]),
  });
}

function writeManifest(directory, manifest) {
  fs.writeFileSync(path.join(directory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

function readManifest(directory) {
  const filename = path.join(directory, MANIFEST_FILE);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new DelegatedCodexError('delegated Codex manifest must be a single regular file');
  }
  try {
    return validateManifest(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch (error) {
    if (error instanceof DelegatedCodexError) throw error;
    throw new DelegatedCodexError('delegated Codex manifest is malformed');
  }
}

function manifestFrom(binding, sessionId) {
  return {
    schema_version: binding.schema_version,
    profile_id: binding.profile_id,
    runtime_provider_id: binding.runtime_provider_id,
    session_id: sessionId,
    executable: binding.executable,
    executable_sha256: binding.executable_sha256,
    args: [...binding.args],
    cwd: binding.cwd,
    env_names: [...binding.env_names],
    secret_refs: [...binding.secret_refs],
  };
}

function sessionSpec(manifest) {
  return {
    schema_version: 1,
    session_id: manifest.session_id,
    agent_id: 'agent:codex-delegated',
    parent_session_id: null,
    authority_ref: 'authority://codex/instructions-only',
    policy_ref: 'policy://codex/l0',
    execution: { mode: 'delegated', runtime_provider_id: PROVIDER_ID, profile: 'instructions-only' },
    limits: { max_turns: 32, max_tokens: 1_000_000, max_duration_ms: 3_600_000, max_tool_calls: 0, max_children: 0, max_workflow_steps: 0 },
    metadata: {
      cwd: manifest.cwd,
      profile_id: PROFILE_ID,
      operational: false,
      binding_sha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex'),
    },
  };
}

function runtimeEnvironment(manifest) {
  return Object.fromEntries(manifest.env_names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
}

function assertDurableBinding(state, manifest) {
  const expected = createHash('sha256').update(canonicalJson(manifest)).digest('hex');
  if (
    state.spec?.execution?.runtime_provider_id !== PROVIDER_ID ||
    state.spec?.metadata?.profile_id !== PROFILE_ID ||
    state.spec?.metadata?.operational !== false ||
    state.spec?.metadata?.binding_sha256 !== expected
  ) {
    throw new DelegatedCodexError('delegated Codex manifest differs from the durable session binding');
  }
}

function assembly(db, manifest) {
  let provider;
  const store = new DelegatedRuntimeStore({ ledger: new ExecutionEventLedger(db) });
  const host = new DelegatedRuntimeHost({
    store,
    provider_factory: () => {
      provider ??= new CodexRuntimeProvider({
        provider_id: PROVIDER_ID,
        driver: new CodexAppServerDriver({
          executable: manifest.executable,
          args: manifest.args,
          cwd: manifest.cwd,
          env: runtimeEnvironment(manifest),
        }),
        default_cwd: manifest.cwd,
      });
      return provider;
    },
    operation_timeout_ms: 3_600_000,
  });
  return {
    host,
    async closeProviders() {
      if (provider) await Promise.allSettled([provider.close()]);
    },
  };
}

function summarize(handle, manifest, state, operation) {
  const terminalError = state.terminal_event?.payload?.error_code;
  return {
    schema_version: 1,
    profile: PROFILE_ID,
    state: handle.directory,
    session_id: manifest.session_id,
    status:
      state.terminal_event?.event_type === 'runtime.session.completed'
        ? 'completed'
        : terminalError === 'cancelled'
          ? 'cancelled'
          : state.failed || state.terminal
            ? 'failed'
            : 'active',
    terminal: state.terminal,
    current_sequence: state.version,
    operation,
    output: state.runtime_events
      .filter((event) => event.event_type === 'runtime.message.delta')
      .map((event) => event.payload.text)
      .join(''),
    world_state: null,
  };
}

async function runDelegatedCodex(options = {}) {
  if (options.createOnly) {
    throw new DelegatedCodexError('create-only is unavailable for the delegated Codex run-only profile', 'CAPABILITY_UNAVAILABLE');
  }
  const binding = readBinding(options.binding);
  const sessionId = options.sessionId || `session:${randomUUID()}`;
  text(sessionId, 'delegated Codex session id', 1024);
  const manifest = validateManifest(manifestFrom(binding, sessionId));
  const handle = createExecutionLedgerFileFixture();
  try {
    writeManifest(handle.directory, manifest);
    const assembled = assembly(handle.db, manifest);
    let state;
    try {
      state = await assembled.host.create({ request_id: `request:${randomUUID()}`, spec: sessionSpec(manifest) });
      state = await assembled.host.resumeAndSend({
        request_id: `request:${randomUUID()}`,
        session_id: sessionId,
        turn_id: `turn:${randomUUID()}`,
        message: { role: 'user', content: text(options.message || 'Execute the delegated instruction.', 'message', 262_144) },
      });
    } finally {
      await assembled.closeProviders();
    }
    return summarize(handle, manifest, state, 'run');
  } catch (error) {
    handle.cleanup();
    throw error;
  } finally {
    handle.close();
  }
}

async function resumeDelegatedCodex(options = {}) {
  if (!Number.isSafeInteger(options.expectedSequence) || options.expectedSequence < 0) {
    throw new DelegatedCodexError('expected_sequence is required and must be a non-negative safe integer');
  }
  const handle = openExecutionLedgerFileFixture(path.resolve(text(options.state, 'state')));
  try {
    const manifest = readManifest(handle.directory);
    const assembled = assembly(handle.db, manifest);
    try {
      const current = assembled.host.read(manifest.session_id);
      assertDurableBinding(current, manifest);
      if (current.version !== options.expectedSequence)
        throw new DelegatedCodexError('expected_sequence does not match delegated durable state');
      const state = await assembled.host.resumeAndSend({
        request_id: `request:${randomUUID()}`,
        session_id: manifest.session_id,
        turn_id: `turn:${randomUUID()}`,
        message: { role: 'user', content: text(options.message, 'message', 262_144) },
      });
      return summarize(handle, manifest, state, 'resume-and-send');
    } finally {
      await assembled.closeProviders();
    }
  } finally {
    handle.close();
  }
}

async function cancelDelegatedCodex(options = {}) {
  const handle = openExecutionLedgerFileFixture(path.resolve(text(options.state, 'state')));
  try {
    const manifest = readManifest(handle.directory);
    const assembled = assembly(handle.db, manifest);
    try {
      assertDurableBinding(assembled.host.read(manifest.session_id), manifest);
      const state = await assembled.host.resumeAndCancel({
        request_id: `request:${randomUUID()}`,
        session_id: manifest.session_id,
        reason: text(options.reason || 'cancelled from HSEOS CLI', 'reason', 2048),
      });
      return summarize(handle, manifest, state, 'cancel');
    } finally {
      await assembled.closeProviders();
    }
  } finally {
    handle.close();
  }
}

module.exports = {
  MANIFEST_FILE,
  PROFILE_ID,
  PROVIDER_ID,
  DelegatedCodexError,
  cancelDelegatedCodex,
  readBinding,
  resumeDelegatedCodex,
  runDelegatedCodex,
};
