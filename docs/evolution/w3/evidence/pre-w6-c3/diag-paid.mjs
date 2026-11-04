// Authorized diagnostic (owner, 2026-11-02): ONE real call, same SDK options as the driver, empty HOME (no login), budget <= USD 0.25.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const key = execFileSync('pass', ['show', 'claude/anthropic-api-key'], { encoding: 'utf8' }).trim();
const sdk = await import('/build/tmp/wc/c3/sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');
const controller = new AbortController();
setTimeout(() => controller.abort(), 90_000);
const prompt =
  'Teste de continuidade HSEOS. Nao use ferramentas, nao leia arquivos e nao execute comandos. Se esta for a primeira mensagem desta conversa, responda exatamente {"value":42,"phase":"initial"}. Se esta conversa ja tiver uma resposta sua anterior, responda exatamente {"value":43,"phase":"resumed"}. Nao use markdown nem acrescente explicacoes.';
const q = sdk.query({
  prompt,
  options: {
    abortController: controller,
    allowedTools: [],
    cwd: '/build/tmp/wc/c3/diag-cwd',
    env: { HOME: '/build/tmp/wc/c3/diag-home', PATH: process.env.PATH, ANTHROPIC_API_KEY: key, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1024' },
    maxTurns: 1,
    maxBudgetUsd: 0.25,
    model: 'claude-haiku-5-5',
    pathToClaudeCodeExecutable: '/home/annonymous/.local/share/claude/versions/2.1.316',
    permissionMode: 'plan',
    persistSession: true,
    settingSources: [],
    tools: [],
    sessionId: randomUUID(),
  },
});
const redact = (t) =>
  String(t ?? '')
    .split(key)
    .join('<key>')
    .slice(0, 300);
try {
  for await (const m of q) {
    const o = { type: m.type, subtype: m.subtype };
    if (m.type === 'system' && m.subtype === 'init')
      Object.assign(o, { tools: m.tools, permissionMode: m.permissionMode, model: m.model, apiKeySource: m.apiKeySource });
    if (m.type === 'assistant')
      o.blocks = (m.message?.content || []).map((b) => (b.type === 'text' ? { type: 'text', text: redact(b.text) } : { type: b.type }));
    if (m.type === 'result')
      Object.assign(o, {
        is_error: m.is_error,
        stop_reason: m.stop_reason,
        api_error_status: m.api_error_status,
        result: redact(m.result),
        permission_denials: m.permission_denials,
        num_turns: m.num_turns,
        total_cost_usd: m.total_cost_usd,
        usage: m.usage && {
          input_tokens: m.usage.input_tokens,
          output_tokens: m.usage.output_tokens,
          cache_creation_input_tokens: m.usage.cache_creation_input_tokens,
          cache_read_input_tokens: m.usage.cache_read_input_tokens,
        },
        model_usage: m.modelUsage && Object.keys(m.modelUsage),
      });
    console.log(JSON.stringify(o));
  }
} catch (error) {
  console.log('stream-error', redact(error.message));
} finally {
  q.close();
}
