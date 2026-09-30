'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { runEngineeringTask, inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
const { engineeringVerifier } = require('../tools/cli/lib/engineering-verifier');
const base = require('./fixtures/engineering-task/addition.json');
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function fixture(
  { code, initial, reference = base.verifier.reference, file = 'add.js', runtime = 'node', responses, createOnly = false },
  check,
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-engineering-run-test-'));
  let result;
  try {
    const task = structuredClone(base);
    task.verifier.reference = reference;
    const verifier = engineeringVerifier(reference);
    task.verifier.sha256 = verifier.sha256;
    task.sources = [{ id: 'spec', kind: 'specification', content: verifier.definition.source, sha256: sha(verifier.definition.source) }];
    task.requirements = [{ id: 'r1', description: verifier.definition.requirement, source_ids: ['spec'] }];
    task.acceptance = [{ id: 'a1', description: verifier.definition.acceptance, requirement_ids: ['r1'] }];
    task.initial_files = initial === undefined ? [] : [{ path: file, content: initial, sha256: sha(initial) }];
    task.scope = { read: [file], write: [file] };
    task.commands = [{ id: 'check', runtime, entrypoint: file, args: [] }];
    task.limits.max_duration_ms = 30_000;
    fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(task));
    fs.writeFileSync(
      path.join(directory, 'responses.json'),
      JSON.stringify(
        responses ||
          (code === undefined
            ? []
            : [
                {
                  name: 'engineering.write',
                  input: { path: file, expected_sha256: initial === undefined ? null : sha(initial), content: code },
                },
                { name: 'engineering.command', input: { id: 'check' } },
              ]),
      ),
    );
    result = await runEngineeringTask({
      taskContract: path.join(directory, 'task.json'),
      scriptedResponses: path.join(directory, 'responses.json'),
      createOnly,
    });
    await check(result);
  } finally {
    if (result?.state) fs.rmSync(result.state, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('Node implementation is independently approved and survives status reopen', () =>
  fixture({ code: 'module.exports=(a,b)=>a+b;\n' }, async (result) => {
    assert.equal(result.task_result, 'approved', JSON.stringify(result));
    assert.equal(result.status, 'completed');
    assert.deepEqual(await inspectEngineeringTask({ state: result.state }), result);
    const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
    assert.equal(evidence.artifacts.files[0].content, 'module.exports=(a,b)=>a+b;\n');
    assert.equal(evidence.verification.evidence.schema_version, 1);
    assert.equal(evidence.verification.evidence.contract_sha256, result.contract_sha256);
  }));

test('Python bug correction is independently approved', () =>
  fixture(
    {
      reference: 'verifier://fixtures/python-clamp-v1',
      file: 'clamp.py',
      runtime: 'python',
      initial: 'def clamp(x, low, high): return x\n',
      code: 'def clamp(x, low, high): return min(high, max(low, x))\n',
    },
    (result) => {
      assert.equal(result.task_result, 'approved', JSON.stringify(result));
    },
  ));

test('Node regression correction preserves zero values', () =>
  fixture(
    {
      reference: 'verifier://fixtures/node-unique-v1',
      file: 'unique.js',
      initial: 'module.exports=xs=>[...new Set(xs.filter(Boolean))];\n',
      code: 'module.exports=xs=>[...new Set(xs)];\n',
    },
    (result) => {
      assert.equal(result.task_result, 'approved', JSON.stringify(result));
    },
  ));

test('a completed model response without implementation fails independent verification', () =>
  fixture({}, (result) => {
    assert.equal(result.status, 'completed');
    assert.equal(result.task_result, 'failed');
  }));

test('incorrect code cannot pass using a successful process exit', () =>
  fixture({ code: 'process.exit(0);\n' }, (result) => {
    assert.equal(result.status, 'completed');
    assert.equal(result.task_result, 'failed');
  }));

test('unknown tools never execute', () =>
  fixture({ responses: [{ name: 'unknown.run', input: {} }] }, (result) => {
    assert.notEqual(result.task_result, 'approved');
    assert.ok(!fs.existsSync(path.join(result.state, 'workspace', 'add.js')));
  }));

test('a create-only task resumes with its original budget and sequence', () =>
  fixture({ code: 'module.exports=(a,b)=>a+b;\n', createOnly: true }, async (result) => {
    assert.equal(result.task_result, 'not_executed');
    await assert.rejects(inspectEngineeringTask({ state: result.state, action: 'resume', expectedSequence: 999 }));
    const resumed = await inspectEngineeringTask({ state: result.state, action: 'resume', expectedSequence: result.current_sequence });
    assert.equal(resumed.task_result, 'approved', JSON.stringify(resumed));
    assert.deepEqual(
      await inspectEngineeringTask({ state: result.state, action: 'resume', expectedSequence: resumed.current_sequence }),
      resumed,
    );
  }));

test('cancel persists a separate task outcome and prevents later execution', () =>
  fixture({ code: 'module.exports=(a,b)=>a+b;\n', createOnly: true }, async (result) => {
    const cancelled = await inspectEngineeringTask({ state: result.state, action: 'cancel' });
    assert.equal(cancelled.task_result, 'not_executed');
    assert.equal(cancelled.reason, 'cancelled');
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(
      await inspectEngineeringTask({ state: result.state, action: 'resume', expectedSequence: cancelled.current_sequence }),
      cancelled,
    );
  }));

function crossProcessCancellation(interrupt = false) {
  return fixture(
    {
      code: 'module.exports=(a,b)=>a+b; if(require.main===module) setTimeout(()=>{},60000);\n',
      createOnly: true,
    },
    async (result) => {
      const { spawn } = require('node:child_process');
      const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
      const { RelationalSessionEventStore } = require('../packages/agent-session-store');
      const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
      const child = spawn(
        process.execPath,
        [
          path.join(__dirname, '../tools/cli/hseos-cli.js'),
          'agent',
          'resume',
          '--profile',
          'disposable-engineering-candidate',
          '--state',
          result.state,
          '--expected-sequence',
          String(result.current_sequence),
          '--json',
        ],
        {
          env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), HSEOS_DISABLE_UPDATE_CHECK: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      let errors = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        errors += data;
      });
      const closed = new Promise((resolve) => child.once('close', resolve));
      const handle = openExecutionLedgerFileFixture(result.state);
      try {
        const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
        const deadline = Date.now() + 8000;
        let started = false;
        while (Date.now() < deadline) {
          started = store
            .readSession(result.session_id)
            .some((event) => event.event_type === 'tool.execution.started' && event.payload.name === 'engineering.command');
          if (started) break;
          if (child.exitCode !== null) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(started, true, errors + output);
        if (interrupt) {
          child.kill('SIGKILL');
          await closed;
        }
        const cancelled = await inspectEngineeringTask({ state: result.state, action: 'cancel' });
        assert.equal(cancelled.reason, 'cancelled', JSON.stringify(cancelled));
        assert.equal(cancelled.status, interrupt ? 'failed' : 'cancelled');
        if (interrupt) {
          assert.ok(
            Object.values(store.replay(result.session_id).tool_invocations).some(
              (invocation) => invocation.outcome?.status === 'uncertain',
            ),
          );
        }
        await closed;
        if (!interrupt) assert.equal(JSON.parse(output).task_result, 'not_executed', output + errors);
      } finally {
        if (child.exitCode === null) child.kill('SIGTERM');
        await closed;
        handle.close();
      }
    },
  );
}

test('cross-process cancellation waits for the running worker to drain its executor', () => crossProcessCancellation());
test('cancellation after worker interruption reaps its executor before confirming', () => crossProcessCancellation(true));

test('tampered verifier hash or acceptance is blocked before the first model turn', async () => {
  const { createEngineeringExample } = require('../tools/examples/engineering-task');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-verifier-test-'));
  try {
    for (const mutation of [
      (task) => {
        task.verifier.sha256 = '0'.repeat(64);
      },
      (task) => {
        task.acceptance[0].description = 'Approve any output';
      },
    ]) {
      const example = createEngineeringExample('addition');
      const task = structuredClone(example.contract);
      mutation(task);
      fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(task));
      fs.writeFileSync(path.join(directory, 'responses.json'), JSON.stringify(example.responses));
      const result = await runEngineeringTask({
        taskContract: path.join(directory, 'task.json'),
        scriptedResponses: path.join(directory, 'responses.json'),
      });
      try {
        assert.equal(result.task_result, 'blocked');
        assert.equal(result.status, 'not_executed');
        assert.ok(!fs.existsSync(path.join(result.state, 'workspace', 'add.js')));
      } finally {
        fs.rmSync(result.state, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('gateway denies verifier, credential, and workspace escape paths', async () => {
  for (const target of ['../engineering-task.json', '/home/user/.credentials', '../../tools/cli/lib/engineering-verifier.js']) {
    await fixture(
      { responses: [{ name: 'engineering.write', input: { path: target, expected_sha256: null, content: 'overwrite' } }] },
      (result) => {
        assert.notEqual(result.task_result, 'approved');
        assert.ok(!fs.existsSync(path.join(result.state, 'workspace', 'add.js')));
        assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(result.state, 'engineering-task.json'), 'utf8')));
      },
    );
  }
});

test('interruption after model completion resumes verification without replaying effects', () =>
  fixture(
    { code: 'module.exports=(a,b)=>{ const end=Date.now()+350; while(Date.now()<end) {} return a+b; };\n', createOnly: true },
    async (result) => {
      const { spawn } = require('node:child_process');
      const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
      const { RelationalSessionEventStore } = require('../packages/agent-session-store');
      const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
      const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
      const child = spawn(
        process.execPath,
        [
          path.join(__dirname, '../tools/cli/hseos-cli.js'),
          'agent',
          'resume',
          '--profile',
          'disposable-engineering-candidate',
          '--state',
          result.state,
          '--expected-sequence',
          String(result.current_sequence),
          '--json',
        ],
        {
          env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), HSEOS_DISABLE_UPDATE_CHECK: '1' },
          stdio: ['ignore', 'ignore', 'ignore'],
        },
      );
      const closed = new Promise((resolve) => child.once('close', resolve));
      const handle = openExecutionLedgerFileFixture(result.state);
      try {
        const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
        const task = new EngineeringTaskState(handle.db, result.task_run_id);
        const deadline = Date.now() + 10_000;
        while (store.replay(result.session_id).status !== 'completed' && Date.now() < deadline) {
          if (child.exitCode !== null) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(store.replay(result.session_id).status, 'completed');
        child.kill('SIGKILL');
        await closed;
        assert.equal(task.read().result, null, 'worker must be interrupted before committing verifier outcome');
        const before = store.readSession(result.session_id);
        const owner = task.read().owner;
        const resumed = await inspectEngineeringTask({ state: result.state, action: 'resume', expectedSequence: task.read().version });
        assert.equal(resumed.task_result, 'approved', JSON.stringify(resumed));
        assert.deepEqual(store.readSession(result.session_id), before, 'recovery must not invoke the model or tools again');
        assert.ok(
          !fs.readdirSync(owner.resource_parent).some((name) => name.startsWith(`hseos-executor-${owner.pid}-${owner.start_ticks}-`)),
        );
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        await closed;
        handle.close();
      }
    },
  ));

for (const boundary of ['tool-intent', 'model-stop'])
  test(`durable cancellation at ${boundary} cannot complete the session`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
    const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
    const taskAppend = EngineeringTaskState.prototype.append;
    const sessionAppend = ExecutionEventLedger.prototype.append;
    let requestCancellation;
    let injected = false;
    t.mock.method(EngineeringTaskState.prototype, 'append', function (event, version) {
      const result = taskAppend.call(this, event, version);
      if (event.kind === 'execution_started')
        requestCancellation = () => this.append({ kind: 'cancellation_requested' }, this.read().version);
      return result;
    });
    t.mock.method(ExecutionEventLedger.prototype, 'append', function (request) {
      const result = sessionAppend.call(this, request);
      if (
        !injected &&
        request.events.some((row) => {
          if (row.event_type !== 'AgentSessionEventRecorded') return false;
          const e = JSON.parse(row.payload.session_event_json);
          return boundary === 'tool-intent'
            ? e.event_type === 'tool.execution.started' && e.payload.name === 'engineering.command'
            : e.event_type === 'model.streamed' &&
                e.payload.event.event_type === 'completed' &&
                e.payload.event.payload.finish_reason === 'stop';
        })
      ) {
        injected = true;
        requestCancellation();
      }
      return result;
    });
    await fixture({ code: 'module.exports=(a,b)=>a+b;\n' }, async (result) => {
      assert.equal(injected, true);
      assert.equal(result.reason, 'cancelled');
      assert.equal(result.task_result, 'not_executed');
      assert.equal(result.status, 'cancelled');
    });
  });
