'use strict';
// Pure planning pieces of the F14 v3 campaign: pre-registered plan, seeded schedule, cost and stop rules.
const { createHash } = require('node:crypto');
const { TASKS } = require('./tasks.cjs');
const { THRESHOLDS } = require('./stats.cjs');

const PLAN = Object.freeze({
  schema: 'f14v3-plan/1',
  registered_in: 'docs/evolution/w3/stab2/T4.md (F14 v3)',
  hypothesis:
    'Promoted memory delivered by the production agent run with source_db changes the task result, as judged by the protected tests.',
  model: 'gpt-4o-2024-08-06',
  tasks: TASKS.map((task) => ({
    id: task.id,
    file: task.file,
    project_id: task.project_id,
    memory_id: task.memory_id,
    protected_cases: task.cases.length,
  })),
  n_per_task_per_condition: 5,
  conditions: { control: 'box A: note written, NOT promoted', promoted: 'box B: same note promoted through the operator promotion API' },
  pilots: {
    per_task: 1,
    condition: 'control',
    rule: 'a pilot that passes the protected tests rejects the task; the series then cannot run',
  },
  series_runs: 30,
  total_runs: 33,
  seed: {
    drawn: 'at campaign start, from the OS entropy source',
    recorded_in: '<out>/seed.json',
    recorded_before_first_call: true,
    value: null,
  },
  order: 'per task a seeded Fisher-Yates shuffle of 5 control + 5 promoted runs; task order also shuffled; pilots first',
  analysis: {
    unit: 'task',
    test: 'exact conditional stratified (convolution of hypergeometrics), two-sided, p = sum of probabilities <= observed',
    pooled_fisher: 'forbidden',
    success: `in EVERY task promoted >= ${THRESHOLDS.promotedMin}/5 and control <= ${THRESHOLDS.controlMax}/5, AND p < ${THRESHOLDS.alpha}`,
    preregistered_examples: { '4/5 x 1/5 in all three': 0.0041, '3/5 x 1/5 in all three': 0.0708 },
  },
  budget: {
    ceiling_usd: 3,
    prior_spend_usd: 0.124,
    prior_spend_note:
      'attempt 1 (2026-11-07) spent US$ 0.124 and stopped on CONTROL_PROVIDER_BACKEND_DIVERGED; informational only, not part of this execution ceiling gate',
    stop_fraction: 0.8,
    price_usd_per_million: { in: 2.5, out: 10 },
    price_rule:
      'real mode needs --price-in and --price-out explicitly (finite, > 0) and equal to this registered price; otherwise it aborts before the first call. There is no built-in price for real mode',
    price_note: 'operator-declared USD per million tokens; cached input charged at the input price; an estimate, not an invoice',
    max_requests_per_run: 8,
    max_requests_note:
      'the rehearsal needs at most 5 requests per run (write, check, answer plus context); 8 leaves 3 of slack. A run that needs more fails as cap-reached instead of spending without a bound',
    per_request_check:
      'before each call: spent + worst-case projection (body bytes / 3 as tokens + max_tokens at the output price) > ceiling refuses the call',
    unreadable_usage:
      'the first request with unreadable usage ends the run as usage-unreadable and the campaign stops; the call is charged at the worst-case projection',
    interrupted_request:
      'a request cut by the 280 s timeout is charged with the declared context window as input plus max_tokens as output and is written to the request log',
    declared_context_tokens: 100_000,
  },
  confirmation: {
    env: 'F14V3_REAL_CONFIRMED',
    rule: 'real mode runs only when the variable equals the hash printed by `f14v3.cjs --print-confirmation`; otherwise BLOCKED before any call',
    covers:
      'this plan, the prices, the protected cases and the content of the scripts listed in confirmation.cjs (GATED_FILES); not the rehearsal results',
  },
  stop: 'failed series ends the campaign with no extra round; spend at 80% of the ceiling stops and reports',
  credential: 'read from an environment variable the operator provides at execution time; never from pass; never written or printed',
});

function makeRng(seed) {
  let state = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle(items, rng) {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

/** The whole series: 30 runs, deterministic from the seed. */
function buildSchedule(seed, tasks = PLAN.tasks.map((task) => task.id), n = PLAN.n_per_task_per_condition) {
  const rng = makeRng(seed);
  const schedule = [];
  for (const task of shuffle(tasks, rng)) {
    const cell = [];
    for (let rep = 1; rep <= n; rep += 1) cell.push({ task, condition: 'control' }, { task, condition: 'promoted' });
    for (const item of shuffle(cell, rng)) schedule.push(item);
  }
  const counter = new Map();
  return schedule.map((item, index) => {
    const key = `${item.task}/${item.condition}`;
    const rep = (counter.get(key) || 0) + 1;
    counter.set(key, rep);
    return { order: index + 1, ...item, rep };
  });
}

function costUsd(usage, { priceInPerMillion, priceOutPerMillion }) {
  return ((usage.prompt_tokens || 0) * priceInPerMillion + (usage.completion_tokens || 0) * priceOutPerMillion) / 1_000_000;
}

/** Stop rule: do not start another run once the spend reached the stop fraction of the ceiling. */
/** Worst-case cost of one call before it is sent: the real body size in approximate tokens (3 bytes each) plus max_tokens. */
function projectCallUsd(bodyBytes, maxTokens, { priceInPerMillion, priceOutPerMillion }) {
  return costUsd({ prompt_tokens: Math.ceil(bodyBytes / 3), completion_tokens: maxTokens }, { priceInPerMillion, priceOutPerMillion });
}

/** Cost charged to a request that never returned: the whole declared context as input plus max_tokens as output. */
function interruptedCallUsd(maxTokens, prices, contextTokens = PLAN.budget.declared_context_tokens) {
  return costUsd({ prompt_tokens: contextTokens, completion_tokens: maxTokens }, prices);
}

const isPositiveNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Real mode price: explicit, finite and positive, and equal to the registered one. Returns { ok, reason?, price? }. */
function validateRealPrice(priceIn, priceOut, registered = PLAN.budget.price_usd_per_million) {
  if (!isPositiveNumber(priceIn) || !isPositiveNumber(priceOut))
    return { ok: false, reason: 'price-invalid: --price-in and --price-out must be finite numbers > 0' };
  if (priceIn !== registered.in || priceOut !== registered.out)
    return { ok: false, reason: 'price-mismatch: differs from the price registered in PLAN.json' };
  return { ok: true, price: { in: priceIn, out: priceOut } };
}

function budgetDecision(spentUsd, { ceilingUsd = PLAN.budget.ceiling_usd, stopFraction = PLAN.budget.stop_fraction } = {}) {
  const limit = Math.round(ceilingUsd * stopFraction * 1e6) / 1e6;
  return { stop: spentUsd >= limit, spent_usd: spentUsd, stop_at_usd: limit, ceiling_usd: ceilingUsd };
}

module.exports = { projectCallUsd, interruptedCallUsd, validateRealPrice, PLAN, makeRng, shuffle, buildSchedule, costUsd, budgetDecision };
