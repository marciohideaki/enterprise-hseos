'use strict';
// Exports the provider-campaign ledger rows of one campaign from a (temporary) ledger fixture directory, projecting selected fields only.
// usage (from the repository root): node export-ledger-rows.cjs <ledger-fixture-dir> <campaign-id> <output.json>
const fs = require('node:fs');
const { EngineeringControl } = require(process.cwd() + '/tools/cli/lib/engineering-control');
const [state, campaignId, output] = process.argv.slice(2);
const control = new EngineeringControl({ state });
const rows = control.providerCampaigns.rows(campaignId);
fs.writeFileSync(
  output,
  JSON.stringify(
    rows.map((r) => ({
      seq: r.stream_sequence,
      kind: r.payload.kind,
      command_id: r.payload.command_id || null,
      binding_id: r.payload.binding_id || null,
      task_id: r.payload.task_id || null,
      quota_admission: r.payload.quota_admission || null,
      status: r.payload.receipt?.status || null,
      committed_microusd: r.payload.committed_microusd ?? null,
      reserved_microusd: r.payload.reserved_microusd ?? null,
      diagnostic: r.payload.diagnostic || null,
    })),
    null,
    2,
  ) + '\n',
);
control.close();
