'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const dir = __dirname,
  out = path.join(dir, 'out');
const { createExecutionLedgerFileFixture } = require(root + '/tools/mcp-project-state/lib/execution-ledger-schema');
const fx = createExecutionLedgerFileFixture();
const state = fx.directory;
fx.close();
const { engineeringDigest } = require(root + '/tools/cli/lib/engineering-task-state');
const { EngineeringControl } = require(root + '/tools/cli/lib/engineering-control');
const { createNativeCampaignAdapter, nativeArtifactDigest } = require(root + '/tools/cli/lib/provider-native-adapter');
const { runCampaignProcess } = require(root + '/tools/cli/lib/provider-campaign-process');
const { readBinding } = require(root + '/tools/cli/lib/delegated-codex-runtime');
const { startControlServer } = require(root + '/tools/cli/lib/engineering-control-http');
const { ControlClient } = require(root + '/packages/control-sdk');
const { runProviderCampaign } = require(root + '/tools/cli/lib/provider-campaign-runner');
const save = (n, v) => fs.writeFileSync(path.join(out, n), JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const MODE = process.argv[2]; // 'inspect' (0 inferences) or 'run'
(async () => {
  const HOME = process.env.HOME,
    CODEX_HOME = path.join(HOME, '.codex');
  const bindingFile = path.join(dir, 'codex-binding.json');
  const taskId = randomUUID(),
    campaignId = randomUUID(),
    authorizationId = randomUUID();
  const prompt =
    'Teste de continuidade HSEOS. Nao use ferramentas, nao leia arquivos e nao execute comandos. Se esta for a primeira mensagem desta conversa, responda exatamente {"value":42,"phase":"initial"}. Se esta conversa ja tiver uma resposta sua anterior, responda exatamente {"value":43,"phase":"resumed"}. Nao use markdown nem acrescente explicacoes.';
  const options = {
    model: 'gpt-6.1-sol',
    memory_max_bytes: 1_073_741_824,
    pids_max: 256,
    tasks: { [taskId]: { prompt } },
    environment: { HOME, CODEX_HOME, PATH: process.env.PATH },
  };
  const manifest = {
    schema_version: 1,
    binding_id: 'binding:codex-c1',
    binding_sha256: engineeringDigest({ binding: readBinding(bindingFile), options }),
    vendor: 'codex',
    provider_kind: 'client',
    provider_version: '0.166.0',
    adapter: 'hseos-codex-campaign-v1',
    artifact_sha256: nativeArtifactDigest(),
    route: 'account',
    transport: 'stdio',
    authentication: {
      mode: 'native_account',
      identity_kind: 'account',
      credential: { name: 'native-account', source_ref: `file://${CODEX_HOME}/auth.json` },
      account_sha256: null,
      source: 'explicit',
    },
    billing: { kind: 'subscription', currency: 'USD', max_request_microusd: 0 },
    limits: { max_requests: 2, max_input_tokens: 65_536, max_output_tokens: 2048, max_duration_ms: 120_000 },
    controls: { authority: 'external_client', resume: 'not_verified', cancel: 'not_verified', quota: 'observed', evidence_sha256: null },
  };
  const turns = path.join(out, 'turns.jsonl');
  const audit = async (input) => {
    const r = await runCampaignProcess(input);
    if (input.input.operation === 'run')
      fs.appendFileSync(
        turns,
        JSON.stringify({ provider_session_id: r.provider_session_id, text_sha256: r.text_sha256, usage: r.usage }) + '\n',
        { mode: 0o600 },
      );
    return r;
  };
  const built = createNativeCampaignAdapter({ manifest, binding: bindingFile, options, state }, { processRunner: audit });
  const observed = await built.adapter.inspect();
  save(`inspect-${MODE}.json`, {
    provider_version: observed.provider_version,
    authenticated: observed.authenticated,
    auth_source: observed.auth_source,
    competing_credentials: observed.competing_credentials,
    quota_windows: observed.quota_windows,
    account_digest_present: !!observed.account_digest,
    binding_sha256: manifest.binding_sha256,
    artifact_sha256: manifest.artifact_sha256,
  });
  console.log(
    JSON.stringify({
      inspect: 'ok',
      version: observed.provider_version,
      competing: observed.competing_credentials,
      quota: observed.quota_windows,
    }),
  );
  if (MODE !== 'run') return;
  manifest.authentication.account_digest = observed.account_digest;
  const configured = {
    manifest,
    ...createNativeCampaignAdapter({ manifest, binding: bindingFile, options, state }, { processRunner: audit }),
  };
  const deadline = Date.now() + 60 * 60_000;
  const first = randomUUID();
  const plan = {
    schema_version: 1,
    scope: 'pilot',
    campaign_id: campaignId,
    authorization_id: authorizationId,
    create_command_id: randomUUID(),
    cancel_command_id: randomUUID(),
    steps: [
      { command_id: first, binding_id: manifest.binding_id, task_id: taskId },
      { command_id: randomUUID(), binding_id: manifest.binding_id, task_id: taskId, resume_from: first },
    ],
  };
  const grant = { max_requests: 4, max_cost_microusd: 0, deadline, binding_ids: [manifest.binding_id], task_ids: [taskId] };
  save('manifest.json', manifest);
  save('grant.json', grant);
  save('plan.json', plan);
  const control = new EngineeringControl({
    state,
    providerBindings: { [manifest.binding_id]: configured },
    providerAuthorizations: { [authorizationId]: grant },
  });
  const entry = 'enterprise-hseos/wc-c1-control-' + campaignId;
  const credential = randomBytes(32).toString('hex');
  execFileSync('pass', ['insert', '-m', entry], { input: credential + '\n', stdio: ['pipe', 'pipe', 'pipe'] });
  let server;
  try {
    server = await startControlServer({ control, credential });
    const result = await runProviderCampaign(new ControlClient({ url: server.url, credential }), plan);
    save('result.json', result);
    const t = fs
      .readFileSync(turns, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const exp = ['{"value":42,"phase":"initial"}', '{"value":43,"phase":"resumed"}'].map((s) =>
      createHash('sha256').update(s).digest('hex'),
    );
    const validation = {
      same_session: t.length === 2 && t[0].provider_session_id === t[1].provider_session_id,
      expected_response_hashes: t.map((x, i) => x.text_sha256 === exp[i]),
      real_inference_calls: t.length,
      requests: result.final.requests,
      committed_microusd: result.final.committed_microusd,
      authorized_microusd: result.final.max_cost_microusd,
      live_commands: result.final.live_commands.length,
      unresolved: result.final.unresolved_commands.length,
      cancelled: result.final.cancelled,
      replay_verified: result.receipts.every((r) => r.control_replay_verified),
    };
    save('validation.json', validation);
    console.log(JSON.stringify(validation));
    if (!validation.same_session || validation.expected_response_hashes.some((v) => !v) || validation.committed_microusd !== 0)
      process.exitCode = 1;
  } catch (error) {
    const st = control.providerCampaigns.query(campaignId);
    save('failure.json', { code: error.code || error.message, state: st });
    console.log(JSON.stringify({ code: error.code || error.message, requests: st.requests, unresolved: st.unresolved_commands }));
    process.exitCode = 1;
  } finally {
    if (server) await server.close();
    await control.providerCampaigns.shutdown();
    control.close();
  }
})().catch((error) => {
  console.error(
    JSON.stringify({
      code: error.code || 'SETUP_FAILED',
      message: /^[A-Z_]+$/.test(error.message) ? error.message : String(error.message).slice(0, 200),
    }),
  );
  process.exitCode = 1;
});
