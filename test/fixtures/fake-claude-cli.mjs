#!/usr/bin/env node
// Deterministic stand-in for the `claude` binary: `--version`, `auth status` and headless stream-json.
// Behaviour comes from ${HOME}/fake-mode.json because the driver forwards only an allowlisted environment.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const home = process.env.HOME;
const mode = JSON.parse(fs.readFileSync(path.join(home, 'fake-mode.json'), 'utf8'));
const argv = process.argv.slice(2);
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
};
fs.appendFileSync(
  path.join(home, 'fake-calls.jsonl'),
  `${JSON.stringify({ argv, env: Object.keys(process.env).sort(), cwd: process.cwd(), pid: process.pid })}\n`,
);

if (argv[0] === '--version') {
  process.stdout.write(`${mode.version ?? '2.1.296'} (Claude Code)\n`);
} else if (argv[0] === 'auth' && argv[1] === 'status') {
  if (mode.auth === null) process.exit(1);
  emit(mode.auth);
} else {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) prompt += chunk;
  const session = flag('--session-id') ?? flag('--resume') ?? randomUUID();
  const base = { session_id: session, uuid: randomUUID() };
  if (mode.run === 'stubborn' || mode.run === 'immortal') {
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => {});
  }
  if (mode.run === 'immortal') {
    // A grandchild in its own session and process group: no signal sent to the client or its group reaches it, so only a
    // kill of the whole cgroup does. The test reads its pid from this file.
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    grandchild.unref();
    fs.writeFileSync(path.join(home, 'grandchild.pid'), String(grandchild.pid));
  }
  emit({
    ...base,
    type: 'system',
    subtype: 'init',
    apiKeySource: mode.run === 'api_key' ? 'ANTHROPIC_API_KEY' : 'none',
    claude_code_version: mode.version ?? '2.1.296',
    tools: mode.run === 'tools_init' ? ['Bash'] : [],
    mcp_servers: [],
    permissionMode: 'dontAsk',
    model: flag('--model'),
    ...(mode.run === 'fast' ? { fast_mode_state: 'on' } : {}),
    ...(mode.run === 'model' ? { model: 'claude-other-1' } : {}),
  });
  if (!argv.includes('--no-session-persistence')) {
    const config = process.env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude');
    const directory = path.join(config, 'projects', fs.realpathSync(process.cwd()).replaceAll(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${session}.jsonl`), prompt);
  }
  if (mode.run === 'utf8') {
    const line = Buffer.from(`${JSON.stringify({ ...base, type: 'assistant', message: { content: [{ type: 'text', text: 'ação—日本語' }] } })}\n`);
    const cut = line.indexOf(Buffer.from('ç')) + 1;
    process.stdout.write(line.subarray(0, cut));
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.stdout.write(line.subarray(cut));
  }
  if (mode.run === 'stubborn' || mode.run === 'immortal') setInterval(() => {}, 1000);
  else {
    if (mode.run === 'big') for (let i = 0; i < 40; i++) emit({ ...base, type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(30_000) }] } });
    const status = { warning: 'allowed_warning', rejected: 'rejected' }[mode.run] ?? 'allowed';
    emit({
      ...base,
      type: 'rate_limit_event',
      rate_limit_info: {
        status,
        rateLimitType: 'five_hour',
        ...(mode.run === 'credits' ? { errorCode: 'credits_required' } : {}),
        ...(mode.run === 'overage' ? { isUsingOverage: true } : {}),
      },
    });
    if (mode.run === 'tool') emit({ ...base, type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } });
    if (mode.run === 'user') emit({ ...base, type: 'user', message: { content: [] } });
    emit({ ...base, type: 'assistant', message: { content: [{ type: 'text', text: mode.answer ?? `echo:${prompt.length}` }] } });
    emit({
      ...base,
      type: 'result',
      subtype: mode.run === 'error' ? 'error_during_execution' : 'success',
      is_error: mode.run === 'error',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: { [flag('--model') ?? 'm']: { inputTokens: 5, outputTokens: 2 } },
      total_cost_usd: 0.0001,
      permission_denials: [],
    });
  }
}
