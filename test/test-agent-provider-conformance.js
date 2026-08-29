'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { loadCapabilityCatalog } = require('../tools/cli/lib/capability-catalog');
const {
  AgentProviderConformanceError,
  PROFILE_CONTRACTS,
  PROVIDER_SPECS,
  buildAgentProviderConformance,
  captureConformanceArtifact,
  defaultRunner,
  inventory,
  runOpenedSuite,
} = require('../tools/lib/agent-provider-conformance');

const ROOT = path.join(__dirname, '..');
const PASS_FIXTURE = 'test/fixtures/provider-conformance-pass.js';
const FAIL_FIXTURE = 'test/fixtures/provider-conformance-fail.js';

test('provider inventory binds every exact profile, component and provider without phantom models', () => {
  const result = inventory(ROOT);
  const expectedProfiles = PROFILE_CONTRACTS.map((profile) => ({
    ...profile,
    secret_refs: [...profile.secret_refs],
    provider_components: [...profile.provider_components].sort(),
  })).sort((left, right) => left.profile_id.localeCompare(right.profile_id));
  assert.deepEqual(result.profiles, expectedProfiles);
  assert.deepEqual(
    result.providers.map((provider) => provider.provider_id),
    PROVIDER_SPECS.map((provider) => provider.provider_id),
  );
  assert.equal(
    result.providers.some((provider) => provider.provider_id === 'model:delegated-runtime'),
    false,
  );
  assert.equal(result.providers.filter((provider) => provider.binding_template).length, 4);
});

test('swapping Codex and Claude providers between profiles fails before suite execution', () => {
  const catalog = structuredClone(loadCapabilityCatalog(ROOT));
  const codex = catalog.profiles['agent-codex-delegated-candidate'].agent;
  const claude = catalog.profiles['agent-claude-delegated-candidate'].agent;
  [codex.runtime_provider_id, claude.runtime_provider_id] = [claude.runtime_provider_id, codex.runtime_provider_id];
  assert.throws(() => inventory(ROOT, PROVIDER_SPECS, () => catalog), /agent profile contract drifted/);
});

test('actual manifests and checked binding templates generate an honest provider matrix', () => {
  const report = buildAgentProviderConformance({ root: ROOT, verify: false });
  assert.equal(report.status, 'not-run');
  assert.equal(report.conformance_verified, false);
  assert.equal(report.operational_activation, false);
  const reference = report.providers.find((provider) => provider.provider_id === 'model:scripted-reference');
  const kernel = report.providers.find((provider) => provider.provider_id === 'runtime:hseos-kernel');
  assert.equal(reference.manifest.provider_type, 'model');
  assert.equal(kernel.provider_kind, 'kernel-runtime');
  assert.equal(kernel.manifest.contract, 'AgentRuntime');
  assert.equal(kernel.declared_conformance_level, null);
  for (const providerId of ['runtime:codex-app-server', 'runtime:claude-agent-sdk', 'runtime:deepseek-harness']) {
    const provider = report.providers.find((candidate) => candidate.provider_id === providerId);
    assert.equal(provider.manifest.provider_type, 'runtime');
    assert.equal(provider.declared_conformance_level, 'L0');
    assert.deepEqual(provider.manifest.capabilities, ['instructions']);
    assert.match(provider.binding_template.sha256, /^[a-f0-9]{64}$/);
  }
});

test('canonical local runner verifies only the canonical provider inventory', { timeout: 120_000 }, () => {
  const report = buildAgentProviderConformance({ root: ROOT, verify: true });
  assert.equal(report.status, 'passed');
  assert.equal(report.verification_mode, 'stable-local-process');
  assert.equal(report.conformance_verified, true);
  assert.equal(
    report.providers.every((provider) => provider.status === 'passed'),
    true,
  );
  assert.equal(
    report.providers.every((provider) => provider.contract_conformance_verified),
    true,
  );
  assert.equal(report.providers.find((provider) => provider.provider_id === 'runtime:codex-app-server').verified_conformance_level, 'L0');
  assert.equal(report.providers.find((provider) => provider.provider_id === 'runtime:hseos-kernel').verified_conformance_level, null);
});

test('certifying build rejects injected runners, provider specs and catalog loaders', () => {
  for (const injected of [
    { runner: defaultRunner },
    { provider_specs: PROVIDER_SPECS },
    { catalog_loader: loadCapabilityCatalog },
  ]) {
    assert.throws(
      () => buildAgentProviderConformance({ root: ROOT, verify: true, ...injected }),
      /unsupported keys/,
    );
  }
});

test('opened descriptor bytes are executed even when the pathname is replaced', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-provider-descriptor-'));
  const filename = path.join(directory, 'suite.js');
  const replacement = path.join(directory, 'replacement.js');
  fs.copyFileSync(path.join(ROOT, PASS_FIXTURE), filename);
  fs.copyFileSync(path.join(ROOT, FAIL_FIXTURE), replacement);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    fs.renameSync(replacement, filename);
    const result = runOpenedSuite(descriptor, filename, directory);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(directory, { recursive: true });
  }
});

test('suite mutation during execution invalidates its earlier hash', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-provider-conformance-'));
  const filename = path.join(directory, 'mutating-suite.js');
  fs.writeFileSync(
    filename,
    [
      "'use strict';",
      "const fs = require('node:fs');",
      "const { test } = require('node:test');",
      String.raw`test('mutates after load', () => { fs.appendFileSync(__filename, '\n// changed'); });`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  try {
    const suite = captureConformanceArtifact(directory, 'mutating-suite.js', 'conformance suite');
    const result = defaultRunner({ root: directory, suite });
    assert.equal(result.passed, false);
    assert.equal(result.artifact_stable, false);
    assert.notEqual(result.artifact_sha256, suite.sha256);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('provider manifest identity and binding-template drift fail closed', () => {
  const manifestDrift = PROVIDER_SPECS.map((spec, index) =>
    index === 0 ? { ...spec, manifest: () => ({ ...spec.manifest(ROOT), provider_id: 'model:drifted' }) } : spec,
  );
  assert.throws(() => inventory(ROOT, manifestDrift), AgentProviderConformanceError);
  const bindingDrift = PROVIDER_SPECS.map((spec) =>
    spec.provider_id === 'runtime:codex-app-server'
      ? { ...spec, binding_template: '.agents/activation/provider-bindings/claude-agent-sdk.example.yaml' }
      : spec,
  );
  assert.throws(() => inventory(ROOT, bindingDrift), AgentProviderConformanceError);
});
