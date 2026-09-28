'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const instant = Date.parse('2027-01-01T00:00:00.000Z');
async function setup(t, patch = {}) {
  const f = fixture(t);
  const control = new EngineeringControl({ workspaces: [f.root] });
  t.after(() => {
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  let now = instant;
  const jobs = control.jobs;
  jobs.now = () => now;
  const id = randomUUID();
  const create = {
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    action: 'create',
    expected_sequence: 0,
    input: {
      kind: 'task',
      definition: { contract: f.contract, responses: [] },
      not_before: new Date(now).toISOString(),
      deadline_at: new Date(now + 120_000).toISOString(),
      depends_on: [],
      ...patch,
    },
  };
  await jobs.execute(create);
  const command = (action = 'claim', expected_sequence = 1, fence = 0) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    action,
    expected_sequence,
    fence,
    lease_ms: 1000,
  });
  return {
    ...f,
    control,
    jobs,
    id,
    command,
    create,
    setNow: (value) => {
      now = value;
    },
  };
}
async function childClaim(t, f, command = f.command(), options = {}) {
  const child = fork(path.join(__dirname, 'helpers/job-claim-process.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill('SIGKILL');
      await closed;
    }
  });
  const message = once(child, 'message');
  child.send({ state: f.control.state, root: f.root, command, now: instant, ...options });
  return { child, message: (await message)[0] };
}
async function kill(child) {
  const done = once(child, 'exit');
  child.kill('SIGKILL');
  await done;
}

test('first claim fixes execution deadline independently of queue waiting; renew preserves it and replay', async (t) => {
  const f = await setup(t);
  f.setNow(instant + 20_000);
  const claim = f.command();
  const claimed = await f.jobs.worker.execute(claim);
  assert.equal(claimed.first_started_at, instant + 20_000);
  assert.equal(claimed.execution_deadline_at, instant + 80_000);
  assert.equal(claimed.fence, 1);
  f.setNow(instant + 30_000);
  const renewed = await f.jobs.worker.execute(f.command('renew', 2, 1));
  assert.equal(renewed.execution_deadline_at, claimed.execution_deadline_at);
  assert.deepEqual(await f.jobs.worker.execute(claim), claimed);
  assert.deepEqual(f.control.rows(f.id), []);
  await assert.rejects(f.jobs.worker.execute(f.command('renew', 3, 0)), { code: 'JOB_FENCE_CONFLICT' });
  await assert.rejects(f.jobs.worker.execute(f.command('renew', 1, 1)), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  f.setNow(instant + 80_000);
  await assert.rejects(f.jobs.worker.execute(f.command('renew', 3, 1)), { code: 'JOB_EXPIRED' });
});
test('schedule, expiration and changed baseline deny claim without ownership', async (t) => {
  const f = await setup(t);
  f.setNow(instant - 1);
  await assert.rejects(f.jobs.worker.execute(f.command()), { code: 'JOB_NOT_ELIGIBLE' });
  f.setNow(instant + 120_000);
  await assert.rejects(f.jobs.worker.execute(f.command()), { code: 'JOB_NOT_ELIGIBLE' });
  f.setNow(instant);
  fs.writeFileSync(path.join(f.root, 'index.js'), 'changed');
  await assert.rejects(f.jobs.worker.execute(f.command()), { code: 'JOB_BASELINE_DRIFT' });
  assert.equal(f.jobs.query(f.id).current_sequence, 1);
});
test('two real controllers contend once; expired lease cannot steal a living owner', async (t) => {
  const f = await setup(t);
  const children = await Promise.all([childClaim(t, f), childClaim(t, f)]);
  assert.equal(children.filter((entry) => entry.message.result).length, 1);
  assert.equal(children.find((entry) => entry.message.code).message.code, 'CONTROL_SEQUENCE_CONFLICT');
  const winner = children.find((entry) => entry.message.result);
  f.setNow(instant + 2000);
  await assert.rejects(f.jobs.worker.execute(f.command('reconcile', 2, 1)), { code: 'JOB_OWNER_ALIVE' });
  await assert.rejects(f.jobs.worker.execute(f.command('renew', 2, 1)), { code: 'JOB_OWNER_MISMATCH' });
  assert.equal(f.jobs.query(f.id).owner.pid, winner.child.pid);
});
test('dead owner requires explicit reconciliation, advances fence and never extends deadline', async (t) => {
  const f = await setup(t);
  const { child, message } = await childClaim(t, f);
  assert.ok(message.result);
  await kill(child);
  f.setNow(instant + 2000);
  const reconcile = f.command('reconcile', 2, 1);
  const recovered = await f.jobs.worker.execute(reconcile);
  assert.equal(recovered.status, 'claimed');
  assert.equal(recovered.owner.pid, process.pid);
  assert.equal(recovered.fence, 2);
  assert.equal(recovered.execution_deadline_at, instant + 60_000);
  assert.equal(recovered.first_started_at, instant);
  assert.equal(recovered.current_sequence, 4);
  assert.deepEqual(await f.jobs.worker.execute(reconcile), recovered);
  await assert.rejects(f.jobs.worker.execute(f.command('renew', 4, 1)), { code: 'JOB_FENCE_CONFLICT' });
  const reopened = new EngineeringControl({ state: f.control.state });
  try {
    assert.deepEqual(reopened.jobs.query(f.id), recovered);
  } finally {
    reopened.close();
  }
});
test('cancellation of claimed work requires owner acknowledgement and cannot resurrect', async (t) => {
  const f = await setup(t);
  const original = await f.jobs.execute(f.create);
  await f.jobs.worker.execute(f.command());
  const cancel = { schema_version: 1, command_id: randomUUID(), resource_id: f.id, action: 'cancel', expected_sequence: 2, input: {} };
  assert.equal((await f.jobs.execute(cancel)).status, 'cancelling');
  assert.equal((await f.jobs.worker.execute(f.command('confirm_cancel', 3, 1))).status, 'cancelled');
  assert.deepEqual(await f.jobs.execute(f.create), original);
  await assert.rejects(f.jobs.worker.execute(f.command('claim', 4, 1)), { code: 'JOB_NOT_ELIGIBLE' });
});
test('cancel during asynchronous claim fences admission before ownership is persisted', async (t) => {
  const f = await setup(t);
  const admit = f.control.admitCreation.bind(f.control);
  f.control.admitCreation = async (...args) => {
    await f.jobs.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.id,
      action: 'cancel',
      expected_sequence: 1,
      input: {},
    });
    return admit(...args);
  };
  await assert.rejects(f.jobs.worker.execute(f.command()), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  assert.equal(f.jobs.query(f.id).status, 'cancelled');
});
test('dead-owner recovery expires instead of renewing a spent execution deadline', async (t) => {
  const f = await setup(t);
  const { child } = await childClaim(t, f);
  await kill(child);
  f.setNow(instant + 60_000);
  assert.equal((await f.jobs.worker.execute(f.command('reconcile', 2, 1))).status, 'expired');
});
test('same concurrent reconciliation command has one durable result and no public persistence bypass', async (t) => {
  const f = await setup(t);
  const { child } = await childClaim(t, f);
  await kill(child);
  const command = f.command('reconcile', 2, 1);
  const results = await Promise.all([f.jobs.worker.execute(command), f.jobs.worker.execute(command)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(f.jobs.query(f.id).current_sequence, 4);
  assert.equal(f.jobs.worker.append, undefined);
});
test('reconciliation proves drain of an actual descendant surviving the controller death', async (t) => {
  const f = await setup(t);
  const { child, message } = await childClaim(t, f, f.command(), { survivor: true });
  assert.ok(message.group, JSON.stringify(message));
  t.after(async () => {
    await require('../packages/agent-isolation-attestation/executor').removeDrainedGroup(message.group);
  });
  await kill(child);
  assert.match(fs.readFileSync(message.group + '/cgroup.events', 'utf8'), /populated 1/);
  const recovered = await f.jobs.worker.execute(f.command('reconcile', 2, 1));
  assert.equal(recovered.status, 'claimed');
  assert.equal(fs.existsSync(message.group), false);
});
test('cancel while reconciliation is draining prevents a recovered claim and requires current sequence', async (t) => {
  const f = await setup(t);
  const { child, message } = await childClaim(t, f, f.command(), { survivor: true });
  assert.ok(message.group);
  t.after(async () => {
    await require('../packages/agent-isolation-attestation/executor').removeDrainedGroup(message.group);
  });
  await kill(child);
  const recovery = assert.rejects(f.jobs.worker.execute(f.command('reconcile', 2, 1)), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  await f.jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.id,
    action: 'cancel',
    expected_sequence: 3,
    input: {},
  });
  await recovery;
  assert.equal(f.jobs.query(f.id).status, 'cancelling');
  assert.equal((await f.jobs.worker.execute(f.command('reconcile', 4, 1))).status, 'cancelled');
});
test('a dead controller in a different resource parent remains unresolved', async (t) => {
  const f = await setup(t);
  const parent = require('../packages/agent-isolation-attestation/executor').executorOwner().resource_parent;
  const foreign = path.join(parent, 'foreign-' + randomUUID());
  const group = path.join(foreign, 'controller');
  fs.mkdirSync(foreign);
  fs.mkdirSync(group);
  fs.writeFileSync(foreign + '/cgroup.subtree_control', '+memory +pids');
  t.after(() => {
    fs.rmdirSync(group);
    fs.rmdirSync(foreign);
  });
  const { child, message } = await childClaim(t, f, f.command(), { foreignGroup: group });
  assert.ok(message.result, JSON.stringify(message));
  await kill(child);
  await assert.rejects(f.jobs.worker.execute(f.command('reconcile', 2, 1)), { code: 'ENGINEERING_ISOLATION_UNAVAILABLE' });
  assert.equal(f.jobs.query(f.id).status, 'recovering');
  assert.equal(f.jobs.query(f.id).fence, 1);
});
test('workflow claim uses aggregate duration and absolute deadline without materializing children', async (t) => {
  const f = await setup(t);
  const id = randomUUID();
  await f.jobs.execute({
    ...f.create,
    command_id: randomUUID(),
    resource_id: id,
    input: {
      ...f.create.input,
      kind: 'workflow',
      deadline_at: new Date(instant + 30_000).toISOString(),
      definition: {
        definition: {
          schema_version: 1,
          workflow_id: 'workflow:claim',
          max_parallelism: 1,
          limits: { ...f.contract.limits, max_children: 1, max_workflow_steps: 1 },
          tasks: [{ id: 'first', contract: f.contract, responses: [], depends_on: [] }],
        },
      },
    },
  });
  const result = await f.jobs.worker.execute({ ...f.command(), resource_id: id });
  assert.equal(result.execution_deadline_at, instant + 30_000);
  assert.deepEqual(f.control.rows(id), []);
});
test('uncertain execution aggregate and changed admission cannot acquire queue ownership', async (t) => {
  const f = await setup(t);
  f.control.append(f.id, { kind: 'intent', command_id: randomUUID() });
  await assert.rejects(f.jobs.worker.execute(f.command()), { code: 'JOB_OUTCOME_UNCERTAIN' });
  const other = await setup(t);
  const admit = other.control.admitCreation.bind(other.control);
  other.control.admitCreation = async (...args) => ({ ...(await admit(...args)), unexpected: true });
  await assert.rejects(other.jobs.worker.execute(other.command()), { code: 'JOB_ADMISSION_DRIFT' });
  assert.equal(other.jobs.query(other.id).current_sequence, 1);
});
test('replay rejects rehashed lifecycle forgery, unknown versions and out-of-order ownership', async (t) => {
  const f = await setup(t);
  await f.jobs.worker.execute(f.command());
  const { jobDigest } = require('../tools/lib/job-contract');
  for (const mutate of [
    (row) => {
      row.schema_version = 2;
    },
    (row) => {
      row.payload.command.resource_id = randomUUID();
    },
    (row) => {
      row.payload.command.fence = 99;
    },
    (row) => {
      row.payload.command.expected_sequence = 0;
    },
    (row) => {
      row.payload.at = instant - 1;
    },
    (row) => {
      row.payload.phase = 'recovered';
      row.payload.command.action = 'reconcile';
    },
    (row) => {
      row.payload.phase = 'renewed';
      row.payload.command.action = 'renew';
    },
    (row) => {
      row.payload.phase = 'cancelled';
      row.payload.command.action = 'confirm_cancel';
    },
    (row) => {
      row.payload.phase = 'recovering';
      row.payload.command.action = 'reconcile';
    },
    (row) => {
      delete row.payload.owner.resource_parent;
    },
  ]) {
    const rows = f.jobs.rows(f.id);
    mutate(rows[1]);
    rows[1].payload.digest = jobDigest(rows[1].payload.command);
    assert.throws(() => f.jobs.project(f.id, rows));
  }
  assert.equal(f.jobs.query(f.id).status, 'claimed');
});
