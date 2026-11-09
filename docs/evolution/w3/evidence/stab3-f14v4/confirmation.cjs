'use strict';
// Confirmation gate of the real F14 v4 execution. The real mode runs only when F14V4_REAL_CONFIRMED equals the hash below,
// which the owner reads from `node f14v4.cjs --print-confirmation` and gives back. The hash covers what DECIDES the campaign:
// the plan, the prices, the protected cases and the content of every file listed in GATED_FILES, INCLUDING the v3 files that the
// v4 campaign imports (stats, secret scan, meter) and the shared usage and proof code. It does not cover the rehearsal results.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const GATED_FILES = Object.freeze([
  'f14v4.cjs',
  'guard.cjs',
  'protected-runner.cjs',
  'tasks.cjs',
  'plan.cjs',
  'confirmation.cjs',
  '../stab3-f14v3/stats.cjs',
  '../stab3-f14v3/measure.cjs',
  '../stab3-f14v3/secret-scan.cjs',
  '../shared/usage-from-sse.cjs',
  '../shared/summarize-provider-proof.cjs',
  'tasks/oidc.naive.fixture.txt',
  'tasks/oidc.correct.fixture.txt',
  'tasks/seed.naive.fixture.txt',
  'tasks/seed.correct.fixture.txt',
  'tasks/pass.naive.fixture.txt',
  'tasks/pass.correct.fixture.txt',
]);

// The product files the campaign exercises (traced by loading every module of `hseos-cli agent run` / `agent evidence` with source_db
// and of this script in a fixture run, plus the real provider adapter). Hashed by CONTENT, relative to the repository root the run uses.
const PRODUCT_FILES = Object.freeze([
  'package.json',
  'packages/agent-compaction/checkpoint-provider.js',
  'packages/agent-compaction/deterministic-provider.js',
  'packages/agent-compaction/index.js',
  'packages/agent-compaction/provider-registry.js',
  'packages/agent-compaction/runtime.js',
  'packages/agent-context/authority.js',
  'packages/agent-context/context-assembler.js',
  'packages/agent-context/index.js',
  'packages/agent-context/media-store.js',
  'packages/agent-context/schemas.js',
  'packages/agent-context/token-counter.js',
  'packages/agent-environment/computer-contract.js',
  'packages/agent-environment/index.js',
  'packages/agent-environment/lsp.js',
  'packages/agent-isolation-attestation/artifact-channel.js',
  'packages/agent-isolation-attestation/executor.js',
  'packages/agent-isolation-attestation/index.js',
  'packages/agent-isolation-attestation/profiles.js',
  'packages/agent-memory/index.js',
  'packages/agent-memory/policy.js',
  'packages/agent-memory/store.js',
  'packages/agent-policy-lattice/index.js',
  'packages/agent-runtime-contracts/agent-contracts.js',
  'packages/agent-runtime-contracts/common.js',
  'packages/agent-runtime-contracts/compaction-contracts.js',
  'packages/agent-runtime-contracts/content-parts.js',
  'packages/agent-runtime-contracts/event-contracts.js',
  'packages/agent-runtime-contracts/index.js',
  'packages/agent-runtime-contracts/orchestration-contracts.js',
  'packages/agent-runtime-contracts/ports.js',
  'packages/agent-runtime-contracts/provider-contracts.js',
  'packages/agent-runtime/index.js',
  'packages/agent-runtime/runtime.js',
  'packages/agent-runtime/schemas.js',
  'packages/agent-session-store/index.js',
  'packages/agent-session-store/replay.js',
  'packages/agent-session-store/session-event-store.js',
  'packages/agent-trace-lineage/index.js',
  'packages/governed-execution/canonical-envelope.js',
  'packages/governed-execution/execution-port.js',
  'packages/governed-execution/index.js',
  'packages/governed-execution/operation-id.js',
  'packages/governed-execution/runtime.js',
  'packages/governed-execution/scheduler.js',
  'packages/managed-governance-contracts/canonical-json.js',
  'packages/model-providers/common.js',
  'packages/model-providers/index.js',
  'packages/model-providers/openai-compatible-provider.js',
  'packages/model-providers/registry.js',
  'packages/model-providers/scripted-provider.js',
  'packages/tool-runtime/index.js',
  'packages/tool-runtime/registry.js',
  'packages/tool-runtime/tool-runtime.js',
  'test/fixtures/engineering-task/addition.json',
  'test/helpers/engineering-project.js',
  'tools/cli/command-manifest.json',
  'tools/cli/commands/agent.js',
  'tools/cli/hseos-cli.js',
  'tools/cli/lib/campaign-evidence-store.js',
  'tools/cli/lib/capability-catalog.js',
  'tools/cli/lib/engineering-model.js',
  'tools/cli/lib/engineering-project-verifier.js',
  'tools/cli/lib/engineering-task-contract.js',
  'tools/cli/lib/engineering-task-extensions.js',
  'tools/cli/lib/engineering-task-runtime.js',
  'tools/cli/lib/engineering-task-state.js',
  'tools/cli/lib/engineering-tools.js',
  'tools/cli/lib/engineering-verifier.js',
  'tools/cli/lib/engineering-workspace.js',
  'tools/cli/lib/environment-approval.js',
  'tools/cli/lib/execution-plugin-adapters.js',
  'tools/cli/lib/execution-plugin-runtime.js',
  'tools/cli/lib/job-dispatch.js',
  'tools/cli/lib/job-materialization.js',
  'tools/cli/lib/memory-context-source.js',
  'tools/cli/lib/project-root.js',
  'tools/cli/lib/provider-api-adapter.js',
  'tools/cli/lib/provider-egress-broker.js',
  'tools/cli/lib/sandbox.js',
  'tools/cli/lib/temporary-kernel-assembly.js',
  'tools/cli/lib/terminal-budget.js',
  'tools/lib/agent-provider-binding.js',
  'tools/lib/agentic-activation-rehearsal.js',
  'tools/lib/compatibility-audit.js',
  'tools/lib/compatibility-observation.js',
  'tools/lib/execution-plugin-manifest.js',
  'tools/lib/execution-plugin-selection.js',
  'tools/lib/governed-execution/canonical-envelope.js',
  'tools/lib/governed-execution/contract-registry.js',
  'tools/lib/governed-execution/event-registry.js',
  'tools/lib/governed-execution/execution-port.js',
  'tools/lib/governed-execution/operational-runtime.js',
  'tools/lib/governed-execution/runtime.js',
  'tools/lib/governed-execution/scheduler.js',
  'tools/lib/provider-control-manifest.js',
  'tools/mcp-project-state/lib/execution-approval-store.js',
  'tools/mcp-project-state/lib/execution-event-ledger.js',
  'tools/mcp-project-state/lib/execution-ledger-schema.js',
  'tools/mcp-project-state/lib/execution-projections.js',
  'tools/mcp-project-state/lib/mcp-legacy-usage-store.js',
  'tools/mcp-project-state/lib/migrations.js',
  'tools/mcp-project-state/lib/operational-state-db.js',
]);

const sha = (value) => createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** sha256 of each product file, by repository-relative path; a missing file is an error, never silence. */
function productFileHashes(root) {
  return Object.fromEntries(PRODUCT_FILES.map((name) => [name, sha(fs.readFileSync(path.join(root, name)))]));
}

/** `plan` and `tasks` can be overridden (tests); by default they are the ones loaded next to this file. */
function confirmationHash({
  dir = __dirname,
  root = path.resolve(__dirname, '../../../../..'),
  plan = require('./plan.cjs').PLAN,
  tasks = require('./tasks.cjs').TASKS,
} = {}) {
  const material = {
    plan,
    prices: plan.budget.price_usd_per_million,
    protected_tests: tasks.map((task) => ({
      id: task.id,
      cases: task.cases,
      verifier_checks: task.verifier_checks,
      note_sha256: sha(task.note),
      placebo_note_sha256: sha(task.placebo_note),
    })),
    files: Object.fromEntries(GATED_FILES.map((name) => [name, sha(fs.readFileSync(path.join(dir, name)))])),
    product_files: productFileHashes(root),
  };
  return sha(canonical(material));
}

module.exports = { GATED_FILES, PRODUCT_FILES, productFileHashes, confirmationHash, canonical };
