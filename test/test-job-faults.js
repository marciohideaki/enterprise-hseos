'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
const { RelationalSessionEventStore } = require('../packages/agent-session-store');

async function setup(t, { workflow = false, expected = 4, prepare = true } = {}) {
  const project = fixture(t, { expected });
  const control = new EngineeringControl({ workspaces: [project.root] });
  t.after(async () => {
    await control.jobs.dispatcher.shutdown();
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const jobs = control.jobs,
    id = randomUUID();
  const definition = workflow
    ? {
        definition: {
          schema_version: 1,
          workflow_id: 'workflow:durable',
          max_parallelism: 1,
          limits: {
            ...project.contract.limits,
            max_duration_ms: 120_000,
            max_children: 2,
            max_workflow_steps: 2,
            max_tokens: project.contract.limits.max_tokens * 2,
            max_tool_calls: project.contract.limits.max_tool_calls * 2,
            max_turns: project.contract.limits.max_turns * 2,
          },
          tasks: [
            { id: 'first', contract: project.contract, responses: [], depends_on: [] },
            { id: 'second', contract: project.contract, responses: [], depends_on: ['first'] },
          ],
        },
      }
    : { contract: project.contract, responses: [] };
  await jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 0,
    action: 'create',
    input: {
      kind: workflow ? 'workflow' : 'task',
      definition,
      not_before: new Date(Date.now() - 1000).toISOString(),
      deadline_at: new Date(Date.now() + 180_000).toISOString(),
      depends_on: [],
    },
  });
  if (!prepare) return { ...project, control, jobs, id };
  await jobs.worker.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 1,
    action: 'claim',
    fence: 0,
    lease_ms: 1000,
  });
  await jobs.materializer.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 2,
    action: 'materialize',
    fence: 1,
  });
  const command = { schema_version: 1, command_id: randomUUID(), resource_id: id, expected_sequence: 4, action: 'dispatch', fence: 1 };
  return { ...project, control, jobs, id, command };
}
for (const workflow of [false, true])
  test(`durable ${workflow ? 'workflow' : 'task'} dispatch settles only independent acceptance`, async (t) => {
    const f = await setup(t, { workflow });
    const prepared = f.jobs.query(f.id);
    const result = await f.jobs.dispatcher.execute(f.command);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.execution_deadline_at, prepared.execution_deadline_at);
    const store = new RelationalSessionEventStore({ ledger: f.control.ledger });
    for (const entry of result.materialization.plan.tasks) {
      const state = new EngineeringTaskState(f.control.handle.db, entry.task_run_id).read();
      assert.equal(state.result.result, 'approved');
      assert.ok(store.replay(entry.created.session_id).terminal_event);
    }
    const before = f.control.ledger.readStream('control_job', f.id);
    assert.deepEqual(await f.jobs.dispatcher.execute(f.command), result);
    assert.deepEqual(f.control.ledger.readStream('control_job', f.id), before);
    const reopened = new EngineeringControl({ state: f.control.state, workspaces: [f.root] });
    try {
      assert.deepEqual(reopened.jobs.query(f.id), result);
    } finally {
      reopened.close();
    }
  });

test('baseline drift after an accepted predecessor invalidates the unstarted dependent after drain', async (t) => {
  const f = await setup(t, { workflow: true });
  const plan = f.jobs.query(f.id).materialization.plan;
  const original = EngineeringTaskState.prototype.append;
  let changed = false;
  EngineeringTaskState.prototype.append = function (value, expectedVersion) {
    const receipt = original.call(this, value, expectedVersion);
    if (!changed && this.id === plan.tasks[0].task_run_id && value.kind === 'result' && value.result === 'approved') {
      changed = true;
      fs.writeFileSync(path.join(f.root, 'index.js'), 'module.exports = (n) => n + 9;\n');
    }
    return receipt;
  };
  t.after(() => {
    EngineeringTaskState.prototype.append = original;
  });
  const result = await f.jobs.dispatcher.execute(f.command);
  assert.equal(changed, true);
  assert.equal(result.status, 'invalidated');
  assert.equal(result.execution.reason, 'baseline-drift-drain-confirmed');
  const first = new EngineeringTaskState(f.control.handle.db, plan.tasks[0].task_run_id).read();
  const second = new EngineeringTaskState(f.control.handle.db, plan.tasks[1].task_run_id).read();
  assert.equal(first.result.result, 'approved');
  assert.equal(second.started, false);
  assert.deepEqual([second.result.result, second.result.reason], ['not_executed', 'JOB_BASELINE_DRIFT']);
  assert.deepEqual(
    result.execution.proofs.map((proof) => proof.result),
    ['approved', 'not_executed'],
  );
  const parent = new RelationalSessionEventStore({ ledger: f.control.ledger }).replay(plan.manifest.parent_session_id);
  assert.equal(parent.workflow_reservations[plan.manifest.definition.workflow_id].released.status, 'failed');
  assert.ok(parent.terminal_event);
  const reopened = new EngineeringControl({ state: f.control.state, workspaces: [f.root] });
  try {
    assert.equal(reopened.jobs.query(f.id).status, 'invalidated');
  } finally {
    reopened.close();
  }
  const terminalRow = f.control.ledger
    .readStream('agent_session', plan.manifest.parent_session_id)
    .find((row) => JSON.parse(row.payload.session_event_json).event_id === parent.terminal_event.event_id);
  const ledger = f.control.ledger;
  const withoutTerminal = {
    append: (...args) => ledger.append(...args),
    appendBatch: (...args) => ledger.appendBatch(...args),
    readGlobal: (...args) => ledger.readGlobal(...args),
    readStream: (type, id) => ledger.readStream(type, id).filter((row) => row.event_id !== terminalRow.event_id),
  };
  const rows = f.jobs.rows(f.id);
  const prior = f.jobs.project(f.id, rows.slice(0, -1));
  const { projectJobExecution } = require('../tools/cli/lib/job-dispatch');
  assert.throws(
    () =>
      projectJobExecution(prior.state, rows.at(-1), new Map(prior.receipts), {
        control: { handle: f.control.handle, ledger: withoutTerminal },
      }),
    { code: 'JOB_EVENT_INVALID' },
  );
});

test('baseline drift after dispatch intent invalidates without starting a child', async (t) => {
  const f = await setup(t, { workflow: true });
  const original = f.control.ledger.append;
  let changed = false;
  f.control.ledger.append = function (request) {
    const receipt = original.call(this, request);
    if (!changed && request.aggregate_type === 'control_job' && request.events[0]?.payload.phase === 'intent') {
      changed = true;
      fs.writeFileSync(path.join(f.root, 'index.js'), 'module.exports = (n) => n + 9;\n');
    }
    return receipt;
  };
  t.after(() => {
    f.control.ledger.append = original;
  });
  const result = await f.jobs.dispatcher.execute(f.command);
  assert.equal(changed, true);
  assert.equal(result.status, 'invalidated');
  for (const entry of result.materialization.plan.tasks) {
    const state = new EngineeringTaskState(f.control.handle.db, entry.task_run_id).read();
    assert.equal(state.started, false);
    assert.deepEqual([state.result.result, state.result.reason], ['not_executed', 'JOB_BASELINE_DRIFT']);
  }
  const parent = new RelationalSessionEventStore({ ledger: f.control.ledger }).replay(
    result.materialization.plan.manifest.parent_session_id,
  );
  assert.ok(parent.terminal_event);
});

test('completed model does not settle a failing independent acceptance as success', async (t) => {
  const f = await setup(t, { expected: 999 });
  const result = await f.jobs.dispatcher.execute(f.command);
  assert.equal(result.status, 'failed');
  const state = new EngineeringTaskState(f.control.handle.db, f.id).read();
  assert.equal(state.result.result, 'failed');
});

test('stale fence, changed baseline and cancellation cannot create dispatch intent', async (t) => {
  const f = await setup(t);
  await assert.rejects(f.jobs.dispatcher.execute({ ...f.command, fence: 2 }), { code: 'JOB_FENCE_CONFLICT' });
  fs.writeFileSync(path.join(f.root, 'index.js'), 'module.exports = () => 9;\n');
  await assert.rejects(f.jobs.dispatcher.execute(f.command));
  assert.equal(f.jobs.rows(f.id).length, 4);
  fs.writeFileSync(path.join(f.root, 'index.js'), 'module.exports = (n) => n + 1;\n');
  await f.jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.id,
    expected_sequence: 4,
    action: 'cancel',
    input: {},
  });
  await assert.rejects(f.jobs.dispatcher.execute({ ...f.command, expected_sequence: 5 }));
  assert.equal(new EngineeringTaskState(f.control.handle.db, f.id).read().started, false);
});

for (const workflow of [false, true])
  test(`cancellation during ${workflow ? 'workflow' : 'task'} dispatch drains before settlement`, async (t) => {
    const f = await setup(t, { workflow });
    const running = f.jobs.dispatcher.execute(f.command);
    while (f.jobs.query(f.id).status !== 'running') await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const state = f.jobs.query(f.id);
    await f.jobs.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.id,
      expected_sequence: state.current_sequence,
      action: 'cancel',
      input: {},
    });
    const result = await running;
    assert.equal(result.status, 'cancelled', JSON.stringify(result.execution));
    assert.equal(f.jobs.dispatcher.active, 0);
  });

test('intent without confirmed outcome is uncertain and never automatically dispatched twice', async (t) => {
  const f = await setup(t);
  const runtime = require('../tools/cli/lib/engineering-task-runtime');
  const original = runtime.executeJobTask;
  let calls = 0;
  runtime.executeJobTask = async () => {
    calls++;
    throw new Error('lost-receipt');
  };
  t.after(() => {
    runtime.executeJobTask = original;
  });
  const result = await f.jobs.dispatcher.execute(f.command);
  assert.equal(result.status, 'uncertain');
  assert.deepEqual(await f.jobs.dispatcher.execute(f.command), result);
  await assert.rejects(f.jobs.dispatcher.execute({ ...f.command, command_id: randomUUID(), expected_sequence: result.current_sequence }), {
    code: 'JOB_OUTCOME_UNCERTAIN',
  });
  await f.jobs.dispatcher.tick();
  assert.equal(calls, 1);
  await assert.rejects(
    f.jobs.dispatcher.execute({ ...f.command, action: 'reconcile', command_id: randomUUID(), expected_sequence: result.current_sequence }),
    { code: 'JOB_OWNER_ALIVE' },
  );
});

test('shutdown stops claims and drains active dispatch before SQLite may close', async (t) => {
  const f = await setup(t);
  const running = f.jobs.dispatcher.execute(f.command);
  while (f.jobs.query(f.id).status !== 'running') await new Promise((resolve) => setTimeout(resolve, 5));
  assert.throws(() => f.control.close(), { code: 'CONTROL_EXECUTION_ACTIVE' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await f.jobs.dispatcher.shutdown();
  assert.equal((await running).status, 'cancelled');
  await assert.rejects(f.jobs.dispatcher.execute(f.command), { code: 'JOB_WORKER_CLOSING' });
});

test('workflow failure blocks a not-yet-started dependent and retains earlier evidence', async (t) => {
  const f = await setup(t, { workflow: true, expected: 999 });
  const result = await f.jobs.dispatcher.execute(f.command);
  assert.equal(result.status, 'failed', JSON.stringify(result.execution));
  const entries = result.materialization.plan.tasks;
  assert.equal(new EngineeringTaskState(f.control.handle.db, entries[0].task_run_id).read().result.result, 'failed');
  assert.equal(new EngineeringTaskState(f.control.handle.db, entries[1].task_run_id).read().started, false);
  const rows = f.jobs.rows(f.id);
  const forged = structuredClone(rows.at(-1));
  forged.payload.outcome = 'invalidated';
  forged.payload.reason = 'baseline-drift-drain-confirmed';
  assert.throws(() => f.jobs.project(f.id, [...rows.slice(0, -1), forged]), { code: 'JOB_EVENT_INVALID' });
});

for (const fault of ['before-effect', 'after-effect'])
  test(`dead controller at ${fault} reconciles without another dispatch`, async (t) => {
    const f = await setup(t, { prepare: false });
    const { fork } = require('node:child_process');
    const { once } = require('node:events');
    const child = fork(path.join(__dirname, 'helpers/job-dispatch-process.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    const message = once(child, 'message');
    child.send({ state: f.control.state, root: f.root, fault });
    assert.equal((await message)[0].boundary, fault);
    const before = f.jobs.query(f.id);
    assert.equal(before.status, 'running');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const result = await f.jobs.dispatcher.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.id,
      expected_sequence: before.current_sequence,
      fence: before.fence,
      action: 'reconcile',
    });
    assert.equal(result.status, fault === 'after-effect' ? 'succeeded' : 'uncertain');
    assert.equal(result.execution_deadline_at, before.execution_deadline_at);
    await f.jobs.dispatcher.tick();
    assert.equal(f.jobs.rows(f.id).filter((row) => row.payload.phase === 'intent').length, 1);
  });

test('two controller processes poll the durable queue but only one dispatches', async (t) => {
  const f = await setup(t, { prepare: false });
  const { fork } = require('node:child_process');
  const { once } = require('node:events');
  const children = [0, 1].map(() =>
    fork(path.join(__dirname, 'helpers/job-dispatch-process.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }),
  );
  t.after(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const done = once(child, 'exit');
        child.kill('SIGKILL');
        await done;
      }
  });
  const messages = children.map((child) => once(child, 'message'));
  for (const child of children) child.send({ state: f.control.state, root: f.root });
  for (const [message] of await Promise.all(messages)) assert.equal(message.done, true, JSON.stringify(message));
  assert.equal(f.jobs.query(f.id).status, 'succeeded');
  assert.equal(f.jobs.rows(f.id).filter((row) => row.payload.phase === 'intent').length, 1);
});

test('expired queued job gets a durable terminal result without materialization', async (t) => {
  const f = await setup(t, { prepare: false });
  f.jobs.now = () => Date.parse(f.jobs.query(f.id).deadline_at);
  await f.jobs.dispatcher.tick();
  assert.equal(f.jobs.query(f.id).status, 'expired');
  assert.equal(f.control.rows(f.id).length, 0);
});

test('shutdown during admission cannot commit an intent or reach the runtime', async (t) => {
  const f = await setup(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const original = f.jobs.worker.admit.bind(f.jobs.worker);
  f.jobs.worker.admit = async (state) => {
    await gate;
    return original(state);
  };
  const running = f.jobs.dispatcher.execute(f.command);
  const rejected = assert.rejects(running, { code: 'JOB_WORKER_CLOSING' });
  const stopping = f.jobs.dispatcher.shutdown();
  release();
  await stopping;
  await rejected;
  assert.equal(f.jobs.rows(f.id).length, 4);
  assert.equal(new EngineeringTaskState(f.control.handle.db, f.id).read().started, false);
});

test('closed quiescent snapshot restored at the same path preserves IDs and one dispatch', async (t) => {
  const f = await setup(t);
  const before = f.jobs.query(f.id);
  const originalPath = f.control.state;
  await f.jobs.dispatcher.shutdown();
  f.control.close();
  const backup = path.join(f.directory, 'closed-ledger-backup');
  require('node:child_process').execFileSync('cp', ['-a', '--', originalPath, backup]);
  fs.rmSync(originalPath, { recursive: true });
  require('node:child_process').execFileSync('cp', ['-a', '--', backup, originalPath]);
  const restored = new EngineeringControl({ state: originalPath, workspaces: [f.root] });
  try {
    assert.deepEqual(restored.jobs.query(f.id), before);
    const result = await restored.jobs.dispatcher.execute(f.command);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.execution_deadline_at, before.execution_deadline_at);
    assert.deepEqual(result.materialization.plan, before.materialization.plan);
  } finally {
    await restored.jobs.dispatcher.shutdown();
    restored.close();
  }
});

test('replay rejects false success even when the settlement digest is recomputed', async (t) => {
  const f = await setup(t, { expected: 999 });
  await f.jobs.dispatcher.execute(f.command);
  const rows = f.jobs.rows(f.id);
  const { state, receipts } = f.jobs.project(f.id, rows.slice(0, -1));
  const forged = structuredClone(rows.at(-1));
  forged.payload.outcome = 'succeeded';
  const { projectJobExecution } = require('../tools/cli/lib/job-dispatch');
  assert.throws(() => projectJobExecution(state, forged, new Map(receipts)), { code: 'JOB_EVENT_INVALID' });
  for (const mutate of [
    (row) => {
      row.schema_version = 2;
    },
    (row) => {
      row.payload.command.fence++;
    },
    (row) => {
      row.payload.at = 0;
    },
    (row) => {
      row.payload.proofs = [];
    },
    (row) => {
      row.payload.proofs[0].task_id = randomUUID();
    },
  ]) {
    const bad = structuredClone(rows.at(-1));
    mutate(bad);
    assert.throws(() => projectJobExecution(state, bad, new Map(receipts)));
  }
});

test('service closes admission then cancels owners before waiting for active HTTP requests', async (t) => {
  const controlModule = require('../tools/cli/lib/engineering-control');
  const config = require('../tools/cli/lib/control-configuration');
  const http = require('../tools/cli/lib/engineering-control-http');
  let finishRequests, serving;
  const started = new Promise((resolve) => {
    serving = resolve;
  });
  let listenerClosed = false,
    ledgerClosed = false;
  const control = {
    state: '/fixture',
    jobs: {
      dispatcher: {
        start() {
          serving();
        },
        async shutdown() {
          assert.equal(listenerClosed, true);
        },
      },
    },
    providerCampaigns: {
      async shutdown() {
        finishRequests();
      },
    },
    terminals: { async shutdown() {} },
    close() {
      ledgerClosed = true;
    },
  };
  t.mock.method(controlModule, 'EngineeringControl', function () {
    return control;
  });
  t.mock.method(config, 'loadControlConfiguration', () => ({}));
  t.mock.method(http, 'startControlServer', async () => ({
    url: 'http://127.0.0.1:1',
    close() {
      listenerClosed = true;
      return new Promise((resolve) => {
        finishRequests = resolve;
      });
    },
  }));
  const operation = require('../tools/cli/commands/control').action('serve', { config: '/fixture' });
  await started;
  process.emit('SIGTERM');
  let timeout;
  try {
    await Promise.race([
      operation,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('HTTP close blocked cancellation')), 1000);
      }),
    ]);
    assert.equal(ledgerClosed, true);
  } finally {
    clearTimeout(timeout);
  }
});

test('polling is explicit, bounded and reports failures without repeating them', async (t) => {
  const f = await setup(t, { prepare: false });
  const deadline = Date.parse(f.jobs.query(f.id).deadline_at);
  f.jobs.now = () => deadline;
  assert.throws(() => f.jobs.dispatcher.start({ interval_ms: 0 }), { code: 'JOB_POLL_INVALID' });
  f.jobs.dispatcher.start({ interval_ms: 25 });
  assert.throws(() => f.jobs.dispatcher.start(), { code: 'JOB_WORKER_CLOSING' });
  const until = Date.now() + 2000;
  while (f.jobs.query(f.id).status === 'queued' && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.jobs.query(f.id).status, 'expired');
  await f.jobs.dispatcher.shutdown();
});

test('a failed predecessor cancels its queued dependent without materializing it', async (t) => {
  const f = await setup(t, { expected: 999 });
  const dependent = randomUUID();
  await f.jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: dependent,
    expected_sequence: 0,
    action: 'create',
    input: {
      kind: 'task',
      definition: { contract: f.contract, responses: [] },
      not_before: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 120_000).toISOString(),
      depends_on: [f.id],
    },
  });
  await f.jobs.dispatcher.tick();
  assert.equal(f.jobs.query(dependent).status, 'queued');
  await f.jobs.dispatcher.execute(f.command);
  await f.jobs.dispatcher.tick();
  assert.equal(f.jobs.query(dependent).status, 'cancelled');
  assert.equal(f.control.rows(dependent).length, 0);
  assert.equal(f.jobs.query(f.id).status, 'failed');
});
