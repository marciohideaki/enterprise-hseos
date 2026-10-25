'use strict';
// Needs a delegated cgroup (same requirement as the other campaign process tests).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createNativeCampaignAdapter } = require('../tools/cli/lib/provider-native-adapter');
const { runCampaignProcess } = require('../tools/cli/lib/provider-campaign-process');
const { setup } = require('./helpers/claude-account');

// A killed process is gone once it no longer runs. Until its new parent reaps it, it can linger as a zombie, which
// `kill(pid, 0)` still reports as present, so read the kernel's state and give the reaper a bounded moment.
const state = (pid) => {
  try {
    return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '')[0];
  } catch {
    return null;
  }
};
const assertGone = async (pid) => {
  const deadline = Date.now() + 5000;
  while (![null, 'Z', 'X'].includes(state(pid)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok([null, 'Z', 'X'].includes(state(pid)), `pid ${pid} is still running (state ${state(pid)}) after the campaign was stopped`);
};
const create = (f) =>
  createNativeCampaignAdapter({ manifest: f.m, binding: f.filename, options: f.settings }, { processRunner: runCampaignProcess });

test('claude/account inspects and runs inside a resource-limited cgroup', async (t) => {
  const f = setup(t);
  const { adapter } = create(f);
  const observation = await adapter.inspect({ signal: new AbortController().signal });
  assert.equal(observation.account_sha256, f.m.authentication.account_sha256);
  const result = await adapter.run({ task_id: f.id, signal: new AbortController().signal });
  assert.equal(result.output_tokens, 2);
  assert.equal(result.cost_microusd, null);
});

test('a client that ignores termination signals leaves no process after the campaign timeout', async (t) => {
  const f = setup(t, { run: 'stubborn' });
  f.m.limits.max_duration_ms = 3000;
  await assert.rejects(create(f).adapter.run({ task_id: f.id, signal: new AbortController().signal }), /CONTROL_OUTCOME_UNCERTAIN/);
  const pids = f
    .calls()
    .filter((call) => call.argv.includes('-p'))
    .map((call) => call.pid);
  assert.equal(pids.length, 1);
  await assertGone(pids[0]);
});

test('aborting the campaign kills the client and a detached grandchild through the cgroup', async (t) => {
  // The client ignores termination signals and leaves a grandchild in its own session, so neither the worker kill, the
  // client's own timeout nor a signal to a process group can reach it: only killing the cgroup does.
  const f = setup(t, { run: 'immortal' });
  const grandchildFile = path.join(f.home, 'grandchild.pid');
  t.after(() => {
    try {
      process.kill(Number(fs.readFileSync(grandchildFile, 'utf8')), 'SIGKILL');
    } catch {
      // Already gone, or never started.
    }
  });
  const controller = new AbortController();
  const pending = create(f).adapter.run({ task_id: f.id, signal: controller.signal });
  const outcome = pending.then(
    () => null,
    (error) => error,
  );
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(grandchildFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(fs.existsSync(grandchildFile), 'the client started and left its grandchild');
  const grandchild = Number(fs.readFileSync(grandchildFile, 'utf8'));
  const client = f.calls().find((call) => call.argv.includes('-p')).pid;
  assert.notEqual(state(client), null, 'the client is running before the abort');
  assert.notEqual(state(grandchild), null, 'the grandchild is running before the abort');
  controller.abort();
  const error = await outcome;
  await assertGone(client);
  await assertGone(grandchild);
  assert.match(String(error?.message), /CONTROL_OUTCOME_UNCERTAIN/);
});

const rejection = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected a rejection');
};
const SECRET = `sk-ant-api03-${'A'.repeat(40)}`;

test('a failing worker reports its real cause in the uncertain error', async (t) => {
  const f = setup(t, { run: 'error' });
  const error = await rejection(create(f).adapter.run({ task_id: f.id, signal: new AbortController().signal }));
  assert.equal(error.code, 'CONTROL_OUTCOME_UNCERTAIN');
  assert.equal(error.diagnostic.exit_code, 1);
  assert.equal(error.diagnostic.timed_out, false);
  assert.equal(error.diagnostic.worker.name, 'Error');
  assert.match(error.diagnostic.worker.message, /^uncertain result: stop_reason="refused"/);
  // Neither the prompt nor the account identity is part of the diagnostic.
  assert.equal(JSON.stringify(error.diagnostic).includes('owner@example.invalid'), false);
  assert.equal(JSON.stringify(error.diagnostic).includes('ready'), false);
});

test('the diagnostic carries the worker stderr and message with credentials withheld and the prompt left out', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-diagnostic-worker-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worker = path.join(directory, 'worker.js');
  fs.writeFileSync(
    worker,
    [
      String.raw`process.stderr.write('plain stderr line\n');`,
      `process.stderr.write('leaked ${SECRET} in stderr\\n');`,
      `process.stdout.write(JSON.stringify({ error: 'CONTROL_OUTCOME_UNCERTAIN', diagnostic: { name: 'Error', code: 'protocol_error', message: 'failed with ${SECRET}', prompt: 'PROMPT-BODY' } }) + '\\n');`,
      'process.exitCode = 1;',
    ].join('\n'),
  );
  const error = await rejection(
    runCampaignProcess({
      args: [worker],
      input: { operation: 'run', prompt: 'PROMPT-BODY' },
      signal: new AbortController().signal,
      timeout_ms: 5000,
      pids_max: 64,
      memory_max_bytes: 536_870_912,
    }),
  );
  assert.equal(error.code, 'CONTROL_OUTCOME_UNCERTAIN');
  assert.equal(error.diagnostic.worker.code, 'protocol_error');
  assert.equal(error.diagnostic.worker.message, '<withheld: credential pattern>');
  assert.equal(error.diagnostic.stderr, '<withheld: credential pattern>');
  const text = JSON.stringify(error.diagnostic);
  assert.equal(text.includes('sk-ant'), false);
  assert.equal(text.includes('PROMPT-BODY'), false);
});

test('stderr without a credential is kept, cut to a fixed size', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-diagnostic-worker-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worker = path.join(directory, 'worker.js');
  fs.writeFileSync(worker, "process.stderr.write('x'.repeat(20000));\nprocess.exitCode = 3;\n");
  const error = await rejection(
    runCampaignProcess({
      args: [worker],
      input: { operation: 'run' },
      signal: new AbortController().signal,
      timeout_ms: 5000,
      pids_max: 64,
      memory_max_bytes: 536_870_912,
    }),
  );
  assert.equal(error.diagnostic.exit_code, 3);
  assert.equal(error.diagnostic.worker, null);
  assert.ok(error.diagnostic.stderr.length > 0 && error.diagnostic.stderr.length <= 1024);
});

test('a key body whose BEGIN marker fell out of the stderr window never reaches the diagnostic', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-diagnostic-worker-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worker = path.join(directory, 'worker.js');
  fs.writeFileSync(
    worker,
    [
      "const { randomBytes } = require('node:crypto');",
      "const rows = Array.from({ length: 90 }, () => 'Zz9' + randomBytes(48).toString('base64').replace(/=/g, 'q').slice(0, 61));",
      String.raw`process.stderr.write(['-----BEGIN PRIVATE KEY-----', ...rows, ''].join('\n'));`,
      'process.exitCode = 1;',
    ].join('\n'),
  );
  const error = await rejection(
    runCampaignProcess({
      args: [worker],
      input: { operation: 'run' },
      signal: new AbortController().signal,
      timeout_ms: 5000,
      pids_max: 64,
      memory_max_bytes: 536_870_912,
    }),
  );
  assert.match(error.diagnostic.stderr, /^<withheld: key body, \d+ lines>$/);
});

test('a timeout and an abort are named in the diagnostic', async (t) => {
  const f = setup(t, { run: 'stubborn' });
  f.m.limits.max_duration_ms = 3000;
  const timedOut = await rejection(create(f).adapter.run({ task_id: f.id, signal: new AbortController().signal }));
  assert.equal(timedOut.diagnostic.timed_out, true);
  const g = setup(t, { run: 'stubborn' });
  const controller = new AbortController();
  const pending = rejection(create(g).adapter.run({ task_id: g.id, signal: controller.signal }));
  setTimeout(() => controller.abort(), 1500);
  assert.equal((await pending).diagnostic.aborted, true);
});

test('a client output limit overrun travels client, worker and runner as the explicit provider output limit', async (t) => {
  const f = setup(t, { run: 'output_limit' });
  const error = await rejection(create(f).adapter.run({ task_id: f.id, signal: new AbortController().signal }));
  assert.equal(error.code, 'CONTROL_PROVIDER_OUTPUT_LIMIT');
  assert.equal(error.diagnostic.limit, 'output_tokens');
  assert.equal(error.diagnostic.client_limit_tokens, f.m.limits.max_output_tokens);
  assert.equal(f.calls().filter((call) => call.argv.includes('-p')).length, 1, 'not retried');
});
