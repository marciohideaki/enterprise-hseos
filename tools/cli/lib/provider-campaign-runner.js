'use strict';
const { z } = require('zod');
const { engineeringDigest } = require('./engineering-task-state');
const vendors = ['codex', 'claude', 'deepseek', 'antigravity'];
const uuid = z.string().uuid();
const planSchema = z
  .object({
    schema_version: z.literal(1),
    scope: z.enum(['pilot', 'four-family']),
    campaign_id: uuid,
    authorization_id: uuid,
    create_command_id: uuid,
    cancel_command_id: uuid,
    steps: z
      .array(z.object({ command_id: uuid, binding_id: z.string().min(1).max(160), task_id: uuid, resume_from: uuid.optional() }).strict())
      .min(1)
      .max(16),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = [value.create_command_id, value.cancel_command_id, ...value.steps.map((step) => step.command_id)];
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Command identities must be unique' });
  });
function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Runs exact campaign commands; replay verification is not vendor-session recovery. */
async function runProviderCampaign(client, rawPlan) {
  const plan = planSchema.parse(rawPlan);
  const bindings = new Map();
  for (const step of plan.steps) {
    if (!bindings.has(step.binding_id)) bindings.set(step.binding_id, await client.bindingInspect(step.binding_id));
  }
  const covered = [...new Set([...bindings.values()].map((binding) => binding.vendor))].sort();
  if (covered.some((vendor) => !vendors.includes(vendor))) fail('CONTROL_CAMPAIGN_VENDOR_UNKNOWN');
  if (plan.scope === 'four-family' && vendors.some((vendor) => !covered.includes(vendor))) fail('CONTROL_CAMPAIGN_COVERAGE_INCOMPLETE');
  const command = (commandId, action, input, expectedSequence) => ({
    schema_version: 1,
    command_id: commandId,
    resource_id: plan.campaign_id,
    expected_sequence: expectedSequence,
    action,
    input,
  });
  await client.campaign(command(plan.create_command_id, 'create', { authorization_id: plan.authorization_id }, 0));
  async function sequenceFor(commandId) {
    const current = await client.campaignQuery(plan.campaign_id);
    let after = 0;
    // Campaign grants permit at most 10,000 dispatches; bound the audit traversal too.
    for (let page = 0; page < 100; page++) {
      const batch = await client.campaignEvents(plan.campaign_id, { after, limit: 1000 });
      const prior = batch.events.find((row) => ['reserved', 'intent'].includes(row.payload.kind) && row.payload.command_id === commandId);
      if (prior) return prior.stream_sequence - 1;
      if (batch.events.length === 0) return current.current_sequence;
      if (batch.next_cursor <= after) fail('CONTROL_CAMPAIGN_CURSOR_INVALID');
      after = batch.next_cursor;
    }
    fail('CONTROL_CAMPAIGN_AUDIT_LIMIT');
  }
  const receipts = [];
  for (const step of plan.steps) {
    const envelope = command(
      step.command_id,
      'run',
      { binding_id: step.binding_id, task_id: step.task_id, ...(step.resume_from ? { resume_from: step.resume_from } : {}) },
      await sequenceFor(step.command_id),
    );
    const result = await client.campaign(envelope);
    const beforeReplay = await client.campaignQuery(plan.campaign_id);
    const replay = await client.campaign(envelope);
    const afterReplay = await client.campaignQuery(plan.campaign_id);
    if (engineeringDigest(result) !== engineeringDigest(replay) || beforeReplay.report_sha256 !== afterReplay.report_sha256)
      fail('CONTROL_CAMPAIGN_REPLAY_MISMATCH');
    if (result.receipt.status !== 'completed') fail('CONTROL_CAMPAIGN_ATTEMPT_FAILED');
    receipts.push({
      binding_id: step.binding_id,
      task_id: step.task_id,
      command_id: step.command_id,
      receipt: result.receipt,
      control_replay_verified: true,
    });
  }
  await client.campaign(command(plan.cancel_command_id, 'cancel', {}, await sequenceFor(plan.cancel_command_id)));
  const final = await client.campaignQuery(plan.campaign_id);
  if (!final.cancelled || final.unresolved_commands.length > 0 || final.live_commands.length > 0) fail('CONTROL_CAMPAIGN_UNSETTLED');
  return {
    schema_version: 1,
    resource_id: plan.campaign_id,
    scope: plan.scope,
    covered_vendors: covered,
    status: 'control_trial_completed',
    vendor_session_recovery: 'not_certified',
    real_conformance: 'not_certified',
    receipts,
    final,
  };
}
module.exports = { runProviderCampaign };
