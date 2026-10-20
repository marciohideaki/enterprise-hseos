'use strict';

// Runs the clock-sensitive test files with the wall clock advanced (see clock-offset.cjs).
// Usage: node test/helpers/run-clock-offset.cjs [--days N] [--list] [file ...]
//   npm run test:clock-offset                      +400 days over the selected files
//   npm run test:clock-offset -- --days 0          control run, no shift
//   npm run test:clock-offset -- --list            print selected and excluded files (with reasons) and exit
//
// Selection is automatic: every test/test-*.js whose source matches TIME_PATTERN (time words or real-clock reads), minus EXCLUDED (each with a reason).
// A new test that talks about time is picked up without anyone editing a list.
//
// Limitations of the preload (clock-offset.cjs):
// - children spawned with a sanitised env (no NODE_OPTIONS) keep the real clock;
// - file mtimes, performance.now()/process.hrtime and non-Node processes are not shifted;
// - a test that mocks Date.now composes with the offset (the mock replaces the shifted function);
//   Date.prototype.constructor is the real Date, so `x.constructor === Date` is false for instances.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const preload = path.join(__dirname, 'clock-offset.cjs');

// Time vocabulary, or a direct read of the real clock (Date.now(), new Date() without arguments, SQLite 'now').
const TIME_PATTERN =
  /\b(liveness|lease|ttl|expir[a-z]*|approval|deadline|stale|heartbeat|retention|sunset|window|2026-\d\d)|Date\.now\(|new Date\(\)|datetime\('now'/i;

const EXCLUDED = {
  'test/test-engineering-task-runtime.js':
    'mixed clocks: children spawned with a sanitised env keep the real clock and Date.now() is compared with file mtimes',
  'test/test-mcp-contract.js':
    'legacy MCP servers stop at the 2026-11-30 sunset by the wall clock; covered by W0-5, which pins the clock of the legacy children',
  'test/test-mcp-hseos-governance.js': 'same as test-mcp-contract.js (legacy MCP server over --port); covered by W0-5',
  'test/test-mcp-hseos-swarm-scope.js': 'same as test-mcp-contract.js (legacy MCP server over --port); covered by W0-5',
  'test/test-mcp-agent-state.js': 'same as test-mcp-contract.js (legacy MCP server process, no clock seam); covered by W0-5',
};

function selection() {
  const all = fs
    .readdirSync(path.join(root, 'test'))
    .filter((name) => /^test-.*\.js$/.test(name))
    .map((name) => `test/${name}`)
    .sort();
  const matching = all.filter((file) => TIME_PATTERN.test(fs.readFileSync(path.join(root, file), 'utf8')));
  return {
    all,
    selected: matching.filter((file) => !EXCLUDED[file]),
    excluded: matching.filter((file) => EXCLUDED[file]),
  };
}

const args = process.argv.slice(2);
let days = process.env.HSEOS_TEST_CLOCK_OFFSET_DAYS || '400';
let list = false;
while (args[0]?.startsWith('--')) {
  const flag = args.shift();
  if (flag === '--days') days = args.shift();
  else if (flag === '--list') list = true;
  else throw new Error(`unknown flag ${flag}`);
}

const { all, selected, excluded } = selection();
if (list) {
  console.log(
    `test files: ${all.length}, selected: ${selected.length}, excluded: ${excluded.length}, not time-related: ${all.length - selected.length - excluded.length}`,
  );
  for (const file of selected) console.log(`selected ${file}`);
  for (const file of excluded) console.log(`excluded ${file}: ${EXCLUDED[file]}`);
} else {
  const files = args.length > 0 ? args : selected;
  const env = {
    ...process.env,
    HSEOS_TEST_CLOCK_OFFSET_DAYS: String(days),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require ${preload}`,
  };
  // Plain scripts (no node:test) run with plain node, as npm test does: some of them fail under node --test even with no offset.
  const runner = files.filter((file) => /node:test/.test(fs.readFileSync(path.join(root, file), 'utf8')));
  const scripts = files.filter((file) => !runner.includes(file));
  const runs = [];
  if (runner.length > 0) runs.push(['--test', '--test-concurrency=1', ...runner]);
  for (const file of scripts) runs.push([file]);
  process.exitCode = 0;
  for (const argv of runs) {
    const result = spawnSync(process.execPath, argv, { cwd: root, stdio: 'inherit', env });
    if (result.status !== 0) {
      console.error(`clock-offset: FAILED (exit ${result.status}): node ${argv.join(' ')}`);
      process.exitCode = 1;
    }
  }
}
