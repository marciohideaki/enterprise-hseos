'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  JsonObjectSchema,
  ModelNameSchema,
  ReferenceSchema,
  boundedString,
  strictObject,
  z,
} = require('./common');

const AgentLimitsSchema = strictObject({
  max_turns: z.number().int().positive(),
  max_tokens: z.number().int().positive(),
  max_duration_ms: z.number().int().positive(),
  max_tool_calls: z.number().int().nonnegative(),
  max_children: z.number().int().nonnegative(),
  max_workflow_steps: z.number().int().nonnegative(),
});

const AgentToolCallSchema = strictObject({
  tool_call_id: IdentifierSchema,
  name: IdentifierSchema,
  input: JsonObjectSchema,
});

const KernelExecutionSchema = strictObject({
  mode: z.literal('kernel'),
  model_provider_id: IdentifierSchema,
  model: ModelNameSchema,
});

const DelegatedExecutionSchema = strictObject({
  mode: z.literal('delegated'),
  runtime_provider_id: IdentifierSchema,
  profile: IdentifierSchema,
});

const AgentSessionSpecSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  session_id: IdentifierSchema,
  agent_id: IdentifierSchema,
  parent_session_id: IdentifierSchema.nullable(),
  authority_ref: ReferenceSchema,
  policy_ref: ReferenceSchema,
  execution: z.discriminatedUnion('mode', [KernelExecutionSchema, DelegatedExecutionSchema]),
  limits: AgentLimitsSchema,
  metadata: JsonObjectSchema,
}).superRefine((session, context) => {
  if (session.parent_session_id === session.session_id) {
    context.addIssue({ code: 'custom', path: ['parent_session_id'], message: 'session cannot be its own parent' });
  }
});

const AgentMessageSchema = strictObject({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: IdentifierSchema.optional(),
  tool_call_id: IdentifierSchema.optional(),
  tool_calls: z.array(AgentToolCallSchema).max(128).optional(),
}).superRefine((message, context) => {
  if (message.role === 'tool' && !message.tool_call_id) {
    context.addIssue({ code: 'custom', path: ['tool_call_id'], message: 'tool message requires tool_call_id' });
  }
  if (message.role !== 'tool' && message.tool_call_id) {
    context.addIssue({ code: 'custom', path: ['tool_call_id'], message: 'tool_call_id is valid only for tool messages' });
  }
  if (message.role !== 'assistant' && message.tool_calls) {
    context.addIssue({ code: 'custom', path: ['tool_calls'], message: 'tool_calls are valid only for assistant messages' });
  }
  if (message.tool_calls) {
    const callIds = message.tool_calls.map((call) => call.tool_call_id);
    if (new Set(callIds).size !== callIds.length) {
      context.addIssue({ code: 'custom', path: ['tool_calls'], message: 'tool call identifiers must be unique' });
    }
  }
});

const ToolDefinitionSchema = strictObject({
  name: IdentifierSchema,
  description: z.string().min(1).max(8192),
  input_schema: JsonObjectSchema,
  governance_ref: ReferenceSchema,
});

const ToolDefinitionsSchema = z.array(ToolDefinitionSchema).superRefine((tools, context) => {
  const names = tools.map((tool) => tool.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    context.addIssue({ code: 'custom', message: `duplicate tool definitions: ${[...new Set(duplicates)].sort().join(', ')}` });
  }
});

const ToolExecutionErrorSchema = strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

const ToolExecutionResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  invocation_id: IdentifierSchema,
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  tool_call_id: IdentifierSchema,
  name: IdentifierSchema,
  status: z.enum(['succeeded', 'failed', 'cancelled', 'uncertain']),
  operation_id: IdentifierSchema.nullable(),
  result: z.json().nullable(),
  error: ToolExecutionErrorSchema.nullable(),
  evidence_refs: z.array(z.string()),
  warnings: z.array(z.string()),
  replayed: z.boolean(),
}).superRefine((outcome, context) => {
  if (outcome.status === 'succeeded' && (outcome.operation_id === null || outcome.error !== null)) {
    context.addIssue({ code: 'custom', message: 'succeeded tool outcomes require operation_id and no error' });
  }
  if (outcome.status !== 'succeeded' && (outcome.result !== null || outcome.error === null || outcome.replayed)) {
    context.addIssue({ code: 'custom', message: 'non-success tool outcomes require an error and cannot contain result/replayed' });
  }
  if (outcome.status === 'cancelled' && outcome.error?.code !== 'EXECUTION_CANCELLED') {
    context.addIssue({ code: 'custom', message: 'cancelled outcomes require EXECUTION_CANCELLED' });
  }
  if (outcome.status === 'uncertain' && outcome.error?.code !== 'EXECUTION_OUTCOME_IN_DOUBT') {
    context.addIssue({ code: 'custom', message: 'uncertain outcomes require EXECUTION_OUTCOME_IN_DOUBT' });
  }
  if (outcome.status === 'failed' && ['EXECUTION_CANCELLED', 'EXECUTION_OUTCOME_IN_DOUBT'].includes(outcome.error?.code)) {
    context.addIssue({ code: 'custom', message: 'failed outcomes cannot use cancelled or uncertain codes' });
  }
  for (const field of ['evidence_refs', 'warnings']) {
    if (new Set(outcome[field]).size !== outcome[field].length) {
      context.addIssue({ code: 'custom', path: [field], message: `${field} must contain unique values` });
    }
  }
});

const ModelRequestSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  request_id: IdentifierSchema,
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  provider_id: IdentifierSchema,
  model: ModelNameSchema,
  messages: z.array(AgentMessageSchema).min(1),
  tools: ToolDefinitionsSchema,
  parameters: strictObject({
    max_output_tokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2).nullable(),
    stop: z.array(boundedString(16_384).min(1)).max(16),
  }).refine((parameters) => Buffer.byteLength(JSON.stringify(parameters), 'utf8') <= 262_144, {
    message: 'model parameters exceed the request byte limit',
  }),
});

const CreateAgentCommandSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('create'),
  spec: AgentSessionSpecSchema,
});

const ResumeAgentCommandSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('resume'),
  session_id: IdentifierSchema,
  expected_sequence: z.number().int().nonnegative(),
});

const SendAgentCommandSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('send'),
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  message: AgentMessageSchema,
});

const CancelAgentCommandSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('cancel'),
  session_id: IdentifierSchema,
  reason: z.string().min(1).max(2048),
  cascade: z.boolean(),
});

const DisposeAgentCommandSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('dispose'),
  session_id: IdentifierSchema,
});

const AgentCommandSchema = z.discriminatedUnion('command', [
  CreateAgentCommandSchema,
  ResumeAgentCommandSchema,
  SendAgentCommandSchema,
  CancelAgentCommandSchema,
  DisposeAgentCommandSchema,
]);

module.exports = {
  AgentCommandSchema,
  AgentLimitsSchema,
  AgentMessageSchema,
  AgentSessionSpecSchema,
  AgentToolCallSchema,
  CancelAgentCommandSchema,
  CreateAgentCommandSchema,
  DelegatedExecutionSchema,
  DisposeAgentCommandSchema,
  KernelExecutionSchema,
  ModelRequestSchema,
  ResumeAgentCommandSchema,
  SendAgentCommandSchema,
  ToolDefinitionSchema,
  ToolDefinitionsSchema,
  ToolExecutionErrorSchema,
  ToolExecutionResultSchema,
};
