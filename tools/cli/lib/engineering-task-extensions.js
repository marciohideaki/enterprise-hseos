'use strict';

const { z, IdentifierSchema, deepFreeze } = require('../../../packages/agent-runtime-contracts');
const { ContextSourceSchema } = require('../../../packages/agent-context/schemas');
const { deterministicOperationId } = require('../../../packages/governed-execution/operation-id');
const { governanceRef } = require('../../../packages/tool-runtime');
const { schemaContract } = require('../../lib/governed-execution/operational-runtime');
const { restoreExecutionPluginSelection, parseExecutionPluginSelection } = require('../../lib/execution-plugin-selection');
const { createExecutionPluginTool } = require('./execution-plugin-adapters');
const { ExecutionPluginError } = require('../../lib/execution-plugin-manifest');
const { ENGINEERING_TOOL_NAMES } = require('./engineering-tools');

const jsonObject = z.record(z.string(), z.json());
const configurationSchema = z
  .object({
    schema_version: z.literal(1),
    name: IdentifierSchema,
    description: z.string().min(1).max(4096),
    capability: IdentifierSchema,
    authority: IdentifierSchema,
    policy_version: IdentifierSchema,
    timeout_ms: z.number().int().positive().max(300_000),
    requires_approval: z.boolean().default(false),
    input_schema: jsonObject,
    output_schema: jsonObject.optional(),
    initial_input: jsonObject.optional(),
  })
  .strict();
const sourcesSchema = z.object({ sources: z.array(ContextSourceSchema).max(64) }).strict();
function reject(code) {
  throw new ExecutionPluginError(code);
}

function taskContextReservations(selection) {
  if (!selection) return 0;
  const pinned = parseExecutionPluginSelection(selection);
  return pinned.entries.filter((entry) => pinned.selected.includes(entry.selection_id) && entry.kind === 'context-source').length;
}

/** Compose host-owned ports without launching any external code. */
function createTaskExtensions({ selection, catalog, deadline }) {
  z.number().int().positive().safe().parse(deadline);
  const resolved = restoreExecutionPluginSelection(catalog, selection);
  const ports = [];
  const contexts = [];
  const names = new Set(ENGINEERING_TOOL_NAMES);
  let sources = [];
  for (const entry of resolved.entries.filter((entry) => resolved.selection.selected.includes(entry.pin.selection_id))) {
    const context = entry.pin.kind === 'context-source';
    if (!context && entry.pin.kind !== 'tool') reject('PLUGIN_TASK_PORT_UNSUPPORTED');
    const config = configurationSchema.parse(entry.configuration);
    if (names.has(config.name)) reject('PLUGIN_TASK_TOOL_CONFLICT');
    names.add(config.name);
    if (
      (context && (config.initial_input === undefined || config.output_schema !== undefined)) ||
      (!context && (config.output_schema === undefined || config.initial_input !== undefined))
    )
      reject('PLUGIN_TASK_CONFIGURATION_INVALID');
    const input = schemaContract(config.input_schema, `${config.name}.input`);
    if (context && !input.safeParse(config.initial_input).success) reject('PLUGIN_TASK_CONFIGURATION_INVALID');
    const port = createExecutionPluginTool({
      admission: entry.admission,
      deadline_at: deadline,
      contract: {
        name: config.name,
        capability: config.capability,
        authority: config.authority,
        policy_version: config.policy_version,
        provider: `execution-plugin:${entry.pin.id}`,
        reversibility: 'read_only',
        cancellation_policy: 'cooperative',
        failure_mode: 'fail_closed',
        timeout_ms: config.timeout_ms,
        requires_approval: config.requires_approval,
        exclusive: true,
        provider_accepts_idempotency: true,
        sandbox: null,
        prerequisites: [],
        input_schema: input,
        output_schema: context
          ? { version: 1, safeParse: sourcesSchema.safeParse.bind(sourcesSchema) }
          : schemaContract(config.output_schema, `${config.name}.output`),
      },
      definition: {
        name: config.name,
        description: config.description,
        input_schema: config.input_schema,
        governance_ref: governanceRef(config.name),
      },
    });
    ports.push(port);
    if (context) contexts.push({ selectionId: entry.pin.selection_id, name: config.name, input: config.initial_input });
  }
  return Object.freeze({
    bundles: Object.freeze(ports.map((port) => port.bundle)),
    get sources() {
      return sources;
    },
    async collect(toolRuntime, { task_id, session_id, signal }) {
      const collected = [];
      for (const context of contexts) {
        if (signal.aborted) reject('PLUGIN_CANCELLED');
        if (Date.now() >= deadline) reject('PLUGIN_TASK_DEADLINE');
        const id = deterministicOperationId(task_id, `${resolved.selection.selection_sha256}:${context.selectionId}`);
        const result = await toolRuntime.execute(
          {
            schema_version: 1,
            invocation_id: id,
            session_id,
            turn_id: `turn:context-${task_id}`,
            tool_call_id: `call:${id}`,
            name: context.name,
            input: context.input,
            actor: { id: 'agent:engineering-context', type: 'agent' },
            resource_scope: { task_id, extension_selection: resolved.selection.selection_sha256 },
            idempotency_key: id,
            correlation_id: id,
            causation_id: id,
            approval_context: null,
          },
          { signal },
        );
        if (result.status !== 'succeeded')
          reject(
            result.status === 'uncertain'
              ? 'PLUGIN_TEARDOWN_UNCERTAIN'
              : result.status === 'cancelled'
                ? 'PLUGIN_CANCELLED'
                : 'PLUGIN_CONTEXT_FAILED',
          );
        collected.push(...sourcesSchema.parse(result.result).sources);
        // The task contract itself occupies one of the assembler's 64 runtime-context slots.
        if (collected.length > 63) reject('PLUGIN_CONTEXT_LIMIT');
      }
      sources = deepFreeze(collected);
    },
    async drain() {
      const results = await Promise.allSettled(ports.map((port) => port.drain()));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
    assertQuiescent() {
      for (const port of ports) port.assertQuiescent();
    },
    async close() {
      const results = await Promise.allSettled(ports.map((port) => port.close()));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
  });
}

module.exports = { createTaskExtensions, taskContextReservations };
