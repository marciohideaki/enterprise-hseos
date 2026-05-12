'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createHttpServer, createMessageHandler, startStdioServer } = require('../lib/mcp-transport');

const DEFAULT_PORT = 3102;

function parseArgs() {
  const args = process.argv.slice(2);
  const port = parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] || DEFAULT_PORT, 10);
  const mode = args.includes('--http') || args.some((a) => a.startsWith('--port=')) ? 'http' : 'stdio';
  return { mode, port };
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
      console.error(`[swarm] failed to load ${file}: ${error.message}`);
    }
  }
  return map;
}

const tools = loadTools();

const TOOL_LIST = [...tools.values()].map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

const handleMessage = createMessageHandler({
  serverInfo: { name: 'hseos-swarm', version: '1.0.0' },
  tools: TOOL_LIST,
  callTool(name, args) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(null, args);
  },
});

const { mode, port } = parseArgs();
let server = null;

if (mode === 'http') {
  server = createHttpServer(handleMessage, { status: 'ok', server: 'hseos-swarm', tools: tools.size });
  server.listen(port, '127.0.0.1', () => {
    console.error(`[swarm] MCP server listening on http://127.0.0.1:${port}`);
    console.error(`[swarm] Tools loaded: ${tools.size}`);
  });
} else {
  console.error(`[swarm] MCP stdio server ready. Tools loaded: ${tools.size}`);
  startStdioServer(handleMessage);
}

function shutdown() {
  if (server) server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
