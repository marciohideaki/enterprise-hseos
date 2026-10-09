'use strict';
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const { engineeringDigest } = require('./engineering-task-state');
const { credentialFingerprint } = require('./provider-api-adapter');
const { runCampaignProcess } = require('./provider-campaign-process');
const { createClaudeAccountCampaignAdapter } = require('./provider-claude-account-adapter');
const readers = { codex: require('./delegated-codex-runtime').readBinding, claude: require('./delegated-claude-runtime').readBinding };
const integer = z.number().int().nonnegative().safe();
const settingsSchema = z
  .object({
    pids_max: integer.min(32).max(256).optional(),
    model: z.string().min(1).max(256),
    memory_max_bytes: integer.min(268_435_456).max(2_147_483_648).optional(),
    tasks: z.record(z.string().uuid(), z.object({ prompt: z.string().min(1).max(16_384) }).strict()),
    environment: z.object({ HOME: z.string().min(1), PATH: z.string().min(1), CODEX_HOME: z.string().min(1).optional() }).strict(),
  })
  .strict();
const files = [
  __filename,
  require.resolve('./provider-campaign-worker'),
  require.resolve('./provider-campaign-process'),
  require.resolve('../../../packages/agent-isolation-attestation/executor'),
  require.resolve('../../../packages/runtime-providers/codex-app-server-driver'),
  require.resolve('../../../packages/runtime-providers/claude-agent-sdk-driver'),
  require.resolve('./provider-claude-account-adapter'),
  require.resolve('./provider-claude-account-worker'),
  require.resolve('../../../packages/runtime-providers/claude-cli-driver'),
];
function nativeArtifactDigest() {
  return engineeringDigest(files.map((file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')));
}
const loadedArtifact = nativeArtifactDigest();
function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Official native surfaces under explicit client authority; remote quota remains mandatory. */
function createNativeCampaignAdapter(
  { manifest, binding: filename, options },
  { environment = process.env, fetchImpl = globalThis.fetch, processRunner = runCampaignProcess } = {},
) {
  const vendor = manifest.vendor;
  if (!Object.hasOwn(readers, vendor)) fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  if (vendor === 'claude' && manifest.route === 'account')
    return createClaudeAccountCampaignAdapter(
      { manifest, binding: filename, options },
      { processRunner },
      {
        loadedArtifact,
        artifactDigest: nativeArtifactDigest,
      },
    );
  const settings = settingsSchema.parse(options);
  const binding = readers[vendor](filename);
  const digest = engineeringDigest({ binding, options: settings });
  if (
    manifest.adapter !== `hseos-${vendor}-campaign-v1` ||
    manifest.provider_kind !== 'client' ||
    manifest.binding_sha256 !== digest ||
    manifest.artifact_sha256 !== loadedArtifact ||
    manifest.limits.max_duration_ms > 300_000 ||
    manifest.authentication.source !== 'explicit' ||
    (vendor === 'codex' ? manifest.route !== 'account' : manifest.route !== 'api')
  )
    fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  function verify() {
    if (
      nativeArtifactDigest() !== loadedArtifact ||
      engineeringDigest({ binding: readers[vendor](filename), options: settings }) !== digest
    )
      fail('CONTROL_PROVIDER_BINDING_DRIFT');
    const selected = { ...settings.environment };
    if (vendor === 'codex') {
      if (!selected.CODEX_HOME || manifest.authentication.credential?.source_ref !== `file://${selected.CODEX_HOME}/auth.json`)
        fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
    } else {
      const ref = manifest.authentication.credential?.source_ref || '';
      if (!/^env:\/\/[A-Z_][A-Z0-9_]*$/.test(ref) || manifest.authentication.identity_kind !== 'credential')
        fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
      const key = environment[ref.slice(6)];
      if (typeof key !== 'string' || credentialFingerprint(key) !== manifest.authentication.credential_sha256)
        fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
      selected.ANTHROPIC_API_KEY = key;
      selected.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(manifest.limits.max_output_tokens);
      // Pin the optional SDK package version without importing it during configuration.
      const version = JSON.parse(
        fs.readFileSync(require('node:path').join(require('node:path').dirname(binding.sdk_module), 'package.json'), 'utf8'),
      ).version;
      if (version !== manifest.provider_version) fail('CONTROL_PROVIDER_BINDING_DRIFT');
    }
    return selected;
  }
  return {
    binding_sha256: digest,
    adapter: {
      async inspect({ signal = new AbortController().signal } = {}) {
        const selected = verify();
        const base = {
          binding_sha256: digest,
          artifact_sha256: loadedArtifact,
          provider_version: manifest.provider_version,
          account_sha256: null,
          authenticated: true,
          auth_source: 'explicit',
          observed_at: Date.now(),
          expires_at: Date.now() + 30_000,
          quota_remaining_requests: null,
          competing_credentials: false,
        };
        if (vendor === 'codex') {
          const report = await processRunner({
            input: { vendor, operation: 'inspect', binding, environment: selected },
            signal,
            timeout_ms: 10_000,
            memory_max_bytes: settings.memory_max_bytes,
            pids_max: settings.pids_max,
          });
          if (
            report.version !== `codex-cli ${manifest.provider_version}` ||
            report.identity?.account?.type !== 'chatgpt' ||
            typeof report.identity.account.email !== 'string'
          )
            fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
          const bucket = report.quota?.rateLimitsByLimitId?.codex || report.quota?.rateLimits;
          // Unknown paid-credit eligibility must not become a zero-cost subscription claim.
          if (
            bucket?.limitId !== 'codex' ||
            bucket.rateLimitReachedType ||
            bucket.credits?.hasCredits !== false ||
            bucket.credits?.unlimited !== false
          )
            fail('CONTROL_PROVIDER_QUOTA_UNAVAILABLE');
          const windows = [bucket.primary, bucket.secondary].filter((v) => v !== null && v !== undefined);
          if (windows.length === 0) fail('CONTROL_PROVIDER_QUOTA_UNAVAILABLE');
          return {
            ...base,
            account_sha256: engineeringDigest({ type: 'chatgpt', email: report.identity.account.email }),
            quota_windows: windows.map((v) => ({
              used_percent: z.number().min(0).max(100).parse(v.usedPercent),
              resets_at: integer.parse(v.resetsAt) * 1000,
            })),
          };
        }
        const response = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', {
          method: 'GET',
          redirect: 'error',
          headers: { 'x-api-key': selected.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        await response.body?.cancel();
        if (response.status !== 200) fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
        // Listing models authenticates the selected key, not the inference quota bucket.
        return { ...base, credential_sha256: credentialFingerprint(selected.ANTHROPIC_API_KEY) };
      },
      async run({ task_id, signal, resume_session_id }) {
        const selected = verify();
        const task = settings.tasks[task_id];
        if (!task || Buffer.byteLength(task.prompt) > manifest.limits.max_input_tokens) fail('CONTROL_CAMPAIGN_SCOPE_DENIED');
        const result = await processRunner({
          input: {
            vendor,
            operation: 'run',
            binding,
            environment: selected,
            model: settings.model,
            prompt: task.prompt,
            budget_microusd: manifest.billing.max_request_microusd,
            ...(resume_session_id ? { resume_session_id } : {}),
          },
          signal,
          timeout_ms: manifest.limits.max_duration_ms,
          memory_max_bytes: settings.memory_max_bytes,
          pids_max: settings.pids_max,
        });
        const usage = vendor === 'codex' ? result.usage?.last : result.usage?.usage;
        const input = integer.parse(
          vendor === 'codex'
            ? usage?.inputTokens
            : integer.parse(usage?.input_tokens) +
                integer.parse(usage?.cache_read_input_tokens ?? 0) +
                integer.parse(usage?.cache_creation_input_tokens ?? 0),
        );
        const output = integer.parse(vendor === 'codex' ? usage?.outputTokens : usage?.output_tokens);
        return {
          status: 'completed',
          binding_sha256: digest,
          evidence_sha256: engineeringDigest(result),
          cost_microusd: null,
          input_tokens: input,
          output_tokens: output,
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
module.exports = { createNativeCampaignAdapter, nativeArtifactDigest };
