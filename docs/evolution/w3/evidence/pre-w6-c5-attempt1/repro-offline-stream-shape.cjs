'use strict';
// Offline reproduction (no network, no credential): feed the adapter a stream shaped like the official OpenAI chat-completions stream.
const fs = require('node:fs'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = process.cwd();
const yaml = require('node:module').createRequire(root + '/package.json')('yaml');
const { engineeringDigest } = require(root + '/tools/cli/lib/engineering-task-state');
const { createApiCampaignAdapter, credentialFingerprint, adapterArtifactDigest, API_ADAPTER_ID } = require(
  root + '/tools/cli/lib/provider-api-adapter',
);
const { parseProviderControlManifest } = require(root + '/tools/lib/provider-control-manifest');
const mode = process.argv[2] || 'null-usage'; // null-usage = official shape; omitted-usage = shape other vendors send
(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, 'repro-'));
  const binding = yaml.parse(fs.readFileSync(root + '/.agents/activation/provider-bindings/openai-compatible.example.yaml', 'utf8'));
  binding.provider.base_url = 'https://api.openai.com/v1';
  binding.provider.model = 'gpt-4o-mini';
  binding.provider.limits.context_tokens = 4096;
  binding.provider.limits.max_output_tokens = 256;
  binding.transport.max_attempts = 1;
  const file = path.join(dir, 'binding.yaml');
  fs.writeFileSync(file, yaml.stringify(binding));
  const task = randomUUID();
  const options = {
    tasks: { [task]: { prompt: 'Reply ready.' } },
    pricing: { input_microusd_per_million: 150000, output_microusd_per_million: 600000, valid_until: Date.now() + 3600_000 },
  };
  const key = 'repro-' + randomUUID() + randomUUID();
  const value = {
    schema_version: 1,
    binding_id: 'binding:repro',
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
  const base = {
    id: 'chatcmpl-x',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o-mini-2024-07-18',
    service_tier: 'default',
    system_fingerprint: 'fp_x',
  };
  const u = mode === 'null-usage' ? { usage: null } : {};
  const frames = [
    {
      ...base,
      choices: [{ index: 0, delta: { role: 'assistant', content: '', refusal: null }, logprobs: null, finish_reason: null }],
      ...u,
    },
    { ...base, choices: [{ index: 0, delta: { content: 'ready' }, logprobs: null, finish_reason: null }], ...u },
    { ...base, choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: 'stop' }], ...u },
    {
      ...base,
      choices: [],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 2,
        total_tokens: 14,
        prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    },
  ];
  const fetchImpl = async () =>
    new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  const adapter = createApiCampaignAdapter(
    { manifest: parseProviderControlManifest(value), binding: file, options },
    { environment: { HSEOS_MODEL_PROVIDER_API_KEY: key }, fetchImpl },
  );
  try {
    const r = await adapter.adapter.run({ task_id: task, request_id: randomUUID(), signal: new AbortController().signal });
    console.log(JSON.stringify({ mode, outcome: 'completed', input_tokens: r.input_tokens, output_tokens: r.output_tokens }));
  } catch (e) {
    console.log(JSON.stringify({ mode, outcome: 'error', code: e.code || e.message }));
  }
  fs.rmSync(dir, { recursive: true, force: true });
})();
