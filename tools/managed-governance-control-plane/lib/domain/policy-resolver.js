'use strict';

const {
  GovernanceDecisionSchema,
  GovernanceRuleSchema,
  canonicalize,
  deepFreeze,
  digestCanonical,
  parseContract,
} = require('../../../../packages/managed-governance-contracts');

const PRECEDENCE = Object.freeze([
  'constitution',
  'organization-standard',
  'organization-policy',
  'portfolio-product',
  'project-repository',
  'environment',
  'protected-ref',
  'agent-authority',
  'activated-surface',
  'approved-exception',
]);
const ACTION_CLASSES = new Set(['read', 'mutation']);
const ACTOR_TYPES = new Set(['human', 'agent', 'automation', 'service']);
const OPERATIONAL_APPROVAL = 'operational.approval.required';

class PolicyResolutionError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_POLICY_INVALID', details = {}) {
    super(message);
    this.name = 'PolicyResolutionError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PolicyResolutionError(`${label} must be an object`);
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new PolicyResolutionError(`${label} contains unknown fields`, 'MANAGED_GOVERNANCE_POLICY_UNKNOWN_FIELD', {
      fields: unknown.sort(),
    });
  }
}

function boundedIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,159}$/.test(value)) {
    throw new PolicyResolutionError(`${label} is invalid`);
  }
  return value;
}

function boundedReference(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 1024) {
    throw new PolicyResolutionError(`${label} is invalid`);
  }
  return value;
}

function stringArray(value, label, maximum = 256) {
  if (!Array.isArray(value) || value.length > maximum) throw new PolicyResolutionError(`${label} is invalid`);
  const parsed = value.map((item) => boundedReference(item, label));
  if (new Set(parsed).size !== parsed.length) throw new PolicyResolutionError(`${label} contains duplicates`);
  return parsed;
}

function normalizeRequest(request) {
  exactKeys(request, ['organization_id', 'actor', 'action', 'resource', 'scope', 'facts', 'action_class'], 'policy request');
  exactKeys(request.actor, ['type', 'roles'], 'policy actor');
  exactKeys(request.resource, ['type', 'identifier'], 'policy resource');
  exactKeys(request.scope, ['repository', 'environment', 'branch', 'stack', 'capabilities'], 'policy scope');
  if (!ACTOR_TYPES.has(request.actor.type)) throw new PolicyResolutionError('policy actor type is invalid');
  if (!ACTION_CLASSES.has(request.action_class)) throw new PolicyResolutionError('policy action class is invalid');
  if (!request.facts || typeof request.facts !== 'object' || Array.isArray(request.facts)) {
    throw new PolicyResolutionError('policy facts must be an object');
  }
  let canonicalFacts;
  try {
    canonicalFacts = canonicalize(request.facts);
  } catch (error) {
    throw new PolicyResolutionError('policy facts are not canonical JSON', 'MANAGED_GOVERNANCE_POLICY_INVALID', {
      cause: error.code || null,
    });
  }
  if (Buffer.byteLength(canonicalFacts, 'utf8') > 256 * 1024) {
    throw new PolicyResolutionError('policy facts exceed the durable evaluation limit');
  }
  return deepFreeze({
    organization_id: boundedIdentifier(request.organization_id, 'organization id'),
    actor: { type: request.actor.type, roles: stringArray(request.actor.roles, 'actor roles', 64) },
    action: boundedIdentifier(request.action, 'action'),
    resource: {
      type: boundedIdentifier(request.resource.type, 'resource type'),
      identifier: boundedReference(request.resource.identifier, 'resource identifier'),
    },
    scope: {
      repository: boundedReference(request.scope.repository, 'scope repository', true),
      environment: boundedIdentifier(request.scope.environment, 'scope environment'),
      branch: boundedReference(request.scope.branch, 'scope branch', true),
      stack: boundedIdentifier(request.scope.stack, 'scope stack'),
      capabilities: stringArray(request.scope.capabilities, 'scope capabilities'),
    },
    facts: structuredClone(request.facts),
    action_class: request.action_class,
  });
}

function normalizeException(value, precedence, evaluatedAt) {
  if (value === null) {
    if (precedence === 'approved-exception') {
      throw new PolicyResolutionError('approved-exception rule requires verified approval evidence');
    }
    return null;
  }
  exactKeys(value, ['status', 'evidence_ref', 'expires_at'], 'policy exception');
  if (precedence !== 'approved-exception' || value.status !== 'approved') {
    throw new PolicyResolutionError('only approved-exception rules may carry exception evidence');
  }
  const expiresAt = Date.parse(value.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(evaluatedAt)) {
    throw new PolicyResolutionError('approved exception is expired or invalid');
  }
  return {
    status: value.status,
    evidence_ref: boundedReference(value.evidence_ref, 'exception evidence reference'),
    expires_at: new Date(expiresAt).toISOString(),
  };
}

function normalizeCandidates(candidates, evaluatedAt) {
  if (!Array.isArray(candidates) || candidates.length > 256) throw new PolicyResolutionError('policy candidates are invalid');
  const normalized = candidates.map((candidate, index) => {
    exactKeys(candidate, ['rule', 'precedence', 'lifecycle_status', 'exception'], `policy candidate ${index}`);
    const precedenceRank = PRECEDENCE.indexOf(candidate.precedence);
    if (precedenceRank === -1) throw new PolicyResolutionError(`policy candidate ${index} has invalid precedence`);
    if (candidate.lifecycle_status !== 'published') {
      throw new PolicyResolutionError(`policy candidate ${index} is not published`, 'MANAGED_GOVERNANCE_POLICY_SOURCE_INVALID');
    }
    const rule = parseContract(GovernanceRuleSchema, candidate.rule, `policy candidate ${index} rule`);
    return {
      rule,
      precedence: candidate.precedence,
      precedence_rank: precedenceRank,
      lifecycle_status: candidate.lifecycle_status,
      exception: normalizeException(candidate.exception, candidate.precedence, evaluatedAt),
    };
  });
  if (new Set(normalized.map((candidate) => candidate.rule.rule_id)).size !== normalized.length) {
    throw new PolicyResolutionError('policy rule ids must be unique');
  }
  return normalized;
}

function includesOrWildcard(values, actual) {
  return (
    values.length === 0 ||
    (actual !== null && values.some((candidate) => candidate === actual || (candidate.includes('*') && wildcardMatch(actual, candidate))))
  );
}

function wildcardMatch(value, pattern) {
  if (
    typeof value !== 'string' ||
    typeof pattern !== 'string' ||
    Buffer.byteLength(value, 'utf8') > 4096 ||
    Buffer.byteLength(pattern, 'utf8') > 256
  )
    return false;
  const rows = Array.from({ length: value.length + 1 }, () => new Uint8Array(pattern.length + 1));
  rows[0][0] = 1;
  for (let column = 1; column <= pattern.length; column += 1) {
    if (pattern[column - 1] === '*') rows[0][column] = rows[0][column - 1];
  }
  for (let row = 1; row <= value.length; row += 1) {
    for (let column = 1; column <= pattern.length; column += 1) {
      const token = pattern[column - 1];
      rows[row][column] =
        token === '*'
          ? rows[row][column - 1] || rows[row - 1][column]
          : (token === '?' || token === value[row - 1]) && rows[row - 1][column - 1];
    }
  }
  return rows[value.length][pattern.length] === 1;
}

function factAtPath(facts, field) {
  let value = facts;
  for (const segment of field.split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(segment) || !Object.hasOwn(value, segment)) {
      return { exists: false, value: undefined };
    }
    value = value[segment];
    if (value === null && segment !== field.split('.').at(-1)) return { exists: false, value: undefined };
  }
  return { exists: true, value };
}

function equalJson(left, right) {
  try {
    return canonicalize(left) === canonicalize(right);
  } catch {
    return false;
  }
}

function conditionMatches(condition, facts) {
  const actual = factAtPath(facts, condition.field);
  switch (condition.operator) {
    case 'exists': {
      return actual.exists;
    }
    case 'equals': {
      return actual.exists && equalJson(actual.value, condition.value);
    }
    case 'not_equals': {
      return actual.exists && !equalJson(actual.value, condition.value);
    }
    case 'in': {
      return actual.exists && condition.value.some((candidate) => equalJson(candidate, actual.value));
    }
    case 'not_in': {
      return actual.exists && condition.value.every((candidate) => !equalJson(candidate, actual.value));
    }
    case 'matches': {
      return actual.exists && wildcardMatch(actual.value, condition.value);
    }
    default: {
      return false;
    }
  }
}

function ruleMatches(rule, request) {
  const scope = rule.scope;
  return (
    rule.organization_id === request.organization_id &&
    rule.subject.actor_types.includes(request.actor.type) &&
    (rule.subject.roles.length === 0 || rule.subject.roles.some((role) => request.actor.roles.includes(role))) &&
    rule.action === request.action &&
    rule.resource.type === request.resource.type &&
    includesOrWildcard(rule.resource.identifiers, request.resource.identifier) &&
    includesOrWildcard(scope.organizations, request.organization_id) &&
    includesOrWildcard(scope.repositories, request.scope.repository) &&
    includesOrWildcard(scope.environments, request.scope.environment) &&
    includesOrWildcard(scope.branches, request.scope.branch) &&
    includesOrWildcard(scope.stacks, request.scope.stack) &&
    scope.capabilities.every((capability) => request.scope.capabilities.includes(capability)) &&
    rule.conditions.every((condition) => conditionMatches(condition, request.facts))
  );
}

function selectedEvidence(candidate) {
  return [
    {
      code: 'policy.rule.selected',
      reference: `rule:${candidate.rule.rule_id}`,
      digest: digestCanonical(candidate.rule),
    },
    ...(candidate.exception ? [{ code: 'policy.exception.approval', reference: candidate.exception.evidence_ref }] : []),
  ];
}

function decisionForMatches(matches, request) {
  if (matches.length === 0) return { decision: 'input_required', reason_code: 'policy.no_match' };
  const normal = matches.filter((candidate) => candidate.precedence !== 'approved-exception');
  const exceptions = matches.filter((candidate) => candidate.precedence === 'approved-exception');
  const levels = new Map();
  for (const candidate of matches) {
    const effects = levels.get(candidate.precedence) || new Set();
    effects.add(candidate.rule.effect);
    levels.set(candidate.precedence, effects);
  }
  if ([...levels.values()].some((effects) => effects.has('allow') && (effects.has('deny') || effects.has('input_required')))) {
    return {
      decision: request.action_class === 'mutation' ? 'deny' : 'input_required',
      reason_code: 'policy.same_precedence_conflict',
    };
  }
  let decision = normal.some((candidate) => candidate.rule.effect === 'deny')
    ? 'deny'
    : normal.some((candidate) => candidate.rule.effect === 'input_required')
      ? 'input_required'
      : normal.some((candidate) => candidate.rule.effect === 'allow')
        ? 'allow'
        : 'input_required';
  let reasonCode = `policy.${decision}`;
  if (exceptions.some((candidate) => candidate.rule.effect === 'deny')) {
    decision = 'deny';
    reasonCode = 'policy.exception_restricts';
  } else if (exceptions.some((candidate) => candidate.rule.effect === 'allow')) {
    decision = 'allow';
    reasonCode = 'policy.approved_exception';
  }
  const obligations = matches.flatMap((candidate) => candidate.rule.obligations);
  if (decision === 'allow' && obligations.some((obligation) => obligation.code === OPERATIONAL_APPROVAL)) {
    return { decision: 'input_required', reason_code: 'policy.operational_approval_required' };
  }
  return { decision, reason_code: reasonCode };
}

function resolveGovernancePolicy({ candidates, request, policyVersion, releaseDigest = null, evaluatedAt }) {
  const evaluated = new Date(evaluatedAt);
  if (Number.isNaN(evaluated.getTime())) throw new PolicyResolutionError('evaluatedAt is invalid');
  const normalizedRequest = normalizeRequest(request);
  const normalized = normalizeCandidates(candidates, evaluated.toISOString());
  const matches = normalized.filter((candidate) => ruleMatches(candidate.rule, normalizedRequest));
  matches.sort(
    (left, right) =>
      left.precedence_rank - right.precedence_rank ||
      right.rule.priority - left.rule.priority ||
      left.rule.rule_id.localeCompare(right.rule.rule_id),
  );
  const outcome = decisionForMatches(matches, normalizedRequest);
  const obligations = [];
  const obligationKeys = new Set();
  for (const candidate of matches) {
    for (const obligation of candidate.rule.obligations) {
      const key = canonicalize(obligation);
      if (!obligationKeys.has(key)) obligations.push(obligation);
      obligationKeys.add(key);
    }
  }
  const evidence = [];
  const evidenceKeys = new Set();
  for (const item of matches.flatMap(selectedEvidence)) {
    const key = canonicalize(item);
    if (!evidenceKeys.has(key)) evidence.push(item);
    evidenceKeys.add(key);
  }
  return parseContract(
    GovernanceDecisionSchema,
    {
      schema_version: 1,
      decision: outcome.decision,
      reason_code: outcome.reason_code,
      policy_version: boundedReference(policyVersion, 'policy version'),
      release_digest: releaseDigest,
      obligations,
      evidence,
      warnings: matches.length === 0 ? ['policy.no_match'] : [],
    },
    'governance decision',
  );
}

module.exports = {
  OPERATIONAL_APPROVAL,
  PRECEDENCE,
  PolicyResolutionError,
  conditionMatches,
  resolveGovernancePolicy,
  ruleMatches,
  wildcardMatch,
};
