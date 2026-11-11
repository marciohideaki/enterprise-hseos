'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { startControlServer } = require('../tools/cli/lib/engineering-control-http');
const { ControlClient } = require('../packages/control-sdk');
const run = promisify(execFile);

test('authenticated HTTP, JS, Python and CLI share terminal identity and cursor', async (t) => {
  const project = fixture(t, {
    files: { 'main.py': 'import sys\nprint(sys.stdin.read().upper(),flush=True)' },
    entry: 'main.py',
    runtime: 'python',
  });
  const control = new EngineeringControl({ workspaces: [project.root] });
  const credential = 'ephemeral-terminal-protocol-fixture-only';
  const server = await startControlServer({ control, credential });
  const client = new ControlClient({ url: server.url, credential });
  t.after(async () => {
    await server.close();
    await control.terminals.shutdown();
    control.close();
    control.handle.cleanup();
  });
  const task = randomUUID(),
    id = randomUUID();
  await client.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: task,
    expected_sequence: 0,
    action: 'create',
    input: { contract: control.prepare(project.contract), responses: [] },
  });
  assert.equal((await fetch(server.url + '/v1/terminals/' + id)).status, 401);
  await client.terminal({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 0,
    action: 'open',
    input: { task_id: task, command_id: 'check', mode: 'job' },
  });
  const env = { ...process.env, HSEOS_CONTROL_CREDENTIAL: credential };
  const cli = await run(process.execPath, ['tools/cli/hseos-cli.js', 'control', 'terminal-query', '--url', server.url, '--resource', id], {
    env,
  });
  assert.equal(JSON.parse(cli.stdout).resource_id, id);
  const python = await run(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      `import json,os,sys,uuid,base64
sys.path.insert(0,'packages/control-sdk')
from hseos_control import ControlClient
c=ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL'])
s=c.terminal_query(sys.argv[2])
r=c.terminal({'schema_version':1,'command_id':str(uuid.uuid4()),'resource_id':s['resource_id'],'expected_sequence':s['current_sequence'],'action':'input','input':{'data':base64.b64encode(b'hello').decode()}})
print(json.dumps(r))`,
      server.url,
      id,
    ],
    { env },
  );
  assert.equal(JSON.parse(python.stdout).effect.bytes, 5);
  const state = await client.terminalQuery(id);
  await client.terminal({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: state.current_sequence,
    action: 'eof',
    input: {},
  });
  const deadline = Date.now() + 4000;
  while (!(await client.terminalQuery(id)).descendants_terminated) {
    assert.ok(Date.now() < deadline);
    await new Promise((r) => setTimeout(r, 10));
  }
  const events = await client.terminalEvents(id);
  assert.equal(
    events.events
      .filter((r) => r.payload.kind === 'output')
      .map((r) => Buffer.from(r.payload.data, 'base64').toString())
      .join(''),
    'HELLO\n',
  );
  assert.equal((await client.terminalEvents(id, { after: events.next_cursor })).events.length, 0);
  await assert.rejects(client.request(`/v1/terminals/${id}/events?after=-1`), { code: 'CONTROL_QUERY_INVALID' });
  await assert.rejects(client.request(`/v1/terminals/${id}?unexpected=1`), { code: 'CONTROL_QUERY_INVALID' });
  const headers = { authorization: `Bearer ${credential}` };
  const missing = randomUUID();
  for (const route of [`/v1/terminals/${missing}`, `/v1/terminals/${missing}/events`]) {
    const response = await fetch(server.url + route, { headers });
    assert.equal(response.status, 404, route);
    assert.deepEqual(await response.json(), { error: 'CONTROL_TERMINAL_NOT_FOUND' });
  }
  const badCursor = await fetch(server.url + `/v1/terminals/${id}/events?after=-1`, { headers });
  assert.equal(badCursor.status, 400);
  assert.deepEqual(await badCursor.json(), { error: 'CONTROL_QUERY_INVALID' });
});

test('terminal actions and event reads are refused without the control credential and leave no effect', async (t) => {
  const project = fixture(t, {
    files: { 'main.py': 'import sys\nprint(sys.stdin.read().upper(),flush=True)' },
    entry: 'main.py',
    runtime: 'python',
  });
  const control = new EngineeringControl({ workspaces: [project.root] });
  const credential = 'ephemeral-terminal-refusal-fixture-only';
  const server = await startControlServer({ control, credential });
  const client = new ControlClient({ url: server.url, credential });
  t.after(async () => {
    await server.close();
    await control.terminals.shutdown();
    control.close();
    control.handle.cleanup();
  });
  const task = randomUUID(),
    id = randomUUID();
  await client.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: task,
    expected_sequence: 0,
    action: 'create',
    input: { contract: control.prepare(project.contract), responses: [] },
  });
  await client.terminal({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: 0,
    action: 'open',
    input: { task_id: task, command_id: 'check', mode: 'pty' },
  });
  const marker = `refusal-marker-${randomUUID()}`;
  const text = async (response) => ({ status: response.status, body: await response.json() });
  const before = await client.terminalQuery(id);
  const eventsBefore = await client.terminalEvents(id);
  const sequence = before.current_sequence;
  const body = (action, input) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: sequence,
    action,
    input,
  });
  const commands = [
    body('input', { data: Buffer.from(`${marker}\n`).toString('base64') }),
    body('resize', { rows: 33, cols: 77 }),
    body('interrupt', {}),
    body('eof', {}),
  ];
  const attempt = (url, init, headers) => fetch(server.url + url, { ...init, headers: { ...headers, ...init.headers } });
  const post = (command, headers) =>
    attempt(
      '/v1/terminals/commands',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) },
      headers,
    );
  const refusals = [{}, { authorization: 'Bearer wrong-credential-wrong-credential-0000' }, { authorization: credential }];
  for (const headers of refusals) {
    for (const command of commands) {
      assert.deepEqual(
        await text(await post(command, headers)),
        { status: 401, body: { error: 'CONTROL_UNAUTHENTICATED' } },
        command.action,
      );
    }
    for (const route of [`/v1/terminals/${id}/events`, `/v1/terminals/${id}/events?after=0`, `/v1/terminals/${id}`]) {
      assert.deepEqual(await text(await attempt(route, { method: 'GET' }, headers)), {
        status: 401,
        body: { error: 'CONTROL_UNAUTHENTICATED' },
      });
    }
  }
  const afterRefusals = await client.terminalQuery(id);
  const eventsAfterRefusals = await client.terminalEvents(id);
  assert.equal(afterRefusals.current_sequence, sequence);
  assert.equal(eventsAfterRefusals.events.length, eventsBefore.events.length);
  assert.equal(eventsAfterRefusals.next_cursor, eventsBefore.next_cursor);
  const outputOf = (events) =>
    events.events
      .filter((r) => r.payload.kind === 'output')
      .map((r) => Buffer.from(r.payload.data, 'base64').toString())
      .join('');
  assert.equal(outputOf(eventsAfterRefusals).includes(marker), false);
  assert.equal(JSON.stringify(eventsAfterRefusals).includes(marker), false);
  // Positive control: the very same payloads are accepted with the right credential.
  const authorized = { authorization: `Bearer ${credential}` };
  const accepted = [];
  let next = sequence;
  for (const command of [commands[0], commands[1], commands[3]]) {
    const response = await text(await post({ ...command, expected_sequence: next }, authorized));
    assert.equal(response.status, 200, `${command.action}: ${JSON.stringify(response.body)}`);
    accepted.push(response.body);
    next = (await client.terminalQuery(id)).current_sequence;
  }
  assert.equal(accepted[0].effect.bytes, Buffer.byteLength(`${marker}\n`));
  const unauthorizedEvents = await text(await attempt(`/v1/terminals/${id}/events`, { method: 'GET' }, {}));
  assert.equal(unauthorizedEvents.status, 401);
  const events = await text(await attempt(`/v1/terminals/${id}/events`, { method: 'GET' }, authorized));
  assert.equal(events.status, 200);
  assert.ok(events.body.events.length > eventsBefore.events.length);
  const deadline = Date.now() + 4000;
  while (!(await client.terminalQuery(id)).descendants_terminated) {
    assert.ok(Date.now() < deadline);
    await new Promise((r) => setTimeout(r, 10));
  }
  const output = outputOf(await client.terminalEvents(id));
  assert.equal(output.split(marker.toUpperCase()).length - 1, 1);
});

test('interactive attach streams bytes, serializes input/resize, and detaches without terminate', async () => {
  const { PassThrough } = require('node:stream');
  const { attachTerminal } = require('../tools/cli/lib/terminal-attach');
  const input = new PassThrough(),
    output = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (v) => {
    input.isRaw = v;
  };
  output.rows = 40;
  output.columns = 100;
  const calls = [];
  let text = '',
    cursor = 0;
  output.on('data', (b) => {
    text += b.toString();
  });
  const client = {
    terminalQuery: async () => ({ current_sequence: calls.length + 1, mode: 'pty', descendants_terminated: false }),
    terminal: async (command) => {
      calls.push(command);
      return { effect: { bytes: command.action === 'input' ? Buffer.from(command.input.data, 'base64').length : undefined } };
    },
    terminalEvents: async () => ({ events: cursor++ ? [] : [{ payload: { kind: 'output', data: 'aGk=' } }], next_cursor: cursor }),
  };
  const attached = attachTerminal(client, 'id', { input, output });
  await new Promise((r) => setTimeout(r, 20));
  input.write(Buffer.from('hello'));
  output.emit('resize');
  input.write(Buffer.from([3]));
  input.write(Buffer.from([4]));
  await new Promise((r) => setTimeout(r, 20));
  input.write(Buffer.from([29]));
  await attached;
  assert.equal(text, 'hi');
  assert.equal(input.isRaw, false);
  assert.deepEqual(
    calls.map((c) => c.action),
    ['input', 'resize', 'interrupt', 'eof'],
  );
  assert.equal(calls[1].input.rows, 40);
});
test('attach restores terminal on rejection and ends at the durable cursor', async () => {
  const { PassThrough } = require('node:stream');
  const { attachTerminal } = require('../tools/cli/lib/terminal-attach');
  const input = new PassThrough(),
    output = new PassThrough();
  const client = {
    terminalQuery: async () => ({ current_sequence: 0, descendants_terminated: true }),
    terminalEvents: async () => ({ events: [], next_cursor: 0 }),
  };
  assert.deepEqual(await attachTerminal(client, 'id', { input, output }), { next_cursor: 0 });
  const input2 = new PassThrough();
  const broken = {
    ...client,
    terminalQuery: async () => ({ mode: 'job', current_sequence: 0 }),
    terminal: async () => {
      throw new Error('uncertain');
    },
  };
  const pending = attachTerminal(broken, 'id', { input: input2, output });
  await new Promise((r) => setTimeout(r, 10));
  input2.end();
  await assert.rejects(pending, /uncertain/);
});

test('attach releases listeners when enabling raw mode fails', async () => {
  const { PassThrough } = require('node:stream');
  const { attachTerminal } = require('../tools/cli/lib/terminal-attach');
  const input = new PassThrough(),
    output = new PassThrough();
  const signalListeners = process.listeners('SIGTERM');
  const error = new Error('TTY unavailable');
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = () => {
    throw error;
  };
  const client = { terminalQuery: async () => ({ mode: 'pty', current_sequence: 0 }) };
  try {
    await assert.rejects(attachTerminal(client, 'id', { input, output }), (actual) => actual === error);
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('end'), 0);
    assert.equal(output.listenerCount('resize'), 0);
    assert.deepEqual(process.listeners('SIGTERM'), signalListeners);
    assert.equal(input.isPaused(), true);
  } finally {
    for (const listener of process.listeners('SIGTERM')) if (!signalListeners.includes(listener)) process.off('SIGTERM', listener);
    input.destroy();
    output.destroy();
  }
});

test('attach fences queued input after an uncertain command', async () => {
  const { PassThrough } = require('node:stream');
  const { attachTerminal } = require('../tools/cli/lib/terminal-attach');
  const input = new PassThrough(),
    output = new PassThrough();
  let calls = 0;
  const client = {
    terminalQuery: async () => ({ mode: 'job', current_sequence: 0 }),
    terminalEvents: async () => ({ events: [], next_cursor: 0 }),
    terminal: async () => {
      calls++;
      throw new Error('uncertain receipt');
    },
  };
  const pending = attachTerminal(client, 'id', { input, output });
  await new Promise((resolve) => setImmediate(resolve));
  input.write(Buffer.alloc(8192, 65));
  await assert.rejects(pending, /uncertain receipt/);
  assert.equal(calls, 1);
});

test('attach reports partial input instead of silently discarding its suffix', async () => {
  const { PassThrough } = require('node:stream');
  const { attachTerminal } = require('../tools/cli/lib/terminal-attach');
  const input = new PassThrough(),
    output = new PassThrough();
  let calls = 0;
  const client = {
    terminalQuery: async () => ({ mode: 'job', current_sequence: 0, descendants_terminated: calls > 0 }),
    terminalEvents: async () => ({ events: [], next_cursor: 0 }),
    terminal: async () => {
      calls++;
      return { effect: { bytes: 2 } };
    },
  };
  const pending = attachTerminal(client, 'id', { input, output });
  await new Promise((resolve) => setImmediate(resolve));
  input.write(Buffer.from('hello'));
  await assert.rejects(pending, { code: 'CONTROL_TERMINAL_INPUT_PARTIAL' });
  assert.equal(calls, 1);
});

for (const prior of [false, true]) {
  test(`detach rejects later data, EOF and resize while draining earlier input (${prior})`, async () => {
    const { Stream } = require('node:stream');
    const { attachTerminal } = require('../tools/cli/lib/terminal-attach');
    const input = new Stream();
    const output = new Stream();
    const actions = [];
    input.pause = () => {};
    input.resume = () => {
      if (prior) input.emit('data', Buffer.from('before'));
      input.emit('data', Buffer.from([29]));
      input.emit('data', Buffer.from('after'));
      input.emit('end');
      output.emit('resize');
    };
    output.write = () => {};
    const client = {
      terminalQuery: async () => ({ mode: 'pty', current_sequence: actions.length, descendants_terminated: false }),
      terminalEvents: async () => {
        throw new Error('Polling after immediate detach');
      },
      terminal: async (command) => {
        actions.push(command);
        return { effect: { bytes: Buffer.from(command.input.data || '', 'base64').length } };
      },
    };
    await attachTerminal(client, randomUUID(), { input, output });
    assert.deepEqual(
      actions.map((command) => command.action),
      prior ? ['input'] : [],
    );
    if (prior) assert.equal(Buffer.from(actions[0].input.data, 'base64').toString(), 'before');
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('end'), 0);
    assert.equal(output.listenerCount('resize'), 0);
  });
}
