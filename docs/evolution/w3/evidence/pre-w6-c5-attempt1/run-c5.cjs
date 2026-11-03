'use strict';
// C5 (pre-W6 closeout): OpenAI-compatible binding on the official provider API (metered), model route, stateless.
// Modes: inspect (no inference, no request to the provider) | run (2 inferences, with control restart between them).
const fs = require('node:fs'),
  path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const yaml = require('node:module').createRequire(process.cwd() + '/package.json')('yaml');
const root = process.cwd();
const dir = __dirname,
  out = path.join(dir, 'out');
const { engineeringDigest } = require(root + '/tools/cli/lib/engineering-task-state');
const { EngineeringControl } = require(root + '/tools/cli/lib/engineering-control');
const { createApiCampaignAdapter, credentialFingerprint, adapterArtifactDigest, API_ADAPTER_ID } = require(
  root + '/tools/cli/lib/provider-api-adapter',
);
const { parseProviderControlManifest } = require(root + '/tools/lib/provider-control-manifest');
const { createExecutionLedgerFileFixture } = require(root + '/tools/mcp-project-state/lib/execution-ledger-schema');
const { startControlServer } = require(root + '/tools/cli/lib/engineering-control-http');
const { ControlClient } = require(root + '/packages/control-sdk');
const save = (n, v) => fs.writeFileSync(path.join(out, n), JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const MODE = process.argv[2];
const idsFile = path.join(dir, 'ids.json');
const ids = fs.existsSync(idsFile)
  ? JSON.parse(fs.readFileSync(idsFile))
  : { t1: randomUUID(), t2: randomUUID(), campaignId: randomUUID(), authorizationId: randomUUID() };
fs.writeFileSync(idsFile, JSON.stringify(ids));
(async () => {
  const key = execFileSync('pass', ['show', 'openai/api-key'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n')[0]
    .trim();
  const binding = yaml.parse(fs.readFileSync(root + '/.agents/activation/provider-bindings/openai-compatible.example.yaml', 'utf8'));
  binding.provider.base_url = 'https://api.openai.com/v1';
  binding.provider.model = 'gpt-4o-mini';
  binding.provider.limits.context_tokens = 4096;
  binding.provider.limits.max_output_tokens = 256;
  binding.transport.max_attempts = 1;
  const bindingFile = path.join(dir, 'binding.yaml');
  fs.writeFileSync(bindingFile, yaml.stringify(binding));
  const prompts = {
    [ids.t1]:
      'Teste de continuidade HSEOS. Nao use ferramentas. Responda exatamente {"value":42,"phase":"initial"} sem markdown e sem explicacoes.',
    [ids.t2]:
      'Teste de continuidade HSEOS. Nao use ferramentas. Contexto recuperado pelo HSEOS: na tarefa anterior a resposta registrada foi {"value":42,"phase":"initial"}. Como esse contexto existe, responda exatamente {"value":43,"phase":"resumed"} sem markdown e sem explicacoes.',
  };
  const options = {
    tasks: { [ids.t1]: { prompt: prompts[ids.t1] }, [ids.t2]: { prompt: prompts[ids.t2] } },
    pricing: { input_microusd_per_million: 150000, output_microusd_per_million: 600000, valid_until: Date.now() + 3 * 3600_000 },
  };
  const manifestValue = {
    schema_version: 1,
    binding_id: 'binding:openai-compatible-c5',
    binding_sha256: engineeringDigest({ binding, options }),
    vendor: 'openai',
    provider_kind: 'model',
    provider_version: '1.0.0',
    adapter: API_ADAPTER_ID,
    artifact_sha256: adapterArtifactDigest(),
    route: 'api',
    transport: 'http',
    authentication: {
      mode: 'api_key',
      identity_kind: 'credential',
      credential: binding.provider.secret_refs[0],
      account_sha256: null,
      credential_sha256: credentialFingerprint(key),
      source: 'explicit',
    },
    billing: { kind: 'metered', currency: 'USD', max_request_microusd: 250000 },
    limits: { max_requests: 2, max_input_tokens: 4096, max_output_tokens: 256, max_duration_ms: 60000 },
    controls: { authority: 'kernel', resume: 'unavailable', cancel: 'not_verified', quota: 'not_verified', evidence_sha256: null },
  };
  const manifest = parseProviderControlManifest(manifestValue);
  const environment = { HSEOS_MODEL_PROVIDER_API_KEY: key };
  const turns = path.join(out, 'turns.jsonl');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url).replace(/\?.*$/, ''), method: init?.method });
    const response = await globalThis.fetch(url, init);
    calls[calls.length - 1].status = response.status;
    return response;
  };
  const configured = () => {
    const a = createApiCampaignAdapter({ manifest, binding: bindingFile, options }, { environment, fetchImpl });
    return { manifest, ...a };
  };
  const first = configured();
  const observed = await first.adapter.inspect();
  const view = (o) => ({
    provider_version: o.provider_version,
    authenticated: o.authenticated,
    auth_source: o.auth_source,
    competing_credentials: o.competing_credentials,
    quota_remaining_requests: o.quota_remaining_requests,
    credential_fingerprint_matches_manifest: o.credential_sha256 === manifest.authentication.credential_sha256,
    effective_backend: o.effective_backend,
    pricing_valid_until: o.expires_at,
    binding_sha256: o.binding_sha256,
    artifact_sha256: o.artifact_sha256,
    observed_at: o.observed_at,
  });
  save(`inspect-before-${MODE}.json`, view(observed));
  console.log(
    JSON.stringify({
      inspect: 'ok',
      fingerprint_matches: view(observed).credential_fingerprint_matches_manifest,
      provider_requests_during_inspect: calls.length,
    }),
  );
  if (MODE !== 'run') return;
  const fx = createExecutionLedgerFileFixture();
  const state = fx.directory;
  fx.close();
  const deadline = Date.now() + 60 * 60_000;
  const grant = {
    max_requests: 4,
    max_cost_microusd: 1000000,
    deadline,
    binding_ids: [manifest.binding_id],
    task_ids: [ids.t1, ids.t2],
    quota_exceptions: {
      [manifest.binding_id]: {
        reason:
          'Owner confirmed C5 on 2026-11-03: at most 2 inferences on the owner OpenAI API key, USD 1.00 campaign ceiling, 0.25 reserved per request; the provider API has no balance endpoint, so no balance or quota window is observable and the exception is limited to this campaign and its validity.',
        expires_at: deadline,
      },
    },
  };
  save('manifest.json', manifestValue);
  save('grant.json', grant);
  const entry = 'enterprise-hseos/wc-c5-control-' + ids.campaignId;
  const credential = randomBytes(32).toString('hex');
  execFileSync('pass', ['insert', '-m', entry], { input: credential + '\n', stdio: ['pipe', 'pipe', 'pipe'] });
  const trace = [];
  let control, server, adapterBox;
  const open = async () => {
    adapterBox = configured();
    control = new EngineeringControl({
      state,
      providerBindings: { [manifest.binding_id]: adapterBox },
      providerAuthorizations: { [ids.authorizationId]: grant },
    });
    server = await startControlServer({ control, credential });
    const real = new ControlClient({ url: server.url, credential });
    return {
      real,
      campaign: async (env, label) => {
        const r = await real.campaign(env);
        trace.push({ t: Date.now(), phase: label, call: 'campaign', action: env.action, command_id: env.command_id });
        return r;
      },
      query: async (label) => {
        const q = await real.campaignQuery(ids.campaignId);
        trace.push({
          t: Date.now(),
          phase: label,
          call: 'query',
          current_sequence: q.current_sequence,
          requests: q.requests,
          committed_microusd: q.committed_microusd,
          report_sha256: q.report_sha256,
        });
        return q;
      },
    };
  };
  const close = async () => {
    await server.close();
    await control.providerCampaigns.shutdown();
    control.close();
  };
  const env = (action, input, seq, commandId = randomUUID()) => ({
    schema_version: 1,
    command_id: commandId,
    resource_id: ids.campaignId,
    expected_sequence: seq,
    action,
    input,
  });
  const receipts = [];
  let finalState, failure;
  let c = await open();
  try {
    await c.campaign(env('create', { authorization_id: ids.authorizationId }, 0), 'before-restart');
    const run1 = env('run', { binding_id: manifest.binding_id, task_id: ids.t1 }, (await c.query('before-restart')).current_sequence);
    const r1 = await c.campaign(run1, 'before-restart');
    receipts.push(r1.receipt);
    const q1 = await c.query('before-restart');
    const replay1 = await c.campaign(run1, 'before-restart-replay');
    const q1r = await c.query('before-restart-replay');
    if (engineeringDigest(r1) !== engineeringDigest(replay1) || q1.report_sha256 !== q1r.report_sha256)
      throw Object.assign(new Error('CONTROL_CAMPAIGN_REPLAY_MISMATCH'), { code: 'CONTROL_CAMPAIGN_REPLAY_MISMATCH' });
    save('inspect-after-first.json', view(await adapterBox.adapter.inspect()));
    // Simulated crash: close the control and the server, then reopen the same ledger from disk.
    const beforeRestart = { current_sequence: q1r.current_sequence, requests: q1r.requests, report_sha256: q1r.report_sha256 };
    await close();
    c = await open();
    const qa = await c.query('after-restart');
    const replayAfter = await c.campaign(run1, 'after-restart-replay');
    const qb = await c.query('after-restart-replay');
    const restart = {
      state_preserved:
        qa.report_sha256 === beforeRestart.report_sha256 &&
        qa.requests === beforeRestart.requests &&
        qa.current_sequence === beforeRestart.current_sequence,
      replay_after_restart_same_result: engineeringDigest(replayAfter) === engineeringDigest(r1),
      requests_unchanged_by_replay: qb.requests === beforeRestart.requests && qb.report_sha256 === beforeRestart.report_sha256,
      before: beforeRestart,
      after: { current_sequence: qb.current_sequence, requests: qb.requests, report_sha256: qb.report_sha256 },
    };
    save('restart-recovery.json', restart);
    const run2 = env('run', { binding_id: manifest.binding_id, task_id: ids.t2 }, qb.current_sequence);
    const r2 = await c.campaign(run2, 'after-restart');
    receipts.push(r2.receipt);
    const q2 = await c.query('after-restart');
    const replay2 = await c.campaign(run2, 'after-restart-replay');
    const q2r = await c.query('after-restart-replay');
    if (engineeringDigest(r2) !== engineeringDigest(replay2) || q2.report_sha256 !== q2r.report_sha256)
      throw Object.assign(new Error('CONTROL_CAMPAIGN_REPLAY_MISMATCH'), { code: 'CONTROL_CAMPAIGN_REPLAY_MISMATCH' });
    await c.campaign(env('cancel', {}, q2r.current_sequence), 'close');
    finalState = await c.query('close');
    const after = await adapterBox.adapter.inspect();
    save('inspect-after.json', view(after));
    save('result.json', { receipts, final: finalState, restart });
    const t = fs.existsSync(turns) ? fs.readFileSync(turns, 'utf8') : '';
    const texts = receipts.map((r) => r.evidence_ref?.sha256);
    const exp = ['{"value":42,"phase":"initial"}', '{"value":43,"phase":"resumed"}'].map((s) =>
      createHash('sha256').update(s).digest('hex'),
    );
    const validation = {
      evidence_kind: 'real_api_call',
      mocks_or_fixtures_in_inference_path: false,
      control_ledger_is_temporary_fixture: true,
      expected_response_hashes: texts.map((h, i) => h === exp[i]),
      real_inference_calls: receipts.length,
      requests: finalState.requests,
      committed_microusd: finalState.committed_microusd,
      authorized_microusd: finalState.max_cost_microusd,
      live_commands: finalState.live_commands.length,
      unresolved: finalState.unresolved_commands.length,
      cancelled: finalState.cancelled,
      provider_calls: calls.map((x) => ({ url: x.url, method: x.method, status: x.status })),
      restart_recovery: restart,
      same_binding_before_after: observed.binding_sha256 === after.binding_sha256,
    };
    save('validation.json', validation);
    console.log(JSON.stringify(validation));
    if (validation.expected_response_hashes.some((v) => !v)) process.exitCode = 1;
  } catch (error) {
    let st = null;
    try {
      st = control.providerCampaigns.query(ids.campaignId);
    } catch {}
    failure = { code: error.code || error.message, diagnostic: error.diagnostic, state: st, receipts };
    save('failure.json', failure);
    console.log(
      JSON.stringify({
        code: failure.code,
        requests: st?.requests,
        unresolved: st?.unresolved_commands,
        committed_microusd: st?.committed_microusd,
      }),
    );
    process.exitCode = 1;
  } finally {
    save('replay-trace.json', trace);
    save('provider-calls.json', calls);
    try {
      await close();
    } catch {}
  }
})().catch((e) => {
  console.error(
    JSON.stringify({ code: e.code || 'SETUP_FAILED', message: /^[A-Z_]+$/.test(e.message) ? e.message : String(e.message).slice(0, 300) }),
  );
  process.exitCode = 1;
});
