'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { CONTRACT_SCHEMA_VERSION, negotiateRuntimeCapabilities, validatePortResult } = require('../packages/agent-runtime-contracts');
const { AcpRuntimeProvider, RuntimeProviderError } = require('../packages/runtime-providers');
const fixtures = require('./fixtures/agent-runtime-contracts');

const PROVIDER_ID = 'runtime:acp-fixture';

class FakeAcpPeer {
  closed = false;
  calls = [];
  notifications = [];

  constructor({ version = 1, effectBoundary = 'instructions_only', loadSession = true } = {}) {
    this.version = version;
    this.effectBoundary = effectBoundary;
    this.loadSession = loadSession;
    this.prompt = null;
  }

  subscribe(handlers) {
    this.handlers = handlers;
    return () => {
      this.handlers = null;
    };
  }

  async request(method, params) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'initialize') {
      return {
        protocolVersion: this.version,
        agentCapabilities: {
          loadSession: this.loadSession,
          _meta: { hseos: { effectBoundary: this.effectBoundary } },
        },
        authMethods: [],
      };
    }
    if (method === 'session/new') return { sessionId: 'acp-session-1' };
    if (method === 'session/load') {
      if (this.loadUpdate) this.emit('session/update', this.loadUpdate);
      return {};
    }
    if (method === 'session/prompt') {
      return new Promise((resolve, reject) => {
        this.prompt = { resolve, reject };
      });
    }
    throw new Error(`unexpected request ${method}`);
  }

  async notify(method, params) {
    this.notifications.push({ method, params: structuredClone(params) });
  }

  emit(method, params) {
    return this.handlers.notification(method, structuredClone(params));
  }

  callClient(method, params) {
    return this.handlers.request(method, structuredClone(params));
  }

  async close() {
    this.closed = true;
  }
}

function delegatedSpec(sessionId = 'session:acp-1') {
  return {
    ...structuredClone(fixtures.delegatedSession),
    session_id: sessionId,
    execution: { mode: 'delegated', runtime_provider_id: PROVIDER_ID, profile: 'instructions-only' },
    metadata: { cwd: '/workspace/fixture', purpose: 'ACP conformance' },
  };
}

function provider(peer = new FakeAcpPeer()) {
  let tick = 0;
  return new AcpRuntimeProvider({
    provider_id: PROVIDER_ID,
    peer,
    default_cwd: '/workspace/default',
    clock: () => new Date(Date.parse('2026-08-22T16:00:00Z') + tick++ * 1000).toISOString(),
  });
}

function query(requestId = 'request:manifest') {
  return { schema_version: CONTRACT_SCHEMA_VERSION, provider_id: PROVIDER_ID, request_id: requestId };
}

function createInput(sessionId = 'session:acp-1') {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    command: 'create',
    provider_id: PROVIDER_ID,
    spec: delegatedSpec(sessionId),
  };
}

function sessionInput(command, runtimeSessionId = 'acp-session-1', sessionId = 'session:acp-1') {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    command,
    provider_id: PROVIDER_ID,
    runtime_session_id: runtimeSessionId,
    session_id: sessionId,
  };
}

async function create(providerValue, sessionId = 'session:acp-1') {
  const input = createInput(sessionId);
  return validatePortResult('RuntimeProvider', 'create', await providerValue.create(input), input);
}

async function collect(providerValue, sessionId = 'session:acp-1', runtimeSessionId = 'acp-session-1', fromSequence = 0) {
  const input = {
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_id: PROVIDER_ID,
    runtime_session_id: runtimeSessionId,
    session_id: sessionId,
    from_sequence: fromSequence,
  };
  const result = [];
  for await (const event of validatePortResult('RuntimeProvider', 'events', providerValue.events(input), input)) result.push(event);
  return result;
}

test('ACP manifest reports L0 honestly and rejects negotiation for every higher level', () => {
  const runtime = provider();
  const manifest = validatePortResult('RuntimeProvider', 'manifest', runtime.manifest(query()), query());
  assert.equal(manifest.transport, 'acp');
  assert.deepEqual(manifest.capabilities, ['instructions']);
  assert.equal(negotiateRuntimeCapabilities(manifest, 'L0').ok, true);
  for (const level of ['L1', 'L2', 'L3', 'L4']) assert.equal(negotiateRuntimeCapabilities(manifest, level).ok, false);
});

test('stable ACP v1 lifecycle maps text and terminal response to normalized ordered events', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  const created = await create(runtime);
  assert.equal(created.runtime_session_id, 'acp-session-1');
  assert.deepEqual(peer.calls[0], {
    method: 'initialize',
    params: {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'hseos', title: 'HSEOS', version: '1.0.0' },
      _meta: { hseos: { effectBoundary: 'instructions_only' } },
    },
  });
  assert.deepEqual(peer.calls[1], { method: 'session/new', params: { cwd: '/workspace/fixture', mcpServers: [] } });

  const send = {
    ...sessionInput('send'),
    turn_id: 'turn:acp-1',
    message: { role: 'user', content: 'inspect only' },
  };
  assert.equal(validatePortResult('RuntimeProvider', 'send', await runtime.send(send), send).accepted, true);
  peer.emit('session/update', {
    sessionId: 'acp-session-1',
    update: {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'opaque-message',
      content: { type: 'text', text: 'observed', annotations: { audience: ['user'], priority: 1 } },
    },
  });
  peer.prompt.resolve({ stopReason: 'end_turn' });
  const events = await collect(runtime);
  assert.deepEqual(
    events.map((event) => [event.sequence, event.event_type]),
    [
      [1, 'runtime.session.started'],
      [2, 'runtime.message.delta'],
      [3, 'runtime.session.completed'],
    ],
  );
  assert.equal(events[1].payload.turn_id, 'turn:acp-1');
  assert.equal(events[1].payload.text, 'observed');
});

test('L0 denies permission requests and cancels tool effects without emitting a tool call', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  await create(runtime);
  await runtime.send({
    ...sessionInput('send'),
    turn_id: 'turn:effect',
    message: { role: 'user', content: 'remain read-only' },
  });
  const outcome = peer.callClient('session/request_permission', {
    sessionId: 'acp-session-1',
    toolCall: { toolCallId: 'call-1' },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
  });
  assert.deepEqual(outcome, { outcome: { outcome: 'cancelled' } });
  const events = await collect(runtime);
  assert.equal(events.at(-1).event_type, 'runtime.session.failed');
  assert.equal(events.at(-1).payload.error_code, 'policy_denied');
  assert.equal(
    events.some((event) => event.event_type === 'runtime.tool.call'),
    false,
  );
  assert.deepEqual(peer.notifications, [{ method: 'session/cancel', params: { sessionId: 'acp-session-1' } }]);
});

test('tool-call notifications, malformed updates and wrong session identities fail closed', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  await create(runtime);
  await runtime.send({
    ...sessionInput('send'),
    turn_id: 'turn:tool',
    message: { role: 'user', content: 'no tools' },
  });
  peer.emit('session/update', {
    sessionId: 'acp-session-1',
    update: { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'unsafe', status: 'pending' },
  });
  assert.equal((await collect(runtime)).at(-1).payload.error_code, 'policy_denied');

  const malformedPeer = new FakeAcpPeer();
  const malformedRuntime = provider(malformedPeer);
  await create(malformedRuntime);
  await malformedRuntime.send({
    ...sessionInput('send'),
    turn_id: 'turn:malformed',
    message: { role: 'user', content: 'text' },
  });
  assert.throws(
    () =>
      malformedPeer.emit('session/update', {
        sessionId: 'acp-session-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 42 } },
      }),
    RuntimeProviderError,
  );
  assert.equal((await collect(malformedRuntime)).at(-1).payload.error_code, 'protocol_error');
  assert.throws(
    () =>
      malformedPeer.emit('session/update', {
        sessionId: 'acp-session-other',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'forged' } },
      }),
    /identity mismatch/,
  );
});

test('version and effect-boundary negotiation reject incompatible or ungoverned peers', async () => {
  for (const peer of [new FakeAcpPeer({ version: 2 }), new FakeAcpPeer({ effectBoundary: 'unrestricted' })]) {
    const runtime = provider(peer);
    await assert.rejects(() => runtime.create(createInput()), RuntimeProviderError);
    assert.equal(
      peer.calls.some((call) => call.method === 'session/new'),
      false,
    );
  }
});

test('resume, cancellation and disposal preserve correlated lifecycle semantics', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  await create(runtime);
  peer.loadUpdate = {
    sessionId: 'acp-session-1',
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'historical replay' } },
  };
  const resume = { ...sessionInput('resume'), expected_sequence: 1 };
  assert.equal(validatePortResult('RuntimeProvider', 'resume', await runtime.resume(resume), resume).terminal, false);
  assert.equal(peer.calls.at(-1).method, 'session/load');

  const cancel = { ...sessionInput('cancel'), reason: 'deadline', cascade: true };
  assert.equal(validatePortResult('RuntimeProvider', 'cancel', await runtime.cancel(cancel), cancel).terminal, true);
  assert.equal((await collect(runtime, 'session:acp-1', 'acp-session-1', 1))[0].payload.error_code, 'cancelled');

  const dispose = sessionInput('dispose');
  assert.equal(validatePortResult('RuntimeProvider', 'dispose', await runtime.dispose(dispose), dispose).terminal, true);
  await runtime.close();
  assert.equal(peer.closed, true);
});

test('concurrent duplicate creates reserve identity before crossing the ACP boundary', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  const [first, duplicate] = await Promise.allSettled([runtime.create(createInput()), runtime.create(createInput())]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(duplicate.status, 'rejected');
  assert.match(duplicate.reason.message, /already exists/);
  assert.equal(peer.calls.filter((call) => call.method === 'session/new').length, 1);
});

test('event budgets terminate an instruction stream before unbounded growth', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  const input = createInput();
  input.spec.limits.max_tokens = 1;
  await runtime.create(input);
  await runtime.send({
    ...sessionInput('send'),
    turn_id: 'turn:bounded',
    message: { role: 'user', content: 'bounded output' },
  });
  peer.emit('session/update', {
    sessionId: 'acp-session-1',
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first' } },
  });
  peer.emit('session/update', {
    sessionId: 'acp-session-1',
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'second' } },
  });
  const events = await collect(runtime);
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2, 3],
  );
  assert.equal(events.at(-1).payload.error_code, 'budget_exceeded');
  assert.equal(peer.notifications.at(-1).method, 'session/cancel');
});

test('a requested cancellation becomes terminal before the peer notification settles', async () => {
  const peer = new FakeAcpPeer();
  let releaseNotification;
  peer.notify = async (method, params) => {
    peer.notifications.push({ method, params: structuredClone(params) });
    await new Promise((resolve) => {
      releaseNotification = resolve;
    });
  };
  const runtime = provider(peer);
  await create(runtime);
  await runtime.send({
    ...sessionInput('send'),
    turn_id: 'turn:cancel-race',
    message: { role: 'user', content: 'wait' },
  });
  const cancelInput = { ...sessionInput('cancel'), reason: 'user cancelled', cascade: true };
  const cancellation = runtime.cancel(cancelInput);
  peer.prompt.resolve({ stopReason: 'cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  releaseNotification();
  await cancellation;
  const events = await collect(runtime);
  assert.equal(events.at(-1).event_type, 'runtime.session.failed');
  assert.equal(events.at(-1).payload.error_code, 'cancelled');
});

test('prompt stop reasons are strict ACP v1 values and cancelled is not reported as success', async () => {
  const invalidPeer = new FakeAcpPeer();
  const invalidRuntime = provider(invalidPeer);
  await create(invalidRuntime);
  await invalidRuntime.send({
    ...sessionInput('send'),
    turn_id: 'turn:bad-stop',
    message: { role: 'user', content: 'stop' },
  });
  invalidPeer.prompt.resolve({ stopReason: 'invented_success' });
  const invalidEvents = await collect(invalidRuntime);
  assert.equal(invalidEvents.at(-1).event_type, 'runtime.session.failed');
  assert.equal(invalidEvents.at(-1).payload.error_code, 'protocol_error');

  const cancelledPeer = new FakeAcpPeer();
  const cancelledRuntime = provider(cancelledPeer);
  await create(cancelledRuntime);
  await cancelledRuntime.send({
    ...sessionInput('send'),
    turn_id: 'turn:peer-cancel',
    message: { role: 'user', content: 'stop' },
  });
  cancelledPeer.prompt.resolve({ stopReason: 'cancelled' });
  const cancelledEvents = await collect(cancelledRuntime);
  assert.equal(cancelledEvents.at(-1).event_type, 'runtime.session.failed');
  assert.equal(cancelledEvents.at(-1).payload.error_code, 'cancelled');

  for (const [stopReason, errorCode] of [
    ['max_tokens', 'budget_exceeded'],
    ['max_turn_requests', 'budget_exceeded'],
    ['refusal', 'policy_denied'],
  ]) {
    const stoppedPeer = new FakeAcpPeer();
    const stoppedRuntime = provider(stoppedPeer);
    await create(stoppedRuntime);
    await stoppedRuntime.send({
      ...sessionInput('send'),
      turn_id: `turn:${stopReason.replace('_', '-')}`,
      message: { role: 'user', content: 'stop with truthful semantics' },
    });
    stoppedPeer.prompt.resolve({ stopReason });
    const stoppedEvents = await collect(stoppedRuntime);
    assert.equal(stoppedEvents.at(-1).event_type, 'runtime.session.failed');
    assert.equal(stoppedEvents.at(-1).payload.error_code, errorCode);
  }
});

test('synchronous prompt dispatch failures settle the session and do not leave an active turn', async () => {
  const peer = new FakeAcpPeer();
  const request = peer.request.bind(peer);
  peer.request = (method, params) => {
    if (method === 'session/prompt') throw new Error('transport closed synchronously');
    return request(method, params);
  };
  const runtime = provider(peer);
  await create(runtime);
  await assert.rejects(
    () =>
      runtime.send({
        ...sessionInput('send'),
        turn_id: 'turn:sync-failure',
        message: { role: 'user', content: 'dispatch' },
      }),
    (error) => error instanceof RuntimeProviderError && error.error_code === 'protocol_error',
  );
  const events = await collect(runtime);
  assert.equal(events.at(-1).event_type, 'runtime.session.failed');
  assert.equal(events.at(-1).payload.error_code, 'protocol_error');
});

test('a correlatable malformed outer notification durably fails its active session', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  await create(runtime);
  await runtime.send({
    ...sessionInput('send'),
    turn_id: 'turn:outer-malformed',
    message: { role: 'user', content: 'validate envelope' },
  });
  assert.throws(
    () =>
      peer.emit('session/update', {
        sessionId: 'acp-session-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ignored' } },
        forbidden: true,
      }),
    RuntimeProviderError,
  );
  peer.prompt.resolve({ stopReason: 'end_turn' });
  const events = await collect(runtime);
  assert.equal(events.at(-1).event_type, 'runtime.session.failed');
  assert.equal(events.at(-1).payload.error_code, 'protocol_error');
});

test('a duplicate remote session identity quarantines its existing local owner', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  await create(runtime);
  await assert.rejects(() => runtime.create(createInput('session:acp-2')), /duplicate sessionId/);
  const ownerEvents = await collect(runtime);
  assert.equal(ownerEvents.at(-1).event_type, 'runtime.session.failed');
  assert.equal(ownerEvents.at(-1).payload.error_code, 'protocol_error');
  await assert.rejects(
    () =>
      runtime.send({
        ...sessionInput('send'),
        turn_id: 'turn:quarantined',
        message: { role: 'user', content: 'must not dispatch' },
      }),
    /cannot accept/,
  );
  assert.deepEqual(peer.notifications.at(-1), { method: 'session/cancel', params: { sessionId: 'acp-session-1' } });
});

test('a malformed post-create response cancels the captured remote session', async () => {
  const peer = new FakeAcpPeer();
  const request = peer.request.bind(peer);
  peer.request = async (method, params) => {
    if (method === 'session/new') return { sessionId: 'remote-orphan-1', forbidden: true };
    return request(method, params);
  };
  const runtime = provider(peer);
  await assert.rejects(() => runtime.create(createInput()), /unknown fields/);
  assert.deepEqual(peer.notifications, [{ method: 'session/cancel', params: { sessionId: 'remote-orphan-1' } }]);
});

test('initialize rejects malformed optional ACP v1 capability fields before session creation', async () => {
  const peer = new FakeAcpPeer();
  peer.request = async (method) => {
    if (method !== 'initialize') throw new Error('session/new must not be reached');
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: 'yes', _meta: { hseos: { effectBoundary: 'instructions_only' } } },
      authMethods: { invalid: true },
    };
  };
  const runtime = provider(peer);
  await assert.rejects(() => runtime.create(createInput()), /loadSession is malformed/);
  assert.equal(
    peer.calls.some((call) => call.method === 'session/new'),
    false,
  );
});

test('input bytes are bounded by the delegated session budget before ACP dispatch', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  const input = createInput();
  input.spec.limits.max_tokens = 1;
  await runtime.create(input);
  await assert.rejects(
    () =>
      runtime.send({
        ...sessionInput('send'),
        turn_id: 'turn:oversized-input',
        message: { role: 'user', content: 'x'.repeat(1_048_576) },
      }),
    (error) => error instanceof RuntimeProviderError && error.error_code === 'budget_exceeded',
  );
  assert.equal(
    peer.calls.some((call) => call.method === 'session/prompt'),
    false,
  );
});

test('content chunk envelope is strict while valid ACP annotations are accepted', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  await create(runtime);
  await runtime.send({
    ...sessionInput('send'),
    turn_id: 'turn:chunk-envelope',
    message: { role: 'user', content: 'validate chunks' },
  });
  assert.throws(
    () =>
      peer.emit('session/update', {
        sessionId: 'acp-session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 42,
          unknown: true,
          _meta: 'bad',
          content: { type: 'text', text: '' },
        },
      }),
    RuntimeProviderError,
  );
  peer.prompt.resolve({ stopReason: 'end_turn' });
  assert.equal((await collect(runtime)).at(-1).payload.error_code, 'protocol_error');
});

test('cancel settles locally when peer notification I/O never completes', async () => {
  const peer = new FakeAcpPeer();
  peer.notify = () => new Promise(() => {});
  const runtime = provider(peer);
  await create(runtime);
  const cancelInput = { ...sessionInput('cancel'), reason: 'bounded notify', cascade: true };
  const result = await Promise.race([
    runtime.cancel(cancelInput),
    new Promise((resolve) => setTimeout(() => resolve('still-pending'), 250)),
  ]);
  assert.notEqual(result, 'still-pending');
  assert.equal(result.terminal, true);
});

test('durations above the Node timer ceiling do not overflow into an immediate timeout', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  const input = createInput();
  input.spec.limits.max_duration_ms = 2_147_483_648;
  await runtime.create(input);
  await runtime.send({
    ...sessionInput('send'),
    turn_id: 'turn:long-duration',
    message: { role: 'user', content: 'remain active' },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const cancelInput = { ...sessionInput('cancel'), reason: 'test cleanup', cascade: true };
  await runtime.cancel(cancelInput);
  assert.equal((await collect(runtime)).at(-1).payload.error_code, 'cancelled');
});

test('send cannot overlap an in-flight session load', async () => {
  const peer = new FakeAcpPeer();
  const runtime = provider(peer);
  await create(runtime);
  const request = peer.request.bind(peer);
  let releaseLoad;
  peer.request = (method, params) => {
    if (method === 'session/load') {
      return new Promise((resolve) => {
        releaseLoad = resolve;
      });
    }
    return request(method, params);
  };
  const resumeInput = { ...sessionInput('resume'), expected_sequence: 1 };
  const resuming = runtime.resume(resumeInput);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () =>
      runtime.send({
        ...sessionInput('send'),
        turn_id: 'turn:during-load',
        message: { role: 'user', content: 'must wait' },
      }),
    /cannot accept/,
  );
  releaseLoad({});
  await resuming;
});

test('resume cannot overlap an active prompt or another in-flight resume', async () => {
  const promptPeer = new FakeAcpPeer();
  const promptRuntime = provider(promptPeer);
  await create(promptRuntime);
  await promptRuntime.send({
    ...sessionInput('send'),
    turn_id: 'turn:active-before-resume',
    message: { role: 'user', content: 'remain active' },
  });
  const resumeInput = { ...sessionInput('resume'), expected_sequence: 1 };
  await assert.rejects(() => promptRuntime.resume(resumeInput), /cannot resume concurrently/);
  promptPeer.prompt.resolve({ stopReason: 'end_turn' });
  await collect(promptRuntime);

  const loadPeer = new FakeAcpPeer();
  const loadRuntime = provider(loadPeer);
  await create(loadRuntime);
  const request = loadPeer.request.bind(loadPeer);
  let releaseLoad;
  loadPeer.request = (method, params) => {
    if (method === 'session/load') {
      return new Promise((resolve) => {
        releaseLoad = resolve;
      });
    }
    return request(method, params);
  };
  const firstResume = loadRuntime.resume(resumeInput);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => loadRuntime.resume(resumeInput), /cannot resume concurrently/);
  releaseLoad({});
  await firstResume;
});

test('create and close settle when lifecycle request I/O never completes', async () => {
  const peer = new FakeAcpPeer();
  const request = peer.request.bind(peer);
  peer.request = (method, params) => {
    if (method === 'session/new') return new Promise(() => {});
    return request(method, params);
  };
  const runtime = provider(peer);
  const input = createInput();
  input.spec.limits.max_duration_ms = 20;
  await assert.rejects(
    () => runtime.create(input),
    (error) => error.error_code === 'timeout',
  );
  await assert.rejects(
    () => runtime.create(input),
    (error) => error.error_code === 'timeout',
  );

  const closingPeer = new FakeAcpPeer();
  const closingRequest = closingPeer.request.bind(closingPeer);
  closingPeer.request = (method, params) => {
    if (method === 'session/new') return new Promise(() => {});
    return closingRequest(method, params);
  };
  closingPeer.close = () => new Promise(() => {});
  const closingRuntime = provider(closingPeer);
  const longInput = createInput();
  longInput.spec.limits.max_duration_ms = 60_000;
  const pendingCreate = closingRuntime.create(longInput);
  const pendingCreateSettled = assert.rejects(pendingCreate, (error) => error.error_code === 'cancelled');
  await new Promise((resolve) => setImmediate(resolve));
  const closeResult = await Promise.race([
    closingRuntime.close().then(() => 'closed'),
    new Promise((resolve) => setTimeout(() => resolve('still-pending'), 250)),
  ]);
  assert.equal(closeResult, 'closed');
  await pendingCreateSettled;
});
