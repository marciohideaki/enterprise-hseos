'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');

function packageFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(output)[0];
}

test('published package exposes runtime and governance assets only', () => {
  const packed = packageFiles();
  const files = new Set(packed.files.map((file) => file.path));
  assert.ok(
    packed.files.find((file) => file.path === 'packages/runtime-providers/codex-acp-launcher.js').mode & 0o111,
    'ACP launcher must retain executable mode',
  );
  for (const required of [
    'tools/cli/commands/control.js',
    'tools/cli/lib/provider-campaign-control.js',
    'tools/cli/lib/execution-plugin-runtime.js',
    'tools/cli/lib/execution-plugin-adapters.js',
    'tools/cli/lib/execution-plugin-campaign.js',
    'tools/cli/lib/execution-plugin-model.js',
    'tools/cli/lib/execution-plugin-provider.js',
    'tools/lib/execution-plugin-manifest.js',
    'tools/cli/lib/control-configuration.js',
    'tools/cli/lib/provider-api-adapter.js',
    'tools/cli/lib/provider-campaign-runner.js',
    'tools/cli/lib/provider-native-adapter.js',
    'tools/cli/lib/provider-acp-adapter.js',
    'tools/cli/lib/provider-acp-worker.js',
    'packages/runtime-providers/codex-acp-peer.js',
    'packages/runtime-providers/codex-acp-composition.js',
    'packages/runtime-providers/codex-acp-launcher.js',
    'packages/runtime-providers/codex-acp-profile.json',
    'tools/cli/lib/provider-antigravity-adapter.js',
    'tools/cli/lib/provider-campaign-worker.js',
    'tools/cli/lib/provider-campaign-process.js',
    'tools/cli/lib/provider-campaign-bridge.js',
    'packages/control-sdk/antigravity_campaign_worker.py',
    'tools/lib/provider-control-manifest.js',
    'tools/cli/lib/engineering-project-verifier.js',
    'tools/cli/lib/engineering-workspace.js',
    'tools/examples/project-task.js',
    'packages/control-sdk/index.js',
    'packages/control-sdk/index.d.ts',
    'packages/control-sdk/hseos_control.py',
    'packages/control-sdk/antigravity_client.py',
    'docs/engineering-control-api.md',
    'LICENSE',
    'tools/hseos-npx-wrapper.js',
    'tools/cli/hseos-cli.js',
    '.agents/manifest.yaml',
    '.enterprise/.specs/constitution/Enterprise-Constitution.md',
    '.enterprise/governance/capabilities/profiles.yaml',
    '.enterprise/governance/capabilities/surfaces.yaml',
    '.agents/capabilities/surfaces.yaml',
    '.hseos/workflows/registry.yaml',
    'docs/MANAGED-GOVERNANCE.md',
    'docs/pt-br/governanca-gerenciada.md',
    'scripts/governance/quality-gates.sh',
    'packages/managed-governance-contracts/index.js',
    'packages/managed-governance-client/index.js',
    'packages/managed-governance-client/session-preflight.js',
    'tools/managed-governance-control-plane/server.js',
    'tools/managed-governance-control-plane/composition.js',
    'tools/managed-governance-control-plane/config.example.json',
    'tools/managed-governance-control-plane/migrations/0003_audit_correlation.sql',
    'tools/managed-governance-control-plane/migrations/0004_operational_health.sql',
    'tools/managed-governance-control-plane/public/index.html',
    'packages/agent-runtime/index.js',
    'tools/lib/execution-plugin-selection.js',
    'tools/cli/lib/engineering-task-extensions.js',
    'tools/cli/lib/engineering-plugin-model.js',
    'tools/cli/lib/job-control.js',
    'tools/cli/lib/job-worker.js',
    'tools/lib/job-contract.js',
    'tools/mcp-project-state/migrations-pending-activation/012-job-events.sql',
    'tools/mcp-project-state/migrations-pending-activation/013-job-lifecycle-events.sql',
    'tools/mcp-project-state/migrations-pending-activation/014-job-materialization-events.sql',
    'tools/cli/lib/job-materialization.js',
    'tools/cli/lib/job-dispatch.js',
    'tools/mcp-project-state/migrations-pending-activation/015-job-execution-events.sql',
    'tools/mcp-project-state/migrations-pending-activation/016-job-workflow-expansion.sql',
    'src/core/agents/hseos-master.agent.yaml',
  ]) {
    assert.ok(files.has(required), `missing required package asset: ${required}`);
  }

  // `.hseos/state/` absence is an explicit acceptance-evidence requirement (managed-shadow-readiness
  // spec.md), not incidental: package.json's `files` field excludes it deliberately (`!.hseos/state/**`).
  const forbiddenPrefixes = ['test/', '_graph/', '.hseos/runs/', '.hseos/state/', '.github/', '.logs/'];
  for (const file of files) {
    assert.ok(!forbiddenPrefixes.some((prefix) => file.startsWith(prefix)), `internal artifact published: ${file}`);
    assert.notEqual(file, '.enterprise/.specs/specs.zip');
    assert.ok(!/\.(?:db|sqlite|pem|key)$/i.test(file), `state or key material published: ${file}`);
    assert.ok(!/(?:^|\/)(?:\.env|managed-governance\.json)$/i.test(file), `runtime configuration published: ${file}`);
  }
  // Reviewed W4 inventory: owner-authorized addition of migration 016 to the 1456-entry base.
  // State/key/config exclusions above remain independent security invariants.
  assert.ok(packed.entryCount <= 1457, `package entry count is not bounded: ${packed.entryCount}`);
  assert.ok(packed.unpackedSize < 22_000_000, `package unpacked size is not bounded: ${packed.unpackedSize}`);
});
