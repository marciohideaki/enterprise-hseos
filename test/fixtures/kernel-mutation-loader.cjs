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
  session_failure_reason: [
    'tools/cli/lib/engineering-task-runtime.js',
    "errorCode === 'budget_exceeded' ? 'session-budget-exceeded' : `session-failed:${errorCode}`",
    "'session-not-completed'",
  ],
  stopped_session_budget: ['packages/agent-runtime/runtime.js', "terminal.payload.finish_reason !== 'stop') {\n          const used", "true) {\n          const used"],
  task_cancellation: ['tools/cli/lib/engineering-task-runtime.js', 'function observeTaskCancellation() {', 'function observeTaskCancellation() { return false;'],
  job_shutdown: ['tools/cli/lib/job-dispatch.js', "if (this.#closing) reject('JOB_WORKER_CLOSING');", 'if (false) {}'],
  job_acceptance: ['tools/cli/lib/job-dispatch.js', '!approved || state.cancellation_requested', 'false'],
  job_ledger: ['tools/mcp-project-state/lib/execution-ledger-schema.js',
    'if (!identity || db.name !== fixture.filename || identity.ino !== current.ino || identity.dev !== current.dev)', 'if (false)'],
  job_preparation: ['tools/cli/lib/job-materialization.js', 'task.version > 1 ||', 'false ||'],
  authority: ['packages/agent-policy-lattice/index.js', 'if (widened.length > 0)', 'if (false)'],
  budget: ['packages/agent-policy-lattice/index.js', 'if (requestedLimit > parentLimit)', 'if (false)'],
  recovery: ['packages/agent-session-store/replay.js', "execution.outcome?.status !== 'uncertain'", 'false'],
  older_pending: ["packages/agent-session-store/replay.js", "if (turn.pending_older_compaction) throw orderViolation(", "if (false) throw orderViolation("],
  older_strategy: ["packages/agent-session-store/replay.js", "if (event.payload.strategy !== 'tool_result_prune') throw orderViolation(", "if (false) throw orderViolation("],
  older_after_current: ["packages/agent-session-store/replay.js", "if (turn.tool_compactions.some((candidate) => canonicalJson(candidate.source_event_ids) === canonicalJson(currentIds))) {", "if (false) {"],
  older_source_unknown: ["packages/agent-session-store/replay.js", "if (!execution?.outcome) throw lineageViolation(", "if (false) throw lineageViolation("],
  older_source_current: ["packages/agent-session-store/replay.js", "if (!(stepIndex.get(execution.step_id) < lastIndex))", "if (false)"],
  older_source_order: ["packages/agent-session-store/replay.js", "if (position <= cursor) throw lineageViolation(", "if (false) throw lineageViolation("],
  older_source_verbatim: ["packages/agent-session-store/replay.js", "if (canonicalJson(step.request.messages[position]) !== canonicalJson(durable)) {", "if (false) {"],
  older_identity: ["packages/agent-session-store/replay.js", "if (replacement?.tool_call_id !== execution.tool_call_id)", "if (false)"],
  older_name: ["packages/agent-session-store/replay.js", "if (replacement.name !== execution.name)", "if (false)"],
  older_count: ["packages/agent-session-store/replay.js", "if (event.payload.replacement_messages.length !== sources.length) {", "if (false) {"],
  older_stub: ["packages/agent-session-store/replay.js", "if (violation) {", "if (false) {"],
  compaction_duplicate_id: ["packages/agent-session-store/replay.js", "compaction.compaction_id === event.payload.compaction_id ||", "false ||"],
  compaction_duplicate_ref: ["packages/agent-session-store/replay.js", "compaction.checkpoint_ref === event.payload.checkpoint_ref ||", "false ||"],
  compaction_duplicate_sources: ["packages/agent-session-store/replay.js", "canonicalJson(compaction.source_event_ids) === canonicalJson(event.payload.source_event_ids)", "false"],
  older_request_sources: ["packages/agent-session-store/replay.js", "...(olderRecord ? [olderRecord.event_id] : []),", ""],
  older_request_prefix: ["packages/agent-session-store/replay.js", "canonicalJson(prefix) !== canonicalJson(expectedPrefix) ||", "false ||"],
  older_pending_reset: ["packages/agent-session-store/replay.js", "turn.pending_older_compaction = null;\n        turn.model_steps.push(step);", "turn.model_steps.push(step);"],
  older_pending_set: ["packages/agent-session-store/replay.js", "if (olderCompaction) turn.pending_older_compaction = compaction;", ""],
  stub_unmarked: ["packages/agent-runtime-contracts/compaction-contracts.js", "if (stub.pruned !== true) return", "if (false) return"],
  stub_body_field: ["packages/agent-runtime-contracts/compaction-contracts.js", "if (Object.keys(stub).some((key) => !PRUNED_STUB_KEYS.includes(key))) return", "if (false) return"],
  stub_digest: ["packages/agent-runtime-contracts/compaction-contracts.js", "if (stub.result_digest !== expected.result_digest) return", "if (false) return"],
  stub_metadata: ["packages/agent-runtime-contracts/compaction-contracts.js", "for (const key of ['status', 'error', 'sha256', 'path']) {", "for (const key of []) {"],
  stub_evidence: ["packages/agent-runtime-contracts/compaction-contracts.js", "for (const key of ['evidence_refs', 'warnings']) {", "for (const key of []) {"],
  older_stub_evidence: ["packages/agent-runtime-contracts/compaction-contracts.js", "for (const key of ['evidence_refs', 'warnings']) {", "for (const key of []) {"],
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
