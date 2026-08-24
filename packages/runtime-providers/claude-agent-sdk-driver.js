'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const { RuntimeProviderError } = require('./acp-runtime-provider');

const MAX_ENVIRONMENT_ENTRIES = 64;
const MAX_ENVIRONMENT_VALUE_BYTES = 65_536;
const NON_EFFECT_CONTENT_TYPES = new Set(['text', 'thinking', 'redacted_thinking']);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value, keys, label) {
  if (!record(value)) throw new RuntimeProviderError(`${label} is malformed`, 'protocol_error');
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new RuntimeProviderError(`${label} contains unknown fields`, 'protocol_error');
}

function text(value, label, maximum = 1024) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new RuntimeProviderError(`${label} is malformed`, 'protocol_error');
  }
  return value;
}

function absoluteFile(value, label, executable = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new RuntimeProviderError(`${label} must be absolute`, 'invalid_request');
  }
  const resolved = fs.realpathSync(value);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new RuntimeProviderError(`${label} must be a file`, 'invalid_request');
  if (executable) {
    try {
      fs.accessSync(resolved, fs.constants.X_OK);
    } catch {
      throw new RuntimeProviderError(`${label} is not executable`, 'invalid_request');
    }
  }
  return resolved;
}

function safeEnvironment(value) {
  if (!record(value) || Object.keys(value).length > MAX_ENVIRONMENT_ENTRIES) {
    throw new RuntimeProviderError('Claude environment is invalid', 'invalid_request');
  }
  const environment = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || typeof entry !== 'string') {
      throw new RuntimeProviderError('Claude environment entry is invalid', 'invalid_request');
    }
    if (Buffer.byteLength(entry, 'utf8') > MAX_ENVIRONMENT_VALUE_BYTES || entry.includes('\u0000')) {
      throw new RuntimeProviderError('Claude environment value is invalid', 'invalid_request');
    }
    environment[name] = entry;
  }
  return Object.freeze(environment);
}

class ClaudeAgentSdkDriver {
  #closed = false;
  #sdk;
  #sessions = new Map();

  constructor({ sdk_module, executable, cwd, env = {}, import_module = (specifier) => import(specifier) }) {
    this.sdkModule = absoluteFile(sdk_module, 'Claude Agent SDK module');
    this.executable = absoluteFile(executable, 'Claude Code executable', true);
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      throw new RuntimeProviderError('Claude driver cwd must be absolute', 'invalid_request');
    }
    this.cwd = fs.realpathSync(cwd);
    if (!fs.statSync(this.cwd).isDirectory()) {
      throw new RuntimeProviderError('Claude driver cwd must be a directory', 'invalid_request');
    }
    this.env = safeEnvironment(env);
    if (typeof import_module !== 'function') {
      throw new RuntimeProviderError('Claude SDK module loader must be a function', 'invalid_request');
    }
    this.importModule = import_module;
  }

  async create(input) {
    this.#available();
    exact(input, ['adapter_id', 'protocol', 'cwd', 'limits', 'effect_boundary'], 'Claude create input');
    this.#boundary(input);
    await this.#loadSdk();
    if (typeof input.cwd !== 'string' || fs.realpathSync(input.cwd) !== this.cwd) {
      throw new RuntimeProviderError('Claude session cwd differs from the bound cwd', 'invalid_request');
    }
    const runtimeSessionId = randomUUID();
    this.#sessions.set(runtimeSessionId, { runtimeSessionId, mode: 'new', active: null });
    return { runtime_session_id: runtimeSessionId, effect_boundary: 'instructions_only', resumable: true };
  }

  async resume(input) {
    this.#available();
    exact(input, ['runtime_session_id', 'expected_sequence', 'effect_boundary'], 'Claude resume input');
    this.#boundary(input);
    const runtimeSessionId = text(input.runtime_session_id, 'Claude session id');
    if (this.#sessions.has(runtimeSessionId)) return { effect_boundary: 'instructions_only' };
    const sdk = await this.#loadSdk();
    let sessionInfo;
    try {
      sessionInfo = await sdk.getSessionInfo(runtimeSessionId, { dir: this.cwd });
    } catch (error) {
      throw new RuntimeProviderError('Claude session discovery failed', 'provider_unavailable', { cause: error });
    }
    this.#sessions.set(runtimeSessionId, {
      runtimeSessionId,
      mode: sessionInfo === undefined ? 'new' : 'resume',
      active: null,
    });
    return { effect_boundary: 'instructions_only' };
  }

  async send(input) {
    this.#available();
    exact(input, ['runtime_session_id', 'turn_id', 'instruction', 'effect_boundary', 'on_event'], 'Claude send input');
    this.#boundary(input);
    if (typeof input.on_event !== 'function') {
      throw new RuntimeProviderError('Claude event callback is required', 'invalid_request');
    }
    const session = this.#resolve(input.runtime_session_id);
    if (session.active) throw new RuntimeProviderError('Claude session already has an active turn', 'invalid_request');
    const sdk = await this.#loadSdk();
    const controller = new AbortController();
    let query;
    try {
      query = sdk.query({
        prompt: input.instruction,
        options: {
          abortController: controller,
          allowedTools: [],
          cwd: this.cwd,
          env: this.env,
          maxTurns: 1,
          pathToClaudeCodeExecutable: this.executable,
          permissionMode: 'plan',
          persistSession: true,
          settingSources: [],
          tools: [],
          ...(session.mode === 'resume' ? { resume: session.runtimeSessionId } : { sessionId: session.runtimeSessionId }),
        },
      });
    } catch (error) {
      throw new RuntimeProviderError('Claude Agent SDK query failed to start', 'provider_unavailable', { cause: error });
    }
    if (!query || typeof query[Symbol.asyncIterator] !== 'function' || typeof query.close !== 'function') {
      throw new RuntimeProviderError('Claude Agent SDK returned a malformed query', 'protocol_error');
    }
    const active = { controller, query };
    session.active = active;
    let stopReason;
    try {
      for await (const message of query) {
        stopReason = this.#message(session, input.on_event, message) || stopReason;
        if (stopReason === 'refused') break;
      }
      if (!stopReason) throw new RuntimeProviderError('Claude stream ended without a result', 'protocol_error');
      session.mode = 'resume';
      return { stop_reason: stopReason };
    } catch (error) {
      if (controller.signal.aborted) return { stop_reason: 'cancelled' };
      if (error instanceof RuntimeProviderError) throw error;
      throw new RuntimeProviderError('Claude Agent SDK stream failed', 'provider_unavailable', { cause: error });
    } finally {
      if (session.active === active) session.active = null;
      query.close();
    }
  }

  async cancel(input) {
    exact(input, ['runtime_session_id', 'reason'], 'Claude cancel input');
    const session = this.#sessions.get(input.runtime_session_id);
    if (!session) return;
    if (session.active) {
      session.active.controller.abort();
      session.active.query.close();
      session.active = null;
    }
    this.#sessions.delete(session.runtimeSessionId);
  }

  async dispose(input) {
    exact(input, ['runtime_session_id'], 'Claude dispose input');
    const session = this.#sessions.get(input.runtime_session_id);
    if (!session) return;
    if (session.active) {
      session.active.controller.abort();
      session.active.query.close();
    }
    this.#sessions.delete(session.runtimeSessionId);
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const session of this.#sessions.values()) {
      if (session.active) {
        session.active.controller.abort();
        session.active.query.close();
      }
    }
    this.#sessions.clear();
  }

  #message(session, onEvent, value) {
    if (!record(value) || value.session_id !== session.runtimeSessionId || typeof value.type !== 'string') {
      throw new RuntimeProviderError('Claude Agent SDK emitted a malformed session message', 'protocol_error');
    }
    if (value.type === 'system' && value.subtype === 'init') {
      if (!Array.isArray(value.tools) || value.tools.length !== 0 || value.permissionMode !== 'plan') {
        onEvent({ type: 'effect.attempted', effect: 'sdk-init-capability-drift' });
        return 'refused';
      }
      return;
    }
    if (value.type === 'assistant') {
      if (!record(value.message) || !Array.isArray(value.message.content)) {
        throw new RuntimeProviderError('Claude assistant message is malformed', 'protocol_error');
      }
      for (const block of value.message.content) {
        if (!record(block) || typeof block.type !== 'string') {
          throw new RuntimeProviderError('Claude content block is malformed', 'protocol_error');
        }
        if (!NON_EFFECT_CONTENT_TYPES.has(block.type)) {
          onEvent({ type: 'effect.attempted', effect: block.type });
          return 'refused';
        }
        if (block.type === 'text') {
          if (typeof block.text !== 'string') {
            throw new RuntimeProviderError('Claude text block is malformed', 'protocol_error');
          }
          if (block.text.length > 0) onEvent({ type: 'message.delta', text: block.text });
        }
      }
      return;
    }
    if (value.type === 'result') {
      if (Array.isArray(value.permission_denials) && value.permission_denials.length > 0) {
        onEvent({ type: 'effect.attempted', effect: 'permission-denial' });
        return 'refused';
      }
      if (value.subtype === 'success' && value.is_error === false) return 'completed';
      if (value.subtype === 'error_max_budget_usd' || value.subtype === 'error_max_turns') return 'budget_exceeded';
      return 'refused';
    }
    throw new RuntimeProviderError('Claude Agent SDK emitted an unsupported message', 'protocol_error');
  }

  async #loadSdk() {
    if (!this.#sdk) {
      let loaded;
      try {
        loaded = await this.importModule(pathToFileURL(this.sdkModule).href);
      } catch (error) {
        throw new RuntimeProviderError('Claude Agent SDK module could not be loaded', 'provider_unavailable', { cause: error });
      }
      if (typeof loaded?.query !== 'function' || typeof loaded?.getSessionInfo !== 'function') {
        throw new RuntimeProviderError('Claude Agent SDK module is incompatible', 'protocol_error');
      }
      this.#sdk = loaded;
    }
    return this.#sdk;
  }

  #resolve(runtimeSessionIdValue) {
    const runtimeSessionId = text(runtimeSessionIdValue, 'Claude session id');
    const session = this.#sessions.get(runtimeSessionId);
    if (!session) throw new RuntimeProviderError('Claude session is not attached', 'invalid_request');
    return session;
  }

  #boundary(input) {
    if (input.effect_boundary !== 'instructions_only') {
      throw new RuntimeProviderError('Claude driver requires instructions-only boundary', 'policy_denied');
    }
  }

  #available() {
    if (this.#closed) throw new RuntimeProviderError('Claude driver is closed', 'provider_unavailable');
  }
}

module.exports = {
  ClaudeAgentSdkDriver,
  MAX_ENVIRONMENT_ENTRIES,
  NON_EFFECT_CONTENT_TYPES,
};
