'use strict';

const { createBoundModelProvider, validateBinding } = require('../../lib/agent-provider-binding');
const { createUnixSocketFetch, startProviderEgressBroker } = require('./provider-egress-broker');

function validateEngineeringBinding(value) {
  const binding = validateBinding(value);
  if (binding.transport.max_attempts !== 1)
    throw new Error('Engineering dispatch requires max_attempts: 1; uncertain provider attempts cannot restart the budget');
  return binding;
}

// The trusted worker receives a broker transport; executors receive neither this
// closure nor its socket directory. The existing broker alone authenticates egress.
function createEngineeringModel({ binding, deadline, environment = process.env, fetchImpl }) {
  binding = validateEngineeringBinding(binding);
  let broker;
  let transport;
  const model = createBoundModelProvider({
    binding,
    secret_resolver: async () => 'hseos-supervisor-owned-secret',
    fetch_impl: (...args) => {
      if (!transport) throw new Error('Engineering model transport has not been enabled');
      return transport(...args);
    },
  });
  return {
    snapshot: model.snapshot,
    async connect() {
      if (broker) return;
      const reference = binding.provider.secret_refs[0].source_ref;
      if (!/^env:\/\/[A-Z_][A-Z0-9_]*$/.test(reference)) throw new Error('Engineering bindings require an env secret reference');
      const name = reference.slice(6);
      const secret = Object.hasOwn(environment, name) ? environment[name] : undefined;
      if (typeof secret !== 'string' || secret.length === 0) throw new Error('Declared engineering provider credential is unavailable');
      const remaining = deadline - Date.now();
      if (remaining < 1) throw new Error('Engineering provider deadline exhausted');
      broker = await startProviderEgressBroker({
        baseUrl: binding.provider.base_url,
        secret,
        fetchImpl,
        timeoutMs: Math.min(remaining, 60_000),
      });
      transport = createUnixSocketFetch(broker.socketPath);
    },
    async close() {
      transport = null;
      await broker?.close();
    },
  };
}

module.exports = { createEngineeringModel, validateEngineeringBinding };
