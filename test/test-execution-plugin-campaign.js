'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const test = require('node:test');
const { z } = require('zod');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const { admitExecutionPlugin } = require('../tools/lib/execution-plugin-manifest');
const { createExecutionPluginCampaignBinding } = require('../tools/cli/lib/execution-plugin-campaign');
const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { parseProviderControlManifest, inspectProviderControlManifest } = require('../tools/lib/provider-control-manifest');
const { manifest: legacyManifest } = require('./helpers/provider-control');
const sha = (value) => createHash('sha256').update(value).digest('hex');
function plugin(t, source = 'module.exports=({input})=>({text:input.text.toUpperCase()});') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-campaign-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'entry.cjs'), source);
  const manifest = {
    schema_version: 1,
    id: 'campaign-plugin',
    version: '1.0.0',
    kind: 'model-provider',
    compatibility: { contract_version: 1, node_majors: [22, 24] },
    entrypoint: 'entry.cjs',
    files: { 'entry.cjs': sha(source) },
    capabilities: ['generate'],
    limits: { timeout_ms: 3000, max_output_bytes: 8192, memory_max_bytes: 268_435_456, pids_max: 32 },
    dependencies: [],
    conformance: ['entry.cjs'],
  };
  fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(manifest));
  const admission = admitExecutionPlugin(directory, {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    manifest_sha256: sha(canonicalize(manifest)),
    contract_version: 1,
    node_major: Number(process.versions.node.split('.')[0]),
    allowed_capabilities: ['generate'],
    limits: manifest.limits,
  });
  return { admission, directory };
}
async function fixture(t, options = {}) {
  const f = plugin(t, options.source);
  const config = {
    admission: f.admission,
    binding_id: 'plugin-local',
    limits: { max_requests: 3, max_input_tokens: 1024, max_output_tokens: 1024, max_duration_ms: 3000 },
    output_schema: z.object({ text: z.string() }).strict(),
  };
  const port = createExecutionPluginCampaignBinding(config);
  const control = new EngineeringControl();
  const authorizationId = randomUUID(),
    campaignId = randomUUID(),
    taskId = randomUUID();
  const campaigns = new ProviderCampaignControl(
    control,
    { 'plugin-local': port.binding },
    {
      authorizations: {
        [authorizationId]: {
          max_requests: 3,
          max_cost_microusd: 0,
          deadline: Date.now() + 30_000,
          binding_ids: ['plugin-local'],
          task_ids: [taskId],
        },
      },
    },
  );
  const command = (action, input = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: campaigns.rows(campaignId).length,
    action,
    input,
  });
  await campaigns.execute(command('create', { authorization_id: authorizationId }));
  port.attach({ campaign: campaigns, campaign_id: campaignId, task_id: taskId });
  t.after(async () => {
    await port.close().catch(() => {});
    await campaigns.shutdown();
    control.close();
    control.handle.cleanup();
  });
  return { ...f, port, config, control, campaigns, campaignId, taskId, authorizationId, command };
}
const request = () => ({ request_id: randomUUID(), method: 'generate', input: { text: 'hello' } });
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('v2 pins a local plugin without weakening v1 routes or inventing account certification', async (t) => {
  const f = await fixture(t);
  const value = f.port.binding.manifest;
  assert.equal(parseProviderControlManifest(legacyManifest()).schema_version, 1);
  const report = inspectProviderControlManifest(value, value.binding_sha256);
  assert.equal(report.official_source, null);
  assert.equal(report.real_conformance, 'not_certified');
  for (const patch of [
    { schema_version: 1 },
    { vendor: 'deepseek' },
    { route: 'api' },
    { transport: 'http' },
    { execution_plugin: undefined },
    { artifact_sha256: 'a'.repeat(64) },
  ])
    assert.throws(() => parseProviderControlManifest({ ...value, ...patch }), { code: 'CONTROL_PROVIDER_MANIFEST_INVALID' });
  assert.throws(() => parseProviderControlManifest({ ...legacyManifest(), schema_version: 2 }), {
    code: 'CONTROL_PROVIDER_MANIFEST_INVALID',
  });
});

test('local dispatch sees a durable reservation and persists output for replay after reopening', async (t) => {
  const f = await fixture(t);
  const req = request();
  let launches = 0;
  const make = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', (...args) => {
    if (String(args[0]).includes('hseos-plugin-execution-')) {
      launches++;
      assert.ok(f.campaigns.rows(f.campaignId).some((row) => row.payload.kind === 'reserved' && row.payload.command_id === req.request_id));
    }
    return make(...args);
  });
  const result = await f.port.execute(req);
  assert.deepEqual(result.result, { text: 'HELLO' });
  assert.deepEqual(await f.port.execute(req), result);
  assert.equal(launches, 1);
  const restarted = createExecutionPluginCampaignBinding(f.config);
  const campaigns = new ProviderCampaignControl(f.control, { 'plugin-local': restarted.binding });
  restarted.attach({ campaign: campaigns, campaign_id: f.campaignId, task_id: f.taskId });
  assert.deepEqual(await restarted.execute(req), result);
  assert.equal(launches, 1);
  await restarted.close();
  assert.equal(campaigns.query(f.campaignId).requests, 1);
  assert.equal(campaigns.query(f.campaignId).committed_microusd, 0);
  await rejects(f.port.execute({ ...req, input: { text: 'changed' } }), 'PLUGIN_REQUEST_CONFLICT');
});

test('unknown capability, oversized input, foreign campaign and direct run fail before effects', async (t) => {
  const f = await fixture(t);
  await rejects(f.port.execute({ ...request(), method: 'network' }), 'PLUGIN_PORT_AUTHORITY');
  await rejects(f.port.execute({ ...request(), input: { text: 'x'.repeat(2000) } }), 'PLUGIN_PROVIDER_INPUT_LIMIT');
  await rejects(
    f.port.binding.adapter.run({ task_id: f.taskId, request_id: randomUUID(), signal: new AbortController().signal }),
    'PLUGIN_CAMPAIGN_RESERVATION_REQUIRED',
  );
  assert.equal(f.campaigns.query(f.campaignId).requests, 0);
  const port = createExecutionPluginCampaignBinding(f.config);
  assert.throws(() => port.attach({ campaign: f.campaigns, campaign_id: f.campaignId, task_id: f.taskId }), {
    code: 'PLUGIN_CAMPAIGN_BINDING_REQUIRED',
  });
  await rejects(port.execute(request()), 'PLUGIN_CAMPAIGN_BINDING_REQUIRED');
  assert.throws(() => createExecutionPluginCampaignBinding({ ...f.config, limits: { ...f.config.limits, max_duration_ms: 4000 } }), {
    code: 'PLUGIN_PORT_LIMIT',
  });
});

test('lost receipt after output remains committed and never dispatches the uncertain request twice', async (t) => {
  const f = await fixture(t);
  const req = request();
  const append = f.campaigns.append.bind(f.campaigns);
  let lost = true;
  f.campaigns.append = (id, payload, ...rest) => {
    if (lost && payload.kind === 'receipt') {
      lost = false;
      throw new Error('receipt lost');
    }
    return append(id, payload, ...rest);
  };
  await rejects(f.port.execute(req), 'CONTROL_OUTCOME_UNCERTAIN');
  assert.ok(f.campaigns.rows(f.campaignId).some((row) => row.payload.kind === 'plugin_result'));
  assert.equal(f.campaigns.query(f.campaignId).requests, 1);
  const restarted = createExecutionPluginCampaignBinding(f.config);
  const campaigns = new ProviderCampaignControl(f.control, { 'plugin-local': restarted.binding });
  restarted.attach({ campaign: campaigns, campaign_id: f.campaignId, task_id: f.taskId });
  await rejects(restarted.execute(req), 'CONTROL_OUTCOME_UNCERTAIN');
  assert.equal(campaigns.query(f.campaignId).requests, 1);
  await rejects(restarted.close(), 'PLUGIN_RESULT_UNCERTAIN');
});

test('campaign limits and one-time authorization cannot be reset by an extension', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++) await f.port.execute(request());
  await rejects(f.port.execute(request()), 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED');
  await rejects(
    f.campaigns.execute({
      ...f.command('create', { authorization_id: f.authorizationId }),
      resource_id: randomUUID(),
      expected_sequence: 0,
    }),
    'CONTROL_CAMPAIGN_AUTHORIZATION_USED',
  );
  assert.equal(f.campaigns.query(f.campaignId).requests, 3);
});

test('malformed provider output conserves uncertainty instead of writing a successful receipt', async (t) => {
  const f = await fixture(t, { source: 'module.exports=()=>({text:7});' });
  await rejects(f.port.execute(request()), 'CONTROL_OUTCOME_UNCERTAIN');
  assert.equal(f.campaigns.query(f.campaignId).requests, 1);
  assert.ok(f.campaigns.query(f.campaignId).unresolved_commands.length > 0);
  await rejects(f.port.close(), 'PLUGIN_RESULT_UNCERTAIN');
});

test('cancellation drains isolated work before a cancelled campaign receipt', async (t) => {
  const f = await fixture(t, { source: 'module.exports=()=>new Promise(()=>setInterval(()=>{},100));' });
  const controller = new AbortController();
  const pending = f.port.execute(request(), { signal: controller.signal });
  const rejected = rejects(pending, 'PLUGIN_CANCELLED');
  await new Promise((resolve) => setTimeout(resolve, 150));
  controller.abort();
  await rejected;
  assert.equal(f.campaigns.query(f.campaignId).unresolved_commands.length, 0);
  const receipt = f.campaigns.rows(f.campaignId).find((row) => row.payload.kind === 'receipt').payload.receipt;
  assert.equal(receipt.status, 'cancelled');
  await f.port.close();
});

test('same request cannot expose a previous task result through another task binding', async (t) => {
  const f = await fixture(t);
  const req = request();
  await f.port.execute(req);
  const other = createExecutionPluginCampaignBinding(f.config);
  const campaigns = new ProviderCampaignControl(f.control, { 'plugin-local': other.binding });
  assert.throws(() => other.attach({ campaign: campaigns, campaign_id: f.campaignId, task_id: randomUUID() }), {
    code: 'PLUGIN_CAMPAIGN_BINDING_REQUIRED',
  });
  await rejects(other.execute(req), 'PLUGIN_CAMPAIGN_BINDING_REQUIRED');
  await other.close();
});

test('changed binding limits or output contracts cannot join an existing campaign', async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { limits: { ...f.config.limits, max_requests: 9 } },
    { output_schema: z.object({ text: z.string(), more: z.string().optional() }).strict() },
  ]) {
    const changed = createExecutionPluginCampaignBinding({ ...f.config, ...patch });
    const campaigns = new ProviderCampaignControl(f.control, { 'plugin-local': changed.binding });
    assert.throws(() => changed.attach({ campaign: campaigns, campaign_id: f.campaignId, task_id: f.taskId }), {
      code: 'PLUGIN_CAMPAIGN_BINDING_REQUIRED',
    });
    await changed.close();
  }
});

test('pre-abort, invalid signal and closed ports cannot reserve work', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await rejects(f.port.execute(request(), { signal: controller.signal }), 'PLUGIN_CANCELLED');
  await rejects(f.port.execute(request(), { signal: {} }), 'PLUGIN_REQUEST_INVALID');
  await f.port.close();
  await rejects(f.port.execute(request()), 'PLUGIN_CAMPAIGN_BINDING_REQUIRED');
  assert.equal(f.campaigns.query(f.campaignId).requests, 0);
});

test('concurrent duplicate requests cannot launch a second process and close drains the first', async (t) => {
  const f = await fixture(t, { source: 'module.exports=()=>new Promise(()=>setInterval(()=>{},100));' });
  const req = request();
  const pending = f.port.execute(req);
  const cancelled = rejects(pending, 'PLUGIN_CANCELLED');
  await rejects(f.port.execute(req), 'PLUGIN_REQUEST_ACTIVE');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await f.port.close();
  await cancelled;
  assert.equal(f.campaigns.query(f.campaignId).requests, 1);
});

test('oversized output remains uncertain and cannot release the consumed request', async (t) => {
  const f = await fixture(t, { source: 'module.exports=()=>({text:"x".repeat(1500)});' });
  await rejects(f.port.execute(request()), 'CONTROL_OUTCOME_UNCERTAIN');
  assert.equal(f.campaigns.query(f.campaignId).requests, 1);
});

test('host response validation identity is pinned and requires a synchronous validator', async (t) => {
  const f = await fixture(t);
  const custom = createExecutionPluginCampaignBinding({
    ...f.config,
    response_validation: { contract_id: 'response-v1', validate: () => true },
  });
  assert.notEqual(custom.binding.manifest.binding_sha256, f.port.binding.manifest.binding_sha256);
  assert.throws(
    () =>
      createExecutionPluginCampaignBinding({
        ...f.config,
        response_validation: { contract_id: 'response-v1' },
      }),
    { code: 'PLUGIN_OUTPUT_SCHEMA_REQUIRED' },
  );
  assert.throws(() => createExecutionPluginCampaignBinding({ ...f.config, response_validation: {} }));
  await custom.close();
});
