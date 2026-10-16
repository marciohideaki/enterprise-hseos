'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPECTED = 29;
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', 'test/test-w5-mutations.js'], {
  cwd: path.resolve(__dirname, '../..'),
  encoding: 'utf8',
  timeout: 600_000,
  maxBuffer: 8 * 1024 * 1024,
});
if (
  result.error ||
  result.status !== 0 ||
  !new RegExp(`^# tests ${EXPECTED}$`, 'm').test(result.stdout) ||
  !new RegExp(`^# pass ${EXPECTED}$`, 'm').test(result.stdout) ||
  !/^# fail 0$/m.test(result.stdout) ||
  !/^# skipped 0$/m.test(result.stdout)
) {
  process.stderr.write(result.stdout + result.stderr);
  throw result.error || new Error(`W5 mutation matrix did not reject all ${EXPECTED - 1} mutants`);
}
process.stdout.write(`W5 mutation matrix: ${EXPECTED - 1} mutants rejected, 0 failed, 0 skipped\n`);
