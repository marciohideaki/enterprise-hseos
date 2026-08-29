'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  ToolExecutionResultSchema,
  deepFreeze,
  parseContract,
  validatePortInput,
  validatePortResult,
} = require('../agent-runtime-contracts');
const { isGovernedExecutionScheduler } = require('../governed-execution');
const { ToolRuntimeRegistry } = require('./registry');

class ToolRuntimeError extends Error {
  constructor(message, code = 'TOOL_RUNTIME_INVALID', details = {}) {
    super(message);
    this.name = 'ToolRuntimeError';
    this.code = code;
    this.details = details;
  }
}

function assertScheduler(scheduler, contracts) {
  if (!isGovernedExecutionScheduler(scheduler, contracts) || contracts.sealed !== true) {
    throw new ToolRuntimeError(
      'ToolRuntime requires a governed scheduler using the registry contract resolver',
      'TOOL_RUNTIME_GOVERNED_SCHEDULER_REQUIRED',
    );
  }
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolRuntimeError(`${label} must be an object`, 'TOOL_RUNTIME_OUTCOME_INVALID');
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ToolRuntimeError(`${label} has non-canonical fields`, 'TOOL_RUNTIME_OUTCOME_INVALID');
  }
}

function normalizeEnvelope(input, envelope) {
  requireExactKeys(envelope, ['schema_version', 'ok', 'data', 'error', 'evidence', 'warnings'], 'execution envelope');
  if (
    envelope.schema_version !== 1 ||
    typeof envelope.ok !== 'boolean' ||
    !Array.isArray(envelope.evidence) ||
    envelope.evidence.some((item) => typeof item !== 'string') ||
    new Set(envelope.evidence).size !== envelope.evidence.length ||
    !Array.isArray(envelope.warnings) ||
    envelope.warnings.some((item) => typeof item !== 'string') ||
    new Set(envelope.warnings).size !== envelope.warnings.length
  ) {
    throw new ToolRuntimeError('execution envelope is not canonical', 'TOOL_RUNTIME_OUTCOME_INVALID');
  }

  let outcome;
  if (envelope.ok) {
    requireExactKeys(envelope.data, ['operation_id', 'result', 'replayed'], 'execution success');
    if (
      envelope.error !== null ||
      typeof envelope.data.operation_id !== 'string' ||
      envelope.data.operation_id.length === 0 ||
      typeof envelope.data.replayed !== 'boolean'
    ) {
      throw new ToolRuntimeError('execution success is not canonical', 'TOOL_RUNTIME_OUTCOME_INVALID');
    }
    outcome = {
      status: 'succeeded',
      operation_id: envelope.data.operation_id,
      result: envelope.data.result,
      error: null,
      replayed: envelope.data.replayed,
    };
  } else {
    requireExactKeys(envelope.error, ['code', 'message', 'operation_id', 'retryable'], 'execution failure');
    if (
      envelope.data !== null ||
      typeof envelope.error.code !== 'string' ||
      envelope.error.code.length === 0 ||
      typeof envelope.error.message !== 'string' ||
      envelope.error.message.length === 0 ||
      typeof envelope.error.retryable !== 'boolean' ||
      !(envelope.error.operation_id === null || (typeof envelope.error.operation_id === 'string' && envelope.error.operation_id.length > 0))
    ) {
      throw new ToolRuntimeError('execution failure is not canonical', 'TOOL_RUNTIME_OUTCOME_INVALID');
    }
    const status =
      envelope.error.code === 'EXECUTION_CANCELLED'
        ? 'cancelled'
        : envelope.error.code === 'EXECUTION_OUTCOME_IN_DOUBT'
          ? 'uncertain'
          : 'failed';
    outcome = {
      status,
      operation_id: envelope.error.operation_id,
      result: null,
      error: {
        code: envelope.error.code,
        message: envelope.error.message,
        retryable: envelope.error.retryable,
      },
      replayed: false,
    };
  }
  return parseContract(
    ToolExecutionResultSchema,
    {
      schema_version: CONTRACT_SCHEMA_VERSION,
      invocation_id: input.invocation_id,
      session_id: input.session_id,
      turn_id: input.turn_id,
      tool_call_id: input.tool_call_id,
      name: input.name,
      ...outcome,
      evidence_refs: envelope.evidence,
      warnings: envelope.warnings,
    },
    'tool execution outcome',
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function operationSignature(input) {
  return JSON.stringify(
    stableValue({
      name: input.name,
      input: input.input,
      session_id: input.session_id,
      turn_id: input.turn_id,
      tool_call_id: input.tool_call_id,
      actor: input.actor,
      resource_scope: input.resource_scope,
      correlation_id: input.correlation_id,
      causation_id: input.causation_id,
      approval_context: input.approval_context,
    }),
  );
}

class ToolRuntime {
  #active;
  #operations;
  #registry;
  #scheduler;

  constructor({ registry, scheduler }) {
    if (!(registry instanceof ToolRuntimeRegistry)) {
      throw new ToolRuntimeError('ToolRuntime requires a nominal ToolRuntimeRegistry');
    }
    registry.seal();
    assertScheduler(scheduler, registry.contracts);
    this.#registry = registry;
    this.#scheduler = scheduler;
    this.#active = new Map();
    this.#operations = new Map();
  }

  list(value) {
    const input = validatePortInput('ToolRuntime', 'list', value);
    return validatePortResult(
      'ToolRuntime',
      'list',
      { schema_version: CONTRACT_SCHEMA_VERSION, session_id: input.session_id, tools: this.#registry.list() },
      input,
    );
  }

  async execute(value, { signal } = {}) {
    const input = validatePortInput('ToolRuntime', 'execute', value);
    this.#registry.resolve(input.name);
    assertScheduler(this.#scheduler, this.#registry.contracts);
    if (this.#active.has(input.invocation_id)) {
      throw new ToolRuntimeError('invocation identifier is already active', 'TOOL_RUNTIME_INVOCATION_ACTIVE', {
        invocation_id: input.invocation_id,
      });
    }
    const operationKey = `${input.name}\0${input.idempotency_key}`;
    const signature = operationSignature(input);
    let operation = this.#operations.get(operationKey);
    if (operation && operation.signature !== signature) {
      throw new ToolRuntimeError('idempotency key is active for a different operation scope', 'TOOL_RUNTIME_OPERATION_ACTIVE', {
        name: input.name,
        idempotency_key: input.idempotency_key,
      });
    }
    if (!operation) {
      const handle = this.#scheduler.enqueue({
        tool: input.name,
        input: input.input,
        actor: input.actor,
        resource_scope: input.resource_scope,
        idempotency_key: input.idempotency_key,
        correlation_id: input.correlation_id,
        causation_id: input.causation_id,
        approval_context: input.approval_context,
        ...(signal === undefined ? {} : { signal }),
      });
      if (!handle || typeof handle.cancel !== 'function' || !handle.promise || typeof handle.promise.then !== 'function') {
        throw new ToolRuntimeError('governed scheduler returned an invalid handle', 'TOOL_RUNTIME_SCHEDULER_INVALID');
      }
      operation = Object.freeze({ handle, promise: Promise.resolve(handle.promise), signature });
      this.#operations.set(operationKey, operation);
    }
    const active = Object.freeze({ handle: operation.handle, input, operation, operationKey });
    this.#active.set(input.invocation_id, active);
    try {
      const outcome = normalizeEnvelope(input, await operation.promise);
      return validatePortResult('ToolRuntime', 'execute', outcome, input);
    } finally {
      if (this.#active.get(input.invocation_id) === active) this.#active.delete(input.invocation_id);
      if (
        this.#operations.get(operationKey) === operation &&
        ![...this.#active.values()].some((candidate) => candidate.operation === operation)
      ) {
        this.#operations.delete(operationKey);
      }
    }
  }

  cancel(value) {
    const input = validatePortInput('ToolRuntime', 'cancel', value);
    const active = this.#active.get(input.invocation_id);
    const ownsInvocation =
      active &&
      active.input.session_id === input.session_id &&
      active.input.turn_id === input.turn_id &&
      active.input.tool_call_id === input.tool_call_id;
    const result = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      invocation_id: input.invocation_id,
      session_id: input.session_id,
      turn_id: input.turn_id,
      tool_call_id: input.tool_call_id,
      accepted: ownsInvocation ? active.handle.cancel(input.reason) === true : false,
    };
    return validatePortResult('ToolRuntime', 'cancel', result, input);
  }

  dispose(value) {
    const input = validatePortInput('ToolRuntime', 'dispose', value);
    const matching = [...this.#active.values()].filter((active) => active.input.session_id === input.session_id);
    let accepted = true;
    for (const active of matching) {
      if (active.handle.cancel('Agent session disposed') !== true) accepted = false;
    }
    return validatePortResult(
      'ToolRuntime',
      'dispose',
      { schema_version: CONTRACT_SCHEMA_VERSION, session_id: input.session_id, accepted },
      input,
    );
  }

  snapshot() {
    return deepFreeze({ active: this.#active.size, active_operations: this.#operations.size, scheduler: this.#scheduler.snapshot() });
  }
}

Object.freeze(ToolRuntime.prototype);

module.exports = { normalizeEnvelope, ToolRuntime, ToolRuntimeError };
