'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const { RuntimeProviderError } = require('./acp-runtime-provider');

const MAX_LINE_BYTES = 1_048_576;
const MAX_PENDING_REQUESTS = 64;
const NON_EFFECT_ITEM_TYPES = new Set(['agentMessage', 'plan', 'reasoning', 'userMessage']);
const EFFECT_ITEM_TYPES = new Set([
  'collabAgentToolCall',
  'commandExecution',
  'contextCompaction',
  'dynamicToolCall',
  'fileChange',
  'imageGeneration',
  'imageView',
  'mcpToolCall',
  'webSearch',
]);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value, allowed, label) {
  if (!record(value)) throw new RuntimeProviderError(`${label} is malformed`, 'protocol_error');
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new RuntimeProviderError(`${label} contains unknown fields`, 'protocol_error');
  return value;
}

function text(value, label, maximum = 4096) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximum || /[\u0000\r\n]/u.test(value)) {
    throw new RuntimeProviderError(`${label} is malformed`, 'invalid_request');
  }
  return value;
}

function absoluteExecutable(value) {
  const candidate = text(value, 'Codex executable path');
  if (!path.isAbsolute(candidate)) {
    throw new RuntimeProviderError('Codex executable path must be absolute', 'invalid_request');
  }
  const executable = path.resolve(candidate);
  const stat = fs.statSync(executable);
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new RuntimeProviderError('Codex executable must be an executable regular file', 'invalid_request');
  }
  return fs.realpathSync(executable);
}

function safeArgs(value) {
  if (!Array.isArray(value) || value.length > 16) throw new RuntimeProviderError('Codex arguments are malformed', 'invalid_request');
  return Object.freeze(value.map((entry) => text(entry, 'Codex argument', 1024)));
}

function safeEnvironment(value) {
  if (!record(value)) throw new RuntimeProviderError('Codex environment is malformed', 'invalid_request');
  const entries = Object.entries(value);
  if (entries.length > 64) throw new RuntimeProviderError('Codex environment is too large', 'invalid_request');
  return Object.freeze(
    Object.fromEntries(
      entries.map(([key, entry]) => {
        if (
          !/^[A-Z][A-Z0-9_]{0,127}$/.test(key) ||
          typeof entry !== 'string' ||
          Buffer.byteLength(entry, 'utf8') > 8192 ||
          entry.includes('\u0000')
        ) {
          throw new RuntimeProviderError('Codex environment entry is malformed', 'invalid_request');
        }
        return [key, entry];
      }),
    ),
  );
}

class AppServerConnection {
  #closed = false;
  #failureSignalled = false;
  #nextId = 1;
  #pending = new Map();

  constructor({ executable, args, cwd, env, spawn_process, onNotification, onFailure }) {
    this.onNotification = onNotification;
    this.onFailure = onFailure;
    this.child = spawn_process(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    if (!this.child || !this.child.stdin || !this.child.stdout || typeof this.child.once !== 'function') {
      throw new RuntimeProviderError('Codex app-server process handle is malformed', 'provider_unavailable');
    }
    this.lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => this.#line(line));
    this.child.once('error', () => this.#failAll('Codex app-server process failed'));
    this.child.once('exit', () => this.#failAll('Codex app-server process exited'));
  }

  async initialize(clientInfo) {
    await this.request('initialize', { clientInfo });
    this.notify('initialized', {});
  }

  request(method, params) {
    if (this.#closed) return Promise.reject(new RuntimeProviderError('Codex app-server connection is closed', 'provider_unavailable'));
    if (this.#pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new RuntimeProviderError('Codex app-server request limit reached', 'rate_limited'));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.#write({ method, params });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.lines.close();
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
    this.#failAll('Codex app-server connection was closed');
  }

  #write(message) {
    if (this.#closed || !this.child.stdin.writable)
      throw new RuntimeProviderError('Codex app-server stdin is unavailable', 'provider_unavailable');
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES)
      throw new RuntimeProviderError('Codex app-server request exceeds the line budget', 'budget_exceeded');
    this.child.stdin.write(line);
  }

  #line(line) {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) return this.#protocolFailure('Codex app-server response exceeds the line budget');
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return this.#protocolFailure('Codex app-server emitted invalid JSON');
    }
    if (!record(message)) return this.#protocolFailure('Codex app-server emitted a malformed message');
    if (Object.hasOwn(message, 'id')) {
      const pending = this.#pending.get(message.id);
      if (!pending) return this.#protocolFailure('Codex app-server emitted an unknown response id');
      this.#pending.delete(message.id);
      if (Object.hasOwn(message, 'error')) {
        pending.reject(new RuntimeProviderError('Codex app-server rejected a request', 'protocol_error'));
      } else if (Object.hasOwn(message, 'result')) {
        pending.resolve(message.result);
      } else {
        pending.reject(new RuntimeProviderError('Codex app-server response is incomplete', 'protocol_error'));
      }
      return;
    }
    if (typeof message.method !== 'string' || !record(message.params))
      return this.#protocolFailure('Codex app-server notification is malformed');
    try {
      this.onNotification(message.method, message.params);
    } catch {
      this.#protocolFailure('Codex app-server notification violated the driver contract');
    }
  }

  #protocolFailure(message) {
    this.#failAll(message, 'protocol_error');
    this.close();
  }

  #failAll(message, code = 'provider_unavailable') {
    const error = new RuntimeProviderError(message, code);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    if (!this.#failureSignalled) {
      this.#failureSignalled = true;
      this.onFailure(error);
    }
  }
}

class CodexAppServerDriver {
  #closed = false;
  #sessions = new Map();

  constructor({ executable, args = ['app-server', '--listen', 'stdio://'], cwd, env = {}, spawn_process = spawn, client = {} }) {
    this.executable = absoluteExecutable(executable);
    this.args = safeArgs(args);
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd))
      throw new RuntimeProviderError('Codex driver cwd must be absolute', 'invalid_request');
    this.cwd = fs.realpathSync(cwd);
    this.env = safeEnvironment(env);
    if (typeof spawn_process !== 'function') throw new RuntimeProviderError('Codex process factory must be a function', 'invalid_request');
    this.spawnProcess = spawn_process;
    exact(client, ['name', 'title', 'version'], 'Codex client metadata');
    this.client = Object.freeze({
      name: text(client.name || 'hseos', 'Codex client name', 128),
      title: text(client.title || 'HSEOS', 'Codex client title', 128),
      version: text(client.version || '1.0.0', 'Codex client version', 128),
    });
  }

  async create(input) {
    this.#available();
    exact(input, ['adapter_id', 'protocol', 'cwd', 'limits', 'effect_boundary'], 'Codex create input');
    this.#boundary(input);
    const connection = await this.#connection(input.cwd);
    try {
      const result = await connection.request('thread/start', {
        cwd: input.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        serviceName: 'hseos',
      });
      const runtimeSessionId = text(result?.thread?.id, 'Codex thread id', 1024);
      if (this.#sessions.has(runtimeSessionId)) throw new RuntimeProviderError('Codex reused a thread identity', 'protocol_error');
      this.#sessions.set(runtimeSessionId, this.#session(connection, runtimeSessionId));
      return { runtime_session_id: runtimeSessionId, effect_boundary: 'instructions_only', resumable: true };
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  async resume(input) {
    this.#available();
    exact(input, ['runtime_session_id', 'expected_sequence', 'effect_boundary'], 'Codex resume input');
    this.#boundary(input);
    const runtimeSessionId = text(input.runtime_session_id, 'Codex thread id', 1024);
    if (this.#sessions.has(runtimeSessionId)) return { effect_boundary: 'instructions_only' };
    const connection = await this.#connection(this.cwd);
    try {
      const result = await connection.request('thread/resume', { threadId: runtimeSessionId });
      if (result?.thread?.id !== runtimeSessionId) throw new RuntimeProviderError('Codex resumed a different thread', 'protocol_error');
      this.#sessions.set(runtimeSessionId, this.#session(connection, runtimeSessionId));
      return { effect_boundary: 'instructions_only' };
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  async send(input) {
    this.#available();
    exact(input, ['runtime_session_id', 'turn_id', 'instruction', 'effect_boundary', 'on_event'], 'Codex send input');
    this.#boundary(input);
    if (typeof input.on_event !== 'function') throw new RuntimeProviderError('Codex event callback is required', 'invalid_request');
    const session = this.#resolve(input.runtime_session_id);
    if (session.active) throw new RuntimeProviderError('Codex thread already has an active turn', 'invalid_request');
    let startedResolve;
    const started = new Promise((resolve) => {
      startedResolve = resolve;
    });
    session.active = {
      hseosTurnId: input.turn_id,
      codexTurnId: null,
      onEvent: input.on_event,
      settle: null,
      started,
      startedResolve,
      completed: false,
    };
    const active = session.active;
    const completion = new Promise((resolve, reject) => {
      active.settle = { resolve, reject };
    });
    active.completion = completion;
    try {
      const result = await session.connection.request('turn/start', {
        threadId: session.runtimeSessionId,
        input: [{ type: 'text', text: input.instruction }],
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly' },
      });
      const codexTurnId = text(result?.turn?.id, 'Codex turn id', 1024);
      if (active.codexTurnId && active.codexTurnId !== codexTurnId) {
        throw new RuntimeProviderError('Codex turn acknowledgement changed identity', 'protocol_error');
      }
      active.codexTurnId = codexTurnId;
      active.startedResolve(true);
      return await completion;
    } catch (error) {
      if (session.active === active) {
        active.startedResolve(false);
        session.active = null;
      }
      throw error;
    }
  }

  async cancel(input) {
    exact(input, ['runtime_session_id', 'reason'], 'Codex cancel input');
    const session = this.#sessions.get(input.runtime_session_id);
    if (!session) return;
    if (session.active && !session.active.codexTurnId) {
      let timeout;
      try {
        await Promise.race([
          session.active.started,
          new Promise((resolve) => {
            timeout = setTimeout(() => resolve(false), 1000);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    if (session.active?.codexTurnId) {
      const active = session.active;
      await session.connection.request('turn/interrupt', {
        threadId: session.runtimeSessionId,
        turnId: active.codexTurnId,
      });
      let timeout;
      try {
        await Promise.race([
          active.completion,
          new Promise((unused, reject) => {
            timeout = setTimeout(() => reject(new RuntimeProviderError('Codex interruption completion timed out', 'timeout')), 1000);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    session.connection.close();
    this.#sessions.delete(session.runtimeSessionId);
  }

  async dispose(input) {
    exact(input, ['runtime_session_id'], 'Codex dispose input');
    const session = this.#sessions.get(input.runtime_session_id);
    if (!session) return;
    session.connection.close();
    this.#sessions.delete(session.runtimeSessionId);
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const session of this.#sessions.values()) session.connection.close();
    this.#sessions.clear();
  }

  async #connection(cwd) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd))
      throw new RuntimeProviderError('Codex session cwd must be absolute', 'invalid_request');
    const canonicalCwd = fs.realpathSync(cwd);
    const holder = { connection: null };
    const connection = new AppServerConnection({
      executable: this.executable,
      args: this.args,
      cwd: canonicalCwd,
      env: this.env,
      spawn_process: this.spawnProcess,
      onNotification: (method, params) => this.#notification(holder.connection, method, params),
      onFailure: (error) => this.#connectionFailure(holder.connection, error),
    });
    holder.connection = connection;
    await connection.initialize(this.client);
    return connection;
  }

  #session(connection, runtimeSessionId) {
    return { connection, runtimeSessionId, active: null };
  }

  #notification(connection, method, params) {
    const session = [...this.#sessions.values()].find((candidate) => candidate.connection === connection);
    if (!session || !session.active) return;
    const notifiedTurnId = params.turnId || params.turn?.id;
    if (!session.active.codexTurnId && params.threadId === session.runtimeSessionId && typeof notifiedTurnId === 'string') {
      session.active.codexTurnId = text(notifiedTurnId, 'Codex notified turn id', 1024);
      session.active.startedResolve(true);
    }
    if (method === 'item/agentMessage/delta') {
      if (
        params.threadId !== session.runtimeSessionId ||
        params.turnId !== session.active.codexTurnId ||
        typeof params.delta !== 'string'
      ) {
        throw new RuntimeProviderError('Codex message delta identity is malformed', 'protocol_error');
      }
      session.active.onEvent({ type: 'message.delta', text: params.delta });
      return;
    }
    if (method === 'item/started' || method === 'item/completed') {
      if (params.threadId !== session.runtimeSessionId || params.turnId !== session.active.codexTurnId) {
        throw new RuntimeProviderError('Codex item identity is malformed', 'protocol_error');
      }
      if (typeof params.item?.type !== 'string') {
        throw new RuntimeProviderError('Codex item type is malformed', 'protocol_error');
      }
      if (!NON_EFFECT_ITEM_TYPES.has(params.item.type)) {
        session.active.onEvent({ type: 'effect.attempted', effect: params.item.type });
      }
      return;
    }
    if (method !== 'turn/completed') return;
    if (params.threadId !== session.runtimeSessionId || params.turn?.id !== session.active.codexTurnId) {
      throw new RuntimeProviderError('Codex completion identity is malformed', 'protocol_error');
    }
    const active = session.active;
    active.completed = true;
    session.active = null;
    const status = params.turn.status;
    if (status === 'completed') active.settle.resolve({ stop_reason: 'completed' });
    else if (status === 'interrupted') active.settle.resolve({ stop_reason: 'cancelled' });
    else active.settle.resolve({ stop_reason: 'refused' });
  }

  #resolve(runtimeSessionIdValue) {
    const runtimeSessionId = text(runtimeSessionIdValue, 'Codex thread id', 1024);
    const session = this.#sessions.get(runtimeSessionId);
    if (!session) throw new RuntimeProviderError('Codex thread is not attached', 'invalid_request');
    return session;
  }

  #connectionFailure(connection, error) {
    const session = [...this.#sessions.values()].find((candidate) => candidate.connection === connection);
    if (!session?.active) return;
    const active = session.active;
    session.active = null;
    active.startedResolve(false);
    active.settle.reject(error);
  }

  #boundary(input) {
    if (input.effect_boundary !== 'instructions_only')
      throw new RuntimeProviderError('Codex driver requires instructions-only boundary', 'policy_denied');
  }

  #available() {
    if (this.#closed) throw new RuntimeProviderError('Codex driver is closed', 'provider_unavailable');
  }
}

module.exports = {
  CodexAppServerDriver,
  EFFECT_ITEM_TYPES,
  MAX_LINE_BYTES,
  NON_EFFECT_ITEM_TYPES,
};
