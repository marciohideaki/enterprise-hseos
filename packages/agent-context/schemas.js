'use strict';

const {
  AgentMessageSchema,
  AgentSessionSpecSchema,
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  ReferenceSchema,
  TimestampSchema,
  ToolDefinitionsSchema,
  boundedString,
  strictObject,
  z,
} = require('../agent-runtime-contracts');

const MAX_CONTEXT_SOURCE_BYTES = 1_048_576;
const MAX_CONTEXT_ASSEMBLY_BYTES = 16_777_216;
const MAX_TOOL_DEFINITIONS_BYTES = 4_194_304;
const MAX_PARAMETER_BYTES = 262_144;
const SENSITIVE_KEY = /(?:^|_)(?:access_token|api_key|approval_token|auth|authentication|authorization|client_secret|cookie|credential|credentials|password|private_key|refresh_token|secret|session_cookie|set_cookie|token)$/;
const SafeReferenceSchema = ReferenceSchema.refine((value) => !/[\s\u0000-\u001f\u007f]/u.test(value), {
  message: 'context source references cannot contain whitespace or control characters',
});
const ContextTextSchema = boundedString(MAX_CONTEXT_SOURCE_BYTES).refine(
  (value) => value.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
  { message: 'context text must be non-empty and cannot contain unsafe control characters' },
);
const BoundedAgentMessageSchema = AgentMessageSchema.superRefine((message, context) => {
  if (Buffer.byteLength(message.content, 'utf8') > MAX_CONTEXT_SOURCE_BYTES) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'message exceeds the context source byte limit' });
  }
});
const BoundedToolDefinitionsSchema = ToolDefinitionsSchema.refine(
  (tools) => Buffer.byteLength(JSON.stringify(tools), 'utf8') <= MAX_TOOL_DEFINITIONS_BYTES,
  { message: 'tool definitions exceed the assembly byte limit' },
);
const ContextSourceSchema = strictObject({
  source_ref: SafeReferenceSchema,
  classification: z.enum(['public', 'internal']),
  content: ContextTextSchema,
});
const MemorySourceSchema = strictObject({
  source_ref: SafeReferenceSchema,
  classification: z.enum(['public', 'internal']),
  priority: z.number().int().min(0).max(100),
  content: ContextTextSchema,
});
const HistorySourceSchema = strictObject({
  source_event_id: IdentifierSchema,
  source_ref: SafeReferenceSchema,
  sequence: z.number().int().positive(),
  message: BoundedAgentMessageSchema,
});
const CurrentTurnSchema = strictObject({ source_ref: SafeReferenceSchema, message: BoundedAgentMessageSchema }).superRefine(
  (turn, context) => {
    if (turn.message.role !== 'user') {
      context.addIssue({ code: 'custom', path: ['message', 'role'], message: 'current turn must be a user message' });
    }
  },
);
const InstructionLayersSchema = strictObject({
  constitution: z.array(ContextSourceSchema).min(1).max(16),
  project: z.array(ContextSourceSchema).min(1).max(64),
  adapter: z.array(ContextSourceSchema).max(32),
  agent: z.array(ContextSourceSchema).max(32),
  skill: z.array(ContextSourceSchema).max(128),
});

function allSources(input) {
  return [
    ...Object.values(input.instructions).flat(),
    ...input.runtime_context,
    ...input.references,
    ...input.memory,
    input.current_turn,
  ];
}

function findSensitiveKey(value, path = 'tools') {
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) {
      const found = findSensitiveKey(nested, `${path}[${index}]`);
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
    const found = findSensitiveKey(nested, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

const ContextAssemblyInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  request_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  event_id: IdentifierSchema,
  compaction_id: IdentifierSchema.optional(),
  compaction_event_id: IdentifierSchema.optional(),
  compaction_provider_id: IdentifierSchema.optional(),
  occurred_at: TimestampSchema,
  expected_version: z.number().int().nonnegative(),
  session: AgentSessionSpecSchema,
  instructions: InstructionLayersSchema,
  runtime_context: z.array(ContextSourceSchema).max(64),
  references: z.array(ContextSourceSchema).max(256),
  memory: z.array(MemorySourceSchema).max(256),
  current_turn: CurrentTurnSchema,
  tools: BoundedToolDefinitionsSchema,
  parameters: strictObject({
    max_output_tokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2).nullable(),
    stop: z.array(boundedString(16_384).min(1)).max(16),
  }).refine((parameters) => Buffer.byteLength(JSON.stringify(parameters), 'utf8') <= MAX_PARAMETER_BYTES, {
    message: 'model parameters exceed the assembly byte limit',
  }),
  overflow_policy: z.enum(['reject', 'truncate_optional', 'compact']),
}).superRefine((input, context) => {
  if (input.session.execution.mode !== 'kernel') {
    context.addIssue({ code: 'custom', path: ['session', 'execution', 'mode'], message: 'context assembly requires kernel execution' });
  }
  const compactionFields = [input.compaction_id, input.compaction_event_id, input.compaction_provider_id];
  if (input.overflow_policy === 'compact' && compactionFields.some((field) => !field)) {
    context.addIssue({ code: 'custom', path: ['overflow_policy'], message: 'compact policy requires compaction ids and provider' });
  }
  if (input.overflow_policy !== 'compact' && compactionFields.some((field) => field !== undefined)) {
    context.addIssue({ code: 'custom', path: ['overflow_policy'], message: 'compaction fields require compact policy' });
  }
  const sourceRefs = allSources(input).map((source) => source.source_ref);
  const duplicateRefs = sourceRefs.filter((reference, index) => sourceRefs.indexOf(reference) !== index);
  if (duplicateRefs.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['instructions'],
      message: `duplicate source references: ${[...new Set(duplicateRefs)].sort().join(', ')}`,
    });
  }
  const sourceBytes = allSources(input).reduce((total, source) => {
    const content = source.content ?? source.message?.content ?? '';
    return total + Buffer.byteLength(content, 'utf8');
  }, 0);
  if (sourceBytes > MAX_CONTEXT_ASSEMBLY_BYTES) {
    context.addIssue({ code: 'custom', message: 'context sources exceed the total assembly byte limit' });
  }
  const sensitivePath = findSensitiveKey(input.tools);
  if (sensitivePath) {
    context.addIssue({ code: 'custom', path: ['tools'], message: `credential-bearing field is forbidden: ${sensitivePath}` });
  }
});

module.exports = {
  ContextAssemblyInputSchema,
  ContextSourceSchema,
  ContextTextSchema,
  HistorySourceSchema,
  InstructionLayersSchema,
  MAX_CONTEXT_ASSEMBLY_BYTES,
  MAX_CONTEXT_SOURCE_BYTES,
  MAX_PARAMETER_BYTES,
  MAX_TOOL_DEFINITIONS_BYTES,
  MemorySourceSchema,
  SafeReferenceSchema,
};
