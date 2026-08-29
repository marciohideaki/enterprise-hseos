'use strict';

const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { canonicalJson } = require('../../../packages/agent-session-store');
const { createBoundModelProvider, readProviderBinding, validateBinding } = require('../../lib/agent-provider-binding');
const { createExecutionLedgerFileFixture, openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');
const { CANDIDATE_PROFILE } = require('../../lib/agentic-activation-rehearsal');
const { assembleTemporaryKernel } = require('./temporary-kernel-assembly');
const { TOOL_NAME, createTemporaryStateTool } = require('./temporary-state-tool');

const BOUND_MANIFEST = 'bound-kernel-agent.json';
const SANDBOX_PROVIDER = 'ai-jail';
const SANDBOX_PROFILE = 'lockdown';

class BoundKernelAgentError extends Error {
  constructor(message, code = 'BOUND_KERNEL_AGENT_INVALID') {
    super(message);
    this.name = 'BoundKernelAgentError';
    this.code = code;
  }
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BoundKernelAgentError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new BoundKernelAgentError(`${label} has an invalid shape`);
}

function validateText(value, label, max = 4096) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > max) {
    throw new BoundKernelAgentError(`${label} must be a non-empty string of at most ${max} bytes`);
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validateAttestation(value) {
  exactObject(value, ['evidence_ref', 'profile', 'provider'], 'execution attestation');
  if (
    value.provider !== SANDBOX_PROVIDER ||
    value.profile !== SANDBOX_PROFILE ||
    typeof value.evidence_ref !== 'string' ||
    !/^sandbox:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/.test(value.evidence_ref)
  ) {
    throw new BoundKernelAgentError('execution attestation does not prove the required ai-jail lockdown profile');
  }
  return Object.freeze({ ...value });
}

async function authorizeExecution(authorizer, context) {
  if (typeof authorizer !== 'function') {
    throw new BoundKernelAgentError('an execution attestation authorizer is required', 'BOUND_KERNEL_AGENT_ATTESTATION_REQUIRED');
  }
  let value;
  try {
    value = await authorizer(Object.freeze({ ...context }));
  } catch {
    throw new BoundKernelAgentError('execution attestation authorizer failed', 'BOUND_KERNEL_AGENT_ATTESTATION_FAILED');
  }
  return validateAttestation(value);
}

function boundManifest({ sessionId, value, binding, bindingSha256, attestation }) {
  return {
    schema_version: 1,
    profile_id: CANDIDATE_PROFILE,
    operational: false,
    session_id: sessionId,
    value,
    binding,
    binding_sha256: bindingSha256,
    execution_attestation: attestation,
  };
}

function validateBoundManifest(value) {
  exactObject(
    value,
    ['schema_version', 'profile_id', 'operational', 'session_id', 'value', 'binding', 'binding_sha256', 'execution_attestation'],
    'bound kernel manifest',
  );
  const binding = validateBinding(value.binding);
  const attestation = validateAttestation(value.execution_attestation);
  if (
    value.schema_version !== 1 ||
    value.profile_id !== CANDIDATE_PROFILE ||
    value.operational !== false ||
    typeof value.binding_sha256 !== 'string' ||
    value.binding_sha256 !== digest(binding)
  ) {
    throw new BoundKernelAgentError('bound kernel manifest changes its immutable profile or binding');
  }
  validateText(value.session_id, 'session_id', 256);
  validateText(value.value, 'value');
  return Object.freeze({ ...value, binding, execution_attestation: attestation });
}

function writeBoundManifest(directory, manifest) {
  fs.writeFileSync(path.join(directory, BOUND_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

function readBoundManifest(directory) {
  const filename = path.join(directory, BOUND_MANIFEST);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new BoundKernelAgentError('bound kernel manifest must be a single regular file');
  }
  try {
    return validateBoundManifest(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch (error) {
    if (error instanceof BoundKernelAgentError) throw error;
    throw new BoundKernelAgentError('bound kernel manifest is malformed');
  }
}

function contextProfile(spec) {
  return {
    instructions: {
      constitution: [
        {
          source_ref: 'governance://constitution',
          classification: 'internal',
          content: 'Honor HSEOS authority, policy, evidence and bounded execution.',
        },
      ],
      project: [
        {
          source_ref: `profile://${CANDIDATE_PROFILE}`,
          classification: 'internal',
          content: `Use ${TOOL_NAME} when asked to persist temporary state. Never claim an effect without its tool outcome.`,
        },
      ],
      adapter: [],
      agent: [],
      skill: [],
    },
    runtime_context: [],
    references: [],
    memory: [],
    parameters: {
      max_output_tokens: 256,
      temperature: null,
      stop: [],
    },
    overflow_policy: 'reject',
  };
}

function sessionSpec(manifest) {
  return {
    schema_version: 1,
    session_id: manifest.session_id,
    agent_id: 'agent:bound-kernel-profile',
    parent_session_id: null,
    authority_ref: 'authority://bound-kernel/temporary-only',
    policy_ref: 'policy://bound-kernel/pre-activation-v1',
    execution: {
      mode: 'kernel',
      model_provider_id: manifest.binding.provider.provider_id,
      model: manifest.binding.provider.model,
    },
    limits: {
      max_turns: 8,
      max_tokens: 100_000,
      max_duration_ms: 60_000,
      max_tool_calls: 4,
      max_children: 0,
      max_workflow_steps: 0,
    },
    metadata: {
      profile_id: CANDIDATE_PROFILE,
      operational: false,
      binding_sha256: manifest.binding_sha256,
      execution_attestation_ref: manifest.execution_attestation.evidence_ref,
      bound_manifest_sha256: digest(manifest),
    },
  };
}

function assemble(handle, manifest, { createWorkspace = false, environment, resolvers, fetch_impl, secret_resolver } = {}) {
  const models = createBoundModelProvider({ binding: manifest.binding, environment, resolvers, fetch_impl, secret_resolver });
  const sandbox = {
    provider: manifest.execution_attestation.provider,
    profile: manifest.execution_attestation.profile,
    required: true,
  };
  const stateTool = createTemporaryStateTool(handle.directory, {
    createWorkspace,
    sandbox,
    evidenceRefs: [manifest.execution_attestation.evidence_ref],
  });
  const assembly = assembleTemporaryKernel({
    db: handle.db,
    model_provider_snapshot: models.snapshot,
    context_profile_resolver: contextProfile,
    tool_bundles: [stateTool.bundle],
  });
  return Object.freeze({
    ...assembly,
    modelProvider: models.provider,
    worldStatePath: stateTool.worldStatePath,
  });
}

function assertSessionBinding(sessionStore, manifest) {
  const state = sessionStore.replay(manifest.session_id);
  const metadata = state.spec.metadata;
  if (
    metadata.profile_id !== manifest.profile_id ||
    metadata.operational !== false ||
    metadata.binding_sha256 !== manifest.binding_sha256 ||
    metadata.execution_attestation_ref !== manifest.execution_attestation.evidence_ref ||
    metadata.bound_manifest_sha256 !== digest(manifest)
  ) {
    throw new BoundKernelAgentError('bound kernel manifest differs from the durable session binding');
  }
  return state;
}

function summarize(handle, manifest, assembly, operation) {
  const state = assembly.sessionStore.replay(manifest.session_id);
  const lastTurn = state.turn_order.length > 0 ? state.turns[state.turn_order.at(-1)] : null;
  const output = lastTurn
    ? lastTurn.model_steps
        .flatMap((step) => step.model_events.filter((event) => event.event_type === 'content.delta').map((event) => event.payload.text))
        .join('')
    : '';
  return {
    schema_version: 1,
    profile: manifest.profile_id,
    operational: false,
    state: handle.directory,
    session_id: manifest.session_id,
    binding_sha256: manifest.binding_sha256,
    status: state.status,
    terminal: Boolean(state.terminal_event),
    current_sequence: state.current_sequence,
    operation,
    output,
    world_state: fs.existsSync(assembly.worldStatePath) ? assembly.worldStatePath : null,
  };
}

async function runBoundKernelAgent(options = {}) {
  const loaded = readProviderBinding(path.resolve(validateText(options.bindingPath, 'bindingPath')));
  const sessionId = options.sessionId || `session:${randomUUID()}`;
  const value = validateText(options.value || 'durable', 'value');
  const attestation = await authorizeExecution(options.executionAuthorizer, {
    profile_id: CANDIDATE_PROFILE,
    binding_id: loaded.binding.binding_id,
    binding_sha256: loaded.binding_sha256,
    operation: options.createOnly ? 'create' : 'run',
  });
  const manifest = validateBoundManifest(
    boundManifest({ sessionId, value, binding: loaded.binding, bindingSha256: loaded.binding_sha256, attestation }),
  );
  const handle = createExecutionLedgerFileFixture();
  let assembly;
  try {
    writeBoundManifest(handle.directory, manifest);
    assembly = assemble(handle, manifest, { ...options, createWorkspace: true });
    await assembly.runtime.create({ schema_version: 1, command: 'create', spec: sessionSpec(manifest) });
    assertSessionBinding(assembly.sessionStore, manifest);
    let operation = 'created';
    if (!options.createOnly) {
      await assembly.runtime.send({
        schema_version: 1,
        command: 'send',
        session_id: sessionId,
        turn_id: `turn:${randomUUID()}`,
        message: { role: 'user', content: validateText(options.message || `Persist temporary state value ${value}.`, 'message') },
      });
      operation = 'run';
    }
    return summarize(handle, manifest, assembly, operation);
  } catch (error) {
    handle.cleanup();
    throw error;
  } finally {
    if (assembly) {
      assembly.modelProvider.dispose({
        schema_version: 1,
        request_id: 'request:bound-kernel-dispose',
        provider_id: manifest.binding.provider.provider_id,
      });
    }
    handle.close();
  }
}

async function resumeBoundKernelAgent(options = {}) {
  if (!Number.isSafeInteger(options.expectedSequence) || options.expectedSequence < 0) {
    throw new BoundKernelAgentError('expected_sequence is required and must be a non-negative safe integer');
  }
  const handle = openExecutionLedgerFileFixture(path.resolve(validateText(options.state, 'state')));
  let assembly;
  let manifest;
  try {
    manifest = readBoundManifest(handle.directory);
    const attestation = await authorizeExecution(options.executionAuthorizer, {
      profile_id: CANDIDATE_PROFILE,
      binding_id: manifest.binding.binding_id,
      binding_sha256: manifest.binding_sha256,
      operation: 'resume',
    });
    if (canonicalJson(attestation) !== canonicalJson(manifest.execution_attestation)) {
      throw new BoundKernelAgentError('resume attestation differs from the durable session binding');
    }
    assembly = assemble(handle, manifest, options);
    assertSessionBinding(assembly.sessionStore, manifest);
    await assembly.runtime.resume({
      schema_version: 1,
      command: 'resume',
      session_id: manifest.session_id,
      expected_sequence: options.expectedSequence,
    });
    let operation = 'resume';
    const resumed = assembly.sessionStore.replay(manifest.session_id);
    if (options.message && !resumed.terminal_event) {
      await assembly.runtime.send({
        schema_version: 1,
        command: 'send',
        session_id: manifest.session_id,
        turn_id: `turn:${randomUUID()}`,
        message: { role: 'user', content: validateText(options.message, 'message') },
      });
      operation = 'resume-and-send';
    }
    return summarize(handle, manifest, assembly, operation);
  } finally {
    if (assembly && manifest) {
      assembly.modelProvider.dispose({
        schema_version: 1,
        request_id: 'request:bound-kernel-resume-dispose',
        provider_id: manifest.binding.provider.provider_id,
      });
    }
    handle.close();
  }
}

async function cancelBoundKernelAgent(options = {}) {
  const handle = openExecutionLedgerFileFixture(path.resolve(validateText(options.state, 'state')));
  let assembly;
  let manifest;
  try {
    manifest = readBoundManifest(handle.directory);
    assembly = assemble(handle, manifest, options);
    assertSessionBinding(assembly.sessionStore, manifest);
    await assembly.runtime.cancel({
      schema_version: 1,
      command: 'cancel',
      session_id: manifest.session_id,
      reason: validateText(options.reason || 'cancelled from HSEOS bound kernel', 'reason', 2048),
      cascade: true,
    });
    return summarize(handle, manifest, assembly, 'cancel');
  } finally {
    if (assembly && manifest) {
      assembly.modelProvider.dispose({
        schema_version: 1,
        request_id: 'request:bound-kernel-cancel-dispose',
        provider_id: manifest.binding.provider.provider_id,
      });
    }
    handle.close();
  }
}

module.exports = {
  BOUND_MANIFEST,
  BoundKernelAgentError,
  authorizeExecution,
  cancelBoundKernelAgent,
  readBoundManifest,
  resumeBoundKernelAgent,
  runBoundKernelAgent,
};
