'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REQUIRED, collect } = require('../.enterprise/governance/hooks/handlers/governance-context.cjs');
const { writeInstructions } = require('../tools/cli/installers/lib/core/agent-core-compiler/sources/instructions-source');
const { syncHandlers, validateHookRegistryDocument } = require('../tools/cli/installers/lib/core/agent-core-compiler/sources/hooks-source');
const { buildClaudeHooksJson } = require('../tools/cli/installers/lib/core/agent-core-compiler/adapters/claude-code');
const yaml = require('yaml');
const root = path.resolve(__dirname, '..');

function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-context-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const consumer = path.join(tmp, 'consumer with spaces');
  const producer = path.join(tmp, 'producer');
  fs.mkdirSync(consumer);
  for (const file of REQUIRED) {
    const target = path.join(producer, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  return { tmp, consumer, producer };
}

test('empty consumer still inherits producer discovery; enforcement is never inferred', (t) => {
  const { consumer, producer } = fixture(t);
  const result = collect({ directory: consumer, sourceRoot: producer });
  assert.equal(result.status, 'resolved');
  assert.ok(result.consumer_adapters.every((source) => source.status === 'unavailable'));
  assert.equal(result.enforcement, 'not_verified');
  assert.equal(result.application, 'not_verified');
  assert.equal(result.other_producers, 'not_verified');
  assert.ok(result.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)));
});

test('missing producer source is incomplete even when local governance exists', (t) => {
  const { consumer, producer } = fixture(t);
  fs.writeFileSync(path.join(consumer, 'AGENTS.md'), 'Local instructions');
  fs.rmSync(path.join(producer, REQUIRED[0]));
  const result = collect({ directory: consumer, sourceRoot: producer });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.sources[0].status, 'unavailable');
});

test('empty sources fail and changed sources receive new hashes', (t) => {
  const { consumer, producer } = fixture(t);
  const before = collect({ directory: consumer, sourceRoot: producer });
  fs.appendFileSync(path.join(producer, REQUIRED[0]), '\nRevision\n');
  const after = collect({ directory: consumer, sourceRoot: producer });
  assert.notEqual(before.sources[0].sha256, after.sources[0].sha256);
  fs.writeFileSync(path.join(producer, REQUIRED[1]), '  ');
  assert.equal(collect({ directory: consumer, sourceRoot: producer }).status, 'incomplete');
});

test('compiled handler reloads context on repeated prompts/resume outside producer cwd', async (t) => {
  const { consumer, producer } = fixture(t);
  await syncHandlers(producer, path.join(root, '.enterprise/governance/hooks/handlers'));
  const handler = path.join(producer, '.agents/hooks/handlers/governance-context.cjs');
  for (const prompt of ['hello', 'retomada', 'convenções']) {
    const run = spawnSync(process.execPath, [handler], {
      cwd: consumer,
      input: JSON.stringify({ cwd: consumer, prompt, session_id: 'same-session' }),
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(producer));
    assert.ok(run.stdout.includes('NOT VERIFIED'));
    assert.ok(run.stdout.includes('Global governance applies'));
  }
  const jsonHook = spawnSync(process.execPath, [handler, '--json-hook'], {
    cwd: consumer,
    input: '{}',
    encoding: 'utf8',
  });
  assert.equal(jsonHook.status, 0, jsonHook.stderr);
  assert.equal(JSON.parse(jsonHook.stdout).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(JSON.parse(jsonHook.stdout).hookSpecificOutput.additionalContext.includes(producer));
  fs.rmSync(path.join(producer, REQUIRED[0]));
  const failed = spawnSync(process.execPath, [handler], { cwd: consumer, input: '{}', encoding: 'utf8' });
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /incomplete/);
  const malformed = spawnSync(process.execPath, [handler], { input: '{', encoding: 'utf8' });
  assert.equal(malformed.status, 2);
});

test('deleted session cwd (removed worktree) resolves nearest ancestor instead of blocking', async (t) => {
  const { consumer, producer } = fixture(t);
  fs.writeFileSync(path.join(consumer, 'AGENTS.md'), 'Local instructions');
  const gone = path.join(consumer, '.worktrees', 'removed-task');
  const result = collect({ directory: gone, sourceRoot: producer });
  assert.equal(result.status, 'resolved');
  assert.equal(result.project_root, fs.realpathSync(consumer));
  assert.equal(result.consumer_adapters[0].status, 'read');
  await syncHandlers(producer, path.join(root, '.enterprise/governance/hooks/handlers'));
  const handler = path.join(producer, '.agents/hooks/handlers/governance-context.cjs');
  const run = spawnSync(process.execPath, [handler], {
    cwd: consumer,
    input: JSON.stringify({ cwd: gone, prompt: 'hello' }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(producer));
});

test('canonical registry emits prompt hook and portable instructions include fallback', async (t) => {
  const { consumer } = fixture(t);
  const registry = yaml.parse(fs.readFileSync(path.join(root, '.enterprise/governance/hooks/registry.yaml'), 'utf8'));
  validateHookRegistryDocument(registry);
  const hook = registry.hooks.find((entry) => entry.id === 'userpromptsubmit-all-governance-context');
  assert.equal(hook.blocking, true);
  const adapter = buildClaudeHooksJson([hook]);
  assert.ok(adapter.hooks.UserPromptSubmit[0].hooks[0].command.includes('governance-context.cjs'));
  await writeInstructions(consumer, '.agents');
  const instructions = fs.readFileSync(path.join(consumer, '.agents/instructions/PROJECT.md'), 'utf8');
  assert.ok(instructions.includes('governance-context --directory'));
  assert.ok(instructions.includes('after context loss'));
});

async function cachedFixture(t) {
  const setup = fixture(t);
  await syncHandlers(setup.producer, path.join(root, '.enterprise/governance/hooks/handlers'));
  const handler = path.join(setup.producer, '.agents/hooks/handlers/governance-context.cjs');
  const stateRoot = path.join(setup.tmp, 'state');
  const run = (event = 'UserPromptSubmit', payload = {}, flags = []) =>
    spawnSync(process.execPath, [handler, '--cache', '--event', event, ...flags], {
      cwd: setup.consumer,
      input: JSON.stringify({ cwd: setup.consumer, session_id: 'session-A', ...payload }),
      encoding: 'utf8',
      env: { ...process.env, HSEOS_GOVERNANCE_CONTEXT_STATE: stateRoot },
    });
  return { ...setup, stateRoot, run };
}

test('dedup requires a lifecycle event, then unchanged prompts emit zero bytes', async (t) => {
  const { run, stateRoot } = await cachedFixture(t);
  assert.ok(run().stdout.length > 0);
  assert.ok(run().stdout.length > 0, 'uninitialized sessions cannot silently deduplicate');
  const first = run('SessionStart', { prompt: 'private input must not be persisted' });
  assert.equal(first.status, 0, first.stderr);
  assert.ok(first.stdout.length > 0 && first.stdout.length < 1400);
  for (let index = 0; index < 20; index++) {
    const next = run();
    assert.equal(next.status, 0, next.stderr);
    assert.equal(next.stdout, '');
    assert.equal(next.stderr, '');
  }
  for (const file of fs.readdirSync(stateRoot)) {
    assert.ok(!fs.readFileSync(path.join(stateRoot, file), 'utf8').includes('private input'));
  }
});

test('compaction, resume, end and project round trips invalidate context', async (t) => {
  const { run, tmp } = await cachedFixture(t);
  assert.ok(run('SessionStart').stdout);
  assert.equal(run().stdout, '');
  for (const event of ['PreCompact', 'SessionEnd']) {
    assert.equal(run(event).stdout, '');
    assert.ok(run().stdout, event);
    assert.equal(run().stdout, '');
  }
  assert.ok(run('SessionStart', { source: 'compact' }).stdout, 'reload before autonomous continuation');
  assert.equal(run().stdout, '');
  const second = path.join(tmp, 'another consumer');
  fs.mkdirSync(second);
  assert.ok(run('UserPromptSubmit', { cwd: second }).stdout);
  assert.equal(run('UserPromptSubmit', { cwd: second }).stdout, '');
  assert.ok(run().stdout, 'returning to an earlier project reloads its context');
});

test('corpus and ancestor adapter changes invalidate; missing sources still block cached sessions', async (t) => {
  const { run, producer, tmp } = await cachedFixture(t);
  run('SessionStart');
  run();
  assert.equal(run().stdout, '');
  fs.writeFileSync(path.join(producer, '.enterprise/policies/another-policy.md'), '# Another policy\n');
  assert.ok(run().stdout, 'changes outside the required baseline also invalidate');
  assert.equal(run().stdout, '');
  fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# Organization instructions\n');
  assert.ok(run().stdout);
  assert.equal(run().stdout, '');
  fs.rmSync(path.join(producer, REQUIRED[0]));
  const failed = run();
  assert.equal(failed.status, 2);
  assert.equal(failed.stdout, '');
  assert.match(failed.stderr, /incomplete/);
});

test('session and adapter isolation, JSON suppression, and absent identity fallback', async (t) => {
  const { run } = await cachedFixture(t);
  run('SessionStart');
  run();
  assert.equal(run().stdout, '');
  assert.ok(run('UserPromptSubmit', { session_id: 'session-B' }).stdout);
  const first = run('SessionStart', {}, ['--json-hook']);
  assert.ok(JSON.parse(first.stdout).hookSpecificOutput.additionalContext);
  assert.equal(JSON.parse(first.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  const next = run('UserPromptSubmit', {}, ['--json-hook']);
  assert.equal(next.status, 0);
  assert.equal(next.stdout, '', 'no empty JSON envelope on cache hit');
  for (let index = 0; index < 2; index++) assert.ok(run('UserPromptSubmit', { session_id: '' }).stdout);
});

test('corrupt or unavailable cache re-emits; expired receipts do not suppress', async (t) => {
  const { run, stateRoot } = await cachedFixture(t);
  run('SessionStart');
  run();
  const receipt = path.join(
    stateRoot,
    fs.readdirSync(stateRoot).find((file) => file.endsWith('.json')),
  );
  fs.writeFileSync(receipt, '{');
  assert.ok(run().stdout);
  const old = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  old.emitted_at = 0;
  fs.writeFileSync(receipt, JSON.stringify(old));
  assert.ok(run().stdout);
  fs.rmSync(stateRoot, { recursive: true });
  fs.writeFileSync(stateRoot, 'not a directory');
  assert.ok(run().stdout, 'state failure cannot hide governance');
  assert.equal(run('PreCompact').status, 2, 'failed invalidation is explicit');
});

test('late receipt cannot undo compact invalidation; session names cannot escape state root', (t) => {
  const { tmp } = fixture(t);
  const { sessionState } = require('../.enterprise/governance/hooks/handlers/governance-context-state.cjs');
  const stateRoot = path.join(tmp, 'state');
  const id = '../../outside/session';
  sessionState(id, 'test', stateRoot).invalidate();
  const before = sessionState(id, 'test', stateRoot);
  sessionState(id, 'test', stateRoot).invalidate();
  before.remember('old-fingerprint');
  assert.equal(sessionState(id, 'test', stateRoot).matches('old-fingerprint'), false);
  assert.ok(fs.readdirSync(stateRoot).every((file) => /^[a-f0-9]{64}\.(json|epoch)$/.test(file)));
  assert.ok(!fs.existsSync(path.join(tmp, 'outside')));
});
