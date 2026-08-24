'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const yaml = require('yaml');

const { canonicalJson } = require('../../../packages/agent-session-store');
const { DelegatedRuntimeHost, DelegatedRuntimeStore } = require('../../../packages/delegated-runtime-host');
const {
  DeepSeekHarnessRuntimeProvider,
  ProcessAcpPeer,
  validateDeepSeekAcpComposition,
} = require('../../../packages/runtime-providers');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { createExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');

const PROFILE_ID = 'agent-deepseek-one-shot-candidate';
const PROVIDER_ID = 'runtime:deepseek-harness';
const MANIFEST_FILE = 'delegated-deepseek.json';

class DelegatedDeepSeekError extends Error {
  constructor(message, code = 'DELEGATED_DEEPSEEK_INVALID') {
    super(message);
    this.name = 'DelegatedDeepSeekError';
    this.code = code;
  }
}

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DelegatedDeepSeekError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new DelegatedDeepSeekError(`${label} has an invalid shape`);
}

function text(value, label, maximum = 4096) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximum || value.includes('\u0000')) {
    throw new DelegatedDeepSeekError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function canonicalFile(value, label, executable = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new DelegatedDeepSeekError(`${label} must be absolute`);
  const filename = path.resolve(value);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync(filename) !== filename) {
    throw new DelegatedDeepSeekError(`${label} must be a single canonical regular file`);
  }
  if (executable && (stat.mode & 0o111) === 0) throw new DelegatedDeepSeekError(`${label} must be executable`);
  return filename;
}

function digestFile(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function bindingDigest(binding) {
  return createHash('sha256').update(canonicalJson(binding)).digest('hex');
}

function validateNames(values, label) {
  if (!Array.isArray(values) || values.length > 64 || new Set(values).size !== values.length) {
    throw new DelegatedDeepSeekError(`${label} is invalid`);
  }
  for (const name of values) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) {
      throw new DelegatedDeepSeekError(`${label} contains an invalid name`);
    }
  }
  return Object.freeze([...values]);
}

function validateBinding(value) {
  exact(
    value,
    [
      'schema_version',
      'profile_id',
      'runtime_provider_id',
      'executable',
      'entrypoint',
      'composition',
      'cwd',
      'env_names',
      'secret_env_names',
      'secret_refs',
      'network_port',
    ],
    'delegated DeepSeek binding',
  );
  if (value.schema_version !== 1 || value.profile_id !== PROFILE_ID || value.runtime_provider_id !== PROVIDER_ID) {
    throw new DelegatedDeepSeekError('delegated DeepSeek binding selects an unsupported capability');
  }
  const executable = canonicalFile(value.executable, 'delegated DeepSeek executable', true);
  const entrypoint = canonicalFile(value.entrypoint, 'delegated DeepSeek entrypoint');
  const composition = canonicalFile(value.composition, 'delegated DeepSeek composition');
  if (!path.isAbsolute(value.cwd)) throw new DelegatedDeepSeekError('delegated DeepSeek cwd must be absolute');
  const cwd = fs.realpathSync(value.cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new DelegatedDeepSeekError('delegated DeepSeek cwd must be a directory');
  const envNames = validateNames(value.env_names, 'delegated DeepSeek env_names');
  const secretEnvNames = validateNames(value.secret_env_names, 'delegated DeepSeek secret_env_names');
  if (secretEnvNames.some((name) => !envNames.includes(name))) {
    throw new DelegatedDeepSeekError('delegated DeepSeek secret environment is not selected');
  }
  if (!secretEnvNames.includes('DEEPSEEK_API_KEY')) {
    throw new DelegatedDeepSeekError('delegated DeepSeek API key must be classified as secret');
  }
  if (!Array.isArray(value.secret_refs) || value.secret_refs.some((entry) => typeof entry !== 'string' || !entry.startsWith('secret://'))) {
    throw new DelegatedDeepSeekError('delegated DeepSeek secret_refs are invalid');
  }
  if (!Number.isSafeInteger(value.network_port) || value.network_port < 1 || value.network_port > 65_535) {
    throw new DelegatedDeepSeekError('delegated DeepSeek network_port is invalid');
  }
  const attestation = validateDeepSeekAcpComposition(composition);
  return Object.freeze({
    schema_version: 1,
    profile_id: PROFILE_ID,
    runtime_provider_id: PROVIDER_ID,
    executable,
    executable_sha256: digestFile(executable),
    entrypoint,
    entrypoint_sha256: digestFile(entrypoint),
    composition,
    composition_sha256: attestation.composition_sha256,
    cwd,
    env_names: envNames,
    secret_env_names: secretEnvNames,
    secret_refs: Object.freeze([...value.secret_refs]),
    network_port: value.network_port,
    effect_boundary: attestation.effect_boundary,
    lifecycle: attestation.lifecycle,
    evidence_ref: attestation.evidence_ref,
  });
}

function readBinding(filename) {
  const resolved = path.resolve(text(filename, 'binding path'));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new DelegatedDeepSeekError('delegated DeepSeek binding must be a single regular file');
  }
  try {
    return validateBinding(yaml.parse(fs.readFileSync(resolved, 'utf8')));
  } catch (error) {
    if (error instanceof DelegatedDeepSeekError) throw error;
    throw new DelegatedDeepSeekError('delegated DeepSeek binding is malformed');
  }
}

function validateBoundFiles(binding) {
  const current = validateDeepSeekAcpComposition(binding.composition);
  if (
    digestFile(binding.executable) !== binding.executable_sha256 ||
    digestFile(binding.entrypoint) !== binding.entrypoint_sha256 ||
    current.composition_sha256 !== binding.composition_sha256 ||
    current.evidence_ref !== binding.evidence_ref
  ) {
    throw new DelegatedDeepSeekError('delegated DeepSeek external binding drifted');
  }
}

function runtimeEnvironment(binding, environment) {
  const selected = {};
  for (const name of binding.env_names) {
    if (Object.hasOwn(environment, name) && environment[name] !== undefined) selected[name] = environment[name];
  }
  for (const name of binding.secret_env_names) {
    if (typeof selected[name] !== 'string' || selected[name].length === 0) {
      throw new DelegatedDeepSeekError('delegated DeepSeek secret environment is unavailable', 'DELEGATED_DEEPSEEK_SECRET_UNAVAILABLE');
    }
  }
  return selected;
}

function manifestFrom(binding, sessionId, sandboxAttestation) {
  return Object.freeze({
    ...binding,
    env_names: [...binding.env_names],
    secret_env_names: [...binding.secret_env_names],
    secret_refs: [...binding.secret_refs],
    session_id: sessionId,
    sandbox_attestation: sandboxAttestation,
  });
}

function sessionSpec(manifest) {
  return {
    schema_version: 1,
    session_id: manifest.session_id,
    agent_id: 'agent:deepseek-one-shot',
    parent_session_id: null,
    authority_ref: 'authority://deepseek/instructions-only',
    policy_ref: 'policy://deepseek/l0-one-shot',
    execution: { mode: 'delegated', runtime_provider_id: PROVIDER_ID, profile: 'instructions-only' },
    limits: { max_turns: 1, max_tokens: 1_000_000, max_duration_ms: 3_600_000, max_tool_calls: 0, max_children: 0, max_workflow_steps: 0 },
    metadata: {
      cwd: manifest.cwd,
      profile_id: PROFILE_ID,
      operational: false,
      lifecycle: 'one_shot',
      binding_sha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex'),
      sandbox_evidence_ref: manifest.sandbox_attestation.evidence_ref,
    },
  };
}

function writeManifest(directory, manifest) {
  fs.writeFileSync(path.join(directory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

function summarize(handle, manifest, state) {
  return {
    schema_version: 1,
    profile: PROFILE_ID,
    state: handle.directory,
    session_id: manifest.session_id,
    status: state.terminal_event?.event_type === 'runtime.session.completed' ? 'completed' : 'failed',
    terminal: state.terminal,
    current_sequence: state.version,
    operation: 'run-one-shot',
    output: state.runtime_events
      .filter((event) => event.event_type === 'runtime.message.delta')
      .map((event) => event.payload.text)
      .join(''),
    world_state: null,
    operational: false,
    lifecycle: 'one_shot',
  };
}

async function runDelegatedDeepSeek(options = {}) {
  if (options.createOnly === true) throw new DelegatedDeepSeekError('DeepSeek one-shot profile does not support create-only');
  if (!options.sandboxAttestation || options.sandboxAttestation.provider !== 'ai-jail') {
    throw new DelegatedDeepSeekError('DeepSeek one-shot requires sandbox attestation', 'DELEGATED_DEEPSEEK_SANDBOX_REQUIRED');
  }
  const binding = readBinding(options.binding);
  if (typeof options.expectedBindingSha256 !== 'string' || bindingDigest(binding) !== options.expectedBindingSha256) {
    throw new DelegatedDeepSeekError('delegated DeepSeek binding changed after sandbox authorization', 'DELEGATED_DEEPSEEK_BINDING_DRIFT');
  }
  validateBoundFiles(binding);
  const sessionId = options.sessionId || `session:${randomUUID()}`;
  text(sessionId, 'delegated DeepSeek session id', 1024);
  const manifest = manifestFrom(binding, sessionId, options.sandboxAttestation);
  const environment = runtimeEnvironment(binding, options.environment || process.env);
  const handle = createExecutionLedgerFileFixture();
  let provider;
  try {
    writeManifest(handle.directory, manifest);
    provider = new DeepSeekHarnessRuntimeProvider({
      provider_id: PROVIDER_ID,
      peer: new ProcessAcpPeer({
        executable: binding.executable,
        args: [binding.entrypoint, '--config', binding.composition],
        cwd: binding.cwd,
        env: environment,
      }),
      default_cwd: binding.cwd,
      effect_boundary_attestation: {
        effect_boundary: binding.effect_boundary,
        lifecycle: binding.lifecycle,
        evidence_ref: binding.evidence_ref,
      },
    });
    const host = new DelegatedRuntimeHost({
      store: new DelegatedRuntimeStore({ ledger: new ExecutionEventLedger(handle.db) }),
      provider_factory: () => provider,
      operation_timeout_ms: 3_600_000,
    });
    await host.create({ request_id: `request:${randomUUID()}`, spec: sessionSpec(manifest) });
    const state = await host.resumeAndSend({
      request_id: `request:${randomUUID()}`,
      session_id: sessionId,
      turn_id: `turn:${randomUUID()}`,
      message: { role: 'user', content: text(options.message || 'Execute the delegated instruction.', 'message', 262_144) },
    });
    return summarize(handle, manifest, state);
  } catch (error) {
    handle.cleanup();
    throw error;
  } finally {
    if (provider) await provider.close();
    handle.close();
  }
}

module.exports = { DelegatedDeepSeekError, MANIFEST_FILE, PROFILE_ID, PROVIDER_ID, bindingDigest, readBinding, runDelegatedDeepSeek };
