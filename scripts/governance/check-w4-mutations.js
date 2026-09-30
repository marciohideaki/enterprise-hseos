'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', 'test/test-kernel-mutations.js'], {
  cwd: path.resolve(__dirname, '../..'),
  encoding: 'utf8',
  timeout: 120_000,
  maxBuffer: 4 * 1024 * 1024,
});
if (
  result.error ||
  result.status !== 0 ||
  !/^# tests 18$/m.test(result.stdout) ||
  !/^# pass 18$/m.test(result.stdout) ||
  !/^# fail 0$/m.test(result.stdout) ||
  !/^# skipped 0$/m.test(result.stdout)
) {
  process.stderr.write(result.stdout + result.stderr);
  throw result.error || new Error('W4 mutation matrix did not reject all 18 mutants');
}
process.stdout.write('W4 mutation matrix: 18 rejected, 0 failed, 0 skipped\n');
