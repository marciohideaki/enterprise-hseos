'use strict';

const { z, IdentifierSchema, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { ConservativeUtf8TokenCounter } = require('../../../packages/agent-context');
const { canonicalize } = require('../../../packages/managed-governance-contracts/canonical-json');
const { assertExecutionPluginAdmission, ExecutionPluginError } = require('../../lib/execution-plugin-manifest');
const { parseProviderControlManifest } = require('../../lib/provider-control-manifest');
const { engineeringDigest } = require('./engineering-task-state');
const { ProviderCampaignControl } = require('./provider-campaign-control');
const { executeExecutionPlugin } = require('./execution-plugin-runtime');

const requestSchema = z.object({ request_id: z.string().uuid(), method: IdentifierSchema, input: z.json() }).strict();
const counter = new ConservativeUtf8TokenCounter();
function reject(code) {
  throw new ExecutionPluginError(code);
}

/** Local isolated effects are dispatched only after the existing campaign reserves them. */
function createExecutionPluginCampaignBinding({ admission, binding_id, limits, output_schema, response_validation }) {
  assertExecutionPluginAdmission(admission);
  const plugin = admission.manifest;
  if (!['model-provider', 'runtime-provider'].includes(plugin.kind)) reject('PLUGIN_PORT_KIND');
  if (typeof output_schema?.safeParse !== 'function') reject('PLUGIN_OUTPUT_SCHEMA_REQUIRED');
  const validateOutput = output_schema.safeParse.bind(output_schema);
  let validateResponse = null;
  if (response_validation !== undefined) {
    IdentifierSchema.parse(response_validation?.contract_id);
    if (typeof response_validation.validate !== 'function') reject('PLUGIN_OUTPUT_SCHEMA_REQUIRED');
    validateResponse = response_validation.validate.bind(response_validation);
  }
  // eslint-disable-next-line unicorn/prefer-structured-clone -- Persist only the public JSON schema, not Zod helper functions.
  const outputContract = JSON.parse(JSON.stringify(z.toJSONSchema(output_schema)));
  const selected = { id: plugin.id, version: plugin.version, manifest_sha256: admission.manifest_sha256 };
  const manifest = parseProviderControlManifest({
    schema_version: 2,
    binding_id,
    binding_sha256: engineeringDigest({
      selected,
      binding_id,
      limits,
      output_contract: outputContract,
      ...(response_validation ? { response_contract: response_validation.contract_id } : {}),
    }),
    vendor: 'execution-plugin',
    execution_plugin: selected,
    provider_kind: plugin.kind === 'model-provider' ? 'model' : 'runtime',
    provider_version: plugin.version,
    adapter: 'execution-plugin-v1',
    artifact_sha256: admission.manifest_sha256,
    route: 'local',
    transport: 'process',
    authentication: {
      mode: 'local',
      credential: null,
      account_sha256: null,
      identity_kind: 'local_profile',
      profile_sha256: admission.manifest_sha256,
      source: 'admitted-plugin',
    },
    billing: { kind: 'local', currency: 'USD', max_request_microusd: 0 },
    limits,
    controls: {
      authority: plugin.kind === 'model-provider' ? 'kernel' : 'delegated_l0',
      resume: 'unavailable',
      cancel: 'not_verified',
      quota: 'not_applicable',
      evidence_sha256: null,
    },
  });
  if (manifest.limits.max_duration_ms > plugin.limits.timeout_ms) reject('PLUGIN_PORT_LIMIT');
  const pending = new Map();
  let attached = null;
  let closed = false;
  let uncertain = false;
  const adapter = Object.freeze({
    async inspect() {
      assertExecutionPluginAdmission(admission);
      return {
        binding_sha256: manifest.binding_sha256,
        artifact_sha256: manifest.artifact_sha256,
        provider_version: manifest.provider_version,
        account_sha256: null,
        profile_sha256: admission.manifest_sha256,
        authenticated: true,
        auth_source: 'admitted-plugin',
        observed_at: Date.now(),
        expires_at: null,
        quota_remaining_requests: null,
        competing_credentials: false,
      };
    },
    async run({ task_id, request_id, signal }) {
      const entry = pending.get(request_id);
      if (!attached || !entry || entry.started || task_id !== attached.task_id) reject('PLUGIN_CAMPAIGN_RESERVATION_REQUIRED');
      const reservation = attached.campaign
        .rows(attached.campaign_id)
        .find((row) => row.payload.kind === 'reserved' && row.payload.command_id === request_id)?.payload;
      if (!reservation || reservation.binding_id !== binding_id || reservation.task_id !== task_id)
        reject('PLUGIN_CAMPAIGN_RESERVATION_REQUIRED');
      entry.started = true;
      if (![...(attached.campaign.active.get(attached.campaign_id) || [])].some((controller) => controller.signal === signal))
        reject('PLUGIN_CAMPAIGN_RESERVATION_REQUIRED');
      const combined = AbortSignal.any([signal, entry.controller.signal]);
      let response;
      try {
        response = await executeExecutionPlugin({
          admission,
          request: entry.request,
          signal: combined,
          deadline_at: Math.min(attached.campaign.query(attached.campaign_id).deadline, Date.now() + manifest.limits.max_duration_ms),
        });
      } catch (error) {
        if (error.code !== 'PLUGIN_CANCELLED') throw error;
        return {
          status: 'cancelled',
          binding_sha256: manifest.binding_sha256,
          evidence_sha256: engineeringDigest({ request_id, status: 'cancelled', descendants_terminated: true }),
          cost_microusd: 0,
          input_tokens: entry.inputTokens,
          output_tokens: 0,
        };
      }
      const parsed = validateOutput(response.result);
      if (!parsed?.success) reject('PLUGIN_PROVIDER_OUTPUT_INVALID');
      // Validate without coercion: the recorded result must be exactly the attested bytes.
      if (canonicalize(parsed.data) !== canonicalize(response.result)) reject('PLUGIN_PROVIDER_OUTPUT_INVALID');
      const outputTokens = counter.count(canonicalize(response.result));
      if (outputTokens > manifest.limits.max_output_tokens) reject('PLUGIN_PROVIDER_OUTPUT_LIMIT');
      if (validateResponse && validateResponse(entry.request, response.result) !== true) reject('PLUGIN_PROVIDER_OUTPUT_INVALID');
      const evidence = engineeringDigest(response);
      attached.campaign.append(attached.campaign_id, {
        kind: 'plugin_result',
        command_id: request_id,
        request_sha256: entry.digest,
        manifest_sha256: admission.manifest_sha256,
        response,
        evidence_sha256: evidence,
      });
      return {
        status: 'completed',
        binding_sha256: manifest.binding_sha256,
        evidence_sha256: evidence,
        cost_microusd: 0,
        input_tokens: entry.inputTokens,
        output_tokens: outputTokens,
      };
    },
  });
  const binding = Object.freeze({ manifest, binding_sha256: manifest.binding_sha256, adapter });
  return Object.freeze({
    binding,
    attach({ campaign, campaign_id, task_id }) {
      z.string().uuid().parse(campaign_id);
      z.string().uuid().parse(task_id);
      if (attached || !(campaign instanceof ProviderCampaignControl) || campaign.bindings.get(binding_id)?.adapter !== adapter)
        reject('PLUGIN_CAMPAIGN_BINDING_REQUIRED');
      // Reading the campaign also proves that creation and authorization have happened.
      campaign.query(campaign_id);
      const opened = campaign.rows(campaign_id).find((row) => row.payload.kind === 'opened').payload;
      if (!opened.task_ids.includes(task_id) || opened.binding_manifests[binding_id] !== engineeringDigest(manifest))
        reject('PLUGIN_CAMPAIGN_BINDING_REQUIRED');
      attached = Object.freeze({ campaign, campaign_id, task_id });
    },
    async execute(raw, { signal } = {}) {
      if (closed || !attached) reject('PLUGIN_CAMPAIGN_BINDING_REQUIRED');
      if (signal !== undefined && !(signal instanceof AbortSignal)) reject('PLUGIN_REQUEST_INVALID');
      if (signal?.aborted) reject('PLUGIN_CANCELLED');
      const request = requestSchema.parse(raw);
      if (!plugin.capabilities.includes(request.method)) reject('PLUGIN_PORT_AUTHORITY');
      const digest = engineeringDigest(request);
      const inputTokens = counter.count(canonicalize(request));
      if (inputTokens > manifest.limits.max_input_tokens) reject('PLUGIN_PROVIDER_INPUT_LIMIT');
      const { campaign, campaign_id, task_id } = attached;
      // This fact has no execution effect. It binds campaign command identity to the payload.
      const dispatchSequence = campaign.control.handle.db
        .transaction(() => {
          const prior = campaign
            .rows(campaign_id)
            .find((row) => row.payload.kind === 'plugin_request' && row.payload.command_id === request.request_id)?.payload;
          if (prior && (prior.request_sha256 !== digest || prior.binding_id !== binding_id || prior.task_id !== task_id))
            reject('PLUGIN_REQUEST_CONFLICT');
          if (prior) return prior.dispatch_sequence;
          const dispatchSequence = campaign.rows(campaign_id).length + 1;
          campaign.append(campaign_id, {
            kind: 'plugin_request',
            command_id: request.request_id,
            request_sha256: digest,
            binding_id,
            task_id,
            dispatch_sequence: dispatchSequence,
          });
          return dispatchSequence;
        })
        .immediate();
      const completed = campaign
        .rows(campaign_id)
        .find((row) => row.payload.kind === 'done' && row.payload.command_id === request.request_id)?.payload;
      if (completed) return recover(completed.result, request.request_id, digest);
      if (pending.has(request.request_id)) reject('PLUGIN_REQUEST_ACTIVE');
      const controller = new AbortController();
      const relay = () => controller.abort();
      signal?.addEventListener('abort', relay, { once: true });
      if (signal?.aborted) controller.abort();
      const entry = { request, digest, inputTokens, controller, started: false, promise: null };
      pending.set(request.request_id, entry);
      entry.promise = campaign.execute({
        schema_version: 1,
        command_id: request.request_id,
        resource_id: campaign_id,
        expected_sequence: dispatchSequence,
        action: 'run',
        input: { binding_id, task_id },
      });
      try {
        return recover(await entry.promise, request.request_id, digest);
      } catch (error) {
        if (error.code === 'CONTROL_OUTCOME_UNCERTAIN' || error.code === 'PLUGIN_RESULT_UNCERTAIN') uncertain = true;
        throw error;
      } finally {
        signal?.removeEventListener('abort', relay);
        pending.delete(request.request_id);
      }
    },
    async close() {
      closed = true;
      for (const entry of pending.values()) entry.controller.abort();
      await Promise.allSettled([...pending.values()].map((entry) => entry.promise));
      if (uncertain) reject('PLUGIN_RESULT_UNCERTAIN');
    },
  });

  function recover(result, requestId, digest) {
    if (result.receipt?.status === 'cancelled') reject('PLUGIN_CANCELLED');
    const record = attached.campaign
      .rows(attached.campaign_id)
      .find((row) => row.payload.kind === 'plugin_result' && row.payload.command_id === requestId)?.payload;
    if (
      !record ||
      result.receipt?.status !== 'completed' ||
      record.request_sha256 !== digest ||
      record.manifest_sha256 !== admission.manifest_sha256 ||
      engineeringDigest(record.response) !== result.receipt.evidence_sha256
    )
      reject('PLUGIN_RESULT_UNCERTAIN');
    return deepFreeze(record.response);
  }
}

module.exports = { createExecutionPluginCampaignBinding };
