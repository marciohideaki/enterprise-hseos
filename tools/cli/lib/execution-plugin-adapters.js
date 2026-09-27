'use strict';

const { randomUUID } = require('node:crypto');
const { ToolDefinitionSchema, parseContract, z } = require('../../../packages/agent-runtime-contracts');
const { ContextSourceSchema, ContextTextSchema } = require('../../../packages/agent-context/schemas');
const { governanceRef } = require('../../../packages/tool-runtime');
const { ExecutionContractRegistry } = require('../../lib/governed-execution/contract-registry');
const { assertExecutionPluginAdmission, ExecutionPluginError } = require('../../lib/execution-plugin-manifest');
const { executeExecutionPlugin } = require('./execution-plugin-runtime');

const contextResultSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
            content: ContextTextSchema,
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .refine((value) => new Set(value.items.map((item) => item.id)).size === value.items.length);
const sourcesSchema = z.object({ sources: z.array(ContextSourceSchema).max(64) }).strict();

function reject(code) {
  const error = new ExecutionPluginError(code);
  if (code === 'PLUGIN_TEARDOWN_UNCERTAIN') error.outcome = 'uncertain';
  throw error;
}

/** Trusted composition only: callers register the bundle with ToolRuntime before sealing. */
function createExecutionPluginTool({ admission, contract: value, definition: definitionValue, deadline_at }) {
  assertExecutionPluginAdmission(admission);
  if (deadline_at !== undefined && (!Number.isSafeInteger(deadline_at) || deadline_at < 1)) reject('PLUGIN_PORT_CONTEXT');
  const manifest = admission.manifest;
  if (!['tool', 'context-source'].includes(manifest.kind)) reject('PLUGIN_PORT_KIND');
  const contextSource = manifest.kind === 'context-source';
  const registry = new ExecutionContractRegistry();
  const contract = registry.register(value);
  registry.seal();
  const definition = parseContract(ToolDefinitionSchema, definitionValue, 'plugin tool definition');
  if (
    !manifest.capabilities.includes(contract.capability) ||
    !manifest.capabilities.includes(contract.name) ||
    definition.name !== contract.name ||
    definition.governance_ref !== governanceRef(contract.name) ||
    contract.reversibility !== 'read_only' ||
    contract.failure_mode !== 'fail_closed' ||
    contract.cancellation_policy !== 'cooperative' ||
    contract.timeout_ms < manifest.limits.timeout_ms ||
    !contract.provider_accepts_idempotency
  )
    reject('PLUGIN_PORT_AUTHORITY');
  const sourcePrefix = `plugin://${manifest.id}/${manifest.version}/${admission.manifest_sha256}`;
  const active = new Set();
  let closed = false;
  let uncertain = false;

  async function invoke(input, context) {
    if (closed) reject('PLUGIN_PORT_CLOSED');
    if (uncertain) reject('PLUGIN_TEARDOWN_UNCERTAIN');
    const deadline = Date.parse(context?.deadline);
    if (!(context?.signal instanceof AbortSignal) || !Number.isSafeInteger(deadline) || typeof context.operation_id !== 'string')
      reject('PLUGIN_PORT_CONTEXT');
    const parsedInput = registry.validateInput(contract, input);
    const controller = new AbortController();
    const relay = () => controller.abort();
    context.signal.addEventListener('abort', relay, { once: true });
    if (context.signal.aborted) controller.abort();
    const operation = { controller, promise: null };
    active.add(operation);
    operation.promise = Promise.resolve().then(async () => {
      try {
        const response = await executeExecutionPlugin({
          admission,
          request: { request_id: randomUUID(), method: contextSource ? 'context' : 'invoke', input: parsedInput },
          signal: controller.signal,
          deadline_at: Math.min(deadline, deadline_at ?? deadline),
        });
        let data = response.result;
        if (contextSource) {
          const parsed = contextResultSchema.safeParse(data);
          if (!parsed.success) reject('PLUGIN_CONTEXT_INVALID');
          data = sourcesSchema.parse({
            sources: parsed.data.items.map((item) => ({
              source_ref: `${sourcePrefix}/${item.id}`,
              classification: 'internal',
              content: item.content,
            })),
          });
        }
        data = registry.validateOutput(contract, data);
        return { data, evidence: [sourcePrefix, `isolation://${response.isolation.policy_digest}`] };
      } catch (error) {
        if (error.code === 'PLUGIN_TEARDOWN_UNCERTAIN') uncertain = true;
        const failure = new ExecutionPluginError(error.code || 'PLUGIN_PORT_FAILED');
        failure.outcome = uncertain ? 'uncertain' : error.code === 'PLUGIN_CANCELLED' ? 'cancelled' : 'failed';
        throw failure;
      } finally {
        context.signal.removeEventListener('abort', relay);
        active.delete(operation);
      }
    });
    return operation.promise;
  }

  return Object.freeze({
    identity: Object.freeze({ id: manifest.id, version: manifest.version, manifest_sha256: admission.manifest_sha256 }),
    bundle: Object.freeze({ contract, definition, provider: Object.freeze({ execute: invoke }) }),
    async drain() {
      await Promise.allSettled([...active].map((operation) => operation.promise));
      if (uncertain) reject('PLUGIN_TEARDOWN_UNCERTAIN');
    },
    async close() {
      closed = true;
      for (const operation of active) operation.controller.abort();
      await Promise.allSettled([...active].map((operation) => operation.promise));
      if (uncertain) reject('PLUGIN_TEARDOWN_UNCERTAIN');
    },
    assertQuiescent() {
      if (uncertain || active.size > 0) reject('PLUGIN_TEARDOWN_UNCERTAIN');
    },
  });
}

module.exports = { createExecutionPluginTool };
