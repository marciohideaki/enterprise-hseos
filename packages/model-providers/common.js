'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  ModelProviderManifestSchema,
  ModelStreamEventSchema,
  deepFreeze,
  parseContract,
  validatePortInput,
} = require('../agent-runtime-contracts');

class ModelProviderError extends Error {
  constructor(message, errorCode = 'internal_error', { retryable = false, cause, status } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ModelProviderError';
    this.error_code = errorCode;
    this.retryable = retryable === true;
    if (status !== undefined) this.status = status;
  }
}

const SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_request: 'model provider rejected the request',
  unauthorized: 'model provider authorization failed',
  policy_denied: 'model provider request was denied by policy',
  capability_unavailable: 'model provider capability is unavailable',
  rate_limited: 'model provider rate limit reached',
  timeout: 'model provider request timed out',
  cancelled: 'model provider request was cancelled',
  provider_unavailable: 'model provider is unavailable',
  protocol_error: 'model provider response violated the protocol',
  budget_exceeded: 'model provider budget was exceeded',
  tool_failed: 'model provider tool request failed',
  internal_error: 'model provider failed internally',
});

function safeErrorMessage(errorCode) {
  return SAFE_ERROR_MESSAGES[errorCode] || SAFE_ERROR_MESSAGES.internal_error;
}

function safeErrorCode(errorCode) {
  return Object.hasOwn(SAFE_ERROR_MESSAGES, errorCode) ? errorCode : 'internal_error';
}

function validateStreamRequest(manifest, input) {
  if (!manifest.capabilities.includes('streaming')) {
    throw new ModelProviderError('streaming is not declared by this provider', 'capability_unavailable');
  }
  if (input.tools.length > 0 && !manifest.capabilities.includes('tool_calls')) {
    throw new ModelProviderError('tool calls are not declared by this provider', 'capability_unavailable');
  }
  if (
    input.parameters.max_output_tokens > manifest.limits.max_output_tokens ||
    input.parameters.max_output_tokens > manifest.limits.context_tokens
  ) {
    throw new ModelProviderError('requested output exceeds provider limits', 'budget_exceeded');
  }
  const conservativeInputTokens = Buffer.byteLength(JSON.stringify({ messages: input.messages, tools: input.tools }), 'utf8');
  if (conservativeInputTokens + input.parameters.max_output_tokens > manifest.limits.context_tokens) {
    throw new ModelProviderError('request exceeds the provider context limit', 'budget_exceeded');
  }
}

function validateInput(providerId, method, value) {
  const input = validatePortInput('ModelProvider', method, value);
  if (input.provider_id !== providerId) {
    throw new ModelProviderError('provider identity mismatch', 'invalid_request');
  }
  return input;
}

function validateManifest(value) {
  return parseContract(ModelProviderManifestSchema, value, 'model provider manifest');
}

function streamEvent(providerId, requestId, sequence, eventType, payload) {
  return parseContract(
    ModelStreamEventSchema,
    { schema_version: CONTRACT_SCHEMA_VERSION, provider_id: providerId, request_id: requestId, sequence, event_type: eventType, payload },
    'model stream event',
  );
}

function ack(providerId, requestId, accepted = true) {
  return deepFreeze({
    schema_version: CONTRACT_SCHEMA_VERSION,
    request_id: requestId,
    provider_id: providerId,
    accepted,
    evidence_refs: [],
  });
}

function discovery(manifest) {
  return deepFreeze({
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_id: manifest.provider_id,
    models: [...manifest.models],
  });
}

module.exports = {
  ModelProviderError,
  ack,
  discovery,
  safeErrorCode,
  safeErrorMessage,
  streamEvent,
  validateInput,
  validateManifest,
  validateStreamRequest,
};
