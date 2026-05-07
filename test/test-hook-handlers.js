/**
 * Hook Handlers Integration Tests
 *
 * Smoke-tests the .agents/hooks/handlers/ shell scripts. Each handler
 * is invoked with a mock event payload (typically a fixture file path)
 * and the test asserts:
 *   - Exit code 0 (best-effort: handlers never block)
 *   - Expected stdout pattern (warn message vs silent no-op)
 *   - Idempotency: running twice produces the same stdout
 *
 * Wave 4 implementation slice — each handler lands as its own commit
 * adding to this suite.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const HANDLERS_DIR = path.join(REPO_ROOT, '.agents', 'hooks', 'handlers');

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

function runHandler(scriptPath, args, options = {}) {
  try {
    const output = execFileSync('bash', [scriptPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      ...options,
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

function withTempDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-hook-test-'));
  try {
    fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// =============================================================================
// plan-lint.sh
// =============================================================================

function testPlanLint() {
  const scriptPath = path.join(HANDLERS_DIR, 'plan-lint.sh');

  assertPass(
    'plan-lint.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'plan-lint.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  // Empty arg → silent no-op
  {
    const result = runHandler(scriptPath, []);
    assertPass(
      'plan-lint.sh with no arg exits 0 silently',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  }

  // Non-plan file path → silent no-op
  withTempDir((tempDir) => {
    const nonPlan = path.join(tempDir, 'README.md');
    fs.writeFileSync(nonPlan, '# Some random doc with wave swarm parallel\n');
    const result = runHandler(scriptPath, [nonPlan]);
    assertPass(
      'plan-lint.sh on non-plan file exits 0 silently',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Plan file with <3 signals → silent no-op
  withTempDir((tempDir) => {
    const plansDir = path.join(tempDir, 'plans');
    fs.mkdirSync(plansDir);
    const planFile = path.join(plansDir, 'simple.md');
    fs.writeFileSync(planFile, '# Simple plan\n\nNo coordinated execution signals here.\n');
    const result = runHandler(scriptPath, [planFile]);
    assertPass(
      'plan-lint.sh on plan with <3 signals exits 0 silently',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Plan file with 3+ signals AND Execution Protocol section → silent no-op
  withTempDir((tempDir) => {
    const plansDir = path.join(tempDir, 'plans');
    fs.mkdirSync(plansDir);
    const planFile = path.join(plansDir, 'parallel.md');
    fs.writeFileSync(
      planFile,
      [
        '# Parallel plan',
        '',
        'This plan uses wave-based execution with squad parallel dispatch via dev-squad.',
        '',
        '## Execution Protocol',
        '',
        'Commander Opus, Squad Sonnet, worktree-isolated.',
        '',
      ].join('\n'),
    );
    const result = runHandler(scriptPath, [planFile]);
    assertPass(
      'plan-lint.sh on parallel plan WITH Execution Protocol exits 0 silently',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Plan file with 3+ signals AND NO Execution Protocol section → advisory warning on stdout
  withTempDir((tempDir) => {
    const plansDir = path.join(tempDir, 'plans');
    fs.mkdirSync(plansDir);
    const planFile = path.join(plansDir, 'parallel-bad.md');
    fs.writeFileSync(
      planFile,
      [
        '# Parallel plan without protocol',
        '',
        'Wave-based parallel execution with swarm squad fan-out across worktrees.',
        '',
        '## Some other section',
        '',
        'No protocol formalization here.',
        '',
      ].join('\n'),
    );
    const result = runHandler(scriptPath, [planFile]);
    assertPass(
      'plan-lint.sh on parallel plan WITHOUT Execution Protocol exits 0 with warning',
      result.ok && /\[HSEOS\]\[PLAN-LINT\]/.test(result.stdout),
      `stdout="${result.stdout.slice(0, 120)}..."`,
    );

    // Idempotency — running twice produces same stdout
    const second = runHandler(scriptPath, [planFile]);
    assertPass(
      'plan-lint.sh is idempotent (same stdout on second run)',
      result.stdout === second.stdout,
      'stdout differs between runs',
    );
  });
}

// =============================================================================
// Run
// =============================================================================

console.log('Hook handler integration tests');
testPlanLint();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
