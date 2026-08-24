'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { CONTRACT_SCHEMA_VERSION } = require('../packages/agent-runtime-contracts');
const { CodexAppServerDriver, CodexRuntimeProvider } = require('../packages/runtime-providers');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-codex-app-server.js');

function temp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-codex-driver-'));
  return { directory, state: path.join(directory, 'remote.json'), cleanup: () => fs.rmSync(directory, { recursive: true }) };
}

function driver(fixture, mode = 'normal') {
  return new CodexAppServerDriver({
    executable: process.execPath,
    args: [FIXTURE, fixture.state, mode],
    cwd: fixture.directory,
    env: {},
  });
}

async function readRemoteState(file) {
  while (true) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

function spec(providerId, sessionId = 'session:codex-app-server') {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    session_id: sessionId,
    agent_id: 'agent:codex-app-server',
    parent_session_id: null,
    authority_ref: 'authority://codex/instructions-only',
    policy_ref: 'policy://codex/l0',
    execution: { mode: 'delegated', runtime_provider_id: providerId, profile: 'instructions-only' },
    limits: {
      max_turns: 2,
      max_tokens: 4096,
      max_duration_ms: 3000,
      max_tool_calls: 0,
      max_children: 0,
      max_workflow_steps: 0,
    },
    metadata: { cwd: path.dirname(__dirname), operational: false },
  };
}

function createInput(providerId, sessionSpec) {
  return { schema_version: 1, command: 'create', provider_id: providerId, spec: sessionSpec };
}

function eventsInput(providerId, sessionId, runtimeSessionId, fromSequence = 0) {
  return {
    schema_version: 1,
    provider_id: providerId,
    session_id: sessionId,
    runtime_session_id: runtimeSessionId,
    from_sequence: fromSequence,
  };
}

test('Codex app-server driver performs official initialize, thread and turn lifecycle over JSONL stdio', async () => {
  const fixture = temp();
  const providerId = 'runtime:codex-app-server';
  const sessionSpec = spec(providerId);
  const provider = new CodexRuntimeProvider({
    provider_id: providerId,
    driver: driver(fixture),
    default_cwd: fixture.directory,
    clock: () => '2026-08-24T02:00:00.000Z',
  });
  try {
    const created = await provider.create(createInput(providerId, sessionSpec));
    const stream = provider.events(eventsInput(providerId, sessionSpec.session_id, created.runtime_session_id));
    await provider.send({
      schema_version: 1,
      command: 'send',
      provider_id: providerId,
      runtime_session_id: created.runtime_session_id,
      session_id: sessionSpec.session_id,
      turn_id: 'turn:codex:1',
      message: { role: 'user', content: 'answer without effects' },
    });
    const seen = [];
    for await (const event of stream) seen.push(event);
    assert.deepEqual(
      seen.map((event) => event.event_type),
      ['runtime.session.started', 'runtime.message.delta', 'runtime.session.completed'],
    );
    assert.equal(seen[1].payload.text, 'fixture answer');
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.state, 'utf8')), {
      created: 1,
      resumed: 0,
      interrupted: 0,
      turns: 1,
      thread_id: 'codex-thread-1',
      selected_environment_received: false,
    });
  } finally {
    await provider.close();
    fixture.cleanup();
  }
});

test('a fresh driver process reattaches with thread/resume and never creates a replacement thread', async () => {
  const fixture = temp();
  const first = driver(fixture);
  try {
    const created = await first.create({
      adapter_id: 'codex',
      protocol: 'app-server',
      cwd: fixture.directory,
      limits: {},
      effect_boundary: 'instructions_only',
    });
    await first.close();
    const second = driver(fixture);
    try {
      assert.deepEqual(
        await second.resume({ runtime_session_id: created.runtime_session_id, expected_sequence: 1, effect_boundary: 'instructions_only' }),
        { effect_boundary: 'instructions_only' },
      );
      assert.deepEqual(JSON.parse(fs.readFileSync(fixture.state, 'utf8')), {
        created: 1,
        resumed: 1,
        interrupted: 0,
        turns: 0,
        thread_id: 'codex-thread-1',
        selected_environment_received: false,
      });
    } finally {
      await second.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('effect-bearing Codex items are rejected by the hosted L0 provider', async () => {
  const fixture = temp();
  const providerId = 'runtime:codex-effect-rejected';
  const sessionSpec = spec(providerId, 'session:codex-effect');
  const provider = new CodexRuntimeProvider({ provider_id: providerId, driver: driver(fixture, 'effect'), default_cwd: fixture.directory });
  try {
    const created = await provider.create(createInput(providerId, sessionSpec));
    await provider.send({
      schema_version: 1,
      command: 'send',
      provider_id: providerId,
      runtime_session_id: created.runtime_session_id,
      session_id: sessionSpec.session_id,
      turn_id: 'turn:effect',
      message: { role: 'user', content: 'attempt an effect' },
    });
    const seen = [];
    for await (const event of provider.events(eventsInput(providerId, sessionSpec.session_id, created.runtime_session_id)))
      seen.push(event);
    assert.equal(seen.at(-1).event_type, 'runtime.session.failed');
    assert.equal(seen.at(-1).payload.error_code, 'policy_denied');
  } finally {
    await provider.close();
    fixture.cleanup();
  }
});

test('an unknown future Codex item fails closed as an effect instead of widening L0', async () => {
  const fixture = temp();
  const providerId = 'runtime:codex-unknown-effect';
  const sessionSpec = spec(providerId, 'session:codex-unknown-effect');
  const provider = new CodexRuntimeProvider({
    provider_id: providerId,
    driver: driver(fixture, 'unknown-effect'),
    default_cwd: fixture.directory,
  });
  try {
    const created = await provider.create(createInput(providerId, sessionSpec));
    await provider.send({
      schema_version: 1,
      command: 'send',
      provider_id: providerId,
      runtime_session_id: created.runtime_session_id,
      session_id: sessionSpec.session_id,
      turn_id: 'turn:future-effect',
      message: { role: 'user', content: 'exercise a future item' },
    });
    const seen = [];
    for await (const event of provider.events(eventsInput(providerId, sessionSpec.session_id, created.runtime_session_id)))
      seen.push(event);
    assert.equal(seen.at(-1).event_type, 'runtime.session.failed');
    assert.equal(seen.at(-1).payload.error_code, 'policy_denied');
  } finally {
    await provider.close();
    fixture.cleanup();
  }
});

test('an app-server process exit settles the active hosted stream as provider unavailable', async () => {
  const fixture = temp();
  const providerId = 'runtime:codex-process-exit';
  const sessionSpec = spec(providerId, 'session:codex-process-exit');
  const provider = new CodexRuntimeProvider({ provider_id: providerId, driver: driver(fixture, 'exit'), default_cwd: fixture.directory });
  try {
    const created = await provider.create(createInput(providerId, sessionSpec));
    await provider.send({
      schema_version: 1,
      command: 'send',
      provider_id: providerId,
      runtime_session_id: created.runtime_session_id,
      session_id: sessionSpec.session_id,
      turn_id: 'turn:exit',
      message: { role: 'user', content: 'exit after acknowledgement' },
    });
    const seen = [];
    for await (const event of provider.events(eventsInput(providerId, sessionSpec.session_id, created.runtime_session_id)))
      seen.push(event);
    assert.equal(seen.at(-1).event_type, 'runtime.session.failed');
    assert.equal(seen.at(-1).payload.error_code, 'provider_unavailable');
  } finally {
    await provider.close();
    fixture.cleanup();
  }
});

test('driver cancellation maps to turn/interrupt and terminates the process', async () => {
  const fixture = temp();
  const instance = driver(fixture, 'wait');
  try {
    const created = await instance.create({
      adapter_id: 'codex',
      protocol: 'app-server',
      cwd: fixture.directory,
      limits: {},
      effect_boundary: 'instructions_only',
    });
    const pending = instance.send({
      runtime_session_id: created.runtime_session_id,
      turn_id: 'turn:wait',
      instruction: 'wait for cancellation',
      effect_boundary: 'instructions_only',
      on_event: () => {},
    });
    while ((await readRemoteState(fixture.state)).turns === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await instance.cancel({ runtime_session_id: created.runtime_session_id, reason: 'operator stop' });
    assert.deepEqual(await pending, { stop_reason: 'cancelled' });
    assert.equal(JSON.parse(fs.readFileSync(fixture.state, 'utf8')).interrupted, 1);
  } finally {
    await instance.close();
    fixture.cleanup();
  }
});

test('driver rejects a relative executable and an environment with non-explicit keys', () => {
  const fixture = temp();
  try {
    assert.throws(() => new CodexAppServerDriver({ executable: 'codex', cwd: fixture.directory }), /executable/);
    assert.throws(
      () => new CodexAppServerDriver({ executable: process.execPath, cwd: fixture.directory, env: { lowercase: 'forbidden' } }),
      /environment entry/,
    );
  } finally {
    fixture.cleanup();
  }
});
