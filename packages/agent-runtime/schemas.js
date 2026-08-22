'use strict';

const { strictObject, z } = require('../agent-runtime-contracts');
const {
  ContextSourceSchema,
  InstructionLayersSchema,
  MemorySourceSchema,
  MAX_PARAMETER_BYTES,
} = require('../agent-context');

const AgentContextProfileSchema = strictObject({
  instructions: InstructionLayersSchema,
  runtime_context: z.array(ContextSourceSchema).max(64),
  references: z.array(ContextSourceSchema).max(256),
  memory: z.array(MemorySourceSchema).max(256),
  parameters: strictObject({
    max_output_tokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2).nullable(),
    stop: z.array(z.string().min(1)).max(16),
  }).refine((parameters) => Buffer.byteLength(JSON.stringify(parameters), 'utf8') <= MAX_PARAMETER_BYTES, {
    message: 'model parameters exceed the runtime profile byte limit',
  }),
  overflow_policy: z.enum(['reject', 'truncate_optional']),
});

module.exports = { AgentContextProfileSchema };
