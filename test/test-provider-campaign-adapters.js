'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const yaml = require('yaml');
const { manifest } = require('./helpers/provider-control');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const vectors = require('./fixtures/campaign-credential-vectors');
const { credentialFingerprint } = require('../tools/cli/lib/provider-api-adapter');
const { createNativeCampaignAdapter, nativeArtifactDigest } = require('../tools/cli/lib/provider-native-adapter');
const { createAntigravityCampaignAdapter, antigravityArtifactDigest } = require('../tools/cli/lib/provider-antigravity-adapter');
const { startCampaignModelBridge } = require('../tools/cli/lib/provider-campaign-bridge');
const { runCampaignProcess } = require('../tools/cli/lib/provider-campaign-process');
function temporary(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-campaign-adapters-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function native(t, vendor) {
  const d = temporary(t),
    id = randomUUID();
  const settings = {
    model: 'pinned',
    tasks: { [id]: { prompt: 'ready' } },
    environment: { HOME: d, PATH: '/usr/bin', ...(vendor === 'codex' ? { CODEX_HOME: d } : {}) },
  };
  const filename = path.join(d, 'binding.yaml'),
    sdk = path.join(d, 'sdk.mjs');
  fs.writeFileSync(sdk, 'export const query = () => {};');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  const binding = {
    schema_version: 1,
    profile_id: `agent-${vendor}-delegated-candidate`,
    runtime_provider_id: `runtime:${vendor === 'codex' ? 'codex-app-server' : 'claude-agent-sdk'}`,
    executable: process.execPath,
    cwd: d,
    env_names: [],
    secret_refs: [],
    ...(vendor === 'codex' ? { args: ['app-server', '--listen', 'stdio://'] } : { sdk_module: sdk }),
  };
  fs.writeFileSync(filename, yaml.stringify(binding));
  const parsed = require(`../tools/cli/lib/delegated-${vendor}-runtime`).readBinding(filename);
  const m = manifest(vendor, vendor === 'codex' ? 'account' : 'api', 'client');
  m.adapter = `hseos-${vendor}-campaign-v1`;
  m.artifact_sha256 = nativeArtifactDigest();
  m.binding_sha256 = engineeringDigest({ binding: parsed, options: settings });
  const credential = randomUUID();
  if (vendor === 'codex') {
    m.authentication.credential.source_ref = `file://${d}/auth.json`;
    m.authentication.account_sha256 = engineeringDigest({ type: 'chatgpt', email: 'fixture@example.invalid' });
  } else {
    m.authentication.identity_kind = 'credential';
    m.authentication.account_sha256 = null;
    m.authentication.credential_sha256 = credentialFingerprint(credential);
  }
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
  const calls = [];
  const deps = {
    environment: { TEST_PROVIDER_KEY: credential },
    processRunner: async (input) => {
      calls.push(input);
      return input.input.operation === 'inspect'
        ? report
        : {
            text_sha256: 'a'.repeat(64),
            provider_session_id: 'native-session-1',
            usage:
              vendor === 'codex'
                ? { last: { inputTokens: 5, outputTokens: 2 }, total: { inputTokens: 5, outputTokens: 2 } }
                : { usage: { input_tokens: 5, output_tokens: 2 }, total_cost_usd: 0.0001 },
          };
    },
    fetchImpl: async (url, input) => {
      assert.equal(url, 'https://api.anthropic.com/v1/models?limit=1');
      assert.equal(input.headers['x-api-key'], credential);
      return new Response('{}', {
        headers: {
          'anthropic-ratelimit-requests-remaining': '3',
          'anthropic-ratelimit-input-tokens-remaining': '1000',
          'anthropic-ratelimit-output-tokens-remaining': '64',
        },
      });
    },
  };
  return {
    m,
    report,
    calls,
    deps,
    settings,
    filename,
    id,
    create: () => createNativeCampaignAdapter({ manifest: m, binding: filename, options: settings }, deps),
  };
}
for (const vendor of ['codex', 'claude'])
  test(`${vendor} factory selects explicit identity, preserves remote quota units and receipts`, async (t) => {
    const f = native(t, vendor),
      configured = f.create();
    assert.equal(f.calls.length, 0);
    const observation = await configured.adapter.inspect();
    assert.equal(observation.account_sha256, f.m.authentication.account_sha256);
    assert.equal(observation.quota_remaining_requests, null);
    const result = await configured.adapter.run({ task_id: f.id, signal: new AbortController().signal });
    assert.equal(result.input_tokens, 5);
    assert.equal(result.cost_microusd, null);
    await assert.rejects(configured.adapter.run({ task_id: randomUUID(), signal: new AbortController().signal }), {
      code: 'CONTROL_CAMPAIGN_SCOPE_DENIED',
    });
    fs.appendFileSync(f.filename, '\n# harmless file formatting does not alter parsed binding\n');
    await configured.adapter.inspect();
    f.settings.model = 'drift';
    assert.throws(f.create, { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  });
test('native runs return retained model output only when it is bounded, hash-exact and credential-free', async (t) => {
  const { createHash } = require('node:crypto');
  const sha = (value) => createHash('sha256').update(value).digest('hex');
  const f = native(t, 'claude');
  const base = (text, hash = sha(text)) => ({
    text,
    text_sha256: hash,
    provider_session_id: 'native-session-1',
    usage: { usage: { input_tokens: 5, output_tokens: 2 } },
  });
  const original = f.deps.processRunner;
  const run = async (result) => {
    f.deps.processRunner = async (input) => (input.input.operation === 'run' ? result : original(input));
    return f.create().adapter.run({ task_id: f.id, signal: new AbortController().signal });
  };
  const kept = await run(base('plan'));
  assert.equal(kept.output_text, 'plan');
  assert.deepEqual(kept.evidence_ref, { schema_version: 1, kind: 'model_output', sha256: sha('plan'), bytes: 4 });
  assert.equal(
    kept.evidence_sha256,
    engineeringDigest({
      text_sha256: sha('plan'),
      provider_session_id: 'native-session-1',
      usage: { usage: { input_tokens: 5, output_tokens: 2 } },
    }),
  );
  for (const withheld of [
    base('plan', 'a'.repeat(64)),
    base('x'.repeat(65_537)),
    base(`key ${f.deps.environment.TEST_PROVIDER_KEY}`),
    base(vectors.RSA_PRIVATE_KEY),
    { ...base('plan'), text: undefined },
  ]) {
    const result = await run(withheld);
    assert.equal(result.output_text, undefined);
    assert.equal(result.evidence_ref, undefined);
  }
});
test('native adapter declares why output is withheld without failing the dispatch', async (t) => {
  const { createHash } = require('node:crypto');
  const sha = (value) => createHash('sha256').update(value).digest('hex');
  const f = native(t, 'claude');
  const original = f.deps.processRunner;
  const run = async (result) => {
    f.deps.processRunner = async (input) => (input.input.operation === 'run' ? result : original(input));
    return f.create().adapter.run({ task_id: f.id, signal: new AbortController().signal });
  };
  const base = (extra) => ({ provider_session_id: 'native-session-1', usage: { usage: { input_tokens: 5, output_tokens: 2 } }, ...extra });
  const text = vectors.PROJECT_TOKEN_TEXT;
  const cases = [
    [base({ text_sha256: sha('x'), text_too_large: true }), 'too_large'],
    [base({ text, text_sha256: sha(text) }), 'credential_pattern'],
    [base({ text: 'ok', text_sha256: 'b'.repeat(64) }), 'integrity_mismatch'],
    [base({ text: 'x'.repeat(65_537), text_sha256: sha('x'.repeat(65_537)) }), 'too_large'],
  ];
  for (const [result, reason] of cases) {
    const receipt = await run(result);
    assert.equal(receipt.evidence_withheld, reason);
    assert.equal(receipt.evidence_ref, undefined);
    assert.equal(receipt.output_text, undefined);
  }
  const known = await run(
    base({ text: `echo ${f.deps.environment.TEST_PROVIDER_KEY}`, text_sha256: sha(`echo ${f.deps.environment.TEST_PROVIDER_KEY}`) }),
  );
  assert.equal(known.evidence_withheld, 'credential_pattern');
  const none = await run(base({ text_sha256: 'a'.repeat(64) }));
  assert.equal(none.evidence_withheld, undefined);
});
test('real worker process returns retained output at the limit without exceeding the envelope', async (t) => {
  const d = temporary(t);
  const run = (prompt) =>
    runCampaignProcess({
      input: {
        vendor: 'claude',
        operation: 'run',
        binding: { executable: process.execPath, sdk_module: path.resolve('test/fixtures/fake-claude-agent-sdk.mjs'), cwd: d },
        environment: { HOME: d, PATH: '/usr/bin', HSEOS_CLAUDE_TEST_REMOTE: path.join(d, 'claude.json') },
        model: 'pinned',
        prompt,
        budget_microusd: 1000,
      },
      signal: new AbortController().signal,
      timeout_ms: 20_000,
    });
  for (const kind of ['quotes', 'control', 'ascii', 'multibyte']) {
    const result = await run(`bulk:${kind}:65536`);
    assert.equal(Buffer.byteLength(result.text), 65_536, kind);
    assert.equal(createHash('sha256').update(result.text).digest('hex'), result.text_sha256, kind);
    assert.equal(result.text_too_large, undefined);
  }
  const over = await run('bulk:control:65537');
  assert.equal(over.text, undefined);
  assert.equal(over.text_too_large, true);
  assert.equal(over.text_sha256.length, 64);
});
test('native preflight never replaces unknown quotas, paid credits or credentials with invented capacity', async (t) => {
  const f = native(t, 'codex');
  const a = f.create().adapter;
  f.report.quota.rateLimits.credits.hasCredits = true;
  await assert.rejects(a.inspect(), { code: 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE' });
  f.report.quota.rateLimits.credits.hasCredits = false;
  f.report.version = 'different';
  await assert.rejects(a.inspect(), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  const c = native(t, 'claude');
  c.deps.fetchImpl = async () => new Response('{}');
  assert.equal((await c.create().adapter.inspect()).quota_remaining_requests, null);
  c.deps.environment.TEST_PROVIDER_KEY = randomUUID();
  await assert.rejects(c.create().adapter.inspect(), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
});
test('bridge authenticates, pins child scope, cannot replay, and works through the Python SDK component', async (t) => {
  let calls = 0;
  const abort = new AbortController();
  const bridge = await startCampaignModelBridge({
    binding_id: 'binding:model',
    signal: abort.signal,
    runSubordinate: async (input) => {
      calls++;
      assert.deepEqual(input, { binding_id: 'binding:model' });
      return { receipt: { status: 'completed', evidence_sha256: 'a'.repeat(64) } };
    },
  });
  t.after(() => bridge.close());
  assert.equal((await fetch(bridge.url + '/run', { method: 'POST', body: '{}' })).status, 401);
  assert.equal(
    (await fetch(bridge.url + '/run', { method: 'POST', headers: { authorization: `Bearer ${bridge.credential}` }, body: '{"id":"x"}' }))
      .status,
    409,
  );
  const python = await promisify(execFile)(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      "import os,sys;sys.path.insert(0,'packages/control-sdk');from antigravity_client import CampaignModelBridge;print(CampaignModelBridge(os.environ['BRIDGE_URL'],os.environ['BRIDGE_CAP'])())",
    ],
    { env: { ...process.env, BRIDGE_URL: bridge.url, BRIDGE_CAP: bridge.credential } },
  );
  assert.equal(JSON.parse(python.stdout).status, 'completed');
  assert.equal(calls, 1);
  assert.equal(bridge.report().completed, true);
  assert.equal(
    (await fetch(bridge.url + '/run', { method: 'POST', headers: { authorization: `Bearer ${bridge.credential}` }, body: '{}' })).status,
    409,
  );
  abort.abort();
  await bridge.close();
  await assert.rejects(fetch(bridge.url + '/run'));
});
test('bridge retains uncertainty and waits for an in-flight child before closing', async () => {
  let release, entered;
  const ready = new Promise((r) => {
    entered = r;
  });
  const abort = new AbortController();
  const bridge = await startCampaignModelBridge({
    binding_id: 'binding:model',
    signal: abort.signal,
    runSubordinate: async () => {
      entered();
      await new Promise((r) => {
        release = r;
      });
      throw new Error('private');
    },
  });
  const request = fetch(bridge.url + '/run', {
    method: 'POST',
    headers: { authorization: `Bearer ${bridge.credential}` },
    body: '{}',
  }).catch(() => null);
  await ready;
  let closed = false;
  const closing = bridge.close().then(() => {
    closed = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  release();
  await closing;
  await request;
  assert.deepEqual(bridge.report(), { used: true, completed: false });
});
test('process supervisor returns only after descendants drain and kills startup stalls', async () => {
  const script =
    "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{let c=JSON.parse(s);require('node:fs').writeFileSync(c.group+'/cgroup.procs',String(process.pid));const c2=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c2.unref();process.stdout.write(JSON.stringify({result:{ok:true,pid:c2.pid}}));});";
  const result = await runCampaignProcess({ args: ['-e', script], input: {}, signal: new AbortController().signal, timeout_ms: 2000 });
  assert.equal(result.ok, true);
  try {
    assert.equal(fs.readFileSync(`/proc/${result.pid}/stat`, 'utf8').split(') ')[1][0], 'Z');
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
  }
  await assert.rejects(
    runCampaignProcess({ args: ['-e', 'setInterval(()=>{},1000)'], input: {}, signal: new AbortController().signal, timeout_ms: 50 }),
    /CONTROL_OUTCOME_UNCERTAIN/,
  );
  await assert.rejects(runCampaignProcess({ input: {}, signal: AbortSignal.abort(), timeout_ms: 1 }), /CONTROL_CAMPAIGN_PROCESS_INVALID/);
});
test('Antigravity factory requires a pinned local checkpoint and proves a subordinate call occurred', async (t) => {
  const d = temporary(t),
    id = randomUUID();
  const config = {
    python: fs.realpathSync('/usr/bin/python3'),
    checkpoint: path.join(d, 'model.litertlm'),
    sdk_module: path.join(d, '__init__.py'),
    scratch: d,
    subordinate_binding_id: 'binding:model',
    max_model_calls: 2,
    pids_max: 256,
    tasks: { [id]: { prompt: 'Call the campaign model tool.' } },
  };
  fs.writeFileSync(config.checkpoint, 'fixture only');
  fs.writeFileSync(config.sdk_module, '');
  const file = path.join(d, 'binding.json');
  fs.writeFileSync(file, JSON.stringify(config));
  const artifacts = [config.python, config.checkpoint, config.sdk_module].map((p) =>
    createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
  );
  const m = manifest('antigravity', 'local', 'client');
  m.adapter = 'hseos-antigravity-campaign-v1';
  m.artifact_sha256 = antigravityArtifactDigest();
  m.authentication.identity_kind = 'local_profile';
  m.authentication.account_sha256 = null;
  m.authentication.profile_sha256 = engineeringDigest(artifacts);
  m.binding_sha256 = engineeringDigest({ config, artifacts });
  let useBridge = true;
  const processRunner = async ({ input, pids_max }) => {
    assert.equal(pids_max, 256);
    if (input.operation === 'inspect') return { sdk_version: m.provider_version };
    if (useBridge) {
      const r = await fetch(input.bridge.url + '/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${input.bridge.credential}` },
        body: '{}',
      });
      assert.equal(r.status, 200);
    }
    return {
      provider_session_id: 'c0c9c8bc-6992-45dc-9c98-a39d86ddc8d3',
      usage: { prompt_token_count: 3, candidates_token_count: 2, thoughts_token_count: 0 },
    };
  };
  const make = (value = m, options = {}, runner = processRunner) =>
    createAntigravityCampaignAdapter({ manifest: value, binding: file, options }, { processRunner: runner });
  assert.throws(() => make(m, { endpoint: 'http://127.0.0.1' }), /CONFIGURATION_INVALID/);
  assert.throws(() => make({ ...m, route: 'api' }), /CONFIGURATION_INVALID/);
  fs.writeFileSync(file, JSON.stringify({ ...config, checkpoint: d }));
  assert.throws(() => make(), /CONFIGURATION_INVALID/);
  fs.writeFileSync(file, JSON.stringify(config));
  const drift = make(m, {}, async () => ({ sdk_version: 'different' })).adapter;
  await assert.rejects(drift.inspect(), /BINDING_DRIFT/);
  const adapter = make().adapter;
  assert.equal((await adapter.inspect()).profile_sha256, m.authentication.profile_sha256);
  let children = 0;
  const input = {
    task_id: id,
    signal: new AbortController().signal,
    runSubordinate: async () => {
      children++;
      return { receipt: { status: 'completed', evidence_sha256: 'a'.repeat(64) } };
    },
  };
  assert.equal((await adapter.run(input)).cost_microusd, 0);
  assert.equal(children, 1);
  await assert.rejects(adapter.run({ ...input, task_id: randomUUID() }), /SCOPE_DENIED/);
  assert.equal(
    (await adapter.run({ ...input, resume_session_id: 'c0c9c8bc-6992-45dc-9c98-a39d86ddc8d3' })).provider_session_id,
    'c0c9c8bc-6992-45dc-9c98-a39d86ddc8d3',
  );
  useBridge = false;
  await assert.rejects(adapter.run(input), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  fs.appendFileSync(config.checkpoint, 'drift');
  await assert.rejects(adapter.inspect(), { code: 'CONTROL_PROVIDER_BINDING_DRIFT' });
});

test('real worker process drives Codex and Claude protocol fixtures and refuses attempted effects', async (t) => {
  const d = temporary(t);
  const binary = path.join(d, 'codex');
  const fixture = path.resolve('test/fixtures/fake-codex-app-server.js');
  const remote = path.join(d, 'remote.json');
  fs.writeFileSync(
    binary,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'codex-cli 1.0.0'; else exec '${process.execPath}' '${fixture}' '${remote}' "$1"; fi\n`,
    { mode: 0o755 },
  );
  const base = {
    vendor: 'codex',
    binding: { executable: binary, args: ['normal'], cwd: d },
    environment: {},
    model: 'pinned',
    prompt: 'ready',
    budget_microusd: 1000,
  };
  const run = (input) => runCampaignProcess({ input, signal: new AbortController().signal, timeout_ms: 5000 });
  assert.equal((await run({ ...base, operation: 'inspect' })).identity.account.type, 'chatgpt');
  const first = await run({ ...base, operation: 'run' });
  assert.equal(first.usage.total.inputTokens, 5);
  const resumed = await run({ ...base, operation: 'run', resume_session_id: first.provider_session_id });
  assert.equal(resumed.provider_session_id, first.provider_session_id);
  assert.equal(JSON.parse(fs.readFileSync(remote, 'utf8')).resumed, 1);
  await assert.rejects(run({ ...base, vendor: 'invalid', operation: 'run' }), /CONTROL_OUTCOME_UNCERTAIN/);
  await assert.rejects(run({ ...base, operation: 'run', binding: { ...base.binding, args: ['effect'] } }), /CONTROL_OUTCOME_UNCERTAIN/);
  const claude = {
    ...base,
    vendor: 'claude',
    operation: 'run',
    binding: { executable: process.execPath, sdk_module: path.resolve('test/fixtures/fake-claude-agent-sdk.mjs'), cwd: d },
    environment: { HOME: d, PATH: '/usr/bin', HSEOS_CLAUDE_TEST_REMOTE: path.join(d, 'claude.json') },
  };
  const claudeFirst = await run(claude);
  assert.equal(claudeFirst.usage.usage.output_tokens, 2);
  assert.equal(
    (await run({ ...claude, resume_session_id: claudeFirst.provider_session_id })).provider_session_id,
    claudeFirst.provider_session_id,
  );
  await assert.rejects(run({ ...claude, resume_session_id: 'unknown-session' }), /CONTROL_OUTCOME_UNCERTAIN/);
  await assert.rejects(run({ ...claude, operation: 'inspect' }), /CONTROL_OUTCOME_UNCERTAIN/);
  await assert.rejects(run({ ...claude, prompt: 'effect' }), /CONTROL_OUTCOME_UNCERTAIN/);
});

test('resource profiles enforce finite memory and process bounds and preserve defaults', async () => {
  const { createResourceGroup, removeDrainedGroup } = require('../packages/agent-isolation-attestation/executor');
  for (const invalid of [0, Infinity, 268_435_455, 2_147_483_649, 536_870_912.5])
    assert.throws(() => createResourceGroup({ memory_max_bytes: invalid }), /Invalid finite memory/);
  for (const invalid of [0, 31, 257, Infinity, 64.5, '256', null])
    assert.throws(() => createResourceGroup({ pids_max: invalid }), /Invalid finite process/);
  for (const requested of [undefined, 536_870_912]) {
    const group = createResourceGroup({ memory_max_bytes: requested });
    try {
      assert.equal(fs.readFileSync(path.join(group, 'memory.max'), 'utf8').trim(), String(requested ?? 268_435_456));
      assert.equal(fs.readFileSync(path.join(group, 'pids.max'), 'utf8').trim(), '32');
      assert.equal(fs.readFileSync(path.join(group, 'memory.swap.max'), 'utf8').trim(), '0');
    } finally {
      await removeDrainedGroup(group);
    }
  }
});

test('Claude cached input remains part of the admitted token usage', async (t) => {
  const f = native(t, 'claude');
  f.deps.processRunner = async () => ({
    provider_session_id: 'session-1',
    usage: {
      usage: {
        input_tokens: 5,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 11,
        output_tokens: 2,
      },
    },
  });
  const result = await f.create().adapter.run({ task_id: f.id, signal: new AbortController().signal });
  assert.equal(result.input_tokens, 23);
});

test('native resource profile is pinned and reaches inspection and execution', async (t) => {
  const f = native(t, 'codex');
  f.settings.pids_max = 256;
  const parsed = require('../tools/cli/lib/delegated-codex-runtime').readBinding(f.filename);
  f.m.binding_sha256 = engineeringDigest({ binding: parsed, options: f.settings });
  const a = f.create().adapter;
  await a.inspect();
  await a.run({ task_id: f.id, signal: new AbortController().signal });
  assert.ok(f.calls.every((call) => call.pids_max === 256));
  f.settings.pids_max = 128;
  assert.throws(f.create, { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  f.settings.pids_max = 257;
  assert.throws(f.create);
  const result = await runCampaignProcess({
    args: [
      '-e',
      "let s='';process.stdin.on('data', c=>s+=c);process.stdin.on('end',()=>{const fs=require('node:fs'),v=JSON.parse(s);fs.writeFileSync(v.group+'/cgroup.procs',String(process.pid));console.log(JSON.stringify({result:{limit:fs.readFileSync(v.group+'/pids.max','utf8').trim(),group:v.group}}));});",
    ],
    input: {},
    signal: new AbortController().signal,
    timeout_ms: 5000,
    pids_max: 256,
  });
  assert.equal(result.limit, '256');
  assert.equal(fs.existsSync(result.group), false);
});
