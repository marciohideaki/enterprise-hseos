'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function main() {
  const project = process.cwd();
  const packageRoot = path.join(project, 'node_modules', 'hseos');
  const { EngineeringControl } = require(path.join(packageRoot, 'tools/cli/lib/engineering-control'));
  const { engineeringDigest } = require(path.join(packageRoot, 'tools/cli/lib/engineering-task-state'));
  const { createNativeCampaignAdapter, nativeArtifactDigest } = require(path.join(packageRoot, 'tools/cli/lib/provider-native-adapter'));
  const { readBinding } = require(path.join(packageRoot, 'tools/cli/lib/delegated-codex-runtime'));
  const bindingFile = path.join(project, 'codex-binding.json');
  const binding = readBinding(bindingFile);
  const taskId = randomUUID();
  const campaignId = randomUUID();
  const authorizationId = randomUUID();
  const deadline = Date.now() + 8 * 60_000;
  const options = {
    model: 'gpt-6-sol',
    memory_max_bytes: 1_073_741_824,
    pids_max: 64,
    tasks: { [taskId]: { prompt: 'Reply with exactly W4 second campaign verified. Do not use tools.' } },
    environment: {
      HOME: process.env.HOME,
      CODEX_HOME: process.env.CODEX_HOME || path.join(process.env.HOME, '.codex'),
      PATH: process.env.PATH,
    },
  };
  const manifest = {
    schema_version: 1,
    binding_id: 'binding:codex-w4-account',
    binding_sha256: engineeringDigest({ binding, options }),
    vendor: 'codex',
    provider_kind: 'client',
    provider_version: '0.157.1',
    adapter: 'hseos-codex-campaign-v1',
    artifact_sha256: nativeArtifactDigest(),
    route: 'account',
    transport: 'stdio',
    authentication: {
      mode: 'native_account',
      identity_kind: 'account',
      credential: { name: 'native-account', source_ref: `file://${options.environment.CODEX_HOME}/auth.json` },
      account_sha256: 'e4174663cc7e5b7717d18784908cd5861731bee2cc1888e8eadd8681c489d42d',
      source: 'explicit',
    },
    billing: { kind: 'subscription', currency: 'USD', max_request_microusd: 0 },
    limits: { max_requests: 1, max_input_tokens: 65_536, max_output_tokens: 512, max_duration_ms: 90_000 },
    controls: { authority: 'external_client', resume: 'not_verified', cancel: 'not_verified', quota: 'observed', evidence_sha256: null },
  };
  const adapter = createNativeCampaignAdapter({ manifest, binding: bindingFile, options });
  const control = new EngineeringControl({
    providerBindings: { [manifest.binding_id]: { manifest, binding_sha256: manifest.binding_sha256, adapter: adapter.adapter } },
    providerAuthorizations: {
      [authorizationId]: {
        max_requests: 1,
        max_cost_microusd: 0,
        deadline,
        binding_ids: [manifest.binding_id],
        task_ids: [taskId],
      },
    },
  });
  fs.writeFileSync(path.join(project, 'campaign-state-path.txt'), `${control.state}\n`);
  const campaign = control.providerCampaigns;
  const command = (action, input) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: campaign.rows(campaignId).length,
    action,
    input,
  });
  try {
    const observed = await adapter.adapter.inspect();
    if (
      observed.account_sha256 !== manifest.authentication.account_sha256 ||
      observed.quota_windows?.some((window) => window.used_percent >= 100 || window.resets_at <= Date.now())
    )
      throw new Error('W4_BINDING_INELIGIBLE');
    await campaign.execute(command('create', { authorization_id: authorizationId }));
    const run = command('run', { binding_id: manifest.binding_id, task_id: taskId });
    let result;
    try {
      result = await campaign.execute(run);
    } catch (error) {
      result = { error_code: error.code || error.message };
    }
    const report = campaign.query(campaignId);
    const rows = campaign.rows(campaignId);
    process.stdout.write(
      JSON.stringify({
        schema_version: 1,
        owner_instruction: 'Pode seguir com a autorizacao anterior',
        inherited_max_additional_dispatches: 2,
        dispatch_ordinal: 2,
        prior_campaign_id: '85ab8776-fe10-4396-941f-c04da9e46a8a',
        inherited_max_additional_paid_microusd: 0,
        retained_historical_reservation_microusd: 9_000_000,
        campaign_id: campaignId,
        authorization_id: authorizationId,
        task_id: taskId,
        deadline,
        binding_id: manifest.binding_id,
        binding_sha256: manifest.binding_sha256,
        artifact_sha256: manifest.artifact_sha256,
        account_sha256: observed.account_sha256,
        quota_windows: observed.quota_windows,
        state: control.state,
        run_command_id: run.command_id,
        run_result: result,
        report,
        event_kinds: rows.map((row) => row.payload.kind),
        event_count: rows.length,
      }) + '\n',
    );
    if (result.error_code || report.unresolved_commands.length > 0 || report.requests !== 1 || report.committed_microusd !== 0)
      process.exitCode = 2;
  } finally {
    await campaign.shutdown();
    await control.terminals.shutdown();
    control.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.message}\n`);
  process.exitCode = 1;
});
