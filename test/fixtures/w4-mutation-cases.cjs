'use strict';

// Data only: the W4 mutation cases. test/test-kernel-mutations.js runs one test per entry and
// scripts/governance/check-w4-mutations.js derives the expected test count from the length.
const cases = [
  ['workflow_baseline', 'test/test-workflow-expansion.js', 'expansion revalidates baseline after admission'],
  ['workflow_revision', 'test/test-workflow-expansion.js', 'hash, CAS, idempotency, deadline'],
  ['workflow_initial', 'test/test-workflow-expansion.js', 'only initial v2 revision can be created'],
  ['reservation_claim', 'test/test-workflow-reservations.js', 'revision rejects stale claim'],
  ['reservation_budget', 'test/test-workflow-reservations.js', 'revision enforces original resource'],
  ['reservation_fence', 'test/test-workflow-reservations.js', 'revision-aware engine rejects a forged caller definition'],
  ['reservation_release', 'test/test-workflow-reservations.js', 'durable cancellation winning the release CAS'],
  ['reservation_current', 'test/test-workflow-reservations.js', 'engine reclaims an expired revised reservation'],
  ['reservation_checkpoint_cas', 'test/test-workflow-reservations.js', 'checkpoint CAS retries after an append-only revision'],
  ['task_completion', 'test/test-agent-orchestration.js', 'cancellation recorded during protected review'],
  ['session_failure_reason', 'test/test-engineering-task-runtime.js', 'exhausts its token budget reports'],
  ['stopped_session_budget', 'test/test-agent-runtime.js', 'stops within its window completes'],
  ['task_cancellation', 'test/test-engineering-task-runtime.js', 'durable cancellation at tool-intent'],
  ['job_shutdown', 'test/test-job-faults.js', 'shutdown during admission cannot'],
  ['job_acceptance', 'test/test-job-faults.js', 'replay rejects false success'],
  ['job_ledger', 'test/test-job-materialization.js', 'a second ledger cannot assemble capabilities'],
  ['job_preparation', 'test/test-job-materialization.js', 'possible task activity blocks completion'],
  ['authority', 'test/test-agent-policy-lattice.js', 'child agents can narrow but cannot widen parent authority'],
  ['budget', 'test/test-agent-policy-lattice.js', 'child agents can narrow but cannot widen parent authority'],
  ['recovery', 'test/test-agent-runtime.js', 'reconciliation retains uncertain evidence'],
];

module.exports = { cases };
