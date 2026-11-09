'use strict';
// Pure planning pieces of the F14 v4 campaign: pre-registered plan, seeded schedule, cost and stop rules.
// Protocol (approved by the owner on 2026-11-09): docs/evolution/w3/stab2/F14-V4-PROTOCOL.md, sections 3 to 9.
const { createHash } = require('node:crypto');
const { TASKS } = require('./tasks.cjs');
const { THRESHOLDS } = require('../stab3-f14v3/stats.cjs');

const sha = (value) => createHash('sha256').update(value).digest('hex');

const LIMITS_DECLARED = Object.freeze({
  real_path_never_exercised:
    'The real path (network, the key, `hseos memory promote` in a TTY) was never exercised by this script: no real call, no real key and no TTY promotion took place while it was written or tested.',
  rehearsal_scope:
    'The rehearsal uses a programmed fake model and only proves the plumbing (boxes, retrieval, meter, receipts, stop rules); it says nothing about what the real model does.',
  credit_declared_not_verified: 'The credit (--credit-usd) is declared by the operator from the console; the script does not verify it.',
  cost_is_estimate:
    'The cost against the US$ 3.00 ceiling is the script estimate from the declared price (no cache discount), not an invoice.',
  failure_paths_covered: [
    'response that is not an event stream (usage unreadable)',
    'zero usage with content',
    'request cut by the timeout (stops at the first occurrence)',
    'per-request cumulative ceiling projection',
    'wall-clock limit',
    'request cap reached (original proof kept, counted apart)',
    'observed model or origin diverging from the declared one',
    'count-independent proof checks failing on a capped run',
    'secret in the database copy',
    'promotions missing, edited manifest, wrong sha256, wrong operator, control box altered or promoted',
    'note not deliverable by retrieval',
    'missing or wrong confirmation, price, credit, key, relative root, heavy-run ancestor or unreadable process ancestry',
  ],
  failure_paths_not_covered: [
    'real provider HTTP errors (4xx, 5xx, 429 rate limit) and network or DNS failure',
    'a stream truncated in the middle of an event',
    'key revoked or credit exhausted in the middle of the campaign',
    'the provider changing the model behind the same dated name',
    'the campaign process killed (SIGKILL) in the middle of a run, and any resume',
    'disk full',
    'the interactive `hseos memory promote` flow itself (TTY, confirmation prompt)',
    'divergence between the script estimate and the console cost',
  ],
  product_files_static:
    'PRODUCT_FILES is a static list derived from an execution trace in a fixture run, not recomputed. 9 files reachable by a static require from hseos-cli.js are not in it (governed-action, entrypoint-adapters, agent-environment/dap, dap-host, framing, browser-contract, legacy-mcp-server, mcp-transport, mcp-protocol), probably lazy requires outside the agent run path; this is not proved.',
  hash_fail_closed_files:
    'package.json and tools/cli/command-manifest.json are in the hash, so changing either invalidates the confirmation (fail-closed).',
  hash_not_covered:
    'The hash does not cover node_modules, the Node version or the content of the real project.db (only the sha256 of its copy is recorded).',
  heavy_run_detection:
    'The heavy-run detection is a regex over the process command line and can wrongly BLOCK a legitimate run (BLOCKED with no cost).',
  promoted_id_format:
    'The format of the promoted_id written by `hseos memory promote` in a real TTY was not exercised; verify-promotions expects `<memory_id>:promoted` as the product store produces it in the API path.',
  timeout_policy:
    'A request cut by the timeout is charged at the pessimistic cost, written to the log and STOPS the campaign at the first occurrence (STOPPED: timeout). This differs from v3, which left the decision to the owner.',
});

const PLAN = Object.freeze({
  schema: 'f14v4-plan/1',
  registered_in: 'docs/evolution/w3/stab2/F14-V4-PROTOCOL.md (F14 v4, approved by the owner on 2026-11-09)',
  hypothesis:
    'Memory promoted by the owner, delivered by the production agent run with source_db, makes the model apply a real project convention to inputs the note does not list, as judged by protected tests on the final file.',
  model: 'gpt-4o-2024-08-06',
  binding: { adapter: 'openai-compatible', origin: 'https://api.openai.com' },
  tasks: TASKS.map((task) => ({
    id: task.id,
    file: task.file,
    project_id: task.project_id,
    memory_id: task.memory_id,
    note_sha256: sha(task.note),
    placebo_of: task.placebo_of,
    placebo_memory_id: task.placebo_memory_id,
    protected_cases: task.cases.length,
  })),
  n_per_task: { control: 5, promoted: 5, placebo: 3 },
  conditions: {
    control: 'box A (criterion): the own note, written as agent memory (untrusted), NOT promoted',
    promoted: 'box B (criterion): the own note, promoted by the owner in the owner terminal',
    placebo:
      'box C (informative, no inference): the note of ANOTHER task (oidc gets seed, seed gets pass, pass gets oidc), promoted by the owner; the own note does not exist in this box; memory id f14v4-<task>-placebo',
  },
  pilots: {
    per_task: 1,
    condition: 'control',
    rule: 'a pilot that passes the protected tests rejects the task; the series then cannot run',
  },
  series_runs: 39,
  total_runs: 42,
  promotion: {
    method: 'owner-terminal',
    operator: 'owner',
    count: 6,
    distribution: '3 in box B (own notes) + 3 in box C (placebo notes)',
    command:
      'hseos memory promote --db <banco> --project <projeto> --memory <id> --reason "<motivo>" --operator owner (needs a TTY, one memory at a time)',
    rule: 'the campaign script NEVER promotes in real mode: `prepare` prints the 6 commands, the owner runs them, and `verify-promotions` (also run before the first call) checks trust, content sha256 and operator; any divergence is BLOCKED',
    rehearsal_method: 'api-rehearsal (fixture mode only)',
    memory_ttl_seconds: 604_800,
  },
  seed: {
    drawn: 'at campaign start, from the OS entropy source',
    recorded_in: '<out>/seed.json',
    recorded_before_first_call: true,
    value: null,
  },
  order: 'per task a seeded Fisher-Yates shuffle of 5 control + 5 promoted + 3 placebo runs; task order also shuffled; pilots first',
  analysis: {
    unit: 'task',
    test: 'exact conditional stratified (convolution of hypergeometrics), promoted against control, two-sided, p = sum of probabilities <= observed',
    pooled_fisher: 'forbidden',
    success: `in EVERY task promoted >= ${THRESHOLDS.promotedMin}/5 and control <= ${THRESHOLDS.controlMax}/5, AND p < ${THRESHOLDS.alpha}`,
    placebo: 'descriptive only: successes per task out of 3, no inference',
    informative:
      'requests per run and per arm, how many runs hit the request cap, note_in_context (own note in the context) and memory sources per run',
    primary_outcome:
      'protected tests pass on the final file rebuilt from the ledger AND the product verifier approves; no reconstruction is no-final-write with a reason, never an approval; hitting the cap is a separate datum, not the outcome',
    preregistered_examples: { '4/5 x 1/5 in all three': 0.0041, '3/5 x 1/5 in all three': 0.0708 },
  },
  budget: {
    ceiling_usd: 3,
    ceiling_scope:
      'cumulative over the whole campaign, by the spend ESTIMATED by the script (no cache discount): prior_spend_usd + spend of the campaign + worst-case projection of the next call never exceeds ceiling_usd',
    prior_spend_usd: 0,
    prior_spend_note: 'v4 is a new campaign: nothing was spent before it. The 80% stop rule does not apply',
    credit_precondition:
      'the credit of the account must be at least US$ 3.00 at the start (read from the console by the owner before launch); otherwise the campaign does not start',
    price_usd_per_million: { in: 2.5, out: 10 },
    price_rule:
      'real mode needs --price-in and --price-out explicitly (finite, > 0) and equal to this registered price; otherwise it aborts before the first call. There is no built-in price for real mode',
    price_note: 'operator-declared USD per million tokens; cached input charged at the input price; an estimate, not an invoice',
    max_requests_per_run: 12,
    max_requests_note:
      'declared before any data (the v3 limit of 8 punished the control by exhaustion). A run that needs more is stopped by the guard: the ORIGINAL adapter proof is kept untouched, the run is marked cap_reached and counted apart',
    per_request_check:
      'before each call: prior_spend_usd + spent + worst-case projection (body bytes / 3 as tokens + max_tokens at the output price) > ceiling refuses the call',
    unreadable_usage:
      'the first request with unreadable usage ends the run as usage-unreadable and the campaign stops; the call is charged at the worst-case projection',
    interrupted_request:
      'a request cut by the 280 s timeout is charged with the declared context window as input plus max_tokens as output and is written to the request log',
    declared_context_tokens: 100_000,
    wall_clock_minutes: 45,
  },
  cap_reached_rule: {
    proof: 'never rewritten: requests_total and backend_verified stay as the adapter reported them',
    counting: 'a cap_reached run does not count as "adapter proof pass"; the receipt reports how many there were',
    stop: 'it does NOT stop the campaign as a protocol failure, but only when the checks that do not depend on the count pass (observed model = declared, observed origin = declared, no pool, no fallback, credential source request-header); if any fails, it is a protocol failure and the campaign stops',
    any_other_proof_not_pass: 'a run that did not hit the cap and whose proof is not pass stops the campaign',
  },
  confirmation: {
    env: 'F14V4_REAL_CONFIRMED',
    rule: 'real mode runs only when the variable equals the hash printed by `f14v4.cjs --print-confirmation`; otherwise BLOCKED before any call',
    covers:
      'this plan, the prices, the protected cases and the content of the scripts listed in confirmation.cjs (GATED_FILES), including the v3 files the campaign imports; not the rehearsal results',
  },
  stop: 'failed series ends the campaign with no extra round; the cumulative ceiling is a hard stop (STOPPED: cumulative ceiling)',
  limits_declared: LIMITS_DECLARED,
  credential: 'read from F14V4_OPENAI_API_KEY, provided by the operator at execution time; never from pass; never written or printed',
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

/** The whole series: 39 runs (5 control + 5 promoted + 3 placebo per task), deterministic from the seed. */
function buildSchedule(seed, tasks = PLAN.tasks.map((task) => task.id), counts = PLAN.n_per_task) {
  const rng = makeRng(seed);
  const schedule = [];
  for (const task of shuffle(tasks, rng)) {
    const cell = [];
    for (const [condition, n] of Object.entries(counts)) for (let rep = 1; rep <= n; rep += 1) cell.push({ task, condition });
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

/**
 * Cumulative ceiling gate: prior spend + spend of this execution + worst-case projection of the next call must stay within the
 * ceiling. With projectedUsd = 0 it is the check made before starting a run; the guard calls it with the real projection.
 */
function cumulativeDecision({ priorUsd, spentUsd, projectedUsd = 0, ceilingUsd = PLAN.budget.ceiling_usd }) {
  const cumulative = priorUsd + spentUsd + projectedUsd;
  const ok = [priorUsd, spentUsd, projectedUsd, ceilingUsd].every((value) => Number.isFinite(value));
  return {
    stop: !ok || cumulative > ceilingUsd || (projectedUsd === 0 && cumulative >= ceilingUsd),
    cumulative_usd: cumulative,
    ceiling_usd: ceilingUsd,
  };
}

/**
 * The checks of the adapter proof that do NOT depend on the request count. A run that hit the request cap keeps its original
 * proof (its requests_total includes the refused call); these checks are what decides whether it is still a valid measurement.
 * Returns { ok, failures }.
 */
function countIndependentProofChecks(proof, { model = PLAN.model, origin = PLAN.binding.origin } = {}) {
  const failures = [];
  if (!proof || typeof proof !== 'object') return { ok: false, failures: ['proof-absent'] };
  const observed = proof.observed?.models;
  if (!Array.isArray(observed) || observed.length === 0 || observed.some((name) => name !== proof.declared?.model))
    failures.push('observed-model-differs-from-declared');
  if (proof.declared?.model !== model) failures.push('declared-model-not-registered');
  if (proof.observed?.origin !== proof.declared?.origin) failures.push('observed-origin-differs-from-declared');
  if (proof.declared?.origin !== origin) failures.push('declared-origin-not-registered');
  if (proof.credential_pool !== false) failures.push('credential-pool');
  if (proof.fallback !== false) failures.push('fallback');
  if (proof.credential_source !== 'request-header') failures.push('credential-source-not-request-header');
  return { ok: failures.length === 0, failures };
}

module.exports = {
  projectCallUsd,
  interruptedCallUsd,
  validateRealPrice,
  countIndependentProofChecks,
  PLAN,
  makeRng,
  shuffle,
  buildSchedule,
  costUsd,
  cumulativeDecision,
};
