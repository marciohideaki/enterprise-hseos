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

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
  assert.equal(alive(pids[0]), false);
});

test('aborting the campaign kills the client through the cgroup', async (t) => {
  const f = setup(t, { run: 'stubborn' });
  const controller = new AbortController();
  const pending = create(f).adapter.run({ task_id: f.id, signal: controller.signal });
  setTimeout(() => controller.abort(), 1500);
  await assert.rejects(pending, /CONTROL_OUTCOME_UNCERTAIN/);
  assert.equal(alive(f.calls().find((call) => call.argv.includes('-p')).pid), false);
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
