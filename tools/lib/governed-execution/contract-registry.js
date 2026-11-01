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

// The published (client-facing) JSON Schema of the input. Optional for contracts that are not served as capability tools; when
// given it must be a plain object, and it is frozen with everything inside it. The programmatic input_schema stays authoritative.
function deepFreeze(value) {
  if (value && typeof value === 'object') for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function normalizeJsonSchema(schema) {
  if (schema === undefined || schema === null) return null;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new ExecutionContractError('input_json_schema must be a JSON Schema object');
  }
  return deepFreeze(structuredClone(schema));
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
    // A schema may also state its cause: a fixed phrase naming the field and the rule, never an input value.
    const cause =
      parsed && parsed.error && /^[A-Za-z][A-Za-z0-9 ._,/-]{0,159}$/.test(parsed.error.hseos_cause || '') ? parsed.error.hseos_cause : null;
    throw new ExecutionContractError(
      `${phase} does not match schema v${schema.version}${cause ? `: ${cause}` : ''}`,
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
      input_json_schema: normalizeJsonSchema(contract.input_json_schema),
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
    if (name === 'output' && value && typeof value === 'object' && value.action !== action) {
      return { success: false, error: { hseos_code: 'ENV_LSP_OUTPUT_INVALID', issues: [{ message: `output is not a ${action} result` }] } };
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

// JSON Schemas 2020-12 published as the `inputSchema` of the capability tools. They describe what the validators above accept
// so that a client sends the right types; they never replace those validators (which stay the source of truth: byte limits,
// credential scans and path scope are not expressible here). test-capability-input-schemas.js pins both to the same verdicts.
const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const inputJsonSchema = (title, body) => ({ $schema: JSON_SCHEMA_DIALECT, title, type: 'object', ...body });
const NO_NUL = String.raw`^[^\u0000]+$`;
const text = (maxLength, extra = {}) => ({ type: 'string', minLength: 1, maxLength, pattern: NO_NUL, ...extra });
const int = (minimum, maximum, extra = {}) => ({ type: 'integer', minimum, maximum, ...extra });
const SAFE_MAX = Number.MAX_SAFE_INTEGER;
const MEMORY_IDENTIFIER = { type: 'string', pattern: '^[a-z0-9][a-z0-9._:-]{0,159}$', description: 'Lowercase identifier.' };
const NON_BLANK = String.raw`\S`;
// The validators default an omitted field with `??`, so an explicit null is accepted as "omitted"; the schema must not refuse it.
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

const lspJsonSchema = (action) => {
  const needsPosition = action !== 'diagnostics';
  const position = {
    type: 'object',
    properties: { line: int(0, SAFE_MAX), character: int(0, SAFE_MAX) },
    required: ['line', 'character'],
  };
  return inputJsonSchema(`environment.lsp.${action}`, {
    properties: {
      action: { const: action },
      language: { enum: ['typescript', 'python'] },
      file: text(1024, { description: 'Workspace-relative path; its extension must match the language (checked by the validator).' }),
      // diagnostics ignores a position, but the validator accepts one, so it stays an optional property there.
      position,
      ...(action === 'rename_preview' ? { new_name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,127}$' } } : {}),
    },
    required: ['action', 'language', 'file', ...(needsPosition ? ['position'] : []), ...(action === 'rename_preview' ? ['new_name'] : [])],
    additionalProperties: false,
  });
};

const DAP_JSON_SCHEMA = (() => {
  return inputJsonSchema('environment.dap.run', {
    properties: {
      runtime: { enum: ['node', 'python'] },
      launch: {
        type: 'object',
        description:
          'Exactly one of program or module. Module is only valid for python, and a program extension must match the runtime (checked by the validator).',
        properties: {
          program: text(1024),
          module: { type: 'string', pattern: String.raw`^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,7}$` },
          args: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 256, pattern: String.raw`^[^\u0000]*$` } },
          cwd: text(1024),
        },
        oneOf: [
          { properties: { program: {} }, required: ['program'] },
          { properties: { module: {} }, required: ['module'] },
        ],
        additionalProperties: false,
      },
      breakpoints: nullable({
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: { file: text(1024), line: int(1, 10_000_000) },
          required: ['file', 'line'],
          additionalProperties: false,
        },
      }),
      steps: nullable({
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: { op: { enum: ['continue', 'next', 'stepIn', 'stepOut'] } },
          required: ['op'],
          additionalProperties: false,
        },
      }),
      capture: nullable({
        type: 'object',
        properties: { stack: { type: 'boolean' }, variables_depth: { enum: [0, 1, 2] } },
        required: ['stack', 'variables_depth'],
        additionalProperties: false,
      }),
      timeout_ms: nullable(int(1000, 120_000)),
    },
    required: ['runtime', 'launch'],
    additionalProperties: false,
  });
})();

const BROWSER_JSON_SCHEMA = (() => {
  const selector = text(512);
  const step = (op, properties, required = []) => ({
    type: 'object',
    properties: { op: { const: op }, ...properties },
    required: ['op', ...required],
    additionalProperties: false,
  });
  return inputJsonSchema('environment.browser.run', {
    properties: {
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description:
          'The first step must be a goto (enforced by the validator, not expressible here); at most 4 screenshot and 4 dom_snapshot steps.',
        items: {
          oneOf: [
            step(
              'goto',
              { url: { type: 'string', maxLength: 2048, pattern: String.raw`^[Hh][Tt][Tt][Pp][Ss]?://[^/?#@\s\\]+(?:[/?#].*)?$` } },
              ['url'],
            ),
            step('click', { selector }, ['selector']),
            step('type', { selector, text: { type: 'string', maxLength: 4096 } }, ['selector', 'text']),
            step('press', { key: { type: 'string', pattern: '^[A-Za-z0-9+]{1,32}$' } }, ['key']),
            {
              ...step('wait_for', { selector, load_state: { enum: ['load', 'domcontentloaded', 'networkidle'] } }),
              oneOf: [
                { properties: { selector: {} }, required: ['selector'] },
                { properties: { load_state: {} }, required: ['load_state'] },
              ],
            },
            step('screenshot', {}),
            step('dom_snapshot', {}),
          ],
        },
        allOf: [
          { contains: { type: 'object', properties: { op: { const: 'screenshot' } }, required: ['op'] }, minContains: 0, maxContains: 4 },
          { contains: { type: 'object', properties: { op: { const: 'dom_snapshot' } }, required: ['op'] }, minContains: 0, maxContains: 4 },
        ],
      },
      viewport: {
        type: 'object',
        properties: { width: int(320, 1920), height: int(240, 1080) },
        required: ['width', 'height'],
        additionalProperties: false,
      },
      timeout_ms: nullable(int(1000, 60_000)),
    },
    required: ['steps'],
    additionalProperties: false,
  });
})();

const COMPUTER_START_JSON_SCHEMA = inputJsonSchema('environment.computer.start', {
  properties: {
    target: {
      type: 'object',
      properties: {
        command: { type: 'string', pattern: '^/usr/bin/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },
        args: nullable({ type: 'array', maxItems: 8, items: { type: 'string', maxLength: 256, pattern: String.raw`^[^\u0000]*$` } }),
      },
      required: ['command'],
      additionalProperties: false,
    },
    display: nullable({
      type: 'object',
      properties: { width: int(320, 800), height: int(240, 600) },
      required: ['width', 'height'],
      additionalProperties: false,
    }),
    timeout_ms: nullable(int(5000, 300_000)),
  },
  required: ['target'],
  additionalProperties: false,
});

const COMPUTER_SESSION_JSON_SCHEMA = (name) =>
  inputJsonSchema(name, {
    properties: { session_id: { type: 'string', minLength: 1 } },
    required: ['session_id'],
    additionalProperties: false,
  });

const COMPUTER_ACT_JSON_SCHEMA = (() => {
  const session_id = { type: 'string', minLength: 1 };
  // Coordinates are checked against the default display (640x400): the same one the act validator uses.
  const x = int(0, 639);
  const y = int(0, 399);
  const action = (name, properties, required = []) => ({
    type: 'object',
    properties: { session_id, action: { const: name }, ...properties },
    required: ['session_id', 'action', ...required],
    additionalProperties: false,
  });
  return inputJsonSchema('environment.computer.act', {
    description: 'One approved action per call; the host resolves the approval, it is never a field of the request.',
    properties: {
      session_id,
      action: { enum: ['move', 'click', 'double_click', 'type', 'key', 'scroll'] },
      x,
      y,
      button: int(1, 3, { default: 1 }),
      text: text(256),
      key: { type: 'string', pattern: '^[A-Za-z0-9_+]{1,48}$' },
      direction: { enum: ['up', 'down'] },
      amount: int(1, 10, { default: 3 }),
    },
    required: ['session_id', 'action'],
    oneOf: [
      action('move', { x, y }, ['x', 'y']),
      action('click', { x, y, button: int(1, 3, { default: 1 }) }, ['x', 'y']),
      action('double_click', { x, y }, ['x', 'y']),
      action('type', { text: text(256) }, ['text']),
      action('key', { key: { type: 'string', pattern: '^[A-Za-z0-9_+]{1,48}$' } }, ['key']),
      action('scroll', { direction: { enum: ['up', 'down'] }, amount: int(1, 10, { default: 3 }) }, ['direction']),
    ],
  });
})();

const MEMORY_WRITE_JSON_SCHEMA = inputJsonSchema('memory.write', {
  description:
    'One memory entry. The timestamp and the write policy are host-owned and are not part of the request; a note written here is stored as an untrusted agent note.',
  properties: {
    memory_id: MEMORY_IDENTIFIER,
    scope: {
      type: 'object',
      description: 'An object, not a JSON string.',
      properties: { project_id: MEMORY_IDENTIFIER },
      required: ['project_id'],
      additionalProperties: false,
    },
    content: { type: 'string', minLength: 1, maxLength: 8192, pattern: NON_BLANK, description: 'At most 8192 UTF-8 bytes.' },
    authority: { const: 'data' },
    origin: nullable({
      enum: ['operator', 'agent', 'tool', 'plugin', 'lsp', 'dap', 'browser', 'display', 'mcp'],
      description: 'Optional. Over MCP an entry is stored as origin agent and trust untrusted only; any other value is refused. Omit it.',
    }),
    trust: nullable({
      enum: ['trusted', 'untrusted'],
      description: 'Optional. Over MCP only untrusted is stored; only the operator origin could ever be trusted.',
    }),
    classification: { enum: ['public', 'internal'] },
    source_ref: { type: 'string', pattern: String.raw`^[^\s\u0000-\u001F\u007F]{1,1024}$`, description: 'A reference without whitespace.' },
    source_digest: nullable({
      type: 'string',
      pattern: '^[0-9a-f]{64}$',
      description: 'Lowercase SHA-256 hex of the content; defaults to it.',
    }),
    ttl_seconds: { type: 'integer', minimum: 1, maximum: 7_776_000, description: 'An integer number of seconds, not a string.' },
    supersedes: MEMORY_IDENTIFIER,
  },
  required: ['memory_id', 'scope', 'content', 'classification', 'source_ref', 'ttl_seconds'],
  additionalProperties: false,
});
const MEMORY_RETRIEVE_JSON_SCHEMA = inputJsonSchema('memory.retrieve', {
  properties: {
    project_id: MEMORY_IDENTIFIER,
    query: { type: 'string', minLength: 1, pattern: NON_BLANK },
    limit: int(1, 50),
    include_untrusted: { type: 'boolean' },
  },
  required: ['project_id', 'query'],
  additionalProperties: false,
});
const MEMORY_DELETE_JSON_SCHEMA = inputJsonSchema('memory.delete', {
  description: 'The deletion needs the explicit approval of the person; it is asked by the client and never a field here.',
  properties: {
    project_id: MEMORY_IDENTIFIER,
    memory_id: MEMORY_IDENTIFIER,
    reason: { type: 'string', minLength: 1, maxLength: 256, pattern: NON_BLANK, description: 'At most 256 UTF-8 bytes.' },
  },
  required: ['project_id', 'memory_id'],
  additionalProperties: false,
});

const environmentContract = (name, capability, input_schema, output_schema, timeout_ms, input_json_schema) =>
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
    input_json_schema,
    output_schema,
  });
const ENVIRONMENT_CONTRACTS = Object.freeze([
  ...['diagnostics', 'definition', 'references', 'hover', 'rename_preview'].map((action) =>
    environmentContract(
      `environment.lsp.${action}`,
      'environment.lsp',
      lspSchema('input', action),
      lspSchema('output', action),
      60_000,
      lspJsonSchema(action),
    ),
  ),
  environmentContract('environment.dap.run', 'environment.dap', dapSchema('input'), dapSchema('output'), 140_000, DAP_JSON_SCHEMA),
]);

// Contracts of the browser, computer-use and memory capabilities (W5-07..W5-09). They describe and validate only: no
// provider is bound here, so the host (not the model) supplies approvals, actors and the session. The schemas are the
// capabilities' own and load on first use, like the LSP and DAP ones above.
const environmentSchema = (load, phase) => ({
  version: 1,
  safeParse: (value) => load()[phase].safeParse(value),
});
const browserContract = () => {
  const { BROWSER_INPUT_SCHEMA, BROWSER_OUTPUT_SCHEMA } = require('../../../packages/agent-environment/browser-contract');
  return { input: BROWSER_INPUT_SCHEMA, output: BROWSER_OUTPUT_SCHEMA };
};
const computerContract = () => {
  const { COMPUTER_INPUT_SCHEMA, COMPUTER_OUTPUT_SCHEMA } = require('../../../packages/agent-environment/computer-contract');
  return { input: COMPUTER_INPUT_SCHEMA, output: COMPUTER_OUTPUT_SCHEMA };
};
const schemaFailure = (code, message) => ({ success: false, error: { hseos_code: code, issues: [{ message }] } });
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// The model addresses a session by id and never supplies an approval id: the host resolves and spends the approval.
const computerActSchema = {
  version: 1,
  safeParse(value) {
    const { parseAction, APPROVED_ACTIONS } = require('../../../packages/agent-environment/computer-contract');
    if (!isRecord(value)) return schemaFailure('ENV_COMPUTER_INPUT_INVALID', 'input must be an object');
    const { session_id: sessionId, ...action } = value;
    if (typeof sessionId !== 'string' || sessionId.length === 0)
      return schemaFailure('ENV_COMPUTER_INPUT_INVALID', 'session_id is required');
    // A screenshot is read-only and never goes through the approval gate, so it is not an `act` action.
    if (!APPROVED_ACTIONS.includes(action.action))
      return schemaFailure('ENV_COMPUTER_INPUT_INVALID', 'action is not an approved computer action');
    const parsed = parseAction(action);
    // The normalized action (defaults filled), the same form the approval binding digests.
    return parsed.success ? { success: true, data: { session_id: sessionId, action: parsed.data.action, ...parsed.data.args } } : parsed;
  },
};
const computerSessionSchema = {
  version: 1,
  safeParse(value) {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'session_id')) {
      return schemaFailure('ENV_COMPUTER_INPUT_INVALID', 'input must hold only a session_id');
    }
    return typeof value.session_id === 'string' && value.session_id.length > 0
      ? { success: true, data: value }
      : schemaFailure('ENV_COMPUTER_INPUT_INVALID', 'session_id is required');
  },
};

const MEMORY_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
// Memory policy checks throw; the contract turns each into a closed-form schema failure that keeps the policy's code.
const memorySchema = (check) => ({
  version: 1,
  safeParse(value) {
    try {
      return { success: true, data: check(value, require('../../../packages/agent-memory')) };
    } catch (error) {
      const code = MEMORY_CODE.test(error?.code || '') ? error.code : 'AGENT_MEMORY_INVALID';
      return schemaFailure(code, error.message);
    }
  },
});
const memoryInvalid = (memory, message, field) => {
  throw new memory.AgentMemoryError(message, 'AGENT_MEMORY_INVALID', { field });
};
const exactFields = (memory, value, allowed, label) => {
  if (!isRecord(value)) memoryInvalid(memory, `${label} must be an object`, label);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) memoryInvalid(memory, `${label} carries an unknown field`, unknown);
};
const scanCredential = (text) => require('../../cli/lib/campaign-evidence-store').containsCredential(text);

const memoryWriteInput = memorySchema((input, memory) => {
  memory.assertEntryInputFields(input);
  // An omitted origin/trust is the least-privileged pair: an agent's note, untrusted.
  const value = { ...input, origin: input.origin ?? 'agent', trust: input.trust ?? 'untrusted' };
  // `created_at` is host-owned: only the shape and the policy ceilings are checked here, with a throwaway timestamp.
  const entry = memory.normalizeEntry({ ...value, created_at: new Date(0).toISOString() });
  if (entry.source_digest !== memory.sha256Text(entry.content))
    memoryInvalid(memory, 'source_digest does not match the content', 'source_digest');
  memory.assertNoCredential(entry, scanCredential);
  return value;
});
const memoryWriteOutput = memorySchema((value, memory) => {
  exactFields(memory, value, ['memory_id', 'write_policy_ref'], 'output');
  memory.requireIdentifier(value.memory_id, 'memory_id');
  if (typeof value.write_policy_ref !== 'string' || value.write_policy_ref.length === 0) {
    memoryInvalid(memory, 'write_policy_ref is required', 'write_policy_ref');
  }
  return value;
});
const memoryRetrieveInput = memorySchema((value, memory) => {
  exactFields(memory, value, ['project_id', 'query', 'limit', 'include_untrusted'], 'input');
  memory.requireIdentifier(value.project_id, 'project_id');
  if (typeof value.query !== 'string' || value.query.trim().length === 0)
    memoryInvalid(memory, 'query must be a non-empty string', 'query');
  if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 50)) {
    memoryInvalid(memory, 'limit is out of range', 'limit');
  }
  if (value.include_untrusted !== undefined && typeof value.include_untrusted !== 'boolean') {
    memoryInvalid(memory, 'include_untrusted must be a boolean', 'include_untrusted');
  }
  return value;
});
const memoryRetrieveOutput = memorySchema((value, memory) => {
  if (!Array.isArray(value)) memoryInvalid(memory, 'output must be a list of memory sources', 'output');
  for (const item of value) {
    if (!isRecord(item) || typeof item.content !== 'string' || typeof item.source_ref !== 'string') {
      memoryInvalid(memory, 'a memory source needs content and a source_ref', 'output');
    }
    if (item.authority !== memory.AUTHORITY) {
      throw new memory.AgentMemoryError('memory can only carry data authority', 'AGENT_MEMORY_AUTHORITY_ESCALATION');
    }
    if (item.provenance?.trust !== 'untrusted') {
      throw new memory.AgentMemoryError('a retrieved memory is untrusted at the context boundary', 'AGENT_MEMORY_TRUST_INVALID');
    }
  }
  return value;
});
// The approval is bound to the exact operation and resolved by the host; it is never a field of the request.
const memoryDeleteInput = memorySchema((value, memory) => {
  exactFields(memory, value, ['project_id', 'memory_id', 'reason'], 'input');
  memory.requireIdentifier(value.project_id, 'project_id');
  memory.requireIdentifier(value.memory_id, 'memory_id');
  if (value.reason !== undefined) memory.normalizeReason(value.reason, scanCredential);
  return value;
});
const memoryDeleteOutput = memorySchema((value, memory) => {
  exactFields(memory, value, ['memory_id', 'deleted'], 'output');
  memory.requireIdentifier(value.memory_id, 'memory_id');
  if (value.deleted !== true) memoryInvalid(memory, 'a deletion receipt must confirm the deletion', 'deleted');
  return value;
});

const capabilityContract = (
  name,
  capability,
  provider,
  authority,
  reversibility,
  requires_approval,
  timeout_ms,
  input_schema,
  output_schema,
  input_json_schema,
  provider_accepts_idempotency = false,
) =>
  Object.freeze({
    name,
    capability,
    contract_version: 1,
    status: 'implemented',
    provider,
    authority,
    policy_version: 'hseos-w5-capability-v1',
    reversibility,
    cancellation_policy: reversibility === 'read_only' ? 'cooperative' : 'non_cancellable',
    failure_mode: 'fail_closed',
    timeout_ms,
    requires_approval,
    exclusive: false,
    provider_accepts_idempotency,
    input_schema,
    input_json_schema,
    output_schema,
  });
const CAPABILITY_CONTRACTS = Object.freeze([
  // The browser caps a run at 60 s; the grace covers reaping the sandbox.
  capabilityContract(
    'environment.browser.run',
    'environment.browser',
    'agent-environment',
    'environment.browser.read',
    'read_only',
    false,
    70_000,
    environmentSchema(browserContract, 'input'),
    environmentSchema(browserContract, 'output'),
    BROWSER_JSON_SCHEMA,
  ),
  // Reading the display is not an action: it needs no approval, and the service demands one before any action.
  capabilityContract(
    'environment.computer.screenshot',
    'environment.computer',
    'agent-environment',
    'environment.computer.read',
    'read_only',
    false,
    30_000,
    computerSessionSchema,
    environmentSchema(computerContract, 'output'),
    COMPUTER_SESSION_JSON_SCHEMA('environment.computer.screenshot'),
  ),
  // Computer-use drives a real display: starting a session and every non-screenshot action need a host approval.
  capabilityContract(
    'environment.computer.start',
    'environment.computer',
    'agent-environment',
    'environment.computer.mutate',
    'irreversible_mutation',
    true,
    310_000,
    environmentSchema(computerContract, 'input'),
    environmentSchema(computerContract, 'output'),
    COMPUTER_START_JSON_SCHEMA,
  ),
  capabilityContract(
    'environment.computer.act',
    'environment.computer',
    'agent-environment',
    'environment.computer.mutate',
    'irreversible_mutation',
    true,
    30_000,
    computerActSchema,
    environmentSchema(computerContract, 'output'),
    COMPUTER_ACT_JSON_SCHEMA,
  ),
  // Stop is idempotent and only ends the session: closing one that is already closed is refused without effect.
  capabilityContract(
    'environment.computer.stop',
    'environment.computer',
    'agent-environment',
    'environment.computer.mutate',
    'idempotent_mutation',
    false,
    30_000,
    computerSessionSchema,
    environmentSchema(computerContract, 'output'),
    COMPUTER_SESSION_JSON_SCHEMA('environment.computer.stop'),
    true,
  ),
  // A write is compensated by superseding or deleting the entry; the ledger keeps the earlier events. The runtime asks
  // for no approval here (the provider is idempotent by memory_id: a replay is refused as a duplicate). The gate is the
  // store's admitWrite policy instead: deny by default, with rules supplied by the host, plus the credential scan.
  capabilityContract(
    'memory.write',
    'agent-memory',
    'agent-memory',
    'agent-memory.mutate',
    'compensatable_mutation',
    false,
    30_000,
    memoryWriteInput,
    memoryWriteOutput,
    MEMORY_WRITE_JSON_SCHEMA,
    true,
  ),
  capabilityContract(
    'memory.retrieve',
    'agent-memory',
    'agent-memory',
    'agent-memory.read',
    'read_only',
    false,
    30_000,
    memoryRetrieveInput,
    memoryRetrieveOutput,
    MEMORY_RETRIEVE_JSON_SCHEMA,
  ),
  capabilityContract(
    'memory.delete',
    'agent-memory',
    'agent-memory',
    'agent-memory.mutate',
    'irreversible_mutation',
    true,
    30_000,
    memoryDeleteInput,
    memoryDeleteOutput,
    MEMORY_DELETE_JSON_SCHEMA,
  ),
]);

// Kept under the old name for callers written when these contracts were stubs; the contracts are real now.
const CAPABILITY_CONTRACT_STUBS = CAPABILITY_CONTRACTS;

/** Registers the LSP, DAP, browser, computer and memory contracts (the name predates the real contracts). */
function registerCapabilityContractStubs(registry) {
  if (!(registry instanceof ExecutionContractRegistry)) throw new ExecutionContractError('A contract registry is required');
  return [...ENVIRONMENT_CONTRACTS, ...CAPABILITY_CONTRACTS].map((contract) => registry.register(contract));
}

module.exports = {
  CAPABILITY_CONTRACTS,
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
