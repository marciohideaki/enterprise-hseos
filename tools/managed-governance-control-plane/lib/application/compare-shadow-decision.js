'use strict';

const {
  GovernanceDecisionSchema,
  canonicalize,
  deepFreeze,
  digestCanonical,
  parseContract,
} = require('../../../../packages/managed-governance-contracts');

function localOutcome(result) {
  if (['allow', 'deny', 'input_required'].includes(result?.decision)) return result.decision;
  if (result?.allowed === false) return 'deny';
  if (result?.requires_approval === true) return 'input_required';
  if (result?.allowed === true) return 'allow';
  throw new TypeError('local governance result has no supported outcome');
}

function compareShadowDecision({ localResult, shadowDecision }) {
  const canonicalLocal = canonicalize(localResult);
  if (Buffer.byteLength(canonicalLocal, 'utf8') > 256 * 1024) throw new TypeError('local governance result exceeds the shadow limit');
  const shadow = parseContract(GovernanceDecisionSchema, shadowDecision, 'shadow governance decision');
  const localDecision = localOutcome(localResult);
  const matched = localDecision === shadow.decision;
  const localDigest = digestCanonical(localResult);
  const shadowDigest = digestCanonical(shadow);
  return deepFreeze({
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
  });
}

module.exports = { compareShadowDecision, localOutcome };
