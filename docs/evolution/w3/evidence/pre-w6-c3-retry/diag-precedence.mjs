// Free diagnostic: with the REAL HOME (subscription login present) and an INVALID ANTHROPIC_API_KEY, which credential does the client select?
// The init message is emitted before any model call; an invalid key cannot be billed. persistSession is false here to avoid writing a session into the real HOME.
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
    env: { HOME: process.env.HOME, PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-ant-api03-invalid-diagnostic-key-0000000000' },
    maxTurns: 1,
    model: 'claude-haiku-5-5',
    pathToClaudeCodeExecutable: '/home/annonymous/.local/share/claude/versions/2.1.316',
    permissionMode: 'plan',
    persistSession: false,
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
      });
    if (m.type === 'result')
      Object.assign(o, {
        is_error: m.is_error,
        api_error_status: m.api_error_status,
        result: String(m.result ?? '').slice(0, 120),
        total_cost_usd: m.total_cost_usd,
        model_usage: m.modelUsage && Object.keys(m.modelUsage),
      });
    console.log(JSON.stringify(o));
  }
} catch (e) {
  console.log('stream-error', String(e.message).slice(0, 160));
} finally {
  q.close();
}
