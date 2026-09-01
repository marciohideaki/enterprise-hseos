'use strict';

const {
  GovernanceDecisionSchema,
  ManagedGovernanceBindingSchema,
  canonicalize,
  deepFreeze,
  digestCanonical,
  parseContract,
} = require('../managed-governance-contracts');

class ManagedGovernanceClientError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_CLIENT_INVALID') {
    super(message);
    this.name = 'ManagedGovernanceClientError';
    this.code = code;
  }
}

const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readBoundedJson(response) {
  const declared = response.headers?.get?.('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAXIMUM_RESPONSE_BYTES)) {
    throw new ManagedGovernanceClientError('response exceeds the client limit');
  }

  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let output = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ManagedGovernanceClientError('response exceeds the client limit');
      }
      output += decoder.decode(value, { stream: true });
    }
    text = output + decoder.decode();
  } else if (typeof response.text === 'function') {
    text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAXIMUM_RESPONSE_BYTES) {
      throw new ManagedGovernanceClientError('response exceeds the client limit');
    }
  } else {
    throw new ManagedGovernanceClientError('control-plane response body is unsupported');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ManagedGovernanceClientError('control-plane response is not valid JSON');
  }
}

function parseEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new ManagedGovernanceClientError('control-plane endpoint is invalid');
  }
  const loopbackHttp = endpoint.protocol === 'http:' && ['127.0.0.1', '::1'].includes(endpoint.hostname);
  if (
    (!loopbackHttp && endpoint.protocol !== 'https:') ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new ManagedGovernanceClientError('control-plane endpoint contract is invalid');
  }
  return endpoint.origin;
}

function localOutcome(result) {
  if (['allow', 'deny', 'input_required'].includes(result?.decision)) return result.decision;
  if (result?.allowed === false) return 'deny';
  if (result?.requires_approval === true) return 'input_required';
  if (result?.allowed === true) return 'allow';
  throw new ManagedGovernanceClientError('local governance result has no supported outcome');
}

function compare(localResult, shadowDecision) {
  const shadow = parseContract(GovernanceDecisionSchema, shadowDecision, 'shadow decision');
  const localDecision = localOutcome(localResult);
  const localDigest = digestCanonical(localResult);
  const shadowDigest = digestCanonical(shadow);
  const matched = localDecision === shadow.decision;
  return {
    mode: 'managed-shadow',
    authoritative_source: 'local',
    result: structuredClone(localResult),
    parity: {
      matched,
      local_decision: localDecision,
      shadow_decision: shadow.decision,
      local_digest: localDigest,
      shadow_digest: shadowDigest,
    },
    mismatch: matched
      ? null
      : {
          reason_code: 'managed_shadow.decision_mismatch',
          local_digest: localDigest,
          shadow_digest: shadowDigest,
          local_decision: localDecision,
          shadow_decision: shadow.decision,
        },
  };
}

function cachedDecision(snapshot, policyInput) {
  const requestDigest = digestCanonical(policyInput);
  const entries = snapshot.effective_scope?.cached_decisions;
  if (!Array.isArray(entries)) throw new ManagedGovernanceClientError('snapshot has no cached decision profile');
  const match = entries.find((entry) => entry?.request_digest === requestDigest);
  if (!match) throw new ManagedGovernanceClientError('snapshot does not cover this policy request');
  return parseContract(GovernanceDecisionSchema, match.decision, 'cached shadow decision');
}

function createManagedGovernanceClient(options) {
  if (!options || typeof options !== 'object') {
    throw new ManagedGovernanceClientError('client options are required');
  }
  const binding = parseContract(ManagedGovernanceBindingSchema, options.binding, 'managed governance binding');
  const expectedRepositoryId = options.repositoryId;
  if (binding.repository_id !== expectedRepositoryId) {
    throw new ManagedGovernanceClientError('binding identity mismatch', 'MANAGED_GOVERNANCE_IDENTITY_MISMATCH');
  }
  const bindingDigest = digestCanonical(binding);
  const endpoint = options.endpoint ? parseEndpoint(options.endpoint) : null;
  const snapshotStore = options.snapshotStore;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const clock = options.clock || (() => new Date());
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random || Math.random;
  const timeoutMs = options.timeoutMs ?? 1500;
  const maximumRetries = options.maximumRetries ?? 2;
  const circuitThreshold = options.circuitThreshold ?? 3;
  const circuitResetMs = options.circuitResetMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000)
    throw new ManagedGovernanceClientError('timeout is invalid');
  if (!Number.isSafeInteger(maximumRetries) || maximumRetries < 0 || maximumRetries > 4)
    throw new ManagedGovernanceClientError('retry bound is invalid');
  if (!Number.isSafeInteger(circuitThreshold) || circuitThreshold < 1 || circuitThreshold > 20)
    throw new ManagedGovernanceClientError('circuit threshold is invalid');
  if (!Number.isSafeInteger(circuitResetMs) || circuitResetMs < 100 || circuitResetMs > 300_000)
    throw new ManagedGovernanceClientError('circuit reset is invalid');
  if (typeof fetchImpl !== 'function' && endpoint) throw new ManagedGovernanceClientError('fetch implementation is unavailable');
  if (typeof clock !== 'function' || typeof sleep !== 'function' || typeof random !== 'function')
    throw new ManagedGovernanceClientError('client timing contract is invalid');
  let failures = 0;
  let openedAt = null;

  const now = () => {
    const value = clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new ManagedGovernanceClientError('client clock returned an invalid date');
    }
    return value.getTime();
  };

  const fallback = (localResult, policyInput, cause) => {
    try {
      const cached = snapshotStore.load({
        maximumAgeSeconds: binding.max_snapshot_age_seconds,
        repositoryId: binding.repository_id,
        bindingDigest,
      });
      const result = compare(localResult, cachedDecision(cached.snapshot, policyInput));
      return deepFreeze({ ...result, transport: { status: 'degraded_snapshot', cause, snapshot_digest: cached.digest } });
    } catch (error) {
      return deepFreeze({
        mode: 'managed-shadow',
        authoritative_source: 'local',
        result: structuredClone(localResult),
        parity: null,
        mismatch: null,
        transport: { status: 'degraded_unavailable', cause, snapshot_status: error.code || 'MANAGED_GOVERNANCE_SNAPSHOT_INVALID' },
      });
    }
  };

  async function online(policyInput) {
    let lastError;
    for (let attempt = 1; attempt <= maximumRetries + 1; attempt += 1) {
      const controller = new AbortController();
      let timer;
      try {
        const request = (async () => {
          const response = await fetchImpl(`${endpoint}/api/v1/policy/evaluate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: canonicalize(policyInput),
            signal: controller.signal,
          });
          return { response, envelope: await readBoundedJson(response) };
        })();
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ManagedGovernanceClientError('control-plane query timed out', 'MANAGED_GOVERNANCE_TIMEOUT'));
          }, timeoutMs);
        });
        const { response, envelope } = await Promise.race([request, timeout]);
        if (!response.ok || envelope?.schema_version !== 1 || envelope.ok !== true)
          throw new ManagedGovernanceClientError('control-plane query failed');
        const data = envelope.data;
        const decision = data?.decision && typeof data.decision === 'object' ? data.decision : data;
        if (data?.snapshot) snapshotStore.promote(data.snapshot, data.snapshot_digest || null);
        return { decision, attempts: attempt };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt <= maximumRetries) {
        const delay = Math.min(500, 25 * 2 ** (attempt - 1)) + Math.floor(random() * 10);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  async function resolveShadow({ localResult, policyInput }) {
    if (binding.mode === 'managed-enforced') {
      return deepFreeze({
        status: 'enforcement_unavailable',
        mode: binding.mode,
        authoritative_source: 'local',
        result: structuredClone(localResult),
        reason_code: 'managed_governance.enforcement_not_activated',
      });
    }
    if (binding.mode !== 'managed-shadow') {
      return deepFreeze({ status: 'portable', mode: binding.mode, authoritative_source: 'local', result: structuredClone(localResult) });
    }
    if (!endpoint || !snapshotStore) return fallback(localResult, policyInput, 'configuration_unavailable');
    if (openedAt !== null && now() - openedAt < circuitResetMs) return fallback(localResult, policyInput, 'circuit_open');
    try {
      const resolved = await online(policyInput);
      failures = 0;
      openedAt = null;
      return deepFreeze({
        ...compare(localResult, resolved.decision),
        transport: { status: 'online', attempts: resolved.attempts, circuit: 'closed' },
      });
    } catch {
      failures += 1;
      if (failures >= circuitThreshold) openedAt = now();
      return fallback(localResult, policyInput, openedAt === null ? 'query_failed' : 'circuit_opened');
    }
  }

  return Object.freeze({
    bindingDigest,
    getState: () => deepFreeze({ circuit: openedAt === null ? 'closed' : 'open', consecutive_failures: failures, opened_at: openedAt }),
    resolveShadow,
  });
}

module.exports = {
  ManagedGovernanceClientError,
  cachedDecision,
  createManagedGovernanceClient,
  localOutcome,
  parseEndpoint,
  readBoundedJson,
};
