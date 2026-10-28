'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MUTANTS } = require('../../test/fixtures/w5-mutants.cjs');

// The matrix runs one test per mutant plus the group-coverage test, so the expected count follows the mutant table.
const EXPECTED = MUTANTS.length + 1;

// Pure verdict on the TAP summary of a matrix run: every test ran and passed, and none failed, skipped or is a todo.
function checkTap(stdout, expected) {
  const problems = [];
  // Each top-level summary line must appear exactly once: a repeated line (a nested run) cannot hide a bad total.
  const summary = (name) => [...stdout.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))].map((match) => match[1]);
  for (const [name, want] of [
    ['tests', String(expected)],
    ['pass', String(expected)],
    ['fail', '0'],
    ['skipped', '0'],
    ['todo', '0'],
  ]) {
    const found = summary(name);
    if (found.length !== 1) problems.push(`# ${name} appears ${found.length} times, expected once`);
    else if (found[0] !== want) problems.push(`# ${name} is ${found[0]}, expected ${want}`);
  }
  return { ok: problems.length === 0, problems };
}

function main() {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', 'test/test-w5-mutations.js'], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const verdict = checkTap(result.stdout ?? '', EXPECTED);
  if (result.error || result.status !== 0 || !verdict.ok) {
    process.stderr.write((result.stdout ?? '') + (result.stderr ?? ''));
    throw (
      result.error ||
      new Error(
        `W5 mutation matrix did not reject all ${MUTANTS.length} mutants: ${verdict.problems.join('; ') || `exit ${result.status}`}`,
      )
    );
  }
  process.stdout.write(`W5 mutation matrix: ${MUTANTS.length} mutants rejected, 0 failed, 0 skipped\n`);
}

if (require.main === module) main();

module.exports = { EXPECTED, checkTap };
