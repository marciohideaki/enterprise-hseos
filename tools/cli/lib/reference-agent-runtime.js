'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const { canonicalJson } = require('../../../packages/agent-session-store');
const { ModelProviderRegistry, ScriptedModelProvider } = require('../../../packages/model-providers');
const { createExecutionLedgerFileFixture, openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');
const { assembleTemporaryKernel } = require('./temporary-kernel-assembly');
const { TOOL_NAME, createTemporaryStateTool } = require('./temporary-state-tool');

const REFERENCE_MANIFEST = 'reference-agent.json';
const MODEL_PROVIDER_ID = 'model:scripted-reference';
const MODEL_ID = 'reference/tool-model';

class ReferenceAgentError extends Error {
  constructor(message, code = 'REFERENCE_AGENT_INVALID') {
    super(message);
    this.name = 'ReferenceAgentError';
    this.code = code;
  }
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReferenceAgentError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new ReferenceAgentError(`${label} has an invalid shape`);
}

function validateText(value, label, max = 4096) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > max) {
    throw new ReferenceAgentError(`${label} must be a non-empty string of at most ${max} bytes`);
  }
  return value;
}

function referenceManifest({ sessionId, value }) {
  return {
    schema_version: 1,
    profile_id: 'agent-reference',
    execution_mode: 'kernel',
    model_provider_id: MODEL_PROVIDER_ID,
    runtime_provider_id: 'runtime:hseos-kernel',
    session_id: sessionId,
    value,
    secret_refs: [],
  };
}

function validateReferenceManifest(value) {
  exactObject(
    value,
    ['schema_version', 'profile_id', 'execution_mode', 'model_provider_id', 'runtime_provider_id', 'session_id', 'value', 'secret_refs'],
    'reference manifest',
  );
  if (
    value.schema_version !== 1 ||
    value.profile_id !== 'agent-reference' ||
    value.execution_mode !== 'kernel' ||
    value.model_provider_id !== MODEL_PROVIDER_ID ||
    value.runtime_provider_id !== 'runtime:hseos-kernel' ||
    !Array.isArray(value.secret_refs) ||
    value.secret_refs.length > 0
  ) {
    throw new ReferenceAgentError('reference manifest selects an unsupported capability');
  }
  validateText(value.session_id, 'session_id', 256);
  validateText(value.value, 'value');
  return Object.freeze({ ...value, secret_refs: Object.freeze([]) });
}

function writeReferenceManifest(directory, manifest) {
  const target = path.join(directory, REFERENCE_MANIFEST);
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function readReferenceManifest(directory) {
  const target = path.join(directory, REFERENCE_MANIFEST);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new ReferenceAgentError('reference manifest must be a single regular file');
  }
  try {
    return validateReferenceManifest(JSON.parse(fs.readFileSync(target, 'utf8')));
  } catch (error) {
    if (error instanceof ReferenceAgentError) throw error;
    throw new ReferenceAgentError('reference manifest is malformed');
  }
}

function manifestDigest(manifest) {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

function modelManifest() {
  return {
    schema_version: 1,
    provider_type: 'model',
    provider_id: MODEL_PROVIDER_ID,
    provider_version: '1.0.0',
    models: [MODEL_ID],
    capabilities: ['text_generation', 'streaming', 'tool_calls', 'usage', 'cancellation'],
    limits: { context_tokens: 1_000_000, max_output_tokens: 256, max_parallel_requests: 1 },
    secret_refs: [],
  };
}

function modelRoutes(value) {
  return [
    {
      match: (request) => request.messages.at(-1).role === 'user',
      events: [
        {
          event_type: 'tool_call.delta',
          payload: { tool_call_id: 'call:reference-state', name: TOOL_NAME, arguments_delta: JSON.stringify({ value }) },
        },
        { event_type: 'completed', payload: { finish_reason: 'tool_calls', provider_response_ref: 'scripted://reference/tool' } },
      ],
    },
    {
      match: (request) => request.messages.at(-1).role === 'tool',
      events: [
        { event_type: 'content.delta', payload: { text: `Reference state set to ${value}` } },
        { event_type: 'usage', payload: { input_tokens: 1, output_tokens: 1, cached_tokens: 0 } },
        { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://reference/done' } },
      ],
    },
  ];
}

function profile() {
  return {
    instructions: {
      constitution: [
        { source_ref: 'governance://constitution', classification: 'internal', content: 'Honor bounded reference authority.' },
      ],
      project: [{ source_ref: 'profile://agent-reference', classification: 'internal', content: 'Use only the reference state tool.' }],
      adapter: [],
      agent: [],
      skill: [],
    },
    runtime_context: [],
    references: [],
    memory: [],
    parameters: { max_output_tokens: 64, temperature: null, stop: [] },
    overflow_policy: 'reject',
  };
}

function sessionSpec(sessionId, referenceManifestDigest) {
  return {
    schema_version: 1,
    session_id: sessionId,
    agent_id: 'agent:reference-profile',
    parent_session_id: null,
    authority_ref: 'authority://reference/local-only',
    policy_ref: 'policy://reference/v1',
    execution: { mode: 'kernel', model_provider_id: MODEL_PROVIDER_ID, model: MODEL_ID },
    limits: { max_turns: 4, max_tokens: 100_000, max_duration_ms: 30_000, max_tool_calls: 2, max_children: 0, max_workflow_steps: 0 },
    metadata: { profile_id: 'agent-reference', operational: false, reference_manifest_sha256: referenceManifestDigest },
  };
}

function assemble(handle, manifest, { createWorkspace = false } = {}) {
  let stateTool;
  try {
    stateTool = createTemporaryStateTool(handle.directory, { createWorkspace });
  } catch (error) {
    throw new ReferenceAgentError(`reference workspace is invalid: ${error.message}`);
  }
  const provider = new ScriptedModelProvider({ manifest: modelManifest(), routes: modelRoutes(manifest.value) });
  const models = new ModelProviderRegistry();
  models.register(provider, modelManifest());
  const assembly = assembleTemporaryKernel({
    db: handle.db,
    model_provider_snapshot: models.snapshot(),
    context_profile_resolver: profile,
    tool_bundles: [stateTool.bundle],
  });
  return { runtime: assembly.runtime, sessionStore: assembly.sessionStore, worldStatePath: stateTool.worldStatePath };
}

function assertSessionBinding(sessionStore, manifest) {
  const state = sessionStore.replay(manifest.session_id);
  if (
    state.spec.metadata.profile_id !== manifest.profile_id ||
    state.spec.metadata.operational !== false ||
    state.spec.metadata.reference_manifest_sha256 !== manifestDigest(manifest)
  ) {
    throw new ReferenceAgentError('reference manifest differs from the durable session binding');
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
    state: handle.directory,
    session_id: manifest.session_id,
    status: state.status,
    terminal: Boolean(state.terminal_event),
    current_sequence: state.current_sequence,
    operation,
    output,
    world_state: fs.existsSync(assembly.worldStatePath) ? assembly.worldStatePath : null,
  };
}

async function runReferenceAgent(options = {}) {
  const value = validateText(options.value || 'durable', 'value');
  const message = validateText(options.message || 'Set and verify the reference state.', 'message');
  const sessionId = options.sessionId || `session:${randomUUID()}`;
  const handle = createExecutionLedgerFileFixture();
  const manifest = validateReferenceManifest(referenceManifest({ sessionId, value }));
  try {
    writeReferenceManifest(handle.directory, manifest);
    const assembly = assemble(handle, manifest, { createWorkspace: true });
    await assembly.runtime.create({ schema_version: 1, command: 'create', spec: sessionSpec(sessionId, manifestDigest(manifest)) });
    assertSessionBinding(assembly.sessionStore, manifest);
    let operation = 'created';
    if (!options.createOnly) {
      await assembly.runtime.send({
        schema_version: 1,
        command: 'send',
        session_id: sessionId,
        turn_id: `turn:${randomUUID()}`,
        message: { role: 'user', content: message },
      });
      operation = 'run';
    }
    return summarize(handle, manifest, assembly, operation);
  } catch (error) {
    handle.cleanup();
    throw error;
  } finally {
    handle.close();
  }
}

async function resumeReferenceAgent(options = {}) {
  if (!Number.isSafeInteger(options.expectedSequence) || options.expectedSequence < 0) {
    throw new ReferenceAgentError('expected_sequence is required and must be a non-negative safe integer');
  }
  const handle = openExecutionLedgerFileFixture(path.resolve(validateText(options.state, 'state')));
  try {
    const manifest = readReferenceManifest(handle.directory);
    const assembly = assemble(handle, manifest);
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
    handle.close();
  }
}

async function cancelReferenceAgent(options = {}) {
  const handle = openExecutionLedgerFileFixture(path.resolve(validateText(options.state, 'state')));
  try {
    const manifest = readReferenceManifest(handle.directory);
    const assembly = assemble(handle, manifest);
    assertSessionBinding(assembly.sessionStore, manifest);
    await assembly.runtime.cancel({
      schema_version: 1,
      command: 'cancel',
      session_id: manifest.session_id,
      reason: validateText(options.reason || 'cancelled from HSEOS CLI', 'reason', 2048),
      cascade: true,
    });
    return summarize(handle, manifest, assembly, 'cancel');
  } finally {
    handle.close();
  }
}

module.exports = {
  REFERENCE_MANIFEST,
  ReferenceAgentError,
  cancelReferenceAgent,
  getReferenceModelManifest: modelManifest,
  readReferenceManifest,
  resumeReferenceAgent,
  runReferenceAgent,
};
