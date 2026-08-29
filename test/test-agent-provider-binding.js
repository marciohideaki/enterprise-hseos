'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const yaml = require('yaml');

const {
  ProviderBindingError,
  createBoundModelProvider,
  createSecretResolver,
  readProviderBinding,
  validateProviderEnvironment,
} = require('../tools/lib/agent-provider-binding');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, '.agents', 'activation', 'provider-bindings', 'openai-compatible.example.yaml');
const SECRET = 'ephemeral-provider-binding-fixture';

function fixture(t, mutate = (value) => value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-provider-binding-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'binding.yaml');
  const binding = mutate(yaml.parse(fs.readFileSync(EXAMPLE, 'utf8')));
  fs.writeFileSync(filename, yaml.stringify(binding), { encoding: 'utf8', mode: 0o600 });
  return { binding, directory, filename };
}

function sandbox(ready) {
  return async () => ({
    ready,
    required: true,
    provider: 'ai-jail',
    profile: 'lockdown',
    checks: [],
    errors: ready ? [] : ['fixture sandbox unavailable'],
  });
}

function successfulFetch(observed) {
  return async (url, init) => {
    observed.push({ url, authorization: init.headers.authorization, body: JSON.parse(init.body) });
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ready' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } } })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'text/event-stream' : name === 'x-request-id' ? 'fixture' : null) },
      body: (async function* body() {
        yield Buffer.from(frames);
      })(),
    };
  };
}

test('binding creates an immutable registry snapshot without loading its secret', (t) => {
  const { filename } = fixture(t);
  const loaded = readProviderBinding(filename);
  let secretReads = 0;
  const environment = {};
  Object.defineProperty(environment, 'HSEOS_MODEL_PROVIDER_API_KEY', {
    enumerable: true,
    get() {
      secretReads += 1;
      return SECRET;
    },
  });
  const assembly = createBoundModelProvider({ binding: loaded.binding, environment, fetch_impl: successfulFetch([]) });
  assert.equal(secretReads, 0);
  assert.equal(assembly.manifest.provider_id, 'model:openai-compatible');
  assert.equal(assembly.snapshot.resolve('model:openai-compatible', 'organization/model').provider, assembly.provider);
  assert.throws(() => assembly.manifest.models.push('other/model'), TypeError);
  assert.throws(() => loaded.binding.provider.capabilities.push('reasoning'), TypeError);
  assert.match(loaded.binding_sha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () => createBoundModelProvider({ binding: { ...loaded.binding, activation: { operational: true, authorized: true } } }),
    ProviderBindingError,
  );
});

test('structural validation performs no network or secret access and never claims activation', async (t) => {
  const { filename } = fixture(t);
  let fetched = 0;
  let secretReads = 0;
  const environment = {};
  Object.defineProperty(environment, 'HSEOS_MODEL_PROVIDER_API_KEY', {
    enumerable: true,
    get() {
      secretReads += 1;
      return SECRET;
    },
  });
  const report = await validateProviderEnvironment({
    bindingPath: filename,
    repositoryRoot: ROOT,
    probe: false,
    environment,
    fetch_impl: async () => {
      fetched += 1;
    },
    sandbox_check: sandbox(true),
  });
  assert.equal(report.status, 'configuration-valid');
  assert.equal(report.network_probe_requested, false);
  assert.equal(report.activation_authorized, false);
  assert.equal(report.operational_activation, false);
  assert.equal(report.ready_for_g9_gate, false);
  assert.equal(report.evidence.configuration.secret_values_loaded, false);
  assert.equal(report.evidence.provider_probe.status, 'not-requested');
  assert.equal(secretReads, 0);
  assert.equal(fetched, 0);
});

test('probe resolves the exact reference at dispatch and returns only normalized safe evidence', async (t) => {
  const { filename } = fixture(t);
  const observed = [];
  const report = await validateProviderEnvironment({
    bindingPath: filename,
    repositoryRoot: ROOT,
    probe: true,
    environment: { HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
    fetch_impl: successfulFetch(observed),
    sandbox_check: sandbox(true),
  });
  assert.equal(report.status, 'provider-environment-passed');
  assert.equal(report.ready_for_g9_gate, true);
  assert.equal(report.activation_authorized, false);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].authorization, `Bearer ${SECRET}`);
  assert.equal(observed[0].url, 'https://api.example.invalid/v1/chat/completions');
  assert.equal(observed[0].body.model, 'organization/model');
  assert.deepEqual(report.evidence.provider_probe.normalized_events, ['content.delta', 'usage', 'completed']);
  assert.equal(report.evidence.provider_probe.finish_reason, 'stop');
  assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET));
  assert.ok(report.remaining_gates.includes('g9-zero-legacy-window'));
  assert.ok(report.remaining_gates.includes('explicit-human-cutover'));
});

test('required sandbox blocks probe before secret resolution or network dispatch', async (t) => {
  const { filename } = fixture(t);
  let fetched = 0;
  let secretReads = 0;
  const environment = {};
  Object.defineProperty(environment, 'HSEOS_MODEL_PROVIDER_API_KEY', {
    enumerable: true,
    get() {
      secretReads += 1;
      return SECRET;
    },
  });
  const report = await validateProviderEnvironment({
    bindingPath: filename,
    repositoryRoot: ROOT,
    probe: true,
    environment,
    fetch_impl: async () => {
      fetched += 1;
    },
    sandbox_check: sandbox(false),
  });
  assert.equal(report.status, 'provider-environment-blocked');
  assert.equal(report.evidence.provider_probe.status, 'blocked-by-required-sandbox');
  assert.equal(secretReads, 0);
  assert.equal(fetched, 0);
});

test('missing secrets fail as sanitized provider evidence', async (t) => {
  const { filename } = fixture(t);
  const report = await validateProviderEnvironment({
    bindingPath: filename,
    repositoryRoot: ROOT,
    probe: true,
    environment: {},
    fetch_impl: successfulFetch([]),
    sandbox_check: sandbox(true),
  });
  assert.equal(report.status, 'provider-environment-blocked');
  assert.equal(report.evidence.provider_probe.status, 'failed');
  assert.equal(report.evidence.provider_probe.error_code, 'unauthorized');
  assert.equal(report.evidence.provider_probe.retryable, false);
  assert.doesNotMatch(JSON.stringify(report), /secret resolution failed/);
});

test('custom secret schemes require an explicit resolver and never broaden implicitly', async () => {
  const resolver = createSecretResolver({ resolvers: { vault: async () => SECRET } });
  assert.equal(await resolver({ name: 'api-key', source_ref: 'vault://team/provider' }), SECRET);
  await assert.rejects(
    () => resolver({ name: 'api-key', source_ref: 'file:///tmp/unapproved' }),
    (error) => error.error_code === 'unauthorized' && error.message === 'secret resolution failed',
  );
});

test('bindings reject aliases, unknown fields, credential URLs and weakened activation', (t) => {
  const valid = fixture(t);
  const symbolic = path.join(valid.directory, 'symbolic.yaml');
  fs.symlinkSync(valid.filename, symbolic);
  assert.throws(() => readProviderBinding(symbolic), ProviderBindingError);
  const hard = path.join(valid.directory, 'hard.yaml');
  fs.linkSync(valid.filename, hard);
  assert.throws(() => readProviderBinding(valid.filename), ProviderBindingError);
  fs.unlinkSync(hard);

  for (const mutate of [
    (binding) => ({ ...binding, unknown: true }),
    (binding) => ({ ...binding, provider: { ...binding.provider, base_url: 'https://user:password@example.invalid/v1' } }),
    (binding) => ({ ...binding, activation: { operational: true, authorized: false } }),
    (binding) => ({ ...binding, provider: { ...binding.provider, secret_refs: [] } }),
  ]) {
    const invalid = fixture(t, mutate);
    assert.throws(() => readProviderBinding(invalid.filename), ProviderBindingError);
  }
});

test('CLI validates configuration without loading the declared environment secret', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'tools', 'cli', 'hseos-cli.js'), 'agent-provider-validate', '--binding', EXAMPLE, '--repository', ROOT, '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HSEOS_DISABLE_UPDATE_CHECK: '1', HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'configuration-valid');
  assert.equal(report.evidence.configuration.secret_values_loaded, false);
  assert.doesNotMatch(result.stdout, new RegExp(SECRET));
});
