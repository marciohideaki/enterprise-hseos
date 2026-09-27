'use strict';

const { createHash } = require('node:crypto');
const { IdentifierSchema, SecretReferenceSchema, strictObject, deepFreeze, z } = require('../../packages/agent-runtime-contracts');
const { canonicalJson } = require('../../packages/agent-session-store');

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const label = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/);
const units = z.number().int().nonnegative().safe();
const positive = z.number().int().positive().safe();

// Documentation classifies integration routes; it never certifies a live binding.
const ROUTES = deepFreeze({
  codex: {
    account: { kinds: ['runtime', 'client'], auth: 'native_account', source: 'https://learn.chatgpt.com/docs/app-server' },
    api: { kinds: ['runtime', 'client'], auth: 'api_key', source: 'https://learn.chatgpt.com/docs/app-server' },
  },
  claude: {
    account: { kinds: ['client'], auth: 'native_account', source: 'https://code.claude.com/docs/en/authentication' },
    api: { kinds: ['runtime', 'client'], auth: 'api_key', source: 'https://code.claude.com/docs/en/agent-sdk/overview' },
  },
  deepseek: {
    api: { kinds: ['model', 'runtime', 'client'], auth: 'api_key', source: 'https://api-docs.deepseek.com/' },
    local: { kinds: ['model', 'runtime', 'client'], auth: 'local', source: 'https://github.com/deepseek-ai/deepseek-harness' },
  },
  antigravity: {
    account: { kinds: ['client'], auth: 'native_account', source: 'https://antigravity.google/docs/cli/installation/' },
    api: { kinds: ['client'], auth: 'api_key', source: 'https://antigravity.google/docs/sdk/overview/' },
    local: { kinds: ['client'], auth: 'local', source: 'https://antigravity.google/docs/sdk/local-models/' },
  },
});

const ProviderControlManifestSchema = strictObject({
  schema_version: z.literal(1),
  binding_id: IdentifierSchema,
  binding_sha256: hash,
  vendor: z.enum(['codex', 'claude', 'deepseek', 'antigravity']),
  provider_kind: z.enum(['model', 'runtime', 'client']),
  provider_version: label,
  adapter: label,
  artifact_sha256: hash,
  route: z.enum(['account', 'api', 'local']),
  transport: z.enum(['stdio', 'process', 'http', 'acp']),
  authentication: strictObject({
    mode: z.enum(['native_account', 'api_key', 'local']),
    credential: SecretReferenceSchema.nullable(),
    account_sha256: hash.nullable(),
    identity_kind: z.enum(['account', 'credential', 'local_profile']).optional(),
    credential_sha256: hash.optional(),
    profile_sha256: hash.optional(),
    source: label,
  }),
  billing: strictObject({
    kind: z.enum(['subscription', 'metered', 'local']),
    currency: z.literal('USD'),
    max_request_microusd: units,
  }),
  limits: strictObject({
    max_requests: positive,
    max_input_tokens: positive,
    max_output_tokens: positive,
    max_duration_ms: positive.max(86_400_000),
  }),
  controls: strictObject({
    authority: z.enum(['kernel', 'delegated_l0', 'external_client']),
    resume: z.enum(['verified', 'unavailable', 'not_verified']),
    cancel: z.enum(['verified', 'unavailable', 'not_verified']),
    quota: z.enum(['observed', 'not_verified', 'not_applicable']),
    evidence_sha256: hash.nullable(),
  }),
}).superRefine((value, context) => {
  const reject = (message) => context.addIssue({ code: 'custom', message });
  const route = ROUTES[value.vendor][value.route];
  if (!route?.kinds.includes(value.provider_kind) || value.authentication.mode !== route?.auth)
    reject('The selected official route has not been established for this provider kind');
  const expectedBilling = { account: 'subscription', api: 'metered', local: 'local' }[value.route];
  if (value.billing.kind !== expectedBilling) reject('Billing must match the selected route');
  if (value.route === 'api' && value.billing.max_request_microusd === 0) reject('Metered requests require a finite positive reservation');
  if (value.route !== 'api' && value.billing.max_request_microusd !== 0) reject('Paid credits require an explicit metered route');
  if (!['credential', 'local_profile'].includes(value.authentication.identity_kind) && value.authentication.account_sha256 === null)
    reject('Account identity must be pinned');
  if (
    value.authentication.identity_kind === 'local_profile' &&
    (value.route !== 'local' || !value.authentication.profile_sha256 || value.authentication.account_sha256 !== null)
  )
    reject('Local profile identity requires a pinned artifact profile, not an account');
  if (
    value.authentication.identity_kind === 'credential' &&
    (value.route !== 'api' || !value.authentication.credential_sha256 || value.authentication.account_sha256 !== null)
  )
    reject('Credential identity requires a pinned API credential and does not assert an account');
  if ((value.route === 'local') !== (value.authentication.credential === null)) reject('Credential references must match the route');
  const authority = { model: 'kernel', runtime: 'delegated_l0', client: 'external_client' }[value.provider_kind];
  if (value.controls.authority !== authority) reject('Declared authority must match the integration boundary');
  if (value.controls.quota === 'not_applicable' && value.route !== 'local') reject('Remote quota cannot be assumed unlimited');
  if ([value.controls.resume, value.controls.cancel].includes('verified') && !value.controls.evidence_sha256)
    reject('Verified controls need pinned conformance evidence');
});

function parseProviderControlManifest(value) {
  const parsed = ProviderControlManifestSchema.safeParse(value);
  if (!parsed.success) {
    const error = new Error('Provider control manifest is invalid or claims an unestablished route');
    error.code = 'CONTROL_PROVIDER_MANIFEST_INVALID';
    throw error;
  }
  return deepFreeze(parsed.data);
}

function inspectProviderControlManifest(value, bindingSha256) {
  const manifest = parseProviderControlManifest(value);
  if (bindingSha256 !== manifest.binding_sha256) {
    const error = new Error('Provider binding changed after its control manifest was pinned');
    error.code = 'CONTROL_PROVIDER_BINDING_DRIFT';
    throw error;
  }
  return deepFreeze({
    binding_id: manifest.binding_id,
    vendor: manifest.vendor,
    route: manifest.route,
    provider_kind: manifest.provider_kind,
    manifest_sha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex'),
    configuration: 'valid',
    official_source: ROUTES[manifest.vendor][manifest.route].source,
    effective_authentication: 'not_observed',
    real_conformance: 'not_certified',
    operational: 'not_activated',
  });
}

module.exports = { ROUTES, ProviderControlManifestSchema, parseProviderControlManifest, inspectProviderControlManifest };
