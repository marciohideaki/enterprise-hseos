'use strict';

const { createHash } = require('node:crypto');
const { CONTRACT_SCHEMA_VERSION, deepFreeze, validatePortInput, validatePortResult } = require('../agent-runtime-contracts');
const { canonicalJson } = require('./deterministic-provider');

function payloadDigest(payload) {
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}

class CheckpointProviderError extends Error {
  constructor(message, code = 'CHECKPOINT_PROVIDER_INVALID') {
    super(message);
    this.name = 'CheckpointProviderError';
    this.code = code;
  }
}

class InMemoryCheckpointProvider {
  #providerId;
  #records = new Map();

  constructor({ provider_id = 'checkpoint:memory' } = {}) {
    this.#providerId = provider_id;
  }

  put(value) {
    const input = validatePortInput('CheckpointProvider', 'put', value);
    if (input.provider_id !== this.#providerId) throw new CheckpointProviderError('checkpoint provider identity mismatch');
    const record = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: this.#providerId,
      checkpoint_id: input.checkpoint_id,
      session_id: input.session_id,
      checkpoint_ref: `checkpoint://${this.#providerId}/${input.session_id}/${input.checkpoint_id}`,
      payload_digest: payloadDigest(input.payload),
      payload: input.payload,
    };
    const key = `${input.session_id}\0${input.checkpoint_id}`;
    const current = this.#records.get(key);
    if (current && canonicalJson(current) !== canonicalJson(record)) {
      throw new CheckpointProviderError('checkpoint id is immutable', 'CHECKPOINT_IMMUTABLE_CONFLICT');
    }
    if (!current) this.#records.set(key, deepFreeze(structuredClone(record)));
    return validatePortResult('CheckpointProvider', 'put', current || record, input);
  }

  get(value) {
    const input = validatePortInput('CheckpointProvider', 'get', value);
    if (input.provider_id !== this.#providerId) throw new CheckpointProviderError('checkpoint provider identity mismatch');
    const record = this.#records.get(`${input.session_id}\0${input.checkpoint_id}`);
    if (!record) throw new CheckpointProviderError('checkpoint is not found', 'CHECKPOINT_NOT_FOUND');
    return validatePortResult('CheckpointProvider', 'get', record, input);
  }

  dispose(value) {
    const input = validatePortInput('CheckpointProvider', 'dispose', value);
    if (input.provider_id !== this.#providerId) throw new CheckpointProviderError('checkpoint provider identity mismatch');
    return validatePortResult(
      'CheckpointProvider',
      'dispose',
      { schema_version: CONTRACT_SCHEMA_VERSION, provider_id: this.#providerId, session_id: input.session_id, accepted: true },
      input,
    );
  }
}

module.exports = { CheckpointProviderError, InMemoryCheckpointProvider, payloadDigest };
