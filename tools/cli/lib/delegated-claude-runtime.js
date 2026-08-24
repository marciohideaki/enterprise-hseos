'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const yaml = require('yaml');

const { canonicalJson } = require('../../../packages/agent-session-store');
const { DelegatedRuntimeHost, DelegatedRuntimeStore } = require('../../../packages/delegated-runtime-host');
const { ClaudeAgentSdkDriver, ClaudeCodeRuntimeProvider } = require('../../../packages/runtime-providers');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { createExecutionLedgerFileFixture, openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');

const PROFILE_ID = 'agent-claude-delegated-candidate';
const PROVIDER_ID = 'runtime:claude-agent-sdk';
const MANIFEST_FILE = 'delegated-claude.json';

class DelegatedClaudeError extends Error {
  constructor(message, code = 'DELEGATED_CLAUDE_INVALID') {
    super(message);
    this.name = 'DelegatedClaudeError';
    this.code = code;
  }
}

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DelegatedClaudeError(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new DelegatedClaudeError(`${label} has an invalid shape`);
  }
}

function text(value, label, maximum = 4096) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximum || value.includes('\u0000')) {
    throw new DelegatedClaudeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function digestFile(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function boundFile(filename, label, executable = false) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) {
    throw new DelegatedClaudeError(`${label} must be absolute`);
  }
  const resolved = fs.realpathSync(filename);
  if (!fs.statSync(resolved).isFile()) throw new DelegatedClaudeError(`${label} must be a file`);
  if (executable) {
    try {
      fs.accessSync(resolved, fs.constants.X_OK);
    } catch {
      throw new DelegatedClaudeError(`${label} must be executable`);
    }
  }
  return resolved;
}

function validateLists(value, label) {
  if (!Array.isArray(value.env_names) || value.env_names.length > 64 || new Set(value.env_names).size !== value.env_names.length) {
    throw new DelegatedClaudeError(`${label} env_names are invalid`);
  }
  for (const name of value.env_names) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) {
      throw new DelegatedClaudeError(`${label} environment name is invalid`);
    }
  }
  if (!Array.isArray(value.secret_refs) || value.secret_refs.some((entry) => typeof entry !== 'string' || !entry.startsWith('secret://'))) {
    throw new DelegatedClaudeError(`${label} secret_refs are invalid`);
  }
}

function validateBinding(value) {
  exact(
    value,
    ['schema_version', 'profile_id', 'runtime_provider_id', 'sdk_module', 'executable', 'cwd', 'env_names', 'secret_refs'],
    'delegated Claude binding',
  );
  if (value.schema_version !== 1 || value.profile_id !== PROFILE_ID || value.runtime_provider_id !== PROVIDER_ID) {
    throw new DelegatedClaudeError('delegated Claude binding selects an unsupported capability');
  }
  const sdkModule = boundFile(value.sdk_module, 'delegated Claude SDK module');
  const executable = boundFile(value.executable, 'delegated Claude executable', true);
  if (typeof value.cwd !== 'string' || !path.isAbsolute(value.cwd)) {
    throw new DelegatedClaudeError('delegated Claude cwd must be absolute');
  }
  const cwd = fs.realpathSync(value.cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new DelegatedClaudeError('delegated Claude cwd must be a directory');
  validateLists(value, 'delegated Claude binding');
  return Object.freeze({
    schema_version: 1,
    profile_id: PROFILE_ID,
    runtime_provider_id: PROVIDER_ID,
    sdk_module: sdkModule,
    sdk_module_sha256: digestFile(sdkModule),
    executable,
    executable_sha256: digestFile(executable),
    cwd,
    env_names: Object.freeze([...value.env_names]),
    secret_refs: Object.freeze([...value.secret_refs]),
  });
}

function readBinding(filename) {
  const resolved = path.resolve(text(filename, 'binding path'));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new DelegatedClaudeError('delegated Claude binding must be a single regular file');
  }
  try {
    return validateBinding(yaml.parse(fs.readFileSync(resolved, 'utf8')));
  } catch (error) {
    if (error instanceof DelegatedClaudeError) throw error;
    throw new DelegatedClaudeError('delegated Claude binding is malformed');
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
      'sdk_module',
      'sdk_module_sha256',
      'executable',
      'executable_sha256',
      'cwd',
      'env_names',
      'secret_refs',
    ],
    'delegated Claude manifest',
  );
  const sdkModule = boundFile(value.sdk_module, 'delegated Claude manifest SDK module');
  const executable = boundFile(value.executable, 'delegated Claude manifest executable', true);
  if (
    value.schema_version !== 1 ||
    value.profile_id !== PROFILE_ID ||
    value.runtime_provider_id !== PROVIDER_ID ||
    digestFile(sdkModule) !== value.sdk_module_sha256 ||
    digestFile(executable) !== value.executable_sha256 ||
    typeof value.cwd !== 'string' ||
    !path.isAbsolute(value.cwd)
  ) {
    throw new DelegatedClaudeError('delegated Claude manifest or external binding drifted');
  }
  const cwd = fs.realpathSync(value.cwd);
  text(value.session_id, 'delegated Claude session id', 1024);
  validateLists(value, 'delegated Claude manifest');
  return Object.freeze({
    ...value,
    sdk_module: sdkModule,
    executable,
    cwd,
    env_names: Object.freeze([...value.env_names]),
    secret_refs: Object.freeze([...value.secret_refs]),
  });
}

function manifestFrom(binding, sessionId) {
  return { ...binding, session_id: sessionId, env_names: [...binding.env_names], secret_refs: [...binding.secret_refs] };
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
    throw new DelegatedClaudeError('delegated Claude manifest must be a single regular file');
  }
  try {
    return validateManifest(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch (error) {
    if (error instanceof DelegatedClaudeError) throw error;
    throw new DelegatedClaudeError('delegated Claude manifest is malformed');
  }
}

function bindingDigest(manifest) {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

function sessionSpec(manifest) {
  return {
    schema_version: 1,
    session_id: manifest.session_id,
    agent_id: 'agent:claude-delegated',
    parent_session_id: null,
    authority_ref: 'authority://claude/instructions-only',
    policy_ref: 'policy://claude/l0',
    execution: { mode: 'delegated', runtime_provider_id: PROVIDER_ID, profile: 'instructions-only' },
    limits: { max_turns: 32, max_tokens: 1_000_000, max_duration_ms: 3_600_000, max_tool_calls: 0, max_children: 0, max_workflow_steps: 0 },
    metadata: { cwd: manifest.cwd, profile_id: PROFILE_ID, operational: false, binding_sha256: bindingDigest(manifest) },
  };
}

function runtimeEnvironment(manifest) {
  return Object.fromEntries(manifest.env_names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
}

function assertDurableBinding(state, manifest) {
  if (
    state.spec?.execution?.runtime_provider_id !== PROVIDER_ID ||
    state.spec?.metadata?.profile_id !== PROFILE_ID ||
    state.spec?.metadata?.operational !== false ||
    state.spec?.metadata?.binding_sha256 !== bindingDigest(manifest)
  ) {
    throw new DelegatedClaudeError('delegated Claude manifest differs from the durable session binding');
  }
}

function assembly(db, manifest) {
  const providers = [];
  const host = new DelegatedRuntimeHost({
    store: new DelegatedRuntimeStore({ ledger: new ExecutionEventLedger(db) }),
    provider_factory: () => {
      const provider = new ClaudeCodeRuntimeProvider({
        provider_id: PROVIDER_ID,
        driver: new ClaudeAgentSdkDriver({
          sdk_module: manifest.sdk_module,
          executable: manifest.executable,
          cwd: manifest.cwd,
          env: runtimeEnvironment(manifest),
        }),
        default_cwd: manifest.cwd,
      });
      providers.push(provider);
      return provider;
    },
    operation_timeout_ms: 3_600_000,
  });
  return { host, closeProviders: () => Promise.allSettled(providers.splice(0).map((provider) => provider.close())) };
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

async function runDelegatedClaude(options = {}) {
  const binding = readBinding(options.binding);
  const sessionId = options.sessionId || `session:${randomUUID()}`;
  text(sessionId, 'delegated Claude session id', 1024);
  const manifest = validateManifest(manifestFrom(binding, sessionId));
  const handle = createExecutionLedgerFileFixture();
  try {
    writeManifest(handle.directory, manifest);
    const createdAssembly = assembly(handle.db, manifest);
    let state;
    try {
      state = await createdAssembly.host.create({ request_id: `request:${randomUUID()}`, spec: sessionSpec(manifest) });
    } finally {
      await createdAssembly.closeProviders();
    }
    let operation = 'created';
    if (!options.createOnly) {
      const resumedAssembly = assembly(handle.db, manifest);
      try {
        state = await resumedAssembly.host.resumeAndSend({
          request_id: `request:${randomUUID()}`,
          session_id: sessionId,
          turn_id: `turn:${randomUUID()}`,
          message: { role: 'user', content: text(options.message || 'Execute the delegated instruction.', 'message', 262_144) },
        });
      } finally {
        await resumedAssembly.closeProviders();
      }
      operation = 'run';
    }
    return summarize(handle, manifest, state, operation);
  } catch (error) {
    handle.cleanup();
    throw error;
  } finally {
    handle.close();
  }
}

async function resumeDelegatedClaude(options = {}) {
  if (!Number.isSafeInteger(options.expectedSequence) || options.expectedSequence < 0) {
    throw new DelegatedClaudeError('expected_sequence is required and must be a non-negative safe integer');
  }
  const handle = openExecutionLedgerFileFixture(path.resolve(text(options.state, 'state')));
  try {
    const manifest = readManifest(handle.directory);
    const assembled = assembly(handle.db, manifest);
    try {
      const current = assembled.host.read(manifest.session_id);
      assertDurableBinding(current, manifest);
      if (current.version !== options.expectedSequence) {
        throw new DelegatedClaudeError('expected_sequence does not match delegated durable state');
      }
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

async function cancelDelegatedClaude(options = {}) {
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
  DelegatedClaudeError,
  cancelDelegatedClaude,
  readBinding,
  resumeDelegatedClaude,
  runDelegatedClaude,
};
