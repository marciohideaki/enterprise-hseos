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

const { createEngineeringExample } = require('../tools/examples/engineering-task');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');

const BAD_ADDITION = 'module.exports = () => 0;\n';

async function correctionRun(t, { corrections = 1, steps }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-runtime-corrections-'));
  const { contract, responses } = structuredClone(createEngineeringExample('addition'));
  contract.max_failed_corrections = corrections;
  contract.limits.max_tokens = 500_000;
  const good = responses[0].input;
  const badFiles = [{ path: 'add.js', content: BAD_ADDITION, sha256: sha(BAD_ADDITION) }];
  const write = (content, expected = sha(BAD_ADDITION)) => ({
    name: 'engineering.write',
    input: { ...good, expected_sha256: expected, content },
  });
  const diagnose = (overrides = {}) => ({
    name: 'engineering.diagnose',
    input: {
      cause: 'The implementation returns a constant instead of adding the inputs.',
      correction: 'Implement addition using both arguments and rerun protected acceptance.',
      requirement_ids: ['r1'],
      files_sha256: engineeringDigest(badFiles),
      ...overrides,
    },
  });
  fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(contract));
  fs.writeFileSync(
    path.join(directory, 'responses.json'),
    JSON.stringify([
      { name: 'engineering.write', input: { ...good, content: BAD_ADDITION } },
      { name: 'fixture.submit', input: {} },
      ...steps({ write, diagnose, good }),
    ]),
  );
  const result = await runEngineeringTask({
    taskContract: path.join(directory, 'task.json'),
    scriptedResponses: path.join(directory, 'responses.json'),
  });
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(result.state, { recursive: true, force: true });
  });
  return result;
}

test('a rejected delivery is diagnosed against its files and corrected within the same budget', async (t) => {
  const result = await correctionRun(t, { steps: ({ write, diagnose, good }) => [diagnose(), write(good.content)] });
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  assert.equal(result.correction_diagnoses.length, 1);
  assert.equal(result.correction_reviews.filter((review) => review.correction_requested).length, 1);
});

test('writing before diagnosing, a diagnosis of other files, or a spent correction budget never approves', async (t) => {
  const undiagnosed = await correctionRun(t, { steps: ({ write, good }) => [write(good.content)] });
  assert.equal(undiagnosed.task_result, 'failed', 'the gateway refuses the write that skips the diagnosis');
  assert.equal(undiagnosed.correction_diagnoses.length, 0);
  const mismatched = await correctionRun(t, {
    steps: ({ write, diagnose, good }) => [diagnose({ files_sha256: sha('some other files') }), write(good.content)],
  });
  assert.notEqual(mismatched.task_result, 'approved');
  assert.equal(mismatched.correction_diagnoses.length, 0);
  const exhausted = await correctionRun(t, { corrections: 0, steps: ({ write, diagnose }) => [diagnose(), write(BAD_ADDITION)] });
  assert.equal(exhausted.task_result, 'failed');
  assert.equal(exhausted.correction_reviews.filter((review) => review.correction_requested).length, 0);
});

test('model source, plugin model and unsupported action preconditions are refused before any effect', async () => {
  const taskContract = path.join(__dirname, 'fixtures/engineering-task/addition.json');
  await assert.rejects(runEngineeringTask({ taskContract, scriptedResponses: 'a', binding: 'b' }), /exactly one engineering model source/);
  await assert.rejects(runEngineeringTask({ taskContract, pluginModel: { selection_id: 'x' } }), {
    code: 'PLUGIN_TASK_REGISTRATION_REQUIRED',
  });
  const result = await runEngineeringTask({ taskContract });
  try {
    assert.equal(result.task_result, 'not_executed');
    assert.equal(result.reason, 'no-model-provider-selected');
    assert.equal(
      (await inspectEngineeringTask({ state: result.state, action: 'unsupported' })).task_result,
      'not_executed',
      'a settled task only reports',
    );
    const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
    assert.equal(evidence.contract.task_id, result.task_id);
    assert.equal(evidence.artifacts, null);
  } finally {
    fs.rmSync(result.state, { recursive: true, force: true });
  }
});

test('a task that never started reconciles to a report and a started one rejects an unexpected sequence', () =>
  fixture({ code: 'module.exports=(a,b)=>a+b;\n', createOnly: true }, async (result) => {
    const report = await inspectEngineeringTask({ state: result.state, action: 'reconcile' });
    assert.ok(report.reconciliation, 'reconcile exposes the report');
    assert.ok(Array.isArray(report.questions));
    await assert.rejects(
      inspectEngineeringTask({ state: result.state, action: 'unsupported', expectedSequence: result.current_sequence }),
      /Unsupported engineering task action/,
    );
    await assert.rejects(
      inspectEngineeringTask({ state: result.state, action: 'resume', expectedSequence: 0 }),
      /Expected task sequence is required/,
    );
  }));

const { fixture: projectFixture } = require('./helpers/engineering-project');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');

function extensionSetup(t, { kind = 'context-source', budget = 4, responses = [] } = {}) {
  const f = projectFixture(t);
  f.contract.limits.max_tool_calls = budget;
  f.save();
  const directory = path.join(f.directory, 'plugin');
  fs.mkdirSync(directory);
  const source =
    kind === 'context-source'
      ? 'module.exports=()=>({items:[{id:"note",content:"Context from the extension"}]});'
      : 'module.exports=({input})=>({echo:input.text});';
  const manifest = {
    schema_version: 1,
    id: 'task-extension',
    version: '1.0.0',
    kind,
    compatibility: { contract_version: 1, node_majors: [22, 24] },
    entrypoint: 'entry.cjs',
    files: { 'entry.cjs': sha(source) },
    capabilities: ['external.read'],
    limits: { timeout_ms: 3000, max_output_bytes: 8192, memory_max_bytes: 268_435_456, pids_max: 32 },
    dependencies: [],
    conformance: ['entry.cjs'],
  };
  fs.writeFileSync(path.join(directory, 'entry.cjs'), source);
  fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(manifest));
  const configuration = {
    schema_version: 1,
    name: 'external.read',
    description: 'Read external data',
    capability: 'external.read',
    authority: 'external.read',
    policy_version: 'v1',
    timeout_ms: 3000,
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    ...(kind === 'context-source'
      ? { initial_input: { text: 'task input' } }
      : { output_schema: { type: 'object', properties: { echo: { type: 'string' } }, required: ['echo'], additionalProperties: false } }),
  };
  const catalog = {
    selected: {
      directory,
      policy: {
        id: manifest.id,
        version: manifest.version,
        kind,
        manifest_sha256: sha(canonicalize(manifest)),
        allowed_capabilities: manifest.capabilities,
        limits: manifest.limits,
        contract_version: 1,
      },
      configuration,
      dependencies: [],
    },
  };
  const responseFile = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responseFile, JSON.stringify(responses));
  return {
    ...f,
    catalog,
    configuration,
    run: async (extra = {}) => {
      const result = await runEngineeringTask({
        taskContract: f.filename,
        scriptedResponses: responseFile,
        extensionCatalog: catalog,
        extensionIds: ['selected'],
        ...extra,
      });
      t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
      return result;
    },
  };
}

test('a pinned context extension is collected on resume and a selected tool runs through the task gateway', async (t) => {
  const context = extensionSetup(t, { budget: 1 });
  const created = await context.run({ createOnly: true });
  const resumed = await inspectEngineeringTask({
    state: created.state,
    action: 'resume',
    expectedSequence: created.current_sequence,
    extensionCatalog: context.catalog,
  });
  assert.equal(resumed.task_result, 'approved', JSON.stringify(resumed));
  const tool = extensionSetup(t, { kind: 'tool', budget: 1, responses: [{ name: 'external.read', input: { text: 'hello' } }] });
  const result = await tool.run();
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
});

test('catalog drift on resume is rejected before effects, and a selection above the tool budget is refused at creation', async (t) => {
  const f = extensionSetup(t);
  const created = await f.run({ createOnly: true });
  f.configuration.description = 'changed';
  await assert.rejects(
    inspectEngineeringTask({
      state: created.state,
      action: 'resume',
      expectedSequence: created.current_sequence,
      extensionCatalog: f.catalog,
    }),
    { code: 'PLUGIN_SELECTION_DRIFT' },
  );
  const tight = extensionSetup(t, { budget: 0 });
  await assert.rejects(tight.run(), /Context selection exceeds task budget|budget/);
});

const { randomUUID } = require('node:crypto');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');

async function claimedJob(t, { expected = 4 } = {}) {
  const project = projectFixture(t, { expected });
  const control = new EngineeringControl({ workspaces: [project.root] });
  t.after(async () => {
    await control.jobs.dispatcher.shutdown();
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const jobs = control.jobs;
  const id = randomUUID();
  await jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 0,
    action: 'create',
    input: {
      kind: 'task',
      definition: { contract: project.contract, responses: [] },
      not_before: new Date(Date.now() - 1000).toISOString(),
      deadline_at: new Date(Date.now() + 180_000).toISOString(),
      depends_on: [],
    },
  });
  await jobs.worker.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 1,
    action: 'claim',
    fence: 0,
    lease_ms: 1000,
  });
  return { project, control, jobs, id };
}

test('a claimed job is prepared and dispatched once through the durable task runtime', async (t) => {
  const f = await claimedJob(t);
  const resume = { schema_version: 1, command_id: randomUUID(), resource_id: f.id, expected_sequence: 2, action: 'resume', input: {} };
  const result = await f.jobs.execute(resume);
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.deepEqual(await f.jobs.execute(resume), result);
});

test('a job whose delivery fails acceptance settles as a verified failure, not as success', async (t) => {
  const f = await claimedJob(t, { expected: 99 });
  const resume = { schema_version: 1, command_id: randomUUID(), resource_id: f.id, expected_sequence: 2, action: 'resume', input: {} };
  const result = await f.jobs.execute(resume);
  assert.notEqual(result.status, 'succeeded', JSON.stringify(result));
});

function sseResponse(frames) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name === 'content-type' ? 'text/event-stream' : null) },
    body: (async function* () {
      yield Buffer.from(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n');
    })(),
  };
}

test('a bound provider worker is created without contacting the provider and resumes through the broker without persisting its credential', async (t) => {
  const YAML = require('yaml');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-runtime-binding-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secret = require('node:crypto').randomUUID();
  const example = structuredClone(createEngineeringExample('addition'));
  fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(example.contract));
  const binding = YAML.parse(
    fs.readFileSync(path.join(__dirname, '../.agents/activation/provider-bindings/openai-compatible.example.yaml'), 'utf8'),
  );
  binding.provider.base_url = 'https://engineering.fixture.invalid/v1';
  binding.provider.limits = { context_tokens: 1_000_000, max_output_tokens: 65_536, max_parallel_requests: 1 };
  binding.provider.secret_refs[0].source_ref = 'env://ENGINEERING_FIXTURE_CREDENTIAL';
  binding.transport.max_attempts = 1;
  fs.writeFileSync(path.join(directory, 'binding.yaml'), YAML.stringify(binding));
  let calls = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.authorization, `Bearer ${secret}`);
    const next = example.responses[calls++];
    return next && next.name !== 'fixture.submit'
      ? sseResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: `call:engineering:${calls}`, function: { name: next.name, arguments: JSON.stringify(next.input) } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          },
        ])
      : sseResponse([
          { choices: [{ delta: { content: 'implemented' }, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } },
        ]);
  };
  const created = await runEngineeringTask({
    taskContract: path.join(directory, 'task.json'),
    binding: path.join(directory, 'binding.yaml'),
    createOnly: true,
    environment: {},
    fetchImpl: () => {
      throw new Error('create-only cannot invoke a provider');
    },
  });
  t.after(() => fs.rmSync(created.state, { recursive: true, force: true }));
  assert.equal(created.task_result, 'not_executed');
  assert.equal(calls, 0);
  const result = await inspectEngineeringTask({
    state: created.state,
    action: 'resume',
    expectedSequence: created.current_sequence,
    environment: { ENGINEERING_FIXTURE_CREDENTIAL: secret },
    fetchImpl,
  });
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  assert.equal(JSON.stringify(await inspectEngineeringTask({ state: result.state, action: 'evidence' })).includes(secret), false);
});

function newestStateDirectory(startedAt) {
  return fs
    .readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('hseos-ledger-fixture-'))
    .map((name) => path.join(os.tmpdir(), name))
    .filter((directory) => fs.statSync(directory).mtimeMs >= startedAt)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

for (const [occurrence, moment] of [
  [1, 'the protected review'],
  [2, 'the final verification'],
])
  test(`files that change during ${moment} block the task for reconciliation instead of approving`, async (t) => {
    const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
    const startedAt = Date.now() - 1000;
    const original = EngineeringTaskState.prototype.append;
    let snapshots = 0;
    t.mock.method(EngineeringTaskState.prototype, 'append', function (event, version) {
      const receipt = original.call(this, event, version);
      if (event.kind === 'snapshot' && ++snapshots === occurrence) {
        fs.appendFileSync(path.join(newestStateDirectory(startedAt), 'workspace', 'add.js'), '// edited while verifying\n');
      }
      return receipt;
    });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-runtime-race-'));
    const { contract, responses } = structuredClone(createEngineeringExample('addition'));
    contract.max_failed_corrections = 1;
    fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(contract));
    fs.writeFileSync(path.join(directory, 'responses.json'), JSON.stringify(responses));
    const result = await runEngineeringTask({
      taskContract: path.join(directory, 'task.json'),
      scriptedResponses: path.join(directory, 'responses.json'),
    });
    t.after(() => {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(result.state, { recursive: true, force: true });
    });
    assert.equal(snapshots >= occurrence, true);
    assert.notEqual(result.task_result, 'approved', JSON.stringify(result));
    assert.equal(result.task_result, 'blocked');
    assert.equal(result.reason, 'reconciliation-required');
  });

test('the task tool budget is enforced by the gateway before a call is dispatched', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-runtime-budget-'));
  const { contract, responses } = structuredClone(createEngineeringExample('addition'));
  contract.limits.max_tool_calls = 1;
  const write = responses[0];
  fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(contract));
  fs.writeFileSync(
    path.join(directory, 'responses.json'),
    JSON.stringify([write, { name: 'engineering.command', input: { id: 'check' } }, write]),
  );
  const result = await runEngineeringTask({
    taskContract: path.join(directory, 'task.json'),
    scriptedResponses: path.join(directory, 'responses.json'),
  });
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(result.state, { recursive: true, force: true });
  });
  const handle = require('../tools/mcp-project-state/lib/execution-ledger-schema').openExecutionLedgerFileFixture(result.state);
  try {
    const { RelationalSessionEventStore } = require('../packages/agent-session-store');
    const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
    const session = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }).replay(result.session_id);
    const dispatched = Object.values(session.tool_invocations).filter((invocation) => invocation.outcome?.status === 'succeeded');
    assert.ok(dispatched.length <= 1, `at most one call within the budget, saw ${dispatched.length}`);
  } finally {
    handle.close();
  }
});

test('a claimed workflow job prepares its parent session and dispatches every task', async (t) => {
  const project = projectFixture(t);
  const control = new EngineeringControl({ workspaces: [project.root] });
  t.after(async () => {
    await control.jobs.dispatcher.shutdown();
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const jobs = control.jobs;
  const id = randomUUID();
  const limits = project.contract.limits;
  await jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 0,
    action: 'create',
    input: {
      kind: 'workflow',
      definition: {
        definition: {
          schema_version: 1,
          workflow_id: 'workflow:runtime-coverage',
          max_parallelism: 1,
          limits: {
            ...limits,
            max_duration_ms: 120_000,
            max_children: 2,
            max_workflow_steps: 2,
            max_tokens: limits.max_tokens * 2,
            max_tool_calls: limits.max_tool_calls * 2,
            max_turns: limits.max_turns * 2,
          },
          tasks: [
            { id: 'first', contract: project.contract, responses: [], depends_on: [] },
            { id: 'second', contract: project.contract, responses: [], depends_on: ['first'] },
          ],
        },
      },
      not_before: new Date(Date.now() - 1000).toISOString(),
      deadline_at: new Date(Date.now() + 180_000).toISOString(),
      depends_on: [],
    },
  });
  await jobs.worker.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 1,
    action: 'claim',
    fence: 0,
    lease_ms: 1000,
  });
  const result = await jobs.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 2,
    action: 'resume',
    input: {},
  });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.materialization.plan.tasks.length, 2);
});

test('a diagnosis without a rejected review is refused and does not change the outcome', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-runtime-diagnose-'));
  const { contract, responses } = structuredClone(createEngineeringExample('addition'));
  contract.max_failed_corrections = 1;
  const good = responses[0].input.content;
  fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(contract));
  fs.writeFileSync(
    path.join(directory, 'responses.json'),
    JSON.stringify([
      responses[0],
      {
        name: 'engineering.diagnose',
        input: {
          cause: 'Nothing was rejected, so there is nothing to diagnose.',
          correction: 'No correction is needed for an unreviewed delivery.',
          requirement_ids: ['r1'],
          files_sha256: engineeringDigest([{ path: 'add.js', content: good, sha256: sha(good) }]),
        },
      },
      responses[1],
    ]),
  );
  const result = await runEngineeringTask({
    taskContract: path.join(directory, 'task.json'),
    scriptedResponses: path.join(directory, 'responses.json'),
  });
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(result.state, { recursive: true, force: true });
  });
  assert.equal(result.correction_diagnoses.length, 0);
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
});

test('a context extension that fails blocks the task before any model turn', async (t) => {
  const f = extensionSetup(t);
  fs.writeFileSync(path.join(f.directory, 'plugin', 'entry.cjs'), 'module.exports=()=>{ throw new Error("extension failed"); };');
  const created = await f.run({ createOnly: true }).catch((error) => error);
  // The edited entrypoint no longer matches the pinned digest, so the failure is reported before execution.
  assert.ok(created instanceof Error || created.task_result !== 'approved');
});

test('reconciliation of an already settled task reports its state without replaying effects', () =>
  fixture({ code: 'module.exports=(a,b)=>a+b;\n' }, async (result) => {
    assert.equal(result.task_result, 'approved');
    const report = await inspectEngineeringTask({ state: result.state, action: 'reconcile' });
    assert.ok(report.reconciliation);
    assert.equal(report.task_result, 'approved');
    assert.deepEqual(await inspectEngineeringTask({ state: result.state }), result, 'the settled outcome is unchanged');
  }));

test('cancelling a task that already finished reports the settled outcome instead of cancelling it', () =>
  fixture({ code: 'module.exports=(a,b)=>a+b;\n' }, async (result) => {
    const after = await inspectEngineeringTask({ state: result.state, action: 'cancel' });
    assert.equal(after.task_result, 'approved');
    assert.equal(after.status, 'completed');
  }));

test('a scripted response fixture must be one regular, unchanged, bounded and well-formed file', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-runtime-fixture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const taskContract = path.join(__dirname, 'fixtures/engineering-task/addition.json');
  const file = (name, content) => {
    const filename = path.join(directory, name);
    fs.writeFileSync(filename, content);
    return filename;
  };
  const responses = file('responses.json', '[]');
  const link = path.join(directory, 'link.json');
  fs.symlinkSync(responses, link);
  const hard = path.join(directory, 'hard.json');
  fs.linkSync(responses, hard);
  for (const scriptedResponses of [
    link,
    hard,
    directory,
    file('big.json', ' '.repeat(1_048_577)),
    file('malformed.json', '{not json'),
    file('shape.json', '{"unexpected":true}'),
    path.join(directory, 'missing.json'),
  ])
    await assert.rejects(runEngineeringTask({ taskContract, scriptedResponses }), undefined, scriptedResponses);
  const valid = file('valid-task.json', JSON.stringify(createEngineeringExample('addition').contract));
  const result = await runEngineeringTask({ taskContract: valid, scriptedResponses: file('valid.json', '[]'), createOnly: true });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'not_executed');
});

test('a task state directory without a valid identity is refused', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-runtime-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(inspectEngineeringTask({ state: directory }));
});
