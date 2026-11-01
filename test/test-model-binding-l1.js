'use strict';

// L1 of F17 (ADR-0050 section 2): every declared model binding is versioned, its effective backend and
// credential source are the declared ones, and a remote binding without observable quota runs only under
// an audited, unexpired owner exception.
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const yaml = require('yaml');

const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
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

// Every official binding file is either a declared remote model binding or a runtime binding that belongs to F18.
const CLASSIFICATION = Object.freeze({
  [OPENAI]: 'model',
  [TOOL_FREE]: 'model',
  'claude-agent-sdk.example.yaml': 'runtime',
  'codex-app-server.example.yaml': 'runtime',
  'deepseek-acp.example.yaml': 'runtime',
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const declaration = (name) => JSON.parse(fs.readFileSync(path.join(DECLARATIONS, `${name}.manifest.json`), 'utf8'));
const MODEL_DECLARATIONS = Object.freeze([
  { file: OPENAI, name: 'openai-compatible' },
  { file: TOOL_FREE, name: 'deepseek-acp-tool-free' },
]);

function pinnedBindingSha(file) {
  return file === OPENAI
    ? readProviderBinding(path.join(BINDINGS, file)).binding_sha256
    : sha256(fs.readFileSync(path.join(BINDINGS, file)));
}

test('every official binding is classified and every model binding has a versioned declaration', () => {
  const present = fs.readdirSync(BINDINGS).sort();
  assert.deepEqual(present, Object.keys(CLASSIFICATION).sort());
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
      max_cost_microusd: 3000,
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
