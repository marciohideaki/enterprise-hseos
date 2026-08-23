'use strict';

const { createHash } = require('node:crypto');
const {
  CONTRACT_SCHEMA_VERSION,
  CompactionProviderManifestSchema,
  deepFreeze,
  parseContract,
  validatePortInput,
  validatePortResult,
} = require('../agent-runtime-contracts');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function estimatedTokens(value) {
  // A7 deliberately uses UTF-8 bytes as a conservative, provider-neutral
  // token upper bound. Model-specific tokenizers belong behind later adapters.
  return Buffer.byteLength(canonicalJson(value), 'utf8');
}

function toolPruningMessage(source) {
  if (source.message.role !== 'tool') throw new TypeError('tool_result_prune accepts only tool messages');
  let result = null;
  try {
    result = JSON.parse(source.message.content);
  } catch {
    // The digest below still preserves identity for a non-JSON provider payload.
  }
  return {
    role: 'tool',
    ...(source.message.name ? { name: source.message.name } : {}),
    tool_call_id: source.message.tool_call_id,
    content: canonicalJson({
      status: result?.status || 'unknown',
      evidence_refs: Array.isArray(result?.evidence_refs) ? result.evidence_refs : [],
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      result_digest: digest(source.message.content),
      pruned: true,
    }),
  };
}

class DeterministicCompactionProvider {
  #manifest;
  #threshold;

  constructor({
    provider_id = 'compaction:deterministic',
    provider_version = '1.0.0',
    threshold_basis_points = 8500,
    max_input_bytes = 16_777_216,
    max_output_bytes = 262_144,
  } = {}) {
    if (!Number.isSafeInteger(threshold_basis_points) || threshold_basis_points < 1 || threshold_basis_points > 10_000) {
      throw new TypeError('threshold_basis_points must be between 1 and 10000');
    }
    this.#threshold = threshold_basis_points;
    this.#manifest = parseContract(
      CompactionProviderManifestSchema,
      {
        schema_version: CONTRACT_SCHEMA_VERSION,
        provider_id,
        provider_version,
        strategies: ['history_summary', 'tool_result_prune'],
        max_input_bytes,
        max_output_bytes,
      },
      'deterministic compaction manifest',
    );
    Object.freeze(this);
  }

  manifest(value) {
    const input = validatePortInput('CompactionProvider', 'manifest', value);
    return validatePortResult('CompactionProvider', 'manifest', this.#manifest, input);
  }

  assess(value) {
    const input = validatePortInput('CompactionProvider', 'assess', value);
    const pressure = Math.min(1_000_000, Math.ceil((input.input_tokens * 10_000) / input.input_limit_tokens));
    return validatePortResult(
      'CompactionProvider',
      'assess',
      {
        schema_version: CONTRACT_SCHEMA_VERSION,
        provider_id: this.#manifest.provider_id,
        should_compact: pressure >= this.#threshold,
        pressure_basis_points: pressure,
        target_tokens: Math.max(0, Math.floor(input.input_limit_tokens * 0.7)),
      },
      input,
    );
  }

  compact(value) {
    const input = validatePortInput('CompactionProvider', 'compact', value);
    const sourceDigest = digest(input.sources);
    const beforeBytes = Buffer.byteLength(canonicalJson(input.sources.map((source) => source.message)), 'utf8');
    const beforeTokens = estimatedTokens(input.sources.map((source) => source.message));
    const lines = input.sources.map((source) => `${source.message.role}@${source.source_event_id}: ${source.message.content}`);
    const header = `[HSEOS COMPACTION id=${input.compaction_id} sources=${input.sources.length} digest=${sourceDigest}]\n`;
    const maximumBytes = Math.min(this.#manifest.max_output_bytes, Math.max(64, input.target_tokens));
    let replacementMessages;
    if (input.strategy === 'tool_result_prune') {
      replacementMessages = input.sources.map(toolPruningMessage);
    } else {
      let content = `${header}${lines.join('\n')}`;
      if (Buffer.byteLength(JSON.stringify({ role: 'assistant', content }), 'utf8') >= beforeBytes) {
        content = `${header}Source content retained in immutable session events and checkpoint.`;
      }
      for (let attempt = 0; Buffer.byteLength(JSON.stringify({ role: 'assistant', content }), 'utf8') > maximumBytes; attempt++) {
        if (attempt >= 64 || content.length <= 1) throw new TypeError('provider output cap cannot contain a valid replacement');
        content = `${content.slice(0, Math.max(0, Math.floor(content.length * 0.8) - 1))}…`;
      }
      replacementMessages = [{ role: 'assistant', content }];
    }
    const afterBytes = Buffer.byteLength(canonicalJson(replacementMessages), 'utf8');
    if (afterBytes >= beforeBytes) throw new TypeError('sources are too small to compact safely');
    const prunedToolCallIds = input.strategy === 'tool_result_prune'
      ? input.sources.filter((source) => source.message.role === 'tool').map((source) => source.message.tool_call_id)
      : [];
    const result = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: this.#manifest.provider_id,
      compaction_id: input.compaction_id,
      trigger: input.trigger,
      strategy: input.strategy,
      source_digest: sourceDigest,
      replacement_messages: replacementMessages,
      before: { message_count: input.sources.length, bytes: beforeBytes, tokens: beforeTokens },
      after: { message_count: replacementMessages.length, bytes: afterBytes, tokens: estimatedTokens(replacementMessages) },
      pruned_tool_call_ids: prunedToolCallIds,
    };
    return validatePortResult('CompactionProvider', 'compact', result, input);
  }

  dispose(value) {
    const input = validatePortInput('CompactionProvider', 'dispose', value);
    return validatePortResult(
      'CompactionProvider',
      'dispose',
      {
        schema_version: CONTRACT_SCHEMA_VERSION,
        request_id: input.request_id,
        provider_id: input.provider_id,
        accepted: true,
        evidence_refs: [],
      },
      input,
    );
  }
}

module.exports = { DeterministicCompactionProvider, canonicalJson, digest, estimatedTokens };
