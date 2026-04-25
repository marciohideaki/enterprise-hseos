/**
 * State CLI smoke tests — spawns each `hseos state-*` command against an
 * isolated temp directory. Verifies exit codes and DB creation.
 *
 * Skips cleanly if better-sqlite3 is not installed (since CLI fails open).
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

if (!Database) {
  console.warn('[test-state-cli] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const REPO_ROOT = path.join(__dirname, '..');
const HSEOS_CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');

let pass = 0;
let fail = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    fail++;
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-test-'));
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [HSEOS_CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    ...opts,
  });
}

console.log('State CLI smoke tests');

it('state-emit creates db file and inserts event', () => {
  const dir = makeTempDir();
  const result = runCli([
    'state-emit',
    'start',
    '--directory',
    dir,
    '--run',
    'R-test',
    '--task',
    'T1',
    '--agent',
    'tester',
    '--silent',
  ]);
  if (result.status !== 0) {
    throw new Error(`exit ${result.status}: ${result.stderr || result.stdout}`);
  }
  const dbPath = path.join(dir, '.hseos', 'state', 'project.db');
  if (!fs.existsSync(dbPath)) throw new Error('db not created');
});

it('state-list returns the row from state-emit', () => {
  const dir = makeTempDir();
  runCli(['state-emit', 'start', '--directory', dir, '--run', 'R1', '--task', 'T1', '--agent', 'A', '--silent']);
  const result = runCli(['state-list', '--directory', dir, '--json']);
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
  const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('no runs listed');
  if (rows[0].id !== 'R1') throw new Error(`unexpected run id: ${rows[0].id}`);
});

it('state-describe returns the run summary', () => {
  const dir = makeTempDir();
  runCli(['state-emit', 'heartbeat', '--directory', dir, '--run', 'R1', '--task', 'T1', '--agent', 'A', '--silent']);
  const result = runCli(['state-describe', 'R1', '--directory', dir, '--json']);
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
  const desc = JSON.parse(result.stdout);
  if (desc.kind !== 'run' || desc.run.id !== 'R1') throw new Error('describe payload unexpected');
});

it('state-list --orphans is empty for fresh heartbeat', () => {
  const dir = makeTempDir();
  runCli(['state-emit', 'heartbeat', '--directory', dir, '--run', 'R1', '--task', 'T1', '--agent', 'A', '--silent']);
  const result = runCli(['state-list', '--orphans', '--directory', dir, '--json']);
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
  const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows) || rows.length > 0) {
    throw new Error(`expected 0 orphans, got ${rows.length}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
