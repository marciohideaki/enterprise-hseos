'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const { engineeringDigest } = require('./engineering-task-state');
const { startCampaignModelBridge } = require('./provider-campaign-bridge');
const { runCampaignProcess } = require('./provider-campaign-process');
const absolute = z.string().refine((v) => path.isAbsolute(v));
const schema = z
  .object({
    python: absolute,
    checkpoint: absolute,
    sdk_module: absolute,
    scratch: absolute,
    subordinate_binding_id: z.string().min(1).max(160),
    max_model_calls: z.number().int().min(1).max(4),
    pids_max: z.number().int().min(32).max(256).optional(),
    memory_max_bytes: z.number().int().min(268_435_456).max(2_147_483_648).optional(),
    tasks: z.record(z.string().uuid(), z.object({ prompt: z.string().min(1).max(16_384) }).strict()),
  })
  .strict();
function fileDigest(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('invalid file');
    const hash = createHash('sha256'),
      buffer = Buffer.alloc(65_536);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}
const worker = path.resolve(__dirname, '../../../packages/control-sdk/antigravity_campaign_worker.py');
function antigravityArtifactDigest() {
  return engineeringDigest(
    [
      __filename,
      worker,
      path.join(path.dirname(worker), 'antigravity_client.py'),
      path.join(path.dirname(worker), 'antigravity_litert.py'),
      require.resolve('./provider-campaign-bridge'),
      require.resolve('./provider-campaign-process'),
    ].map(fileDigest),
  );
}
const loadedArtifact = antigravityArtifactDigest();
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
/** Official LiteRT SDK client: local checkpoint, no unmetered remote model endpoint. */
function createAntigravityCampaignAdapter({ manifest, binding: filename, options }, { processRunner = runCampaignProcess } = {}) {
  if (Object.keys(options).length > 0) fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  const read = () => {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65_536) fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
    const config = schema.parse(JSON.parse(fs.readFileSync(filename, 'utf8')));
    fs.accessSync(config.python, fs.constants.X_OK);
    if (
      fs.realpathSync(config.scratch) !== config.scratch ||
      !fs.statSync(config.scratch).isDirectory() ||
      !config.checkpoint.endsWith('.litertlm')
    )
      fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
    return { config, artifacts: [config.python, config.checkpoint, config.sdk_module].map((file) => fileDigest(fs.realpathSync(file))) };
  };
  const selected = read(),
    digest = engineeringDigest(selected);
  const profile = engineeringDigest(selected.artifacts);
  if (
    manifest.vendor !== 'antigravity' ||
    manifest.route !== 'local' ||
    manifest.provider_kind !== 'client' ||
    manifest.adapter !== 'hseos-antigravity-campaign-v1' ||
    manifest.binding_sha256 !== digest ||
    manifest.artifact_sha256 !== loadedArtifact ||
    manifest.authentication.identity_kind !== 'local_profile' ||
    manifest.authentication.profile_sha256 !== profile ||
    manifest.authentication.source !== 'explicit' ||
    manifest.limits.max_duration_ms > 300_000
  )
    fail('CONTROL_PROVIDER_CONFIGURATION_INVALID');
  function verify() {
    if (antigravityArtifactDigest() !== loadedArtifact || engineeringDigest(read()) !== digest) fail('CONTROL_PROVIDER_BINDING_DRIFT');
  }
  const processInput = { sdk_version: manifest.provider_version, ...selected.config };
  const execute = (input, signal, timeout_ms) =>
    processRunner({
      binary: selected.config.python,
      args: ['-I', '-B', worker],
      input: { ...processInput, ...input },
      signal,
      timeout_ms,
      memory_max_bytes: selected.config.memory_max_bytes,
      pids_max: selected.config.pids_max,
    });
  return {
    binding_sha256: digest,
    adapter: {
      async inspect({ signal = new AbortController().signal } = {}) {
        verify();
        const observed = await execute({ operation: 'inspect' }, signal, 10_000);
        if (observed.sdk_version !== manifest.provider_version) fail('CONTROL_PROVIDER_BINDING_DRIFT');
        return {
          binding_sha256: digest,
          artifact_sha256: loadedArtifact,
          provider_version: manifest.provider_version,
          account_sha256: null,
          profile_sha256: profile,
          authenticated: true,
          auth_source: 'explicit',
          competing_credentials: false,
          observed_at: Date.now(),
          expires_at: null,
          quota_remaining_requests: null,
        };
      },
      async run({ task_id, signal, runSubordinate, resume_session_id }) {
        verify();
        const task = selected.config.tasks[task_id];
        if (!task) fail('CONTROL_CAMPAIGN_SCOPE_DENIED');
        const bridge = await startCampaignModelBridge({ binding_id: selected.config.subordinate_binding_id, runSubordinate, signal });
        try {
          const result = await execute(
            {
              operation: 'run',
              ...(resume_session_id ? { resume_session_id } : {}),
              task_id,
              prompt: task.prompt,
              bridge: { url: bridge.url, credential: bridge.credential },
              timeout_seconds: Math.max(1, Math.floor(manifest.limits.max_duration_ms / 1000)),
              max_input_tokens: manifest.limits.max_input_tokens,
              max_output_tokens: manifest.limits.max_output_tokens,
            },
            signal,
            manifest.limits.max_duration_ms,
          );
          if (!bridge.report().completed) fail('CONTROL_OUTCOME_UNCERTAIN');
          const integer = z.number().int().nonnegative().safe();
          const input = integer.parse(result.usage?.prompt_token_count);
          const output = integer.parse(result.usage?.candidates_token_count) + integer.parse(result.usage?.thoughts_token_count ?? 0);
          return {
            status: 'completed',
            binding_sha256: digest,
            evidence_sha256: engineeringDigest(result),
            cost_microusd: 0,
            input_tokens: input,
            output_tokens: output,
            provider_session_id: z
              .string()
              .min(32)
              .max(1024)
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
              .parse(result.provider_session_id),
          };
        } finally {
          await bridge.close();
        }
      },
    },
  };
}
module.exports = { createAntigravityCampaignAdapter, antigravityArtifactDigest };
