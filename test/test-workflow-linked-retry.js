'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
const { projectWorkspaceSnapshot } = require('../tools/cli/lib/engineering-workspace');
const { projectVerifierDigest } = require('../tools/cli/lib/engineering-project-verifier');

function command(id, action, expected_sequence, input) {
  return { schema_version: 1, command_id: randomUUID(), resource_id: id, expected_sequence, action, input };
}

function setup(t) {
  const project = fixture(t);
  const control = new EngineeringControl({ workspaces: [project.root] });
  t.after(async () => {
    await control.jobs.dispatcher.shutdown();
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const definition = {
    schema_version: 1,
    workflow_id: 'workflow:initial',
    max_parallelism: 1,
    limits: { ...project.contract.limits, max_children: 2, max_workflow_steps: 2 },
    tasks: [{ id: 'first', contract: project.contract, responses: [], depends_on: [] }],
  };
  const id = randomUUID();
  const create = command(id, 'create', 0, {
    kind: 'workflow',
    definition: { definition },
    not_before: '2027-01-01T00:00:00.000Z',
    deadline_at: '2027-01-02T00:00:00.000Z',
    depends_on: [],
  });
  return { project, control, jobs: control.jobs, id, create, definition };
}

test('retry creates one linked successor only after a terminal workflow and reopens durably', async (t) => {
  const f = setup(t);
  await f.jobs.execute(f.create);
  const id = randomUUID();
  const retry = command(id, 'retry', 0, { ...f.create.input, retry_of: f.id });
  await assert.rejects(f.jobs.execute(retry), { code: 'JOB_RETRY_NOT_TERMINAL' });
  const cancelled = await f.jobs.execute(command(f.id, 'cancel', 1, {}));
  assert.equal(cancelled.status, 'cancelled');
  const clock = f.jobs.now;
  f.jobs.now = () => Date.parse(f.create.input.deadline_at);
  await assert.rejects(f.jobs.execute(retry), { code: 'JOB_RETRY_BUDGET_EXCEEDED' });
  f.jobs.now = clock;
  const created = await f.jobs.execute(retry);
  assert.equal(created.status, 'queued');
  assert.equal(created.retry_of, f.id);
  assert.equal(created.retry_root_id, f.id);
  assert.equal(f.jobs.query(f.id).retry_successor_id, id);
  assert.deepEqual(await f.jobs.execute(retry), created);
  const rows = f.jobs.rows(f.id);
  const forged = structuredClone(rows.at(-1));
  forged.payload.command.input.retry_digest = '0'.repeat(64);
  forged.payload.digest = require('../tools/lib/job-contract').jobDigest(forged.payload.command);
  assert.throws(() => f.jobs.project(f.id, [...rows.slice(0, -1), forged]), { code: 'JOB_EVENT_INVALID' });
  await assert.rejects(f.jobs.execute(forged.payload.command), { code: 'JOB_COMMAND_INTERNAL' });
  await assert.rejects(f.jobs.execute(command(randomUUID(), 'retry', 0, { ...retry.input })), {
    code: 'JOB_RETRY_CONFLICT',
  });
  const reopened = new EngineeringControl({ state: f.control.state, workspaces: [f.project.root] });
  try {
    assert.deepEqual(reopened.jobs.query(id), created);
    assert.equal(reopened.jobs.query(f.id).retry_successor_id, id);
  } finally {
    reopened.close();
  }
});

test('concurrent retry commands make one linear successor and preserve the root deadline through another terminal attempt', async (t) => {
  const f = setup(t);
  await f.jobs.execute(f.create);
  await f.jobs.execute(command(f.id, 'cancel', 1, {}));
  const input = { ...f.create.input, retry_of: f.id };
  const candidates = [command(randomUUID(), 'retry', 0, input), command(randomUUID(), 'retry', 0, input)];
  const results = await Promise.allSettled(candidates.map((candidate) => f.jobs.execute(candidate)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'JOB_RETRY_CONFLICT');
  const winner = results.findIndex((result) => result.status === 'fulfilled');
  const secondId = candidates[winner].resource_id;
  assert.equal(f.jobs.query(f.id).retry_successor_id, secondId);
  await f.jobs.execute(command(secondId, 'cancel', 1, {}));
  const third = await f.jobs.execute(command(randomUUID(), 'retry', 0, { ...input, retry_of: secondId }));
  assert.equal(third.retry_of, secondId);
  assert.equal(third.retry_root_id, f.id);
  assert.equal(third.deadline_at, f.create.input.deadline_at);
  assert.equal(f.jobs.query(secondId).retry_successor_id, third.resource_id);
});

test('linked retry keeps the original deadline and resource budget without replaying accepted nodes', async (t) => {
  const f = setup(t);
  const contract = f.project.contract;
  const original = {
    ...f.definition,
    limits: {
      ...contract.limits,
      max_duration_ms: 120_000,
      max_children: 3,
      max_workflow_steps: 3,
      max_tokens: contract.limits.max_tokens * 3,
      max_turns: contract.limits.max_turns * 3,
      max_tool_calls: contract.limits.max_tool_calls * 3,
    },
    tasks: [
      { id: 'first', contract, responses: [], depends_on: [] },
      { id: 'second', contract, responses: [], depends_on: ['first'] },
    ],
  };
  const create = command(f.id, 'create', 0, {
    kind: 'workflow',
    definition: { definition: original },
    not_before: new Date(Date.now() - 1000).toISOString(),
    deadline_at: new Date(Date.now() + 180_000).toISOString(),
    depends_on: [],
  });
  await f.jobs.execute(create);
  await f.jobs.worker.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.id,
    expected_sequence: 1,
    action: 'claim',
    fence: 0,
    lease_ms: 1000,
  });
  await f.jobs.materializer.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.id,
    expected_sequence: 2,
    action: 'materialize',
    fence: 1,
  });
  const plan = f.jobs.query(f.id).materialization.plan;
  const append = EngineeringTaskState.prototype.append;
  EngineeringTaskState.prototype.append = function (value, expectedVersion) {
    const receipt = append.call(this, value, expectedVersion);
    if (this.id === plan.tasks[0].task_run_id && value.kind === 'result' && value.result === 'approved') {
      fs.writeFileSync(path.join(f.project.root, 'index.js'), 'module.exports = (n) => n + 9;\n');
    }
    return receipt;
  };
  t.after(() => {
    EngineeringTaskState.prototype.append = append;
  });
  const terminal = await f.jobs.dispatcher.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.id,
    expected_sequence: 4,
    action: 'dispatch',
    fence: 1,
  });
  assert.equal(terminal.status, 'invalidated');
  assert.deepEqual(
    terminal.execution.proofs.map((proof) => proof.result),
    ['approved', 'not_executed'],
  );
  execFileSync('git', ['-C', f.project.root, 'add', 'index.js']);
  execFileSync('git', ['-C', f.project.root, 'commit', '-m', 'updated baseline']);
  const revised = structuredClone(contract);
  revised.baseline_sha = execFileSync('git', ['-C', f.project.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  revised.workspace.files_sha256 = projectWorkspaceSnapshot(revised).sha256;
  revised.verifier.checks[0].expected = 12;
  revised.verifier.sha256 = projectVerifierDigest(revised);
  const definition = {
    ...original,
    workflow_id: 'workflow:retry',
    limits: { ...contract.limits, max_children: 1, max_workflow_steps: 1 },
    tasks: [{ id: 'second', contract: revised, responses: [], depends_on: [] }],
  };
  const retry = command(randomUUID(), 'retry', 0, {
    kind: 'workflow',
    definition: { definition },
    not_before: new Date(Date.now()).toISOString(),
    deadline_at: new Date(terminal.execution_deadline_at).toISOString(),
    depends_on: [],
    retry_of: f.id,
  });
  await assert.rejects(
    f.jobs.execute({ ...retry, command_id: randomUUID(), input: { ...retry.input, deadline_at: terminal.deadline_at } }),
    {
      code: 'JOB_RETRY_BUDGET_EXCEEDED',
    },
  );
  await assert.rejects(
    f.jobs.execute({
      ...retry,
      command_id: randomUUID(),
      input: { ...retry.input, definition: { definition: { ...definition, tasks: [{ ...definition.tasks[0], id: 'first' }] } } },
    }),
    { code: 'JOB_RETRY_ACCEPTED_NODE' },
  );
  await assert.rejects(
    f.jobs.execute({
      ...retry,
      command_id: randomUUID(),
      input: { ...retry.input, definition: { definition: { ...definition, tasks: [{ ...definition.tasks[0], id: 'third' }] } } },
    }),
    { code: 'JOB_RETRY_NODE_UNKNOWN' },
  );
  await assert.rejects(
    f.jobs.execute({
      ...retry,
      command_id: randomUUID(),
      input: { ...retry.input, definition: { definition: { ...definition, limits: { ...definition.limits, max_children: 2 } } } },
    }),
    { code: 'JOB_RETRY_BUDGET_EXCEEDED' },
  );
  await assert.rejects(
    f.jobs.execute({
      ...retry,
      command_id: randomUUID(),
      input: {
        ...retry.input,
        definition: { definition: { ...definition, limits: { ...definition.limits, max_turns: original.limits.max_turns } } },
      },
    }),
    { code: 'JOB_RETRY_BUDGET_EXCEEDED' },
  );
  const created = await f.jobs.execute(retry);
  assert.equal(created.retry_root_id, f.id);
  assert.equal(created.deadline_at, retry.input.deadline_at);
  assert.deepEqual(
    created.admission.input.definition.tasks.map((task) => task.id),
    ['second'],
  );
  assert.equal(f.jobs.query(f.id).retry_successor_id, retry.resource_id);
  await f.jobs.worker.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: retry.resource_id,
    expected_sequence: 1,
    action: 'claim',
    fence: 0,
    lease_ms: 1000,
  });
  await f.jobs.materializer.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: retry.resource_id,
    expected_sequence: 2,
    action: 'materialize',
    fence: 1,
  });
  const completed = await f.jobs.dispatcher.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: retry.resource_id,
    expected_sequence: 4,
    action: 'dispatch',
    fence: 1,
  });
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(
    completed.execution.proofs.map((proof) => proof.result),
    ['approved'],
  );
  assert.equal(new EngineeringTaskState(f.control.handle.db, plan.tasks[0].task_run_id).read().result.result, 'approved');
});
