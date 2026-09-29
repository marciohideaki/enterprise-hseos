'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

async function main() {
  const project = process.cwd();
  const packageRoot = path.join(project, 'node_modules', 'hseos');
  const { EngineeringControl } = require(path.join(packageRoot, 'tools/cli/lib/engineering-control'));
  const { ProviderCampaignControl } = require(path.join(packageRoot, 'tools/cli/lib/provider-campaign-control'));
  const { createExecutionPluginProvider } = require(path.join(packageRoot, 'tools/cli/lib/execution-plugin-provider'));
  const { admitExecutionPlugin } = require(path.join(packageRoot, 'tools/lib/execution-plugin-manifest'));
  const { canonicalize } = require(path.join(packageRoot, 'packages/managed-governance-contracts/canonical-json'));
  const { validatePortResult } = require(path.join(packageRoot, 'packages/agent-runtime-contracts'));
  const registry = require(path.join(project, 'node_modules', 'yaml')).parse(
    fs.readFileSync(path.join(project, '.agents', 'plugins', 'registry.yaml'), 'utf8'),
  );
  const row = registry.plugins.find((entry) => entry.id === 'policy-verifier');
  const directory = path.join(project, '.hseos', 'plugins', 'store', row.execution.manifest_sha256);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'execution.json'), 'utf8'));
  const admission = admitExecutionPlugin(directory, {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    manifest_sha256: createHash('sha256').update(canonicalize(manifest)).digest('hex'),
    node_major: Number(process.versions.node.split('.')[0]),
    contract_version: 1,
    allowed_capabilities: manifest.capabilities,
    limits: manifest.limits,
  });
  const bindingId = 'policy-verifier-binding';
  const port = createExecutionPluginProvider({
    admission,
    binding_id: bindingId,
    limits: { max_requests: 1, max_input_tokens: 8192, max_output_tokens: 1024, max_duration_ms: 3000 },
  });
  const control = new EngineeringControl();
  const campaignId = randomUUID(),
    taskId = randomUUID(),
    authorizationId = randomUUID();
  const campaign = new ProviderCampaignControl(
    control,
    { [bindingId]: port.binding },
    {
      authorizations: {
        [authorizationId]: {
          max_requests: 1,
          max_cost_microusd: 0,
          deadline: Date.now() + 60_000,
          binding_ids: [bindingId],
          task_ids: [taskId],
        },
      },
    },
  );
  try {
    await campaign.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: campaignId,
      expected_sequence: 0,
      action: 'create',
      input: { authorization_id: authorizationId },
    });
    port.attach({ campaign, campaign_id: campaignId, task_id: taskId });
    const providerId = port.manifest.provider_id;
    const spec = {
      schema_version: 1,
      session_id: `session:${randomUUID()}`,
      agent_id: 'agent:w4-policy-verifier',
      parent_session_id: null,
      authority_ref: 'authority://w4/verification',
      policy_ref: 'policy://w4/v1',
      execution: { mode: 'delegated', runtime_provider_id: providerId, profile: 'plugin' },
      limits: { max_turns: 1, max_tokens: 8192, max_duration_ms: 10_000, max_tool_calls: 0, max_children: 0, max_workflow_steps: 0 },
      metadata: { purpose: 'external-provider-consumer' },
    };
    const createInput = { schema_version: 1, command: 'create', provider_id: providerId, spec };
    const created = validatePortResult('RuntimeProvider', 'create', await port.provider.create(createInput), createInput);
    const identity = {
      schema_version: 1,
      provider_id: providerId,
      runtime_session_id: created.runtime_session_id,
      session_id: spec.session_id,
    };
    const artifact = 'module.exports = (n) => n + 1;\n';
    const instruction = JSON.stringify({
      artifact_sha256: createHash('sha256').update(artifact).digest('hex'),
      line_count: 2,
      max_lines: 2,
    });
    const sendInput = { ...identity, command: 'send', turn_id: 'turn:w4-verification', message: { role: 'user', content: instruction } };
    validatePortResult('RuntimeProvider', 'send', await port.provider.send(sendInput), sendInput);
    const eventInput = { ...identity, from_sequence: 0 };
    const events = await Array.fromAsync(validatePortResult('RuntimeProvider', 'events', port.provider.events(eventInput), eventInput));
    const output = JSON.parse(events.find((event) => event.event_type === 'runtime.message.delta').payload.text);
    assert.equal(output.accepted, true);
    assert.equal(output.artifact_sha256, JSON.parse(instruction).artifact_sha256);
    assert.equal(events.at(-1).event_type, 'runtime.session.completed');
    const report = campaign.query(campaignId);
    assert.equal(report.requests, 1);
    assert.equal(report.committed_microusd, 0);
    assert.deepEqual(report.unresolved_commands, []);
    const disposeInput = { ...identity, command: 'dispose' };
    validatePortResult('RuntimeProvider', 'dispose', await port.provider.dispose(disposeInput), disposeInput);
    process.stdout.write(
      JSON.stringify({
        schema_version: 1,
        package_root: packageRoot,
        plugin_manifest_sha256: row.execution.manifest_sha256,
        campaign_id: campaignId,
        authorization_id: authorizationId,
        task_id: taskId,
        event_types: events.map((event) => event.event_type),
        output,
        requests: report.requests,
        committed_microusd: report.committed_microusd,
        unresolved_commands: report.unresolved_commands,
        campaign_event_kinds: campaign.rows(campaignId).map((entry) => entry.payload.kind),
      }) + '\n',
    );
  } finally {
    await port.close();
    await campaign.shutdown();
    await control.terminals.shutdown();
    control.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
