'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_PORT = 3101;

function parseArgs() {
  const args = process.argv.slice(2);
  const port = parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] || DEFAULT_PORT, 10);
  return { port };
}

function loadTools() {
  const toolsDir = path.join(__dirname, 'tools');
  const map = new Map();
  if (!fs.existsSync(toolsDir)) return map;
  for (const file of fs.readdirSync(toolsDir).filter((f) => f.endsWith('.js'))) {
    try {
      const exported = require(path.join(toolsDir, file));
      if (!Array.isArray(exported)) continue;
      for (const tool of exported) {
        if (tool?.name && typeof tool.handler === 'function') map.set(tool.name, tool);
      }
    } catch (error) {
      console.error(`[governance] failed to load ${file}: ${error.message}`);
    }
  }
  return map;
}

function buildMcpResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function buildMcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

const tools = loadTools();

const TOOL_LIST = [...tools.values()].map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'hseos-governance', tools: tools.size }));
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

      const { id, method, params } = parsed;
      res.writeHead(200, { 'Content-Type': 'application/json' });

      try {
        switch (method) {
          case 'initialize': {
            res.end(JSON.stringify(buildMcpResponse(id, {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'hseos-governance', version: '1.0.0' },
              capabilities: { tools: {} },
            })));
            break;
          }
          case 'tools/list': {
            res.end(JSON.stringify(buildMcpResponse(id, { tools: TOOL_LIST })));
            break;
          }
          case 'tools/call': {
            const tool = tools.get(params.name);
            if (!tool) throw new Error(`Unknown tool: ${params.name}`);
            const result = tool.handler(null, params.arguments || {});
            res.end(JSON.stringify(buildMcpResponse(id, {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            })));
            break;
          }
          default: {
            res.end(JSON.stringify(buildMcpError(id, -32_601, `Method not found: ${method}`)));
          }
        }
      } catch (error) {
        res.end(JSON.stringify(buildMcpError(id, -32_000, error.message)));
      }
    });
  });
}

const { port } = parseArgs();
const server = createServer();

server.listen(port, '127.0.0.1', () => {
  console.log(`[governance] MCP server listening on http://127.0.0.1:${port}`);
  console.log(`[governance] Tools loaded: ${tools.size}`);
});

function shutdown() {
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
