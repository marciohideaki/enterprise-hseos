'use strict';

const { z } = require('zod');

const CONTRACT_SCHEMA_VERSION = 1;
const NORMALIZED_ERROR_CODES = Object.freeze([
  'invalid_request',
  'unauthorized',
  'policy_denied',
  'capability_unavailable',
  'rate_limited',
  'timeout',
  'cancelled',
  'provider_unavailable',
  'protocol_error',
  'budget_exceeded',
  'tool_failed',
  'internal_error',
]);

class AgentContractError extends Error {
  constructor(message, code = 'AGENT_CONTRACT_INVALID', details = {}) {
    super(message);
    this.name = 'AgentContractError';
    this.code = code;
    this.details = details;
  }
}

const IdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
const ModelNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/);
const OpaqueIdentifierSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/);
const ReferenceSchema = z.string().min(1).max(1024);
const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const TimestampSchema = z.string().datetime({ offset: true });
const JsonObjectSchema = z.record(z.string(), z.json());
const NormalizedErrorCodeSchema = z.enum(NORMALIZED_ERROR_CODES);

function boundedString(maximumBytes) {
  return z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= maximumBytes, {
    message: `string exceeds ${maximumBytes} UTF-8 bytes`,
  });
}

function boundedJsonObject(maximumBytes) {
  return JsonObjectSchema.refine((value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= maximumBytes, {
    message: `JSON object exceeds ${maximumBytes} UTF-8 bytes`,
  });
}

function strictObject(shape) {
  return z.object(shape).strict();
}

function uniqueEnumArray(itemSchema, minimum = 0) {
  return z
    .array(itemSchema)
    .min(minimum)
    .superRefine((items, context) => {
      const duplicates = items.filter((item, index) => items.indexOf(item) !== index);
      if (duplicates.length > 0) {
        context.addIssue({
          code: 'custom',
          message: `duplicate values: ${[...new Set(duplicates)].sort().join(', ')}`,
        });
      }
    });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function parseContract(schema, value, label = 'contract') {
  let parsed;
  try {
    parsed = schema.safeParse(value);
  } catch (error) {
    throw new AgentContractError(`${label} schema evaluation failed`, 'AGENT_CONTRACT_SCHEMA_EVALUATION_FAILED', {
      label,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!parsed.success) {
    throw new AgentContractError(`${label} does not match schema v${CONTRACT_SCHEMA_VERSION}`, 'AGENT_CONTRACT_SCHEMA_INVALID', {
      label,
      schema_version: CONTRACT_SCHEMA_VERSION,
      issues: parsed.error.issues,
    });
  }
  return deepFreeze(parsed.data);
}

module.exports = {
  AgentContractError,
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  JsonObjectSchema,
  ModelNameSchema,
  NORMALIZED_ERROR_CODES,
  NormalizedErrorCodeSchema,
  OpaqueIdentifierSchema,
  ReferenceSchema,
  SemverSchema,
  TimestampSchema,
  boundedJsonObject,
  boundedString,
  deepFreeze,
  parseContract,
  strictObject,
  uniqueEnumArray,
  z,
};
