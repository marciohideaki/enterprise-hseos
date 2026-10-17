'use strict';

/**
 * Composition of the real CO1 core (CLI, service, store) with the real CO2 modules (publish guard, axon adapter and
 * the session hook handler). Each side passes its own tests against stubs; only the real pieces together show whether
 * the exit codes, the mirrored events and the `foreign_reservations` format line up. The only stubbed edges are the
 * npm registry (a fake `npm` on PATH) and the axon transport (`callAxon` / binary resolver).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'cli', 'hseos-cli.js');
const HANDLER = path.join(ROOT, '.enterprise', 'governance', 'hooks', 'handlers', 'activity-coordination.sh');
const HAS_JQ = spawnSync('jq', ['--version']).status === 0;
const REPO = 'github.com/hideaki/composition';

const scratch = (prefix) => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), prefix));

function project(extraContract = '') {
  const dir = scratch('activity-composition-');
  // The session hook resolves the project with `git rev-parse --show-toplevel`, so this must be a real repository.
  assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0);
  fs.mkdirSync(path.join(dir, '.hseos', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.hseos', 'config', 'activity-coordination.yaml'),
    `enabled: true\nstore:\n  path: ${path.join(dir, 'state', 'activity.db')}\n${extraContract}`,
  );
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npm'), "#!/bin/sh\necho '[]'\n", { mode: 0o755 });
  return { dir, bin };
}

function activity(ctx, args, env = {}) {
  return spawnSync(process.execPath, [CLI, 'activity', ...args, '--directory', ctx.dir], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PATH: `${ctx.bin}:${process.env.PATH}`, ...env },
  });
}

const register = (ctx, session, tool, extra = []) =>
  activity(ctx, ['register', '--session', session, '--tool', tool, '--repo', REPO, '--worktree', ctx.dir, '--json', ...extra]);

test('guard-publish as the real hseos process: 1 when the version is reserved, 2 for an invalid spec, 0 otherwise', () => {
  const ctx = project('enforce:\n  publish_guard: true\n');
  assert.equal(register(ctx, 'claude-1', 'claude-code').status, 0);
  const reserved = activity(ctx, ['reserve', 'version:contracts@1.0.0-experimental.6', '--session', 'claude-1', '--json']);
  assert.equal(reserved.status, 0, reserved.stderr);

  const refuse = activity(ctx, ['guard-publish', 'contracts@1.0.0-experimental.6', '--session', 'codex-1']);
  assert.equal(refuse.status, 1, `${refuse.stdout}${refuse.stderr}`);
  assert.match(refuse.stdout, /\[guard-publish\] refuse contracts@1\.0\.0-experimental\.6/);

  const invalid = activity(ctx, ['guard-publish', 'Contracts@1.0.0', '--session', 'codex-1']);
  assert.equal(invalid.status, 2, `${invalid.stdout}${invalid.stderr}`);

  const allow = activity(ctx, ['guard-publish', 'contracts@1.0.1', '--session', 'codex-1', '--json']);
  assert.equal(allow.status, 0, `${allow.stdout}${allow.stderr}`);
  assert.equal(JSON.parse(allow.stdout).decision, 'allow');
});

test('guard-publish only warns while enforcement is off', () => {
  const ctx = project();
  register(ctx, 'claude-1', 'claude-code');
  activity(ctx, ['reserve', 'version:contracts@1.0.0-experimental.6', '--session', 'claude-1', '--json']);
  const warned = activity(ctx, ['guard-publish', 'contracts@1.0.0-experimental.6', '--session', 'codex-1']);
  assert.equal(warned.status, 0, `${warned.stdout}${warned.stderr}`);
});

test('the real axon adapter receives events with a unique id, the tool, the source and the other session', () => {
  const ctx = project('  adapters: [axon]\n');
  const log = path.join(ctx.dir, 'axon-calls.jsonl');
  // Preloaded into every `hseos` process: only the axon transport is replaced, the adapter and the core are real.
  const preload = path.join(ctx.dir, 'axon-preload.js');
  fs.writeFileSync(
    preload,
    `const fs = require('node:fs');
     const client = require(${JSON.stringify(path.join(ROOT, 'tools/mcp-axon-bridge/lib/axon-client'))});
     const resolver = require(${JSON.stringify(path.join(ROOT, 'tools/mcp-axon-bridge/lib/binary-resolver'))});
     resolver.resolve = () => '/usr/bin/axon';
     client.callAxon = async (bin, tool, args) => { fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ tool, args }) + '\\n'); return {}; };`,
  );
  const env = { NODE_OPTIONS: `--require ${preload}` };
  const run = (args) => {
    const result = activity(ctx, args, env);
    // reserve exits 3 when it acquired with conflicts and 2 when the key is held by someone else
    assert.ok([0, 2, 3].includes(result.status), `${args.join(' ')}: ${result.stdout}${result.stderr}`);
    return result;
  };
  run([
    'register',
    '--session',
    's1',
    '--tool',
    'claude-code',
    '--repo',
    REPO,
    '--worktree',
    ctx.dir,
    '--intent',
    'ship contracts',
    '--json',
  ]);
  run(['register', '--session', 's2', '--tool', 'codex', '--repo', REPO, '--worktree', ctx.dir, '--json']);
  run(['declare', '--session', 's1', '--path', 'src/a.js', '--json']);
  run(['declare', '--session', 's1', '--path', 'src/b.js', '--json']);
  run(['reserve', 'name:held-pkg', '--session', 's1', '--json']);
  run(['reserve', 'name:held-pkg', '--session', 's2', '--json']);

  const waitForCalls = (count) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
      if (lines.length >= count) return lines.map((line) => JSON.parse(line));
      spawnSync('sleep', ['0.2']);
    }
    return fs.existsSync(log)
      ? fs
          .readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  };
  const calls = waitForCalls(3);
  assert.ok(calls.length >= 3, `expected the declares and the conflict to reach axon, got ${calls.length}`);
  const keys = calls.map((call) => call.args.idempotency_key);
  assert.equal(new Set(keys).size, keys.length, `idempotency keys must be unique: ${keys.join(', ')}`);
  const declares = calls.filter((call) => call.args.target_agent === 'coordination-peer');
  assert.equal(declares.length, 2, 'two declares of the same session are two handoffs');
  for (const call of declares) assert.match(call.args.objective, /Session s1 \(claude-code\) declared work on/);
  const conflicts = calls.filter((call) => call.args.target_agent === 'coordination-conflict');
  assert.ok(conflicts.length > 0);
  for (const call of conflicts) {
    assert.doesNotMatch(call.args.objective, /source: unknown/, call.args.objective);
    assert.doesNotMatch(call.args.objective, /sessions \S+ and \?/, call.args.objective);
    assert.match(call.args.objective, /name:held-pkg/);
  }
  assert.ok(
    conflicts.some((call) => /between sessions s2 and s1/.test(call.args.objective)),
    conflicts.map((call) => call.args.objective).join(' | '),
  );
});

test('foreign_reservations from the real CLI is [{key, tool, owner}] and reaches the session hook prompt', { skip: !HAS_JQ }, () => {
  const ctx = project();
  register(ctx, 'cc-1', 'claude-code');
  const reserved = activity(ctx, ['reserve', 'name:shared-lib', '--session', 'cc-1', '--json']);
  assert.equal(reserved.status, 0, reserved.stderr);
  register(ctx, 'z-1', 'codex', ['--identifier', 'shared-lib']);

  const checked = activity(ctx, ['check', '--session', 'z-1', '--json']);
  assert.equal(checked.status, 0, checked.stderr);
  const { foreign_reservations: foreign } = JSON.parse(checked.stdout);
  // The format the handler assumes is [{key, tool, owner}]; the CLI may add detail (fence, overdue, matched).
  assert.equal(foreign.length, 1);
  assert.deepEqual(
    { key: foreign[0].key, tool: foreign[0].tool, owner: foreign[0].owner },
    { key: 'name:shared-lib', tool: 'claude-code', owner: 'cc-1' },
  );

  const hook = spawnSync('bash', [HANDLER], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'z-1', cwd: ctx.dir }),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HSEOS_ACTIVITY_CLI: CLI, HSEOS_AGENT_TOOL: 'codex', PATH: `${ctx.bin}:${process.env.PATH}` },
  });
  assert.equal(hook.status, 0, hook.stderr);
  const output = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  // The handler reads `tool` and `key` of each entry; the owner session is not injected into the prompt.
  assert.match(output, /reserved by another session tool="claude-code" key="name:shared-lib"/, output);
});
