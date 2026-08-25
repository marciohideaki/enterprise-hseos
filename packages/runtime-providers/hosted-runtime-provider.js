'use strict';

const path = require('node:path');

const {
  CONTRACT_SCHEMA_VERSION,
  RuntimeEventSchema,
  RuntimeProviderManifestSchema,
  deepFreeze,
  parseContract,
  validatePortInput,
} = require('../agent-runtime-contracts');
const { RuntimeProviderError } = require('./acp-runtime-provider');

const HOSTED_STOP_REASONS = Object.freeze(['completed', 'cancelled', 'refused', 'budget_exceeded']);
const MAX_HOSTED_SESSIONS = 128;
const MAX_HOSTED_EVENTS = 4096;
const MAX_HOSTED_STREAM_BYTES = 4_194_304;
const MAX_HOSTED_INPUT_BYTES = 1_048_576;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DRIVER_TEARDOWN_TIMEOUT_MS = 25;

const HOSTED_RUNTIME_ADAPTERS = deepFreeze({
  codex: {
    adapter_id: 'codex',
    protocol: 'app-server',
    transport: 'stdio',
    conformance_level: 'L0',
    capabilities: ['instructions'],
    external_dependency: '@openai/codex',
  },
  'claude-code': {
    adapter_id: 'claude-code',
    protocol: 'agent-sdk',
    transport: 'process',
    conformance_level: 'L0',
    capabilities: ['instructions'],
    external_dependency: '@anthropic-ai/claude-agent-sdk',
  },
  'deepseek-harness': {
    adapter_id: 'deepseek-harness',
    protocol: 'acp-v1',
    transport: 'acp',
    conformance_level: 'L0',
    capabilities: ['instructions'],
    external_dependency: '@agentclientprotocol/sdk',
  },
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value, allowed, label) {
  if (!isRecord(value)) throw new RuntimeProviderError(`${label} is malformed`, 'protocol_error');
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new RuntimeProviderError(`${label} contains unknown fields`, 'protocol_error');
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || value.length === 0 || /\s|[\u0000-\u001f\u007f]/u.test(value) || value.length > 1024) {
    throw new RuntimeProviderError(`${label} is malformed`, 'protocol_error');
  }
  return value;
}

function isSafeRuntimeIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/\s|[\u0000-\u001f\u007f]/u.test(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateDriver(driver) {
  const methods = ['create', 'send', 'resume', 'cancel', 'dispose', 'close'];
  if (!driver || methods.some((method) => typeof driver[method] !== 'function')) {
    throw new RuntimeProviderError(`hosted driver requires ${methods.join(', ')}`, 'invalid_request');
  }
  return driver;
}

function createHostedRuntimeManifest(adapterId, providerId, providerVersion = '1.0.0') {
  const descriptor = HOSTED_RUNTIME_ADAPTERS[adapterId];
  if (!descriptor) throw new RuntimeProviderError('hosted adapter_id is unknown', 'invalid_request');
  return parseContract(RuntimeProviderManifestSchema, {
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_type: 'runtime',
    provider_id: providerId,
    provider_version: providerVersion,
    conformance_level: descriptor.conformance_level,
    capabilities: descriptor.capabilities,
    transport: descriptor.transport,
    secret_refs: [],
  }, `${adapterId} runtime provider manifest`);
}

function operation(providerId, session, terminal = session.terminal) {
  return deepFreeze({
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_id: providerId,
    runtime_session_id: session.runtimeSessionId,
    session_id: session.sessionId,
    accepted: true,
    terminal,
    evidence_refs: [],
  });
}

class HostedInstructionsRuntimeProvider {
  #closeController = new AbortController();
  #closed = false;
  #inflightCreates = 0;
  #pending = new Set();
  #quarantineExhausted = false;
  #runtimeIds = new Set();
  #sessions = new Map();

  constructor({ adapter_id, provider_id, provider_version = '1.0.0', driver, default_cwd, clock = () => new Date().toISOString() }) {
    const descriptor = HOSTED_RUNTIME_ADAPTERS[adapter_id];
    if (!descriptor || adapter_id === 'deepseek-harness') {
      throw new RuntimeProviderError('hosted adapter_id must be codex or claude-code', 'invalid_request');
    }
    if (typeof default_cwd !== 'string' || !path.isAbsolute(default_cwd)) {
      throw new RuntimeProviderError('hosted default_cwd must be absolute', 'invalid_request');
    }
    if (typeof clock !== 'function') throw new RuntimeProviderError('clock must be a function', 'invalid_request');
    this.adapter = descriptor;
    this.driver = validateDriver(driver);
    this.defaultCwd = path.normalize(default_cwd);
    this.clock = clock;
    this.providerManifest = createHostedRuntimeManifest(adapter_id, provider_id, provider_version);
  }

  manifest(inputValue) {
    this.#input('manifest', inputValue);
    return this.providerManifest;
  }

  async create(inputValue) {
    const input = this.#input('create', inputValue);
    this.#available();
    if (this.#sessions.has(input.spec.session_id) || this.#pending.has(input.spec.session_id)) {
      throw new RuntimeProviderError('HSEOS session already exists', 'invalid_request');
    }
    if (this.#runtimeIds.size + this.#pending.size >= MAX_HOSTED_SESSIONS) {
      throw new RuntimeProviderError('hosted session limit reached', 'rate_limited');
    }
    const cwdValue = typeof input.spec.metadata.cwd === 'string' ? input.spec.metadata.cwd : this.defaultCwd;
    if (!path.isAbsolute(cwdValue)) throw new RuntimeProviderError('hosted cwd must be absolute', 'invalid_request');
    this.#pending.add(input.spec.session_id);
    let response;
    let rawResponse;
    let adopted = false;
    try {
      this.#inflightCreates += 1;
      const createRequest = Promise.resolve().then(() => this.driver.create({
        adapter_id: this.adapter.adapter_id,
        protocol: this.adapter.protocol,
        cwd: path.normalize(cwdValue),
        limits: structuredClone(input.spec.limits),
        effect_boundary: 'instructions_only',
      }));
      try {
        rawResponse = await this.#bounded(createRequest, input.spec.limits.max_duration_ms, 'hosted create');
        response = onlyKeys(
          rawResponse,
          ['runtime_session_id', 'effect_boundary', 'resumable'],
          'hosted create response',
        );
      } catch (error) {
        void createRequest.then(async (late) => {
          if (isRecord(late) && isSafeRuntimeIdentifier(late.runtime_session_id)) {
            await this.#compensatePublishedId(late.runtime_session_id, 'cancelled');
          }
        }, () => {});
        throw error;
      }
      const runtimeSessionId = identifier(response.runtime_session_id, 'runtime_session_id');
      this.#available();
      if (response.effect_boundary !== 'instructions_only') {
        throw new RuntimeProviderError('hosted runtime did not attest the instructions-only boundary', 'policy_denied');
      }
      if (typeof response.resumable !== 'boolean') throw new RuntimeProviderError('hosted resumable flag is malformed', 'protocol_error');
      if (this.#runtimeIds.has(runtimeSessionId)) {
        const owner = [...this.#sessions.values()].find((candidate) => candidate.runtimeSessionId === runtimeSessionId);
        if (owner && !owner.terminal) {
          this.#terminate(owner, 'runtime.session.failed', {
            error_code: 'protocol_error',
            message: 'hosted runtime reused an active session identity',
            retryable: false,
          });
        }
        throw new RuntimeProviderError('hosted runtime reused a session identity', 'protocol_error');
      }
      const session = this.#newSession(input.spec, runtimeSessionId, 0, response.resumable);
      this.#sessions.set(session.sessionId, session);
      this.#runtimeIds.add(runtimeSessionId);
      adopted = true;
      this.#emit(session, 'runtime.session.started', { hseos_session_id: session.sessionId });
      return operation(this.providerManifest.provider_id, session, false);
    } catch (error) {
      if (!adopted && isRecord(rawResponse) && isSafeRuntimeIdentifier(rawResponse.runtime_session_id)) {
        await this.#compensatePublishedId(rawResponse.runtime_session_id, 'protocol_error', true);
      }
      throw error;
    } finally {
      this.#inflightCreates -= 1;
      this.#pending.delete(input.spec.session_id);
    }
  }

  async send(inputValue) {
    const input = this.#input('send', inputValue);
    this.#available();
    const session = this.#resolve(input);
    if (session.terminal || session.activeTurn || session.loading) throw new RuntimeProviderError('hosted session cannot accept this turn', 'invalid_request');
    if (!['user', 'system'].includes(input.message.role) || input.message.tool_calls || input.message.tool_call_id) {
      throw new RuntimeProviderError('hosted L0 accepts instruction text only', 'capability_unavailable');
    }
    if (Buffer.byteLength(input.message.content, 'utf8') > session.maxInputBytes) {
      throw new RuntimeProviderError('hosted instruction exceeds the bounded input budget', 'budget_exceeded');
    }
    session.activeTurn = input.turn_id;
    this.#armDeadline(session, session.maxDurationMs);
    let request;
    try {
      request = this.driver.send({
        runtime_session_id: session.runtimeSessionId,
        turn_id: input.turn_id,
        instruction: input.message.content,
        effect_boundary: 'instructions_only',
        on_event: (event) => this.#driverEvent(session, input.turn_id, event),
      });
    } catch (error) {
      this.#fail(session, error);
      throw new RuntimeProviderError('hosted send failed', 'protocol_error', { cause: error });
    }
    void Promise.resolve(request).then((result) => this.#complete(session, result)).catch((error) => this.#fail(session, error));
    return operation(this.providerManifest.provider_id, session, false);
  }

  async resume(inputValue) {
    const input = this.#input('resume', inputValue);
    this.#available();
    let session = this.#sessions.get(input.session_id);
    const restoring = session === undefined;
    if (restoring) {
      if (!input.spec) {
        throw new RuntimeProviderError('durable session spec is required to reattach a hosted session', 'invalid_request');
      }
      if (this.#pending.has(input.session_id) || this.#runtimeIds.has(input.runtime_session_id)) {
        throw new RuntimeProviderError('hosted session identity is already reserved', 'invalid_request');
      }
      if (this.#runtimeIds.size + this.#pending.size >= MAX_HOSTED_SESSIONS) {
        throw new RuntimeProviderError('hosted session limit reached', 'rate_limited');
      }
      session = this.#newSession(input.spec, input.runtime_session_id, input.expected_sequence, true);
      session.loading = true;
      this.#pending.add(input.session_id);
      this.#sessions.set(input.session_id, session);
      this.#runtimeIds.add(input.runtime_session_id);
    } else {
      if (session.runtimeSessionId !== input.runtime_session_id) {
        throw new RuntimeProviderError('hosted session identity mismatch', 'invalid_request');
      }
      if (input.spec && stableJson(input.spec) !== stableJson(session.spec)) {
        throw new RuntimeProviderError('durable session spec does not match the hosted session', 'invalid_request');
      }
    }
    if (!session.resumable) throw new RuntimeProviderError('hosted adapter does not support resume', 'capability_unavailable');
    if (session.terminal || session.activeTurn || session.loading || input.expected_sequence !== session.sequence) {
      if (!restoring) throw new RuntimeProviderError('hosted session cannot resume at this sequence', 'invalid_request');
    }
    session.loading = true;
    let resumed = false;
    try {
      const response = onlyKeys(
        await this.#bounded(Promise.resolve().then(() => this.driver.resume({
          runtime_session_id: session.runtimeSessionId,
          expected_sequence: input.expected_sequence,
          effect_boundary: 'instructions_only',
        })), session.maxDurationMs, 'hosted resume', session.controller.signal),
        ['effect_boundary'],
        'hosted resume response',
      );
      this.#available();
      if (this.#sessions.get(session.sessionId) !== session || session.terminal) {
        throw new RuntimeProviderError('hosted session changed while resume was in flight', 'cancelled');
      }
      if (response.effect_boundary !== 'instructions_only') {
        this.#fail(session, new RuntimeProviderError('hosted resume weakened the effect boundary', 'policy_denied'));
        throw new RuntimeProviderError('hosted resume weakened the effect boundary', 'policy_denied');
      }
      resumed = true;
    } catch (error) {
      void this.#safeDriver('cancel', { runtime_session_id: session.runtimeSessionId, reason: 'protocol_error' });
      const normalized = error instanceof RuntimeProviderError
        ? error
        : new RuntimeProviderError('hosted resume failed', 'protocol_error', { cause: error });
      this.#fail(session, normalized);
      throw normalized;
    } finally {
      session.loading = false;
      if (restoring) {
        this.#pending.delete(input.session_id);
        if (!resumed && this.#sessions.get(input.session_id) === session) {
          this.#sessions.delete(input.session_id);
          this.#runtimeIds.delete(input.runtime_session_id);
        }
      }
    }
    return operation(this.providerManifest.provider_id, session, false);
  }

  events(inputValue) {
    const input = this.#input('events', inputValue);
    const session = this.#resolve(input);
    if (input.from_sequence > session.sequence) throw new RuntimeProviderError('event cursor is ahead of hosted session', 'invalid_request');
    let cursor = input.from_sequence;
    return { async *[Symbol.asyncIterator]() {
      while (true) {
        const next = session.events.find((event) => event.sequence > cursor);
        if (next) {
          cursor = next.sequence;
          yield next;
          if (['runtime.session.completed', 'runtime.session.failed'].includes(next.event_type)) return;
          continue;
        }
        if (session.terminal) return;
        await new Promise((resolve) => session.waiters.add(resolve));
      }
    } };
  }

  async cancel(inputValue) {
    const input = this.#input('cancel', inputValue);
    const session = this.#resolve(input);
    if (!session.terminal) {
      session.controller.abort();
      this.#terminate(session, 'runtime.session.failed', { error_code: 'cancelled', message: 'hosted session was cancelled', retryable: false });
      await this.#safeDriver('cancel', { runtime_session_id: session.runtimeSessionId, reason: input.reason });
    }
    return operation(this.providerManifest.provider_id, session, true);
  }

  async dispose(inputValue) {
    const input = this.#input('dispose', inputValue);
    const session = this.#resolve(input);
    session.controller.abort();
    if (!session.terminal) this.#terminate(session, 'runtime.session.failed', { error_code: 'cancelled', message: 'hosted session was disposed', retryable: false });
    const externallyDisposed = await this.#safeDriver('dispose', { runtime_session_id: session.runtimeSessionId });
    const result = operation(this.providerManifest.provider_id, session, true);
    this.#sessions.delete(session.sessionId);
    if (externallyDisposed && this.#inflightCreates === 0) this.#runtimeIds.delete(session.runtimeSessionId);
    return result;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeController.abort();
    for (const session of this.#sessions.values()) {
      session.controller.abort();
      if (!session.terminal) this.#terminate(session, 'runtime.session.failed', { error_code: 'cancelled', message: 'hosted provider was closed', retryable: false });
    }
    await this.#safeDriver('close');
  }

  #input(method, value) {
    const input = validatePortInput('RuntimeProvider', method, value);
    if (input.provider_id !== this.providerManifest.provider_id) throw new RuntimeProviderError('runtime provider identity mismatch', 'invalid_request');
    return input;
  }

  #available() {
    if (this.#closed) throw new RuntimeProviderError('hosted provider is closed', 'provider_unavailable');
    if (this.#quarantineExhausted) {
      throw new RuntimeProviderError('hosted provider exhausted its uncertain identity quarantine', 'provider_unavailable');
    }
  }

  #resolve(input) {
    const session = this.#sessions.get(input.session_id);
    if (!session || session.runtimeSessionId !== input.runtime_session_id) throw new RuntimeProviderError('hosted session identity mismatch', 'invalid_request');
    return session;
  }

  #newSession(spec, runtimeSessionId, sequence, resumable) {
    const cwdValue = typeof spec.metadata.cwd === 'string' ? spec.metadata.cwd : this.defaultCwd;
    if (!path.isAbsolute(cwdValue)) throw new RuntimeProviderError('hosted cwd must be absolute', 'invalid_request');
    return {
      sessionId: spec.session_id,
      runtimeSessionId,
      spec,
      sequence,
      events: [],
      bytes: 0,
      maxEvents: Math.min(MAX_HOSTED_EVENTS, Math.max(3, spec.limits.max_tokens)),
      maxBytes: Math.min(MAX_HOSTED_STREAM_BYTES, Math.max(4096, spec.limits.max_tokens * 16)),
      maxInputBytes: Math.min(MAX_HOSTED_INPUT_BYTES, Math.max(1024, spec.limits.max_tokens * 16)),
      maxDurationMs: spec.limits.max_duration_ms,
      resumable,
      activeTurn: null,
      loading: false,
      deadline: null,
      controller: new AbortController(),
      terminal: false,
      waiters: new Set(),
    };
  }

  #driverEvent(session, turnId, value) {
    if (session.terminal || session.activeTurn !== turnId) throw new RuntimeProviderError('stale hosted runtime event', 'protocol_error');
    try {
      const event = onlyKeys(value, ['type', 'text', 'effect'], 'hosted runtime event');
      if (event.type === 'message.delta') {
        if (typeof event.text !== 'string' || Buffer.byteLength(event.text, 'utf8') > 262_144 || event.effect !== undefined) {
          throw new RuntimeProviderError('hosted text event is malformed', 'protocol_error');
        }
        this.#emit(session, 'runtime.message.delta', { turn_id: turnId, text: event.text });
        return;
      }
      if (event.type === 'effect.attempted') {
        void this.#safeDriver('cancel', { runtime_session_id: session.runtimeSessionId, reason: 'policy_denied' });
        this.#terminate(session, 'runtime.session.failed', { error_code: 'policy_denied', message: 'hosted L0 runtime attempted an effect', retryable: false });
        return;
      }
      throw new RuntimeProviderError('unsupported hosted runtime event', 'protocol_error');
    } catch (error) {
      void this.#safeDriver('cancel', { runtime_session_id: session.runtimeSessionId, reason: 'protocol_error' });
      this.#fail(session, error);
      throw error;
    }
  }

  #complete(session, value) {
    if (session.terminal) return;
    const result = onlyKeys(value, ['stop_reason'], 'hosted send result');
    if (!HOSTED_STOP_REASONS.includes(result.stop_reason)) {
      this.#fail(session, new RuntimeProviderError('hosted stop reason is invalid', 'protocol_error'));
      return;
    }
    if (result.stop_reason === 'completed') {
      this.#terminate(session, 'runtime.session.completed', { outcome_ref: `${this.adapter.protocol}://session/${encodeURIComponent(session.runtimeSessionId)}` });
      return;
    }
    const mapping = { cancelled: 'cancelled', refused: 'policy_denied', budget_exceeded: 'budget_exceeded' };
    this.#terminate(session, 'runtime.session.failed', { error_code: mapping[result.stop_reason], message: `hosted runtime stopped: ${result.stop_reason}`, retryable: false });
  }

  #fail(session, error) {
    if (session.terminal) return;
    const code = error instanceof RuntimeProviderError ? error.error_code : 'protocol_error';
    this.#terminate(session, 'runtime.session.failed', { error_code: code, message: code === 'protocol_error' ? 'hosted runtime violated its adapter contract' : error.message, retryable: false });
  }

  #emit(session, eventType, payload) {
    session.sequence += 1;
    const event = parseContract(RuntimeEventSchema, {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: this.providerManifest.provider_id,
      runtime_session_id: session.runtimeSessionId,
      sequence: session.sequence,
      occurred_at: this.clock(),
      event_type: eventType,
      payload,
    }, 'hosted normalized runtime event');
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
    if (!['runtime.session.completed', 'runtime.session.failed'].includes(eventType) &&
        (session.events.length + 1 >= session.maxEvents || session.bytes + bytes > session.maxBytes)) {
      session.sequence -= 1;
      void this.#safeDriver('cancel', { runtime_session_id: session.runtimeSessionId, reason: 'budget_exceeded' });
      return this.#terminate(session, 'runtime.session.failed', { error_code: 'budget_exceeded', message: 'hosted runtime exceeded its event budget', retryable: false });
    }
    session.events.push(event);
    session.bytes += bytes;
    for (const waiter of session.waiters) waiter();
    session.waiters.clear();
    return event;
  }

  #terminate(session, eventType, payload) {
    if (session.terminal) return session.events.at(-1);
    session.terminal = true;
    session.activeTurn = null;
    if (session.deadline) clearTimeout(session.deadline);
    session.deadline = null;
    return this.#emit(session, eventType, payload);
  }

  async #safeDriver(method, value) {
    try {
      const request = method === 'close' ? this.driver.close() : this.driver[method](value);
      return await this.#settle(request, DRIVER_TEARDOWN_TIMEOUT_MS);
    } catch {
      // Local terminal truth wins over best-effort external teardown.
      return false;
    }
  }

  async #compensatePublishedId(runtimeSessionId, reason, ownCreateInFlight = false) {
    const alreadyReserved = this.#runtimeIds.has(runtimeSessionId);
    if (!alreadyReserved && this.#runtimeIds.size >= MAX_HOSTED_SESSIONS) {
      this.#quarantineExhausted = true;
    } else {
      this.#runtimeIds.add(runtimeSessionId);
    }
    const compensated = await this.#safeDriver('cancel', { runtime_session_id: runtimeSessionId, reason });
    const owned = [...this.#sessions.values()].some((session) => session.runtimeSessionId === runtimeSessionId);
    const safeInflightCount = ownCreateInFlight ? 1 : 0;
    if (!this.#quarantineExhausted && compensated && !alreadyReserved && !owned && this.#inflightCreates <= safeInflightCount) {
      this.#runtimeIds.delete(runtimeSessionId);
    }
    return compensated;
  }

  async #bounded(request, timeoutMs, label, signal) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RuntimeProviderError(`${label} exceeded its deadline`, 'timeout');
    let timeout;
    let onClose;
    let onInterrupt;
    try {
      const closed = new Promise((unused, reject) => {
        onClose = () => reject(new RuntimeProviderError(`${label} was interrupted by provider close`, 'cancelled'));
        if (this.#closeController.signal.aborted) return onClose();
        this.#closeController.signal.addEventListener('abort', onClose, { once: true });
      });
      const interrupted = new Promise((unused, reject) => {
        if (!signal) return;
        onInterrupt = () => reject(new RuntimeProviderError(`${label} was interrupted`, 'cancelled'));
        if (signal.aborted) return onInterrupt();
        signal.addEventListener('abort', onInterrupt, { once: true });
      });
      return await Promise.race([
        Promise.resolve(request),
        closed,
        interrupted,
        new Promise((unused, reject) => {
          timeout = setTimeout(
            () => reject(new RuntimeProviderError(`${label} exceeded its deadline`, 'timeout')),
            Math.min(timeoutMs, MAX_TIMER_DELAY_MS),
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (onClose) this.#closeController.signal.removeEventListener('abort', onClose);
      if (onInterrupt) signal.removeEventListener('abort', onInterrupt);
    }
  }

  async #settle(request, timeoutMs) {
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve(request).then(() => true, () => false),
        new Promise((resolve) => { timeout = setTimeout(() => resolve(false), timeoutMs); }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  #armDeadline(session, remainingMs) {
    const startedAt = Date.now();
    session.deadline = setTimeout(() => {
      const remaining = remainingMs - Math.max(1, Date.now() - startedAt);
      if (remaining > 0) return this.#armDeadline(session, remaining);
      void this.#safeDriver('cancel', { runtime_session_id: session.runtimeSessionId, reason: 'timeout' });
      this.#terminate(session, 'runtime.session.failed', { error_code: 'timeout', message: 'hosted session exceeded its duration limit', retryable: false });
    }, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
  }
}

class CodexRuntimeProvider extends HostedInstructionsRuntimeProvider {
  constructor(options) { super({ ...options, adapter_id: 'codex' }); }
}

class ClaudeCodeRuntimeProvider extends HostedInstructionsRuntimeProvider {
  constructor(options) { super({ ...options, adapter_id: 'claude-code' }); }
}

module.exports = {
  HOSTED_RUNTIME_ADAPTERS,
  HOSTED_STOP_REASONS,
  ClaudeCodeRuntimeProvider,
  CodexRuntimeProvider,
  HostedInstructionsRuntimeProvider,
  createHostedRuntimeManifest,
};
