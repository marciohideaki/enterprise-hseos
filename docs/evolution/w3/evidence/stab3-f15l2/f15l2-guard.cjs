'use strict';
// F15 L2 campaign preload. Runs in every `agent` CLI child. It is the only door to a model:
//  - fixture mode: answers `https://mock.invalid/` with a scripted fake model and REFUSES every other destination (no network at all);
//  - real mode: allows only `https://api.openai.com/`, and only when the owner's confirmation equals the campaign fingerprint.
// It counts and caps requests, kills the process just before the first request that follows a write result (the crash), controls the
// spend BEFORE each request (worst case of the real body plus the whole output cap) and never prints or stores a credential. A response
// that is not SSE or whose usage is unreadable stops the whole campaign at the first occurrence. Model output is data.
// DECLARED LIMIT: this guard wraps `fetch` only. Another network path (the http/https modules, WebSocket, a spawned `curl`) is not
// intercepted; the engineering commands run in the product's isolated executor and the Podman verifier runs with --network=none.
// env: F15L2_MODE=fixture|real, F15L2_DIR, F15L2_MAX_REQUESTS, F15L2_DEADLINE_MS, F15L2_CRASH_AFTER_WRITE=1,
//      F15L2_FAKE_BEHAVIOR=good|mutilate, F15L2_FAKE_FAULT=non-sse|no-usage|hang|diverge|no-model|no-model-journey,
//      F15L2_PLAN_SHA256 (the campaign fingerprint), F15L2_REAL_CONFIRMED,
//      budget: F15L2_SPEND_FILE, F15L2_STOP_FILE, F15L2_LIMIT_USD, F15L2_PRIOR_SPEND_USD, F15L2_PRICE_IN, F15L2_PRICE_OUT, F15L2_WINDOW_TOKENS, F15L2_MAX_OUT
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseSse } = require('../shared/usage-from-sse.cjs');
const { fakeModelResponse, summarizeToolResults, wroteBefore } = require('./f15l2-fake-model.cjs');
const lib = require('./f15l2-lib.cjs');

const dir = process.env.F15L2_DIR;
const mode = process.env.F15L2_MODE;
const max = Number(process.env.F15L2_MAX_REQUESTS || 0);
const counter = path.join(dir, 'request-count.txt');
const log = path.join(dir, 'provider-requests.jsonl');
const real = globalThis.fetch;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const FIXTURE_ORIGIN = 'https://mock.invalid/';
const REAL_ORIGIN = 'https://api.openai.com/';
// Test mode (F15L2_TEST_MODE=1 plus a base url): the ONLY destination becomes the local test server on 127.0.0.1; api.openai.com is refused.
// Outside the test mode the variable is ignored and the destination is fixed.
const TEST_MODE = process.env.F15L2_TEST_MODE === '1' && /^http:\/\/127\.0\.0\.1:\d{1,5}(\/|$)/.test(process.env.F15L2_TEST_BASE_URL || '');
const TEST_ORIGIN = TEST_MODE ? `${new URL(process.env.F15L2_TEST_BASE_URL).origin}/` : null;
const price = { in: Number(process.env.F15L2_PRICE_IN), out: Number(process.env.F15L2_PRICE_OUT) };
const spendFile = process.env.F15L2_SPEND_FILE;
const stopFile = process.env.F15L2_STOP_FILE;
const limitUsd = Number(process.env.F15L2_LIMIT_USD);
// Spent BEFORE this campaign (declared in the plan; 0 for F15). The ceiling is cumulative: prior + campaign spend + pending + worst case.
const priorUsd = Number(process.env.F15L2_PRIOR_SPEND_USD || 0);
const windowTokens = Number(process.env.F15L2_WINDOW_TOKENS);
const maxOut = Number(process.env.F15L2_MAX_OUT);

const realAllowed = () =>
  mode === 'real' && Boolean(process.env.F15L2_PLAN_SHA256) && process.env.F15L2_REAL_CONFIRMED === process.env.F15L2_PLAN_SHA256;

function safeHost(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return 'unparseable';
  }
}

function refuse(url, reason) {
  fs.appendFileSync(
    path.join(dir, 'refusals.jsonl'),
    `${JSON.stringify({ t: new Date().toISOString(), mode, reason, host: safeHost(url) })}\n`,
  );
  throw Object.assign(new Error(`F15L2_REAL_DESTINATION_REFUSED: ${reason}`), { code: 'F15L2_REAL_DESTINATION_REFUSED' });
}

const readCount = () => (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0);

function stopCampaign(reason, error, detail) {
  fs.writeFileSync(stopFile, JSON.stringify({ reason, detail: detail ?? null, t: new Date().toISOString() }), { mode: 0o600 });
  throw Object.assign(new Error(`F15L2_CAMPAIGN_STOPPED: ${reason}`), { code: error });
}

/** The spend is checked before the request leaves: nothing is sent if the worst case would pass the limit. */
function reserve(bodyBytes, maxTokens) {
  if (fs.existsSync(stopFile))
    throw Object.assign(new Error('F15L2_CAMPAIGN_STOPPED: stop file present'), { code: 'F15L2_CAMPAIGN_STOPPED' });
  const worst = lib.worstCaseUsd({ bodyBytes, maxTokens, price });
  const spend = lib.readSpend(spendFile);
  if (priorUsd + spend.spent_usd + spend.pending_usd + worst > limitUsd) {
    stopCampaign(
      'budget-pre-call',
      'F15L2_BUDGET_STOP',
      `prior ${priorUsd.toFixed(4)} + spent ${spend.spent_usd.toFixed(4)} + pending ${spend.pending_usd.toFixed(4)} + worst case ${worst.toFixed(4)} > ${limitUsd}`,
    );
  }
  lib.writeSpend(spendFile, { ...spend, pending_usd: spend.pending_usd + worst, calls: spend.calls + 1 });
  return worst;
}

function settle(worst, actual) {
  const spend = lib.readSpend(spendFile);
  lib.writeSpend(spendFile, { ...spend, pending_usd: Math.max(0, spend.pending_usd - worst), spent_usd: spend.spent_usd + actual });
}

/** Response that cannot be priced: book the pessimistic cost, stop the campaign. */
function unreadable(worst, reason) {
  settle(worst, lib.pessimisticUsd({ windowTokens, maxTokens: maxOut, price }));
  stopCampaign(reason, 'F15L2_USAGE_UNREADABLE');
}

globalThis.fetch = async (url, init) => {
  const target = String(url);
  const isFixture = target.startsWith(FIXTURE_ORIGIN);
  const isReal = TEST_MODE ? target.startsWith(TEST_ORIGIN) : target.startsWith(REAL_ORIGIN);
  if (mode === 'fixture' && !isFixture) refuse(url, 'fixture-mode-allows-only-the-fake-origin');
  if (mode === 'real' && !isReal) refuse(url, 'real-mode-allows-only-the-declared-origin');
  if (mode === 'real' && !realAllowed()) refuse(url, 'owner-confirmation-missing');
  if (mode !== 'fixture' && mode !== 'real') refuse(url, 'unknown-mode');
  const body = JSON.parse(init.body);
  if (process.env.F15L2_CRASH_AFTER_WRITE === '1' && wroteBefore(body.messages)) {
    fs.writeFileSync(
      path.join(dir, 'crash-record.json'),
      JSON.stringify({ pid: process.pid, killed_before_sending: true, trigger: 'first-request-after-a-write-result' }),
    );
    process.kill(process.pid, 'SIGKILL');
  }
  if (process.env.F15L2_DEADLINE_MS && Date.now() > Number(process.env.F15L2_DEADLINE_MS))
    throw Object.assign(new Error('F15L2_DEADLINE_EXPIRED'), { code: 'F15L2_DEADLINE_EXPIRED' });
  const total = readCount();
  if (max > 0 && total >= max) throw Object.assign(new Error('F15L2_REQUEST_CAP_REACHED'), { code: 'F15L2_REQUEST_CAP_REACHED' });
  const worst = reserve(init.body.length, body.max_tokens ?? maxOut);
  fs.writeFileSync(counter, String(total + 1));
  const entry = {
    n: total + 1,
    t: new Date().toISOString(),
    mode,
    origin: safeHost(url),
    model: body.model,
    messages: body.messages.length,
    tool_results: summarizeToolResults(body.messages),
    wire_names_valid: (body.tools || []).map((tool) => tool.function.name).every((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name)),
    max_tokens: body.max_tokens,
    body_sha256: sha(init.body),
    body_bytes: init.body.length,
    worst_case_usd: worst,
  };
  // `no-model-journey`: frames without a model only outside the reference run (the series proof must stop the campaign on its own).
  const fault =
    process.env.F15L2_FAKE_FAULT === 'no-model-journey'
      ? path.basename(dir) === 'reference'
        ? undefined
        : 'no-model'
      : process.env.F15L2_FAKE_FAULT;
  if (mode === 'fixture') {
    if (fault === 'hang') await new Promise(() => {}); // never answers: the CLI timeout must catch it, and the reservation stays booked
    const { response } = fakeModelResponse(body, {
      behavior: process.env.F15L2_FAKE_BEHAVIOR || 'good',
      model: body.model, // what the request declared; the fake answers with the served snapshot, as the provider does
      bodyBytes: init.body.length,
      fault,
    });
    entry.status = 200;
    entry.source = 'fixture';
    const parsed = parseSse(await response.clone().text());
    entry.responding_model = parsed.model;
    const isSse = (response.headers.get('content-type') || '').includes('text/event-stream');
    entry.usage = parsed.usage;
    fs.appendFileSync(log, `${JSON.stringify(entry)}\n`);
    const cost = isSse ? lib.usageUsd(parsed.usage, price) : null;
    if (cost === null) unreadable(worst, isSse ? 'usage-unreadable' : 'response-not-sse');
    settle(worst, cost);
    return response;
  }
  const result = await real(url, init);
  entry.status = result.status;
  entry.source = 'real';
  let cost = null;
  const isSse = (result.headers.get('content-type') || '').includes('text/event-stream');
  try {
    const parsed = parseSse(await result.clone().text());
    entry.usage = parsed.usage;
    entry.finish = parsed.finish;
    entry.responding_model = parsed.model;
    cost = isSse && result.status === 200 ? lib.usageUsd(parsed.usage, price) : null;
  } catch (error) {
    entry.usage = null;
    entry.usage_error = String(error.message).slice(0, 160);
  }
  fs.appendFileSync(log, `${JSON.stringify(entry)}\n`);
  if (cost === null) unreadable(worst, isSse && result.status === 200 ? 'usage-unreadable' : 'response-not-sse');
  settle(worst, cost);
  return result;
};
