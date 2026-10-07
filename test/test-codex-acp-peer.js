'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexAcpPeer } = require('../packages/runtime-providers/codex-acp-peer');
const { restrictedConfig, startupArgs } = require('../packages/runtime-providers/codex-acp-composition');
const init = {
  protocolVersion: 1,
  agentInfo: { name: '@agentclientprotocol/codex-acp', version: '1.13.1' },
  agentCapabilities: {
    loadSession: true,
    providers: {},
    auth: { logout: {} },
    mcpCapabilities: { acp: false, http: true, sse: false },
    sessionCapabilities: { fork: {}, subagents: {} },
  },
  authMethods: [{ id: 'api-key', name: 'API Key' }],
};
const session = {
  sessionId: 'acp-session',
  modes: { currentModeId: 'read-only', availableModes: [] },
  configOptions: Object.entries({
    mode: 'read-only',
    collaboration_mode: 'default',
    model: 'gpt-6-astra',
    reasoning_effort: 'low',
    'fast-mode': 'off',
  }).map(([id, currentValue]) => ({ id, name: id, type: 'select', currentValue, options: [] })),
};
function fixture(overrides = {}) {
  let handlers;
  const calls = [];
  let expire = false;
  const delivered = [];
  const raw = {
    async request(m, p) {
      calls.push(m);
      if (m === 'initialize') return structuredClone(init);
      if (m === 'session/new') {
        handlers.notification('session/update', {
          sessionId: 'acp-session',
          update: { sessionUpdate: 'available_commands_update', availableCommands: [] },
        });
        return structuredClone(session);
      }
      if (m === 'session/load') return { ...structuredClone(session), sessionId: undefined };
      return { stopReason: 'end_turn', usage: { totalTokens: 4, inputTokens: 3, outputTokens: 1 } };
    },
    notify(m) {
      calls.push(m);
    },
    subscribe(h) {
      handlers = h;
      return () => {};
    },
    close() {},
    ...overrides,
  };
  const peer = new CodexAcpPeer({
    peer: raw,
    model: 'gpt-6-astra',
    verify: () => {
      if (expire) throw new Error('expired');
    },
    account_sha256: 'a'.repeat(64),
  });
  peer.subscribe({
    notification: (m, p) => delivered.push([m, p]),
    request: () => {
      throw new Error('denied');
    },
  });
  return {
    peer,
    calls,
    delivered,
    emit: (m, p) => handlers.notification(m, p),
    expire: () => {
      expire = true;
    },
  };
}
test('pinned ACP profile negotiates known advertisements without enabling those operations', async () => {
  const f = fixture();
  const result = await f.peer.request('initialize', {});
  assert.deepEqual(result.agentCapabilities, { loadSession: true });
  assert.deepEqual(result.authMethods, []);
  assert.deepEqual(await f.peer.request('session/new', { mcpServers: [] }), { sessionId: 'acp-session' });
  for (const method of ['authenticate', 'session/set_mode', 'session/set_config_option', '_providers/update', 'session/fork'])
    await assert.rejects(f.peer.request(method, {}));
  for (const command of ['/logout', '  /review', '$skill'])
    await assert.rejects(f.peer.request('session/prompt', { sessionId: 'acp-session', prompt: [{ type: 'text', text: command }] }));
  assert.deepEqual(f.calls, ['initialize', 'session/new']);
});
test('unknown capabilities and versions fail closed', async () => {
  for (const value of [
    { ...init, agentCapabilities: { ...init.agentCapabilities, unknown: {} } },
    { ...init, agentInfo: { ...init.agentInfo, version: '1.14.0' } },
  ])
    await assert.rejects(fixture({ request: async () => value }).peer.request('initialize', {}));
});
test('mode or model drift fails before prompt; unsolicited metadata is rejected', async () => {
  await assert.rejects(
    fixture({ request: async () => ({ ...session, modes: { ...session.modes, currentModeId: 'agent-full-access' } }) }).peer.request(
      'session/new',
      { mcpServers: [] },
    ),
  );
  await assert.rejects(
    fixture({ request: async () => ({ ...session, configOptions: session.configOptions.slice(1) }) }).peer.request('session/new', {
      mcpServers: [],
    }),
  );
  const f = fixture();
  assert.throws(() => f.emit('session/update', { sessionId: 'alien', update: { sessionUpdate: 'usage_update', used: 1, size: 2 } }));
});
test('usage is bounded and tools pass through to the denying generic L0 bridge', async () => {
  const f = fixture();
  await f.peer.request('session/new', { mcpServers: [] });
  await f.peer.request('session/prompt', { sessionId: 'acp-session', prompt: [{ type: 'text', text: 'READY' }] });
  assert.deepEqual(f.peer.usage, { totalTokens: 4, inputTokens: 3, outputTokens: 1 });
  f.emit('session/update', { sessionId: 'acp-session', update: { sessionUpdate: 'tool_call', toolCallId: 'bad' } });
  assert.equal(f.delivered.length, 1);
  assert.throws(() => f.emit('session/update', { sessionId: 'acp-session', update: { sessionUpdate: 'usage_update', used: -1, size: 2 } }));
});
test('expiry denies new work while cancellation remains possible; paid auth changes denied', async () => {
  const f = fixture();
  f.expire();
  await assert.rejects(f.peer.request('initialize', {}), /expired/);
  f.peer.notify('session/cancel', { sessionId: 'acp-session' });
  assert.deepEqual(f.calls, ['session/cancel']);
  assert.throws(() => f.emit('_auth/status_update', { authStatus: { kind: 'api_key', label: 'API' } }));
  assert.throws(() => f.emit('_auth/status_update', { authStatus: { kind: 'account', account: { email: 'different@example.test' } } }));
});
test('startup profile disables tool sources and pins catalog before app-server starts', () => {
  const config = restrictedConfig({ model: 'gpt-6-astra', catalog: '/private/catalog.json' });
  for (const key of ['shell_tool', 'view_image', 'multi_agent', 'multi_agent_v2', 'token_budget', 'sleep_tool', 'apps', 'plugins'])
    assert.equal(config.features[key], false);
  assert.equal(config.tools.experimental_request_user_input.enabled, false);
  assert.equal(config.forced_login_method, 'chatgpt');
  assert.equal(config.web_search, 'disabled');
  assert.ok(startupArgs(config).includes('model_catalog_json="/private/catalog.json"'));
});

test('ACP campaign accounts cached input and rejects inconsistent native totals', () => {
  const { normalizeAcpUsage } = require('../tools/cli/lib/provider-acp-adapter');
  assert.deepEqual(normalizeAcpUsage({ totalTokens: 6055, inputTokens: 2082, cachedReadTokens: 3968, outputTokens: 5, thoughtTokens: 0 }), {
    input_tokens: 6050,
    output_tokens: 5,
  });
  assert.throws(() => normalizeAcpUsage({ totalTokens: 10, inputTokens: 8, cachedReadTokens: 3, outputTokens: 2 }));
  assert.throws(() => normalizeAcpUsage({ totalTokens: 10, inputTokens: 8, outputTokens: 2, thoughtTokens: 3 }));
});

test('catalog cannot re-enable tools through model metadata despite disabled feature flags', () => {
  const { validateRestrictedCatalog } = require('../packages/runtime-providers/codex-acp-composition');
  const model = {
    slug: 'pinned',
    apply_patch_tool_type: null,
    shell_type: 'disabled',
    supports_search_tool: false,
    tool_mode: 'direct',
    node_repl_disabled: true,
    multi_agent_version: null,
    multi_agent_reasoning_effort: null,
    experimental_supported_tools: [],
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false,
    include_apps_usage_instructions: false,
  };
  validateRestrictedCatalog({ models: [model] }, 'pinned');
  for (const patch of [
    { apply_patch_tool_type: 'freeform' },
    { shell_type: 'unified_exec' },
    { tool_mode: 'code_mode_only' },
    { multi_agent_version: 'v2' },
    { experimental_supported_tools: ['clock'] },
    { supports_search_tool: true },
    { include_apps_usage_instructions: true },
  ])
    assert.throws(() => validateRestrictedCatalog({ models: [{ ...model, ...patch }] }, 'pinned'));
  assert.throws(() => validateRestrictedCatalog({ models: [model, model] }, 'pinned'));
});

test('private cwd cannot inherit ancestor configuration or tools', (t) => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const { validateRestrictedDirectories } = require('../packages/runtime-providers/codex-acp-composition');
  const root = fs.mkdtempSync(path.join(require('./helpers/codex-free-tmpdir').codexFreeTmpdir(), 'acp-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'),
    cwd = path.join(root, 'cwd');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(cwd, { mode: 0o700 });
  validateRestrictedDirectories(home, cwd);
  fs.mkdirSync(path.join(root, '.codex'));
  assert.throws(() => validateRestrictedDirectories(home, cwd));
  fs.rmSync(path.join(root, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.toml'), '[mcp_servers.untrusted]\ncommand="unexpected"');
  assert.throws(() => validateRestrictedDirectories(home, cwd));
});

test('ACP session lifecycle enforces metadata identities, shape bounds and cancellation-only notifications', async () => {
  assert.throws(() => new CodexAcpPeer({ peer: {}, model: '', verify() {}, account_sha256: 'a'.repeat(64) }));
  assert.throws(() => new CodexAcpPeer({ peer: {}, model: 'pinned', verify() {}, account_sha256: 'bad' }));
  const f = fixture();
  await f.peer.request('session/load', { sessionId: 'loaded', mcpServers: [] });
  assert.deepEqual(await f.peer.request('session/prompt', { sessionId: 'loaded', prompt: [{ type: 'text', text: 'hello' }] }), {
    stopReason: 'end_turn',
  });
  f.emit('_auth/status_update', { authStatus: { kind: 'account' } });
  f.emit('_auth/status_update', { authStatus: { kind: 'account', account: { plan: 'fixture' } } });
  f.emit('session/update', { sessionId: 'loaded', update: { sessionUpdate: 'session_info_update', title: 'fixture' } });
  assert.throws(() => f.peer.notify('authenticate', {}));
  for (const prompt of [[], [{ type: 'image' }], [{ type: 'text', text: 5 }]])
    await assert.rejects(f.peer.request('session/prompt', { sessionId: 'loaded', prompt }));
  await assert.rejects(f.peer.request('session/new', { mcpServers: [{}] }));
  f.peer.close();
  for (const result of [
    { ...session, sessionId: undefined },
    { ...session, models: { currentModelId: 'wrong', availableModels: [] } },
    { ...session, configOptions: [...session.configOptions, session.configOptions[0]] },
    { ...session, _meta: { oversized: 'x'.repeat(262_145) } },
  ])
    await assert.rejects(fixture({ request: async () => result }).peer.request('session/new', { mcpServers: [] }));
  const noUsage = fixture({
    request: async (method) => (method === 'session/new' ? structuredClone(session) : { stopReason: 'cancelled' }),
  });
  await noUsage.peer.request('session/new', { mcpServers: [] });
  await noUsage.peer.request('session/prompt', { sessionId: 'acp-session', prompt: [{ type: 'text', text: 'hello' }] });
  assert.equal(noUsage.peer.usage, null);
  for (let i = 0; i < 4096; i++) noUsage.emit('known_generic_notification', {});
  assert.throws(() => noUsage.emit('known_generic_notification', {}));
});

test('ACP cannot overlap openings, retain a failed pending session or accept metadata for another opening', async () => {
  let resolve;
  const f = fixture({
    request: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const opening = f.peer.request('session/new', { mcpServers: [] });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(f.peer.request('session/new', { mcpServers: [] }));
  f.emit('session/update', { sessionId: 'one', update: { sessionUpdate: 'available_commands_update', availableCommands: [] } });
  assert.throws(() =>
    f.emit('session/update', { sessionId: 'two', update: { sessionUpdate: 'available_commands_update', availableCommands: [] } }),
  );
  resolve(structuredClone(session));
  await assert.rejects(opening);
  assert.equal(f.peer.pending, null);
  f.peer.sessions = new Set(Array.from({ length: 128 }, (_, i) => String(i)));
  await assert.rejects(f.peer.request('session/new', { mcpServers: [] }));
});
