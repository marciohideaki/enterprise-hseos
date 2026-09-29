'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const mutations = {
  workflow_baseline: ['tools/cli/lib/job-control.js', "reject('JOB_BASELINE_DRIFT');", 'void 0;'],
  workflow_revision: ['tools/cli/lib/job-control.js', "if (jobDigest(previous) !== command.input.definition_sha256)", 'if (false)'],
  workflow_initial: ['tools/cli/lib/job-control.js', 'function assertInitialWorkflow(input) {', 'function assertInitialWorkflow(input) { return;'],
  reservation_claim: ['packages/agent-session-store/replay.js', 'reservation.claim_ref !== claimRef || state.cancellation_request', 'false || state.cancellation_request'],
  reservation_budget: ['packages/agent-session-store/replay.js', 'steps.reduce((sum, step) => sum + step.child_spec.limits[name], 0) > state.spec.limits[name]', 'false'],
  reservation_fence: ['packages/agent-orchestration/workflow-engine.js', 'if (!reservation.revisions.some((item) => item.definition_digest === digest(workflow)))', 'if (false)'],
  reservation_release: ['packages/agent-orchestration/workflow-engine.js', 'if (latestState.cancellation_request) {', 'if (false) {'],
  reservation_current: ['packages/agent-orchestration/workflow-engine.js', 'return reservation.revisions.at(-1).definition;', 'return workflow;'],
  reservation_checkpoint_cas: ['packages/agent-orchestration/workflow-engine.js', "['AGENT_SESSION_VERSION_CONFLICT', 'EXECUTION_STREAM_VERSION_CONFLICT'].includes(error?.code)", "['AGENT_SESSION_VERSION_CONFLICT'].includes(error?.code)"],
  task_completion: [
    'packages/agent-runtime/runtime.js',
    "if (state.cancellation_request) return this.#settleCancellation(state, active);\n    return this.#terminalize(state, 'session.completed'",
    "if (false) return this.#settleCancellation(state, active);\n    return this.#terminalize(state, 'session.completed'",
  ],
  task_cancellation: ['tools/cli/lib/engineering-task-runtime.js', 'function observeTaskCancellation() {', 'function observeTaskCancellation() { return false;'],
  job_shutdown: ['tools/cli/lib/job-dispatch.js', "if (this.#closing) reject('JOB_WORKER_CLOSING');", 'if (false) {}'],
  job_acceptance: ['tools/cli/lib/job-dispatch.js', '!approved || state.cancellation_requested', 'false'],
  job_ledger: ['tools/mcp-project-state/lib/execution-ledger-schema.js',
    'if (!identity || db.name !== fixture.filename || identity.ino !== current.ino || identity.dev !== current.dev)', 'if (false)'],
  job_preparation: ['tools/cli/lib/job-materialization.js', 'task.version > 1 ||', 'false ||'],
  authority: ['packages/agent-policy-lattice/index.js', 'if (widened.length > 0)', 'if (false)'],
  budget: ['packages/agent-policy-lattice/index.js', 'if (requestedLimit > parentLimit)', 'if (false)'],
  recovery: ['packages/agent-session-store/replay.js', "execution.outcome?.status !== 'uncertain'", 'false'],
};
const selected = mutations[process.env.HSEOS_TEST_MUTATION];
if (!selected) throw new Error('Unknown test mutation');
const [relative, before, after] = selected;
const target = path.resolve(__dirname, '../..', relative);
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (filename !== target) return original(module, filename);
  const source = fs.readFileSync(filename, 'utf8');
  if (source.split(before).length !== 2) throw new Error('Mutation anchor must occur exactly once');
  process.stderr.write(`HSEOS_TEST_MUTATION_APPLIED:${process.env.HSEOS_TEST_MUTATION}\n`);
  let mutated = source.replace(before, after);
  if (process.env.HSEOS_TEST_MUTATION === 'reservation_release') {
    const cancellationFallback = 'Boolean(this.#store.replay(input.parent_session_id).cancellation_request);';
    if (mutated.split(cancellationFallback).length !== 2) throw new Error('Mutation cancellation fallback anchor must occur exactly once');
    mutated = mutated.replace(cancellationFallback, 'false;');
  }
  module._compile(mutated, filename);
};
