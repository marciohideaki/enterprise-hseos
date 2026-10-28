'use strict';

const http = require('node:http');
const readline = require('node:readline');
const Ajv2020 = require('ajv/dist/2020');
const { MCP_PROTOCOL_VERSION } = require('./mcp-protocol');

function buildMcpResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function buildMcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isNotification(message) {
  return !Object.prototype.hasOwnProperty.call(message, 'id');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatSchemaErrors(errors) {
  return (errors || []).map((error) => `${error.instancePath || '(arguments)'} ${error.message}`.trim()).join('; ');
}

const MAX_HTTP_BODY_BYTES = 1_048_576;
// An oversized body is read and discarded up to this many extra bytes, then the connection is dropped.
const MAX_DRAIN_BYTES = 16_777_216;

// Compiles every declared tool inputSchema at registration, so an unresolvable $ref fails the boot, not the first call.
// Unknown tools are left to callTool.
function createArgumentValidator(tools) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const compiled = new Map();
  for (const tool of tools || []) {
    try {
      compiled.set(tool.name, ajv.compile(tool.inputSchema));
    } catch (error) {
      throw Object.assign(new Error(`Tool ${tool.name} has an invalid inputSchema: ${error.message}`), {
        code: 'MCP_TOOL_SCHEMA_INVALID',
      });
    }
  }
  return (name, args) => {
    const validate = compiled.get(name);
    if (!validate) return null;
    return validate(args) ? null : formatSchemaErrors(validate.errors);
  };
}

// Only an error the server worded itself, identified by a string `code` on this list, may show its message to the
// client; any other failure (a system error, a throwing tool) is reported generically and its cause goes to stderr.
const CLIENT_SAFE_ERROR_CODE_PREFIXES = ['AXON_', 'MANAGED_GOVERNANCE_', 'EXECUTION_ACTIVATION_'];
const CLIENT_SAFE_ERROR_CODES = new Set([
  'MCP_TOOL_UNKNOWN',
  'MCP_SCOPE_DENIED',
  'TASK_NOT_FOUND',
  'HANDOFF_NOT_FOUND',
  'RUN_NOT_FOUND',
  'PROJECT_STATE_ARGUMENT_REQUIRED',
]);

function clientMessage(error, fallback) {
  const code = error && error.code;
  const authored =
    typeof code === 'string' &&
    (CLIENT_SAFE_ERROR_CODES.has(code) || CLIENT_SAFE_ERROR_CODE_PREFIXES.some((prefix) => code.startsWith(prefix)));
  if (authored && typeof error.message === 'string') return error.message;
  process.stderr.write(`[mcp] ${fallback.toLowerCase()}: ${error && error.stack ? error.stack : String(error)}\n`);
  return null;
}

async function respondSafely(handleMessage, parsed) {
  try {
    return await handleMessage(parsed);
  } catch (error) {
    const message = clientMessage(error, 'Internal error');
    return buildMcpError(null, -32_603, message === null ? 'Internal error' : `Internal error: ${message}`);
  }
}

function createHttpServer(handleMessage, healthPayload, { maxBodyBytes = MAX_HTTP_BODY_BYTES } = {}) {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(healthPayload));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    const chunks = [];
    let received = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (rejected) {
        // Draining: the rest of an oversized body is discarded unread by the tool, up to a hard cap.
        if (received > maxBodyBytes + MAX_DRAIN_BYTES) req.destroy();
        return;
      }
      if (received > maxBodyBytes) {
        // Stop buffering at once: the body is refused without being parsed or handed to any tool. The 413 is written
        // with Connection: close and the remaining input is drained (not reset) so a client mid-upload can read it.
        rejected = true;
        chunks.length = 0;
        res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify(buildMcpError(null, -32_600, 'Request body exceeds limit')));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (rejected) return;
      const body = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildMcpError(null, -32_700, 'Parse error')));
        return;
      }

      const response = await respondSafely(handleMessage, parsed);
      if (!response) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
}

function startStdioServer(handleMessage) {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify(buildMcpError(null, -32_700, 'Parse error'))}\n`);
      return;
    }

    const response = await respondSafely(handleMessage, parsed);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });

  rl.on('close', () => process.exit(0));
}

function createMessageHandler({ serverInfo, tools, callTool, wrapToolResults = true }) {
  const validateArguments = createArgumentValidator(tools);
  return async (message) => {
    if (!isPlainObject(message) || typeof message.method !== 'string' || message.method.length === 0) {
      const id = isPlainObject(message) && ['string', 'number'].includes(typeof message.id) ? message.id : null;
      return buildMcpError(id, -32_600, 'Invalid Request');
    }
    const hasId = !isNotification(message);
    if (
      hasId &&
      !(typeof message.id === 'number' ? Number.isInteger(message.id) : typeof message.id === 'string' && message.id.length > 0)
    ) {
      return buildMcpError(null, -32_600, 'Invalid Request: id must be a non-empty string or an integer');
    }
    if (!hasId) {
      // JSON-RPC 2.0: notifications never get a response, and are never executed as requests.
      if (message.method !== 'notifications/initialized') {
        process.stderr.write(`[mcp] discarded notification: ${message.method}\n`);
      }
      return null;
    }
    const { id, method, params = {} } = message;

    try {
      switch (method) {
        case 'initialize': {
          return buildMcpResponse(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo,
            capabilities: { tools: {} },
          });
        }
        case 'notifications/initialized': {
          return buildMcpResponse(id, {});
        }
        case 'tools/list': {
          return buildMcpResponse(id, { tools });
        }
        case 'tools/call': {
          // Await so async tool handlers serialize their resolved value instead
          // of a pending Promise (awaiting a sync value is a no-op).
          if (!isPlainObject(params) || typeof params.name !== 'string') {
            return buildMcpError(id, -32_602, 'Invalid params: tools/call requires a string "name"');
          }
          const args = params.arguments === undefined ? {} : params.arguments;
          const argumentErrors = validateArguments(params.name, args);
          if (argumentErrors !== null) {
            return buildMcpError(id, -32_602, `Invalid params: ${argumentErrors}`);
          }
          const result = await callTool(params.name, args);
          if (!wrapToolResults) return buildMcpResponse(id, result);
          return buildMcpResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          });
        }
        default: {
          return buildMcpError(id, -32_601, `Method not found: ${method}`);
        }
      }
    } catch (error) {
      const message = clientMessage(error, 'Tool failed');
      return buildMcpError(id, -32_000, message === null ? 'Tool failed' : message);
    }
  };
}

module.exports = {
  MAX_HTTP_BODY_BYTES,
  buildMcpError,
  buildMcpResponse,
  createHttpServer,
  createMessageHandler,
  startStdioServer,
};
