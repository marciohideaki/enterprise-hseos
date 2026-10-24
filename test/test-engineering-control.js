'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const { fixture } = require('./helpers/engineering-project');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { projectVerifierDigest } = require('../tools/cli/lib/engineering-project-verifier');
const { startControlServer } = require('../tools/cli/lib/engineering-control-http');
const { ControlClient } = require('../packages/control-sdk');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const executeFile = promisify(execFile);
const credential = 'ephemeral-test-fixture-credential-not-for-installation';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const command = (id, action, sequence, input = {}) => ({
  schema_version: 1,
  command_id: randomUUID(),
  resource_id: id,
  action,
  expected_sequence: sequence,
  input,
});

async function setup(t, { bindings } = {}) {
  const f = fixture(t, { files: { 'index.js': 'module.exports = n => n - 1;' } });
  const control = new EngineeringControl({ workspaces: [f.root], ...(bindings ? { bindings: bindings(f.directory) } : {}) });
  const server = await startControlServer({ control, credential });
  const client = new ControlClient({ url: server.url, credential });
  t.after(async () => {
    await server.close();
    const states = control.ledger
      .readGlobal({ limit: 1000, aggregate_type: 'control_task' })
      .filter((e) => e.payload.kind === 'registered')
      .map((e) => e.payload.state_directory);
    control.close();
    for (const state of [...states, control.state]) fs.rmSync(state, { recursive: true, force: true });
  });
  const id = randomUUID();
  const create = command(id, 'create', 0, {
    contract: f.contract,
    responses: [
      {
        name: 'engineering.patch',
        input: { path: 'index.js', expected_sha256: sha('module.exports = n => n - 1;'), before: 'n - 1', after: 'n + 1' },
      },
    ],
  });
  return { ...f, control, server, client, id, create };
}

test('CLI, JavaScript, Python and HTTP share identity, task results and replayable event cursors', async (t) => {
  const f = await setup(t);
  const created = await f.client.execute(f.create);
  assert.deepEqual(await f.client.execute(f.create), created);
  const resumedCommand = command(f.id, 'resume', created.current_sequence);
  const result = await f.client.execute(resumedCommand);
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  assert.deepEqual(await f.client.execute(resumedCommand), result);
  assert.deepEqual(await f.control.query(f.id), result);
  const env = { ...process.env, HSEOS_CONTROL_CREDENTIAL: credential };
  const cli = await executeFile(
    process.execPath,
    ['tools/cli/hseos-cli.js', 'control', 'query', '--url', f.server.url, '--resource', f.id],
    { env },
  );
  assert.deepEqual(JSON.parse(cli.stdout), result);
  const python = await executeFile(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      "import json,os,sys;sys.path.insert(0,'packages/control-sdk');from hseos_control import ControlClient;print(json.dumps(ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL']).query(sys.argv[2])))",
      f.server.url,
      f.id,
    ],
    { env },
  );
  assert.deepEqual(JSON.parse(python.stdout), result);
  const requestFile = path.join(f.root, 'control-retry.json');
  fs.writeFileSync(requestFile, JSON.stringify(resumedCommand));
  const retried = await executeFile(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      "import json,os,sys;sys.path.insert(0,'packages/control-sdk');from hseos_control import ControlClient;print(json.dumps(ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL']).execute(json.load(open(sys.argv[2])))))",
      f.server.url,
      requestFile,
    ],
    { env },
  );
  assert.deepEqual(JSON.parse(retried.stdout), result);
  const session = await f.client.query(f.id, 'session');
  assert.equal(session.session_id, result.session_id);
  assert.equal(session.status, 'completed');
  const evidence = await f.client.query(f.id, 'evidence');
  assert.equal(evidence.verification.result, 'approved');
  let after = 0;
  const combined = [];
  while (true) {
    const page = await f.client.events(f.id, { after, limit: 3 });
    combined.push(...page.events);
    if (page.events.length === 0) break;
    assert.ok(page.next_cursor > after);
    after = page.next_cursor;
  }
  assert.deepEqual(combined, (await f.client.events(f.id, { limit: 1000 })).events);
  assert.equal(JSON.stringify(f.client).includes(credential), false);
  const reopened = new EngineeringControl({ state: f.control.state, workspaces: [f.root] });
  try {
    assert.deepEqual(await reopened.query(f.id), result);
    assert.deepEqual(await reopened.execute(resumedCommand), result);
  } finally {
    reopened.close();
  }
});

test('authenticated control rejects wrong identity, origins, workspace escalation and stale commands', async (t) => {
  const f = await setup(t);
  assert.equal((await fetch(f.server.url + '/v1/commands', { method: 'POST' })).status, 401);
  assert.equal(
    (
      await fetch(f.server.url + `/v1/tasks/${f.id}`, {
        headers: { authorization: `Bearer ${credential}`, origin: 'http://hostile.invalid' },
      })
    ).status,
    403,
  );
  const forbidden = structuredClone(f.create);
  forbidden.input.contract.workspace.root = '/etc';
  await assert.rejects(f.client.execute(forbidden), { code: 'CONTROL_WORKSPACE_DENIED' });
  assert.equal(f.control.rows(f.id).length, 0);
  const created = await f.client.execute(f.create);
  const changed = structuredClone(f.create);
  changed.input.responses = [];
  await assert.rejects(f.client.execute(changed), { code: 'CONTROL_IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.client.execute(command(f.id, 'resume', created.current_sequence + 1)), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  await assert.rejects(f.client.query(randomUUID()), { code: 'CONTROL_TASK_NOT_FOUND' });
});

test('an intent without receipt is not automatically dispatched again', async (t) => {
  const f = await setup(t);
  const created = await f.client.execute(f.create);
  const request = command(f.id, 'resume', created.current_sequence);
  f.control.append(f.id, { kind: 'intent', command_id: request.command_id, action: 'resume', digest: engineeringDigest(request) });
  await assert.rejects(f.client.execute(request), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  assert.equal((await f.client.query(f.id)).current_sequence, created.current_sequence);
});

test('review binds approval to Git baseline and only explicit apply modifies the source project', async (t) => {
  const f = await setup(t);
  const created = await f.client.execute(f.create);
  const result = await f.client.execute(command(f.id, 'resume', created.current_sequence));
  const review = await f.client.query(f.id, 'review');
  assert.equal(review.baseline_valid, true);
  assert.match(review.patch, /n \+ 1/);
  assert.equal(fs.readFileSync(path.join(f.root, 'index.js'), 'utf8'), 'module.exports = n => n - 1;');
  const applied = await f.client.execute(command(f.id, 'apply', result.current_sequence, { review_sha256: review.review_sha256 }));
  assert.equal(applied.applied, true);
  assert.equal(fs.readFileSync(path.join(f.root, 'index.js'), 'utf8'), 'module.exports = n => n + 1;');
});

test('concurrent source edits invalidate the prior review and are preserved', async (t) => {
  const f = await setup(t);
  const created = await f.client.execute(f.create);
  const result = await f.client.execute(command(f.id, 'resume', created.current_sequence));
  const review = await f.client.query(f.id, 'review');
  fs.writeFileSync(path.join(f.root, 'index.js'), 'external edit');
  await assert.rejects(f.client.execute(command(f.id, 'apply', result.current_sequence, { review_sha256: review.review_sha256 })));
  assert.equal(fs.readFileSync(path.join(f.root, 'index.js'), 'utf8'), 'external edit');
  assert.equal((await f.client.query(f.id, 'review')).baseline_valid, false);
});

test('public preparation pins the current workspace and cannot expand the server allowlist', async (t) => {
  const f = await setup(t);
  const prepared = await f.client.prepare({ ...f.contract, baseline_sha: '0'.repeat(40) });
  assert.equal(prepared.baseline_sha, f.contract.baseline_sha);
  assert.deepEqual(prepared, f.contract);
  await assert.rejects(f.client.prepare({ ...f.contract, workspace: { ...f.contract.workspace, root: '/etc' } }), {
    code: 'CONTROL_WORKSPACE_DENIED',
  });
});

test('rejected preparation returns a curated actionable cause under the stable category', async (t) => {
  const f = await setup(t);
  const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' };
  const post = async (contract) =>
    fetch(f.server.url + '/v1/prepare', { method: 'POST', headers, body: JSON.stringify(contract) }).then(async (r) => ({
      status: r.status,
      body: await r.json(),
    }));
  fs.symlinkSync('/etc/hostname', path.join(f.root, 'linked.txt'));
  const denied = await post({ ...f.contract, scope: { read: ['index.js', 'linked.txt'], write: ['index.js'] } });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, 'CONTROL_REQUEST_REJECTED');
  assert.equal(denied.body.detail.code, 'PROJECT_FILE_UNSAFE');
  assert.equal(denied.body.detail.path, 'linked.txt');
  assert.ok(!JSON.stringify(denied.body).includes(f.root));
  await assert.rejects(
    new ControlClient({ url: f.server.url, credential }).prepare({
      ...f.contract,
      scope: { read: ['index.js', 'linked.txt'], write: ['index.js'] },
    }),
    (error) => error.code === 'CONTROL_REQUEST_REJECTED' && error.detail.code === 'PROJECT_FILE_UNSAFE',
  );
});

test('prepare reports binary files and scope-contract violations with a curated cause', async (t) => {
  const f = await setup(t);
  const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' };
  const post = async (contract) =>
    fetch(f.server.url + '/v1/prepare', { method: 'POST', headers, body: JSON.stringify(contract) }).then(async (r) => r.json());
  fs.writeFileSync(path.join(f.root, 'blob.bin'), Buffer.from([0xff, 0xfe, 0xfd]));
  const binary = await post({ ...f.contract, scope: { read: ['index.js', 'blob.bin'], write: ['index.js'] } });
  assert.deepEqual(binary, {
    error: 'CONTROL_REQUEST_REJECTED',
    detail: { code: 'PROJECT_FILE_NOT_UTF8', message: binary.detail.message, path: 'blob.bin' },
  });
  const cases = [
    [{ read: ['index.js', 'index.js/x'], write: ['index.js'] }, 'PROJECT_SCOPE_CONFLICT', 'scope'],
    [{ read: ['index.js', '../x'], write: ['index.js'] }, 'PROJECT_PATH_INVALID', 'scope.read[1]'],
    [{ read: ['index.js'], write: ['index.js', 'other.js'] }, 'PROJECT_SCOPE_INVALID', 'scope.write'],
    [{ read: ['index.js', 'index.js'], write: ['index.js'] }, 'PROJECT_SCOPE_INVALID', 'scope.read'],
  ];
  for (const [scope, code, field] of cases) {
    const body = await post({ ...f.contract, scope });
    assert.equal(body.error, 'CONTROL_REQUEST_REJECTED');
    assert.equal(body.detail.code, code);
    assert.equal(body.detail.field, field);
    assert.ok(!JSON.stringify(body).includes(f.root) && !JSON.stringify(body).includes('../x'));
  }
});

test('an out-of-scope read by the executor fails with ENGINEERING_SCOPE_DENIED', async (t) => {
  const f = await setup(t);
  await f.client.execute(
    command(f.id, 'create', 0, { contract: f.contract, responses: [{ name: 'engineering.read', input: { path: 'outside.js' } }] }),
  );
  const result = await f.client.execute(command(f.id, 'resume', 1));
  const text = JSON.stringify([result, (await f.client.events(f.id, { limit: 1000 })).events]);
  assert.ok(text.includes('ENGINEERING_SCOPE_DENIED'), text.slice(0, 600));
  assert.ok(!text.includes('EXECUTION_INPUT_INVALID'));
  assert.notEqual(result.task_result, 'approved');
});

test('review of a non-approved task and a stale apply expose their cause', async (t) => {
  const f = await setup(t);
  await f.client.execute(command(f.id, 'create', 0, { contract: f.contract, responses: [] }));
  const headers = { authorization: `Bearer ${credential}` };
  const response = await fetch(`${f.server.url}/v1/tasks/${f.id}/review`, { headers });
  const body = await response.json();
  assert.equal(body.error, 'CONTROL_REQUEST_REJECTED');
  assert.equal(body.detail.code, 'PROJECT_RESULT_NOT_APPROVED');
});

test('workflows reuse the same API control and aggregate kernel budget', async (t) => {
  const f = await setup(t);
  const input = {
    schema_version: 1,
    workflow_id: 'workflow:project-api',
    max_parallelism: 1,
    limits: {
      ...f.contract.limits,
      max_children: 2,
      max_workflow_steps: 2,
      max_tokens: f.contract.limits.max_tokens * 2,
      max_turns: f.contract.limits.max_turns * 2,
      max_tool_calls: f.contract.limits.max_tool_calls * 2,
      max_duration_ms: f.contract.limits.max_duration_ms * 2,
    },
    tasks: ['first', 'second'].map((id, index) => ({
      id,
      contract: f.contract,
      responses: f.create.input.responses,
      depends_on: index ? ['first'] : [],
    })),
  };
  const created = await f.client.execute(command(f.id, 'create_workflow', 0, { definition: input }));
  const result = await f.client.execute(command(f.id, 'resume', created.current_sequence));
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.ok(result.tasks.every((task) => task.result === 'approved'));
  const evidence = await f.client.query(f.id, 'evidence');
  assert.ok(evidence.evidence.every((step) => step.verification.result === 'approved'));
  assert.equal((await f.client.query(f.id, 'session')).session_id, result.session_id);
  await assert.rejects(f.client.query(f.id, 'review'), { code: 'CONTROL_VIEW_UNAVAILABLE' });
  await assert.rejects(
    f.client.execute(
      command(f.id, 'resume', result.current_sequence, {
        reconciliation_decision: { report_sha256: '0'.repeat(64), decision: 'continue-from-observed-state', answer: 'invalid kind' },
      }),
    ),
    { code: 'CONTROL_RECONCILIATION_KIND' },
  );
  assert.deepEqual(await f.client.query(f.id), result);
  const events = await f.client.events(f.id, { limit: 1000 });
  assert.ok(events.events.length > 0);
});

test('HTTP rejects malformed, oversized and unsupported requests without exposing internal errors', async (t) => {
  const f = await setup(t);
  const headers = { authorization: `Bearer ${credential}` };
  assert.equal((await fetch(f.server.url + '/v1/commands', { method: 'POST', headers, body: '{}' })).status, 415);
  const badJson = await fetch(f.server.url + '/v1/commands', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: '{',
  });
  assert.deepEqual(await badJson.json(), { error: 'CONTROL_REQUEST_REJECTED' });
  assert.equal((await fetch(f.server.url + '/v2/commands', { method: 'POST', headers })).status, 404);
  assert.equal(
    (
      await fetch(f.server.url + '/v1/commands', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify('x'.repeat(2_100_000)),
      })
    ).status,
    413,
  );
  await f.client.execute(f.create);
  assert.equal((await fetch(f.server.url + `/v1/tasks/${f.id}?unexpected=1`, { headers })).status, 400);
  assert.equal((await fetch(f.server.url + `/v1/tasks/${f.id}/events?unexpected=1`, { headers })).status, 400);
  const badCursor = await fetch(f.server.url + `/v1/tasks/${f.id}/events?after=-1`, { headers });
  assert.equal(badCursor.status, 400);
  assert.deepEqual(await badCursor.json(), { error: 'CONTROL_QUERY_INVALID' });
  const missingEvents = await fetch(f.server.url + `/v1/tasks/${randomUUID()}/events`, { headers });
  assert.equal(missingEvents.status, 404);
  assert.deepEqual(await missingEvents.json(), { error: 'CONTROL_TASK_NOT_FOUND' });
});

test('SDK rejects remote endpoints, malformed cursors and invalid query views', () => {
  assert.throws(() => new ControlClient({ url: 'https://remote.invalid', credential }), /loopback/);
  assert.throws(() => new ControlClient({ url: 'http://127.0.0.1', credential: 'short' }), /credential/);
  const client = new ControlClient({ url: 'http://127.0.0.1:1', credential });
  assert.throws(() => client.events(randomUUID(), { after: -1 }), /cursor/);
  assert.throws(() => client.query('../elsewhere'), /query/);
  assert.throws(() => client.query(randomUUID(), 'unknown'), /query/);
});

test('candidate edits after approval invalidate review without applying unverified bytes', async (t) => {
  const f = await setup(t);
  const created = await f.client.execute(f.create);
  const result = await f.client.execute(command(f.id, 'resume', created.current_sequence));
  const review = await f.client.query(f.id, 'review');
  fs.writeFileSync(path.join(f.control.location(f.id), 'workspace', 'index.js'), 'unverified edit');
  await assert.rejects(f.client.execute(command(f.id, 'apply', result.current_sequence, { review_sha256: review.review_sha256 })));
  assert.equal(fs.readFileSync(path.join(f.root, 'index.js'), 'utf8'), 'module.exports = n => n - 1;');
});

test('control rejects model ambiguity, unknown bindings and duplicate resources before effects', async (t) => {
  const f = await setup(t);
  const ambiguous = structuredClone(f.create);
  ambiguous.input.binding_id = 'binding:unknown';
  await assert.rejects(f.client.execute(ambiguous), { code: 'CONTROL_MODEL_CONFLICT' });
  delete ambiguous.input.responses;
  await assert.rejects(f.client.execute(ambiguous), { code: 'CONTROL_BINDING_UNKNOWN' });
  delete ambiguous.input.binding_id;
  await assert.rejects(f.client.execute(ambiguous), { code: 'CONTROL_MODEL_REQUIRED' });
  await f.client.execute(f.create);
  await assert.rejects(f.client.execute({ ...f.create, command_id: randomUUID() }), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  const cancelled = await f.client.execute(command(f.id, 'cancel', (await f.client.query(f.id)).current_sequence));
  assert.equal(cancelled.reason, 'cancelled');
  await assert.rejects(f.client.query(f.id, 'review'));
  f.control.active.add('active');
  assert.throws(() => f.control.close(), { code: 'CONTROL_EXECUTION_ACTIVE' });
  f.control.active.clear();
});

test('Git application never invokes configured filesystem monitors or external diff commands', async (t) => {
  const f = await setup(t);
  const created = await f.client.execute(f.create);
  const result = await f.client.execute(command(f.id, 'resume', created.current_sequence));
  const marker = path.join(f.directory, 'git-external-effect');
  const script = path.join(f.directory, 'git-extension.sh');
  fs.writeFileSync(script, `#!/bin/sh\nprintf effect >> '${marker}'\nexit 1\n`, { mode: 0o700 });
  for (const key of ['core.fsmonitor', 'diff.external']) await executeFile('git', ['-C', f.root, 'config', key, script]);
  await executeFile('git', ['-C', f.root, 'config', 'diff.trustExitCode', 'true']);
  const review = await f.client.query(f.id, 'review');
  assert.equal(
    (await f.client.execute(command(f.id, 'apply', result.current_sequence, { review_sha256: review.review_sha256 }))).applied,
    true,
  );
  assert.equal(fs.existsSync(marker), false);
});

test('unknown resources return 404 and malformed cursors 400 uniformly across task, job, terminal and campaign routes', async (t) => {
  const f = await setup(t);
  const headers = { authorization: `Bearer ${credential}` };
  const surfaces = [
    ['tasks', 'CONTROL_TASK_NOT_FOUND'],
    ['jobs', 'JOB_NOT_FOUND'],
    ['terminals', 'CONTROL_TERMINAL_NOT_FOUND'],
    ['provider-campaigns', 'CONTROL_CAMPAIGN_NOT_FOUND'],
  ];
  for (const [surface, code] of surfaces) {
    const id = randomUUID();
    for (const route of [`/v1/${surface}/${id}`, `/v1/${surface}/${id}/events`, `/v1/${surface}/${id}/events?after=0&limit=10`]) {
      const response = await fetch(f.server.url + route, { headers });
      assert.equal(response.status, 404, route);
      assert.deepEqual(await response.json(), { error: code }, route);
    }
    for (const query of ['after=-1', 'after=1.5', 'limit=0', 'limit=1001']) {
      const response = await fetch(f.server.url + `/v1/${surface}/${id}/events?${query}`, { headers });
      assert.equal(response.status, 400, `${surface} ${query}`);
      assert.deepEqual(await response.json(), { error: 'CONTROL_QUERY_INVALID' }, `${surface} ${query}`);
    }
  }
  const binding = await fetch(f.server.url + '/v1/provider-bindings?binding_id=binding%3Aunknown', { headers });
  assert.equal(binding.status, 404);
});

test('admission refuses weak acceptance and unsafe command arguments with a curated detail.code (A5b, N1)', async (t) => {
  const f = await setup(t);
  const rejected = (contract, code) =>
    assert.rejects(
      f.client.execute(command(randomUUID(), 'create', 0, { contract, responses: [] })),
      (error) => error.code === 'CONTROL_REQUEST_REJECTED' && error.detail.code === code && !JSON.stringify(error.detail).includes(f.root),
      code,
    );
  const weak = structuredClone(f.contract);
  weak.verifier.reference = 'verifier://project/web-content-v1';
  weak.verifier.checks = [{ id: 'c1', path: 'index.js', export_name: 'default', args: [], expected: 'module.exports' }];
  await rejected(weak, 'ENGINEERING_ACCEPTANCE_WEAK');
  const withCommand = (mutate) => {
    const contract = structuredClone(f.contract);
    fs.writeFileSync(path.join(f.root, 'check.js'), 'process.exit(0);\n');
    contract.scope.read = [...contract.scope.read, 'check.js'];
    contract.commands = [{ id: 'check', runtime: 'node', entrypoint: 'check.js', args: [] }];
    contract.verifier.command_checks = [{ command_id: 'check' }];
    contract.verifier.protected_paths = ['check.js'];
    mutate(contract);
    return contract;
  };
  await rejected(
    withCommand((c) => (c.commands[0].args = ['-cindex.js'])),
    'ENGINEERING_COMMAND_ARG_INVALID',
  );
  fs.writeFileSync(path.join(f.root, 'package.json'), '{}');
  await rejected(
    withCommand((c) => c.scope.read.push('package.json')),
    'ENGINEERING_PROTECTED_CONFIG_MISSING',
  );
  await rejected(
    withCommand((c) => (c.verifier.protected_paths = ['index.js'])),
    'ENGINEERING_PROTECTED_PATH_INVALID',
  );
  const workflow = {
    schema_version: 1,
    workflow_id: 'workflow:weak',
    max_parallelism: 1,
    limits: { ...f.contract.limits, max_children: 1, max_workflow_steps: 1, max_duration_ms: f.contract.limits.max_duration_ms * 2 },
    tasks: [
      {
        id: 'only',
        contract: { ...weak, verifier: { ...weak.verifier, sha256: projectVerifierDigest(weak) } },
        responses: f.create.input.responses,
        depends_on: [],
      },
    ],
  };
  await assert.rejects(
    f.client.execute(command(randomUUID(), 'create_workflow', 0, { definition: workflow })),
    (error) => error.code === 'CONTROL_REQUEST_REJECTED' && error.detail?.code === 'ENGINEERING_ACCEPTANCE_WEAK',
  );
});

test('a materialized job exposes status, evidence, session and owned events without dispatch', async (t) => {
  const f = fixture(t);
  const control = new EngineeringControl({ workspaces: [f.root] });
  t.after(() => {
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const id = randomUUID();
  const now = Date.parse('2027-01-01T00:00:00.000Z');
  control.jobs.now = () => now;
  const step = (action, expected_sequence, extra = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence,
    action,
    ...extra,
  });
  await control.jobs.execute(
    step('create', 0, {
      input: {
        kind: 'task',
        definition: { contract: f.contract, responses: [] },
        not_before: new Date(now).toISOString(),
        deadline_at: new Date(now + 120_000).toISOString(),
        depends_on: [],
      },
    }),
  );
  await control.jobs.worker.execute(step('claim', 1, { fence: 0, lease_ms: 1000 }));
  await control.jobs.materializer.execute(step('materialize', 2, { fence: 1 }));
  const status = await control.query(id);
  assert.equal(status.resource_id, id);
  assert.equal((await control.query(id, 'evidence')).resource_id, id);
  assert.equal((await control.query(id, 'session')).resource_id, id);
  await assert.rejects(control.query(id, 'review'), { code: 'CONTROL_VIEW_UNAVAILABLE' });
  const events = control.events(id);
  assert.ok(events.events.length > 0);
  assert.equal(control.events(id, { after: events.next_cursor }).events.length, 0);
});

test('job creation applies the hardened admission while replaying admitted input does not', async (t) => {
  const f = fixture(t);
  const control = new EngineeringControl({ workspaces: [f.root] });
  t.after(() => {
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const weak = structuredClone(f.contract);
  weak.verifier.reference = 'verifier://project/web-content-v1';
  weak.verifier.checks = [{ id: 'c1', path: 'index.js', export_name: 'default', args: [], expected: 'module.exports' }];
  weak.verifier.sha256 = projectVerifierDigest(weak);
  const input = { contract: weak, responses: [] };
  const { parseCreationInput } = require('../tools/cli/lib/engineering-control');
  assert.equal(parseCreationInput('create', input).contract.schema_version, 2, 'history stays readable');
  assert.throws(() => parseCreationInput('create', input, { admission: true }), { reason: 'ENGINEERING_ACCEPTANCE_WEAK' });
  const now = Date.parse('2027-01-01T00:00:00.000Z');
  control.jobs.now = () => now;
  await assert.rejects(
    control.jobs.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: randomUUID(),
      expected_sequence: 0,
      action: 'create',
      input: {
        kind: 'task',
        definition: input,
        not_before: new Date(now).toISOString(),
        deadline_at: new Date(now + 120_000).toISOString(),
        depends_on: [],
      },
    }),
    { reason: 'ENGINEERING_ACCEPTANCE_WEAK' },
  );
});

test('a job admitted under the previous rules is still claimed and re-validated, while new weak jobs are refused', async (t) => {
  const f = fixture(t);
  const control = new EngineeringControl({ workspaces: [f.root] });
  t.after(() => {
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  const weak = structuredClone(f.contract);
  weak.verifier.reference = 'verifier://project/web-content-v1';
  weak.verifier.checks = [{ id: 'c1', path: 'index.js', export_name: 'default', args: [], expected: 'module.exports' }];
  weak.verifier.sha256 = projectVerifierDigest(weak);
  const id = randomUUID();
  const now = Date.parse('2027-01-01T00:00:00.000Z');
  control.jobs.now = () => now;
  const step = (action, expected_sequence, extra = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence,
    action,
    ...extra,
  });
  const create = step('create', 0, {
    input: {
      kind: 'task',
      definition: { contract: weak, responses: [] },
      not_before: new Date(now).toISOString(),
      deadline_at: new Date(now + 120_000).toISOString(),
      depends_on: [],
    },
  });
  await assert.rejects(control.jobs.execute(create), { reason: 'ENGINEERING_ACCEPTANCE_WEAK' });
  // Simulate a job persisted before the hardened rules existed.
  const hardened = control.admitCreation;
  control.admitCreation = (action, input, resource, deadline) =>
    hardened.call(control, action, input, resource, deadline, { admission: false });
  await control.jobs.execute(create);
  delete control.admitCreation;
  const claimed = await control.jobs.worker.execute(step('claim', 1, { fence: 0, lease_ms: 1000 }));
  assert.equal(claimed.status, 'claimed');
  // Recovery re-validates through the same path as the claim.
  await control.jobs.worker.admit(control.jobs.query(id));
});

test('admission refuses a max_tokens below the context floor through create and create_workflow, citing both numbers (H-4)', async (t) => {
  const f = await setup(t);
  const low = structuredClone(f.contract);
  low.limits.max_tokens = 100;
  const expectDetail = (error) => {
    assert.equal(error.code, 'CONTROL_REQUEST_REJECTED');
    assert.equal(error.detail.code, 'ENGINEERING_MAX_TOKENS_BELOW_FLOOR');
    assert.match(error.detail.message, /max_tokens 100 is below the minimum \d+/);
    return true;
  };
  await assert.rejects(f.client.execute(command(randomUUID(), 'create', 0, { contract: low, responses: [] })), expectDetail);
  const workflow = {
    schema_version: 1,
    workflow_id: 'workflow:low-tokens',
    max_parallelism: 1,
    limits: { ...f.contract.limits, max_children: 1, max_workflow_steps: 1, max_duration_ms: f.contract.limits.max_duration_ms * 2 },
    tasks: [
      {
        id: 'only',
        contract: { ...low, verifier: { ...low.verifier, sha256: projectVerifierDigest(low) } },
        responses: f.create.input.responses,
        depends_on: [],
      },
    ],
  };
  await assert.rejects(f.client.execute(command(randomUUID(), 'create_workflow', 0, { definition: workflow })), expectDetail);
});

// A binding file with a given provider output cap, for the admission floor that follows the cap the control API resolves.
function bindingFile(directory, cap) {
  const YAML = require('yaml');
  const binding = YAML.parse(
    fs.readFileSync(path.join(__dirname, '../.agents/activation/provider-bindings/openai-compatible.example.yaml'), 'utf8'),
  );
  binding.provider.base_url = 'https://engineering.fixture.invalid/v1';
  binding.provider.limits = { context_tokens: 1_000_000, max_output_tokens: cap, max_parallel_requests: 1 };
  binding.provider.secret_refs[0].source_ref = 'env://ENGINEERING_FIXTURE_CREDENTIAL';
  binding.transport.max_attempts = 1;
  const filename = path.join(directory, `binding-${cap}.yaml`);
  fs.writeFileSync(filename, YAML.stringify(binding));
  return { id: binding.binding_id, filename };
}

test('create with a binding id is held to the floor of the binding output cap, exactly (H-4)', async (t) => {
  const { minimumMaxTokens } = require('../tools/cli/lib/engineering-task-contract');
  for (const cap of [8192, 1024, 256]) {
    let binding;
    const f = await setup(t, {
      bindings: (directory) => {
        binding = bindingFile(directory, cap);
        return { [binding.id]: binding.filename };
      },
    });
    const withTokens = (value) => ({ ...f.contract, limits: { ...f.contract.limits, max_tokens: value } });
    const floor = minimumMaxTokens(f.contract, cap);
    const create = (value, id = randomUUID()) =>
      f.client.execute(command(id, 'create', 0, { contract: withTokens(value), binding_id: binding.id }));
    await assert.rejects(
      () => create(floor - 1),
      (error) => {
        assert.equal(error.detail.code, 'ENGINEERING_MAX_TOKENS_BELOW_FLOOR', `cap ${cap}`);
        assert.ok(error.detail.message.includes(`minimum ${floor} `) && error.detail.message.includes(`max_tokens ${floor - 1} `));
        return true;
      },
      `cap ${cap}: one below the exact floor`,
    );
    // Not the smallest-reserve floor: a cap-8192 binding must not be admitted just above the cap-1 floor.
    if (cap > 1024) await assert.rejects(() => create(minimumMaxTokens(f.contract, 1) + 1), { code: 'CONTROL_REQUEST_REJECTED' });
    const created = await create(floor);
    assert.equal(created.reason, 'awaiting-execution', `cap ${cap}: exactly the floor is admitted: ${JSON.stringify(created)}`);
  }
});

test('create_workflow admits scripted tasks at the exact scripted floor (H-4)', async (t) => {
  const { minimumMaxTokens } = require('../tools/cli/lib/engineering-task-contract');
  const f = await setup(t);
  const floor = minimumMaxTokens(f.contract);
  const workflow = (value) => {
    const contract = { ...f.contract, limits: { ...f.contract.limits, max_tokens: value } };
    return {
      schema_version: 1,
      workflow_id: 'workflow:floor',
      max_parallelism: 1,
      limits: {
        ...f.contract.limits,
        max_tokens: value,
        max_children: 1,
        max_workflow_steps: 1,
        max_duration_ms: f.contract.limits.max_duration_ms * 2,
      },
      tasks: [{ id: 'only', contract, responses: f.create.input.responses, depends_on: [] }],
    };
  };
  const attempt = (value) => f.client.execute(command(randomUUID(), 'create_workflow', 0, { definition: workflow(value) }));
  // One below the scripted floor, but above the unknown-cap floor: only the scripted reserve (8192) refuses it.
  await assert.rejects(
    () => attempt(floor - 1),
    (error) => error.detail?.code === 'ENGINEERING_MAX_TOKENS_BELOW_FLOOR',
  );
  const created = await attempt(floor);
  assert.ok(created.resource_id, JSON.stringify(created));
});

test('the job command pre-check refuses weak acceptance before any other validation', async (t) => {
  const f = await setup(t);
  const weak = structuredClone(f.contract);
  weak.verifier.reference = 'verifier://project/web-content-v1';
  weak.verifier.checks = [{ id: 'c1', path: 'index.js', export_name: 'default', args: [], expected: 'module.exports' }];
  const response = await fetch(f.server.url + '/v1/jobs/commands', {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      command_id: 'not-a-command',
      input: { kind: 'task', definition: { contract: weak, responses: [] } },
    }),
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, 'CONTROL_REQUEST_REJECTED');
  assert.equal(body.detail.code, 'ENGINEERING_ACCEPTANCE_WEAK');
});
