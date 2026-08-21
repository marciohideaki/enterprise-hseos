'use strict';

const REVERSIBILITY_CLASSES = new Set([
  'read_only',
  'idempotent_mutation',
  'compensatable_mutation',
  'irreversible_mutation',
]);
const CANCELLATION_POLICIES = new Set(['cooperative', 'non_cancellable']);
const FAILURE_MODES = new Set(['fail_closed', 'optional_warning']);

class ExecutionContractError extends Error {
  constructor(message, code = 'EXECUTION_CONTRACT_INVALID', details = {}) {
    super(message);
    this.name = 'ExecutionContractError';
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new ExecutionContractError(`${field} must be a non-empty string`);
}

function normalizeSchema(schema, field) {
  if (!schema || !Number.isInteger(schema.version) || schema.version < 1 || typeof schema.safeParse !== 'function') {
    throw new ExecutionContractError(`${field} must declare a positive version and safeParse(value)`);
  }
  return Object.freeze({ version: schema.version, safeParse: schema.safeParse.bind(schema) });
}

function parseSchema(schema, value, phase) {
  let parsed;
  try {
    parsed = schema.safeParse(value);
  } catch (error) {
    throw new ExecutionContractError(`${phase} schema evaluation failed`, 'EXECUTION_SCHEMA_EVALUATION_FAILED', {
      phase,
      cause: error.message,
    });
  }
  if (!parsed || parsed.success !== true) {
    throw new ExecutionContractError(`${phase} does not match schema v${schema.version}`, `EXECUTION_${phase.toUpperCase()}_INVALID`, {
      phase,
      schema_version: schema.version,
      issues: parsed && parsed.error && parsed.error.issues ? parsed.error.issues : [],
    });
  }
  return parsed.data;
}

class ExecutionContractRegistry {
  constructor() {
    this._contracts = new Map();
    this._sealed = false;
  }

  register(contract) {
    if (this._sealed) throw new ExecutionContractError('Tool contract registry is sealed', 'EXECUTION_CONTRACT_REGISTRY_SEALED');
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
      throw new ExecutionContractError('Tool contract must be an object');
    }
    for (const field of ['name', 'capability', 'provider', 'authority', 'policy_version']) requireText(contract[field], field);
    if (this._contracts.has(contract.name)) {
      throw new ExecutionContractError(`Tool already registered: ${contract.name}`, 'EXECUTION_TOOL_DUPLICATE');
    }
    if (!REVERSIBILITY_CLASSES.has(contract.reversibility)) {
      throw new ExecutionContractError(`Invalid reversibility class: ${contract.reversibility}`);
    }
    if (!CANCELLATION_POLICIES.has(contract.cancellation_policy)) {
      throw new ExecutionContractError(`Invalid cancellation policy: ${contract.cancellation_policy}`);
    }
    if (!FAILURE_MODES.has(contract.failure_mode)) throw new ExecutionContractError(`Invalid failure mode: ${contract.failure_mode}`);
    if (!Number.isInteger(contract.timeout_ms) || contract.timeout_ms < 1 || contract.timeout_ms > 3_600_000) {
      throw new ExecutionContractError('timeout_ms must be an integer between 1 and 3600000');
    }
    if (
      typeof contract.requires_approval !== 'boolean' ||
      typeof contract.exclusive !== 'boolean' ||
      typeof contract.provider_accepts_idempotency !== 'boolean'
    ) {
      throw new ExecutionContractError('requires_approval, exclusive, and provider_accepts_idempotency must be booleans');
    }
    const normalized = Object.freeze({
      name: contract.name,
      capability: contract.capability,
      provider: contract.provider,
      authority: contract.authority,
      policy_version: contract.policy_version,
      reversibility: contract.reversibility,
      cancellation_policy: contract.cancellation_policy,
      failure_mode: contract.failure_mode,
      timeout_ms: contract.timeout_ms,
      requires_approval: contract.requires_approval,
      exclusive: contract.exclusive,
      provider_accepts_idempotency: contract.provider_accepts_idempotency,
      sandbox: contract.sandbox || null,
      prerequisites: Object.freeze([...(contract.prerequisites || [])]),
      input_schema: normalizeSchema(contract.input_schema, 'input_schema'),
      output_schema: normalizeSchema(contract.output_schema, 'output_schema'),
    });
    this._contracts.set(contract.name, normalized);
    return normalized;
  }

  resolve(name) {
    const contract = this._contracts.get(name);
    if (!contract) throw new ExecutionContractError(`Unknown governed tool: ${name}`, 'EXECUTION_TOOL_NOT_FOUND', { tool: name });
    return contract;
  }

  validateInput(contract, input) {
    return parseSchema(contract.input_schema, input, 'input');
  }

  validateOutput(contract, output) {
    return parseSchema(contract.output_schema, output, 'output');
  }

  list() {
    return [...this._contracts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  seal() {
    this._sealed = true;
    return this;
  }

  get sealed() {
    return this._sealed;
  }
}

module.exports = {
  CANCELLATION_POLICIES,
  ExecutionContractError,
  ExecutionContractRegistry,
  FAILURE_MODES,
  REVERSIBILITY_CLASSES,
};
