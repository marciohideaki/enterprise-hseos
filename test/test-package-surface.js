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
    'tools/cli/commands/init.js',
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
  // Reviewed inventory ceiling (owner decision G3, 2026-10-09; analysis in docs/evolution/revalidation-2026-10/).
  // The 17 files with no consumer were retired (14 removed from the repository, 3 pilot-evidence files excluded from the
  // package via `!.hseos/loops/**`), leaving 1454 entries. The W5 projection for the core is +47 to +72 files
  // (central ~60); the ceiling is the post-removal base plus the high scenario (72) plus ~14 of contingency for
  // evidence/migration files that only appear during execution, i.e. 1540. Raising it again needs a per-increment
  // justification; the history of earlier increments lives in Git.
  // Note: the capability registry snapshot, its lock, the runtime defaults and the bindings schema are also copied into
  // .agents/capabilities/. That is a side effect of the compiler (syncCapabilityCatalog copies the whole directory
  // without a filter), not a runtime need; the owner decided to keep the mirror and test-capability-catalog.js asserts
  // it equals the canonical source.
  // State/key/config exclusions above remain independent security invariants.
  const ENTRY_CEILING = 1540;
  assert.ok(packed.entryCount <= ENTRY_CEILING, `package entry count is not bounded: ${packed.entryCount}`);
  assert.ok(packed.unpackedSize < 14_000_000, `package unpacked size is not bounded: ${packed.unpackedSize}`);

  // Per-area budget = measured count after the G3 removals + projected W5 core share (high estimate) + contingency.
  // Measured: .enterprise 446, tools 371, src 245, .agents 186, packages 112, .hseos 61, scripts 19, docs 7, root 7
  // (1454). W5 high share (72): .enterprise 33 (ADR, policies, 3 skills), tools 18 (MCP hardening, LSP, DAP, memory),
  // packages 9 (multimodal contracts), .agents 6 (skill mirror), src 4, scripts 2. Contingency (14): .enterprise 5,
  // tools 4, packages 2, .agents 1, src 1, .hseos 1. The area budgets sum to the ceiling, so none can grow at the
  // expense of another without an explicit change here.
  const areaBudgets = {
    '.enterprise': 484,
    tools: 393,
    src: 250,
    '.agents': 193,
    packages: 123,
    '.hseos': 62,
    scripts: 21,
    docs: 7,
    '(root)': 7,
  };
  assert.ok(Object.values(areaBudgets).reduce((a, b) => a + b, 0) <= ENTRY_CEILING, 'area budgets must not exceed the entry ceiling');
  const areaCounts = {};
  for (const file of files) {
    const area = file.includes('/') ? file.split('/')[0] : '(root)';
    areaCounts[area] = (areaCounts[area] || 0) + 1;
  }
  for (const [area, count] of Object.entries(areaCounts)) {
    assert.ok(area in areaBudgets, `package area has no budget: ${area} (${count} entries)`);
    assert.ok(count <= areaBudgets[area], `package area ${area} exceeds its budget: ${count} > ${areaBudgets[area]}`);
  }
});
