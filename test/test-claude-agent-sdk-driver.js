'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { CONTRACT_SCHEMA_VERSION } = require('../packages/agent-runtime-contracts');
const { ClaudeAgentSdkDriver, ClaudeCodeRuntimeProvider } = require('../packages/runtime-providers');

const SDK = path.join(__dirname, 'fixtures', 'fake-claude-agent-sdk.mjs');

function temp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-claude-driver-'));
  return { directory, state: path.join(directory, 'remote.json'), cleanup: () => fs.rmSync(directory, { recursive: true }) };
}

function driver(fixture, env = {}) {
  return new ClaudeAgentSdkDriver({
    sdk_module: SDK,
    executable: process.execPath,
    cwd: fixture.directory,
    env: { HSEOS_CLAUDE_TEST_REMOTE: fixture.state, ...env },
  });
}

function spec(providerId, cwd, sessionId = 'session:claude-agent-sdk') {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    session_id: sessionId,
    agent_id: 'agent:claude-agent-sdk',
    parent_session_id: null,
    authority_ref: 'authority://claude/instructions-only',
    policy_ref: 'policy://claude/l0',
    execution: { mode: 'delegated', runtime_provider_id: providerId, profile: 'instructions-only' },
    limits: {
      max_turns: 2,
      max_tokens: 4096,
      max_duration_ms: 3000,
      max_tool_calls: 0,
      max_children: 0,
      max_workflow_steps: 0,
    },
    metadata: { cwd, operational: false },
  };
}

function createInput(providerId, sessionSpec) {
  return { schema_version: 1, command: 'create', provider_id: providerId, spec: sessionSpec };
}

function eventsInput(providerId, sessionId, runtimeSessionId) {
  return {
    schema_version: 1,
    provider_id: providerId,
    session_id: sessionId,
    runtime_session_id: runtimeSessionId,
    from_sequence: 0,
  };
}

async function send(provider, providerId, sessionId, runtimeSessionId, message) {
  return provider.send({
    schema_version: 1,
    command: 'send',
    provider_id: providerId,
    runtime_session_id: runtimeSessionId,
    session_id: sessionId,
    turn_id: `turn:${message}`,
    message: { role: 'user', content: message },
  });
}

test('Claude Agent SDK driver binds an explicit session and completes through the hosted L0 provider', async () => {
  const fixture = temp();
  const providerId = 'runtime:claude-agent-sdk';
  const sessionSpec = spec(providerId, fixture.directory);
  const provider = new ClaudeCodeRuntimeProvider({
    provider_id: providerId,
    driver: driver(fixture),
    default_cwd: fixture.directory,
    clock: () => '2026-08-24T03:00:00.000Z',
  });
  try {
    const created = await provider.create(createInput(providerId, sessionSpec));
    const stream = provider.events(eventsInput(providerId, sessionSpec.session_id, created.runtime_session_id));
    await send(provider, providerId, sessionSpec.session_id, created.runtime_session_id, 'answer');
    const seen = [];
    for await (const event of stream) seen.push(event);
    assert.deepEqual(
      seen.map((event) => event.event_type),
      ['runtime.session.started', 'runtime.message.delta', 'runtime.session.completed'],
    );
    assert.equal(seen[1].payload.text, 'fixture answer');
    const remote = JSON.parse(fs.readFileSync(fixture.state, 'utf8'));
    assert.equal(remote.sessions[created.runtime_session_id].mode, 'new');
    assert.equal(remote.sessions[created.runtime_session_id].isolated, true);
  } finally {
    await provider.close();
    fixture.cleanup();
  }
});

test('a fresh driver finds an existing transcript and resumes the exact session id', async () => {
  const fixture = temp();
  process.env.HSEOS_CLAUDE_TEST_REMOTE = fixture.state;
  const first = driver(fixture);
  try {
    const created = await first.create({
      adapter_id: 'claude-code',
      protocol: 'agent-sdk',
      cwd: fixture.directory,
      limits: {},
      effect_boundary: 'instructions_only',
    });
    await first.send({
      runtime_session_id: created.runtime_session_id,
      turn_id: 'turn:first',
      instruction: 'answer',
      effect_boundary: 'instructions_only',
      on_event: () => {},
    });
    await first.close();
    const second = driver(fixture);
    try {
      await second.resume({
        runtime_session_id: created.runtime_session_id,
        expected_sequence: 3,
        effect_boundary: 'instructions_only',
      });
      await second.send({
        runtime_session_id: created.runtime_session_id,
        turn_id: 'turn:second',
        instruction: 'answer again',
        effect_boundary: 'instructions_only',
        on_event: () => {},
      });
      const remote = JSON.parse(fs.readFileSync(fixture.state, 'utf8'));
      assert.equal(remote.queries, 2);
      assert.equal(remote.sessions[created.runtime_session_id].mode, 'resume');
    } finally {
      await second.close();
    }
  } finally {
    delete process.env.HSEOS_CLAUDE_TEST_REMOTE;
    fixture.cleanup();
  }
});

for (const prompt of ['effect', 'unknown-effect']) {
  test(`Claude ${prompt} content fails closed at the hosted effect boundary`, async () => {
    const fixture = temp();
    const providerId = `runtime:claude-${prompt}`;
    const sessionSpec = spec(providerId, fixture.directory, `session:claude-${prompt}`);
    const provider = new ClaudeCodeRuntimeProvider({
      provider_id: providerId,
      driver: driver(fixture),
      default_cwd: fixture.directory,
    });
    try {
      const created = await provider.create(createInput(providerId, sessionSpec));
      await send(provider, providerId, sessionSpec.session_id, created.runtime_session_id, prompt);
      const seen = [];
      for await (const event of provider.events(eventsInput(providerId, sessionSpec.session_id, created.runtime_session_id))) {
        seen.push(event);
      }
      assert.equal(seen.at(-1).event_type, 'runtime.session.failed');
      assert.equal(seen.at(-1).payload.error_code, 'policy_denied');
    } finally {
      await provider.close();
      fixture.cleanup();
    }
  });
}

test('driver cancellation aborts and closes an active Agent SDK query', async () => {
  const fixture = temp();
  const instance = driver(fixture);
  try {
    const created = await instance.create({
      adapter_id: 'claude-code',
      protocol: 'agent-sdk',
      cwd: fixture.directory,
      limits: {},
      effect_boundary: 'instructions_only',
    });
    const pending = instance.send({
      runtime_session_id: created.runtime_session_id,
      turn_id: 'turn:wait',
      instruction: 'wait',
      effect_boundary: 'instructions_only',
      on_event: () => {},
    });
    while (!fs.existsSync(fixture.state)) await new Promise((resolve) => setImmediate(resolve));
    await instance.cancel({ runtime_session_id: created.runtime_session_id, reason: 'operator stop' });
    assert.deepEqual(await pending, { stop_reason: 'cancelled' });
  } finally {
    await instance.close();
    fixture.cleanup();
  }
});

test('driver passes only the selected environment values to the SDK child contract', async () => {
  const fixture = temp();
  const instance = driver(fixture, { HSEOS_CLAUDE_TEST_VALUE: 'selected-runtime-value' });
  try {
    const created = await instance.create({
      adapter_id: 'claude-code',
      protocol: 'agent-sdk',
      cwd: fixture.directory,
      limits: {},
      effect_boundary: 'instructions_only',
    });
    await instance.send({
      runtime_session_id: created.runtime_session_id,
      turn_id: 'turn:env',
      instruction: 'answer',
      effect_boundary: 'instructions_only',
      on_event: () => {},
    });
    const remote = JSON.parse(fs.readFileSync(fixture.state, 'utf8'));
    assert.equal(remote.sessions[created.runtime_session_id].selected_environment_received, true);
  } finally {
    await instance.close();
    fixture.cleanup();
  }
});

test('driver rejects relative bindings and implicit environment keys', () => {
  const fixture = temp();
  try {
    assert.throws(
      () => new ClaudeAgentSdkDriver({ sdk_module: 'sdk.mjs', executable: process.execPath, cwd: fixture.directory }),
      /SDK module must be absolute/,
    );
    assert.throws(
      () => new ClaudeAgentSdkDriver({ sdk_module: SDK, executable: process.execPath, cwd: fixture.directory, env: { lowercase: 'no' } }),
      /environment entry/,
    );
  } finally {
    fixture.cleanup();
  }
});
