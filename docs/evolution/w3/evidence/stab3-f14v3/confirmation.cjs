'use strict';
// Confirmation gate of the real F14 v3 execution. The real mode runs only when F14V3_REAL_CONFIRMED equals the hash below,
// which the owner reads from `node f14v3.cjs --print-confirmation` and gives back. The hash covers what DECIDES the campaign:
// the plan, the prices, the protected cases and the code listed in GATED_FILES. It does not cover the rehearsal results.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const GATED_FILES = Object.freeze([
  'f14v3.cjs',
  'guard.cjs',
  'stats.cjs',
  'protected-runner.cjs',
  'tasks.cjs',
  'plan.cjs',
  'secret-scan.cjs',
  'confirmation.cjs',
  'tasks/invoice.naive.fixture.txt',
  'tasks/invoice.correct.fixture.txt',
  'tasks/retry.naive.fixture.txt',
  'tasks/retry.correct.fixture.txt',
  'tasks/priority.naive.fixture.txt',
  'tasks/priority.correct.fixture.txt',
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

/** `plan` and `tasks` can be overridden (tests); by default they are the ones loaded next to this file. */
function confirmationHash({ dir = __dirname, plan = require('./plan.cjs').PLAN, tasks = require('./tasks.cjs').TASKS } = {}) {
  const material = {
    plan,
    prices: plan.budget.price_usd_per_million,
    protected_tests: tasks.map((task) => ({ id: task.id, cases: task.cases, verifier_checks: task.verifier_checks })),
    files: Object.fromEntries(GATED_FILES.map((name) => [name, sha(fs.readFileSync(path.join(dir, name)))])),
  };
  return sha(canonical(material));
}

module.exports = { GATED_FILES, confirmationHash, canonical };
