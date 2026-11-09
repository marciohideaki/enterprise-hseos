'use strict';
// Scripted fake of an OpenAI-compatible chat model for the F15 L2 rehearsal. Pure: it reads a request body and returns an SSE
// `Response` plus synthetic usage. Nothing here touches a network. Everything it reads from a request is treated as data.
// Behaviors: `good` rewrites the module as asked; `mutilate` writes a file that passes the product verifier (`add` works) but
// deletes every other export (the mini-3 failure), so the whole-file check has to refuse it.
const { createHash } = require('node:crypto');

const sha = (value) => createHash('sha256').update(value).digest('hex');
const toolCallsOf = (message) => (message.role === 'assistant' && Array.isArray(message.tool_calls) ? message.tool_calls : []);
const nameOf = (call) => String(call.function?.name ?? '');
const argsOf = (call) => {
  try {
    return JSON.parse(call.function?.arguments || '{}');
  } catch {
    return {};
  }
};
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The tool result that answers one assistant call, matched by `tool_call_id`. */
function resultFor(messages, call) {
  return messages.find((message) => message.role === 'tool' && message.tool_call_id === call.id);
}

/** True when the history already holds the result of a write call. This is the crash trigger and the "after write" state. */
function wroteBefore(messages) {
  return messages.some((message) => toolCallsOf(message).some((call) => nameOf(call).endsWith('write') && resultFor(messages, call)));
}

/** Per tool result: was it pruned, does it still carry the file hash, how many bytes remain. No content is stored. */
function summarizeToolResults(messages) {
  const out = [];
  for (const message of messages) {
    for (const call of toolCallsOf(message)) {
      const result = resultFor(messages, call);
      if (!result) continue;
      const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      const parsed = parseJson(text);
      out.push({
        tool: nameOf(call).replace(/^.*[._-]/, ''),
        path: argsOf(call).path ?? null,
        pruned: parsed?.pruned === true,
        bytes: text.length,
        has_sha256: /"sha256"\s*:\s*"[a-f0-9]{64}"/.test(text),
      });
    }
  }
  return out;
}

/** Finds `{ content, sha256 }` of the newest read of `file` whose result is still verbatim; falls back to the newest hash seen. */
function latestRead(messages, file) {
  let verbatim = null;
  let hash = null;
  for (const message of messages) {
    for (const call of toolCallsOf(message)) {
      if (!nameOf(call).endsWith('read') || argsOf(call).path !== file) continue;
      const result = resultFor(messages, call);
      const text = typeof result?.content === 'string' ? result.content : '';
      const parsed = parseJson(text);
      const found = findFields(parsed);
      if (found.sha256) hash = found.sha256;
      if (found.content !== undefined && parsed?.pruned !== true) verbatim = { content: found.content, sha256: found.sha256 ?? hash };
    }
  }
  return { verbatim, hash };
}

function findFields(value, depth = 0) {
  const found = {};
  if (!value || typeof value !== 'object' || depth > 4) return found;
  if (typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)) found.sha256 = value.sha256;
  if (typeof value.content === 'string') found.content = value.content;
  for (const child of Object.values(value)) {
    const inner = findFields(child, depth + 1);
    found.sha256 ??= inner.sha256;
    found.content ??= inner.content;
  }
  return found;
}

const SUM_INTEGERS = `function sumIntegers(values) {
  assertNonEmptyList(values, 'values');
  let total = 0;
  for (const [index, value] of values.entries()) {
    total += assertInteger(value, describeOperand('values', index));
  }
  return total;
}

`;

/** Rewrites the module the way the change request asks. Pure string work on the text the model was shown. */
function goodContent(original) {
  let text = original.replace(/(function add\(a, b\) \{[\s\S]*?return )a - b;/, '$1a + b;');
  text = text.replace(
    "'use strict';\n",
    "'use strict';\n\nconst { assertInteger, assertNonEmptyList, describeOperand } = require('./guards.js');\n",
  );
  text = text.replace('module.exports = add;', `${SUM_INTEGERS}module.exports = add;`);
  return `${text.trimEnd()}\nmodule.exports.sumIntegers = sumIntegers;\n`;
}

const MUTILATED = `'use strict';

function add(a, b) {
  return a + b;
}

module.exports = add;
`;

const ENV_PROBE = `'use strict';
function add(a, b) {
  return a + b;
}
console.log(JSON.stringify({ key_type: typeof process.env.HSEOS_MODEL_PROVIDER_API_KEY, variables: Object.keys(process.env).length }));
module.exports = add;
`;

const sse = (frames) =>
  new Response(`${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

// The provider answers an ALIAS with the DATED snapshot it actually served (declared `gpt-4o`, answered `gpt-4o-2024-08-06`). The
// adapter's backend proof is strict and compares the name literally, so a campaign has to declare the dated name.
const SNAPSHOTS = Object.freeze({ 'gpt-4o': 'gpt-4o-2024-08-06', 'gpt-4o-mini': 'gpt-4o-mini-2024-07-18' });
const respondingModel = (requested) => SNAPSHOTS[requested] ?? requested;

const pieces = (text, parts = 3) => {
  const size = Math.max(1, Math.ceil(text.length / parts));
  return Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size));
};

function fakeModelResponse(body, { behavior, model, bodyBytes, fault }) {
  const messages = body.messages;
  const names = (body.tools || []).map((tool) => tool.function.name);
  const wire = (suffix) => names.find((name) => name.endsWith(suffix));
  const calls = messages.flatMap((message) => toolCallsOf(message));
  const readOf = (file) => calls.some((call) => nameOf(call).endsWith('read') && argsOf(call).path === file);
  const promptTokens = Math.ceil(bodyBytes / 4);
  // `model` here is what the request asked for (the declared name). What the provider answers in every frame is the served snapshot.
  const served = fault === 'diverge' ? 'gpt-4o-2024-11-20' : respondingModel(model);
  const chatId = `chatcmpl-${sha(`${bodyBytes}:${calls.length}`).slice(0, 24)}`;
  const frame = (extra) => ({
    id: chatId,
    object: 'chat.completion.chunk',
    created: 1_762_500_000,
    ...(fault === 'no-model' ? {} : { model: served }),
    service_tier: 'default',
    system_fingerprint: 'fp_f15l2rehearsal',
    ...extra,
  });
  const faulty = (frames) => {
    // Fault injection for the failure-path rehearsal: a body that is not SSE, or an SSE stream without a usage frame.
    if (fault === 'non-sse')
      return {
        response: new Response(JSON.stringify({ error: 'not a stream' }), { status: 200, headers: { 'content-type': 'application/json' } }),
        usage: null,
      };
    if (fault === 'no-usage') return { response: sse(frames), usage: null };
    return null;
  };
  // Like a real stream with include_usage: content chunks, a finish chunk with an empty delta, then a LAST frame with `choices: []` and usage.
  const reply = (frames, completionText) => {
    const completion = Math.ceil(completionText.length / 4);
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completion,
      total_tokens: promptTokens + completion,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
    };
    return (
      faulty(frames) ?? {
        response: sse([...frames, frame({ choices: [], usage })]),
        usage: { prompt_tokens: promptTokens, completion_tokens: completion, total_tokens: promptTokens + completion, cached_tokens: 0 },
      }
    );
  };
  const call = (suffix, args) => {
    const text = JSON.stringify(args);
    const id = `call_${sha(`${calls.length}:${text}`).slice(0, 12)}`;
    const toolCall = (extra) =>
      frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...extra }] }, logprobs: null, finish_reason: null }] });
    return reply(
      [
        // The first chunk names the call; the arguments then arrive in fragments, as a real stream sends them.
        frame({
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: null,
                tool_calls: [{ index: 0, id, type: 'function', function: { name: wire(suffix), arguments: '' } }],
              },
              logprobs: null,
              finish_reason: null,
            },
          ],
        }),
        ...pieces(text).map((piece) => toolCall({ function: { arguments: piece } })),
        frame({ choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: 'tool_calls' }] }),
      ],
      text,
    );
  };
  const text = (content) =>
    reply(
      [
        frame({ choices: [{ index: 0, delta: { role: 'assistant', content: '', refusal: null }, logprobs: null, finish_reason: null }] }),
        ...pieces(content, 2).map((piece) =>
          frame({ choices: [{ index: 0, delta: { content: piece }, logprobs: null, finish_reason: null }] }),
        ),
        frame({ choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: 'stop' }] }),
      ],
      content,
    );

  if (!readOf('add.js')) return call('read', { path: 'add.js' });
  if (!readOf('guards.js')) return call('read', { path: 'guards.js' });
  if (!calls.some((item) => nameOf(item).endsWith('write'))) {
    if (behavior === 'envprobe') {
      // Rehearsal-only: a file whose check prints only the TYPE of the credential variable and the NUMBER of variables it can see.
      const { hash } = latestRead(messages, 'add.js');
      return call('write', { path: 'add.js', expected_sha256: hash, content: ENV_PROBE });
    }
    if (behavior === 'mutilate') {
      const { hash } = latestRead(messages, 'add.js');
      return call('write', { path: 'add.js', expected_sha256: hash, content: MUTILATED });
    }
    const { verbatim } = latestRead(messages, 'add.js');
    if (!verbatim) return call('read', { path: 'add.js' });
    // A resumed turn may find the change already in the file: nothing to rewrite, go to the check.
    if (verbatim.content.includes('function sumIntegers')) {
      return calls.some((item) => nameOf(item).endsWith('command'))
        ? text('The change was already in the file and the check ran.')
        : call('command', { id: 'check' });
    }
    return call('write', { path: 'add.js', expected_sha256: verbatim.sha256, content: goodContent(verbatim.content) });
  }
  if (!calls.some((item) => nameOf(item).endsWith('command'))) return call('command', { id: 'check' });
  return text('The change request is done: add sums, sumIntegers uses the guards, and the check ran.');
}

module.exports = { respondingModel, SNAPSHOTS, fakeModelResponse, summarizeToolResults, wroteBefore, goodContent, MUTILATED, latestRead };
