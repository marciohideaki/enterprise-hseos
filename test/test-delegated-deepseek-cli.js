'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const yaml = require('yaml');

const agentCommand = require('../tools/cli/commands/agent');
const { resolveCapabilityPlan } = require('../tools/cli/lib/capability-catalog');
const { runSupervisedDelegatedDeepSeek } = require('../tools/cli/lib/delegated-deepseek-supervisor');
const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');

const ROOT = path.join(__dirname, '..');
const PROFILE = 'agent-deepseek-one-shot-candidate';
const SECRET = 'ephemeral-deepseek-fixture-secret';

function writeExecutable(filename, content) {
  fs.writeFileSync(filename, content, { encoding: 'utf8', mode: 0o700 });
  fs.chmodSync(filename, 0o700);
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-deepseek-supervisor-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'ai-jail-fixture');
  writeExecutable(
    binary,
    ['#!/bin/sh', 'while [ "$#" -gt 0 ]; do', '  if [ "$1" = "--" ]; then shift; exec "$@"; fi', '  shift', 'done', 'exit 64', ''].join(
      '\n',
    ),
  );
  const configDirectory = path.join(directory, '.hseos', 'config');
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(configDirectory, 'hseos.config.yaml'),
    yaml.stringify({
      sandbox: {
        provider: 'ai-jail',
        binary,
        required: true,
        default_profile: 'lockdown',
        profiles: {
          lockdown: {
            flags: ['--lockdown', '--no-save-config'],
            masks: ['.env', '.env.local', 'credentials.json', 'secrets.yml'],
            ro_maps: [],
            rw_maps: [],
            allow_tcp_ports: ['443'],
          },
        },
      },
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  const entrypoint = path.join(directory, 'fake-acp-process.js');
  const composition = path.join(configDirectory, 'deepseek-acp-tool-free.yaml');
  fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', 'fake-acp-process.js'), entrypoint);
  fs.copyFileSync(path.join(ROOT, '.agents', 'activation', 'provider-bindings', 'deepseek-acp-tool-free.example.yaml'), composition);
  const binding = path.join(configDirectory, 'deepseek-acp.yaml');
  fs.writeFileSync(
    binding,
    yaml.stringify({
      schema_version: 1,
      profile_id: PROFILE,
      runtime_provider_id: 'runtime:deepseek-harness',
      executable: process.execPath,
      entrypoint,
      composition,
      cwd: directory,
      env_names: ['DEEPSEEK_API_KEY', 'PATH'],
      secret_env_names: ['DEEPSEEK_API_KEY'],
      secret_refs: ['secret://deepseek/host-auth'],
      network_port: 443,
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  return { binary, binding, composition, directory, entrypoint };
}

function readiness(ok = true) {
  return async () => ({
    ok,
    provider: 'ai-jail',
    required: true,
    configured: true,
    checks: [{ id: 'fixture', ok, required: true }],
    warnings: [],
    errors: [],
  });
}

function cleanupState(state) {
  openExecutionLedgerFileFixture(state).cleanup();
}

test('DeepSeek capability plan selects the external runtime and no raw model implementation', () => {
  const plan = resolveCapabilityPlan({ root: ROOT, profile: PROFILE });
  assert.deepEqual(plan.materialization.selected_model_providers, ['model:delegated-runtime']);
  assert.deepEqual(plan.materialization.selected_runtime_providers, ['runtime:deepseek-harness']);
  assert.deepEqual(plan.materialization.secret_refs, ['secret://deepseek/host-auth']);
  assert.ok(plan.install_paths.includes('tools/cli/lib/delegated-deepseek-supervisor.js'));
  assert.ok(plan.install_paths.includes('packages/runtime-providers/'));
  assert.ok(!plan.install_paths.includes('packages/model-providers/'));
});

test('supervised DeepSeek profile completes one tool-free ACP turn under the fixed sandbox command', async (t) => {
  const project = fixture(t);
  let childEnvironment;
  const result = await runSupervisedDelegatedDeepSeek(
    {
      binding: project.binding,
      projectDir: project.directory,
      message: 'answer without effects',
      environment: { PATH: process.env.PATH, DEEPSEEK_API_KEY: SECRET, UNRELATED_SECRET: 'must-not-cross-boundary' },
    },
    {
      readinessCheck: readiness(),
      spawnImpl(binary, args, options) {
        assert.equal(binary, fs.realpathSync(project.binary));
        assert.deepEqual(args.slice(-3), ['--', process.execPath, path.join(ROOT, 'tools', 'cli', 'lib', 'delegated-deepseek-worker.js')]);
        childEnvironment = options.env;
        return spawn(binary, args, options);
      },
    },
  );
  try {
    assert.equal(result.status, 'completed');
    assert.equal(result.output, 'deepseek fixture answer');
    assert.equal(result.lifecycle, 'one_shot');
    assert.equal(result.operational, false);
    assert.deepEqual(Object.keys(childEnvironment).sort(), ['DEEPSEEK_API_KEY', 'HSEOS_DISABLE_UPDATE_CHECK', 'PATH']);
    const manifest = fs.readFileSync(path.join(result.state, 'delegated-deepseek.json'), 'utf8');
    assert.match(manifest, /sandbox:\/\/ai-jail\/lockdown\/sha256\/[a-f0-9]{64}/);
    assert.doesNotMatch(manifest, new RegExp(SECRET));
    assert.doesNotMatch(JSON.stringify(result), /must-not-cross-boundary/);
  } finally {
    cleanupState(result.state);
  }
});

test('sandbox readiness fails before reading the DeepSeek secret or launching a worker', async (t) => {
  const project = fixture(t);
  let secretReads = 0;
  let launches = 0;
  const environment = { PATH: process.env.PATH };
  Object.defineProperty(environment, 'DEEPSEEK_API_KEY', {
    enumerable: true,
    get() {
      secretReads += 1;
      return SECRET;
    },
  });
  await assert.rejects(
    () =>
      runSupervisedDelegatedDeepSeek(
        { binding: project.binding, projectDir: project.directory, environment },
        { readinessCheck: readiness(false), spawnImpl: () => void (launches += 1) },
      ),
    /readiness checks did not pass/,
  );
  assert.equal(secretReads, 0);
  assert.equal(launches, 0);
});

test('binding drift between authorization and worker execution fails before ACP spawn', async (t) => {
  const project = fixture(t);
  await assert.rejects(
    () =>
      runSupervisedDelegatedDeepSeek(
        {
          binding: project.binding,
          projectDir: project.directory,
          environment: { PATH: process.env.PATH, DEEPSEEK_API_KEY: SECRET },
        },
        {
          readinessCheck: readiness(),
          spawnImpl(binary, args, options) {
            fs.appendFileSync(project.composition, '\n');
            return spawn(binary, args, options);
          },
        },
      ),
    /binding changed after sandbox authorization/,
  );
});

test('public profile rejects unsupported lifecycle operations before execution', async () => {
  await assert.rejects(() => agentCommand.execute('resume', { profile: PROFILE, state: '/tmp/not-used' }), /supports only agent run/);
  await assert.rejects(() => agentCommand.execute('cancel', { profile: PROFILE, state: '/tmp/not-used' }), /supports only agent run/);
  await assert.rejects(
    () => agentCommand.execute('run', { profile: PROFILE, binding: '/tmp/not-used', createOnly: true }),
    /create-only is unavailable/,
  );
});

test('public supervisor rejects ACP assets outside the sandboxed project', async (t) => {
  const project = fixture(t);
  const document = yaml.parse(fs.readFileSync(project.binding, 'utf8'));
  document.entrypoint = path.join(ROOT, 'test', 'fixtures', 'fake-acp-process.js');
  fs.writeFileSync(project.binding, yaml.stringify(document), { encoding: 'utf8', mode: 0o600 });
  await assert.rejects(
    () =>
      runSupervisedDelegatedDeepSeek(
        { binding: project.binding, projectDir: project.directory, environment: { PATH: process.env.PATH, DEEPSEEK_API_KEY: SECRET } },
        { readinessCheck: readiness() },
      ),
    /entrypoint must be inside the sandboxed project/,
  );
});
