'use strict';
// C7 (pre-W6 closeout): Antigravity local (LiteRT) parent that calls a Codex-account child once per dispatch.
// Modes: inspect (no inference) | run (parent run + parent resume; each parent dispatch calls the child once).
const fs = require('node:fs'),
  path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const dir = __dirname,
  out = path.join(dir, 'out');
const { engineeringDigest } = require(root + '/tools/cli/lib/engineering-task-state');
const { EngineeringControl } = require(root + '/tools/cli/lib/engineering-control');
const { createNativeCampaignAdapter, nativeArtifactDigest } = require(root + '/tools/cli/lib/provider-native-adapter');
const { createAntigravityCampaignAdapter, antigravityArtifactDigest } = require(root + '/tools/cli/lib/provider-antigravity-adapter');
const { runCampaignProcess } = require(root + '/tools/cli/lib/provider-campaign-process');
const { readBinding } = require(root + '/tools/cli/lib/delegated-codex-runtime');
const { createExecutionLedgerFileFixture } = require(root + '/tools/mcp-project-state/lib/execution-ledger-schema');
const { startControlServer } = require(root + '/tools/cli/lib/engineering-control-http');
const { ControlClient } = require(root + '/packages/control-sdk');
const { runProviderCampaign } = require(root + '/tools/cli/lib/provider-campaign-runner');
const save = (n, v) => fs.writeFileSync(path.join(out, n), JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const sha = (p) =>
  createHash('sha256')
    .update(fs.readFileSync(fs.realpathSync(p)))
    .digest('hex');
const MODE = process.argv[2];
const idsFile = path.join(dir, 'ids.json');
const ids = fs.existsSync(idsFile)
  ? JSON.parse(fs.readFileSync(idsFile))
  : { task: randomUUID(), campaign: randomUUID(), authorization: randomUUID() };
fs.writeFileSync(idsFile, JSON.stringify(ids));
(async () => {
  const HOME = process.env.HOME,
    CODEX_HOME = path.join(HOME, '.codex');
  const fx = createExecutionLedgerFileFixture();
  const state = fx.directory;
  fx.close();
  const python = '/build/hseos-models/venv/bin/python';
  const sdkModule = '/build/hseos-models/venv/lib/python3.12/site-packages/google/antigravity/__init__.py';
  const checkpoint = '/build/hseos-models/litert/Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm';
  const scratch = fs.realpathSync(path.join(dir, 'parent-scratch'));
  // child: Codex account, 0.166.0
  const childFile = path.join(dir, 'codex-binding.json');
  const childOptions = {
    model: 'gpt-6.1-sol',
    memory_max_bytes: 1073741824,
    pids_max: 256,
    tasks: { [ids.task]: { prompt: 'Do not use any tools or read files. Reply exactly READY.' } },
    environment: { HOME, CODEX_HOME, PATH: process.env.PATH },
  };
  const child = {
    schema_version: 1,
    binding_id: 'binding:codex-child-c7',
    binding_sha256: engineeringDigest({ binding: readBinding(childFile), options: childOptions }),
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
    limits: { max_requests: 2, max_input_tokens: 65536, max_output_tokens: 1024, max_duration_ms: 90000 },
    controls: { authority: 'external_client', resume: 'not_verified', cancel: 'not_verified', quota: 'observed', evidence_sha256: null },
  };
  // parent: Antigravity local
  const config = {
    python,
    checkpoint,
    sdk_module: sdkModule,
    scratch,
    subordinate_binding_id: child.binding_id,
    max_model_calls: 1,
    memory_max_bytes: 2147483648,
    pids_max: 256,
    tasks: { [ids.task]: { prompt: 'Call run_campaign_model exactly once, with no arguments. /no_think' } },
  };
  const localFile = path.join(dir, 'local.json');
  fs.writeFileSync(localFile, JSON.stringify(config));
  const artifacts = [python, checkpoint, sdkModule].map(sha);
  const parent = {
    schema_version: 1,
    binding_id: 'binding:antigravity-local-c7',
    binding_sha256: engineeringDigest({ config, artifacts }),
    vendor: 'antigravity',
    provider_kind: 'client',
    provider_version: '0.1.18',
    adapter: 'hseos-antigravity-campaign-v1',
    artifact_sha256: antigravityArtifactDigest(),
    route: 'local',
    transport: 'stdio',
    authentication: {
      mode: 'local',
      identity_kind: 'local_profile',
      credential: null,
      account_sha256: null,
      profile_sha256: engineeringDigest(artifacts),
      source: 'explicit',
    },
    billing: { kind: 'local', currency: 'USD', max_request_microusd: 0 },
    limits: { max_requests: 2, max_input_tokens: 4096, max_output_tokens: 96, max_duration_ms: 150000 },
    controls: {
      authority: 'external_client',
      resume: 'not_verified',
      cancel: 'not_verified',
      quota: 'not_applicable',
      evidence_sha256: null,
    },
  };
  const audit = (kind) => async (input) => {
    const r = await runCampaignProcess(input);
    if (input.input.operation === 'run')
      fs.appendFileSync(path.join(out, kind + '-turns.jsonl'), JSON.stringify(r) + '\n', { mode: 0o600 });
    return r;
  };
  const childAdapter = createNativeCampaignAdapter(
    { manifest: child, binding: childFile, options: childOptions, state },
    { processRunner: audit('child') },
  );
  const observedChild = await childAdapter.adapter.inspect();
  save(`child-inspect-before-${MODE}.json`, {
    provider_version: observedChild.provider_version,
    authenticated: observedChild.authenticated,
    quota_windows: observedChild.quota_windows,
    account_digest_present: !!observedChild.account_digest,
    binding_sha256: observedChild.binding_sha256,
  });
  const env = {
    python_version: execFileSync(python, ['--version'], { encoding: 'utf8' }).trim(),
    python_realpath_sha256: sha(python),
    packages: execFileSync(
      python,
      ['-I', '-c', "import importlib.metadata as m;print({n:m.version(n) for n in ['google-antigravity','litert-lm','litert-lm-api']})"],
      { encoding: 'utf8' },
    ).trim(),
    checkpoint_sha256: sha(checkpoint),
    checkpoint_size: fs.statSync(checkpoint).size,
    sdk_module_sha256: sha(sdkModule),
    codex_version_observed: observedChild.provider_version,
  };
  save(`environment-${MODE}.json`, env);
  console.log(
    JSON.stringify({
      inspect: 'ok',
      child_version: observedChild.provider_version,
      child_quota: observedChild.quota_windows,
      checkpoint_sha256: env.checkpoint_sha256.slice(0, 12),
      packages: env.packages,
    }),
  );
  if (MODE !== 'run') return;
  child.authentication.account_digest = observedChild.account_digest;
  const childConfigured = {
    manifest: child,
    ...createNativeCampaignAdapter(
      { manifest: child, binding: childFile, options: childOptions, state },
      { processRunner: audit('child') },
    ),
  };
  const parentConfigured = {
    manifest: parent,
    subordinate_binding_ids: [child.binding_id],
    ...createAntigravityCampaignAdapter({ manifest: parent, binding: localFile, options: {} }, { processRunner: audit('parent') }),
  };
  const providerBindings = { [child.binding_id]: childConfigured, [parent.binding_id]: parentConfigured };
  const deadline = Date.now() + 60 * 60_000;
  const grant = { max_requests: 4, max_cost_microusd: 0, deadline, binding_ids: Object.keys(providerBindings), task_ids: [ids.task] };
  const first = randomUUID();
  const plan = {
    schema_version: 1,
    scope: 'pilot',
    campaign_id: ids.campaign,
    authorization_id: ids.authorization,
    create_command_id: randomUUID(),
    cancel_command_id: randomUUID(),
    steps: [
      { command_id: first, binding_id: parent.binding_id, task_id: ids.task },
      { command_id: randomUUID(), binding_id: parent.binding_id, task_id: ids.task, resume_from: first },
    ],
  };
  save('manifests.json', { parent, child });
  save('grant.json', grant);
  save('plan.json', plan);
  const control = new EngineeringControl({ state, providerBindings, providerAuthorizations: { [ids.authorization]: grant } });
  const entry = 'enterprise-hseos/wc-c7-control-' + ids.campaign;
  const credential = randomBytes(32).toString('hex');
  execFileSync('pass', ['insert', '-m', entry], { input: credential + '\n', stdio: ['pipe', 'pipe', 'pipe'] });
  let server;
  const trace = [];
  try {
    server = await startControlServer({ control, credential });
    const real = new ControlClient({ url: server.url, credential });
    const client = {
      bindingInspect: (...a) => real.bindingInspect(...a),
      campaign: async (e) => {
        const r = await real.campaign(e);
        trace.push({
          t: Date.now(),
          call: 'campaign',
          action: e.action,
          command_id: e.command_id,
          replay_of_prior: trace.some((x) => x.command_id === e.command_id),
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
    save(
      'ledger-rows.json',
      control.providerCampaigns.rows(ids.campaign).map((r) => ({
        seq: r.stream_sequence,
        kind: r.payload.kind,
        command_id: r.payload.command_id || null,
        binding_id: r.payload.binding_id || null,
        status: r.payload.receipt?.status || null,
        diagnostic: r.payload.diagnostic || null,
      })),
    );
    const afterChild = await childConfigured.adapter.inspect();
    save('child-inspect-after.json', {
      provider_version: afterChild.provider_version,
      quota_windows: afterChild.quota_windows,
      binding_sha256: afterChild.binding_sha256,
    });
    const readLines = (f) =>
      fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const pt = readLines('parent-turns.jsonl'),
      ct = readLines('child-turns.jsonl');
    const validation = {
      evidence_kind: 'real_local_client_and_real_account_child',
      mocks_or_fixtures_in_inference_path: false,
      control_ledger_is_temporary_fixture: true,
      parent_turns: pt.length,
      child_turns: ct.length,
      parent_model_calls: pt.map((x) => x.model_calls),
      parent_usage_source: pt.map((x) => x.usage_source),
      requests: result.final.requests,
      committed_microusd: result.final.committed_microusd,
      authorized_microusd: result.final.max_cost_microusd,
      live_commands: result.final.live_commands.length,
      unresolved: result.final.unresolved_commands.length,
      cancelled: result.final.cancelled,
      replay_verified: result.receipts.every((r) => r.control_replay_verified),
      child_same_binding_before_after: observedChild.binding_sha256 === afterChild.binding_sha256,
    };
    save('validation.json', validation);
    console.log(JSON.stringify(validation));
  } catch (error) {
    let st = null;
    try {
      st = control.providerCampaigns.query(ids.campaign);
    } catch {}
    save('failure.json', { code: error.code || error.message, diagnostic: error.diagnostic, state: st });
    try {
      save(
        'ledger-rows-failure.json',
        control.providerCampaigns.rows(ids.campaign).map((r) => ({
          seq: r.stream_sequence,
          kind: r.payload.kind,
          binding_id: r.payload.binding_id || null,
          diagnostic: r.payload.diagnostic || null,
        })),
      );
    } catch {}
    console.log(JSON.stringify({ code: error.code || error.message, requests: st?.requests, unresolved: st?.unresolved_commands }));
    process.exitCode = 1;
  } finally {
    if (server) await server.close();
    await control.providerCampaigns.shutdown();
    control.close();
  }
})().catch((e) => {
  console.error(
    JSON.stringify({ code: e.code || 'SETUP_FAILED', message: /^[A-Z_]+$/.test(e.message) ? e.message : String(e.message).slice(0, 300) }),
  );
  process.exitCode = 1;
});
