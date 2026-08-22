'use strict';

const {
  AgentContractError,
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  ModelNameSchema,
  SemverSchema,
  deepFreeze,
  parseContract,
  strictObject,
  uniqueEnumArray,
  z,
} = require('./common');

const MODEL_CAPABILITIES = Object.freeze([
  'text_generation',
  'streaming',
  'reasoning',
  'tool_calls',
  'usage',
  'cancellation',
  'image_input',
]);

const RUNTIME_CAPABILITIES = Object.freeze([
  'instructions',
  'governed_tools',
  'session_lifecycle',
  'cancellation',
  'approval_outcomes',
  'context_control',
  'tool_events',
  'replay',
  'compaction_lineage',
  'sandbox',
  'telemetry',
]);

const CONFORMANCE_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4']);
const CONFORMANCE_REQUIREMENTS = deepFreeze({
  L0: ['instructions'],
  L1: ['instructions', 'governed_tools'],
  L2: ['instructions', 'governed_tools', 'session_lifecycle', 'cancellation', 'approval_outcomes'],
  L3: ['instructions', 'governed_tools', 'session_lifecycle', 'cancellation', 'approval_outcomes', 'context_control', 'tool_events'],
  L4: [
    'instructions',
    'governed_tools',
    'session_lifecycle',
    'cancellation',
    'approval_outcomes',
    'context_control',
    'tool_events',
    'replay',
    'compaction_lineage',
    'sandbox',
    'telemetry',
  ],
});

const SecretReferenceSchema = strictObject({
  name: IdentifierSchema,
  source_ref: z.string().regex(/^(?:secret|env|file|vault|keychain):\/\/[^\s]+$/),
});

const SecretReferencesSchema = z.array(SecretReferenceSchema).superRefine((references, context) => {
  const names = references.map((reference) => reference.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    context.addIssue({ code: 'custom', message: `duplicate secret references: ${[...new Set(duplicates)].sort().join(', ')}` });
  }
});

function deriveRuntimeConformanceLevel(capabilities) {
  const capabilitySet = new Set(capabilities);
  return [...CONFORMANCE_LEVELS]
    .reverse()
    .find((level) => CONFORMANCE_REQUIREMENTS[level].every((capability) => capabilitySet.has(capability)));
}

const ModelProviderManifestSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_type: z.literal('model'),
  provider_id: IdentifierSchema,
  provider_version: SemverSchema,
  models: uniqueEnumArray(ModelNameSchema, 1),
  capabilities: uniqueEnumArray(z.enum(MODEL_CAPABILITIES), 1),
  limits: strictObject({
    context_tokens: z.number().int().positive(),
    max_output_tokens: z.number().int().positive(),
    max_parallel_requests: z.number().int().positive(),
  }),
  secret_refs: SecretReferencesSchema,
}).superRefine((manifest, context) => {
  if (!manifest.capabilities.includes('text_generation')) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'model provider requires text_generation' });
  }
});

const RuntimeProviderManifestSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_type: z.literal('runtime'),
  provider_id: IdentifierSchema,
  provider_version: SemverSchema,
  conformance_level: z.enum(CONFORMANCE_LEVELS),
  capabilities: uniqueEnumArray(z.enum(RUNTIME_CAPABILITIES), 1),
  transport: z.enum(['in_process', 'stdio', 'process', 'http', 'acp']),
  secret_refs: SecretReferencesSchema,
}).superRefine((manifest, context) => {
  const missing = CONFORMANCE_REQUIREMENTS[manifest.conformance_level].filter((capability) => !manifest.capabilities.includes(capability));
  if (missing.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['capabilities'],
      message: `${manifest.conformance_level} is missing: ${missing.join(', ')}`,
    });
  }
  const effectiveLevel = deriveRuntimeConformanceLevel(manifest.capabilities);
  if (effectiveLevel && effectiveLevel !== manifest.conformance_level) {
    context.addIssue({
      code: 'custom',
      path: ['conformance_level'],
      message: `declared ${manifest.conformance_level} does not match effective ${effectiveLevel}`,
    });
  }
});

const ProviderManifestSchema = z.discriminatedUnion('provider_type', [ModelProviderManifestSchema, RuntimeProviderManifestSchema]);

function negotiateRuntimeCapabilities(manifestValue, requiredLevel = 'L0', requiredCapabilities = []) {
  const manifest = parseContract(RuntimeProviderManifestSchema, manifestValue, 'runtime provider manifest');
  if (!CONFORMANCE_LEVELS.includes(requiredLevel)) {
    throw new AgentContractError(`Unknown conformance level: ${requiredLevel}`, 'AGENT_CONFORMANCE_LEVEL_UNKNOWN');
  }
  const unknownCapabilities = requiredCapabilities.filter((capability) => !RUNTIME_CAPABILITIES.includes(capability));
  if (unknownCapabilities.length > 0) {
    throw new AgentContractError(`Unknown runtime capabilities: ${unknownCapabilities.join(', ')}`, 'AGENT_RUNTIME_CAPABILITY_UNKNOWN', {
      capabilities: unknownCapabilities,
    });
  }
  const declaredLevelIndex = CONFORMANCE_LEVELS.indexOf(manifest.conformance_level);
  const requiredLevelIndex = CONFORMANCE_LEVELS.indexOf(requiredLevel);
  const required = [...new Set([...CONFORMANCE_REQUIREMENTS[requiredLevel], ...requiredCapabilities])].sort();
  const missing = required.filter((capability) => !manifest.capabilities.includes(capability));
  return deepFreeze({
    ok: declaredLevelIndex >= requiredLevelIndex && missing.length === 0,
    declared_level: manifest.conformance_level,
    required_level: requiredLevel,
    missing_capabilities: missing,
  });
}

module.exports = {
  CONFORMANCE_LEVELS,
  CONFORMANCE_REQUIREMENTS,
  MODEL_CAPABILITIES,
  ModelProviderManifestSchema,
  ProviderManifestSchema,
  RUNTIME_CAPABILITIES,
  RuntimeProviderManifestSchema,
  SecretReferenceSchema,
  SecretReferencesSchema,
  deriveRuntimeConformanceLevel,
  negotiateRuntimeCapabilities,
};
