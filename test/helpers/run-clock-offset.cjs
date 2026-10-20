'use strict';

// Runs the clock-sensitive test files with the wall clock advanced (see clock-offset.cjs).
// Usage: node test/helpers/run-clock-offset.cjs [--days N] [file ...]
//
// Limitations of the preload (clock-offset.cjs):
// - children spawned with a sanitised env (no NODE_OPTIONS) keep the real clock;
// - file mtimes, performance.now()/process.hrtime and non-Node processes are not shifted.
// Left out of the default list on purpose:
// - test/test-engineering-task-runtime.js: mixed clocks (sanitised-env children, Date.now() vs mtime), not a real dependency;
// - test/journeys/*.mjs: not a node:test file, it needs its own arguments;
// - test/test-mcp-contract.js and test/test-mcp-agent-state.js: the legacy MCP servers stop at the 2026-11-30 sunset
//   by the wall clock and have no clock seam; the owner decision on that sunset is pending.
//
// Default: +400 days over every file that touches liveness, coordination, memory, state, approval,
// lease/TTL or readiness windows. The preload is passed through NODE_OPTIONS with an absolute path so
// child processes spawned by the tests (any cwd) are shifted too.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const preload = path.join(__dirname, 'clock-offset.cjs');

// Deliberately absent (see the report that introduced this runner):
// - test-engineering-task-runtime.js: spawns children with a sanitised env (the preload cannot reach them) and
//   compares Date.now() with file mtimes, which are not shifted: mixed clocks, not a real dependency.
// - test-mcp-contract.js and test-mcp-agent-state.js: spawn the legacy MCP servers, which stop answering at
//   LEGACY_SUNSET (2026-11-30) by the wall clock. Real time bomb with no clock seam in the server processes.
const DEFAULT_FILES = [
  'test/test-liveness-guard.js',
  'test/test-agent-liveness.js',
  'test/test-activity-coordination.js',
  'test/test-agent-memory.js',
  'test/test-w5-negative-matrix.js',
  'test/test-environment-browser.js',
  'test/test-environment-computer.js',
  'test/test-environment-dap.js',
  'test/test-environment-lsp.js',
  'test/test-mcp-2026-adapter.js',
  'test/test-agent-state-dal.js',
  'test/test-operational-state-db.js',
  'test/test-state-ui.js',
  'test/test-state-cli.js',
  'test/test-state-session.js',
  'test/test-state-purge.js',
  'test/test-execution-event-ledger.js',
  'test/test-execution-projections.js',
  'test/test-governed-execution-runtime.js',
  'test/test-workflow-reservations.js',
  'test/test-agent-orchestration.js',
  'test/test-agent-message-transport.js',
  'test/test-agent-session-store.js',
  'test/test-agent-context.js',
  'test/test-agent-runtime-contracts.js',
  'test/test-agentic-framework-foundation.js',
  'test/test-agentic-completion-audit.js',
  'test/test-agentic-activation-rehearsal.js',
  'test/test-compatibility-observation.js',
  'test/test-compatibility-audit.js',
  'test/test-compatibility-evidence-pack.js',
  'test/test-compatibility-evidence-inventory.js',
  'test/test-compaction-resume-fork.js',
  'test/test-delegated-runtime-host.js',
  'test/test-hosted-runtime-adapters.js',
  'test/test-runtime-providers.js',
  'test/test-codex-app-server-driver.js',
  'test/test-tool-runtime.js',
  'test/test-capability-intake-guard.js',
  'test/test-agent-context-authority.js',
  'test/test-claude-agent-sdk-driver.js',
  'test/test-documentation-neutrality.js',
  'test/test-platform-bindings-downgrade.js',
  'test/test-platform-bindings.js',
  'test/test-process-acp-peer.js',
  'test/test-package-surface.js',
];

const args = process.argv.slice(2);
let days = process.env.HSEOS_TEST_CLOCK_OFFSET_DAYS || '400';
if (args[0] === '--days') {
  days = args[1];
  args.splice(0, 2);
}
const files = args.length > 0 ? args : DEFAULT_FILES;

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    HSEOS_TEST_CLOCK_OFFSET_DAYS: String(days),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require ${preload}`,
  },
});
process.exitCode = result.status ?? 1;
