'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildMcpError, createHttpServer, createMessageHandler, startStdioServer } = require('./mcp-transport');
const { MCP_PROTOCOL_VERSION } = require('./mcp-protocol');
const { McpLegacyUsageStore } = require('../mcp-project-state/lib/mcp-legacy-usage-store');

const LEGACY_SUNSET = 'after-30-complete-zero-use-days-and-explicit-ADR-0022-activation';
const OBSERVATION_INTERVAL_MS = 15 * 60 * 1000;

function startLegacyMcpServer({
  serverId,
  serverName,
  tools,
  invokeTool,
  mode,
  port,
  projectDirectory = process.cwd(),
  health = {},
  wrapHttpResults = true,
  log = console.error,
}) {
  const telemetryPath = path.join(path.resolve(projectDirectory), '.hseos', 'state', 'mcp-legacy-usage.db');
  fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
  const usage = new McpLegacyUsageStore(telemetryPath);
  const observe = () => {
    try {
      usage.markObservation(serverId);
    } catch (error) {
      log(`[${serverId}:legacy-observation:warn] ${error.message}`);
    }
  };
  observe();
  const observationTimer = setInterval(observe, OBSERVATION_INTERVAL_MS);
  observationTimer.unref();

  const descriptors = [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const createHandler = (wrapToolResults) => {
    const delegate = createMessageHandler({
      serverInfo: { name: serverName, version: '1.0.0' },
      tools: descriptors,
      wrapToolResults,
      callTool: invokeTool,
    });
    return async (message) => {
      if (message && Object.hasOwn(message, 'id')) {
        const identity = message.method === 'initialize' ? message.params?.clientInfo?.name : null;
        try {
          usage.record({
            client_identity: identity || `legacy-${serverId}-client`,
            protocol_version: MCP_PROTOCOL_VERSION,
            server_id: serverId,
            sunset: LEGACY_SUNSET,
          });
        } catch (error) {
          log(`[${serverId}:legacy-telemetry:warn] ${error.message}`);
          return buildMcpError(message.id, -32_000, 'Legacy compatibility telemetry unavailable');
        }
      }
      return delegate(message);
    };
  };

  let server = null;
  let stdio = null;
  if (mode === 'http') {
    server = createHttpServer(createHandler(wrapHttpResults), {
      status: 'ok', server: serverName, protocol: MCP_PROTOCOL_VERSION, compatibility_mode: 'legacy-metered', ...health,
    });
    server.listen(port, '127.0.0.1', () => log(`[${serverId}] legacy MCP compatibility listening on http://127.0.0.1:${port}`));
  } else {
    stdio = startStdioServer(createHandler(true));
    log(`[${serverId}] legacy MCP compatibility stdio ready; tools=${tools.size}`);
  }
  let closing = false;
  return Object.freeze({
    server,
    stdio,
    usage,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(observationTimer);
      if (stdio) stdio.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      usage.close();
    },
  });
}

module.exports = { LEGACY_SUNSET, OBSERVATION_INTERVAL_MS, startLegacyMcpServer };
