'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');

const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcp2026HttpServer,
  createMcpApprovalStateCodec,
  HSEOS_CATALOG_REVISION_META_KEY,
  HSEOS_IDEMPOTENCY_META_KEY,
  JSON_RPC,
  LEGACY_SUNSET,
  Mcp2026Adapter,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
  startMcp2026Stdio,
} = require('../tools/lib/mcp-2026-adapter');
const { deterministicOperationId } = require('../tools/lib/governed-execution/runtime');
const { MCP_LEGACY_PROTOCOL_VERSION, MCP_MODERN_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');
const { McpLegacyUsageStore } = require('../tools/mcp-project-state/lib/mcp-legacy-usage-store');

const BASE_TOOLS = [
  {
    name: 'zeta.echo',
    description: 'Echo a bounded string',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { value: { type: 'string', maxLength: 20 } },
      required: ['value'],
      additionalProperties: false,
    },
    outputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { echoed: { type: 'string' } },
      required: ['echoed'],
      additionalProperties: false,
    },
  },
  {
    name: 'alpha.read',
    description: 'Read a stable value',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function modernParams(extra = {}) {
  return {
    ...extra,
    _meta: {
      [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
      [CLIENT_INFO_META_KEY]: { name: 'fixture-client', version: '1.0.0' },
      [CLIENT_CAPABILITIES_META_KEY]: {},
      ...extra._meta,
    },
  };
}

function modernMessage(method, params = {}, id = 1) {
  return { jsonrpc: '2.0', id, method, params: modernParams(params) };
}

function httpHeaders(method, name) {
  return {
    'mcp-protocol-version': MCP_MODERN_PROTOCOL_VERSION,
    'mcp-method': method,
    ...(name ? { 'mcp-name': name } : {}),
  };
}

function successfulEnvelope(result = null) {
  return {
    schema_version: 1,
    ok: true,
    data: { operation_id: 'operation-1', result: result || { echoed: 'hello' }, replayed: false },
    error: null,
    evidence: ['evidence://fixture'],
    warnings: [],
  };
}

function adapter(overrides = {}) {
  const calls = [];
  const instance = new Mcp2026Adapter({
    serverInfo: { name: 'hseos-fixture', version: '2.0.0' },
    tools: BASE_TOOLS,
    execute: async (request) => {
      calls.push(request);
      return successfulEnvelope({ echoed: request.input.value || 'stable' });
    },
    resolveActor: async () => ({ id: 'actor-1', type: 'human' }),
    resolveResourceScope: async ({ tool }) => ({ project: 'fixture', tool }),
    cacheTtlMs: 5000,
    ...overrides,
  });
  return { calls, instance };
}

test('MRTR state codec enforces integrity, exact operation binding, and expiry', () => {
  let now = new Date('2026-08-21T05:00:00.000Z');
  const codec = createMcpApprovalStateCodec({
    key: '0123456789abcdef0123456789abcdef',
    ttlMs: 1000,
    clock: { now: () => now },
  });
  const binding = { actor: { id: 'a' }, input: { value: 'x' }, operation_id: 'op', policy_version: 'v1' };
  const protectedState = {
    policy_version: 'v1',
    approval_token: 'SECRET-APPROVAL',
    apiKey: 'SECRET-API-KEY',
    nested: { secret: 'SECRET-NESTED' },
  };
  const token = codec.mint({ binding, state: protectedState });
  assert.deepEqual(codec.verify(token, { binding }), protectedState);
  const decodedWirePayload = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
  for (const secret of ['SECRET-APPROVAL', 'SECRET-API-KEY', 'SECRET-NESTED', 'approval_token', 'apiKey']) {
    assert.equal(token.includes(secret), false);
    assert.equal(decodedWirePayload.includes(secret), false);
  }
  assert.throws(() => codec.verify(`${token}x`, { binding }), /integrity/);
  assert.throws(() => codec.verify(token, { binding: { ...binding, input: { value: 'y' } } }), /another operation/);
  now = new Date('2026-08-21T05:00:01.000Z');
  assert.throws(() => codec.verify(token, { binding }), /expired/);
});

test('modern discovery and tool list are stateless, deterministic, cacheable, and server-stamped', async () => {
  const { instance } = adapter();
  assert.equal(MCP_PROTOCOL_VERSION, MCP_LEGACY_PROTOCOL_VERSION, 'operational activation remains ADR-gated');

  const discover = await instance.handle(modernMessage('server/discover'));
  assert.deepEqual(discover.result.supportedVersions, [MCP_MODERN_PROTOCOL_VERSION]);
  assert.equal(discover.result.resultType, 'complete');
  assert.equal(discover.result.ttlMs, 5000);
  assert.equal(discover.result.cacheScope, 'private');
  assert.deepEqual(discover.result._meta[SERVER_INFO_META_KEY], { name: 'hseos-fixture', version: '2.0.0' });

  const first = await instance.handle(modernMessage('tools/list', {}, 2));
  const second = await instance.handle(modernMessage('tools/list', {}, 3));
  assert.deepEqual(first.result.tools.map((tool) => tool.name), ['alpha.read', 'zeta.echo']);
  assert.deepEqual(first.result.tools, second.result.tools);
  assert.deepEqual(first.result.tools[1].outputSchema.required, [
    'schema_version',
    'ok',
    'data',
    'error',
    'evidence',
    'warnings',
  ]);
  assert.equal(
    first.result.tools[1].outputSchema.properties.data.oneOf[1].properties.result.properties.echoed.type,
    'string',
  );
  assert.equal(first.result.ttlMs, 5000);
  assert.equal(first.result.cacheScope, 'private');
  assert.match(first.result._meta[HSEOS_CATALOG_REVISION_META_KEY], /^[a-f0-9]{64}$/);
  assert.equal(first.result._meta[HSEOS_CATALOG_REVISION_META_KEY], second.result._meta[HSEOS_CATALOG_REVISION_META_KEY]);

  assert.throws(() => {
    first.result.tools[1].inputSchema.properties.value.maxLength = 999;
  }, TypeError);
  const afterMutationAttempt = await instance.handle(modernMessage('tools/list', {}, 4));
  assert.equal(afterMutationAttempt.result.tools[1].inputSchema.properties.value.maxLength, 20);
  assert.equal(afterMutationAttempt.result._meta[HSEOS_CATALOG_REVISION_META_KEY], first.result._meta[HSEOS_CATALOG_REVISION_META_KEY]);
});

test('modern HTTP routing headers are required and must match the body exactly', async () => {
  const { instance } = adapter();
  const message = modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } });
  const missing = await instance.handle(message, { transport: 'http', headers: {} });
  assert.equal(missing.error.code, JSON_RPC.HEADER_MISMATCH);

  const divergentVersion = await instance.handle(message, {
    transport: 'http',
    headers: { ...httpHeaders('tools/call', 'zeta.echo'), 'mcp-protocol-version': '2025-11-25' },
  });
  assert.equal(divergentVersion.error.code, JSON_RPC.HEADER_MISMATCH);

  const unknownVersionMessage = modernMessage('tools/call', {
    name: 'zeta.echo',
    arguments: { value: 'hello' },
    _meta: { [PROTOCOL_VERSION_META_KEY]: '2099-01-01' },
  });
  const unknownVersion = await instance.handle(unknownVersionMessage, {
    transport: 'http',
    headers: { ...httpHeaders('tools/call', 'zeta.echo'), 'mcp-protocol-version': '2099-01-01' },
  });
  assert.equal(unknownVersion.error.code, JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
  assert.equal(unknownVersion.error.data.requested, '2099-01-01');

  const wrongMethod = await instance.handle(message, {
    transport: 'http',
    headers: httpHeaders('tools/list', 'zeta.echo'),
  });
  assert.equal(wrongMethod.error.code, JSON_RPC.HEADER_MISMATCH);

  const wrongName = await instance.handle(message, {
    transport: 'http',
    headers: httpHeaders('tools/call', 'alpha.read'),
  });
  assert.equal(wrongName.error.code, JSON_RPC.HEADER_MISMATCH);
  const encodedName = Buffer.from('zeta.echo').toString('base64');
  const encoded = await instance.handle(message, {
    transport: 'http',
    headers: httpHeaders('tools/call', `=?base64?${encodedName}?=`),
  });
  assert.ok(encoded.result);
  const wrongSentinelCase = await instance.handle(message, {
    transport: 'http',
    headers: httpHeaders('tools/call', `=?BASE64?${encodedName}?=`),
  });
  assert.equal(wrongSentinelCase.error.code, JSON_RPC.HEADER_MISMATCH);
});

test('x-mcp-header parameters are validated against nested body values before execution', async () => {
  const tools = [
    {
      name: 'routed.echo',
      description: 'Echo through an explicitly routed region',
      inputSchema: {
        type: 'object',
        properties: {
          routing: {
            type: 'object',
            properties: { region: { type: 'string', 'x-mcp-header': 'Region' } },
            required: ['region'],
            additionalProperties: false,
          },
        },
        required: ['routing'],
        additionalProperties: false,
      },
    },
  ];
  const { calls, instance } = adapter({ tools });
  const message = modernMessage('tools/call', { name: 'routed.echo', arguments: { routing: { region: 'us-east' } } });
  const missing = await instance.handle(message, { transport: 'http', headers: httpHeaders('tools/call', 'routed.echo') });
  assert.equal(missing.error.code, JSON_RPC.HEADER_MISMATCH);
  const mismatch = await instance.handle(message, {
    transport: 'http',
    headers: { ...httpHeaders('tools/call', 'routed.echo'), 'mcp-param-region': 'eu-west' },
  });
  assert.equal(mismatch.error.code, JSON_RPC.HEADER_MISMATCH);
  const encoded = Buffer.from('us-east').toString('base64');
  const wrongCase = await instance.handle(message, {
    transport: 'http',
    headers: { ...httpHeaders('tools/call', 'routed.echo'), 'mcp-param-region': `=?BASE64?${encoded}?=` },
  });
  assert.equal(wrongCase.error.code, JSON_RPC.HEADER_MISMATCH);
  const invalidUtf8 = await instance.handle(
    modernMessage('tools/call', { name: 'routed.echo', arguments: { routing: { region: '\uFFFD' } } }),
    {
      transport: 'http',
      headers: { ...httpHeaders('tools/call', 'routed.echo'), 'mcp-param-region': '=?base64?/w==?=' },
    },
  );
  assert.equal(invalidUtf8.error.code, JSON_RPC.HEADER_MISMATCH);
  const success = await instance.handle(message, {
    transport: 'http',
    headers: { ...httpHeaders('tools/call', 'routed.echo'), 'mcp-param-region': `=?base64?${encoded}?=` },
  });
  assert.equal(success.result.structuredContent.ok, true);
  const internalTab = await instance.handle(
    modernMessage('tools/call', { name: 'routed.echo', arguments: { routing: { region: 'us\teast' } } }),
    {
      transport: 'http',
      headers: { ...httpHeaders('tools/call', 'routed.echo'), 'mcp-param-region': 'us\teast' },
    },
  );
  assert.equal(internalTab.result.structuredContent.ok, true);
  assert.equal(calls.length, 2);
});

test('x-mcp-header rejects annotations outside an exclusive properties chain', () => {
  for (const inputSchema of [
    { type: 'object', not: { properties: { secret: { type: 'string', 'x-mcp-header': 'Secret' } } } },
    { type: 'object', patternProperties: { '^x': { type: 'string', 'x-mcp-header': 'Pattern' } } },
    { type: 'object', properties: { values: { type: 'array', items: { type: 'string', 'x-mcp-header': 'Item' } } } },
  ]) {
    assert.throws(
      () => adapter({ tools: [{ name: 'invalid.header', description: 'invalid header path', inputSchema }] }),
      /cannot be mapped deterministically/,
    );
  }
});

test('modern calls use only the governed execution port and preserve one structured envelope', async () => {
  const { calls, instance } = adapter();
  const message = modernMessage('tools/call', {
    name: 'zeta.echo',
    arguments: { value: 'hello' },
    _meta: { [HSEOS_IDEMPOTENCY_META_KEY]: 'stable-key' },
  });
  const response = await instance.handle(message, {
    transport: 'http',
    headers: httpHeaders('tools/call', 'zeta.echo'),
  });
  assert.equal(response.result.resultType, 'complete');
  assert.equal(response.result.isError, false);
  assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
  assert.deepEqual(response.result.structuredContent, successfulEnvelope());
  assert.deepEqual(response.result._meta[SERVER_INFO_META_KEY], { name: 'hseos-fixture', version: '2.0.0' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotency_key, 'stable-key');
  assert.deepEqual(calls[0].actor, { id: 'actor-1', type: 'human' });
  assert.deepEqual(calls[0].resource_scope, { project: 'fixture', tool: 'zeta.echo' });
});

test('advertised output schema is enforced at the adapter boundary', async () => {
  const { instance } = adapter({
    execute: async () => successfulEnvelope({ echoed: 42 }),
  });
  const response = await instance.handle(
    modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } }),
  );
  assert.equal(response.error.code, JSON_RPC.INTERNAL_ERROR);
  assert.match(response.error.message, /outputSchema/);
});

test('execution port must return the exact canonical six-field envelope', async () => {
  for (const invalidEnvelope of [
    { ...successfulEnvelope(), extra: true },
    { ...successfulEnvelope(), evidence: [{}] },
    { ...successfulEnvelope(), data: null },
    { schema_version: 1, ok: false, data: null, error: { code: 'FAILED', message: 'failed' }, evidence: [], warnings: [] },
  ]) {
    const { instance } = adapter({ execute: async () => invalidEnvelope });
    const response = await instance.handle(modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } }));
    assert.equal(response.error.code, JSON_RPC.INTERNAL_ERROR);
    assert.match(response.error.message, /envelope/);
  }
});

test('invalid input and unsupported modern lifecycle methods fail before execution', async () => {
  const { calls, instance } = adapter();
  const invalid = await instance.handle(modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 42 } }));
  assert.equal(invalid.error.code, JSON_RPC.INVALID_PARAMS);
  const initialize = await instance.handle(modernMessage('initialize'));
  assert.equal(initialize.error.code, JSON_RPC.METHOD_NOT_FOUND);
  const missingCapabilities = await instance.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: { _meta: { [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION } },
  });
  assert.equal(missingCapabilities.error.code, JSON_RPC.INVALID_PARAMS);
  const missingMetaOverModernHttp = await instance.handle(
    { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    { transport: 'http', headers: httpHeaders('tools/list') },
  );
  assert.equal(missingMetaOverModernHttp.error.code, JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
  assert.deepEqual(missingMetaOverModernHttp.error.data, { requested: null, supported: [MCP_MODERN_PROTOCOL_VERSION] });
  for (const clientInfo of [{ name: '', version: '1' }, { name: 'client', version: '' }]) {
    const malformedClient = await instance.handle(
      modernMessage('tools/list', { _meta: { [CLIENT_INFO_META_KEY]: clientInfo } }),
    );
    assert.equal(malformedClient.error.code, JSON_RPC.INVALID_PARAMS);
  }
  const notification = await instance.handle({ jsonrpc: '2.0', method: 'tools/list', params: modernParams() });
  assert.equal(notification.error.code, JSON_RPC.INVALID_REQUEST);
  for (const id of [{}, null, 1.5]) {
    const invalidId = await instance.handle(modernMessage('tools/list', {}, id));
    assert.equal(invalidId.error.code, JSON_RPC.INVALID_REQUEST);
  }
  const nullArguments = await instance.handle(modernMessage('tools/call', { name: 'alpha.read', arguments: null }));
  assert.equal(nullArguments.error.code, JSON_RPC.INVALID_PARAMS);
  for (const idempotencyKey of ['', 42]) {
    const invalidIdempotency = await instance.handle(
      modernMessage('tools/call', {
        name: 'zeta.echo',
        arguments: { value: 'hello' },
        _meta: { [HSEOS_IDEMPOTENCY_META_KEY]: idempotencyKey },
      }),
    );
    assert.equal(invalidIdempotency.error.code, JSON_RPC.INVALID_PARAMS);
  }
  assert.equal(calls.length, 0);
});

test('schema and request limits fail closed and external references are rejected', async () => {
  assert.throws(
    () => adapter({ tools: [{ name: 'bad', description: 'bad', inputSchema: { $ref: 'https://example.test/schema.json' } }] }),
    /cannot dereference external schemas/,
  );
  const { instance: localReferenceInstance } = adapter({
    tools: [
      {
        name: 'local.reference',
        description: 'Valid local output reference',
        inputSchema: { type: 'object', additionalProperties: false },
        outputSchema: {
          $defs: { payload: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
          $ref: '#/$defs/payload',
        },
      },
    ],
  });
  const localReferenceList = await localReferenceInstance.handle(modernMessage('tools/list'));
  assert.equal(
    localReferenceList.result.tools[0].outputSchema.properties.data.oneOf[1].properties.result.$ref,
    '#/properties/data/oneOf/1/properties/result/$defs/payload',
  );
  const { instance } = adapter({ maxBodyBytes: 300, maxJsonDepth: 8 });
  const oversized = await instance.handle(modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'x'.repeat(500) } }));
  assert.equal(oversized.error.code, JSON_RPC.REQUEST_TOO_LARGE);
  const { instance: depthInstance } = adapter({ maxBodyBytes: 5000, maxJsonDepth: 8 });
  const tooDeep = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: modernParams({ nested: { a: { b: { c: { d: { e: { f: { g: {} } } } } } } } }),
  };
  const depth = await depthInstance.handle(tooDeep);
  assert.equal(depth.error.code, JSON_RPC.INVALID_REQUEST);
  const { calls, instance: timedInstance } = adapter({ validationTimeoutMs: 1 });
  const timed = await timedInstance.handle(modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } }));
  assert.equal(timed.error.code, JSON_RPC.DEADLINE_EXCEEDED);
  assert.equal(calls.length, 0);
});

test('absolute MCP execution deadline bounds a port that never settles', async () => {
  const { calls, instance } = adapter({
    executionTimeoutMs: 1000,
    validationTimeoutMs: 5000,
    execute: async (request) => {
      calls.push(request);
      return await new Promise(() => {});
    },
  });
  const response = await instance.handle(modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } }));
  assert.equal(response.error.code, JSON_RPC.DEADLINE_EXCEEDED);
  assert.match(response.error.message, /deadline/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
  assert.match(calls[0].deadline, /^\d{4}-\d{2}-\d{2}T/);
});

test('legacy era is explicit, isolated, metered, deprecated, and cannot skip initialize', async () => {
  const usage = [];
  const { calls, instance } = adapter({ legacyUsage: (event) => usage.push(event) });
  const connection = instance.createConnectionContext();
  const premature = await instance.handle(
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    { transport: 'stdio', connection: instance.createConnectionContext() },
  );
  assert.equal(premature.error.code, JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
  const missingInitializeParams = await instance.handle(
    { jsonrpc: '2.0', id: 0, method: 'initialize' },
    { transport: 'stdio', connection: instance.createConnectionContext() },
  );
  assert.equal(missingInitializeParams.error.code, JSON_RPC.INVALID_PARAMS);

  const initialized = await instance.handle(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
        clientInfo: { name: 'legacy-client', version: '0.9' },
        capabilities: {},
      },
    },
    { transport: 'stdio', connection },
  );
  assert.equal(initialized.result.protocolVersion, MCP_LEGACY_PROTOCOL_VERSION);
  assert.equal(initialized.result._meta.sunset, LEGACY_SUNSET);

  const listed = await instance.handle(
    { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    { transport: 'stdio', connection },
  );
  assert.equal(listed.result.ttlMs, undefined, 'modern cache semantics must not leak into legacy');
  assert.equal(listed.result._meta.sunset, LEGACY_SUNSET);
  assert.equal(usage.length, 2);
  assert.equal(instance.legacySnapshot()['legacy-client@0.9'], 2);
  const modernOnLegacy = await instance.handle(modernMessage('tools/list', {}, 4), { transport: 'stdio', connection });
  assert.equal(modernOnLegacy.error.code, JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
  const modernConnection = instance.createConnectionContext();
  const modernFirst = await instance.handle(modernMessage('server/discover', {}, 5), {
    transport: 'stdio',
    connection: modernConnection,
  });
  assert.ok(modernFirst.result);
  const legacyOnModern = await instance.handle(
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'initialize',
      params: { protocolVersion: MCP_LEGACY_PROTOCOL_VERSION, clientInfo: { name: 'legacy-client', version: '0.9' } },
    },
    { transport: 'stdio', connection: modernConnection },
  );
  assert.equal(legacyOnModern.error.code, JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
  assert.equal(calls.length, 0);
});

test('legacy usage evidence survives restart in a bounded daily aggregate', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-legacy-usage-'));
  const databasePath = path.join(directory, 'legacy.db');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const event = {
    client_identity: 'legacy-client@1',
    protocol_version: MCP_LEGACY_PROTOCOL_VERSION,
    server_id: 'governance',
    sunset: LEGACY_SUNSET,
  };
  const first = new McpLegacyUsageStore(databasePath);
  first.record(event, new Date('2026-08-21T01:00:00.000Z'));
  first.close();
  const reopened = new McpLegacyUsageStore(databasePath);
  reopened.record(event, new Date('2026-08-21T02:00:00.000Z'));
  assert.deepEqual(reopened.snapshot().map(({ request_count: count, usage_day: day }) => ({ count, day })), [
    { count: 2, day: '2026-08-21' },
  ]);
  reopened.close();
});

test('legacy activation readiness requires every hour of 30 completed zero-use days from every native server', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-legacy-readiness-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new McpLegacyUsageStore(path.join(directory, 'legacy.db'));
  const servers = ['governance', 'project_state', 'swarm', 'axon_bridge'];
  const start = new Date('2026-07-22T00:00:00.000Z');
  for (let hour = 0; hour < 30 * 24; hour += 1) {
    const instant = new Date(start.getTime() + hour * 3_600_000);
    for (const serverId of servers) store.markObservation(serverId, instant);
  }
  assert.equal(store.activationReadiness({ serverIds: servers, asOf: new Date('2026-08-21T23:00:00.000Z') }).ready, true);
  store.record(
    {
      client_identity: 'late-legacy-client',
      protocol_version: MCP_LEGACY_PROTOCOL_VERSION,
      server_id: 'swarm',
      sunset: LEGACY_SUNSET,
    },
    new Date('2026-08-20T18:00:00.000Z'),
  );
  const blocked = store.activationReadiness({ serverIds: servers, asOf: new Date('2026-08-21T23:00:00.000Z') });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.legacy_use, [{ count: 1, day: '2026-08-20', server_id: 'swarm' }]);
  store.record(
    {
      client_identity: 'current-day-legacy-client',
      protocol_version: MCP_LEGACY_PROTOCOL_VERSION,
      server_id: 'governance',
      sunset: LEGACY_SUNSET,
    },
    new Date('2026-08-21T18:00:00.000Z'),
  );
  assert.equal(
    store.activationReadiness({ serverIds: servers, asOf: new Date('2026-08-21T23:00:00.000Z') }).legacy_use.some(
      (usage) => usage.day === '2026-08-21' && usage.server_id === 'governance',
    ),
    true,
  );
  store.close();
});

test('one heartbeat per day cannot produce false-green legacy readiness', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-legacy-sparse-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new McpLegacyUsageStore(path.join(directory, 'legacy.db'));
  const servers = ['governance', 'project_state', 'swarm', 'axon_bridge'];
  for (let day = 0; day < 30; day += 1) {
    const instant = new Date(Date.parse('2026-07-22T12:00:00.000Z') + day * 86_400_000);
    for (const serverId of servers) store.markObservation(serverId, instant);
  }
  const readiness = store.activationReadiness({ serverIds: servers, asOf: new Date('2026-08-21T23:00:00.000Z') });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.gaps.every((gap) => gap.covered_hours === 1 && gap.required_hours === 24), true);
  store.close();
});

test('durable legacy telemetry bounds identity cardinality and expires old aggregates', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-legacy-bounded-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new McpLegacyUsageStore(path.join(directory, 'legacy.db'), { maxIdentitiesPerDay: 8, retentionDays: 31 });
  const base = {
    protocol_version: MCP_LEGACY_PROTOCOL_VERSION,
    server_id: 'governance',
    sunset: LEGACY_SUNSET,
  };
  store.record({ ...base, client_identity: 'expired' }, new Date('2026-06-01T00:00:00.000Z'));
  for (let index = 0; index < 100; index += 1) {
    store.record({ ...base, client_identity: `client-${index}` }, new Date('2026-08-21T12:00:00.000Z'));
  }
  const rows = store.snapshot();
  assert.equal(rows.length, 8);
  assert.equal(rows.some((row) => row.client_label === 'expired'), false);
  assert.equal(rows.find((row) => row.client_label === '__overflow__').request_count, 93);
  store.close();
});

test('legacy compatibility stops at the approved sunset and keeps identity metrics bounded', async () => {
  for (const instant of ['2026-11-30T00:00:00.000Z', '2027-01-01T00:00:00.000Z']) {
    const { instance } = adapter({ clock: { now: () => new Date(instant) } });
    const rejected = await instance.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: MCP_LEGACY_PROTOCOL_VERSION, clientInfo: { name: 'expired', version: '1' } },
    });
    assert.equal(rejected.error.code, JSON_RPC.UNSUPPORTED_PROTOCOL_VERSION);
    assert.deepEqual(rejected.error.data.supported, [MCP_MODERN_PROTOCOL_VERSION]);
  }

  const { instance } = adapter({ maxLegacyIdentities: 1 });
  for (const name of ['first', 'second', 'third']) {
    const response = await instance.handle(
      {
        jsonrpc: '2.0',
        id: name,
        method: 'initialize',
        params: { protocolVersion: MCP_LEGACY_PROTOCOL_VERSION, clientInfo: { name, version: '1' } },
      },
      { transport: 'stdio', connection: instance.createConnectionContext() },
    );
    assert.ok(response.result);
  }
  assert.deepEqual(instance.legacySnapshot(), { __overflow__: 2, 'first@1': 1 });
});

test('legacy approval failures are explicit, deprecated, and never redispatched', async () => {
  const { calls, instance } = adapter({
    execute: async (executionRequest) => {
      calls.push(executionRequest);
      return {
        schema_version: 1,
        ok: false,
        data: null,
        error: {
          code: 'EXECUTION_APPROVAL_REQUIRED',
          message: 'approval required',
          operation_id: deterministicOperationId(executionRequest.tool, executionRequest.idempotency_key),
          retryable: false,
        },
        evidence: [],
        warnings: [],
      };
    },
  });
  const response = await instance.handle(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zeta.echo', arguments: { value: 'hello' } } },
    { transport: 'http' },
  );
  assert.equal(response.result.structuredContent.error.code, 'MCP_LEGACY_APPROVAL_UNSUPPORTED');
  assert.equal(response.result._meta.sunset, LEGACY_SUNSET);
  assert.equal(calls.length, 1);
});

test('approval-required calls use MRTR only for capable modern clients and bind retry state through the approval flow', async () => {
  const calls = [];
  const approvalEvents = [];
  const { instance } = adapter({
    execute: async (executionRequest) => {
      calls.push(executionRequest);
      if (!executionRequest.approval_context) {
        return {
          schema_version: 1,
          ok: false,
          data: null,
          error: {
            code: 'EXECUTION_APPROVAL_REQUIRED',
            message: 'approval required',
            operation_id: deterministicOperationId(executionRequest.tool, executionRequest.idempotency_key),
            retryable: false,
          },
          evidence: [],
          warnings: [],
        };
      }
      return successfulEnvelope();
    },
    approvalFlow: {
      async begin(context) {
        approvalEvents.push({ phase: 'begin', context });
        return {
          state: { approval_step: 'confirm', policy_version: 'policy-v1' },
          inputRequests: {
            confirm: {
              method: 'elicitation/create',
              params: {
                mode: 'form',
                message: 'Approve?',
                requestedSchema: {
                  type: 'object',
                  properties: { approved: { type: 'boolean' } },
                  required: ['approved'],
                },
              },
            },
          },
        };
      },
      async resolve(context) {
        approvalEvents.push({ phase: 'resolve', context });
        assert.deepEqual(context.verifiedState, { approval_step: 'confirm', policy_version: 'policy-v1' });
        assert.deepEqual(context.inputResponses, { confirm: { action: 'accept', content: { approved: true } } });
        return { approval_id: 'approval-1', policy_version: 'policy-v1' };
      },
    },
    approvalStateCodec: createMcpApprovalStateCodec({ key: '0123456789abcdef0123456789abcdef' }),
  });
  const incapable = await instance.handle(
    modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } }),
  );
  assert.equal(incapable.error.code, JSON_RPC.MISSING_CLIENT_CAPABILITY);
  assert.deepEqual(incapable.error.data.requiredCapabilities, { elicitation: {} });
  assert.equal(incapable.error.data.hseos.code, 'approval_required');

  const capableMeta = {
    [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
    [CLIENT_INFO_META_KEY]: { name: 'fixture-client', version: '1.0.0' },
    [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} },
  };
  const pending = await instance.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'zeta.echo', arguments: { value: 'hello' }, _meta: capableMeta },
  });
  assert.equal(pending.result.resultType, 'input_required');
  assert.match(pending.result.requestState, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const tampered = await instance.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'zeta.echo',
      arguments: { value: 'hello' },
      requestState: `${pending.result.requestState}x`,
      inputResponses: { confirm: { action: 'accept', content: { approved: true } } },
      _meta: capableMeta,
    },
  });
  assert.equal(tampered.error.code, JSON_RPC.INVALID_PARAMS);

  const completed = await instance.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'zeta.echo',
      arguments: { value: 'hello' },
      requestState: pending.result.requestState,
      inputResponses: { confirm: { action: 'accept', content: { approved: true } } },
      _meta: capableMeta,
    },
  });
  assert.equal(completed.result.resultType, 'complete');
  assert.equal(completed.result.structuredContent.ok, true);
  assert.equal(calls.at(-2).idempotency_key, calls.at(-1).idempotency_key, 'signed MRTR state must recover the generated key');
  assert.deepEqual(calls.at(-1).approval_context, { approval_id: 'approval-1', policy_version: 'policy-v1' });
  assert.deepEqual(approvalEvents.map((event) => event.phase), ['begin', 'resolve']);
});

function requestHttp(port, { body = '', headers = {}, method = 'POST', requestPath = '/mcp' }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...headers },
      },
      (response) => {
        let payload = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (payload += chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: payload ? JSON.parse(payload) : null }));
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

test('HTTP transport bounds bodies and returns the same modern structured semantics', async () => {
  const { instance } = adapter({ maxBodyBytes: 700, allowedOrigins: ['https://trusted.example'] });
  const server = createMcp2026HttpServer(instance);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const message = modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } });
    const success = await requestHttp(port, {
      body: JSON.stringify(message),
      headers: {
        'MCP-Protocol-Version': MCP_MODERN_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'zeta.echo',
      },
    });
    assert.equal(success.status, 200);
    assert.equal(success.body.result.structuredContent.ok, true);

    const missingProtocolHeader = await requestHttp(port, {
      body: JSON.stringify(message),
      headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'zeta.echo' },
    });
    assert.equal(missingProtocolHeader.status, 400);
    assert.equal(missingProtocolHeader.body.error.code, JSON_RPC.HEADER_MISMATCH);

    const divergentProtocolHeader = await requestHttp(port, {
      body: JSON.stringify(message),
      headers: { 'MCP-Protocol-Version': '2025-11-25', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'zeta.echo' },
    });
    assert.equal(divergentProtocolHeader.status, 400);
    assert.equal(divergentProtocolHeader.body.error.code, JSON_RPC.HEADER_MISMATCH);

    const forbiddenOrigin = await requestHttp(port, {
      body: JSON.stringify(message),
      headers: {
        ...httpHeaders('tools/call', 'zeta.echo'),
        Origin: 'https://evil.example',
      },
    });
    assert.equal(forbiddenOrigin.status, 403);

    const wrongContentType = await requestHttp(port, {
      body: JSON.stringify(message),
      headers: { ...httpHeaders('tools/call', 'zeta.echo'), 'Content-Type': 'text/plain' },
    });
    assert.equal(wrongContentType.status, 415);

    const invalidUtf8Body = await requestHttp(port, {
      body: Buffer.from([0xff]),
      headers: httpHeaders('tools/list'),
    });
    assert.equal(invalidUtf8Body.status, 400);
    assert.equal(invalidUtf8Body.body.error.code, JSON_RPC.PARSE_ERROR);

    const trustedOrigin = await requestHttp(port, {
      body: JSON.stringify(message),
      headers: {
        ...httpHeaders('tools/call', 'zeta.echo'),
        Origin: 'https://trusted.example',
      },
    });
    assert.equal(trustedOrigin.status, 200);

    const unknown = await requestHttp(port, {
      body: JSON.stringify(modernMessage('unknown/method', {}, 9)),
      headers: httpHeaders('unknown/method'),
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, JSON_RPC.METHOD_NOT_FOUND);

    const unsupportedMethod = await requestHttp(port, { method: 'GET' });
    assert.equal(unsupportedMethod.status, 405);

    const oversized = await requestHttp(port, { body: JSON.stringify({ padding: 'x'.repeat(1000) }) });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error.code, JSON_RPC.REQUEST_TOO_LARGE);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('legacy HTTP subset remains stateless, deprecated, and metered during the compatibility window', async () => {
  const usage = [];
  const { calls, instance } = adapter({ legacyUsage: (event) => usage.push(event) });
  const server = createMcp2026HttpServer(instance);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const listed = await requestHttp(port, {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.result._meta.sunset, LEGACY_SUNSET);
    const called = await requestHttp(port, {
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'zeta.echo', arguments: { value: 'hello' } },
      }),
    });
    assert.equal(called.status, 200);
    assert.equal(called.body.result.structuredContent.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(usage.length, 2);

    const notification = await requestHttp(port, {
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });
    assert.equal(notification.status, 202);
    assert.equal(notification.body, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP missing client capability maps to protocol -32021 and status 400', async () => {
  const { instance } = adapter({
    execute: async (executionRequest) => ({
      schema_version: 1,
      ok: false,
      data: null,
      error: {
        code: 'EXECUTION_APPROVAL_REQUIRED',
        message: 'approval required',
        operation_id: deterministicOperationId(executionRequest.tool, executionRequest.idempotency_key),
        retryable: false,
      },
      evidence: [],
      warnings: [],
    }),
    approvalFlow: { async begin() { return { state: { policy_version: 'v1' }, inputRequests: {} }; }, async resolve() {} },
    approvalStateCodec: createMcpApprovalStateCodec({ key: '0123456789abcdef0123456789abcdef' }),
  });
  const server = createMcp2026HttpServer(instance);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const message = modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } });
    const response = await requestHttp(port, {
      body: JSON.stringify(message),
      headers: {
        'MCP-Protocol-Version': MCP_MODERN_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'zeta.echo',
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, JSON_RPC.MISSING_CLIENT_CAPABILITY);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('modern stdio cancellation aborts the matching in-flight request', async () => {
  let notifyProviderStarted;
  let activeRequest;
  const providerStarted = new Promise((resolve) => (notifyProviderStarted = resolve));
  const { instance } = adapter({
    execute: async (executionRequest) => {
      activeRequest = executionRequest;
      notifyProviderStarted();
      return new Promise((resolve) => {
        executionRequest.signal.addEventListener(
          'abort',
          () =>
            resolve({
              schema_version: 1,
              ok: false,
              data: null,
              error: { code: 'EXECUTION_CANCELLED', message: 'cancelled', operation_id: 'operation-1', retryable: false },
              evidence: [],
              warnings: [],
            }),
          { once: true },
        );
      });
    },
  });
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding('utf8');
  let wire = '';
  output.on('data', (chunk) => (wire += chunk));
  const rl = startMcp2026Stdio(instance, { input, output });
  input.write(`${JSON.stringify(modernMessage('tools/call', { name: 'zeta.echo', arguments: { value: 'hello' } }, 'call-1'))}\n`);
  await providerStarted;
  input.write(`${JSON.stringify({ method: 'notifications/cancelled', params: { requestId: 'call-1' } })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(activeRequest.signal.aborted, false, 'malformed JSON-RPC notification must not cancel execution');
  const malformed = JSON.parse(wire.trim());
  assert.equal(malformed.error.code, JSON_RPC.INVALID_REQUEST);
  wire = '';
  input.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 'call-1', reason: 'user cancelled' },
    })}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const response = JSON.parse(wire.trim());
  assert.equal(response.id, 'call-1');
  assert.equal(response.result.structuredContent.error.code, 'EXECUTION_CANCELLED');
  rl.close();
  input.end();
});
