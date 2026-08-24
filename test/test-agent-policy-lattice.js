'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AgentPolicyLatticeError,
  deriveChildAuthority,
  evaluatePermissionLattice,
  resolveConfiguration,
} = require('../packages/agent-policy-lattice');

test('constitutional and mandatory denies survive bypass mode and provider callbacks', () => {
  let callbackCalls = 0;
  const outcome = evaluatePermissionLattice({
    execution_mode: 'bypass',
    rules: [
      { id: 'project-allow', source: 'project', stage: 'allow', decision: 'allow' },
      { id: 'protected-deny', source: 'enterprise', stage: 'constitutional', decision: 'deny' },
    ],
    provider_callback() {
      callbackCalls += 1;
      return 'allow';
    },
  });
  assert.equal(outcome.decision, 'deny');
  assert.equal(outcome.dispatch_allowed, false);
  assert.equal(outcome.deciding_rule_id, 'protected-deny');
  assert.equal(callbackCalls, 0);
  assert.deepEqual(
    outcome.trace.map((entry) => entry.stage),
    ['constitutional', 'execution_mode', 'allow', 'governed_dispatch'],
  );
});

test('ask precedes mode, allow, and provider callback', () => {
  const outcome = evaluatePermissionLattice({
    execution_mode: 'bypass',
    rules: [
      { id: 'managed-hitl', source: 'managed', stage: 'ask', decision: 'ask' },
      { id: 'project-allow', source: 'project', stage: 'allow', decision: 'allow' },
    ],
    provider_callback: () => 'allow',
  });
  assert.equal(outcome.decision, 'ask');
  assert.equal(outcome.dispatch_allowed, false);
});

test('provider callback can narrow but never runs after a deny or ask', () => {
  const outcome = evaluatePermissionLattice({
    rules: [{ id: 'allow', source: 'enterprise', stage: 'allow', decision: 'allow' }],
    provider_callback: () => 'deny',
  });
  assert.equal(outcome.decision, 'deny');
  assert.equal(outcome.dispatch_allowed, false);
});

test('configuration precedence and restrictive merge kinds are deterministic', () => {
  const result = resolveConfiguration([
    { key: 'endpoint', source: 'project', value: 'project.example' },
    { key: 'endpoint', source: 'enterprise', value: 'managed.example' },
    { key: 'denied_tools', source: 'enterprise', kind: 'deny_union', value: ['shell'] },
    { key: 'denied_tools', source: 'project', kind: 'deny_union', value: ['network'] },
    { key: 'allowed_hosts', source: 'enterprise', kind: 'allow_intersection', value: ['a.test', 'b.test'] },
    { key: 'allowed_hosts', source: 'project', kind: 'allow_intersection', value: ['b.test', 'c.test'] },
    { key: 'max_turns', source: 'managed', kind: 'limit_min', value: 8 },
    { key: 'max_turns', source: 'project', kind: 'limit_min', value: 50 },
  ]);
  assert.deepEqual(result.values, {
    endpoint: 'managed.example',
    denied_tools: ['network', 'shell'],
    allowed_hosts: ['b.test'],
    max_turns: 8,
  });
  assert.deepEqual(result.provenance.endpoint, ['enterprise', 'project']);
});

test('child agents can narrow but cannot widen parent authority', () => {
  assert.deepEqual(deriveChildAuthority({ capabilities: ['read', 'write'], max_effects: 4 }, { capabilities: ['read'], max_effects: 2 }), {
    capabilities: ['read'],
    max_effects: 2,
  });
  assert.throws(
    () => deriveChildAuthority({ capabilities: ['read'], max_effects: 2 }, { capabilities: ['read', 'write'], max_effects: 2 }),
    (error) => error instanceof AgentPolicyLatticeError && error.code === 'AGENT_AUTHORITY_WIDENING',
  );
  assert.throws(
    () => deriveChildAuthority({ capabilities: ['read'], max_effects: 2 }, { capabilities: ['read'], max_effects: 3 }),
    (error) => error instanceof AgentPolicyLatticeError && error.code === 'AGENT_AUTHORITY_WIDENING',
  );
});

test('malformed modes, rules, configuration values, and authority fail closed', () => {
  assert.throws(() => evaluatePermissionLattice({ rules: [], execution_mode: 'unknown' }), AgentPolicyLatticeError);
  assert.throws(
    () =>
      evaluatePermissionLattice({
        rules: [
          { id: 'duplicate', source: 'enterprise', stage: 'allow', decision: 'allow' },
          { id: 'duplicate', source: 'project', stage: 'allow', decision: 'allow' },
        ],
      }),
    AgentPolicyLatticeError,
  );
  assert.throws(
    () => evaluatePermissionLattice({ rules: [{ id: 'mixed', source: 'project', stage: 'allow', decision: 'deny' }] }),
    AgentPolicyLatticeError,
  );
  assert.throws(
    () => evaluatePermissionLattice({ rules: [{ id: 'hook-grant', source: 'enterprise', stage: 'mandatory_hook', decision: 'allow' }] }),
    AgentPolicyLatticeError,
  );
  assert.throws(
    () => resolveConfiguration([{ key: 'denied', source: 'project', kind: 'deny_union', value: 'shell' }]),
    AgentPolicyLatticeError,
  );
  assert.throws(
    () => resolveConfiguration([{ key: 'limit', source: 'project', kind: 'limit_min', value: Number.NaN }]),
    AgentPolicyLatticeError,
  );
  assert.throws(
    () =>
      resolveConfiguration([
        { key: 'endpoint', source: 'project', value: 'one' },
        { key: 'endpoint', source: 'project', value: 'two' },
      ]),
    AgentPolicyLatticeError,
  );
  assert.throws(() => resolveConfiguration([{ key: '__proto__', source: 'project', value: { allow_all: true } }]), AgentPolicyLatticeError);
  assert.throws(
    () => deriveChildAuthority({ capabilities: 'read', max_effects: 2 }, { capabilities: ['read'], max_effects: 1 }),
    AgentPolicyLatticeError,
  );
});
