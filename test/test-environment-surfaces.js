'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const { fixture } = require('./helpers/engineering-project');
const { projectVerifierDigest } = require('../tools/cli/lib/engineering-project-verifier');
const { EngineeringControl, contextProvenance, executorSignals, rowProvenance } = require('../tools/cli/lib/engineering-control');
const { startControlServer, stripExecutable } = require('../tools/cli/lib/engineering-control-http');
const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { RelationalSessionEventStore } = require('../packages/agent-session-store');
const { ControlClient } = require('../packages/control-sdk');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const { assembler, assemblyInput, declare, openStore, prepareSession, session, source } = require('./fixtures/agent-context-harness');

const executeFile = promisify(execFile);
const credential = 'ephemeral-test-fixture-credential-not-for-installation';
const env = { ...process.env, HSEOS_CONTROL_CREDENTIAL: credential };
const sha = (value) => createHash('sha256').update(value).digest('hex');
const command = (id, action, sequence, input = {}) => ({
  schema_version: 1,
  command_id: randomUUID(),
  resource_id: id,
  action,
  expected_sequence: sequence,
  input,
});

async function setup(t, { acceptance = false } = {}) {
  const f = fixture(t, { files: { 'index.js': 'module.exports = n => n - 1;', 'check.js': 'process.exit(0);' } });
  if (acceptance) {
    f.contract.commands = [{ id: 'check', runtime: 'node', entrypoint: 'check.js', args: [] }];
    f.contract.verifier.command_checks = [{ command_id: 'check' }];
    f.contract.verifier.protected_paths = ['check.js'];
    f.contract.scope.write = ['index.js'];
    f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  }
  const control = new EngineeringControl({ workspaces: [f.root] });
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

async function run(f) {
  const created = await f.client.execute(f.create);
  return f.client.execute(command(f.id, 'resume', created.current_sequence));
}

/** Records a real context v2 session in the task's own ledger file, as the runtime does through the assembler. */
function recordV2Session(f, label) {
  const handle = openExecutionLedgerFileFixture(f.control.location(f.id));
  try {
    const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
    const spec = session(`session:${label}`);
    const turn = prepareSession(store, spec);
    const input = assemblyInput(spec, turn);
    assembler(store).assembleAndRecord({
      ...input,
      references: [declare(source('source://reference-a', 'reference A'), { origin: 'lsp' })],
      memory: [declare({ ...source('memory://note', 'remembered'), priority: 5 }, { origin: 'memory' })],
    });
    return spec.session_id;
  } finally {
    handle.close();
  }
}

test('evidence exposes context provenance and executor signals additively, equal over HTTP, SDK, CLI and Python', async (t) => {
  const f = await setup(t);
  const result = await run(f);
  const evidence = await f.client.query(f.id, 'evidence');
  assert.equal(evidence.verification.result, 'approved');
  assert.equal(evidence.task_result, result.task_result);
  assert.equal(evidence.contract_sha256, result.contract_sha256, 'v1 fields are untouched');
  assert.equal(evidence.context_provenance.context_contract, 'v2');
  assert.ok(evidence.context_provenance.source_refs.length > 0);
  assert.ok(evidence.context_provenance.sources.length >= 3);
  assert.ok(evidence.context_provenance.sources.every((record) => evidence.context_provenance.source_refs.includes(record.source_ref)));
  assert.ok(evidence.context_provenance.sources.every((record) => /^[0-9a-f]{64}$/.test(record.digest)));
  assert.deepEqual(evidence.executor_signals.unknown_signals, ['init', 'rate_limit', 'pids_peak', 'memory_peak_bytes']);
  assert.equal(evidence.executor_signals.init, null);
  assert.equal(evidence.executor_signals.rate_limit, null);
  assert.deepEqual(await f.control.query(f.id, 'evidence'), evidence);
  const provenance = await f.client.provenance(f.id);
  assert.deepEqual(provenance, {
    resource_id: f.id,
    context_provenance: evidence.context_provenance,
    executor_signals: evidence.executor_signals,
  });
  const cli = await executeFile(
    process.execPath,
    ['tools/cli/hseos-cli.js', 'control', 'query', '--url', f.server.url, '--resource', f.id, '--view', 'evidence'],
    { env },
  );
  assert.deepEqual(JSON.parse(cli.stdout), evidence);
  const python = await executeFile(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      "import json,os,sys;sys.path.insert(0,'packages/control-sdk');from hseos_control import ControlClient;c=ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL']);print(json.dumps({'p':c.provenance(sys.argv[2]),'q':c.query(sys.argv[2],'evidence')}))",
      f.server.url,
      f.id,
    ],
    { env },
  );
  const fromPython = JSON.parse(python.stdout);
  assert.deepEqual(fromPython.p, provenance);
  assert.deepEqual(fromPython.q, evidence);
  assert.equal(JSON.stringify(evidence).includes(credential), false);
});

test('a measured acceptance command exposes pids_peak and memory_peak_bytes; init and rate_limit stay declared unknown', async (t) => {
  const f = await setup(t, { acceptance: true });
  const result = await run(f);
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  const { executor_signals: signals } = await f.client.provenance(f.id);
  assert.ok(Number.isSafeInteger(signals.pids_peak) && signals.pids_peak >= 1, JSON.stringify(signals));
  assert.ok(Number.isSafeInteger(signals.memory_peak_bytes) && signals.memory_peak_bytes > 0);
  assert.deepEqual(signals.unknown_signals, ['init', 'rate_limit']);
});

test('executorSignals takes the peak across checks, ignores non-integers and never invents a value', () => {
  const none = executorSignals();
  assert.deepEqual(none.unknown_signals, ['init', 'rate_limit', 'pids_peak', 'memory_peak_bytes']);
  assert.equal(executorSignals({ command_checks: 'x' }).pids_peak, null);
  const nested = executorSignals({
    evidence: {
      command_checks: [
        { pids_peak: 3, memory_peak_bytes: 10 },
        { pids_peak: 7, memory_peak_bytes: null },
        { pids_peak: -1, memory_peak_bytes: 1.5 },
        { pids_peak: '9' },
      ],
    },
  });
  assert.equal(nested.pids_peak, 7);
  assert.equal(nested.memory_peak_bytes, 10);
  assert.deepEqual(nested.unknown_signals, ['init', 'rate_limit']);
  assert.equal(executorSignals({ command_checks: [{ pids_peak: 2 }] }).pids_peak, 2);
});

test('events carry provenance for context v2 and keep the exact v1 shape elsewhere; cursors stay stable', async (t) => {
  const f = await setup(t);
  await run(f);
  const before = await f.client.events(f.id, { limit: 1000 });
  assert.ok(before.events.length > 0);
  const realTagged = before.events.filter((event) => event.provenance);
  assert.ok(realTagged.length > 0, 'the real task assembles context v2');
  assert.ok(realTagged.every((event) => event.provenance.every((record) => /^[0-9a-f]{64}$/.test(record.digest))));
  const sessionId = recordV2Session(f, 'surfaces-v2');
  const all = await f.client.events(f.id, { limit: 1000 });
  const tagged = all.events.filter((event) => event.provenance);
  assert.equal(tagged.length, realTagged.length + 1);
  const recorded = tagged.find((event) => event.provenance.some((record) => record.source_ref === 'source://reference-a'));
  const byRef = new Map(recorded.provenance.map((record) => [record.source_ref, record]));
  assert.deepEqual(Object.keys(byRef.get('source://reference-a')).sort(), ['authority', 'digest', 'origin', 'source_ref', 'trust']);
  assert.equal(byRef.get('source://reference-a').origin, 'lsp');
  assert.equal(byRef.get('source://reference-a').trust, 'untrusted');
  assert.equal(byRef.get('source://reference-a').digest, sha('reference A'));
  assert.equal(byRef.get('memory://note').authority, 'data');
  assert.equal(byRef.get('governance://constitution/a').authority, 'directive');
  assert.equal(JSON.stringify(recorded.provenance).includes('remembered'), false, 'provenance never carries content');
  let after = 0;
  const combined = [];
  while (true) {
    const page = await f.client.events(f.id, { after, limit: 4 });
    combined.push(...page.events);
    if (page.events.length === 0) break;
    after = page.next_cursor;
  }
  assert.deepEqual(combined, all.events);
  const handle = openExecutionLedgerFileFixture(f.control.location(f.id));
  try {
    const ledger = new ExecutionEventLedger(handle.db);
    const provenance = contextProvenance(ledger, sessionId);
    assert.equal(provenance.context_contract, 'v2');
    assert.deepEqual(provenance.sources.map((record) => record.source_ref).sort(), [...byRef.keys()].sort());
    assert.deepEqual(contextProvenance(ledger), { schema_version: 1, context_contract: 'v1', source_refs: [], sources: [] });
    assert.deepEqual(contextProvenance(ledger, 'session:absent'), {
      schema_version: 1,
      context_contract: 'v1',
      source_refs: [],
      sources: [],
    });
  } finally {
    handle.close();
  }
});

test('rowProvenance reads only context.assembled v2 envelopes', () => {
  const { db, store } = openStore();
  try {
    const spec = session('session:row-provenance');
    const turn = prepareSession(store, spec);
    assembler(store).assembleAndRecord({
      ...assemblyInput(spec, turn),
      references: [declare(source('source://r', 'r'), { origin: 'tool' })],
    });
    const ledger = new ExecutionEventLedger(db);
    const rows = ledger.readStream('agent_session', spec.session_id);
    const withSources = rows.map(rowProvenance).filter((list) => list.length > 0);
    assert.equal(withSources.length, 1);
    assert.ok(withSources[0].every((record) => record.digest && record.trust && record.origin && record.authority));
    assert.deepEqual(rowProvenance({ payload: {} }), []);
    assert.deepEqual(rowProvenance(), []);
    assert.deepEqual(rowProvenance({ payload: { session_event_json: '{"event_type":"context.assembled","payload":{}}' } }), []);
    assert.deepEqual(rowProvenance({ payload: { session_event_json: '{"event_type":"x","note":"context.assembled"}' } }), []);
  } finally {
    db.close();
  }
});

test('HTTP never carries functions or code-bearing fields, at any depth', async () => {
  assert.deepEqual(
    stripExecutable({ ok: 1, run: () => 1, inline_code: 'x', nested: [() => 2, { source_code: 'y', keep: [1, null] }], none: null }),
    { ok: 1, nested: [{ keep: [1, null] }], none: null },
  );
  const control = {
    query: async () => ({
      resource_id: 'r',
      handler: () => 'x',
      executable_code: 'process.exit(1)',
      deep: { script_source: 'z', digest: 'd' },
    }),
  };
  const server = await startControlServer({ control, credential });
  try {
    const response = await fetch(`${server.url}/v1/tasks/${randomUUID()}`, { headers: { authorization: `Bearer ${credential}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { resource_id: 'r', deep: { digest: 'd' } });
  } finally {
    await server.close();
  }
});

test('a job carrying inline files is refused over HTTP before any effect', async (t) => {
  const f = await setup(t);
  const contract = { ...f.contract, initial_files: [{ path: 'x.js', content: 'process.exit(0)', sha256: sha('process.exit(0)') }] };
  const response = await fetch(`${f.server.url}/v1/jobs/commands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: randomUUID(),
      action: 'create',
      expected_sequence: 0,
      input: { kind: 'task', definition: { contract, responses: [] } },
    }),
  });
  // Contract validation may refuse the inline files before JOB_INLINE_CODE_DENIED is reached; either way nothing is created.
  assert.equal(response.status, 409);
  assert.ok(['JOB_INLINE_CODE_DENIED', 'CONTROL_REQUEST_REJECTED'].includes((await response.json()).error));
});

test('the SDK exposes every route through the same loopback transport and keeps v1 servers readable', async () => {
  const id = randomUUID();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([init.method, new URL(url).pathname + new URL(url).search]);
    if (url.includes('/fail')) return { ok: false, json: async () => ({ error: 'CONTROL_REQUEST_REJECTED', detail: { code: 'E1' } }) };
    return { ok: true, json: async () => ({ resource_id: id }) };
  };
  const client = new ControlClient({ url: 'http://127.0.0.1:1', credential, fetchImpl });
  await client.bindingInspect('provider:model');
  await client.campaign({});
  await client.job({});
  await client.jobQuery(id);
  await client.jobEvents(id, { after: 1, limit: 2 });
  await client.campaignQuery(id);
  await client.campaignEvents(id);
  await client.campaignEvidence(id, id);
  await client.terminal({});
  await client.terminalQuery(id);
  await client.terminalEvents(id);
  await client.prepare({});
  await client.execute({});
  await client.query(id, 'session');
  await client.events(id);
  assert.equal(seen.length, 15);
  assert.deepEqual(seen[3], ['GET', `/v1/jobs/${id}`]);
  // A v1 server returns evidence without the additive fields: the SDK supplies explicit "none" values.
  assert.deepEqual(await client.provenance(id), {
    resource_id: id,
    context_provenance: { schema_version: 1, context_contract: 'v1', source_refs: [], sources: [] },
    executor_signals: null,
  });
  const failing = new ControlClient({
    url: 'http://127.0.0.1:1',
    credential,
    fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'CONTROL_REQUEST_REJECTED', detail: { code: 'E1' } }) }),
  });
  await assert.rejects(failing.query(id), (error) => error.code === 'CONTROL_REQUEST_REJECTED' && error.detail.code === 'E1');
  const anonymous = new ControlClient({
    url: 'http://127.0.0.1:1',
    credential,
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  await assert.rejects(anonymous.query(id), (error) => error.message === 'CONTROL_REQUEST_FAILED');
  for (const bad of [
    () => client.bindingInspect('Bad'),
    () => client.jobQuery('x'),
    () => client.jobEvents(id, { limit: 0 }),
    () => client.campaignQuery('x'),
    () => client.campaignEvents(id, { after: -1 }),
    () => client.campaignEvidence(id, 'x'),
    () => client.terminalQuery('x'),
    () => client.terminalEvents(id, { limit: 1001 }),
    () => client.query(id, 'nope'),
    () => client.events('x'),
    () => new ControlClient({ url: 'https://example.com', credential }),
    () => new ControlClient({ url: 'http://127.0.0.1:1', credential: 'short' }),
  ])
    assert.throws(bad);
});

test('unknown views and workflow review stay rejected after the evidence extension', async (t) => {
  const f = await setup(t);
  await run(f);
  await assert.rejects(f.control.query(f.id, 'nope'), (error) => error.code === 'CONTROL_QUERY_UNKNOWN');
  const response = await fetch(`${f.server.url}/v1/tasks/${f.id}/evidence?x=1`, { headers: { authorization: `Bearer ${credential}` } });
  assert.equal(response.status, 400);
  assert.ok(path.basename(f.root).length > 0);
});

/** A real context-source extension: its items enter the model context as declared, provenance-carrying sources. */
function contextSourceCatalog(f) {
  const directory = path.join(f.directory, 'plugin');
  fs.mkdirSync(directory);
  const source = 'module.exports=()=>({items:[{id:"note",content:"reference note"}]});';
  const manifest = {
    schema_version: 1,
    id: 'task-extension',
    version: '1.0.0',
    kind: 'context-source',
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
  return {
    selected: {
      directory,
      policy: {
        id: manifest.id,
        version: manifest.version,
        kind: manifest.kind,
        manifest_sha256: sha(canonicalize(manifest)),
        allowed_capabilities: manifest.capabilities,
        limits: manifest.limits,
        contract_version: 1,
      },
      configuration: {
        schema_version: 1,
        name: 'external.read',
        description: 'Read external data',
        capability: 'external.read',
        authority: 'external.read',
        policy_version: 'v1',
        timeout_ms: 3000,
        input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
        initial_input: { text: 'task input' },
      },
      dependencies: [],
    },
  };
}

test('a task with a context-source extension is admitted and keeps its v1 lineage readable without inventing authority', async (t) => {
  const f = fixture(t);
  f.contract.limits.max_tool_calls = 4;
  const control = new EngineeringControl({ workspaces: [f.root], extensionCatalog: contextSourceCatalog(f) });
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
  const created = await client.execute(command(id, 'create', 0, { contract: f.contract, responses: [], extension_ids: ['selected'] }));
  const result = await client.execute(command(id, 'resume', created.current_sequence));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  const { context_provenance: provenance } = await client.provenance(id);
  // The engineering runtime declares authority and provenance for its own sources, so the real task assembles context v2.
  assert.equal(provenance.context_contract, 'v2', JSON.stringify(provenance));
  assert.ok(provenance.source_refs.length > 0 && provenance.source_refs.every((ref) => typeof ref === 'string'));
  assert.ok(provenance.sources.length >= 3 && provenance.sources.every((record) => provenance.source_refs.includes(record.source_ref)));
  assert.ok(
    provenance.sources.every((record) => record.authority && record.origin && record.trust && /^[0-9a-f]{64}$/.test(record.digest)),
  );
  const events = await client.events(id, { limit: 1000 });
  assert.equal(
    events.events.some((event) => event.provenance),
    true,
  );
  assert.equal(JSON.stringify(provenance).includes('reference note'), false);
});

test('a job exposes the same evidence, session and event surfaces as a task', async (t) => {
  const f = await setup(t);
  const jobId = randomUUID();
  const job = {
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: jobId,
    expected_sequence: 0,
    action: 'create',
    input: {
      kind: 'task',
      definition: { contract: f.contract, responses: f.create.input.responses },
      not_before: new Date(Date.now() - 1000).toISOString(),
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
      depends_on: [],
    },
  };
  const queued = await f.client.job(job);
  assert.equal(queued.status, 'queued');
  await f.control.jobs.worker.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: jobId,
    expected_sequence: 1,
    action: 'claim',
    fence: 0,
    lease_ms: 1000,
  });
  const done = await f.client.job({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: jobId,
    expected_sequence: 2,
    action: 'resume',
    input: {},
  });
  assert.equal(done.status, 'succeeded');
  const evidence = await f.client.query(jobId, 'evidence');
  assert.equal(evidence.resource_id, jobId);
  assert.deepEqual(evidence.context_provenance.sources.length > 0 || evidence.context_provenance.context_contract === 'v1', true);
  assert.deepEqual(evidence.executor_signals.unknown_signals.slice(0, 2), ['init', 'rate_limit']);
  assert.equal((await f.client.query(jobId, 'session')).resource_id, jobId);
  await assert.rejects(f.client.query(jobId, 'review'), (error) => error.code === 'CONTROL_VIEW_UNAVAILABLE');
  const events = await f.client.events(jobId, { limit: 1000 });
  assert.ok(events.events.length > 0);
  assert.deepEqual((await f.client.events(jobId, { after: events.next_cursor })).events, []);
});

test('stale sequences and resumed intents are refused with stable codes', async (t) => {
  const f = await setup(t);
  const created = await f.client.execute(f.create);
  await assert.rejects(
    f.client.execute(command(f.id, 'resume', created.current_sequence + 5)),
    (error) => error.code === 'CONTROL_SEQUENCE_CONFLICT',
  );
  await assert.rejects(f.client.execute(command(f.id, 'create', 0, f.create.input)), (error) => error.code === 'CONTROL_SEQUENCE_CONFLICT');
  await assert.rejects(
    f.client.execute(command(f.id, 'resume', created.current_sequence, { reconciliation_decisions: {} })),
    (error) => error.code === 'CONTROL_RECONCILIATION_KIND',
  );
});
