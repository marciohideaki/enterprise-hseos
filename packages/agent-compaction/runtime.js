'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  CompactionInputSchema,
  CompactionResultSchema,
  assertPortShape,
  deepFreeze,
  parseContract,
  validatePortResult,
} = require('../agent-runtime-contracts');
const { CompactionProviderRegistrySnapshot } = require('./provider-registry');
const { canonicalJson, digest } = require('./deterministic-provider');

class CompactionRuntimeError extends Error {
  constructor(message, code = 'COMPACTION_RUNTIME_INVALID', details = {}) {
    super(message);
    this.name = 'CompactionRuntimeError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

class CompactionRuntime {
  #checkpoint;
  #checkpointProviderId;
  #providers;

  constructor({ compaction_provider_snapshot, checkpoint_provider, checkpoint_provider_id }) {
    if (!(compaction_provider_snapshot instanceof CompactionProviderRegistrySnapshot)) {
      throw new CompactionRuntimeError('compaction providers require an immutable registry snapshot');
    }
    assertPortShape('CheckpointProvider', checkpoint_provider);
    if (typeof checkpoint_provider_id !== 'string' || checkpoint_provider_id.length === 0) {
      throw new CompactionRuntimeError('checkpoint_provider_id is required');
    }
    this.#providers = compaction_provider_snapshot;
    this.#checkpoint = checkpoint_provider;
    this.#checkpointProviderId = checkpoint_provider_id;
    Object.freeze(this);
  }

  assess(value) {
    const entry = this.#providers.resolve(value.provider_id);
    const result = entry.provider.assess(value);
    return validatePortResult('CompactionProvider', 'assess', result, value);
  }

  resolve(providerId, strategy) {
    return this.#providers.resolve(providerId, strategy).manifest;
  }

  get checkpoint_provider_id() {
    return this.#checkpointProviderId;
  }

  compact(value, retainedSourceEventIds = [], acceptResult = () => true) {
    const input = parseContract(CompactionInputSchema, value, 'compaction runtime input');
    const entry = this.#providers.resolve(input.provider_id, input.strategy);
    const beforeBytes = Buffer.byteLength(canonicalJson(input.sources.map((source) => source.message)), 'utf8');
    if (beforeBytes > entry.manifest.max_input_bytes) {
      throw new CompactionRuntimeError('compaction input exceeds provider manifest cap', 'COMPACTION_INPUT_CAP_EXCEEDED');
    }
    let result;
    let checkpoint;
    const getInput = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: this.#checkpointProviderId,
      checkpoint_id: input.compaction_id,
      session_id: input.session_id,
    };
    try {
      checkpoint = validatePortResult('CheckpointProvider', 'get', this.#checkpoint.get(getInput), getInput);
      result = parseContract(CompactionResultSchema, checkpoint.payload, 'compaction checkpoint payload');
    } catch (error) {
      if (error?.code !== 'CHECKPOINT_NOT_FOUND') {
        throw new CompactionRuntimeError('checkpoint recovery failed closed', 'COMPACTION_CHECKPOINT_RECOVERY_FAILED', {
          cause_code: error?.code || 'unknown',
        });
      }
      try {
        result = validatePortResult('CompactionProvider', 'compact', entry.provider.compact(input), input);
      } catch (providerError) {
        throw new CompactionRuntimeError('compaction provider failed', 'COMPACTION_PROVIDER_FAILED', {
          cause_code: providerError?.code || 'unknown',
        });
      }
    }
    if (
      result.provider_id !== input.provider_id ||
      result.compaction_id !== input.compaction_id ||
      result.trigger !== input.trigger ||
      result.strategy !== input.strategy
    ) {
      throw new CompactionRuntimeError('compaction result identity mismatch', 'COMPACTION_IDENTITY_MISMATCH');
    }
    if (result.source_digest !== digest(input.sources)) {
      throw new CompactionRuntimeError('provider result does not bind the exact sources', 'COMPACTION_SOURCE_DIGEST_MISMATCH');
    }
    const afterBytes = Buffer.byteLength(canonicalJson(result.replacement_messages), 'utf8');
    if (
      result.before.message_count !== input.sources.length ||
      result.before.bytes !== beforeBytes ||
      result.before.tokens !== beforeBytes ||
      result.after.message_count !== result.replacement_messages.length ||
      result.after.bytes !== afterBytes ||
      result.after.tokens !== afterBytes
    ) {
      throw new CompactionRuntimeError('provider byte or message accounting is false', 'COMPACTION_ACCOUNTING_MISMATCH');
    }
    if (afterBytes > entry.manifest.max_output_bytes) {
      throw new CompactionRuntimeError('compaction output exceeds provider manifest cap', 'COMPACTION_OUTPUT_CAP_EXCEEDED');
    }
    if (
      input.strategy === 'tool_result_prune' &&
      canonicalJson(result.replacement_messages.map((message) => message.tool_call_id)) !==
        canonicalJson(input.sources.map((source) => source.message.tool_call_id))
    ) {
      throw new CompactionRuntimeError('tool replacements changed call identity or ordering', 'COMPACTION_TOOL_IDENTITY_MISMATCH');
    }
    if (typeof acceptResult !== 'function' || acceptResult(result) !== true) {
      throw new CompactionRuntimeError(
        'compaction replacement does not satisfy the caller budget',
        'COMPACTION_REPLACEMENT_REJECTED',
      );
    }
    if (!checkpoint) {
      const putInput = {
        schema_version: CONTRACT_SCHEMA_VERSION,
        provider_id: this.#checkpointProviderId,
        checkpoint_id: input.compaction_id,
        session_id: input.session_id,
        payload: result,
      };
      checkpoint = validatePortResult('CheckpointProvider', 'put', this.#checkpoint.put(putInput), putInput);
    }
    if (
      checkpoint.payload_digest !== digest(result) ||
      canonicalJson(checkpoint.payload) !== canonicalJson(result)
    ) {
      throw new CompactionRuntimeError('checkpoint provider did not preserve the exact payload', 'CHECKPOINT_PAYLOAD_MISMATCH');
    }
    return deepFreeze({
      compaction_id: result.compaction_id,
      turn_id: input.turn_id,
      provider_id: result.provider_id,
      provider_manifest: entry.manifest,
      checkpoint_provider_id: this.#checkpointProviderId,
      trigger: result.trigger,
      strategy: result.strategy,
      checkpoint_ref: checkpoint.checkpoint_ref,
      source_event_ids: input.sources.map((source) => source.source_event_id),
      retained_source_event_ids: [...retainedSourceEventIds],
      source_digest: result.source_digest,
      replacement_messages: result.replacement_messages,
      before: result.before,
      after: result.after,
      pruned_tool_call_ids: result.pruned_tool_call_ids,
    });
  }
}

module.exports = { CompactionRuntime, CompactionRuntimeError };
