'use strict';

const { isDeepStrictEqual } = require('node:util');
const {
  CONTRACT_SCHEMA_VERSION,
  CompactionProviderManifestSchema,
  assertPortShape,
  deepFreeze,
  parseContract,
  validatePortResult,
} = require('../agent-runtime-contracts');

const SNAPSHOT_TOKEN = Symbol('CompactionProviderRegistrySnapshot');

class CompactionProviderRegistryError extends Error {
  constructor(message, code = 'COMPACTION_PROVIDER_REGISTRY_INVALID', details = {}) {
    super(message);
    this.name = 'CompactionProviderRegistryError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

class CompactionProviderRegistrySnapshot {
  #entries;

  constructor(entries, token) {
    if (token !== SNAPSHOT_TOKEN || !(entries instanceof Map)) {
      throw new CompactionProviderRegistryError('registry snapshots can be created only by the registry');
    }
    this.#entries = new Map(entries);
    Object.freeze(this);
  }

  get manifests() {
    return deepFreeze([...this.#entries.values()].map((entry) => entry.manifest));
  }

  resolve(providerId, strategy) {
    const entry = this.#entries.get(providerId);
    if (!entry) throw new CompactionProviderRegistryError('provider is absent from this snapshot', 'COMPACTION_PROVIDER_NOT_FOUND');
    if (strategy && !entry.manifest.strategies.includes(strategy)) {
      throw new CompactionProviderRegistryError('provider does not declare the strategy', 'COMPACTION_STRATEGY_NOT_FOUND');
    }
    return entry;
  }
}

Object.freeze(CompactionProviderRegistrySnapshot.prototype);

class CompactionProviderRegistry {
  #providers = new Map();

  register(provider, manifestValue) {
    assertPortShape('CompactionProvider', provider);
    const manifest = parseContract(CompactionProviderManifestSchema, manifestValue, 'compaction provider manifest');
    const input = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      request_id: 'request:compaction-registry-manifest',
      provider_id: manifest.provider_id,
    };
    let reported;
    try {
      reported = validatePortResult('CompactionProvider', 'manifest', provider.manifest(input), input);
    } catch (error) {
      throw new CompactionProviderRegistryError('provider manifest cannot be verified', 'COMPACTION_PROVIDER_MANIFEST_INVALID', {
        cause_code: error?.code || 'unknown',
      });
    }
    if (!isDeepStrictEqual(reported, manifest)) {
      throw new CompactionProviderRegistryError('registered and reported manifests differ', 'COMPACTION_PROVIDER_MANIFEST_MISMATCH');
    }
    if (this.#providers.has(manifest.provider_id)) {
      throw new CompactionProviderRegistryError('provider identifier is already registered', 'COMPACTION_PROVIDER_DUPLICATE');
    }
    // Capture bound functions now. A snapshot must not retain a live mutable
    // provider object whose methods can be replaced after registration.
    const sealedProvider = Object.freeze({
      manifest: provider.manifest.bind(provider),
      assess: provider.assess.bind(provider),
      compact: provider.compact.bind(provider),
      dispose: provider.dispose.bind(provider),
    });
    this.#providers.set(manifest.provider_id, Object.freeze({ provider: sealedProvider, manifest }));
    return manifest;
  }

  snapshot() {
    return new CompactionProviderRegistrySnapshot(this.#providers, SNAPSHOT_TOKEN);
  }
}

module.exports = { CompactionProviderRegistry, CompactionProviderRegistryError, CompactionProviderRegistrySnapshot };
