'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { z } = require('zod');

const { assertPortShape } = require('../packages/agent-runtime-contracts');
const {
  ToolRuntime,
  ToolRuntimeError,
  ToolRuntimeRegistry,
  ToolRuntimeRegistryError,
  governanceRef,
  normalizeEnvelope,
} = require('../packages/tool-runtime');
const { ExecutionContractRegistry } = require('../tools/lib/governed-execution/contract-registry');
const { createExecutionEventRegistry } = require('../tools/lib/governed-execution/event-registry');
const { createGovernedExecutionPort } = require('../tools/lib/governed-execution/execution-port');
const { GovernedExecutionRuntime, deterministicOperationId } = require('../tools/lib/governed-execution/runtime');
const { GovernedExecutionScheduler } = require('../tools/lib/governed-execution/scheduler');
const { ExecutionApprovalStore } = require('../tools/mcp-project-state/lib/execution-approval-store');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { ExecutionProjectionStore } = require('../tools/mcp-project-state/lib/execution-projections');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');
const NOW = '2026-08-22T02:00:00.000Z';

function executableSchema(schema, phase, order) {
  const safeParse = schema.safeParse.bind(schema);
  return Object.freeze({
    version: 1,
    safeParse(value) {
      if (order) order.push(phase);
      return safeParse(value);
    },
  });
}

function contract(order = null, overrides = {}) {
  return {
    name: 'fixture.echo',
    capability: 'fixture.echo',
    provider: 'fixture-provider',
    authority: 'fixture.execute',
    policy_version: 'policy-v1',
    reversibility: 'read_only',
    cancellation_policy: 'cooperative',
    failure_mode: 'fail_closed',
    timeout_ms: 250,
    requires_approval: false,
    exclusive: false,
    provider_accepts_idempotency: true,
    sandbox: null,
    prerequisites: [],
    input_schema: executableSchema(z.object({ value: z.string() }).strict(), 'pre', order),
    output_schema: executableSchema(z.object({ echoed: z.string(), nested: z.object({ value: z.string() }) }).strict(), 'post', order),
    ...overrides,
  };
}

function definition(name = 'fixture.echo') {
  return {
    name,
    description: 'Echo a fixture through governed execution.',
    input_schema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    governance_ref: governanceRef(name),
  };
}

function invocation(overrides = {}) {
  return {
    schema_version: 1,
    invocation_id: 'invocation:fixture-1',
    session_id: 'session:fixture-1',
    turn_id: 'turn:fixture-1',
    tool_call_id: 'call:fixture-1',
    name: 'fixture.echo',
    input: { value: 'hello' },
    actor: { id: 'agent:fixture', type: 'agent' },
    resource_scope: { project: 'fixture' },
    idempotency_key: 'idempotency:fixture-1',
    correlation_id: 'correlation:fixture-1',
    causation_id: 'request:fixture-1',
    approval_context: null,
    ...overrides,
  };
}

function setup({ contractValue, provider, order = null, approvalResolver = null } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const eventRegistry = createExecutionEventRegistry();
  const ledger = new ExecutionEventLedger(db, { event_registry: eventRegistry });
  if (order) {
    const append = ledger.append.bind(ledger);
    ledger.append = (request) => {
      const eventTypes = request.events.map((event) => event.event_type);
      if (eventTypes.includes('ExecutionAuthorized')) order.push('authorized');
      if (
        eventTypes.some((type) =>
          ['ExecutionSucceeded', 'ExecutionFailed', 'ExecutionCancelled', 'ExecutionOutcomeUncertain'].includes(type),
        )
      ) {
        order.push('result');
      }
      return append(request);
    };
  }
  const projector = new ExecutionProjectionStore(db, ledger);
  projector.rebuild();
  const approvals = new ExecutionApprovalStore(db);
  const contracts = new ExecutionContractRegistry();
  const registered = contracts.register(contractValue || contract(order));
  const providers = new Map([
    [
      registered.provider,
      provider || {
        async execute(input) {
          if (order) order.push('dispatch');
          return { data: { echoed: input.value, nested: { value: input.value } }, evidence: ['evidence://fixture'] };
        },
      },
    ],
  ]);
  const runtime = new GovernedExecutionRuntime({
    contracts,
    event_registry: eventRegistry,
    ledger,
    approval_store: approvals,
    authority: {
      async evaluate() {
        if (order) order.push('guard:authority');
        return { allowed: true };
      },
    },
    policy: {
      async evaluate() {
        if (order) order.push('guard:policy');
        return {
          allowed: true,
          requires_approval: registered.requires_approval,
          policy_version: registered.policy_version,
          warnings: [],
        };
      },
    },
    providers,
    approval_resolver: approvalResolver,
    projector,
    clock: { now: () => NOW },
    event_id_factory: randomUUID,
  });
  const port = createGovernedExecutionPort(runtime);
  const scheduler = new GovernedExecutionScheduler({ contracts, port, maxConcurrency: 2 });
  const registry = new ToolRuntimeRegistry({ contracts });
  registry.register(definition(registered.name));
  const tools = new ToolRuntime({ registry, scheduler });
  return { approvals, contracts, db, ledger, registry, runtime, scheduler, tools };
}

test('registry exposes deterministic model definitions only when backed by the exact governed contract', () => {
  const contracts = new ExecutionContractRegistry();
  contracts.register(contract(null));
  contracts.register(contract(null, { name: 'alpha.read', capability: 'alpha.read' }));
  const registry = new ToolRuntimeRegistry({ contracts });
  registry.register(definition('fixture.echo'));
  registry.register(definition('alpha.read'));
  assert.deepEqual(
    registry.list().map((tool) => tool.name),
    ['alpha.read', 'fixture.echo'],
  );
  assert.equal(Object.isFrozen(registry.list()[0].input_schema), true);
  assert.throws(() => registry.register(definition('missing.read')), ToolRuntimeRegistryError);
  assert.throws(
    () => {
      const invalid = new ToolRuntimeRegistry({ contracts });
      invalid.register({ ...definition(), governance_ref: 'governance://tool/other' });
    },
    (error) => error.code === 'TOOL_RUNTIME_GOVERNANCE_MISMATCH',
  );
});

test('published runtime source has no provider dispatch or internal governed-runtime import', () => {
  const packageRoot = path.join(__dirname, '..', 'packages', 'tool-runtime');
  const source = fs
    .readdirSync(packageRoot)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(packageRoot, file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /provider\.execute|invokeTool|executionPort\.execute\s*\(/);
  assert.doesNotMatch(source, /tools\/lib\/governed-execution/);
});

test('ToolRuntime rejects scheduler contract drift and satisfies the versioned port shape', async (context) => {
  const first = setup();
  context.after(() => first.db.close());
  assert.deepEqual(assertPortShape('ToolRuntime', first.tools).methods, ['list', 'execute', 'cancel', 'dispose']);
  assert.deepEqual(first.tools.list({ schema_version: 1, session_id: 'session:fixture-1' }).tools, [definition()]);

  const foreignContracts = new ExecutionContractRegistry();
  foreignContracts.register(contract(null));
  const foreignRegistry = new ToolRuntimeRegistry({ contracts: foreignContracts });
  foreignRegistry.register(definition());
  assert.throws(
    () => new ToolRuntime({ registry: foreignRegistry, scheduler: first.scheduler }),
    (error) => error.code === 'TOOL_RUNTIME_GOVERNED_SCHEDULER_REQUIRED',
  );

  let outsideEffects = 0;
  const lookalike = {
    contracts: first.contracts,
    executionPort: { execute() {}, cancelQueued() {} },
    enqueue() {
      outsideEffects += 1;
    },
    snapshot() {},
  };
  assert.throws(
    () => new ToolRuntime({ registry: first.registry, scheduler: lookalike }),
    (error) => error.code === 'TOOL_RUNTIME_GOVERNED_SCHEDULER_REQUIRED',
  );
  assert.equal(outsideEffects, 0);
  const bypassScheduler = new GovernedExecutionScheduler({ contracts: first.contracts, port: lookalike.executionPort });
  assert.throws(
    () => new ToolRuntime({ registry: first.registry, scheduler: bypassScheduler }),
    (error) => error.code === 'TOOL_RUNTIME_GOVERNED_SCHEDULER_REQUIRED',
  );
  const { GovernedExecutionPort } = require('../packages/governed-execution');
  const forgedPort = Object.create(GovernedExecutionPort.prototype);
  Object.defineProperties(forgedPort, {
    execute: { value: lookalike.executionPort.execute },
    cancelQueued: { value: lookalike.executionPort.cancelQueued },
  });
  const forgedScheduler = new GovernedExecutionScheduler({ contracts: first.contracts, port: forgedPort });
  assert.throws(
    () => new ToolRuntime({ registry: first.registry, scheduler: forgedScheduler }),
    (error) => error.code === 'TOOL_RUNTIME_GOVERNED_SCHEDULER_REQUIRED',
  );
  class OverriddenScheduler extends GovernedExecutionScheduler {
    enqueue() {
      outsideEffects += 1;
    }
  }
  const overridden = new OverriddenScheduler({ contracts: first.contracts, port: first.scheduler.executionPort });
  assert.throws(
    () => new ToolRuntime({ registry: first.registry, scheduler: overridden }),
    (error) => error.code === 'TOOL_RUNTIME_GOVERNED_SCHEDULER_REQUIRED',
  );

  const unsealedContracts = new ExecutionContractRegistry();
  unsealedContracts.register(contract(null));
  const unsealedRegistry = new ToolRuntimeRegistry({ contracts: unsealedContracts });
  unsealedRegistry.register(definition());
  assert.throws(
    () =>
      new ToolRuntime({
        registry: unsealedRegistry,
        scheduler: {
          contracts: unsealedContracts,
          executionPort: { execute() {}, cancelQueued() {} },
          enqueue() {},
          snapshot() {},
        },
      }),
    (error) => error.code === 'TOOL_RUNTIME_GOVERNED_SCHEDULER_REQUIRED',
  );
});

test('governed execution preserves pre, guard, approval, dispatch, post and durable result ordering', async (context) => {
  const order = [];
  const approvalId = 'approval:fixture-1';
  const fixture = setup({
    order,
    contractValue: contract(order, { reversibility: 'irreversible_mutation', requires_approval: true }),
    approvalResolver: async () => {
      order.push('approval');
      return approvalId;
    },
  });
  context.after(() => fixture.db.close());
  const input = invocation();
  fixture.approvals.issue({
    approval_id: approvalId,
    operation_id: deterministicOperationId(input.name, input.idempotency_key),
    authorizer: { id: 'human:approver', type: 'human' },
    resource_scope: input.resource_scope,
    issued_at: '2026-08-22T01:59:00.000Z',
    expires_at: '2026-08-22T02:01:00.000Z',
    decision: 'approved',
    policy_version: 'policy-v1',
    evidence_ref: 'evidence://approval',
  });

  const outcome = await fixture.tools.execute(input);
  assert.deepEqual(order, ['pre', 'guard:authority', 'guard:policy', 'approval', 'authorized', 'dispatch', 'post', 'result']);
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.operation_id, deterministicOperationId(input.name, input.idempotency_key));
  assert.deepEqual(outcome.evidence_refs, ['evidence://approval', 'evidence://fixture']);
  assert.equal(Object.isFrozen(outcome), true);
  assert.equal(Object.isFrozen(outcome.result.nested), true);
  assert.throws(() => {
    outcome.result.nested.value = 'mutated';
  }, TypeError);
  const eventTypes = fixture.ledger.readStream('execution', outcome.operation_id).map((event) => event.event_type);
  assert.deepEqual(eventTypes, ['ExecutionAuthorized', 'ExecutionStarted', 'ExecutionSucceeded']);
});

test('approval denial cannot dispatch a classified effect', async (context) => {
  let dispatches = 0;
  const fixture = setup({
    contractValue: contract(null, { reversibility: 'irreversible_mutation', requires_approval: true }),
    provider: {
      async execute() {
        dispatches += 1;
        return { data: { echoed: 'forbidden', nested: { value: 'forbidden' } } };
      },
    },
    approvalResolver: async () => null,
  });
  context.after(() => fixture.db.close());
  const outcome = await fixture.tools.execute(invocation());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error.code, 'EXECUTION_APPROVAL_REQUIRED');
  assert.equal(dispatches, 0);
});

test('settled retries reuse the governed operation without a second dispatch', async (context) => {
  let dispatches = 0;
  const fixture = setup({
    provider: {
      async execute(input) {
        dispatches += 1;
        return { data: { echoed: input.value, nested: { value: input.value } }, evidence: ['evidence://fixture'] };
      },
    },
  });
  context.after(() => fixture.db.close());
  const first = await fixture.tools.execute(invocation());
  const replay = await fixture.tools.execute(invocation({ invocation_id: 'invocation:fixture-replay' }));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.operation_id, first.operation_id);
  assert.equal(dispatches, 1);
});

test('concurrent equivalent idempotent invocations coalesce on one governed outcome', async (context) => {
  let dispatches = 0;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const fixture = setup({
    provider: {
      async execute(input) {
        dispatches += 1;
        await barrier;
        return { data: { echoed: input.value, nested: { value: input.value } } };
      },
    },
  });
  context.after(() => fixture.db.close());
  const first = fixture.tools.execute(invocation());
  const second = fixture.tools.execute(invocation({ invocation_id: 'invocation:fixture-concurrent' }));
  release();
  const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
  assert.equal(firstOutcome.status, 'succeeded');
  assert.equal(secondOutcome.status, 'succeeded');
  assert.equal(secondOutcome.operation_id, firstOutcome.operation_id);
  assert.equal(dispatches, 1);
});

test('an in-flight deferred tool cannot be joined from a different trace or causation', async (context) => {
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const fixture = setup({
    provider: {
      async execute(input) {
        await barrier;
        return { data: { echoed: input.value, nested: { value: input.value } } };
      },
    },
  });
  context.after(() => fixture.db.close());
  const first = fixture.tools.execute(invocation());
  await assert.rejects(
    () =>
      fixture.tools.execute(
        invocation({ invocation_id: 'invocation:trace-drift', correlation_id: 'correlation:other', causation_id: 'request:other' }),
      ),
    (error) => error instanceof ToolRuntimeError && error.code === 'TOOL_RUNTIME_OPERATION_ACTIVE',
  );
  release();
  assert.equal((await first).status, 'succeeded');
  const settledDrift = await fixture.tools.execute(
    invocation({ invocation_id: 'invocation:settled-trace-drift', correlation_id: 'correlation:other', causation_id: 'request:other' }),
  );
  assert.equal(settledDrift.status, 'failed');
  assert.equal(settledDrift.error.code, 'EXECUTION_IDEMPOTENCY_SCOPE_CONFLICT');
  const operationId = deterministicOperationId('fixture.echo', 'idempotency:fixture-1');
  const rows = fixture.ledger.readStream('execution', operationId);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.correlation_id === 'correlation:fixture-1'));
});

test('post-effect evidence accepted by the canonical runtime is preserved without a tighter adapter bound', async (context) => {
  const evidence = Array.from({ length: 1025 }, (_, index) => `evidence://fixture/${index}`);
  const fixture = setup({
    provider: {
      async execute(input) {
        return { data: { echoed: input.value, nested: { value: input.value } }, evidence };
      },
    },
  });
  context.after(() => fixture.db.close());
  const outcome = await fixture.tools.execute(invocation());
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.evidence_refs.length, evidence.length);
  assert.deepEqual(outcome.evidence_refs, evidence);
});

test('deadline and active cancellation settle through governed terminal outcomes', async (context) => {
  const deadlineFixture = setup({
    contractValue: contract(null, { timeout_ms: 20 }),
    provider: {
      async execute() {
        return new Promise(() => {});
      },
    },
  });
  context.after(() => deadlineFixture.db.close());
  const deadline = await deadlineFixture.tools.execute(invocation());
  assert.equal(deadline.status, 'uncertain');
  assert.equal(deadline.error.code, 'EXECUTION_OUTCOME_IN_DOUBT');

  let started;
  const providerStarted = new Promise((resolve) => {
    started = resolve;
  });
  const cancelFixture = setup({
    provider: {
      async execute(_input, { signal }) {
        started();
        return new Promise((resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('cancelled by fixture');
              error.outcome = 'cancelled';
              reject(error);
            },
            { once: true },
          );
        });
      },
    },
  });
  context.after(() => cancelFixture.db.close());
  const running = cancelFixture.tools.execute(invocation({ invocation_id: 'invocation:cancel-1' }));
  await providerStarted;
  assert.equal(
    cancelFixture.tools.cancel({
      schema_version: 1,
      invocation_id: 'invocation:cancel-1',
      session_id: 'session:other',
      turn_id: 'turn:fixture-1',
      tool_call_id: 'call:fixture-1',
      reason: 'forged cross-session cancel',
    }).accepted,
    false,
  );
  assert.equal(
    cancelFixture.tools.cancel({
      schema_version: 1,
      invocation_id: 'invocation:cancel-1',
      session_id: 'session:fixture-1',
      turn_id: 'turn:fixture-1',
      tool_call_id: 'call:fixture-1',
      reason: 'user cancelled',
    }).accepted,
    true,
  );
  const cancelled = await running;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.error.code, 'EXECUTION_CANCELLED');
  assert.equal(cancelFixture.ledger.readStream('execution', cancelled.operation_id).at(-1).event_type, 'ExecutionCancelled');
});

test('session disposal reports non-cancellable work without waiting or suppressing its outcome', async (context) => {
  let started;
  let complete;
  const providerStarted = new Promise((resolve) => {
    started = resolve;
  });
  const providerCompletion = new Promise((resolve) => {
    complete = resolve;
  });
  const fixture = setup({
    contractValue: contract(null, { cancellation_policy: 'non_cancellable' }),
    provider: {
      async execute(input) {
        started();
        await providerCompletion;
        return { data: { echoed: input.value, nested: { value: input.value } } };
      },
    },
  });
  context.after(() => fixture.db.close());
  const running = fixture.tools.execute(invocation({ invocation_id: 'invocation:non-cancellable' }));
  await providerStarted;
  const disposed = fixture.tools.dispose({ schema_version: 1, session_id: 'session:fixture-1' });
  assert.equal(disposed.accepted, false);
  complete();
  assert.equal((await running).status, 'succeeded');
});

test('duplicate active calls, unknown tools and malformed outcomes fail closed', async (context) => {
  let started;
  const providerStarted = new Promise((resolve) => {
    started = resolve;
  });
  const fixture = setup({
    provider: {
      async execute(_input, { signal }) {
        started();
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { outcome: 'cancelled' })), {
            once: true,
          });
        });
      },
    },
  });
  context.after(() => fixture.db.close());
  const active = fixture.tools.execute(invocation());
  await providerStarted;
  await assert.rejects(
    () => fixture.tools.execute(invocation()),
    (error) => error.code === 'TOOL_RUNTIME_INVOCATION_ACTIVE',
  );
  await assert.rejects(
    () => fixture.tools.execute(invocation({ invocation_id: 'invocation:unknown', name: 'missing.tool' })),
    (error) => error.code === 'TOOL_RUNTIME_TOOL_NOT_FOUND',
  );
  assert.throws(
    () => normalizeEnvelope(invocation(), { ok: true, data: {}, error: null, evidence: [], warnings: [], schema_version: 1 }),
    (error) => error instanceof ToolRuntimeError && error.code === 'TOOL_RUNTIME_OUTCOME_INVALID',
  );
  fixture.tools.cancel({
    schema_version: 1,
    invocation_id: 'invocation:fixture-1',
    session_id: 'session:fixture-1',
    turn_id: 'turn:fixture-1',
    tool_call_id: 'call:fixture-1',
    reason: 'cleanup',
  });
  assert.equal((await active).status, 'cancelled');
});
