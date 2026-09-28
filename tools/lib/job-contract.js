'use strict';

const { z, deepFreeze } = require('../../packages/agent-runtime-contracts');
const { engineeringDigest } = require('../cli/lib/engineering-task-state');
const uuid = z.string().uuid();
const utc = z.string().refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const jobCommandSchema = z
  .object({
    schema_version: z.literal(1),
    command_id: uuid,
    resource_id: uuid,
    expected_sequence: z.number().int().nonnegative().safe(),
    action: z.enum(['create', 'cancel']),
    input: z.record(z.string(), z.json()),
  })
  .strict();
const jobCreateSchema = z
  .object({
    kind: z.enum(['task', 'workflow']),
    definition: z.record(z.string(), z.json()),
    not_before: utc,
    deadline_at: utc,
    depends_on: z
      .array(uuid)
      .max(128)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict()
  .refine((value) => Date.parse(value.not_before) < Date.parse(value.deadline_at));

function parseJobCommand(value) {
  const command = jobCommandSchema.parse(value);
  const input = command.action === 'create' ? jobCreateSchema.parse(command.input) : z.object({}).strict().parse(command.input);
  return deepFreeze({ ...command, input });
}
function jobDigest(value) {
  return engineeringDigest(value);
}
const expansionSchema = jobCommandSchema.extend({
  action: z.literal('expand'),
  input: z
    .object({
      definition_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      nodes: z.array(z.record(z.string(), z.json())).min(1).max(16),
    })
    .strict(),
});
function parseJobExpansion(value) {
  return deepFreeze(expansionSchema.parse(value));
}
module.exports = { parseJobCommand, parseJobExpansion, jobCreateSchema, jobDigest };
