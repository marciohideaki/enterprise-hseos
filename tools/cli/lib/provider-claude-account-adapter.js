'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const yaml = require('yaml');
const { z } = require('zod');
const { engineeringDigest } = require('./engineering-task-state');
const { runCampaignProcess } = require('./provider-campaign-process');

const PROFILE_ID = 'agent-claude-cli-account-candidate';
const PROVIDER_ID = 'runtime:claude-cli';
const WORKER = path.join(__dirname, 'provider-claude-account-worker.js');
const integer = z.number().int().nonnegative().safe();
// The environment is an allowlist: API keys, auth tokens, helpers and cloud switches would outrank the login.
const settingsSchema = z
  .object({
    pids_max: integer.min(32).max(256).optional(),
    model: z.string().min(1).max(256),
    memory_max_bytes: integer.min(268_435_456).max(2_147_483_648).optional(),
    persist_sessions: z.boolean().optional(),
    tasks: z.record(z.string().uuid(), z.object({ prompt: z.string().min(1).max(16_384) }).strict()),
    environment: z.object({ HOME: z.string().min(1), PATH: z.string().min(1), CLAUDE_CONFIG_DIR: z.string().min(1).optional() }).strict(),
  })
  .strict();
const refusals = new Set(['CONTROL_PROVIDER_IDENTITY_UNVERIFIED', 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE']);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

const hashes = new Map();
/** Streams the client binary (hundreds of MB) and reuses the digest while file identity is unchanged. */
function sha256(filename) {
  const stat = fs.statSync(filename);
  const key = `${filename}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (!hashes.has(key)) {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1_048_576);
    const descriptor = fs.openSync(filename, 'r');
    try {
      for (
        let read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        read > 0;
        read = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      )
        hash.update(buffer.subarray(0, read));
    } finally {
      fs.closeSync(descriptor);
    }
    hashes.clear();
    hashes.set(key, hash.digest('hex'));
  }
  return hashes.get(key);
}

function readBinding(filename) {
  try {
    return parseBinding(filename);
  } catch {
    return fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  }
}

function parseBinding(filename) {
  const resolved = path.resolve(filename);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  const value = yaml.parse(fs.readFileSync(resolved, 'utf8'));
  const keys = ['schema_version', 'profile_id', 'runtime_provider_id', 'executable', 'cwd', 'env_names', 'secret_refs'];
  if (
    !value ||
    typeof value !== 'object' ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort()) ||
    value.schema_version !== 1 ||
    value.profile_id !== PROFILE_ID ||
    value.runtime_provider_id !== PROVIDER_ID ||
    !path.isAbsolute(value.executable) ||
    !path.isAbsolute(value.cwd) ||
    value.env_names.length > 0 ||
    value.secret_refs.length > 0
  )
    fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  const executable = fs.realpathSync(value.executable);
  fs.accessSync(executable, fs.constants.X_OK);
  const cwd = fs.realpathSync(value.cwd);
  if (!fs.statSync(cwd).isDirectory()) fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  return Object.freeze({
    schema_version: 1,
    profile_id: PROFILE_ID,
    runtime_provider_id: PROVIDER_ID,
    executable,
    executable_sha256: sha256(executable),
    cwd,
    env_names: [],
    secret_refs: [],
  });
}

/** Claude by subscription: the owner's own unmodified `claude` binary, headless, under the owner's own login. */
function createClaudeAccountCampaignAdapter(
  { manifest, binding: filename, options },
  { processRunner = runCampaignProcess } = {},
  { loadedArtifact, artifactDigest },
) {
  const settings = settingsSchema.parse(options);
  const binding = readBinding(filename);
  const digest = engineeringDigest({ binding, options: settings });
  const configDirectory = settings.environment.CLAUDE_CONFIG_DIR || `${settings.environment.HOME}/.claude`;
  if (
    manifest.adapter !== 'hseos-claude-campaign-v1' ||
    manifest.provider_kind !== 'client' ||
    manifest.route !== 'account' ||
    manifest.binding_sha256 !== digest ||
    manifest.artifact_sha256 !== loadedArtifact ||
    manifest.limits.max_duration_ms > 300_000 ||
    manifest.authentication.source !== 'explicit' ||
    manifest.authentication.identity_kind === 'credential' ||
    manifest.billing.max_request_microusd !== 0 ||
    // The reference names the login directory only; credential files are never opened by this adapter.
    manifest.authentication.credential?.source_ref !== `file://${configDirectory}`
  )
    fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  function verify() {
    let current;
    try {
      current = readBinding(filename);
    } catch {
      // A missing or replaced client binary is drift, not an opportunity to fall back to another one.
      fail('CONTROL_PROVIDER_BINDING_DRIFT');
    }
    if (artifactDigest() !== loadedArtifact || engineeringDigest({ binding: current, options: settings }) !== digest)
      fail('CONTROL_PROVIDER_BINDING_DRIFT');
    return { ...settings.environment, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(manifest.limits.max_output_tokens) };
  }
  const profile = () => ({ memory_max_bytes: settings.memory_max_bytes, pids_max: settings.pids_max });
  return {
    binding_sha256: digest,
    adapter: {
      async inspect({ signal = new AbortController().signal } = {}) {
        const environment = verify();
        const report = await processRunner({
          args: [WORKER],
          input: {
            operation: 'inspect',
            binding: { executable: binding.executable, cwd: binding.cwd },
            environment,
            expected_version: manifest.provider_version,
          },
          signal,
          timeout_ms: 20_000,
          ...profile(),
        });
        if (refusals.has(report.refusal)) fail(report.refusal);
        if (report.refusal || report.version !== manifest.provider_version || !/^[a-f0-9]{64}$/.test(report.account_sha256 ?? ''))
          fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED');
        return {
          binding_sha256: digest,
          artifact_sha256: loadedArtifact,
          provider_version: manifest.provider_version,
          account_sha256: report.account_sha256,
          authenticated: true,
          auth_source: 'explicit',
          observed_at: Date.now(),
          expires_at: Date.now() + 30_000,
          // The CLI exposes no quota windows; admission then depends on an owner quota exception.
          quota_remaining_requests: null,
          competing_credentials: false,
        };
      },
      async run({ task_id, signal, resume_session_id }) {
        const environment = verify();
        const task = settings.tasks[task_id];
        if (!task || Buffer.byteLength(task.prompt) > manifest.limits.max_input_tokens) fail('CONTROL_CAMPAIGN_SCOPE_DENIED');
        if (resume_session_id && settings.persist_sessions !== true) fail('CONTROL_PROVIDER_RESUME_UNAVAILABLE');
        const result = await processRunner({
          args: [WORKER],
          input: {
            operation: 'run',
            binding: { executable: binding.executable, cwd: binding.cwd },
            environment,
            model: settings.model,
            prompt: task.prompt,
            expected_version: manifest.provider_version,
            expected_account_sha256: manifest.authentication.account_sha256,
            persist: settings.persist_sessions === true,
            timeout_ms: Math.floor(manifest.limits.max_duration_ms * 0.9),
            ...(resume_session_id ? { resume_session_id } : {}),
          },
          signal,
          timeout_ms: manifest.limits.max_duration_ms,
          ...profile(),
        });
        if (refusals.has(result.refusal)) fail(result.refusal);
        const usage = result.usage?.usage;
        const input =
          integer.parse(usage?.input_tokens) +
          integer.parse(usage?.cache_read_input_tokens ?? 0) +
          integer.parse(usage?.cache_creation_input_tokens ?? 0);
        const output = integer.parse(usage?.output_tokens);
        if (output > manifest.limits.max_output_tokens) fail('CONTROL_CAMPAIGN_BUDGET_EXHAUSTED');
        return {
          status: 'completed',
          binding_sha256: digest,
          evidence_sha256: engineeringDigest(result),
          // total_cost_usd is an estimate under a subscription; no monetary quantity is ever reported.
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
module.exports = { createClaudeAccountCampaignAdapter, readBinding, PROFILE_ID, PROVIDER_ID };
