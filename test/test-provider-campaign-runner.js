'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
const { runProviderCampaign } = require('../tools/cli/lib/provider-campaign-runner');
const { manifest } = require('./helpers/provider-control');

function fixture(t, { lost = false, vendor = 'deepseek', noBalance = false, exception = false } = {}) {
  const control = new EngineeringControl();
  t.after(() => {
    control.close();
    control.handle.cleanup();
  });
  const value = manifest(vendor);
  const taskId = randomUUID();
  const plan = {
    schema_version: 1,
    scope: 'pilot',
    campaign_id: randomUUID(),
    authorization_id: randomUUID(),
    create_command_id: randomUUID(),
    cancel_command_id: randomUUID(),
    steps: [{ command_id: randomUUID(), binding_id: value.binding_id, task_id: taskId }],
  };
  let calls = 0;
  const configured = {
    manifest: value,
    binding_sha256: value.binding_sha256,
    adapter: {
      inspect: async () => ({
        binding_sha256: value.binding_sha256,
        artifact_sha256: value.artifact_sha256,
        provider_version: value.provider_version,
        account_sha256: value.authentication.account_sha256,
        authenticated: true,
        auth_source: 'explicit',
        observed_at: Date.now(),
        expires_at: null,
        quota_remaining_requests: noBalance ? null : 3,
        competing_credentials: false,
      }),
      run: async () => {
        calls++;
        if (lost) throw new Error('uncertain');
        return {
          status: 'completed',
          binding_sha256: value.binding_sha256,
          evidence_sha256: 'f'.repeat(64),
          cost_microusd: null,
          input_tokens: 3,
          output_tokens: 1,
        };
      },
    },
  };
  const service = new ProviderCampaignControl(
    control,
    { [value.binding_id]: configured },
    {
      authorizations: {
        [plan.authorization_id]: {
          max_requests: 1,
          max_cost_microusd: 1000,
          deadline: Date.now() + 60_000,
          binding_ids: [value.binding_id],
          task_ids: [taskId],
          ...(exception
            ? { quota_exceptions: { [value.binding_id]: { reason: 'pilot without a balance endpoint', expires_at: Date.now() + 30_000 } } }
            : {}),
        },
      },
    },
  );
  control.providerCampaigns = service;
  const client = {
    bindingInspect: async (id) => service.inspect(id),
    campaign: (input) => service.execute(input),
    campaignQuery: async (id) => service.query(id),
    campaignEvents: async (id, options) => service.events(id, options),
  };
  return { control, plan, service, client, calls: () => calls };
}

test('runner completes a bounded pilot, checks replay and can restart without repeating inference or resetting budget', async (t) => {
  const f = fixture(t);
  const first = await runProviderCampaign(f.client, f.plan);
  const second = await runProviderCampaign(f.client, f.plan);
  assert.deepEqual(second, first);
  assert.equal(first.status, 'control_trial_completed');
  assert.equal(first.real_conformance, 'not_certified');
  assert.equal(first.vendor_session_recovery, 'not_certified');
  assert.equal(first.final.committed_microusd, 1000);
  assert.equal(first.final.cancelled, true);
  assert.equal(f.calls(), 1);
});

test('four-family scope fails before authorization claim if families are missing', async (t) => {
  const f = fixture(t);
  f.plan.scope = 'four-family';
  await assert.rejects(runProviderCampaign(f.client, f.plan), { code: 'CONTROL_CAMPAIGN_COVERAGE_INCOMPLETE' });
  assert.equal(f.service.rows(f.plan.campaign_id).length, 0);
  assert.equal(f.calls(), 0);
});

test('runner preserves uncertain effects across restart and never advances or cancels them implicitly', async (t) => {
  const f = fixture(t, { lost: true });
  for (let retry = 0; retry < 2; retry++)
    await assert.rejects(runProviderCampaign(f.client, f.plan), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  assert.equal(f.calls(), 1);
  assert.equal(f.service.query(f.plan.campaign_id).cancelled, false);
  assert.equal(f.service.query(f.plan.campaign_id).unresolved_commands.length, 1);
});

test('runner rejects duplicate command identity and unexpected vendor before effects', async (t) => {
  const f = fixture(t);
  f.plan.cancel_command_id = f.plan.create_command_id;
  await assert.rejects(runProviderCampaign(f.client, f.plan));
  f.plan.cancel_command_id = randomUUID();
  f.client.bindingInspect = async () => ({ vendor: 'unknown' });
  await assert.rejects(runProviderCampaign(f.client, f.plan), { code: 'CONTROL_CAMPAIGN_VENDOR_UNKNOWN' });
  assert.equal(f.calls(), 0);
});

test('a pilot-only vendor runs as a single-binding pilot and never counts toward the four-family coverage', async (t) => {
  const f = fixture(t, { vendor: 'gemini' });
  const result = await runProviderCampaign(f.client, f.plan);
  assert.equal(result.status, 'control_trial_completed');
  assert.deepEqual(result.covered_vendors, ['gemini']);
  assert.equal(f.calls(), 1);

  const g = fixture(t, { vendor: 'gemini' });
  g.plan.scope = 'four-family';
  await assert.rejects(runProviderCampaign(g.client, g.plan), { code: 'CONTROL_CAMPAIGN_VENDOR_UNKNOWN' });
  // Even beside every required vendor, the pilot-only one is refused in a four-family plan and cannot replace one.
  const inspected = { codex: 'codex', claude: 'claude', deepseek: 'deepseek', gemini: 'gemini' };
  g.plan.steps = Object.keys(inspected).map((id) => ({ command_id: randomUUID(), binding_id: id, task_id: randomUUID() }));
  g.client.bindingInspect = async (id) => ({ vendor: inspected[id] });
  await assert.rejects(runProviderCampaign(g.client, g.plan), { code: 'CONTROL_CAMPAIGN_VENDOR_UNKNOWN' });
  assert.equal(g.service.rows(g.plan.campaign_id).length, 0);
  assert.equal(g.calls(), 0);
});

test('a four-family plan with exactly the four required vendors passes the coverage check', async (t) => {
  const f = fixture(t);
  f.plan.scope = 'four-family';
  const vendorOf = { a: 'codex', b: 'claude', c: 'deepseek', d: 'antigravity' };
  f.plan.steps = Object.keys(vendorOf).map((id) => ({ command_id: randomUUID(), binding_id: id, task_id: randomUUID() }));
  f.client.bindingInspect = async (id) => ({ vendor: vendorOf[id] });
  f.client.campaign = async () => {
    throw Object.assign(new Error('REACHED'), { code: 'REACHED' });
  };
  await assert.rejects(runProviderCampaign(f.client, f.plan), { code: 'REACHED' });
});

test('a pilot-only vendor with more than one binding is refused before effects', async (t) => {
  const f = fixture(t, { vendor: 'gemini' });
  f.plan.steps.push({ command_id: randomUUID(), binding_id: 'binding:second', task_id: randomUUID() });
  f.client.bindingInspect = async () => ({ vendor: 'gemini' });
  await assert.rejects(runProviderCampaign(f.client, f.plan), { code: 'CONTROL_CAMPAIGN_PILOT_SCOPE_INVALID' });
  assert.equal(f.service.rows(f.plan.campaign_id).length, 0);
  assert.equal(f.calls(), 0);
});

test('the compatible API vendor runs as a single-binding pilot and is refused in a four-family plan or with two bindings', async (t) => {
  const f = fixture(t, { vendor: 'openai' });
  const result = await runProviderCampaign(f.client, f.plan);
  assert.deepEqual(result.covered_vendors, ['openai']);
  assert.equal(f.calls(), 1);

  const g = fixture(t, { vendor: 'openai' });
  g.plan.scope = 'four-family';
  await assert.rejects(runProviderCampaign(g.client, g.plan), { code: 'CONTROL_CAMPAIGN_VENDOR_UNKNOWN' });

  const h = fixture(t, { vendor: 'openai' });
  h.plan.steps.push({ command_id: randomUUID(), binding_id: 'binding:second', task_id: randomUUID() });
  h.client.bindingInspect = async () => ({ vendor: 'openai' });
  await assert.rejects(runProviderCampaign(h.client, h.plan), { code: 'CONTROL_CAMPAIGN_PILOT_SCOPE_INVALID' });
  assert.equal(h.calls(), 0);
});

test('a vendor without a balance endpoint is admitted only with an audited quota exception', async (t) => {
  const withException = fixture(t, { vendor: 'openai', noBalance: true, exception: true });
  const result = await runProviderCampaign(withException.client, withException.plan);
  assert.equal(result.status, 'control_trial_completed');
  assert.equal(withException.calls(), 1);

  const without = fixture(t, { vendor: 'openai', noBalance: true });
  await assert.rejects(runProviderCampaign(without.client, without.plan), { code: 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE' });
  assert.equal(without.calls(), 0);
});

test('runner operates through authenticated HTTP and the public SDK', async (t) => {
  const f = fixture(t);
  const { startControlServer } = require('../tools/cli/lib/engineering-control-http');
  const { ControlClient } = require('../packages/control-sdk');
  const credential = randomUUID();
  const server = await startControlServer({ control: f.control, credential });
  try {
    const result = await runProviderCampaign(new ControlClient({ url: server.url, credential }), f.plan);
    assert.equal(result.final.cancelled, true);
    const request = path.join(f.control.state, 'campaign-plan.json');
    fs.writeFileSync(request, JSON.stringify(f.plan));
    const cli = await execFile(
      process.execPath,
      ['tools/cli/hseos-cli.js', 'control', 'campaign-run', '--url', server.url, '--request', request],
      { env: { ...process.env, HSEOS_CONTROL_CREDENTIAL: credential } },
    );
    assert.deepEqual(JSON.parse(cli.stdout), result);
    const discovery = await execFile(process.execPath, ['tools/cli/hseos-cli.js', 'control', 'adapters']);
    assert.equal(JSON.parse(discovery.stdout).implemented[0].adapter, 'hseos-api-campaign-v1');
    assert.equal(f.calls(), 1);
  } finally {
    await server.close();
  }
});
