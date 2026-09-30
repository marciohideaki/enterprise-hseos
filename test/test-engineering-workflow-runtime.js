'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createEngineeringExample } = require('../tools/examples/engineering-task');
const { parseEngineeringWorkflow, runEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');

function definition() {
  return {
    schema_version: 1,
    workflow_id: 'workflow:engineering-examples',
    max_parallelism: 1,
    limits: { max_turns: 24, max_tokens: 300_000, max_duration_ms: 180_000, max_tool_calls: 24, max_children: 3, max_workflow_steps: 3 },
    tasks: ['addition', 'clamp', 'unique'].map((name, index, names) => {
      const example = createEngineeringExample(name);
      return { id: name, contract: example.contract, responses: example.responses, depends_on: index === 0 ? [] : [names[index - 1]] };
    }),
  };
}

test('WorkflowEngine composes the three engineering tasks using independent outcomes', async () => {
  const result = await runEngineeringWorkflow({ definition: definition() });
  try {
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.deepEqual(
      result.tasks.map((task) => task.result),
      ['approved', 'approved', 'approved'],
    );
  } finally {
    fs.rmSync(result.state, { recursive: true, force: true });
  }
});

test('a completed model with a failed task prevents execution of dependent tasks', async () => {
  const input = definition();
  input.tasks[0].responses = [];
  const result = await runEngineeringWorkflow({ definition: input });
  try {
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.deepEqual(
      result.tasks.map((task) => task.result),
      ['failed', 'not_executed', 'not_executed'],
    );
  } finally {
    fs.rmSync(result.state, { recursive: true, force: true });
  }
});

test('workflow validation rejects cycles and aggregate oversubscription before creating state', () => {
  for (const limit of ['max_tokens', 'max_tool_calls', 'max_turns', 'max_children', 'max_workflow_steps', 'max_duration_ms']) {
    const input = definition();
    input.limits[limit] = 1;
    assert.throws(() => parseEngineeringWorkflow(input));
  }
  const cycle = definition();
  cycle.tasks[0].depends_on = ['unique'];
  assert.throws(() => parseEngineeringWorkflow(cycle), /cycle/);
});

test('workflow status and create-only resume use the canonical ledger', async () => {
  const { inspectEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
  const result = await runEngineeringWorkflow({ definition: definition(), createOnly: true });
  try {
    assert.equal(result.status, 'not_executed');
    assert.deepEqual(await inspectEngineeringWorkflow({ state: result.state }), result);
    await assert.rejects(inspectEngineeringWorkflow({ state: result.state, action: 'resume', expectedSequence: 999 }));
    const resumed = await inspectEngineeringWorkflow({ state: result.state, action: 'resume', expectedSequence: result.current_sequence });
    assert.equal(resumed.status, 'completed', JSON.stringify(resumed));
    assert.deepEqual(
      await inspectEngineeringWorkflow({ state: result.state, action: 'resume', expectedSequence: resumed.current_sequence }),
      resumed,
    );
  } finally {
    fs.rmSync(result.state, { recursive: true, force: true });
  }
});

test('workflow cancellation before execution preserves all task artifacts and prevents resume', async () => {
  const { inspectEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
  const result = await runEngineeringWorkflow({ definition: definition(), createOnly: true });
  try {
    const cancelled = await inspectEngineeringWorkflow({ state: result.state, action: 'cancel' });
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.tasks.every((task) => task.result === 'not_executed'));
    assert.deepEqual(
      await inspectEngineeringWorkflow({ state: result.state, action: 'resume', expectedSequence: cancelled.current_sequence }),
      cancelled,
    );
  } finally {
    fs.rmSync(result.state, { recursive: true, force: true });
  }
});

test('workflow definition identity is protected after creation', async () => {
  const path = require('node:path');
  const { inspectEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
  const result = await runEngineeringWorkflow({ definition: definition(), createOnly: true });
  try {
    const filename = path.join(result.state, 'engineering-workflow.json');
    const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
    manifest.definition.max_parallelism = 2;
    fs.writeFileSync(filename, JSON.stringify(manifest));
    await assert.rejects(inspectEngineeringWorkflow({ state: result.state }), /digest mismatch/);
  } finally {
    fs.rmSync(result.state, { recursive: true, force: true });
  }
});

test('parallel tasks share the declared aggregate budget and release unused reservations', async () => {
  const input = definition();
  input.max_parallelism = 2;
  input.tasks = input.tasks.slice(0, 2).map((task) => ({ ...task, depends_on: [] }));
  const result = await runEngineeringWorkflow({ definition: input });
  try {
    assert.equal(result.status, 'completed', JSON.stringify(result));
    for (const budget of Object.values(result.budget)) {
      assert.ok(budget.spent > 0 && budget.spent <= budget.ceiling);
      assert.equal(budget.reserved, 0);
      assert.ok(budget.released >= 0);
    }
  } finally {
    fs.rmSync(result.state, { recursive: true, force: true });
  }
});

test('explicit migration converts eligible definitions without touching legacy history or executing tasks', () => {
  const path = require('node:path');
  const os = require('node:os');
  const YAML = require('yaml');
  const { migrateEngineeringWorkflow, readEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-workflow-migration-'));
  try {
    const source = path.join(directory, 'definition.yaml');
    const output = path.join(directory, 'definition.json');
    const input = definition();
    const original = YAML.stringify(input);
    fs.writeFileSync(source, original);
    const result = migrateEngineeringWorkflow({ source, output });
    assert.equal(result.execution_authorized, false);
    assert.deepEqual(readEngineeringWorkflow(output), input);
    assert.equal(fs.readFileSync(source, 'utf8'), original);
    assert.throws(() => migrateEngineeringWorkflow({ source, output }), /EEXIST/);
    fs.writeFileSync(source, YAML.stringify({ run_id: 'legacy', status: 'completed', phase: 'implement' }));
    assert.throws(() => migrateEngineeringWorkflow({ source, output: path.join(directory, 'legacy.json') }));
    assert.equal(fs.existsSync(path.join(directory, 'legacy.json')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function cancelWorkflowFixture(interrupt = false) {
  const path = require('node:path');
  const os = require('node:os');
  const { spawn } = require('node:child_process');
  const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
  const { RelationalSessionEventStore } = require('../packages/agent-session-store');
  const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
  const { inspectEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
  const input = definition();
  input.tasks[0].responses[0].input.content = 'module.exports=(a,b)=>a+b;setTimeout(()=>{},20000);';
  const prepared = await runEngineeringWorkflow({ definition: input, createOnly: true });
  const handle = openExecutionLedgerFileFixture(prepared.state);
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, '../tools/cli/hseos-cli.js'),
      'workflow',
      'resume',
      '--state',
      prepared.state,
      '--expected-sequence',
      String(prepared.current_sequence),
      '--json',
    ],
    {
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  try {
    const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
    const deadline = Date.now() + 8000;
    const started = () =>
      store
        .readSession(prepared.tasks[0].session_id)
        .some((event) => event.event_type === 'tool.execution.started' && event.payload.name === 'engineering.command');
    while (!started() && child.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(started(), output);
    if (interrupt) {
      child.kill('SIGKILL');
      await closed;
      const before = store.readSession(prepared.tasks[0].session_id);
      const blocked = await inspectEngineeringWorkflow({
        state: prepared.state,
        action: 'resume',
        expectedSequence: store.replay(prepared.session_id).current_sequence,
      });
      assert.equal(blocked.reason, 'workflow-effect-reconciliation-required');
      assert.deepEqual(store.readSession(prepared.tasks[0].session_id), before);
    }
    const cancelled = await inspectEngineeringWorkflow({ state: prepared.state, action: 'cancel' });
    assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled));
    assert.equal(cancelled.tasks[0].reason, 'cancelled');
    assert.ok(cancelled.tasks.slice(1).every((task) => task.result === 'not_executed'));
    await closed;
    assert.equal((await inspectEngineeringWorkflow({ state: prepared.state })).status, 'cancelled');
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await closed;
    handle.close();
    fs.rmSync(prepared.state, { recursive: true, force: true });
  }
}

test('live workflow cancellation settles the active executor and preserves unstarted tasks', () => cancelWorkflowFixture());
test('interrupted workflow blocks uncertain effects and cancellation drains the abandoned executor', () => cancelWorkflowFixture(true));

test('interrupted workflow reclaims only a dead owner and resumes verification without repeated effects', async () => {
  const path = require('node:path');
  const os = require('node:os');
  const { spawn } = require('node:child_process');
  const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
  const { RelationalSessionEventStore } = require('../packages/agent-session-store');
  const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
  const { inspectEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
  const input = definition();
  input.tasks[0].responses[0].input.content = 'module.exports=(a,b)=>{const end=Date.now()+350;while(Date.now()<end){}return a+b;};';
  const prepared = await runEngineeringWorkflow({ definition: input, createOnly: true });
  const handle = openExecutionLedgerFileFixture(prepared.state);
  const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
  const deadlines = prepared.tasks.map((task) => new EngineeringTaskState(handle.db, task.task_run_id).read().created.deadline);
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, '../tools/cli/hseos-cli.js'),
      'workflow',
      'resume',
      '--state',
      prepared.state,
      '--expected-sequence',
      String(prepared.current_sequence),
      '--json',
    ],
    {
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir() },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  const closed = new Promise((resolve) => child.once('close', resolve));
  try {
    const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
    const deadline = Date.now() + 10_000;
    while (store.replay(prepared.tasks[0].session_id).status !== 'completed' && child.exitCode === null && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(store.replay(prepared.tasks[0].session_id).status, 'completed');
    const parent = store.replay(prepared.session_id);
    const leaseWait = Date.parse(parent.workflow_reservations[input.workflow_id].claim_expires_at) - Date.now() + 5;
    if (leaseWait > 0) await new Promise((resolve) => setTimeout(resolve, leaseWait));
    const blocked = await inspectEngineeringWorkflow({
      state: prepared.state,
      action: 'resume',
      expectedSequence: parent.current_sequence,
    });
    assert.equal(blocked.reason, 'workflow-owner-active');
    child.kill('SIGKILL');
    await closed;
    const before = store.readSession(prepared.tasks[0].session_id);
    const expectedSequence = store.replay(prepared.session_id).current_sequence;
    const competing = await Promise.allSettled(
      [0, 1].map(() =>
        inspectEngineeringWorkflow({
          state: prepared.state,
          action: 'resume',
          expectedSequence,
        }),
      ),
    );
    const completed = competing.filter((entry) => entry.status === 'fulfilled' && entry.value.status === 'completed');
    assert.equal(completed.length, 1, JSON.stringify(competing));
    assert.ok(competing.some((entry) => entry.status === 'rejected' || entry.value.status === 'blocked'));
    const recovered = completed[0].value;
    assert.ok(recovered.tasks.every((task) => task.result === 'approved'));
    assert.deepEqual(
      prepared.tasks.map((task) => new EngineeringTaskState(handle.db, task.task_run_id).read().created.deadline),
      deadlines,
    );
    assert.deepEqual(store.readSession(prepared.tasks[0].session_id), before);
    assert.equal(store.readSession(prepared.session_id).filter((event) => event.event_type === 'workflow.reclaimed').length, 1);
    assert.ok(Object.values(recovered.budget).every((budget) => budget.spent <= budget.ceiling));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    handle.close();
    fs.rmSync(prepared.state, { recursive: true, force: true });
  }
});
