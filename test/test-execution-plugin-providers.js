'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const test = require('node:test');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const { assertPortShape, validatePortResult } = require('../packages/agent-runtime-contracts');
const { ModelProviderRegistry } = require('../packages/model-providers');
const { admitExecutionPlugin } = require('../tools/lib/execution-plugin-manifest');
const { createExecutionPluginModel } = require('../tools/cli/lib/execution-plugin-model');
const { createExecutionPluginProvider } = require('../tools/cli/lib/execution-plugin-provider');
const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const fixtures = require('./fixtures/agent-runtime-contracts');
const { executorOwner } = require('../packages/agent-isolation-attestation/executor');
function ownedGroups() {
  const parent = executorOwner().resource_parent;
  return fs
    .readdirSync(parent)
    .filter((name) => name.startsWith(`hseos-executor-${process.pid}-`))
    .map((name) => path.join(parent, name));
}
async function waitForSandbox() {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (ownedGroups().some((group) => /populated 1/.test(fs.readFileSync(path.join(group, 'cgroup.events'), 'utf8')))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('sandbox did not become populated before cancellation');
}
const sha = (value) => createHash('sha256').update(value).digest('hex');
async function setup(t, { kind = 'model-provider', source, capabilities } = {}) {
  const runtime = kind === 'runtime-provider';
  source ??= runtime
    ? 'module.exports=({input})=>({text:input.instruction.toUpperCase()});'
    : 'module.exports=({input})=>({text:input.messages.at(-1).content.toUpperCase(),tool_calls:[]});';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-provider-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'entry.cjs'), source);
  const manifest = {
    schema_version: 1,
    id: 'provider-plugin',
    version: '1.0.0',
    kind,
    compatibility: { contract_version: 1, node_majors: [22, 24] },
    entrypoint: 'entry.cjs',
    files: { 'entry.cjs': sha(source) },
    capabilities: capabilities || (runtime ? ['send'] : ['generate', 'tool_calls']),
    limits: { timeout_ms: 3000, max_output_bytes: 65_536, memory_max_bytes: 268_435_456, pids_max: 32 },
    dependencies: [],
    conformance: ['entry.cjs'],
  };
  fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(manifest));
  const admission = admitExecutionPlugin(directory, {
    id: manifest.id,
    version: manifest.version,
    kind,
    manifest_sha256: sha(canonicalize(manifest)),
    node_major: Number(process.versions.node.split('.')[0]),
    contract_version: 1,
    allowed_capabilities: manifest.capabilities,
    limits: manifest.limits,
  });
  const config = {
    admission,
    binding_id: 'plugin-provider',
    models: ['plugin/test'],
    limits: { max_requests: 10, max_input_tokens: 16_384, max_output_tokens: 8192, max_duration_ms: 3000 },
  };
  const port = (runtime ? createExecutionPluginProvider : createExecutionPluginModel)(config);
  const control = new EngineeringControl();
  const campaignId = randomUUID(),
    taskId = randomUUID(),
    auth = randomUUID();
  const campaigns = new ProviderCampaignControl(
    control,
    { 'plugin-provider': port.binding },
    {
      authorizations: {
        [auth]: {
          max_requests: 10,
          max_cost_microusd: 0,
          deadline: Date.now() + 60_000,
          binding_ids: ['plugin-provider'],
          task_ids: [taskId],
        },
      },
    },
  );
  await campaigns.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: 0,
    action: 'create',
    input: { authorization_id: auth },
  });
  port.attach({ campaign: campaigns, campaign_id: campaignId, task_id: taskId });
  t.after(async () => {
    await port.close().catch(() => {});
    await campaigns.shutdown();
    control.close();
    control.handle.cleanup();
  });
  return { port, config, control, campaigns, campaignId };
}
function modelRequest(f, overrides = {}) {
  return { ...structuredClone(fixtures.modelRequest), provider_id: f.port.manifest.provider_id, model: 'plugin/test', ...overrides };
}
function query(f, request_id = 'query:plugin') {
  return { schema_version: 1, provider_id: f.port.manifest.provider_id, request_id };
}
async function modelEvents(f, input = modelRequest(f)) {
  return Array.fromAsync(validatePortResult('ModelProvider', 'stream', f.port.provider.stream(input), input));
}
async function createRuntime(f) {
  const id = f.port.manifest.provider_id;
  const input = {
    schema_version: 1,
    command: 'create',
    provider_id: id,
    spec: { ...structuredClone(fixtures.delegatedSession), execution: { mode: 'delegated', runtime_provider_id: id, profile: 'plugin' } },
  };
  const result = validatePortResult('RuntimeProvider', 'create', await f.port.provider.create(input), input);
  return { schema_version: 1, provider_id: id, runtime_session_id: result.runtime_session_id, session_id: input.spec.session_id };
}
async function runtimeEvents(f, identity) {
  const input = { ...identity, from_sequence: 0 };
  return Array.fromAsync(validatePortResult('RuntimeProvider', 'events', f.port.provider.events(input), input));
}

test('model manifest is lazy, registry-compatible and stream identity survives durable replay', async (t) => {
  const f = await setup(t);
  assertPortShape('ModelProvider', f.port.provider);
  const registry = new ModelProviderRegistry();
  registry.register(f.port.provider, f.port.manifest);
  assert.equal(registry.snapshot().resolve(f.port.manifest.provider_id).provider, f.port.provider);
  assert.equal(f.campaigns.query(f.campaignId).requests, 0);
  assert.deepEqual(f.port.provider.discover(query(f)).models, ['plugin/test']);
  const events = await modelEvents(f);
  assert.equal(events.at(-1).event_type, 'completed');
  assert.equal(events.find((e) => e.event_type === 'content.delta').payload.text, 'READ THE FIXTURE');
  assert.ok(events[0].payload.input_tokens > 0);
  assert.deepEqual(await modelEvents(f), events);
  assert.equal(f.campaigns.query(f.campaignId).requests, 1);
});

test('model tool proposals are normalized and undeclared tools fail without execution', async (t) => {
  const f = await setup(t, { source: 'module.exports=()=>({text:"",tool_calls:[{tool_call_id:"call:1",name:"fixture.read",input:{}}]});' });
  const events = await modelEvents(f);
  assert.equal(events.at(-1).payload.finish_reason, 'tool_calls');
  assert.equal(events.find((e) => e.event_type === 'tool_call.delta').payload.arguments_delta, '{}');
  const input = modelRequest(f, { request_id: 'request:other', tools: [] });
  await assert.rejects(modelEvents(f, input), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  assert.equal(f.campaigns.query(f.campaignId).unresolved_commands.length, 1);
  assert.equal(f.campaigns.rows(f.campaignId).filter((row) => row.payload.kind === 'plugin_result').length, 1);
  const requests = f.campaigns.query(f.campaignId).requests;
  await assert.rejects(modelEvents(f, input), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  assert.equal(f.campaigns.query(f.campaignId).requests, requests);
  await assert.rejects(f.port.close(), { code: 'PLUGIN_RESULT_UNCERTAIN' });
});

test('model rejects unknown selection, capabilities and concurrent reservations before dispatch', async (t) => {
  const f = await setup(t);
  const input = modelRequest(f);
  const stream = f.port.provider.stream(input);
  assert.throws(
    () => f.port.provider.stream(input),
    (error) => error.error_code === 'rate_limited',
  );
  await stream.return();
  assert.equal(f.campaigns.query(f.campaignId).requests, 0);
  assert.throws(
    () => f.port.provider.stream({ ...input, model: 'other' }),
    (error) => error.error_code === 'invalid_request',
  );
  const limited = await setup(t, { capabilities: ['generate'] });
  assert.throws(
    () => limited.port.provider.stream(modelRequest(limited)),
    (error) => error.error_code === 'capability_unavailable',
  );
  assert.throws(() => createExecutionPluginProvider(f.config), { code: 'PLUGIN_PORT_KIND' });
});

test('model cancellation drains pending work and unstarted reservations cannot leak', async (t) => {
  const f = await setup(t, { source: 'module.exports=()=>new Promise(()=>setInterval(()=>{},100));' });
  const input = modelRequest(f);
  const pending = modelEvents(f, input);
  await waitForSandbox();
  const cancellation = { ...query(f, input.request_id), reason: 'stop' };
  assert.equal((await f.port.provider.cancel(cancellation)).accepted, true);
  assert.equal((await pending).at(-1).payload.finish_reason, 'cancelled');
  assert.deepEqual(ownedGroups(), []);
  const unused = f.port.provider.stream({ ...input, request_id: 'request:unused' });
  await f.port.provider.cancel({ ...query(f, 'request:unused'), reason: 'stop' });
  await unused.return();
  assert.equal(f.campaigns.query(f.campaignId).requests, 1);
  assert.equal((await f.port.provider.cancel({ ...query(f, 'request:absent'), reason: 'stop' })).accepted, false);
});

test('model output over requested budget retains uncertainty and cannot close safely', async (t) => {
  const f = await setup(t, { source: 'module.exports=()=>({text:"x".repeat(200),tool_calls:[]});' });
  const input = modelRequest(f);
  input.parameters.max_output_tokens = 50;
  await assert.rejects(modelEvents(f, input), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  assert.equal(f.campaigns.query(f.campaignId).unresolved_commands.length, 1);
  assert.equal(f.campaigns.rows(f.campaignId).filter((row) => row.payload.kind === 'plugin_result').length, 0);
  await assert.rejects(f.port.close(), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  assert.throws(
    () => f.port.provider.stream(input),
    (error) => error.error_code === 'provider_unavailable',
  );
});

test('uncertain model output cannot be reported as completed or disposed safely', async (t) => {
  const f = await setup(t, { source: 'module.exports=()=>({text:7,tool_calls:[]});' });
  await assert.rejects(modelEvents(f), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  await assert.rejects(f.port.close(), { code: 'PLUGIN_RESULT_UNCERTAIN' });
});

test('runtime uses the existing L0 lifecycle with verified port results and durable campaign effects', async (t) => {
  const f = await setup(t, { kind: 'runtime-provider' });
  assertPortShape('RuntimeProvider', f.port.provider);
  assert.equal(f.port.provider.manifest(query(f)).conformance_level, 'L0');
  assert.equal(f.campaigns.query(f.campaignId).requests, 0);
  const identity = await createRuntime(f);
  await assert.rejects(
    f.port.provider.resume({ ...identity, command: 'resume', expected_sequence: 1 }),
    (error) => error.error_code === 'capability_unavailable',
  );
  const input = { ...identity, command: 'send', turn_id: 'turn:plugin', message: { role: 'user', content: 'hello' } };
  validatePortResult('RuntimeProvider', 'send', await f.port.provider.send(input), input);
  const events = await runtimeEvents(f, identity);
  assert.equal(events.at(-1).event_type, 'runtime.session.completed');
  assert.equal(events.find((e) => e.event_type === 'runtime.message.delta').payload.text, 'HELLO');
  const dispose = { ...identity, command: 'dispose' };
  validatePortResult('RuntimeProvider', 'dispose', await f.port.provider.dispose(dispose), dispose);
  assert.equal(f.campaigns.query(f.campaignId).requests, 1);
  assert.throws(() => createExecutionPluginModel(f.config), { code: 'PLUGIN_PORT_KIND' });
});

test('runtime refuses cross-session cancellation and drains valid cancellation', async (t) => {
  const f = await setup(t, { kind: 'runtime-provider', source: 'module.exports=()=>new Promise(()=>setInterval(()=>{},100));' });
  const identity = await createRuntime(f);
  await f.port.provider.send({ ...identity, command: 'send', turn_id: 'turn:plugin', message: { role: 'user', content: 'wait' } });
  const events = runtimeEvents(f, identity);
  const input = { ...identity, command: 'cancel', reason: 'stop', cascade: true };
  await waitForSandbox();
  await assert.rejects(f.port.provider.cancel({ ...input, session_id: 'session:other' }));
  assert.ok(ownedGroups().length > 0);
  validatePortResult('RuntimeProvider', 'cancel', await f.port.provider.cancel(input), input);
  assert.equal((await events).at(-1).payload.error_code, 'cancelled');
  assert.deepEqual(ownedGroups(), []);
});

test('runtime never emits a terminal success when the plugin response is uncertain', async (t) => {
  const f = await setup(t, { kind: 'runtime-provider', source: 'module.exports=()=>({text:7});' });
  const identity = await createRuntime(f);
  await f.port.provider.send({ ...identity, command: 'send', turn_id: 'turn:plugin', message: { role: 'user', content: 'hello' } });
  await assert.rejects(runtimeEvents(f, identity), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  await assert.rejects(f.port.close(), { code: 'PLUGIN_RESULT_UNCERTAIN' });
});

test('cancelling buffered model output emits no later text or tool proposals', async (t) => {
  const f = await setup(t);
  const input = modelRequest(f);
  const stream = f.port.provider.stream(input);
  assert.equal((await stream.next()).value.event_type, 'usage');
  await f.port.provider.cancel({ ...query(f, input.request_id), reason: 'stop' });
  assert.equal((await stream.next()).value.payload.finish_reason, 'cancelled');
  await stream.return();
});

test('uncertain executor teardown cannot be hidden by closing the model iterator', async (t) => {
  const f = await setup(t);
  const original = fs.writeFileSync;
  let inject = true;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (inject && String(file).endsWith('/cgroup.kill')) {
      inject = false;
      throw Object.assign(new Error('injected'), { code: 'EIO' });
    }
    return original(file, ...args);
  });
  const stream = f.port.provider.stream(modelRequest(f));
  await assert.rejects(stream.next(), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  await assert.rejects(stream.return(), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  await assert.rejects(f.port.close(), { code: 'PLUGIN_RESULT_UNCERTAIN' });
});
