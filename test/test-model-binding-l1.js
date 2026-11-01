'use strict';

// L1 of F17 (ADR-0050 section 2): every declared model binding is versioned, its effective backend and
// credential source are the declared ones, and a remote binding without observable quota runs only under
// an audited, unexpired owner exception.
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const yaml = require('yaml');

const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const {
  API_ADAPTER_ID,
  adapterArtifactDigest,
  createApiCampaignAdapter,
  credentialFingerprint,
} = require('../tools/cli/lib/provider-api-adapter');
const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
const { createBoundModelProvider, probeBoundProvider, readProviderBinding } = require('../tools/lib/agent-provider-binding');
const {
  assertEffectiveBackend,
  parseProviderControlManifest,
  selectDeclaredCredential,
} = require('../tools/lib/provider-control-manifest');

const ROOT = path.join(__dirname, '..');
const BINDINGS = path.join(ROOT, '.agents', 'activation', 'provider-bindings');
const DECLARATIONS = path.join(ROOT, 'docs', 'evolution', 'w3', 'model-bindings');
const OPENAI = 'openai-compatible.example.yaml';
const TOOL_FREE = 'deepseek-acp-tool-free.example.yaml';

// Every official binding file is either a declared remote model binding, a runtime binding that belongs to F18, or a
// model binding whose versioned declaration is still pending (it must stay neither operational nor authorized until then).
// The fourth-family API binding is declared; authorization stays with the owner, per campaign.
const GEMINI = 'gemini-api.example.yaml';
const CLASSIFICATION = Object.freeze({
  [OPENAI]: 'model',
  [TOOL_FREE]: 'model',
  [GEMINI]: 'model',
  'claude-agent-sdk.example.yaml': 'runtime',
  'codex-app-server.example.yaml': 'runtime',
  'deepseek-acp.example.yaml': 'runtime',
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const declaration = (name) => JSON.parse(fs.readFileSync(path.join(DECLARATIONS, `${name}.manifest.json`), 'utf8'));
const MODEL_DECLARATIONS = Object.freeze([
  { file: OPENAI, name: 'openai-compatible' },
  { file: TOOL_FREE, name: 'deepseek-acp-tool-free' },
  { file: GEMINI, name: 'gemini-api' },
]);

function pinnedBindingSha(file) {
  return file === OPENAI || file === GEMINI
    ? readProviderBinding(path.join(BINDINGS, file)).binding_sha256
    : sha256(fs.readFileSync(path.join(BINDINGS, file)));
}

test('every official binding is classified and every model binding has a versioned declaration', () => {
  const present = fs.readdirSync(BINDINGS).sort();
  assert.deepEqual(present, Object.keys(CLASSIFICATION).sort());
  for (const [file, kind] of Object.entries(CLASSIFICATION)) {
    if (kind === 'model_pending') assert.fail(`${file} is a model binding without a versioned declaration`);
  }
  const gemini = readProviderBinding(path.join(BINDINGS, GEMINI)).binding;
  assert.deepEqual(gemini.activation, { operational: false, authorized: false }, 'the owner authorizes per campaign, never the file');
  const declared = fs.readdirSync(DECLARATIONS).sort();
  assert.deepEqual(declared, MODEL_DECLARATIONS.map(({ name }) => `${name}.manifest.json`).sort());
  for (const { file, name } of MODEL_DECLARATIONS) {
    const manifest = parseProviderControlManifest(declaration(name));
    assert.equal(CLASSIFICATION[file], 'model');
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.provider_kind, 'model');
    assert.match(manifest.provider_version, /^\d+\.\d+\.\d+$/);
    assert.equal(manifest.binding_sha256, pinnedBindingSha(file), `${name} is pinned to the binding file`);
    assert.equal(manifest.transport, 'http');
    assert.equal(manifest.authentication.mode, 'api_key');
    assert.ok(manifest.authentication.credential, 'remote bindings declare their credential source');
    assert.equal(manifest.billing.kind, 'metered');
    assert.ok(manifest.billing.max_request_microusd > 0);
    assert.notEqual(manifest.controls.quota, 'observed', 'a declaration cannot claim an observation it never made');
    assert.notEqual(manifest.controls.quota, 'not_applicable', 'remote quota is never assumed unlimited');
  }
});

test('the declaration of the OpenAI-compatible binding agrees with the binding it pins', () => {
  const { binding } = readProviderBinding(path.join(BINDINGS, OPENAI));
  const manifest = parseProviderControlManifest(declaration('openai-compatible'));
  assert.equal(manifest.binding_id, binding.binding_id);
  assert.equal(manifest.adapter, binding.adapter);
  assert.equal(manifest.provider_version, binding.provider.provider_version);
  assert.deepEqual(manifest.authentication.credential, binding.provider.secret_refs[0]);
  assert.ok(binding.provider.limits.context_tokens <= manifest.limits.max_input_tokens);
  assert.ok(manifest.limits.max_output_tokens <= binding.provider.limits.max_output_tokens);
  assert.equal(
    manifest.artifact_sha256,
    sha256(fs.readFileSync(path.join(ROOT, 'packages', 'model-providers', 'openai-compatible-provider.js'))),
  );
});

test('the tool-free composition declares the model and credential its manifest pins', () => {
  const composition = yaml.parse(fs.readFileSync(path.join(BINDINGS, TOOL_FREE), 'utf8'));
  const model = composition.find((entry) => entry.id === 'model').config;
  const manifest = parseProviderControlManifest(declaration('deepseek-acp-tool-free'));
  assert.equal(manifest.authentication.credential.source_ref, `env://${model.apiKeyEnv}`);
  assert.equal(manifest.artifact_sha256, manifest.binding_sha256);
  assert.deepEqual(
    model.models.map((entry) => entry.id),
    ['deepseek-chat'],
  );
  assert.equal(composition.find((entry) => entry.id === 'agent').config.model, 'deepseek-chat');
});

function streamingFetch(observed) {
  return async (url, init) => {
    observed.push({ url, authorization: init.headers.authorization, model: JSON.parse(init.body).model });
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ready' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } } })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'text/event-stream' : null) },
      body: (async function* body() {
        yield Buffer.from(frames);
      })(),
    };
  };
}

async function observeEffectiveBackend(binding, environment) {
  const requests = [];
  const assembly = createBoundModelProvider({ binding, environment, fetch_impl: streamingFetch(requests) });
  const evidence = await probeBoundProvider(assembly);
  assert.equal(evidence.status, 'passed');
  assert.equal(requests.length, 1);
  return {
    origin: new URL(requests[0].url).origin,
    model: requests[0].model,
    bearer: requests[0].authorization.replace(/^Bearer /, ''),
  };
}

test('the backend a request actually reaches is the declared one and any divergence is refused', async () => {
  const { binding } = readProviderBinding(path.join(BINDINGS, OPENAI));
  const secret = `fixture-${randomUUID()}`;
  const environment = { HSEOS_MODEL_PROVIDER_API_KEY: secret };
  const effective = await observeEffectiveBackend(binding, environment);
  const declared = { origin: new URL(binding.provider.base_url).origin, model: binding.provider.model };
  assert.deepEqual(assertEffectiveBackend(declared, effective), declared);
  assert.equal(effective.bearer, secret);

  for (const divergent of [
    { ...effective, origin: 'https://other.example.invalid' },
    { ...effective, origin: 'http://api.example.invalid' },
    { ...effective, model: 'organization/other-model' },
    { ...effective, model: undefined },
    { ...effective, origin: undefined },
  ])
    assert.throws(() => assertEffectiveBackend(declared, divergent), { code: 'CONTROL_PROVIDER_BACKEND_DIVERGED' });

  const drifted = structuredClone(binding);
  drifted.provider.model = 'organization/drifted';
  const driftedEffective = await observeEffectiveBackend(drifted, environment);
  assert.throws(() => assertEffectiveBackend(declared, driftedEffective), { code: 'CONTROL_PROVIDER_BACKEND_DIVERGED' });
});

test('credential precedence: only the declared source counts and a second source is a refused conflict', () => {
  for (const { name } of MODEL_DECLARATIONS) {
    const manifest = parseProviderControlManifest(declaration(name));
    const declared = manifest.authentication.credential.source_ref;
    assert.equal(selectDeclaredCredential(manifest, { [declared]: 'declared-value' }), 'declared-value');
    assert.equal(
      selectDeclaredCredential(manifest, { [declared]: 'declared-value', 'secret://pass/other': undefined, 'env://OTHER': '' }),
      'declared-value',
    );
    for (const competing of ['env://ANTHROPIC_API_KEY', 'secret://pass/models/other', 'file://~/.config/key']) {
      assert.throws(() => selectDeclaredCredential(manifest, { [declared]: 'declared-value', [competing]: 'other-value' }), {
        code: 'CONTROL_PROVIDER_CREDENTIAL_CONFLICT',
      });
      assert.throws(() => selectDeclaredCredential(manifest, { [declared]: 'declared-value', [competing]: 'declared-value' }), {
        code: 'CONTROL_PROVIDER_CREDENTIAL_CONFLICT',
      });
      assert.throws(() => selectDeclaredCredential(manifest, { [competing]: 'other-value' }), {
        code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED',
      });
    }
    assert.throws(() => selectDeclaredCredential(manifest, {}), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
    assert.throws(() => selectDeclaredCredential(manifest, { [declared]: '' }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  }
  const local = parseProviderControlManifest({
    ...declaration('openai-compatible'),
    vendor: 'deepseek',
    route: 'local',
    transport: 'process',
    authentication: {
      mode: 'local',
      credential: null,
      account_sha256: null,
      identity_kind: 'local_profile',
      profile_sha256: 'a'.repeat(64),
      source: 'explicit',
    },
    billing: { kind: 'local', currency: 'USD', max_request_microusd: 0 },
    controls: { authority: 'kernel', resume: 'not_verified', cancel: 'not_verified', quota: 'not_applicable', evidence_sha256: null },
  });
  assert.equal(selectDeclaredCredential(local, {}), null);
  assert.throws(() => selectDeclaredCredential(local, { 'env://AMBIENT_KEY': 'ambient' }), {
    code: 'CONTROL_PROVIDER_CREDENTIAL_CONFLICT',
  });
});

async function quotaFixture(t, manifest, exception) {
  const control = new EngineeringControl();
  t.after(() => {
    control.close();
    control.handle.cleanup();
  });
  const taskId = randomUUID();
  const authorizationId = randomUUID();
  const id = randomUUID();
  const observed = {
    binding_sha256: manifest.binding_sha256,
    artifact_sha256: manifest.artifact_sha256,
    provider_version: manifest.provider_version,
    account_sha256: null,
    credential_sha256: manifest.authentication.credential_sha256,
    authenticated: true,
    auth_source: 'explicit',
    observed_at: Date.now(),
    expires_at: Date.now() + 60_000,
    quota_remaining_requests: null,
    competing_credentials: false,
  };
  let calls = 0;
  const configured = {
    manifest,
    binding_sha256: manifest.binding_sha256,
    adapter: {
      inspect: async () => ({ ...observed, observed_at: Date.now() }),
      run: async () => {
        calls++;
        return {
          status: 'completed',
          binding_sha256: manifest.binding_sha256,
          evidence_sha256: 'f'.repeat(64),
          cost_microusd: 100,
          input_tokens: 20,
          output_tokens: 4,
        };
      },
    },
  };
  const deadline = Date.now() + 60_000;
  const authorizations = {
    [authorizationId]: {
      max_requests: 3,
      max_cost_microusd: manifest.billing.max_request_microusd * 3,
      deadline,
      binding_ids: [manifest.binding_id],
      task_ids: [taskId],
      ...(exception ? { quota_exceptions: { [manifest.binding_id]: exception(deadline) } } : {}),
    },
  };
  const campaigns = new ProviderCampaignControl(control, { [manifest.binding_id]: configured }, { authorizations });
  const command = (action, input = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: campaigns.rows(id).length,
    action,
    input,
  });
  await campaigns.execute(command('create', { authorization_id: authorizationId }));
  return { campaigns, command, id, taskId, calls: () => calls, binding_id: manifest.binding_id };
}

test('a remote binding without observable quota runs only under a valid audited exception', async (t) => {
  for (const { name } of MODEL_DECLARATIONS) {
    const manifest = parseProviderControlManifest(declaration(name));
    const run = (f) => f.campaigns.execute(f.command('run', { binding_id: f.binding_id, task_id: f.taskId }));

    const absent = await quotaFixture(t, manifest);
    await assert.rejects(run(absent), { code: 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE' });
    assert.equal(absent.calls(), 0, `${name}: unknown quota is not unlimited`);

    const valid = await quotaFixture(t, manifest, () => ({ reason: 'L1 F17 audited quota exception', expires_at: Date.now() + 30_000 }));
    await run(valid);
    assert.equal(valid.calls(), 1);
    assert.equal(valid.campaigns.rows(valid.id).find((row) => row.payload.kind === 'reserved').payload.quota_admission, 'owner_exception');

    const expired = await quotaFixture(t, manifest, () => ({ reason: 'L1 F17 expiring quota exception', expires_at: Date.now() + 50 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await assert.rejects(run(expired), { code: 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE' });
    assert.equal(expired.calls(), 0, `${name}: an expired exception refuses`);
  }
});

test('the declaration of the fourth-family binding agrees with the binding it pins and states nothing as fact', () => {
  const { binding } = readProviderBinding(path.join(BINDINGS, GEMINI));
  const manifest = parseProviderControlManifest(declaration('gemini-api'));
  assert.equal(manifest.binding_id, binding.binding_id);
  assert.equal(manifest.adapter, binding.adapter);
  assert.equal(manifest.provider_version, binding.provider.provider_version);
  assert.deepEqual(manifest.authentication.credential, binding.provider.secret_refs[0]);
  assert.match(binding.provider.secret_refs[0].source_ref, /^env:\/\/[A-Z_][A-Z0-9_]*$/);
  assert.ok(binding.provider.limits.context_tokens <= manifest.limits.max_input_tokens);
  assert.ok(manifest.limits.max_output_tokens <= binding.provider.limits.max_output_tokens);
  assert.equal(manifest.vendor, 'gemini');
  assert.equal(manifest.route, 'api');
  assert.equal(manifest.controls.quota, 'not_verified', 'balance is not observable, so a quota exception is the only way in');
  // Endpoint and model are configuration to be confirmed in the campaign; the file must say so and keep the reserved host.
  const text = fs.readFileSync(path.join(BINDINGS, GEMINI), 'utf8');
  assert.match(text, /a confirmar na campanha/);
  assert.match(binding.provider.base_url, /\.invalid\//);
  // The campaign envelope of the ADR: 4 requests, US$ 1.00 in total.
  assert.ok(manifest.limits.max_requests <= 4);
  assert.ok(manifest.limits.max_requests * manifest.billing.max_request_microusd <= 1_000_000);
  assert.ok(!/AIza|sk-[A-Za-z0-9]{16}/.test(text), 'no credential in the file');
});

const GEMINI_ENV = 'HSEOS_GEMINI_API_KEY';
const GEMINI_AMBIENT = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];

function geminiFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-gemini-l1-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'binding.yaml');
  fs.copyFileSync(path.join(BINDINGS, GEMINI), filename);
  const taskId = randomUUID();
  const options = {
    tasks: { [taskId]: { prompt: 'Reply ready.' } },
    pricing: { input_microusd_per_million: 1_000_000, output_microusd_per_million: 1_000_000, valid_until: Date.now() + 120_000 },
    allowed_origin: new URL(readProviderBinding(filename).binding.provider.base_url).origin,
  };
  const credential = randomUUID() + randomUUID();
  const value = structuredClone(declaration('gemini-api'));
  value.adapter = API_ADAPTER_ID;
  value.binding_sha256 = engineeringDigest({ binding: readProviderBinding(filename).binding, options });
  value.artifact_sha256 = adapterArtifactDigest();
  value.authentication.credential_sha256 = credentialFingerprint(credential);
  const environment = { [GEMINI_ENV]: credential, GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined };
  const calls = [];
  const transport = {
    frames: [
      { choices: [{ delta: { content: 'ready' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 4, completion_tokens: 1 } },
    ],
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, authorization: init.headers.authorization, model: JSON.parse(init.body).model, body: init.body });
    return new Response(transport.frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const create = () =>
    createApiCampaignAdapter({ manifest: parseProviderControlManifest(value), binding: filename, options }, { environment, fetchImpl });
  const input = () => ({ task_id: taskId, request_id: randomUUID(), signal: new AbortController().signal });
  const rebind = () => {
    value.binding_sha256 = engineeringDigest({ binding: readProviderBinding(filename).binding, options });
  };
  return { create, value, environment, transport, calls, filename, options, taskId, credential, input, rebind };
}

async function geminiCampaign(t, f, { exception = true, override = {} } = {}) {
  const authorizationId = randomUUID();
  const campaignId = randomUUID();
  const deadline = Date.now() + 60_000;
  const control = new EngineeringControl({
    providerBindings: { [f.value.binding_id]: { ...f.create(), manifest: f.value, ...override } },
    providerAuthorizations: {
      [authorizationId]: {
        max_requests: 1,
        max_cost_microusd: f.value.billing.max_request_microusd,
        deadline,
        binding_ids: [f.value.binding_id],
        task_ids: [f.taskId],
        ...(exception
          ? { quota_exceptions: { [f.value.binding_id]: { reason: 'L1 B1 audited quota exception', expires_at: deadline - 1000 } } }
          : {}),
      },
    },
  });
  t.after(() => {
    control.close();
    control.handle.cleanup();
  });
  const service = control.providerCampaigns;
  const command = (action, input) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: service.rows(campaignId).length,
    action,
    input,
  });
  await service.execute(command('create', { authorization_id: authorizationId }));
  return { service, campaignId, run: () => service.execute(command('run', { binding_id: f.value.binding_id, task_id: f.taskId })) };
}

test('L1 fourth family: the supervisor injects the declared credential and the answer path never carries it', async (t) => {
  const f = geminiFixture(t);
  const { adapter } = f.create();
  const observation = await adapter.inspect();
  const receipt = await adapter.run(f.input());
  assert.equal(receipt.status, 'completed');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].authorization, `Bearer ${f.credential}`, 'the egress broker authenticates with the declared source');
  assert.ok(!f.calls[0].body.includes(f.credential), 'the credential is never in a request body the executor could shape');
  assert.ok(!JSON.stringify({ receipt, observation }).includes(f.credential));
  assert.equal(observation.credential_sha256, credentialFingerprint(f.credential));
  assert.ok(!fs.readFileSync(f.filename, 'utf8').includes(f.credential), 'the binding holds a reference, never a value');
});

test('L1 fourth family: an override of the declared source is refused before any egress', async (t) => {
  const f = geminiFixture(t);
  const { adapter } = f.create();
  f.environment[GEMINI_ENV] = randomUUID();
  await assert.rejects(adapter.inspect(), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  await assert.rejects(adapter.run(f.input()), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  delete f.environment[GEMINI_ENV];
  await assert.rejects(adapter.run(f.input()), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  f.environment[GEMINI_ENV] = f.credential;
  const text = fs.readFileSync(f.filename, 'utf8');
  fs.writeFileSync(f.filename, text.replace(/^(\s*model:).*$/m, '$1 other-model'));
  await assert.rejects(adapter.run(f.input()), { code: 'CONTROL_PROVIDER_BINDING_DRIFT' });
  assert.equal(f.calls.length, 0);
});

test('L1 fourth family: an answer that echoes the credential is withheld, even split across deltas', async (t) => {
  const f = geminiFixture(t);
  const half = Math.floor(f.credential.length / 2);
  f.transport.frames = [
    { choices: [{ delta: { content: `echo ${f.credential.slice(0, half)}` } }] },
    { choices: [{ delta: { content: f.credential.slice(half) }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 1 } },
  ];
  const receipt = await f.create().adapter.run(f.input());
  assert.equal(receipt.evidence_withheld, 'credential_pattern');
  assert.equal(receipt.output_text, undefined);
  assert.equal(receipt.evidence_ref, undefined);
  assert.ok(!JSON.stringify(receipt).includes(f.credential));
});

test('L1 fourth family: an expired tariff blocks inspection and dispatch', async (t) => {
  const f = geminiFixture(t);
  f.options.pricing.valid_until = 1;
  f.rebind();
  const { adapter } = f.create();
  await assert.rejects(adapter.inspect(), { code: 'CONTROL_PROVIDER_PRICING_EXPIRED' });
  await assert.rejects(adapter.run(f.input()), { code: 'CONTROL_PROVIDER_PRICING_EXPIRED' });
  assert.equal(f.calls.length, 0);
});

test('L1 fourth family: the vendor ambient keys never overlay the declared credential', async (t) => {
  for (const name of GEMINI_AMBIENT) {
    for (const same of [false, true]) {
      const f = geminiFixture(t);
      const { adapter } = f.create();
      f.environment[name] = same ? f.credential : randomUUID();
      await assert.rejects(adapter.inspect(), { code: 'CONTROL_PROVIDER_CREDENTIAL_CONFLICT' }, `${name} same=${same}`);
      await assert.rejects(adapter.run(f.input()), { code: 'CONTROL_PROVIDER_CREDENTIAL_CONFLICT' });
      assert.equal(f.calls.length, 0, 'no request leaves with two credential sources present');
      delete f.environment[name];
      await adapter.run(f.input());
      assert.equal(f.calls.length, 1);
    }
  }
});

test('L1 fourth family: a silent change of price or reservation blocks configuration', async (t) => {
  const f = geminiFixture(t);
  f.options.pricing.input_microusd_per_million *= 2;
  assert.throws(f.create, { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  f.rebind();
  assert.ok(f.create(), 'a re-pinned price that still fits the reservation is admitted');
  f.options.pricing.input_microusd_per_million = 10_000_000_000;
  f.rebind();
  assert.throws(f.create, { code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED' });
  f.options.pricing.input_microusd_per_million = 1_000_000;
  f.value.billing.max_request_microusd = 1;
  f.rebind();
  assert.throws(f.create, { code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED' });
  assert.equal(f.calls.length, 0);
});

test('L1 fourth family: a binding that is not HTTPS or whose manifest names another vendor is refused', async (t) => {
  const f = geminiFixture(t);
  const text = fs.readFileSync(f.filename, 'utf8');
  fs.writeFileSync(f.filename, text.replace(/https:\/\//, 'http://'));
  f.rebind();
  assert.throws(f.create, { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  fs.writeFileSync(f.filename, text);
  f.rebind();
  assert.ok(f.create());
  f.value.vendor = 'claude';
  assert.throws(f.create, { code: 'CONTROL_PROVIDER_MANIFEST_INVALID' });
});

test('L1 fourth family: the credential only goes to the pinned origin and any other origin is refused', async (t) => {
  const f = geminiFixture(t);
  assert.ok(f.create());
  const text = fs.readFileSync(f.filename, 'utf8');
  // The binding moved to another HTTPS host without re-pinning the allowed origin.
  fs.writeFileSync(f.filename, text.replace(/https:\/\/[^/\s]+/, 'https://elsewhere.example.invalid'));
  f.rebind();
  assert.throws(f.create, { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  fs.writeFileSync(f.filename, text);
  f.rebind();
  // An absent or malformed pin is refused too: configuration alone never chooses where the credential goes.
  for (const pin of [undefined, 'https://gemini-endpoint-a-confirmar.example.invalid/v1', 'not a url']) {
    const g = geminiFixture(t);
    if (pin === undefined) delete g.options.allowed_origin;
    else g.options.allowed_origin = pin;
    g.rebind();
    assert.throws(g.create, (error) => ['CONTROL_PROVIDER_CONFIGURATION_INVALID', 'ZodError'].includes(error.code ?? error.name));
    assert.equal(g.calls.length, 0);
  }
  assert.equal(f.calls.length, 0);
});

test('L1 fourth family: the backend a request reaches is the declared origin and model, and divergence is refused', async (t) => {
  const f = geminiFixture(t);
  const configured = f.create();
  const observation = await configured.adapter.inspect();
  await configured.adapter.run(f.input());
  const { binding } = readProviderBinding(f.filename);
  const declared = { origin: new URL(binding.provider.base_url).origin, model: binding.provider.model };
  assert.deepEqual(configured.declared_backend, { origin: declared.origin });
  assert.deepEqual(observation.effective_backend, { origin: declared.origin });
  assert.deepEqual(
    assertEffectiveBackend(declared, { origin: new URL(f.calls[0].url).origin, model: f.calls[0].model }),
    declared,
    'the request that actually left carried the declared origin and model',
  );
  assert.throws(() => assertEffectiveBackend(declared, { origin: 'https://other.example.invalid', model: declared.model }), {
    code: 'CONTROL_PROVIDER_BACKEND_DIVERGED',
  });
  const before = f.calls.length;
  for (const declared_backend of [{ origin: 'https://other.example.invalid' }, { origin: declared.origin.replace('https', 'http') }]) {
    const campaign = await geminiCampaign(t, f, { override: { declared_backend } });
    await assert.rejects(campaign.run(), { code: 'CONTROL_PROVIDER_BACKEND_DIVERGED' });
  }
  assert.equal(f.calls.length, before, 'a diverged backend is refused before dispatch');
});

test('L1 fourth family: no balance is observable, so a campaign needs a valid audited quota exception', async (t) => {
  const f = geminiFixture(t);
  const observation = await f.create().adapter.inspect();
  assert.equal(observation.quota_available_microusd, undefined, 'a balance is never invented');
  assert.equal(observation.quota_remaining_requests, null);
  assert.equal(f.calls.length, 0, 'inspecting spends no request and calls no balance endpoint');

  const absent = await geminiCampaign(t, f, { exception: false });
  await assert.rejects(absent.run(), { code: 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE' });
  assert.equal(f.calls.length, 0, 'unknown quota is not unlimited');

  const granted = await geminiCampaign(t, f);
  await granted.run();
  assert.equal(f.calls.length, 1);
  assert.equal(
    granted.service.rows(granted.campaignId).find((row) => row.payload.kind === 'reserved').payload.quota_admission,
    'owner_exception',
  );
});

test('L1 fourth family: the catalog lists the vendor as implemented but pending real conformance', () => {
  const output = require('node:child_process').execFileSync(process.execPath, ['tools/cli/hseos-cli.js', 'control', 'adapters'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const catalog = JSON.parse(output);
  const entry = catalog.implemented.find((adapter) => adapter.vendor === 'gemini');
  assert.ok(entry, 'gemini is in the implemented catalog');
  assert.equal(entry.route, 'api');
  assert.equal(entry.provider_kind, 'model');
  assert.equal(entry.real_conformance, 'not_certified');
  assert.ok(catalog.pending_real_conformance.includes('gemini'));
});
