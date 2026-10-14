'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REVERSIBILITY_CLASSES = new Set(['read_only', 'idempotent_mutation', 'compensatable_mutation', 'irreversible_mutation']);
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
    // A schema may classify its own rejection with a specific, closed-form code; the default stays EXECUTION_<PHASE>_INVALID.
    const specific =
      parsed && parsed.error && /^[A-Z][A-Z0-9_]{2,63}$/.test(parsed.error.hseos_code || '') ? parsed.error.hseos_code : null;
    throw new ExecutionContractError(
      `${phase} does not match schema v${schema.version}`,
      specific || `EXECUTION_${phase.toUpperCase()}_INVALID`,
      {
        phase,
        schema_version: schema.version,
        issues: parsed && parsed.error && parsed.error.issues ? parsed.error.issues : [],
      },
    );
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

// Exit code of an MCP server that refuses to boot because its tool catalog is malformed (sysexits EX_CONFIG).
const TOOL_CATALOG_EXIT_CODE = 78;
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

class ToolCatalogError extends Error {
  constructor(message, details = {}, code = 'MCP_TOOL_CATALOG_INVALID') {
    super(message);
    this.name = 'ToolCatalogError';
    this.code = code;
    this.details = details;
  }
}

function assertToolDefinition(tool, source) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
    throw new ToolCatalogError(`Tool in ${source} must be an object`, { source });
  }
  if (typeof tool.name !== 'string' || !TOOL_NAME_PATTERN.test(tool.name)) {
    throw new ToolCatalogError(`Tool in ${source} requires a valid name`, { source });
  }
  if (typeof tool.description !== 'string' || tool.description.length === 0) {
    throw new ToolCatalogError(`Tool ${tool.name} in ${source} requires a description`, { source, tool: tool.name });
  }
  if (typeof tool.handler !== 'function') {
    throw new ToolCatalogError(`Tool ${tool.name} in ${source} requires a handler function`, { source, tool: tool.name });
  }
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
    throw new ToolCatalogError(`Tool ${tool.name} in ${source} requires an inputSchema object`, { source, tool: tool.name });
  }
}

// Fail-closed: any unreadable, non-array, malformed or duplicated tool aborts the whole catalog instead of being skipped.
function loadServerTools(toolsDirectory) {
  const tools = new Map();
  if (!fs.existsSync(toolsDirectory)) throw new ToolCatalogError('Tool directory is missing', { directory: toolsDirectory });
  for (const file of fs
    .readdirSync(toolsDirectory)
    .filter((entry) => entry.endsWith('.js'))
    .sort()) {
    let exported;
    try {
      exported = require(path.resolve(toolsDirectory, file));
    } catch (error) {
      throw new ToolCatalogError(`Failed to load tool module ${file}: ${error.message}`, { source: file });
    }
    if (!Array.isArray(exported)) throw new ToolCatalogError(`Tool module ${file} must export an array`, { source: file });
    for (const tool of exported) {
      assertToolDefinition(tool, file);
      if (tools.has(tool.name)) throw new ToolCatalogError(`Duplicate tool ${tool.name} in ${file}`, { source: file, tool: tool.name });
      tools.set(tool.name, tool);
    }
  }
  if (tools.size === 0) throw new ToolCatalogError('Tool catalog is empty', { directory: toolsDirectory }, 'MCP_TOOL_CATALOG_EMPTY');
  return tools;
}

// Boot helper shared by the stdio/HTTP servers: report the cause on stderr and exit with a stable code.
function failBoot(serverId, error, { exit = process.exit, stderr = process.stderr } = {}) {
  const code = error && error.code ? error.code : 'MCP_BOOT_FAILED';
  stderr.write(`[${serverId}] fatal: ${code}: ${error && error.message ? error.message : error}\n`);
  exit(TOOL_CATALOG_EXIT_CODE);
}

const NOT_IMPLEMENTED_SCHEMA = Object.freeze({
  version: 1,
  safeParse() {
    return {
      success: false,
      error: {
        hseos_code: 'ENV_CAPABILITY_NOT_IMPLEMENTED',
        issues: [{ message: 'capability contract is a stub without implementation' }],
      },
    };
  },
});

// Versioned contract stubs for the W5 capabilities (design 5). No provider exists: every call fails closed until the
// owning task (W5-07..W5-09) replaces the stub with the real schema. Names follow environment.<capability>.<action>.
const CAPABILITY_CONTRACT_STUBS = Object.freeze(
  [
    ['environment.browser.run', 'read_only', false],
    ['environment.computer.start', 'irreversible_mutation', true],
    ['environment.computer.act', 'irreversible_mutation', true],
    ['environment.computer.stop', 'idempotent_mutation', false],
    ['memory.write', 'idempotent_mutation', false],
    ['memory.retrieve', 'read_only', false],
    ['memory.delete', 'irreversible_mutation', true],
  ].map(([name, reversibility, requiresApproval]) => {
    const capability = name.startsWith('memory.') ? 'agent-memory' : name.split('.').slice(0, 2).join('.');
    return Object.freeze({
      name,
      capability,
      contract_version: 1,
      status: 'stub',
      provider: `unimplemented:${capability}`,
      authority: `${capability}.${reversibility === 'read_only' ? 'read' : 'mutate'}`,
      policy_version: 'hseos-w5-contract-stub-v1',
      reversibility,
      cancellation_policy: reversibility === 'read_only' ? 'cooperative' : 'non_cancellable',
      failure_mode: 'fail_closed',
      timeout_ms: 30_000,
      requires_approval: requiresApproval,
      exclusive: false,
      provider_accepts_idempotency: false,
      input_schema: NOT_IMPLEMENTED_SCHEMA,
      output_schema: NOT_IMPLEMENTED_SCHEMA,
    });
  }),
);

// Real contracts of the shipped environment providers (LSP, W5-05; DAP, W5-06). The schemas are the providers' own, loaded
// on first use so requiring the registry never pulls the environment package (the LSP pack does not carry dap.js).
const lspSchema = (name, action) => ({
  version: 1,
  safeParse(value) {
    const { LSP_INPUT_SCHEMA, LSP_OUTPUT_SCHEMA } = require('../../../packages/agent-environment/lsp');
    const schema = name === 'input' ? LSP_INPUT_SCHEMA : LSP_OUTPUT_SCHEMA;
    if (name === 'input' && value && typeof value === 'object' && value.action !== action) {
      return { success: false, error: { hseos_code: 'ENV_LSP_INPUT_INVALID', issues: [{ message: `action must be ${action}` }] } };
    }
    return schema.safeParse(value);
  },
});
const dapSchema = (name) => ({
  version: 1,
  safeParse(value) {
    const { DAP_INPUT_SCHEMA, DAP_OUTPUT_SCHEMA } = require('../../../packages/agent-environment/dap');
    return (name === 'input' ? DAP_INPUT_SCHEMA : DAP_OUTPUT_SCHEMA).safeParse(value);
  },
});
const environmentContract = (name, capability, input_schema, output_schema, timeout_ms) =>
  Object.freeze({
    name,
    capability,
    contract_version: 1,
    status: 'implemented',
    provider: 'agent-environment',
    authority: `${capability}.read`,
    policy_version: 'hseos-w5-environment-v1',
    reversibility: 'read_only',
    cancellation_policy: 'cooperative',
    failure_mode: 'fail_closed',
    timeout_ms,
    requires_approval: false,
    exclusive: false,
    provider_accepts_idempotency: false,
    input_schema,
    output_schema,
  });
const ENVIRONMENT_CONTRACTS = Object.freeze([
  ...['diagnostics', 'definition', 'references', 'hover', 'rename_preview'].map((action) =>
    environmentContract(`environment.lsp.${action}`, 'environment.lsp', lspSchema('input', action), lspSchema('output', action), 60_000),
  ),
  environmentContract('environment.dap.run', 'environment.dap', dapSchema('input'), dapSchema('output'), 140_000),
]);

function registerCapabilityContractStubs(registry) {
  if (!(registry instanceof ExecutionContractRegistry)) throw new ExecutionContractError('A contract registry is required');
  return [...ENVIRONMENT_CONTRACTS, ...CAPABILITY_CONTRACT_STUBS].map((contract) => registry.register(contract));
}

module.exports = {
  CAPABILITY_CONTRACT_STUBS,
  ENVIRONMENT_CONTRACTS,
  TOOL_CATALOG_EXIT_CODE,
  ToolCatalogError,
  failBoot,
  loadServerTools,
  registerCapabilityContractStubs,
  CANCELLATION_POLICIES,
  ExecutionContractError,
  ExecutionContractRegistry,
  FAILURE_MODES,
  REVERSIBILITY_CLASSES,
};
