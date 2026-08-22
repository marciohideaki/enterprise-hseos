'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  NormalizedErrorCodeSchema,
  OpaqueIdentifierSchema,
  ReferenceSchema,
  TimestampSchema,
  boundedJsonObject,
  boundedString,
  strictObject,
  z,
} = require('./common');
const { AgentMessageSchema, AgentSessionSpecSchema, ModelRequestSchema } = require('./agent-contracts');

const MAX_EVENT_DELTA_BYTES = 262_144;
const MAX_RUNTIME_TOOL_INPUT_BYTES = 1_048_576;

function streamEvent(eventType, payload) {
  return strictObject({
    schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
    provider_id: IdentifierSchema,
    request_id: IdentifierSchema,
    event_type: z.literal(eventType),
    sequence: z.number().int().nonnegative(),
    payload,
  });
}

const ModelStreamEventSchema = z.discriminatedUnion('event_type', [
  streamEvent('content.delta', strictObject({ text: boundedString(MAX_EVENT_DELTA_BYTES) })),
  streamEvent('reasoning.delta', strictObject({ text: boundedString(MAX_EVENT_DELTA_BYTES) })),
  streamEvent(
    'tool_call.delta',
    strictObject({
      tool_call_id: IdentifierSchema,
      name: IdentifierSchema.nullable(),
      arguments_delta: boundedString(MAX_EVENT_DELTA_BYTES),
    }),
  ),
  streamEvent(
    'usage',
    strictObject({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      cached_tokens: z.number().int().nonnegative(),
    }),
  ),
  streamEvent(
    'completed',
    strictObject({
      finish_reason: z.enum(['stop', 'tool_calls', 'length', 'cancelled']),
      provider_response_ref: ReferenceSchema,
    }),
  ),
  streamEvent(
    'failed',
    strictObject({
      error_code: NormalizedErrorCodeSchema,
      message: z.string().min(1).max(4096),
      retryable: z.boolean(),
    }),
  ),
]);

function sessionEvent(eventType, payload) {
  return strictObject({
    schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
    event_id: IdentifierSchema,
    session_id: IdentifierSchema,
    sequence: z.number().int().positive(),
    occurred_at: TimestampSchema,
    event_type: z.literal(eventType),
    payload,
  });
}

const SessionEventSchema = z
  .discriminatedUnion('event_type', [
    sessionEvent('session.created', strictObject({ spec: AgentSessionSpecSchema })),
    sessionEvent('session.resumed', strictObject({ from_sequence: z.number().int().nonnegative() })),
    sessionEvent('session.forked', strictObject({ parent_session_id: IdentifierSchema, parent_sequence: z.number().int().positive() })),
    sessionEvent('turn.started', strictObject({ turn_id: IdentifierSchema, input: AgentMessageSchema })),
    sessionEvent(
      'context.assembled',
      strictObject({ turn_id: IdentifierSchema, request: ModelRequestSchema, source_refs: z.array(ReferenceSchema) }),
    ),
    sessionEvent(
      'model.streamed',
      strictObject({ turn_id: IdentifierSchema, provider_id: IdentifierSchema, event: ModelStreamEventSchema }),
    ),
    sessionEvent(
      'tool.operation_linked',
      strictObject({ turn_id: IdentifierSchema, tool_call_id: IdentifierSchema, operation_id: IdentifierSchema }),
    ),
    sessionEvent(
      'compaction.completed',
      strictObject({ checkpoint_ref: ReferenceSchema, source_event_ids: z.array(IdentifierSchema).min(1) }),
    ),
    sessionEvent('child.attached', strictObject({ child_session_id: IdentifierSchema, authority_ceiling_ref: ReferenceSchema })),
    sessionEvent(
      'workflow.checkpointed',
      strictObject({ workflow_id: IdentifierSchema, step_id: IdentifierSchema, checkpoint_ref: ReferenceSchema }),
    ),
    sessionEvent('session.cancelled', strictObject({ reason: z.string().min(1).max(2048), cascade: z.boolean() })),
    sessionEvent('session.completed', strictObject({ outcome_ref: ReferenceSchema })),
    sessionEvent(
      'session.failed',
      strictObject({ error_code: NormalizedErrorCodeSchema, message: z.string().min(1).max(4096), retryable: z.boolean() }),
    ),
  ])
  .superRefine((event, context) => {
    if (event.event_type === 'session.created' && event.session_id !== event.payload.spec.session_id) {
      context.addIssue({ code: 'custom', path: ['payload', 'spec', 'session_id'], message: 'session identity mismatch' });
    }
    if (event.event_type === 'context.assembled') {
      if (event.session_id !== event.payload.request.session_id) {
        context.addIssue({ code: 'custom', path: ['payload', 'request', 'session_id'], message: 'session identity mismatch' });
      }
      if (event.payload.turn_id !== event.payload.request.turn_id) {
        context.addIssue({ code: 'custom', path: ['payload', 'request', 'turn_id'], message: 'turn identity mismatch' });
      }
    }
    if (event.event_type === 'model.streamed' && event.payload.provider_id !== event.payload.event.provider_id) {
      context.addIssue({ code: 'custom', path: ['payload', 'event', 'provider_id'], message: 'provider identity mismatch' });
    }
  });

function runtimeEvent(eventType, payload) {
  return strictObject({
    schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
    provider_id: IdentifierSchema,
    runtime_session_id: OpaqueIdentifierSchema,
    sequence: z.number().int().positive(),
    occurred_at: TimestampSchema,
    event_type: z.literal(eventType),
    payload,
  });
}

const RuntimeEventSchema = z.discriminatedUnion('event_type', [
  runtimeEvent('runtime.session.started', strictObject({ hseos_session_id: IdentifierSchema })),
  runtimeEvent('runtime.message.delta', strictObject({ turn_id: IdentifierSchema, text: boundedString(MAX_EVENT_DELTA_BYTES) })),
  runtimeEvent(
    'runtime.tool.call',
    strictObject({
      turn_id: IdentifierSchema,
      tool_call_id: IdentifierSchema,
      name: IdentifierSchema,
      input: boundedJsonObject(MAX_RUNTIME_TOOL_INPUT_BYTES),
    }),
  ),
  runtimeEvent(
    'runtime.approval.outcome',
    strictObject({ tool_call_id: IdentifierSchema, decision: z.enum(['approved', 'denied']), approval_ref: ReferenceSchema }),
  ),
  runtimeEvent('runtime.session.completed', strictObject({ outcome_ref: ReferenceSchema })),
  runtimeEvent(
    'runtime.session.failed',
    strictObject({ error_code: NormalizedErrorCodeSchema, message: z.string().min(1).max(4096), retryable: z.boolean() }),
  ),
]);

module.exports = {
  MAX_EVENT_DELTA_BYTES,
  MAX_RUNTIME_TOOL_INPUT_BYTES,
  ModelStreamEventSchema,
  RuntimeEventSchema,
  SessionEventSchema,
};
