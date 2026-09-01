'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareShadowDecision } = require('../../tools/managed-governance-control-plane/lib/application/compare-shadow-decision');

function shadow(decision) {
  return {
    schema_version: 1,
    decision,
    reason_code: `policy.${decision}`,
    policy_version: 'policy:v1',
    release_digest: `sha256:${'a'.repeat(64)}`,
    obligations: [],
    evidence: [],
    warnings: [],
  };
}

test('managed-shadow records a mismatch with both digests and preserves the local result', () => {
  const localResult = {
    allowed: true,
    requires_approval: false,
    policy_version: 'local:v1',
    warnings: [],
  };
  const comparison = compareShadowDecision({ localResult, shadowDecision: shadow('deny') });
  assert.deepEqual(comparison.result, localResult);
  assert.equal(comparison.authoritative_source, 'local');
  assert.equal(comparison.parity.matched, false);
  assert.equal(comparison.mismatch.local_digest, comparison.parity.local_digest);
  assert.equal(comparison.mismatch.shadow_digest, comparison.parity.shadow_digest);
  assert.match(comparison.mismatch.local_digest, /^sha256:[a-f0-9]{64}$/);
});

test('managed-shadow reports semantic parity without creating mismatch evidence', () => {
  const localResult = { allowed: false, requires_approval: false, policy_version: 'local:v1', warnings: [] };
  const comparison = compareShadowDecision({ localResult, shadowDecision: shadow('deny') });
  assert.equal(comparison.parity.matched, true);
  assert.equal(comparison.mismatch, null);
  assert.deepEqual(comparison.result, localResult);
});

test('approval-required local results map to input_required without changing authority', () => {
  const localResult = { allowed: true, requires_approval: true, policy_version: 'local:v1', warnings: [] };
  const comparison = compareShadowDecision({ localResult, shadowDecision: shadow('input_required') });
  assert.equal(comparison.parity.matched, true);
  assert.equal(comparison.parity.local_decision, 'input_required');
  assert.equal(comparison.authoritative_source, 'local');
});
