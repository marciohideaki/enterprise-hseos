'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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

function cliFailure(...args) {
  const result = spawnSync(process.execPath, [CLI, 'agent', ...args, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HSEOS_DISABLE_UPDATE_CHECK: '1' },
  });
  assert.notEqual(result.status, 0);
  return `${result.stdout}${result.stderr}`;
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

test('public delegated Codex CLI rejects create-only before spawning app-server', () => {
  const fixture = fixtureBinding();
  try {
    assert.match(
      cliFailure('run', '--profile', PROFILE, '--binding', fixture.binding, '--create-only'),
      /create-only is unavailable for the delegated Codex run-only profile/,
    );
    assert.equal(fs.existsSync(fixture.remote), false);
  } finally {
    fixture.cleanup();
  }
});

test('public delegated Codex run keeps the first turn attached to the newly created thread', () => {
  const fixture = fixtureBinding();
  const result = cli('run', '--profile', PROFILE, '--binding', fixture.binding, '--message', 'first turn');
  try {
    assert.equal(result.operation, 'run');
    assert.equal(result.status, 'completed');
    assert.equal(result.output, 'fixture answer');
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.remote, 'utf8')), {
      created: 1,
      resumed: 0,
      interrupted: 0,
      turns: 1,
      thread_id: 'codex-thread-1',
      selected_environment_received: false,
    });
  } finally {
    cleanupState(result.state);
    fixture.cleanup();
  }
});

test('public delegated Codex CLI rejects resume and cancel as unavailable capabilities', () => {
  const fixture = fixtureBinding();
  try {
    assert.match(
      cliFailure('resume', '--profile', PROFILE, '--state', fixture.directory, '--message', 'continue'),
      /profile supports only agent run/,
    );
    assert.match(
      cliFailure('cancel', '--profile', PROFILE, '--state', fixture.directory),
      /profile supports only agent run/,
    );
    assert.equal(fs.existsSync(fixture.remote), false);
  } finally {
    fixture.cleanup();
  }
});

test('delegated Codex run-only rejection takes precedence over lifecycle arguments', () => {
  const fixture = fixtureBinding();
  try {
    assert.match(
      cliFailure('resume', '--profile', PROFILE, '--binding', fixture.binding, '--state', fixture.directory, '--expected-sequence', '0'),
      /profile supports only agent run/,
    );
    assert.equal(fs.existsSync(fixture.remote), false);
  } finally {
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
  let result;
  try {
    result = cli('run', '--profile', PROFILE, '--binding', fixture.binding, '--message', 'inspect durable binding');
    const durable = fs.readFileSync(path.join(result.state, 'delegated-codex.json'), 'utf8');
    assert.equal(durable.includes('sensitive-runtime-only-value'), false);
    assert.equal(durable.includes('HSEOS_CODEX_TEST_VALUE'), true);
    assert.equal(JSON.parse(fs.readFileSync(fixture.remote, 'utf8')).selected_environment_received, true);
  } finally {
    if (result) cleanupState(result.state);
    if (prior === undefined) delete process.env.HSEOS_CODEX_TEST_VALUE;
    else process.env.HSEOS_CODEX_TEST_VALUE = prior;
    fixture.cleanup();
  }
});

test('public delegated Codex rejects resume before inspecting durable state', () => {
  const fixture = fixtureBinding();
  try {
    const absent = path.join(fixture.directory, 'does-not-exist');
    assert.match(
      cliFailure('resume', '--profile', PROFILE, '--state', absent, '--expected-sequence', '0', '--message', 'must not inspect'),
      /profile supports only agent run/,
    );
    assert.equal(fs.existsSync(fixture.remote), false);
  } finally {
    fixture.cleanup();
  }
});
