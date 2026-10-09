'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { resolve: resolveAxon } = require('./lib/binary-resolver');
const { startNativeMcpServer } = require('../lib/governed-execution/native-mcp-server');
const { startLegacyMcpServer } = require('../lib/legacy-mcp-server');

const DEFAULT_PORT = 3103;
const MIN_CREDENTIAL_LENGTH = 32;

// Same convention as the other HSEOS MCP servers: stdio by default, HTTP only on request.
function parseArgs() {
  const args = process.argv.slice(2);
  const mode = args.includes('--http') || args.some((a) => a.startsWith('--port=')) ? 'http' : 'stdio';
  const port = parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] || DEFAULT_PORT, 10);
  return { mode, port };
}

function equalSecrets(a, b) {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

// Loopback bind is not an access control: any local process (or a browser via DNS rebinding) can reach it.
function protectHttpServer(server, credential) {
  const listeners = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    const deny = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    if (req.headers.origin || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host || '')) {
      deny(403, 'forbidden origin or host');
      return;
    }
    const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!match || !equalSecrets(match[1], credential)) {
      deny(401, 'missing or invalid bearer credential');
      return;
    }
    for (const listener of listeners) listener.call(server, req, res);
  });
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
      console.error(`[axon-bridge] failed to load ${file}: ${error.message}`);
    }
  }
  return map;
}

const tools = loadTools();
const axonBin = resolveAxon();

const { mode, port } = parseArgs();
const credential = process.env.HSEOS_AXON_BRIDGE_CREDENTIAL || '';
if (mode === 'http' && credential.length < MIN_CREDENTIAL_LENGTH) {
  console.error(
    `[axon-bridge] HTTP mode requires HSEOS_AXON_BRIDGE_CREDENTIAL with at least ${MIN_CREDENTIAL_LENGTH} characters (or run without --http/--port for stdio)`,
  );
  process.exit(1);
}
const fixtureActivation = process.env.NODE_ENV === 'test' && process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE === '1';
const serverOptions = {
  serverId: 'axon_bridge',
  tools,
  mode,
  port,
  // stdout is the protocol channel in stdio mode; diagnostics go to stderr.
  log: console.error,
  async invokeTool(name, args, context) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(null, args, null, context);
  },
};
const runtimeHandle = fixtureActivation
  ? startNativeMcpServer(serverOptions)
  : startLegacyMcpServer({
      ...serverOptions,
      serverName: 'axon-bridge',
      health: { axon_binary: axonBin || null, axon_available: Boolean(axonBin), tools: tools.size },
    });
if (mode === 'http') protectHttpServer(runtimeHandle.server, credential);
console.error(`[axon-bridge] Axon binary: ${axonBin || '(unavailable: tools return AXON_UNAVAILABLE)'}`);

async function shutdown() {
  await runtimeHandle.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
