'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const test = require('node:test');
const { fixture } = require('./helpers/engineering-project');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const { pinExecutionPluginSelection } = require('../tools/lib/execution-plugin-selection');
const { createExecutionPluginModel } = require('../tools/cli/lib/execution-plugin-model');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
const { executorOwner } = require('../packages/agent-isolation-attestation/executor');
const { createPluginModelCampaignAdapter } = require('../tools/cli/lib/engineering-plugin-model');
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function setup(t, { source = 'module.exports=()=>({text:"done",tool_calls:[]});', files } = {}) {
  const f = fixture(t, { files });
  const directory = path.join(f.directory, 'plugin');
  fs.mkdirSync(directory);
  const manifest = {
    schema_version: 1,
    id: 'task-model',
    version: '1.0.0',
    kind: 'model-provider',
    compatibility: { contract_version: 1, node_majors: [22, 24] },
    entrypoint: 'entry.cjs',
    files: { 'entry.cjs': sha(source) },
    capabilities: ['generate', 'tool_calls'],
    limits: { timeout_ms: 3000, max_output_bytes: 65_536, memory_max_bytes: 268_435_456, pids_max: 32 },
    dependencies: [],
    conformance: ['entry.cjs'],
  };
  fs.writeFileSync(path.join(directory, 'entry.cjs'), source);
  fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(manifest));
  const configuration = {
    schema_version: 1,
    binding_id: 'local-model',
    model: 'plugin/test',
    models: ['plugin/test'],
    limits: { max_requests: 20, max_input_tokens: 65_536, max_output_tokens: 8192, max_duration_ms: 3000 },
  };
  const catalog = {
    selected: {
      directory,
      policy: {
        id: manifest.id,
        version: manifest.version,
        kind: manifest.kind,
        manifest_sha256: sha(canonicalize(manifest)),
        contract_version: 1,
        allowed_capabilities: manifest.capabilities,
        limits: manifest.limits,
      },
      configuration,
      dependencies: [],
    },
  };
  const selected = pinExecutionPluginSelection(catalog, ['selected']);
  const port = createExecutionPluginModel({ admission: selected.entries[0].admission, ...configuration });
  const resourceId = randomUUID(),
    secondId = randomUUID(),
    campaignId = randomUUID(),
    authorizationId = randomUUID();
  const control = new EngineeringControl({
    workspaces: [f.root],
    extensionCatalog: catalog,
    providerBindings: { 'local-model': port.binding },
    providerAuthorizations: {
      [authorizationId]: {
        max_requests: 20,
        max_cost_microusd: 0,
        deadline: Date.now() + 60_000,
        binding_ids: ['local-model'],
        task_ids: [resourceId, secondId],
      },
    },
  });
  const states = [];
  t.after(async () => {
    await port.close();
    await control.providerCampaigns.shutdown();
    await control.terminals.shutdown();
    const state = control.state;
    control.close();
    for (const value of [...states, state]) fs.rmSync(value, { recursive: true, force: true });
  });
  await control.providerCampaigns.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: 0,
    action: 'create',
    input: { authorization_id: authorizationId },
  });
  let launches = 0;
  const mkdtemp = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', (...args) => {
    if (String(args[0]).includes('hseos-plugin-execution-')) launches++;
    return mkdtemp(...args);
  });
  const command = async (action, input = {}, id = resourceId) =>
    control.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: id,
      expected_sequence: action === 'create' ? 0 : (await control.query(id)).current_sequence,
      action,
      input,
    });
  return {
    ...f,
    catalog,
    configuration,
    port,
    control,
    resourceId,
    secondId,
    campaignId,
    command,
    get launches() {
      return launches;
    },
    async create(id = resourceId, extra = {}) {
      const result = await command(
        'create',
        { contract: f.contract, plugin_model: { selection_id: 'selected', campaign_id: campaignId }, ...extra },
        id,
      );
      states.push(control.location(id));
      return result;
    },
  };
}
function groups() {
  return fs.readdirSync(executorOwner().resource_parent).filter((name) => name.startsWith(`hseos-executor-${process.pid}-`));
}
async function started(f) {
  const until = Date.now() + 5000;
  const parent = executorOwner().resource_parent;
  const populated = () => groups().some((name) => /populated 1/.test(fs.readFileSync(path.join(parent, name, 'cgroup.events'), 'utf8')));
  while (Date.now() < until && (f.launches === 0 || !populated())) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.launches, 1);
  assert.equal(populated(), true);
}

test('create-only pins authorized model identity; resume reserves the original campaign and verifies the task', async (t) => {
  const f = await setup(t);
  const created = await f.create();
  assert.equal(f.launches, 0);
  assert.equal(created.plugin_model.resource_id, f.resourceId);
  assert.equal(Object.hasOwn(created.plugin_model, 'control_identity'), false);
  assert.notEqual(created.task_run_id, f.resourceId);
  const result = await f.command('resume');
  assert.equal(result.task_result, 'approved');
  assert.equal(f.launches, 1);
  const campaign = f.control.providerCampaigns.query(f.campaignId);
  assert.equal(campaign.requests, 1);
  assert.equal(campaign.cancelled, false);
  const receipt = f.control.providerCampaigns.rows(f.campaignId).find((row) => row.payload.kind === 'reserved');
  assert.equal(receipt.payload.task_id, f.resourceId);
  assert.equal((await f.control.query(f.resourceId, 'session')).status, 'completed');
  assert.equal((await f.command('resume')).task_result, 'approved');
  assert.equal(f.launches, 1);
});

test('model tool proposal is executed by the task gateway and independently accepted', async (t) => {
  const before = 'module.exports = (n) => n - 1;\n';
  const after = 'module.exports = (n) => n + 1;\n';
  const source = `module.exports=({input})=>input.messages.some(m=>m.role==='tool')?{text:'done',tool_calls:[]}:{text:'',tool_calls:[{tool_call_id:'call:fix',name:'engineering.patch',input:{path:'index.js',expected_sha256:'${sha(before)}',before:${JSON.stringify(before)},after:${JSON.stringify(after)}}}]};`;
  const f = await setup(t, { source, files: { 'index.js': before } });
  await f.create();
  const result = await f.command('resume');
  assert.equal(result.task_result, 'approved');
  assert.equal(f.launches, 2);
  assert.equal(f.control.providerCampaigns.query(f.campaignId).requests, 2);
  assert.equal(fs.readFileSync(path.join(f.root, 'index.js'), 'utf8'), before);
});

test('public campaign dispatch without a prepared plugin request cannot reserve or execute', async (t) => {
  const f = await setup(t);
  await assert.rejects(
    f.control.providerCampaigns.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.campaignId,
      expected_sequence: f.control.providerCampaigns.rows(f.campaignId).length,
      action: 'run',
      input: { binding_id: 'local-model', task_id: f.resourceId },
    }),
    { code: 'CONTROL_PROVIDER_DISPATCH_DENIED' },
  );
  assert.equal(f.control.providerCampaigns.query(f.campaignId).requests, 0);
  assert.equal(f.launches, 0);
});

test('model ambiguity, unauthorized task and changed association fail before effects', async (t) => {
  const f = await setup(t);
  await assert.rejects(f.create(f.resourceId, { responses: [] }), { code: 'CONTROL_MODEL_CONFLICT' });
  await assert.rejects(f.create(randomUUID()), { code: 'PLUGIN_CAMPAIGN_BINDING_REQUIRED' });
  assert.equal(f.control.rows(f.resourceId).length, 0);
  await f.create();
  await assert.rejects(
    inspectEngineeringTask({
      state: f.control.location(f.resourceId),
      action: 'resume',
      expectedSequence: (await f.control.query(f.resourceId)).current_sequence,
      campaigns: f.control.providerCampaigns,
      extensionCatalog: f.catalog,
      resourceId: f.secondId,
    }),
    { code: 'PLUGIN_TASK_RESOURCE_DRIFT' },
  );
  assert.equal(f.launches, 0);
});

test('task cancellation drains its model without cancelling the shared campaign', async (t) => {
  const f = await setup(t, { source: 'module.exports=()=>new Promise(()=>setInterval(()=>{},100));' });
  await f.create();
  await f.create(f.secondId);
  const pending = f.command('resume');
  await started(f);
  await f.command('cancel');
  assert.equal((await pending).reason, 'cancelled');
  assert.equal(f.control.providerCampaigns.query(f.campaignId).cancelled, false);
  assert.equal((await f.control.query(f.secondId)).reason, 'awaiting-execution');
  assert.deepEqual(groups(), []);
});

test('owner shutdown reaches facade requests and waits for process drain', async (t) => {
  const f = await setup(t, { source: 'module.exports=()=>new Promise(()=>setInterval(()=>{},100));' });
  await f.create();
  const pending = f.command('resume');
  await started(f);
  assert.ok(f.control.providerCampaigns.drains.size > 0);
  assert.throws(() => f.control.close(), { code: 'CONTROL_EXECUTION_ACTIVE' });
  await f.control.providerCampaigns.shutdown();
  const result = await pending;
  assert.notEqual(result.task_result, 'approved');
  assert.deepEqual(groups(), []);
  assert.equal(f.control.providerCampaigns.drains.size, 0);
});

test('malformed model output preserves uncertain reservation and blocks task acceptance', async (t) => {
  const f = await setup(t, { source: 'module.exports=()=>({text:"bad",tool_calls:[{tool_call_id:"bad",name:"undeclared",input:{}}]});' });
  await f.create();
  await assert.rejects(f.command('resume'), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  const state = await f.control.query(f.resourceId);
  assert.equal(state.task_result, 'blocked');
  assert.equal(state.reason, 'reconciliation-required');
  assert.equal(f.control.providerCampaigns.query(f.campaignId).requests, 1);
  assert.equal(f.control.providerCampaigns.query(f.campaignId).unresolved_commands.length, 1);
  await assert.rejects(f.command('resume'), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  assert.equal(f.launches, 1);
});

test('local binding loader inspects only declared selection without starting plugin code', async (t) => {
  const f = await setup(t);
  const loaded = createPluginModelCampaignAdapter({
    manifest: f.port.binding.manifest,
    options: { catalog: f.catalog, selection_id: 'selected' },
  });
  assert.equal(loaded.binding_sha256, f.port.binding.binding_sha256);
  assert.equal(await loaded.adapter.validateDispatch({ task_id: f.resourceId, request_id: randomUUID() }), false);
  assert.equal(f.launches, 0);
  assert.throws(
    () =>
      createPluginModelCampaignAdapter({
        manifest: { ...f.port.binding.manifest, binding_id: 'foreign' },
        options: { catalog: f.catalog, selection_id: 'selected' },
      }),
    { code: 'CONTROL_PROVIDER_BINDING_DRIFT' },
  );
});

test('a new controller restores the same task and campaign; catalog drift never swaps an in-flight selection', async (t) => {
  const f = await setup(t);
  await f.create();
  const drift = structuredClone(f.catalog);
  drift.selected.configuration.model = 'plugin/other';
  const changed = new EngineeringControl({
    state: f.control.state,
    workspaces: [f.root],
    extensionCatalog: drift,
    providerBindings: { 'local-model': f.port.binding },
  });
  try {
    assert.equal((await changed.query(f.resourceId)).reason, 'awaiting-execution');
    await assert.rejects(
      inspectEngineeringTask({
        state: changed.location(f.resourceId),
        action: 'resume',
        expectedSequence: (await changed.query(f.resourceId)).current_sequence,
        extensionCatalog: changed.extensionCatalog,
        campaigns: changed.providerCampaigns,
        resourceId: f.resourceId,
      }),
    );
    assert.equal(f.launches, 0);
  } finally {
    changed.close();
  }
  const restored = new EngineeringControl({
    state: f.control.state,
    workspaces: [f.root],
    extensionCatalog: f.catalog,
    providerBindings: { 'local-model': f.port.binding },
  });
  try {
    const result = await restored.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.resourceId,
      expected_sequence: (await restored.query(f.resourceId)).current_sequence,
      action: 'resume',
      input: {},
    });
    assert.equal(result.task_result, 'approved');
    assert.equal(restored.providerCampaigns.query(f.campaignId).requests, 1);
  } finally {
    restored.close();
  }
});

test('lost campaign receipt keeps model result uncertain without replaying its process', async (t) => {
  const f = await setup(t);
  await f.create();
  const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
  const append = ProviderCampaignControl.prototype.append;
  t.mock.method(ProviderCampaignControl.prototype, 'append', function (id, payload, ...rest) {
    if (id === f.campaignId && payload.kind === 'receipt') throw new Error('receipt write unavailable');
    return append.call(this, id, payload, ...rest);
  });
  await assert.rejects(f.command('resume'), { code: 'PLUGIN_RESULT_UNCERTAIN' });
  const rows = f.control.providerCampaigns.rows(f.campaignId);
  assert.ok(rows.some((row) => row.payload.kind === 'plugin_result'));
  assert.ok(!rows.some((row) => row.payload.kind === 'receipt'));
  assert.equal((await f.control.query(f.resourceId)).task_result, 'blocked');
  await assert.rejects(f.command('resume'), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  assert.equal(f.launches, 1);
});

test('model binding derivation preserves exact manifest, shared lifecycle and denies new authorization', async (t) => {
  const f = await setup(t);
  const derived = f.control.providerCampaigns.withBinding(f.port.binding);
  assert.equal(derived.active, f.control.providerCampaigns.active);
  assert.equal(derived.drains, f.control.providerCampaigns.drains);
  assert.equal(derived.authorizations.size, 0);
  assert.throws(() => derived.withBinding({ ...f.port.binding, manifest: { ...f.port.binding.manifest, binding_id: 'other' } }), {
    code: 'CONTROL_PROVIDER_BINDING_DRIFT',
  });
  await f.control.providerCampaigns.shutdown();
  assert.equal(derived.closing, true);
});

test('task deadline and invalid model pins fail before reserve', async (t) => {
  const f = await setup(t);
  const { prepareTaskPluginModel, parseTaskPluginModel, restoreTaskPluginModel } = require('../tools/cli/lib/engineering-plugin-model');
  const selection = pinExecutionPluginSelection(f.catalog, ['selected']).selection;
  const options = {
    reference: { selection_id: 'selected', campaign_id: f.campaignId },
    selection,
    catalog: f.catalog,
    campaigns: f.control.providerCampaigns,
    resourceId: f.resourceId,
    deadline: Date.now() - 1,
  };
  const expired = prepareTaskPluginModel(options);
  await assert.rejects(expired.connect(), { code: 'PLUGIN_TASK_DEADLINE' });
  await expired.close();
  assert.throws(() => parseTaskPluginModel({ ...expired.pin, model: 'missing' }, selection), { code: 'PLUGIN_TASK_MODEL_INVALID' });
  assert.throws(() => prepareTaskPluginModel({ ...options, campaigns: {} }), { code: 'PLUGIN_CAMPAIGN_BINDING_REQUIRED' });
  assert.throws(() => prepareTaskPluginModel({ ...options, reference: { ...options.reference, selection_id: 'missing' } }), {
    code: 'PLUGIN_TASK_MODEL_INVALID',
  });
  assert.throws(() => restoreTaskPluginModel({ ...options, pin: { ...expired.pin, binding_manifest_sha256: '0'.repeat(64) } }), {
    code: 'PLUGIN_TASK_MODEL_DRIFT',
  });
  assert.equal(f.control.providerCampaigns.query(f.campaignId).requests, 0);
  assert.equal(f.launches, 0);
});

test('same UUIDs and manifests in a different ledger cannot reset the task campaign', async (t) => {
  const f = await setup(t);
  await f.create();
  const opened = f.control.providerCampaigns.rows(f.campaignId).find((row) => row.payload.kind === 'opened').payload;
  const other = new EngineeringControl({
    workspaces: [f.root],
    extensionCatalog: f.catalog,
    providerBindings: { 'local-model': f.port.binding },
    providerAuthorizations: {
      [opened.authorization_id]: {
        max_requests: 20,
        max_cost_microusd: 0,
        deadline: opened.deadline,
        binding_ids: ['local-model'],
        task_ids: [f.resourceId, f.secondId],
      },
    },
  });
  try {
    await other.providerCampaigns.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: f.campaignId,
      expected_sequence: 0,
      action: 'create',
      input: { authorization_id: opened.authorization_id },
    });
    other.append(f.resourceId, { kind: 'registered', resource_kind: 'task', state_directory: f.control.location(f.resourceId) });
    await assert.rejects(
      inspectEngineeringTask({
        state: f.control.location(f.resourceId),
        action: 'resume',
        expectedSequence: (await f.control.query(f.resourceId)).current_sequence,
        extensionCatalog: f.catalog,
        campaigns: other.providerCampaigns,
        resourceId: f.resourceId,
      }),
      { code: 'PLUGIN_TASK_CONTROL_DRIFT' },
    );
    assert.equal(other.providerCampaigns.query(f.campaignId).requests, 0);
    assert.equal(f.control.providerCampaigns.query(f.campaignId).requests, 0);
    assert.equal(f.launches, 0);
  } finally {
    const state = other.state;
    other.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
  const { assertTaskPluginControl } = require('../tools/cli/lib/engineering-plugin-model');
  const pin = {
    ...(await f.control.query(f.resourceId)).plugin_model,
    control_identity: require('../tools/cli/lib/control-configuration').readControlStateIdentity(f.control.state),
  };
  assert.throws(
    () => assertTaskPluginControl({ pin, campaigns: f.control.providerCampaigns, resourceId: f.resourceId, directory: '/wrong' }),
    { code: 'PLUGIN_TASK_RESOURCE_DRIFT' },
  );
});

test('created replay rejects mixed model authority and direct unregistered execution', async (t) => {
  const f = await setup(t);
  const created = await f.create();
  const { runEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
  await assert.rejects(
    runEngineeringTask({
      taskContract: f.filename,
      pluginModel: { selection_id: 'selected', campaign_id: f.campaignId },
      extensionCatalog: f.catalog,
      campaigns: f.control.providerCampaigns,
      resourceId: f.resourceId,
    }),
    { code: 'PLUGIN_TASK_REGISTRATION_REQUIRED' },
  );
  const {
    createExecutionLedgerFileFixture,
    openExecutionLedgerFileFixture,
  } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
  const { EngineeringTaskState } = require('../tools/cli/lib/engineering-task-state');
  const original = openExecutionLedgerFileFixture(f.control.location(f.resourceId));
  const target = createExecutionLedgerFileFixture();
  try {
    const event = new EngineeringTaskState(original.db, created.task_run_id).read().created;
    const task = new EngineeringTaskState(target.db, randomUUID());
    assert.throws(() => task.append({ ...event, responses: [{ name: 'fixture.submit', input: {} }] }, 0), /combine model sources/);
    assert.equal(task.read().version, 0);
  } finally {
    original.close();
    target.cleanup();
  }
});

test('control configuration loads a local plugin binding without an unused binding file or plugin effect', async (t) => {
  const f = await setup(t);
  const { loadControlConfiguration, readControlStateIdentity } = require('../tools/cli/lib/control-configuration');
  const file = path.join(f.directory, 'control-config.json');
  const configuration = {
    workspaces: [f.root],
    extensions: f.catalog,
    provider_control: {
      schema_version: 1,
      ...readControlStateIdentity(f.control.state),
      bindings: { 'local-model': { manifest: f.port.binding.manifest, options: { catalog: f.catalog, selection_id: 'selected' } } },
      authorizations: {},
    },
  };
  fs.writeFileSync(file, JSON.stringify(configuration));
  const loaded = loadControlConfiguration(file, { adapterFactories: { 'execution-plugin-v1': createPluginModelCampaignAdapter } });
  assert.equal(loaded.providerBindings['local-model'].binding_sha256, f.port.binding.binding_sha256);
  assert.equal(f.launches, 0);
});
test('queued job pins model selection and original campaign without a launch or reservation', async (t) => {
  const f = await setup(t);
  const job = {
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.resourceId,
    expected_sequence: 0,
    action: 'create',
    input: {
      kind: 'task',
      definition: { contract: f.contract, plugin_model: { selection_id: 'selected', campaign_id: f.campaignId } },
      not_before: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 30_000).toISOString(),
      depends_on: [],
    },
  };
  const before = f.control.providerCampaigns.events(f.campaignId);
  const created = await f.control.jobs.execute(job);
  assert.equal(f.launches, 0);
  assert.deepEqual(f.control.providerCampaigns.events(f.campaignId), before);
  assert.equal(created.admission.plugin_model.resource_id, f.resourceId);
  assert.deepEqual(f.control.rows(f.resourceId), []);
  const second = new EngineeringControl({ state: f.control.state });
  try {
    assert.deepEqual(second.jobs.query(f.resourceId), created);
  } finally {
    second.close();
  }
  const { jobDigest } = require('../tools/lib/job-contract');
  for (const mutate of [
    (a) => {
      a.plugin_model.resource_id = randomUUID();
    },
    (a) => {
      a.plugin_model.campaign_id = randomUUID();
    },
    (a) => {
      a.selection.selection_sha256 = '0'.repeat(64);
    },
  ]) {
    const rows = f.control.jobs.rows(f.resourceId);
    mutate(rows[0].payload.admission);
    rows[0].payload.admission_sha256 = jobDigest(rows[0].payload.admission);
    assert.throws(() => f.control.jobs.project(f.resourceId, rows));
  }
});
test('job claim consults original campaign without reserving and rejects cancellation before claim', async (t) => {
  const f = await setup(t);
  const jobs = f.control.jobs;
  const create = async (id) =>
    jobs.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: id,
      expected_sequence: 0,
      action: 'create',
      input: {
        kind: 'task',
        definition: { contract: f.contract, plugin_model: { selection_id: 'selected', campaign_id: f.campaignId } },
        not_before: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 30_000).toISOString(),
        depends_on: [],
      },
    });
  const claim = (id) =>
    jobs.worker.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: id,
      expected_sequence: 1,
      fence: 0,
      action: 'claim',
      lease_ms: 1000,
    });
  await create(f.resourceId);
  const before = f.control.providerCampaigns.events(f.campaignId);
  assert.equal((await claim(f.resourceId)).status, 'claimed');
  const prepared = await jobs.materializer.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.resourceId,
    expected_sequence: 2,
    fence: 1,
    action: 'materialize',
  });
  assert.equal(prepared.materialization.phase, 'ready');
  assert.equal(prepared.materialization.plan.tasks[0].created.plugin_model.campaign_id, f.campaignId);
  assert.deepEqual(f.control.providerCampaigns.events(f.campaignId), before);
  assert.equal(f.launches, 0);
  await create(f.secondId);
  await f.control.providerCampaigns.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: f.campaignId,
    expected_sequence: f.control.providerCampaigns.query(f.campaignId).current_sequence,
    action: 'cancel',
    input: {},
  });
  await assert.rejects(claim(f.secondId), { code: 'CONTROL_CAMPAIGN_CANCELLED' });
  assert.equal(jobs.query(f.secondId).status, 'queued');
  assert.equal(f.launches, 0);
});
