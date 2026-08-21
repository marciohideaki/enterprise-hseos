'use strict';

const Ajv2020 = require('ajv/dist/2020');

const { ExecutionContractRegistry } = require('./contract-registry');
const { createExecutionEventRegistry } = require('./event-registry');
const { createGovernedExecutionPort } = require('./execution-port');
const { GovernedExecutionRuntime } = require('./runtime');
const { GovernedExecutionScheduler } = require('./scheduler');
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
const EXCLUSIVE_TOOLS = new Set(['consolidate_handoff', 'plan_squad', 'run_pipeline']);
const IDEMPOTENT_PROVIDERS = new Set(['run_create', 'scheduler_sweep_orphans', 'tasks_add']);

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

function createOperationalExecution({ db, serverId, tools, invokeTool, maxConcurrency = 4, toolGovernance = {} }) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Operational execution requires a SQLite database');
  if (!(tools instanceof Map) || tools.size === 0) throw new TypeError('Operational execution requires a non-empty tool map');
  if (typeof invokeTool !== 'function') throw new TypeError('Operational execution requires a provider invoker');

  const contracts = new ExecutionContractRegistry();
  const providers = new Map();
  for (const [name, tool] of tools) {
    const governance = toolGovernance[name] || {};
    const reversibility = governance.reversibility || MUTATION_CLASS[name] || 'read_only';
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
      provider_accepts_idempotency:
        governance.provider_accepts_idempotency === true || IDEMPOTENT_PROVIDERS.has(name),
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

  const eventRegistry = createExecutionEventRegistry();
  const ledger = new ExecutionEventLedger(db, { event_registry: eventRegistry });
  const projector = new ExecutionProjectionStore(db, ledger);
  if (projector.health().reason === 'no_active_generation') projector.rebuild();
  const approvalStore = new ExecutionApprovalStore(db);
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
      async evaluate() {
        return { allowed: true, policy_version: 'hseos-operational-v1', requires_approval: false, warnings: [] };
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

module.exports = { createOperationalExecution, EXCLUSIVE_TOOLS, IDEMPOTENT_PROVIDERS, MUTATION_CLASS };
