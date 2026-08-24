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

const ACP_PROTOCOL_VERSION = 1;
const MAX_SESSIONS = 128;
const MAX_EVENTS_PER_SESSION = 4096;
const MAX_INPUT_BYTES_PER_TURN = 1_048_576;
const MAX_STREAM_BYTES_PER_SESSION = 4_194_304;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const NOTIFY_SETTLE_TIMEOUT_MS = 25;
const ACP_STOP_REASONS = Object.freeze(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']);

class RuntimeProviderError extends Error {
  constructor(message, errorCode = 'internal_error', { retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RuntimeProviderError';
    this.error_code = errorCode;
    this.retryable = retryable === true;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function assertRecord(value, label) {
  if (!isRecord(value)) throw new RuntimeProviderError(`${label} is malformed`, 'protocol_error');
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new RuntimeProviderError(`${label} contains unknown fields`, 'protocol_error');
}

function assertString(value, label, maximum = 4096) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximum) {
    throw new RuntimeProviderError(`${label} is malformed`, 'protocol_error');
  }
  return value;
}

function assertBoundedText(value, label, maximum = 262_144) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum) {
    throw new RuntimeProviderError(`${label} is malformed`, 'protocol_error');
  }
  return value;
}

function assertOptionalMeta(value, label) {
  if (value !== undefined && value !== null && !isRecord(value)) {
    throw new RuntimeProviderError(`${label} _meta is malformed`, 'protocol_error');
  }
}

function validateAnnotations(value) {
  if (value === undefined || value === null) return;
  const annotations = assertRecord(value, 'content annotations');
  assertOnlyKeys(annotations, ['audience', 'lastModified', 'priority', '_meta'], 'content annotations');
  if (annotations.audience !== undefined && annotations.audience !== null) {
    if (!Array.isArray(annotations.audience) || annotations.audience.some((role) => !['user', 'assistant'].includes(role))) {
      throw new RuntimeProviderError('content annotations audience is malformed', 'protocol_error');
    }
  }
  if (annotations.lastModified !== undefined && annotations.lastModified !== null && typeof annotations.lastModified !== 'string') {
    throw new RuntimeProviderError('content annotations lastModified is malformed', 'protocol_error');
  }
  if (annotations.priority !== undefined && annotations.priority !== null && typeof annotations.priority !== 'number') {
    throw new RuntimeProviderError('content annotations priority is malformed', 'protocol_error');
  }
  assertOptionalMeta(annotations._meta, 'content annotations');
}

function assertOptionalImplementation(value, label) {
  if (value === undefined || value === null) return;
  const implementation = assertRecord(value, label);
  assertOnlyKeys(implementation, ['name', 'title', 'version', '_meta'], label);
  assertString(implementation.name, `${label} name`);
  assertString(implementation.version, `${label} version`);
  if (implementation.title !== undefined && implementation.title !== null) assertString(implementation.title, `${label} title`);
  assertOptionalMeta(implementation._meta, label);
}

function assertBooleanCapabilities(value, keys, label) {
  const capabilities = assertRecord(value, label);
  assertOnlyKeys(capabilities, [...keys, '_meta'], label);
  for (const key of keys) {
    if (capabilities[key] !== undefined && typeof capabilities[key] !== 'boolean') {
      throw new RuntimeProviderError(`${label}.${key} is malformed`, 'protocol_error');
    }
  }
  assertOptionalMeta(capabilities._meta, label);
}

function validateAgentCapabilities(value) {
  const capabilities = assertRecord(value, 'agentCapabilities');
  assertOnlyKeys(
    capabilities,
    ['loadSession', 'promptCapabilities', 'mcpCapabilities', 'sessionCapabilities', 'auth', '_meta'],
    'agentCapabilities',
  );
  if (capabilities.loadSession !== undefined && typeof capabilities.loadSession !== 'boolean') {
    throw new RuntimeProviderError('agentCapabilities.loadSession is malformed', 'protocol_error');
  }
  if (capabilities.promptCapabilities !== undefined) {
    assertBooleanCapabilities(capabilities.promptCapabilities, ['image', 'audio', 'embeddedContext'], 'promptCapabilities');
  }
  if (capabilities.mcpCapabilities !== undefined) {
    assertBooleanCapabilities(capabilities.mcpCapabilities, ['http', 'sse'], 'mcpCapabilities');
  }
  const optionalCapabilityKeys = {
    sessionCapabilities: ['list', 'delete', 'additionalDirectories', 'resume', 'close'],
    auth: ['logout'],
  };
  for (const [key, allowedKeys] of Object.entries(optionalCapabilityKeys)) {
    if (capabilities[key] !== undefined) {
      const label = `agentCapabilities.${key}`;
      const optional = assertRecord(capabilities[key], label);
      assertOnlyKeys(optional, [...allowedKeys, '_meta'], label);
      assertOptionalMeta(optional._meta, label);
      for (const name of allowedKeys) {
        const entry = optional[name];
        if (entry !== undefined && entry !== null) {
          const marker = assertRecord(entry, `${label}.${name}`);
          assertOnlyKeys(marker, ['_meta'], `${label}.${name}`);
          assertOptionalMeta(marker._meta, `${label}.${name}`);
        }
      }
    }
  }
  assertOptionalMeta(capabilities._meta, 'agentCapabilities');
  return capabilities;
}

function validateUnusedSessionState(response, label) {
  assertOptionalMeta(response._meta, label);
  if (response.modes !== undefined && response.modes !== null) {
    throw new RuntimeProviderError(`${label} modes are unsupported by the L0 bridge`, 'capability_unavailable');
  }
  if (response.configOptions !== undefined && response.configOptions !== null) {
    if (!Array.isArray(response.configOptions)) throw new RuntimeProviderError(`${label} configOptions are malformed`, 'protocol_error');
    if (response.configOptions.length > 0) {
      throw new RuntimeProviderError(`${label} configOptions are unsupported by the L0 bridge`, 'capability_unavailable');
    }
  }
}

function operation(providerId, runtimeSessionId, sessionId, accepted, terminal, evidenceRefs = []) {
  return deepFreeze({
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_id: providerId,
    runtime_session_id: runtimeSessionId,
    session_id: sessionId,
    accepted,
    terminal,
    evidence_refs: evidenceRefs,
  });
}

function validatePeer(peer) {
  const methods = ['request', 'notify', 'subscribe', 'close'];
  if (!peer || methods.some((method) => typeof peer[method] !== 'function')) {
    throw new RuntimeProviderError(`ACP peer requires ${methods.join(', ')}`, 'invalid_request');
  }
  return peer;
}

class AcpRuntimeProvider {
  #closeController = new AbortController();
  #disposed = false;
  #initialization;
  #pendingSessions = new Set();
  #sessions = new Map();
  #runtimeSessions = new Set();
  #unsubscribe;

  constructor({
    provider_id,
    provider_version = '1.0.0',
    peer,
    default_cwd,
    effect_boundary_attestation,
    clock = () => new Date().toISOString(),
  }) {
    this.peer = validatePeer(peer);
    if (typeof clock !== 'function') throw new RuntimeProviderError('clock must be a function', 'invalid_request');
    if (typeof default_cwd !== 'string' || !path.isAbsolute(default_cwd)) {
      throw new RuntimeProviderError('default_cwd must be an absolute path', 'invalid_request');
    }
    this.clock = clock;
    this.defaultCwd = default_cwd;
    if (effect_boundary_attestation !== undefined) {
      const attestation = assertRecord(effect_boundary_attestation, 'ACP effect boundary attestation');
      assertOnlyKeys(attestation, ['effect_boundary', 'evidence_ref', 'lifecycle'], 'ACP effect boundary attestation');
      if (
        attestation.effect_boundary !== 'instructions_only' ||
        attestation.lifecycle !== 'one_shot' ||
        typeof attestation.evidence_ref !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(attestation.evidence_ref)
      ) {
        throw new RuntimeProviderError('ACP effect boundary attestation is malformed', 'invalid_request');
      }
      this.effectBoundaryAttestation = deepFreeze(structuredClone(attestation));
    }
    this.providerManifest = parseContract(
      RuntimeProviderManifestSchema,
      {
        schema_version: CONTRACT_SCHEMA_VERSION,
        provider_type: 'runtime',
        provider_id,
        provider_version,
        conformance_level: 'L0',
        capabilities: ['instructions'],
        transport: 'acp',
        secret_refs: [],
      },
      'ACP runtime provider manifest',
    );
    this.#unsubscribe = this.peer.subscribe({
      notification: (method, params) => this.#onNotification(method, params),
      request: (method, params) => this.#onRequest(method, params),
    });
    if (typeof this.#unsubscribe !== 'function') {
      throw new RuntimeProviderError('ACP peer subscribe must return an unsubscribe function', 'invalid_request');
    }
  }

  manifest(inputValue) {
    const input = this.#input('manifest', inputValue);
    if (input.provider_id !== this.providerManifest.provider_id) this.#identityError();
    return this.providerManifest;
  }

  async create(inputValue) {
    const input = this.#input('create', inputValue);
    this.#available();
    if (this.#sessions.has(input.spec.session_id) || this.#pendingSessions.has(input.spec.session_id)) {
      throw new RuntimeProviderError('HSEOS session already exists', 'invalid_request');
    }
    if (this.#sessions.size + this.#pendingSessions.size >= MAX_SESSIONS) {
      throw new RuntimeProviderError('ACP session limit reached', 'rate_limited');
    }
    this.#pendingSessions.add(input.spec.session_id);
    const deadlineAt = Date.now() + input.spec.limits.max_duration_ms;
    try {
      await this.#boundedRequest(this.#initialize(), this.#remaining(deadlineAt), 'ACP initialize');
      this.#available();
      const cwd = this.#cwd(input.spec);
      const remoteCreate = Promise.resolve().then(() => this.peer.request('session/new', { cwd, mcpServers: [] }));
      let response;
      try {
        response = assertRecord(
          await this.#boundedRequest(remoteCreate, this.#remaining(deadlineAt), 'ACP session/new'),
          'session/new response',
        );
      } catch (error) {
        void remoteCreate.then(
          (lateResponse) => {
            if (
              isRecord(lateResponse) &&
              typeof lateResponse.sessionId === 'string' &&
              !/\s|[\u0000-\u001f\u007f]/u.test(lateResponse.sessionId)
            ) {
              void this.#safeNotify('session/cancel', { sessionId: lateResponse.sessionId });
            }
          },
          () => {},
        );
        throw error;
      }
      let runtimeSessionId;
      try {
        runtimeSessionId = assertString(response.sessionId, 'session/new sessionId', 1024);
        this.#available();
        if (/\s|[\u0000-\u001f\u007f]/u.test(runtimeSessionId)) {
          throw new RuntimeProviderError('session/new returned an invalid sessionId', 'protocol_error');
        }
        assertOnlyKeys(response, ['sessionId', 'modes', 'configOptions', '_meta'], 'session/new response');
        validateUnusedSessionState(response, 'session/new response');
        if (this.#runtimeSessions.has(runtimeSessionId)) {
          const owner = [...this.#sessions.values()].find((candidate) => candidate.runtimeSessionId === runtimeSessionId);
          if (owner && !owner.terminal) {
            this.#terminate(owner, 'runtime.session.failed', {
              error_code: 'protocol_error',
              message: 'ACP peer reused an active runtime session identity',
              retryable: false,
            });
          }
          throw new RuntimeProviderError('session/new returned a duplicate sessionId', 'protocol_error');
        }
      } catch (error) {
        if (runtimeSessionId && !/\s|[\u0000-\u001f\u007f]/u.test(runtimeSessionId)) {
          await this.#safeNotify('session/cancel', { sessionId: runtimeSessionId });
        }
        throw error;
      }
      const session = this.#newSession(input.spec, runtimeSessionId, cwd, 0);
      this.#sessions.set(input.spec.session_id, session);
      this.#runtimeSessions.add(runtimeSessionId);
      this.#emit(session, 'runtime.session.started', { hseos_session_id: input.spec.session_id });
      return operation(this.providerManifest.provider_id, runtimeSessionId, input.spec.session_id, true, false, [
        `acp://session/${encodeURIComponent(runtimeSessionId)}`,
      ]);
    } finally {
      this.#pendingSessions.delete(input.spec.session_id);
    }
  }

  async resume(inputValue) {
    const input = this.#input('resume', inputValue);
    this.#available();
    let existing = this.#sessions.get(input.session_id);
    const restoring = existing === undefined;
    if (restoring) {
      if (!input.spec) {
        throw new RuntimeProviderError('durable session spec is required to reattach an ACP session', 'invalid_request');
      }
      await this.#boundedRequest(this.#initialize(), input.spec.limits.max_duration_ms, 'ACP initialize');
      this.#available();
      if (!this.agentCapabilities.loadSession) {
        throw new RuntimeProviderError('ACP agent does not support session/load', 'capability_unavailable');
      }
      if (this.#pendingSessions.has(input.session_id) || this.#runtimeSessions.has(input.runtime_session_id)) {
        throw new RuntimeProviderError('ACP session identity is already reserved', 'invalid_request');
      }
      if (this.#sessions.size + this.#pendingSessions.size >= MAX_SESSIONS) {
        throw new RuntimeProviderError('ACP session limit reached', 'rate_limited');
      }
      existing = this.#newSession(input.spec, input.runtime_session_id, this.#cwd(input.spec), input.expected_sequence);
      existing.loading = true;
      this.#pendingSessions.add(input.session_id);
      this.#sessions.set(input.session_id, existing);
      this.#runtimeSessions.add(input.runtime_session_id);
    } else {
      if (existing.runtimeSessionId !== input.runtime_session_id) this.#sessionError();
      if (input.spec && stableJson(input.spec) !== stableJson(existing.spec)) {
        throw new RuntimeProviderError('durable session spec does not match the ACP session', 'invalid_request');
      }
    }
    if (existing.terminal || existing.activeTurn || existing.loading) {
      if (!restoring) throw new RuntimeProviderError('ACP session cannot resume concurrently', 'invalid_request');
    }
    if (existing.sequence !== input.expected_sequence) {
      throw new RuntimeProviderError('resume sequence does not match durable expectation', 'invalid_request');
    }
    if (!this.agentCapabilities?.loadSession) {
      if (!restoring && this.effectBoundaryAttestation?.lifecycle === 'one_shot') {
        return operation(this.providerManifest.provider_id, existing.runtimeSessionId, existing.sessionId, true, false, [
          this.effectBoundaryAttestation.evidence_ref,
        ]);
      }
      throw new RuntimeProviderError('ACP agent does not support session/load', 'capability_unavailable');
    }
    const deadlineAt = Date.now() + existing.maxDurationMs;
    existing.loading = true;
    let resumed = false;
    try {
      const response = assertRecord(
        await this.#boundedRequest(
          Promise.resolve().then(() =>
            this.peer.request('session/load', { sessionId: existing.runtimeSessionId, cwd: existing.cwd, mcpServers: [] }),
          ),
          this.#remaining(deadlineAt),
          'ACP session/load',
        ),
        'session/load response',
      );
      assertOnlyKeys(response, ['modes', 'configOptions', '_meta'], 'session/load response');
      validateUnusedSessionState(response, 'session/load response');
      if (this.#sessions.get(existing.sessionId) !== existing || existing.terminal) {
        throw new RuntimeProviderError('ACP session changed while resume was in flight', 'cancelled');
      }
      resumed = true;
    } catch (error) {
      void this.#safeNotify('session/cancel', { sessionId: existing.runtimeSessionId });
      this.#fail(existing, error);
      throw error;
    } finally {
      existing.loading = false;
      if (restoring) {
        this.#pendingSessions.delete(input.session_id);
        if (!resumed && this.#sessions.get(input.session_id) === existing) {
          this.#sessions.delete(input.session_id);
          this.#runtimeSessions.delete(input.runtime_session_id);
        }
      }
    }
    return operation(this.providerManifest.provider_id, existing.runtimeSessionId, existing.sessionId, true, existing.terminal);
  }

  async send(inputValue) {
    const input = this.#input('send', inputValue);
    this.#available();
    await this.#initialize();
    const session = this.#resolve(input);
    if (session.terminal || session.activeTurn || session.loading) {
      throw new RuntimeProviderError('ACP session cannot accept this turn', 'invalid_request');
    }
    if (!['user', 'system'].includes(input.message.role) || input.message.tool_calls || input.message.tool_call_id) {
      throw new RuntimeProviderError('ACP L0 accepts instruction text only', 'capability_unavailable');
    }
    if (Buffer.byteLength(input.message.content, 'utf8') > session.maxInputBytes) {
      throw new RuntimeProviderError('ACP instruction exceeds the bounded input budget', 'budget_exceeded');
    }
    session.activeTurn = input.turn_id;
    this.#armDeadline(session, session.maxDurationMs);
    let promptRequest;
    try {
      promptRequest = this.peer.request('session/prompt', {
        sessionId: session.runtimeSessionId,
        prompt: [{ type: 'text', text: input.message.content }],
        _meta: { hseos: { turnId: input.turn_id } },
      });
    } catch (error) {
      const normalized =
        error instanceof RuntimeProviderError
          ? error
          : new RuntimeProviderError('ACP prompt dispatch failed', 'protocol_error', { cause: error });
      this.#fail(session, normalized);
      throw normalized;
    }
    void Promise.resolve(promptRequest)
      .then((response) => this.#completePrompt(session, response))
      .catch((error) => this.#fail(session, error));
    return operation(this.providerManifest.provider_id, session.runtimeSessionId, session.sessionId, true, false);
  }

  events(inputValue) {
    const input = this.#input('events', inputValue);
    const session = this.#resolve(input);
    if (input.from_sequence > session.sequence) {
      throw new RuntimeProviderError('event cursor is ahead of the runtime session', 'invalid_request');
    }
    const provider = this;
    let cursor = input.from_sequence;
    return {
      async *[Symbol.asyncIterator]() {
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
          if (provider.#disposed && !session.terminal) return;
        }
      },
    };
  }

  async cancel(inputValue) {
    const input = this.#input('cancel', inputValue);
    const session = this.#resolve(input);
    if (!session.terminal) {
      this.#terminate(session, 'runtime.session.failed', {
        error_code: 'cancelled',
        message: 'runtime provider session was cancelled',
        retryable: false,
      });
      await this.#safeNotify('session/cancel', { sessionId: session.runtimeSessionId });
    }
    return operation(this.providerManifest.provider_id, session.runtimeSessionId, session.sessionId, true, true);
  }

  async dispose(inputValue) {
    const input = this.#input('dispose', inputValue);
    const session = this.#resolve(input);
    if (!session.terminal) {
      this.#terminate(session, 'runtime.session.failed', {
        error_code: 'cancelled',
        message: 'runtime provider session was disposed',
        retryable: false,
      });
      await this.#safeNotify('session/cancel', { sessionId: session.runtimeSessionId });
    }
    const result = operation(this.providerManifest.provider_id, session.runtimeSessionId, session.sessionId, true, true);
    this.#sessions.delete(session.sessionId);
    this.#runtimeSessions.delete(session.runtimeSessionId);
    return result;
  }

  async close() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#closeController.abort();
    for (const session of this.#sessions.values()) {
      if (!session.terminal) {
        this.#terminate(session, 'runtime.session.failed', {
          error_code: 'cancelled',
          message: 'runtime provider was closed',
          retryable: false,
        });
      }
    }
    this.#unsubscribe();
    await this.#settleExternal(
      Promise.resolve().then(() => this.peer.close()),
      NOTIFY_SETTLE_TIMEOUT_MS,
    );
  }

  #input(method, value) {
    const input = validatePortInput('RuntimeProvider', method, value);
    if (input.provider_id !== this.providerManifest.provider_id) this.#identityError();
    return input;
  }

  #identityError() {
    throw new RuntimeProviderError('runtime provider identity mismatch', 'invalid_request');
  }

  #available() {
    if (this.#disposed) throw new RuntimeProviderError('runtime provider is closed', 'provider_unavailable');
  }

  #cwd(spec) {
    const candidate = typeof spec.metadata.cwd === 'string' ? spec.metadata.cwd : this.defaultCwd;
    if (!path.isAbsolute(candidate)) throw new RuntimeProviderError('ACP cwd must be absolute', 'invalid_request');
    return path.normalize(candidate);
  }

  async #initialize() {
    if (!this.#initialization) {
      this.#initialization = this.peer
        .request('initialize', {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'hseos', title: 'HSEOS', version: this.providerManifest.provider_version },
          _meta: { hseos: { effectBoundary: 'instructions_only' } },
        })
        .then((value) => {
          const response = assertRecord(value, 'initialize response');
          assertOnlyKeys(response, ['protocolVersion', 'agentCapabilities', 'authMethods', 'agentInfo', '_meta'], 'initialize response');
          if (response.protocolVersion !== ACP_PROTOCOL_VERSION) {
            throw new RuntimeProviderError('ACP protocol version negotiation failed', 'capability_unavailable');
          }
          const capabilities = response.agentCapabilities === undefined ? {} : validateAgentCapabilities(response.agentCapabilities);
          if (response.authMethods !== undefined) {
            if (!Array.isArray(response.authMethods))
              throw new RuntimeProviderError('initialize authMethods is malformed', 'protocol_error');
            if (response.authMethods.length > 0) {
              throw new RuntimeProviderError('ACP authentication is unsupported by the L0 bridge', 'capability_unavailable');
            }
          }
          assertOptionalImplementation(response.agentInfo, 'initialize agentInfo');
          assertOptionalMeta(response._meta, 'initialize response');
          const hseos = isRecord(capabilities._meta) && isRecord(capabilities._meta.hseos) ? capabilities._meta.hseos : null;
          if ((!hseos || hseos.effectBoundary !== 'instructions_only') && !this.effectBoundaryAttestation) {
            throw new RuntimeProviderError('ACP peer did not attest the instructions-only effect boundary', 'policy_denied');
          }
          this.agentCapabilities = deepFreeze({ loadSession: capabilities.loadSession === true });
          return response;
        })
        .catch((error) => {
          this.#initialization = undefined;
          throw error;
        });
    }
    return this.#initialization;
  }

  #newSession(spec, runtimeSessionId, cwd, sequence) {
    return {
      sessionId: spec.session_id,
      runtimeSessionId,
      spec,
      cwd,
      sequence,
      events: [],
      eventBytes: 0,
      maxDurationMs: spec.limits.max_duration_ms,
      maxInputBytes: Math.min(MAX_INPUT_BYTES_PER_TURN, Math.max(1024, spec.limits.max_tokens * 16)),
      maxEventBytes: Math.min(MAX_STREAM_BYTES_PER_SESSION, Math.max(4096, spec.limits.max_tokens * 16)),
      maxEvents: Math.min(MAX_EVENTS_PER_SESSION, Math.max(3, spec.limits.max_tokens)),
      waiters: new Set(),
      activeTurn: null,
      loading: false,
      deadline: null,
      terminal: false,
    };
  }

  #resolve(input) {
    const session = this.#sessions.get(input.session_id);
    if (!session || session.runtimeSessionId !== input.runtime_session_id) this.#sessionError();
    return session;
  }

  #sessionError() {
    throw new RuntimeProviderError('ACP session identity mismatch', 'invalid_request');
  }

  #emit(session, eventType, payload) {
    session.sequence += 1;
    const event = parseContract(
      RuntimeEventSchema,
      {
        schema_version: CONTRACT_SCHEMA_VERSION,
        provider_id: this.providerManifest.provider_id,
        runtime_session_id: session.runtimeSessionId,
        sequence: session.sequence,
        occurred_at: this.clock(),
        event_type: eventType,
        payload,
      },
      'ACP normalized runtime event',
    );
    const eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
    if (!['runtime.session.completed', 'runtime.session.failed'].includes(eventType)) {
      if (session.events.length + 1 >= session.maxEvents || session.eventBytes + eventBytes > session.maxEventBytes) {
        session.sequence -= 1;
        void this.#safeNotify('session/cancel', { sessionId: session.runtimeSessionId });
        this.#terminate(session, 'runtime.session.failed', {
          error_code: 'budget_exceeded',
          message: 'ACP session exceeded its bounded event budget',
          retryable: false,
        });
        return session.events.at(-1);
      }
    }
    session.events.push(event);
    session.eventBytes += eventBytes;
    for (const waiter of session.waiters) waiter();
    session.waiters.clear();
    return event;
  }

  #terminate(session, eventType, payload) {
    if (session.terminal) return;
    session.terminal = true;
    session.activeTurn = null;
    if (session.deadline) clearTimeout(session.deadline);
    session.deadline = null;
    this.#emit(session, eventType, payload);
  }

  #completePrompt(session, value) {
    if (session.terminal) return;
    const response = assertRecord(value, 'session/prompt response');
    assertOnlyKeys(response, ['stopReason', '_meta'], 'session/prompt response');
    assertOptionalMeta(response._meta, 'session/prompt response');
    const reason = assertString(response.stopReason, 'session/prompt stopReason', 128);
    if (!ACP_STOP_REASONS.includes(reason)) throw new RuntimeProviderError('invalid ACP stopReason', 'protocol_error');
    if (reason === 'cancelled') {
      this.#terminate(session, 'runtime.session.failed', {
        error_code: 'cancelled',
        message: 'ACP peer cancelled the prompt turn',
        retryable: false,
      });
      return;
    }
    if (reason === 'max_tokens' || reason === 'max_turn_requests') {
      this.#terminate(session, 'runtime.session.failed', {
        error_code: 'budget_exceeded',
        message: 'ACP peer reached a bounded prompt limit',
        retryable: false,
      });
      return;
    }
    if (reason === 'refusal') {
      this.#terminate(session, 'runtime.session.failed', {
        error_code: 'policy_denied',
        message: 'ACP peer refused the prompt turn',
        retryable: false,
      });
      return;
    }
    this.#terminate(session, 'runtime.session.completed', {
      outcome_ref: `acp://session/${encodeURIComponent(session.runtimeSessionId)}/stop/${encodeURIComponent(reason)}`,
    });
  }

  #fail(session, error) {
    const normalized = error instanceof RuntimeProviderError ? error : new RuntimeProviderError('ACP request failed', 'protocol_error');
    this.#terminate(session, 'runtime.session.failed', {
      error_code: normalized.error_code,
      message: normalized.error_code === 'protocol_error' ? 'ACP peer violated the protocol' : normalized.message,
      retryable: normalized.retryable,
    });
  }

  #onNotification(method, params) {
    if (method !== 'session/update') throw new RuntimeProviderError('unsupported ACP notification', 'protocol_error');
    const value = assertRecord(params, 'session/update');
    const runtimeSessionId = assertString(value.sessionId, 'session/update sessionId', 1024);
    const session = [...this.#sessions.values()].find((candidate) => candidate.runtimeSessionId === runtimeSessionId);
    if (!session || session.terminal || (!session.activeTurn && !session.loading)) this.#sessionError();
    try {
      assertOnlyKeys(value, ['sessionId', 'update', '_meta'], 'session/update');
      assertOptionalMeta(value._meta, 'session/update');
      const update = assertRecord(value.update, 'session/update update');
      const kind = assertString(update.sessionUpdate, 'session/update discriminator', 128);
      const contentKinds = ['agent_message_chunk', 'agent_thought_chunk', 'user_message_chunk'];
      const metadataKinds = [
        'plan',
        'available_commands_update',
        'current_mode_update',
        'config_option_update',
        'session_info_update',
        'usage_update',
      ];
      if (![...contentKinds, 'tool_call', 'tool_call_update', ...metadataKinds].includes(kind)) {
        throw new RuntimeProviderError('unsupported ACP session update', 'protocol_error');
      }
      if (contentKinds.includes(kind)) {
        assertOnlyKeys(update, ['sessionUpdate', 'content', 'messageId', '_meta'], 'ACP content chunk');
        if (update.messageId !== undefined && update.messageId !== null) {
          assertBoundedText(update.messageId, 'ACP messageId', 1024);
        }
        assertOptionalMeta(update._meta, 'ACP content chunk');
        const content = assertRecord(update.content, 'ACP message content');
        assertOnlyKeys(content, ['type', 'text', 'annotations', '_meta'], 'ACP message content');
        if (content.type !== 'text') throw new RuntimeProviderError('ACP L0 accepts text output only', 'capability_unavailable');
        const text = assertBoundedText(content.text, 'ACP message text');
        validateAnnotations(content.annotations);
        assertOptionalMeta(content._meta, 'ACP message content');
        if (!session.loading && kind === 'agent_message_chunk') {
          this.#emit(session, 'runtime.message.delta', { turn_id: session.activeTurn, text });
        }
        return;
      }
      if (metadataKinds.includes(kind)) {
        throw new RuntimeProviderError('ACP metadata updates are unsupported by the L0 bridge', 'capability_unavailable');
      }
      if (kind === 'tool_call' || kind === 'tool_call_update') {
        void this.#safeNotify('session/cancel', { sessionId: session.runtimeSessionId });
        this.#terminate(session, 'runtime.session.failed', {
          error_code: 'policy_denied',
          message: 'ACP L0 peer attempted a tool effect',
          retryable: false,
        });
      }
    } catch (error) {
      void this.#safeNotify('session/cancel', { sessionId: session.runtimeSessionId });
      this.#fail(session, error);
      throw error;
    }
  }

  #onRequest(method, params) {
    if (method === 'session/request_permission') {
      const value = assertRecord(params, 'session/request_permission');
      const runtimeSessionId = assertString(value.sessionId, 'permission sessionId', 1024);
      const session = [...this.#sessions.values()].find((candidate) => candidate.runtimeSessionId === runtimeSessionId);
      if (!session || session.terminal || (!session.activeTurn && !session.loading)) this.#sessionError();
      try {
        assertOnlyKeys(value, ['sessionId', 'toolCall', 'options', '_meta'], 'session/request_permission');
        assertOptionalMeta(value._meta, 'session/request_permission');
        const toolCall = assertRecord(value.toolCall, 'permission toolCall');
        assertOnlyKeys(
          toolCall,
          ['toolCallId', 'title', 'kind', 'status', 'content', 'locations', 'rawInput', 'rawOutput', '_meta'],
          'permission toolCall',
        );
        assertString(toolCall.toolCallId, 'permission toolCallId', 1024);
        if (toolCall.title !== undefined) assertString(toolCall.title, 'permission toolCall title');
        if (
          toolCall.kind !== undefined &&
          !['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other'].includes(toolCall.kind)
        ) {
          throw new RuntimeProviderError('permission toolCall kind is malformed', 'protocol_error');
        }
        if (toolCall.status !== undefined && !['pending', 'in_progress', 'completed', 'failed'].includes(toolCall.status)) {
          throw new RuntimeProviderError('permission toolCall status is malformed', 'protocol_error');
        }
        for (const key of ['content', 'locations']) {
          if (toolCall[key] !== undefined && !Array.isArray(toolCall[key])) {
            throw new RuntimeProviderError(`permission toolCall ${key} is malformed`, 'protocol_error');
          }
        }
        for (const key of ['rawInput', 'rawOutput']) {
          if (toolCall[key] !== undefined && !isRecord(toolCall[key])) {
            throw new RuntimeProviderError(`permission toolCall ${key} is malformed`, 'protocol_error');
          }
        }
        assertOptionalMeta(toolCall._meta, 'permission toolCall');
        if (!Array.isArray(value.options)) throw new RuntimeProviderError('permission options are malformed', 'protocol_error');
        const optionIds = new Set();
        for (const optionValue of value.options) {
          const option = assertRecord(optionValue, 'permission option');
          assertOnlyKeys(option, ['optionId', 'name', 'kind', '_meta'], 'permission option');
          const optionId = assertString(option.optionId, 'permission optionId', 1024);
          assertString(option.name, 'permission option name');
          if (!['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(option.kind)) {
            throw new RuntimeProviderError('permission option kind is malformed', 'protocol_error');
          }
          assertOptionalMeta(option._meta, 'permission option');
          if (optionIds.has(optionId)) throw new RuntimeProviderError('permission option identifiers are duplicated', 'protocol_error');
          optionIds.add(optionId);
        }
      } catch (error) {
        void this.#safeNotify('session/cancel', { sessionId: runtimeSessionId });
        this.#fail(session, error);
        throw error;
      }
      void this.#safeNotify('session/cancel', { sessionId: runtimeSessionId });
      this.#terminate(session, 'runtime.session.failed', {
        error_code: 'policy_denied',
        message: 'ACP L0 peer requested effect permission',
        retryable: false,
      });
      return { outcome: { outcome: 'cancelled' } };
    }
    throw new RuntimeProviderError('unsupported ACP client request', 'protocol_error');
  }

  #remaining(deadlineAt) {
    return Math.max(0, deadlineAt - Date.now());
  }

  async #boundedRequest(request, timeoutMs, label) {
    if (timeoutMs <= 0) throw new RuntimeProviderError(`${label} exceeded its deadline`, 'timeout');
    let timeout;
    let onClose;
    try {
      const closed = new Promise((unused, reject) => {
        onClose = () => reject(new RuntimeProviderError(`${label} was interrupted by provider close`, 'cancelled'));
        if (this.#closeController.signal.aborted) {
          onClose();
          return;
        }
        this.#closeController.signal.addEventListener('abort', onClose, { once: true });
      });
      return await Promise.race([
        Promise.resolve(request),
        closed,
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
    }
  }

  async #settleExternal(request, timeoutMs) {
    let timeout;
    try {
      await Promise.race([
        Promise.resolve(request),
        new Promise((resolve) => {
          timeout = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } catch {
      // Teardown is locally complete even when the external peer does not settle.
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async #safeNotify(method, params) {
    await this.#settleExternal(
      Promise.resolve().then(() => this.peer.notify(method, params)),
      NOTIFY_SETTLE_TIMEOUT_MS,
    );
  }

  #armDeadline(session, remainingMs) {
    const delay = Math.min(remainingMs, MAX_TIMER_DELAY_MS);
    const startedAt = Date.now();
    session.deadline = setTimeout(() => {
      const remaining = remainingMs - Math.max(1, Date.now() - startedAt);
      if (remaining > 0) {
        this.#armDeadline(session, remaining);
        return;
      }
      void this.#safeNotify('session/cancel', { sessionId: session.runtimeSessionId });
      this.#terminate(session, 'runtime.session.failed', {
        error_code: 'timeout',
        message: 'ACP session exceeded its duration limit',
        retryable: false,
      });
    }, delay);
    session.deadline.unref?.();
  }
}

module.exports = {
  ACP_PROTOCOL_VERSION,
  ACP_STOP_REASONS,
  MAX_EVENTS_PER_SESSION,
  MAX_INPUT_BYTES_PER_TURN,
  MAX_SESSIONS,
  MAX_STREAM_BYTES_PER_SESSION,
  MAX_TIMER_DELAY_MS,
  NOTIFY_SETTLE_TIMEOUT_MS,
  AcpRuntimeProvider,
  RuntimeProviderError,
};
