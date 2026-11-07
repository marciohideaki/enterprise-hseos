'use strict';

const { createHash } = require('node:crypto');

const {
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  ReferenceSchema,
  SemverSchema,
  boundedJsonObject,
  boundedString,
  strictObject,
  uniqueEnumArray,
  z,
} = require('./common');
const { AgentMessageSchema } = require('./agent-contracts');

const MAX_COMPACTION_INPUT_BYTES = 16_777_216;
const MAX_COMPACTION_OUTPUT_BYTES = 262_144;
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const SENSITIVE_KEY =
  /(?:^|_)(?:access_token|api_key|approval_token|auth|authentication|authorization|client_secret|cookie|credential|credentials|password|private_key|refresh_token|secret|session_cookie|set_cookie|token)$/;
const UniqueIdentifiersSchema = z
  .array(IdentifierSchema)
  .max(4096)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: 'identifiers must be unique' });
  });

const CompactionProviderManifestSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  provider_version: SemverSchema,
  strategies: uniqueEnumArray(z.enum(['history_summary', 'tool_result_prune']), 1),
  max_input_bytes: z.number().int().positive().max(MAX_COMPACTION_INPUT_BYTES),
  max_output_bytes: z.number().int().positive().max(MAX_COMPACTION_OUTPUT_BYTES),
});

const CompactionSourceSchema = strictObject({
  source_event_id: IdentifierSchema,
  source_ref: ReferenceSchema,
  sequence: z.number().int().positive(),
  message: AgentMessageSchema,
});

const CompactionAssessInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  trigger: z.enum(['context_pressure', 'tool_result_pressure']),
  input_tokens: z.number().int().nonnegative().max(1_000_000_000),
  input_limit_tokens: z.number().int().positive().max(1_000_000_000),
});

const CompactionPressureSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  should_compact: z.boolean(),
  pressure_basis_points: z.number().int().min(0).max(1_000_000),
  target_tokens: z.number().int().nonnegative(),
});

const CompactionInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  compaction_id: IdentifierSchema,
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  trigger: z.enum(['context_pressure', 'tool_result_pressure']),
  strategy: z.enum(['history_summary', 'tool_result_prune']),
  target_tokens: z.number().int().nonnegative(),
  sources: z.array(CompactionSourceSchema).min(1).max(4096),
}).superRefine((input, context) => {
  const ids = input.sources.map((source) => source.source_event_id);
  const refs = input.sources.map((source) => source.source_ref);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['sources'], message: 'source event ids must be unique' });
  if (new Set(refs).size !== refs.length) context.addIssue({ code: 'custom', path: ['sources'], message: 'source refs must be unique' });
  if (Buffer.byteLength(JSON.stringify(input.sources), 'utf8') > MAX_COMPACTION_INPUT_BYTES) {
    context.addIssue({ code: 'custom', path: ['sources'], message: 'compaction sources exceed the byte limit' });
  }
});

const CompactionStatsSchema = strictObject({
  message_count: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
}).superRefine((stats, context) => {
  if (stats.tokens !== stats.bytes) {
    context.addIssue({ code: 'custom', path: ['tokens'], message: 'A7 uses the canonical UTF-8 byte upper-bound counter' });
  }
});

const CompactionResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  compaction_id: IdentifierSchema,
  trigger: z.enum(['context_pressure', 'tool_result_pressure']),
  strategy: z.enum(['history_summary', 'tool_result_prune']),
  source_digest: DigestSchema,
  replacement_messages: z.array(AgentMessageSchema).min(1).max(128),
  before: CompactionStatsSchema,
  after: CompactionStatsSchema,
  pruned_tool_call_ids: UniqueIdentifiersSchema,
}).superRefine((result, context) => {
  if (
    result.strategy === 'history_summary' &&
    (result.replacement_messages.length !== 1 ||
      result.replacement_messages[0].role !== 'assistant' ||
      result.replacement_messages[0].tool_call_id ||
      result.replacement_messages[0].tool_calls)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['replacement_messages'],
      message: 'history replacement must be one plain assistant message',
    });
  }
  if (
    result.strategy === 'tool_result_prune' &&
    (result.replacement_messages.some((message) => message.role !== 'tool') ||
      result.pruned_tool_call_ids.length !== result.replacement_messages.length ||
      canonicalIds(result.replacement_messages.map((message) => message.tool_call_id)) !== canonicalIds(result.pruned_tool_call_ids))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['replacement_messages'],
      message: 'tool pruning must preserve one tool message per call id',
    });
  }
  if (
    result.before.message_count < 1 ||
    result.after.message_count !== result.replacement_messages.length ||
    result.after.bytes >= result.before.bytes
  ) {
    context.addIssue({ code: 'custom', message: 'compaction replacements must be smaller than their sources' });
  }
  if (result.after.tokens > result.before.tokens) {
    context.addIssue({ code: 'custom', path: ['after', 'tokens'], message: 'compaction cannot increase token pressure' });
  }
  if (Buffer.byteLength(JSON.stringify(result.replacement_messages), 'utf8') > MAX_COMPACTION_OUTPUT_BYTES) {
    context.addIssue({ code: 'custom', path: ['replacement_messages'], message: 'replacements exceed the output byte limit' });
  }
});

const CompactionRecordSchema = strictObject({
  compaction_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  provider_id: IdentifierSchema,
  provider_manifest: CompactionProviderManifestSchema,
  checkpoint_provider_id: IdentifierSchema,
  trigger: z.enum(['context_pressure', 'tool_result_pressure']),
  strategy: z.enum(['history_summary', 'tool_result_prune']),
  checkpoint_ref: ReferenceSchema,
  source_event_ids: UniqueIdentifiersSchema.min(1),
  retained_source_event_ids: UniqueIdentifiersSchema,
  source_digest: DigestSchema,
  replacement_messages: z.array(AgentMessageSchema).min(1).max(128),
  before: CompactionStatsSchema,
  after: CompactionStatsSchema,
  pruned_tool_call_ids: UniqueIdentifiersSchema,
}).superRefine((record, context) => {
  const retained = new Set(record.retained_source_event_ids);
  if (record.source_event_ids.some((eventId) => retained.has(eventId))) {
    context.addIssue({ code: 'custom', message: 'compacted and retained event ids cannot overlap' });
  }
  const parsed = CompactionResultSchema.safeParse({
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_id: record.provider_id,
    compaction_id: record.compaction_id,
    trigger: record.trigger,
    strategy: record.strategy,
    source_digest: record.source_digest,
    replacement_messages: record.replacement_messages,
    before: record.before,
    after: record.after,
    pruned_tool_call_ids: record.pruned_tool_call_ids,
  });
  if (!parsed.success) context.addIssue({ code: 'custom', message: 'compaction record violates result invariants' });
  if (record.provider_manifest.provider_id !== record.provider_id) {
    context.addIssue({ code: 'custom', path: ['provider_manifest'], message: 'record manifest identity mismatch' });
  }
  if (record.before.bytes > record.provider_manifest.max_input_bytes || record.after.bytes > record.provider_manifest.max_output_bytes) {
    context.addIssue({ code: 'custom', message: 'record exceeds its provider manifest caps' });
  }
});

function canonicalIds(values) {
  return JSON.stringify([...values].sort());
}

function sensitivePath(value, path = 'payload') {
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) {
      const found = sensitivePath(nested, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key
      .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replaceAll(/[^a-zA-Z0-9]+/g, '_')
      .replaceAll(/^_+|_+$/g, '')
      .toLowerCase();
    if (SENSITIVE_KEY.test(normalized)) return `${path}.${key}`;
    const found = sensitivePath(nested, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

const SafeCheckpointPayloadSchema = boundedJsonObject(MAX_COMPACTION_OUTPUT_BYTES).superRefine((payload, context) => {
  const found = sensitivePath(payload);
  if (found) context.addIssue({ code: 'custom', message: `credential-bearing checkpoint field is forbidden: ${found}` });
});

const CheckpointPutInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  checkpoint_id: IdentifierSchema,
  session_id: IdentifierSchema,
  payload: SafeCheckpointPayloadSchema,
});

const CheckpointGetInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  checkpoint_id: IdentifierSchema,
  session_id: IdentifierSchema,
});

const CheckpointDisposeInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  session_id: IdentifierSchema,
});

const CheckpointRecordSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  checkpoint_id: IdentifierSchema,
  session_id: IdentifierSchema,
  checkpoint_ref: ReferenceSchema,
  payload_digest: DigestSchema,
  payload: SafeCheckpointPayloadSchema,
});

const CheckpointDisposeResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  session_id: IdentifierSchema,
  accepted: z.boolean(),
});

// The single definition of a pruned tool-result stub. The deterministic compaction provider produces it and the
// session replay re-derives it, so the formula lives here and nowhere else.
const PRUNED_STUB_KEYS = Object.freeze(['status', 'evidence_refs', 'warnings', 'error', 'sha256', 'path', 'result_digest', 'pruned']);

function canonicalToolJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalToolJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalToolJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function toolResultDigest(value) {
  return `sha256:${createHash('sha256').update(canonicalToolJson(value)).digest('hex')}`;
}

// What the next action needs: the error contract and the identity (sha256, path) of the produced artifact.
function nextActionMetadata(result) {
  const out = {};
  const error = result?.error;
  if (error && typeof error === 'object') {
    const picked = {};
    for (const key of ['code', 'message', 'retryable']) {
      if (error[key] === undefined) continue;
      picked[key] = error[key];
    }
    out.error = picked;
  }
  const body = result?.result;
  if (body && typeof body === 'object') {
    if (typeof body.sha256 === 'string') out.sha256 = body.sha256;
    if (typeof body.path === 'string') out.path = body.path;
  }
  return out;
}

function pruneToolMessage(message) {
  if (message.role !== 'tool') throw new TypeError('tool_result_prune accepts only tool messages');
  let result = null;
  try {
    result = JSON.parse(message.content);
  } catch {
    // The digest below still preserves identity for a non-JSON provider payload.
  }
  return {
    role: 'tool',
    ...(message.name ? { name: message.name } : {}),
    tool_call_id: message.tool_call_id,
    content: canonicalToolJson({
      status: result?.status || 'unknown',
      evidence_refs: Array.isArray(result?.evidence_refs) ? result.evidence_refs : [],
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      ...nextActionMetadata(result),
      result_digest: toolResultDigest(message.content),
      pruned: true,
    }),
  };
}

// Why a replacement is not a faithful stub of `source`, or null when it is.
function prunedStubViolation(source, replacement) {
  let stub;
  try {
    stub = JSON.parse(replacement.content);
  } catch {
    return 'stub is not valid JSON';
  }
  const expected = JSON.parse(pruneToolMessage(source).content);
  if (!stub || typeof stub !== 'object' || Array.isArray(stub)) return 'stub is not an object';
  if (stub.pruned !== true) return 'stub is not marked pruned';
  if (Object.keys(stub).some((key) => !PRUNED_STUB_KEYS.includes(key))) return 'stub carries a body field';
  if (stub.result_digest !== expected.result_digest) return 'stub digest differs from the original result';
  for (const key of ['status', 'error', 'sha256', 'path']) {
    if (canonicalToolJson(stub[key]) !== canonicalToolJson(expected[key])) return `stub ${key} differs from the original result`;
  }
  for (const key of ['evidence_refs', 'warnings']) {
    if (canonicalToolJson(stub[key]) !== canonicalToolJson(expected[key])) return `stub ${key} differs from the original outcome`;
  }
  return null;
}

module.exports = {
  CheckpointDisposeInputSchema,
  CheckpointDisposeResultSchema,
  CheckpointGetInputSchema,
  CheckpointPutInputSchema,
  CheckpointRecordSchema,
  CompactionAssessInputSchema,
  CompactionInputSchema,
  CompactionPressureSchema,
  CompactionProviderManifestSchema,
  CompactionRecordSchema,
  CompactionResultSchema,
  CompactionSourceSchema,
  CompactionStatsSchema,
  DigestSchema,
  MAX_COMPACTION_INPUT_BYTES,
  MAX_COMPACTION_OUTPUT_BYTES,
  SafeCheckpointPayloadSchema,
  canonicalToolJson,
  nextActionMetadata,
  pruneToolMessage,
  prunedStubViolation,
  toolResultDigest,
};
