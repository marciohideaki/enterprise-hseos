'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildMcpError, createHttpServer, createMessageHandler, startStdioServer } = require('./mcp-transport');
const { MCP_PROTOCOL_VERSION } = require('./mcp-protocol');
const { McpLegacyUsageStore } = require('../mcp-project-state/lib/mcp-legacy-usage-store');

const LEGACY_SUNSET = 'after-30-complete-zero-use-days-and-explicit-ADR-0022-activation';
const OBSERVATION_INTERVAL_MS = 15 * 60 * 1000;

function resolveLegacyTelemetryPath({
  projectDirectory = process.cwd(),
  stateDatabasePath = process.env.HSEOS_STATE_DB,
  telemetryPath = process.env.HSEOS_LEGACY_TELEMETRY_DB,
} = {}) {
  if (telemetryPath !== undefined) {
    if (typeof telemetryPath !== 'string' || telemetryPath.length === 0 || !path.isAbsolute(telemetryPath)) {
      throw new TypeError('HSEOS_LEGACY_TELEMETRY_DB must be an absolute path');
    }
    return path.normalize(telemetryPath);
  }
  if (stateDatabasePath !== undefined) {
    if (typeof stateDatabasePath !== 'string' || stateDatabasePath.length === 0) {
      throw new TypeError('HSEOS_STATE_DB must be a non-empty path');
    }
    const statePath = path.resolve(projectDirectory, stateDatabasePath);
    return path.join(path.dirname(statePath), 'mcp-legacy-usage.db');
  }
  return path.join(path.resolve(projectDirectory), '.hseos', 'state', 'mcp-legacy-usage.db');
}

function assertLegacyTelemetryTarget(telemetryPath, { projectDirectory = process.cwd(), stateDatabasePath } = {}) {
  const resolvedTelemetryPath = path.resolve(telemetryPath);
  let resolvedStatePath = null;
  if (stateDatabasePath !== undefined) {
    resolvedStatePath = path.resolve(projectDirectory, stateDatabasePath);
    if (resolvedTelemetryPath === resolvedStatePath) {
      throw new Error('Legacy telemetry database must be separate from the operational state database');
    }
    if (fs.existsSync(resolvedStatePath) && fs.lstatSync(resolvedStatePath).isSymbolicLink()) {
      throw new Error('Operational state database must not be a symlink when legacy telemetry is enabled');
    }
  }
  if (fs.existsSync(resolvedTelemetryPath)) {
    const metadata = fs.lstatSync(resolvedTelemetryPath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      throw new Error('Legacy telemetry database must be a regular, non-linked file');
    }
    if (resolvedStatePath && fs.existsSync(resolvedStatePath)) {
      const stateMetadata = fs.statSync(resolvedStatePath);
      if (
        fs.realpathSync(resolvedTelemetryPath) === fs.realpathSync(resolvedStatePath) ||
        (metadata.dev === stateMetadata.dev && metadata.ino === stateMetadata.ino)
      ) {
        throw new Error('Legacy telemetry database must be separate from the operational state database');
      }
    }
  }
}

function startLegacyMcpServer({
  serverId,
  serverName,
  tools,
  invokeTool,
  mode,
  port,
  projectDirectory = process.cwd(),
  stateDatabasePath = process.env.HSEOS_STATE_DB,
  telemetryPath = process.env.HSEOS_LEGACY_TELEMETRY_DB,
  health = {},
  wrapHttpResults = true,
  log = console.error,
}) {
  const resolvedTelemetryPath = resolveLegacyTelemetryPath({ projectDirectory, stateDatabasePath, telemetryPath });
  assertLegacyTelemetryTarget(resolvedTelemetryPath, { projectDirectory, stateDatabasePath });
  fs.mkdirSync(path.dirname(resolvedTelemetryPath), { recursive: true });
  assertLegacyTelemetryTarget(resolvedTelemetryPath, { projectDirectory, stateDatabasePath });
  const usage = new McpLegacyUsageStore(resolvedTelemetryPath);
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
      status: 'ok',
      server: serverName,
      protocol: MCP_PROTOCOL_VERSION,
      compatibility_mode: 'legacy-metered',
      ...health,
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      log(`[${serverId}] legacy MCP compatibility listening on http://127.0.0.1:${address.port}`);
    });
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

module.exports = {
  LEGACY_SUNSET,
  OBSERVATION_INTERVAL_MS,
  assertLegacyTelemetryTarget,
  resolveLegacyTelemetryPath,
  startLegacyMcpServer,
};
