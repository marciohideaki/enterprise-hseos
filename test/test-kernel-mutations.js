'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const cases = [
  ['workflow_baseline', 'test/test-workflow-expansion.js', 'expansion revalidates baseline after admission'],
  ['workflow_revision', 'test/test-workflow-expansion.js', 'hash, CAS, idempotency, deadline'],
  ['workflow_initial', 'test/test-workflow-expansion.js', 'only initial v2 revision can be created'],
  ['task_completion', 'test/test-engineering-task-runtime.js', 'durable cancellation at model-stop'],
  ['task_cancellation', 'test/test-engineering-task-runtime.js', 'durable cancellation at tool-intent'],
  ['job_shutdown', 'test/test-job-faults.js', 'shutdown during admission cannot'],
  ['job_acceptance', 'test/test-job-faults.js', 'replay rejects false success'],
  ['job_ledger', 'test/test-job-materialization.js', 'a second ledger cannot assemble capabilities'],
  ['job_preparation', 'test/test-job-materialization.js', 'possible task activity blocks completion'],
  ['authority', 'test/test-agent-policy-lattice.js', 'child agents can narrow but cannot widen parent authority'],
  ['budget', 'test/test-agent-policy-lattice.js', 'child agents can narrow but cannot widen parent authority'],
  ['recovery', 'test/test-agent-runtime.js', 'reconciliation retains uncertain evidence'],
];
for (const [mutation, filename, pattern] of cases)
  test(`tests detect removal of the ${mutation} guard`, () => {
    const cwd = path.resolve(__dirname, '..');
    const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', `--test-name-pattern=${pattern}`, filename];
    const options = { cwd, env: { ...process.env }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 };
    delete options.env.HSEOS_TEST_MUTATION;
    // An absent key is re-injected by Node's spawn coverage propagation.
    options.env.NODE_V8_COVERAGE = '';
    delete options.env.NODE_TEST_CONTEXT;
    const control = spawnSync(process.execPath, args, options);
    assert.equal(control.error, undefined);
    assert.equal(control.status, 0, control.stdout + control.stderr);
    assert.match(control.stdout, /# tests 1\b/);
    const mutant = spawnSync(process.execPath, ['--require', './test/fixtures/kernel-mutation-loader.cjs', ...args], {
      ...options,
      env: { ...options.env, HSEOS_TEST_MUTATION: mutation },
    });
    assert.equal(mutant.error, undefined);
    assert.equal(mutant.status, 1, mutant.stdout + mutant.stderr);
    assert.match(mutant.stdout + mutant.stderr, new RegExp(`HSEOS_TEST_MUTATION_APPLIED:${mutation}`));
    assert.match(mutant.stdout, /ERR_ASSERTION/);
  });
