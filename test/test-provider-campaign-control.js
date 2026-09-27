'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { ProviderCampaignControl } = require('../tools/cli/lib/provider-campaign-control');
const { manifest } = require('./helpers/provider-control');

async function fixture(t, options = {}) {
  const control = new EngineeringControl();
  t.after(() => {
    control.close();
    control.handle.cleanup();
  });
  const taskId = randomUUID(),
    authorizationId = randomUUID(),
    id = randomUUID();
  const value = manifest();
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
  const receipt = {
    status: 'completed',
    binding_sha256: value.binding_sha256,
    evidence_sha256: 'f'.repeat(64),
    cost_microusd: 100,
    input_tokens: 20,
    output_tokens: 4,
  };
  const configured = {
    manifest: value,
    binding_sha256: value.binding_sha256,
    adapter: {
      inspect: async () => ({ ...observed, observed_at: Date.now() }),
      run: async (input) => {
        calls++;
        return options.run ? options.run(input) : receipt;
      },
    },
  };
  const authorizations = {
    [authorizationId]: {
      max_requests: 3,
      max_cost_microusd: options.maxCost ?? 1100,
      deadline: Date.now() + 60_000,
      binding_ids: [value.binding_id],
      task_ids: [taskId],
    },
  };
  const campaigns = new ProviderCampaignControl(control, { [value.binding_id]: configured }, { authorizations });
  control.providerCampaigns = campaigns;
  const command = (action, input = {}, resourceId = id) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: resourceId,
    expected_sequence: campaigns.rows(resourceId).length,
    action,
    input,
  });
  await campaigns.execute(command('create', { authorization_id: authorizationId }));
  return { control, campaigns, command, id, taskId, authorizationId, authorizations, configured, observed, receipt, calls: () => calls };
}

test('campaign reserves before dispatch, replays receipts and preserves consumption after reopening', async (t) => {
  const f = await fixture(t);
  const command = f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId });
  const result = await f.campaigns.execute(command);
  assert.deepEqual(await f.campaigns.execute(command), result);
  assert.equal(f.calls(), 1);
  const second = new ProviderCampaignControl(f.control, { [f.configured.manifest.binding_id]: f.configured });
  assert.equal(second.query(f.id).committed_microusd, 100);
  await second.execute(f.command('run', command.input));
  assert.equal(second.query(f.id).committed_microusd, 200);
  await assert.rejects(second.execute(f.command('run', command.input)), { code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED' });
  assert.equal(f.calls(), 2);
  await assert.rejects(f.campaigns.execute({ ...command, input: { ...command.input, task_id: randomUUID() } }), {
    code: 'CONTROL_IDEMPOTENCY_CONFLICT',
  });
});

test('a new campaign identity cannot reuse authorization or manufacture a larger budget', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.campaigns.execute(f.command('create', { authorization_id: f.authorizationId }, randomUUID())), {
    code: 'CONTROL_CAMPAIGN_AUTHORIZATION_USED',
  });
  await assert.rejects(f.campaigns.execute(f.command('create', { authorization_id: randomUUID() }, randomUUID())), {
    code: 'CONTROL_CAMPAIGN_AUTHORIZATION_REQUIRED',
  });
  await assert.rejects(
    f.campaigns.execute(f.command('create', { authorization_id: f.authorizationId, max_cost_microusd: 99_999 }, randomUUID())),
  );
  await assert.rejects(f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: randomUUID() })), {
    code: 'CONTROL_CAMPAIGN_SCOPE_DENIED',
  });
  assert.equal(f.calls(), 0);
});

test('ambiguous credentials, logout, expired observations and unavailable quota cannot dispatch', async (t) => {
  const f = await fixture(t);
  const baseline = { ...f.observed };
  for (const [change, code] of [
    [{ competing_credentials: true }, 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED'],
    [{ authenticated: false }, 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED'],
    [{ account_sha256: 'e'.repeat(64) }, 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED'],
    [{ auth_source: 'another-source' }, 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED'],
    [{ expires_at: 1 }, 'CONTROL_PROVIDER_OBSERVATION_EXPIRED'],
    [{ quota_remaining_requests: null }, 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE'],
    [{ quota_remaining_requests: 0 }, 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE'],
    [{ artifact_sha256: 'e'.repeat(64) }, 'CONTROL_PROVIDER_BINDING_DRIFT'],
  ]) {
    Object.assign(f.observed, baseline, change);
    await assert.rejects(f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId })), {
      code,
    });
  }
  assert.equal(f.calls(), 0);
  assert.equal(f.campaigns.query(f.id).requests, 0);
});

test('receipt loss preserves the reservation and requires current-state reconciliation without retry', async (t) => {
  const f = await fixture(t, {
    run: async () => {
      throw new Error('lost receipt');
    },
  });
  const command = f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId });
  await assert.rejects(f.campaigns.execute(command), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  await assert.rejects(f.campaigns.execute(command), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  assert.equal(f.calls(), 1);
  const report = f.campaigns.query(f.id);
  assert.equal(report.committed_microusd, 1000);
  await assert.rejects(f.campaigns.execute(f.command('reconcile', { report_sha256: '0'.repeat(64), answer: 'observed' })), {
    code: 'CONTROL_RECONCILIATION_CONFLICT',
  });
  await f.campaigns.execute(
    f.command('reconcile', { report_sha256: report.report_sha256, answer: 'Observed remote attempt ended; retain the reservation.' }),
  );
  assert.equal(f.campaigns.query(f.id).unresolved_commands.length, 0);
  assert.equal(f.campaigns.query(f.id).committed_microusd, 1000);
  await assert.rejects(f.campaigns.execute(f.command('run', command.input)), { code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED' });
});

test('a second controller cannot reconcile a live dispatch and can cancel it durably', async (t) => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const f = await fixture(t, {
    run: ({ signal }) =>
      new Promise((resolve, reject) => {
        started();
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }),
  });
  const running = f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId }));
  const rejected = assert.rejects(running, { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  await ready;
  const other = new ProviderCampaignControl(f.control, { [f.configured.manifest.binding_id]: f.configured });
  const report = other.query(f.id);
  assert.equal(report.live_commands.length, 1);
  await assert.rejects(
    other.execute(f.command('reconcile', { report_sha256: report.report_sha256, answer: 'must not release live dispatch' })),
    { code: 'CONTROL_RECONCILIATION_CONFLICT' },
  );
  await other.execute(f.command('cancel'));
  await rejected;
  assert.equal(other.query(f.id).cancelled, true);
  assert.equal(other.query(f.id).requests, 1);
});

test('a changed binding manifest cannot replace the pinned configuration after reopening', async (t) => {
  const f = await fixture(t);
  const replacement = { ...f.configured, manifest: { ...f.configured.manifest, provider_version: '2.0.0' } };
  replacement.adapter = { ...replacement.adapter, inspect: async () => ({ ...f.observed, provider_version: '2.0.0' }) };
  const reopened = new ProviderCampaignControl(f.control, { [replacement.manifest.binding_id]: replacement });
  await assert.rejects(reopened.execute(f.command('run', { binding_id: replacement.manifest.binding_id, task_id: f.taskId })), {
    code: 'CONTROL_PROVIDER_BINDING_DRIFT',
  });
  assert.equal(f.calls(), 0);
});

test('HTTP and SDK campaign commands share authentication, cursors and durable budget', async (t) => {
  const f = await fixture(t);
  const { startControlServer } = require('../tools/cli/lib/engineering-control-http');
  const { ControlClient } = require('../packages/control-sdk');
  const credential = 'test-provider-campaign-credential-long-enough';
  const server = await startControlServer({ control: f.control, credential });
  try {
    const client = new ControlClient({ url: server.url, credential });
    const denied = new ControlClient({ url: server.url, credential: 'wrong-credential-long-enough-for-client' });
    await assert.rejects(denied.campaignQuery(f.id), { code: 'CONTROL_UNAUTHENTICATED' });
    const inspected = await client.bindingInspect(f.configured.manifest.binding_id);
    assert.equal(inspected.configuration, 'valid');
    assert.equal(inspected.effective_authentication, 'not_observed');
    assert.equal(f.calls(), 0);
    await assert.rejects(client.bindingInspect('binding:unknown'), { code: 'CONTROL_PROVIDER_BINDING_UNKNOWN' });
    await assert.rejects(client.request('/v1/provider-bindings'), { code: 'CONTROL_QUERY_INVALID' });
    assert.throws(() => client.bindingInspect('invalid'));
    const before = await client.campaignQuery(f.id);
    assert.equal(before.requests, 0);
    const events = await client.campaignEvents(f.id, { limit: 1 });
    assert.equal(events.events.length, 1);
    const rest = await client.campaignEvents(f.id, { after: events.next_cursor });
    assert.equal(rest.events.length, before.current_sequence - 1);
    await client.campaign(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId }));
    assert.equal((await client.campaignQuery(f.id)).committed_microusd, 100);
    const { promisify } = require('node:util');
    const run = promisify(require('node:child_process').execFile);
    const env = { ...process.env, HSEOS_CONTROL_CREDENTIAL: credential };
    const cli = await run(
      process.execPath,
      ['tools/cli/hseos-cli.js', 'control', 'campaign-query', '--url', server.url, '--resource', f.id],
      { env },
    );
    assert.deepEqual(JSON.parse(cli.stdout), await client.campaignQuery(f.id));
    const python = await run(
      '/usr/bin/python3',
      [
        '-B',
        '-c',
        "import json,os,sys;sys.path.insert(0,'packages/control-sdk');from hseos_control import ControlClient;c=ControlClient(sys.argv[1],os.environ['HSEOS_CONTROL_CREDENTIAL']);print(json.dumps({'status':c.campaign_query(sys.argv[2]),'events':c.campaign_events(sys.argv[2]),'binding':c.binding_inspect(sys.argv[3])}))",
        server.url,
        f.id,
        f.configured.manifest.binding_id,
      ],
      { env },
    );
    const parity = JSON.parse(python.stdout);
    assert.deepEqual(parity.status, await client.campaignQuery(f.id));
    assert.deepEqual(parity.events, await client.campaignEvents(f.id));
    assert.deepEqual(parity.binding, inspected);
    await assert.rejects(client.request(`/v1/provider-campaigns/${f.id}?unexpected=1`), { code: 'CONTROL_QUERY_INVALID' });
    await assert.rejects(client.request(`/v1/provider-campaigns/${f.id}/events?after=-1`), { code: 'CONTROL_QUERY_INVALID' });
    await assert.rejects(client.request(`/v1/provider-campaigns/${f.id}/events?extra=1`), { code: 'CONTROL_QUERY_INVALID' });
    assert.throws(() => client.campaignQuery('invalid'));
    assert.throws(() => client.campaignEvents(f.id, { limit: 0 }));
  } finally {
    await server.close();
  }
});

test('known overspend remains charged after uncertain outcome reconciliation', async (t) => {
  const f = await fixture(t);
  f.receipt.cost_microusd = 2000;
  await assert.rejects(f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId })), {
    code: 'CONTROL_OUTCOME_UNCERTAIN',
  });
  const report = f.campaigns.query(f.id);
  assert.equal(report.committed_microusd, 2000);
  await f.campaigns.execute(
    f.command('reconcile', { report_sha256: report.report_sha256, answer: 'Record unexpected overspend and retain measured cost.' }),
  );
  assert.equal(f.campaigns.query(f.id).committed_microusd, 2000);
  await assert.rejects(f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId })), {
    code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED',
  });
});

test('expired grants, stale sequences and cancellation deny new effects', async (t) => {
  const f = await fixture(t);
  const input = { binding_id: f.configured.manifest.binding_id, task_id: f.taskId };
  await assert.rejects(f.campaigns.execute({ ...f.command('run', input), expected_sequence: 0 }), { code: 'CONTROL_SEQUENCE_CONFLICT' });
  await assert.rejects(f.campaigns.execute(f.command('run', { ...input, binding_id: 'binding:unknown' })), {
    code: 'CONTROL_PROVIDER_BINDING_UNKNOWN',
  });
  const afterDeadline = new ProviderCampaignControl(
    f.control,
    { [f.configured.manifest.binding_id]: f.configured },
    {
      authorizations: f.authorizations,
      now: () => Date.now() + 120_000,
    },
  );
  await assert.rejects(afterDeadline.execute(f.command('create', { authorization_id: f.authorizationId }, randomUUID())), {
    code: 'CONTROL_CAMPAIGN_AUTHORIZATION_REQUIRED',
  });
  assert.throws(() => f.campaigns.events(f.id, { after: -1 }), { code: 'CONTROL_QUERY_INVALID' });
  assert.throws(() => f.campaigns.query(randomUUID()), { code: 'CONTROL_CAMPAIGN_NOT_FOUND' });
  const cancel = f.command('cancel');
  await f.campaigns.execute(cancel);
  await f.campaigns.execute(cancel);
  await assert.rejects(f.campaigns.execute(f.command('run', input)), { code: 'CONTROL_CAMPAIGN_CANCELLED' });
  assert.equal(f.calls(), 0);
});

test('unbound adapter identities and missing dispatch implementations cannot configure campaigns', async (t) => {
  const f = await fixture(t);
  assert.throws(() => new ProviderCampaignControl(f.control, { 'binding:another': f.configured }), {
    code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID',
  });
  assert.throws(
    () =>
      new ProviderCampaignControl(f.control, {
        [f.configured.manifest.binding_id]: { ...f.configured, adapter: { inspect: async () => f.observed } },
      }),
    { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' },
  );
  const missing = new ProviderCampaignControl(f.control, {}, { authorizations: f.authorizations });
  await assert.rejects(missing.execute(f.command('create', { authorization_id: f.authorizationId }, randomUUID())), {
    code: 'CONTROL_CAMPAIGN_AUTHORIZATION_USED',
  });
  const freshAuthorization = randomUUID();
  const fresh = new ProviderCampaignControl(
    f.control,
    {},
    { authorizations: { [freshAuthorization]: f.authorizations[f.authorizationId] } },
  );
  await assert.rejects(fresh.execute(f.command('create', { authorization_id: freshAuthorization }, randomUUID())), {
    code: 'CONTROL_PROVIDER_BINDING_UNKNOWN',
  });
  assert.equal(f.control.ledger.readStream('control_provider_authorization', freshAuthorization).length, 0);
});

test('a concurrent exact retry observes the committed receipt without a second dispatch', async (t) => {
  const f = await fixture(t);
  let release;
  const inspected = new Promise((resolve) => {
    release = resolve;
  });
  let observations = 0;
  f.configured.adapter.inspect = async () => {
    if (++observations === 2) await inspected;
    return { ...f.observed, observed_at: Date.now() };
  };
  const command = f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId });
  const first = f.campaigns.execute(command);
  const retry = f.campaigns.execute(command);
  const result = await first;
  release();
  assert.deepEqual(await retry, result);
  assert.equal(f.calls(), 1);
});

test('a request ceiling holds even when prior attempts report zero charge', async (t) => {
  const f = await fixture(t);
  f.receipt.cost_microusd = 0;
  const input = { binding_id: f.configured.manifest.binding_id, task_id: f.taskId };
  for (let count = 0; count < 3; count++) await f.campaigns.execute(f.command('run', input));
  await assert.rejects(f.campaigns.execute(f.command('run', input)), { code: 'CONTROL_CAMPAIGN_BUDGET_EXHAUSTED' });
  assert.equal(f.calls(), 3);
  assert.equal(f.campaigns.query(f.id).committed_microusd, 0);
});

test('failed inspection never consumes an authorization or leaks transport details', async (t) => {
  const f = await fixture(t);
  f.configured.adapter.inspect = async () => {
    throw new Error('private transport details');
  };
  await assert.rejects(
    f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId })),
    (error) => error.code === 'CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE' && !error.message.includes('private'),
  );
  assert.equal(f.campaigns.query(f.id).requests, 0);
  assert.equal(f.calls(), 0);
});

async function composedFixture(t, { maxCost = 2000, childRun, parentRun, childKind } = {}) {
  const control = new EngineeringControl();
  t.after(() => {
    control.close();
    control.handle.cleanup();
  });
  const campaignId = randomUUID(),
    taskId = randomUUID(),
    authorizationId = randomUUID();
  const parent = manifest('antigravity', 'local', 'client');
  parent.binding_id = 'binding:client';
  const child = childKind === 'client' ? manifest('codex', 'account', 'client') : manifest();
  child.binding_id = 'binding:model';
  if (childKind) child.provider_kind = childKind;
  const receipt = (value) => ({
    status: 'completed',
    binding_sha256: value.binding_sha256,
    evidence_sha256: 'f'.repeat(64),
    cost_microusd: value.route === 'api' ? 100 : 0,
    input_tokens: 2,
    output_tokens: 1,
  });
  const configured = (value, run, subordinate_binding_ids = []) => ({
    manifest: value,
    binding_sha256: value.binding_sha256,
    subordinate_binding_ids,
    adapter: {
      inspect: async () => ({
        binding_sha256: value.binding_sha256,
        artifact_sha256: value.artifact_sha256,
        provider_version: value.provider_version,
        account_sha256: value.authentication.account_sha256,
        authenticated: true,
        auth_source: value.authentication.source,
        observed_at: Date.now(),
        expires_at: null,
        quota_remaining_requests: 10,
        competing_credentials: false,
      }),
      run,
    },
  });
  let calls = 0;
  const bindings = {
    [parent.binding_id]: configured(
      parent,
      async (input) => {
        if (parentRun) return parentRun(input, receipt(parent));
        await input.runSubordinate({ binding_id: child.binding_id });
        return receipt(parent);
      },
      [child.binding_id],
    ),
    [child.binding_id]: configured(child, async (input) => {
      calls++;
      assert.equal(service.query(campaignId).committed_microusd, child.billing.max_request_microusd);
      assert.equal(input.task_id, taskId);
      return childRun ? childRun(input) : receipt(child);
    }),
  };
  const service = new ProviderCampaignControl(control, bindings, {
    authorizations: {
      [authorizationId]: {
        max_requests: 4,
        max_cost_microusd: maxCost,
        deadline: Date.now() + 60_000,
        binding_ids: Object.keys(bindings),
        task_ids: [taskId],
      },
    },
  });
  control.providerCampaigns = service;
  const command = (action, input = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: campaignId,
    expected_sequence: service.rows(campaignId).length,
    action,
    input,
  });
  await service.execute(command('create', { authorization_id: authorizationId }));
  return {
    control,
    service,
    campaignId,
    command,
    calls: () => calls,
    bindings,
    run: () => service.execute(command('run', { binding_id: parent.binding_id, task_id: taskId })),
  };
}

test('client and subordinate model reserve in one campaign before effect and preserve costs on reopen', async (t) => {
  const f = await composedFixture(t);
  await f.run();
  assert.equal(f.calls(), 1);
  const reopened = new ProviderCampaignControl(f.control, f.bindings);
  assert.equal(reopened.query(f.campaignId).requests, 2);
  assert.equal(reopened.query(f.campaignId).committed_microusd, 100);
  assert.deepEqual(reopened.query(f.campaignId).unresolved_commands, []);
  const reserved = f.service.rows(f.campaignId).filter((row) => row.payload.kind === 'reserved');
  assert.equal(reserved[1].payload.parent_command_id, reserved[0].payload.command_id);
});

test('subordinate budget cannot bypass the campaign ceiling', async (t) => {
  const f = await composedFixture(t, { maxCost: 999 });
  await assert.rejects(f.run(), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  assert.equal(f.calls(), 0);
  assert.equal(f.service.query(f.campaignId).requests, 1);
});

test('a child with a lost receipt retains its reservation and fences even a parent that catches its error', async (t) => {
  const f = await composedFixture(t, {
    childRun: async () => {
      throw new Error('receipt lost');
    },
    parentRun: async ({ runSubordinate }, receipt) => {
      await runSubordinate({ binding_id: 'binding:model' }).catch(() => {});
      return receipt;
    },
  });
  await assert.rejects(f.run(), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  const state = f.service.query(f.campaignId);
  assert.equal(state.committed_microusd, 1000);
  assert.equal(state.unresolved_commands.length, 2);
  await assert.rejects(f.run(), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  assert.equal(f.calls(), 1);
});

test('subordinate capability expires when parent finishes and cannot target an unpinned binding', async (t) => {
  let capability;
  const f = await composedFixture(t, {
    parentRun: async ({ runSubordinate }, receipt) => {
      capability = runSubordinate;
      await assert.rejects(runSubordinate({ binding_id: 'binding:other' }), { code: 'CONTROL_CAMPAIGN_SCOPE_DENIED' });
      return receipt;
    },
  });
  await f.run();
  await assert.rejects(capability({ binding_id: 'binding:model' }), { code: 'CONTROL_CAMPAIGN_CANCELLED' });
  assert.equal(f.calls(), 0);
});

test('campaign cancellation reaches parent and child and waits for child termination', async (t) => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let drained = false;
  const f = await composedFixture(t, {
    childRun: async ({ signal }) => {
      started();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      drained = true;
      throw new Error('cancelled');
    },
  });
  const running = assert.rejects(f.run(), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  await ready;
  assert.throws(() => f.control.close(), { code: 'CONTROL_EXECUTION_ACTIVE' });
  await f.service.execute(f.command('cancel'));
  await running;
  assert.equal(drained, true);
  assert.equal(f.service.active.size, 0);
  assert.equal(f.service.query(f.campaignId).committed_microusd, 1000);
});

test('shutdown cancels and drains a composed call before returning, and fences future effects', async (t) => {
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const f = await composedFixture(t, {
    childRun: async ({ signal }) => {
      entered();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      throw new Error('stopped');
    },
  });
  const running = assert.rejects(f.run(), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
  await ready;
  await f.service.shutdown();
  await running;
  assert.equal(f.service.active.size, 0);
  assert.equal(f.service.query(f.campaignId).cancelled, true);
  await assert.rejects(f.run(), { code: 'CONTROL_CAMPAIGN_CANCELLED' });
});

test('denied task scope is checked before resolving provider credentials or probing its API', async (t) => {
  const f = await fixture(t);
  let inspected = 0;
  f.configured.adapter.inspect = async () => {
    inspected++;
    return f.observed;
  };
  await assert.rejects(f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: randomUUID() })), {
    code: 'CONTROL_CAMPAIGN_SCOPE_DENIED',
  });
  assert.equal(inspected, 0);
  assert.equal(f.calls(), 0);
});

test('shutdown aborts and waits for admission probes before the ledger can close', async (t) => {
  const f = await fixture(t);
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let aborted = false;
  f.configured.adapter.inspect = async ({ signal }) => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
        },
        { once: true },
      );
    });
    throw new Error('probe ended');
  };
  const run = f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId }));
  const rejected = assert.rejects(run, { code: 'CONTROL_PROVIDER_OBSERVATION_UNAVAILABLE' });
  await started;
  assert.throws(() => f.control.close());
  let closed = false;
  const close = f.campaigns.shutdown().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborted, true);
  assert.equal(closed, false);
  release();
  await rejected;
  await close;
  assert.equal(f.calls(), 0);
  assert.equal(f.campaigns.query(f.id).requests, 0);
});

test('request quota cannot conceal an observed monetary deficit', async (t) => {
  const f = await fixture(t);
  f.observed.quota_available_microusd = 0;
  await assert.rejects(f.campaigns.execute(f.command('run', { binding_id: f.configured.manifest.binding_id, task_id: f.taskId })), {
    code: 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE',
  });
  assert.equal(f.calls(), 0);
});

test('Python Antigravity capability reaches the same campaign reservation before the subordinate effect', async (t) => {
  const { startCampaignModelBridge } = require('../tools/cli/lib/provider-campaign-bridge');
  const run = require('node:util').promisify(require('node:child_process').execFile);
  const f = await composedFixture(t, {
    parentRun: async ({ signal, runSubordinate }, receipt) => {
      const bridge = await startCampaignModelBridge({ binding_id: 'binding:model', signal, runSubordinate });
      try {
        const python = await run(
          '/usr/bin/python3',
          [
            '-B',
            '-c',
            "import os,sys;sys.path.insert(0,'packages/control-sdk');from antigravity_client import CampaignModelBridge;print(CampaignModelBridge(os.environ['BRIDGE_URL'],os.environ['BRIDGE_CAP'])())",
          ],
          { env: { ...process.env, BRIDGE_URL: bridge.url, BRIDGE_CAP: bridge.credential } },
        );
        assert.equal(JSON.parse(python.stdout).status, 'completed');
        assert.equal(bridge.report().completed, true);
        return receipt;
      } finally {
        await bridge.close();
      }
    },
  });
  await f.run();
  assert.equal(f.calls(), 1);
  assert.equal(f.service.query(f.campaignId).requests, 2);
});

test('known session resume keeps binding, task and campaign budget pinned', async (t) => {
  const f = await fixture(t, { maxCost: 3000 });
  f.receipt.provider_session_id = 'native-session-1';
  const input = { binding_id: f.configured.manifest.binding_id, task_id: f.taskId };
  const first = f.command('run', input);
  await f.campaigns.execute(first);
  const original = f.configured.adapter.run;
  let resumed;
  f.configured.adapter.run = async (value) => {
    resumed = value.resume_session_id;
    return original(value);
  };
  await f.campaigns.execute(f.command('run', { ...input, resume_from: first.command_id }));
  assert.equal(resumed, 'native-session-1');
  assert.equal(f.calls(), 2);
  assert.equal(f.campaigns.query(f.id).committed_microusd, 200);
  await assert.rejects(f.campaigns.execute(f.command('run', { ...input, resume_from: randomUUID() })), {
    code: 'CONTROL_PROVIDER_RESUME_UNAVAILABLE',
  });
  f.receipt.provider_session_id = 'different-session';
  await assert.rejects(f.campaigns.execute(f.command('run', { ...input, resume_from: first.command_id })), {
    code: 'CONTROL_OUTCOME_UNCERTAIN',
  });
});

test('unknown quota requires an explicit expiring owner exception and never overrides exhaustion', async (t) => {
  const f = await fixture(t);
  f.observed.quota_remaining_requests = null;
  const opened = f.campaigns.rows(f.id)[0].payload;
  const authorizations = {
    [randomUUID()]: {
      max_requests: 3,
      max_cost_microusd: 3000,
      deadline: Date.now() + 60_000,
      binding_ids: [f.configured.manifest.binding_id],
      task_ids: [f.taskId],
      quota_exceptions: {
        [f.configured.manifest.binding_id]: { reason: 'Explicit test-only quota decision', expires_at: Date.now() + 30_000 },
      },
    },
  };
  const service = new ProviderCampaignControl(f.control, { [f.configured.manifest.binding_id]: f.configured }, { authorizations });
  const id = randomUUID();
  const command = (action, input) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    expected_sequence: service.rows(id).length,
    action,
    input,
  });
  await service.execute(command('create', { authorization_id: Object.keys(authorizations)[0] }));
  await service.execute(command('run', { binding_id: opened.binding_ids[0], task_id: f.taskId }));
  assert.equal(service.rows(id).find((row) => row.payload.kind === 'reserved').payload.quota_admission, 'owner_exception');
  f.observed.quota_remaining_requests = 0;
  await assert.rejects(service.execute(command('run', { binding_id: opened.binding_ids[0], task_id: f.taskId })), {
    code: 'CONTROL_PROVIDER_QUOTA_UNAVAILABLE',
  });
});

test('quota exceptions cannot expand authorization scope or expiration', async (t) => {
  const f = await fixture(t);
  const grant = f.authorizations[f.authorizationId];
  for (const quota_exceptions of [
    { other: { reason: 'unrelated', expires_at: grant.deadline } },
    { [grant.binding_ids[0]]: { reason: 'too late', expires_at: grant.deadline + 1 } },
  ]) {
    assert.throws(
      () =>
        new ProviderCampaignControl(
          f.control,
          {},
          {
            authorizations: {
              [randomUUID()]: { ...grant, quota_exceptions },
            },
          },
        ),
      /Quota exception exceeds authorization scope/,
    );
  }
});

test('terminal account client composes without changing identity or enabling recursive children', async (t) => {
  const fixture = await composedFixture(t, { childKind: 'client' });
  const result = await fixture.run();
  assert.equal(result.receipt.status, 'completed');
  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.service.query(fixture.campaignId).requests, 2);
  assert.equal(fixture.bindings['binding:model'].manifest.provider_kind, 'client');
  assert.equal(fixture.service.query(fixture.campaignId).committed_microusd, 0);
  const child = fixture.service.bindings.get('binding:model');
  child.subordinateIds = ['binding:client'];
  assert.throws(() => fixture.service.validateComposition(), /COMPOSITION_INVALID/);
  child.subordinateIds = [];
  const parent = fixture.service.bindings.get('binding:client');
  for (const ids of [['binding:client'], ['missing']]) {
    parent.subordinateIds = ids;
    assert.throws(() => fixture.service.validateComposition(), /COMPOSITION_INVALID/);
  }
});
