'use strict';

const { z, IdentifierSchema, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { ContextSourceSchema } = require('../../../packages/agent-context/schemas');
const { deterministicOperationId } = require('../../../packages/governed-execution/operation-id');
const { governanceRef } = require('../../../packages/tool-runtime');
const { schemaContract } = require('../../lib/governed-execution/operational-runtime');
const { restoreExecutionPluginSelection, parseExecutionPluginSelection } = require('../../lib/execution-plugin-selection');
const { createExecutionPluginTool } = require('./execution-plugin-adapters');
const { ExecutionPluginError } = require('../../lib/execution-plugin-manifest');
const { ENGINEERING_TOOL_NAMES } = require('./engineering-tools');
const { ENVIRONMENT_CAPABILITIES } = require('./engineering-task-contract');
const { ENVIRONMENT_CONTRACTS, CAPABILITY_CONTRACTS } = require('../../lib/governed-execution/contract-registry');

const jsonObject = z.record(z.string(), z.json());
const configurationSchema = z
  .object({
    schema_version: z.literal(1),
    name: IdentifierSchema,
    description: z.string().min(1).max(4096),
    capability: IdentifierSchema,
    authority: IdentifierSchema,
    policy_version: IdentifierSchema,
    timeout_ms: z.number().int().positive().max(300_000),
    requires_approval: z.boolean().default(false),
    input_schema: jsonObject,
    output_schema: jsonObject.optional(),
    initial_input: jsonObject.optional(),
  })
  .strict();
const sourcesSchema = z.object({ sources: z.array(ContextSourceSchema).max(64) }).strict();
function reject(code) {
  throw new ExecutionPluginError(code);
}

function taskContextReservations(selection) {
  if (!selection) return 0;
  const pinned = parseExecutionPluginSelection(selection);
  return pinned.entries.filter((entry) => pinned.selected.includes(entry.selection_id) && entry.kind === 'context-source').length;
}

/** Compose host-owned ports without launching any external code. */
function createTaskExtensions({ selection, catalog, deadline, modelSelectionId }) {
  z.number().int().positive().safe().parse(deadline);
  const resolved = restoreExecutionPluginSelection(catalog, selection);
  const ports = [];
  const contexts = [];
  const names = new Set(ENGINEERING_TOOL_NAMES);
  let sources = [];
  for (const entry of resolved.entries.filter((entry) => resolved.selection.selected.includes(entry.pin.selection_id))) {
    if (entry.pin.kind === 'model-provider' && entry.pin.selection_id === modelSelectionId) continue;
    const context = entry.pin.kind === 'context-source';
    if (!context && entry.pin.kind !== 'tool') reject('PLUGIN_TASK_PORT_UNSUPPORTED');
    const config = configurationSchema.parse(entry.configuration);
    if (names.has(config.name)) reject('PLUGIN_TASK_TOOL_CONFLICT');
    names.add(config.name);
    if (
      (context && (config.initial_input === undefined || config.output_schema !== undefined)) ||
      (!context && (config.output_schema === undefined || config.initial_input !== undefined))
    )
      reject('PLUGIN_TASK_CONFIGURATION_INVALID');
    const input = schemaContract(config.input_schema, `${config.name}.input`);
    if (context && !input.safeParse(config.initial_input).success) reject('PLUGIN_TASK_CONFIGURATION_INVALID');
    const port = createExecutionPluginTool({
      admission: entry.admission,
      deadline_at: deadline,
      contract: {
        name: config.name,
        capability: config.capability,
        authority: config.authority,
        policy_version: config.policy_version,
        provider: `execution-plugin:${entry.pin.id}`,
        reversibility: 'read_only',
        cancellation_policy: 'cooperative',
        failure_mode: 'fail_closed',
        timeout_ms: config.timeout_ms,
        requires_approval: config.requires_approval,
        exclusive: true,
        provider_accepts_idempotency: true,
        sandbox: null,
        prerequisites: [],
        input_schema: input,
        output_schema: context
          ? { version: 1, safeParse: sourcesSchema.safeParse.bind(sourcesSchema) }
          : schemaContract(config.output_schema, `${config.name}.output`),
      },
      definition: {
        name: config.name,
        description: config.description,
        input_schema: config.input_schema,
        governance_ref: governanceRef(config.name),
      },
    });
    ports.push(port);
    if (context) contexts.push({ selectionId: entry.pin.selection_id, name: config.name, input: config.initial_input });
  }
  return Object.freeze({
    bundles: Object.freeze(ports.map((port) => port.bundle)),
    get sources() {
      return sources;
    },
    async collect(toolRuntime, { task_id, session_id, signal }) {
      const collected = [];
      for (const context of contexts) {
        if (signal.aborted) reject('PLUGIN_CANCELLED');
        if (Date.now() >= deadline) reject('PLUGIN_TASK_DEADLINE');
        const id = deterministicOperationId(task_id, `${resolved.selection.selection_sha256}:${context.selectionId}`);
        const result = await toolRuntime.execute(
          {
            schema_version: 1,
            invocation_id: id,
            session_id,
            turn_id: `turn:context-${task_id}`,
            tool_call_id: `call:${id}`,
            name: context.name,
            input: context.input,
            actor: { id: 'agent:engineering-context', type: 'agent' },
            resource_scope: { task_id, extension_selection: resolved.selection.selection_sha256 },
            idempotency_key: id,
            correlation_id: id,
            causation_id: id,
            approval_context: null,
          },
          { signal },
        );
        if (result.status !== 'succeeded')
          reject(
            result.status === 'uncertain'
              ? 'PLUGIN_TEARDOWN_UNCERTAIN'
              : result.status === 'cancelled'
                ? 'PLUGIN_CANCELLED'
                : 'PLUGIN_CONTEXT_FAILED',
          );
        collected.push(...sourcesSchema.parse(result.result).sources);
        // The task contract itself occupies one of the assembler's 64 runtime-context slots.
        if (collected.length > 63) reject('PLUGIN_CONTEXT_LIMIT');
      }
      sources = deepFreeze(collected);
    },
    async drain() {
      const results = await Promise.allSettled(ports.map((port) => port.drain()));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
    assertQuiescent() {
      for (const port of ports) port.assertQuiescent();
    },
    async close() {
      const results = await Promise.allSettled(ports.map((port) => port.close()));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Environment (LSP, DAP, browser, computer-use) and memory capabilities, opt-in per task.
// ---------------------------------------------------------------------------------------------------------------

const ENVIRONMENT_FAMILIES = Object.freeze({
  lsp: (name) => name.startsWith('environment.lsp.'),
  dap: (name) => name === 'environment.dap.run',
  browser: (name) => name === 'environment.browser.run',
  computer: (name) => name.startsWith('environment.computer.'),
  memory: (name) => name.startsWith('memory.'),
});
const ENVIRONMENT_ACTOR = Object.freeze({ id: 'agent:engineering-environment', type: 'agent' });
// The execution approval of one operation: short, single-use (the store consumes it) and issued by the host.
const EXECUTION_APPROVAL_TTL_MS = 60_000;
const NOT_READY = (family) =>
  Object.freeze({ status: 'blocked', code: 'ENV_TOOLCHAIN_UNAVAILABLE', cause: `the ${family} toolchain was not provided by the host` });

const familyOf = (name) => Object.keys(ENVIRONMENT_FAMILIES).find((family) => ENVIRONMENT_FAMILIES[family](name));

function environmentContracts() {
  const contracts = new Map([...ENVIRONMENT_CONTRACTS, ...CAPABILITY_CONTRACTS].map((contract) => [contract.name, contract]));
  // The contract's enum and the registry must describe the same capabilities, or a declared name would have no tool.
  if (contracts.size !== ENVIRONMENT_CAPABILITIES.length || ENVIRONMENT_CAPABILITIES.some((name) => !contracts.has(name)))
    reject('ENVIRONMENT_CAPABILITY_REGISTRY_DRIFT');
  return contracts;
}

/** A refusal the service reports as data becomes a failed tool call: the effect did not happen, so it is not in doubt. */
function serviceOutcome(result) {
  if (result && ['ok', 'started', 'stopped', 'ready'].includes(result.status)) return result;
  const error = new Error(result?.cause || `environment capability reported ${result?.status}`);
  error.code = result?.code || 'ENV_CAPABILITY_FAILED';
  error.outcome = result?.status === 'uncertain' ? 'uncertain' : 'failed';
  throw error;
}

function memoryFailure(error) {
  // The memory store appends atomically and checks everything before it does: a rejected call left no effect.
  if (typeof error?.code === 'string' && error.code.startsWith('AGENT_MEMORY_') && error.outcome === undefined) error.outcome = 'failed';
  throw error;
}

function refuseCall(code, message) {
  const error = new Error(message);
  error.code = code;
  error.outcome = 'failed';
  throw error;
}

function environmentSchemaJson(name) {
  return { type: 'object', description: `Input of ${name}, validated by its governed contract.`, additionalProperties: true };
}

/**
 * Bundles (contract, definition, provider) for the capabilities a task declared, wired to the real services.
 *
 * The services are built lazily with `ledger: ledgerSink` (never the no-op default), so every event they emit is
 * appended to the execution ledger and a failed append propagates. Anything the model cannot be trusted with is a
 * host input: the toolchains, the isolation policies, the approver, the memory store and its rules and operator.
 * `factories.<family>(context)` replaces a default service (tests, alternative hosts); it receives the same context.
 */
function createEnvironmentBundles({
  capabilities,
  policies = {},
  toolchains = {},
  ledgerSink,
  approvalGate,
  approve = null,
  project_id: projectId,
  memory = {},
  factories = {},
  broker,
  mediaStore,
  operatorDisplay,
  isCancelled = () => false,
} = {}) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) reject('ENVIRONMENT_CAPABILITIES_REQUIRED');
  if (typeof ledgerSink !== 'function') reject('ENVIRONMENT_LEDGER_SINK_REQUIRED');
  if (typeof approvalGate?.request !== 'function') reject('ENVIRONMENT_APPROVAL_GATE_REQUIRED');
  const known = environmentContracts();
  const declared = [...new Set(capabilities)];
  if (declared.some((name) => !known.has(name))) reject('ENVIRONMENT_CAPABILITY_UNKNOWN');
  const services = new Map();
  const inflight = new Set();
  const sessions = new Set();
  let uncertain = false;

  const service = (family) => {
    if (!services.has(family)) {
      const context = {
        policy: policies[family],
        toolchain: toolchains[family] ?? NOT_READY(family),
        ledger: ledgerSink,
        approvals: approvalGate,
        broker,
        mediaStore,
        operatorDisplay,
      };
      const factory = factories[family] ?? defaultServiceFactory(family);
      services.set(family, factory(context));
    }
    return services.get(family);
  };
  const track = (promise) => {
    const settled = promise.then(
      () => inflight.delete(settled),
      () => inflight.delete(settled),
    );
    inflight.add(settled);
    return promise;
  };

  // The contracts of start and act are not cancellable once dispatched, so a cancelled task must not dispatch them at all.
  const assertLive = () => {
    if (isCancelled() === true) refuseCall('ENV_TASK_CANCELLED', 'the task was cancelled before the action was dispatched');
  };
  const handlers = {
    'environment.dap.run': async (value) => serviceOutcome(await service('dap').run(value)),
    'environment.browser.run': async (value) => serviceOutcome(await service('browser').run(value)),
    'environment.computer.start': async (value) => {
      assertLive();
      const result = serviceOutcome(await service('computer').start(value));
      sessions.add(result.session_id);
      return result;
    },
    'environment.computer.screenshot': async ({ session_id: sessionId }) => serviceOutcome(await service('computer').screenshot(sessionId)),
    'environment.computer.stop': async ({ session_id: sessionId }) => {
      const result = serviceOutcome(await service('computer').stop(sessionId));
      sessions.delete(sessionId);
      return result;
    },
    'environment.computer.act': async ({ session_id: sessionId, ...action }) => {
      assertLive();
      const computer = service('computer');
      const pending = computer.requestApproval(sessionId, action);
      if (pending.status !== 'pending') serviceOutcome(pending);
      const decision =
        typeof approve === 'function'
          ? await approve({
              layer: 'computer_action',
              tool: 'environment.computer.act',
              session_id: sessionId,
              action: action.action,
              binding_digest: pending.binding_digest,
            })
          : null;
      const approver = typeof decision?.approver === 'string' ? decision.approver : '';
      // The host may present an approval it obtained for something else: the gate then refuses the binding mismatch.
      let requestId = pending.request_id;
      if (typeof decision?.request_id === 'string') requestId = decision.request_id;
      else if (decision?.approved === true) {
        const granted = approvalGate.approve(requestId, { approver });
        if (granted.status !== 'approved') refuseCall(granted.code, 'the approval was not granted');
      } else approvalGate.deny(requestId, { approver: approver || 'host' });
      // The approval can take as long as a person needs; the task may have been cancelled in the meantime.
      assertLive();
      return serviceOutcome(await computer.act(sessionId, action, { approval_id: requestId }));
    },
    'memory.write': (value) => {
      requireMemory(memory.store);
      if (value?.scope?.project_id !== projectId)
        refuseCall('AGENT_MEMORY_PROJECT_MISMATCH', 'memory can only be written to the task project');
      return memory.store.write(value, { rules: memory.rules, ...(memory.actor ? { actor: memory.actor } : {}) });
    },
    'memory.retrieve': (value) => {
      requireMemory(memory.store);
      if (value.project_id !== projectId) refuseCall('AGENT_MEMORY_PROJECT_MISMATCH', 'memory can only be read from the task project');
      if (value.include_untrusted === true) refuseCall('AGENT_MEMORY_UNTRUSTED_FORBIDDEN', 'untrusted memory is a host decision');
      if (require('./campaign-evidence-store').containsCredential(value.query))
        refuseCall('AGENT_MEMORY_CREDENTIAL_DETECTED', 'the query looks like a credential');
      return memory.store.retrieve(value);
    },
    'memory.delete': (value) => {
      requireMemory(memory.store);
      if (value.project_id !== projectId) refuseCall('AGENT_MEMORY_PROJECT_MISMATCH', 'memory can only be deleted from the task project');
      memory.store.forget(value, { actor: memory.operator });
      return { memory_id: value.memory_id, deleted: true };
    },
  };
  for (const name of ENVIRONMENT_CAPABILITIES.filter((entry) => entry.startsWith('environment.lsp.')))
    handlers[name] = async (value) => serviceOutcome(await service('lsp').run(value));

  const bundles = declared.map((name) => {
    const contract = known.get(name);
    const family = familyOf(name);
    return {
      contract: { ...contract, provider: `${contract.provider}:${name}`, sandbox: null, prerequisites: [] },
      definition: {
        name,
        description: `Governed ${family} capability ${name}. Declared by the task contract; the host owns approvals, toolchains and sessions.`,
        input_schema: environmentSchemaJson(name),
        governance_ref: governanceRef(name),
      },
      provider: {
        async execute(value) {
          try {
            return { data: await track(Promise.resolve().then(() => handlers[name](value))), evidence: [`environment://${name}`] };
          } catch (error) {
            return family === 'memory' ? memoryFailure(error) : Promise.reject(error);
          }
        },
      },
    };
  });

  async function drain() {
    await Promise.allSettled(inflight);
    const computer = services.get('computer');
    for (const id of sessions) {
      try {
        const stopped = await computer.stop(id);
        if (stopped.status === 'uncertain') uncertain = true;
      } catch {
        uncertain = true;
      }
      sessions.delete(id);
    }
  }
  return Object.freeze({
    bundles: Object.freeze(bundles),
    names: Object.freeze(bundles.map((bundle) => bundle.definition.name)),
    drain,
    assertQuiescent() {
      const state = services.get('computer')?.state();
      if (inflight.size > 0 || sessions.size > 0 || uncertain || state?.active || state?.uncertain)
        throw Object.assign(new Error('Environment completion could not be attested'), { code: 'ENGINEERING_TEARDOWN_UNCERTAIN' });
    },
    close: drain,
  });
}

function requireMemory(store) {
  if (!store) refuseCall('ENV_MEMORY_UNAVAILABLE', 'the host provided no governed memory store');
}

function defaultServiceFactory(family) {
  return (context) => {
    const environment = require('../../../packages/agent-environment');
    const { policy, toolchain, ledger } = context;
    if (!policy)
      return {
        run: () => ({ status: 'blocked', code: 'ENV_POLICY_UNAVAILABLE', cause: `the host provided no ${family} isolation policy` }),
      };
    if (family === 'lsp') return environment.createDefaultLspService({ policy, toolchain, ledger });
    if (family === 'dap') return environment.createDefaultDapService({ policy, toolchain, ledger });
    if (family === 'browser')
      return environment.createDefaultBrowserService({ policy, toolchain, broker: context.broker, mediaStore: context.mediaStore, ledger });
    return environment.createDefaultComputerService({
      policy,
      toolchain,
      approvals: context.approvals,
      mediaStore: context.mediaStore,
      ledger,
      ...(context.operatorDisplay === undefined ? {} : { operatorDisplay: context.operatorDisplay }),
    });
  };
}

/**
 * The execution-layer approval resolver of the governed runtime. The host's `approve` callback decides; the model
 * is never consulted and sends no approval. A grant is issued to the approval store for exactly this operation
 * (the store binds operation id, resource scope and policy version, and spends it once).
 */
function createExecutionApprovalResolver({ store, approve, now = () => new Date(), id = require('node:crypto').randomUUID }) {
  return async (operation) => {
    if (typeof approve !== 'function') return null;
    const decision = await approve({
      layer: 'execution',
      tool: operation.tool,
      operation_id: operation.operation_id,
      resource_scope: operation.resource_scope,
    });
    if (decision?.approved !== true) return null;
    // The host may present an approval it already holds; the store still binds it to this operation when it is spent.
    if (typeof decision.approval_id === 'string') return decision.approval_id;
    if (typeof decision.approver !== 'string' || decision.approver.length === 0) return null;
    const issued = now();
    return store.issue({
      approval_id: id(),
      operation_id: operation.operation_id,
      authorizer: { id: decision.approver, type: 'human' },
      resource_scope: operation.resource_scope,
      issued_at: issued.toISOString(),
      expires_at: new Date(issued.getTime() + EXECUTION_APPROVAL_TTL_MS).toISOString(),
      decision: 'approved',
      policy_version: operation.policy_version,
      evidence_ref: `hseos://environment/approval/${operation.tool}`,
    }).approval_id;
  };
}

// Capabilities whose every use needs a person: the policy says so even if a contract were ever registered without it.
const APPROVAL_REQUIRED = Object.freeze(['environment.computer.start', 'environment.computer.act', 'memory.delete']);
// P1 gives the server and the display loopback sockets; the browser needs the mediated egress profile, so its policy is host-provided.
const SERVICE_PROFILE = Object.freeze({ lsp: 'P1', dap: 'P1', computer: 'P1' });

/**
 * Everything a task needs for the capabilities it declared, composed from the host's inputs and the task's own
 * ledger: the real services over a ledger sink, the per-action approval gate, the execution-layer resolver and the
 * isolation policies. Nothing here is reachable by the model; the host (`host`) is the only source of trust.
 */
function createTaskEnvironment({ capabilities, db, session_id: sessionId, host, workspace, isCancelled }) {
  const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
  const { ExecutionApprovalStore } = require('../../mcp-project-state/lib/execution-approval-store');
  const { createExecutionEventRegistry } = require('../../lib/governed-execution/event-registry');
  const { createEnvironmentLedgerSink } = require('../../../packages/agent-environment');
  const { createApprovalGate } = require('./environment-approval');
  const { createIsolationPolicy } = require('../../../packages/agent-isolation-attestation');
  const { containsCredential } = require('./campaign-evidence-store');
  if (typeof host?.project_id !== 'string' || host.project_id.length === 0) reject('ENVIRONMENT_HOST_PROJECT_REQUIRED');
  const ledger = new ExecutionEventLedger(db, { event_registry: createExecutionEventRegistry() });
  const ledgerSink = createEnvironmentLedgerSink({
    ledger,
    project_id: host.project_id,
    actor: ENVIRONMENT_ACTOR,
    session_id: sessionId,
    containsCredential,
  });
  const approvalGate = host.approvalGate ?? createApprovalGate({ ledger: ledgerSink });
  const policies = { ...host.policies };
  for (const family of new Set(capabilities.map(familyOf))) {
    const root = host.toolchains?.[family]?.root;
    if (SERVICE_PROFILE[family] && !policies[family] && typeof root === 'string')
      policies[family] = createIsolationPolicy({
        backend: 'bwrap',
        ...workspace,
        profile: SERVICE_PROFILE[family],
        toolchain_roots: [root],
      });
  }
  const environment = createEnvironmentBundles({
    capabilities,
    policies,
    toolchains: host.toolchains,
    ledgerSink,
    approvalGate,
    approve: host.approve,
    project_id: host.project_id,
    memory: host.memory,
    factories: host.factories,
    broker: host.broker,
    mediaStore: host.mediaStore,
    operatorDisplay: host.operatorDisplay,
    isCancelled,
  });
  const approvalResolver = createExecutionApprovalResolver({ store: new ExecutionApprovalStore(db), approve: host.approve });
  return Object.freeze({
    ...environment,
    approvalResolver,
    // A host may ask for more approvals than the contracts do (a stricter deployment); never fewer.
    requiresApproval: (name) =>
      environment.names.includes(name) && (APPROVAL_REQUIRED.includes(name) || (host.require_approval ?? []).includes(name)),
  });
}

module.exports = {
  createTaskExtensions,
  taskContextReservations,
  createEnvironmentBundles,
  createExecutionApprovalResolver,
  createTaskEnvironment,
};
