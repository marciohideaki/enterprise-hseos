'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { executionEnvelope } = require('../tools/lib/governed-execution/canonical-envelope');
const { createEntrypointAdapters, ENTRYPOINT_SURFACES } = require('../tools/lib/governed-execution/entrypoint-adapters');
const {
  createNativeMcpAdapters,
  loadNativeMcpCatalogs,
  NATIVE_MCP_SERVERS,
} = require('../tools/lib/governed-execution/native-mcp-adapters');
const { deterministicOperationId } = require('../tools/lib/governed-execution/runtime');
const { GovernedExecutionScheduler } = require('../tools/lib/governed-execution/scheduler');
const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} = require('../tools/lib/mcp-2026-adapter');
const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');

function contractResolver(exclusiveTools = [], nonCancellableTools = []) {
  const exclusive = new Set(exclusiveTools);
  const nonCancellable = new Set(nonCancellableTools);
  return {
    resolve: (tool) => ({
      cancellation_policy: nonCancellable.has(tool) ? 'non_cancellable' : 'cooperative',
      exclusive: exclusive.has(tool),
    }),
  };
}

function success(request, result = request.input) {
  return executionEnvelope({
    ok: true,
    data: {
      operation_id: deterministicOperationId(request.tool, request.idempotency_key),
      result,
      replayed: false,
    },
    evidence: ['evidence://shared-port'],
    warnings: ['shared-warning'],
  });
}

function cancellationEnvelope(request, message = 'cancelled before dispatch') {
  return executionEnvelope({
    ok: false,
    error: {
      code: 'EXECUTION_CANCELLED',
      message,
      operation_id: deterministicOperationId(request.tool, request.idempotency_key),
      retryable: false,
    },
    evidence: ['event://ExecutionCancelled'],
  });
}

function testPort(execute, cancelQueued = async (request, reason) => cancellationEnvelope(request, String(reason))) {
  return { cancelQueued, execute };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('CLI, hook, project-state, and SWARM preserve identical governed-port semantics', async () => {
  const requests = [];
  const scheduler = new GovernedExecutionScheduler({
    contracts: contractResolver(),
    maxConcurrency: 4,
    port: testPort(async (request) => {
      requests.push(request);
      return success(request, { echoed: request.input.value });
    }),
  });
  const adapters = createEntrypointAdapters({
    scheduler,
    resolvers: {
      default: {
        resolveActor: async () => ({ id: 'actor-1', type: 'human' }),
        resolveResourceScope: async () => ({ project: 'fixture' }),
      },
    },
  });

  const outcomes = await Promise.all(
    ENTRYPOINT_SURFACES.map((surface) =>
      adapters[surface].invoke({
        tool: 'fixture.echo',
        input: { value: 'uniform' },
        idempotencyKey: 'shared-idempotency-key',
      }),
    ),
  );

  for (const outcome of outcomes.slice(1)) assert.deepEqual(outcome, outcomes[0]);
  assert.equal(requests.length, 4);
  assert.deepEqual(
    requests.map((request) => request.actor),
    Array.from({ length: 4 }, () => ({ id: 'actor-1', type: 'human' })),
  );
  assert.deepEqual(
    requests.map((request) => request.resource_scope),
    Array.from({ length: 4 }, () => ({ project: 'fixture' })),
  );
  assert.equal(scheduler.snapshot().totals.started, 4);
});

test('entrypoint context failure and malformed port output fail as canonical envelopes', async () => {
  const scheduler = new GovernedExecutionScheduler({
    contracts: contractResolver(),
    port: testPort(async () => ({ ok: true })),
  });
  const adapters = createEntrypointAdapters({
    scheduler,
    resolvers: {
      default: {
        resolveActor: async () => ({ id: 'actor-1', type: 'human' }),
        resolveResourceScope: async () => ({ project: 'fixture' }),
      },
      hook: {
        resolveActor: async () => {
          const error = new Error('hook identity unavailable');
          error.code = 'EXECUTION_ACTOR_UNAVAILABLE';
          throw error;
        },
        resolveResourceScope: async () => ({ project: 'fixture' }),
      },
    },
  });

  const hookFailure = await adapters.hook.invoke({ tool: 'fixture.echo', idempotencyKey: 'hook-key' });
  assert.equal(hookFailure.error.code, 'EXECUTION_ACTOR_UNAVAILABLE');
  assert.equal(hookFailure.error.operation_id, deterministicOperationId('fixture.echo', 'hook-key'));
  const malformedPort = await adapters.cli.invoke({ tool: 'fixture.echo', idempotencyKey: 'cli-key' });
  assert.equal(malformedPort.error.code, 'EXECUTION_ENVELOPE_INVALID');
  assert.equal(scheduler.snapshot().totals.started, 1, 'resolver failure must not enter the scheduler');
});

test('all four native MCP catalogs are handler-free and call only the governed scheduler', async () => {
  const catalogs = loadNativeMcpCatalogs();
  assert.deepEqual(Object.keys(catalogs).sort(), Object.keys(NATIVE_MCP_SERVERS).sort());
  for (const catalog of Object.values(catalogs)) {
    assert.ok(catalog.length > 0);
    assert.equal(catalog.some((tool) => Object.hasOwn(tool, 'handler')), false);
  }
  const governanceDescriptor = catalogs.governance.find((tool) => tool.name === 'query_constitution');
  assert.equal(Object.isFrozen(governanceDescriptor), true);
  assert.equal(Object.isFrozen(governanceDescriptor.inputSchema), true);
  assert.equal(Object.isFrozen(governanceDescriptor.inputSchema.properties), true);
  assert.throws(() => {
    governanceDescriptor.inputSchema.properties.injected = { type: 'string' };
  }, TypeError);
  assert.equal(
    Object.hasOwn(
      loadNativeMcpCatalogs().governance.find((tool) => tool.name === 'query_constitution').inputSchema.properties,
      'injected',
    ),
    false,
  );

  const requests = [];
  const scheduler = new GovernedExecutionScheduler({
    contracts: contractResolver(),
    port: testPort(async (request) => {
      requests.push(request);
      return success(request, { server: request.resource_scope.server });
    }),
  });
  const adapters = createNativeMcpAdapters({
    scheduler,
    resolvers: {
      default: {
        resolveActor: async () => ({ id: 'mcp-actor', type: 'service' }),
        resolveResourceScope: async ({ tool }) => ({ project: 'fixture', server: tool }),
      },
    },
  });
  const calls = {
    axon_bridge: ['get_overview', {}],
    governance: ['query_constitution', {}],
    project_state: ['state_read', {}],
    swarm: ['list_runs', {}],
  };
  const responses = await Promise.all(
    Object.entries(calls).map(([server, [name, argumentsValue]], index) =>
      adapters[server].handle({
        jsonrpc: '2.0',
        id: index + 1,
        method: 'tools/call',
        params: {
          name,
          arguments: argumentsValue,
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
            [CLIENT_INFO_META_KEY]: { name: 'g6-fixture', version: '1.0.0' },
            [CLIENT_CAPABILITIES_META_KEY]: {},
            'io.hseos/idempotencyKey': `native-${server}`,
          },
        },
      }),
    ),
  );
  assert.equal(responses.every((response) => !response.error), true);
  assert.deepEqual(requests.map((request) => request.tool).sort(), Object.values(calls).map(([name]) => name).sort());
  assert.equal(scheduler.snapshot().totals.started, 4);
});

test('exclusive contracts form FIFO barriers around bounded parallel work', async () => {
  const starts = [];
  const resolvers = new Map();
  const scheduler = new GovernedExecutionScheduler({
    contracts: contractResolver(['exclusive']),
    maxConcurrency: 2,
    port: testPort((request) => {
      starts.push(request.idempotency_key);
      return new Promise((resolve) => resolvers.set(request.idempotency_key, () => resolve(success(request))));
    }),
  });
  const request = (tool, key) => ({
    tool,
    input: {},
    actor: { id: 'a', type: 'human' },
    resource_scope: { project: 'fixture' },
    idempotency_key: key,
  });

  const first = scheduler.enqueue(request('normal', 'n1'));
  const second = scheduler.enqueue(request('normal', 'n2'));
  const barrier = scheduler.enqueue(request('exclusive', 'x1'));
  const after = scheduler.enqueue(request('normal', 'n3'));
  await tick();
  assert.deepEqual(starts, ['n1', 'n2']);

  resolvers.get('n1')();
  await tick();
  assert.deepEqual(starts, ['n1', 'n2'], 'exclusive task waits for every active task');
  resolvers.get('n2')();
  await tick();
  assert.deepEqual(starts, ['n1', 'n2', 'x1']);
  assert.equal(scheduler.snapshot().exclusive_running, true);

  resolvers.get('x1')();
  await tick();
  assert.deepEqual(starts, ['n1', 'n2', 'x1', 'n3']);
  resolvers.get('n3')();
  await Promise.all([first.promise, second.promise, barrier.promise, after.promise]);
  assert.equal(scheduler.snapshot().active, 0);
  assert.equal(scheduler.snapshot().totals.completed, 4);
});

test('queued cancellation settles without dispatch or provider side effects', async () => {
  let releaseFirst;
  let sideEffects = 0;
  const seen = [];
  const scheduler = new GovernedExecutionScheduler({
    contracts: contractResolver(),
    maxConcurrency: 1,
    maxQueue: 1,
    port: testPort(
      async (request) => {
        seen.push({ key: request.idempotency_key, aborted: request.signal.aborted });
        sideEffects += 1;
        if (request.idempotency_key === 'first') await new Promise((resolve) => (releaseFirst = resolve));
        return success(request);
      },
      async (request, reason) => {
        seen.push({ key: request.idempotency_key, cancelled: true });
        return cancellationEnvelope(request, String(reason));
      },
    ),
  });
  const request = (key) => ({
    tool: 'normal',
    input: {},
    actor: { id: 'a', type: 'human' },
    resource_scope: { project: 'fixture' },
    idempotency_key: key,
  });
  const first = scheduler.enqueue(request('first'));
  const cancelled = scheduler.enqueue(request('cancelled'));
  const rejected = scheduler.enqueue(request('overflow'));
  assert.equal(cancelled.cancel('caller stopped waiting'), true);
  await tick();
  assert.equal((await rejected.promise).error.code, 'EXECUTION_SCHEDULER_CAPACITY');

  releaseFirst();
  const [, cancelledOutcome] = await Promise.all([first.promise, cancelled.promise]);
  assert.equal(cancelledOutcome.error.code, 'EXECUTION_CANCELLED');
  assert.deepEqual(seen, [
    { key: 'first', aborted: false },
    { key: 'cancelled', cancelled: true },
  ]);
  assert.equal(sideEffects, 1);

  await scheduler.close();
  const afterClose = await scheduler.execute(request('closed'));
  assert.equal(afterClose.error.code, 'EXECUTION_SCHEDULER_CLOSED');
  const invalidSignal = new GovernedExecutionScheduler({
    contracts: contractResolver(),
    port: testPort(async (scheduledRequest) => success(scheduledRequest)),
  });
  const invalidSignalOutcome = await invalidSignal.execute({ ...request('bad-signal'), signal: {} });
  assert.equal(invalidSignalOutcome.error.code, 'EXECUTION_REQUEST_INVALID');
  assert.equal(invalidSignal.snapshot().totals.started, 0);

  let releaseExternalBlocker;
  const externallyCancelledCalls = [];
  const externallyCancelled = new GovernedExecutionScheduler({
    contracts: contractResolver(),
    maxConcurrency: 1,
    port: testPort(async (scheduledRequest) => {
      externallyCancelledCalls.push(scheduledRequest.idempotency_key);
      if (scheduledRequest.idempotency_key === 'external-blocker') {
        await new Promise((resolve) => (releaseExternalBlocker = resolve));
      }
      return success(scheduledRequest);
    }),
  });
  const externalBlocker = externallyCancelled.enqueue(request('external-blocker'));
  const externalController = new AbortController();
  const externalQueued = externallyCancelled.enqueue({ ...request('external-queued'), signal: externalController.signal });
  externalController.abort('external cancellation');
  const preAbortedController = new AbortController();
  preAbortedController.abort('already cancelled');
  const preAborted = externallyCancelled.enqueue({ ...request('pre-aborted'), signal: preAbortedController.signal });
  assert.equal((await externalQueued.promise).error.code, 'EXECUTION_CANCELLED');
  assert.equal((await preAborted.promise).error.code, 'EXECUTION_CANCELLED');
  releaseExternalBlocker();
  await externalBlocker.promise;
  assert.deepEqual(externallyCancelledCalls, ['external-blocker']);

  const nonCancellable = new GovernedExecutionScheduler({
    contracts: contractResolver([], ['non-cancellable']),
    maxConcurrency: 1,
    port: testPort(async (scheduledRequest) => success(scheduledRequest)),
  });
  const nonCancellableHandle = nonCancellable.enqueue({ ...request('cannot-cancel'), tool: 'non-cancellable' });
  assert.equal(nonCancellableHandle.cancel(), false);
  assert.equal((await nonCancellableHandle.promise).ok, true);
  assert.equal(nonCancellable.snapshot().totals.cancellation_refused, 1);
});

test('queued cancellation is a durability barrier and persistence failure halts downstream dispatch', async () => {
  let persistCancellation;
  const starts = [];
  const scheduler = new GovernedExecutionScheduler({
    contracts: contractResolver(['exclusive']),
    maxConcurrency: 3,
    port: testPort(
      async (request) => {
        starts.push(request.idempotency_key);
        return success(request);
      },
      (request) => new Promise((resolve) => (persistCancellation = () => resolve(cancellationEnvelope(request)))),
    ),
  });
  const request = (tool, key) => ({
    tool,
    input: {},
    actor: { id: 'a', type: 'human' },
    resource_scope: { project: 'fixture' },
    idempotency_key: key,
  });
  const blocker = scheduler.enqueue(request('normal', 'first'));
  const barrier = scheduler.enqueue(request('exclusive', 'cancelled-exclusive'));
  assert.equal(barrier.cancel(), true);
  const after = scheduler.enqueue(request('normal', 'after'));
  await tick();
  assert.deepEqual(starts, ['first']);
  assert.equal(scheduler.snapshot().exclusive_running, true);
  persistCancellation();
  assert.equal((await barrier.promise).error.code, 'EXECUTION_CANCELLED');
  await Promise.all([blocker.promise, after.promise]);
  assert.deepEqual(starts, ['first', 'after']);

  let releaseFirst;
  const failedStarts = [];
  const failed = new GovernedExecutionScheduler({
    contracts: contractResolver(['exclusive']),
    maxConcurrency: 3,
    port: testPort(
      async (scheduledRequest) => {
        failedStarts.push(scheduledRequest.idempotency_key);
        if (scheduledRequest.idempotency_key === 'first') await new Promise((resolve) => (releaseFirst = resolve));
        return success(scheduledRequest);
      },
      async () => {
        throw Object.assign(new Error('ledger unavailable'), { code: 'EXECUTION_LEDGER_UNAVAILABLE' });
      },
    ),
  });
  const failedFirst = failed.enqueue(request('normal', 'first'));
  const failedBarrier = failed.enqueue(request('exclusive', 'failed-exclusive'));
  failedBarrier.cancel();
  const rejectedAfter = failed.enqueue(request('normal', 'must-not-dispatch'));
  assert.equal((await failedBarrier.promise).error.code, 'EXECUTION_LEDGER_UNAVAILABLE');
  assert.equal((await rejectedAfter.promise).error.code, 'EXECUTION_SCHEDULER_HALTED');
  assert.deepEqual(failedStarts, ['first']);
  releaseFirst();
  await failedFirst.promise;
  await failed.drain();
});
