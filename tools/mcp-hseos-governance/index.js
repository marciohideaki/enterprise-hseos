'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { startNativeMcpServer } = require('../lib/governed-execution/native-mcp-server');
const { startLegacyMcpServer } = require('../lib/legacy-mcp-server');

const DEFAULT_PORT = 3101;

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
      console.error(`[governance] failed to load ${file}: ${error.message}`);
    }
  }
  return map;
}

const tools = loadTools();

const { mode, port } = parseArgs();
const fixtureActivation = process.env.NODE_ENV === 'test' && process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE === '1';
const serverOptions = {
  serverId: 'governance', tools, mode, port,
  invokeTool(name, args, context) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(null, args, null, context);
  },
};
const runtimeHandle = fixtureActivation
  ? startNativeMcpServer(serverOptions)
  : startLegacyMcpServer({ ...serverOptions, serverName: 'hseos-governance', health: { tools: tools.size } });

async function shutdown() {
  await runtimeHandle.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
