'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const { childEnvironment, setup, IDENTITY } = require('./helpers/claude-account');

const signal = () => new AbortController().signal;

test('claude/account is accepted and inspection exposes a digest, never the identity itself', async (t) => {
  const f = setup(t);
  const configured = f.create();
  assert.equal(configured.binding_sha256, f.m.binding_sha256);
  const observation = await configured.adapter.inspect({ signal: signal() });
  assert.equal(observation.account_sha256, f.m.authentication.account_sha256);
  assert.equal(observation.authenticated, true);
  assert.equal(observation.quota_remaining_requests, null);
  assert.equal(observation.quota_windows, undefined);
  assert.equal(observation.competing_credentials, false);
  const text = JSON.stringify(observation);
  for (const secret of [IDENTITY.email, IDENTITY.orgId]) assert.ok(!text.includes(secret));
  assert.ok(!fs.readFileSync(`${f.home}/fake-calls.jsonl`, 'utf8').includes('.credentials'));
});

test('configuration rejects unsafe or unpinned shapes', (t) => {
  const f = setup(t);
  f.m.authentication.credential.source_ref = 'env://ANTHROPIC_API_KEY';
  assert.throws(() => f.create(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  const g = setup(t);
  g.m.provider_kind = 'runtime';
  assert.throws(() => g.create(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  const h = setup(t);
  h.m.artifact_sha256 = 'f'.repeat(64);
  assert.throws(() => h.create(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  const i = setup(t);
  i.settings.model = 'drift';
  assert.throws(() => i.create(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK']) {
    const j = setup(t);
    j.settings.environment[name] = 'x';
    assert.throws(() => j.create(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID', message: /unrecognized/i }, name);
  }
});

test('inspection fails closed unless the login is a subscription account', async (t) => {
  for (const authMethod of ['api_key', 'none', 'third_party', 'oauth_token']) {
    const f = setup(t, { mode: { auth: { loggedIn: true, apiProvider: 'firstParty', ...IDENTITY, authMethod } } });
    await assert.rejects(f.create().adapter.inspect({ signal: signal() }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' }, authMethod);
  }
  const cloud = setup(t, { mode: { auth: { loggedIn: true, apiProvider: 'bedrock', ...IDENTITY } } });
  await assert.rejects(cloud.create().adapter.inspect({ signal: signal() }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  const out = setup(t, { mode: { auth: { loggedIn: false, authMethod: 'none' } } });
  await assert.rejects(out.create().adapter.inspect({ signal: signal() }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  const failed = setup(t, { mode: { auth: null } });
  await assert.rejects(failed.create().adapter.inspect({ signal: signal() }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
});

test('a different account or version is observable and never matches the pinned identity', async (t) => {
  const other = setup(t, { mode: { auth: { loggedIn: true, apiProvider: 'firstParty', ...IDENTITY, email: 'other@example.invalid' } } });
  const observed = await other.create().adapter.inspect({ signal: signal() });
  assert.notEqual(observed.account_sha256, other.m.authentication.account_sha256);
  assert.equal(observed.account_sha256, engineeringDigest({ ...IDENTITY, email: 'other@example.invalid' }));
  const org = setup(t, { mode: { auth: { loggedIn: true, apiProvider: 'firstParty', ...IDENTITY, orgId: 'org-other' } } });
  assert.notEqual((await org.create().adapter.inspect({ signal: signal() })).account_sha256, org.m.authentication.account_sha256);
  const old = setup(t, { mode: { version: '2.0.0' } });
  await assert.rejects(old.create().adapter.inspect({ signal: signal() }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
});

test('run refuses when the account changed after inspection', async (t) => {
  const f = setup(t);
  const { adapter } = f.create();
  await adapter.inspect({ signal: signal() });
  f.writeMode({ auth: { loggedIn: true, apiProvider: 'firstParty', ...IDENTITY, email: 'swapped@example.invalid' } });
  await assert.rejects(adapter.run({ task_id: f.id, signal: signal() }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  assert.equal(f.calls().filter((call) => call.argv.includes('-p')).length, 0);
});

test('run reports tokens, null cost and a session, with the parent API key kept out of the child', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'parent-secret-must-not-propagate';
  t.after(() => delete process.env.ANTHROPIC_API_KEY);
  const f = setup(t);
  const result = await f.create().adapter.run({ task_id: f.id, signal: signal() });
  assert.equal(result.status, 'completed');
  assert.equal(result.cost_microusd, null);
  assert.equal(result.input_tokens, 5);
  assert.equal(result.output_tokens, 2);
  assert.match(result.provider_session_id, /^[0-9a-f-]{36}$/);
  assert.equal(result.binding_sha256, f.m.binding_sha256);
  const prompt = f.calls().find((call) => call.argv.includes('-p'));
  assert.ok(
    childEnvironment(prompt.env).every((name) => ['HOME', 'PATH', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS'].includes(name)),
    childEnvironment(prompt.env).join(','),
  );
  assert.ok(!prompt.cwd.endsWith('/work'), 'each run gets a fresh empty directory');
  assert.deepEqual(fs.readdirSync(f.cwd), []);
  await assert.rejects(f.create().adapter.run({ task_id: randomUUID(), signal: signal() }), { code: 'CONTROL_CAMPAIGN_SCOPE_DENIED' });
});

test('quota refusals are explicit and never retried', async (t) => {
  for (const run of ['rejected', 'credits', 'overage']) {
    const f = setup(t, { run });
    await assert.rejects(f.create().adapter.run({ task_id: f.id, signal: signal() }), { code: 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE' }, run);
    assert.equal(f.calls().filter((call) => call.argv.includes('-p')).length, 1, run);
  }
});

test('API key init, tool use, extra events and oversized output fail closed', async (t) => {
  const f = setup(t, { run: 'api_key' });
  await assert.rejects(f.create().adapter.run({ task_id: f.id, signal: signal() }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  for (const run of ['tool', 'tools_init', 'user', 'big', 'error']) {
    const g = setup(t, { run });
    await assert.rejects(g.create().adapter.run({ task_id: g.id, signal: signal() }), /CONTROL_OUTCOME_UNCERTAIN/, run);
  }
});

test('resume needs explicit persisted sessions', async (t) => {
  const f = setup(t);
  await assert.rejects(f.create().adapter.run({ task_id: f.id, signal: signal(), resume_session_id: randomUUID() }), {
    code: 'CONTROL_PROVIDER_RESUME_UNAVAILABLE',
  });
  const g = setup(t);
  g.settings.persist_sessions = true;
  g.m.binding_sha256 = engineeringDigest({
    binding: require('../tools/cli/lib/provider-claude-account-adapter').readBinding(g.filename),
    options: g.settings,
  });
  const { adapter } = g.create();
  const first = await adapter.run({ task_id: g.id, signal: signal() });
  const again = await adapter.run({ task_id: g.id, signal: signal(), resume_session_id: first.provider_session_id });
  assert.equal(again.provider_session_id, first.provider_session_id);
});

test('binary absence, replacement or oversized token output is drift or budget exhaustion', async (t) => {
  const f = setup(t);
  const { adapter } = f.create();
  fs.appendFileSync(f.executable, '\n// replaced\n');
  await assert.rejects(adapter.inspect({ signal: signal() }), { code: 'CONTROL_PROVIDER_BINDING_DRIFT' });
  fs.rmSync(f.executable);
  await assert.rejects(adapter.run({ task_id: f.id, signal: signal() }), { code: 'CONTROL_PROVIDER_BINDING_DRIFT' });
  assert.throws(() => f.create(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  const g = setup(t);
  g.m.limits.max_output_tokens = 1;
  await assert.rejects(g.create().adapter.run({ task_id: g.id, signal: signal() }), { code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED' });
});

test('session transcripts are removed unless persistence is explicitly enabled', async (t) => {
  const f = setup(t);
  await f.create().adapter.run({ task_id: f.id, signal: signal() });
  assert.equal(fs.existsSync(`${f.home}/.claude/projects`) && fs.readdirSync(`${f.home}/.claude/projects`).length > 0, false);
  const g = setup(t);
  g.settings.persist_sessions = true;
  g.m.binding_sha256 = engineeringDigest({
    binding: require('../tools/cli/lib/provider-claude-account-adapter').readBinding(g.filename),
    options: g.settings,
  });
  let seen;
  await g.create({}, (runner) => async (input) => (seen = await runner(input))).adapter.run({ task_id: g.id, signal: signal() });
  assert.match(seen.sensitive_session_dir, /\/\.claude\/projects\//);
  assert.ok(fs.existsSync(seen.sensitive_session_dir));
  assert.equal(seen.init.fast_mode_state, null);
});

test('claude/account refuses omitted pids_max with a stable error that names the field', (t) => {
  const f = setup(t);
  delete f.settings.pids_max;
  // Re-pin so only the missing field, not a digest mismatch, can make the factory refuse.
  f.m.binding_sha256 = engineeringDigest({
    binding: require('../tools/cli/lib/provider-claude-account-adapter').readBinding(f.filename),
    options: f.settings,
  });
  assert.throws(
    f.create,
    (error) =>
      error.code === 'CONTROL_PROVIDER_CONFIGURATION_INVALID' && /pids_max/.test(error.message) && /pids_max/.test(String(error.cause)),
  );
});

test('claude/account keeps accepting 32-256 and refusing out-of-range or non-integer pids_max', (t) => {
  for (const value of [32, 128, 256]) {
    const f = setup(t);
    f.settings.pids_max = value;
    f.m.binding_sha256 = engineeringDigest({
      binding: require('../tools/cli/lib/provider-claude-account-adapter').readBinding(f.filename),
      options: f.settings,
    });
    assert.doesNotThrow(() => f.create());
  }
  for (const value of [31, 257, '64', Number.NaN, 32.5, null]) {
    const f = setup(t);
    f.settings.pids_max = value;
    assert.throws(() => f.create(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  }
});

test('a client output limit overrun is an explicit provider output limit, never a bare uncertain outcome', async (t) => {
  const f = setup(t, { run: 'output_limit' });
  const error = await f
    .create()
    .adapter.run({ task_id: f.id, signal: signal() })
    .then(
      () => null,
      (error_) => error_,
    );
  assert.equal(error.code, 'CONTROL_PROVIDER_OUTPUT_LIMIT');
  assert.equal(error.diagnostic.limit, 'output_tokens');
  assert.equal(error.diagnostic.client_limit_tokens, f.m.limits.max_output_tokens);
  assert.equal(f.calls().filter((call) => call.argv.includes('-p')).length, 1, 'not retried');
});

test('the manifest output limit counts reasoning, as the client cap does, and a breach names the numbers', async (t) => {
  const usage = (output, thinking) => ({
    input_tokens: 5,
    output_tokens: output,
    output_tokens_details: { thinking_tokens: thinking },
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
  const f = setup(t, { mode: { usage: usage(16_385, 12_000) } });
  f.m.limits.max_output_tokens = 16_384;
  const error = await f
    .create()
    .adapter.run({ task_id: f.id, signal: signal() })
    .then(
      () => null,
      (error_) => error_,
    );
  assert.equal(error.code, 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED');
  assert.deepEqual(error.diagnostic, {
    limit: 'output_tokens',
    output_tokens: 16_385,
    max_output_tokens: 16_384,
    reasoning_tokens: 12_000,
  });
  const g = setup(t, { mode: { usage: usage(16_384, 12_000) } });
  g.m.limits.max_output_tokens = 16_384;
  const receipt = await g.create().adapter.run({ task_id: g.id, signal: signal() });
  assert.equal(receipt.output_tokens, 16_384, 'a run exactly at the limit is accepted');
  const h = setup(t, {
    mode: { usage: { input_tokens: 5, output_tokens: 16_385, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  });
  h.m.limits.max_output_tokens = 16_384;
  const plain = await h
    .create()
    .adapter.run({ task_id: h.id, signal: signal() })
    .then(
      () => null,
      (error_) => error_,
    );
  assert.equal(plain.diagnostic.reasoning_tokens, null, 'absent reasoning is reported as unknown, not zero');
});

test('cache reads and cache creation stay part of the input total of the receipt', async (t) => {
  const f = setup(t, {
    mode: { usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 600, cache_creation_input_tokens: 400 } },
  });
  const receipt = await f.create().adapter.run({ task_id: f.id, signal: signal() });
  assert.equal(receipt.input_tokens, 1005, 'direct 5 + cache read 600 + cache creation 400');
});
