'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');

const { createMcp2026HttpServer, createMcpApprovalStateCodec, startMcp2026Stdio } = require('../mcp-2026-adapter');
const { DEFAULT_STATE_DB, openOperationalStateDatabase } = require('../../mcp-project-state/lib/operational-state-db');
const { McpLegacyUsageStore } = require('../../mcp-project-state/lib/mcp-legacy-usage-store');
const { createNativeMcpAdapter, NATIVE_MCP_SERVERS } = require('./native-mcp-adapters');
const { buildGatewayDenialFact } = require('./event-registry');
const { createOperationalExecution } = require('./operational-runtime');
const { deterministicOperationId } = require('./runtime');

function localProcessActor() {
  const user = os.userInfo();
  const principal = typeof process.getuid === 'function' ? `uid:${process.getuid()}` : `user:${user.username}`;
  return {
    id: `local:${principal}`,
    type: 'local_process',
  };
}

// Records a gateway denial as a ledger fact. A recorder failure is logged and never relaxes the denial itself.
function createDenialRecorder({ ledger, serverId, actor, log, clock = () => new Date() }) {
  return (denial) => {
    try {
      ledger.append(
        buildGatewayDenialFact({
          serverId,
          tool: denial.tool,
          code: denial.code,
          rpcCode: denial.rpc_code,
          actor,
          eventId: randomUUID(),
          occurredAt: clock().toISOString(),
        }),
      );
    } catch (error) {
      log(`[${serverId}:gateway:warn] denial not recorded in the ledger: ${error.message}`);
    }
  };
}

function createLocalApprovalFlow({ execution, serverId }) {
  // The grant is bound to the policy version of the contract being approved (the MCP tools and the capability contracts differ).
  const policyVersionOf = (tool) => execution.contracts.resolve(tool).policy_version;
  return {
    async begin({ outcome, executionRequest }) {
      const operationId = outcome.error.operation_id;
      // What the human is shown: for a capability tool the action itself (and, for the computer, its screenshot digest).
      const detail = execution.capabilityApprovals?.describe(executionRequest, operationId) ?? null;
      return {
        state: { operation_id: operationId, policy_version: policyVersionOf(executionRequest.tool) },
        inputRequests: {
          confirm: {
            method: 'elicitation/create',
            params: {
              mode: 'form',
              message: detail ?? `Approve governed execution ${operationId}?`,
              requestedSchema: {
                type: 'object',
                properties: { approved: { type: 'boolean' } },
                required: ['approved'],
                additionalProperties: false,
              },
            },
          },
        },
      };
    },
    async resolve({ inputResponses, verifiedState, executionRequest }) {
      const confirmation = inputResponses?.confirm;
      if (confirmation?.action !== 'accept' || confirmation.content?.approved !== true) {
        const error = new Error('Governed execution was not explicitly approved');
        error.code = 'EXECUTION_APPROVAL_DENIED';
        throw error;
      }
      const operationId = deterministicOperationId(executionRequest.tool, executionRequest.idempotency_key);
      if (operationId !== verifiedState.operation_id) throw new Error('Approval operation binding mismatch');
      const policyVersion = policyVersionOf(executionRequest.tool);
      if (verifiedState.policy_version !== policyVersion) throw new Error('Approval policy version binding mismatch');
      const authorizer = localProcessActor();
      // The service-level gate (computer actions) opens only now, for this exact input, in the approver's name.
      execution.capabilityApprovals?.grant(executionRequest, operationId, authorizer.id);
      const now = new Date();
      const approvalId = randomUUID();
      execution.approvalStore.issue({
        approval_id: approvalId,
        operation_id: operationId,
        authorizer,
        resource_scope: executionRequest.resource_scope,
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 300_000).toISOString(),
        decision: 'approved',
        policy_version: policyVersion,
        evidence_ref: `hseos://mcp/${serverId}/elicitation/${approvalId}`,
      });
      return { approval_id: approvalId, policy_version: policyVersion };
    },
  };
}

function startNativeMcpServer({
  serverId,
  tools,
  invokeTool,
  mode,
  port,
  dbPath,
  health = {},
  environmentHost = null,
  log = console.error,
}) {
  const serverSpec = NATIVE_MCP_SERVERS[serverId];
  if (!serverSpec) throw new TypeError(`Unknown native MCP server: ${serverId}`);
  const fixtureActivation = process.env.NODE_ENV === 'test' && process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE === '1';
  if (!fixtureActivation) {
    const error = new Error('Governed MCP activation is pending ADR-0022/0023 compatibility evidence');
    error.code = 'EXECUTION_ACTIVATION_PENDING';
    throw error;
  }
  const resolvedDbPath = path.resolve(dbPath || process.env.HSEOS_STATE_DB || DEFAULT_STATE_DB);
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolvedDbPath.startsWith(temporaryRoot)) throw new Error('Governed MCP fixture activation requires a temporary database');
  if (fs.existsSync(resolvedDbPath)) throw new Error('Governed MCP fixture activation requires a fresh database');
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  const realParent = `${fs.realpathSync(path.dirname(resolvedDbPath))}${path.sep}`;
  if (!realParent.startsWith(temporaryRoot)) throw new Error('Governed MCP fixture database resolved outside the temporary root');
  const db = openOperationalStateDatabase(resolvedDbPath, {
    activatePendingFixture: true,
    log: (level, message) => log(`[${serverId}:migration:${level}] ${message}`),
  });
  const legacyUsageStore = new McpLegacyUsageStore(path.join(path.dirname(resolvedDbPath), 'mcp-legacy-usage.db'));
  legacyUsageStore.markObservation(serverId);
  const legacyObservationTimer = setInterval(
    () => {
      try {
        legacyUsageStore.markObservation(serverId);
      } catch (error) {
        log(`[${serverId}:legacy-observation:warn] ${error.message}`);
      }
    },
    60 * 60 * 1000,
  );
  legacyObservationTimer.unref();
  let recordDenial = () => {};
  // A handler refusal for an out-of-scope access is a denial too; it is recorded before the failure envelope is built.
  const gatedInvokeTool = async (name, args, context) => {
    try {
      return await invokeTool(name, args, context);
    } catch (error) {
      if (error && error.code === 'MCP_SCOPE_DENIED') {
        recordDenial({ tool: name, code: 'MCP_SCOPE_DENIED', rpc_code: -32_000 });
      }
      throw error;
    }
  };
  const execution = createOperationalExecution({ db, serverId, tools, invokeTool: gatedInvokeTool, environmentHost });
  recordDenial = createDenialRecorder({
    ledger: execution.ledger,
    serverId,
    actor: localProcessActor(),
    log,
  });
  const approvalStateCodec = createMcpApprovalStateCodec({ key: randomBytes(32) });
  const approvalFlow = createLocalApprovalFlow({ execution, serverId });
  const adapter = createNativeMcpAdapter({
    serverId,
    scheduler: execution.scheduler,
    extraTools: execution.capabilityTools,
    resolver: {
      resolveActor: async () => localProcessActor(),
      resolveResourceScope: async () => ({ project: path.resolve(process.cwd()), server: serverId, state_db: resolvedDbPath }),
    },
    adapterOptions: {
      approvalFlow,
      approvalStateCodec,
      onDenied: (denial) => recordDenial(denial),
      legacyUsage(event) {
        try {
          legacyUsageStore.record({ ...event, server_id: serverId });
        } catch (error) {
          log(`[${serverId}:legacy-telemetry:warn] ${error.message}`);
        }
      },
    },
  });
  let server = null;
  let stdio = null;
  let closing = false;
  if (mode === 'http') {
    server = createMcp2026HttpServer(adapter, {
      status: 'ok',
      server: serverSpec.name,
      protocol: 'governed',
      schema_version: db.pragma('user_version', { simple: true }),
      tools: tools.size,
      ...health,
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      log(`[${serverId}] governed MCP listening on http://127.0.0.1:${address.port}/mcp`);
    });
  } else {
    stdio = startMcp2026Stdio(adapter);
    log(`[${serverId}] governed MCP stdio ready; tools=${tools.size}`);
  }
  const handle = Object.freeze({
    adapter,
    db,
    execution,
    server,
    stdio,
    async close() {
      if (closing) return;
      closing = true;
      await execution.scheduler.close({ cancelQueued: true, cancelRunning: true });
      if (stdio) stdio.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      clearInterval(legacyObservationTimer);
      legacyUsageStore.close();
      if (db.open) db.close();
    },
  });
  if (stdio) {
    stdio.once('close', () => {
      if (!closing) void handle.close().then(() => process.exit(0));
    });
  }
  return handle;
}

module.exports = { createDenialRecorder, createLocalApprovalFlow, startNativeMcpServer };
