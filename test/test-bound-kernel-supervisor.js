'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const yaml = require('yaml');

const { runSupervisedBoundKernel } = require('../tools/cli/lib/bound-kernel-supervisor');
const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, '.agents', 'activation', 'provider-bindings', 'openai-compatible.example.yaml');
const CLI = path.join(ROOT, 'tools', 'cli', 'hseos-cli.js');
const SECRET = 'ephemeral-supervised-provider-secret';

function writeExecutable(filename, content) {
  fs.writeFileSync(filename, content, { encoding: 'utf8', mode: 0o700 });
  fs.chmodSync(filename, 0o700);
}

function fixture(t, { port = '443', endpoint = 'https://provider.fixture.invalid/v1' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-supervisor-'));
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
            allow_tcp_ports: [String(port)],
          },
        },
      },
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  const binding = yaml.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  binding.binding_id = 'provider-binding:supervised-fixture';
  binding.provider.base_url = endpoint;
  binding.provider.model = 'fixture/supervised';
  binding.transport.max_attempts = 1;
  binding.transport.retry_delay_ms = 0;
  const bindingPath = path.join(directory, 'binding.yaml');
  fs.writeFileSync(bindingPath, yaml.stringify(binding), { encoding: 'utf8', mode: 0o600 });
  return { binary, bindingPath, directory };
}

function readiness() {
  return async () => ({
    ok: true,
    provider: 'ai-jail',
    required: true,
    configured: true,
    checks: [{ id: 'fixture', ok: true, required: true }],
    warnings: [],
    errors: [],
  });
}

function cleanupState(state) {
  const handle = openExecutionLedgerFileFixture(state);
  handle.cleanup();
}

function sendSse(response, frames) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'supervisor-fixture' });
  for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`);
  response.end('data: [DONE]\n\n');
}

async function providerServer(t, observed) {
  const server = http.createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const body = JSON.parse(raw);
      observed.push({ authorization: request.headers.authorization, body, url: request.url });
      if (body.messages.at(-1).role === 'tool') {
        sendSse(response, [
          { choices: [{ delta: { content: 'supervised state persisted' }, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 8, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } } },
        ]);
        return;
      }
      sendSse(response, [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call:supervised-state',
                    function: { name: 'temporary.set-state', arguments: '{"value":"durable"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test('supervisor executes the complete provider/tool loop inside the fixed sandbox command', async (t) => {
  const observed = [];
  const port = await providerServer(t, observed);
  const project = fixture(t, { port, endpoint: `http://127.0.0.1:${port}/v1` });
  let childEnvironment;
  const result = await runSupervisedBoundKernel(
    'run',
    {
      bindingPath: project.bindingPath,
      projectDir: project.directory,
      value: 'durable',
      environment: {
        PATH: process.env.PATH,
        HSEOS_MODEL_PROVIDER_API_KEY: SECRET,
        UNRELATED_SECRET: 'must-not-cross-worker-boundary',
      },
    },
    {
      readinessCheck: readiness(),
      spawnImpl(binary, args, options) {
        assert.equal(binary, fs.realpathSync(project.binary));
        assert.deepEqual(args.slice(-3), ['--', process.execPath, path.join(ROOT, 'tools', 'cli', 'lib', 'bound-kernel-worker.js')]);
        childEnvironment = options.env;
        return spawn(binary, args, options);
      },
    },
  );
  try {
    assert.equal(result.status, 'completed');
    assert.equal(result.operational, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.world_state, 'utf8')), { schema_version: 1, value: 'durable' });
    assert.equal(observed.length, 2);
    assert.ok(observed.every((request) => request.authorization === `Bearer ${SECRET}`));
    assert.deepEqual(Object.keys(childEnvironment).sort(), ['HSEOS_DISABLE_UPDATE_CHECK', 'HSEOS_MODEL_PROVIDER_API_KEY', 'PATH']);
    assert.doesNotMatch(JSON.stringify(result), /must-not-cross-worker-boundary/);
    const manifest = fs.readFileSync(path.join(result.state, 'bound-kernel-agent.json'), 'utf8');
    assert.match(manifest, /sandbox:\/\/ai-jail\/lockdown\/sha256\/[a-f0-9]{64}/);
    assert.doesNotMatch(manifest, new RegExp(SECRET));
  } finally {
    cleanupState(result.state);
  }
});

test('supervisor reopens and cancels candidate sessions across sandboxed worker processes', async (t) => {
  const observed = [];
  const port = await providerServer(t, observed);
  const project = fixture(t, { port, endpoint: `http://127.0.0.1:${port}/v1` });
  const dependencies = { readinessCheck: readiness() };
  const created = await runSupervisedBoundKernel(
    'run',
    { bindingPath: project.bindingPath, createOnly: true, projectDir: project.directory },
    dependencies,
  );
  try {
    const resumed = await runSupervisedBoundKernel(
      'resume',
      {
        state: created.state,
        expectedSequence: created.current_sequence,
        message: 'continue under the same confinement',
        projectDir: project.directory,
        environment: { PATH: process.env.PATH, HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
      },
      dependencies,
    );
    assert.equal(resumed.session_id, created.session_id);
    assert.equal(resumed.status, 'completed');
  } finally {
    cleanupState(created.state);
  }

  const cancellable = await runSupervisedBoundKernel(
    'run',
    { bindingPath: project.bindingPath, createOnly: true, projectDir: project.directory },
    dependencies,
  );
  try {
    const cancelled = await runSupervisedBoundKernel(
      'cancel',
      { state: cancellable.state, reason: 'supervised cancellation', projectDir: project.directory },
      dependencies,
    );
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.terminal, true);
  } finally {
    cleanupState(cancellable.state);
  }
});

test('readiness failure happens before provider secret resolution or worker launch', async (t) => {
  const project = fixture(t);
  let secretReads = 0;
  let launches = 0;
  const environment = { PATH: process.env.PATH };
  Object.defineProperty(environment, 'HSEOS_MODEL_PROVIDER_API_KEY', {
    enumerable: true,
    get() {
      secretReads += 1;
      return SECRET;
    },
  });
  await assert.rejects(
    () =>
      runSupervisedBoundKernel(
        'run',
        { bindingPath: project.bindingPath, projectDir: project.directory, environment },
        {
          readinessCheck: async () => ({
            ok: false,
            provider: 'ai-jail',
            required: true,
            checks: [{ id: 'backend', ok: false, required: true }],
          }),
          spawnImpl() {
            launches += 1;
          },
        },
      ),
    /readiness checks did not pass/,
  );
  assert.equal(secretReads, 0);
  assert.equal(launches, 0);
});

test('resume rejects sandbox binary drift before model or tool effects', async (t) => {
  const project = fixture(t);
  const dependencies = { readinessCheck: readiness() };
  const created = await runSupervisedBoundKernel(
    'run',
    { bindingPath: project.bindingPath, createOnly: true, projectDir: project.directory },
    dependencies,
  );
  try {
    fs.appendFileSync(project.binary, '# upgraded fixture\n');
    await assert.rejects(
      () =>
        runSupervisedBoundKernel(
          'resume',
          {
            state: created.state,
            expectedSequence: created.current_sequence,
            message: 'must not execute after sandbox drift',
            projectDir: project.directory,
            environment: { PATH: process.env.PATH, HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
          },
          dependencies,
        ),
      /attestation differs from the durable session binding/,
    );
    assert.equal(fs.existsSync(path.join(created.state, 'workspace', 'world-state.json')), false);
  } finally {
    cleanupState(created.state);
  }
});

test('public candidate CLI fails closed when the real required sandbox doctor is not green', (t) => {
  const project = fixture(t);
  const result = spawnSync(
    process.execPath,
    [
      CLI,
      'agent',
      'run',
      '--profile',
      'agent-openai-compatible-candidate',
      '--binding',
      project.bindingPath,
      '--directory',
      project.directory,
      '--create-only',
      '--json',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: '', HSEOS_DISABLE_UPDATE_CHECK: '1', HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BOUND_KERNEL_SANDBOX_UNAVAILABLE/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(SECRET));
});
