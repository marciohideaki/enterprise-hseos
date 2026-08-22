'use strict';

const {
  AgentContractError,
  boundedJsonObject,
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  ModelNameSchema,
  NormalizedErrorCodeSchema,
  OpaqueIdentifierSchema,
  ReferenceSchema,
  deepFreeze,
  parseContract,
  strictObject,
  uniqueEnumArray,
  z,
} = require('./common');
const {
  CancelAgentCommandSchema,
  CreateAgentCommandSchema,
  DisposeAgentCommandSchema,
  AgentMessageSchema,
  AgentSessionSpecSchema,
  ModelRequestSchema,
  ResumeAgentCommandSchema,
  SendAgentCommandSchema,
  ToolExecutionResultSchema,
  ToolDefinitionsSchema,
} = require('./agent-contracts');
const { ModelStreamEventSchema, RuntimeEventSchema } = require('./event-contracts');
const { ModelProviderManifestSchema, RuntimeProviderManifestSchema } = require('./provider-contracts');
const {
  CheckpointDisposeInputSchema,
  CheckpointDisposeResultSchema,
  CheckpointGetInputSchema,
  CheckpointPutInputSchema,
  CheckpointRecordSchema,
  CompactionAssessInputSchema,
  CompactionInputSchema,
  CompactionPressureSchema,
  CompactionProviderManifestSchema,
  CompactionResultSchema,
} = require('./compaction-contracts');

const PORT_METHODS = deepFreeze({
  AgentRuntime: ['create', 'resume', 'send', 'cancel', 'dispose'],
  ModelProvider: ['manifest', 'discover', 'stream', 'cancel', 'dispose'],
  RuntimeProvider: ['manifest', 'create', 'resume', 'send', 'events', 'cancel', 'dispose'],
  ToolRuntime: ['list', 'execute', 'cancel', 'dispose'],
  CompactionProvider: ['manifest', 'assess', 'compact', 'dispose'],
  CheckpointProvider: ['put', 'get', 'dispose'],
});

const PortAckSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  request_id: IdentifierSchema,
  provider_id: IdentifierSchema,
  accepted: z.boolean(),
  evidence_refs: z.array(ReferenceSchema),
});

const AgentOperationResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  session_id: IdentifierSchema,
  accepted: z.boolean(),
  terminal: z.boolean(),
  event_refs: z.array(ReferenceSchema),
});

const ModelDiscoveryResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  models: uniqueEnumArray(ModelNameSchema, 1),
});

const RuntimeOperationResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  runtime_session_id: OpaqueIdentifierSchema,
  session_id: IdentifierSchema,
  accepted: z.boolean(),
  terminal: z.boolean(),
  evidence_refs: z.array(ReferenceSchema),
});

const PortErrorSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  error_code: NormalizedErrorCodeSchema,
  message: z.string().min(1).max(4096),
  retryable: z.boolean(),
  evidence_refs: z.array(ReferenceSchema),
});

const ProviderQuerySchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  request_id: IdentifierSchema,
  provider_id: IdentifierSchema,
});

const ProviderCancelSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  request_id: IdentifierSchema,
  provider_id: IdentifierSchema,
  reason: z.string().min(1).max(2048),
});

const RuntimeEventsInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  runtime_session_id: OpaqueIdentifierSchema,
  session_id: IdentifierSchema,
  from_sequence: z.number().int().nonnegative(),
});

const RuntimeCreateInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('create'),
  provider_id: IdentifierSchema,
  spec: AgentSessionSpecSchema,
});

const RuntimeResumeInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('resume'),
  provider_id: IdentifierSchema,
  runtime_session_id: OpaqueIdentifierSchema,
  session_id: IdentifierSchema,
  expected_sequence: z.number().int().nonnegative(),
});

const RuntimeSendInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('send'),
  provider_id: IdentifierSchema,
  runtime_session_id: OpaqueIdentifierSchema,
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  message: AgentMessageSchema,
});

const RuntimeCancelInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('cancel'),
  provider_id: IdentifierSchema,
  runtime_session_id: OpaqueIdentifierSchema,
  session_id: IdentifierSchema,
  reason: z.string().min(1).max(2048),
  cascade: z.boolean(),
});

const RuntimeDisposeInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  command: z.literal('dispose'),
  provider_id: IdentifierSchema,
  runtime_session_id: OpaqueIdentifierSchema,
  session_id: IdentifierSchema,
});

const ToolListInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  session_id: IdentifierSchema,
});

const ToolExecuteInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  invocation_id: IdentifierSchema,
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  tool_call_id: IdentifierSchema,
  name: IdentifierSchema,
  input: boundedJsonObject(1_048_576),
  actor: strictObject({ id: IdentifierSchema, type: IdentifierSchema }),
  resource_scope: boundedJsonObject(262_144).refine((scope) => Object.keys(scope).length > 0, {
    message: 'resource_scope must not be empty',
  }),
  idempotency_key: IdentifierSchema,
  correlation_id: IdentifierSchema,
  causation_id: IdentifierSchema,
  approval_context: boundedJsonObject(262_144).nullable(),
});

const ToolCancelInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  invocation_id: IdentifierSchema,
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  tool_call_id: IdentifierSchema,
  reason: z.string().min(1).max(2048),
});

const ToolDisposeInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  session_id: IdentifierSchema,
});

const ToolListResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  session_id: IdentifierSchema,
  tools: ToolDefinitionsSchema,
});

const ToolCancelResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  invocation_id: IdentifierSchema,
  session_id: IdentifierSchema,
  turn_id: IdentifierSchema,
  tool_call_id: IdentifierSchema,
  accepted: z.boolean(),
});

const ToolDisposeResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  session_id: IdentifierSchema,
  accepted: z.boolean(),
});

const PORT_INPUT_CONTRACTS = deepFreeze({
  AgentRuntime: {
    create: 'CreateAgentCommand',
    resume: 'ResumeAgentCommand',
    send: 'SendAgentCommand',
    cancel: 'CancelAgentCommand',
    dispose: 'DisposeAgentCommand',
  },
  ModelProvider: {
    manifest: 'ProviderQuery',
    discover: 'ProviderQuery',
    stream: 'ModelRequest',
    cancel: 'ProviderCancel',
    dispose: 'ProviderQuery',
  },
  RuntimeProvider: {
    manifest: 'ProviderQuery',
    create: 'RuntimeCreateInput',
    resume: 'RuntimeResumeInput',
    send: 'RuntimeSendInput',
    events: 'RuntimeEventsInput',
    cancel: 'RuntimeCancelInput',
    dispose: 'RuntimeDisposeInput',
  },
  ToolRuntime: {
    list: 'ToolListInput',
    execute: 'ToolExecuteInput',
    cancel: 'ToolCancelInput',
    dispose: 'ToolDisposeInput',
  },
  CompactionProvider: {
    manifest: 'ProviderQuery',
    assess: 'CompactionAssessInput',
    compact: 'CompactionInput',
    dispose: 'ProviderQuery',
  },
  CheckpointProvider: {
    put: 'CheckpointPutInput',
    get: 'CheckpointGetInput',
    dispose: 'CheckpointDisposeInput',
  },
});

const PORT_RESULT_CONTRACTS = deepFreeze({
  AgentRuntime: {
    create: 'AgentOperationResult',
    resume: 'AgentOperationResult',
    send: 'AgentOperationResult',
    cancel: 'AgentOperationResult',
    dispose: 'AgentOperationResult',
  },
  ModelProvider: {
    manifest: 'ModelProviderManifest',
    discover: 'ModelDiscoveryResult',
    stream: 'AsyncIterable<ModelStreamEvent>',
    cancel: 'PortAck',
    dispose: 'PortAck',
  },
  RuntimeProvider: {
    manifest: 'RuntimeProviderManifest',
    create: 'RuntimeOperationResult',
    resume: 'RuntimeOperationResult',
    send: 'RuntimeOperationResult',
    events: 'AsyncIterable<RuntimeEvent>',
    cancel: 'RuntimeOperationResult',
    dispose: 'RuntimeOperationResult',
  },
  ToolRuntime: {
    list: 'ToolListResult',
    execute: 'ToolExecutionResult',
    cancel: 'ToolCancelResult',
    dispose: 'ToolDisposeResult',
  },
  CompactionProvider: {
    manifest: 'CompactionProviderManifest',
    assess: 'CompactionPressure',
    compact: 'CompactionResult',
    dispose: 'PortAck',
  },
  CheckpointProvider: {
    put: 'CheckpointRecord',
    get: 'CheckpointRecord',
    dispose: 'CheckpointDisposeResult',
  },
});

const RESULT_SCHEMAS = {
  AgentRuntime: Object.fromEntries(PORT_METHODS.AgentRuntime.map((method) => [method, AgentOperationResultSchema])),
  ModelProvider: {
    manifest: ModelProviderManifestSchema,
    discover: ModelDiscoveryResultSchema,
    stream: null,
    cancel: PortAckSchema,
    dispose: PortAckSchema,
  },
  RuntimeProvider: {
    manifest: RuntimeProviderManifestSchema,
    create: RuntimeOperationResultSchema,
    resume: RuntimeOperationResultSchema,
    send: RuntimeOperationResultSchema,
    events: null,
    cancel: RuntimeOperationResultSchema,
    dispose: RuntimeOperationResultSchema,
  },
  ToolRuntime: {
    list: ToolListResultSchema,
    execute: ToolExecutionResultSchema,
    cancel: ToolCancelResultSchema,
    dispose: ToolDisposeResultSchema,
  },
  CompactionProvider: {
    manifest: CompactionProviderManifestSchema,
    assess: CompactionPressureSchema,
    compact: CompactionResultSchema,
    dispose: PortAckSchema,
  },
  CheckpointProvider: {
    put: CheckpointRecordSchema,
    get: CheckpointRecordSchema,
    dispose: CheckpointDisposeResultSchema,
  },
};

const INPUT_SCHEMAS = {
  AgentRuntime: {
    create: CreateAgentCommandSchema,
    resume: ResumeAgentCommandSchema,
    send: SendAgentCommandSchema,
    cancel: CancelAgentCommandSchema,
    dispose: DisposeAgentCommandSchema,
  },
  ModelProvider: {
    manifest: ProviderQuerySchema,
    discover: ProviderQuerySchema,
    stream: ModelRequestSchema,
    cancel: ProviderCancelSchema,
    dispose: ProviderQuerySchema,
  },
  RuntimeProvider: {
    manifest: ProviderQuerySchema,
    create: RuntimeCreateInputSchema,
    resume: RuntimeResumeInputSchema,
    send: RuntimeSendInputSchema,
    events: RuntimeEventsInputSchema,
    cancel: RuntimeCancelInputSchema,
    dispose: RuntimeDisposeInputSchema,
  },
  ToolRuntime: {
    list: ToolListInputSchema,
    execute: ToolExecuteInputSchema,
    cancel: ToolCancelInputSchema,
    dispose: ToolDisposeInputSchema,
  },
  CompactionProvider: {
    manifest: ProviderQuerySchema,
    assess: CompactionAssessInputSchema,
    compact: CompactionInputSchema,
    dispose: ProviderQuerySchema,
  },
  CheckpointProvider: {
    put: CheckpointPutInputSchema,
    get: CheckpointGetInputSchema,
    dispose: CheckpointDisposeInputSchema,
  },
};

const STREAM_SCHEMAS = {
  ModelProvider: { stream: ModelStreamEventSchema },
  RuntimeProvider: { events: RuntimeEventSchema },
};

function resolvePortMethod(portName, method) {
  if (!PORT_METHODS[portName]) {
    throw new AgentContractError(`Unknown port: ${portName}`, 'AGENT_PORT_UNKNOWN', { port: portName });
  }
  if (!PORT_METHODS[portName].includes(method)) {
    throw new AgentContractError(`Unknown ${portName} method: ${method}`, 'AGENT_PORT_METHOD_UNKNOWN', { port: portName, method });
  }
}

function assertPortShape(portName, implementation) {
  const methods = PORT_METHODS[portName];
  if (!methods) {
    throw new AgentContractError(`Unknown port: ${portName}`, 'AGENT_PORT_UNKNOWN', { port: portName });
  }
  if (!implementation || (typeof implementation !== 'object' && typeof implementation !== 'function')) {
    throw new AgentContractError(`${portName} implementation must be an object`, 'AGENT_PORT_INVALID', { port: portName });
  }
  const missing = methods.filter((method) => typeof implementation[method] !== 'function');
  if (missing.length > 0) {
    throw new AgentContractError(`${portName} is missing required methods: ${missing.join(', ')}`, 'AGENT_PORT_INCOMPLETE', {
      port: portName,
      missing,
    });
  }
  return deepFreeze({ port: portName, methods: [...methods], structural: true });
}

function validatePortInput(portName, method, value) {
  resolvePortMethod(portName, method);
  const input = parseContract(INPUT_SCHEMAS[portName][method], value, `${portName}.${method} input`);
  if (portName === 'RuntimeProvider' && method === 'create' && input.spec.execution.mode !== 'delegated') {
    throw new AgentContractError('RuntimeProvider.create requires delegated execution ownership', 'AGENT_RUNTIME_EXECUTION_OWNER_INVALID');
  }
  if (portName === 'RuntimeProvider' && method === 'create' && input.provider_id !== input.spec.execution.runtime_provider_id) {
    throw new AgentContractError('RuntimeProvider.create provider identity mismatch', 'AGENT_PORT_CORRELATION_INVALID');
  }
  return input;
}

function correlationError(portName, method, field, expected, actual) {
  throw new AgentContractError(`${portName}.${method} ${field} mismatch`, 'AGENT_PORT_CORRELATION_INVALID', {
    port: portName,
    method,
    field,
    expected,
    actual,
  });
}

function assertEqual(portName, method, field, expected, actual) {
  if (expected !== actual) correlationError(portName, method, field, expected, actual);
}

function correlateResult(portName, method, input, result) {
  if (portName === 'AgentRuntime') {
    const expectedSessionId = method === 'create' ? input.spec.session_id : input.session_id;
    assertEqual(portName, method, 'session_id', expectedSessionId, result.session_id);
  }
  if (portName === 'ModelProvider') {
    if (method === 'manifest' || method === 'discover') {
      assertEqual(portName, method, 'provider_id', input.provider_id, result.provider_id);
    }
    if (method === 'cancel' || method === 'dispose') {
      assertEqual(portName, method, 'provider_id', input.provider_id, result.provider_id);
      assertEqual(portName, method, 'request_id', input.request_id, result.request_id);
    }
  }
  if (portName === 'RuntimeProvider') {
    if (method === 'manifest') {
      assertEqual(portName, method, 'provider_id', input.provider_id, result.provider_id);
    } else if (method !== 'events') {
      assertEqual(portName, method, 'provider_id', input.provider_id, result.provider_id);
      const expectedSessionId = method === 'create' ? input.spec.session_id : input.session_id;
      assertEqual(portName, method, 'session_id', expectedSessionId, result.session_id);
      if (method !== 'create') {
        assertEqual(portName, method, 'runtime_session_id', input.runtime_session_id, result.runtime_session_id);
      }
    }
  }
  if (portName === 'ToolRuntime') {
    if (method === 'list' || method === 'dispose') assertEqual(portName, method, 'session_id', input.session_id, result.session_id);
    if (method === 'execute') {
      for (const field of ['invocation_id', 'session_id', 'turn_id', 'tool_call_id', 'name']) {
        assertEqual(portName, method, field, input[field], result[field]);
      }
    }
    if (method === 'cancel') {
      for (const field of ['invocation_id', 'session_id', 'turn_id', 'tool_call_id']) {
        assertEqual(portName, method, field, input[field], result[field]);
      }
    }
  }
  if (portName === 'CompactionProvider') {
    assertEqual(portName, method, 'provider_id', input.provider_id, result.provider_id);
    if (method === 'compact') assertEqual(portName, method, 'compaction_id', input.compaction_id, result.compaction_id);
    if (method === 'dispose') assertEqual(portName, method, 'request_id', input.request_id, result.request_id);
  }
  if (portName === 'CheckpointProvider') {
    assertEqual(portName, method, 'provider_id', input.provider_id, result.provider_id);
    assertEqual(portName, method, 'session_id', input.session_id, result.session_id);
    if (method === 'put' || method === 'get') {
      assertEqual(portName, method, 'checkpoint_id', input.checkpoint_id, result.checkpoint_id);
    }
  }
  return result;
}

function correlateStreamEvent(portName, method, input, event, expectedSequence) {
  assertEqual(portName, method, 'sequence', expectedSequence, event.sequence);
  if (portName === 'ModelProvider') {
    assertEqual(portName, method, 'provider_id', input.provider_id, event.provider_id);
    assertEqual(portName, method, 'request_id', input.request_id, event.request_id);
  } else {
    assertEqual(portName, method, 'provider_id', input.provider_id, event.provider_id);
    assertEqual(portName, method, 'runtime_session_id', input.runtime_session_id, event.runtime_session_id);
    if (event.event_type === 'runtime.session.started') {
      assertEqual(portName, method, 'session_id', input.session_id, event.payload.hseos_session_id);
    }
  }
}

function validatingStream(portName, method, input, iterable, itemSchema, label) {
  return {
    async *[Symbol.asyncIterator]() {
      let expectedSequence = portName === 'ModelProvider' ? 0 : input.from_sequence + 1;
      let previousTimestamp = null;
      for await (const item of iterable) {
        const event = parseContract(itemSchema, item, label);
        correlateStreamEvent(portName, method, input, event, expectedSequence);
        if (portName === 'RuntimeProvider') {
          const timestamp = Date.parse(event.occurred_at);
          if (previousTimestamp !== null && timestamp < previousTimestamp) {
            correlationError(portName, method, 'occurred_at', 'monotonic timestamp', event.occurred_at);
          }
          previousTimestamp = timestamp;
        }
        expectedSequence++;
        yield event;
      }
    },
  };
}

function validatePortResult(portName, method, value, inputValue) {
  resolvePortMethod(portName, method);
  if (inputValue === undefined) {
    throw new AgentContractError(`${portName}.${method} result requires its correlated input`, 'AGENT_PORT_INPUT_REQUIRED');
  }
  const input = validatePortInput(portName, method, inputValue);
  const schema = RESULT_SCHEMAS[portName][method];
  if (schema) {
    const result = parseContract(schema, value, `${portName}.${method} result`);
    return correlateResult(portName, method, input, result);
  }
  if (!value || typeof value[Symbol.asyncIterator] !== 'function') {
    throw new AgentContractError(`${portName}.${method} must resolve to an AsyncIterable`, 'AGENT_PORT_STREAM_INVALID', {
      port: portName,
      method,
    });
  }
  return validatingStream(portName, method, input, value, STREAM_SCHEMAS[portName][method], `${portName}.${method} event`);
}

function validatePortError(value) {
  return parseContract(PortErrorSchema, value, 'port error');
}

module.exports = {
  AgentOperationResultSchema,
  CheckpointDisposeInputSchema,
  CheckpointDisposeResultSchema,
  CheckpointGetInputSchema,
  CheckpointPutInputSchema,
  CheckpointRecordSchema,
  CompactionAssessInputSchema,
  CompactionInputSchema,
  CompactionPressureSchema,
  CompactionProviderManifestSchema,
  CompactionResultSchema,
  ModelDiscoveryResultSchema,
  PORT_METHODS,
  PORT_INPUT_CONTRACTS,
  PORT_RESULT_CONTRACTS,
  PortAckSchema,
  PortErrorSchema,
  ProviderCancelSchema,
  ProviderQuerySchema,
  RuntimeEventsInputSchema,
  RuntimeCancelInputSchema,
  RuntimeCreateInputSchema,
  RuntimeDisposeInputSchema,
  RuntimeOperationResultSchema,
  RuntimeResumeInputSchema,
  RuntimeSendInputSchema,
  ToolCancelInputSchema,
  ToolCancelResultSchema,
  ToolDisposeInputSchema,
  ToolDisposeResultSchema,
  ToolExecuteInputSchema,
  ToolExecutionResultSchema,
  ToolListInputSchema,
  ToolListResultSchema,
  assertPortShape,
  validatePortError,
  validatePortInput,
  validatePortResult,
};
