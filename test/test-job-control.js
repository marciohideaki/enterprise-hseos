'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const cmd = (id, action, expected_sequence, input = {}) => ({
  schema_version: 1,
  command_id: randomUUID(),
  resource_id: id,
  action,
  expected_sequence,
  input,
});
function setup(t) {
  const f = fixture(t, { files: { 'index.js': 'module.exports = 1;' } });
  const control = new EngineeringControl({ workspaces: [f.root] });
  t.after(() => {
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const create = cmd(randomUUID(), 'create', 0, {
    kind: 'task',
    definition: { contract: f.contract, responses: [] },
    not_before: '2027-01-01T00:00:00.000Z',
    deadline_at: '2027-01-02T00:00:00.000Z',
    depends_on: [],
  });
  return { ...f, control, jobs: control.jobs, create };
}
test('job creation is data only, durable, temporally eligible and replayable', async (t) => {
  const f = setup(t),
    id = f.create.resource_id;
  const created = await f.jobs.execute(f.create);
  assert.equal(created.status, 'queued');
  assert.equal(created.first_started_at, undefined);
  assert.deepEqual(f.control.rows(id), []);
  assert.equal(f.control.ledger.readGlobal({ aggregate_type: 'control_campaign', limit: 100 }).length, 0);
  assert.deepEqual(await f.jobs.execute(f.create), created);
  assert.equal(f.jobs.eligibility(id, Date.parse(created.not_before) - 1).reason, 'scheduled');
  assert.equal(f.jobs.eligibility(id, Date.parse(created.not_before)).eligible, true);
  assert.equal(f.jobs.eligibility(id, Date.parse(created.deadline_at)).reason, 'expired');
  const second = new EngineeringControl({ state: f.control.state });
  try {
    assert.deepEqual(second.jobs.query(id), created);
  } finally {
    second.close();
  }
  assert.equal(f.jobs.events(id, { limit: 1 }).next_cursor, 1);
  assert.deepEqual(f.jobs.events(id, { after: 1 }).events, []);
});
test('cancellation and idempotency preserve receipts and reject stale mutations', async (t) => {
  const f = setup(t),
    id = f.create.resource_id;
  const created = await f.jobs.execute(f.create);
  await assert.rejects(f.jobs.execute({ ...f.create, input: { ...f.create.input, depends_on: [randomUUID()] } }), {
    code: 'CONTROL_IDEMPOTENCY_CONFLICT',
  });
  await assert.rejects(f.jobs.execute(cmd(id, 'cancel', 0)), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  const cancel = cmd(id, 'cancel', 1);
  assert.equal((await f.jobs.execute(cancel)).status, 'cancelled');
  assert.equal((await f.jobs.execute(cancel)).current_sequence, 2);
  assert.deepEqual(await f.jobs.execute(f.create), created);
  await assert.rejects(f.jobs.execute(cmd(id, 'cancel', 2)), { code: 'JOB_TERMINAL' });
  assert.equal(f.jobs.eligibility(id).reason, 'terminal');
  assert.equal(f.jobs.events(id, { after: 1 }).next_cursor, 2);
  assert.throws(() => f.jobs.events(id, { limit: 0 }), { code: 'CONTROL_QUERY_INVALID' });
});
test('dependencies and strict schedule reject invalid commands without records', async (t) => {
  const f = setup(t),
    id = f.create.resource_id;
  await assert.rejects(f.jobs.execute({ ...f.create, input: { ...f.create.input, depends_on: [id] } }), { code: 'JOB_DEPENDENCY_INVALID' });
  await assert.rejects(f.jobs.execute({ ...f.create, input: { ...f.create.input, depends_on: [randomUUID()] } }), {
    code: 'JOB_NOT_FOUND',
  });
  for (const patch of [
    { depends_on: [id, id] },
    { not_before: f.create.input.deadline_at },
    { deadline_at: '2027-02-30T00:00:00.000Z' },
    { recurrence: 'daily' },
  ])
    await assert.rejects(f.jobs.execute({ ...f.create, input: { ...f.create.input, ...patch } }));
  assert.deepEqual(f.jobs.rows(id), []);
  await f.jobs.execute(f.create);
  const child = { ...f.create, command_id: randomUUID(), resource_id: randomUUID(), input: { ...f.create.input, depends_on: [id] } };
  await f.jobs.execute(child);
  assert.equal(f.jobs.eligibility(child.resource_id, Date.parse(child.input.not_before)).reason, 'dependencies');
  await assert.rejects(
    f.jobs.execute({
      ...f.create,
      command_id: randomUUID(),
      expected_sequence: 1,
      input: { ...f.create.input, depends_on: [child.resource_id] },
    }),
    { code: 'CONTROL_SEQUENCE_CONFLICT' },
  );
});
test('concurrent creates have one receipt; a job owns its future resource identity', async (t) => {
  const f = setup(t);
  const results = await Promise.all([f.jobs.execute(f.create), f.jobs.execute(f.create)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(f.jobs.rows(f.create.resource_id).length, 1);
  await assert.rejects(f.control.execute(cmd(f.create.resource_id, 'create', 0, f.create.input.definition)), {
    code: 'JOB_RESOURCE_CONFLICT',
  });
  const next = { ...f.create, resource_id: randomUUID(), command_id: randomUUID() };
  const race = await Promise.allSettled([f.jobs.execute(next), f.jobs.execute({ ...next, command_id: randomUUID() })]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
});
test('replay rejects fabricated states and admission tampering', async (t) => {
  const f = setup(t),
    id = f.create.resource_id;
  await f.jobs.execute(f.create);
  const rows = f.jobs.rows(id);
  for (const mutate of [
    (r) => {
      r.event_type = 'ControlCommandRecorded';
    },
    (r) => {
      r.schema_version = 2;
    },
    (r) => {
      r.payload.admission.input.responses.push({ name: 'injected', input: {} });
    },
    (r) => {
      r.payload.command.expected_sequence = 2;
    },
    (r) => {
      r.payload.command.resource_id = randomUUID();
    },
  ]) {
    const changed = structuredClone(rows);
    mutate(changed[0]);
    assert.throws(() => f.jobs.project(id, changed));
  }
  assert.throws(() => f.jobs.query(randomUUID()), { code: 'JOB_NOT_FOUND' });
  await assert.rejects(f.jobs.execute(cmd(randomUUID(), 'cancel', 0)), { code: 'JOB_NOT_FOUND' });
});
test('legacy binding is validated and pinned without initializing its provider', async (t) => {
  const f = setup(t);
  const path = require('node:path');
  const file = path.join(f.root, 'job-binding.json');
  const control = new EngineeringControl({ state: f.control.state, workspaces: [f.root], bindings: { local: file } });
  t.after(() => control.close());
  const create = { ...f.create, input: { ...f.create.input, definition: { contract: f.contract, binding_id: 'local' } } };
  await assert.rejects(control.jobs.execute(create), /absent/);
  fs.writeFileSync(file, '{}');
  await assert.rejects(control.jobs.execute(create), /schema/);
  const binding = require('yaml').parse(
    fs.readFileSync(path.join(__dirname, '../.agents/activation/provider-bindings/openai-compatible.example.yaml'), 'utf8'),
  );
  binding.transport.max_attempts = 1;
  fs.writeFileSync(file, JSON.stringify(binding));
  const created = await control.jobs.execute(create);
  assert.deepEqual(created.admission.binding, require('../tools/cli/lib/engineering-model').validateEngineeringBinding(binding));
  binding.provider.base_url = 'https://changed.fixture.invalid/v1';
  fs.writeFileSync(file, JSON.stringify(binding));
  assert.deepEqual(control.jobs.query(create.resource_id), created);
  assert.deepEqual(await control.jobs.execute(create), created);
  const admitted = await control.admitCreation('create', create.input.definition, create.resource_id);
  assert.notEqual(admitted.binding_sha256, created.admission.binding_sha256);
});
test('replay rejects invalid admission even with recalculated digests and UTC compares instants', async (t) => {
  const f = setup(t),
    id = f.create.resource_id;
  const { jobDigest } = require('../tools/lib/job-contract');
  await f.jobs.execute(f.create);
  for (const admission of [
    { input: {} },
    { input: f.create.input.definition, binding_sha256: 'a'.repeat(64) },
    { input: f.create.input.definition, selection: {} },
    { input: f.create.input.definition, plugin_model: {} },
  ]) {
    const rows = f.jobs.rows(id);
    rows[0].payload.admission = admission;
    rows[0].payload.admission_sha256 = jobDigest(admission);
    assert.throws(() => f.jobs.project(id, rows));
  }
  await assert.rejects(
    f.jobs.execute({ ...f.create, resource_id: randomUUID(), input: { ...f.create.input, not_before: '+010000-01-01T00:00:00.000Z' } }),
  );
});
test('replay cannot introduce absent or conflicting model sources', async (t) => {
  const f = setup(t),
    id = f.create.resource_id;
  const { jobDigest } = require('../tools/lib/job-contract');
  await f.jobs.execute(f.create);
  for (const definition of [{ contract: f.contract }, { ...f.create.input.definition, binding_id: 'local' }]) {
    const rows = f.jobs.rows(id),
      payload = rows[0].payload;
    payload.command.input.definition = definition;
    payload.admission.input = definition;
    payload.digest = jobDigest(payload.command);
    payload.admission_sha256 = jobDigest(payload.admission);
    assert.throws(() => f.jobs.project(id, rows), /CONTROL_MODEL_/);
  }
});
test('workflow definition is pinned without materializing children', async (t) => {
  const f = setup(t);
  const definition = {
    schema_version: 1,
    workflow_id: 'workflow:queued',
    max_parallelism: 1,
    limits: { ...f.contract.limits, max_children: 1, max_workflow_steps: 1 },
    tasks: [{ id: 'first', contract: f.contract, responses: [], depends_on: [] }],
  };
  const create = { ...f.create, input: { ...f.create.input, kind: 'workflow', definition: { definition } } };
  const result = await f.jobs.execute(create);
  assert.equal(result.kind, 'workflow');
  assert.deepEqual(f.control.rows(create.resource_id), []);
  assert.equal(result.admission.input.definition.tasks.length, 1);
  assert.deepEqual(f.jobs.query(create.resource_id), result);
});
test('resource ownership is rechecked after asynchronous admission in both directions', async (t) => {
  const f = setup(t),
    id = f.create.resource_id;
  const original = f.control.admitCreation.bind(f.control);
  let release, entered;
  const enteredPromise = new Promise((r) => {
    entered = r;
  });
  const wait = new Promise((r) => {
    release = r;
  });
  let calls = 0;
  t.mock.method(f.control, 'admitCreation', async (...args) => {
    const result = await original(...args);
    if (++calls === 1) {
      entered();
      await wait;
    }
    return result;
  });
  const immediate = f.control.execute(cmd(id, 'create', 0, f.create.input.definition));
  await enteredPromise;
  await f.jobs.execute(f.create);
  release();
  await assert.rejects(immediate, { code: 'JOB_RESOURCE_CONFLICT' });
  assert.deepEqual(f.control.rows(id), []);
  const other = randomUUID();
  f.control.append(other, { kind: 'intent', command_id: randomUUID(), digest: 'a'.repeat(64), action: 'create' });
  await assert.rejects(f.jobs.execute({ ...f.create, resource_id: other }), { code: 'JOB_RESOURCE_CONFLICT' });
  assert.deepEqual(f.jobs.rows(other), []);
});
