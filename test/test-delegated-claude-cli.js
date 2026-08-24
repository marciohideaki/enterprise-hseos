'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const yaml = require('yaml');

const { resolveCapabilityPlan } = require('../tools/cli/lib/capability-catalog');
const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'cli', 'hseos-cli.js');
const SOURCE_SDK = path.join(__dirname, 'fixtures', 'fake-claude-agent-sdk.mjs');
const PROFILE = 'agent-claude-delegated-candidate';

function cli(environment, ...args) {
  return JSON.parse(
    execFileSync(process.execPath, [CLI, 'agent', ...args, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HSEOS_DISABLE_UPDATE_CHECK: '1', ...environment },
    }).trim(),
  );
}

function fixtureBinding() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-claude-cli-'));
  const remote = path.join(directory, 'remote.json');
  const sdkModule = path.join(directory, 'sdk.mjs');
  const binding = path.join(directory, 'binding.yaml');
  fs.copyFileSync(SOURCE_SDK, sdkModule);
  fs.writeFileSync(
    binding,
    yaml.stringify({
      schema_version: 1,
      profile_id: PROFILE,
      runtime_provider_id: 'runtime:claude-agent-sdk',
      sdk_module: sdkModule,
      executable: process.execPath,
      cwd: ROOT,
      env_names: ['HSEOS_CLAUDE_TEST_REMOTE'],
      secret_refs: [],
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  return {
    binding,
    directory,
    remote,
    sdkModule,
    environment: { HSEOS_CLAUDE_TEST_REMOTE: remote },
    cleanup: () => fs.rmSync(directory, { recursive: true }),
  };
}

function cleanupState(directory) {
  openExecutionLedgerFileFixture(directory).cleanup();
}

test('delegated Claude capability plan selects Agent SDK and no raw model implementation', () => {
  const plan = resolveCapabilityPlan({ root: ROOT, profile: PROFILE });
  assert.deepEqual(plan.materialization.selected_model_providers, ['model:delegated-runtime']);
  assert.deepEqual(plan.materialization.selected_runtime_providers, ['runtime:claude-agent-sdk']);
  assert.deepEqual(plan.materialization.secret_refs, ['secret://claude/host-auth']);
  assert.ok(plan.install_paths.includes('tools/cli/lib/delegated-claude-runtime.js'));
  assert.ok(plan.install_paths.includes('packages/runtime-providers/'));
  assert.ok(!plan.install_paths.includes('packages/model-providers/'));
  assert.ok(!JSON.stringify(plan).includes('runtime:codex-app-server'));
  assert.ok(!JSON.stringify(plan).includes('runtime:deepseek-harness'));
});

test('public delegated Claude CLI creates and materializes the same explicit SDK session across processes', () => {
  const fixture = fixtureBinding();
  const created = cli(fixture.environment, 'run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    assert.equal(created.operation, 'created');
    assert.equal(created.status, 'active');
    const resumed = cli(
      fixture.environment,
      'resume',
      '--profile',
      PROFILE,
      '--state',
      created.state,
      '--expected-sequence',
      String(created.current_sequence),
      '--message',
      'continue through Agent SDK',
    );
    assert.equal(resumed.session_id, created.session_id);
    assert.equal(resumed.operation, 'resume-and-send');
    assert.equal(resumed.status, 'completed');
    assert.equal(resumed.output, 'fixture answer');
    const remote = JSON.parse(fs.readFileSync(fixture.remote, 'utf8'));
    const remoteSession = Object.values(remote.sessions)[0];
    assert.equal(Object.keys(remote.sessions).length, 1);
    assert.equal(remoteSession.mode, 'new');
    assert.equal(remoteSession.isolated, true);
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});

test('public delegated Claude CLI reattaches and durably cancels an idle session', () => {
  const fixture = fixtureBinding();
  const created = cli(fixture.environment, 'run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    const cancelled = cli(fixture.environment, 'cancel', '--profile', PROFILE, '--state', created.state, '--reason', 'operator stop');
    assert.equal(cancelled.session_id, created.session_id);
    assert.equal(cancelled.operation, 'cancel');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.terminal, true);
    assert.equal(fs.existsSync(fixture.remote), false);
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});

test('delegated Claude resume rejects stale optimistic state before SDK dispatch', () => {
  const fixture = fixtureBinding();
  const created = cli(fixture.environment, 'run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    assert.throws(
      () =>
        cli(
          fixture.environment,
          'resume',
          '--profile',
          PROFILE,
          '--state',
          created.state,
          '--expected-sequence',
          String(created.current_sequence - 1),
          '--message',
          'stale',
        ),
      /expected_sequence does not match/,
    );
    assert.equal(fs.existsSync(fixture.remote), false);
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});

test('delegated Claude manifest persists environment names but never selected values', () => {
  const fixture = fixtureBinding();
  const document = yaml.parse(fs.readFileSync(fixture.binding, 'utf8'));
  document.env_names.push('HSEOS_CLAUDE_TEST_VALUE');
  fs.writeFileSync(fixture.binding, yaml.stringify(document), { encoding: 'utf8', mode: 0o600 });
  const environment = { ...fixture.environment, HSEOS_CLAUDE_TEST_VALUE: 'selected-runtime-value' };
  const created = cli(environment, 'run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    const resumed = cli(
      environment,
      'resume',
      '--profile',
      PROFILE,
      '--state',
      created.state,
      '--expected-sequence',
      String(created.current_sequence),
      '--message',
      'environment check',
    );
    const durable = fs.readFileSync(path.join(created.state, 'delegated-claude.json'), 'utf8');
    assert.equal(durable.includes('selected-runtime-value'), false);
    assert.equal(durable.includes('HSEOS_CLAUDE_TEST_VALUE'), true);
    const remoteSession = Object.values(JSON.parse(fs.readFileSync(fixture.remote, 'utf8')).sessions)[0];
    assert.equal(remoteSession.selected_environment_received, true);
    assert.equal(resumed.status, 'completed');
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});

test('delegated Claude resume rejects SDK module drift before reattachment', () => {
  const fixture = fixtureBinding();
  const created = cli(fixture.environment, 'run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    fs.appendFileSync(fixture.sdkModule, '\n// drift\n');
    assert.throws(
      () =>
        cli(
          fixture.environment,
          'resume',
          '--profile',
          PROFILE,
          '--state',
          created.state,
          '--expected-sequence',
          String(created.current_sequence),
          '--message',
          'must not dispatch',
        ),
      /external binding drifted/,
    );
    assert.equal(fs.existsSync(fixture.remote), false);
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});
