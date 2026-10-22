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
const inputDigest = (value) =>
  require('node:crypto').createHash('sha256').update(require('../../../packages/agent-session-store').canonicalJson(value)).digest('hex');
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
  assertApproved = () => {},
  approverOf = () => {},
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
      let decision = null;
      try {
        if (typeof approve === 'function')
          decision = await approve({
            layer: 'computer_action',
            tool: 'environment.computer.act',
            session_id: sessionId,
            action: action.action,
            // What the person is asked to approve: the exact action with its arguments, bound by the gate's digest
            // (which also covers the screenshot the approver looked at).
            input: action,
            input_digest: inputDigest(action),
            binding_digest: pending.binding_digest,
          });
      } catch {
        // A request nobody can answer must not stay pending until it expires.
        approvalGate.deny(pending.request_id, { approver: 'host' });
        refuseCall('ENV_APPROVAL_CALLBACK_FAILED', 'the host approver failed; the request was rejected');
      }
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
    'memory.delete': (value, context) => {
      requireMemory(memory.store);
      if (value.project_id !== projectId) refuseCall('AGENT_MEMORY_PROJECT_MISMATCH', 'memory can only be deleted from the task project');
      // The store wants its own single-use approval for this exact deletion. When the host gave a deriver, it is issued
      // now from the person's approval of this call (bound to project and memory) and released whatever happens.
      const release = memory.deleteApprovals?.derive({
        project_id: value.project_id,
        memory_id: value.memory_id,
        approver: approverOf(context) ?? 'host',
      });
      try {
        memory.store.forget(value, { actor: memory.operator });
      } finally {
        release?.();
      }
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
        async execute(value, context) {
          try {
            assertApproved(name, value, context);
            return { data: await track(Promise.resolve().then(() => handlers[name](value, context))), evidence: [`environment://${name}`] };
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
      const state = services.get('computer')?.state?.();
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
      throw Object.assign(new Error(`the host provided no ${family} isolation policy`), {
        code: 'ENGINEERING_ENVIRONMENT_POLICY_REQUIRED',
        outcome: 'failed',
      });
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
function createExecutionApprovalResolver({
  store,
  approve,
  inputOf = () => {},
  bind = () => {},
  now = () => new Date(),
  id = require('node:crypto').randomUUID,
}) {
  return async (operation) => {
    if (typeof approve !== 'function') return null;
    // The approver sees the content of the call, not only its name, and approves that content's digest.
    const input = inputOf(operation);
    const digest = input === undefined ? null : inputDigest(input);
    const decision = await approve({
      layer: 'execution',
      tool: operation.tool,
      operation_id: operation.operation_id,
      resource_scope: operation.resource_scope,
      input,
      input_digest: digest,
    });
    if (decision?.approved !== true) return null;
    // An approval given for other content is not an approval of this call.
    if (decision.input_digest !== undefined && decision.input_digest !== digest) return null;
    bind(operation.operation_id, digest, decision.approver);
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
function createTaskEnvironment({ capabilities, db, session_id: sessionId, host, workspace, isCancelled, max_concurrency: maxConcurrency }) {
  // The policy hands the approver the call it just evaluated through one slot; that is only sound while calls are serial.
  if (maxConcurrency !== 1) reject('ENGINEERING_ENVIRONMENT_CONCURRENCY_UNSUPPORTED');
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
  // A host that cannot own a store before the task database exists (the production host) hands a factory instead: the
  // store is then built over this task's ledger, together with the deriver of its deletion approvals.
  const memory = typeof host.memory?.create === 'function' ? { ...host.memory, ...host.memory.create({ ledger, db }) } : host.memory;
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
  // A declared family with neither a policy nor an injected factory could only ever fail at the first call: fail now.
  for (const family of new Set(capabilities.map(familyOf)))
    if (family !== 'memory' && !policies[family] && !host.factories?.[family]) reject('ENGINEERING_ENVIRONMENT_POLICY_REQUIRED');
  // The call the policy just evaluated is the one the approver is shown and the one the provider must receive.
  let noted = { tool: null, input: undefined };
  const approvedInputs = new Map();
  const approvers = new Map();
  const environment = createEnvironmentBundles({
    capabilities,
    policies,
    toolchains: host.toolchains,
    ledgerSink,
    approvalGate,
    approve: host.approve,
    project_id: host.project_id,
    memory,
    factories: host.factories,
    broker: host.broker,
    mediaStore: host.mediaStore,
    operatorDisplay: host.operatorDisplay,
    isCancelled,
    approverOf: (context) => approvers.get(context?.operation_id),
    assertApproved(name, value, context) {
      if (!needsApproval(name)) return;
      if (approvedInputs.get(context?.operation_id) !== inputDigest(value))
        throw Object.assign(new Error('the call differs from the content that was approved'), {
          code: 'ENV_APPROVAL_INPUT_MISMATCH',
          outcome: 'failed',
        });
    },
  });
  const needsApproval = (name) =>
    environment.names.includes(name) && (APPROVAL_REQUIRED.includes(name) || (host.require_approval ?? []).includes(name));
  const approvalResolver = createExecutionApprovalResolver({
    store: new ExecutionApprovalStore(db),
    approve: host.approve,
    inputOf: (operation) => (noted.tool === operation.tool ? noted.input : undefined),
    bind: (operationId, digest, approver) => {
      approvedInputs.set(operationId, digest);
      approvers.set(operationId, approver);
    },
  });
  // Governed memory enters the context only when the task declared the capability and the host owns a store. The
  // assembler resolves its profile synchronously, so the (async) collection runs once before the session starts and
  // the resolver reads the frozen result; the retrieval itself is the store's synchronous, governed `retrieve`.
  const wantsMemory = capabilities.includes('memory.retrieve') && Boolean(memory?.store);
  let memorySources = Object.freeze([]);
  return Object.freeze({
    ...environment,
    approvalResolver,
    get memorySources() {
      return memorySources;
    },
    async collectMemory({ query }) {
      // A query that looks like a credential is never used to search: nothing leaves, nothing is found.
      memorySources = deepFreeze(
        wantsMemory && !containsCredential(query)
          ? await require('./memory-context-source').collectMemorySources({ store: memory.store, project_id: host.project_id, query })
          : [],
      );
    },
    // A host may ask for more approvals than the contracts do (a stricter deployment); never fewer.
    requiresApproval: needsApproval,
    noteInput(tool, input) {
      noted = { tool, input };
    },
  });
}

/**
 * Host-side deriver of the memory store's own deletion approval. The host builds its store's approval verifier with
 * `resolveApprovalId` and hands `derive` to the task environment: when a person approves `memory.delete` at the runtime,
 * a single-use approval bound to that project and memory is issued for the store, spent by `forget`, and released.
 */
function createMemoryDeleteApprovals({
  approvalStore,
  policyVersion = 'hseos-operational-v1',
  ttl_ms = 30_000,
  now = Date.now,
  id = require('node:crypto').randomUUID,
}) {
  const granted = new Map();
  return Object.freeze({
    resolveApprovalId: ({ operation_id: operationId }) => granted.get(operationId),
    derive({ project_id: projectId, memory_id: memoryId, approver }) {
      const { operation_id: operationId, resource_scope: resourceScope } = require('../../../packages/agent-memory').memoryDeleteOperation(
        projectId,
        memoryId,
      );
      const approvalId = id();
      const issued = now();
      approvalStore.issue({
        approval_id: approvalId,
        operation_id: operationId,
        authorizer: { id: approver, type: 'human' },
        resource_scope: resourceScope,
        issued_at: new Date(issued).toISOString(),
        expires_at: new Date(issued + ttl_ms).toISOString(),
        decision: 'approved',
        policy_version: policyVersion,
        evidence_ref: `hseos://engineering/derived-approval/${approvalId}`,
      });
      granted.set(operationId, approvalId);
      return () => granted.delete(operationId);
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Production host: the `environment:` section of the global configuration, composed into the host of a task.
// ---------------------------------------------------------------------------------------------------------------

// `isolation` is informational: a single-value restriction. The task environment always isolates with bwrap (the only
// backend `createIsolationPolicy` implements); the key does not select a backend, it only refuses any other value.
const ENVIRONMENT_ISOLATION_BACKENDS = Object.freeze(['bwrap']);

/** An absolute, normalized path of an existing directory that is not itself a symbolic link. */
function pinnedDirectory(value, context) {
  const fs = require('node:fs');
  const path = require('node:path');
  if (
    !path.isAbsolute(value) ||
    value.split('/').includes('..') ||
    path.normalize(value) !== value ||
    (value.length > 1 && value.endsWith('/'))
  )
    return context.addIssue({ code: 'custom', message: 'must be an absolute, normalized path without ".." segments' });
  let stat;
  try {
    stat = fs.lstatSync(value);
  } catch {
    return context.addIssue({ code: 'custom', message: 'must be an existing directory' });
  }
  // Only the final component is checked; a symbolic link in an intermediate component is not resolved here.
  if (stat.isSymbolicLink() || !stat.isDirectory())
    context.addIssue({ code: 'custom', message: 'must be a directory, not a symbolic link' });
}
const environmentConfigSchema = z
  .object({
    project_id: IdentifierSchema,
    toolchain_cache: z.string().min(1).max(4096).superRefine(pinnedDirectory).optional(),
    memory: z
      .object({
        rules: z.array(z.record(z.string(), z.json())).max(256).default([]),
        operator: z
          .object({ id: IdentifierSchema, kind: z.literal('operator') })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    isolation: z.array(z.enum(ENVIRONMENT_ISOLATION_BACKENDS)).min(1).max(ENVIRONMENT_ISOLATION_BACKENDS.length).optional(),
  })
  .strict();

function configError(message) {
  return Object.assign(new Error(`environment configuration: ${message}`), { code: 'ENGINEERING_ENVIRONMENT_CONFIG_INVALID' });
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1)
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}

/** The `environment:` section of a global configuration file; `null` when the file or the section is absent. */
function readEnvironmentSection(file) {
  const fs = require('node:fs');
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = require('yaml').parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw configError(`${file} is not valid YAML (${error.message})`);
  }
  // The host stays absent (fail-closed) in both cases below; the warning only tells the person why.
  if (parsed && typeof parsed === 'object') {
    if ('environment' in parsed && parsed.environment === null)
      process.stderr.write(`hseos: the environment section of ${file} is empty; no environment host is composed\n`);
    for (const key of Object.keys(parsed).filter(
      (entry) => entry !== 'environment' && editDistance(entry.toLowerCase(), 'environment') <= 2,
    ))
      process.stderr.write(`hseos: ${file} has the key "${key}", did you mean "environment"? no environment host is composed\n`);
  }
  return parsed?.environment ?? null;
}

// Preparers of the pinned toolchain of each family: they copy the verified cache into a read-only directory.
function defaultToolchainPreparers() {
  const environment = require('../../../packages/agent-environment');
  const install = environment.loadPins().installToolchain;
  return {
    lsp: ({ cacheDirectory, destination }) => environment.prepareLspToolchain({ install, cacheDirectory, destination }),
    dap: ({ cacheDirectory, destination }) => environment.prepareDapToolchain({ install, cacheDirectory, destination }),
  };
}

/**
 * The host of a task, built from the `environment:` section (`section`, already read) of the global configuration.
 *
 * Returns `null` without the section: the host stays absent and a contract that declares capabilities is refused
 * (`ENGINEERING_ENVIRONMENT_HOST_REQUIRED`). The section is strict: an unknown key, a rule the permission lattice does
 * not accept or an unsupported isolation backend is refused with a clear message, never ignored.
 *
 * Fail-closed by construction:
 * - `approve` always denies. The CLI has no channel to a person, and nothing here approves on anyone's behalf, so
 *   `environment.computer.start/act` and `memory.delete` are denied until a host with a real channel is composed.
 * - memory writes are denied unless `memory.rules` allows them; deletion also needs `memory.operator`.
 * - a family whose toolchain is not provisioned (or has no preparer, such as the browser, which needs the mediated
 *   egress broker the CLI does not have) stays blocked.
 *
 * Limitation of this phase: the memory store is built over the ledger of each TASK (see `memory.create`), so memory
 * written by one task is not seen by the next. Durable memory across tasks needs the activated project database.
 *
 * `options.capabilities` limits the toolchain preparation to the families a task declared; `options.prepare` and
 * `options.factories` replace the preparers and services (tests, alternative hosts). `host.dispose()` removes the
 * prepared toolchains.
 */
function createProductionEnvironmentHost(section, options = {}) {
  if (section === null || section === undefined) return null;
  const parsed = environmentConfigSchema.safeParse(section);
  if (!parsed.success)
    throw configError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; '));
  const config = parsed.data;
  const rules = config.memory?.rules ?? [];
  try {
    require('../../../packages/agent-policy-lattice').evaluatePermissionLattice({ rules });
  } catch (error) {
    throw configError(`memory.rules: ${error.message}`);
  }
  const { mkdtempSync, rmSync } = require('node:fs');
  const toolchains = {};
  const scratch = [];
  const families = new Set((options.capabilities ?? []).map(familyOf).filter((family) => family && family !== 'memory'));
  if (config.toolchain_cache && families.size > 0) {
    const preparers = options.prepare ?? defaultToolchainPreparers();
    for (const family of families) {
      if (typeof preparers[family] !== 'function') continue;
      const destination = mkdtempSync(require('node:path').join(require('node:os').tmpdir(), `hseos-env-${family}-`));
      scratch.push(destination);
      toolchains[family] = preparers[family]({ cacheDirectory: config.toolchain_cache, destination });
    }
  }
  const operator = config.memory?.operator;
  return Object.freeze({
    project_id: config.project_id,
    toolchains,
    policies: {},
    isolation: config.isolation ?? ENVIRONMENT_ISOLATION_BACKENDS,
    factories: options.factories,
    approve: async () => ({ approved: false }),
    memory: Object.freeze({
      rules,
      ...(operator ? { operator: { kind: operator.kind, id: operator.id } } : {}),
      create({ ledger, db }) {
        const { ExecutionApprovalStore } = require('../../mcp-project-state/lib/execution-approval-store');
        const { createExecutionApprovalVerifier } = require('../../../packages/agent-memory');
        const approvalStore = new ExecutionApprovalStore(db);
        const deleteApprovals = createMemoryDeleteApprovals({ approvalStore });
        const { createGovernedMemory } = require('./memory-context-source');
        const store = createGovernedMemory({
          ledger,
          approvalVerifier: createExecutionApprovalVerifier({ approvalStore, resolveApprovalId: deleteApprovals.resolveApprovalId }),
        });
        return { store, deleteApprovals };
      },
    }),
    dispose() {
      for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
    },
  });
}

const MEMORY_QUERY_CHARS = 1024;

/** The retrieval query of a task: its requirements, bounded and deterministic. Never the model's words. */
function taskMemoryQuery(contract) {
  return contract.requirements
    .map((requirement) => requirement.description)
    .join(' ')
    .slice(0, MEMORY_QUERY_CHARS);
}

module.exports = {
  createMemoryDeleteApprovals,
  taskMemoryQuery,
  createTaskExtensions,
  taskContextReservations,
  createEnvironmentBundles,
  createExecutionApprovalResolver,
  createTaskEnvironment,
  createProductionEnvironmentHost,
  readEnvironmentSection,
};
