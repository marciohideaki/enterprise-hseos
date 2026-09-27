'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const { CONTRACT_SCHEMA_VERSION } = require('../../../packages/agent-runtime-contracts');
const { engineeringDigest } = require('./engineering-task-state');
const { readProviderBinding } = require('../../lib/agent-provider-binding');
const { createEngineeringModel, validateEngineeringBinding } = require('./engineering-model');

const API_ADAPTER_ID = 'hseos-api-campaign-v1';
const API_ADAPTER_VERSION = '1.0.0';
const integer = z.number().int().nonnegative().safe();
const optionsSchema = z
  .object({
    tasks: z.record(z.string().uuid(), z.object({ prompt: z.string().min(1).max(16_384) }).strict()),
    pricing: z
      .object({
        input_microusd_per_million: integer.positive(),
        output_microusd_per_million: integer.positive(),
        valid_until: integer.positive(),
      })
      .strict(),
  })
  .strict();
const artifactFiles = [
  __filename,
  require.resolve('./engineering-model'),
  require.resolve('./provider-egress-broker'),
  require.resolve('../../lib/agent-provider-binding'),
  require.resolve('../../../packages/model-providers/openai-compatible-provider'),
  require.resolve('../../../packages/model-providers/common'),
];
function adapterArtifactDigest() {
  return engineeringDigest(artifactFiles.map((file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')));
}
const loadedArtifact = adapterArtifactDigest();
function credentialFingerprint(value) {
  return createHash('sha256').update('hseos-provider-credential-v1\0').update(value).digest('hex');
}
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function quotaMicrousd(value) {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value)) fail('CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) fail('CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE');
  return Number(amount);
}

/** A real API transport; account identity and actual billing are never inferred. */
function createApiCampaignAdapter(
  { manifest, binding: filename, options },
  { environment = process.env, fetchImpl = globalThis.fetch } = {},
) {
  const settings = optionsSchema.parse(options);
  const initial = readProviderBinding(filename);
  const binding = validateEngineeringBinding(initial.binding);
  const digest = engineeringDigest({ binding, options: settings });
  if (
    manifest.adapter !== API_ADAPTER_ID ||
    manifest.vendor !== 'deepseek' ||
    manifest.route !== 'api' ||
    manifest.provider_kind !== 'model' ||
    manifest.authentication.identity_kind !== 'credential' ||
    manifest.authentication.account_sha256 !== null ||
    digest !== manifest.binding_sha256 ||
    manifest.artifact_sha256 !== loadedArtifact ||
    manifest.provider_version !== API_ADAPTER_VERSION ||
    binding.provider.provider_version !== API_ADAPTER_VERSION ||
    manifest.authentication.source !== 'explicit' ||
    !['https://api.deepseek.com', 'https://api.deepseek.com/v1'].includes(binding.provider.base_url.replace(/\/$/, '')) ||
    engineeringDigest(manifest.authentication.credential) !== engineeringDigest(binding.provider.secret_refs[0]) ||
    binding.provider.limits.context_tokens > manifest.limits.max_input_tokens ||
    manifest.limits.max_output_tokens > binding.provider.limits.max_output_tokens ||
    !binding.provider.capabilities.includes('usage')
  )
    fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  const reference = binding.provider.secret_refs[0].source_ref;
  if (!/^env:\/\/[A-Z_][A-Z0-9_]*$/.test(reference)) fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  const name = reference.slice(6);
  const ceiling =
    (BigInt(binding.provider.limits.context_tokens) * BigInt(settings.pricing.input_microusd_per_million) +
      BigInt(manifest.limits.max_output_tokens) * BigInt(settings.pricing.output_microusd_per_million) +
      999_999n) /
    1_000_000n;
  if (ceiling > BigInt(manifest.billing.max_request_microusd)) fail('CONTROL_CAMPAIGN_BUDGET_EXHAUSTED');
  function verify() {
    if (
      adapterArtifactDigest() !== loadedArtifact ||
      engineeringDigest({ binding: readProviderBinding(filename).binding, options: settings }) !== digest
    )
      fail('CONTROL_PROVIDER_BINDING_DRIFT');
    if (settings.pricing.valid_until < Date.now() + manifest.limits.max_duration_ms) fail('CONTROL_PROVIDER_PRICING_EXPIRED');
    const value = Object.hasOwn(environment, name) ? environment[name] : undefined;
    if (typeof value !== 'string' || !value || credentialFingerprint(value) !== manifest.authentication.credential_sha256)
      fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
    return value;
  }
  return {
    binding_sha256: digest,
    adapter: {
      async inspect({ signal = new AbortController().signal } = {}) {
        try {
          const value = verify();
          const response = await fetchImpl('https://api.deepseek.com/user/balance', {
            method: 'GET',
            redirect: 'error',
            headers: { authorization: `Bearer ${value}`, accept: 'application/json' },
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          });
          if (response.status !== 200) {
            await response.body?.cancel();
            fail('CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE');
          }
          const chunks = [];
          let bytes = 0;
          for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > 16_384) fail('CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE');
            chunks.push(Buffer.from(chunk));
          }
          const balance = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof balance.is_available !== 'boolean' || !Array.isArray(balance.balance_infos))
            fail('CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE');
          const usd = balance.balance_infos.filter((entry) => entry.currency === 'USD');
          if (usd.length !== 1) fail('CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE');
          const available = balance.is_available ? quotaMicrousd(usd[0].total_balance) : 0;
          return {
            binding_sha256: digest,
            artifact_sha256: loadedArtifact,
            provider_version: manifest.provider_version,
            account_sha256: null,
            credential_sha256: credentialFingerprint(value),
            authenticated: true,
            auth_source: 'explicit',
            observed_at: Date.now(),
            expires_at: settings.pricing.valid_until,
            quota_remaining_requests: null,
            quota_available_microusd: available,
            competing_credentials: false,
          };
        } catch (error) {
          if (
            ['CONTROL_PROVIDER_BINDING_DRIFT', 'CONTROL_PROVIDER_PRICING_EXPIRED', 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED'].includes(
              error.code,
            )
          )
            fail(error.code);
          fail('CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE');
        }
      },
      async run({ task_id, request_id, signal }) {
        const value = verify();
        const task = settings.tasks[task_id];
        if (!task) fail('CONTROL_CAMPAIGN_SCOPE_DENIED');
        if (signal.aborted) fail('CONTROL_CAMPAIGN_CANCELLED');
        const connection = createEngineeringModel({
          binding,
          environment: { [name]: value },
          fetchImpl,
          deadline: Date.now() + manifest.limits.max_duration_ms,
        });
        const provider = connection.snapshot.resolve(binding.provider.provider_id, binding.provider.model).provider;
        const id = `request:${request_id}`;
        const cancel = () =>
          provider.cancel({
            schema_version: CONTRACT_SCHEMA_VERSION,
            provider_id: binding.provider.provider_id,
            request_id: id,
            reason: 'Campaign cancelled',
          });
        signal.addEventListener('abort', cancel, { once: true });
        const output = createHash('sha256');
        let bytes = 0,
          usage,
          terminal;
        try {
          await connection.connect();
          if (signal.aborted) fail('CONTROL_CAMPAIGN_CANCELLED');
          for await (const event of provider.stream({
            schema_version: CONTRACT_SCHEMA_VERSION,
            request_id: id,
            provider_id: binding.provider.provider_id,
            session_id: `session:${task_id}`,
            turn_id: `turn:${request_id}`,
            model: binding.provider.model,
            messages: [{ role: 'user', content: task.prompt }],
            tools: [],
            parameters: { max_output_tokens: manifest.limits.max_output_tokens, temperature: null, stop: [] },
          })) {
            if (signal.aborted) {
              cancel();
              fail('CONTROL_CAMPAIGN_CANCELLED');
            }
            if (event.event_type === 'content.delta' || event.event_type === 'reasoning.delta') {
              const text = event.payload.text;
              bytes += Buffer.byteLength(text);
              if (bytes > 1_048_576) {
                cancel();
                fail('CONTROL_PROVIDER_OUTPUT_LIMIT');
              }
              output.update(text);
            }
            if (event.event_type === 'usage') usage = event.payload;
            if (event.event_type === 'completed' || event.event_type === 'failed') terminal = event;
          }
          if (!usage || terminal?.event_type !== 'completed' || terminal.payload.finish_reason !== 'stop')
            fail('CONTROL_OUTCOME_UNCERTAIN');
          return {
            status: 'completed',
            binding_sha256: digest,
            evidence_sha256: engineeringDigest({ task_id, request_id, output_sha256: output.digest('hex'), usage }),
            cost_microusd: null,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
          };
        } finally {
          signal.removeEventListener('abort', cancel);
          try {
            provider.dispose({ schema_version: CONTRACT_SCHEMA_VERSION, provider_id: binding.provider.provider_id, request_id: id });
          } finally {
            await connection.close();
          }
        }
      },
    },
  };
}
module.exports = { API_ADAPTER_ID, API_ADAPTER_VERSION, adapterArtifactDigest, credentialFingerprint, createApiCampaignAdapter };
