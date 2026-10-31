'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { executionEnvelope } = require('../tools/lib/governed-execution/canonical-envelope');
const {
  createEntrypointAdapters,
  ENTRYPOINT_SURFACES,
  EntrypointAdapterError,
  GovernedEntrypointAdapter,
} = require('../tools/lib/governed-execution/entrypoint-adapters');
const {
  createNativeMcpAdapter,
  createNativeMcpAdapters,
  loadNativeMcpCatalogs,
} = require('../tools/lib/governed-execution/native-mcp-adapters');

const resolver = {
  resolveActor: async () => ({ id: 'actor-1', type: 'human' }),
  resolveResourceScope: async () => ({ project: 'fixture' }),
};

function scheduler(execute) {
  return { execute };
}

function okEnvelope(request) {
  return executionEnvelope({ ok: true, data: { operation_id: 'op', result: request.input, replayed: false }, evidence: [], warnings: [] });
}

test('an adapter refuses an unsupported surface, a missing scheduler and missing resolvers', () => {
  const base = { surface: 'cli', scheduler: scheduler(async () => null), ...resolver };
  assert.throws(
    () => new GovernedEntrypointAdapter({ ...base, surface: 'web' }),
    (error) => {
      assert.ok(error instanceof EntrypointAdapterError);
      assert.equal(error.name, 'EntrypointAdapterError');
      assert.equal(error.code, 'EXECUTION_ADAPTER_INVALID');
      assert.match(error.message, /Unsupported execution surface: web/);
      return true;
    },
  );
  assert.throws(() => new GovernedEntrypointAdapter({ ...base, scheduler: undefined }), /cli adapter requires the governed scheduler/);
  assert.throws(() => new GovernedEntrypointAdapter({ ...base, scheduler: {} }), /cli adapter requires the governed scheduler/);
  assert.throws(() => new GovernedEntrypointAdapter({ ...base, resolveActor: undefined }), /requires actor and resource-scope resolvers/);
  assert.throws(() => new GovernedEntrypointAdapter({ ...base, resolveResourceScope: 'x' }), /requires actor and resource-scope resolvers/);
});

test('the factory refuses a surface that has neither its own resolver nor a default', () => {
  const only = { cli: resolver, hook: resolver, project_state: resolver };
  assert.throws(
    () => createEntrypointAdapters({ scheduler: scheduler(async () => null), resolvers: only }),
    /Missing resolver configuration for swarm/,
  );
  assert.throws(() => createEntrypointAdapters({ scheduler: scheduler(async () => null) }), /Missing resolver configuration for cli/);
  const adapters = createEntrypointAdapters({ scheduler: scheduler(async () => null), resolvers: { ...only, swarm: resolver } });
  assert.deepEqual(Object.keys(adapters), ENTRYPOINT_SURFACES);
  assert.ok(Object.isFrozen(adapters));
  assert.ok(Object.isFrozen(adapters.cli));
});

test('an invocation without a tool or with a bad idempotency key is a failure envelope that never reaches the scheduler', async () => {
  let reached = 0;
  const adapter = new GovernedEntrypointAdapter({
    surface: 'cli',
    scheduler: scheduler(async (request) => {
      reached += 1;
      return okEnvelope(request);
    }),
    ...resolver,
  });

  for (const tool of [undefined, '', 7]) {
    const envelope = await adapter.invoke({ tool });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'EXECUTION_REQUEST_INVALID');
    assert.match(envelope.error.message, /requires a tool/);
  }
  for (const idempotencyKey of ['', 42]) {
    const envelope = await adapter.invoke({ tool: 'x.tool', idempotencyKey });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'EXECUTION_REQUEST_INVALID');
    assert.match(envelope.error.message, /idempotency key must be a non-empty string/);
  }
  assert.equal(reached, 0);
});

test('a resolver or scheduler that throws becomes a failure envelope carrying the operation id', async () => {
  const failingActor = new GovernedEntrypointAdapter({
    surface: 'hook',
    scheduler: scheduler(async (request) => okEnvelope(request)),
    resolveActor: async () => {
      throw new Error('actor lookup failed');
    },
    resolveResourceScope: resolver.resolveResourceScope,
  });
  const actorFailure = await failingActor.invoke({ tool: 'x.tool', idempotencyKey: 'k1' });
  assert.equal(actorFailure.ok, false);
  assert.match(actorFailure.error.message, /actor lookup failed/);
  assert.ok(actorFailure.error.operation_id);

  const failingScheduler = new GovernedEntrypointAdapter({
    surface: 'swarm',
    scheduler: scheduler(async () => {
      throw 'not an error object';
    }),
    ...resolver,
  });
  const thrown = await failingScheduler.invoke({ tool: 'x.tool', idempotencyKey: 'k2' });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error.code, 'EXECUTION_ADAPTER_FAILED');
  assert.match(thrown.error.message, /Entrypoint adapter failed/);
});

test('an outcome that is not a canonical envelope is refused instead of passed through', async () => {
  const adapter = new GovernedEntrypointAdapter({
    surface: 'project_state',
    scheduler: scheduler(async () => ({ ok: true, ad_hoc: 'shape' })),
    ...resolver,
  });
  const envelope = await adapter.invoke({ tool: 'x.tool', idempotencyKey: 'k3' });
  assert.equal(envelope.ok, false);
});

test('the request carries derived correlation ids, an approval context and the abort signal only when given', async () => {
  const seen = [];
  const adapter = new GovernedEntrypointAdapter({
    surface: 'cli',
    scheduler: scheduler(async (request) => {
      seen.push(request);
      return okEnvelope(request);
    }),
    ...resolver,
  });
  await adapter.invoke({ tool: 'x.tool', input: { a: 1 }, idempotencyKey: 'plain' });
  const controller = new AbortController();
  await adapter.invoke({
    tool: 'x.tool',
    idempotencyKey: 'full',
    correlationId: 'corr-1',
    causationId: 'cause-1',
    approvalContext: { approval: 'a-1' },
    signal: controller.signal,
  });
  const [plain, full] = seen;
  assert.match(plain.correlation_id, /^cli:/);
  assert.match(plain.causation_id, /^cli-request:/);
  assert.equal('approval_context' in plain, false);
  assert.equal('signal' in plain, false);
  assert.deepEqual(plain.input, { a: 1 });
  assert.equal(full.correlation_id, 'corr-1');
  assert.equal(full.causation_id, 'cause-1');
  assert.deepEqual(full.approval_context, { approval: 'a-1' });
  assert.equal(full.signal, controller.signal);
});

test('native MCP adapters refuse a missing scheduler, missing resolvers and an incomplete resolver per server', () => {
  const sched = scheduler(async () => null);
  assert.throws(() => createNativeMcpAdapters({ resolvers: { default: resolver } }), /Native MCP adapters require the governed scheduler/);
  assert.throws(() => createNativeMcpAdapters({ scheduler: {}, resolvers: { default: resolver } }), /require the governed scheduler/);
  assert.throws(() => createNativeMcpAdapters({ scheduler: sched }), /require server-scoped resolvers/);
  assert.throws(() => createNativeMcpAdapters({ scheduler: sched, resolvers: 'x' }), /require server-scoped resolvers/);
  assert.throws(
    () => createNativeMcpAdapters({ scheduler: sched, resolvers: {} }),
    /Missing actor\/resource resolver for native MCP server: axon_bridge/,
  );
  assert.throws(
    () => createNativeMcpAdapters({ scheduler: sched, resolvers: { default: { resolveActor: resolver.resolveActor } } }),
    /Missing actor\/resource resolver for native MCP server: axon_bridge/,
  );
  assert.throws(
    () => createNativeMcpAdapters({ scheduler: sched, resolvers: { default: { resolveResourceScope: resolver.resolveResourceScope } } }),
    /Missing actor\/resource resolver/,
  );
});

test('a single native MCP adapter refuses an unknown server, a missing scheduler and an incomplete resolver', () => {
  const sched = scheduler(async () => null);
  assert.throws(
    () => createNativeMcpAdapter({ serverId: 'ghost', scheduler: sched, resolver }),
    (error) => {
      assert.ok(error instanceof EntrypointAdapterError);
      assert.match(error.message, /Unknown native MCP server: ghost/);
      return true;
    },
  );
  assert.throws(() => createNativeMcpAdapter({ serverId: 'swarm', resolver }), /Native MCP adapter requires the governed scheduler/);
  assert.throws(() => createNativeMcpAdapter({ serverId: 'swarm', scheduler: {}, resolver }), /requires the governed scheduler/);
  assert.throws(
    () => createNativeMcpAdapter({ serverId: 'swarm', scheduler: sched }),
    /Missing actor\/resource resolver for native MCP server: swarm/,
  );
  assert.throws(
    () => createNativeMcpAdapter({ serverId: 'swarm', scheduler: sched, resolver: { resolveActor: resolver.resolveActor } }),
    /Missing actor\/resource resolver for native MCP server: swarm/,
  );
  assert.throws(
    () =>
      createNativeMcpAdapter({ serverId: 'swarm', scheduler: sched, resolver: { resolveResourceScope: resolver.resolveResourceScope } }),
    /Missing actor\/resource resolver/,
  );
});

const DESCRIPTOR_FAILURES = [
  ['not an object', 'x'],
  ['null', null],
  ['without a name', { description: 'd', inputSchema: {} }],
  ['without a description', { name: 'n', inputSchema: {} }],
  ['without an input schema', { name: 'n', description: 'd' }],
  ['with a scalar input schema', { name: 'n', description: 'd', inputSchema: 'object' }],
];

for (const [name, descriptor] of DESCRIPTOR_FAILURES) {
  test(`an extra tool descriptor ${name} is refused with its source`, () => {
    assert.throws(
      () => createNativeMcpAdapter({ serverId: 'swarm', scheduler: scheduler(async () => null), resolver, extraTools: [descriptor] }),
      /Invalid native MCP tool descriptor in extraTools/,
    );
  });
}

test('an extra tool is accepted by the adapter and leaves the shared frozen catalog untouched', () => {
  const inputSchema = { type: 'object', properties: { list: { type: 'array', items: { type: 'string' } } } };
  const outputSchema = { type: 'object' };
  const adapter = createNativeMcpAdapter({
    serverId: 'swarm',
    scheduler: scheduler(async () => null),
    resolver,
    extraTools: [{ name: 'extra.probe', description: 'probe', inputSchema, outputSchema, ignored: true }],
  });
  assert.ok(adapter);
  const catalog = loadNativeMcpCatalogs();
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(catalog.swarm));
  assert.equal(
    catalog.swarm.some((tool) => tool.name === 'extra.probe'),
    false,
  );
  for (const tool of catalog.project_state) {
    assert.ok(Object.isFrozen(tool));
    assert.ok(Object.isFrozen(tool.inputSchema));
  }
});

function withStubbedDirectory(entries, fn) {
  const original = fs.readdirSync;
  const toolsMarker = `${path.sep}mcp-hseos-governance${path.sep}tools`;
  fs.readdirSync = function stub(target, ...rest) {
    if (typeof target === 'string' && target.endsWith(toolsMarker)) return entries;
    return original.call(this, target, ...rest);
  };
  try {
    return fn();
  } finally {
    fs.readdirSync = original;
  }
}

test('a tool module that does not export an array is refused naming its path', () => {
  withStubbedDirectory(['../../lib/job-contract.js'], () => {
    assert.throws(
      () => loadNativeMcpCatalogs(),
      (error) => {
        assert.ok(error instanceof EntrypointAdapterError);
        assert.match(error.message, /Native MCP tool module must export an array: .*job-contract\.js/);
        return true;
      },
    );
  });
  assert.ok(loadNativeMcpCatalogs().governance.length > 0);
});

test('a catalog that repeats a tool name, or has none, is refused', () => {
  const real = fs
    .readdirSync(path.join(__dirname, '..', 'tools', 'mcp-hseos-governance', 'tools'))
    .filter((name) => name.endsWith('.js'))
    .sort();
  assert.ok(real.length > 0);
  withStubbedDirectory([real[0], real[0]], () => {
    assert.throws(() => loadNativeMcpCatalogs(), /Native MCP catalog is empty or contains duplicates: governance/);
  });
  withStubbedDirectory(['README.md'], () => {
    assert.throws(() => loadNativeMcpCatalogs(), /Native MCP catalog is empty or contains duplicates: governance/);
  });
});
