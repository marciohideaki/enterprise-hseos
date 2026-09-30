'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const yaml = require('yaml');
const profile = require('../packages/runtime-providers/codex-acp-profile.json');
const compositionApi = require('../packages/runtime-providers/codex-acp-composition');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const { manifest } = require('./helpers/provider-control');
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const value = Object.fromEntries(['binary', 'agent', 'catalog', 'home', 'cwd', 'auth_source'].map((k) => [k, path.join(root, k)]));
  for (const dir of [value.home, value.cwd]) fs.mkdirSync(dir, { mode: 0o700 });
  fs.writeFileSync(value.binary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(value.agent, 'fixture agent');
  // Test-owned pins only: production pins and native binaries are never changed on disk.
  for (const key of ['binary', 'agent']) {
    const original = profile.sha256[key];
    profile.sha256[key] = sha(value[key]);
    t.after(() => {
      profile.sha256[key] = original;
    });
  }
  value.auth_source = path.join(root, 'auth.json');
  fs.writeFileSync(value.auth_source, '{}');
  fs.symlinkSync(value.auth_source, path.join(value.home, 'auth.json'));
  value.model = 'pinned';
  fs.writeFileSync(
    value.catalog,
    JSON.stringify({
      models: [
        {
          slug: value.model,
          apply_patch_tool_type: null,
          shell_type: 'disabled',
          supports_search_tool: false,
          tool_mode: 'direct',
          node_repl_disabled: true,
          multi_agent_version: null,
          multi_agent_reasoning_effort: null,
          experimental_supported_tools: [],
          include_skills_usage_instructions: false,
          include_plugin_usage_instructions: false,
          include_apps_usage_instructions: false,
        },
      ],
    }),
  );
  value.catalog_sha256 = sha(value.catalog);
  const filename = path.join(root, 'composition.json');
  fs.writeFileSync(filename, JSON.stringify(value));
  return { root, value, filename, write: () => fs.writeFileSync(filename, JSON.stringify(value)) };
}
test('composition rejects replaced artifacts, aliases, ambient configuration and credential redirection', (t) => {
  const f = fixture(t);
  const proof = compositionApi.validateRestrictedComposition(f.value);
  assert.equal(proof.effect_boundary, 'instructions_only');
  assert.match(proof.evidence_ref, /^sha256:[a-f0-9]{64}$/);
  for (const patch of [null, { extra: true }, { binary: 'relative' }, { catalog_sha256: '0'.repeat(64) }, { auth_source: '/another' }])
    assert.throws(() => compositionApi.validateRestrictedComposition(patch === null ? null : { ...f.value, ...patch }));
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.value.binary, alias);
  assert.throws(() => compositionApi.validateRestrictedComposition({ ...f.value, binary: alias }));
  fs.appendFileSync(f.value.agent, ' drift');
  assert.throws(() => compositionApi.validateRestrictedComposition(f.value));
  fs.chmodSync(f.value.cwd, 0o755);
  assert.throws(() => compositionApi.validateRestrictedDirectories(f.value.home, f.value.cwd));
});
function adapterFixture(t) {
  const f = fixture(t),
    taskId = randomUUID();
  const binding = {
    schema_version: 1,
    profile_id: 'agent-codex-delegated-candidate',
    runtime_provider_id: 'runtime:codex-app-server',
    executable: process.execPath,
    cwd: f.root,
    env_names: [],
    secret_refs: [],
    args: ['app-server', '--listen', 'stdio://'],
  };
  const nativePath = path.join(f.root, 'native.yaml');
  fs.writeFileSync(nativePath, yaml.stringify(binding));
  const nativeOptions = {
    model: f.value.model,
    tasks: { [taskId]: { prompt: 'READY' } },
    environment: { HOME: f.root, CODEX_HOME: f.root, PATH: '/usr/bin' },
  };
  const options = { native_binding: nativePath, native_options: nativeOptions };
  const m = manifest('codex', 'account', 'client');
  const { createAcpCampaignAdapter, acpArtifactDigest } = require('../tools/cli/lib/provider-acp-adapter');
  m.adapter = 'hseos-codex-acp-campaign-v1';
  m.authentication.credential.source_ref = `file://${f.value.auth_source}`;
  m.authentication.account_sha256 = engineeringDigest({ type: 'chatgpt', email: 'fixture@example.invalid' });
  const pin = () => {
    m.artifact_sha256 = acpArtifactDigest();
    m.binding_sha256 = engineeringDigest({
      composition: f.value,
      nativeBinding: require('../tools/cli/lib/delegated-codex-runtime').readBinding(nativePath),
      options,
    });
  };
  pin();
  const report = {
    version: 'codex-cli 1.0.0',
    identity: { account: { type: 'chatgpt', email: 'fixture@example.invalid' } },
    quota: {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 20, resetsAt: Math.ceil(Date.now() / 1000) + 60 },
        credits: { hasCredits: false, unlimited: false },
      },
    },
  };
  const receipt = {
    completed: true,
    cancelled: false,
    usage: { totalTokens: 4, inputTokens: 3, outputTokens: 1 },
    provider_session_id: 'session-1',
    effect_boundary_ref: compositionApi.validateRestrictedComposition(f.value).evidence_ref,
  };
  const calls = [];
  const create = () =>
    createAcpCampaignAdapter(
      { manifest: m, binding: f.filename, options },
      {
        processRunner: async (args) => {
          calls.push(args);
          return args.input.operation === 'inspect' ? structuredClone(report) : structuredClone(receipt);
        },
      },
    );
  return { ...f, m, report, receipt, create, pin, calls, taskId, nativeOptions };
}
test('ACP campaign re-inspects identity before every effect and preserves resume and usage', async (t) => {
  const f = adapterFixture(t),
    a = f.create().adapter;
  const inspected = await a.inspect();
  assert.equal(inspected.binding_sha256, f.m.binding_sha256);
  const result = await a.run({ task_id: f.taskId, resume_session_id: 'session-1' });
  assert.equal(result.status, 'completed');
  assert.equal(result.cost_microusd, null);
  assert.equal(result.input_tokens, 3);
  assert.equal(f.calls.at(-1).input.resume_session_id, 'session-1');
  await assert.rejects(a.run({ task_id: randomUUID() }), { code: 'CONTROL_CAMPAIGN_SCOPE_DENIED' });
  f.report.quota.rateLimits.primary.usedPercent = 100;
  await assert.rejects(a.run({ task_id: f.taskId }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  f.report.quota.rateLimits.primary.usedPercent = 20;
  f.report.identity.account.email = 'changed@example.invalid';
  await assert.rejects(a.run({ task_id: f.taskId }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  f.report.identity.account.email = 'fixture@example.invalid';
  for (const patch of [{ completed: false }, { cancelled: true }, { effect_boundary_ref: 'sha256:wrong' }]) {
    const old = { ...f.receipt };
    Object.assign(f.receipt, patch);
    await assert.rejects(a.run({ task_id: f.taskId }), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
    Object.assign(f.receipt, old);
  }
  f.m.billing.max_request_microusd = 1;
  assert.throws(f.create, { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  f.m.billing.max_request_microusd = 0;
  f.nativeOptions.tasks[f.taskId].prompt = '/logout';
  f.pin();
  await assert.rejects(f.create().adapter.run({ task_id: f.taskId }), { code: 'CONTROL_CAMPAIGN_SCOPE_DENIED' });
  f.value.model = 'changed';
  f.write();
  await assert.rejects(a.inspect());
});
function workerFixture(t) {
  const f = fixture(t);
  const request = {
    group: f.root,
    composition_path: f.filename,
    account_sha256: 'a'.repeat(64),
    inspection: { expires_at: Date.now() + 60_000, account_sha256: 'a'.repeat(64), authenticated: true },
    max_tokens: 100,
    timeout_ms: 1000,
    prompt: 'READY',
  };
  const { AcpRuntimeProvider } = require('../packages/runtime-providers/acp-runtime-provider');
  const p = AcpRuntimeProvider.prototype;
  const closed = t.mock.method(p, 'close', async () => {});
  t.mock.method(p, 'create', async () => ({ runtime_session_id: 'worker-session' }));
  t.mock.method(p, 'resume', async () => ({ runtime_session_id: 'worker-session' }));
  t.mock.method(p, 'send', async () => {});
  const cancel = t.mock.method(p, 'cancel', async (r) => assert.equal(r.cascade, false));
  let events = [{ event_type: 'runtime.message.delta', payload: { text: 'READY' } }, { event_type: 'runtime.session.completed' }];
  t.mock.method(p, 'events', async function* () {
    yield* events;
  });
  t.mock.getter(process, 'stdin', () => Readable.from([JSON.stringify(request)]));
  return {
    ...f,
    request,
    closed,
    cancel,
    setEvents: (e) => {
      events = e;
    },
    run: require('../tools/cli/lib/provider-acp-worker').main,
  };
}
test('worker joins containment, closes after success/resume/cancel and retains uncertain failures', async (t) => {
  const f = workerFixture(t);
  assert.equal((await f.run()).completed, true);
  assert.equal(fs.readFileSync(path.join(f.root, 'cgroup.procs'), 'utf8'), String(process.pid));
  f.request.resume_session_id = 'worker-session';
  assert.equal((await f.run()).provider_session_id, 'worker-session');
  f.request.inspect_only = true;
  assert.equal((await f.run()).inference_dispatched, false);
  delete f.request.inspect_only;
  f.request.cancel_on_output = true;
  f.setEvents([
    { event_type: 'runtime.message.delta', payload: { text: 'partial' } },
    { event_type: 'runtime.session.failed', payload: { error_code: 'cancelled' } },
  ]);
  assert.equal((await f.run()).cancelled, true);
  assert.equal(f.cancel.mock.callCount(), 1);
  f.request.cancel_on_output = false;
  await assert.rejects(f.run(), /cancelled/);
  f.setEvents([]);
  await assert.rejects(f.run(), /ACP_INCOMPLETE/);
  assert.equal(f.closed.mock.callCount(), 6);
  f.request.inspection.expires_at = 0;
  await assert.rejects(f.run(), /ACP_IDENTITY_EXPIRED/);
  f.request.prompt = 'x'.repeat(131_073);
  await assert.rejects(f.run(), /input/);
});
test('launcher forwards only pinned startup configuration and propagates child failures and termination', (t) => {
  const f = fixture(t),
    children = [];
  t.mock.method(require('node:child_process'), 'spawn', (binary, args, options) => {
    assert.equal(binary, f.value.binary);
    assert.ok(args.includes('model_provider="openai"'));
    assert.equal(options.shell, false);
    assert.deepEqual(Object.keys(options.env).sort(), ['CODEX_HOME', 'HOME', 'PATH']);
    // ChildProcess exposes the EventEmitter contract.
    // eslint-disable-next-line unicorn/prefer-event-target
    const child = new EventEmitter();
    child.kill = t.mock.fn();
    children.push(child);
    return child;
  });
  const on = t.mock.method(process, 'on', t.mock.fn());
  const exit = t.mock.method(process, 'exit', t.mock.fn());
  const oldEnv = process.env,
    oldArgv = process.argv,
    oldCode = process.exitCode;
  t.after(() => {
    process.env = oldEnv;
    process.argv = oldArgv;
    process.exitCode = oldCode;
  });
  process.env = {
    HSEOS_ACP_COMPOSITION: f.filename,
    HOME: f.value.home,
    CODEX_HOME: f.value.home,
    PATH: '/usr/bin',
    UNTRUSTED: 'never-forwarded',
  };
  process.argv = ['node', 'launcher', 'app-server'];
  const file = require.resolve('../packages/runtime-providers/codex-acp-launcher');
  const run = () => {
    delete require.cache[file];
    require(file);
  };
  run();
  children[0].emit('error', new Error('failed'));
  assert.equal(process.exitCode, 1);
  children[0].emit('exit', 7);
  assert.equal(exit.mock.calls.at(-1).arguments[0], 7);
  children[0].emit('exit', null);
  assert.equal(exit.mock.calls.at(-1).arguments[0], 1);
  on.mock.calls.find((c) => c.arguments[0] === 'SIGTERM').arguments[1]();
  assert.deepEqual(children[0].kill.mock.calls[0].arguments, ['SIGTERM']);
  process.env.HOME = '/wrong';
  run();
  assert.equal(children.length, 1);
  process.argv.push('unexpected');
  run();
  assert.equal(children.length, 1);
});
