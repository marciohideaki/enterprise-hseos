'use strict';

const { z, AgentToolCallSchema } = require('../../../packages/agent-runtime-contracts');
const { ConservativeUtf8TokenCounter } = require('../../../packages/agent-context');
const { canonicalize } = require('../../../packages/managed-governance-contracts/canonical-json');
const { deterministicOperationId } = require('../../../packages/governed-execution/operation-id');
const { assertExecutionPluginAdmission, ExecutionPluginError } = require('../../lib/execution-plugin-manifest');
const { createExecutionPluginCampaignBinding } = require('./execution-plugin-campaign');
const {
  ModelProviderError,
  ack,
  discovery,
  streamEvent,
  validateInput,
  validateManifest,
  validateStreamRequest,
} = require('../../../packages/model-providers/common');

const outputSchema = z
  .object({ text: z.string().max(65_536), tool_calls: z.array(AgentToolCallSchema).max(128) })
  .strict()
  .refine((value) => new Set(value.tool_calls.map((call) => call.tool_call_id)).size === value.tool_calls.length);
const counter = new ConservativeUtf8TokenCounter();

function createExecutionPluginModel({ admission, binding_id, models, limits }) {
  assertExecutionPluginAdmission(admission);
  const plugin = admission.manifest;
  if (plugin.kind !== 'model-provider' || !plugin.capabilities.includes('generate')) throw new ExecutionPluginError('PLUGIN_PORT_KIND');
  const manifest = validateManifest({
    schema_version: 1,
    provider_type: 'model',
    provider_id: `model:plugin-${plugin.id}`,
    provider_version: plugin.version,
    models,
    capabilities: [
      'text_generation',
      'streaming',
      'usage',
      'cancellation',
      ...(plugin.capabilities.includes('tool_calls') ? ['tool_calls'] : []),
    ],
    limits: {
      context_tokens: limits.max_input_tokens + limits.max_output_tokens,
      max_output_tokens: limits.max_output_tokens,
      max_parallel_requests: 1,
    },
    secret_refs: [],
  });
  const bridge = createExecutionPluginCampaignBinding({
    admission,
    binding_id,
    limits,
    output_schema: outputSchema,
    response_validation: {
      contract_id: 'model-response-v1',
      validate(request, result) {
        return (
          counter.count(canonicalize(result)) <= request.input.parameters.max_output_tokens &&
          result.tool_calls.every(
            (call) => manifest.capabilities.includes('tool_calls') && request.input.tools.some((tool) => tool.name === call.name),
          )
        );
      },
    },
  });
  const active = new Map();
  let disposed = false;
  const provider = Object.freeze({
    manifest(input) {
      validateInput(manifest.provider_id, 'manifest', input);
      return manifest;
    },
    discover(input) {
      validateInput(manifest.provider_id, 'discover', input);
      return discovery(manifest);
    },
    stream(raw) {
      const input = validateInput(manifest.provider_id, 'stream', raw);
      if (disposed) throw new ModelProviderError('provider is disposed', 'provider_unavailable');
      if (!manifest.models.includes(input.model)) throw new ModelProviderError('model is not admitted', 'invalid_request');
      validateStreamRequest(manifest, input);
      if (active.size > 0) throw new ModelProviderError('plugin provider is busy', 'rate_limited');
      const entry = { controller: new AbortController(), promise: null };
      active.set(input.request_id, entry);
      const cleanup = () => {
        if (active.get(input.request_id) === entry) active.delete(input.request_id);
      };
      const request = {
        request_id: deterministicOperationId(
          manifest.provider_id,
          canonicalize({ session_id: input.session_id, turn_id: input.turn_id, request_id: input.request_id }),
        ),
        method: 'generate',
        input,
      };
      async function* run() {
        let sequence = 0;
        const event = (type, payload) => streamEvent(manifest.provider_id, input.request_id, sequence++, type, payload);
        try {
          entry.promise = bridge.execute(request, { signal: entry.controller.signal });
          const response = await entry.promise;
          const data = response.result;
          const inputTokens = counter.count(canonicalize(request));
          const outputTokens = counter.count(canonicalize(data));
          yield event('usage', { input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: 0 });
          const definitions = [
            ...(data.text ? [['content.delta', { text: data.text }]] : []),
            ...data.tool_calls.map((call) => [
              'tool_call.delta',
              { tool_call_id: call.tool_call_id, name: call.name, arguments_delta: canonicalize(call.input) },
            ]),
            [
              'completed',
              {
                finish_reason: data.tool_calls.length > 0 ? 'tool_calls' : 'stop',
                provider_response_ref: `plugin-response://${request.request_id}`,
              },
            ],
          ];
          for (const [type, payload] of definitions) {
            if (entry.controller.signal.aborted) {
              yield event('completed', {
                finish_reason: 'cancelled',
                provider_response_ref: `plugin-response://${request.request_id}/cancelled`,
              });
              return;
            }
            yield event(type, payload);
          }
        } catch (error) {
          if (['CONTROL_OUTCOME_UNCERTAIN', 'PLUGIN_RESULT_UNCERTAIN'].includes(error.code))
            throw new ExecutionPluginError('PLUGIN_RESULT_UNCERTAIN');
          if (error.code === 'PLUGIN_CANCELLED') {
            yield event('completed', {
              finish_reason: 'cancelled',
              provider_response_ref: `plugin-response://${request.request_id}/cancelled`,
            });
          } else {
            const code = error.code?.includes('BUDGET') ? 'budget_exceeded' : 'protocol_error';
            yield event('failed', { error_code: code, message: 'plugin model request failed', retryable: false });
          }
        } finally {
          cleanup();
        }
      }
      const iterator = run();
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(value) {
          return iterator.next(value);
        },
        async return() {
          entry.controller.abort();
          await entry.promise?.catch((error) => {
            if (['CONTROL_OUTCOME_UNCERTAIN', 'PLUGIN_RESULT_UNCERTAIN'].includes(error.code))
              throw new ExecutionPluginError('PLUGIN_RESULT_UNCERTAIN');
          });
          try {
            return await iterator.return();
          } finally {
            cleanup();
          }
        },
      };
    },
    async cancel(raw) {
      const input = validateInput(manifest.provider_id, 'cancel', raw);
      const entry = active.get(input.request_id);
      if (entry) {
        entry.controller.abort();
        await entry.promise?.catch((error) => {
          if (error.code !== 'PLUGIN_CANCELLED') throw error;
        });
        if (active.get(input.request_id) === entry) active.delete(input.request_id);
      }
      return ack(manifest.provider_id, input.request_id, Boolean(entry));
    },
    async dispose(raw) {
      const input = validateInput(manifest.provider_id, 'dispose', raw);
      disposed = true;
      for (const entry of active.values()) entry.controller.abort();
      await bridge.close();
      active.clear();
      return ack(manifest.provider_id, input.request_id);
    },
  });
  return Object.freeze({
    provider,
    manifest,
    binding: bridge.binding,
    attach: bridge.attach,
    close: () => provider.dispose({ schema_version: 1, provider_id: manifest.provider_id, request_id: 'request:plugin-close' }),
  });
}

module.exports = { createExecutionPluginModel };
