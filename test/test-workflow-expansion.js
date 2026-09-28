'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { parseEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
const { jobDigest } = require('../tools/lib/job-contract');

async function setup(t, { version = 2, limits = {}, scheduled = false } = {}) {
  const project = fixture(t);
  const control = new EngineeringControl({ workspaces: [project.root] });
  t.after(async () => {
    await control.jobs.dispatcher.shutdown();
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const node = (id, depends_on = []) => ({ id, contract: project.contract, responses: [], depends_on });
  const definition = {
    schema_version: version,
    ...(version === 2 ? { revision: 1, previous_definition_sha256: null } : {}),
    workflow_id: 'workflow:expansion',
    max_parallelism: 1,
    limits: {
      ...project.contract.limits,
      max_duration_ms: 240_000,
      max_children: 4,
      max_workflow_steps: 4,
      max_tokens: project.contract.limits.max_tokens * 4,
      max_tool_calls: project.contract.limits.max_tool_calls * 4,
      max_turns: project.contract.limits.max_turns * 4,
      ...limits,
    },
    tasks: [node('first')],
  };
  const id = randomUUID();
  const envelope = (action, expected_sequence, input = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence,
    action,
    input,
  });
  const create = envelope('create', 0, {
    kind: 'workflow',
    definition: { definition },
    not_before: new Date(Date.now() + (scheduled ? 60_000 : -1000)).toISOString(),
    deadline_at: new Date(Date.now() + 300_000).toISOString(),
    depends_on: [],
  });
  const initial = await control.jobs.execute(create);
  const expand = (nodes = [node('second', ['first'])]) =>
    envelope('expand', control.jobs.query(id).current_sequence, {
      definition_sha256: jobDigest(control.jobs.query(id).admission.input.definition),
      nodes,
    });
  return { ...project, control, jobs: control.jobs, id, node, definition, envelope, create, initial, expand };
}

test('v1 normalized shape and historical receipt remain unchanged', async (t) => {
  const f = await setup(t, { version: 1 });
  assert.deepEqual(parseEngineeringWorkflow(f.definition).definition, f.definition);
  assert.deepEqual(await f.jobs.execute(f.create), f.initial);
  await assert.rejects(f.jobs.expand(f.expand()), { code: 'JOB_EXPANSION_DENIED' });
  assert.equal(f.jobs.rows(f.id).length, 1);
});

test('queued revisions chain, preserve prior nodes and replay receipts after reopening', async (t) => {
  const f = await setup(t, { scheduled: true });
  const command = f.expand();
  const second = await f.jobs.expand(command);
  const third = await f.jobs.expand(f.expand([f.node('third', ['second'])]));
  assert.equal(third.admission.input.definition.revision, 3);
  assert.equal(third.admission.input.definition.previous_definition_sha256, jobDigest(second.admission.input.definition));
  assert.deepEqual(third.admission.input.definition.tasks[0], f.definition.tasks[0]);
  assert.deepEqual(third.admission.input.definition.limits, f.definition.limits);
  assert.equal(third.admission.input.definition.max_parallelism, f.definition.max_parallelism);
  assert.equal(third.deadline_at, f.initial.deadline_at);
  assert.equal(f.jobs.eligibility(f.id).reason, 'scheduled');
  assert.equal(f.control.rows(f.id).length, 0);
  assert.equal(third.materialization, undefined);
  const reopened = new EngineeringControl({ state: f.control.state, workspaces: [f.root] });
  try {
    assert.deepEqual(reopened.jobs.query(f.id), third);
    assert.deepEqual(await reopened.jobs.expand(command), second);
    assert.deepEqual(await reopened.jobs.execute(f.create), f.initial);
    assert.equal(reopened.jobs.events(f.id, { after: 1 }).events.length, 2);
  } finally {
    reopened.close();
  }
});

test('hash, CAS, idempotency, deadline and strict command fields fence expansion', async (t) => {
  const f = await setup(t);
  const command = f.expand();
  await assert.rejects(f.jobs.expand({ ...command, input: { ...command.input, definition_sha256: '0'.repeat(64) } }), {
    code: 'JOB_DEFINITION_CONFLICT',
  });
  await assert.rejects(f.jobs.expand({ ...command, expected_sequence: 0 }), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  await assert.rejects(f.jobs.expand({ ...command, input: { ...command.input, limits: f.definition.limits } }));
  const result = await f.jobs.expand(command);
  assert.deepEqual(await f.jobs.expand(command), result);
  await assert.rejects(f.jobs.expand({ ...command, input: { ...command.input, nodes: [f.node('third')] } }), {
    code: 'CONTROL_IDEMPOTENCY_CONFLICT',
  });
  f.jobs.now = () => Date.parse(f.initial.deadline_at);
  await assert.rejects(f.jobs.expand(f.expand([f.node('third')])), { code: 'JOB_EXPIRED' });
  assert.deepEqual(await f.jobs.expand(command), result);
});

for (const variant of ['duplicate', 'missing', 'cycle', 'plugin', 'binding', 'extensions', 'empty', 'too-many'])
  test(`expansion rejects ${variant} without events or effects`, async (t) => {
    const f = await setup(t);
    const nodes = {
      duplicate: [f.node('first')],
      missing: [f.node('second', ['missing'])],
      cycle: [f.node('second', ['third']), f.node('third', ['second'])],
      plugin: [{ ...f.node('second'), plugin_model: {} }],
      binding: [
        {
          ...f.node('second'),
          binding: require('yaml').parse(
            fs.readFileSync(
              require('node:path').join(__dirname, '../.agents/activation/provider-bindings/openai-compatible.example.yaml'),
              'utf8',
            ),
          ),
        },
      ],
      extensions: [{ ...f.node('second'), extension_ids: ['extension:external'] }],
      empty: [],
      'too-many': Array.from({ length: 16 }, (_, i) => f.node(`node${i}`)),
    }[variant];
    if (variant === 'binding') {
      nodes[0].binding.transport.max_attempts = 1;
      require('../tools/cli/lib/engineering-model').validateEngineeringBinding(nodes[0].binding);
      await assert.rejects(f.jobs.expand(f.expand(nodes)), { code: 'CONTROL_BINDING_UNKNOWN' });
    } else await assert.rejects(f.jobs.expand(f.expand(nodes)));
    assert.deepEqual(f.jobs.query(f.id), f.initial);
    assert.equal(f.control.rows(f.id).length, 0);
  });

for (const limit of ['max_tokens', 'max_tool_calls', 'max_turns', 'max_children', 'max_workflow_steps', 'max_duration_ms'])
  test(`expanded DAG respects original ${limit}`, async (t) => {
    const project = fixture(t);
    const value = ['max_children', 'max_workflow_steps'].includes(limit) ? 1 : project.contract.limits[limit];
    const f = await setup(t, { limits: { [limit]: value } });
    await assert.rejects(f.jobs.expand(f.expand()));
    assert.deepEqual(f.jobs.query(f.id), f.initial);
  });

test('only initial v2 revision can be created; v1 and revision metadata cannot mix', async (t) => {
  const f = await setup(t);
  for (const [revision, previous_definition_sha256] of [
    [0, null],
    [1, 'a'.repeat(64)],
    [2, null],
    [2, 'a'.repeat(64)],
  ]) {
    const definition = { ...f.definition, revision, previous_definition_sha256 };
    await assert.rejects(
      f.jobs.execute({
        ...f.create,
        command_id: randomUUID(),
        resource_id: randomUUID(),
        input: { ...f.create.input, definition: { definition } },
      }),
    );
  }
  assert.throws(() => parseEngineeringWorkflow({ ...f.definition, schema_version: 1 }));
});

test('two controllers race for one revision and cancellation wins asynchronous admission', async (t) => {
  const f = await setup(t);
  const other = new EngineeringControl({ state: f.control.state, workspaces: [f.root] });
  t.after(() => other.close());
  const outcomes = await Promise.allSettled([f.jobs.expand(f.expand()), other.jobs.expand(f.expand([f.node('third')]))]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((r) => r.status === 'rejected').reason.code, 'CONTROL_SEQUENCE_CONFLICT');
  const admit = f.control.admitCreation.bind(f.control);
  f.control.admitCreation = async (...args) => {
    const admission = await admit(...args);
    await other.jobs.execute(f.envelope('cancel', 2));
    return admission;
  };
  await assert.rejects(f.jobs.expand(f.expand([f.node('last')])), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  assert.equal(f.jobs.query(f.id).status, 'cancelled');
});

test('expanded definition is pinned by claim, materialized and dispatched once', async (t) => {
  const f = await setup(t);
  await f.jobs.expand(f.expand());
  const worker = (action, expected_sequence, extra = {}) => {
    const { input: _, ...command } = f.envelope(action, expected_sequence);
    return { ...command, fence: 1, ...extra };
  };
  await f.jobs.worker.execute(worker('claim', 2, { fence: 0, lease_ms: 1000 }));
  await assert.rejects(f.jobs.expand(f.expand([f.node('third')])), { code: 'JOB_EXPANSION_DENIED' });
  await f.jobs.materializer.execute(worker('materialize', 3));
  const prepared = f.jobs.query(f.id);
  assert.equal(prepared.materialization.plan.tasks.length, 2);
  const dispatch = worker('dispatch', prepared.current_sequence);
  const result = await f.jobs.dispatcher.execute(dispatch);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.admission.input.definition.revision, 2);
  assert.deepEqual(await f.jobs.dispatcher.execute(dispatch), result);
  await assert.rejects(f.jobs.expand(f.expand([f.node('third')])), { code: 'JOB_EXPANSION_DENIED' });
});

for (const winner of ['claim', 'expiry', 'baseline'])
  test(`expansion revalidates ${winner} after admission`, async (t) => {
    const f = await setup(t);
    const original = f.control.admitCreation.bind(f.control);
    f.control.admitCreation = async (...args) => {
      const admitted = await original(...args);
      if (winner === 'claim') {
        const { input: _, ...command } = f.envelope('claim', 1);
        f.control.admitCreation = original;
        await f.jobs.worker.execute({ ...command, fence: 0, lease_ms: 1000 });
      } else if (winner === 'expiry') f.jobs.now = () => Date.parse(f.initial.deadline_at);
      else fs.writeFileSync(require('node:path').join(f.root, 'index.js'), 'changed');
      return admitted;
    };
    await assert.rejects(f.jobs.expand(f.expand()));
    assert.equal(f.jobs.query(f.id).admission.input.definition.revision, 1);
  });

test('replay rejects altered revision events even with recomputed payload hashes', async (t) => {
  const f = await setup(t);
  await f.jobs.expand(f.expand());
  for (const alter of [
    (row) => {
      row.schema_version = 2;
    },
    (row) => {
      row.stream_sequence++;
    },
    (row) => {
      row.payload.command.resource_id = randomUUID();
    },
    (row) => {
      row.payload.command.expected_sequence = 0;
    },
    (row) => {
      row.payload.command.command_id = f.create.command_id;
    },
    (row) => {
      row.payload.digest = '0'.repeat(64);
    },
    (row) => {
      row.payload.admission_sha256 = '0'.repeat(64);
    },
    (row) => {
      row.payload.at++;
    },
    (row) => {
      row.payload.at = Date.parse(f.initial.deadline_at);
      row.occurred_at = f.initial.deadline_at;
    },
    (row) => {
      row.payload.admission.input.definition.tasks[0].id = 'tampered';
      row.payload.admission_sha256 = jobDigest(row.payload.admission);
    },
    (row) => {
      row.payload.command.input.definition_sha256 = '0'.repeat(64);
      row.payload.digest = jobDigest(row.payload.command);
    },
  ]) {
    const rows = structuredClone(f.jobs.rows(f.id));
    alter(rows[1]);
    assert.throws(() => f.jobs.project(f.id, rows));
  }
  assert.throws(() => f.jobs.project(f.id, [f.jobs.rows(f.id)[1]]));
});

test('two separate processes cannot append competing workflow revisions', async (t) => {
  const f = await setup(t);
  const { fork } = require('node:child_process');
  const { once } = require('node:events');
  const path = require('node:path');
  const run = async (command) => {
    const child = fork(path.join(__dirname, 'helpers/job-expansion-process.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const exited = once(child, 'exit');
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    });
    const message = once(child, 'message');
    child.send({ state: f.control.state, root: f.root, command });
    const [result] = await message;
    child.disconnect();
    await exited;
    return result;
  };
  const results = await Promise.all([run(f.expand()), run(f.expand([f.node('third')]))]);
  assert.equal(results.filter((result) => result.sequence === 2).length, 1);
  assert.equal(results.find((result) => result.code).code, 'CONTROL_SEQUENCE_CONFLICT');
  assert.equal(f.jobs.rows(f.id).length, 2);
});
