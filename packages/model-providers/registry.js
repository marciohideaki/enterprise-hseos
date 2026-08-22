'use strict';

const { isDeepStrictEqual } = require('node:util');

const {
  CONTRACT_SCHEMA_VERSION,
  ModelProviderManifestSchema,
  assertPortShape,
  deepFreeze,
  parseContract,
  validatePortResult,
} = require('../agent-runtime-contracts');

class ProviderRegistryError extends Error {
  constructor(message, code = 'MODEL_PROVIDER_REGISTRY_INVALID', details = {}) {
    super(message);
    this.name = 'ProviderRegistryError';
    this.code = code;
    this.details = details;
  }
}

class ModelProviderRegistry {
  #providers;

  constructor() {
    this.#providers = new Map();
  }

  register(provider, manifestValue) {
    assertPortShape('ModelProvider', provider);
    const manifest = parseContract(ModelProviderManifestSchema, manifestValue, 'model provider manifest');
    let reportedManifest;
    try {
      const input = {
        schema_version: CONTRACT_SCHEMA_VERSION,
        request_id: 'request:registry-manifest',
        provider_id: manifest.provider_id,
      };
      reportedManifest = validatePortResult('ModelProvider', 'manifest', provider.manifest(input), input);
    } catch (error) {
      throw new ProviderRegistryError('provider manifest could not be verified', 'MODEL_PROVIDER_MANIFEST_INVALID', {
        cause_code: error?.code || error?.error_code || 'unknown',
      });
    }
    if (!isDeepStrictEqual(reportedManifest, manifest)) {
      throw new ProviderRegistryError('registered manifest differs from provider manifest', 'MODEL_PROVIDER_MANIFEST_MISMATCH');
    }
    if (this.#providers.has(manifest.provider_id)) {
      throw new ProviderRegistryError('provider identifier is already registered', 'MODEL_PROVIDER_DUPLICATE', {
        provider_id: manifest.provider_id,
      });
    }
    this.#providers.set(manifest.provider_id, Object.freeze({ provider, manifest }));
    return manifest;
  }

  snapshot() {
    const entries = new Map(this.#providers);
    return Object.freeze({
      manifests: deepFreeze([...entries.values()].map((entry) => entry.manifest)),
      resolve(providerId, model) {
        const entry = entries.get(providerId);
        if (!entry) throw new ProviderRegistryError('provider is not present in this snapshot', 'MODEL_PROVIDER_NOT_FOUND');
        if (model !== undefined && !entry.manifest.models.includes(model)) {
          throw new ProviderRegistryError('model is not declared by the provider', 'MODEL_PROVIDER_MODEL_NOT_FOUND');
        }
        return entry;
      },
    });
  }
}

module.exports = { ModelProviderRegistry, ProviderRegistryError };
