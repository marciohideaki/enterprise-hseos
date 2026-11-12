'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { manifest } = require('./helpers/provider-control');

const CHILDREN = 6;
const PER_CHILD = 4;
const COST = manifest().billing.max_request_microusd;

// Real processes race on one shared ledger; the aggregate ceiling must hold regardless of interleaving.
async function race(t, { maxCost, maxRequests }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-budget-'));
  const callsDir = path.join(scratch, 'calls');
  fs.mkdirSync(callsDir);
  const control = new EngineeringControl();
  const children = [];
  t.after(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const done = once(child, 'exit');
        child.kill('SIGKILL');
        await done;
      }
    control.close();
    control.handle.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const value = manifest();
  const taskId = randomUUID();
  const campaignId = randomUUID();
  const authorizationId = randomUUID();
  const authorizations = {
    [authorizationId]: {
      max_requests: maxRequests,
      max_cost_microusd: maxCost,
      deadline: Date.now() + 120_000,
      binding_ids: [value.binding_id],
      task_ids: [taskId],
    },
  };
  const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
  value.limits.max_requests = 100;
  const configured = {
    manifest: value,
    binding_sha256: value.binding_sha256,
    adapter: { inspect: async () => ({}), run: async () => ({}) },
  };
  const campaigns = new ProviderCampaignControl(control, { [value.binding_id]: configured }, { authorizations });
  await campaigns.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: 0,
    action: 'create',
    input: { authorization_id: authorizationId },
  });
  for (let index = 0; index < CHILDREN; index++)
    children.push(fork(path.join(__dirname, 'helpers/budget-attempt-process.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  const ready = children.map((child) => once(child, 'message'));
  for (const child of children)
    child.send({
      state: control.state,
      campaignId,
      taskId,
      callsDir,
      reservations: PER_CHILD,
      maxTries: 400,
      maxRequests: 100,
      costMicrousd: COST,
    });
  for (const [message] of await Promise.all(ready)) assert.equal(message.ready, true, JSON.stringify(message));
  // Start barrier: every child has loaded modules and opened the shared state before any of them dispatches.
  const finished = children.map((child) => once(child, 'message'));
  for (const child of children) child.send({ go: true });
  const results = (await Promise.all(finished)).map(([message]) => message);
  for (const result of results) assert.equal(result.done, true, JSON.stringify(result));
  const contention = results.reduce((sum, result) => sum + result.conflicts + result.uncertain, 0);
  const rows = control.ledger.readStream('control_provider_campaign', campaignId);
  const reserved = rows.filter((row) => row.payload.kind === 'reserved');
  return { results, reserved, calls: fs.readdirSync(callsDir).length, maxCost, contention };
}

function assertCeiling({ results, reserved, calls, maxCost, contention }, expected) {
  assert.ok(contention > 0, 'no child lost a race, so the run was effectively serial');
  let running = 0;
  for (const row of reserved) {
    running += row.payload.reserved_microusd;
    assert.ok(running <= maxCost, `cumulative reservation ${running} exceeded ceiling ${maxCost}`);
  }
  assert.ok(running <= maxCost);
  assert.equal(reserved.length, expected);
  assert.equal(
    results.reduce((sum, result) => sum + result.ok, 0),
    reserved.length,
  );
  assert.equal(calls, reserved.length);
  for (const result of results) assert.deepEqual(result.other, []);
}

test('concurrent processes never reserve beyond the aggregate cost ceiling', async (t) => {
  const capacity = 3;
  const outcome = await race(t, { maxCost: capacity * COST, maxRequests: 50 });
  assertCeiling(outcome, Math.floor((capacity * COST) / COST));
  assert.ok(outcome.results.some((result) => result.exhausted > 0));
});

test('concurrent processes never exceed the aggregate request ceiling', async (t) => {
  const outcome = await race(t, { maxCost: 1_000_000_000, maxRequests: 4 });
  assertCeiling({ ...outcome, maxCost: 1_000_000_000 }, 4);
  assert.ok(outcome.results.some((result) => result.exhausted > 0));
});
