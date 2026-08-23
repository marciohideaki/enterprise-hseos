'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const yaml = require('yaml');
const { z } = require('zod');

const {
  CONTRACT_SCHEMA_VERSION,
  ModelProviderManifestSchema,
  SecretReferenceSchema,
  deepFreeze,
  parseContract,
  validatePortResult,
} = require('../../packages/agent-runtime-contracts');
const { ModelProviderError, ModelProviderRegistry, OpenAICompatibleModelProvider } = require('../../packages/model-providers');
const { CANDIDATE_PROFILE, checkRequiredSandbox, readCandidateManifest } = require('./agentic-activation-rehearsal');
const { canonicalJson } = require('../../packages/agent-session-store');

const REFERENCE_PATTERN = /^(?:secret|env|file|vault|keychain):\/\/[^\s]+$/;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const Identifier = z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);
const BindingSchema = z
  .object({
    schema_version: z.literal('1.0'),
    binding_id: Identifier,
    profile_id: z.literal(CANDIDATE_PROFILE),
    adapter: z.literal('openai-compatible-sse'),
    provider: z
      .object({
        provider_id: z.literal('model:openai-compatible'),
        provider_version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
        base_url: z.url(),
        model: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[^\s]+$/),
        capabilities: z
          .array(z.enum(['text_generation', 'streaming', 'reasoning', 'tool_calls', 'usage', 'cancellation', 'image_input']))
          .min(2)
          .max(7),
        limits: z
          .object({
            context_tokens: z.number().int().positive(),
            max_output_tokens: z.number().int().positive(),
            max_parallel_requests: z.number().int().positive(),
          })
          .strict(),
        secret_refs: z.array(SecretReferenceSchema).length(1),
      })
      .strict(),
    transport: z
      .object({
        max_attempts: z.number().int().min(1).max(5),
        retry_delay_ms: z.number().int().min(0).max(60_000),
      })
      .strict(),
    activation: z.object({ operational: z.literal(false), authorized: z.literal(false) }).strict(),
  })
  .strict()
  .superRefine((binding, context) => {
    let endpoint;
    try {
      endpoint = new URL(binding.provider.base_url);
    } catch {
      endpoint = null;
    }
    if (
      !endpoint ||
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provider', 'base_url'],
        message: 'base_url must be a credential-free HTTP(S) URL without query or fragment',
      });
    }
    const capabilities = binding.provider.capabilities;
    for (const required of ['text_generation', 'streaming', 'cancellation']) {
      if (!capabilities.includes(required))
        context.addIssue({ code: 'custom', path: ['provider', 'capabilities'], message: `missing ${required}` });
    }
    if (new Set(capabilities).size !== capabilities.length) {
      context.addIssue({ code: 'custom', path: ['provider', 'capabilities'], message: 'capabilities must be unique' });
    }
    if (binding.provider.limits.max_output_tokens > binding.provider.limits.context_tokens) {
      context.addIssue({ code: 'custom', path: ['provider', 'limits'], message: 'max_output_tokens exceeds context_tokens' });
    }
    const secret = binding.provider.secret_refs[0];
    if (secret?.name !== 'api-key')
      context.addIssue({ code: 'custom', path: ['provider', 'secret_refs'], message: 'api-key reference is required' });
  });

class ProviderBindingError extends Error {
  constructor(message, code = 'PROVIDER_BINDING_INVALID') {
    super(message);
    this.name = 'ProviderBindingError';
    this.code = code;
  }
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validateBinding(value) {
  const result = BindingSchema.safeParse(value);
  if (!result.success) throw new ProviderBindingError('provider binding does not match schema v1');
  return deepFreeze(result.data);
}

function readProviderBinding(filename) {
  const resolved = path.resolve(filename);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new ProviderBindingError('provider binding file is absent');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new ProviderBindingError('provider binding must be a single regular file');
  }
  let parsed;
  try {
    parsed = yaml.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    throw new ProviderBindingError('provider binding is not valid YAML');
  }
  const binding = validateBinding(parsed);
  return Object.freeze({
    binding,
    binding_sha256: digest(binding),
    filename: resolved,
  });
}

function providerManifest(binding) {
  binding = validateBinding(binding);
  return parseContract(
    ModelProviderManifestSchema,
    {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_type: 'model',
      provider_id: binding.provider.provider_id,
      provider_version: binding.provider.provider_version,
      models: [binding.provider.model],
      capabilities: binding.provider.capabilities,
      limits: binding.provider.limits,
      secret_refs: binding.provider.secret_refs,
    },
    'bound model provider manifest',
  );
}

function referenceScheme(reference) {
  if (!reference || typeof reference.source_ref !== 'string' || !REFERENCE_PATTERN.test(reference.source_ref)) {
    throw new ProviderBindingError('secret resolver received an invalid reference');
  }
  return reference.source_ref.slice(0, reference.source_ref.indexOf('://'));
}

function createSecretResolver({ environment = process.env, resolvers = {} } = {}) {
  const custom = resolvers instanceof Map ? new Map(resolvers) : new Map(Object.entries(resolvers));
  return async (reference, context = {}) => {
    const scheme = referenceScheme(reference);
    try {
      let value;
      if (scheme === 'env') {
        const name = reference.source_ref.slice('env://'.length);
        if (!ENV_NAME_PATTERN.test(name)) throw new ProviderBindingError('environment secret reference name is invalid');
        value = Object.hasOwn(environment, name) ? environment[name] : undefined;
      } else {
        const resolver = custom.get(scheme);
        if (typeof resolver !== 'function') throw new ProviderBindingError(`no resolver is registered for ${scheme} references`);
        value = await resolver(reference, context);
      }
      if (typeof value !== 'string' || value.length === 0) throw new ProviderBindingError('secret reference did not resolve');
      return value;
    } catch (error) {
      throw new ModelProviderError('secret resolution failed', 'unauthorized', { cause: error });
    }
  };
}

function createBoundModelProvider({ binding, environment, resolvers, fetch_impl }) {
  binding = validateBinding(binding);
  const manifest = providerManifest(binding);
  const fetchImplementation = fetch_impl || Reflect.get(globalThis, 'fetch');
  const provider = new OpenAICompatibleModelProvider({
    manifest,
    base_url: binding.provider.base_url,
    fetch_impl: fetchImplementation,
    secret_resolver: createSecretResolver({ environment, resolvers }),
    max_attempts: binding.transport.max_attempts,
    retry_delay_ms: binding.transport.retry_delay_ms,
  });
  const registry = new ModelProviderRegistry();
  registry.register(provider, manifest);
  return Object.freeze({ manifest, provider, snapshot: registry.snapshot() });
}

function safeProbeEvidence(events) {
  const terminal = events.at(-1);
  return Object.freeze({
    status: terminal?.event_type === 'completed' ? 'passed' : 'failed',
    ready: terminal?.event_type === 'completed',
    normalized_events: events.map(({ event_type: eventType }) => eventType),
    terminal_event: terminal?.event_type || null,
    finish_reason: terminal?.event_type === 'completed' ? terminal.payload.finish_reason : null,
    error_code: terminal?.event_type === 'failed' ? terminal.payload.error_code : null,
    retryable: terminal?.event_type === 'failed' ? terminal.payload.retryable : null,
    evidence_refs:
      terminal?.event_type === 'completed' && terminal.payload.provider_response_ref ? [terminal.payload.provider_response_ref] : [],
  });
}

async function probeBoundProvider(assembly) {
  const input = {
    schema_version: CONTRACT_SCHEMA_VERSION,
    request_id: `request:provider-probe-${Date.now()}`,
    session_id: 'session:provider-environment-probe',
    turn_id: 'turn:provider-environment-probe',
    provider_id: assembly.manifest.provider_id,
    model: assembly.manifest.models[0],
    messages: [{ role: 'user', content: 'Reply with a short readiness acknowledgement.' }],
    tools: [],
    parameters: {
      max_output_tokens: Math.min(32, assembly.manifest.limits.max_output_tokens),
      temperature: null,
      stop: [],
    },
  };
  const events = [];
  for await (const event of validatePortResult('ModelProvider', 'stream', assembly.provider.stream(input), input)) events.push(event);
  assembly.provider.dispose({
    schema_version: CONTRACT_SCHEMA_VERSION,
    request_id: 'request:provider-probe-dispose',
    provider_id: assembly.manifest.provider_id,
  });
  return safeProbeEvidence(events);
}

async function validateProviderEnvironment({
  bindingPath,
  repositoryRoot,
  projectDirectory = repositoryRoot,
  probe = false,
  environment = process.env,
  resolvers,
  fetch_impl,
  sandbox_check,
}) {
  const candidate = readCandidateManifest(path.resolve(repositoryRoot));
  const loaded = readProviderBinding(bindingPath);
  const binding = loaded.binding;
  if (binding.profile_id !== candidate.profile_id || binding.provider.provider_id !== candidate.execution.model_provider_id) {
    throw new ProviderBindingError('provider binding does not match the selected candidate profile');
  }
  const manifest = providerManifest(binding);
  const configuration = Object.freeze({
    ready: true,
    binding_id: binding.binding_id,
    binding_sha256: loaded.binding_sha256,
    profile_id: binding.profile_id,
    adapter: binding.adapter,
    provider_id: manifest.provider_id,
    provider_version: manifest.provider_version,
    model: manifest.models[0],
    base_url_origin: new URL(binding.provider.base_url).origin,
    capabilities: manifest.capabilities,
    limits: manifest.limits,
    secret_refs: manifest.secret_refs,
    secret_values_loaded: false,
  });
  const sandbox = sandbox_check
    ? await sandbox_check({ candidate, projectDirectory, environment })
    : checkRequiredSandbox(candidate, environment);
  let providerProbe = { status: 'not-requested', ready: false };
  if (probe && !sandbox.ready) providerProbe = { status: 'blocked-by-required-sandbox', ready: false };
  if (probe && sandbox.ready) {
    const assembly = createBoundModelProvider({ binding, environment, resolvers, fetch_impl });
    providerProbe = await probeBoundProvider(assembly);
  }
  const providerEnvironmentReady = configuration.ready && sandbox.ready && providerProbe.ready;
  return Object.freeze({
    schema_version: '1.0',
    status: providerEnvironmentReady ? 'provider-environment-passed' : probe ? 'provider-environment-blocked' : 'configuration-valid',
    validation_only: true,
    network_probe_requested: probe,
    operational_activation: false,
    activation_authorized: false,
    ready_for_g9_gate: providerEnvironmentReady,
    evidence: { configuration, sandbox, provider_probe: providerProbe },
    remaining_gates: [
      ...(sandbox.ready ? [] : ['required-sandbox-runtime']),
      ...(providerProbe.ready ? [] : ['provider-environment-probe']),
      'g9-zero-legacy-window',
      'final-stable-audit',
      'explicit-human-cutover',
    ],
  });
}

module.exports = {
  BindingSchema,
  ProviderBindingError,
  createBoundModelProvider,
  createSecretResolver,
  probeBoundProvider,
  providerManifest,
  readProviderBinding,
  validateBinding,
  validateProviderEnvironment,
};
