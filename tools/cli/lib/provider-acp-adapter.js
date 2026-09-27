'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const { engineeringDigest } = require('./engineering-task-state');
const { createNativeCampaignAdapter, nativeArtifactDigest } = require('./provider-native-adapter');
const { readBinding } = require('./delegated-codex-runtime');
const { validateRestrictedComposition } = require('../../../packages/runtime-providers/codex-acp-composition');
const { runCampaignProcess } = require('./provider-campaign-process');
const files = [
  __filename,
  require.resolve('./provider-acp-worker'),
  require.resolve('../../../packages/runtime-providers/codex-acp-peer'),
  require.resolve('../../../packages/runtime-providers/codex-acp-composition'),
  require.resolve('../../../packages/runtime-providers/codex-acp-launcher'),
  require.resolve('../../../packages/runtime-providers/codex-acp-profile.json'),
  require.resolve('../../../packages/runtime-providers/acp-runtime-provider'),
  require.resolve('../../../packages/runtime-providers/process-acp-peer'),
];
function acpArtifactDigest() {
  return engineeringDigest({
    native: nativeArtifactDigest(),
    files: files.map((f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')),
  });
}
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function normalizeAcpUsage(usage) {
  const integer = z.number().int().nonnegative().safe();
  const input = integer.parse(
    integer.parse(usage?.inputTokens) + integer.parse(usage?.cachedReadTokens ?? 0) + integer.parse(usage?.cachedWriteTokens ?? 0),
  );
  const output = integer.parse(usage?.outputTokens);
  if (integer.parse(usage?.totalTokens) !== input + output || integer.parse(usage?.thoughtTokens ?? 0) > output)
    fail('CONTROL_OUTCOME_UNCERTAIN');
  return { input_tokens: input, output_tokens: output };
}
function createAcpCampaignAdapter({ manifest, binding, options }, { processRunner = runCampaignProcess } = {}) {
  const settings = z
    .object({ native_binding: z.string().refine(path.isAbsolute), native_options: z.record(z.string(), z.unknown()) })
    .strict()
    .parse(options);
  const composition = JSON.parse(fs.readFileSync(binding, 'utf8'));
  const attestation = validateRestrictedComposition(composition);
  const nativeBinding = readBinding(settings.native_binding);
  const digest = engineeringDigest({ composition, nativeBinding, options: settings });
  const artifact = acpArtifactDigest();
  if (
    manifest.adapter !== 'hseos-codex-acp-campaign-v1' ||
    manifest.vendor !== 'codex' ||
    manifest.provider_kind !== 'client' ||
    manifest.route !== 'account' ||
    manifest.billing.max_request_microusd !== 0 ||
    manifest.binding_sha256 !== digest ||
    manifest.artifact_sha256 !== artifact ||
    settings.native_options.model !== composition.model ||
    manifest.limits.max_output_tokens > 256 ||
    manifest.authentication.credential?.source_ref !== `file://${composition.auth_source}`
  )
    fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  const native = createNativeCampaignAdapter(
    {
      manifest: {
        ...manifest,
        adapter: 'hseos-codex-campaign-v1',
        binding_sha256: engineeringDigest({ binding: nativeBinding, options: settings.native_options }),
        artifact_sha256: nativeArtifactDigest(),
      },
      binding: settings.native_binding,
      options: settings.native_options,
    },
    { processRunner },
  );
  function verify() {
    if (
      acpArtifactDigest() !== artifact ||
      validateRestrictedComposition(JSON.parse(fs.readFileSync(binding, 'utf8'))).evidence_ref !== attestation.evidence_ref
    )
      fail('CONTROL_PROVIDER_BINDING_DRIFT');
  }
  async function inspect(args) {
    verify();
    const value = await native.adapter.inspect(args);
    return { ...value, binding_sha256: digest, artifact_sha256: artifact };
  }
  return {
    binding_sha256: digest,
    adapter: {
      inspect,
      async run({ task_id, signal, resume_session_id }) {
        verify();
        const task = settings.native_options.tasks[task_id];
        if (!task || Buffer.byteLength(task.prompt) > manifest.limits.max_input_tokens || /^\s*[/$]/u.test(task.prompt))
          fail('CONTROL_CAMPAIGN_SCOPE_DENIED');
        const inspection = await inspect({ signal });
        if (
          inspection.account_sha256 !== manifest.authentication.account_sha256 ||
          inspection.quota_windows.some((w) => w.used_percent >= 100)
        )
          fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
        const result = await processRunner({
          args: [path.join(__dirname, 'provider-acp-worker.js')],
          input: {
            composition_path: binding,
            inspection,
            account_sha256: manifest.authentication.account_sha256,
            prompt: task.prompt,
            resume_session_id,
            max_tokens: manifest.limits.max_input_tokens + manifest.limits.max_output_tokens,
            timeout_ms: manifest.limits.max_duration_ms,
          },
          signal,
          timeout_ms: manifest.limits.max_duration_ms,
          memory_max_bytes: settings.native_options.memory_max_bytes,
          pids_max: settings.native_options.pids_max,
        });
        if (!result.completed || result.cancelled || result.effect_boundary_ref !== attestation.evidence_ref)
          fail('CONTROL_OUTCOME_UNCERTAIN');
        const integer = z.number().int().nonnegative().safe();
        return {
          status: 'completed',
          binding_sha256: digest,
          evidence_sha256: engineeringDigest(result),
          cost_microusd: null,
          ...normalizeAcpUsage(result.usage),
          provider_session_id: z
            .string()
            .min(1)
            .max(1024)
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
            .parse(result.provider_session_id),
        };
      },
    },
  };
}
module.exports = { createAcpCampaignAdapter, acpArtifactDigest, normalizeAcpUsage };
