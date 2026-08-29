'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const { RuntimeProviderError } = require('./acp-runtime-provider');

const MAX_LINE_BYTES = 1_048_576;
const MAX_PENDING_REQUESTS = 64;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, label, maximum = 4096) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximum || /[\u0000\r\n]/u.test(value)) {
    throw new RuntimeProviderError(`${label} is malformed`, 'invalid_request');
  }
  return value;
}

function executablePath(value) {
  const candidate = text(value, 'ACP executable path');
  if (!path.isAbsolute(candidate)) throw new RuntimeProviderError('ACP executable path must be absolute', 'invalid_request');
  const resolved = fs.realpathSync(candidate);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new RuntimeProviderError('ACP executable must be an executable regular file', 'invalid_request');
  }
  return resolved;
}

function argumentsList(value) {
  if (!Array.isArray(value) || value.length > 32) throw new RuntimeProviderError('ACP arguments are malformed', 'invalid_request');
  return Object.freeze(value.map((entry) => text(entry, 'ACP argument', 4096)));
}

function environment(value) {
  if (!record(value)) throw new RuntimeProviderError('ACP environment is malformed', 'invalid_request');
  const entries = Object.entries(value);
  if (entries.length > 64) throw new RuntimeProviderError('ACP environment is too large', 'invalid_request');
  return Object.freeze(
    Object.fromEntries(
      entries.map(([key, entry]) => {
        if (
          !/^[A-Z][A-Z0-9_]{0,127}$/.test(key) ||
          typeof entry !== 'string' ||
          Buffer.byteLength(entry, 'utf8') > 8192 ||
          entry.includes('\u0000')
        ) {
          throw new RuntimeProviderError('ACP environment entry is malformed', 'invalid_request');
        }
        return [key, entry];
      }),
    ),
  );
}

class ProcessAcpPeer {
  #closed = false;
  #failureSignalled = false;
  #nextId = 1;
  #pending = new Map();
  #subscriber = null;

  constructor({ executable, args = [], cwd, env = {}, spawn_process = spawn }) {
    this.executable = executablePath(executable);
    this.args = argumentsList(args);
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new RuntimeProviderError('ACP cwd must be absolute', 'invalid_request');
    this.cwd = fs.realpathSync(cwd);
    this.env = environment(env);
    if (typeof spawn_process !== 'function') throw new RuntimeProviderError('ACP process factory must be a function', 'invalid_request');
    this.child = spawn_process(this.executable, this.args, {
      cwd: this.cwd,
      env: this.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    if (!this.child || !this.child.stdin || !this.child.stdout || typeof this.child.once !== 'function') {
      throw new RuntimeProviderError('ACP process handle is malformed', 'provider_unavailable');
    }
    this.lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => this.#line(line));
    this.child.once('error', () => this.#failAll('ACP process failed'));
    this.child.once('exit', () => this.#failAll('ACP process exited'));
  }

  subscribe(subscriber) {
    if (!record(subscriber) || typeof subscriber.notification !== 'function' || typeof subscriber.request !== 'function') {
      throw new RuntimeProviderError('ACP subscriber is malformed', 'invalid_request');
    }
    if (this.#subscriber) throw new RuntimeProviderError('ACP peer already has a subscriber', 'invalid_request');
    this.#subscriber = subscriber;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#subscriber === subscriber) this.#subscriber = null;
    };
  }

  request(method, params) {
    if (this.#closed) return Promise.reject(new RuntimeProviderError('ACP process is closed', 'provider_unavailable'));
    if (this.#pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new RuntimeProviderError('ACP process request limit reached', 'rate_limited'));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#write({ jsonrpc: '2.0', id, method: text(method, 'ACP method', 256), params });
      } catch (error) {
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.#write({ jsonrpc: '2.0', method: text(method, 'ACP method', 256), params });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.lines.close();
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
    this.#failAll('ACP process was closed');
  }

  #write(message) {
    if (this.#closed || !this.child.stdin.writable)
      throw new RuntimeProviderError('ACP process stdin is unavailable', 'provider_unavailable');
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      throw new RuntimeProviderError('ACP request exceeds the line budget', 'budget_exceeded');
    }
    this.child.stdin.write(line);
  }

  #line(line) {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) return this.#protocolFailure('ACP response exceeds the line budget');
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return this.#protocolFailure('ACP process emitted invalid JSON');
    }
    if (!record(message) || message.jsonrpc !== '2.0') return this.#protocolFailure('ACP process emitted a malformed JSON-RPC message');
    if (Object.hasOwn(message, 'id') && !Object.hasOwn(message, 'method')) return this.#response(message);
    if (typeof message.method !== 'string' || !record(message.params))
      return this.#protocolFailure('ACP process emitted a malformed method message');
    if (Object.hasOwn(message, 'id')) return void this.#inboundRequest(message);
    try {
      if (!this.#subscriber) throw new RuntimeProviderError('ACP notification arrived before subscription', 'protocol_error');
      this.#subscriber.notification(message.method, message.params);
    } catch {
      this.#protocolFailure('ACP notification violated the peer contract');
    }
  }

  #response(message) {
    const allowed = Object.hasOwn(message, 'error') ? ['jsonrpc', 'id', 'error'] : ['jsonrpc', 'id', 'result'];
    if (
      Object.keys(message).some((key) => !allowed.includes(key)) ||
      (!Object.hasOwn(message, 'result') && !Object.hasOwn(message, 'error'))
    ) {
      return this.#protocolFailure('ACP response envelope is malformed');
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return this.#protocolFailure('ACP process emitted an unknown response id');
    this.#pending.delete(message.id);
    if (Object.hasOwn(message, 'error')) pending.reject(new RuntimeProviderError('ACP process rejected a request', 'protocol_error'));
    else pending.resolve(message.result);
  }

  async #inboundRequest(message) {
    try {
      if (!this.#subscriber) throw new RuntimeProviderError('ACP request arrived before subscription', 'protocol_error');
      const result = await this.#subscriber.request(message.method, message.params);
      this.#write({ jsonrpc: '2.0', id: message.id, result });
    } catch {
      try {
        this.#write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'ACP client rejected request' } });
      } finally {
        this.#protocolFailure('ACP request violated the peer contract');
      }
    }
  }

  #protocolFailure(message) {
    this.#failAll(message, 'protocol_error');
    void this.close();
  }

  #failAll(message, code = 'provider_unavailable') {
    const error = new RuntimeProviderError(message, code);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    if (!this.#failureSignalled) this.#failureSignalled = true;
  }
}

module.exports = { MAX_LINE_BYTES, MAX_PENDING_REQUESTS, ProcessAcpPeer };
