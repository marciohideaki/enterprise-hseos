/**
 * state-emit-hook.sh integration tests
 *
 * Validates the SQLite auto-detection added to state-emit-hook.sh:
 * - Silent no-op when no context and no DB
 * - Auto-detects active run at SessionStart when RUN_ID unset
 * - Skips auto-detection when HSEOS_CURRENT_RUN_ID already set
 * - Non-SessionStart with no context → silent skip
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const HOOK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'governance', 'state-emit-hook.sh');

let passed = 0;
let failed = 0;

function assertPass(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${details ? ` — ${details}` : ''}`);
    failed++;
  }
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-emit-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Create a minimal as_runs schema and insert one row. */
function seedDb(dbPath, runId, status = 'active') {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS as_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      project TEXT,
      phase TEXT DEFAULT 'intake',
      gate_status TEXT DEFAULT 'PASS',
      status TEXT DEFAULT 'active',
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      session_id TEXT
    )
  `);
  db.prepare('INSERT INTO as_runs (id, project, status) VALUES (?, ?, ?)').run(runId, 'test', status);
  db.close();
}

/**
 * Build a fake `hseos` bin in tempDir/bin that writes its args to a capture file.
 * Returns { fakeBin, captureFile }.
 */
function buildFakeHseos(tempDir) {
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const captureFile = path.join(tempDir, 'hseos-args.txt');
  const fakeBin = path.join(binDir, 'hseos');
  fs.writeFileSync(fakeBin, `#!/bin/sh\necho "$@" >> "${captureFile}"\n`);
  fs.chmodSync(fakeBin, 0o755);
  return { fakeBin, binDir, captureFile };
}

function runHook(env = {}) {
  try {
    const output = execFileSync('bash', [HOOK_SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8000,
      env: { PATH: process.env.PATH, ...env },
    });
    return { ok: true, stdout: output, exitCode: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? error.stdout.toString() : '',
      stderr: error.stderr ? error.stderr.toString() : '',
      exitCode: error.status ?? 1,
    };
  }
}

/** Poll a file until it exists and is non-empty, or timeout. */
function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content.length > 0) return content;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return '';
}

// =============================================================================
// Tests
// =============================================================================

assertPass('state-emit-hook.sh exists', fs.existsSync(HOOK_SCRIPT), HOOK_SCRIPT);
assertPass(
  'state-emit-hook.sh is executable',
  (fs.statSync(HOOK_SCRIPT).mode & 0o111) !== 0,
);

// No context, no DB → silent exit 0
withTempDir((dir) => {
  const result = runHook({ CLAUDE_HOOK_EVENT: 'SessionStart', HOME: dir });
  assertPass(
    'no-context + no DB → silent exit 0',
    result.ok && result.stdout.trim() === '',
    `exit=${result.exitCode} stderr="${result.stderr?.trim()}"`,
  );
});

// DB exists but no active run → silent exit 0
withTempDir((dir) => {
  const dbDir = path.join(dir, '.hseos', 'state');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'project.db');
  seedDb(dbPath, '20260509-completed-run', 'completed');

  const result = runHook({
    CLAUDE_HOOK_EVENT: 'SessionStart',
    HSEOS_STATE_DB: dbPath,
    HOME: dir,
  });
  assertPass(
    'DB with completed run only → silent exit 0',
    result.ok && result.stdout.trim() === '',
    `exit=${result.exitCode}`,
  );
});

// DB has active run → hook calls hseos with --run <id>
withTempDir((dir) => {
  const dbDir = path.join(dir, '.hseos', 'state');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'project.db');
  seedDb(dbPath, '20260509-active-run');

  const { binDir, captureFile } = buildFakeHseos(dir);

  const result = runHook({
    CLAUDE_HOOK_EVENT: 'SessionStart',
    HSEOS_STATE_DB: dbPath,
    PATH: `${binDir}:${process.env.PATH}`,
    HOME: dir,
  });

  const captured = waitForFile(captureFile);

  assertPass(
    'active run in DB → hook exits 0',
    result.ok,
    `exit=${result.exitCode} stderr="${result.stderr?.trim()}"`,
  );
  assertPass(
    'active run in DB → hseos called with correct --run id',
    captured.includes('--run') && captured.includes('20260509-active-run'),
    `captured="${captured}"`,
  );
  assertPass(
    'active run in DB → kind=start passed to state-emit',
    captured.includes('state-emit') && captured.includes('start'),
    `captured="${captured}"`,
  );
});

// HSEOS_CURRENT_RUN_ID already set → uses it, does NOT query DB
withTempDir((dir) => {
  const dbDir = path.join(dir, '.hseos', 'state');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'project.db');
  seedDb(dbPath, '20260509-db-run');

  const { binDir, captureFile } = buildFakeHseos(dir);

  runHook({
    CLAUDE_HOOK_EVENT: 'SessionStart',
    HSEOS_CURRENT_RUN_ID: '20260509-env-run',
    HSEOS_STATE_DB: dbPath,
    PATH: `${binDir}:${process.env.PATH}`,
    HOME: dir,
  });

  const captured = waitForFile(captureFile);

  assertPass(
    'env RUN_ID takes precedence over DB',
    captured.includes('20260509-env-run') && !captured.includes('20260509-db-run'),
    `captured="${captured}"`,
  );
});

// Non-SessionStart with no context → silent skip (unchanged behaviour)
withTempDir((dir) => {
  const result = runHook({ CLAUDE_HOOK_EVENT: 'PostToolUse', CLAUDE_TOOL_NAME: 'Edit', HOME: dir });
  assertPass(
    'PostToolUse + no context → silent exit 0',
    result.ok && result.stdout.trim() === '',
    `exit=${result.exitCode}`,
  );
});

// =============================================================================
console.log(`\nState-emit hook tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
