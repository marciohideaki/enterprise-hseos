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
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-codex-app-server.js');
const PROFILE = 'agent-codex-delegated-candidate';

function cli(...args) {
  return JSON.parse(
    execFileSync(process.execPath, [CLI, 'agent', ...args, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HSEOS_DISABLE_UPDATE_CHECK: '1',
        ...(process.env.HSEOS_CODEX_TEST_VALUE ? { HSEOS_CODEX_TEST_VALUE: process.env.HSEOS_CODEX_TEST_VALUE } : {}),
      },
    }).trim(),
  );
}

function fixtureBinding(mode = 'normal') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-codex-cli-'));
  const remote = path.join(directory, 'remote.json');
  const binding = path.join(directory, 'binding.yaml');
  fs.writeFileSync(
    binding,
    yaml.stringify({
      schema_version: 1,
      profile_id: PROFILE,
      runtime_provider_id: 'runtime:codex-app-server',
      executable: process.execPath,
      args: [FIXTURE, remote, mode],
      cwd: ROOT,
      env_names: [],
      secret_refs: [],
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  return { binding, directory, remote, cleanup: () => fs.rmSync(directory, { recursive: true }) };
}

function cleanupState(directory) {
  openExecutionLedgerFileFixture(directory).cleanup();
}

test('delegated Codex capability plan selects the direct runtime and no raw model implementation', () => {
  const plan = resolveCapabilityPlan({ root: ROOT, profile: PROFILE });
  assert.deepEqual(plan.materialization.selected_model_providers, ['model:delegated-runtime']);
  assert.deepEqual(plan.materialization.selected_runtime_providers, ['runtime:codex-app-server']);
  assert.deepEqual(plan.materialization.secret_refs, ['secret://codex/host-auth']);
  assert.ok(plan.install_paths.includes('packages/delegated-runtime-host/'));
  assert.ok(plan.install_paths.includes('packages/runtime-providers/'));
  assert.ok(plan.install_paths.includes('tools/cli/lib/delegated-codex-runtime.js'));
  assert.ok(!plan.install_paths.includes('packages/model-providers/'));
  assert.ok(!JSON.stringify(plan).includes('runtime:claude-code'));
  assert.ok(!JSON.stringify(plan).includes('runtime:deepseek-harness'));
});

test('public delegated Codex CLI creates and resumes the same remote thread across processes', () => {
  const fixture = fixtureBinding();
  const created = cli('run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    assert.equal(created.operation, 'created');
    assert.equal(created.status, 'active');
    assert.equal(created.terminal, false);
    const resumed = cli(
      'resume',
      '--profile',
      PROFILE,
      '--state',
      created.state,
      '--expected-sequence',
      String(created.current_sequence),
      '--message',
      'continue through app-server',
    );
    assert.equal(resumed.session_id, created.session_id);
    assert.equal(resumed.operation, 'resume-and-send');
    assert.equal(resumed.status, 'completed');
    assert.equal(resumed.output, 'fixture answer');
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.remote, 'utf8')), {
      created: 1,
      resumed: 1,
      interrupted: 0,
      turns: 1,
      thread_id: 'codex-thread-1',
      selected_environment_received: false,
    });
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});

test('public delegated Codex CLI reattaches and durably cancels an idle session', () => {
  const fixture = fixtureBinding();
  const created = cli('run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    const cancelled = cli('cancel', '--profile', PROFILE, '--state', created.state, '--reason', 'operator stop');
    assert.equal(cancelled.session_id, created.session_id);
    assert.equal(cancelled.operation, 'cancel');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.terminal, true);
    const remote = JSON.parse(fs.readFileSync(fixture.remote, 'utf8'));
    assert.equal(remote.created, 1);
    assert.equal(remote.resumed, 1);
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});

test('delegated Codex resume rejects stale optimistic state before app-server dispatch', () => {
  const fixture = fixtureBinding();
  const created = cli('run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    assert.throws(
      () =>
        cli(
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
    assert.equal(JSON.parse(fs.readFileSync(fixture.remote, 'utf8')).resumed, 0);
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});

test('delegated Codex durable manifest contains no resolved environment value', () => {
  const fixture = fixtureBinding();
  const document = yaml.parse(fs.readFileSync(fixture.binding, 'utf8'));
  document.env_names = ['HSEOS_CODEX_TEST_VALUE'];
  fs.writeFileSync(fixture.binding, yaml.stringify(document), { encoding: 'utf8', mode: 0o600 });
  const prior = process.env.HSEOS_CODEX_TEST_VALUE;
  process.env.HSEOS_CODEX_TEST_VALUE = 'sensitive-runtime-only-value';
  let created;
  try {
    created = cli('run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
    const durable = fs.readFileSync(path.join(created.state, 'delegated-codex.json'), 'utf8');
    assert.equal(durable.includes('sensitive-runtime-only-value'), false);
    assert.equal(durable.includes('HSEOS_CODEX_TEST_VALUE'), true);
    assert.equal(JSON.parse(fs.readFileSync(fixture.remote, 'utf8')).selected_environment_received, true);
  } finally {
    if (created) cleanupState(created.state);
    if (prior === undefined) delete process.env.HSEOS_CODEX_TEST_VALUE;
    else process.env.HSEOS_CODEX_TEST_VALUE = prior;
    fixture.cleanup();
  }
});

test('delegated Codex resume rejects manifest argument drift before remote reattachment', () => {
  const fixture = fixtureBinding();
  const created = cli('run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only');
  try {
    const filename = path.join(created.state, 'delegated-codex.json');
    const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
    manifest.args.push('--changed-after-create');
    fs.writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    assert.throws(
      () =>
        cli(
          'resume',
          '--profile',
          PROFILE,
          '--state',
          created.state,
          '--expected-sequence',
          String(created.current_sequence),
          '--message',
          'must not reach remote',
        ),
      /differs from the durable session binding/,
    );
    assert.equal(JSON.parse(fs.readFileSync(fixture.remote, 'utf8')).resumed, 0);
  } finally {
    cleanupState(created.state);
    fixture.cleanup();
  }
});
