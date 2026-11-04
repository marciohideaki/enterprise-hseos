'use strict';
// C2 (pre-W6 closeout): Claude Code account (subscription) campaign. Modes: inspect (0 inferences) | run (2 inferences).
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
const { readBinding } = require(root + '/tools/cli/lib/provider-claude-account-adapter');
const { startControlServer } = require(root + '/tools/cli/lib/engineering-control-http');
const { ControlClient } = require(root + '/packages/control-sdk');
const { runProviderCampaign } = require(root + '/tools/cli/lib/provider-campaign-runner');
const save = (n, v) => fs.writeFileSync(path.join(out, n), JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const MODE = process.argv[2];
const idsFile = path.join(dir, 'ids.json');
const ids = fs.existsSync(idsFile)
  ? JSON.parse(fs.readFileSync(idsFile))
  : { taskId: randomUUID(), campaignId: randomUUID(), authorizationId: randomUUID() };
fs.writeFileSync(idsFile, JSON.stringify(ids));
(async () => {
  const HOME = process.env.HOME,
    configDir = path.join(HOME, '.claude');
  const bindingFile = path.join(dir, 'claude-binding.yaml');
  const { taskId, campaignId, authorizationId } = ids;
  const prompt =
    'Teste de continuidade HSEOS. Nao use ferramentas, nao leia arquivos e nao execute comandos. Se esta for a primeira mensagem desta conversa, responda exatamente {"value":42,"phase":"initial"}. Se esta conversa ja tiver uma resposta sua anterior, responda exatamente {"value":43,"phase":"resumed"}. Nao use markdown nem acrescente explicacoes.';
  const options = {
    model: 'haiku',
    memory_max_bytes: 1_073_741_824,
    pids_max: 256,
    persist_sessions: true,
    tasks: { [taskId]: { prompt } },
    environment: { HOME, PATH: process.env.PATH },
  };
  const manifest = {
    schema_version: 1,
    binding_id: 'binding:claude-c2',
    binding_sha256: engineeringDigest({ binding: readBinding(bindingFile), options }),
    vendor: 'claude',
    provider_kind: 'client',
    provider_version: '2.1.316',
    adapter: 'hseos-claude-campaign-v1',
    artifact_sha256: nativeArtifactDigest(),
    route: 'account',
    transport: 'process',
    authentication: {
      mode: 'native_account',
      identity_kind: 'account',
      credential: { name: 'native-account', source_ref: `file://${configDir}` },
      account_sha256: null,
      source: 'explicit',
    },
    billing: { kind: 'subscription', currency: 'USD', max_request_microusd: 0 },
    limits: { max_requests: 2, max_input_tokens: 65_536, max_output_tokens: 2048, max_duration_ms: 180_000 },
    controls: {
      authority: 'external_client',
      resume: 'not_verified',
      cancel: 'not_verified',
      quota: 'not_verified',
      evidence_sha256: null,
    },
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
  const mk = () => createNativeCampaignAdapter({ manifest, binding: bindingFile, options, state }, { processRunner: audit });
  const built = mk();
  const observed = await built.adapter.inspect();
  const view = (o) => ({
    provider_version: o.provider_version,
    authenticated: o.authenticated,
    auth_source: o.auth_source,
    competing_credentials: o.competing_credentials,
    quota_remaining_requests: o.quota_remaining_requests,
    account_digest_present: !!o.account_digest,
    binding_sha256: o.binding_sha256,
    artifact_sha256: o.artifact_sha256,
    observed_at: o.observed_at,
  });
  save(`inspect-before-${MODE}.json`, view(observed));
  console.log(
    JSON.stringify({ inspect: 'ok', version: observed.provider_version, quota_remaining_requests: observed.quota_remaining_requests }),
  );
  if (MODE !== 'run') return;
  manifest.authentication.account_digest = observed.account_digest;
  const configured = { manifest, ...mk() };
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
  const grant = {
    max_requests: 4,
    max_cost_microusd: 0,
    deadline,
    binding_ids: [manifest.binding_id],
    task_ids: [taskId],
    quota_exceptions: {
      [manifest.binding_id]: {
        reason:
          'Owner confirmed C2 on 2026-11-02: at most 2 headless Claude Code inferences on the owner subscription; the CLI exposes no quota window, so the exception is limited to this campaign and its validity.',
        expires_at: deadline,
      },
    },
  };
  save('manifest.json', manifest);
  save('grant.json', grant);
  save('plan.json', plan);
  const control = new EngineeringControl({
    state,
    providerBindings: { [manifest.binding_id]: configured },
    providerAuthorizations: { [authorizationId]: grant },
  });
  const entry = 'enterprise-hseos/wc-c2-control-' + campaignId;
  const credential = randomBytes(32).toString('hex');
  execFileSync('pass', ['insert', '-m', entry], { input: credential + '\n', stdio: ['pipe', 'pipe', 'pipe'] });
  let server;
  const trace = [];
  try {
    server = await startControlServer({ control, credential });
    const real = new ControlClient({ url: server.url, credential });
    const client = {
      bindingInspect: (...a) => real.bindingInspect(...a),
      campaign: async (env) => {
        const r = await real.campaign(env);
        trace.push({
          t: Date.now(),
          call: 'campaign',
          action: env.action,
          command_id: env.command_id,
          replay_of_prior: trace.some((x) => x.command_id === env.command_id),
        });
        return r;
      },
      campaignQuery: async (id) => {
        const q = await real.campaignQuery(id);
        trace.push({
          t: Date.now(),
          call: 'query',
          requests: q.requests,
          committed_microusd: q.committed_microusd,
          report_sha256: q.report_sha256,
        });
        return q;
      },
      campaignEvents: (...a) => real.campaignEvents(...a),
    };
    const result = await runProviderCampaign(client, plan);
    save('result.json', result);
    save('replay-trace.json', trace);
    const after = await configured.adapter.inspect();
    save('inspect-after.json', view(after));
    const t = fs
      .readFileSync(turns, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const exp = ['{"value":42,"phase":"initial"}', '{"value":43,"phase":"resumed"}'].map((s) =>
      createHash('sha256').update(s).digest('hex'),
    );
    const validation = {
      evidence_kind: 'real_client_call',
      mocks_or_fixtures_in_inference_path: false,
      control_ledger_is_temporary_fixture: true,
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
      same_binding_before_after: observed.binding_sha256 === after.binding_sha256,
    };
    save('validation.json', validation);
    console.log(JSON.stringify(validation));
    if (!validation.same_session || validation.expected_response_hashes.some((v) => !v) || validation.committed_microusd !== 0)
      process.exitCode = 1;
  } catch (error) {
    const st = control.providerCampaigns.query(campaignId);
    save('failure.json', { code: error.code || error.message, diagnostic: error.diagnostic, state: st });
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
