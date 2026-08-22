'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  JsonObjectSchema,
  ModelNameSchema,
  ReferenceSchema,
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
}).superRefine((message, context) => {
  if (message.role === 'tool' && !message.tool_call_id) {
    context.addIssue({ code: 'custom', path: ['tool_call_id'], message: 'tool message requires tool_call_id' });
  }
  if (message.role !== 'tool' && message.tool_call_id) {
    context.addIssue({ code: 'custom', path: ['tool_call_id'], message: 'tool_call_id is valid only for tool messages' });
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
    stop: z.array(z.string().min(1)).max(16),
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
};
