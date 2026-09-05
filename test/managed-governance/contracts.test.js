'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contracts = require('../../packages/managed-governance-contracts');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures');
const validFixtures = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'contracts-valid.json'), 'utf8'));
const invalidFixtures = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'contracts-invalid.json'), 'utf8'));

function clone(value) {
  return structuredClone(value);
}

function setAtPath(value, segments, replacement) {
  let target = value;
  for (const segment of segments.slice(0, -1)) target = target[segment];
  target[segments.at(-1)] = replacement;
}

function assertContractError(callback, label) {
  assert.throws(callback, (error) => {
    assert.equal(error.name, 'ManagedGovernanceContractError', label);
    assert.match(error.code, /^MANAGED_GOVERNANCE_/);
    assert.ok(Array.isArray(error.details.issues), label);
    return true;
  });
}

test('every valid fixture parses through its exported schema and is deeply frozen', () => {
  for (const [schemaName, fixture] of Object.entries(validFixtures)) {
    const schema = contracts[schemaName];
    assert.ok(schema, `${schemaName} must be exported`);
    const parsed = contracts.parseContract(schema, fixture, schemaName);
    assert.deepEqual(parsed, fixture);
    assert.ok(Object.isFrozen(parsed), `${schemaName} root must be frozen`);
    for (const nested of Object.values(parsed)) {
      if (nested && typeof nested === 'object') assert.ok(Object.isFrozen(nested), `${schemaName} nested value must be frozen`);
    }
  }
});

test('every invalid fixture fails closed with normalized contract evidence', () => {
  for (const invalid of invalidFixtures) {
    const value = clone(validFixtures[invalid.schema]);
    if (invalid.patch) Object.assign(value, invalid.patch);
    if (invalid.path) setAtPath(value, invalid.path, invalid.value);
    assertContractError(() => contracts.parseContract(contracts[invalid.schema], value, invalid.label), invalid.label);
  }
});

test('all top-level schemas reject unsupported versions and unknown fields', () => {
  for (const [schemaName, fixture] of Object.entries(validFixtures)) {
    assertContractError(
      () => contracts.parseContract(contracts[schemaName], { ...clone(fixture), schema_version: 2 }, schemaName),
      `${schemaName} version`,
    );
    assertContractError(
      () => contracts.parseContract(contracts[schemaName], { ...clone(fixture), unexpected: true }, schemaName),
      `${schemaName} unknown field`,
    );
  }
});

test('session preflight status, reason and parity fields cannot diverge', () => {
  const fixture = clone(validFixtures.ManagedGovernanceSessionPreflightSchema);
  assertContractError(
    () =>
      contracts.parseContract(
        contracts.ManagedGovernanceSessionPreflightSchema,
        { ...fixture, status: 'drift_detected' },
        'preflight reason mismatch',
      ),
    'preflight reason mismatch',
  );
  fixture.constitution.matched = false;
  assertContractError(
    () => contracts.parseContract(contracts.ManagedGovernanceSessionPreflightSchema, fixture, 'preflight parity mismatch'),
    'preflight parity mismatch',
  );
});

test('canonical JSON is lexically ordered and digest-stable', () => {
  const left = { z: 3, a: { y: true, x: [null, 'é'] } };
  const right = { a: { x: [null, 'é'], y: true }, z: 3 };
  const expected = '{"a":{"x":[null,"é"],"y":true},"z":3}';
  assert.equal(contracts.canonicalize(left), expected);
  assert.equal(contracts.canonicalize(right), expected);
  const expectedDigest = 'sha256:82f6dcd9737b3b2b33d9629b2305f85822f414671ad2cb621a2244fd4ee09fcd';
  assert.equal(contracts.digestCanonical(left), expectedDigest);
  assert.equal(contracts.digestCanonical(right), expectedDigest);
  assert.match(expectedDigest, /^sha256:[a-f0-9]{64}$/);
});

test('canonical JSON rejects lossy, executable and ambiguous JavaScript values', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  const extraArrayProperty = [];
  extraArrayProperty.extra = true;
  const symbolObject = { ok: true };
  symbolObject[Symbol('hidden')] = true;
  const accessorObject = {};
  Object.defineProperty(accessorObject, 'value', { enumerable: true, get: () => 'side-effect' });
  const hiddenObject = { ok: true };
  Object.defineProperty(hiddenObject, 'hidden', { enumerable: false, value: true });

  const rejected = [
    undefined,
    1n,
    Symbol('value'),
    () => true,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -0,
    Number.MAX_SAFE_INTEGER + 1,
    cyclic,
    sparse,
    extraArrayProperty,
    new Date(),
    symbolObject,
    accessorObject,
    hiddenObject,
    '\uD800',
  ];
  for (const value of rejected) {
    assert.throws(
      () => contracts.canonicalize(value),
      (error) => {
        assert.equal(error.name, 'CanonicalJsonError');
        assert.equal(error.code, 'MANAGED_GOVERNANCE_CANONICAL_JSON_INVALID');
        return true;
      },
    );
  }
});

test('identifier, raw content and structured content byte limits are enforced', () => {
  const artifact = clone(validFixtures.GovernanceArtifactSchema);
  artifact.artifact_id = 'a'.repeat(contracts.MAX_IDENTIFIER_BYTES);
  assert.doesNotThrow(() => contracts.parseContract(contracts.GovernanceArtifactSchema, artifact));
  artifact.artifact_id = 'a'.repeat(contracts.MAX_IDENTIFIER_BYTES + 1);
  assertContractError(() => contracts.parseContract(contracts.GovernanceArtifactSchema, artifact), 'identifier upper bound');

  const version = clone(validFixtures.ArtifactVersionSchema);
  version.raw_content = 'a'.repeat(contracts.MAX_RAW_CONTENT_BYTES);
  assert.doesNotThrow(() => contracts.parseContract(contracts.ArtifactVersionSchema, version));
  version.raw_content += 'a';
  assertContractError(() => contracts.parseContract(contracts.ArtifactVersionSchema, version), 'raw content upper bound');

  version.raw_content = '';
  version.structured_content = { value: 'a'.repeat(contracts.MAX_STRUCTURED_CONTENT_BYTES) };
  assertContractError(() => contracts.parseContract(contracts.ArtifactVersionSchema, version), 'structured content upper bound');
});

test('closed vocabularies reject semantic widening', () => {
  const cases = [
    ['GovernanceArtifactSchema', ['artifact_type'], 'custom-type'],
    ['GovernanceArtifactSchema', ['lifecycle_status'], 'active'],
    ['GovernanceRuleSchema', ['effect'], 'override'],
    ['GovernanceRuleSchema', ['enforcement_points'], ['mcp']],
    ['ManagedGovernanceBindingSchema', ['mode'], 'managed-auto'],
    ['GovernanceReleaseSchema', ['change_class'], 'silent'],
    ['GovernanceSessionLeaseSchema', ['enforcement_level'], 'bypass'],
    ['GovernanceDecisionSchema', ['decision'], 'abstain'],
    ['ImportPlanSchema', ['items', 0, 'action'], 'delete'],
  ];
  for (const [schemaName, fieldPath, invalidValue] of cases) {
    const value = clone(validFixtures[schemaName]);
    setAtPath(value, fieldPath, invalidValue);
    assertContractError(() => contracts.parseContract(contracts[schemaName], value), `${schemaName} closed vocabulary`);
  }
});

test('collection, timestamp and semantic-version boundaries are explicit', () => {
  const binding = clone(validFixtures.ManagedGovernanceBindingSchema);
  binding.trusted_key_ids = Array.from({ length: 32 }, (_, index) => `key-${index}`);
  assert.doesNotThrow(() => contracts.parseContract(contracts.ManagedGovernanceBindingSchema, binding));
  binding.trusted_key_ids.push('key-overflow');
  assertContractError(() => contracts.parseContract(contracts.ManagedGovernanceBindingSchema, binding), 'trusted key count');

  const artifactVersion = clone(validFixtures.ArtifactVersionSchema);
  artifactVersion.created_at = '2026-09-01';
  assertContractError(() => contracts.parseContract(contracts.ArtifactVersionSchema, artifactVersion), 'RFC 3339 timestamp');

  const release = clone(validFixtures.GovernanceReleaseSchema);
  for (const invalidVersion of ['01.0.0', '1.0', '1.0.0-01', '1.0.0+']) {
    release.runtime_min_version = invalidVersion;
    assertContractError(() => contracts.parseContract(contracts.GovernanceReleaseSchema, release), invalidVersion);
  }
  release.runtime_min_version = '1.2.3-rc.1+build.5';
  assert.doesNotThrow(() => contracts.parseContract(contracts.GovernanceReleaseSchema, release));
});

test('rule conditions enforce operator-specific data without executable expressions', () => {
  const base = clone(validFixtures.GovernanceRuleSchema);
  const validConditions = [
    { field: 'context.branch', operator: 'equals', value: 'main' },
    { field: 'context.tags', operator: 'in', value: ['protected'] },
    { field: 'context.owner', operator: 'exists' },
    { field: 'context.branch', operator: 'matches', value: '^release/' },
  ];
  base.conditions = validConditions;
  assert.doesNotThrow(() => contracts.parseContract(contracts.GovernanceRuleSchema, base));

  const invalidConditions = [
    { field: 'context.owner', operator: 'exists', value: true },
    { field: 'context.branch', operator: 'equals' },
    { field: 'context.tags', operator: 'in', value: 'protected' },
    { field: 'context.branch', operator: 'matches', value: ['release'] },
  ];
  for (const condition of invalidConditions) {
    const value = clone(validFixtures.GovernanceRuleSchema);
    value.conditions = [condition];
    assertContractError(() => contracts.parseContract(contracts.GovernanceRuleSchema, value), condition.operator);
  }
});

test('duplicate arrays, reversed time and unsafe paths fail closed', () => {
  const rule = clone(validFixtures.GovernanceRuleSchema);
  rule.enforcement_points = ['cli', 'cli'];
  assertContractError(() => contracts.parseContract(contracts.GovernanceRuleSchema, rule), 'duplicate enforcement point');

  const release = clone(validFixtures.GovernanceReleaseSchema);
  release.expires_at = '2026-08-01T00:00:00Z';
  assertContractError(() => contracts.parseContract(contracts.GovernanceReleaseSchema, release), 'release chronology');

  const version = clone(validFixtures.ArtifactVersionSchema);
  for (const unsafePath of ['/absolute.md', '../outside.md', String.raw`C:\outside.md`, '.enterprise//policy.md']) {
    version.source.path = unsafePath;
    assertContractError(() => contracts.parseContract(contracts.ArtifactVersionSchema, version), unsafePath);
  }
});

test('import reports must account for every discovered source', () => {
  const report = clone(validFixtures.ImportReportSchema);
  assert.doesNotThrow(() => contracts.parseContract(contracts.ImportReportSchema, report));

  report.counts.unclassified = 1;
  assertContractError(() => contracts.parseContract(contracts.ImportReportSchema, report), 'classification accounting');

  const missingItem = clone(validFixtures.ImportReportSchema);
  missingItem.items = [];
  assertContractError(() => contracts.parseContract(contracts.ImportReportSchema, missingItem), 'item accounting');
});

test('readiness report ready flag requires every readiness-algorithm condition, not just one', () => {
  const base = clone(validFixtures.ReadinessReportSchema);
  assert.doesNotThrow(() => contracts.parseContract(contracts.ReadinessReportSchema, base));

  const violations = [
    ['covered_sessions', 189],
    ['repositories_missing_evidence', ['7f9f9b79-638c-4138-9a29-8a2406ad9fb8']],
    ['adapters_missing_evidence', ['codex']],
    ['preflight_latency_p95_ms', 501],
    ['open_drift_count', 1],
    ['open_invalid_contract_count', 1],
    ['signer_evidence_current', false],
    ['recovery_evidence_current', false],
    ['threat_model_evidence_current', false],
    ['rollback_evidence_current', false],
  ];
  for (const [field, value] of violations) {
    const report = clone(base);
    report[field] = value;
    assertContractError(() => contracts.parseContract(contracts.ReadinessReportSchema, report), `ready report violation: ${field}`);
  }

  const notReady = clone(base);
  notReady.ready = false;
  notReady.open_drift_count = 3;
  assert.doesNotThrow(() => contracts.parseContract(contracts.ReadinessReportSchema, notReady), 'a non-ready report may report open findings');
});

test('managed network profile enforces deny-by-default admission for shared-network', () => {
  const base = clone(validFixtures.ManagedNetworkProfileSchema);
  assert.doesNotThrow(() => contracts.parseContract(contracts.ManagedNetworkProfileSchema, base));

  const loopback = { ...base, profile: 'loopback', listen_host: null, port: null, allowed_clients: [], transport: null, authentication: null, rate_limits: null };
  assert.doesNotThrow(() => contracts.parseContract(contracts.ManagedNetworkProfileSchema, loopback));

  for (const wildcard of ['0.0.0.0/0', '::/0']) {
    const widened = clone(base);
    widened.allowed_clients = [wildcard];
    assertContractError(() => contracts.parseContract(contracts.ManagedNetworkProfileSchema, widened), `wildcard CIDR ${wildcard}`);
  }

  for (const malformed of ['not-a-cidr', '192.168.5.0', '192.168.5.0/33', '192.168.5.0/-1']) {
    const invalid = clone(base);
    invalid.allowed_clients = [malformed];
    assertContractError(() => contracts.parseContract(contracts.ManagedNetworkProfileSchema, invalid), `malformed CIDR ${malformed}`);
  }

  const noAllowlist = clone(base);
  noAllowlist.allowed_clients = [];
  assertContractError(() => contracts.parseContract(contracts.ManagedNetworkProfileSchema, noAllowlist), 'empty allowlist on shared-network');

  const missingControls = clone(base);
  missingControls.transport = null;
  assertContractError(() => contracts.parseContract(contracts.ManagedNetworkProfileSchema, missingControls), 'shared-network without transport');
});

test('contract parser normalizes schema evaluation failures without leaking values', () => {
  const explodingSchema = {
    safeParse() {
      throw new Error('internal parser failure');
    },
  };
  assert.throws(
    () => contracts.parseContract(explodingSchema, { token: 'must-not-appear' }, 'exploding'),
    (error) => {
      assert.equal(error.code, 'MANAGED_GOVERNANCE_SCHEMA_EVALUATION_FAILED');
      assert.equal(error.details.cause, 'internal parser failure');
      assert.doesNotMatch(JSON.stringify(error), /must-not-appear/);
      return true;
    },
  );
});
