'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EngineeringControl } = require('../../tools/cli/lib/engineering-control');
const { ProviderCampaignControl } = require('../../tools/cli/lib/provider-campaign-control');
const { manifest } = require('./provider-control');

const RETRYABLE = new Set(['CONTROL_SEQUENCE_CONFLICT', 'CONTROL_OUTCOME_UNCERTAIN']);

process.once('message', async ({ state, campaignId, taskId, callsDir, reservations, maxTries, maxRequests, costMicrousd }) => {
  const control = new EngineeringControl({ state });
  try {
    const value = manifest();
    value.limits.max_requests = maxRequests;
    const observed = {
      binding_sha256: value.binding_sha256,
      artifact_sha256: value.artifact_sha256,
      provider_version: value.provider_version,
      account_sha256: value.authentication.account_sha256,
      authenticated: true,
      auth_source: 'explicit',
      quota_remaining_requests: 3,
      competing_credentials: false,
    };
    const receipt = {
      status: 'completed',
      binding_sha256: value.binding_sha256,
      evidence_sha256: 'f'.repeat(64),
      cost_microusd: costMicrousd,
      input_tokens: 20,
      output_tokens: 4,
    };
    const configured = {
      manifest: value,
      binding_sha256: value.binding_sha256,
      adapter: {
        inspect: async () => ({ ...observed, observed_at: Date.now(), expires_at: Date.now() + 60_000 }),
        run: async () => {
          fs.writeFileSync(path.join(callsDir, `${process.pid}-${randomUUID()}`), '');
          return receipt;
        },
      },
    };
    const campaigns = new ProviderCampaignControl(control, { [value.binding_id]: configured });
    const tally = { ok: 0, exhausted: 0, conflicts: 0, uncertain: 0, other: [] };
    attempts: for (let wanted = 0; wanted < reservations; wanted++) {
      for (let attempt = 0; attempt < maxTries; attempt++) {
        try {
          await campaigns.execute({
            schema_version: 1,
            command_id: randomUUID(),
            resource_id: campaignId,
            expected_sequence: campaigns.rows(campaignId).length,
            action: 'run',
            input: { binding_id: value.binding_id, task_id: taskId },
          });
          tally.ok++;
          continue attempts;
        } catch (error) {
          if (error.code === 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED') {
            tally.exhausted++;
            break attempts;
          }
          if (!RETRYABLE.has(error.code)) {
            tally.other.push(error.code || error.message);
            break attempts;
          }
          if (error.code === 'CONTROL_SEQUENCE_CONFLICT') tally.conflicts++;
          else tally.uncertain++;
          await new Promise((resolve) => setTimeout(resolve, 1 + Math.floor(Math.random() * 4)));
        }
      }
      tally.other.push('RETRIES_EXHAUSTED');
      break;
    }
    process.send({ done: true, ...tally });
  } catch (error) {
    process.send({ error: error.code || error.message });
  } finally {
    control.close();
  }
});
