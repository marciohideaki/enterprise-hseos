import fs from 'node:fs';
import path from 'node:path';

function remotePath(options = {}) {
  return options.env?.HSEOS_CLAUDE_TEST_REMOTE || process.env.HSEOS_CLAUDE_TEST_REMOTE;
}

function readState(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { sessions: {}, queries: 0 };
  }
}

function writeState(filename, state) {
  fs.writeFileSync(filename, `${JSON.stringify(state, null, 2)}\n`);
}

// `bulk:<kind>:<bytes>` yields output of an exact UTF-8 size whose JSON escaping is worst-case (control) or heavy (quotes).
function bulkText(prompt) {
  const match = /^bulk:(quotes|control|ascii|multibyte):(\d+)$/.exec(prompt);
  if (!match) return undefined;
  const bytes = Number(match[2]);
  if (match[1] === 'multibyte') return '€'.repeat(Math.floor(bytes / 3)) + 'x'.repeat(bytes % 3);
  const unit = { quotes: '"', control: '\u0001', ascii: 'a' }[match[1]];
  return unit.repeat(bytes);
}

export async function getSessionInfo(sessionId, { dir } = {}) {
  const filename = remotePath() || (dir ? path.join(dir, 'claude.json') : undefined);
  if (!filename) return undefined;
  const state = readState(filename);
  return state.sessions[sessionId] ? { sessionId, summary: 'fixture' } : undefined;
}

export function query({ prompt, options }) {
  let closed = false;
  const sessionId = options.sessionId || options.resume;
  const mode = options.sessionId ? 'new' : 'resume';
  return {
    close() {
      closed = true;
    },
    async *[Symbol.asyncIterator]() {
      const filename = remotePath(options);
      if (!filename) throw new Error('missing fixture remote path');
      const state = readState(filename);
      state.queries += 1;
      state.sessions[sessionId] = {
        mode,
        prompt,
        selected_environment_received: options.env?.HSEOS_CLAUDE_TEST_VALUE === 'selected-runtime-value',
        executable: options.pathToClaudeCodeExecutable,
        isolated:
          Array.isArray(options.allowedTools) &&
          options.allowedTools.length === 0 &&
          Array.isArray(options.tools) &&
          options.tools.length === 0 &&
          Array.isArray(options.settingSources) &&
          options.settingSources.length === 0 &&
          options.permissionMode === 'plan' &&
          options.maxTurns === 1,
      };
      writeState(filename, state);
      yield {
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        tools: options.tools,
        permissionMode: options.permissionMode,
      };
      yield {
        type: 'rate_limit_event',
        session_id: sessionId,
        rate_limit_info: { status: 'allowed' },
      };
      yield {
        type: 'system',
        subtype: prompt === 'unknown-system' ? 'unknown_progress' : 'thinking_tokens',
        session_id: prompt === 'thinking-foreign' ? 'foreign-session' : sessionId,
        estimated_tokens: 123,
        estimated_tokens_delta: prompt === 'thinking-invalid' ? -1 : 123,
      };
      if (prompt === 'wait') {
        while (!options.abortController.signal.aborted && !closed) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        return;
      }
      const content =
        prompt === 'effect'
          ? [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }]
          : prompt === 'unknown-effect'
            ? [{ type: 'future_capability', payload: {} }]
            : [{ type: 'thinking', thinking: 'fixture reasoning' }, { type: 'text', text: bulkText(prompt) ?? 'fixture answer' }];
      yield { type: 'assistant', session_id: sessionId, message: { content } };
      yield {
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 5, output_tokens: 2 },
        total_cost_usd: 0.0001,
        is_error: false,
        permission_denials: [],
        session_id: sessionId,
      };
    },
  };
}
