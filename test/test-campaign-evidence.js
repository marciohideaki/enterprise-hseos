'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash, randomUUID } = require('node:crypto');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
const { startControlServer } = require('../tools/cli/lib/engineering-control-http');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const { ControlClient } = require('../packages/control-sdk');
const { manifest } = require('./helpers/provider-control');
const { fixture } = require('./helpers/engineering-project');
const vectors = require('./fixtures/campaign-credential-vectors');
const claudeAccount = require('./helpers/claude-account');

const executeFile = promisify(execFile);
const credential = 'ephemeral-test-fixture-credential-not-for-installation';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const PLAN = [
  {
    name: 'engineering.patch',
    input: { path: 'index.js', expected_sha256: sha('module.exports = n => n - 1;'), before: 'n - 1', after: 'n + 1' },
  },
];

const legacy = () => ({
  status: 'completed',
  binding_sha256: 'a'.repeat(64),
  evidence_sha256: 'f'.repeat(64),
  cost_microusd: 100,
  input_tokens: 20,
  output_tokens: 4,
});

function answer(text, overrides = {}) {
  const buffer = Buffer.from(text, 'utf8');
  return {
    status: 'completed',
    binding_sha256: 'a'.repeat(64),
    evidence_sha256: sha(`attested:${text}`),
    cost_microusd: 100,
    input_tokens: 20,
    output_tokens: 4,
    evidence_ref: { schema_version: 1, kind: 'model_output', sha256: sha(buffer), bytes: buffer.length },
    output_text: text,
    ...overrides,
  };
}

async function setup(t, { respond = () => answer(JSON.stringify(PLAN)), registerEvidence = true } = {}) {
  const f = fixture(t, { files: { 'index.js': 'module.exports = n => n - 1;' } });
  const control = new EngineeringControl({ workspaces: [f.root] });
  const value = manifest();
  const taskId = randomUUID(),
    authorizationId = randomUUID(),
    campaignId = randomUUID();
  const contract = { ...f.contract, task_id: taskId };
  let calls = 0;
  const observed = {
    binding_sha256: value.binding_sha256,
    artifact_sha256: value.artifact_sha256,
    provider_version: value.provider_version,
    account_sha256: value.authentication.account_sha256,
    authenticated: true,
    auth_source: 'explicit',
    observed_at: Date.now(),
    expires_at: Date.now() + 60_000,
    quota_remaining_requests: 3,
    competing_credentials: false,
  };
  const configured = {
    manifest: value,
    binding_sha256: value.binding_sha256,
    adapter: {
      inspect: async () => ({ ...observed, observed_at: Date.now() }),
      run: async (input) => {
        calls++;
        return respond(input);
      },
    },
  };
  const authorizations = {
    [authorizationId]: {
      max_requests: 3,
      max_cost_microusd: 5000,
      deadline: Date.now() + 120_000,
      binding_ids: [value.binding_id],
      task_ids: [taskId],
    },
  };
  const campaigns = new ProviderCampaignControl(control, { [value.binding_id]: configured }, { authorizations });
  control.providerCampaigns = campaigns;
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
  const command = (action, input = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: campaigns.rows(campaignId).length,
    action,
    input,
  });
  await client.campaign(command('create', { authorization_id: authorizationId }));
  const dispatch = async () => {
    const run = command('run', { binding_id: value.binding_id, task_id: taskId });
    await client.campaign(run);
    return run.command_id;
  };
  const taskCreate = (commandId, extra = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: randomUUID(),
    expected_sequence: 0,
    action: 'create',
    input: {
      contract,
      responses_from: { ref: `campaign://${campaignId}/${commandId}`, binding_sha256: value.binding_sha256 },
      ...extra,
    },
  });
  return {
    ...f,
    contract,
    control,
    campaigns,
    server,
    client,
    campaignId,
    command,
    dispatch,
    taskCreate,
    value,
    calls: () => calls,
    observed,
  };
}

const evidenceFile = (f, commandId) => {
  const ref = f.campaigns.rows(f.campaignId).find((r) => r.payload.kind === 'receipt' && r.payload.command_id === commandId).payload
    .receipt.evidence_ref;
  return path.join(f.control.state, 'campaign-evidence', ref.sha256);
};

test('a completed campaign output is recoverable and hash-verified through control, HTTP, JS SDK, Python SDK and CLI', async (t) => {
  const f = await setup(t);
  const commandId = await f.dispatch();
  const text = JSON.stringify(PLAN);
  const viaClient = await f.client.campaignEvidence(f.campaignId, commandId);
  assert.equal(viaClient.text, text);
  assert.equal(viaClient.evidence_sha256, sha(text));
  assert.equal(viaClient.bytes, Buffer.byteLength(text));
  assert.equal(viaClient.binding_sha256, f.value.binding_sha256);
  assert.equal(viaClient.command_id, commandId);
  assert.deepEqual(f.campaigns.evidence(f.campaignId, commandId), viaClient);
  const receipt = f.campaigns.rows(f.campaignId).find((r) => r.payload.kind === 'receipt').payload.receipt;
  assert.equal(viaClient.receipt_sha256, engineeringDigest(receipt));
  assert.equal(JSON.stringify(f.campaigns.events(f.campaignId).events).includes('n + 1'), false, 'events never carry the artifact text');
  const env = { ...process.env, HSEOS_CONTROL_CREDENTIAL: credential };
  const cli = await executeFile(
    process.execPath,
    ['tools/cli/hseos-cli.js', 'control', 'campaign-evidence', '--url', f.server.url, '--resource', f.campaignId, '--command', commandId],
    { env },
  );
  assert.deepEqual(JSON.parse(cli.stdout), viaClient);
  const python = await executeFile(
    '/usr/bin/python3',
    [
      '-B',
      '-c',
      "import json,os,sys;sys.path.insert(0,'packages/control-sdk');from hseos_control import ControlClient;print(json.dumps(ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL']).campaign_evidence(sys.argv[2],sys.argv[3])))",
      f.server.url,
      f.campaignId,
      commandId,
    ],
    { env },
  );
  assert.deepEqual(JSON.parse(python.stdout), viaClient);
  assert.throws(() => f.client.campaignEvidence('x', commandId), /Invalid campaign evidence query/);
  const raw = await fetch(`${f.server.url}/v1/provider-campaigns/${f.campaignId}/evidence`, {
    headers: { authorization: `Bearer ${credential}` },
  });
  assert.equal(raw.status, 400);
});

test('a v2 task consumes campaign:// output with registered provenance and no new dispatch or budget', async (t) => {
  const f = await setup(t);
  const commandId = await f.dispatch();
  const before = f.campaigns.query(f.campaignId);
  const create = f.taskCreate(commandId);
  const created = await f.client.execute(create);
  assert.deepEqual(await f.client.execute(create), created, 'idempotent replay');
  const source = created.response_source;
  assert.equal(source.ref, `campaign://${f.campaignId}/${commandId}`);
  assert.equal(source.resource_id, f.campaignId);
  assert.equal(source.command_id, commandId);
  assert.equal(source.binding_sha256, f.value.binding_sha256);
  assert.equal(source.evidence_sha256, sha(JSON.stringify(PLAN)));
  assert.match(source.receipt_sha256, /^[a-f0-9]{64}$/);
  const result = await f.client.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: create.resource_id,
    expected_sequence: created.current_sequence,
    action: 'resume',
    input: {},
  });
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  const evidence = await f.client.query(create.resource_id, 'evidence');
  assert.deepEqual(evidence.response_source, source);
  assert.equal(f.calls(), 1, 'consuming the output never dispatches again');
  const after = f.campaigns.query(f.campaignId);
  assert.equal(after.requests, before.requests);
  assert.equal(after.committed_microusd, before.committed_microusd);
  assert.equal(after.current_sequence, before.current_sequence);
});

test('scripted responses still work and cannot be combined with a campaign source', async (t) => {
  const f = await setup(t, { respond: legacy });
  const commandId = await f.dispatch();
  const mixed = f.taskCreate(commandId, { responses: PLAN });
  await assert.rejects(f.client.execute(mixed), { message: /CONTROL_MODEL_CONFLICT/ });
  const scripted = { ...f.taskCreate(commandId), input: { contract: f.contract, responses: PLAN } };
  const created = await f.client.execute(scripted);
  assert.equal(created.response_source, undefined);
});

test('fenced JSON plans are accepted and malformed outputs are rejected before any task exists', async (t) => {
  const plan = JSON.stringify(PLAN);
  let text = `\`\`\`json\n${plan}\n\`\`\``;
  const f = await setup(t, { respond: () => answer(text) });
  const fenced = await f.dispatch();
  assert.equal((await f.client.execute(f.taskCreate(fenced))).response_source.command_id, fenced);
  text = 'I would patch index.js by changing n - 1 to n + 1.';
  const prose = await f.dispatch();
  const create = f.taskCreate(prose);
  await assert.rejects(f.client.execute(create), { message: /CONTROL_CAMPAIGN_EVIDENCE_INVALID/ });
  assert.equal(f.control.rows(create.resource_id).length, 0);
});

test('tampered, missing and foreign-binding artifacts fail closed', async (t) => {
  const f = await setup(t);
  const commandId = await f.dispatch();
  const file = evidenceFile(f, commandId);
  const original = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.from(original.toString().replace('n + 1', 'n + 2')));
  assert.throws(() => f.campaigns.evidence(f.campaignId, commandId), { code: 'CONTROL_CAMPAIGN_EVIDENCE_CORRUPT' });
  await assert.rejects(f.client.campaignEvidence(f.campaignId, commandId), { message: /CONTROL_CAMPAIGN_EVIDENCE_CORRUPT/ });
  const create = f.taskCreate(commandId);
  await assert.rejects(f.client.execute(create), { message: /CONTROL_CAMPAIGN_EVIDENCE_CORRUPT/ });
  assert.equal(f.control.rows(create.resource_id).length, 0);
  fs.writeFileSync(file, original.subarray(0, 10));
  assert.throws(() => f.campaigns.evidence(f.campaignId, commandId), { code: 'CONTROL_CAMPAIGN_EVIDENCE_CORRUPT' });
  fs.rmSync(file);
  assert.throws(() => f.campaigns.evidence(f.campaignId, commandId), { code: 'CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE' });
  fs.writeFileSync(file, original);
  assert.equal(f.campaigns.evidence(f.campaignId, commandId).text, original.toString());
  const foreign = f.taskCreate(commandId);
  foreign.input.responses_from.binding_sha256 = 'e'.repeat(64);
  await assert.rejects(f.client.execute(foreign), { message: /CONTROL_CAMPAIGN_BINDING_MISMATCH/ });
  const forged = f.taskCreate(commandId);
  forged.input.responses_from.ref = `campaign://${randomUUID()}/${commandId}`;
  await assert.rejects(f.client.execute(forged), { message: /CONTROL_CAMPAIGN_NOT_FOUND/ });
  await assert.rejects(f.client.campaignEvidence(f.campaignId, randomUUID()), { message: /CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE/ });
  const symlinked = path.join(path.dirname(file), 'moved');
  fs.renameSync(file, symlinked);
  fs.symlinkSync(symlinked, file);
  assert.throws(() => f.campaigns.evidence(f.campaignId, commandId), { code: 'CONTROL_CAMPAIGN_EVIDENCE_CORRUPT' });
});

test('in-flight, uncertain and reconciled dispatches expose no evidence', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let mode = 'hold';
  const f = await setup(t, {
    respond: async () => {
      if (mode === 'hold') await gate;
      if (mode === 'lose') throw new Error('lost receipt');
      return answer(JSON.stringify(PLAN));
    },
  });
  const run = f.command('run', { binding_id: f.value.binding_id, task_id: f.campaigns.rows(f.campaignId)[0].payload.task_ids[0] });
  const pending = f.client.campaign(run);
  while (f.calls() === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.throws(() => f.campaigns.evidence(f.campaignId, run.command_id), { code: 'CONTROL_CAMPAIGN_NOT_COMPLETED' });
  release();
  await pending;
  assert.equal(f.campaigns.evidence(f.campaignId, run.command_id).text, JSON.stringify(PLAN));
  mode = 'lose';
  const lost = f.command('run', { binding_id: f.value.binding_id, task_id: run.input.task_id });
  await assert.rejects(f.client.campaign(lost), { message: /CONTROL_OUTCOME_UNCERTAIN/ });
  assert.throws(() => f.campaigns.evidence(f.campaignId, lost.command_id), { code: 'CONTROL_CAMPAIGN_EVIDENCE_REJECTED' });
  const report = f.campaigns.query(f.campaignId);
  await f.client.campaign(f.command('reconcile', { report_sha256: report.report_sha256, answer: 'observed provider state; no retry' }));
  assert.throws(() => f.campaigns.evidence(f.campaignId, lost.command_id), { code: 'CONTROL_CAMPAIGN_EVIDENCE_REJECTED' });
  await assert.rejects(f.client.execute(f.taskCreate(lost.command_id)), { message: /CONTROL_CAMPAIGN_EVIDENCE_REJECTED/ });
});

test('oversized, mismatched and credential-bearing outputs invalidate the receipt instead of being stored', async (t) => {
  const huge = 'x'.repeat(65_537);
  const cases = [
    answer(huge, { evidence_ref: { schema_version: 1, kind: 'model_output', sha256: sha(huge), bytes: 65_537 } }),
    answer('first', { output_text: 'second' }),
    answer('ok', { output_text: undefined }),
    answer(vectors.OPENSSH_PRIVATE_KEY),
    answer(vectors.ANTHROPIC_TOKEN_TEXT),
  ];
  for (const [i, receipt] of cases.entries()) {
    const f = await setup(t, { respond: () => receipt });
    const run = f.command('run', { binding_id: f.value.binding_id, task_id: f.campaigns.rows(f.campaignId)[0].payload.task_ids[0] });
    await assert.rejects(f.campaigns.execute(run), { code: 'CONTROL_OUTCOME_UNCERTAIN' }, `case ${i}`);
    assert.throws(() => f.campaigns.evidence(f.campaignId, run.command_id), { code: 'CONTROL_CAMPAIGN_EVIDENCE_REJECTED' });
    assert.equal(fs.existsSync(path.join(f.control.state, 'campaign-evidence')), false, `case ${i}`);
  }
});

test('receipts recorded before evidence retention remain readable and report the artifact as unavailable', async (t) => {
  const f = await setup(t, { respond: legacy });
  const commandId = await f.dispatch();
  assert.equal(f.campaigns.query(f.campaignId).requests, 1);
  assert.throws(() => f.campaigns.evidence(f.campaignId, commandId), { code: 'CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE' });
  await assert.rejects(f.client.execute(f.taskCreate(commandId)), { message: /CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE/ });
});

test('a campaign source cannot be used to create jobs', async (t) => {
  const f = await setup(t, { respond: legacy });
  const commandId = await f.dispatch();
  const create = f.taskCreate(commandId);
  await assert.rejects(
    f.client.job({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: randomUUID(),
      expected_sequence: 0,
      action: 'create',
      input: {
        kind: 'task',
        definition: create.input,
        not_before: new Date(Date.now() - 1000).toISOString(),
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
        depends_on: [],
      },
    }),
    { message: /JOB_RESPONSES_SOURCE_DENIED/ },
  );
});

test('output is bound to the consuming task and can feed only one resource', async (t) => {
  const f = await setup(t);
  const commandId = await f.dispatch();
  const other = { ...f.taskCreate(commandId) };
  other.input = { ...other.input, contract: { ...f.contract, task_id: 'another-task' } };
  await assert.rejects(f.client.execute(other), { message: /CONTROL_CAMPAIGN_TASK_MISMATCH/ });
  assert.equal(f.control.rows(other.resource_id).length, 0);
  const first = f.taskCreate(commandId);
  const created = await f.client.execute(first);
  assert.equal(created.response_source.task_id, f.contract.task_id);
  assert.deepEqual(await f.client.execute(first), created, 'same command replays');
  await assert.rejects(f.client.execute(f.taskCreate(commandId)), { message: /CONTROL_CAMPAIGN_EVIDENCE_CONSUMED/ });
  const claim = f.control.ledger.readStream('control_campaign_evidence', commandId);
  assert.equal(claim.length, 1);
  assert.equal(claim[0].payload.consumer_id, first.resource_id);
  assert.equal(claim[0].payload.contract_sha256, engineeringDigest(f.contract));
});

test('withheld outputs keep the paid dispatch valid and reads fail explicitly', async (t) => {
  for (const reason of ['too_large', 'credential_pattern', 'integrity_mismatch']) {
    const f = await setup(t, { respond: () => ({ ...legacy(), evidence_withheld: reason }) });
    const commandId = await f.dispatch();
    assert.equal(f.campaigns.query(f.campaignId).unresolved_commands.length, 0);
    assert.throws(() => f.campaigns.evidence(f.campaignId, commandId), { code: 'CONTROL_CAMPAIGN_EVIDENCE_WITHHELD' });
    await assert.rejects(f.client.campaignEvidence(f.campaignId, commandId), { message: /CONTROL_CAMPAIGN_EVIDENCE_WITHHELD/ });
    await assert.rejects(f.client.execute(f.taskCreate(commandId)), { message: /CONTROL_CAMPAIGN_EVIDENCE_WITHHELD/ });
  }
  const contradictory = await setup(t, { respond: () => ({ ...answer('x'), evidence_withheld: 'too_large' }) });
  await assert.rejects(contradictory.dispatch(), { message: /CONTROL_OUTCOME_UNCERTAIN/ });
});

test('credential filter covers common token shapes and known secret values without flagging plain plans', () => {
  const { containsCredential } = require('../tools/cli/lib/campaign-evidence-store');
  for (const text of vectors.FLAGGED) assert.equal(containsCredential(`context ${text} trailing`), true, text);
  assert.equal(containsCredential(JSON.stringify(PLAN)), false);
  for (const benign of vectors.BENIGN) assert.equal(containsCredential(benign), false, benign);
  assert.equal(containsCredential('contains known-value-12345 here', ['known-value-12345']), true);
  assert.equal(containsCredential('short abc', ['abc']), false, 'too-short known values are ignored');
});

test('a truncated artifact left by a crash is replaced atomically and recorded', async (t) => {
  const f = await setup(t);
  const text = JSON.stringify(PLAN);
  const directory = path.join(f.control.state, 'campaign-evidence');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, sha(text)), text.slice(0, 5));
  const commandId = await f.dispatch();
  assert.equal(f.campaigns.evidence(f.campaignId, commandId).text, text);
  const rows = f.campaigns.rows(f.campaignId);
  assert.equal(rows.filter((r) => r.payload.kind === 'evidence_repaired' && r.payload.command_id === commandId).length, 1);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.startsWith('.tmp-')),
    [],
  );
  const again = await f.dispatch();
  assert.equal(f.campaigns.evidence(f.campaignId, again).text, text, 'identical content is accepted without a second repair');
  assert.equal(f.campaigns.rows(f.campaignId).filter((r) => r.payload.kind === 'evidence_repaired').length, 1);
});

test('a failed creation can be retried by the same task but not taken over once registered or by another contract', async (t) => {
  const f = await setup(t);
  const commandId = await f.dispatch();
  const claimed = f.taskCreate(commandId);
  f.campaigns.resolveResponses(claimed.input.responses_from, { task_id: f.contract.task_id });
  const digest = engineeringDigest(f.contract);
  f.campaigns.claimEvidence(commandId, claimed.resource_id, f.contract.task_id, digest);
  // The first resource never registered: the same task and contract may retry under a new resource.
  const retry = f.taskCreate(commandId);
  const created = await f.client.execute(retry);
  assert.equal(created.response_source.command_id, commandId);
  const claims = f.control.ledger.readStream('control_campaign_evidence', commandId);
  assert.deepEqual(
    claims.map((row) => row.payload.consumer_id),
    [claimed.resource_id, retry.resource_id],
  );
  // Once a resource registered, nobody else (nor a different contract digest) can reuse the output.
  assert.throws(() => f.campaigns.claimEvidence(commandId, randomUUID(), f.contract.task_id, digest), {
    code: 'CONTROL_CAMPAIGN_EVIDENCE_CONSUMED',
  });
  assert.throws(() => f.campaigns.claimEvidence(commandId, retry.resource_id, f.contract.task_id, 'e'.repeat(64)), {
    code: 'CONTROL_CAMPAIGN_EVIDENCE_CONSUMED',
  });
});

test('store handles directory targets, partial writes and failed renames explicitly', async (t) => {
  const { storeEvidence } = require('../tools/cli/lib/campaign-evidence-store');
  const state = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hseos-evidence-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const text = 'plan';
  const ref = { schema_version: 1, kind: 'model_output', sha256: sha(text), bytes: 4 };
  const directory = path.join(state, 'campaign-evidence');
  fs.mkdirSync(path.join(directory, ref.sha256), { recursive: true });
  assert.throws(() => storeEvidence(state, text, ref), { code: 'CONTROL_CAMPAIGN_EVIDENCE_CORRUPT' });
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.startsWith('.tmp-')),
    [],
  );
  fs.rmdirSync(path.join(directory, ref.sha256));
  assert.deepEqual(storeEvidence(state, text, ref), { repaired: false });
});

// claude/account feeds the same retention path: fake CLI output -> adapter receipt -> store -> campaign:// consumer.
async function claudeReceipt(t, answerText) {
  const c = claudeAccount.setup(t, { mode: { answer: answerText } });
  const { adapter } = c.create();
  return async (input) => ({
    ...(await adapter.run({ task_id: c.id, signal: input.signal ?? new AbortController().signal })),
    binding_sha256: 'a'.repeat(64),
  });
}

test('claude/account output is retained, recoverable and consumable by a campaign:// task', async (t) => {
  const f = await setup(t, { respond: await claudeReceipt(t, JSON.stringify(PLAN)) });
  const commandId = await f.dispatch();
  const stored = f.campaigns.evidence(f.campaignId, commandId);
  assert.equal(stored.output_text ?? stored.text, JSON.stringify(PLAN));
  const create = f.taskCreate(commandId);
  const created = await f.client.execute(create);
  assert.equal(created.response_source.evidence_sha256, sha(JSON.stringify(PLAN)));
  const result = await f.client.execute({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: create.resource_id,
    expected_sequence: created.current_sequence,
    action: 'resume',
    input: {},
  });
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
});

test('claude/account output carrying a credential or exceeding the cap is withheld, not stored', async (t) => {
  for (const [text, reason] of [
    [`token ghp_${'a1B2c3D4e5'.repeat(4)}`, 'credential_pattern'],
    ['x'.repeat(70_000), 'too_large'],
  ]) {
    const f = await setup(t, { respond: await claudeReceipt(t, text) });
    const commandId = await f.dispatch();
    assert.equal(f.campaigns.query(f.campaignId).unresolved_commands.length, 0);
    assert.throws(() => f.campaigns.evidence(f.campaignId, commandId), { code: 'CONTROL_CAMPAIGN_EVIDENCE_WITHHELD' });
    const receipt = f.campaigns.rows(f.campaignId).find((r) => r.payload.kind === 'receipt').payload.receipt;
    assert.equal(receipt.evidence_withheld, reason);
  }
});
