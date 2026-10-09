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

// Lazily compiles each declared tool inputSchema once; unknown tools are left to callTool.
function createArgumentValidator(tools) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const schemas = new Map((tools || []).map((tool) => [tool.name, tool.inputSchema]));
  const compiled = new Map();
  return (name, args) => {
    const schema = schemas.get(name);
    if (!schema) return null;
    if (!compiled.has(name)) compiled.set(name, ajv.compile(schema));
    const validate = compiled.get(name);
    return validate(args) ? null : formatSchemaErrors(validate.errors);
  };
}

async function respondSafely(handleMessage, parsed) {
  try {
    return await handleMessage(parsed);
  } catch (error) {
    return buildMcpError(null, -32_603, `Internal error: ${error.message}`);
  }
}

function createHttpServer(handleMessage, healthPayload) {
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

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
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
      return buildMcpError(id, -32_000, error.message);
    }
  };
}

module.exports = {
  buildMcpError,
  buildMcpResponse,
  createHttpServer,
  createMessageHandler,
  startStdioServer,
};
