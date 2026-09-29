'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function main() {
  const project = process.cwd();
  const packageRoot = path.join(project, 'node_modules', 'hseos');
  const { EngineeringControl } = require(path.join(packageRoot, 'tools/cli/lib/engineering-control'));
  const { projectWorkspaceSnapshot } = require(path.join(packageRoot, 'tools/cli/lib/engineering-workspace'));
  const { projectVerifierDigest } = require(path.join(packageRoot, 'tools/cli/lib/engineering-project-verifier'));
  const { canonicalize } = require(path.join(packageRoot, 'packages/managed-governance-contracts/canonical-json'));
  const { RelationalSessionEventStore } = require(path.join(packageRoot, 'packages/agent-session-store'));
  const { admitExecutionPlugin } = require(path.join(packageRoot, 'tools/lib/execution-plugin-manifest'));
  const { createExecutionPluginModel } = require(path.join(packageRoot, 'tools/cli/lib/execution-plugin-model'));
  const workspace = path.join(project, 'consumer-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const source = 'module.exports = (n) => n + 1;\n';
  const providerReceipt = JSON.parse(fs.readFileSync(path.join(project, 'provider-port-result.json'), 'utf8'));
  const providerResult = providerReceipt.output;
  assert.equal(providerReceipt.requests, 1);
  assert.equal(providerReceipt.committed_microusd, 0);
  assert.deepEqual(providerReceipt.unresolved_commands, []);
  assert.equal(providerResult.accepted, true);
  assert.equal(providerResult.artifact_sha256, sha(source));
  assert.ok(providerReceipt.campaign_event_kinds.includes('receipt'));
  const providerResultText = canonicalize({ campaign_id: providerReceipt.campaign_id, output: providerResult });
  fs.writeFileSync(path.join(workspace, 'index.js'), source);
  const git = (...args) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' }).trim();
  if (!fs.existsSync(path.join(workspace, '.git'))) {
    git('init');
    git('config', 'user.name', 'W4 Consumer');
    git('config', 'user.email', 'w4@example.invalid');
    git('add', 'index.js');
    git('commit', '-m', 'Consumer baseline');
  }
  const contract = JSON.parse(fs.readFileSync(path.join(project, 'task-template.json'), 'utf8'));
  contract.sources.push({ id: 'policy-verification', kind: 'memory', content: providerResultText, sha256: sha(providerResultText) });
  contract.requirements[0].source_ids.push('policy-verification');
  Object.assign(contract, {
    schema_version: 2,
    execution_profile: 'managed-project',
    baseline_sha: git('rev-parse', 'HEAD'),
    initial_files: [],
    scope: { read: ['index.js'], write: ['index.js'] },
    commands: [{ id: 'check', runtime: 'node', entrypoint: 'index.js', args: [] }],
    workspace: { root: workspace, files_sha256: '0'.repeat(64) },
  });
  contract.limits.max_duration_ms = 60_000;
  contract.limits.max_tool_calls = 4;
  contract.verifier = {
    reference: 'verifier://project/node-module-v1',
    sha256: '0'.repeat(64),
    acceptance_ids: ['a1'],
    checks: [{ path: 'index.js', export_name: 'default', args: [3], expected: 4 }],
  };
  contract.workspace.files_sha256 = projectWorkspaceSnapshot(contract).sha256;
  contract.verifier.sha256 = projectVerifierDigest(contract);
  const store = path.join(project, '.hseos', 'plugins', 'store');
  const registry = require(path.join(project, 'node_modules', 'yaml')).parse(
    fs.readFileSync(path.join(project, '.agents', 'plugins', 'registry.yaml'), 'utf8'),
  );
  const catalog = {};
  for (const row of registry.plugins.filter((item) => ['source-audit', 'runbook-context', 'source-review-model'].includes(item.id))) {
    const directory = path.join(store, row.execution.manifest_sha256);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'execution.json'), 'utf8'));
    if (manifest.kind === 'model-provider') {
      catalog[row.id] = {
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
        configuration: {
          schema_version: 1,
          binding_id: 'source-review-binding',
          model: 'plugin/source-review',
          models: ['plugin/source-review'],
          limits: { max_requests: 3, max_input_tokens: 65_536, max_output_tokens: 8192, max_duration_ms: 3000 },
        },
        dependencies: [],
      };
      continue;
    }
    const tool = manifest.kind === 'tool';
    const input_schema = tool
      ? { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
      : { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'], additionalProperties: false };
    catalog[row.id] = {
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
      configuration: {
        schema_version: 1,
        name: manifest.capabilities[0],
        description: tool ? 'Audit source text' : 'Read the recovery runbook',
        capability: manifest.capabilities[0],
        authority: manifest.capabilities[0],
        policy_version: 'v1',
        timeout_ms: manifest.limits.timeout_ms,
        input_schema,
        ...(tool
          ? {
              output_schema: {
                type: 'object',
                properties: {
                  sha256: { type: 'string' },
                  lines: { type: 'integer' },
                  nonempty_lines: { type: 'integer' },
                  review_markers: { type: 'integer' },
                },
                required: ['sha256', 'lines', 'nonempty_lines', 'review_markers'],
                additionalProperties: false,
              },
            }
          : { initial_input: { topic: 'recovery' } }),
      },
      dependencies: [],
    };
  }
  const taskId = randomUUID(),
    workflowId = randomUUID(),
    cancelledId = randomUUID();
  const campaignId = randomUUID(),
    authorizationId = randomUUID();
  const modelEntry = catalog['source-review-model'];
  const modelManifest = JSON.parse(fs.readFileSync(path.join(modelEntry.directory, 'execution.json'), 'utf8'));
  const modelAdmission = admitExecutionPlugin(modelEntry.directory, {
    ...modelEntry.policy,
    node_major: Number(process.versions.node.split('.')[0]),
  });
  assert.equal(modelManifest.kind, 'model-provider');
  const modelPort = createExecutionPluginModel({ admission: modelAdmission, ...modelEntry.configuration });
  const control = new EngineeringControl({
    workspaces: [workspace],
    extensionCatalog: catalog,
    providerBindings: { [modelEntry.configuration.binding_id]: modelPort.binding },
    providerAuthorizations: {
      [authorizationId]: {
        max_requests: 3,
        max_cost_microusd: 0,
        deadline: Date.now() + 180_000,
        binding_ids: [modelEntry.configuration.binding_id],
        task_ids: [taskId],
      },
    },
  });
  fs.writeFileSync(path.join(project, 'job-state-path.txt'), `${control.state}\n`);
  const jobs = control.jobs;
  const now = Date.now();
  const jobInput = (kind, definition, depends_on = []) => ({
    kind,
    definition,
    not_before: new Date(now).toISOString(),
    deadline_at: new Date(now + 180_000).toISOString(),
    depends_on,
  });
  const command = (resource_id, action, expected_sequence, input, extra = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id,
    expected_sequence,
    action,
    ...(input === undefined ? {} : { input }),
    ...extra,
  });
  const taskDefinition = {
    contract,
    plugin_model: { selection_id: 'source-review-model', campaign_id: campaignId },
    extension_ids: ['source-audit', 'runbook-context'],
  };
  const cancelledDefinition = { contract, responses: [], extension_ids: ['source-audit', 'runbook-context'] };
  const workflow = {
    schema_version: 1,
    workflow_id: 'workflow:w4-consumers',
    max_parallelism: 1,
    limits: {
      ...contract.limits,
      max_duration_ms: 120_000,
      max_children: 2,
      max_workflow_steps: 2,
      max_tokens: contract.limits.max_tokens * 2,
      max_tool_calls: contract.limits.max_tool_calls * 2,
      max_turns: contract.limits.max_turns * 2,
    },
    tasks: [
      { id: 'first', contract, responses: [], depends_on: [] },
      { id: 'second', contract, responses: [], depends_on: ['first'] },
    ],
  };
  try {
    await control.providerCampaigns.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: campaignId,
      expected_sequence: 0,
      action: 'create',
      input: { authorization_id: authorizationId },
    });
    await jobs.execute(command(taskId, 'create', 0, jobInput('task', taskDefinition)));
    await jobs.execute(command(workflowId, 'create', 0, jobInput('workflow', { definition: workflow }, [taskId])));
    await jobs.execute(command(cancelledId, 'create', 0, jobInput('task', cancelledDefinition)));
    const cancelled = await jobs.execute(command(cancelledId, 'cancel', 1, {}));
    assert.equal(cancelled.status, 'cancelled');
    const first = await jobs.worker.execute(command(taskId, 'claim', 1, undefined, { fence: 0, lease_ms: 1000 }));
    assert.equal(first.status, 'claimed');
    await jobs.materializer.execute(command(taskId, 'materialize', 2, undefined, { fence: 1 }));
    const dispatchedTask = await jobs.dispatcher.execute(command(taskId, 'dispatch', 4, undefined, { fence: 1 }));
    assert.equal(dispatchedTask.status, 'succeeded', JSON.stringify(dispatchedTask));
    const claimedWorkflow = await jobs.worker.execute(command(workflowId, 'claim', 1, undefined, { fence: 0, lease_ms: 1000 }));
    assert.equal(claimedWorkflow.status, 'claimed');
    const prepared = await jobs.materializer.execute(command(workflowId, 'materialize', 2, undefined, { fence: 1 }));
    assert.equal(prepared.materialization.plan.tasks.length, 2);
    const dispatchedWorkflow = await jobs.dispatcher.execute(command(workflowId, 'dispatch', 4, undefined, { fence: 1 }));
    assert.equal(dispatchedWorkflow.status, 'succeeded', JSON.stringify(dispatchedWorkflow));
    const sessionStore = new RelationalSessionEventStore({ ledger: control.ledger });
    const session = sessionStore.replay(prepared.materialization.plan.manifest.parent_session_id);
    const taskSession = sessionStore.replay(dispatchedTask.materialization.plan.tasks[0].created.session_id);
    const modelMessages = taskSession.turns[taskSession.turn_order[0]].model_steps[0].request.messages;
    const modelInput = JSON.stringify(modelMessages);
    assert.ok(modelInput.includes('plugin://runbook-context'));
    assert.ok(modelInput.includes('reconcile the original command'));
    const taskRows = jobs.rows(taskId);
    const workflowRows = jobs.rows(workflowId);
    const campaign = control.providerCampaigns.query(campaignId);
    const campaignRows = control.providerCampaigns.rows(campaignId);
    assert.equal(taskRows[0].payload.admission.plugin_model.campaign_id, campaignId);
    assert.equal(campaignRows.find((row) => row.payload.kind === 'opened').payload.authorization_id, authorizationId);
    assert.ok(campaignRows.some((row) => row.payload.kind === 'reserved' && row.payload.task_id === taskId));
    assert.equal(campaign.requests, 2);
    assert.equal(campaign.committed_microusd, 0);
    assert.deepEqual(campaign.unresolved_commands, []);
    const result = {
      schema_version: 1,
      package_root: packageRoot,
      state: control.state,
      task_id: taskId,
      provider_campaign_id: providerReceipt.campaign_id,
      provider_result_sha256: sha(providerResultText),
      provider_manifest_sha256: providerReceipt.plugin_manifest_sha256,
      model_campaign_id: campaignId,
      model_authorization_id: authorizationId,
      model_campaign_requests: campaign.requests,
      model_campaign_committed_microusd: campaign.committed_microusd,
      model_campaign_unresolved_commands: campaign.unresolved_commands,
      model_campaign_event_kinds: campaignRows.map((row) => row.payload.kind),
      workflow_id: workflowId,
      cancelled_id: cancelledId,
      task_status: dispatchedTask.status,
      workflow_status: dispatchedWorkflow.status,
      cancelled_status: cancelled.status,
      task_event_types: taskRows.map((row) => row.event_type),
      workflow_event_types: workflowRows.map((row) => row.event_type),
      workflow_children: prepared.materialization.plan.tasks.map((entry) => ({ id: entry.task_run_id, step: entry.step_id })),
      parent_session_status: session.status,
      parent_reservation_released: session.workflow_reservations[workflow.workflow_id]?.released,
      tool_invocations: Object.values(
        sessionStore.replay(dispatchedTask.materialization.plan.tasks[0].created.session_id).tool_invocations,
      ).map((item) => item.name),
      context_origin_pinned: true,
      context_text_observed: true,
    };
    assert.deepEqual(result.tool_invocations, ['source.audit']);
    assert.equal(result.parent_reservation_released?.status, 'completed');
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await jobs.dispatcher.shutdown();
    await modelPort.close();
    await control.providerCampaigns.shutdown();
    await control.terminals.shutdown();
    control.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
