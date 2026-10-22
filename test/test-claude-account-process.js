'use strict';
// Needs a delegated cgroup (same requirement as the other campaign process tests).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createNativeCampaignAdapter } = require('../tools/cli/lib/provider-native-adapter');
const { runCampaignProcess } = require('../tools/cli/lib/provider-campaign-process');
const { setup } = require('./helpers/claude-account');

const fs = require('node:fs');
const path = require('node:path');

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
