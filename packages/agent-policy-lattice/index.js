'use strict';

const { deepFreeze } = require('../agent-runtime-contracts');

const SOURCE_PRECEDENCE = Object.freeze([
  'runtime_default',
  'synced_plugin',
  'installed_plugin',
  'project',
  'user',
  'managed',
  'enterprise',
]);
const STAGE_PRECEDENCE = Object.freeze([
  'constitutional',
  'mandatory_hook',
  'deny',
  'ask',
  'execution_mode',
  'allow',
  'provider_callback',
  'governed_dispatch',
]);
const DECISIONS = new Set(['abstain', 'allow', 'ask', 'deny']);
const EXECUTION_MODES = new Set(['default', 'bypass', 'plan']);
const RULE_STAGES = new Set(['constitutional', 'mandatory_hook', 'deny', 'ask', 'allow']);

class AgentPolicyLatticeError extends Error {
  constructor(message, code = 'AGENT_POLICY_LATTICE_INVALID', details = {}) {
    super(message);
    this.name = 'AgentPolicyLatticeError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentPolicyLatticeError(`${label} must be an object`);
  }
}

function normalizeSource(source) {
  const rank = SOURCE_PRECEDENCE.indexOf(source);
  if (rank < 0) throw new AgentPolicyLatticeError(`unknown policy source: ${source}`);
  return rank;
}

function normalizeDecision(value, label) {
  if (!DECISIONS.has(value)) throw new AgentPolicyLatticeError(`${label} returned an invalid decision`);
  return value;
}

function normalizeRule(rule, index) {
  assertRecord(rule, `rule ${index}`);
  if (typeof rule.id !== 'string' || rule.id.length < 1 || rule.id.length > 256) {
    throw new AgentPolicyLatticeError(`rule ${index} has an invalid id`);
  }
  if (!RULE_STAGES.has(rule.stage)) throw new AgentPolicyLatticeError(`rule ${rule.id} has an invalid stage`);
  const decision = normalizeDecision(rule.decision, `rule ${rule.id}`);
  const fixedDecision = { deny: 'deny', ask: 'ask', allow: 'allow' }[rule.stage];
  if (fixedDecision && !['abstain', fixedDecision].includes(decision)) {
    throw new AgentPolicyLatticeError(`rule ${rule.id} has a decision incompatible with its stage`);
  }
  if (['constitutional', 'mandatory_hook'].includes(rule.stage) && !['abstain', 'ask', 'deny'].includes(decision)) {
    throw new AgentPolicyLatticeError(`rule ${rule.id} cannot grant authority from a protective stage`);
  }
  return deepFreeze({
    id: rule.id,
    source: rule.source,
    source_rank: normalizeSource(rule.source),
    stage: rule.stage,
    stage_rank: STAGE_PRECEDENCE.indexOf(rule.stage),
    decision,
    reason: typeof rule.reason === 'string' ? rule.reason.slice(0, 2048) : '',
  });
}

function evaluatePermissionLattice({ rules, execution_mode = 'default', provider_callback = null }) {
  if (!Array.isArray(rules)) throw new AgentPolicyLatticeError('rules must be an array');
  if (!EXECUTION_MODES.has(execution_mode)) throw new AgentPolicyLatticeError('execution_mode is invalid');
  const normalized = rules.map(normalizeRule);
  if (new Set(normalized.map((rule) => rule.id)).size !== normalized.length) throw new AgentPolicyLatticeError('rule ids must be unique');

  const ordered = [...normalized].sort(
    (left, right) => left.stage_rank - right.stage_rank || right.source_rank - left.source_rank || left.id.localeCompare(right.id),
  );
  const deny = ordered.find((rule) => rule.decision === 'deny');
  const ask = ordered.find((rule) => rule.decision === 'ask');
  const allow = ordered.find((rule) => rule.stage === 'allow' && rule.decision === 'allow');
  const modeDecision = execution_mode === 'bypass' ? 'allow' : execution_mode === 'plan' ? 'ask' : 'abstain';
  let decision = deny ? 'deny' : ask ? 'ask' : modeDecision === 'ask' ? 'ask' : allow || modeDecision === 'allow' ? 'allow' : 'ask';
  let decidingRule = deny || ask || allow || null;
  const traceRule = (rule) => ({ stage: rule.stage, source: rule.source, rule_id: rule.id, decision: rule.decision });
  const trace = ordered.filter((rule) => rule.stage !== 'allow').map(traceRule);
  trace.push({ stage: 'execution_mode', source: 'runtime_default', rule_id: `mode:${execution_mode}`, decision: modeDecision });
  trace.push(...ordered.filter((rule) => rule.stage === 'allow').map(traceRule));
  if (decision === 'allow' && provider_callback !== null) {
    if (typeof provider_callback !== 'function') throw new AgentPolicyLatticeError('provider_callback must be a function');
    const providerDecision = normalizeDecision(provider_callback(), 'provider callback');
    trace.push({ stage: 'provider_callback', source: 'runtime_default', rule_id: 'provider:callback', decision: providerDecision });
    if (providerDecision !== 'abstain') {
      decision = providerDecision;
      decidingRule = null;
    }
  }
  trace.push({
    stage: 'governed_dispatch',
    source: 'runtime_default',
    rule_id: 'dispatch:governed',
    decision: decision === 'allow' ? 'allow' : 'deny',
  });
  return deepFreeze({
    decision,
    dispatch_allowed: decision === 'allow',
    deciding_rule_id: decidingRule?.id || null,
    trace,
  });
}

function resolveConfiguration(entries) {
  if (!Array.isArray(entries)) throw new AgentPolicyLatticeError('configuration entries must be an array');
  const ordered = entries.map((entry, index) => {
    assertRecord(entry, `configuration entry ${index}`);
    if (
      typeof entry.key !== 'string' ||
      entry.key.length < 1 ||
      entry.key.length > 256 ||
      ['__proto__', 'prototype', 'constructor'].includes(entry.key)
    ) {
      throw new AgentPolicyLatticeError('configuration key is invalid');
    }
    return { ...entry, source_rank: normalizeSource(entry.source) };
  });
  const identities = ordered.map((entry) => `${entry.key}\0${entry.source}`);
  if (new Set(identities).size !== identities.length) {
    throw new AgentPolicyLatticeError('a configuration source may define each key only once');
  }
  const resolved = {};
  const provenance = {};
  for (const key of new Set(ordered.map((entry) => entry.key))) {
    const candidates = ordered.filter((entry) => entry.key === key).sort((a, b) => b.source_rank - a.source_rank);
    const kinds = new Set(candidates.map((entry) => entry.kind || 'replace'));
    if (kinds.size !== 1) throw new AgentPolicyLatticeError(`configuration key ${key} has incompatible merge kinds`);
    const kind = candidates[0].kind || 'replace';
    if (kind === 'replace') resolved[key] = structuredClone(candidates[0].value);
    else if (kind === 'deny_union') {
      for (const entry of candidates) assertStringArray(entry.value, `${key} deny list`);
      resolved[key] = [...new Set(candidates.flatMap((entry) => entry.value))].sort();
    } else if (kind === 'allow_intersection') {
      for (const entry of candidates) assertStringArray(entry.value, `${key} allow list`);
      const sets = candidates.map((entry) => new Set(entry.value));
      resolved[key] = [...sets[0]].filter((value) => sets.every((set) => set.has(value))).sort();
    } else if (kind === 'limit_min') {
      if (candidates.some((entry) => typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value < 0)) {
        throw new AgentPolicyLatticeError(`${key} limits must be finite non-negative numbers`);
      }
      resolved[key] = Math.min(...candidates.map((entry) => entry.value));
    } else throw new AgentPolicyLatticeError(`configuration key ${key} has an unknown merge kind`);
    provenance[key] = candidates.map((entry) => entry.source);
  }
  return deepFreeze({ values: resolved, provenance });
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 1024)) {
    throw new AgentPolicyLatticeError(`${label} must be an array of bounded strings`);
  }
}

function deriveChildAuthority(parent, requested) {
  assertRecord(parent, 'parent authority');
  assertRecord(requested, 'requested child authority');
  assertStringArray(parent.capabilities, 'parent capabilities');
  assertStringArray(requested.capabilities, 'requested child capabilities');
  const parentCapabilities = new Set(parent.capabilities || []);
  const requestedCapabilities = [...new Set(requested.capabilities || [])];
  const widened = requestedCapabilities.filter((capability) => !parentCapabilities.has(capability));
  if (widened.length > 0) {
    throw new AgentPolicyLatticeError('child authority exceeds its parent', 'AGENT_AUTHORITY_WIDENING', { capabilities: widened });
  }
  const parentLimit = parent.max_effects;
  const requestedLimit = requested.max_effects;
  if (!Number.isSafeInteger(parentLimit) || parentLimit < 0 || !Number.isSafeInteger(requestedLimit) || requestedLimit < 0) {
    throw new AgentPolicyLatticeError('authority limits must be non-negative safe integers');
  }
  if (requestedLimit > parentLimit) {
    throw new AgentPolicyLatticeError('child effect limit exceeds its parent', 'AGENT_AUTHORITY_WIDENING');
  }
  return deepFreeze({ capabilities: requestedCapabilities.sort(), max_effects: requestedLimit });
}

module.exports = {
  AgentPolicyLatticeError,
  SOURCE_PRECEDENCE,
  STAGE_PRECEDENCE,
  deriveChildAuthority,
  evaluatePermissionLattice,
  resolveConfiguration,
};
