'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  OPERATIONAL_APPROVAL,
  resolveGovernancePolicy,
  wildcardMatch,
} = require('../../tools/managed-governance-control-plane/lib/domain/policy-resolver');

const RELEASE_DIGEST = `sha256:${'a'.repeat(64)}`;

function rule(ruleId, effect, overrides = {}) {
  return {
    schema_version: 1,
    rule_id: ruleId,
    organization_id: 'hideaki-solutions',
    kind: effect === 'allow' ? 'permission' : 'prohibition',
    subject: { actor_types: ['agent', 'human'], roles: [] },
    action: 'repository.push',
    resource: { type: 'repository', identifiers: [] },
    scope: {
      organizations: ['hideaki-solutions'],
      repositories: [],
      environments: [],
      branches: [],
      stacks: [],
      capabilities: [],
    },
    conditions: [],
    effect,
    priority: 500,
    obligations: [],
    enforcement_points: ['runtime'],
    source: { artifact_id: `policy:${ruleId}`, artifact_version: 1, locator: `governance:${ruleId}` },
    ...overrides,
  };
}

function candidate(governanceRule, precedence, exception = null) {
  return { rule: governanceRule, precedence, lifecycle_status: 'published', exception };
}

function request(actionClass = 'mutation', facts = {}) {
  return {
    organization_id: 'hideaki-solutions',
    actor: { type: 'agent', roles: ['developer'] },
    action: 'repository.push',
    resource: { type: 'repository', identifier: 'repository:enterprise-hseos' },
    scope: {
      repository: 'repository:enterprise-hseos',
      environment: 'production',
      branch: 'refs/heads/master',
      stack: 'node',
      capabilities: ['repository.write'],
    },
    facts,
    action_class: actionClass,
  };
}

function resolve(candidates, policyRequest = request()) {
  return resolveGovernancePolicy({
    candidates,
    request: policyRequest,
    policyVersion: 'policy:v1',
    releaseDigest: RELEASE_DIGEST,
    evaluatedAt: '2026-09-01T00:00:00.000Z',
  });
}

test('resolution is deterministic and a lower allow cannot widen a constitutional deny', () => {
  const candidates = [
    candidate(rule('project-allow', 'allow'), 'project-repository'),
    candidate(rule('constitution-deny', 'deny'), 'constitution'),
  ];
  const forward = resolve(candidates);
  const reverse = resolve(candidates.toReversed());
  assert.deepEqual(reverse, forward);
  assert.equal(forward.decision, 'deny');
  assert.equal(forward.reason_code, 'policy.deny');
  assert.deepEqual(
    forward.evidence.map((item) => item.reference),
    ['rule:constitution-deny', 'rule:project-allow'],
  );
});

test('same-precedence contradictions fail closed according to action class', () => {
  const candidates = [
    candidate(rule('same-allow', 'allow'), 'organization-policy'),
    candidate(rule('same-deny', 'deny'), 'organization-policy'),
  ];
  assert.equal(resolve(candidates).decision, 'deny');
  const readDecision = resolve(candidates, request('read'));
  assert.equal(readDecision.decision, 'input_required');
  assert.equal(readDecision.reason_code, 'policy.same_precedence_conflict');
});

test('only a current approved exception may explicitly widen a restrictive result', () => {
  const candidates = [
    candidate(rule('organization-deny', 'deny'), 'organization-policy'),
    candidate(rule('exception-allow', 'allow'), 'approved-exception', {
      status: 'approved',
      evidence_ref: 'exception:approved:1',
      expires_at: '2026-09-02T00:00:00.000Z',
    }),
  ];
  const decision = resolve(candidates);
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reason_code, 'policy.approved_exception');
  assert.ok(decision.evidence.some((item) => item.reference === 'exception:approved:1'));
  assert.throws(
    () => resolve([candidate(rule('unverified-exception', 'allow'), 'approved-exception')]),
    (error) => error.code === 'MANAGED_GOVERNANCE_POLICY_INVALID',
  );
  assert.throws(
    () =>
      resolve([
        candidate(rule('expired-exception', 'allow'), 'approved-exception', {
          status: 'approved',
          evidence_ref: 'exception:expired',
          expires_at: '2026-08-31T00:00:00.000Z',
        }),
      ]),
    (error) => error.code === 'MANAGED_GOVERNANCE_POLICY_INVALID',
  );
});

test('governance acceptance never satisfies an operational approval obligation', () => {
  const approvalRule = rule('approval-required', 'allow', {
    obligations: [{ code: OPERATIONAL_APPROVAL, parameters: { channel: 'interactive' } }],
  });
  const decision = resolve(
    [candidate(approvalRule, 'organization-policy')],
    request('mutation', { governance_acceptance: 'accepted', target: 'refs/heads/master' }),
  );
  assert.equal(decision.decision, 'input_required');
  assert.equal(decision.reason_code, 'policy.operational_approval_required');
  assert.deepEqual(decision.obligations, approvalRule.obligations);
});

test('scope, pure predicates and bounded wildcard matching select only exact candidates', () => {
  const matching = rule('condition-match', 'allow', {
    resource: { type: 'repository', identifiers: ['repository:*'] },
    scope: {
      organizations: ['hideaki-solutions'],
      repositories: ['repository:*'],
      environments: ['production'],
      branches: ['refs/heads/master'],
      stacks: ['node'],
      capabilities: ['repository.write'],
    },
    conditions: [
      { field: 'change.kind', operator: 'equals', value: 'documentation' },
      { field: 'change.path', operator: 'matches', value: 'docs/*.md' },
    ],
  });
  const decision = resolve(
    [candidate(matching, 'project-repository')],
    request('mutation', { change: { kind: 'documentation', path: 'docs/guide.md' } }),
  );
  assert.equal(decision.decision, 'allow');
  assert.equal(wildcardMatch('docs/guide.md', 'docs/*.md'), true);
  assert.equal(wildcardMatch('src/guide.js', 'docs/*.md'), false);
});
