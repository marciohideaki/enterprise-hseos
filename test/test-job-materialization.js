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
const runtime = require('../tools/cli/lib/engineering-task-runtime');
async function setup(t, workflow = false, claim = true) {
  const f = fixture(t);
  const control = new EngineeringControl({ workspaces: [f.root] });
  t.after(() => {
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const id = randomUUID(),
    jobs = control.jobs;
  const now = Date.parse('2027-01-01T00:00:00.000Z');
  jobs.now = () => now;
  const definition = workflow
    ? {
        definition: {
          schema_version: 1,
          workflow_id: 'workflow:prepare',
          max_parallelism: 1,
          limits: {
            ...f.contract.limits,
            max_duration_ms: 120_000,
            max_children: 2,
            max_workflow_steps: 2,
            max_tokens: f.contract.limits.max_tokens * 2,
            max_tool_calls: f.contract.limits.max_tool_calls * 2,
            max_turns: f.contract.limits.max_turns * 2,
          },
          tasks: [
            { id: 'first', contract: f.contract, responses: [], depends_on: [] },
            { id: 'second', contract: f.contract, responses: [], depends_on: ['first'] },
          ],
        },
      }
    : { contract: f.contract, responses: [] };
  await jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 0,
    action: 'create',
    input: {
      kind: workflow ? 'workflow' : 'task',
      definition,
      not_before: new Date(now).toISOString(),
      deadline_at: new Date(now + 120_000).toISOString(),
      depends_on: [],
    },
  });
  if (claim)
    await jobs.worker.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: id,
      expected_sequence: 1,
      action: 'claim',
      fence: 0,
      lease_ms: 1000,
    });
  const command = { schema_version: 1, command_id: randomUUID(), resource_id: id, expected_sequence: 2, fence: 1, action: 'materialize' };
  return { ...f, control, jobs, id, command, now, store: new RelationalSessionEventStore({ ledger: control.ledger }) };
}
for (const workflow of [false, true])
  test(`materialization of ${workflow ? 'workflow' : 'task'} pins identity without dispatch`, async (t) => {
    const f = await setup(t, workflow);
    const claimed = f.jobs.query(f.id);
    const ready = await f.jobs.materializer.execute(f.command);
    assert.equal(ready.status, 'claimed');
    assert.equal(ready.materialization.phase, 'ready');
    assert.equal(ready.execution_deadline_at, claimed.execution_deadline_at);
    assert.deepEqual(await f.jobs.materializer.execute(f.command), ready);
    assert.equal(f.jobs.rows(f.id).length, 4);
    assert.equal(f.control.rows(f.id).length, 2);
    for (const entry of ready.materialization.plan.tasks) {
      const task = new EngineeringTaskState(f.control.handle.db, entry.task_run_id).read();
      assert.equal(task.version, 1);
      assert.equal(task.started, false);
      assert.equal(
        task.created.deadline,
        Math.min(ready.execution_deadline_at, claimed.first_started_at + task.created.contract.limits.max_duration_ms),
      );
      const location = f.control.location(entry.task_run_id);
      assert.equal(
        fs.readFileSync(path.join(location, 'workspace/index.js'), 'utf8'),
        f.contract.initial_files[0]?.content || 'module.exports = (n) => n + 1;\n',
      );
      assert.equal(f.store.readSession(entry.created.session_id).length, workflow ? 0 : 1);
      assert.throws(() => runtime.assembleEngineeringTask({ db: f.control.handle.db, directory: location }, task.created), {
        code: 'JOB_DISPATCH_REQUIRED',
      });
      await assert.rejects(
        runtime.executeEngineeringTask(
          { db: f.control.handle.db },
          new EngineeringTaskState(f.control.handle.db, entry.task_run_id),
          {},
          task.created,
        ),
        { code: 'JOB_DISPATCH_REQUIRED' },
      );
      assert.throws(() => new EngineeringTaskState(f.control.handle.db, entry.task_run_id).append({ kind: 'execution_started' }, 1), {
        code: 'JOB_DISPATCH_REQUIRED',
      });
      assert.throws(() => f.control.terminals.parent(entry.task_run_id), { code: 'JOB_DISPATCH_REQUIRED' });
      for (const action of ['resume', 'cancel', 'reconcile'])
        await assert.rejects(
          f.control.execute({
            schema_version: 1,
            command_id: randomUUID(),
            resource_id: entry.task_run_id,
            action,
            expected_sequence: 1,
            input: {},
          }),
          { code: 'JOB_DISPATCH_REQUIRED' },
        );
    }
    const value = await f.control.query(f.id);
    assert.equal(value.resource_id, f.id);
    assert.equal((await f.control.query(f.id, 'session')).children.length, 0);
    assert.equal(f.store.readSession(value.session_id).length, 1);
    const reopened = new EngineeringControl({ state: f.control.state, workspaces: [f.root] });
    try {
      assert.deepEqual(await reopened.query(f.id), value);
    } finally {
      reopened.close();
    }
    const events = f.control.events(f.id);
    assert.ok(events.events.length > 0);
    assert.equal(f.control.events(f.id, { after: events.next_cursor }).events.length, 0);
  });
test('partial preparation reuses durable IDs and exact files after a failed initializer', async (t) => {
  const f = await setup(t);
  const original = runtime.initializeJobSession;
  const mocked = t.mock.method(runtime, 'initializeJobSession', async () => {
    throw new Error('injected crash before session');
  });
  await assert.rejects(f.jobs.materializer.execute(f.command), /injected crash/);
  const planned = f.jobs.query(f.id);
  assert.equal(planned.materialization.phase, 'planned');
  assert.equal(f.control.rows(f.id)[0].payload.kind, 'job_prepared');
  await assert.rejects(f.control.query(f.id), { code: 'JOB_PREPARATION_PENDING' });
  const dir = path.join(f.control.state, 'jobs', f.id);
  const ino = fs.statSync(path.join(dir, 'engineering-task.json')).ino;
  fs.unlinkSync(path.join(dir, 'workspace/index.js'));
  mocked.mock.restore();
  assert.equal(runtime.initializeJobSession, original);
  const ready = await f.jobs.materializer.execute(f.command);
  assert.deepEqual(ready.materialization.plan, planned.materialization.plan);
  assert.equal(fs.statSync(path.join(dir, 'engineering-task.json')).ino, ino);
  assert.equal(new EngineeringTaskState(f.control.handle.db, f.id).read().version, 1);
  assert.equal(f.store.readSession(ready.materialization.plan.tasks[0].created.session_id).length, 1);
});
test('cancellation during initialization prevents ready receipt and preserves bindings', async (t) => {
  const f = await setup(t);
  const initialize = runtime.initializeJobSession;
  t.mock.method(runtime, 'initializeJobSession', async (...args) => {
    const receipt = await initialize(...args);
    await f.jobs.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.id,
      expected_sequence: 3,
      action: 'cancel',
      input: {},
    });
    return receipt;
  });
  await assert.rejects(f.jobs.materializer.execute(f.command), { code: 'JOB_NOT_CLAIMED' });
  assert.equal(f.jobs.query(f.id).status, 'cancelling');
  assert.equal(f.jobs.query(f.id).materialization.phase, 'planned');
  assert.equal(f.control.rows(f.id).length, 1);
});
test('a replaced manifest cannot expose the job runtime or its tools', async (t) => {
  const f = await setup(t);
  const ready = await f.jobs.materializer.execute(f.command);
  const entry = ready.materialization.plan.tasks[0];
  const directory = f.control.location(f.id);
  const foreignId = randomUUID();
  fs.writeFileSync(path.join(directory, 'engineering-task.json'), JSON.stringify({ task_run_id: foreignId }));
  assert.throws(() => runtime.assembleEngineeringTask({ db: f.control.handle.db, directory }, entry.created), {
    code: 'JOB_DISPATCH_REQUIRED',
  });
  const alias = path.join(f.directory, 'job-alias');
  fs.symlinkSync(directory, alias);
  assert.throws(() => runtime.assembleEngineeringTask({ db: f.control.handle.db, directory: alias }, entry.created), {
    code: 'JOB_DISPATCH_REQUIRED',
  });
  const foreignDirectory = path.join(f.directory, 'foreign');
  fs.mkdirSync(foreignDirectory);
  fs.writeFileSync(path.join(foreignDirectory, 'engineering-task.json'), JSON.stringify({ task_run_id: foreignId }));
  assert.throws(() => runtime.assembleEngineeringTask({ db: f.control.handle.db, directory: foreignDirectory }, entry.created), {
    code: 'JOB_DISPATCH_REQUIRED',
  });
  assert.equal(f.store.readSession(entry.created.session_id).length, 1);
});
for (const point of ['before-session', 'after-session'])
  test(`dead controller recovery after ${point} preserves IDs and first deadline`, async (t) => {
    const f = await setup(t, false, false);
    const { fork } = require('node:child_process');
    const { once } = require('node:events');
    const child = fork(path.join(__dirname, 'helpers/job-claim-process.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    });
    const message = once(child, 'message');
    child.send({
      state: f.control.state,
      root: f.root,
      now: f.now,
      materialize: f.command.command_id,
      preparationFault: point,
      command: { ...f.command, expected_sequence: 1, fence: 0, action: 'claim', lease_ms: 1000, command_id: randomUUID() },
    });
    assert.equal((await message)[0].code, `injected-${point}`);
    const planned = f.jobs.query(f.id);
    await assert.rejects(f.jobs.materializer.execute(f.command), { code: 'JOB_OWNER_MISMATCH' });
    await assert.rejects(
      f.jobs.worker.execute({ ...f.command, command_id: randomUUID(), action: 'reconcile', expected_sequence: 3, lease_ms: 1000 }),
      { code: 'JOB_OWNER_ALIVE' },
    );
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const recovered = await f.jobs.worker.execute({
      ...f.command,
      command_id: randomUUID(),
      action: 'reconcile',
      expected_sequence: 3,
      lease_ms: 1000,
    });
    assert.equal(recovered.fence, 2);
    const ready = await f.jobs.materializer.execute({
      ...f.command,
      command_id: randomUUID(),
      expected_sequence: recovered.current_sequence,
      fence: 2,
    });
    assert.equal(ready.materialization.phase, 'ready');
    assert.deepEqual(ready.materialization.plan, planned.materialization.plan);
    assert.equal(ready.execution_deadline_at, planned.execution_deadline_at);
    assert.equal(new EngineeringTaskState(f.control.handle.db, f.id).read().version, 1);
    assert.equal(f.store.readSession(ready.materialization.plan.tasks[0].created.session_id).length, 1);
  });
test('changed prepared files remain uncertain and are never overwritten on retry', async (t) => {
  const f = await setup(t);
  const mocked = t.mock.method(runtime, 'initializeJobSession', async () => {
    throw new Error('pause');
  });
  await assert.rejects(f.jobs.materializer.execute(f.command), /pause/);
  mocked.mock.restore();
  const file = path.join(f.control.state, 'jobs', f.id, 'workspace/index.js');
  fs.writeFileSync(file, 'altered');
  await assert.rejects(f.jobs.materializer.execute(f.command), /Preparation file/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'altered');
  assert.equal(f.jobs.query(f.id).materialization.phase, 'planned');
  assert.equal(f.control.rows(f.id).length, 1);
});
test('deadline and sequence changes during preparation prevent ready without extending deadline', async (t) => {
  const f = await setup(t);
  const initialize = runtime.initializeJobSession;
  t.mock.method(runtime, 'initializeJobSession', async (...args) => {
    const result = await initialize(...args);
    f.jobs.now = () => f.jobs.query(f.id).execution_deadline_at;
    return result;
  });
  await assert.rejects(f.jobs.materializer.execute(f.command), { code: 'JOB_EXPIRED' });
  assert.equal(f.jobs.query(f.id).execution_deadline_at, f.now + 60_000);
  assert.equal(f.control.rows(f.id).length, 1);
});
test('same concurrent command has one preparation; changed digest and stale commands fail', async (t) => {
  const f = await setup(t);
  const [a, b] = await Promise.all([f.jobs.materializer.execute(f.command), f.jobs.materializer.execute(f.command)]);
  assert.deepEqual(a, b);
  assert.equal(f.jobs.rows(f.id).length, 4);
  await assert.rejects(f.jobs.materializer.execute({ ...f.command, expected_sequence: 4 }), { code: 'CONTROL_IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.jobs.materializer.execute({ ...f.command, command_id: randomUUID(), expected_sequence: 2 }), {
    code: 'CONTROL_SEQUENCE_CONFLICT',
  });
});
test('replay rejects rehashed plan changes and phase/version forgery', async (t) => {
  const f = await setup(t, true);
  await f.jobs.materializer.execute(f.command);
  const { engineeringDigest: digest } = require('../tools/cli/lib/engineering-task-state');
  for (const mutate of [
    (row) => {
      row.schema_version = 2;
    },
    (row) => {
      row.stream_sequence += 2;
      row.payload.command.expected_sequence += 2;
    },
    (row) => {
      row.payload.phase = 'ready';
    },
    (row) => {
      row.payload.command.fence++;
    },
    (row) => {
      row.payload.at = f.now - 1;
    },
    (row) => {
      row.payload.plan.tasks[0].created.deadline++;
    },
    (row) => {
      row.payload.plan.tasks[0].created.responses.push({ name: 'injected', input: {} });
    },
    (row) => {
      row.payload.plan.tasks[1].task_run_id = row.payload.plan.tasks[0].task_run_id;
    },
    (row) => {
      row.payload.plan.manifest.parent_session_id = row.payload.plan.tasks[0].created.session_id;
    },
    (row) => {
      row.payload.plan.manifest.definition.limits.max_tokens++;
    },
    (row) => {
      row.payload.plan.tasks[0].created.contract.initial_files[0].content = 'altered';
    },
    (row) => {
      row.payload.plan.tasks[0].created.binding = {};
    },
  ]) {
    const rows = structuredClone(f.jobs.rows(f.id));
    mutate(rows[2]);
    rows[2].payload.plan_sha256 = digest(rows[2].payload.plan);
    rows[2].payload.digest = digest(rows[2].payload.command);
    assert.throws(() => f.jobs.project(f.id, rows));
  }
});
test('possible task activity blocks completion and cancellation acknowledgement', async (t) => {
  const f = await setup(t);
  const mocked = t.mock.method(runtime, 'initializeJobSession', async () => {
    throw new Error('pause');
  });
  await assert.rejects(f.jobs.materializer.execute(f.command), /pause/);
  mocked.mock.restore();
  new EngineeringTaskState(f.control.handle.db, f.id).append({ kind: 'uncertainty', question: 'Uncertain prior effect' }, 1);
  await assert.rejects(f.jobs.materializer.execute(f.command), { code: 'JOB_OUTCOME_UNCERTAIN' });
  await f.jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.id,
    expected_sequence: 3,
    action: 'cancel',
    input: {},
  });
  await assert.rejects(
    f.jobs.worker.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.id,
      expected_sequence: 4,
      action: 'confirm_cancel',
      fence: 1,
      lease_ms: 1000,
    }),
    { code: 'JOB_OUTCOME_UNCERTAIN' },
  );
  assert.equal(f.jobs.query(f.id).status, 'cancelling');
});
test('shared ledger event queries exclude other jobs and preserve global cursor', async (t) => {
  const f = await setup(t);
  await f.jobs.materializer.execute(f.command);
  const other = randomUUID();
  f.control.append(other, { kind: 'intent', command_id: randomUUID(), digest: 'a'.repeat(64), action: 'create' });
  const events = f.control.events(f.id, { limit: 1000 });
  assert.ok(events.events.every((row) => row.aggregate_id !== other));
  assert.equal(events.next_cursor, f.control.ledger.readGlobal({ limit: 1000 }).at(-1).position);
  assert.deepEqual(f.control.events(f.id, { after: events.next_cursor }).events, []);
  await assert.rejects(f.control.query(f.id, 'review'), { code: 'CONTROL_VIEW_UNAVAILABLE' });
  assert.equal((await f.control.query(f.id, 'evidence')).contract.schema_version, 2);
});

test('a second ledger cannot assemble capabilities over the original job workspace', async (t) => {
  const f = await setup(t);
  const ready = await f.jobs.materializer.execute(f.command);
  const other = require('../tools/mcp-project-state/lib/execution-ledger-schema').createExecutionLedgerFileFixture();
  try {
    const created = ready.materialization.plan.tasks[0].created;
    assert.throws(() => runtime.assembleEngineeringTask({ db: other.db, directory: f.control.location(f.id) }, created), {
      code: 'JOB_LEDGER_MISMATCH',
    });
    const ledger = new (require('../tools/mcp-project-state/lib/execution-event-ledger').ExecutionEventLedger)(other.db);
    assert.deepEqual(ledger.readGlobal({ limit: 100 }), []);
    assert.equal(f.store.readSession(created.session_id).length, 1);
  } finally {
    other.cleanup();
  }
});

test('replacing the database path cannot rebind an already opened fixture view', async (t) => {
  const f = await setup(t);
  const ready = await f.jobs.materializer.execute(f.command);
  const filename = path.join(f.control.state, 'ledger.sqlite');
  const old = `${filename}.old`;
  fs.renameSync(filename, old);
  fs.copyFileSync(old, filename);
  try {
    assert.throws(
      () =>
        require('../tools/mcp-project-state/lib/execution-ledger-schema').assertExecutionLedgerView(
          f.control.handle.db,
          f.control.location(f.id),
        ),
      { code: 'JOB_LEDGER_MISMATCH' },
    );
    assert.equal(ready.materialization.phase, 'ready');
  } finally {
    fs.unlinkSync(filename);
    fs.renameSync(old, filename);
  }
});
for (const point of ['before-files', 'before-task-event']) {
  test(`preparation resumes its intent after fault ${point} without new identity`, async (t) => {
    const f = await setup(t);
    let mock;
    if (point === 'before-files') {
      const mkdir = fs.mkdirSync;
      mock = t.mock.method(fs, 'mkdirSync', (name, ...args) => {
        if (String(name).endsWith('/jobs')) throw new Error('injected-before-files');
        return mkdir(name, ...args);
      });
    } else {
      const append = EngineeringTaskState.prototype.append;
      mock = t.mock.method(EngineeringTaskState.prototype, 'append', function (event, version) {
        if (event.kind === 'created') throw new Error('injected-before-task-event');
        return append.call(this, event, version);
      });
    }
    await assert.rejects(f.jobs.materializer.execute(f.command), new RegExp(`injected-${point}`));
    mock.mock.restore();
    const planned = f.jobs.query(f.id);
    assert.equal(planned.materialization.phase, 'planned');
    assert.equal(new EngineeringTaskState(f.control.handle.db, f.id).read().version, 0);
    assert.equal(f.control.rows(f.id).length, 1);
    const ready = await f.jobs.materializer.execute(f.command);
    assert.deepEqual(ready.materialization.plan, planned.materialization.plan);
    assert.equal(new EngineeringTaskState(f.control.handle.db, f.id).read().version, 1);
    assert.equal(f.store.readSession(ready.materialization.plan.tasks[0].created.session_id).length, 1);
  });
}
