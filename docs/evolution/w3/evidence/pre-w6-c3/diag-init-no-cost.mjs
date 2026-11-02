// Free diagnostic: same SDK options as the driver, invalid key and an empty HOME (no login), so no model call can be billed.
import { randomUUID } from 'node:crypto';
const sdk = await import('/build/tmp/wc/c3/sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');
const controller = new AbortController();
setTimeout(() => controller.abort(), 45000);
const q = sdk.query({
  prompt: 'diagnostic only',
  options: {
    abortController: controller,
    allowedTools: [],
    cwd: '/build/tmp/wc/c3/diag-cwd',
    env: {
      HOME: '/build/tmp/wc/c3/diag-home',
      PATH: process.env.PATH,
      ANTHROPIC_API_KEY: 'sk-ant-api03-invalid-diagnostic-key-0000000000',
    },
    maxTurns: 1,
    model: 'claude-haiku-5-5',
    pathToClaudeCodeExecutable: '/home/annonymous/.local/share/claude/versions/2.1.316',
    permissionMode: 'plan',
    persistSession: true,
    settingSources: [],
    tools: [],
    sessionId: randomUUID(),
  },
});
try {
  for await (const m of q) {
    const o = { type: m.type, subtype: m.subtype };
    if (m.type === 'system' && m.subtype === 'init')
      Object.assign(o, {
        tools: m.tools,
        permissionMode: m.permissionMode,
        model: m.model,
        apiKeySource: m.apiKeySource,
        claude_code_version: m.claude_code_version,
        mcp_servers: m.mcp_servers,
      });
    if (m.type === 'result')
      Object.assign(o, {
        is_error: m.is_error,
        stop_reason: m.stop_reason,
        api_error_status: m.api_error_status,
        result: String(m.result ?? '').slice(0, 160),
        permission_denials: m.permission_denials,
        has_usage: !!m.usage,
      });
    if (m.type === 'assistant') o.blocks = (m.message?.content || []).map((b) => b.type);
    console.log(JSON.stringify(o));
  }
} catch (e) {
  console.log('stream-error', String(e.message).slice(0, 200));
} finally {
  q.close();
}
