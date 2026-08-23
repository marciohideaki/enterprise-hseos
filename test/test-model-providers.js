'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

const { CONTRACT_SCHEMA_VERSION, validatePortResult } = require('../packages/agent-runtime-contracts');
const {
  MAX_SSE_BUFFER_BYTES,
  ModelProviderError,
  ModelProviderRegistry,
  OpenAICompatibleModelProvider,
  ProviderRegistryError,
  ScriptedModelProvider,
  parseSse,
} = require('../packages/model-providers');
const fixtures = require('./fixtures/agent-runtime-contracts');

function manifest(providerId) {
  const value = {
    ...structuredClone(fixtures.modelManifest),
    provider_id: providerId,
    secret_refs: [],
  };
  value.capabilities.push('reasoning');
  return value;
}

function request(providerId, requestId, content) {
  const value = structuredClone(fixtures.modelRequest);
  value.provider_id = providerId;
  value.request_id = requestId;
  value.messages = [{ role: 'user', content }];
  return value;
}

function query(providerId, requestId) {
  return { schema_version: CONTRACT_SCHEMA_VERSION, provider_id: providerId, request_id: requestId };
}

async function collect(provider, input) {
  const events = [];
  const validated = validatePortResult('ModelProvider', 'stream', provider.stream(input), input);
  for await (const event of validated) events.push(event);
  return events;
}

function scriptedProvider(providerId = 'model:scripted', maxParallelRequests = 8) {
  const providerManifest = manifest(providerId);
  providerManifest.limits.max_parallel_requests = maxParallelRequests;
  return new ScriptedModelProvider({
    manifest: providerManifest,
    routes: [
      {
        match: (input) => input.messages.at(-1).content === 'text',
        events: [
          { event_type: 'content.delta', payload: { text: 'fixture' } },
          { event_type: 'usage', payload: { input_tokens: 2, output_tokens: 1, cached_tokens: 0 } },
          { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://text' } },
        ],
      },
      {
        match: (input) => input.messages.at(-1).content === 'tool',
        events: [
          { event_type: 'reasoning.delta', payload: { text: 'inspect' } },
          {
            event_type: 'tool_call.delta',
            payload: { tool_call_id: 'call:one', name: 'fixture.read', arguments_delta: '{"path":' },
          },
          {
            event_type: 'tool_call.delta',
            payload: { tool_call_id: 'call:one', name: null, arguments_delta: '"state"}' },
          },
          { event_type: 'completed', payload: { finish_reason: 'tool_calls', provider_response_ref: 'scripted://tool' } },
        ],
      },
      {
        match: (input) => input.messages.at(-1).content === 'slow',
        events: [
          { delay_ms: 5000, event_type: 'content.delta', payload: { text: 'late' } },
          { event_type: 'completed', payload: { finish_reason: 'stop', provider_response_ref: 'scripted://slow' } },
        ],
      },
    ],
  });
}

test('registry snapshots isolate later registrations and reject mutation and duplicates', () => {
  const registry = new ModelProviderRegistry();
  const scripted = scriptedProvider();
  registry.register(scripted, scripted.manifest(query('model:scripted', 'request:manifest')));
  const snapshot = registry.snapshot();
  assert.equal(snapshot.resolve('model:scripted').provider, scripted);
  assert.throws(() => snapshot.manifests.push({}), TypeError);
  assert.throws(() => registry.register(scripted, manifest('model:scripted')), ProviderRegistryError);

  const later = scriptedProvider('model:later');
  registry.register(later, manifest('model:later'));
  assert.throws(() => snapshot.resolve('model:later'), /not present/);
  assert.equal(registry.snapshot().resolve('model:later').provider, later);
});

test('two scripted routes produce normalized text, reasoning, tool and usage events', async () => {
  const provider = scriptedProvider();
  const textEvents = await collect(provider, request('model:scripted', 'request:script-text', 'text'));
  const toolEvents = await collect(provider, request('model:scripted', 'request:script-tool', 'tool'));
  assert.deepEqual(
    textEvents.map((event) => event.event_type),
    ['content.delta', 'usage', 'completed'],
  );
  assert.deepEqual(
    toolEvents.map((event) => event.event_type),
    ['reasoning.delta', 'tool_call.delta', 'tool_call.delta', 'completed'],
  );
  assert.equal(toolEvents[1].payload.name, 'fixture.read');
  assert.equal(toolEvents[2].payload.arguments_delta, '"state"}');
});

test('scripted cancellation is prompt and produces a normalized terminal event', async () => {
  const provider = scriptedProvider();
  const input = request('model:scripted', 'request:script-cancel', 'slow');
  const pending = collect(provider, input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.cancel({ ...query('model:scripted', input.request_id), reason: 'test cancellation' }).accepted, true);
  const events = await pending;
  assert.deepEqual(
    events.map((event) => event.event_type),
    ['completed'],
  );
  assert.equal(events[0].payload.finish_reason, 'cancelled');
});

test('provider discovery, disposal and parallel reservations fail closed', async () => {
  const provider = scriptedProvider('model:scripted', 1);
  const discoveryInput = query('model:scripted', 'request:discover');
  const discovered = validatePortResult('ModelProvider', 'discover', provider.discover(discoveryInput), discoveryInput);
  assert.deepEqual(discovered.models, fixtures.modelManifest.models);

  const first = request('model:scripted', 'request:reserved', 'slow');
  const reserved = provider.stream(first);
  assert.throws(() => provider.stream(request('model:scripted', 'request:over-limit', 'text')), /parallel request limit/);
  assert.equal(provider.cancel({ ...query('model:scripted', first.request_id), reason: 'before iteration' }).accepted, true);
  const replacementInput = request('model:scripted', first.request_id, 'text');
  const replacement = provider.stream(replacementInput);
  const events = [];
  for await (const event of reserved) events.push(event);
  assert.equal(events[0].payload.finish_reason, 'cancelled');
  const replacementEvents = [];
  for await (const event of validatePortResult('ModelProvider', 'stream', replacement, replacementInput)) replacementEvents.push(event);
  assert.equal(replacementEvents.at(-1).payload.finish_reason, 'stop');
  provider.dispose(query('model:scripted', 'request:dispose'));
  assert.throws(() => provider.stream(request('model:scripted', 'request:disposed', 'text')), /disposed/);
});

test('SSE parsing fails closed when one frame exceeds its fixed memory bound', async () => {
  const body = async function* oversizedBody() {
    yield Buffer.from(`data: ${'x'.repeat(MAX_SSE_BUFFER_BYTES + 1)}`);
  };
  await assert.rejects(async () => {
    for await (const ignored of parseSse(body())) void ignored;
  }, /buffer limit/);
});

test('declared capabilities and output limits are enforced before dispatch', () => {
  const limitedManifest = manifest('model:http');
  limitedManifest.limits.max_output_tokens = 5;
  const limited = new OpenAICompatibleModelProvider({ manifest: limitedManifest, base_url: 'http://127.0.0.1:1' });
  const overBudget = request('model:http', 'request:over-budget', 'text');
  overBudget.parameters.max_output_tokens = 6;
  assert.throws(() => limited.stream(overBudget), /exceeds provider limits/);

  const contextManifest = manifest('model:http');
  contextManifest.limits.context_tokens = 10;
  contextManifest.limits.max_output_tokens = 5;
  const boundedContext = new OpenAICompatibleModelProvider({ manifest: contextManifest, base_url: 'http://127.0.0.1:1' });
  const overContext = request('model:http', 'request:over-context', 'x');
  overContext.parameters.max_output_tokens = 1;
  assert.throws(() => boundedContext.stream(overContext), /context limit/);

  const weakManifest = manifest('model:http');
  weakManifest.capabilities = ['text_generation'];
  const weak = new OpenAICompatibleModelProvider({ manifest: weakManifest, base_url: 'http://127.0.0.1:1' });
  assert.throws(() => weak.stream(request('model:http', 'request:no-stream', 'text')), /streaming is not declared/);

  weakManifest.capabilities = ['text_generation', 'streaming'];
  const noTools = new OpenAICompatibleModelProvider({ manifest: weakManifest, base_url: 'http://127.0.0.1:1' });
  assert.throws(() => noTools.stream(request('model:http', 'request:no-tools', 'text')), /tool calls are not declared/);
});

let server;
let baseUrl;
let retryRequests = 0;
let malformedRequests = 0;

function sendSse(response, frames, { hold = false } = {}) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'x-request-id': 'remote response with unsafe / characters',
  });
  for (const frame of frames) {
    const encoded = `data: ${JSON.stringify(frame)}\r\n\r\n`;
    response.write(encoded.slice(0, 7));
    response.write(encoded.slice(7));
  }
  if (!hold) response.end('data: [DONE]\n\n');
}

before(async () => {
  server = http.createServer((incoming, response) => {
    let raw = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk) => {
      raw += chunk;
    });
    incoming.on('end', () => {
      const body = JSON.parse(raw);
      const content = body.messages.at(-1).content;
      assert.equal(incoming.method, 'POST');
      assert.equal(incoming.url, '/chat/completions');
      assert.equal(body.stream, true);
      if (body.messages.at(-1).role === 'tool') {
        assert.equal(body.messages.at(-1).tool_call_id, 'call:continuation');
        assert.deepEqual(body.messages.at(-2).tool_calls, [
          {
            id: 'call:continuation',
            type: 'function',
            function: { name: 'fixture.read', arguments: '{"path":"state"}' },
          },
        ]);
        sendSse(response, [{ choices: [{ delta: { content: 'continued' }, finish_reason: 'stop' }] }]);
        return;
      }
      if (content === 'authenticated') {
        assert.equal(incoming.headers.authorization, 'Bearer ephemeral-fixture-value');
      }
      if (content === 'retry' && retryRequests++ === 0) {
        response.writeHead(503).end();
        return;
      }
      if (content === 'malformed') {
        malformedRequests++;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
        response.end('data: not-json\n\n');
        return;
      }
      if (content === 'invalid-content') {
        sendSse(response, [{ choices: [{ delta: { content: { text: 'not-string' } }, finish_reason: 'stop' }] }]);
        return;
      }
      if (content === 'invalid-tool') {
        sendSse(response, [{ choices: [{ delta: { tool_calls: [null] }, finish_reason: 'tool_calls' }] }]);
        return;
      }
      if (content === 'cancel') {
        sendSse(response, [{ choices: [{ delta: { content: 'first' }, finish_reason: null }] }], { hold: true });
        return;
      }
      sendSse(response, [
        { choices: [{ delta: { reasoning_content: 'inspect' }, finish_reason: null }] },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: 'call:one', function: { name: 'fixture.read', arguments: '{"path":' } }] },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"state"}' } }] }, finish_reason: 'tool_calls' }],
        },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 1 } } },
      ]);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function provider(options = {}) {
  return new OpenAICompatibleModelProvider({ manifest: manifest('model:http'), base_url: baseUrl, ...options });
}

test('assembles fragmented SSE tool deltas, usage and opaque response evidence', async () => {
  const events = await collect(provider(), request('model:http', 'request:http-tool', 'tool'));
  assert.deepEqual(
    events.map((event) => event.event_type),
    ['reasoning.delta', 'tool_call.delta', 'tool_call.delta', 'usage', 'completed'],
  );
  assert.equal(events[2].payload.arguments_delta, '"state"}');
  assert.deepEqual(events[3].payload, { input_tokens: 3, output_tokens: 2, cached_tokens: 1 });
  assert.match(events[4].payload.provider_response_ref, /^provider-response:\/\/sha256\/[a-f0-9]{64}$/);
  assert.doesNotMatch(events[4].payload.provider_response_ref, /unsafe/);
});

test('maps canonical assistant tool calls and tool outcomes into OpenAI-compatible continuation messages', async () => {
  const input = request('model:http', 'request:http-continuation', 'unused');
  input.messages = [
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ tool_call_id: 'call:continuation', name: 'fixture.read', input: { path: 'state' } }],
    },
    { role: 'tool', name: 'fixture.read', tool_call_id: 'call:continuation', content: '{"status":"succeeded"}' },
  ];
  const events = await collect(provider(), input);
  assert.equal(events[0].payload.text, 'continued');
  assert.equal(events.at(-1).payload.finish_reason, 'stop');
});

test('retries a transient failure before emission', async () => {
  const events = await collect(provider({ max_attempts: 2 }), request('model:http', 'request:http-retry', 'retry'));
  assert.equal(retryRequests, 2);
  assert.equal(events.at(-1).event_type, 'completed');
});

test('resolves a declared secret reference only at request dispatch', async () => {
  const secretManifest = manifest('model:http');
  secretManifest.secret_refs = [{ name: 'api-key', source_ref: 'secret://fixture/provider-key' }];
  const resolvedReferences = [];
  const modelProvider = provider({
    manifest: secretManifest,
    secret_resolver: async (reference) => {
      resolvedReferences.push(reference);
      return 'ephemeral-fixture-value';
    },
  });
  assert.equal(resolvedReferences.length, 0);
  const events = await collect(modelProvider, request('model:http', 'request:http-auth', 'authenticated'));
  assert.equal(events.at(-1).event_type, 'completed');
  assert.deepEqual(resolvedReferences, secretManifest.secret_refs);
  assert.doesNotMatch(JSON.stringify(events), /ephemeral-fixture-value/);
});

test('sanitizes errors thrown by an untrusted secret resolver', async () => {
  const secretManifest = manifest('model:http');
  secretManifest.secret_refs = [{ name: 'api-key', source_ref: 'secret://fixture/provider-key' }];
  const modelProvider = provider({
    manifest: secretManifest,
    secret_resolver: async () => {
      throw new ModelProviderError('resolver included ephemeral-fixture-value', 'unauthorized', { retryable: 'yes' });
    },
  });
  const events = await collect(modelProvider, request('model:http', 'request:http-secret-error', 'tool'));
  assert.equal(events[0].event_type, 'failed');
  assert.equal(events[0].payload.error_code, 'unauthorized');
  assert.equal(events[0].payload.retryable, false);
  assert.equal(events[0].payload.message, 'model provider authorization failed');
  assert.doesNotMatch(JSON.stringify(events), /ephemeral-fixture-value/);
});

test('does not retry a protocol failure after emitting output', async () => {
  const events = await collect(provider({ max_attempts: 3 }), request('model:http', 'request:http-malformed', 'malformed'));
  assert.deepEqual(
    events.map((event) => event.event_type),
    ['content.delta', 'failed'],
  );
  assert.equal(events[1].payload.error_code, 'protocol_error');
  assert.equal(events[1].payload.retryable, false);
  assert.equal(malformedRequests, 1);
});

test('invalid content and tool wire shapes fail as protocol errors without false success', async () => {
  for (const [content, requestId] of [
    ['invalid-content', 'request:http-invalid-content'],
    ['invalid-tool', 'request:http-invalid-tool'],
  ]) {
    const events = await collect(provider({ max_attempts: 2 }), request('model:http', requestId, content));
    assert.deepEqual(
      events.map((event) => event.event_type),
      ['failed'],
    );
    assert.equal(events[0].payload.error_code, 'protocol_error');
    assert.equal(events[0].payload.retryable, false);
  }
});

test('cancels an in-flight HTTP stream with a normalized terminal event', async () => {
  const modelProvider = provider();
  const input = request('model:http', 'request:http-cancel', 'cancel');
  const iterator = validatePortResult('ModelProvider', 'stream', modelProvider.stream(input), input)[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.event_type, 'content.delta');
  assert.equal(modelProvider.cancel({ ...query('model:http', input.request_id), reason: 'deadline' }).accepted, true);
  const terminal = await iterator.next();
  assert.equal(terminal.value.event_type, 'completed');
  assert.equal(terminal.value.payload.finish_reason, 'cancelled');
  await iterator.return();
});

test('HTTP cancellation releases an unstarted reservation without an ABA race', async () => {
  const limitedManifest = manifest('model:http');
  limitedManifest.limits.max_parallel_requests = 1;
  const modelProvider = provider({ manifest: limitedManifest });
  const firstInput = request('model:http', 'request:http-reserved', 'cancel');
  const first = modelProvider.stream(firstInput);
  assert.throws(() => modelProvider.stream(request('model:http', 'request:http-over-limit', 'tool')), /parallel request limit/);
  assert.equal(modelProvider.cancel({ ...query('model:http', firstInput.request_id), reason: 'before iteration' }).accepted, true);
  const replacementInput = request('model:http', firstInput.request_id, 'tool');
  const replacement = modelProvider.stream(replacementInput);
  const cancelled = [];
  for await (const event of validatePortResult('ModelProvider', 'stream', first, firstInput)) cancelled.push(event);
  assert.equal(cancelled[0].payload.finish_reason, 'cancelled');
  const completed = [];
  for await (const event of validatePortResult('ModelProvider', 'stream', replacement, replacementInput)) completed.push(event);
  assert.equal(completed.at(-1).payload.finish_reason, 'tool_calls');
});
