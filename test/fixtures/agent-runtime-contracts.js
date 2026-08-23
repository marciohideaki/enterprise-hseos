'use strict';

const { CONFORMANCE_REQUIREMENTS, CONTRACT_SCHEMA_VERSION } = require('../../packages/agent-runtime-contracts');

const limits = Object.freeze({
  max_turns: 12,
  max_tokens: 64_000,
  max_duration_ms: 300_000,
  max_tool_calls: 20,
  max_children: 4,
  max_workflow_steps: 30,
});

const kernelSession = Object.freeze({
  schema_version: CONTRACT_SCHEMA_VERSION,
  session_id: 'session:fixture-1',
  agent_id: 'agent:fixture',
  parent_session_id: null,
  authority_ref: 'authority://fixture/read-write',
  policy_ref: 'policy://fixture/v1',
  execution: {
    mode: 'kernel',
    model_provider_id: 'model:fixture',
    model: 'organization/fixture-model:latest',
  },
  limits,
  metadata: { purpose: 'contract-conformance' },
});

const delegatedSession = Object.freeze({
  ...kernelSession,
  session_id: 'session:fixture-2',
  execution: {
    mode: 'delegated',
    runtime_provider_id: 'runtime:fixture',
    profile: 'governed-default',
  },
});

const modelManifest = Object.freeze({
  schema_version: CONTRACT_SCHEMA_VERSION,
  provider_type: 'model',
  provider_id: 'model:fixture',
  provider_version: '1.0.0',
  models: ['organization/fixture-model:latest'],
  capabilities: ['text_generation', 'streaming', 'tool_calls', 'usage', 'cancellation'],
  limits: {
    context_tokens: 128_000,
    max_output_tokens: 8192,
    max_parallel_requests: 8,
  },
  secret_refs: [{ name: 'api-key', source_ref: 'secret://fixture/provider-key' }],
});

function runtimeManifest(level = 'L4') {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_type: 'runtime',
    provider_id: `runtime:fixture-${level.toLowerCase()}`,
    provider_version: '1.0.0',
    conformance_level: level,
    capabilities: [...CONFORMANCE_REQUIREMENTS[level]],
    transport: 'stdio',
    secret_refs: [],
  };
}

const modelRequest = Object.freeze({
  schema_version: CONTRACT_SCHEMA_VERSION,
  request_id: 'request:fixture-1',
  session_id: kernelSession.session_id,
  turn_id: 'turn:fixture-1',
  provider_id: 'model:fixture',
  model: 'organization/fixture-model:latest',
  messages: [{ role: 'user', content: 'read the fixture' }],
  tools: [
    {
      name: 'fixture.read',
      description: 'Read deterministic fixture state',
      input_schema: { type: 'object', additionalProperties: false },
      governance_ref: 'governance://tool/fixture.read',
    },
  ],
  parameters: {
    max_output_tokens: 2048,
    temperature: null,
    stop: [],
  },
});

function sessionEvent(eventType, payload, sequence = 1) {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    event_id: `event:fixture-${sequence}`,
    session_id: kernelSession.session_id,
    sequence,
    occurred_at: `2026-08-22T00:00:0${sequence}Z`,
    event_type: eventType,
    payload,
  };
}

module.exports = {
  delegatedSession,
  kernelSession,
  limits,
  modelManifest,
  modelRequest,
  runtimeManifest,
  sessionEvent,
};
