'use strict';

const path = require('node:path');
const { failBoot, loadServerTools } = require('../lib/governed-execution/contract-registry');
const { startNativeMcpServer } = require('../lib/governed-execution/native-mcp-server');
const { startLegacyMcpServer } = require('../lib/legacy-mcp-server');

const DEFAULT_PORT = 3102;

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
  failBoot('swarm', error);
}

const { mode, port } = parseArgs();
const fixtureActivation = process.env.NODE_ENV === 'test' && process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE === '1';
const serverOptions = {
  serverId: 'swarm',
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
  runtimeHandle = fixtureActivation
    ? startNativeMcpServer(serverOptions)
    : startLegacyMcpServer({ ...serverOptions, serverName: 'hseos-swarm', health: { tools: tools.size } });
} catch (error) {
  failBoot('swarm', error);
}

async function shutdown() {
  await runtimeHandle.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
