'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { terminalBudget } = require('../tools/cli/lib/terminal-budget');
async function setup(t, script = 'import sys\nprint(sys.stdin.readline().upper(),flush=True)\n', options = {}) {
  const project = fixture(t, { files: { 'main.py': script }, entry: 'main.py', runtime: 'python' });
  if (options.maxCalls) project.contract.limits.max_tool_calls = options.maxCalls;
  const control = new EngineeringControl({ workspaces: [project.root] });
  const taskId = randomUUID();
  await control.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: taskId,
    expected_sequence: 0,
    action: 'create',
    input: { contract: control.prepare(project.contract), responses: options.responses || [] },
  });
  t.after(async () => {
    await control.terminals.shutdown();
    control.close();
    control.handle.cleanup();
  });
  const make = (id, action, input = {}, sequence) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: sequence ?? (action === 'open' ? 0 : control.terminals.query(id).current_sequence),
    action,
    input,
  });
  const open = async (mode = 'job') => {
    const id = randomUUID();
    const command = make(id, 'open', { task_id: taskId, command_id: 'check', mode });
    await control.terminals.execute(command);
    return { id, command };
  };
  return { control, taskId, make, open };
}
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('observation timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('control reserves parent budget and exposes durable cursor without replaying input', async (t) => {
  const { control, taskId, make, open } = await setup(t);
  const { id, command } = await open();
  const result = await control.terminals.execute(command);
  assert.equal(result.action, 'open');
  const input = make(id, 'input', { data: Buffer.from('hello\n').toString('base64') });
  const sent = await control.terminals.execute(input);
  assert.deepEqual(await control.terminals.execute(input), sent);
  await until(() => control.terminals.query(id).descendants_terminated);
  const events = control.terminals.events(id, { limit: 2 });
  const rest = control.terminals.events(id, { after: events.next_cursor });
  assert.ok(rest.events.every((r) => r.stream_sequence > events.next_cursor));
  assert.equal(control.terminals.query(id).outcome_uncertain, false);
  const parent = control.terminals.parent(taskId);
  assert.equal(terminalBudget(parent.handle.db, parent.id).count, 1);
  assert.equal(terminalBudget(parent.handle.db, parent.id).reservations[0].settled, true);
  parent.handle.close();
});
test('CAS, command authorization, mode and finite shared budget fail closed', async (t) => {
  const { control, taskId, make, open } = await setup(t, 'import time\ntime.sleep(30)\n', { maxCalls: 1 });
  const bad = make(randomUUID(), 'open', { task_id: taskId, command_id: 'unknown', mode: 'job' });
  await assert.rejects(control.terminals.execute(bad), { code: 'CONTROL_TERMINAL_COMMAND_DENIED' });
  const { id } = await open();
  await assert.rejects(open(), { code: 'CONTROL_TERMINAL_BUDGET_EXHAUSTED' });
  await assert.rejects(control.terminals.execute(make(id, 'pause', {}, 0)), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  await assert.rejects(control.terminals.execute(make(id, 'resize', { rows: 30, cols: 80 })), { code: 'CONTROL_TERMINAL_MODE_DENIED' });
  await control.terminals.execute(make(id, 'terminate'));
  assert.equal(control.terminals.query(id).descendants_terminated, true);
});
test('receipt loss never repeats effect and requires explicit digest-bound reconciliation', async (t) => {
  const { control, make, open } = await setup(t, 'import sys,time\nprint(sys.stdin.readline(),flush=True)\ntime.sleep(30)\n');
  const { id } = await open();
  const original = control.terminals.append.bind(control.terminals);
  let fail = true;
  control.terminals.append = (resource, payload) => {
    if (payload.kind === 'receipt' && payload.action === 'input' && fail) {
      fail = false;
      throw new Error('lost receipt');
    }
    return original(resource, payload);
  };
  const command = make(id, 'input', { data: Buffer.from('once\n').toString('base64') });
  await assert.rejects(control.terminals.execute(command), /lost receipt/);
  await assert.rejects(control.terminals.execute(command), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  await assert.rejects(control.terminals.execute(make(id, 'input', { data: 'YQ==' })), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  await control.terminals.execute(make(id, 'terminate'));
  const report = control.terminals.query(id);
  assert.equal(report.outcome_uncertain, true);
  await assert.rejects(control.terminals.execute(make(id, 'reconcile', { report_sha256: '0'.repeat(64), answer: 'observed' })), {
    code: 'CONTROL_RECONCILIATION_CONFLICT',
  });
  await control.terminals.execute(
    make(id, 'reconcile', { report_sha256: report.report_sha256, answer: 'Observed output and drained descendants; do not repeat.' }),
  );
  assert.equal(control.terminals.query(id).outcome_uncertain, false);
  await assert.rejects(control.terminals.execute(command), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
});
test('concurrent sessions isolate output and parent cancellation drains all children', async (t) => {
  const { control, taskId, make, open } = await setup(t, 'import sys,time\nprint(sys.stdin.readline(),flush=True)\ntime.sleep(30)');
  const first = await open(),
    second = await open();
  await control.terminals.execute(make(first.id, 'input', { data: Buffer.from('first\n').toString('base64') }));
  await control.terminals.execute(make(second.id, 'input', { data: Buffer.from('second\n').toString('base64') }));
  await until(() => control.terminals.events(first.id).events.some((r) => r.payload.kind === 'output'));
  const text = (id) =>
    control.terminals
      .events(id)
      .events.filter((r) => r.payload.kind === 'output')
      .map((r) => Buffer.from(r.payload.data, 'base64').toString())
      .join('');
  assert.match(text(first.id), /first/);
  assert.doesNotMatch(text(first.id), /second/);
  const status = await control.query(taskId);
  await control.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: taskId,
    expected_sequence: status.current_sequence,
    action: 'cancel',
    input: {},
  });
  assert.ok([first, second].every(({ id }) => control.terminals.query(id).descendants_terminated));
  await assert.rejects(open(), { code: 'CONTROL_TERMINAL_PARENT_BUSY' });
});

for (const phase of ['before-intent', 'after-intent', 'after-prepared', 'before-receipt', 'after-receipt', 'input-receipt']) {
  test(`SIGKILL ${phase}: recovery never respawns and cancellation drains resources`, async (t) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { spawn } = require('node:child_process');
    const { control, taskId, make } = await setup(
      t,
      'import sys,os,time\nif os.fork()==0: os.setsid()\nprint("started",flush=True)\nsys.stdin.readline()\ntime.sleep(30)',
    );
    const id = randomUUID();
    const command = make(id, 'open', { task_id: taskId, command_id: 'check', mode: 'job' });
    const filename = path.join(control.state, `crash-${phase}.json`);
    fs.writeFileSync(filename, JSON.stringify({ state: control.state, phase, command }));
    const child = spawn(process.execPath, ['test/fixtures/terminal/crash-worker.cjs', filename], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (s) => {
      errors += s;
    });
    const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.signal, 'SIGKILL', errors);
    if (phase === 'before-intent') {
      assert.throws(() => control.terminals.query(id), { code: 'CONTROL_TERMINAL_NOT_FOUND' });
      return;
    }
    const prepared = control.terminals.rows(id).find((r) => r.payload.kind === 'prepared');
    if (prepared)
      await until(
        () =>
          !fs.existsSync(prepared.payload.group) ||
          /populated 0/.test(fs.readFileSync(path.join(prepared.payload.group, 'cgroup.events'), 'utf8')),
      );
    await control.terminals.execute(make(id, 'recover'));
    assert.equal(control.terminals.query(id).descendants_terminated, true);
    assert.equal(control.terminals.query(id).outcome_uncertain, true);
    if (prepared) assert.equal(fs.existsSync(prepared.payload.group), false);
    const intents = control.terminals.rows(id).filter((r) => r.payload.kind === 'intent' && r.payload.action === 'open').length;
    if (phase === 'after-receipt' || phase === 'input-receipt') await control.terminals.execute(command);
    else await assert.rejects(control.terminals.execute(command), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
    assert.equal(control.terminals.rows(id).filter((r) => r.payload.kind === 'intent' && r.payload.action === 'open').length, intents);
    const parent = await control.query(taskId);
    await control.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: taskId,
      expected_sequence: parent.current_sequence,
      action: 'cancel',
      input: {},
    });
    const report = control.terminals.query(id);
    await control.terminals.execute(
      make(id, 'reconcile', {
        report_sha256: report.report_sha256,
        answer: 'Process group drained after crash; outcome remains externally reviewed.',
      }),
    );
    assert.equal(control.terminals.query(id).outcome_uncertain, false);
  });
}

test('cancel during remote recovery fences dispatch and preserves other sessions', async (t) => {
  const { control, make, open } = await setup(t, 'import time\ntime.sleep(30)');
  const first = await open(),
    second = await open();
  const other = new EngineeringControl({ state: control.state });
  t.after(() => other.close());
  const recovery = other.terminals.execute(make(first.id, 'recover'));
  const cancellation = control.terminals.execute(make(first.id, 'terminate'));
  await Promise.all([recovery, cancellation]);
  assert.equal(control.terminals.query(first.id).descendants_terminated, true);
  assert.equal(control.terminals.query(first.id).outcome_uncertain, true);
  assert.equal(control.terminals.query(second.id).descendants_terminated, false);
});

test('terminal reservations reduce model tool budget and block parent while active', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = 'print("unchanged",flush=True)\n';
  const { createHash } = require('node:crypto');
  const { control, taskId, open } = await setup(t, source, {
    maxCalls: 1,
    responses: [
      {
        name: 'engineering.write',
        input: { path: 'main.py', expected_sha256: createHash('sha256').update(source).digest('hex'), content: 'print("changed")' },
      },
    ],
  });
  const { id } = await open();
  await until(() => control.terminals.query(id).descendants_terminated);
  const state = await control.query(taskId);
  await control.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: taskId,
    expected_sequence: state.current_sequence,
    action: 'resume',
    input: {},
  });
  const parent = control.terminals.parent(taskId);
  assert.equal(fs.readFileSync(path.join(parent.directory, 'workspace/main.py'), 'utf8'), source);
  parent.handle.close();
});
test('parent resume cannot bypass live terminal reservations through direct runtime', async (t) => {
  const { control, taskId, open } = await setup(t, 'import time\ntime.sleep(30)');
  await open();
  const status = await control.query(taskId);
  const { inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
  await assert.rejects(
    inspectEngineeringTask({ state: control.location(taskId), action: 'resume', expectedSequence: status.current_sequence }),
    { code: 'CONTROL_TERMINALS_UNSETTLED' },
  );
  await assert.rejects(inspectEngineeringTask({ state: control.location(taskId), action: 'cancel' }), {
    code: 'CONTROL_TERMINALS_UNSETTLED',
  });
});
