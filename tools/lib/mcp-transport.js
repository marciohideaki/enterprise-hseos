'use strict';

const http = require('node:http');
const readline = require('node:readline');

function buildMcpResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function buildMcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isNotification(message) {
  return !Object.prototype.hasOwnProperty.call(message, 'id');
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
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildMcpError(null, -32_700, 'Parse error')));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handleMessage(parsed)));
    });
  });
}

function startStdioServer(handleMessage) {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify(buildMcpError(null, -32_700, 'Parse error'))}\n`);
      return;
    }

    const response = handleMessage(parsed);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });

  rl.on('close', () => process.exit(0));
}

function createMessageHandler({ serverInfo, tools, callTool, wrapToolResults = true }) {
  return (message) => {
    const { id, method, params = {} } = message;

    try {
      switch (method) {
        case 'initialize': {
          return buildMcpResponse(id, {
            protocolVersion: '2024-11-05',
            serverInfo,
            capabilities: { tools: {} },
          });
        }
        case 'notifications/initialized': {
          return isNotification(message) ? null : buildMcpResponse(id, {});
        }
        case 'tools/list': {
          return buildMcpResponse(id, { tools });
        }
        case 'tools/call': {
          const result = callTool(params.name, params.arguments || {});
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
