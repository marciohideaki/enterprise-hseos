'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildMcpError, createHttpServer, createMessageHandler, startStdioServer } = require('./mcp-transport');
const { MCP_PROTOCOL_VERSION } = require('./mcp-protocol');
const { McpLegacyUsageStore } = require('../mcp-project-state/lib/mcp-legacy-usage-store');

// ADR-0048 item 3: the 30-day zero-use criterion is replaced; the legacy compat expires only on an owner-fixed date.
const LEGACY_SUNSET = 'no-fixed-date-pending-ADR-0048-owner-decision';
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

const SCOPE_DENIED_CODE = 'MCP_SCOPE_DENIED';
const TOOL_UNKNOWN_CODE = 'MCP_TOOL_UNKNOWN';
// The legacy transport answers any thrown tool error with -32000.
const LEGACY_DENIAL_RPC_CODE = -32_000;

// Gateway in front of every legacy tool call: unknown tools never reach a handler, and refusals raised by a handler
// for an out-of-scope access are reported as denials. The legacy path has no execution ledger (activation pending
// ADR-0022/0023), so the denial goes to the injected durable recorder and to the structured server log. A recorder
// failure never releases the call: it stays denied and the failure is appended to the error the client receives.
function createLegacyGateway({ serverId, tools, invokeTool, recordDenial, log = console.error }) {
  if (!(tools instanceof Map)) throw new TypeError('Legacy gateway requires the tool map');
  if (typeof invokeTool !== 'function') throw new TypeError('Legacy gateway requires a tool invoker');
  const deny = (tool, code, message) => {
    const denial = {
      server_id: serverId,
      tool: String(tool).slice(0, 128),
      code,
      message: String(message).slice(0, 256),
      rpc_code: LEGACY_DENIAL_RPC_CODE,
    };
    log(`[${serverId}:gateway:denied] ${code} tool=${denial.tool}`);
    try {
      if (typeof recordDenial === 'function') recordDenial(denial);
    } catch (error) {
      log(`[${serverId}:gateway:warn] denial recorder failed: ${error.message}`);
      // The recorder's own text (paths, SQL errors) stays in the operator log; the client sees only a fixed suffix.
      return typeof error.code === 'string' ? `denial not recorded: ${error.code}` : 'denial not recorded';
    }
    return null;
  };
  const withRecordingFailure = (error, recordingFailure) => {
    if (recordingFailure) error.message = `${error.message} (${recordingFailure})`;
    return error;
  };
  return async (name, args, context) => {
    if (typeof name !== 'string' || !tools.has(name)) {
      const failure = deny(name, TOOL_UNKNOWN_CODE, `Unknown tool: ${name}`);
      throw withRecordingFailure(Object.assign(new Error(`Unknown tool: ${name}`), { code: TOOL_UNKNOWN_CODE }), failure);
    }
    try {
      return await invokeTool(name, args, context);
    } catch (error) {
      if (error && error.code === SCOPE_DENIED_CODE) throw withRecordingFailure(error, deny(name, SCOPE_DENIED_CODE, error.message));
      throw error;
    }
  };
}

function startLegacyMcpServer({
  serverId,
  serverName,
  tools,
  invokeTool: rawInvokeTool,
  mode,
  port,
  projectDirectory = process.cwd(),
  stateDatabasePath = process.env.HSEOS_STATE_DB,
  telemetryPath = process.env.HSEOS_LEGACY_TELEMETRY_DB,
  health = {},
  wrapHttpResults = true,
  recordDenial,
  log = console.error,
}) {
  const resolvedTelemetryPath = resolveLegacyTelemetryPath({ projectDirectory, stateDatabasePath, telemetryPath });
  assertLegacyTelemetryTarget(resolvedTelemetryPath, { projectDirectory, stateDatabasePath });
  fs.mkdirSync(path.dirname(resolvedTelemetryPath), { recursive: true });
  assertLegacyTelemetryTarget(resolvedTelemetryPath, { projectDirectory, stateDatabasePath });
  const usage = new McpLegacyUsageStore(resolvedTelemetryPath);
  // No raw invoker reaches the transport: all four servers get the gateway by construction, recording in the durable store.
  const invokeTool = createLegacyGateway({
    serverId,
    tools,
    invokeTool: rawInvokeTool,
    recordDenial: recordDenial || ((denial) => usage.recordDenial(denial)),
    log,
  });
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
  SCOPE_DENIED_CODE,
  TOOL_UNKNOWN_CODE,
  createLegacyGateway,
  LEGACY_SUNSET,
  OBSERVATION_INTERVAL_MS,
  assertLegacyTelemetryTarget,
  resolveLegacyTelemetryPath,
  startLegacyMcpServer,
};
