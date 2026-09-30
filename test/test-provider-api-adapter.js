'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const yaml = require('yaml');
const { manifest } = require('./helpers/provider-control');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const { parseProviderControlManifest } = require('../tools/lib/provider-control-manifest');
const {
  createApiCampaignAdapter,
  credentialFingerprint,
  adapterArtifactDigest,
  API_ADAPTER_ID,
} = require('../tools/cli/lib/provider-api-adapter');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-api-adapter-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binding = yaml.parse(
    fs.readFileSync(path.join(__dirname, '../.agents/activation/provider-bindings/openai-compatible.example.yaml'), 'utf8'),
  );
  binding.provider.base_url = 'https://api.deepseek.com';
  binding.provider.model = 'pinned-model';
  binding.provider.limits.context_tokens = 512;
  binding.provider.limits.max_output_tokens = 64;
  binding.transport.max_attempts = 1;
  const filename = path.join(directory, 'binding.yaml');
  fs.writeFileSync(filename, yaml.stringify(binding));
  const taskId = randomUUID();
  const options = {
    tasks: { [taskId]: { prompt: 'Reply ready.' } },
    pricing: { input_microusd_per_million: 1_000_000, output_microusd_per_million: 1_000_000, valid_until: Date.now() + 120_000 },
  };
  const value = manifest();
  value.adapter = API_ADAPTER_ID;
  value.authentication.credential = binding.provider.secret_refs[0];
  value.authentication.identity_kind = 'credential';
  value.authentication.account_sha256 = null;
  const credential = randomUUID() + randomUUID();
  value.authentication.credential_sha256 = credentialFingerprint(credential);
  value.binding_sha256 = engineeringDigest({ binding, options });
  value.artifact_sha256 = adapterArtifactDigest();
  const environment = { HSEOS_MODEL_PROVIDER_API_KEY: credential, OPENAI_API_KEY: randomUUID() };
  const calls = [];
  const transport = {
    balance: { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '1.000001' }] },
    status: 200,
    frames: [
      { choices: [{ delta: { content: 'ready' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 4, completion_tokens: 1 } },
    ],
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headerMatches: init.headers.authorization === `Bearer ${credential}` });
    assert.equal(init.headers.authorization, `Bearer ${credential}`);
    if (url.endsWith('/user/balance')) return new Response(JSON.stringify(transport.balance), { status: transport.status });
    if (transport.wait) {
      transport.started();
      await new Promise((resolve, reject) => {
        if (init.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }
    transport.onDispatch?.();
    const body = JSON.parse(init.body);
    assert.equal(body.model, binding.provider.model);
    assert.equal(body.max_tokens, 64);
    assert.equal(body.tools, undefined);
    return new Response(transport.frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const create = () =>
    createApiCampaignAdapter({ manifest: parseProviderControlManifest(value), binding: filename, options }, { environment, fetchImpl });
  return { create, value, environment, transport, calls, filename, binding, options, taskId, credential };
}

test('real API adapter is lazy, observes selected credential and USD balance, and streams through existing egress broker', async (t) => {
  const f = fixture(t);
  const configured = f.create();
  assert.equal(f.calls.length, 0);
  const observation = await configured.adapter.inspect();
  assert.equal(observation.account_sha256, null);
  assert.equal(observation.credential_sha256, credentialFingerprint(f.credential));
  assert.equal(observation.quota_remaining_requests, null);
  assert.equal(observation.quota_available_microusd, 1_000_001);
  const receipt = await configured.adapter.run({ task_id: f.taskId, request_id: randomUUID(), signal: new AbortController().signal });
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.input_tokens, 4);
  assert.equal(receipt.cost_microusd, null);
  assert.equal(receipt.evidence_sha256.length, 64);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((call) => call.headerMatches));
  assert.ok(!JSON.stringify({ receipt, observation }).includes(f.credential));
});

test('API adapter refuses credential and binding drift before network effects', async (t) => {
  const f = fixture(t);
  const { adapter } = f.create();
  f.environment.HSEOS_MODEL_PROVIDER_API_KEY = randomUUID();
  await assert.rejects(adapter.inspect(), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  f.environment.HSEOS_MODEL_PROVIDER_API_KEY = f.credential;
  f.binding.provider.model = 'changed';
  fs.writeFileSync(f.filename, yaml.stringify(f.binding));
  await assert.rejects(adapter.inspect(), { code: 'CONTROL_PROVIDER_BINDING_DRIFT' });
  assert.equal(f.calls.length, 0);
});

test('API adapter refuses unsupported origin, insufficient reservation and expired pricing', async (t) => {
  const f = fixture(t);
  f.value.billing.max_request_microusd = 1;
  assert.throws(f.create, { code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED' });
  f.value.billing.max_request_microusd = 1000;
  f.options.pricing.valid_until = 1;
  f.value.binding_sha256 = engineeringDigest({ binding: f.binding, options: f.options });
  await assert.rejects(f.create().adapter.inspect(), { code: 'CONTROL_PROVIDER_PRICING_EXPIRED' });
  f.binding.provider.base_url = 'https://untrusted.invalid';
  fs.writeFileSync(f.filename, yaml.stringify(f.binding));
  f.value.binding_sha256 = engineeringDigest({ binding: f.binding, options: f.options });
  assert.throws(f.create, { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  assert.equal(f.calls.length, 0);
});

test('balance observation cannot invent quota or convert currencies', async (t) => {
  const f = fixture(t);
  const { adapter } = f.create();
  for (const balance of [
    {},
    { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10' }] },
    { is_available: true, balance_infos: [{ currency: 'USD', total_balance: 'NaN' }] },
    { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '999999999999' }] },
  ]) {
    f.transport.balance = balance;
    await assert.rejects(adapter.inspect(), { code: 'CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE' });
  }
  f.transport.status = 401;
  await assert.rejects(adapter.inspect(), { code: 'CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE' });
  f.transport.status = 200;
  f.transport.balance = { is_available: false, balance_infos: [{ currency: 'USD', total_balance: '10' }] };
  assert.equal((await adapter.inspect()).quota_available_microusd, 0);
});

test('missing usage, cancellation and unknown task never become successful receipts', async (t) => {
  const f = fixture(t);
  const { adapter } = f.create();
  const input = { task_id: f.taskId, request_id: randomUUID(), signal: new AbortController().signal };
  await assert.rejects(adapter.run({ ...input, task_id: randomUUID() }), { code: 'CONTROL_CAMPAIGN_SCOPE_DENIED' });
  await assert.rejects(adapter.run({ ...input, signal: AbortSignal.abort() }), { code: 'CONTROL_CAMPAIGN_CANCELLED' });
  assert.equal(f.calls.length, 0);
  f.transport.frames.pop();
  await assert.rejects(adapter.run(input), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
});

test('API adapter cancellation aborts the broker request and drains its connection', async (t) => {
  const f = fixture(t);
  const { adapter } = f.create();
  const abort = new AbortController();
  f.transport.wait = true;
  const ready = new Promise((resolve) => {
    f.transport.started = resolve;
  });
  const running = assert.rejects(adapter.run({ task_id: f.taskId, request_id: randomUUID(), signal: abort.signal }), (error) =>
    ['CONTROL_CAMPAIGN_CANCELLED', 'CONTROL_OUTCOME_UNCERTAIN'].includes(error.code),
  );
  await ready;
  abort.abort();
  await running;
  assert.equal(f.calls.length, 1);
});

test('API adapter and campaign integrate credential admission, monetary quota and reservation before dispatch', async (t) => {
  const f = fixture(t);
  const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
  const authorizationId = randomUUID(),
    campaignId = randomUUID();
  const control = new EngineeringControl({
    providerBindings: { [f.value.binding_id]: { ...f.create(), manifest: f.value } },
    providerAuthorizations: {
      [authorizationId]: {
        max_requests: 1,
        max_cost_microusd: 1000,
        deadline: Date.now() + 60_000,
        binding_ids: [f.value.binding_id],
        task_ids: [f.taskId],
      },
    },
  });
  t.after(() => {
    control.close();
    control.handle.cleanup();
  });
  const service = control.providerCampaigns;
  const command = (action, input) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: service.rows(campaignId).length,
    action,
    input,
  });
  await service.execute(command('create', { authorization_id: authorizationId }));
  f.transport.onDispatch = () => assert.equal(service.query(campaignId).committed_microusd, 1000);
  await service.execute(command('run', { binding_id: f.value.binding_id, task_id: f.taskId }));
  const state = service.query(campaignId);
  assert.equal(state.requests, 1);
  assert.equal(state.committed_microusd, 1000);
  assert.deepEqual(state.unresolved_commands, []);
  assert.equal(f.calls.length, 2);
});
