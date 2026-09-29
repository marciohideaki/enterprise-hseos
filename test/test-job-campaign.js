'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
const { manifest } = require('./helpers/provider-control');

test('campaign requires reciprocal authorization and keeps an uncertain reservation committed', async (t) => {
  const control = new EngineeringControl();
  t.after(() => {
    control.close();
    control.handle.cleanup();
  });
  const campaignId = randomUUID();
  const authorizationId = randomUUID();
  const taskId = randomUUID();
  const binding = manifest();
  let effects = 0;
  let campaigns;
  const service = {
    manifest: binding,
    binding_sha256: binding.binding_sha256,
    adapter: {
      async inspect() {
        return {
          binding_sha256: binding.binding_sha256,
          artifact_sha256: binding.artifact_sha256,
          provider_version: binding.provider_version,
          account_sha256: binding.authentication.account_sha256,
          authenticated: true,
          auth_source: binding.authentication.source,
          observed_at: Date.now(),
          expires_at: Date.now() + 30_000,
          quota_remaining_requests: 1,
          competing_credentials: false,
        };
      },
      async run({ request_id }) {
        effects++;
        const rows = campaigns.rows(campaignId);
        assert.equal(
          rows.some((row) => row.payload.kind === 'reserved' && row.payload.command_id === request_id),
          true,
        );
        throw new Error('receipt lost after effect');
      },
    },
  };
  campaigns = new ProviderCampaignControl(
    control,
    { [binding.binding_id]: service },
    {
      authorizations: {
        [authorizationId]: {
          max_requests: 1,
          max_cost_microusd: 1000,
          deadline: Date.now() + 60_000,
          binding_ids: [binding.binding_id],
          task_ids: [taskId],
        },
      },
    },
  );
  const command = (action, input = {}, resourceId = campaignId) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: resourceId,
    expected_sequence: campaigns.rows(resourceId).length,
    action,
    input,
  });
  await campaigns.execute(command('create', { authorization_id: authorizationId }));
  const original = control.ledger.readStream.bind(control.ledger);
  const read = t.mock.method(control.ledger, 'readStream', (aggregate, id) => {
    const rows = original(aggregate, id);
    if (aggregate !== 'control_provider_authorization' || id !== authorizationId) return rows;
    return rows.map((row) => ({ ...row, payload: { ...row.payload, campaign_id: randomUUID() } }));
  });
  assert.throws(() => campaigns.query(campaignId), { code: 'CONTROL_CAMPAIGN_AUTHORIZATION_INVALID' });
  await assert.rejects(campaigns.execute(command('run', { binding_id: binding.binding_id, task_id: taskId })), {
    code: 'CONTROL_CAMPAIGN_AUTHORIZATION_INVALID',
  });
  assert.equal(effects, 0);
  read.mock.restore();

  const run = command('run', { binding_id: binding.binding_id, task_id: taskId });
  await assert.rejects(campaigns.execute(run), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  await assert.rejects(campaigns.execute(run), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  assert.equal(effects, 1);
  const report = campaigns.query(campaignId);
  assert.equal(report.requests, 1);
  assert.equal(report.committed_microusd, 1000);
  assert.deepEqual(report.unresolved_commands, [run.command_id]);
  await campaigns.execute(
    command('reconcile', { report_sha256: report.report_sha256, answer: 'Effect observed; retain original reservation.' }),
  );
  assert.equal(campaigns.query(campaignId).committed_microusd, 1000);
  await assert.rejects(campaigns.execute(command('run', { binding_id: binding.binding_id, task_id: taskId })), {
    code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED',
  });
  await assert.rejects(campaigns.execute(command('create', { authorization_id: authorizationId }, randomUUID())), {
    code: 'CONTROL_CAMPAIGN_AUTHORIZATION_USED',
  });
  assert.equal(effects, 1);
});
