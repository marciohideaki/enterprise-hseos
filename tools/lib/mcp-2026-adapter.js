'use strict';

const { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');
const { TextDecoder } = require('node:util');
const { Worker } = require('node:worker_threads');
const Ajv2020 = require('ajv/dist/2020');

const { assertCanonicalEnvelope } = require('./governed-execution/canonical-envelope');
const { deterministicOperationId } = require('./governed-execution/runtime');
const { MCP_LEGACY_PROTOCOL_VERSION, MCP_MODERN_PROTOCOL_VERSION } = require('./mcp-protocol');

const JSON_RPC = Object.freeze({
  PARSE_ERROR: -32_700,
  INVALID_REQUEST: -32_600,
  METHOD_NOT_FOUND: -32_601,
  INVALID_PARAMS: -32_602,
  INTERNAL_ERROR: -32_603,
  HEADER_MISMATCH: -32_020,
  MISSING_CLIENT_CAPABILITY: -32_021,
  UNSUPPORTED_PROTOCOL_VERSION: -32_022,
  REQUEST_TOO_LARGE: -32_023,
  DEADLINE_EXCEEDED: -32_024,
});
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const HSEOS_CATALOG_REVISION_META_KEY = 'io.hseos/toolCatalogRevision';
const HSEOS_IDEMPOTENCY_META_KEY = 'io.hseos/idempotencyKey';
const LEGACY_SUNSET = '2026-11-30';
const LEGACY_SUNSET_INSTANT = Date.parse(`${LEGACY_SUNSET}T00:00:00.000Z`);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

class McpAdapterError extends Error {
  constructor(message, code = JSON_RPC.INTERNAL_ERROR, data = {}) {
    super(message);
    this.name = 'McpAdapterError';
    this.code = code;
    this.data = data;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function createMcpApprovalStateCodec({ key, ttlMs = 300_000, clock = { now: () => new Date() } }) {
  const keyBytes = Buffer.isBuffer(key) ? Buffer.from(key) : Buffer.from(key || '', 'utf8');
  if (keyBytes.length < 32) throw new McpAdapterError('MRTR state key must contain at least 32 bytes');
  if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new McpAdapterError('MRTR state ttlMs must be a positive integer');
  const deriveKey = (purpose) => createHmac('sha256', keyBytes).update(`hseos-mcp-mrtr:${purpose}:v1`).digest();
  const encryptionKey = deriveKey('encryption');
  const signingKey = deriveKey('signature');
  const signature = (encoded) => createHmac('sha256', signingKey).update(encoded).digest('base64url');
  const open = (token) => {
    if (typeof token !== 'string' || token.length === 0 || token.length > 16_384) {
      throw new McpAdapterError('MRTR requestState is invalid', JSON_RPC.INVALID_PARAMS);
    }
    const pieces = token.split('.');
    if (pieces.length !== 2) throw new McpAdapterError('MRTR requestState is invalid', JSON_RPC.INVALID_PARAMS);
    const expected = Buffer.from(signature(pieces[0]));
    const actual = Buffer.from(pieces[1]);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new McpAdapterError('MRTR requestState integrity check failed', JSON_RPC.INVALID_PARAMS);
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8'));
    } catch {
      throw new McpAdapterError('MRTR requestState payload is invalid', JSON_RPC.INVALID_PARAMS);
    }
    const expectedKeys = [
      'binding_digest',
      'expires_at_ms',
      'issued_at_ms',
      'state_ciphertext',
      'state_iv',
      'state_tag',
      'version',
    ];
    const now = new Date(clock.now()).getTime();
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join('\0') !== expectedKeys.join('\0') ||
      payload.version !== 1 ||
      !Number.isFinite(now) ||
      !Number.isInteger(payload.issued_at_ms) ||
      !Number.isInteger(payload.expires_at_ms) ||
      now >= payload.expires_at_ms
    ) {
      throw new McpAdapterError('MRTR requestState is expired', JSON_RPC.INVALID_PARAMS);
    }
    const metadata = {
      binding_digest: payload.binding_digest,
      expires_at_ms: payload.expires_at_ms,
      issued_at_ms: payload.issued_at_ms,
      version: payload.version,
    };
    let state;
    try {
      const iv = Buffer.from(payload.state_iv, 'base64url');
      const tag = Buffer.from(payload.state_tag, 'base64url');
      const ciphertext = Buffer.from(payload.state_ciphertext, 'base64url');
      if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid AEAD parameters');
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
      decipher.setAAD(Buffer.from(stableJson(metadata), 'utf8'));
      decipher.setAuthTag(tag);
      state = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    } catch {
      throw new McpAdapterError('MRTR requestState confidentiality or integrity check failed', JSON_RPC.INVALID_PARAMS);
    }
    return { ...metadata, state };
  };
  return Object.freeze({
    mint({ binding, state }) {
      const issuedAt = new Date(clock.now()).getTime();
      if (!Number.isFinite(issuedAt)) throw new McpAdapterError('MRTR state clock is invalid');
      const metadata = {
        binding_digest: createHash('sha256').update(stableJson(binding)).digest('hex'),
        expires_at_ms: issuedAt + ttlMs,
        issued_at_ms: issuedAt,
        version: 1,
      };
      const plaintext = stableJson(state);
      if (typeof plaintext !== 'string') throw new McpAdapterError('MRTR state must be JSON serializable', JSON_RPC.INVALID_PARAMS);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      cipher.setAAD(Buffer.from(stableJson(metadata), 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const payload = {
        ...metadata,
        state_ciphertext: ciphertext.toString('base64url'),
        state_iv: iv.toString('base64url'),
        state_tag: cipher.getAuthTag().toString('base64url'),
      };
      const encoded = Buffer.from(stableJson(payload)).toString('base64url');
      const token = `${encoded}.${signature(encoded)}`;
      if (token.length > 16_384) throw new McpAdapterError('MRTR state exceeds the token size limit', JSON_RPC.INVALID_PARAMS);
      return token;
    },
    open(token) {
      const payload = open(token);
      return { bindingDigest: payload.binding_digest, state: payload.state };
    },
    verify(token, { binding }) {
      const payload = open(token);
      const bindingDigest = createHash('sha256').update(stableJson(binding)).digest('hex');
      if (payload.binding_digest !== bindingDigest) {
        throw new McpAdapterError('MRTR requestState is bound to another operation', JSON_RPC.INVALID_PARAMS);
      }
      return payload.state;
    },
  });
}

function approvalStateBinding(executionRequest, operationId) {
  return {
    actor: executionRequest.actor,
    idempotency_key: executionRequest.idempotency_key,
    input: executionRequest.input,
    operation_id: operationId,
    resource_scope: executionRequest.resource_scope,
    tool: executionRequest.tool,
  };
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function jsonDepth(value) {
  let maximum = 0;
  const pending = [{ depth: 0, value }];
  while (pending.length > 0) {
    const current = pending.pop();
    maximum = Math.max(maximum, current.depth);
    if (!current.value || typeof current.value !== 'object') continue;
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (const child of children) pending.push({ depth: current.depth + 1, value: child });
  }
  return maximum;
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function modernResult(serverInfo, result) {
  return {
    resultType: 'complete',
    ...result,
    _meta: { ...result._meta, [SERVER_INFO_META_KEY]: serverInfo },
  };
}

function assertText(value, field, code = JSON_RPC.INTERNAL_ERROR) {
  if (typeof value !== 'string' || value.length === 0) throw new McpAdapterError(`${field} must be a non-empty string`, code);
}

function assertServerInfo(serverInfo) {
  if (!serverInfo || typeof serverInfo !== 'object' || Array.isArray(serverInfo)) {
    throw new McpAdapterError('serverInfo must be an object');
  }
  assertText(serverInfo.name, 'serverInfo.name');
  assertText(serverInfo.version, 'serverInfo.version');
}

function schemaHasExternalRef(value) {
  if (Array.isArray(value)) return value.some(schemaHasExternalRef);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => {
    if ((key === '$ref' || key === '$dynamicRef') && typeof child === 'string') return !child.startsWith('#');
    return schemaHasExternalRef(child);
  });
}

function createSchemaCompiler({ maxSchemaBytes, maxSchemaDepth }) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false, loadSchema: undefined });
  ajv.addKeyword({ keyword: 'x-mcp-header', schemaType: 'string' });
  return (schema, field) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new McpAdapterError(`${field} must be a JSON Schema object`);
    }
    if (byteLength(schema) > maxSchemaBytes) throw new McpAdapterError(`${field} exceeds the schema byte limit`);
    if (jsonDepth(schema) > maxSchemaDepth) throw new McpAdapterError(`${field} exceeds the schema depth limit`);
    if (schemaHasExternalRef(schema)) throw new McpAdapterError(`${field} cannot dereference external schemas`);
    try {
      return ajv.compile(schema);
    } catch (error) {
      throw new McpAdapterError(`${field} is not valid bounded JSON Schema 2020-12`, JSON_RPC.INVALID_PARAMS, {
        cause: error.message,
      });
    }
  };
}

function collectMcpHeaderBindings(schema) {
  const bindings = [];
  const names = new Set();
  const visit = (node, valuePath, reachableProperty) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (Object.hasOwn(node, 'x-mcp-header')) {
      const name = node['x-mcp-header'];
      if (!reachableProperty || typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
        throw new McpAdapterError('x-mcp-header must identify a statically reachable property with a valid HTTP token');
      }
      if (!['boolean', 'integer', 'string'].includes(node.type)) {
        throw new McpAdapterError(`x-mcp-header ${name} must annotate a string, integer, or boolean property`);
      }
      const canonicalName = name.toLowerCase();
      if (names.has(canonicalName)) throw new McpAdapterError(`duplicate x-mcp-header name: ${name}`);
      names.add(canonicalName);
      bindings.push(Object.freeze({ header: `mcp-param-${canonicalName}`, name, path: Object.freeze([...valuePath]), type: node.type }));
    }
    for (const [keyword, child] of Object.entries(node)) {
      if (keyword === 'properties' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const [property, propertySchema] of Object.entries(child)) {
          visit(propertySchema, [...valuePath, property], true);
        }
        continue;
      }
      if (keyword === 'x-mcp-header') continue;
      if (child && typeof child === 'object' && stableJson(child).includes('"x-mcp-header"')) {
        throw new McpAdapterError(`x-mcp-header inside ${keyword} cannot be mapped deterministically to an argument path`);
      }
    }
  };
  visit(schema, [], false);
  return Object.freeze(bindings);
}

function nestedValue(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return;
    current = current[part];
  }
  return current;
}

function decodeMcpHeaderValue(value) {
  if (typeof value !== 'string') throw new McpAdapterError('Mcp-Param header must contain one textual value', JSON_RPC.HEADER_MISMATCH);
  const encoded = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (!encoded) {
    const isVisibleAscii = [...value].every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === 9 || (codePoint >= 32 && codePoint <= 126);
    });
    if (value !== '' && (!isVisibleAscii || value.trim() !== value)) {
      throw new McpAdapterError('Mcp-Param header contains characters that require base64 encoding', JSON_RPC.HEADER_MISMATCH);
    }
    return value;
  }
  if (encoded[1].length % 4 !== 0) throw new McpAdapterError('Mcp-Param header has malformed base64', JSON_RPC.HEADER_MISMATCH);
  const decoded = Buffer.from(encoded[1], 'base64');
  if (decoded.toString('base64') !== encoded[1]) throw new McpAdapterError('Mcp-Param header has malformed base64', JSON_RPC.HEADER_MISMATCH);
  try {
    return UTF8_DECODER.decode(decoded);
  } catch {
    throw new McpAdapterError('Mcp-Param header has invalid UTF-8', JSON_RPC.HEADER_MISMATCH);
  }
}

function validateToolParameterHeaders(tool, argumentsValue, headers) {
  const expectedHeaders = new Set(tool.headerBindings.map((binding) => binding.header));
  for (const header of Object.keys(headers)) {
    if (header.startsWith('mcp-param-') && !expectedHeaders.has(header)) {
      throw new McpAdapterError(`Unexpected MCP parameter header: ${header}`, JSON_RPC.HEADER_MISMATCH);
    }
  }
  for (const binding of tool.headerBindings) {
    const argument = nestedValue(argumentsValue, binding.path);
    const header = headers[binding.header];
    if (argument === undefined || argument === null) {
      if (header !== undefined) throw new McpAdapterError(`Unexpected ${binding.header} for absent argument`, JSON_RPC.HEADER_MISMATCH);
      continue;
    }
    if (binding.type === 'integer' && (!Number.isSafeInteger(argument) || !Number.isSafeInteger(Number(argument)))) {
      throw new McpAdapterError(`${binding.name} integer is outside the safe range`, JSON_RPC.HEADER_MISMATCH);
    }
    if (header === undefined) {
      throw new McpAdapterError(`${binding.header} is missing or does not match the request body`, JSON_RPC.HEADER_MISMATCH);
    }
    const decodedHeader = decodeMcpHeaderValue(header);
    const matches =
      binding.type === 'integer'
        ? Number.isSafeInteger(Number(decodedHeader)) && Number(decodedHeader) === argument
        : decodedHeader === String(argument);
    if (!matches) throw new McpAdapterError(`${binding.header} does not match the request body`, JSON_RPC.HEADER_MISMATCH);
  }
}

function rebaseLocalSchemaRefs(value, prefix) {
  if (Array.isArray(value)) return value.map((item) => rebaseLocalSchemaRefs(item, prefix));
  if (!value || typeof value !== 'object') return value;
  const activePrefix = Object.hasOwn(value, '$id') ? null : prefix;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (activePrefix && (key === '$ref' || key === '$dynamicRef') && typeof child === 'string' && child.startsWith('#')) {
        return [key, `${activePrefix}${child.slice(1)}`];
      }
      return [key, rebaseLocalSchemaRefs(child, activePrefix)];
    }),
  );
}

function executionEnvelopeSchema(resultSchema = {}) {
  const thenKeyword = 'then';
  const scopedResultSchema = rebaseLocalSchemaRefs(
    stableValue(resultSchema),
    '#/properties/data/oneOf/1/properties/result',
  );
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      schema_version: { const: 1 },
      ok: { type: 'boolean' },
      data: {
        oneOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              operation_id: { type: 'string', minLength: 1 },
              result: scopedResultSchema,
              replayed: { type: 'boolean' },
            },
            required: ['operation_id', 'result', 'replayed'],
            additionalProperties: false,
          },
        ],
      },
      error: {
        oneOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              code: { type: 'string', minLength: 1 },
              message: { type: 'string', minLength: 1 },
              operation_id: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
              retryable: { type: 'boolean' },
            },
            required: ['code', 'message', 'operation_id', 'retryable'],
            additionalProperties: false,
          },
        ],
      },
      evidence: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      warnings: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    },
    required: ['schema_version', 'ok', 'data', 'error', 'evidence', 'warnings'],
    additionalProperties: false,
    allOf: [
      {
        if: { properties: { ok: { const: true } }, required: ['ok'] },
        // JSON Schema requires this keyword; this object is data, not a Promise-like value.
        // eslint-disable-next-line unicorn/no-thenable
        [thenKeyword]: { properties: { data: { type: 'object' }, error: { type: 'null' } } },
        else: { properties: { data: { type: 'null' }, error: { type: 'object' } } },
      },
    ],
  };
}

function normalizeToolCatalog(tools, limits) {
  if (!Array.isArray(tools)) throw new McpAdapterError('tools must be an array');
  const compile = createSchemaCompiler(limits);
  const names = new Set();
  const normalized = tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new McpAdapterError('tool must be an object');
    assertText(tool.name, 'tool.name');
    assertText(tool.description, 'tool.description');
    if (names.has(tool.name)) throw new McpAdapterError(`duplicate tool: ${tool.name}`);
    names.add(tool.name);
    compile(tool.inputSchema, `${tool.name}.inputSchema`);
    if (tool.outputSchema) compile(tool.outputSchema, `${tool.name}.outputSchema`);
    const publicOutputSchema = executionEnvelopeSchema(tool.outputSchema || {});
    compile(publicOutputSchema, `${tool.name}.publicOutputSchema`);
    const descriptor = deepFreeze({
      name: tool.name,
      description: tool.description,
      inputSchema: deepFreeze(stableValue(tool.inputSchema)),
      outputSchema: deepFreeze(publicOutputSchema),
    });
    return Object.freeze({
      descriptor,
      headerBindings: collectMcpHeaderBindings(descriptor.inputSchema),
      inputSchema: descriptor.inputSchema,
      outputSchema: tool.outputSchema ? deepFreeze(stableValue(tool.outputSchema)) : null,
    });
  });
  normalized.sort((left, right) => (left.descriptor.name < right.descriptor.name ? -1 : left.descriptor.name > right.descriptor.name ? 1 : 0));
  return Object.freeze(normalized);
}

function validateInWorker({ schema, value, timeoutMs, workerPath, signal }) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new McpAdapterError('Schema validation cancelled', JSON_RPC.DEADLINE_EXCEEDED));
      return;
    }
    const worker = new Worker(workerPath);
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      void worker.terminate();
      callback();
    };
    const abort = () => finish(() => reject(new McpAdapterError('Schema validation cancelled', JSON_RPC.DEADLINE_EXCEEDED)));
    const timer = setTimeout(
      () => finish(() => reject(new McpAdapterError('Schema validation exceeded deadline', JSON_RPC.DEADLINE_EXCEEDED))),
      timeoutMs,
    );
    if (signal) signal.addEventListener('abort', abort, { once: true });
    worker.once('error', (error) => finish(() => reject(new McpAdapterError(`Schema validation worker failed: ${error.message}`))));
    worker.once('message', (message) => {
      finish(() => {
        if (message.compilerError) reject(new McpAdapterError(`Schema validation worker rejected schema: ${message.compilerError}`));
        else resolve({ errors: message.errors || [], valid: message.valid === true });
      });
    });
    worker.postMessage({ schema, value });
  });
}

function validateRpcRequest(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
    throw new McpAdapterError('Invalid JSON-RPC request', JSON_RPC.INVALID_REQUEST);
  }
  if (typeof message.method !== 'string' || message.method.length === 0) {
    throw new McpAdapterError('JSON-RPC method is required', JSON_RPC.INVALID_REQUEST);
  }
  if (message.params !== undefined && (!message.params || typeof message.params !== 'object' || Array.isArray(message.params))) {
    throw new McpAdapterError('JSON-RPC params must be an object', JSON_RPC.INVALID_PARAMS);
  }
}

function validateModernEnvelope(params) {
  const meta = params && params._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new McpAdapterError('Modern request metadata is required', JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION, {
      requested: null,
      supported: [MCP_MODERN_PROTOCOL_VERSION],
    });
  }
  if (meta[PROTOCOL_VERSION_META_KEY] !== MCP_MODERN_PROTOCOL_VERSION) {
    throw new McpAdapterError('Unsupported MCP protocol version', JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION, {
      requested: meta[PROTOCOL_VERSION_META_KEY],
      supported: [MCP_MODERN_PROTOCOL_VERSION],
    });
  }
  const clientInfo = meta[CLIENT_INFO_META_KEY];
  if (clientInfo !== undefined) {
    if (!clientInfo || typeof clientInfo !== 'object' || Array.isArray(clientInfo)) {
      throw new McpAdapterError('clientInfo is malformed', JSON_RPC.INVALID_PARAMS);
    }
    assertText(clientInfo.name, 'clientInfo.name', JSON_RPC.INVALID_PARAMS);
    assertText(clientInfo.version, 'clientInfo.version', JSON_RPC.INVALID_PARAMS);
  }
  const capabilities = meta[CLIENT_CAPABILITIES_META_KEY];
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new McpAdapterError('clientCapabilities is required and must be an object', JSON_RPC.INVALID_PARAMS);
  }
  return { capabilities, clientInfo: clientInfo || null, meta };
}

function requireElicitationCapability(capabilities, operationId) {
  if (!capabilities.elicitation || typeof capabilities.elicitation !== 'object' || Array.isArray(capabilities.elicitation)) {
    throw new McpAdapterError('Client lacks the elicitation capability required for approval', JSON_RPC.MISSING_CLIENT_CAPABILITY, {
      requiredCapabilities: { elicitation: {} },
      hseos: { code: 'approval_required', operation_id: operationId },
    });
  }
}

function validateApprovalInputRequests(inputRequests, capabilities, operationId) {
  if (!inputRequests || typeof inputRequests !== 'object' || Array.isArray(inputRequests) || Object.keys(inputRequests).length === 0) {
    throw new McpAdapterError('Approval flow must return at least one input request');
  }
  requireElicitationCapability(capabilities, operationId);
  for (const request of Object.values(inputRequests)) {
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      request.method !== 'elicitation/create' ||
      !request.params ||
      request.params.mode !== 'form' ||
      typeof request.params.message !== 'string' ||
      !request.params.requestedSchema
    ) {
      throw new McpAdapterError('Approval flow returned a malformed elicitation request');
    }
  }
}

function validateHttpHeaders(headers, message) {
  const protocol = headers['mcp-protocol-version'];
  const bodyProtocol = message.params && message.params._meta && message.params._meta[PROTOCOL_VERSION_META_KEY];
  const method = headers['mcp-method'];
  const name = headers['mcp-name'];
  if (protocol === undefined || (bodyProtocol !== undefined && protocol !== bodyProtocol)) {
    throw new McpAdapterError('MCP-Protocol-Version header does not match the request body', JSON_RPC.HEADER_MISMATCH);
  }
  if (protocol !== MCP_MODERN_PROTOCOL_VERSION) {
    throw new McpAdapterError('MCP-Protocol-Version is missing or unsupported', JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION, {
      requested: protocol || null,
      supported: [MCP_MODERN_PROTOCOL_VERSION],
    });
  }
  if (method !== message.method) {
    throw new McpAdapterError('Mcp-Method header does not match the JSON-RPC method', JSON_RPC.HEADER_MISMATCH);
  }
  const expectedName = message.method === 'tools/call' ? message.params && message.params.name : undefined;
  if (expectedName !== undefined && (name === undefined || decodeMcpHeaderValue(name) !== expectedName)) {
    throw new McpAdapterError('Mcp-Name header does not match the requested tool', JSON_RPC.HEADER_MISMATCH);
  }
  if (expectedName === undefined && name !== undefined) {
    throw new McpAdapterError('Mcp-Name is not valid for this method', JSON_RPC.HEADER_MISMATCH);
  }
}

class Mcp2026Adapter {
  constructor({
    serverInfo,
    tools,
    execute,
    resolveActor,
    resolveResourceScope,
    approvalFlow = null,
    approvalStateCodec = null,
    cacheTtlMs = 30_000,
    cacheScope = 'private',
    maxBodyBytes = 1_048_576,
    maxJsonDepth = 32,
    maxSchemaBytes = 65_536,
    maxSchemaDepth = 16,
    maxValidationWorkers = 4,
    validationTimeoutMs = 1000,
    executionTimeoutMs = 30_000,
    validationWorkerPath = path.join(__dirname, 'json-schema-validation-worker.js'),
    legacyEnabled = true,
    legacyUsage = null,
    maxLegacyIdentities = 1024,
    allowedOrigins = [],
    clock = { now: () => new Date() },
  }) {
    assertServerInfo(serverInfo);
    if (typeof execute !== 'function') throw new McpAdapterError('execute port is required');
    if (typeof resolveActor !== 'function' || typeof resolveResourceScope !== 'function') {
      throw new McpAdapterError('actor and resource-scope resolvers are required');
    }
    if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0) throw new McpAdapterError('cacheTtlMs must be non-negative');
    if (!['private', 'public'].includes(cacheScope)) throw new McpAdapterError('cacheScope must be private or public');
    for (const [field, value] of Object.entries({
      maxBodyBytes,
      maxJsonDepth,
      maxSchemaBytes,
      maxSchemaDepth,
      maxValidationWorkers,
      maxLegacyIdentities,
      validationTimeoutMs,
      executionTimeoutMs,
    })) {
      if (!Number.isInteger(value) || value < 1) throw new McpAdapterError(`${field} must be a positive integer`);
    }
    if (!Array.isArray(allowedOrigins) || !allowedOrigins.every((origin) => typeof origin === 'string' && origin.length > 0)) {
      throw new McpAdapterError('allowedOrigins must be an array of non-empty strings');
    }
    this.serverInfo = deepFreeze(stableValue(serverInfo));
    this.executePort = execute;
    this.resolveActor = resolveActor;
    this.resolveResourceScope = resolveResourceScope;
    this.approvalFlow = approvalFlow;
    if (
      approvalFlow &&
      (!approvalStateCodec ||
        typeof approvalStateCodec.mint !== 'function' ||
        typeof approvalStateCodec.open !== 'function' ||
        typeof approvalStateCodec.verify !== 'function')
    ) {
      throw new McpAdapterError('approvalStateCodec with mint/open/verify is required when approvalFlow is configured');
    }
    this.approvalStateCodec = approvalStateCodec;
    this.cacheTtlMs = cacheTtlMs;
    this.cacheScope = cacheScope;
    this.maxBodyBytes = maxBodyBytes;
    this.maxJsonDepth = maxJsonDepth;
    this.validationTimeoutMs = validationTimeoutMs;
    this.executionTimeoutMs = executionTimeoutMs;
    this.validationWorkerPath = validationWorkerPath;
    this.maxValidationWorkers = maxValidationWorkers;
    this.activeValidationWorkers = 0;
    this.legacyEnabled = legacyEnabled;
    this.legacyUsage = legacyUsage;
    this.maxLegacyIdentities = maxLegacyIdentities;
    this.allowedOrigins = new Set(allowedOrigins);
    this.clock = clock;
    this.catalog = normalizeToolCatalog(tools, { maxSchemaBytes, maxSchemaDepth });
    this.toolByName = new Map(this.catalog.map((entry) => [entry.descriptor.name, entry]));
    this.catalogRevision = createHash('sha256').update(stableJson(this.catalog.map((entry) => entry.descriptor))).digest('hex');
    this.legacyCounters = new Map();
  }

  createConnectionContext(extra = {}) {
    return { era: null, legacyNegotiated: false, ...extra };
  }

  legacySnapshot() {
    return Object.fromEntries([...this.legacyCounters.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  _recordLegacy(clientInfo) {
    const identity = clientInfo && clientInfo.name ? `${clientInfo.name}@${clientInfo.version || 'unknown'}` : 'unknown';
    const counterIdentity = this.legacyCounters.has(identity) || this.legacyCounters.size < this.maxLegacyIdentities ? identity : '__overflow__';
    this.legacyCounters.set(counterIdentity, (this.legacyCounters.get(counterIdentity) || 0) + 1);
    if (typeof this.legacyUsage === 'function') {
      this.legacyUsage({ client_identity: identity, protocol_version: MCP_LEGACY_PROTOCOL_VERSION, sunset: LEGACY_SUNSET });
    }
    return `MCP ${MCP_LEGACY_PROTOCOL_VERSION} compatibility is deprecated and will be removed by ${LEGACY_SUNSET}`;
  }

  _assertLegacyAvailable() {
    const now = new Date(this.clock.now()).getTime();
    if (!this.legacyEnabled || !Number.isFinite(now) || now >= LEGACY_SUNSET_INSTANT) {
      throw new McpAdapterError('Legacy MCP compatibility is unavailable', JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION, {
        requested: MCP_LEGACY_PROTOCOL_VERSION,
        supported: [MCP_MODERN_PROTOCOL_VERSION],
      });
    }
  }

  _bounded(message) {
    if (byteLength(message) > this.maxBodyBytes) throw new McpAdapterError('Request body exceeds limit', JSON_RPC.REQUEST_TOO_LARGE);
    if (jsonDepth(message) > this.maxJsonDepth) throw new McpAdapterError('Request JSON depth exceeds limit', JSON_RPC.INVALID_REQUEST);
  }

  _modernResponse(id, result) {
    return rpcResult(id, modernResult(this.serverInfo, result));
  }

  async _validateSchema(schema, value, signal) {
    if (this.activeValidationWorkers >= this.maxValidationWorkers) {
      throw new McpAdapterError('Schema validation capacity is exhausted', JSON_RPC.DEADLINE_EXCEEDED);
    }
    this.activeValidationWorkers += 1;
    try {
      return await validateInWorker({
        schema,
        value,
        timeoutMs: this.validationTimeoutMs,
        workerPath: this.validationWorkerPath,
        signal,
      });
    } finally {
      this.activeValidationWorkers -= 1;
    }
  }

  async _executeTool(message, requestContext, era) {
    const startedAt = new Date(this.clock.now()).getTime();
    if (!Number.isFinite(startedAt)) throw new McpAdapterError('Execution deadline clock is invalid');
    const controller = new AbortController();
    let rejectBoundary;
    const boundary = new Promise((_, reject) => {
      rejectBoundary = reject;
    });
    const cancel = () => {
      controller.abort(requestContext.signal && requestContext.signal.reason);
    };
    if (requestContext.signal && requestContext.signal.aborted) cancel();
    else if (requestContext.signal) requestContext.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      controller.abort(new Error('MCP execution deadline exceeded'));
      rejectBoundary(new McpAdapterError('MCP execution deadline exceeded', JSON_RPC.DEADLINE_EXCEEDED));
    }, this.executionTimeoutMs);
    try {
      return await Promise.race([
        this._executeToolWithinDeadline(
          message,
          {
            ...requestContext,
            signal: controller.signal,
            executionDeadline: new Date(startedAt + this.executionTimeoutMs).toISOString(),
          },
          era,
        ),
        boundary,
      ]);
    } finally {
      clearTimeout(timer);
      if (requestContext.signal) requestContext.signal.removeEventListener('abort', cancel);
    }
  }

  async _executeToolWithinDeadline(message, requestContext, era) {
    const params = message.params || {};
    const tool = this.toolByName.get(params.name);
    if (!tool) throw new McpAdapterError(`Unknown tool: ${params.name}`, JSON_RPC.INVALID_PARAMS);
    if (
      params.arguments !== undefined &&
      (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments))
    ) {
      throw new McpAdapterError('Tool arguments must be an object when provided', JSON_RPC.INVALID_PARAMS);
    }
    const argumentsValue = params.arguments === undefined ? {} : params.arguments;
    if (requestContext.transport === 'http') {
      validateToolParameterHeaders(tool, argumentsValue, requestContext.headers || {});
    }
    const inputValidation = await this._validateSchema(tool.inputSchema, argumentsValue, requestContext.signal);
    if (!inputValidation.valid) {
      throw new McpAdapterError('Tool arguments do not match inputSchema', JSON_RPC.INVALID_PARAMS, {
        issues: inputValidation.errors,
      });
    }
    const actor = await this.resolveActor(requestContext);
    const resourceScope = await this.resolveResourceScope({ ...requestContext, tool: params.name, arguments: argumentsValue });
    const meta = params._meta || {};
    if (
      (params.requestState !== undefined || params.inputResponses !== undefined) &&
      (era !== 'modern' || !this.approvalFlow || typeof this.approvalFlow.resolve !== 'function')
    ) {
      throw new McpAdapterError('MRTR approval response is unsupported', JSON_RPC.INVALID_PARAMS);
    }
    const hasIdempotencyKey = Object.hasOwn(meta, HSEOS_IDEMPOTENCY_META_KEY);
    const openedState = params.requestState === undefined ? null : await this.approvalStateCodec.open(params.requestState);
    const stateIdempotencyKey = openedState ? openedState.state && openedState.state.idempotency_key : undefined;
    const idempotencyKey = hasIdempotencyKey ? meta[HSEOS_IDEMPOTENCY_META_KEY] : stateIdempotencyKey || randomUUID();
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      throw new McpAdapterError('io.hseos/idempotencyKey must be a non-empty string', JSON_RPC.INVALID_PARAMS);
    }
    if (hasIdempotencyKey && stateIdempotencyKey !== undefined && idempotencyKey !== stateIdempotencyKey) {
      throw new McpAdapterError('MRTR idempotency key does not match signed requestState', JSON_RPC.INVALID_PARAMS);
    }
    const executionRequest = {
      tool: params.name,
      input: argumentsValue,
      actor,
      resource_scope: resourceScope,
      idempotency_key: idempotencyKey,
      correlation_id: requestContext.correlationId || `mcp:${message.id}`,
      causation_id: `mcp-request:${message.id}`,
      deadline: requestContext.executionDeadline,
      signal: requestContext.signal,
    };
    if (params.requestState !== undefined || params.inputResponses !== undefined) {
      if (typeof params.requestState !== 'string' || !params.inputResponses || typeof params.inputResponses !== 'object') {
        throw new McpAdapterError('MRTR retry requires requestState and inputResponses', JSON_RPC.INVALID_PARAMS);
      }
      const operationId = deterministicOperationId(params.name, idempotencyKey);
      const verifiedWrapper = await this.approvalStateCodec.verify(params.requestState, {
        binding: approvalStateBinding(executionRequest, operationId),
      });
      if (
        !verifiedWrapper ||
        verifiedWrapper.idempotency_key !== idempotencyKey ||
        !verifiedWrapper.flow ||
        typeof verifiedWrapper.flow !== 'object'
      ) {
        throw new McpAdapterError('MRTR requestState payload is malformed', JSON_RPC.INVALID_PARAMS);
      }
      const verifiedState = verifiedWrapper.flow;
      const approvalContext = await this.approvalFlow.resolve({
        requestState: params.requestState,
        inputResponses: params.inputResponses,
        verifiedState,
        executionRequest,
        requestContext,
      });
      if (
        !approvalContext ||
        typeof approvalContext !== 'object' ||
        typeof approvalContext.policy_version !== 'string' ||
        approvalContext.policy_version.length === 0 ||
        !verifiedState ||
        approvalContext.policy_version !== verifiedState.policy_version
      ) {
        throw new McpAdapterError('Approval policy version does not match the signed MRTR state', JSON_RPC.INVALID_PARAMS);
      }
      executionRequest.approval_context = approvalContext;
    }
    const outcome = await this.executePort(executionRequest);
    assertCanonicalEnvelope(outcome);
    if (outcome.ok && tool.outputSchema) {
      const outputValidation =
        outcome.data &&
        Object.hasOwn(outcome.data, 'result') &&
        (await this._validateSchema(tool.outputSchema, outcome.data.result, requestContext.signal));
      if (!outputValidation || !outputValidation.valid) {
        throw new McpAdapterError('Execution result does not match the advertised outputSchema', JSON_RPC.INTERNAL_ERROR, {
          issues: outputValidation ? outputValidation.errors : [],
        });
      }
    }
    if (outcome.error && outcome.error.code === 'EXECUTION_APPROVAL_REQUIRED') {
      if (era === 'legacy') return this._toolResult(outcome, era);
      if (!this.approvalFlow || typeof this.approvalFlow.begin !== 'function') {
        throw new McpAdapterError('Approval flow is unavailable', JSON_RPC.MISSING_CLIENT_CAPABILITY, {
          requiredCapabilities: { elicitation: {} },
          hseos: { code: 'approval_required', operation_id: outcome.error.operation_id },
        });
      }
      requireElicitationCapability(requestContext.clientCapabilities, outcome.error.operation_id);
      const pending = await this.approvalFlow.begin({ outcome, executionRequest, requestContext });
      if (
        !pending ||
        !pending.state ||
        typeof pending.state !== 'object' ||
        typeof pending.state.policy_version !== 'string' ||
        pending.state.policy_version.length === 0
      ) {
        throw new McpAdapterError('Approval flow returned invalid MRTR state');
      }
      validateApprovalInputRequests(pending.inputRequests, requestContext.clientCapabilities, outcome.error.operation_id);
      const requestState = await this.approvalStateCodec.mint({
        binding: approvalStateBinding(executionRequest, outcome.error.operation_id),
        state: { flow: pending.state, idempotency_key: idempotencyKey },
      });
      return {
        resultType: 'input_required',
        inputRequests: pending.inputRequests,
        requestState,
        _meta: { [SERVER_INFO_META_KEY]: this.serverInfo },
      };
    }
    return this._toolResult(outcome, era);
  }

  _toolResult(outcome, era) {
    const structuredContent =
      era === 'legacy' && outcome.error && outcome.error.code === 'EXECUTION_APPROVAL_REQUIRED'
        ? {
            ...outcome,
            error: {
              ...outcome.error,
              code: 'MCP_LEGACY_APPROVAL_UNSUPPORTED',
              message: 'Approval-required execution is unavailable on the legacy MCP protocol',
            },
          }
        : outcome;
    const result = {
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent,
      isError: !structuredContent.ok,
    };
    return era === 'modern'
      ? modernResult(this.serverInfo, result)
      : {
          ...result,
          _meta: {
            deprecation: `MCP ${MCP_LEGACY_PROTOCOL_VERSION} compatibility ends ${LEGACY_SUNSET}`,
            sunset: LEGACY_SUNSET,
          },
        };
  }

  async _modern(message, requestContext) {
    const envelope = validateModernEnvelope(message.params || {});
    if (requestContext.connection) requestContext.connection.era = 'modern';
    const context = { ...requestContext, clientInfo: envelope.clientInfo, clientCapabilities: envelope.capabilities };
    switch (message.method) {
      case 'server/discover': {
        return this._modernResponse(message.id, {
          supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          ttlMs: this.cacheTtlMs,
          cacheScope: this.cacheScope,
          _meta: { [HSEOS_CATALOG_REVISION_META_KEY]: this.catalogRevision },
        });
      }
      case 'tools/list': {
        return this._modernResponse(message.id, {
          tools: this.catalog.map((entry) => entry.descriptor),
          ttlMs: this.cacheTtlMs,
          cacheScope: this.cacheScope,
          _meta: { [HSEOS_CATALOG_REVISION_META_KEY]: this.catalogRevision },
        });
      }
      case 'tools/call': {
        return rpcResult(message.id, await this._executeTool(message, context, 'modern'));
      }
      case 'initialize':
      case 'notifications/initialized': {
        throw new McpAdapterError(`Method not found in modern era: ${message.method}`, JSON_RPC.METHOD_NOT_FOUND);
      }
      default: {
        throw new McpAdapterError(`Method not found: ${message.method}`, JSON_RPC.METHOD_NOT_FOUND);
      }
    }
  }

  async _legacy(message, requestContext) {
    this._assertLegacyAvailable();
    if (message.method === 'initialize') {
      if (!message.params || typeof message.params !== 'object' || Array.isArray(message.params)) {
        throw new McpAdapterError('Legacy initialize params are required', JSON_RPC.INVALID_PARAMS);
      }
      if (message.params.protocolVersion !== MCP_LEGACY_PROTOCOL_VERSION) {
        throw new McpAdapterError('Unsupported legacy protocol version', JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
      }
      requestContext.legacyNegotiated = true;
      requestContext.era = 'legacy';
      requestContext.legacyClientInfo = message.params.clientInfo || null;
      const warning = this._recordLegacy(requestContext.legacyClientInfo);
      return rpcResult(message.id, {
        protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
        serverInfo: this.serverInfo,
        capabilities: { tools: {} },
        _meta: { deprecation: warning, sunset: LEGACY_SUNSET },
      });
    }
    if (!requestContext.legacyNegotiated && !requestContext.legacyStateless) {
      throw new McpAdapterError('Legacy request requires an initialize exchange', JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
    }
    this._recordLegacy(requestContext.legacyClientInfo);
    if (message.method === 'notifications/initialized') return message.id === undefined ? null : rpcResult(message.id, {});
    if (message.method === 'tools/list') {
      return rpcResult(message.id, {
        tools: this.catalog.map((entry) => entry.descriptor),
        _meta: { deprecation: `Legacy compatibility ends ${LEGACY_SUNSET}`, sunset: LEGACY_SUNSET },
      });
    }
    if (message.method === 'tools/call') return rpcResult(message.id, await this._executeTool(message, requestContext, 'legacy'));
    throw new McpAdapterError(`Method not found: ${message.method}`, JSON_RPC.METHOD_NOT_FOUND);
  }

  async handle(message, requestContext = {}) {
    const id = message && Object.hasOwn(message, 'id') ? message.id : null;
    try {
      this._bounded(message);
      validateRpcRequest(message);
      if (
        Object.hasOwn(message, 'id') &&
        !((typeof message.id === 'string' && message.id.length > 0) || (typeof message.id === 'number' && Number.isInteger(message.id)))
      ) {
        throw new McpAdapterError('JSON-RPC request id must be a non-empty string or integer', JSON_RPC.INVALID_REQUEST);
      }
      if (!Object.hasOwn(message, 'id') && !['notifications/cancelled', 'notifications/initialized'].includes(message.method)) {
        throw new McpAdapterError('JSON-RPC request id is required', JSON_RPC.INVALID_REQUEST);
      }
      const context =
        requestContext.transport === 'http'
          ? { ...requestContext, legacyNegotiated: true, legacyStateless: true }
          : requestContext.connection || requestContext;
      const modernMeta = message.params && message.params._meta && message.params._meta[PROTOCOL_VERSION_META_KEY];
      const headerProtocol = requestContext.headers && requestContext.headers['mcp-protocol-version'];
      const requestedEra =
        modernMeta !== undefined || (headerProtocol !== undefined && headerProtocol !== MCP_LEGACY_PROTOCOL_VERSION)
          ? 'modern'
          : 'legacy';
      if (requestContext.transport === 'stdio' && context.era && context.era !== requestedEra) {
        throw new McpAdapterError('MCP protocol era is pinned for this stdio connection', JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
      }
      if (requestedEra === 'modern') {
        if (requestContext.transport === 'http') validateHttpHeaders(requestContext.headers || {}, message);
        return await this._modern(message, { ...requestContext, connection: context });
      }
      return await this._legacy(message, context);
    } catch (error) {
      const normalized = error instanceof McpAdapterError ? error : new McpAdapterError(error.message || 'Internal error');
      return rpcError(id, normalized.code, normalized.message, Object.keys(normalized.data).length > 0 ? normalized.data : undefined);
    }
  }
}

function createMcp2026HttpServer(adapter, healthPayload = null) {
  const health = healthPayload || { status: 'ok' };
  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !adapter.allowedOrigins.has(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rpcError(null, JSON_RPC.INVALID_REQUEST, 'Origin is not allowed')));
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }
    if (req.url === '/mcp' && req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    if (req.url !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      res.writeHead(415, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rpcError(null, JSON_RPC.INVALID_REQUEST, 'Content-Type must be application/json')));
      return;
    }
    const chunks = [];
    let receivedBytes = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      if (overflow) return;
      receivedBytes += chunk.length;
      if (receivedBytes > adapter.maxBodyBytes) overflow = true;
      else chunks.push(chunk);
    });
    req.on('end', async () => {
      if (overflow) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rpcError(null, JSON_RPC.REQUEST_TOO_LARGE, 'Request body exceeds limit')));
        return;
      }
      let message;
      try {
        const body = UTF8_DECODER.decode(Buffer.concat(chunks));
        message = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rpcError(null, JSON_RPC.PARSE_ERROR, 'Parse error')));
        return;
      }
      const controller = new AbortController();
      req.on('aborted', () => controller.abort(new Error('HTTP client disconnected')));
      res.on('close', () => {
        if (!res.writableEnded) controller.abort(new Error('HTTP client disconnected'));
      });
      const response = await adapter.handle(message, {
        transport: 'http',
        headers: req.headers,
        signal: controller.signal,
        correlationId: req.headers.traceparent || `mcp-http:${message.id}`,
      });
      if (controller.signal.aborted || res.destroyed) return;
      if (response === null) {
        res.writeHead(202);
        res.end();
        return;
      }
      const status =
        response.error && response.error.code === JSON_RPC.METHOD_NOT_FOUND
          ? 404
          : response.error &&
              [JSON_RPC.HEADER_MISMATCH, JSON_RPC.MISSING_CLIENT_CAPABILITY, JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION].includes(
                response.error.code,
              )
            ? 400
            : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
}

function startMcp2026Stdio(adapter, { input = process.stdin, output = process.stdout } = {}) {
  const connection = adapter.createConnectionContext();
  const inflight = new Map();
  const rl = readline.createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    if (byteLength(line) > adapter.maxBodyBytes) {
      output.write(`${JSON.stringify(rpcError(null, JSON_RPC.REQUEST_TOO_LARGE, 'Request body exceeds limit'))}\n`);
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(rpcError(null, JSON_RPC.PARSE_ERROR, 'Parse error'))}\n`);
      return;
    }
    if (message && message.method === 'notifications/cancelled' && !Object.hasOwn(message, 'id')) {
      let requestId;
      try {
        validateRpcRequest(message);
        requestId = message.params && message.params.requestId;
        if (
          !(
            (typeof requestId === 'string' && requestId.length > 0) ||
            (typeof requestId === 'number' && Number.isInteger(requestId))
          )
        ) {
          throw new McpAdapterError('Cancellation requestId must be a non-empty string or integer', JSON_RPC.INVALID_PARAMS);
        }
        if (message.params.reason !== undefined && typeof message.params.reason !== 'string') {
          throw new McpAdapterError('Cancellation reason must be a string', JSON_RPC.INVALID_PARAMS);
        }
      } catch (error) {
        const normalized = error instanceof McpAdapterError ? error : new McpAdapterError(error.message || 'Invalid cancellation');
        output.write(`${JSON.stringify(rpcError(null, normalized.code, normalized.message))}\n`);
        return;
      }
      const controller = inflight.get(requestId);
      if (controller) controller.abort(new Error(message.params.reason || 'MCP request cancelled'));
      return;
    }
    const controller = new AbortController();
    if (Object.hasOwn(message, 'id')) inflight.set(message.id, controller);
    try {
      const response = await adapter.handle(message, { transport: 'stdio', connection, signal: controller.signal });
      if (response) output.write(`${JSON.stringify(response)}\n`);
    } finally {
      if (Object.hasOwn(message, 'id') && inflight.get(message.id) === controller) inflight.delete(message.id);
    }
  });
  return rl;
}

module.exports = {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcp2026HttpServer,
  createMcpApprovalStateCodec,
  HSEOS_CATALOG_REVISION_META_KEY,
  HSEOS_IDEMPOTENCY_META_KEY,
  JSON_RPC,
  LEGACY_SUNSET,
  Mcp2026Adapter,
  McpAdapterError,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
  startMcp2026Stdio,
};
