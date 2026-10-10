'use strict';
// Needs a delegated cgroup (same requirement as the other campaign process tests).
const assert = require('node:assert/strict');
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
