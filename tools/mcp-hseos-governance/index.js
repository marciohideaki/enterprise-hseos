'use strict';

const path = require('node:path');
const { failBoot, loadServerTools } = require('../lib/governed-execution/contract-registry');
const { startNativeMcpServer } = require('../lib/governed-execution/native-mcp-server');
const { startLegacyMcpServer } = require('../lib/legacy-mcp-server');
const { resolveGovernedExecutionMode } = require('../mcp-project-state/lib/operational-state-db');

const DEFAULT_PORT = 3101;

function parseArgs() {
  const args = process.argv.slice(2);
  const port = parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] || DEFAULT_PORT, 10);
  const mode = args.includes('--http') || args.some((a) => a.startsWith('--port=')) ? 'http' : 'stdio';
  return { mode, port };
}

let tools;
try {
  tools = loadServerTools(path.join(__dirname, 'tools'));
} catch (error) {
  failBoot('governance', error);
}

const { mode, port } = parseArgs();
const serverOptions = {
  serverId: 'governance',
  tools,
  mode,
  port,
  invokeTool(name, args, context) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(null, args, null, context);
  },
};
let runtimeHandle;
try {
  // Modern governed mode for a fixture or an activated database; a v4 database keeps the legacy server; an inconsistent one is refused.
  runtimeHandle = resolveGovernedExecutionMode().modern
    ? startNativeMcpServer(serverOptions)
    : startLegacyMcpServer({ ...serverOptions, serverName: 'hseos-governance', health: { tools: tools.size } });
} catch (error) {
  failBoot('governance', error);
}

async function shutdown() {
  await runtimeHandle.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
