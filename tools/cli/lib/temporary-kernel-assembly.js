'use strict';

const { randomUUID } = require('node:crypto');

const { AgentRuntime } = require('../../../packages/agent-runtime');
const { RelationalSessionEventStore } = require('../../../packages/agent-session-store');
const { ToolRuntime, ToolRuntimeRegistry } = require('../../../packages/tool-runtime');
const { ExecutionContractRegistry } = require('../../lib/governed-execution/contract-registry');
const { createExecutionEventRegistry } = require('../../lib/governed-execution/event-registry');
const { createGovernedExecutionPort } = require('../../lib/governed-execution/execution-port');
const { GovernedExecutionRuntime } = require('../../lib/governed-execution/runtime');
const { GovernedExecutionScheduler } = require('../../lib/governed-execution/scheduler');
const { ExecutionApprovalStore } = require('../../mcp-project-state/lib/execution-approval-store');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { ExecutionProjectionStore } = require('../../mcp-project-state/lib/execution-projections');

class TemporaryKernelAssemblyError extends Error {
  constructor(message, code = 'TEMPORARY_KERNEL_ASSEMBLY_INVALID') {
    super(message);
    this.name = 'TemporaryKernelAssemblyError';
    this.code = code;
  }
}

function validateToolBundles(toolBundles) {
  if (!Array.isArray(toolBundles)) throw new TemporaryKernelAssemblyError('tool_bundles must be an array');
  const names = new Set();
  const providers = new Set();
  for (const bundle of toolBundles) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      throw new TemporaryKernelAssemblyError('each tool bundle must be an object');
    }
    const actual = Object.keys(bundle).sort();
    if (JSON.stringify(actual) !== JSON.stringify(['contract', 'definition', 'provider'])) {
      throw new TemporaryKernelAssemblyError('tool bundle has an invalid shape');
    }
    if (bundle.contract?.name !== bundle.definition?.name || names.has(bundle.contract?.name)) {
      throw new TemporaryKernelAssemblyError('tool bundle names must be matching and unique');
    }
    if (providers.has(bundle.contract?.provider)) {
      throw new TemporaryKernelAssemblyError('temporary tool providers must be unique');
    }
    if (!bundle.provider || typeof bundle.provider.execute !== 'function') {
      throw new TemporaryKernelAssemblyError('tool bundle provider must implement execute');
    }
    names.add(bundle.contract.name);
    providers.add(bundle.contract.provider);
  }
  return toolBundles;
}

function assembleTemporaryKernel({
  db,
  model_provider_snapshot,
  context_profile_resolver,
  tool_bundles = [],
  max_concurrency = 1,
  runtime_clock = Date,
  execution_clock = { now: () => new Date().toISOString() },
}) {
  if (!db?.open) throw new TemporaryKernelAssemblyError('an open temporary SQLite database is required');
  if (!Number.isInteger(max_concurrency) || max_concurrency < 1 || max_concurrency > 64) {
    throw new TemporaryKernelAssemblyError('max_concurrency must be between 1 and 64');
  }
  const bundles = validateToolBundles(tool_bundles);
  const eventRegistry = createExecutionEventRegistry();
  const executionLedger = new ExecutionEventLedger(db, { event_registry: eventRegistry });
  const sessionStore = new RelationalSessionEventStore({ ledger: executionLedger });
  const projection = new ExecutionProjectionStore(db, executionLedger);
  projection.rebuild();
  const contracts = new ExecutionContractRegistry();
  for (const bundle of bundles) contracts.register(bundle.contract);
  const governed = new GovernedExecutionRuntime({
    contracts,
    event_registry: eventRegistry,
    ledger: executionLedger,
    approval_store: new ExecutionApprovalStore(db),
    authority: {
      async evaluate() {
        return { allowed: true };
      },
    },
    policy: {
      async evaluate({ contract }) {
        return { allowed: true, requires_approval: false, policy_version: contract.policy_version, warnings: [] };
      },
    },
    providers: new Map(bundles.map((bundle) => [bundle.contract.provider, bundle.provider])),
    projector: projection,
    clock: execution_clock,
    event_id_factory: randomUUID,
  });
  const toolRegistry = new ToolRuntimeRegistry({ contracts });
  for (const bundle of bundles) toolRegistry.register(bundle.definition);
  const toolRuntime = new ToolRuntime({
    registry: toolRegistry,
    scheduler: new GovernedExecutionScheduler({
      contracts,
      port: createGovernedExecutionPort(governed),
      maxConcurrency: max_concurrency,
    }),
  });
  const runtime = new AgentRuntime({
    session_store: sessionStore,
    model_provider_snapshot,
    tool_runtime: toolRuntime,
    context_profile_resolver,
    clock: runtime_clock,
  });
  return Object.freeze({ executionLedger, projection, runtime, sessionStore, toolRuntime });
}

module.exports = { TemporaryKernelAssemblyError, assembleTemporaryKernel };
