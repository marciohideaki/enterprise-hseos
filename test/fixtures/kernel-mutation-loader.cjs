'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const mutations = {
  task_completion: [
    'tools/cli/lib/engineering-task-runtime.js',
    "completion_review: async ({ step }) => {\n      if (observeTaskCancellation()) throw Object.assign(new Error('Task cancelled'), { code: 'ENGINEERING_TASK_CANCELLED' });",
    'completion_review: async ({ step }) => {\n      if (observeTaskCancellation()) return null;',
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
  module._compile(source.replace(before, after), filename);
};
