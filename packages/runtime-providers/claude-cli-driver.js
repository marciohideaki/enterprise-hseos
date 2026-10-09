'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const { RuntimeProviderError } = require('./acp-runtime-provider');

const ENVIRONMENT_NAMES = new Set(['HOME', 'PATH', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS']);
// oauth_token (CLAUDE_CODE_OAUTH_TOKEN) is deliberately unsupported: the token cannot be resolved without exposing it.
const ACCOUNT_AUTH_METHODS = new Set(['claude.ai']);
const NON_EFFECT_CONTENT_TYPES = new Set(['text', 'thinking', 'redacted_thinking']);
const PASSIVE_SYSTEM_SUBTYPES = new Set(['thinking_tokens', 'status', 'api_retry']);
const MAX_STREAM_BYTES = 1_048_576;
const MAX_LINE_BYTES = 262_144;
const MAX_CAPTURE_BYTES = 65_536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function absolute(value, label, executable = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new RuntimeProviderError(`${label} must be absolute`, 'invalid_request');
  const resolved = fs.realpathSync(value);
  const stat = fs.statSync(resolved);
  if (executable ? !stat.isFile() : !stat.isDirectory()) throw new RuntimeProviderError(`${label} has the wrong type`, 'invalid_request');
  if (executable) fs.accessSync(resolved, fs.constants.X_OK);
  return resolved;
}

/**
 * The child environment is an allowlist: provider credentials, cloud-provider switches and helper
 * overrides take precedence over a subscription login, so none of them may ever be forwarded.
 */
function accountEnvironment(value) {
  if (!record(value)) throw new RuntimeProviderError('Claude environment is invalid', 'invalid_request');
  const environment = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!ENVIRONMENT_NAMES.has(name) || typeof entry !== 'string' || entry.length === 0 || entry.includes('\u0000'))
      throw new RuntimeProviderError('Claude environment entry is not allowed', 'invalid_request');
    environment[name] = entry;
  }
  if (!environment.HOME || !environment.PATH)
    throw new RuntimeProviderError('Claude environment requires HOME and PATH', 'invalid_request');
  return Object.freeze(environment);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Drives the unmodified `claude` binary in headless stream-json mode under the owner's own login. */
class ClaudeCliDriver {
  constructor({ executable, cwd, env, grace_ms = 2000 }) {
    this.executable = absolute(executable, 'Claude Code executable', true);
    this.cwd = absolute(cwd, 'Claude driver cwd');
    this.env = accountEnvironment(env);
    this.graceMs = grace_ms;
  }

  /** Bounded capture for non-prompt commands (`--version`, `auth status`). */
  async #capture(args, timeoutMs) {
    const child = spawn(this.executable, args, { cwd: this.cwd, env: { ...this.env }, stdio: ['ignore', 'pipe', 'ignore'], shell: false });
    let output = '';
    let overflow = false;
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > MAX_CAPTURE_BYTES) {
        overflow = true;
        child.kill('SIGKILL');
      }
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const code = await new Promise((resolve) => {
      child.once('error', () => resolve(-1));
      child.once('close', (value) => resolve(value ?? -1));
    });
    clearTimeout(timer);
    if (code !== 0 || overflow) throw new RuntimeProviderError('Claude command failed', 'provider_unavailable');
    return output;
  }

  /** Reports version and the identity tuple; never reads or returns credentials. */
  async inspectAccount({ timeout_ms = 10_000 } = {}) {
    const version = (await this.#capture(['--version'], timeout_ms)).trim();
    let status;
    try {
      status = JSON.parse(await this.#capture(['auth', 'status', '--json'], timeout_ms));
    } catch (error) {
      if (error instanceof RuntimeProviderError) throw error;
      throw new RuntimeProviderError('Claude auth status is malformed', 'protocol_error');
    }
    if (!record(status)) throw new RuntimeProviderError('Claude auth status is malformed', 'protocol_error');
    return {
      version,
      logged_in: status.loggedIn === true,
      api_provider: status.apiProvider,
      identity: {
        authMethod: status.authMethod,
        email: status.email,
        orgId: status.orgId,
        subscriptionType: status.subscriptionType,
      },
    };
  }

  static isAccountAuthMethod(value) {
    return ACCOUNT_AUTH_METHODS.has(value);
  }

  static buildArguments({ model, session_id, persist, resume, max_turns = 1 }) {
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      model,
      '--max-turns',
      String(max_turns),
      '--permission-mode',
      'dontAsk',
      '--setting-sources',
      '',
      '--safe-mode',
      '--settings',
      '{"disableAllHooks":true}',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--disallowedTools',
      'mcp__*',
      '--disable-slash-commands',
      ...(resume ? ['--resume', resume] : persist ? ['--session-id', session_id] : ['--no-session-persistence']),
      // Variadic option last so nothing after it can be swallowed as a tool name.
      '--tools',
      '',
    ];
  }

  async run({ prompt, model, session_id, persist = false, resume, timeout_ms, signal, on_event, on_usage, expected_version }) {
    if (typeof prompt !== 'string' || prompt.length === 0 || typeof model !== 'string' || model.length === 0)
      throw new RuntimeProviderError('Claude run input is invalid', 'invalid_request');
    if (typeof on_event !== 'function') throw new RuntimeProviderError('Claude event callback is required', 'invalid_request');
    if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 1) throw new RuntimeProviderError('Claude timeout is invalid', 'invalid_request');
    if (!UUID.test(session_id) || (resume !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(resume)))
      throw new RuntimeProviderError('Claude session id is invalid', 'invalid_request');
    if (signal?.aborted) return { stop_reason: 'cancelled' };
    const expected = resume ?? (persist ? session_id : undefined);
    const args = ClaudeCliDriver.buildArguments({ model, session_id, persist, resume });
    const child = spawn(this.executable, args, { cwd: this.cwd, env: { ...this.env }, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    const closed = new Promise((resolve) => {
      child.once('error', () => resolve(-1));
      child.once('close', (code, sig) => resolve(sig ? -1 : (code ?? -1)));
    });
    let failure;
    let cancelled = false;
    let seenInit = false;
    let initial = { model: null, fast_mode_state: null };
    let observedSession;
    let result;
    let bytes = 0;
    let pending = '';
    const decoder = new StringDecoder('utf8');
    const warnings = [];
    const fail = (error) => {
      failure ||= error;
      void terminate();
    };
    // SIGINT lets the client flush, SIGTERM is the polite stop, SIGKILL is the guaranteed one.
    let terminating = false;
    const terminate = async () => {
      if (terminating) return;
      terminating = true;
      for (const stage of ['SIGINT', 'SIGTERM', 'SIGKILL']) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill(stage);
        if (stage === 'SIGKILL') return;
        if ((await Promise.race([closed.then(() => true), sleep(this.graceMs).then(() => false)])) === true) return;
      }
    };
    const handle = (message) => {
      if (!record(message) || typeof message.type !== 'string')
        throw new RuntimeProviderError('Claude message is malformed', 'protocol_error');
      if (message.session_id !== undefined) {
        if (typeof message.session_id !== 'string' || !UUID.test(message.session_id))
          throw new RuntimeProviderError('Claude message session is malformed', 'protocol_error');
        observedSession ||= message.session_id;
        if (message.session_id !== observedSession || (expected && message.session_id !== expected))
          throw new RuntimeProviderError('Claude session identity drifted', 'protocol_error');
      }
      if (message.type === 'system' && message.subtype === 'init') {
        if (seenInit) throw new RuntimeProviderError('Claude emitted a second init', 'protocol_error');
        seenInit = true;
        // The subscription is only in use when no API key source is active; anything else is billed elsewhere.
        if (message.apiKeySource !== 'none')
          throw new RuntimeProviderError('Claude is not running on the subscription login', 'identity_unverified');
        if (
          !Array.isArray(message.tools) ||
          message.tools.length > 0 ||
          !Array.isArray(message.mcp_servers) ||
          message.mcp_servers.length > 0 ||
          message.permissionMode !== 'dontAsk' ||
          (expected_version !== undefined && message.claude_code_version !== expected_version)
        ) {
          on_event({ type: 'effect.attempted', effect: 'init-capability-drift' });
          throw new RuntimeProviderError('Claude init exposes capabilities', 'policy_denied');
        }
        // Fast mode bills as extra usage under a subscription; an absent state is recorded, not trusted.
        if (message.fast_mode_state !== undefined && message.fast_mode_state !== 'off')
          throw new RuntimeProviderError('Claude fast mode is not part of the subscription', 'policy_denied');
        // Aliases (opus, sonnet) resolve server-side; only a fully pinned id must match what init reports.
        if (/\d/.test(model) && typeof message.model === 'string' && !message.model.startsWith(model))
          throw new RuntimeProviderError('Claude selected a different model than pinned', 'policy_denied');
        initial = {
          model: typeof message.model === 'string' ? message.model.slice(0, 256) : null,
          fast_mode_state: typeof message.fast_mode_state === 'string' ? message.fast_mode_state : null,
        };
        return;
      }
      if (!seenInit) throw new RuntimeProviderError('Claude emitted output before init', 'protocol_error');
      if (message.type === 'system' && PASSIVE_SYSTEM_SUBTYPES.has(message.subtype)) return;
      if (message.type === 'rate_limit_event') {
        const info = message.rate_limit_info;
        if (!record(info) || !['allowed', 'allowed_warning', 'rejected'].includes(info.status))
          throw new RuntimeProviderError('Claude rate-limit event is malformed', 'protocol_error');
        // Extra usage is paid credit, never part of the subscription: refuse it without retrying.
        if (info.status === 'rejected' || info.errorCode === 'credits_required' || info.isUsingOverage === true)
          throw new RuntimeProviderError('Claude subscription quota is unavailable', 'quota_unavailable');
        if (info.status === 'allowed_warning') warnings.push(String(info.rateLimitType ?? 'unknown').slice(0, 64));
        return;
      }
      if (message.type === 'assistant') {
        if (!record(message.message) || !Array.isArray(message.message.content))
          throw new RuntimeProviderError('Claude assistant message is malformed', 'protocol_error');
        if (['rate_limit', 'billing_error'].includes(message.error))
          throw new RuntimeProviderError('Claude quota is unavailable', 'quota_unavailable');
        for (const block of message.message.content) {
          if (!record(block) || typeof block.type !== 'string')
            throw new RuntimeProviderError('Claude content block is malformed', 'protocol_error');
          if (!NON_EFFECT_CONTENT_TYPES.has(block.type)) {
            on_event({ type: 'effect.attempted', effect: block.type });
            throw new RuntimeProviderError('Claude attempted an effect', 'policy_denied');
          }
          if (block.type === 'text') {
            if (typeof block.text !== 'string') throw new RuntimeProviderError('Claude text block is malformed', 'protocol_error');
            if (block.text.length > 0) on_event({ type: 'message.delta', text: block.text });
          }
        }
        return;
      }
      if (message.type === 'result') {
        if (result) throw new RuntimeProviderError('Claude emitted a second result', 'protocol_error');
        if (message.errorCode === 'credits_required' || message.error_code === 'credits_required')
          throw new RuntimeProviderError('Claude subscription quota is unavailable', 'quota_unavailable');
        if (Array.isArray(message.permission_denials) && message.permission_denials.length > 0) {
          on_event({ type: 'effect.attempted', effect: 'permission-denial' });
          throw new RuntimeProviderError('Claude attempted an effect', 'policy_denied');
        }
        if (message.subtype === 'success' && message.is_error === false) {
          if (!record(message.usage)) throw new RuntimeProviderError('Claude result has no usage', 'protocol_error');
          result = { stop_reason: 'completed', usage: message.usage, model_usage: record(message.modelUsage) ? message.modelUsage : null };
          // total_cost_usd is a client-side estimate and is evidence only; it is never a monetary quantity.
          on_usage?.({
            usage: message.usage,
            model_usage: result.model_usage,
            estimated_cost_usd: typeof message.total_cost_usd === 'number' ? message.total_cost_usd : null,
          });
          return;
        }
        if (message.subtype === 'error_max_turns' || message.subtype === 'error_max_budget_usd') {
          result = { stop_reason: 'budget_exceeded' };
          return;
        }
        result = { stop_reason: 'refused' };
        return;
      }
      // user (tool results), stream_event and unknown system subtypes are not part of an instructions-only turn.
      on_event({ type: 'effect.attempted', effect: String(message.type).slice(0, 64) });
      throw new RuntimeProviderError('Claude emitted an unsupported message', 'protocol_error');
    };
    const consume = (line) => {
      if (line.length === 0 || failure) return;
      try {
        handle(JSON.parse(line));
      } catch (error) {
        fail(error instanceof RuntimeProviderError ? error : new RuntimeProviderError('Claude stream is malformed', 'protocol_error'));
      }
    };
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      pending += decoder.write(chunk);
      if (bytes > MAX_STREAM_BYTES || Buffer.byteLength(pending) > MAX_LINE_BYTES) {
        fail(new RuntimeProviderError('Claude output exceeds its limit', 'output_limit'));
        pending = '';
        return;
      }
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, index));
        pending = pending.slice(index + 1);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    const onAbort = () => {
      cancelled = true;
      void terminate();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => fail(new RuntimeProviderError('Claude run timed out', 'timeout')), timeout_ms);
    try {
      const code = await closed;
      consume((pending + decoder.end()).trim());
      if (cancelled) return { stop_reason: 'cancelled' };
      if (failure) throw failure;
      if (!result) throw new RuntimeProviderError('Claude stream ended without a result', 'protocol_error');
      if (code !== 0 && result.stop_reason === 'completed')
        throw new RuntimeProviderError('Claude exited unsuccessfully', 'provider_unavailable');
      return { ...result, session_id: observedSession, rate_limit_warnings: warnings, init: initial };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
}

module.exports = { ClaudeCliDriver, ENVIRONMENT_NAMES, ACCOUNT_AUTH_METHODS };
