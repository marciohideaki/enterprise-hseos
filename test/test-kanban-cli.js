/**
 * Kanban CLI ASCII smoke — spawns `hseos kanban` against a tmp directory
 * with a pre-seeded SQLite, verifies non-zero column rendering.
 *
 * Skips cleanly if better-sqlite3 is not installed.
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
  console.warn('[test-kanban-cli] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const REPO_ROOT = path.join(__dirname, '..');
const HSEOS_CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');

let pass = 0;
let fail = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    pass++;
  } catch (error) {
    console.log(`  \u2717 ${name}\n    ${error.message}`);
    fail++;
  }
}

function seedDb(dir) {
  const dbPath = path.join(dir, '.hseos', 'state', 'project.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // Run state-emit to bootstrap schema and a few rows, mirrors real usage.
  const result = spawnSync(
    process.execPath,
    [HSEOS_CLI, 'state-emit', 'start', '--directory', dir, '--run', 'R-test', '--task', 'T1', '--agent', 'A', '--silent'],
    { encoding: 'utf8', timeout: 10_000 }
  );
  if (result.status !== 0) {
    throw new Error(`seed state-emit failed: ${result.stderr}`);
  }
  return dbPath;
}

console.log('Kanban CLI ASCII smoke');

it('hseos kanban exits 0 and renders all 5 columns', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-kanban-'));
  seedDb(tmp);
  const result = spawnSync(process.execPath, [HSEOS_CLI, 'kanban', '--directory', tmp], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr || result.stdout}`);
  const out = result.stdout;
  for (const col of ['Pending', 'Running', 'Completed', 'Aborted', 'Orphaned']) {
    if (!out.includes(col)) throw new Error(`column "${col}" missing in output`);
  }
});

it('hseos kanban shows the seeded run id', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-kanban-'));
  seedDb(tmp);
  const result = spawnSync(process.execPath, [HSEOS_CLI, 'kanban', '--directory', tmp], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  if (result.status !== 0) throw new Error(`exit ${result.status}`);
  if (!result.stdout.includes('R-test')) throw new Error('run id R-test not in output');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
