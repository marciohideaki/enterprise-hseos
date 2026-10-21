'use strict';

const { randomUUID } = require('node:crypto');

const Ajv2020 = require('ajv/dist/2020');

const { ExecutionContractRegistry, registerCapabilityContractStubs } = require('./contract-registry');
const { createExecutionEventRegistry } = require('./event-registry');
const { createGovernedExecutionPort } = require('./execution-port');
const { GovernedExecutionRuntime } = require('./runtime');
const { GovernedExecutionScheduler } = require('./scheduler');
const { AgentMemoryError, memoryDeleteOperation } = require('../../../packages/agent-memory');
const { ExecutionApprovalStore } = require('../../mcp-project-state/lib/execution-approval-store');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { ExecutionProjectionStore } = require('../../mcp-project-state/lib/execution-projections');

const MUTATION_CLASS = Object.freeze({
  consolidate_handoff: 'compensatable_mutation',
  event_emit: 'idempotent_mutation',
  plan_squad: 'compensatable_mutation',
  run_create: 'idempotent_mutation',
  run_pipeline: 'idempotent_mutation',
  scheduler_sweep_orphans: 'idempotent_mutation',
  state_write: 'idempotent_mutation',
  tasks_add: 'idempotent_mutation',
  tasks_update: 'idempotent_mutation',
});
const READ_ONLY_TOOLS = Object.freeze({
  governance: new Set([
    'list_workflows',
    'validate_adr',
    'query_constitution',
    'list_skills',
    'check_authority',
    'get_effective_governance_context',
    'evaluate_governed_action',
    'explain_governance_decision',
    'get_governance_artifact',
    'get_governance_release',
    'diff_governance_releases',
    'verify_governance_snapshot',
    'get_governance_session_status',
    'get_governance_session_preflight',
    'get_governance_readiness',
  ]),
  swarm: new Set(['get_run_state', 'dispatch_wave', 'list_runs']),
  axon_bridge: new Set(['code_search', 'get_skeleton', 'memory_search', 'get_overview', 'dep_graph']),
  project_state: new Set([
    'state_read',
    'tasks_list',
    'state_history',
    'handoffs_list',
    'handoff_get',
    'runs_list',
    'run_describe',
    'events_search',
    'agent_runs_list',
    'orphans_list',
  ]),
});
const MUTATION_SERVERS = Object.freeze({
  swarm: new Set(['consolidate_handoff', 'plan_squad']),
  axon_bridge: new Set(['run_pipeline']),
  project_state: new Set(['event_emit', 'run_create', 'scheduler_sweep_orphans', 'state_write', 'tasks_add', 'tasks_update']),
});
const EXCLUSIVE_TOOLS = new Set(['consolidate_handoff', 'plan_squad', 'run_pipeline']);
const IDEMPOTENT_PROVIDERS = new Set(['run_create', 'scheduler_sweep_orphans', 'tasks_add']);

// Stable code of an environment.* / memory.* call that reaches a server started without the host that backs it. It is
// distinct from NOT_IMPLEMENTED: the contract is implemented, the capability just has no provider wired in this process.
const ENV_CAPABILITY_UNAVAILABLE = 'ENV_CAPABILITY_UNAVAILABLE';
const ENVIRONMENT_PROVIDER = 'agent-environment';
const MEMORY_PROVIDER = 'agent-memory';
const DERIVED_APPROVAL_TTL_MS = 60_000;

function schemaContract(schema, label) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema || {});
  return Object.freeze({
    version: 1,
    safeParse(value) {
      if (validate(value)) return { success: true, data: value };
      return { success: false, error: { issues: validate.errors || [], message: `${label} validation failed` } };
    },
  });
}

function strictJsonClone(value, path = 'output', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${path} contains a lossy number`);
    return value;
  }
  const isPlainObject = value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (!Array.isArray(value) && !isPlainObject) throw new TypeError(`${path} contains a non-JSON value`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new TypeError(`${path} contains a sparse or decorated array`);
      }
      return value.map((child, index) => strictJsonClone(child, `${path}[${index}]`, ancestors));
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(value).some(
        (key) => typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'),
      )
    ) {
      throw new TypeError(`${path} contains non-data JSON properties`);
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, strictJsonClone(descriptor.value, `${path}.${key}`, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function outputContract() {
  return Object.freeze({
    version: 1,
    safeParse(value) {
      try {
        return { success: true, data: strictJsonClone(value) };
      } catch (error) {
        return { success: false, error: { issues: [{ message: `provider output must be strict JSON: ${error.message}` }] } };
      }
    },
  });
}

function capabilityUnavailable(tool, cause) {
  // Nothing was attempted, so the outcome is a plain failure and not an uncertain mutation.
  return Object.assign(new Error(`${tool} is unavailable: ${cause}`), {
    code: ENV_CAPABILITY_UNAVAILABLE,
    retryable: false,
    outcome: 'failed',
  });
}

/**
 * Handlers of the environment.* and memory.* contracts, by tool name. Without a host (or without the one member a tool
 * needs) a call fails closed with ENV_CAPABILITY_UNAVAILABLE. The runtime has already demanded and spent the explicit
 * approval of the contracts that require one (computer.start/act, memory.delete) before a handler runs.
 *
 * `host` is `{ lsp, dap, browser, computer, approvals, approver, memory: { store, rules, actor, operator } }`, every
 * member optional: the services of packages/agent-environment, the computer approval gate, and the governed memory store.
 */
function createCapabilityHandlers({ host, deriveDeleteApproval }) {
  const member = (tool, name) => {
    const value = name === 'store' ? host?.memory?.store : host?.[name];
    if (!value) throw capabilityUnavailable(tool, host ? `the host has no ${name}` : 'no environment host was supplied');
    return value;
  };
  const viaRun = (name) => (tool, input) => member(tool, name).run(input);
  return {
    'environment.lsp.diagnostics': viaRun('lsp'),
    'environment.lsp.definition': viaRun('lsp'),
    'environment.lsp.references': viaRun('lsp'),
    'environment.lsp.hover': viaRun('lsp'),
    'environment.lsp.rename_preview': viaRun('lsp'),
    'environment.dap.run': viaRun('dap'),
    'environment.browser.run': viaRun('browser'),
    'environment.computer.start': (tool, input) => member(tool, 'computer').start(input),
    'environment.computer.screenshot': (tool, input) => member(tool, 'computer').screenshot(input.session_id),
    'environment.computer.stop': (tool, input) => member(tool, 'computer').stop(input.session_id),
    'environment.computer.act': async (tool, input) => {
      const computer = member(tool, 'computer');
      const gate = member(tool, 'approvals');
      const { session_id: sessionId, ...action } = input;
      const asked = computer.requestApproval(sessionId, action);
      if (asked.status !== 'pending') return asked;
      // The runtime spent the explicit approval of this exact call before dispatch. It opens the service's own per-action
      // gate, which still binds the grant to the session, sequence, action and the screenshot the approver saw.
      const resolved = gate.resolve(asked.request_id, true, { approver: host.approver || 'governed-runtime' });
      if (resolved.status !== 'approved') return resolved;
      return computer.act(sessionId, action, { approval_id: asked.request_id });
    },
    'memory.write': (tool, input) => {
      const store = member(tool, 'store');
      const { rules, actor } = host.memory;
      return store.write(input, { rules, ...(actor ? { actor } : {}) });
    },
    'memory.retrieve': (tool, input) => member(tool, 'store').retrieve(input),
    'memory.delete': (tool, input, context) => {
      const store = member(tool, 'store');
      // The store asks for a single-use approval bound to this exact deletion; it is derived from the explicit approval
      // the runtime has just spent for the call, and only exists for the duration of the forget.
      deriveDeleteApproval(input, context);
      store.forget(input, { actor: host.memory.operator });
      return { memory_id: input.memory_id, deleted: true };
    },
  };
}

function createCapabilityProviders({ host, deriveDeleteApproval }) {
  const handlers = createCapabilityHandlers({ host, deriveDeleteApproval });
  const dispatch = (providerName) => ({
    async execute(input, context) {
      const handler = handlers[context.tool];
      if (!handler) throw capabilityUnavailable(String(context.tool), `no handler for ${providerName}`);
      let result;
      try {
        result = await handler(context.tool, input, context);
      } catch (error) {
        // A memory policy refusal (denied write, duplicate, unknown entry, missing approval) is raised before any append.
        if (error instanceof AgentMemoryError && error.outcome === undefined) error.outcome = 'failed';
        throw error;
      }
      return { data: result, evidence: [`hseos://execution/${context.operation_id}/provider/${providerName}`] };
    },
  });
  return new Map([
    [ENVIRONMENT_PROVIDER, dispatch(ENVIRONMENT_PROVIDER)],
    [MEMORY_PROVIDER, dispatch(MEMORY_PROVIDER)],
  ]);
}

function createOperationalExecution({ db, serverId, tools, invokeTool, maxConcurrency = 4, toolGovernance = {}, environmentHost = null }) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Operational execution requires a SQLite database');
  if (!(tools instanceof Map) || tools.size === 0) throw new TypeError('Operational execution requires a non-empty tool map');
  if (typeof invokeTool !== 'function') throw new TypeError('Operational execution requires a provider invoker');

  const contracts = new ExecutionContractRegistry();
  const providers = new Map();
  for (const [name, tool] of tools) {
    const governance = toolGovernance[name] || {};
    const reversibility =
      governance.reversibility ||
      (MUTATION_SERVERS[serverId]?.has(name) ? MUTATION_CLASS[name] : READ_ONLY_TOOLS[serverId]?.has(name) ? 'read_only' : null);
    if (!reversibility) throw new TypeError(`Explicit execution governance is required for ${serverId}:${name}`);
    const providerName = `${serverId}:${name}`;
    contracts.register({
      name,
      capability: `mcp.${serverId}`,
      provider: providerName,
      authority: `mcp.${serverId}.${reversibility === 'read_only' ? 'read' : 'mutate'}`,
      policy_version: 'hseos-operational-v1',
      reversibility,
      cancellation_policy: governance.cancellation_policy || (reversibility === 'read_only' ? 'cooperative' : 'non_cancellable'),
      failure_mode: 'fail_closed',
      timeout_ms: 30_000,
      requires_approval: governance.requires_approval === true,
      exclusive: governance.exclusive === true || EXCLUSIVE_TOOLS.has(name),
      provider_accepts_idempotency: governance.provider_accepts_idempotency === true || IDEMPOTENT_PROVIDERS.has(name),
      sandbox: null,
      prerequisites: [],
      input_schema: schemaContract(tool.inputSchema, `${name}.input`),
      output_schema: outputContract(),
    });
    providers.set(providerName, {
      async execute(input, context) {
        const result = await invokeTool(name, input, context);
        return {
          data: result,
          evidence: [`hseos://execution/${context.operation_id}/provider/${providerName}`],
        };
      },
    });
  }

  // The versioned environment.* and memory.* contracts belong to the production registry; the stubs fail closed.
  registerCapabilityContractStubs(contracts);

  const eventRegistry = createExecutionEventRegistry();
  const ledger = new ExecutionEventLedger(db, { event_registry: eventRegistry });
  const projector = new ExecutionProjectionStore(db, ledger);
  if (projector.health().reason === 'no_active_generation') projector.rebuild();
  const approvalStore = new ExecutionApprovalStore(db);

  // environment.* and memory.*: the providers always exist, so a call without a host fails with a stable code instead of
  // a missing provider. A host is built here, after the ledger and the approval store it must share exist.
  const derivedDeleteApprovals = new Map();
  const wiring = Object.freeze({
    ledger,
    approvalStore,
    resolveMemoryDeleteApproval: ({ operation_id: operationId }) => derivedDeleteApprovals.get(operationId),
  });
  if (environmentHost !== null && typeof environmentHost !== 'function') {
    throw new TypeError('environmentHost must be a function that builds the host from the execution wiring');
  }
  const host = environmentHost ? environmentHost(wiring) : null;
  const deriveDeleteApproval = (input, context) => {
    const operator = host?.memory?.operator;
    if (!operator || typeof operator.id !== 'string') {
      throw Object.assign(new Error('deleting memory requires an operator actor'), { code: 'AGENT_MEMORY_OPERATOR_REQUIRED' });
    }
    const { operation_id: operationId, resource_scope: resourceScope } = memoryDeleteOperation(input.project_id, input.memory_id);
    const approvalId = randomUUID();
    const now = new Date();
    approvalStore.issue({
      approval_id: approvalId,
      operation_id: operationId,
      authorizer: { id: operator.id, type: 'human' },
      resource_scope: resourceScope,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + DERIVED_APPROVAL_TTL_MS).toISOString(),
      decision: 'approved',
      policy_version: 'hseos-operational-v1',
      evidence_ref: `hseos://execution/${context.operation_id}/derived-approval/${approvalId}`,
    });
    derivedDeleteApprovals.set(operationId, approvalId);
  };
  for (const [name, provider] of createCapabilityProviders({ host, deriveDeleteApproval })) providers.set(name, provider);
  const runtime = new GovernedExecutionRuntime({
    contracts,
    event_registry: eventRegistry,
    ledger,
    approval_store: approvalStore,
    authority: {
      async evaluate({ actor, resource_scope: resourceScope }) {
        const trustedType = actor && ['human', 'local_process', 'system'].includes(actor.type);
        return {
          allowed: Boolean(trustedType && actor.id && resourceScope && typeof resourceScope.project === 'string'),
        };
      },
    },
    policy: {
      // The capability contracts (environment.*, memory.*) carry their own policy version; the MCP tools share the operational one.
      async evaluate({ contract }) {
        return { allowed: true, policy_version: contract.policy_version, requires_approval: false, warnings: [] };
      },
    },
    providers,
    approval_resolver: async (_operation, approvalContext) => approvalContext && approvalContext.approval_id,
    projector,
  });
  const port = createGovernedExecutionPort(runtime);
  const scheduler = new GovernedExecutionScheduler({ contracts, port, maxConcurrency });
  return Object.freeze({ approvalStore, contracts, ledger, port, projector, runtime, scheduler });
}

module.exports = {
  ENV_CAPABILITY_UNAVAILABLE,
  schemaContract,
  createOperationalExecution,
  EXCLUSIVE_TOOLS,
  IDEMPOTENT_PROVIDERS,
  MUTATION_CLASS,
};
