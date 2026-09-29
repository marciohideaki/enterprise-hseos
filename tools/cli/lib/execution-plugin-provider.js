'use strict';

const { randomUUID } = require('node:crypto');
const { z, validatePortInput } = require('../../../packages/agent-runtime-contracts');
const { HostedInstructionsRuntimeProvider } = require('../../../packages/runtime-providers/hosted-runtime-provider');
const { deterministicOperationId } = require('../../../packages/governed-execution/operation-id');
const { assertExecutionPluginAdmission, ExecutionPluginError } = require('../../lib/execution-plugin-manifest');
const { createExecutionPluginCampaignBinding } = require('./execution-plugin-campaign');

function createExecutionPluginProvider({ admission, binding_id, limits }) {
  assertExecutionPluginAdmission(admission);
  const plugin = admission.manifest;
  if (plugin.kind !== 'runtime-provider' || !plugin.capabilities.includes('send')) throw new ExecutionPluginError('PLUGIN_PORT_KIND');
  const bridge = createExecutionPluginCampaignBinding({
    admission,
    binding_id,
    limits,
    output_schema: z.object({ text: z.string().max(65_536) }).strict(),
  });
  const sessions = new Map();
  let uncertain = false;
  async function drain(id) {
    const selected = id ? [sessions.get(id)].filter(Boolean) : [...sessions.values()];
    await Promise.allSettled(selected.map((session) => session.pending));
    if (uncertain) throw new ExecutionPluginError('PLUGIN_RESULT_UNCERTAIN');
  }
  async function stop(id) {
    const selected = id ? [sessions.get(id)].filter(Boolean) : [...sessions.values()];
    for (const session of selected) session.controller.abort();
    await drain(id);
  }
  const driver = {
    async create() {
      const id = randomUUID();
      sessions.set(id, { controller: new AbortController(), pending: null });
      return { runtime_session_id: id, effect_boundary: 'instructions_only', resumable: false };
    },
    send({ runtime_session_id, turn_id, instruction, on_event }) {
      const session = sessions.get(runtime_session_id);
      if (!session || session.pending) throw new ExecutionPluginError('PLUGIN_RUNTIME_SESSION');
      session.pending = (async () => {
        try {
          const result = await bridge.execute(
            { request_id: deterministicOperationId(runtime_session_id, turn_id), method: 'send', input: { instruction } },
            { signal: session.controller.signal },
          );
          on_event({ type: 'message.delta', text: result.result.text });
          return { stop_reason: 'completed' };
        } catch (error) {
          if (error.code === 'PLUGIN_CANCELLED') return { stop_reason: 'cancelled' };
          if (['CONTROL_OUTCOME_UNCERTAIN', 'PLUGIN_RESULT_UNCERTAIN'].includes(error.code)) uncertain = true;
          throw error;
        }
      })();
      return session.pending;
    },
    async resume() {
      throw new ExecutionPluginError('PLUGIN_RESUME_UNAVAILABLE');
    },
    cancel: ({ runtime_session_id }) => stop(runtime_session_id),
    async dispose({ runtime_session_id }) {
      await stop(runtime_session_id);
      sessions.delete(runtime_session_id);
    },
    async close() {
      await stop();
      await bridge.close();
      sessions.clear();
    },
  };
  const hosted = new HostedInstructionsRuntimeProvider({
    adapter_id: 'execution-plugin',
    provider_id: `runtime:plugin-${plugin.id}`,
    provider_version: plugin.version,
    driver,
    default_cwd: '/workspace',
  });
  function checked(method, raw) {
    const input = validatePortInput('RuntimeProvider', method, raw);
    if (input.provider_id !== hosted.providerManifest.provider_id) throw new ExecutionPluginError('PLUGIN_RUNTIME_IDENTITY');
    if (['cancel', 'dispose'].includes(method))
      hosted.events({
        schema_version: 1,
        provider_id: input.provider_id,
        session_id: input.session_id,
        runtime_session_id: input.runtime_session_id,
        from_sequence: 0,
      });
    return input;
  }
  const provider = Object.freeze({
    manifest: (input) => hosted.manifest(input),
    create: (input) => hosted.create(input),
    resume: (input) => hosted.resume(input),
    send: (input) => hosted.send(input),
    events(raw) {
      const input = checked('events', raw);
      const events = hosted.events(input);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const event of events) {
            if (['runtime.session.completed', 'runtime.session.failed'].includes(event.event_type)) await drain(input.runtime_session_id);
            yield event;
          }
        },
      };
    },
    async cancel(raw) {
      const input = checked('cancel', raw);
      await stop(input.runtime_session_id);
      return hosted.cancel(input);
    },
    async dispose(raw) {
      const input = checked('dispose', raw);
      await stop(input.runtime_session_id);
      return hosted.dispose(input);
    },
  });
  return Object.freeze({
    provider,
    manifest: hosted.providerManifest,
    binding: bridge.binding,
    attach: bridge.attach,
    async close() {
      await driver.close();
      await hosted.close();
    },
  });
}

module.exports = { createExecutionPluginProvider };
