'use strict';
// Preload of the F14 v3 campaign (`node --require guard.cjs ... hseos-cli.js agent run`). It counts, logs and answers the
// provider requests, and REFUSES any other destination. It never prints a credential.
// env: F14V3_MODE=mock|real, F14V3_OFFLINE=1 (real is refused outright), C9_DIR (log/counter dir), C9_MAX_REQUESTS (cap per run),
//      F14V3_PRICE_IN/OUT, F14V3_CEILING_USD, F14V3_SPENT_USD (spent before this run; the guard adds the run's own cost),
//      F14V3_MOCK_FAULT=nonsse|hang|zerousage (mock only: failure-path rehearsal)
// Coverage limit: this guard wraps the global `fetch` of the process that loads it. `node:https`/`node:http` and child processes are NOT covered.
// In mock mode the "model" follows the project rule only when the promoted note is in the context it receives.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseSse } = require('../shared/usage-from-sse.cjs');
const { TASKS } = require('./tasks.cjs');
const { projectCallUsd, costUsd } = require('./plan.cjs');

const dir = process.env.C9_DIR;
const mode = process.env.F14V3_MODE;
const max = Number(process.env.C9_MAX_REQUESTS || 8);
const prices = { priceInPerMillion: Number(process.env.F14V3_PRICE_IN), priceOutPerMillion: Number(process.env.F14V3_PRICE_OUT) };
const ceilingUsd = Number(process.env.F14V3_CEILING_USD);
const spentBeforeUsd = Number(process.env.F14V3_SPENT_USD || 0);
const inflight = path.join(dir, 'inflight.json');
const positive = (value) => Number.isFinite(value) && value > 0;
const fault = mode === 'mock' ? process.env.F14V3_MOCK_FAULT : undefined;
const counter = path.join(dir, 'request-count.txt');
const log = path.join(dir, 'provider-requests.jsonl');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const refuse = (code, url) =>
  Object.assign(
    new Error(
      `${code}: ${String(url)
        .replace(/[?#].*$/, '')
        .slice(0, 80)}`,
    ),
    { code },
  );
const REAL_PREFIX = 'https://api.openai.com/v1/';
const MOCK_PREFIX = 'https://mock.invalid/v1/';

const sse = (frames) =>
  new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const tokens = (value) => Math.ceil(String(value).length / 4);

function mockAnswer(body) {
  const messages = body.messages;
  const text = messages.map((message) => String(message.content ?? '')).join('\n');
  const task = TASKS.find((item) => text.includes(item.export));
  const promotedNoteInContext =
    Boolean(task) &&
    messages.some(
      (message) => String(message.content ?? '').startsWith('[HSEOS MEMORY_DATA') && String(message.content).includes(task.note),
    );
  const names = (body.tools || []).map((tool) => tool.function.name);
  const find = (suffix) => names.find((name) => name.endsWith(suffix));
  const tool = (name, args) => ({
    frame: {
      model: body.model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call_${sha(JSON.stringify(args)).slice(0, 8)}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    out: JSON.stringify(args),
  });
  const results = messages.filter((message) => message.role === 'tool');
  if (!task)
    return { frame: { model: body.model, choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] }, out: 'done' };
  if (results.length === 0)
    return tool(find('write'), {
      path: task.file,
      expected_sha256: sha(task.stub),
      content: promotedNoteInContext ? task.correct : task.naive,
    });
  if (results.length === 1) return tool(find('command'), { id: 'check' });
  return { frame: { model: body.model, choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] }, out: 'done' };
}

function carriesContent(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const delta = JSON.parse(line.slice(5).trim())?.choices?.[0]?.delta;
      if (
        (typeof delta?.content === 'string' && delta.content.length > 0) ||
        (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0)
      )
        return true;
    } catch {
      // A frame that is not JSON carries no content for this purpose.
      continue;
    }
  }
  return false;
}

const authorization = (init) => {
  const headers = init?.headers;
  if (!headers) return '';
  return typeof headers.get === 'function' ? headers.get('authorization') || '' : headers.Authorization || headers.authorization || '';
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  const isMock = target.startsWith(MOCK_PREFIX);
  const isReal = target.startsWith(REAL_PREFIX);
  if (!isMock && !isReal) throw refuse('F14V3_DESTINATION_REFUSED', target);
  if (isMock && mode !== 'mock') throw refuse('F14V3_DESTINATION_REFUSED', target);
  if (isReal && (mode !== 'real' || process.env.F14V3_OFFLINE === '1')) throw refuse('F14V3_REAL_DESTINATION_REFUSED', target);
  if (process.env.C9_DEADLINE_MS && Date.now() > Number(process.env.C9_DEADLINE_MS)) throw refuse('F14V3_DEADLINE_EXPIRED', target);
  const body = JSON.parse(init.body);
  // Fail closed inside the guard, whatever the caller validated: a price, the ceiling and max_tokens must be usable numbers.
  if (!positive(prices.priceInPerMillion) || !positive(prices.priceOutPerMillion)) throw refuse('F14V3_PRICE_INVALID', target);
  if (!positive(ceilingUsd) || !Number.isFinite(spentBeforeUsd)) throw refuse('F14V3_CEILING_INVALID', target);
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) throw refuse('F14V3_MAX_TOKENS_INVALID', target);
  const readLog = () =>
    fs.existsSync(log)
      ? fs
          .readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const runCost = readLog().reduce((sum, line) => sum + (line.cost_usd || 0), 0);
  const maxTokens = body.max_tokens;
  const projected = projectCallUsd(Buffer.byteLength(init.body), maxTokens, prices);
  if (!Number.isFinite(projected) || !Number.isFinite(ceilingUsd) || spentBeforeUsd + runCost + projected > ceilingUsd) {
    fs.appendFileSync(
      log,
      `${JSON.stringify({ refused: 'ceiling-projection', projected_usd: projected, spent_usd: spentBeforeUsd + runCost, ceiling_usd: ceilingUsd })}\n`,
    );
    throw refuse('F14V3_CEILING_PROJECTION', target);
  }
  const total = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  if (total >= max) throw refuse('F14V3_REQUEST_CAP_REACHED', target);
  fs.writeFileSync(counter, String(total + 1));
  const entry = {
    n: total + 1,
    t: new Date().toISOString(),
    mode,
    host: new URL(target).host,
    model: body.model,
    messages: body.messages.length,
    tool_names: (body.tools || []).map((tool) => tool.function.name),
    body_sha256: sha(init.body),
    body_bytes: init.body.length,
    max_tokens: maxTokens,
    projected_usd: projected,
    authorization_present: authorization(init).length > 0,
  };
  // Written BEFORE the call, removed after: a process killed mid-request leaves it for the campaign to charge.
  fs.writeFileSync(inflight, JSON.stringify({ n: entry.n, body_sha256: entry.body_sha256, max_tokens: maxTokens }));
  if (fault === 'hang') await new Promise(() => setTimeout(() => {}, 1_000_000_000));
  let response;
  if (isMock) {
    if (fault === 'zerousage') {
      const answer = mockAnswer(body);
      response = sse([answer.frame, { model: body.model, choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } }]);
    } else if (fault === 'nonsse') {
      response = new Response('{"error":"not an event stream"}', { status: 200, headers: { 'content-type': 'application/json' } });
    } else {
      const answer = mockAnswer(body);
      const usage = {
        prompt_tokens: tokens(init.body),
        completion_tokens: tokens(answer.out) + 8,
        prompt_tokens_details: { cached_tokens: 0 },
      };
      response = sse([answer.frame, { model: body.model, choices: [], usage }]);
    }
  } else {
    response = await realFetch(url, init);
  }
  entry.status = response.status;
  try {
    const text = await response.clone().text();
    if (!isMock)
      fs.appendFileSync(path.join(dir, 'raw-sse.txt'), `--- request ${entry.n} status ${response.status}\n${text}\n`, { mode: 0o600 });
    const parsed = parseSse(text);
    entry.usage = parsed.usage;
    entry.finish = parsed.finish;
    entry.carried_content = carriesContent(text);
    entry.responding_model = parsed.model;
    if (parsed.unparsed_frames > 0) entry.unparsed_frames = parsed.unparsed_frames;
  } catch (error) {
    entry.usage = null;
    entry.usage_error = String(error.message).slice(0, 160);
  }
  // Zero tokens in and out on a response that carries content is not a measurement: treated as unreadable.
  const zeroWithContent = entry.usage?.prompt_tokens === 0 && entry.usage?.completion_tokens === 0 && entry.carried_content === true;
  const readable = entry.usage && entry.usage.prompt_tokens !== null && entry.usage.completion_tokens !== null && !zeroWithContent;
  entry.cost_usd = readable ? costUsd(entry.usage, prices) : projected;
  if (!readable) entry.usage_unreadable = true;
  fs.rmSync(inflight, { force: true });
  fs.appendFileSync(log, `${JSON.stringify(entry)}\n`);
  // Fail closed: a response whose usage cannot be read ends the run; the campaign stops on the same entry.
  if (!readable) throw refuse('F14V3_USAGE_UNREADABLE', target);
  return response;
};
