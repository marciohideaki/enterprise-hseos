'use strict';
const { z } = require('zod');
const { createHash } = require('node:crypto');
const { canonicalJson } = require('../agent-session-store/replay');
const { RuntimeProviderError } = require('./acp-runtime-provider');
const text = z.string().min(1).max(4096);
const meta = z.record(z.string(), z.unknown()).nullish();
const marker = z.object({ _meta: meta }).strict().nullish();
const count = z.number().int().nonnegative().safe();
const usage = z
  .object({
    totalTokens: count,
    inputTokens: count,
    outputTokens: count,
    cachedReadTokens: count.optional(),
    cachedWriteTokens: count.optional(),
    thoughtTokens: count.optional(),
  })
  .strict();
const init = z
  .object({
    protocolVersion: z.literal(1),
    agentInfo: z
      .object({ name: z.literal('@agentclientprotocol/codex-acp'), title: text.optional(), version: z.literal('1.13.1'), _meta: meta })
      .strict(),
    agentCapabilities: z
      .object({
        loadSession: z.literal(true),
        providers: marker,
        auth: z.object({ logout: marker, _meta: meta }).strict().optional(),
        promptCapabilities: z
          .object({ image: z.boolean().optional(), audio: z.boolean().optional(), embeddedContext: z.boolean().optional(), _meta: meta })
          .strict()
          .optional(),
        mcpCapabilities: z
          .object({ acp: z.boolean().optional(), http: z.boolean().optional(), sse: z.boolean().optional(), _meta: meta })
          .strict()
          .optional(),
        sessionCapabilities: z
          .object(
            Object.fromEntries(['resume', 'list', 'close', 'delete', 'fork', 'additionalDirectories', 'subagents'].map((k) => [k, marker])),
          )
          .extend({ _meta: meta })
          .strict()
          .optional(),
        _meta: meta,
      })
      .strict(),
    authMethods: z
      .array(z.object({ id: z.literal('api-key'), name: text, description: text.optional(), _meta: meta }).strict())
      .max(1)
      .optional(),
    _meta: meta,
  })
  .strict();
const choice = z.object({ value: text, name: text, description: text.optional(), _meta: meta }).strict();
const configOption = z
  .object({
    id: text,
    name: text,
    description: text.optional(),
    category: text.optional(),
    type: z.literal('select'),
    currentValue: text,
    options: z.array(choice).max(256),
    _meta: meta,
  })
  .strict();
const mode = z.object({ id: text, name: text, description: text.optional(), _meta: meta }).strict();
const models = z
  .object({
    currentModelId: text,
    availableModels: z.array(z.object({ modelId: text, name: text, description: text.optional(), _meta: meta }).strict()).max(256),
    _meta: meta,
  })
  .strict();
const sessionState = z
  .object({
    sessionId: text.optional(),
    modes: z.object({ currentModeId: z.literal('read-only'), availableModes: z.array(mode).max(16), _meta: meta }).strict(),
    models: models.optional(),
    configOptions: z.array(configOption).max(16),
    _meta: meta,
  })
  .strict();
const updates = {
  available_commands_update: z
    .object({
      sessionUpdate: z.literal('available_commands_update'),
      availableCommands: z
        .array(z.object({ name: text, description: text, input: z.object({ hint: text }).strict().nullish(), _meta: meta }).strict())
        .max(256),
      _meta: meta,
    })
    .strict(),
  session_info_update: z
    .object({ sessionUpdate: z.literal('session_info_update'), title: text.nullish(), updatedAt: text.nullish(), _meta: meta })
    .strict(),
  usage_update: z
    .object({
      sessionUpdate: z.literal('usage_update'),
      used: count,
      size: count,
      cost: z.object({ amount: z.number().nonnegative().finite(), currency: text }).strict().optional(),
      _meta: meta,
    })
    .strict(),
};
function deny(message) {
  throw new RuntimeProviderError(message, 'policy_denied');
}
function parse(schema, value) {
  if (Buffer.byteLength(JSON.stringify(value)) > 262_144) deny('ACP profile payload exceeds its bound');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RuntimeProviderError('ACP profile rejected an unsupported shape', 'protocol_error');
  return parsed.data;
}
/** Version-specific metadata normalization. No authentication, configuration or tool operations are exposed. */
class CodexAcpPeer {
  constructor({ peer, model, verify, account_sha256 }) {
    if (!peer || typeof verify !== 'function' || !text.safeParse(model).success) deny('ACP profile configuration is invalid');
    if (!/^[a-f0-9]{64}$/.test(account_sha256)) deny('ACP account identity is required');
    this.accountSha256 = account_sha256;
    this.peer = peer;
    this.model = model;
    this.verify = verify;
    this.sessions = new Set();
    this.pending = null;
    this.usage = null;
    this.notifications = 0;
  }
  state(value, creating) {
    const state = parse(sessionState, value);
    if (creating !== (typeof state.sessionId === 'string')) deny('ACP session identity is malformed');
    const expected = { mode: 'read-only', collaboration_mode: 'default', model: this.model, reasoning_effort: 'low', 'fast-mode': 'off' };
    const selected = Object.fromEntries(state.configOptions.map((o) => [o.id, o.currentValue]));
    if (
      state.configOptions.length !== Object.keys(selected).length ||
      Object.keys(selected).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([k, v]) => selected[k] !== v)
    )
      deny('ACP configuration drift');
    if (state.models && state.models.currentModelId !== `${this.model}[low]`) deny('ACP model drift');
    return state;
  }
  async request(method, params) {
    await this.verify();
    if (!['initialize', 'session/new', 'session/load', 'session/prompt'].includes(method)) deny('ACP operation is not admitted');
    if (method === 'session/prompt') {
      if (
        !this.sessions.has(params.sessionId) ||
        !Array.isArray(params.prompt) ||
        params.prompt.length !== 1 ||
        params.prompt[0].type !== 'text' ||
        typeof params.prompt[0].text !== 'string' ||
        /^\s*[/$]/u.test(params.prompt[0].text)
      )
        deny('ACP command prompts are not admitted');
      this.usage = null;
    }
    const opening = method === 'session/new' || method === 'session/load';
    if (opening) {
      if (this.pending || this.sessions.size >= 128 || !Array.isArray(params.mcpServers) || params.mcpServers.length > 0)
        deny('ACP session configuration is not admitted');
      this.pending = new Set();
    }
    try {
      const result = await this.peer.request(method, params);
      if (method === 'initialize') {
        const validated = parse(init, result);
        // The host verifier proves preauthentication independently of advertised login methods.
        return { protocolVersion: 1, agentInfo: validated.agentInfo, agentCapabilities: { loadSession: true }, authMethods: [] };
      }
      if (opening) {
        const state = this.state(result, method === 'session/new');
        const id = state.sessionId || params.sessionId;
        if ([...this.pending].some((s) => s !== id)) deny('ACP metadata session mismatch');
        this.sessions.add(id);
        return method === 'session/new' ? { sessionId: id } : {};
      }
      const prompt = parse(
        z
          .object({
            stopReason: z.enum(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']),
            usage: usage.optional(),
            _meta: meta,
          })
          .strict(),
        result,
      );
      this.usage = prompt.usage ? Object.freeze({ ...prompt.usage }) : null;
      return { stopReason: prompt.stopReason };
    } finally {
      if (opening) this.pending = null;
    }
  }
  notify(method, params) {
    if (method !== 'session/cancel') deny('ACP notification is not admitted');
    return this.peer.notify(method, params);
  }
  subscribe(handlers) {
    return this.peer.subscribe({
      request: handlers.request,
      notification: (method, params) => {
        if (++this.notifications > 4096) deny('ACP profile notification bound exceeded');
        if (method === '_auth/status_update') {
          const status = parse(
            z
              .object({
                authStatus: z
                  .object({
                    kind: z.literal('account'),
                    label: text.optional(),
                    account: z.object({ email: text.optional(), plan: text.optional() }).strict().optional(),
                    _meta: meta,
                  })
                  .strict(),
              })
              .strict(),
            params,
          );
          if (
            status.authStatus.account?.email &&
            createHash('sha256')
              .update(canonicalJson({ type: 'chatgpt', email: status.authStatus.account.email }))
              .digest('hex') !== this.accountSha256
          )
            deny('ACP account identity changed');
          // Status is advisory; it never substitutes for the host identity/quota verifier.
          return;
        }
        const update = params?.update;
        if (method === 'session/update' && Object.hasOwn(updates, update?.sessionUpdate || '')) {
          parse(z.object({ sessionId: text, update: z.unknown(), _meta: meta }).strict(), params);
          parse(updates[update.sessionUpdate], update);
          if (!this.sessions.has(params.sessionId)) {
            if (!this.pending || (this.pending.size > 0 && !this.pending.has(params.sessionId))) deny('ACP metadata session mismatch');
            this.pending.add(params.sessionId);
          }
          return;
        }
        return handlers.notification(method, params);
      },
    });
  }
  close() {
    return this.peer.close();
  }
}
module.exports = { CodexAcpPeer };
