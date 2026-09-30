'use strict';
const { ROUTES } = require('../../tools/lib/provider-control-manifest');
function manifest(vendor = 'deepseek', route = 'api', provider_kind = 'model') {
  return {
    schema_version: 1,
    binding_id: 'binding:individual',
    binding_sha256: 'a'.repeat(64),
    vendor,
    provider_kind,
    provider_version: '1.0.0',
    adapter: 'official-adapter',
    artifact_sha256: 'b'.repeat(64),
    route,
    transport: 'http',
    authentication: {
      mode: ROUTES[vendor][route].auth,
      credential: route === 'local' ? null : { name: 'api-key', source_ref: 'env://TEST_PROVIDER_KEY' },
      account_sha256: 'c'.repeat(64),
      source: 'explicit',
    },
    billing: {
      kind: { account: 'subscription', api: 'metered', local: 'local' }[route],
      currency: 'USD',
      max_request_microusd: route === 'api' ? 1000 : 0,
    },
    limits: { max_requests: 3, max_input_tokens: 1000, max_output_tokens: 64, max_duration_ms: 30_000 },
    controls: {
      authority: { model: 'kernel', runtime: 'delegated_l0', client: 'external_client' }[provider_kind],
      resume: 'not_verified',
      cancel: 'not_verified',
      quota: route === 'local' ? 'not_applicable' : 'not_verified',
      evidence_sha256: null,
    },
  };
}

module.exports = { manifest };
