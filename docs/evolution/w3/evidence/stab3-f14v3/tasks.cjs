'use strict';
// The three F14 v3 tasks, designed by the executor (declared limit: the owner did not write them). Each one hides a
// project rule that exists ONLY in the memory note. The requirement given to the model never cites the rule or the memory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, 'tasks');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

const TASKS = [
  {
    id: 'invoice',
    file: 'invoice.js',
    export: 'formatInvoiceId',
    project_id: 'f14v3-invoice',
    memory_id: 'f14v3-invoice-rule',
    requirement:
      'In invoice.js, export with module.exports a function formatInvoiceId(seq, date) that returns the invoice identifier. seq is a positive integer and date is an ISO string such as "2026-03-01". Follow the project convention.',
    note: 'Project convention for invoice identifiers: INV-<year in base 36, uppercase>-<sequence zero-padded to 5 digits>-<d>, where d = (sum of the decimal digits of the 5-digit sequence + the year) mod 7. Example: sequence 42 on 2026-03-01 gives INV-1KA-00042-2.',
    cases: [
      { id: 'example', args: [42, '2026-03-01'], expected: 'INV-1KA-00042-2' },
      { id: 'first', args: [1, '2026-01-15'], expected: 'INV-1KA-00001-4' },
      { id: 'max', args: [99_999, '2025-12-31'], expected: 'INV-1K9-99999-5' },
      { id: 'mid', args: [12_345, '2030-06-30'], expected: 'INV-1KE-12345-1' },
      { id: 'old', args: [7, '2000-07-07'], expected: 'INV-1JK-00007-5' },
    ],
  },
  {
    id: 'retry',
    file: 'retry.js',
    export: 'retryDelayMs',
    project_id: 'f14v3-retry',
    memory_id: 'f14v3-retry-rule',
    requirement:
      'In retry.js, export with module.exports a function retryDelayMs(attempt) that returns the wait before the given retry attempt. Follow the project convention.',
    note: 'Project convention for retry delays: attempts 1 to 4 wait 250, 1000, 1000 and 5000 milliseconds; attempt 5 or later returns null (give up); an attempt that is not an integer or is below 1 throws RangeError.',
    cases: [
      { id: 'a1', args: [1], expected: 250 },
      { id: 'a2', args: [2], expected: 1000 },
      { id: 'a3', args: [3], expected: 1000 },
      { id: 'a4', args: [4], expected: 5000 },
      { id: 'a5', args: [5], expected: null },
      { id: 'a9', args: [9], expected: null },
      { id: 'zero', args: [0], throws: 'RangeError' },
      { id: 'fraction', args: [1.5], throws: 'RangeError' },
      { id: 'string', args: ['2'], throws: 'RangeError' },
    ],
  },
  {
    id: 'priority',
    file: 'priority.js',
    export: 'classifyPriority',
    project_id: 'f14v3-priority',
    memory_id: 'f14v3-priority-rule',
    requirement:
      'In priority.js, export with module.exports a function classifyPriority(ticket) that returns the priority label of a support ticket shaped { severity: string, tags: string[] }. Follow the project convention.',
    note: 'Project convention for ticket priority: a ticket tagged billing is always P2; otherwise severity critical is P1, high is P2, medium is P3 and low is P4; an unknown severity throws Error.',
    cases: [
      { id: 'critical', args: [{ severity: 'critical', tags: [] }], expected: 'P1' },
      { id: 'high', args: [{ severity: 'high', tags: ['ux'] }], expected: 'P2' },
      { id: 'medium', args: [{ severity: 'medium', tags: [] }], expected: 'P3' },
      { id: 'low', args: [{ severity: 'low', tags: [] }], expected: 'P4' },
      { id: 'billing-low', args: [{ severity: 'low', tags: ['billing'] }], expected: 'P2' },
      { id: 'billing-critical', args: [{ severity: 'critical', tags: ['x', 'billing'] }], expected: 'P2' },
      { id: 'billing-unknown', args: [{ severity: 'urgent', tags: ['billing'] }], expected: 'P2' },
      { id: 'unknown', args: [{ severity: 'urgent', tags: [] }], throws: 'Error' },
    ],
  },
];

for (const task of TASKS) {
  const stem = task.file.replace(/\.js$/, '');
  task.naive = read(`${stem}.naive.fixture.txt`);
  task.correct = read(`${stem}.correct.fixture.txt`);
  task.stub = `module.exports = function ${task.export}() {\n  throw new Error('not implemented');\n};\n`;
  // The product verifier compares returned values only, so it carries the non-throwing cases; the throwing ones live in the
  // protected runner below. Both run on every execution.
  task.verifier_checks = task.cases
    .filter((item) => !item.throws)
    .map((item, index) => ({ id: `c${index + 1}`, path: task.file, export_name: 'default', args: item.args, expected: item.expected }));
}

/** Runs the protected cases against candidate source text, in a child process with a minimal environment. */
function runProtected(task, source, { timeoutMs = 10_000 } = {}) {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f14v3-protected-'));
  try {
    const candidate = path.join(scratch, task.file);
    fs.writeFileSync(candidate, source);
    const run = spawnSync(process.execPath, [path.join(__dirname, 'protected-runner.cjs'), candidate, JSON.stringify(task.cases)], {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { PATH: process.env.PATH, TMPDIR: scratch },
      cwd: scratch,
    });
    let results = null;
    try {
      results = JSON.parse((run.stdout || '').trim().split('\n').at(-1));
    } catch (error) {
      results = null;
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (!Array.isArray(results) || results.length !== task.cases.length)
      return { pass: false, passed: 0, total: task.cases.length, failed: ['runner-failed'], results: [] };
    const failed = results.filter((item) => !item.pass).map((item) => item.id);
    return { pass: failed.length === 0, passed: results.length - failed.length, total: results.length, failed, results };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Filter (i): the naive reference must FAIL the protected tests and the correct one must PASS, offline, at no cost. */
function runFilter() {
  const tasks = TASKS.map((task) => {
    const naive = runProtected(task, task.naive);
    const correct = runProtected(task, task.correct);
    const stub = runProtected(task, task.stub);
    return {
      id: task.id,
      naive: { pass: naive.pass, passed: naive.passed, total: naive.total, failed: naive.failed },
      correct: { pass: correct.pass, passed: correct.passed, total: correct.total, failed: correct.failed },
      stub_fails: !stub.pass,
      accepted: !naive.pass && correct.pass && !stub.pass,
    };
  });
  return { filter: 'i-naive-fails-correct-passes', accepted: tasks.every((item) => item.accepted), tasks };
}

module.exports = { TASKS, runProtected, runFilter };
