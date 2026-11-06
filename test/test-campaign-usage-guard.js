'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { parseSse, sumUsage } = require('../docs/evolution/w3/evidence/shared/usage-from-sse.cjs');

const GUARD = path.join(__dirname, '../docs/evolution/w3/evidence/shared/fetch-guard.cjs');

// A response shaped like the real stream: `usage: null` in the early frames, and a final frame whose usage carries two nested detail objects.
const REAL_SHAPED = [
  { id: 'c1', model: 'gpt-4o-mini-2024-07-18', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }], usage: null },
  { id: 'c1', model: 'gpt-4o-mini-2024-07-18', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }], usage: null },
  { id: 'c1', model: 'gpt-4o-mini-2024-07-18', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: null },
  {
    id: 'c1',
    model: 'gpt-4o-mini-2024-07-18',
    choices: [],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 80,
      total_tokens: 1280,
      prompt_tokens_details: { cached_tokens: 1024, audio_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
    },
  },
]
  .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
  .join('')
  .concat('data: [DONE]\n\n');

test('the usage, the finish reason and the model are read from a real-shaped stream with nested detail objects', () => {
  const parsed = parseSse(REAL_SHAPED);
  assert.deepEqual(parsed.usage, { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280, cached_tokens: 1024 });
  assert.equal(parsed.finish, 'stop');
  assert.equal(parsed.model, 'gpt-4o-mini-2024-07-18');
  assert.equal(parsed.unparsed_frames, 0);
});

test('the regular expression the old guards used cannot read that stream, which is why the cost was never measured', () => {
  const old = [...REAL_SHAPED.matchAll(/"usage":(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/g)]
    .map((match) => match[1])
    .findLast((value) => !value.startsWith('null'));
  assert.throws(() => JSON.parse(old), SyntaxError);
});

test('a stream without usage is reported as null and a broken frame is counted, never invented', () => {
  assert.equal(parseSse('data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n').usage, null);
  assert.equal(parseSse('data: {not json}\n\ndata: [DONE]\n').unparsed_frames, 1);
  assert.deepEqual(parseSse(''), { usage: null, finish: null, model: null, unparsed_frames: 0 });
});

test('the sum counts a request without readable usage instead of treating it as zero, and prices only what the operator declared', () => {
  const ok = parseSse(REAL_SHAPED);
  const sum = sumUsage([{ usage: ok.usage }, { usage: ok.usage }, { usage: null }], { priceInPerMillion: 0.15, priceOutPerMillion: 0.6 });
  assert.equal(sum.requests, 3);
  assert.equal(sum.unreadable_requests, 1);
  assert.equal(sum.complete, false, 'a partial sum never claims to be the total');
  assert.equal(sum.prompt_tokens, 2400);
  assert.equal(sum.completion_tokens, 160);
  assert.ok(Math.abs(sum.estimated_cost_usd - (2400 * 0.15 + 160 * 0.6) / 1_000_000) < 1e-12);
  assert.equal(sumUsage([{ usage: ok.usage }]).estimated_cost_usd, null, 'no declared price, no cost');
  assert.equal(sumUsage([{ usage: ok.usage }]).complete, true);
});

test('the shared guard records the parsed usage of a real-shaped response in the request log', () => {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'usage-guard-'));
  try {
    const fake = path.join(directory, 'fake-fetch.cjs');
    fs.writeFileSync(
      fake,
      `const body = ${JSON.stringify(REAL_SHAPED)};\nglobalThis.fetch = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });\n`,
    );
    const driver = path.join(directory, 'driver.cjs');
    fs.writeFileSync(
      driver,
      "fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'x' }] }) }).then((r) => r.text()).then(() => undefined);\n",
    );
    const result = spawnSync(process.execPath, ['--require', fake, '--require', GUARD, driver], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR || os.tmpdir(),
        C9_MODE: 'real',
        C9_DIR: directory,
        C9_MAX_REQUESTS: '3',
        C9_DEADLINE_MS: String(Date.now() + 60_000),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const entries = fs
      .readFileSync(path.join(directory, 'provider-requests.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].usage, { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280, cached_tokens: 1024 });
    assert.equal(entries[0].responding_model, 'gpt-4o-mini-2024-07-18');
    assert.equal(entries[0].finish, 'stop');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
