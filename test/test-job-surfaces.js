'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHash, randomUUID } = require('node:crypto');
const { execFile, fork } = require('node:child_process');
const { once } = require('node:events');
const { promisify } = require('node:util');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { startControlServer } = require('../tools/cli/lib/engineering-control-http');
const { ControlClient } = require('../packages/control-sdk');
const executeFile = promisify(execFile);
const credential = 'ephemeral-job-surface-credential-not-for-installation';

async function setup(t) {
  const f = fixture(t);
  const control = new EngineeringControl({ workspaces: [f.root] });
  const server = await startControlServer({ control, credential });
  t.after(async () => {
    await server.close();
    await control.jobs.dispatcher.shutdown();
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const id = randomUUID();
  const create = {
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 0,
    action: 'create',
    input: {
      kind: 'task',
      definition: { contract: f.contract, responses: [] },
      not_before: new Date(Date.now() - 1000).toISOString(),
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
      depends_on: [],
    },
  };
  return { ...f, control, server, client: new ControlClient({ url: server.url, credential }), id, create };
}

test('CLI, JavaScript and Python share job state, command replay and event cursors', async (t) => {
  const f = await setup(t);
  const created = await f.client.job(f.create);
  assert.equal(created.status, 'queued');
  assert.deepEqual(await f.client.job(f.create), created);
  const env = { ...process.env, HSEOS_CONTROL_CREDENTIAL: credential };
  const cli = await executeFile(
    process.execPath,
    ['tools/cli/hseos-cli.js', 'control', 'job-query', '--url', f.server.url, '--resource', f.id],
    { env },
  );
  assert.deepEqual(JSON.parse(cli.stdout), created);
  const python = await executeFile(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      "import json,os,sys;sys.path.insert(0,'packages/control-sdk');from hseos_control import ControlClient;c=ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL']);print(json.dumps({'job':c.job_query(sys.argv[2]),'events':c.job_events(sys.argv[2],limit=1)}))",
      f.server.url,
      f.id,
    ],
    { env },
  );
  const fromPython = JSON.parse(python.stdout);
  assert.deepEqual(fromPython.job, created);
  assert.equal(fromPython.events.events.length, 1);
  assert.equal(fromPython.events.next_cursor, 1);
  const cancel = { ...f.create, command_id: randomUUID(), expected_sequence: 1, action: 'cancel', input: {} };
  const requestFile = path.join(f.directory, 'job-cancel.json');
  fs.writeFileSync(requestFile, JSON.stringify(cancel));
  const cancelled = await executeFile(
    process.execPath,
    ['tools/cli/hseos-cli.js', 'control', 'job-command', '--url', f.server.url, '--request', requestFile],
    { env },
  );
  assert.equal(JSON.parse(cancelled.stdout).status, 'cancelled');
  const pythonCommand = await executeFile(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      "import json,os,sys;sys.path.insert(0,'packages/control-sdk');from hseos_control import ControlClient;print(json.dumps(ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL']).job(json.load(open(sys.argv[2])))))",
      f.server.url,
      requestFile,
    ],
    { env },
  );
  assert.deepEqual(JSON.parse(pythonCommand.stdout), JSON.parse(cancelled.stdout));
  assert.deepEqual(await f.client.job(cancel), JSON.parse(cancelled.stdout));
  const page = await f.client.jobEvents(f.id, { after: 1, limit: 1 });
  assert.equal(page.events.length, 1);
  assert.equal(page.next_cursor, 2);
  const cliEvents = await executeFile(
    process.execPath,
    ['tools/cli/hseos-cli.js', 'control', 'job-events', '--url', f.server.url, '--resource', f.id, '--after', '1', '--limit', '1'],
    { env },
  );
  assert.deepEqual(JSON.parse(cliEvents.stdout), page);
  assert.deepEqual((await f.client.jobEvents(f.id, { after: 2 })).events, []);
});

test('HTTP, CLI and Python expose explicit resume with one durable dispatch', async (t) => {
  const f = await setup(t);
  await f.client.job(f.create);
  await f.control.jobs.worker.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.id,
    expected_sequence: 1,
    action: 'claim',
    fence: 0,
    lease_ms: 1000,
  });
  const resume = { schema_version: 1, command_id: randomUUID(), resource_id: f.id, expected_sequence: 2, action: 'resume', input: {} };
  const requestFile = path.join(f.directory, 'job-resume.json');
  fs.writeFileSync(requestFile, JSON.stringify(resume));
  const env = { ...process.env, HSEOS_CONTROL_CREDENTIAL: credential };
  const cli = await executeFile(
    process.execPath,
    ['tools/cli/hseos-cli.js', 'control', 'job-command', '--url', f.server.url, '--request', requestFile],
    { env },
  );
  const result = JSON.parse(cli.stdout);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(await f.client.job(resume), result);
  const python = await executeFile(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      "import json,os,sys;sys.path.insert(0,'packages/control-sdk');from hseos_control import ControlClient;print(json.dumps(ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL']).job(json.load(open(sys.argv[2])))))",
      f.server.url,
      requestFile,
    ],
    { env },
  );
  assert.deepEqual(JSON.parse(python.stdout), result);
  assert.equal((await f.client.jobEvents(f.id)).events.filter((event) => event.event_type === 'JobExecutionRecorded').length, 2);
});

test('job HTTP keeps authentication, strict commands and cursor boundaries', async (t) => {
  const f = await setup(t);
  const unauthorized = await fetch(f.server.url + '/v1/jobs/' + f.id);
  assert.equal(unauthorized.status, 401);
  const content = fs.readFileSync(path.join(f.root, 'index.js'), 'utf8');
  const inline = structuredClone(f.create);
  inline.input.definition.contract.initial_files = [
    { path: 'index.js', content, sha256: createHash('sha256').update(content).digest('hex') },
  ];
  await assert.rejects(f.client.job(inline), { code: 'JOB_INLINE_CODE_DENIED' });
  assert.deepEqual(f.control.jobs.rows(f.id), []);
  await assert.rejects(f.client.job({ ...f.create, unknown: true }), { code: 'CONTROL_REQUEST_REJECTED' });
  await assert.rejects(
    f.client.job({
      ...f.create,
      action: 'link_retry',
      input: { retry_job_id: randomUUID(), retry_command_id: randomUUID(), retry_digest: 'a'.repeat(64) },
    }),
    { code: 'JOB_COMMAND_INTERNAL' },
  );
  const created = await f.client.job(f.create);
  await assert.rejects(f.client.job({ ...f.create, input: { ...f.create.input, depends_on: [randomUUID()] } }), {
    code: 'CONTROL_IDEMPOTENCY_CONFLICT',
  });
  assert.throws(() => f.client.jobEvents(f.id, { limit: 0 }), /cursor/);
  await assert.rejects(f.client.job({ ...f.create, command_id: randomUUID(), action: 'reconcile', expected_sequence: 1, input: {} }), {
    code: 'JOB_TERMINAL',
  });
  assert.deepEqual(await f.client.jobQuery(f.id), created);
});

test('public reconciliation drains a dead claim and replays with its original fence', async (t) => {
  const f = await setup(t);
  await f.client.job(f.create);
  const child = fork(path.join(__dirname, 'helpers/job-claim-process.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill('SIGKILL');
      await closed;
    }
  });
  const message = once(child, 'message');
  child.send({
    state: f.control.state,
    root: f.root,
    now: Date.now(),
    command: {
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.id,
      expected_sequence: 1,
      action: 'claim',
      fence: 0,
      lease_ms: 1000,
    },
  });
  const claimed = (await message)[0];
  assert.equal(claimed.result?.status, 'claimed', JSON.stringify(claimed));
  const closed = once(child, 'exit');
  child.kill('SIGKILL');
  await closed;
  const reconcile = {
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.id,
    expected_sequence: 2,
    action: 'reconcile',
    input: {},
  };
  const recovered = await f.client.job(reconcile);
  assert.equal(recovered.status, 'claimed');
  assert.equal(recovered.fence, 2);
  assert.deepEqual(await f.client.job(reconcile), recovered);
  assert.equal((await f.client.jobQuery(f.id)).current_sequence, recovered.current_sequence);
});
