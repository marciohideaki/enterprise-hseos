'use strict';

const { createHash } = require('node:crypto');
const { assertEffectiveBackend, parseProviderControlManifest } = require('../../lib/provider-control-manifest');
const { createBoundModelProvider, validateBinding } = require('../../lib/agent-provider-binding');
const { createUnixSocketFetch, startProviderEgressBroker } = require('./provider-egress-broker');

function credentialFingerprint(value) {
  return createHash('sha256').update('hseos-provider-credential-v1\0').update(value).digest('hex');
}

function authorizationOf(headers) {
  if (!headers) return;
  if (typeof headers.get === 'function') return headers.get('authorization') ?? undefined;
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  const found = entries.find(([name]) => String(name).toLowerCase() === 'authorization');
  return found ? String(found[1]) : undefined;
}

// Observes every request and every response inside the trusted worker. The credential hash comes from the
// Authorization header actually sent; the model comes from every SSE frame that names one. Bytes reach the broker
// unchanged, and a consumer that stops reading stops the tee with it.
function createProviderObserver({ declared, secret, upstreamFetch }) {
  const resolved = credentialFingerprint(secret);
  const state = { origin: null, models: new Set(), total: 0, verified: 0, credential_sha256: null, divergence: null };
  const fail = (code, message) => {
    const error = Object.assign(new Error(message), { code });
    state.divergence ??= error;
    throw error;
  };
  const check = (model) => {
    try {
      assertEffectiveBackend(declared, { origin: state.origin, model });
    } catch (error) {
      state.divergence ??= error;
      throw error;
    }
  };

  function observeBody(upstream) {
    if (!upstream?.body) return upstream;
    const source = upstream.body;
    const observed = (async function* () {
      const decoder = new TextDecoder('utf-8');
      let pending = '';
      let counted = false;
      const inspect = (line) => {
        line = line.trim();
        if (!line.startsWith('data:') || line.endsWith('[DONE]')) return;
        let frame;
        try {
          frame = JSON.parse(line.slice(5));
        } catch {
          return;
        }
        if (typeof frame?.model !== 'string') return;
        state.models.add(frame.model);
        check(frame.model);
        if (!counted) {
          counted = true;
          state.verified += 1;
        }
      };
      const feed = (text) => {
        pending += text;
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          inspect(line);
        }
        if (pending.length > 65_536) pending = '';
      };
      for await (const chunk of source) {
        feed(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
        yield chunk;
      }
      feed(decoder.decode());
      inspect(pending);
    })();
    return new Proxy(upstream, { get: (target, key) => (key === 'body' ? observed : Reflect.get(target, key)) });
  }

  return {
    async fetch(url, init) {
      state.origin = new URL(url).origin;
      state.total += 1;
      check(declared.model);
      const header = authorizationOf(init?.headers);
      const sent = typeof header === 'string' && header.startsWith('Bearer ') ? credentialFingerprint(header.slice(7)) : null;
      if (sent === null || sent !== resolved)
        fail('CONTROL_PROVIDER_IDENTITY_UNVERIFIED', 'The credential sent differs from the resolved credential');
      if (state.credential_sha256 !== null && state.credential_sha256 !== sent)
        fail('CONTROL_PROVIDER_CREDENTIAL_CONFLICT', 'The credential changed between requests');
      state.credential_sha256 = sent;
      return observeBody(await upstreamFetch(url, init));
    },
    proof(authentication) {
      if (state.divergence) throw state.divergence;
      const local = authentication === 'local';
      const models = [...state.models].sort();
      return {
        schema_version: 1,
        auth_mode: local ? 'local' : state.credential_sha256 ? 'credential' : 'not_observed',
        ...(local || !state.credential_sha256 ? {} : { credential_sha256: state.credential_sha256, credential_source: 'request-header' }),
        credential_pool: false,
        fallback: false,
        declared,
        observed: { origin: state.origin, models },
        requests_total: state.total,
        requests_verified: state.verified,
        backend_verified:
          state.total > 0 &&
          state.verified === state.total &&
          models.length === 1 &&
          models[0] === declared.model &&
          state.origin === declared.origin,
      };
    },
  };
}

function validateEngineeringBinding(value) {
  const binding = validateBinding(value);
  if (binding.transport.max_attempts !== 1)
    throw new Error('Engineering dispatch requires max_attempts: 1; uncertain provider attempts cannot restart the budget');
  return binding;
}

// The trusted worker receives a broker transport; executors receive neither this
// closure nor its socket directory. The existing broker alone authenticates egress.
// The authentication mode comes from the binding's pinned control manifest (route `local`), never from the address:
// a tunnel and a cluster DNS name must classify the same way.
function declaredAuthentication(binding, manifest) {
  if (manifest === undefined || manifest === null) return 'credential';
  const parsed = parseProviderControlManifest(manifest);
  if (parsed.binding_id !== binding.binding_id || parsed.provider_kind !== 'model')
    throw Object.assign(new Error('The control manifest does not describe this binding'), { code: 'CONTROL_PROVIDER_BINDING_DRIFT' });
  return parsed.authentication.mode === 'local' ? 'local' : 'credential';
}

function createEngineeringModel({ binding, deadline, environment = process.env, fetchImpl, manifest }) {
  binding = validateEngineeringBinding(binding);
  const authentication = declaredAuthentication(binding, manifest);
  let broker;
  let transport;
  const declared = { origin: new URL(binding.provider.base_url).origin, model: binding.provider.model };
  let observer;
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
      observer = createProviderObserver({
        declared,
        secret,
        upstreamFetch: fetchImpl ?? Reflect.get(globalThis, 'fetch'),
      });
      broker = await startProviderEgressBroker({
        baseUrl: binding.provider.base_url,
        secret,
        fetchImpl: observer.fetch,
        timeoutMs: Math.min(remaining, 60_000),
      });
      transport = createUnixSocketFetch(broker.socketPath);
    },
    // The adapter's own record: only hashes and observed values, never the secret. A divergence refuses here.
    proof: () =>
      observer
        ? observer.proof(authentication)
        : {
            schema_version: 1,
            auth_mode: authentication === 'local' ? 'local' : 'not_observed',
            credential_pool: false,
            fallback: false,
            declared,
            observed: { origin: null, models: [] },
            requests_total: 0,
            requests_verified: 0,
            backend_verified: false,
          },
    async close() {
      transport?.destroy?.();
      transport = null;
      await broker?.close();
    },
  };
}

module.exports = { createEngineeringModel, createProviderObserver, credentialFingerprint, validateEngineeringBinding };
