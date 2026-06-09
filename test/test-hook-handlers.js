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

function runCommand(command, options = {}) {
  try {
    const output = execFileSync(command, {
      encoding: 'utf8',
      shell: true,
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

  // Relative plan paths are accepted because platform adapters may pass repo-relative paths
  withTempDir((tempDir) => {
    const plansDir = path.join(tempDir, 'plans');
    fs.mkdirSync(plansDir);
    const planFile = path.join(plansDir, 'relative-bad.md');
    fs.writeFileSync(
      planFile,
      [
        '# Relative parallel plan',
        '',
        'Wave parallel swarm squad execution across worktrees.',
        '',
      ].join('\n'),
    );
    const result = runHandler(scriptPath, ['plans/relative-bad.md'], { cwd: tempDir });
    assertPass(
      'plan-lint.sh accepts relative plans/*.md paths',
      result.ok && /\[HSEOS\]\[PLAN-LINT\]/.test(result.stdout),
      `stdout="${result.stdout.slice(0, 120)}..."`,
    );
  });

  // Registry command shape: CLAUDE_TOOL_FILE_PATH is expanded by the shell
  withTempDir((tempDir) => {
    const plansDir = path.join(tempDir, 'plans');
    fs.mkdirSync(plansDir);
    const planFile = path.join(plansDir, 'registry-env-bad.md');
    fs.writeFileSync(
      planFile,
      [
        '# Registry command plan',
        '',
        'Wave parallel swarm squad execution across worktrees.',
        '',
      ].join('\n'),
    );
    const result = runCommand(`bash "${scriptPath}" "$CLAUDE_TOOL_FILE_PATH"`, {
      env: { ...process.env, CLAUDE_TOOL_FILE_PATH: planFile },
    });
    assertPass(
      'plan-lint.sh works with registry CLAUDE_TOOL_FILE_PATH command shape',
      result.ok && /\[HSEOS\]\[PLAN-LINT\]/.test(result.stdout),
      `stdout="${result.stdout.slice(0, 120)}..."`,
    );
  });
}

// =============================================================================
// code-index-post-edit.sh
// =============================================================================

function testCodeIndexPostEdit() {
  const scriptPath = path.join(HANDLERS_DIR, 'code-index-post-edit.sh');

  assertPass(
    'code-index-post-edit.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'code-index-post-edit.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  // Empty arg → silent no-op
  {
    const result = runHandler(scriptPath, []);
    assertPass(
      'code-index-post-edit.sh with no arg exits 0 silently',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  }

  // File path with no provider marker → silent no-op (graceful degradation)
  withTempDir((tempDir) => {
    const editedFile = path.join(tempDir, 'src', 'foo.js');
    fs.mkdirSync(path.dirname(editedFile), { recursive: true });
    fs.writeFileSync(editedFile, "module.exports = 1;\n");
    const result = runHandler(scriptPath, [editedFile]);
    assertPass(
      'code-index-post-edit.sh with no provider marker is silent no-op',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // File path under a project with .axon/ marker → appends to queue
  withTempDir((tempDir) => {
    const axonDir = path.join(tempDir, '.axon');
    fs.mkdirSync(axonDir);
    const editedFile = path.join(tempDir, 'src', 'bar.ts');
    fs.mkdirSync(path.dirname(editedFile), { recursive: true });
    fs.writeFileSync(editedFile, "export const x = 1;\n");

    const result = runHandler(scriptPath, [editedFile]);
    assertPass(
      'code-index-post-edit.sh with axon marker exits 0',
      result.ok,
      `stdout="${result.stdout.trim()}"`,
    );

    const queue = path.join(axonDir, 'pending-writes.txt');
    const queueExists = fs.existsSync(queue);
    assertPass(
      'code-index-post-edit.sh axon: pending-writes.txt created',
      queueExists,
      queue,
    );

    if (queueExists) {
      const lines = fs.readFileSync(queue, 'utf8').trim().split('\n');
      assertPass(
        'code-index-post-edit.sh axon: queue contains the edited file path',
        lines.includes(editedFile),
        `queue=${JSON.stringify(lines)}`,
      );
    }

    // Idempotency: invoking twice appends two entries (provider dedupes)
    runHandler(scriptPath, [editedFile]);
    const linesAfter = fs.readFileSync(queue, 'utf8').trim().split('\n');
    const occurrences = linesAfter.filter((l) => l === editedFile).length;
    assertPass(
      'code-index-post-edit.sh axon: idempotent append (provider dedupes)',
      occurrences === 2,
      `occurrences=${occurrences}`,
    );
  });
}

// =============================================================================
// claude-md-guard.sh
// =============================================================================

function testClaudeMdGuard() {
  const scriptPath = path.join(HANDLERS_DIR, 'claude-md-guard.sh');

  assertPass(
    'claude-md-guard.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'claude-md-guard.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  {
    const result = runHandler(scriptPath, []);
    assertPass(
      'claude-md-guard.sh with no arg exits 0 silently',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  }

  withTempDir((tempDir) => {
    const agentsPath = path.join(tempDir, 'AGENTS.md');
    const result = runHandler(scriptPath, [agentsPath]);
    assertPass(
      'claude-md-guard.sh allows AGENTS.md',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  withTempDir((tempDir) => {
    const claudePath = path.join(tempDir, 'CLAUDE.md');
    const result = runHandler(scriptPath, [claudePath]);
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      parsed = null;
    }

    assertPass(
      'claude-md-guard.sh blocks CLAUDE.md with deny JSON',
      result.ok &&
        parsed &&
        parsed.hookSpecificOutput?.hookEventName === 'PreToolUse' &&
        parsed.hookSpecificOutput?.permissionDecision === 'deny' &&
        /AGENTS\.md/.test(parsed.hookSpecificOutput?.additionalContext ?? ''),
      `stdout="${result.stdout.slice(0, 160)}"`,
    );
  });
}

// =============================================================================
// on-notification.sh
// =============================================================================

function testOnNotification() {
  const scriptPath = path.join(HANDLERS_DIR, 'on-notification.sh');

  assertPass(
    'on-notification.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'on-notification.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  // With HSEOS_NOTIFICATION_SILENT=1 the handler emits absolutely nothing
  // (not even the terminal bell). Useful for headless CI.
  {
    const result = runHandler(scriptPath, ['Test message'], {
      env: { ...process.env, HSEOS_NOTIFICATION_SILENT: '1' },
    });
    assertPass(
      'on-notification.sh respects HSEOS_NOTIFICATION_SILENT=1 (silent exit 0)',
      result.ok && result.stdout === '' && (result.stderr === '' || result.stderr === undefined),
      `stdout="${result.stdout}" stderr="${result.stderr ?? ''}"`,
    );
  }

  // Without the silence flag, the handler always exits 0 regardless of
  // which notification stacks are available — terminal bell is the
  // unconditional final fallback. We do not assert on the bell character
  // itself (some shells absorb it) — only that the handler exits 0.
  {
    const result = runHandler(scriptPath, ['Test message'], {
      env: { ...process.env, HSEOS_NOTIFICATION_SILENT: '0' },
    });
    assertPass(
      'on-notification.sh exits 0 with default args',
      result.ok,
      `exitCode=${result.exitCode}`,
    );
  }

  // No-arg invocation also exits 0 (uses default message)
  {
    const result = runHandler(scriptPath, [], {
      env: { ...process.env, HSEOS_NOTIFICATION_SILENT: '1' },
    });
    assertPass(
      'on-notification.sh with no arg exits 0',
      result.ok,
      `exitCode=${result.exitCode}`,
    );
  }

  // Idempotency: running twice produces the same exit code
  {
    const env = { ...process.env, HSEOS_NOTIFICATION_SILENT: '1' };
    const a = runHandler(scriptPath, ['Same message'], { env });
    const b = runHandler(scriptPath, ['Same message'], { env });
    assertPass(
      'on-notification.sh is idempotent (same exit on second run)',
      a.exitCode === b.exitCode && a.exitCode === 0,
      `a=${a.exitCode} b=${b.exitCode}`,
    );
  }
}

// =============================================================================
// pre-compact.sh
// =============================================================================

function testPreCompact() {
  const scriptPath = path.join(HANDLERS_DIR, 'pre-compact.sh');

  assertPass(
    'pre-compact.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'pre-compact.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  // Outside an HSEOS-installed project: silent no-op
  withTempDir((tempDir) => {
    // No .hseos/ inside tempDir
    const result = runHandler(scriptPath, [], { cwd: tempDir });
    assertPass(
      'pre-compact.sh outside HSEOS project is silent no-op',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Inside an HSEOS-installed project: writes a snapshot file
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.hseos'), { recursive: true });

    const sessionId = `test-${Date.now()}`;
    const env = {
      ...process.env,
      HSEOS_SESSION_ID: sessionId,
    };
    const result = runHandler(scriptPath, [], { cwd: tempDir, env });

    assertPass(
      'pre-compact.sh inside HSEOS project exits 0',
      result.ok,
      `stderr="${result.stderr ?? ''}"`,
    );

    const snapshot = path.join(
      tempDir, '.hseos', 'runs', 'sessions', sessionId, 'PRE-COMPACT.md',
    );
    assertPass(
      'pre-compact.sh writes PRE-COMPACT.md to .hseos/runs/sessions/<id>/',
      fs.existsSync(snapshot),
      snapshot,
    );

    if (fs.existsSync(snapshot)) {
      const body = fs.readFileSync(snapshot, 'utf8');
      assertPass(
        'pre-compact.sh snapshot contains required sections',
        body.includes('# Pre-Compact Snapshot') &&
          body.includes('## Recent commits') &&
          body.includes('## Dirty working tree') &&
          body.includes(`Session:** \`${sessionId}\``),
        `body length=${body.length}`,
      );
    }
  });

  // User-authored pre-compact notes are preserved + consumed
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.hseos'), { recursive: true });

    const sessionId = `notes-${Date.now()}`;
    const runDir = path.join(tempDir, '.hseos', 'runs', 'sessions', sessionId);
    fs.mkdirSync(runDir, { recursive: true });
    const notesPath = path.join(runDir, '.pre-compact-notes.md');
    fs.writeFileSync(notesPath, '## My critical context\n\n- thing 1\n- thing 2\n');

    const env = {
      ...process.env,
      HSEOS_SESSION_ID: sessionId,
      HSEOS_PRE_COMPACT_NOTES: notesPath,
    };
    runHandler(scriptPath, [], { cwd: tempDir, env });

    const snapshot = path.join(runDir, 'PRE-COMPACT.md');
    if (fs.existsSync(snapshot)) {
      const body = fs.readFileSync(snapshot, 'utf8');
      assertPass(
        'pre-compact.sh embeds user-authored notes into snapshot',
        body.includes('## User-authored pre-compact notes') &&
          body.includes('My critical context') &&
          body.includes('thing 2'),
        `body excerpt="${body.slice(-200)}"`,
      );
    }

    assertPass(
      'pre-compact.sh consumes (removes) the user notes file after embedding',
      !fs.existsSync(notesPath),
      `notes still exists at ${notesPath}`,
    );
  });
}

// =============================================================================
// on-prompt-submit.sh
// =============================================================================

function runHandlerWithStdin(scriptPath, stdinPayload, options = {}) {
  try {
    const output = execFileSync('bash', [scriptPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      input: stdinPayload,
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

function testOnPromptSubmit() {
  const scriptPath = path.join(HANDLERS_DIR, 'on-prompt-submit.sh');

  assertPass(
    'on-prompt-submit.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'on-prompt-submit.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  // Outside an HSEOS project: silent no-op
  withTempDir((tempDir) => {
    const payload = JSON.stringify({ prompt: 'hello world', cwd: tempDir });
    const result = runHandlerWithStdin(scriptPath, payload, { cwd: tempDir });
    assertPass(
      'on-prompt-submit.sh outside HSEOS project is silent no-op',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Inside HSEOS project: writes prompt log
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.hseos'), { recursive: true });

    const sessionId = `test-${Date.now()}`;
    const env = { ...process.env, HSEOS_SESSION_ID: sessionId };
    const payload = JSON.stringify({ prompt: 'just a regular prompt', cwd: tempDir });

    const result = runHandlerWithStdin(scriptPath, payload, { cwd: tempDir, env });

    assertPass(
      'on-prompt-submit.sh inside HSEOS project exits 0',
      result.ok,
      `stderr="${result.stderr ?? ''}"`,
    );

    const promptsDir = path.join(
      tempDir, '.hseos', 'runs', 'sessions', sessionId, 'prompts',
    );
    const dirExists = fs.existsSync(promptsDir);
    assertPass(
      'on-prompt-submit.sh creates .hseos/runs/sessions/<id>/prompts/',
      dirExists,
      promptsDir,
    );

    if (dirExists) {
      const files = fs.readdirSync(promptsDir);
      assertPass(
        'on-prompt-submit.sh writes one prompt file',
        files.length === 1,
        `files=${JSON.stringify(files)}`,
      );

      if (files.length === 1) {
        const body = fs.readFileSync(path.join(promptsDir, files[0]), 'utf8');
        assertPass(
          'on-prompt-submit.sh prompt file contains the prompt',
          body.includes('just a regular prompt') &&
            body.includes(sessionId),
          `body excerpt="${body.slice(0, 80)}"`,
        );
      }
    }
  });

  // Empty stdin: silent no-op (no prompt, even when in HSEOS project)
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.hseos'), { recursive: true });
    const sessionId = `empty-${Date.now()}`;
    const env = { ...process.env, HSEOS_SESSION_ID: sessionId };

    const result = runHandlerWithStdin(scriptPath, '', { cwd: tempDir, env });
    assertPass(
      'on-prompt-submit.sh with empty stdin is silent no-op',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );

    const promptsDir = path.join(
      tempDir, '.hseos', 'runs', 'sessions', sessionId, 'prompts',
    );
    assertPass(
      'on-prompt-submit.sh with empty stdin does not create prompts dir',
      !fs.existsSync(promptsDir),
      promptsDir,
    );
  });

  // /plan with heterogeneous task signals -> SWARM advisory
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.hseos'), { recursive: true });
    const sessionId = `swarm-${Date.now()}`;
    const env = { ...process.env, HSEOS_SESSION_ID: sessionId };

    const heterogeneousPrompt =
      '/plan refactor the auth module, fix the broken test, implementar nova feature de logging, atualizar docs';
    const payload = JSON.stringify({ prompt: heterogeneousPrompt, cwd: tempDir });
    const result = runHandlerWithStdin(scriptPath, payload, { cwd: tempDir, env });

    assertPass(
      'on-prompt-submit.sh emits SWARM advisory on /plan with heterogeneous signals',
      result.ok && /\[HSEOS\]\[SWARM\]/.test(result.stdout) &&
        result.stdout.includes('/dev-squad'),
      `stdout excerpt="${result.stdout.slice(0, 120)}..."`,
    );
  });

  // /plan but only a single task signal -> NO advisory
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.hseos'), { recursive: true });
    const sessionId = `simple-${Date.now()}`;
    const env = { ...process.env, HSEOS_SESSION_ID: sessionId };

    const singleTaskPrompt = '/plan fix the typo in README';
    const payload = JSON.stringify({ prompt: singleTaskPrompt, cwd: tempDir });
    const result = runHandlerWithStdin(scriptPath, payload, { cwd: tempDir, env });

    assertPass(
      'on-prompt-submit.sh skips SWARM advisory on simple /plan (no heterogeneous signals)',
      result.ok && !result.stdout.includes('[HSEOS][SWARM]'),
      `stdout="${result.stdout.trim()}"`,
    );
  });
}

// =============================================================================
// session-end.sh
// =============================================================================

function testSessionEnd() {
  const scriptPath = path.join(HANDLERS_DIR, 'session-end.sh');

  assertPass(
    'session-end.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'session-end.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  // Outside HSEOS project: silent no-op
  withTempDir((tempDir) => {
    const result = runHandler(scriptPath, [], { cwd: tempDir });
    assertPass(
      'session-end.sh outside HSEOS project is silent no-op',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Inside HSEOS, no second_brain config -> Tier 1 only (SESSION-END.md written)
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.hseos'), { recursive: true });

    const sessionId = `tier1-${Date.now()}`;
    const env = { ...process.env, HSEOS_SESSION_ID: sessionId };
    const result = runHandler(scriptPath, [], { cwd: tempDir, env });

    assertPass(
      'session-end.sh inside HSEOS exits 0 (Tier 1 only)',
      result.ok,
      `stderr="${result.stderr ?? ''}"`,
    );

    const marker = path.join(
      tempDir, '.hseos', 'runs', 'sessions', sessionId, 'SESSION-END.md',
    );
    assertPass(
      'session-end.sh writes SESSION-END.md marker',
      fs.existsSync(marker),
      marker,
    );

    if (fs.existsSync(marker)) {
      const body = fs.readFileSync(marker, 'utf8');
      assertPass(
        'session-end.sh marker contains required sections',
        body.includes('# Session End') &&
          body.includes(`Session:** \`${sessionId}\``) &&
          body.includes('## Dirty working tree'),
        `body length=${body.length}`,
      );
    }
  });

  // Inside HSEOS, second_brain.enabled: false -> Tier 1 only (vault NOT touched)
  withTempDir((tempDir) => {
    const hseosDir = path.join(tempDir, '.hseos');
    const configDir = path.join(hseosDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });

    const vaultDir = path.join(tempDir, 'fake-vault');
    fs.mkdirSync(path.join(vaultDir, '_memory'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, '_memory', 'activity-log.md'), '# Pre-existing log\n');

    fs.writeFileSync(
      path.join(configDir, 'hseos.config.yaml'),
      [
        'framework:',
        '  name: test',
        '',
        'second_brain:',
        '  enabled: false',
        `  path: ${vaultDir}`,
        '',
      ].join('\n'),
    );

    const sessionId = `disabled-${Date.now()}`;
    const env = { ...process.env, HSEOS_SESSION_ID: sessionId };
    const result = runHandler(scriptPath, [], { cwd: tempDir, env });

    assertPass(
      'session-end.sh with enabled:false skips Tier 2 (vault untouched)',
      result.ok,
      `stderr="${result.stderr ?? ''}"`,
    );

    const log = fs.readFileSync(path.join(vaultDir, '_memory', 'activity-log.md'), 'utf8');
    assertPass(
      'session-end.sh enabled:false: vault activity-log NOT modified',
      log === '# Pre-existing log\n',
      `log changed: "${log.slice(0, 60)}"`,
    );
    assertPass(
      'session-end.sh enabled:false: .needs-end-session flag NOT created',
      !fs.existsSync(path.join(vaultDir, '_memory', '.needs-end-session')),
      'flag exists when it should not',
    );
  });

  // Inside HSEOS, second_brain.enabled: true -> Tier 1 + Tier 2 (vault appended)
  withTempDir((tempDir) => {
    const hseosDir = path.join(tempDir, '.hseos');
    const configDir = path.join(hseosDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });

    const vaultDir = path.join(tempDir, 'real-vault');
    fs.mkdirSync(path.join(vaultDir, '_memory'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, '_memory', 'activity-log.md'), '# Pre-existing log\n');

    fs.writeFileSync(
      path.join(configDir, 'hseos.config.yaml'),
      [
        'framework:',
        '  name: test',
        '',
        'second_brain:',
        '  enabled: true',
        `  path: ${vaultDir}`,
        '',
      ].join('\n'),
    );

    const sessionId = `enabled-${Date.now()}`;
    const env = { ...process.env, HSEOS_SESSION_ID: sessionId };
    const result = runHandler(scriptPath, [], { cwd: tempDir, env });

    assertPass(
      'session-end.sh with enabled:true exits 0 (Tier 1 + 2)',
      result.ok,
      `stderr="${result.stderr ?? ''}"`,
    );

    const log = fs.readFileSync(path.join(vaultDir, '_memory', 'activity-log.md'), 'utf8');
    assertPass(
      'session-end.sh enabled:true: vault activity-log appended',
      log.includes('# Pre-existing log') &&
        /## \[.+\] session-end \| .+/.test(log),
      `log excerpt="${log.slice(-120)}"`,
    );
    assertPass(
      'session-end.sh enabled:true: .needs-end-session flag created',
      fs.existsSync(path.join(vaultDir, '_memory', '.needs-end-session')),
      'flag missing',
    );
  });
}

// =============================================================================
// suggest-skill.sh
// =============================================================================

function testSuggestSkill() {
  const scriptPath = path.join(HANDLERS_DIR, 'suggest-skill.sh');

  assertPass(
    'suggest-skill.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'suggest-skill.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  // Outside HSEOS project (no .agents/skills/) → silent no-op
  withTempDir((tempDir) => {
    const payload = JSON.stringify({
      tool_input: { prompt: 'commit-hygiene anything', description: '', subagent_type: '' },
    });
    const result = runHandlerWithStdin(scriptPath, payload, { cwd: tempDir });
    assertPass(
      'suggest-skill.sh outside HSEOS project is silent no-op',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  function withFakeSkillsTree(fn) {
    return withTempDir((tempDir) => {
      const skillsDir = path.join(tempDir, '.agents', 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      // commit-hygiene skill
      const commitHygieneDir = path.join(skillsDir, 'commit-hygiene');
      fs.mkdirSync(commitHygieneDir);
      fs.writeFileSync(
        path.join(commitHygieneDir, 'SKILL.md'),
        [
          '---',
          'name: commit-hygiene',
          'description: Validate commit messages, branch naming, and trailer policies',
          'tier: 1',
          'triggers:',
          '  - commit-hygiene',
          '  - conventional commits',
          '  - branch protection',
          '---',
          '',
          '# Commit Hygiene',
          '',
        ].join('\n'),
      );

      // doc-project skill (should NOT match a commit prompt)
      const docProjectDir = path.join(skillsDir, 'doc-project');
      fs.mkdirSync(docProjectDir);
      fs.writeFileSync(
        path.join(docProjectDir, 'SKILL.md'),
        [
          '---',
          'name: doc-project',
          'description: Generate bilingual README and project documentation',
          'tier: 2',
          'triggers: [readme, changelog, contributing]',
          '---',
          '',
          '# Doc Project',
          '',
        ].join('\n'),
      );

      fn(tempDir, skillsDir);
    });
  }

  // Inside HSEOS, commit-hygiene-related prompt → advisory matches commit-hygiene only
  withFakeSkillsTree((tempDir) => {
    const payload = JSON.stringify({
      tool_input: {
        prompt: 'Validate the commit-hygiene rules before this PR opens',
        description: '',
        subagent_type: '',
      },
    });
    const result = runHandlerWithStdin(scriptPath, payload, { cwd: tempDir });

    assertPass(
      'suggest-skill.sh emits advisory when prompt matches a skill trigger',
      result.ok && /\[HSEOS\]\[SKILL-CHECK\]/.test(result.stdout) &&
        result.stdout.includes('/commit-hygiene'),
      `stdout="${result.stdout.slice(0, 120)}..."`,
    );

    assertPass(
      'suggest-skill.sh advisory does not include unrelated skills',
      !result.stdout.includes('/doc-project'),
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Inside HSEOS, prompt with no skill match → silent no-op
  withFakeSkillsTree((tempDir) => {
    const payload = JSON.stringify({
      tool_input: {
        prompt: 'a completely unrelated topic about kitchen recipes',
        description: '',
        subagent_type: '',
      },
    });
    const result = runHandlerWithStdin(scriptPath, payload, { cwd: tempDir });
    assertPass(
      'suggest-skill.sh silent when no skill triggers match',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Empty stdin → silent no-op
  withFakeSkillsTree((tempDir) => {
    const result = runHandlerWithStdin(scriptPath, '', { cwd: tempDir });
    assertPass(
      'suggest-skill.sh with empty stdin is silent no-op',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });
}

// =============================================================================
// code-index-guard.sh
// =============================================================================

function testCodeIndexGuard() {
  const scriptPath = path.join(HANDLERS_DIR, 'code-index-guard.sh');

  assertPass(
    'code-index-guard.sh exists',
    fs.existsSync(scriptPath),
    scriptPath,
  );

  if (!fs.existsSync(scriptPath)) {
    return;
  }

  const stat = fs.statSync(scriptPath);
  assertPass(
    'code-index-guard.sh is executable',
    (stat.mode & 0o111) !== 0,
    `mode=${stat.mode.toString(8)}`,
  );

  // No provider detected -> silent allow (exit 0, empty stdout)
  withTempDir((tempDir) => {
    const result = runHandler(scriptPath, ['Grep'], { cwd: tempDir });
    assertPass(
      'code-index-guard.sh with no provider → silent allow',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Provider .axon/ but no index file -> silent allow (per design: hint
  // is delegated to on-prompt-submit.sh once per session, not per call)
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.axon'));
    const result = runHandler(scriptPath, ['Grep'], { cwd: tempDir });
    assertPass(
      'code-index-guard.sh with provider but no index → silent allow',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Provider .axon/ with index.duckdb -> blocking JSON output
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.axon'));
    fs.writeFileSync(path.join(tempDir, '.axon', 'index.duckdb'), '');

    const result = runHandler(scriptPath, ['Grep'], { cwd: tempDir });
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      parsed = null;
    }
    assertPass(
      'code-index-guard.sh with provider+index on Grep → emits blocking JSON',
      result.ok &&
        parsed &&
        parsed.hookSpecificOutput &&
        parsed.hookSpecificOutput.permissionDecision === 'ask' &&
        parsed.hookSpecificOutput.hookEventName === 'PreToolUse' &&
        /Grep/.test(parsed.hookSpecificOutput.permissionDecisionReason ?? ''),
      `stdout="${result.stdout.slice(0, 120)}"`,
    );
  });

  // Provider+index on Glob -> different reason text
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.axon'));
    fs.writeFileSync(path.join(tempDir, '.axon', 'index.duckdb'), '');

    const result = runHandler(scriptPath, ['Glob'], { cwd: tempDir });
    let parsed = null;
    try { parsed = JSON.parse(result.stdout.trim()); } catch { parsed = null; }
    assertPass(
      'code-index-guard.sh with provider+index on Glob → emits blocking JSON',
      result.ok && parsed &&
        /Glob/.test(parsed.hookSpecificOutput.permissionDecisionReason ?? '') &&
        /get_skeleton|skeleton/.test(parsed.hookSpecificOutput.additionalContext ?? ''),
      `stdout="${result.stdout.slice(0, 120)}"`,
    );
  });

  // HSEOS_BYPASS_INDEX=1 -> silent allow even with provider+index
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.axon'));
    fs.writeFileSync(path.join(tempDir, '.axon', 'index.duckdb'), '');

    const env = { ...process.env, HSEOS_BYPASS_INDEX: '1' };
    const result = runHandler(scriptPath, ['Grep'], { cwd: tempDir, env });
    assertPass(
      'code-index-guard.sh respects HSEOS_BYPASS_INDEX=1 (silent allow)',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });

  // Other tool names (not Grep/Glob) -> silent allow even with provider+index
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, '.axon'));
    fs.writeFileSync(path.join(tempDir, '.axon', 'index.duckdb'), '');

    const result = runHandler(scriptPath, ['Read'], { cwd: tempDir });
    assertPass(
      'code-index-guard.sh ignores non-Grep/Glob tools',
      result.ok && result.stdout.trim() === '',
      `stdout="${result.stdout.trim()}"`,
    );
  });
}

// =============================================================================
// Run
// =============================================================================

console.log('Hook handler integration tests');
testPlanLint();
testCodeIndexPostEdit();
testClaudeMdGuard();
testOnNotification();
testPreCompact();
testOnPromptSubmit();
testSessionEnd();
testSuggestSkill();
testCodeIndexGuard();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
