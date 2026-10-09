'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { ClaudeCliDriver } = require('../packages/runtime-providers/claude-cli-driver');
const { setup, PATH } = require('./helpers/claude-account');

function driver(f, extra = {}) {
  return new ClaudeCliDriver({ executable: f.executable, cwd: f.cwd, env: { HOME: f.home, PATH }, grace_ms: 150, ...extra });
}
async function run(f, overrides = {}) {
  const events = [];
  const usage = [];
  const result = await driver(f).run({
    prompt: 'ready',
    model: 'pinned-model',
    session_id: randomUUID(),
    timeout_ms: 5000,
    on_event: (event) => events.push(event),
    on_usage: (value) => usage.push(value),
    ...overrides,
  });
  return { result, events, usage };
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('headless run uses the subscription-safe flag set and an allowlisted environment', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'parent-secret-must-not-propagate';
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  t.after(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
  });
  const f = setup(t);
  const { result, events, usage } = await run(f);
  assert.equal(result.stop_reason, 'completed');
  assert.deepEqual(events, [{ type: 'message.delta', text: 'echo:5' }]);
  assert.equal(usage[0].usage.output_tokens, 2);
  assert.equal(usage[0].estimated_cost_usd, 0.0001);
  const call = f.calls().at(-1);
  assert.ok(
    call.env.every((name) => ['HOME', 'PATH'].includes(name)),
    `unexpected env ${call.env}`,
  );
  for (const [flag, value] of [
    ['--permission-mode', 'dontAsk'],
    ['--setting-sources', ''],
    ['--settings', '{"disableAllHooks":true}'],
    ['--mcp-config', '{"mcpServers":{}}'],
    ['--disallowedTools', 'mcp__*'],
    ['--max-turns', '1'],
    ['--output-format', 'stream-json'],
    ['--tools', ''],
  ])
    assert.equal(call.argv[call.argv.indexOf(flag) + 1], value, flag);
  for (const flag of ['--strict-mcp-config', '--disable-slash-commands', '--safe-mode', '--no-session-persistence', '-p', '--verbose'])
    assert.ok(call.argv.includes(flag), flag);
  for (const forbidden of ['--bare', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'ready'])
    assert.ok(!call.argv.includes(forbidden), forbidden);
});

test('persisted and resumed sessions switch the session flags', async (t) => {
  const f = setup(t);
  const session = randomUUID();
  const first = await run(f, { persist: true, session_id: session });
  assert.equal(first.result.session_id, session);
  assert.ok(f.calls().at(-1).argv.includes('--session-id'));
  assert.ok(!f.calls().at(-1).argv.includes('--no-session-persistence'));
  const resumed = await run(f, { persist: true, resume: session });
  assert.equal(resumed.result.session_id, session);
  assert.equal(f.calls().at(-1).argv[f.calls().at(-1).argv.indexOf('--resume') + 1], session);
});

test('credential-bearing or unknown environment names never reach the driver', (t) => {
  const f = setup(t);
  for (const name of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_OAUTH_TOKEN',
  ])
    assert.throws(() => driver(f, { env: { HOME: f.home, PATH, [name]: 'x' } }), /not allowed/, name);
  assert.throws(() => driver(f, { env: { HOME: f.home } }), /HOME and PATH/);
});

test('inspectAccount returns identity and version without credentials', async (t) => {
  const f = setup(t);
  const report = await driver(f).inspectAccount();
  assert.equal(report.version, '2.1.296 (Claude Code)');
  assert.equal(report.identity.authMethod, 'claude.ai');
  assert.ok(!JSON.stringify(report).includes('credentials'));
  f.writeMode({ auth: null });
  await assert.rejects(driver(f).inspectAccount(), { error_code: 'provider_unavailable' });
});

test('refusals are explicit and fail closed', async (t) => {
  const cases = [
    ['api_key', 'identity_unverified'],
    ['tools_init', 'policy_denied'],
    ['tool', 'policy_denied'],
    ['user', 'protocol_error'],
    ['rejected', 'quota_unavailable'],
    ['credits', 'quota_unavailable'],
    ['overage', 'quota_unavailable'],
    ['big', 'output_limit'],
  ];
  for (const [name, code] of cases) {
    const f = setup(t, { run: name });
    await assert.rejects(run(f), { error_code: code }, name);
  }
  const f = setup(t, { run: 'error' });
  assert.equal((await run(f)).result.stop_reason, 'refused');
});

test('tool use is reported as an attempted effect before the refusal', async (t) => {
  const f = setup(t, { run: 'tool' });
  const events = [];
  await assert.rejects(run(f, { on_event: (event) => events.push(event) }), { error_code: 'policy_denied' });
  assert.deepEqual(events, [{ type: 'effect.attempted', effect: 'tool_use' }]);
});

test('allowed_warning is recorded and the run still completes', async (t) => {
  const f = setup(t, { run: 'warning' });
  assert.deepEqual((await run(f)).result.rate_limit_warnings, ['five_hour']);
});

test('a client that ignores SIGINT and SIGTERM is killed on timeout without orphans', async (t) => {
  const f = setup(t, { run: 'stubborn' });
  const started = Date.now();
  await assert.rejects(run(f, { timeout_ms: 300 }), { error_code: 'timeout' });
  assert.ok(Date.now() - started < 3000);
  assert.ok(f.calls().length > 0);
  const pid = f.calls().at(-1).pid;
  assert.equal(alive(pid), false);
});

test('abort cancels through the signal ladder and leaves no process behind', async (t) => {
  const f = setup(t, { run: 'stubborn' });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const { result } = await run(f, { signal: controller.signal });
  assert.equal(result.stop_reason, 'cancelled');
  assert.equal(alive(f.calls().at(-1).pid), false);
});

test('a missing client binary is rejected at construction', (t) => {
  const f = setup(t);
  fs.rmSync(f.executable);
  assert.throws(() => driver(f));
});

test('multibyte output split across chunks is decoded intact', async (t) => {
  const f = setup(t, { run: 'utf8' });
  const { events } = await run(f);
  assert.equal(events[0].text, 'ação—日本語');
});

test('oauth_token is not an accepted account method', () => {
  assert.equal(ClaudeCliDriver.isAccountAuthMethod('oauth_token'), false);
  assert.equal(ClaudeCliDriver.isAccountAuthMethod('claude.ai'), true);
});

test('fast mode and a different pinned model are refused; init state is recorded', async (t) => {
  await assert.rejects(run(setup(t, { run: 'fast' })), { error_code: 'policy_denied' });
  await assert.rejects(run(setup(t, { run: 'model' }), { model: 'claude-pinned-4' }), { error_code: 'policy_denied' });
  const { result } = await run(setup(t), { model: 'opus' });
  assert.deepEqual(result.init, { model: 'opus', fast_mode_state: null });
});
