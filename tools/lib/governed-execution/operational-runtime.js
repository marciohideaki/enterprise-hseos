'use strict';

const { randomUUID } = require('node:crypto');

const Ajv2020 = require('ajv/dist/2020');

const { GovernedRefusalError } = require('./canonical-envelope');
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
  return new GovernedRefusalError(ENV_CAPABILITY_UNAVAILABLE, `${tool} is unavailable: ${cause}`);
}

function refusal(code, message) {
  return new GovernedRefusalError(code, message);
}

// The policy version the runtime expects for a contract comes from this table, never from the contract itself: a
// contract that declares another version (or belongs to a family not listed here) is refused by the runtime check.
const EXPECTED_POLICY_VERSION = Object.freeze({
  'environment.lsp': 'hseos-w5-environment-v1',
  'environment.dap': 'hseos-w5-environment-v1',
  'environment.browser': 'hseos-w5-capability-v1',
  'environment.computer': 'hseos-w5-capability-v1',
  'agent-memory': 'hseos-w5-capability-v1',
});

function expectedPolicyVersion(contract) {
  const capability = contract && contract.capability;
  if (typeof capability !== 'string') return null;
  if (capability.startsWith('mcp.')) return 'hseos-operational-v1';
  return Object.hasOwn(EXPECTED_POLICY_VERSION, capability) ? EXPECTED_POLICY_VERSION[capability] : null;
}

const HOST_SERVICES = Object.freeze({
  lsp: ['run'],
  dap: ['run'],
  browser: ['run'],
  computer: ['start', 'screenshot', 'requestApproval', 'act', 'stop'],
});
const HOST_MEMBERS = new Set([...Object.keys(HOST_SERVICES), 'approvals', 'project_id', 'memory']);

/** Fails loudly when the host a builder returned lacks what its own members need. Returns the host. */
function validateEnvironmentHost(host) {
  const fail = (message) => {
    throw new TypeError(`environment host ${message}`);
  };
  if (!host || typeof host !== 'object' || Array.isArray(host)) fail('must be an object');
  for (const key of Object.keys(host)) if (!HOST_MEMBERS.has(key)) fail(`has an unknown member: ${key}`);
  const present = [...Object.keys(HOST_SERVICES), 'memory'].filter((key) => host[key] !== undefined);
  if (present.length === 0) fail('must provide at least one service or the memory store');
  for (const [name, methods] of Object.entries(HOST_SERVICES)) {
    if (host[name] === undefined) continue;
    for (const method of methods) if (typeof host[name]?.[method] !== 'function') fail(`${name} service lacks ${method}()`);
  }
  if (host.computer !== undefined && typeof host.approvals?.approve !== 'function') {
    fail('needs approvals.approve() (the computer approval gate) when it provides computer');
  }
  if (host.memory !== undefined) {
    const { store, rules, operator } = host.memory ?? {};
    for (const method of ['write', 'retrieve', 'forget']) {
      if (typeof store?.[method] !== 'function') fail(`memory store lacks ${method}()`);
    }
    if (!Array.isArray(rules)) fail('memory needs write rules (an array)');
    if (!operator || typeof operator.id !== 'string' || operator.kind !== 'operator') fail('memory needs an operator actor');
    if (typeof host.project_id !== 'string' || host.project_id.length === 0) fail('memory needs a project_id');
  }
  return host;
}

const stable = (value) =>
  JSON.stringify(value, (_key, child) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).sort(([x], [y]) => (x < y ? -1 : 1)))
      : child,
  );
const MAX_PENDING_GRANTS = 64;

/**
 * Per-call approvals for the capability tools. `describe` is the text a human sees when asked (and, for a computer
 * action, opens the service's own request for exactly that action); `grant` runs only after that human accepted and
 * resolves the service gate with the approver's identity; `take` hands the provider the grant for the very same input.
 */
function createCapabilityApprovals({ host, normalize, tools = new Map() }) {
  const pending = new Map();
  // The runtime hands a provider the contract-normalized input (defaults filled); both sides compare that one form.
  const canonical = (tool, input) => stable(normalize(tool, input));
  return Object.freeze({
    describe(request, operationId) {
      // A tool may declare a deterministic, side-effect-free `preflight(input)`: scope and input that can never succeed are
      // refused here, before a person is asked. The tool repeats the same check when it executes.
      const preflight = tools.get(request.tool)?.preflight;
      if (typeof preflight === 'function') {
        try {
          preflight(request.input);
        } catch (error) {
          if (error && typeof error.code === 'string') throw Object.assign(error, { preApprovalRefusal: true });
          throw error;
        }
      }
      if (request.tool === 'environment.computer.act') {
        if (!host?.computer) throw capabilityUnavailable(request.tool, 'the host has no computer');
        const { session_id: sessionId, ...action } = normalize(request.tool, request.input);
        const asked = host.computer.requestApproval(sessionId, action);
        if (asked.status !== 'pending') {
          throw refusal(asked.code || 'ENV_COMPUTER_APPROVAL_REFUSED', `the computer action cannot be approved: ${asked.code}`);
        }
        if (pending.size >= MAX_PENDING_GRANTS) pending.delete(pending.keys().next().value);
        pending.set(operationId, { request_id: asked.request_id, input: canonical(request.tool, request.input), granted: false });
        const { action: name, ...args } = action;
        return `Approve computer action ${name} ${JSON.stringify(args)} on session ${sessionId} (step ${asked.seq}, screenshot sha256 ${asked.screenshot_digest}, binding ${asked.binding_digest})?`;
      }
      if (request.tool === 'memory.delete') {
        const { project_id: projectId, memory_id: memoryId, reason } = request.input;
        // The scope is checked before a person is asked: a deletion in another project is never put to the human.
        if (host?.memory && projectId !== host.project_id) {
          throw refusal('ENV_PROJECT_SCOPE_MISMATCH', `memory.delete is bound to project ${host.project_id}`);
        }
        return `Approve deleting memory ${memoryId} of project ${projectId}${reason ? ` (reason: ${reason})` : ''}?`;
      }
      return null;
    },
    grant(request, operationId, approverId) {
      if (request.tool !== 'environment.computer.act') return;
      const entry = pending.get(operationId);
      if (!entry || entry.input !== canonical(request.tool, request.input)) {
        throw refusal('ENV_COMPUTER_APPROVAL_REQUIRED', 'no computer approval was requested for this exact action');
      }
      const resolved = host.approvals.approve(entry.request_id, { approver: approverId });
      if (resolved.status !== 'approved') {
        throw refusal(resolved.code || 'ENV_COMPUTER_APPROVAL_REFUSED', 'the computer approval was not granted');
      }
      entry.granted = true;
    },
    take(operationId, input) {
      const entry = pending.get(operationId);
      if (!entry || !entry.granted || entry.input !== canonical('environment.computer.act', input)) {
        throw refusal('ENV_COMPUTER_APPROVAL_REQUIRED', 'computer action has no granted approval for this exact input');
      }
      pending.delete(operationId);
      return entry.request_id;
    },
  });
}

const MCP_MEMORY_WRITE_FIXED = Object.freeze({ origin: 'agent', trust: 'untrusted' });
const memoryProject = (tool, input) => (tool === 'memory.write' ? input?.scope?.project_id : input?.project_id);

/**
 * Handlers of the environment.* and memory.* contracts, by tool name. Without a host (or without the one member a tool
 * needs) a call fails closed with ENV_CAPABILITY_UNAVAILABLE. The runtime has already demanded and spent the explicit
 * approval of the contracts that require one (computer.start/act, memory.delete) before a handler runs.
 */
function createCapabilityHandlers({ host, deriveDeleteApproval, capabilityApprovals }) {
  const member = (tool, name) => {
    const value = name === 'store' ? host?.memory?.store : host?.[name];
    if (!value) throw capabilityUnavailable(tool, host ? `the host has no ${name}` : 'no environment host was supplied');
    return value;
  };
  // A service reports a refusal as data (`status` blocked/refused/failed, with its own `code`). That is a failed call carrying
  // that code, not a malformed output: the output contract only describes a success.
  const served = (result) => {
    if (result && ['ok', 'started', 'stopped', 'ready'].includes(result.status)) return result;
    throw Object.assign(new Error(result?.cause || `environment capability reported ${result?.status}`), {
      code: result?.code || 'ENV_CAPABILITY_FAILED',
      retryable: false,
      outcome: result?.status === 'uncertain' ? 'uncertain' : 'failed',
    });
  };
  const viaRun = (name) => async (tool, input) => served(await member(tool, name).run(input));
  const memoryStore = (tool, input) => {
    const store = member(tool, 'store');
    if (memoryProject(tool, input) !== host.project_id) {
      throw refusal('ENV_PROJECT_SCOPE_MISMATCH', `${tool} is bound to project ${host.project_id}`);
    }
    return store;
  };
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
    'environment.computer.act': async (tool, input, context) => {
      const computer = member(tool, 'computer');
      const { session_id: sessionId, ...action } = input;
      // The service gate was resolved by the human's accepted elicitation (see grant), never by the runtime.
      return computer.act(sessionId, action, { approval_id: capabilityApprovals.take(context.operation_id, input) });
    },
    'memory.write': (tool, input) => {
      const store = memoryStore(tool, input);
      const { rules, actor } = host.memory;
      // A client of this surface never decides what a memory is worth: origin and trust are fixed here, and a request
      // that names anything else is refused instead of silently rewritten. The configured actor is the identity the
      // write rules see, never the origin of the entry. Promotion to trusted needs an operator path that does not exist yet.
      for (const [field, allowed] of Object.entries(MCP_MEMORY_WRITE_FIXED)) {
        if (input[field] !== undefined && input[field] !== allowed) {
          throw refusal('MEMORY_WRITE_FIELD_NOT_ALLOWED', `memory.write over MCP stores ${field}=${allowed} only`);
        }
      }
      return store.write({ ...input, ...MCP_MEMORY_WRITE_FIXED }, { rules, ...(actor ? { actor } : {}) });
    },
    'memory.retrieve': (tool, input) => memoryStore(tool, input).retrieve(input),
    'memory.delete': (tool, input, context) => {
      const store = memoryStore(tool, input);
      // The store asks for a single-use approval bound to this exact deletion; it is derived from the explicit approval
      // the runtime has just spent for the call, and exists only for the duration of the (synchronous) forget.
      const release = deriveDeleteApproval(input, context);
      try {
        store.forget(input, { actor: host.memory.operator });
      } finally {
        release();
      }
      return { memory_id: input.memory_id, deleted: true };
    },
  };
}

function createCapabilityProviders({ host, deriveDeleteApproval, capabilityApprovals }) {
  const handlers = createCapabilityHandlers({ host, deriveDeleteApproval, capabilityApprovals });
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

// Public descriptors of the tools a host can actually serve: a tool whose service the host lacks is not advertised.
const TOOL_MEMBERS = (name) => {
  if (name.startsWith('environment.lsp.')) return ['lsp'];
  if (name === 'environment.dap.run') return ['dap'];
  if (name === 'environment.browser.run') return ['browser'];
  if (name === 'environment.computer.act') return ['computer', 'approvals'];
  if (name.startsWith('environment.computer.')) return ['computer'];
  return ['memory'];
};
function capabilityToolDescriptors(contracts, host) {
  if (!host) return [];
  return contracts
    .list()
    .filter((contract) => contract.provider === ENVIRONMENT_PROVIDER || contract.provider === MEMORY_PROVIDER)
    .filter((contract) => TOOL_MEMBERS(contract.name).every((name) => host[name] !== undefined))
    .map((contract) =>
      Object.freeze({
        name: contract.name,
        description: `Governed ${contract.name}${contract.requires_approval ? ' (asks for explicit approval)' : ''}; the input is validated against the versioned contract.`,
        inputSchema: Object.freeze({ type: 'object', additionalProperties: true }),
      }),
    );
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
  const host = environmentHost ? validateEnvironmentHost(environmentHost(wiring)) : null;
  const capabilityApprovals = createCapabilityApprovals({
    host,
    tools,
    normalize: (tool, input) => contracts.validateInput(contracts.resolve(tool), input),
  });
  const deriveDeleteApproval = (input, context) => {
    const { operation_id: operationId, resource_scope: resourceScope } = memoryDeleteOperation(input.project_id, input.memory_id);
    // No in-progress check: the grant is issued, spent by the synchronous forget and released in one tick of the loop.
    const approvalId = randomUUID();
    const now = new Date();
    approvalStore.issue({
      approval_id: approvalId,
      operation_id: operationId,
      authorizer: { id: host.memory.operator.id, type: 'human' },
      resource_scope: resourceScope,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + DERIVED_APPROVAL_TTL_MS).toISOString(),
      decision: 'approved',
      policy_version: 'hseos-operational-v1',
      evidence_ref: `hseos://execution/${context.operation_id}/derived-approval/${approvalId}`,
    });
    derivedDeleteApprovals.set(operationId, approvalId);
    return () => derivedDeleteApprovals.delete(operationId);
  };
  for (const [name, provider] of createCapabilityProviders({ host, deriveDeleteApproval, capabilityApprovals }))
    providers.set(name, provider);
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
      // The expected version comes from a table by contract family, so a contract cannot choose its own policy.
      async evaluate({ contract }) {
        return { allowed: true, policy_version: expectedPolicyVersion(contract), requires_approval: false, warnings: [] };
      },
    },
    providers,
    approval_resolver: async (_operation, approvalContext) => approvalContext && approvalContext.approval_id,
    projector,
  });
  const port = createGovernedExecutionPort(runtime);
  const scheduler = new GovernedExecutionScheduler({ contracts, port, maxConcurrency });
  const capabilityTools = capabilityToolDescriptors(contracts, host);
  return Object.freeze({ approvalStore, capabilityApprovals, capabilityTools, contracts, ledger, port, projector, runtime, scheduler });
}

module.exports = {
  ENV_CAPABILITY_UNAVAILABLE,
  expectedPolicyVersion,
  schemaContract,
  createOperationalExecution,
  EXCLUSIVE_TOOLS,
  IDEMPOTENT_PROVIDERS,
  MUTATION_CLASS,
};
