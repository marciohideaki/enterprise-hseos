'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CONTRACT_SCHEMA_VERSION,
  negotiateRuntimeCapabilities,
  validatePortResult,
} = require('../packages/agent-runtime-contracts');
const {
  HOSTED_RUNTIME_ADAPTERS,
  ClaudeCodeRuntimeProvider,
  CodexRuntimeProvider,
  DeepSeekHarnessRuntimeProvider,
  RuntimeProviderError,
} = require('../packages/runtime-providers');
const fixtures = require('./fixtures/agent-runtime-contracts');

class FakeHostedDriver {
  calls = [];

  constructor({ boundary = 'instructions_only', resumable = true } = {}) {
    this.boundary = boundary;
    this.resumable = resumable;
  }

  async create(input) {
    this.calls.push(['create', structuredClone(input)]);
    return { runtime_session_id: 'hosted-session-1', effect_boundary: this.boundary, resumable: this.resumable };
  }

  send(input) {
    const { on_event: unused, ...serializable } = input;
    this.calls.push(['send', structuredClone(serializable)]);
    this.current = input;
    return new Promise((resolve, reject) => { this.turn = { resolve, reject }; });
  }

  async resume(input) {
    this.calls.push(['resume', structuredClone(input)]);
    return { effect_boundary: this.boundary };
  }

  async cancel(input) { this.calls.push(['cancel', structuredClone(input)]); }
  async dispose(input) { this.calls.push(['dispose', structuredClone(input)]); }
  async close() { this.calls.push(['close']); }
  emit(event) { return this.current.on_event(structuredClone(event)); }
}

function runtime(Adapter, providerId, driver = new FakeHostedDriver()) {
  let tick = 0;
  return new Adapter({
    provider_id: providerId,
    driver,
    default_cwd: '/workspace/default',
    clock: () => new Date(Date.parse('2026-08-22T18:00:00Z') + tick++ * 1000).toISOString(),
  });
}

function query(providerId) {
  return { schema_version: CONTRACT_SCHEMA_VERSION, provider_id: providerId, request_id: 'request:hosted-manifest' };
}

function createInput(providerId, sessionId = 'session:hosted-1') {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    command: 'create',
    provider_id: providerId,
    spec: {
      ...structuredClone(fixtures.delegatedSession),
      session_id: sessionId,
      execution: { mode: 'delegated', runtime_provider_id: providerId, profile: 'instructions-only' },
      metadata: { cwd: '/workspace/task', purpose: 'hosted adapter conformance' },
    },
  };
}

function sessionInput(providerId, command, runtimeSessionId = 'hosted-session-1', sessionId = 'session:hosted-1') {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    command,
    provider_id: providerId,
    runtime_session_id: runtimeSessionId,
    session_id: sessionId,
  };
}

async function collect(provider, providerId, fromSequence = 0) {
  const input = {
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_id: providerId,
    runtime_session_id: 'hosted-session-1',
    session_id: 'session:hosted-1',
    from_sequence: fromSequence,
  };
  const events = [];
  for await (const event of validatePortResult('RuntimeProvider', 'events', provider.events(input), input)) events.push(event);
  return events;
}

for (const [name, Adapter, providerId, transport] of [
  ['Codex', CodexRuntimeProvider, 'runtime:codex', 'stdio'],
  ['Claude Code', ClaudeCodeRuntimeProvider, 'runtime:claude-code', 'process'],
]) {
  test(`${name} manifest is immutable, secretless and honestly L0`, () => {
    const provider = runtime(Adapter, providerId);
    const input = query(providerId);
    const manifest = validatePortResult('RuntimeProvider', 'manifest', provider.manifest(input), input);
    assert.equal(manifest.transport, transport);
    assert.equal(manifest.conformance_level, 'L0');
    assert.deepEqual(manifest.capabilities, ['instructions']);
    assert.deepEqual(manifest.secret_refs, []);
    assert.equal(negotiateRuntimeCapabilities(manifest, 'L0').ok, true);
    for (const level of ['L1', 'L2', 'L3', 'L4']) assert.equal(negotiateRuntimeCapabilities(manifest, level).ok, false);
    assert.throws(() => { manifest.capabilities.push('governed_tools'); }, TypeError);
  });

  test(`${name} maps its injected native driver to ordered RuntimeProvider facts`, async () => {
    const driver = new FakeHostedDriver();
    const provider = runtime(Adapter, providerId, driver);
    const create = createInput(providerId);
    const created = validatePortResult('RuntimeProvider', 'create', await provider.create(create), create);
    assert.equal(created.runtime_session_id, 'hosted-session-1');
    assert.deepEqual(driver.calls[0][1], {
      adapter_id: name === 'Codex' ? 'codex' : 'claude-code',
      protocol: name === 'Codex' ? 'app-server' : 'agent-sdk',
      cwd: '/workspace/task',
      limits: create.spec.limits,
      effect_boundary: 'instructions_only',
    });
    const send = {
      ...sessionInput(providerId, 'send'),
      turn_id: 'turn:hosted-1',
      message: { role: 'user', content: 'answer without effects' },
    };
    await provider.send(send);
    driver.emit({ type: 'message.delta', text: 'bounded answer' });
    driver.turn.resolve({ stop_reason: 'completed' });
    const events = await collect(provider, providerId);
    assert.deepEqual(events.map((event) => event.event_type), [
      'runtime.session.started',
      'runtime.message.delta',
      'runtime.session.completed',
    ]);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  });
}

test('hosted adapters fail closed when attestation is missing or an effect is attempted', async () => {
  const denied = runtime(CodexRuntimeProvider, 'runtime:codex-denied', new FakeHostedDriver({ boundary: 'unrestricted' }));
  await assert.rejects(() => denied.create(createInput('runtime:codex-denied')), (error) => error.error_code === 'policy_denied');

  const driver = new FakeHostedDriver();
  const provider = runtime(ClaudeCodeRuntimeProvider, 'runtime:claude-effect', driver);
  await provider.create(createInput('runtime:claude-effect'));
  await provider.send({
    ...sessionInput('runtime:claude-effect', 'send'),
    turn_id: 'turn:effect',
    message: { role: 'user', content: 'do not use tools' },
  });
  driver.emit({ type: 'effect.attempted', effect: 'terminal' });
  const events = await collect(provider, 'runtime:claude-effect');
  assert.equal(events.at(-1).event_type, 'runtime.session.failed');
  assert.equal(events.at(-1).payload.error_code, 'policy_denied');
  assert.equal(driver.calls.some(([method]) => method === 'cancel'), true);
});

test('hosted resume requires declared support and re-attests the effect boundary', async () => {
  const unavailable = runtime(CodexRuntimeProvider, 'runtime:codex-no-resume', new FakeHostedDriver({ resumable: false }));
  await unavailable.create(createInput('runtime:codex-no-resume'));
  await assert.rejects(
    () => unavailable.resume({ ...sessionInput('runtime:codex-no-resume', 'resume'), expected_sequence: 1 }),
    (error) => error instanceof RuntimeProviderError && error.error_code === 'capability_unavailable',
  );

  const driver = new FakeHostedDriver();
  const provider = runtime(CodexRuntimeProvider, 'runtime:codex-resume', driver);
  await provider.create(createInput('runtime:codex-resume'));
  const input = { ...sessionInput('runtime:codex-resume', 'resume'), expected_sequence: 1 };
  assert.equal(validatePortResult('RuntimeProvider', 'resume', await provider.resume(input), input).terminal, false);
  assert.equal(driver.calls.at(-1)[0], 'resume');
});

for (const [name, Adapter, providerId] of [
  ['Codex', CodexRuntimeProvider, 'runtime:codex-reattach'],
  ['Claude Code', ClaudeCodeRuntimeProvider, 'runtime:claude-reattach'],
]) {
  test(`${name} reattaches a durable session in a fresh provider without creating a new remote identity`, async () => {
    const driver = new FakeHostedDriver();
    const restored = runtime(Adapter, providerId, driver);
    const spec = createInput(providerId).spec;
    const resume = {
      ...sessionInput(providerId, 'resume'),
      expected_sequence: 7,
      spec,
    };
    const result = validatePortResult('RuntimeProvider', 'resume', await restored.resume(resume), resume);
    assert.equal(result.runtime_session_id, 'hosted-session-1');
    assert.deepEqual(driver.calls.map(([method]) => method), ['resume']);

    const send = {
      ...sessionInput(providerId, 'send'),
      turn_id: `turn:${name.toLowerCase().replace(' ', '-')}-restored`,
      message: { role: 'user', content: 'continue from durable state' },
    };
    await restored.send(send);
    driver.emit({ type: 'message.delta', text: 'resumed' });
    driver.turn.resolve({ stop_reason: 'completed' });
    const events = await collect(restored, providerId, 7);
    assert.deepEqual(events.map((event) => [event.sequence, event.event_type]), [
      [8, 'runtime.message.delta'],
      [9, 'runtime.session.completed'],
    ]);
  });
}

test('hosted reattachment rejects missing or drifted durable specs before driver dispatch', async () => {
  const providerId = 'runtime:codex-reattach-invalid';
  const driver = new FakeHostedDriver();
  const restored = runtime(CodexRuntimeProvider, providerId, driver);
  const base = { ...sessionInput(providerId, 'resume'), expected_sequence: 3 };
  await assert.rejects(() => restored.resume(base), /durable session spec is required/);
  assert.deepEqual(driver.calls, []);

  const spec = createInput(providerId).spec;
  await restored.resume({ ...base, spec });
  const drifted = structuredClone(spec);
  drifted.limits.max_tokens += 1;
  await assert.rejects(() => restored.resume({ ...base, spec: drifted }), /does not match/);
  assert.equal(driver.calls.filter(([method]) => method === 'resume').length, 1);
});

test('DeepSeek Harness adapter is the ACP bridge and does not import Cordis or MCP', () => {
  assert.equal(Object.getPrototypeOf(DeepSeekHarnessRuntimeProvider.prototype).constructor.name, 'AcpRuntimeProvider');
  assert.deepEqual(HOSTED_RUNTIME_ADAPTERS['deepseek-harness'], {
    adapter_id: 'deepseek-harness',
    protocol: 'acp-v1',
    transport: 'acp',
    conformance_level: 'L0',
    capabilities: ['instructions'],
    external_dependency: '@agentclientprotocol/sdk',
  });
  assert.throws(() => { HOSTED_RUNTIME_ADAPTERS['deepseek-harness'].capabilities.push('governed_tools'); }, TypeError);
});

test('unknown driver events and malformed stop reasons terminate without false success', async () => {
  const driver = new FakeHostedDriver();
  const provider = runtime(CodexRuntimeProvider, 'runtime:codex-malformed', driver);
  await provider.create(createInput('runtime:codex-malformed'));
  await provider.send({
    ...sessionInput('runtime:codex-malformed', 'send'),
    turn_id: 'turn:malformed',
    message: { role: 'user', content: 'validate boundary' },
  });
  assert.throws(() => driver.emit({ type: 'unknown' }), /unsupported/);
  driver.turn.resolve({ stop_reason: 'invented_success' });
  const events = await collect(provider, 'runtime:codex-malformed');
  assert.equal(events.at(-1).event_type, 'runtime.session.failed');
  assert.equal(events.at(-1).payload.error_code, 'protocol_error');
});

test('hosted adapters bound input, active turns and non-settling teardown', async () => {
  const driver = new FakeHostedDriver();
  driver.cancel = () => new Promise(() => {});
  const provider = runtime(CodexRuntimeProvider, 'runtime:codex-bounds', driver);
  const create = createInput('runtime:codex-bounds');
  create.spec.limits.max_tokens = 1;
  create.spec.limits.max_duration_ms = 10;
  await provider.create(create);
  await assert.rejects(
    () => provider.send({
      ...sessionInput('runtime:codex-bounds', 'send'),
      turn_id: 'turn:oversized',
      message: { role: 'user', content: 'x'.repeat(1025) },
    }),
    (error) => error.error_code === 'budget_exceeded',
  );
  await provider.send({
    ...sessionInput('runtime:codex-bounds', 'send'),
    turn_id: 'turn:timeout',
    message: { role: 'user', content: 'wait forever' },
  });
  const events = await collect(provider, 'runtime:codex-bounds');
  assert.equal(events.at(-1).payload.error_code, 'timeout');
  const dispose = sessionInput('runtime:codex-bounds', 'dispose');
  const startedAt = Date.now();
  await provider.dispose(dispose);
  assert.equal(Date.now() - startedAt < 100, true);
});

test('hosted create deadline cancels a runtime identity published late', async () => {
  let release;
  const driver = new FakeHostedDriver();
  driver.create = () => new Promise((resolve) => { release = resolve; });
  const provider = runtime(ClaudeCodeRuntimeProvider, 'runtime:claude-create-timeout', driver);
  const input = createInput('runtime:claude-create-timeout');
  input.spec.limits.max_duration_ms = 5;
  await assert.rejects(() => provider.create(input), (error) => error.error_code === 'timeout');
  release({ runtime_session_id: 'late-runtime', effect_boundary: 'instructions_only', resumable: false });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(driver.calls.some(([method, value]) => method === 'cancel' && value.runtime_session_id === 'late-runtime'), true);
});

test('runtime identity collision quarantines the active owner before rejecting reuse', async () => {
  const driver = new FakeHostedDriver();
  const provider = runtime(CodexRuntimeProvider, 'runtime:codex-collision', driver);
  await provider.create(createInput('runtime:codex-collision'));
  await assert.rejects(
    () => provider.create(createInput('runtime:codex-collision', 'session:hosted-2')),
    /reused a session identity/,
  );
  const events = await collect(provider, 'runtime:codex-collision');
  assert.equal(events.at(-1).event_type, 'runtime.session.failed');
  assert.equal(events.at(-1).payload.error_code, 'protocol_error');
  await assert.rejects(() => provider.send({
    ...sessionInput('runtime:codex-collision', 'send'),
    turn_id: 'turn:quarantined',
    message: { role: 'user', content: 'must not run' },
  }), /cannot accept/);
});

test('close fences a pending create and cancels its late published identity', async () => {
  let release;
  const driver = new FakeHostedDriver();
  driver.create = () => new Promise((resolve) => { release = resolve; });
  const provider = runtime(ClaudeCodeRuntimeProvider, 'runtime:claude-close-create', driver);
  const creation = provider.create(createInput('runtime:claude-close-create'));
  const rejected = assert.rejects(() => creation, /interrupted by provider close/);
  await new Promise((resolve) => setImmediate(resolve));
  await provider.close();
  await rejected;
  release({ runtime_session_id: 'late-after-close', effect_boundary: 'instructions_only', resumable: true });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(driver.calls.some(([method, value]) => method === 'cancel' && value.runtime_session_id === 'late-after-close'), true);
});

test('malformed hosted event envelope cannot be followed by false success', async () => {
  const driver = new FakeHostedDriver();
  const provider = runtime(CodexRuntimeProvider, 'runtime:codex-event-envelope', driver);
  await provider.create(createInput('runtime:codex-event-envelope'));
  await provider.send({
    ...sessionInput('runtime:codex-event-envelope', 'send'),
    turn_id: 'turn:forged',
    message: { role: 'user', content: 'validate strict event' },
  });
  assert.throws(() => driver.emit({ type: 'message.delta', text: 'forged', forbidden: true }), /unknown fields/);
  driver.turn.resolve({ stop_reason: 'completed' });
  const events = await collect(provider, 'runtime:codex-event-envelope');
  assert.equal(events.at(-1).event_type, 'runtime.session.failed');
  assert.equal(events.at(-1).payload.error_code, 'protocol_error');
});

test('resume is exclusive and a concurrent cancel prevents false resume success', async () => {
  let release;
  const driver = new FakeHostedDriver();
  driver.resume = () => new Promise((resolve) => { release = resolve; });
  const provider = runtime(ClaudeCodeRuntimeProvider, 'runtime:claude-resume-race', driver);
  await provider.create(createInput('runtime:claude-resume-race'));
  const resumeInput = { ...sessionInput('runtime:claude-resume-race', 'resume'), expected_sequence: 1 };
  const resuming = provider.resume(resumeInput);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => provider.resume(resumeInput), /cannot resume/);
  await assert.rejects(() => provider.send({
    ...sessionInput('runtime:claude-resume-race', 'send'),
    turn_id: 'turn:during-resume',
    message: { role: 'user', content: 'must wait' },
  }), /cannot accept/);
  await provider.cancel({ ...sessionInput('runtime:claude-resume-race', 'cancel'), reason: 'user cancelled', cascade: true });
  await assert.rejects(() => resuming, /resume was interrupted/);
  release({ effect_boundary: 'instructions_only' });
  const events = await collect(provider, 'runtime:claude-resume-race');
  assert.equal(events.at(-1).payload.error_code, 'cancelled');
});

test('unconfirmed dispose quarantines the remote identity against ABA reuse', async () => {
  const driver = new FakeHostedDriver();
  driver.dispose = () => new Promise(() => {});
  const provider = runtime(CodexRuntimeProvider, 'runtime:codex-dispose-aba', driver);
  await provider.create(createInput('runtime:codex-dispose-aba'));
  await provider.dispose(sessionInput('runtime:codex-dispose-aba', 'dispose'));
  await assert.rejects(
    () => provider.create(createInput('runtime:codex-dispose-aba', 'session:hosted-2')),
    /reused a session identity/,
  );
});

test('resume timeout terminalizes and cancels the potentially resumed remote session', async () => {
  const driver = new FakeHostedDriver();
  driver.resume = () => new Promise(() => {});
  const provider = runtime(CodexRuntimeProvider, 'runtime:codex-resume-timeout', driver);
  const create = createInput('runtime:codex-resume-timeout');
  create.spec.limits.max_duration_ms = 5;
  await provider.create(create);
  await assert.rejects(
    () => provider.resume({ ...sessionInput('runtime:codex-resume-timeout', 'resume'), expected_sequence: 1 }),
    (error) => error.error_code === 'timeout',
  );
  const events = await collect(provider, 'runtime:codex-resume-timeout');
  assert.equal(events.at(-1).payload.error_code, 'timeout');
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(driver.calls.some(([method]) => method === 'cancel'), true);
});

test('failed create quarantines an unconfirmed published identity against ABA reuse', async () => {
  let creates = 0;
  const driver = new FakeHostedDriver();
  driver.create = async () => ({
    runtime_session_id: 'same-remote',
    effect_boundary: creates++ === 0 ? 'unrestricted' : 'instructions_only',
    resumable: false,
  });
  driver.cancel = () => new Promise(() => {});
  const provider = runtime(CodexRuntimeProvider, 'runtime:codex-create-aba', driver);
  await assert.rejects(
    () => provider.create(createInput('runtime:codex-create-aba')),
    (error) => error.error_code === 'policy_denied',
  );
  await assert.rejects(
    () => provider.create(createInput('runtime:codex-create-aba', 'session:hosted-2')),
    /reused a session identity/,
  );
});

test('quarantined identities count against the fixed provider admission cap', async () => {
  let nextId = 0;
  const driver = new FakeHostedDriver();
  driver.create = async () => ({
    runtime_session_id: `quarantined-${++nextId}`,
    effect_boundary: 'instructions_only',
    resumable: false,
  });
  driver.dispose = async () => { throw new Error('remote teardown uncertain'); };
  const providerId = 'runtime:codex-quarantine-cap';
  const provider = runtime(CodexRuntimeProvider, providerId, driver);
  for (let index = 1; index <= 128; index += 1) {
    const sessionId = `session:quarantine-${index}`;
    const created = await provider.create(createInput(providerId, sessionId));
    await provider.dispose(sessionInput(providerId, 'dispose', created.runtime_session_id, sessionId));
  }
  await assert.rejects(
    () => provider.create(createInput(providerId, 'session:quarantine-overflow')),
    (error) => error.error_code === 'rate_limited',
  );
});

test('late create identity remains quarantined when timeout compensation cannot settle', async () => {
  let release;
  let createCount = 0;
  const driver = new FakeHostedDriver();
  driver.create = () => {
    createCount += 1;
    if (createCount === 1) return new Promise((resolve) => { release = resolve; });
    return Promise.resolve({ runtime_session_id: 'late-id', effect_boundary: 'instructions_only', resumable: false });
  };
  driver.cancel = () => new Promise(() => {});
  const providerId = 'runtime:claude-late-aba';
  const provider = runtime(ClaudeCodeRuntimeProvider, providerId, driver);
  const first = createInput(providerId);
  first.spec.limits.max_duration_ms = 5;
  await assert.rejects(() => provider.create(first), (error) => error.error_code === 'timeout');
  release({ runtime_session_id: 'late-id', effect_boundary: 'instructions_only', resumable: false });
  await new Promise((resolve) => setTimeout(resolve, 35));
  await assert.rejects(
    () => provider.create(createInput(providerId, 'session:hosted-2')),
    /reused a session identity/,
  );
});

test('confirmed create compensation cannot release an ID beneath an older in-flight create', async () => {
  let createCount = 0;
  let releaseSecondCreate;
  let confirmCancel;
  const driver = new FakeHostedDriver();
  driver.create = () => {
    createCount += 1;
    if (createCount === 1) {
      return Promise.resolve({ runtime_session_id: 'raced-id', effect_boundary: 'unrestricted', resumable: false });
    }
    return new Promise((resolve) => { releaseSecondCreate = resolve; });
  };
  driver.cancel = () => new Promise((resolve) => { confirmCancel = resolve; });
  const providerId = 'runtime:codex-create-fence';
  const provider = runtime(CodexRuntimeProvider, providerId, driver);
  const first = provider.create(createInput(providerId));
  await new Promise((resolve) => setImmediate(resolve));
  const second = provider.create(createInput(providerId, 'session:hosted-2'));
  await new Promise((resolve) => setImmediate(resolve));
  confirmCancel();
  await assert.rejects(() => first, (error) => error.error_code === 'policy_denied');
  releaseSecondCreate({ runtime_session_id: 'raced-id', effect_boundary: 'instructions_only', resumable: false });
  await assert.rejects(() => second, /reused a session identity/);
});

test('confirmed dispose cannot release an ID beneath an in-flight create', async () => {
  let createCount = 0;
  let releaseSecondCreate;
  const driver = new FakeHostedDriver();
  driver.create = () => {
    createCount += 1;
    if (createCount === 1) {
      return Promise.resolve({ runtime_session_id: 'dispose-raced-id', effect_boundary: 'instructions_only', resumable: false });
    }
    return new Promise((resolve) => { releaseSecondCreate = resolve; });
  };
  const providerId = 'runtime:claude-dispose-fence';
  const provider = runtime(ClaudeCodeRuntimeProvider, providerId, driver);
  await provider.create(createInput(providerId));
  const second = provider.create(createInput(providerId, 'session:hosted-2'));
  await new Promise((resolve) => setImmediate(resolve));
  await provider.dispose(sessionInput(providerId, 'dispose', 'dispose-raced-id'));
  releaseSecondCreate({ runtime_session_id: 'dispose-raced-id', effect_boundary: 'instructions_only', resumable: false });
  await assert.rejects(() => second, /reused a session identity/);
});

test('late tombstones cannot exceed the cap and degrade admission fail-closed', async () => {
  const releases = [];
  const driver = new FakeHostedDriver();
  driver.create = () => new Promise((resolve) => { releases.push(resolve); });
  driver.cancel = () => new Promise(() => {});
  const providerId = 'runtime:codex-late-cap';
  const provider = runtime(CodexRuntimeProvider, providerId, driver);
  for (let index = 1; index <= 129; index += 1) {
    const input = createInput(providerId, `session:late-cap-${index}`);
    input.spec.limits.max_duration_ms = 1;
    await assert.rejects(() => provider.create(input), (error) => error.error_code === 'timeout');
  }
  for (const [index, release] of releases.entries()) {
    release({
      runtime_session_id: `late-cap-${index + 1}`,
      effect_boundary: 'instructions_only',
      resumable: false,
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => provider.create(createInput(providerId, 'session:after-late-cap')),
    (error) => error.error_code === 'provider_unavailable' && /quarantine/.test(error.message),
  );
});
