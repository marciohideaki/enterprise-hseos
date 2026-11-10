'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const dir = process.env.F14V4_DIR || path.join(repoRoot, 'docs', 'evolution', 'w3', 'evidence', 'stab3-f14v4');
const v3 = path.join(dir, '..', 'stab3-f14v3');
const protocolFile = path.join(repoRoot, 'docs', 'evolution', 'w3', 'stab2', 'F14-V4-PROTOCOL.md');
const { stratifiedExactTest, evaluateCriterion } = require(path.join(v3, 'stats.cjs'));
const {
  PLAN,
  buildSchedule,
  cumulativeDecision,
  validateRealPrice,
  projectCallUsd,
  interruptedCallUsd,
  usageCostUsd,
  costUsd,
  effectiveCeilingUsd,
  campaignCeilingUsd,
  countIndependentProofChecks,
} = require(path.join(dir, 'plan.cjs'));
const { TASKS, runFilter, runProtected, PLACEBO_SOURCE, PLACEBO_PREFIX } = require(path.join(dir, 'tasks.cjs'));
const { scanFile } = require(path.join(v3, 'secret-scan.cjs'));
const { GATED_FILES, PRODUCT_FILES, confirmationHash } = require(path.join(dir, 'confirmation.cjs'));
const campaignModule = require(path.join(dir, 'f14v4.cjs'));
const { publicProof, analyse, armReport, boxNotes, promotionCommand, wrappedInHeavyRun, promoteViaApi } = campaignModule;

const tmpBase = () => process.env.TMPDIR || os.tmpdir();
const sha = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex');
const task = (id) => TASKS.find((item) => item.id === id);
const OWNER_REAL_KEY_ENV = 'F14V4_OPENAI_API_KEY';

const strata = (promoted, control) =>
  ['a', 'b', 'c'].map((id) => ({ id, promoted: { n: 5, successes: promoted }, control: { n: 5, successes: control } }));

// ---- statistics: promoted against control, the placebo carries no inference ----

test('stratified exact test reproduces the pre-registered examples', () => {
  assert.equal(stratifiedExactTest(strata(4, 1)).p.toFixed(4), '0.0041');
  assert.equal(stratifiedExactTest(strata(3, 1)).p.toFixed(4), '0.0708');
});

test('success needs every task at 4/5 against at most 1/5 and p < 0.05', () => {
  assert.equal(evaluateCriterion(strata(4, 1)).success, true);
  assert.equal(evaluateCriterion(strata(3, 1)).success, false);
  const mixed = strata(5, 0);
  mixed[2] = { id: 'c', promoted: { n: 5, successes: 3 }, control: { n: 5, successes: 0 } };
  const verdict = evaluateCriterion(mixed);
  assert.ok(verdict.p < 0.05);
  assert.equal(verdict.success, false, 'one weak task fails the criterion even when the pooled p is small');
});

test('analysis uses the task as the unit, keeps the placebo descriptive and refuses an incomplete series', () => {
  assert.equal(analyse([]).complete, false);
  const rows = [];
  for (const item of TASKS) {
    for (const [condition, n, wins] of [
      ['control', 5, 1],
      ['promoted', 5, 4],
      ['placebo', 3, 2],
    ])
      for (let rep = 0; rep < n; rep += 1)
        rows.push({
          kind: 'series',
          task: item.id,
          condition,
          success: rep < wins,
          cap_reached: condition === 'control' && rep === 4,
          usage: { requests: condition === 'promoted' ? 3 : 7 },
          replay: { note_in_context: condition === 'promoted', memory_sources: condition === 'control' ? [] : [{}] },
        });
  }
  const verdict = analyse(rows);
  assert.equal(verdict.complete, true);
  assert.equal(verdict.p.toFixed(4), '0.0041', 'the placebo does not enter the test');
  assert.equal(verdict.success, true);
  assert.deepEqual(
    verdict.placebo_descriptive.map((item) => item.placebo),
    ['2/3', '2/3', '2/3'],
  );
  assert.equal(verdict.by_arm.control.cap_reached, 3, 'runs that hit the cap are counted per arm');
  assert.equal(verdict.by_arm.promoted.requests_mean, 3);
  assert.equal(verdict.by_arm.promoted.note_in_context, 15);
  assert.equal(verdict.by_arm.control.note_in_context, 0);
  assert.equal(verdict.by_arm.placebo.memory_sources_total, 9);
  assert.equal(armReport(rows).by_task_and_arm['oidc/control'].runs, 5);
  // Without a complete placebo arm (n = 3 per task) the series is incomplete.
  assert.equal(analyse(rows.filter((row) => row.condition !== 'placebo')).complete, false);
});

// ---- tasks: the three real rules, the naive filter and the protocol cases ----

test('filter (i): the naive reference fails the protected tests and the correct one passes, on A, B and D', () => {
  const filter = runFilter();
  assert.deepEqual(
    filter.tasks.map((item) => item.id),
    ['oidc', 'seed', 'pass'],
  );
  for (const item of filter.tasks) {
    assert.equal(item.naive.pass, false, `${item.id}: naive must fail`);
    assert.ok(item.naive.failed.length > 0);
    assert.equal(item.correct.pass, true, `${item.id}: correct must pass`);
    assert.equal(item.stub_fails, true);
  }
  assert.equal(filter.accepted, true);
});

test('the protected cases are exactly the ones of the protocol', () => {
  const cases = (id) => task(id).cases.map((item) => [...item.args, item.expected]);
  const issuer = (app) => `https://keycloak.hideakiservicos.net/kc/realms/${app}`;
  const jwks = (app) => `http://keycloak-shared.platform-shared-dev.svc.cluster.local:8080/kc/realms/${app}/protocol/openid-connect/certs`;
  assert.deepEqual(
    cases('oidc'),
    ['marketplace', 'ai-agents-os', 'poynthub'].map((app) => [
      app,
      { issuer: issuer(app), jwksUrl: jwks(app), frontendClientId: `${app}-frontend`, backendClientId: `${app}-backend` },
    ]),
  );
  assert.deepEqual(cases('seed'), [
    ['client', 1, 'poynthub', 'client0001@poynthub.local'],
    ['provider', 12, 'poynthub', 'provider0012@poynthub.local'],
    ['support', 345, 'curatex', 'support0345@curatex.local'],
    ['driver', 9999, 'poynthub', 'driver9999@poynthub.local'],
    ['admin', null, 'poynthub', 'admin@poynthub.local'],
    ['admin', 2, 'poynthub', 'admin0002@poynthub.local'],
  ]);
  assert.deepEqual(cases('pass'), [
    ['GitHub token', 'ci-bot', 'github/ci-bot'],
    ['Bitbucket token', 'mirror', 'github/mirror'],
    ['OAuth client', 'portal', 'google/portal'],
    ['service account', 'bq-reader', 'google/bq-reader'],
    ['registry credentials', 'ghcr', 'docker/ghcr'],
    ['kubeconfig', 'dev-cluster', 'kubernetes/dev-cluster'],
    ['certificate', 'ingress-tls', 'kubernetes/ingress-tls'],
    ['SSH private key', 'deploy', 'ssh/deploy'],
    ['GitOps automation key', 'argocd', 'gitops/argocd'],
    ['MCP token', 'axon', 'claude/axon'],
    ['shared infra credential', 'postgres-shared', 'platform-shared-dev/postgres-shared'],
    ['project credential', 'db-user', 'poynt', 'poynt/db-user'],
    ['unknown thing', 'x', 'misc/x'],
  ]);
  assert.deepEqual(
    TASKS.map((item) => [item.file, item.export, item.project_id, item.memory_id, item.placebo_memory_id]),
    [
      ['oidc.js', 'oidcConfig', 'f14v4-oidc', 'f14v4-oidc-rule', 'f14v4-oidc-placebo'],
      ['seed.js', 'seedEmail', 'f14v4-seed', 'f14v4-seed-rule', 'f14v4-seed-placebo'],
      ['pass.js', 'passPath', 'f14v4-pass', 'f14v4-pass-rule', 'f14v4-pass-placebo'],
    ],
  );
});

test('notes and requirements are the text of the protocol; the note shows only the example `demo`, the tests use other inputs', () => {
  const protocol = fs.readFileSync(protocolFile, 'utf8');
  for (const item of TASKS) {
    assert.ok(
      protocol.includes(`"${item.note}"`) || protocol.includes(`"${item.note}"`.replace(/^"/, '**Nota promovida (texto):** "')),
      item.id,
    );
    assert.ok(protocol.includes(`"${item.requirement}"`), `${item.id}: requirement`);
    assert.match(item.requirement, /Follow the project convention\.$/);
    assert.doesNotMatch(item.requirement, /memory|note|keycloak|\.local|platform-shared|jwks.*internal/i);
    assert.ok(item.verifier_checks.length === item.cases.length && item.verifier_checks.every((check) => check.expected !== undefined));
  }
  // The note uses only `demo`; no protected input appears in it.
  assert.match(task('oidc').note, /app `demo`/);
  for (const app of ['marketplace', 'ai-agents-os', 'poynthub']) assert.equal(task('oidc').note.includes(app), false, app);
  assert.match(task('seed').note, /client0001@demo\.local/);
  for (const word of ['poynthub', 'curatex', 'provider0012', 'support0345', 'driver9999'])
    assert.equal(task('seed').note.includes(word), false, word);
  // The pass note does not use the test phrasing literally, except the kinds that are the singular of a plural the note does use
  // ("OAuth clients", "service accounts", "kubeconfigs"); the names of the secrets never appear.
  const singular = new Set(['OAuth client', 'service account', 'kubeconfig']);
  for (const item of task('pass').cases)
    assert.equal(task('pass').note.includes(item.args[0]), singular.has(item.args[0]), `paraphrase ${item.args[0]}`);
  for (const item of task('pass').cases) assert.equal(task('pass').note.includes(item.args[1]), false, `name ${item.args[1]}`);
});

test('protected tests compare objects by value, whatever the key order, and still tell types apart', () => {
  const oidc = task('oidc');
  const shuffled =
    'module.exports = (app) => ({ backendClientId: `${app}-backend`, frontendClientId: `${app}-frontend`, jwksUrl: `http://keycloak-shared.platform-shared-dev.svc.cluster.local:8080/kc/realms/${app}/protocol/openid-connect/certs`, issuer: `https://keycloak.hideakiservicos.net/kc/realms/${app}` });\n';
  assert.equal(runProtected(oidc, shuffled).pass, true);
  assert.equal(runProtected(oidc, shuffled.replace('issuer:', 'issuer: 1 + 0 ? undefined : ')).pass, false);
  assert.equal(runProtected(oidc, 'throw new Error("x");\n').pass, false);
  assert.equal(runProtected(task('seed'), "module.exports = () => 'client0001@poynthub.local ';\n").pass, false);
});

test('the three protected tasks are rejected by their naive solution one by one', () => {
  for (const item of TASKS) {
    const naive = runProtected(item, item.naive);
    assert.equal(naive.pass, false);
    assert.ok(naive.passed < naive.total, item.id);
    assert.equal(runProtected(item, item.correct).pass, true, item.id);
  }
});

// ---- boxes: A control, B promoted, C placebo ----

test('boxes: A and B hold the own note, C holds the note of ANOTHER task under the placebo id, in a cycle', () => {
  assert.deepEqual(PLACEBO_SOURCE, { oidc: 'seed', seed: 'pass', pass: 'oidc' });
  for (const box of ['A', 'B']) {
    for (const note of boxNotes(box)) {
      const own = task(note.task);
      assert.deepEqual([note.role, note.memory_id, note.content, note.project_id], ['own', own.memory_id, own.note, own.project_id]);
    }
  }
  for (const note of boxNotes('C')) {
    const own = task(note.task);
    assert.equal(note.role, 'placebo');
    assert.equal(note.memory_id, `f14v4-${own.id}-placebo`);
    assert.equal(note.content, `${PLACEBO_PREFIX}${task(PLACEBO_SOURCE[own.id]).note}`);
    assert.ok(note.content.startsWith('Project convention (general project note): '));
    assert.notEqual(note.content, own.note, 'the own note does not exist in box C');
    assert.equal(note.project_id, own.project_id, 'the placebo lives in the project of the task');
  }
  assert.equal(PLACEBO_PREFIX, 'Project convention (general project note): ');
  assert.equal(task('oidc').placebo_note, PLACEBO_PREFIX + task('seed').note);
  assert.equal(task('seed').placebo_note, PLACEBO_PREFIX + task('pass').note);
  assert.equal(task('pass').placebo_note, PLACEBO_PREFIX + task('oidc').note);
  for (const item of TASKS) {
    assert.equal(item.note.startsWith(PLACEBO_PREFIX), false, 'real notes carry no prefix');
    assert.ok(item.placebo_note.startsWith(PLACEBO_PREFIX));
    assert.equal(item.placebo_note.includes(item.note), false, 'the own note is not in the placebo');
  }
});

test('plan matches the protocol: 42 runs, cap 12, US$ 3.00 cumulative, no 80% rule, placebo n = 3, owner promotions', () => {
  const registered = JSON.parse(fs.readFileSync(path.join(dir, 'PLAN.json'), 'utf8'));
  assert.deepEqual(registered, structuredClone(PLAN));
  assert.equal(registered.schema, 'f14v4-plan/1');
  assert.equal(registered.model, 'gpt-4o-2024-08-06');
  assert.deepEqual(registered.n_per_task, { control: 5, promoted: 5, placebo: 3 });
  assert.equal(registered.pilots.per_task * registered.tasks.length, 3);
  assert.equal(registered.series_runs, 39);
  assert.equal(registered.total_runs, 42);
  assert.equal(3 + 3 * (5 + 5 + 3), registered.total_runs);
  assert.equal(registered.budget.max_requests_per_run, 12);
  assert.equal(registered.budget.ceiling_usd, 3);
  assert.equal(registered.budget.prior_spend_usd, 0);
  assert.equal(registered.budget.stop_fraction, undefined, 'the 80% rule does not apply');
  assert.deepEqual(registered.budget.price_usd_per_million, { in: 2.5, out: 10, cached_input_fraction: 0.5 });
  assert.equal(registered.budget.credit_reserve_usd, 0.1);
  assert.equal(registered.budget.cost_basis, 'estimated-with-cache-discount');
  assert.equal(registered.budget.wall_clock_minutes, 45);
  assert.equal(registered.seed.value, null);
  assert.equal(registered.promotion.method, 'owner-terminal');
  assert.equal(registered.promotion.count, 6);
  assert.equal(registered.confirmation.env, 'F14V4_REAL_CONFIRMED');
  assert.deepEqual(
    registered.tasks.map((item) => item.placebo_of),
    ['seed', 'pass', 'oidc'],
  );
  assert.deepEqual(registered.analysis.preregistered_examples, { '4/5 x 1/5 in all three': 0.0041, '3/5 x 1/5 in all three': 0.0708 });
  // The protocol itself carries the same figures.
  const protocol = fs.readFileSync(protocolFile, 'utf8');
  for (const fragment of ['**42 execuções**', '**12** por execução', '**US$ 3,00** cumulativo', '`--price-in 2.5 --price-out 10`']) {
    assert.ok(protocol.includes(fragment), fragment);
  }
});

test('schedule is deterministic, balanced 5 + 5 + 3 per task and interleaved', () => {
  const schedule = buildSchedule('seed-a');
  assert.deepEqual(schedule, buildSchedule('seed-a'));
  assert.notDeepEqual(
    schedule.map((item) => `${item.task}${item.condition}`),
    buildSchedule('seed-b').map((item) => `${item.task}${item.condition}`),
  );
  assert.equal(schedule.length, 39);
  for (const item of PLAN.tasks) {
    const runs = schedule.filter((entry) => entry.task === item.id);
    assert.equal(runs.length, 13);
    for (const [condition, n] of [
      ['control', 5],
      ['promoted', 5],
      ['placebo', 3],
    ])
      assert.equal(runs.filter((entry) => entry.condition === condition).length, n);
    const first = schedule.findIndex((entry) => entry.task === item.id);
    assert.deepEqual(
      runs.map((entry) => entry.order),
      Array.from({ length: 13 }, (_, index) => first + index + 1),
      'the 13 runs of one task are contiguous: tasks are shuffled, then each cell',
    );
  }
  const heads = new Set(
    ['s1', 's2', 's3', 's4', 's5', 's6'].map((seed) =>
      buildSchedule(seed)
        .slice(0, 13)
        .map((entry) => entry.condition)
        .join(''),
    ),
  );
  assert.ok(heads.size > 1, 'order depends on the seed');
});

test('cost and stop rule: the US$ 3 ceiling is cumulative, starts from zero and is a hard stop', () => {
  assert.equal(cumulativeDecision({ priorUsd: 0, spentUsd: 2.9 }).stop, false);
  assert.equal(cumulativeDecision({ priorUsd: 0, spentUsd: 2.9, projectedUsd: 0.1 }).stop, false, 'exactly the ceiling is allowed');
  assert.equal(cumulativeDecision({ priorUsd: 0, spentUsd: 2.9, projectedUsd: 0.11 }).stop, true);
  assert.equal(cumulativeDecision({ priorUsd: 0, spentUsd: 3 }).stop, true, 'a run does not start at the ceiling');
  assert.equal(cumulativeDecision({ priorUsd: Number.NaN, spentUsd: 0 }).stop, true, 'fail closed on a non-number');
  const prices = { priceInPerMillion: 2.5, priceOutPerMillion: 10 };
  assert.ok(Math.abs(projectCallUsd(3000, 1000, prices) - (1000 * 2.5 + 1000 * 10) / 1_000_000) < 1e-12);
  assert.ok(interruptedCallUsd(1024, prices) > 0.25);
});

test('cost with cache discount: cheaper than no cache for the same usage; worst-case projection stays no cache', () => {
  const prices = { priceInPerMillion: 2.5, priceOutPerMillion: 10 };
  const usage = { prompt_tokens: 1_000_000, completion_tokens: 100_000, cached_tokens: 800_000 };
  const withCache = usageCostUsd(usage, prices);
  assert.ok(Math.abs(withCache - (200_000 * 2.5 + 800_000 * 2.5 * 0.5 + 100_000 * 10) / 1_000_000) < 1e-12);
  assert.ok(withCache < costUsd(usage, prices), 'discounted cost is lower than the no-cache cost');
  assert.equal(usageCostUsd({ ...usage, cached_tokens: 0 }, prices), costUsd(usage, prices), 'no cached tokens: same cost');
  // Worst-case projection before the call ignores any cache.
  assert.equal(projectCallUsd(3000, 1000, prices), costUsd({ prompt_tokens: 1000, completion_tokens: 1000 }, prices));
  // A synthetic execution that breaks the US$ 3 ceiling without the discount and does not with it.
  const heavy = { prompt_tokens: 1_000_000, completion_tokens: 40_000, cached_tokens: 900_000 };
  const noCacheUsd = costUsd(heavy, prices) * 1.3;
  const cachedUsd = usageCostUsd(heavy, prices) * 1.3;
  assert.ok(noCacheUsd > 3 && cachedUsd < 3, `${noCacheUsd} ${cachedUsd}`);
  assert.equal(cumulativeDecision({ priorUsd: 0, spentUsd: noCacheUsd }).stop, true);
  assert.equal(cumulativeDecision({ priorUsd: 0, spentUsd: cachedUsd }).stop, false);
});

test('invalid cached_tokens never lowers the cost below the clamped value, never goes negative, and cost_usd <= no cache', () => {
  const prices = { priceInPerMillion: 2.5, priceOutPerMillion: 10 };
  const base = { prompt_tokens: 1000, completion_tokens: 100 };
  const noCache = costUsd(base, prices);
  for (const bad of [-5, 'x', '500', Number.NaN, undefined, null, Infinity, -Infinity]) {
    const cost = usageCostUsd({ ...base, cached_tokens: bad }, prices);
    assert.ok(cost >= 0, String(bad));
    assert.equal(cost, noCache, `invalid ${String(bad)} gives no discount`);
  }
  const above = usageCostUsd({ ...base, cached_tokens: 5000 }, prices);
  assert.equal(above, usageCostUsd({ ...base, cached_tokens: 1000 }, prices), 'above the prompt is clamped');
  assert.ok(above >= 0 && above <= noCache);
  for (const cached of [0, 1, 500, 1000, 1e9, -1, 'a', null])
    assert.ok(usageCostUsd({ ...base, cached_tokens: cached }, prices) <= noCache, String(cached));
  // The SSE reading path turns an invalid value into null, which the sum counts as 0.
  const { parseSse, sumUsage } = require(path.join(dir, '..', 'shared', 'usage-from-sse.cjs'));
  for (const bad of [-5, 'x', Number.NaN, null, undefined, 1.5]) {
    const text = `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: bad === undefined ? {} : { cached_tokens: bad } } })}\n`;
    const parsed = parseSse(text).usage;
    assert.equal(parsed.cached_tokens, null, String(bad));
    assert.equal(sumUsage([{ usage: parsed }]).cached_tokens, 0);
  }
});

test('effective ceiling is the lower of the ceiling and the credit minus the reserve; both are in the hash', () => {
  assert.ok(Math.abs(effectiveCeilingUsd(3) - 2.9) < 1e-12);
  assert.equal(effectiveCeilingUsd(5), 3);
  assert.equal(effectiveCeilingUsd(3.17), 3);
  assert.ok(Number.isNaN(effectiveCeilingUsd(Number.NaN)), 'a non-number never yields a usable ceiling');
  const ceilingOf = (mode, credit, arg) => campaignCeilingUsd({ mode, credit_usd: credit, ceiling_arg: arg });
  assert.ok(Math.abs(ceilingOf('real', 3) - 2.9) < 1e-12);
  assert.equal(ceilingOf('real', 5), 3);
  assert.equal(ceilingOf('real', 3.17), 3);
  assert.equal(ceilingOf('real', 5, '1'), 3, 'real mode ignores --ceiling');
  for (const bad of [Number.NaN, undefined]) {
    const ceiling = ceilingOf('real', bad);
    assert.ok(Number.isNaN(ceiling));
    assert.equal(cumulativeDecision({ priorUsd: 0, spentUsd: 0, ceilingUsd: ceiling }).stop, true, 'the gate refuses it');
  }
  assert.equal(ceilingOf('fixture', undefined, '0.5'), 0.5);
  assert.equal(campaignCeilingUsd({ mode: 'fixture' }), 3);
  const base = confirmationHash();
  const fraction = structuredClone(PLAN);
  fraction.budget.price_usd_per_million.cached_input_fraction = 0.51;
  assert.notEqual(confirmationHash({ plan: fraction }), base, 'cached_input_fraction');
  const reserve = structuredClone(PLAN);
  reserve.budget.credit_reserve_usd = 0.11;
  assert.notEqual(confirmationHash({ plan: reserve }), base, 'credit reserve');
});

test('real mode price must be explicit and equal to the registered one', () => {
  assert.equal(validateRealPrice(2.5, 10).ok, true);
  for (const [a, b] of [
    [Number.NaN, 10],
    [0, 10],
    [-1, 10],
    [2.5, Number.POSITIVE_INFINITY],
  ])
    assert.equal(validateRealPrice(a, b).reason.startsWith('price-invalid'), true);
  assert.match(validateRealPrice(1, 1).reason, /^price-mismatch/);
});

// ---- the proof: count-independent checks and no rewriting ----

const goodProof = {
  declared: { model: 'gpt-4o-2024-08-06', origin: 'https://api.openai.com' },
  observed: { models: ['gpt-4o-2024-08-06'], origin: 'https://api.openai.com' },
  credential_pool: false,
  fallback: false,
  credential_source: 'request-header',
  requests_total: 13,
  requests_verified: 12,
};

test('the checks that do not depend on the request count each fail closed', () => {
  assert.deepEqual(countIndependentProofChecks(goodProof), { ok: true, failures: [] });
  const bad = (patch) => countIndependentProofChecks({ ...structuredClone(goodProof), ...patch }).failures;
  assert.deepEqual(bad({ observed: { models: ['other-model'], origin: goodProof.observed.origin } }), [
    'observed-model-differs-from-declared',
  ]);
  assert.deepEqual(bad({ observed: { models: [], origin: goodProof.observed.origin } }), ['observed-model-differs-from-declared']);
  assert.deepEqual(bad({ observed: { models: goodProof.observed.models, origin: 'https://evil.example' } }), [
    'observed-origin-differs-from-declared',
  ]);
  assert.deepEqual(bad({ credential_pool: true }), ['credential-pool']);
  assert.deepEqual(bad({ fallback: true }), ['fallback']);
  assert.deepEqual(bad({ credential_source: 'env' }), ['credential-source-not-request-header']);
  assert.deepEqual(countIndependentProofChecks(null), { ok: false, failures: ['proof-absent'] });
  assert.equal(countIndependentProofChecks(goodProof, { model: 'x' }).ok, false, 'the declared model must be the registered one');
});

test('the script never rewrites the adapter proof (no assignment to requests_total or backend_verified)', () => {
  for (const name of ['f14v4.cjs', 'guard.cjs']) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotMatch(source, /\.(requests_total|requests_verified|backend_verified)\s*=[^=]/, name);
    assert.doesNotMatch(source, /cap_adjustment/, name);
  }
});

test('the public proof drops the credential hash', () => {
  const hash = 'a'.repeat(64);
  const shown = publicProof({ x: { provider_proof: { backend_verified: true, credential_sha256: hash, requests_total: 1 } } });
  assert.equal(JSON.stringify(shown).includes(hash), false);
  assert.equal(shown.proof.credential_sha256_present, true);
});

test('secret scan flags a credential and an exact literal, and passes clean text', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-scan-'));
  try {
    const clean = path.join(scratch, 'clean.txt');
    const dirty = path.join(scratch, 'dirty.txt');
    fs.writeFileSync(clean, 'ordinary project text about issuers and seeds\n'.repeat(20));
    fs.writeFileSync(dirty, `header\napi_key = sk-${'A1b2C3d4E5'.repeat(4)}\n`);
    assert.equal(scanFile(clean).clean, true);
    assert.equal(scanFile(dirty).clean, false);
    assert.equal(scanFile(clean, { literals: ['ordinary project'] }).clean, false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- the guard: destinations, fail-closed numbers, cumulative ceiling ----

function runGuard(env, url, body = '{"model":"m","messages":[],"max_tokens":100}') {
  const run = spawnSync(
    process.execPath,
    [
      '--require',
      path.join(dir, 'guard.cjs'),
      '-e',
      `fetch(${JSON.stringify(url)}, { method: 'POST', body: ${JSON.stringify(body)} }).then(() => process.stdout.write('ALLOWED'), (e) => process.stdout.write(e.code || 'ERR'))`,
    ],
    { encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 20_000 },
  );
  return run.stdout;
}

test('the guard refuses every real destination in fixture mode and any other host', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-guard-'));
  try {
    const base = { C9_DIR: scratch, F14V4_PRICE_IN: '2.5', F14V4_PRICE_OUT: '10', F14V4_CEILING_USD: '3' };
    for (const url of ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/responses', 'https://api.openai.com/v1/'])
      assert.equal(runGuard({ ...base, F14V4_MODE: 'fixture', F14V4_OFFLINE: '1' }, url), 'F14V4_REAL_DESTINATION_REFUSED', url);
    // Even without F14V4_OFFLINE the fixture mode is not the real mode: the real destination is refused.
    assert.equal(
      runGuard({ ...base, F14V4_MODE: 'fixture' }, 'https://api.openai.com/v1/chat/completions'),
      'F14V4_REAL_DESTINATION_REFUSED',
    );
    assert.equal(
      runGuard({ ...base, F14V4_MODE: 'real', F14V4_OFFLINE: '1' }, 'https://api.openai.com/v1/chat/completions'),
      'F14V4_REAL_DESTINATION_REFUSED',
    );
    for (const url of [
      'https://example.com/',
      'http://127.0.0.1:1/v1/x',
      'https://api.openai.com.evil.example/v1/',
      'https://api.anthropic.com/v1/messages',
    ])
      assert.equal(runGuard({ ...base, F14V4_MODE: 'fixture' }, url), 'F14V4_DESTINATION_REFUSED', url);
    assert.equal(runGuard({ ...base, F14V4_MODE: 'real' }, 'https://mock.invalid/v1/chat/completions'), 'F14V4_DESTINATION_REFUSED');
    assert.equal(fs.existsSync(path.join(scratch, 'request-count.txt')), false, 'a refused destination is not counted as a request');
    assert.equal(runGuard({ ...base, F14V4_MODE: 'fixture' }, 'https://mock.invalid/v1/chat/completions'), 'ALLOWED');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the guard fails closed: price, ceiling, max_tokens and the cap default of 12', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-closed-'));
  try {
    const env = (extra = {}) => ({
      F14V4_MODE: 'fixture',
      F14V4_OFFLINE: '1',
      C9_DIR: scratch,
      F14V4_PRICE_IN: '2.5',
      F14V4_PRICE_OUT: '10',
      F14V4_CEILING_USD: '3',
      ...extra,
    });
    const mock = 'https://mock.invalid/v1/chat/completions';
    const probe = (extra, body) => {
      fs.rmSync(path.join(scratch, 'request-count.txt'), { force: true });
      return runGuard(env(extra), mock, JSON.stringify(body));
    };
    const ok = { model: 'm', messages: [], max_tokens: 1024 };
    assert.equal(probe({}, ok), 'ALLOWED');
    assert.equal(probe({ F14V4_PRICE_IN: '' }, ok), 'F14V4_PRICE_INVALID');
    assert.equal(probe({ F14V4_PRICE_OUT: 'abc' }, ok), 'F14V4_PRICE_INVALID');
    assert.equal(probe({ F14V4_CEILING_USD: '' }, ok), 'F14V4_CEILING_INVALID');
    assert.equal(probe({}, { model: 'm', messages: [] }), 'F14V4_MAX_TOKENS_INVALID');
    assert.equal(probe({}, { ...ok, max_tokens: '1024' }), 'F14V4_MAX_TOKENS_INVALID');
    // The cap defaults to 12 requests per run: the 13th is refused and marked.
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(scratch);
    fs.writeFileSync(path.join(scratch, 'request-count.txt'), '11');
    assert.equal(runGuard(env(), mock, JSON.stringify(ok)), 'ALLOWED', 'the 12th request goes through');
    assert.equal(runGuard(env(), mock, JSON.stringify(ok)), 'F14V4_REQUEST_CAP_REACHED', 'the 13th is refused');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(scratch, 'cap-reached.json'), 'utf8')), { made: 12, max: 12 });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('cumulative ceiling: the guard refuses a call that would pass US$ 3.00 counting the spend, with no prior spend', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-cum-'));
  try {
    const env = {
      F14V4_MODE: 'fixture',
      F14V4_OFFLINE: '1',
      C9_DIR: scratch,
      F14V4_PRICE_IN: '2.5',
      F14V4_PRICE_OUT: '10',
      F14V4_CEILING_USD: '3',
      F14V4_SPENT_USD: '2.9',
    };
    const call = (maxTokens, extra = {}) => {
      fs.rmSync(path.join(scratch, 'request-count.txt'), { force: true });
      return runGuard(
        { ...env, ...extra },
        'https://mock.invalid/v1/chat/completions',
        JSON.stringify({ model: 'm', messages: [], max_tokens: maxTokens }),
      );
    };
    assert.equal(call(8000), 'ALLOWED', '2.9 + 0.08 stays under 3.00');
    assert.equal(call(12_000), 'F14V4_CEILING_PROJECTION', '2.9 + 0.12 passes 3.00');
    assert.equal(call(1000, { F14V4_PRIOR_SPEND_USD: '-1' }), 'F14V4_CEILING_INVALID');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- confirmation gate: every file that decides the run, including the v3 ones the campaign imports ----

function printConfirmation(scriptDir) {
  const run = spawnSync(process.execPath, [path.join(scriptDir, 'f14v4.cjs'), '--print-confirmation'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, TMPDIR: tmpBase() },
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

/** A copy of the evidence directories the campaign needs (v4, the v3 scripts it imports, shared), with the repository tools linked. */
function evidenceCopy(scratch) {
  const root = path.join(scratch, 'root');
  const evidence = path.join(root, 'docs', 'evolution', 'w3', 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  const copy = path.join(evidence, 'stab3-f14v4');
  spawnSync('cp', ['-r', dir, copy], { stdio: 'ignore' });
  for (const name of fs.readdirSync(copy))
    if (name.startsWith('rehearsal')) fs.rmSync(path.join(copy, name), { recursive: true, force: true });
  fs.mkdirSync(path.join(evidence, 'stab3-f14v3'));
  for (const name of fs.readdirSync(v3))
    if (name.endsWith('.cjs')) fs.copyFileSync(path.join(v3, name), path.join(evidence, 'stab3-f14v3', name));
  spawnSync('cp', ['-r', path.join(v3, '..', 'shared'), path.join(evidence, 'shared')], { stdio: 'ignore' });
  for (const name of ['tools', 'packages', 'test', 'package.json']) fs.symlinkSync(path.join(repoRoot, name), path.join(root, name));
  return { root, copy, evidence };
}

test('the confirmation hash changes with one byte of any gated file, the plan, the prices or the protected cases', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-confirm-'));
  try {
    const { copy } = evidenceCopy(scratch);
    const baseline = printConfirmation(copy);
    assert.equal(baseline, confirmationHash());
    assert.match(baseline, /^[0-9a-f]{64}$/);
    const required = [
      'f14v4.cjs',
      'guard.cjs',
      'protected-runner.cjs',
      'tasks.cjs',
      'plan.cjs',
      'confirmation.cjs',
      '../stab3-f14v3/stats.cjs',
      '../stab3-f14v3/measure.cjs',
      '../stab3-f14v3/secret-scan.cjs',
      '../shared/usage-from-sse.cjs',
      '../shared/summarize-provider-proof.cjs',
    ];
    for (const name of required) assert.ok(GATED_FILES.includes(name), `${name} must be listed in the gate`);
    for (const name of GATED_FILES) {
      const file = path.join(copy, name);
      const original = fs.readFileSync(file);
      fs.appendFileSync(file, name.endsWith('.txt') ? ' ' : '\n// one byte more\n');
      assert.notEqual(printConfirmation(copy), baseline, `${name} must be covered`);
      fs.writeFileSync(file, original);
    }
    assert.equal(printConfirmation(copy), baseline, 'restored files give the same hash');
    const plan = structuredClone(PLAN);
    plan.budget.ceiling_usd = 4;
    assert.notEqual(confirmationHash({ plan }), baseline, 'plan');
    const priced = structuredClone(PLAN);
    priced.budget.price_usd_per_million.out = 11;
    assert.notEqual(confirmationHash({ plan: priced }), baseline, 'prices');
    const capped = structuredClone(PLAN);
    capped.budget.max_requests_per_run = 13;
    assert.notEqual(confirmationHash({ plan: capped }), baseline, 'request cap');
    const tasks = structuredClone(TASKS);
    tasks[1].cases[0].expected = 'client0002@poynthub.local';
    assert.notEqual(confirmationHash({ tasks }), baseline, 'protected cases');
    const notes = structuredClone(TASKS);
    notes[0].placebo_note += ' ';
    assert.notEqual(confirmationHash({ tasks: notes }), baseline, 'placebo note');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('every local file the campaign scripts require is covered by the confirmation hash', () => {
  const gated = new Set(GATED_FILES.map((name) => path.resolve(dir, name)));
  for (const name of ['f14v4.cjs', 'guard.cjs', 'plan.cjs', 'tasks.cjs', 'confirmation.cjs', 'protected-runner.cjs']) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const [, spec] of source.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
      if (spec.includes('/tools/') || spec.includes('../../../../../')) continue; // product code, not campaign script
      const resolved = path.resolve(dir, spec);
      assert.ok(
        gated.has(resolved) || gated.has(`${resolved}.cjs`) || gated.has(`${resolved}.js`),
        `${name} requires ${spec}, which is not gated`,
      );
    }
  }
  // secret-scan.cjs of v3 requires campaign-evidence-store (product code): its own file is gated here and the product file is in the
  // product list below.
  assert.ok(GATED_FILES.includes('../stab3-f14v3/secret-scan.cjs'));
  assert.ok(PRODUCT_FILES.includes('tools/cli/lib/campaign-evidence-store.js'));
});

test('the product files the campaign exercises are in the confirmation hash by content; one byte of any of them changes it', () => {
  for (const name of [
    'tools/cli/hseos-cli.js',
    'tools/cli/lib/engineering-task-extensions.js',
    'tools/cli/lib/memory-context-source.js',
    'tools/cli/lib/campaign-evidence-store.js',
    'tools/cli/lib/provider-api-adapter.js',
    'tools/cli/lib/engineering-model.js',
    'tools/cli/lib/engineering-task-runtime.js',
    'tools/cli/lib/engineering-project-verifier.js',
    'test/helpers/engineering-project.js',
    'packages/agent-memory/store.js',
    'packages/model-providers/openai-compatible-provider.js',
  ])
    assert.ok(PRODUCT_FILES.includes(name), `${name} must be gated`);
  assert.ok(
    PRODUCT_FILES.every((name) => fs.existsSync(path.join(repoRoot, name))),
    'every listed file exists',
  );
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-product-'));
  try {
    for (const name of PRODUCT_FILES) {
      fs.mkdirSync(path.dirname(path.join(scratch, name)), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, name), path.join(scratch, name));
    }
    const baseline = confirmationHash({ root: scratch });
    assert.equal(baseline, confirmationHash({ root: repoRoot }), 'same content, same hash');
    for (const name of PRODUCT_FILES) {
      const file = path.join(scratch, name);
      const original = fs.readFileSync(file);
      fs.appendFileSync(file, ' ');
      assert.notEqual(confirmationHash({ root: scratch }), baseline, `${name} must be covered`);
      fs.writeFileSync(file, original);
    }
    assert.equal(confirmationHash({ root: scratch }), baseline);
    fs.rmSync(path.join(scratch, PRODUCT_FILES[0]));
    assert.throws(() => confirmationHash({ root: scratch }), /ENOENT/, 'a missing product file is an error, never silence');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- campaign: BLOCKED paths, real mode never promotes ----

async function fixtureDatabase(scratch) {
  const { activateExecutionLedger, openOperationalStateDatabase } = require(
    path.join(repoRoot, 'tools/mcp-project-state/lib/operational-state-db'),
  );
  const decisions = path.join(scratch, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(path.join(decisions, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nAccepted\n');
  const db = path.join(scratch, 'state', 'project.db');
  openOperationalStateDatabase(db).close();
  await activateExecutionLedger(db, {
    adr: 'ADR-0048',
    backupDir: path.join(scratch, 'backups'),
    now: () => Date.now(),
    internal: { decisionsDirectory: decisions },
  });
  return db;
}

function f14v4(args, env = {}, script = path.join(dir, 'f14v4.cjs'), options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 240_000,
    env: { PATH: process.env.PATH, TMPDIR: tmpBase(), F14V4_OFFLINE: '1', ...env },
    ...options,
  });
}

const campaign = (args, env) => f14v4(['campaign', '--root', repoRoot, ...args], env);
const readReceipt = (out) => JSON.parse(fs.readFileSync(path.join(out, 'campaign.json'), 'utf8'));

test('real mode aborts before any call on a missing, invalid or unregistered price', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-price-'));
  try {
    const out = path.join(scratch, 'out');
    for (const [flags, reason] of [
      [[], 'price-invalid'],
      [['--price-in', 'abc', '--price-out', '10'], 'price-invalid'],
      [['--price-in', '0', '--price-out', '10'], 'price-invalid'],
      [['--price-in', '2.5', '--price-out', 'Infinity'], 'price-invalid'],
      [['--price-in', '1', '--price-out', '1'], 'price-mismatch'],
    ]) {
      const run = campaign(['--mode', 'real', '--prepared', path.join(scratch, 'none'), '--out', out, '--credit-usd', '3.17', ...flags], {
        [OWNER_REAL_KEY_ENV]: 'fake-key-for-test',
        F14V4_REAL_CONFIRMED: confirmationHash(),
      });
      assert.notEqual(run.status, 0, flags.join(' '));
      assert.match(run.stderr, new RegExp(reason), flags.join(' '));
      assert.equal(fs.existsSync(path.join(out, 'seed.json')), false, 'nothing starts before the price is validated');
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('mutation: computing the measured cost without the cache discount breaks the discount check', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-nocache-'));
  try {
    const db = await fixtureDatabase(scratch);
    const check = (receipt) => receipt.runs.every((run) => run.cost_usd < run.cost_usd_no_cache);
    const good = runnableCopy(fs.mkdtempSync(path.join(scratch, 'a-')));
    assert.equal(check(campaignFrom(good.copy, good.root, db, path.join(scratch, 'a-out'), ['--pilots-only']).receipt), true);
    const bad = runnableCopy(fs.mkdtempSync(path.join(scratch, 'b-')));
    const file = path.join(bad.copy, 'guard.cjs');
    const source = fs.readFileSync(file, 'utf8');
    const mutated = source.replace('usageCostUsd(entry.usage, prices) : projected;', 'costUsd(entry.usage, prices) : projected;');
    assert.notEqual(mutated, source, 'the mutation must apply');
    fs.writeFileSync(file, mutated);
    assert.equal(check(campaignFrom(bad.copy, bad.root, db, path.join(scratch, 'b-out'), ['--pilots-only']).receipt), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('real mode is BLOCKED without the matching confirmation, a credit of at least US$ 3.00 or the key, before any call', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-block-'));
  try {
    const out = path.join(scratch, 'out');
    const args = [
      '--mode',
      'real',
      '--prepared',
      path.join(scratch, 'none'),
      '--out',
      out,
      '--price-in',
      '2.5',
      '--price-out',
      '10',
      '--credit-usd',
      '3.17',
    ];
    for (const confirmed of [undefined, '', 'x'.repeat(64), `${confirmationHash()} `]) {
      const run = campaign(args, {
        [OWNER_REAL_KEY_ENV]: 'fake-key-for-test',
        ...(confirmed === undefined ? {} : { F14V4_REAL_CONFIRMED: confirmed }),
      });
      assert.equal(run.status, 3, `confirmation ${JSON.stringify(confirmed)}`);
      assert.match(run.stderr, /BLOCKED/);
      assert.equal(fs.existsSync(out), false, 'nothing starts');
    }
    const confirmed = { [OWNER_REAL_KEY_ENV]: 'fake-key-for-test', F14V4_REAL_CONFIRMED: confirmationHash() };
    const noCredit = campaign(args.slice(0, -2), confirmed);
    assert.equal(noCredit.status, 3);
    assert.match(noCredit.stderr, /credit-usd/);
    const low = campaign([...args.slice(0, -1), '2.99'], confirmed);
    assert.equal(low.status, 3, 'a credit under the US$ 3.00 ceiling stops the campaign');
    const noKey = campaign(args, { F14V4_REAL_CONFIRMED: confirmationHash() });
    assert.equal(noKey.status, 2);
    assert.match(noKey.stderr, new RegExp(OWNER_REAL_KEY_ENV));
    assert.equal(fs.existsSync(out), false, 'nothing started in any of these');
    // The rehearsal-only flags are refused in real mode.
    for (const flag of [
      ['--ceiling', '1'],
      ['--prior-spend', '0'],
      ['--seed', 'x'],
      ['--source-db', 'x'],
    ]) {
      const refused = campaign([...args, ...flag], confirmed);
      assert.equal(refused.status, 2, flag.join(' '));
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the repository root must be an absolute path', () => {
  for (const command of ['campaign', 'prepare', 'verify-promotions']) {
    const run = f14v4([command, '--root', 'relative/root', '--mode', 'fixture', '--source-db', 'x', '--out', 'o', '--prepared', 'p']);
    assert.equal(run.status, 2, command);
    assert.match(run.stderr, /ABSOLUTE/);
  }
});

test('the real campaign is BLOCKED when it runs inside heavy-run, and the detector reads the process ancestry', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-heavy-'));
  try {
    const out = path.join(scratch, 'out');
    const script = `node ${JSON.stringify(path.join(dir, 'f14v4.cjs'))} campaign --root ${JSON.stringify(repoRoot)} --mode real --prepared ${JSON.stringify(path.join(scratch, 'none'))} --out ${JSON.stringify(out)} --price-in 2.5 --price-out 10 --credit-usd 3.17; :`;
    const run = spawnSync('bash', ['-c', script], {
      argv0: 'heavy-run',
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        TMPDIR: tmpBase(),
        [OWNER_REAL_KEY_ENV]: 'fake-key-for-test',
        F14V4_REAL_CONFIRMED: confirmationHash(),
      },
    });
    assert.match(run.stderr, /must not run inside heavy-run/, run.stderr);
    assert.equal(fs.existsSync(out), false, 'nothing started');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  // The detector itself, over a synthetic process table.
  const table = {
    '/proc/30/cmdline': 'node\0f14v4.cjs\0',
    '/proc/30/stat': '30 (node) S 20 0',
    '/proc/20/cmdline': 'bash\0-c\0run\0',
    '/proc/20/stat': '20 (bash) S 10 0',
    '/proc/10/cmdline': '/home/u/.local/bin/heavy-run\0--mem\u00004G\0--\0node\0',
    '/proc/10/stat': '10 (heavy-run) S 1 0',
  };
  const reader = (file) => {
    if (!(file in table)) throw new Error('gone');
    return table[file];
  };
  assert.equal(wrappedInHeavyRun(reader, 20), true);
  assert.equal(wrappedInHeavyRun(reader, 30), true);
  assert.equal(
    wrappedInHeavyRun((file) => reader(file).replace('heavy-run', 'something'), 30),
    false,
  );
});

test('the heavy-run detector fails closed when the process ancestry cannot be determined, and the real mode BLOCKS on it', () => {
  const { heavyRunStatus } = campaignModule;
  const table = {
    '/proc/20/cmdline': 'node\u0000x\u0000',
    '/proc/20/stat': '20 (node) S 10 0',
    '/proc/10/cmdline': 'bash\u0000',
    '/proc/10/stat': '10 (bash) S 1 0',
  };
  const reader = (file) => {
    if (!(file in table)) throw new Error('unreadable');
    return table[file];
  };
  assert.equal(heavyRunStatus(reader, 20), 'clear');
  assert.equal(
    heavyRunStatus(() => {
      throw new Error('no /proc');
    }, 20),
    'unknown',
  );
  assert.equal(heavyRunStatus(reader, 99), 'unknown', 'a pid that cannot be read');
  assert.equal(
    heavyRunStatus((file) => (file.endsWith('stat') ? 'garbage' : 'x'), 20),
    'unknown',
    'a stat that cannot be parsed',
  );
  assert.equal(
    heavyRunStatus((file) => (file.endsWith('stat') ? '5 (x) S 5 0' : 'x'), 5),
    'unknown',
    'a chain that never ends',
  );
  assert.equal(
    wrappedInHeavyRun(() => {
      throw new Error('x');
    }, 20),
    false,
    'the compatibility form keeps the old answer',
  );
  const source = fs.readFileSync(path.join(dir, 'f14v4.cjs'), 'utf8');
  assert.match(source, /mode === 'real' \? heavyRunStatus\(\) : 'clear'/, 'fixture keeps the old behaviour');
  assert.match(source, /heavy === 'unknown'/);
});

test('real mode never calls promote: the only `.promote(` is in the fixture-only function, which refuses real', () => {
  const source = fs.readFileSync(path.join(dir, 'f14v4.cjs'), 'utf8');
  const calls = [...source.matchAll(/\.promote\(/g)];
  assert.equal(calls.length, 1, 'exactly one call site');
  const start = source.indexOf('function promoteViaApi(');
  const end = source.indexOf('\n}\n', start);
  assert.ok(start > 0 && calls[0].index > start && calls[0].index < end, 'the call sits inside promoteViaApi');
  assert.match(source.slice(start, start + 400), /mode !== 'fixture'/);
  // `promoteViaApi` is only called on the fixture branch, and `owner-terminal` is written after the verification.
  const callers = [...source.matchAll(/promoteViaApi\(\{/g)].map((match) => match.index);
  assert.equal(callers.length, 2, 'definition plus one call');
  const fixtureBranch = source.indexOf("if (mode === 'fixture') {", source.indexOf('async function campaign('));
  assert.ok(callers[1] > fixtureBranch);
  assert.ok(source.indexOf("result.promotion_method = 'owner-terminal'") > source.indexOf('const verified = verifyPromotions('));
  const manifest = { kind: 'real', boxes: {}, promotions: [] };
  assert.throws(() => promoteViaApi({ root: repoRoot, manifest, mode: 'real' }), /only for the fixture rehearsal/);
  assert.throws(
    () => promoteViaApi({ root: repoRoot, manifest: { ...manifest, kind: 'real' }, mode: 'fixture' }),
    /only for the fixture rehearsal/,
  );
  assert.equal(PLAN.promotion.rehearsal_method, 'api-rehearsal (fixture mode only)');
});

/** Runnable copy of the campaign, repository tools linked, so a test can mutate the copy. */
function runnableCopy(scratch) {
  const { root, copy } = evidenceCopy(scratch);
  for (const name of fs.readdirSync(repoRoot)) {
    if (['docs', '.git', '.worktrees', 'tools', 'packages', 'test', 'package.json'].includes(name)) continue;
    fs.symlinkSync(path.join(repoRoot, name), path.join(root, name));
  }
  return { root, copy };
}

const pinAlias = (copy) => {
  const file = path.join(copy, 'plan.cjs');
  const source = fs.readFileSync(file, 'utf8');
  const mutated = source.replace("model: 'gpt-4o-2024-08-06',", "model: 'gpt-4o',");
  assert.notEqual(mutated, source);
  fs.writeFileSync(file, mutated);
};

function campaignFrom(copy, root, db, out, extra = [], env = {}) {
  const run = f14v4(
    ['campaign', '--root', root, '--mode', 'fixture', '--source-db', db, '--out', out, '--seed', 'v4', ...extra],
    env,
    path.join(copy, 'f14v4.cjs'),
  );
  const file = path.join(out, 'campaign.json');
  return { run, receipt: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null };
}

/** Promotes the 6 notes through the operator API with a chosen operator id (test helper; the script has its own fixture-only path). */
function promoteAll(root, manifest, { operator = 'owner', skip = [] } = {}) {
  const { openOperatorMemory } = require(path.join(root, 'tools/cli/lib/memory-context-source'));
  for (const box of ['B', 'C']) {
    const handle = openOperatorMemory({ databasePath: manifest.boxes[box].file, operator: { kind: 'operator', id: operator } });
    try {
      for (const item of manifest.promotions.filter((entry) => entry.box === box && !skip.includes(`${entry.box}:${entry.task}`)))
        handle.promote({
          project_id: item.project_id,
          memory_id: item.memory_id,
          content_sha256: item.content_sha256,
          reason: 'test promotion',
        });
    } finally {
      handle.close();
    }
  }
}

const prepareArgs = (root, db, workDir, mode = 'fixture') => [
  'prepare',
  '--root',
  root,
  '--mode',
  mode,
  '--source-db',
  db,
  '--work-dir',
  workDir,
];
const verifyArgs = (root, prepared) => ['verify-promotions', '--root', root, '--prepared', prepared];

test('prepare prints the 6 owner commands, creates untrusted boxes, and verify-promotions BLOCKS until the owner promotes', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-prepare-'));
  try {
    const db = await fixtureDatabase(scratch);
    const work = path.join(scratch, 'prepared');
    const prepared = f14v4(prepareArgs(repoRoot, db, work));
    assert.equal(prepared.status, 0, prepared.stderr);
    const commands = prepared.stdout.split('\n').filter((line) => line.startsWith('hseos memory promote '));
    assert.equal(commands.length, 6);
    const manifest = JSON.parse(fs.readFileSync(path.join(work, 'prepared.json'), 'utf8'));
    assert.equal(manifest.kind, 'fixture');
    const expected = [];
    for (const [box, role] of [
      ['B', 'own'],
      ['C', 'placebo'],
    ])
      for (const item of TASKS) {
        const memory = role === 'own' ? item.memory_id : item.placebo_memory_id;
        const content = role === 'own' ? item.note : item.placebo_note;
        expected.push({ box, project: item.project_id, memory, sha: sha(content) });
      }
    for (const [index, item] of expected.entries()) {
      const file = path.join(work, `box-${item.box.toLowerCase()}.db`);
      const prefix = `hseos memory promote --db ${file} --project ${item.project} --memory ${item.memory} --reason "`;
      assert.ok(commands[index].startsWith(prefix), commands[index]);
      assert.ok(commands[index].endsWith('" --operator owner'), commands[index]);
      assert.equal(manifest.promotions[index].content_sha256, item.sha);
      assert.ok(prepared.stdout.includes(item.sha), 'the sha256 the owner will see is printed');
      assert.equal(commands[index], promotionCommand(manifest.promotions[index]));
    }
    assert.equal(commands.filter((line) => line.includes('box-b.db')).length, 3);
    assert.equal(commands.filter((line) => line.includes('box-c.db')).length, 3);
    assert.equal(commands.filter((line) => line.includes('box-a.db')).length, 0, 'nothing is promoted in the control box');
    assert.equal(fs.existsSync(path.join(work, 'base.db')), false, 'the database copy is removed once the boxes exist');
    // Nothing was promoted: verify-promotions is BLOCKED and names the 6 missing promotions.
    const blocked = f14v4(verifyArgs(repoRoot, work));
    assert.equal(blocked.status, 3, blocked.stdout);
    const report = JSON.parse(blocked.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.problems.filter((item) => item.startsWith('not-promoted:')).length, 6);
    // A prepare into a non-empty or non-$TMPDIR directory is refused.
    assert.equal(f14v4(prepareArgs(repoRoot, db, work)).status, 2);
    assert.equal(f14v4(prepareArgs(repoRoot, db, path.join(repoRoot, 'x-prepared'))).status, 2);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('prepare stops on a database copy that holds a credential', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-prepare-secret-'));
  try {
    const db = await fixtureDatabase(scratch);
    const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'));
    const handle = new Database(db);
    handle.exec('CREATE TABLE leaked (t TEXT)');
    handle.prepare('INSERT INTO leaked VALUES (?)').run(`api_key = sk-${'A1b2C3d4E5'.repeat(4)}`);
    handle.pragma('wal_checkpoint(TRUNCATE)');
    handle.close();
    const work = path.join(scratch, 'prepared');
    const run = f14v4(prepareArgs(repoRoot, db, work));
    assert.equal(run.status, 4, run.stderr);
    assert.match(run.stderr, /BLOCKED/);
    assert.equal(fs.existsSync(work), false, 'the copy is removed');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('verify-promotions: a preparation passes only after the 6 owner promotions, and BLOCKS on any divergence', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-verify-'));
  try {
    const db = await fixtureDatabase(scratch);
    const { root, copy } = runnableCopy(scratch);
    const script = path.join(copy, 'f14v4.cjs');
    const make = (name) => {
      const work = path.join(scratch, name);
      const run = f14v4(prepareArgs(root, db, work), {}, script);
      assert.equal(run.status, 0, run.stderr);
      return { work, manifest: JSON.parse(fs.readFileSync(path.join(work, 'prepared.json'), 'utf8')) };
    };
    const verify = (work) => {
      const run = f14v4(verifyArgs(root, work), {}, script);
      return { run, report: JSON.parse(run.stdout) };
    };
    // Complete and correct: verified, with the operator and the sha256 of every promotion.
    const good = make('good');
    promoteAll(root, good.manifest);
    const ok = verify(good.work);
    assert.equal(ok.run.status, 0, ok.run.stdout);
    assert.equal(ok.report.promotions.length, 6);
    assert.ok(ok.report.promotions.every((item) => item.operator === 'owner' && /^[0-9a-f]{64}$/.test(item.content_sha256)));
    // One memory not promoted.
    const partial = make('partial');
    promoteAll(root, partial.manifest, { skip: ['C:pass'] });
    const missing = verify(partial.work);
    assert.equal(missing.run.status, 3);
    assert.deepEqual(missing.report.problems, ['not-promoted:box-C:f14v4-pass/f14v4-pass-placebo', 'not-deliverable:box-C:f14v4-pass']);
    // The wrong sha256: the manifest expects another content than the one promoted.
    const wrong = make('wrong');
    promoteAll(root, wrong.manifest);
    const wrongManifest = JSON.parse(fs.readFileSync(path.join(wrong.work, 'prepared.json'), 'utf8'));
    wrongManifest.promotions[0].content_sha256 = 'f'.repeat(64);
    fs.writeFileSync(path.join(wrong.work, 'prepared.json'), JSON.stringify(wrongManifest));
    const mismatch = verify(wrong.work);
    assert.equal(mismatch.run.status, 3);
    assert.ok(
      mismatch.report.problems.some((item) => item.startsWith('manifest-diverges:box-B:f14v4-oidc/')),
      mismatch.run.stdout,
    );
    // A promotion by another operator.
    const stranger = make('stranger');
    promoteAll(root, stranger.manifest, { operator: 'someone-else' });
    const other = verify(stranger.work);
    assert.equal(other.run.status, 3);
    assert.equal(other.report.problems.filter((item) => item.startsWith('operator-not-owner:')).length, 6);
    // The control box promoted by mistake.
    const controlled = make('controlled');
    promoteAll(root, controlled.manifest);
    {
      const { openOperatorMemory } = require(path.join(root, 'tools/cli/lib/memory-context-source'));
      const handle = openOperatorMemory({ databasePath: controlled.manifest.boxes.A.file, operator: { kind: 'operator', id: 'owner' } });
      try {
        const item = TASKS[0];
        handle.promote({ project_id: item.project_id, memory_id: item.memory_id, content_sha256: sha(item.note), reason: 'by mistake' });
      } finally {
        handle.close();
      }
    }
    const control = verify(controlled.work);
    assert.equal(control.run.status, 3);
    assert.ok(control.report.problems.includes('control-note-promoted:f14v4-oidc/f14v4-oidc-rule'), control.run.stdout);
    // An old or edited manifest: the promoted id and the project are what the code expects, so any edit is BLOCKED.
    const forged = make('forged');
    promoteAll(root, forged.manifest);
    const forgedManifest = JSON.parse(fs.readFileSync(path.join(forged.work, 'prepared.json'), 'utf8'));
    forgedManifest.promotions[1].promoted_id = 'f14v4-seed-rule-v0:promoted';
    forgedManifest.promotions = forgedManifest.promotions.slice(0, 5);
    fs.writeFileSync(path.join(forged.work, 'prepared.json'), JSON.stringify(forgedManifest));
    const old = verify(forged.work);
    assert.equal(old.run.status, 3);
    assert.ok(old.report.problems.includes('manifest-diverges:promotion-count'), old.run.stdout);
    assert.ok(old.report.problems.some((item) => item.startsWith('manifest-diverges:box-B:f14v4-seed/')));
    // The control box with another CONTENT than the note of the code (prepared by a copy whose oidc note differs) is BLOCKED.
    const alt = runnableCopy(fs.mkdtempSync(path.join(scratch, 'alt-')));
    const altTasks = path.join(alt.copy, 'tasks.cjs');
    const altSource = fs.readFileSync(altTasks, 'utf8');
    const altMutated = altSource.replace('Convenção de OIDC do projeto:', 'Convenção de OIDC do projeto (outra):');
    assert.notEqual(altMutated, altSource);
    fs.writeFileSync(altTasks, altMutated);
    const altWork = path.join(scratch, 'altwork');
    assert.equal(f14v4(prepareArgs(alt.root, db, altWork), {}, path.join(alt.copy, 'f14v4.cjs')).status, 0);
    promoteAll(root, JSON.parse(fs.readFileSync(path.join(altWork, 'prepared.json'), 'utf8')));
    const altVerify = verify(altWork);
    assert.equal(altVerify.run.status, 3);
    assert.ok(altVerify.report.problems.includes('control-note-content:f14v4-oidc/f14v4-oidc-rule'), altVerify.run.stdout);
    // A control box whose bytes changed after the preparation.
    const touched = make('touched');
    promoteAll(root, touched.manifest);
    fs.appendFileSync(touched.manifest.boxes.A.file, 'x');
    assert.ok(verify(touched.work).report.problems.includes('control-box-changed'));
    // A box that is gone.
    const gone = make('gone');
    promoteAll(root, gone.manifest);
    fs.rmSync(gone.manifest.boxes.B.file);
    const absent = verify(gone.work);
    assert.equal(absent.run.status, 3);
    assert.ok(absent.report.problems.includes('db-missing:box-B'));
    // A directory with no manifest.
    const none = f14v4(verifyArgs(root, path.join(scratch, 'nothing-here')), {}, script);
    assert.equal(none.status, 3);
    assert.ok(JSON.parse(none.stdout).problems.includes('manifest-missing'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('delivery check: through the product retrieval, A delivers nothing, B the own promoted note and C the placebo, in every task', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-delivery-'));
  try {
    const db = await fixtureDatabase(scratch);
    const work = path.join(scratch, 'prepared');
    assert.equal(f14v4(prepareArgs(repoRoot, db, work)).status, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(work, 'prepared.json'), 'utf8'));
    promoteAll(repoRoot, manifest);
    const verified = f14v4(verifyArgs(repoRoot, work));
    assert.equal(verified.status, 0, verified.stdout);
    const report = JSON.parse(verified.stdout);
    assert.deepEqual(report.problems, []);
    assert.equal(report.delivery.length, 9);
    for (const item of report.delivery) {
      const own = task(item.task);
      assert.equal(item.ok, true, `${item.box}/${item.task}`);
      if (item.box === 'A') assert.deepEqual(item.delivered, []);
      else {
        const id = item.box === 'B' ? own.memory_id : own.placebo_memory_id;
        assert.deepEqual(item.delivered, [`memory://${own.project_id}/${id}:promoted`]);
      }
    }
    // The placebo shares a term with every requirement because of the neutral prefix (lexical retrieval on the requirement).
    const { tokenize } = require(path.join(repoRoot, 'packages/agent-memory/store.js'));
    for (const item of TASKS) {
      const query = new Set(tokenize(item.requirement));
      assert.ok(
        tokenize(item.placebo_note).some((term) => query.has(term)),
        item.id,
      );
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the real campaign with boxes the owner did not promote is BLOCKED before any call and leaves the memory untrusted', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-real-block-'));
  try {
    const db = await fixtureDatabase(scratch);
    const work = path.join(scratch, 'prepared');
    assert.equal(f14v4(prepareArgs(repoRoot, db, work, 'real')).status, 0);
    const out = path.join(scratch, 'out');
    const run = campaign(
      ['--mode', 'real', '--prepared', work, '--out', out, '--price-in', '2.5', '--price-out', '10', '--credit-usd', '3.17'],
      { [OWNER_REAL_KEY_ENV]: 'fake-key-for-test', F14V4_REAL_CONFIRMED: confirmationHash() },
    );
    assert.equal(run.status, 3, run.stderr);
    assert.match(run.stderr, /BLOCKED/);
    assert.equal(fs.existsSync(path.join(out, 'seed.json')), false, 'no seed, no run');
    assert.equal(fs.existsSync(path.join(out, 'runs')) && fs.readdirSync(path.join(out, 'runs')).length > 0, false, 'no run started');
    // Whatever blocked it (promotions, or heavy-run when the suite itself is wrapped), the campaign did not promote anything.
    const after = f14v4(verifyArgs(repoRoot, work));
    assert.equal(JSON.parse(after.stdout).problems.filter((item) => item.startsWith('not-promoted:')).length, 6);
    if (!/heavy-run/.test(run.stderr)) {
      assert.equal(readReceipt(out).verdict, 'BLOCKED: promotions not verified');
      assert.equal(fs.existsSync(work), true, 'the prepared boxes stay for the owner to promote');
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the rehearsal campaign promotes through the API only in fixture mode and records it; pilots only is not a verdict', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-pilots-'));
  try {
    const db = await fixtureDatabase(scratch);
    const { root, copy } = runnableCopy(scratch);
    const { run, receipt } = campaignFrom(copy, root, db, path.join(scratch, 'out'), ['--pilots-only']);
    assert.equal(run.status, 0, run.stderr);
    assert.match(receipt.verdict, /^NOT EVALUATED/);
    assert.equal(receipt.evidence_kind, 'fixture-rehearsal');
    assert.equal(receipt.promotion_method, 'api-rehearsal');
    assert.equal(receipt.boxes.promotion_method, 'api-rehearsal');
    assert.equal(receipt.boxes.promotions.length, 6);
    assert.ok(receipt.boxes.promotions.every((item) => item.operator === 'owner'));
    assert.equal(receipt.database.kind, 'fixture-copy');
    assert.equal(receipt.seed_recorded_before_first_call, true);
    assert.equal(receipt.totals.runs, 3);
    assert.deepEqual(receipt.protocol_issues, []);
    assert.equal(receipt.totals.adapter_proof_pass, 3);
    assert.equal(receipt.totals.cap_reached_runs, 0);
    assert.ok(receipt.runs.every((item) => item.condition === 'control' && item.box === 'A' && item.protected.pass === false));
    assert.ok(receipt.runs.every((item) => item.provider_proof.verdict === 'pass' && item.replay.memory_sources.length === 0));
    assert.deepEqual(receipt.runs[0].responding_models, ['gpt-4o-2024-08-06']);
    assert.equal(receipt.artifact_scan.clean, true);
    assert.equal(JSON.stringify(receipt).includes('"credential_sha256":'), false);
    assert.equal(fs.existsSync(path.join(scratch, 'out', 'seed.json')), true);
    // Receipt additions: the commit (informative), the product files by content, and the declared limits.
    assert.ok('git_head' in receipt, 'the root of this copy has no .git, so the commit is null here');
    assert.equal(receipt.git_head, null);
    const head = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assert.equal(campaignModule.gitHead(repoRoot), head, 'informative commit of the run, outside the hash');
    assert.deepEqual(Object.keys(receipt.product_files_sha256), [...PRODUCT_FILES]);
    for (const key of [
      'real_path_never_exercised',
      'rehearsal_scope',
      'credit_declared_not_verified',
      'cost_is_estimate',
      'timeout_policy',
    ])
      assert.ok(typeof receipt.limits[key] === 'string' && receipt.limits[key].length > 20, key);
    assert.match(receipt.limits.real_path_never_exercised, /network.*key.*memory promote.*TTY/i);
    assert.match(receipt.limits.rehearsal_scope, /fake model.*plumbing/i);
    assert.match(receipt.limits.credit_declared_not_verified, /not verify/i);
    assert.match(receipt.limits.cost_is_estimate, /estimate/i);
    assert.match(receipt.limits.cost_is_estimate, /cached-input discount.*declared, not verified/i);
    assert.match(receipt.limits.cost_is_estimate, /not an invoice.*console prevails/i);
    assert.match(receipt.limits.cost_is_estimate, /100%.*2\.98.*1\.49/);
    assert.match(receipt.limits.cost_is_estimate, /50% discount.*1\.94.*still above the console/i);
    assert.match(receipt.limits.cost_is_estimate, /between 50% and 75%/);
    assert.match(receipt.limits.cost_is_estimate, /console reading can lag/i);
    assert.match(receipt.limits.credit_lock_scope, /2\.90|3\.00 to 2\.90/);
    assert.match(receipt.limits.credit_lock_scope, /does not protect a smaller credit.*owner decision/i);
    assert.match(
      receipt.limits.estimate_margin_over_console,
      /0\.4%.*v3.*0\.946.*0\.95.*30%.*v4.*1\.94.*1\.49.*console prevails.*at least 50%/i,
    );
    assert.match(receipt.limits.cached_tokens_invalid, /invalid cached_tokens.*becomes 0.*no discount/i);
    assert.match(PLAN.budget.ceiling_scope, /WITH the published cache discount/);
    // The two costs and their basis are in the receipt, and the gate base is the discounted one.
    assert.equal(receipt.totals.cost_basis, 'estimated-with-cache-discount');
    assert.ok(receipt.totals.cost_usd_no_cache > 0 && receipt.totals.cost_usd <= receipt.totals.cost_usd_no_cache);
    assert.equal(receipt.totals.cost_usd, receipt.totals.cost_usd_estimate);
    assert.equal(typeof receipt.totals.cached_tokens, 'number');
    assert.equal(receipt.totals.effective_ceiling_usd, 3);
    for (const run of receipt.runs) {
      assert.equal(run.cost_basis, 'estimated-with-cache-discount');
      assert.ok(run.cost_usd <= run.cost_usd_no_cache);
    }
    assert.match(receipt.limits.timeout_policy, /differs from v3/i);
    for (const [key, pattern] of [
      ['product_files_static', /static list.*fixture.*not recomputed.*governed-action.*mcp-protocol.*not proved/is],
      ['hash_fail_closed_files', /package\.json.*command-manifest\.json.*invalidat/is],
      ['hash_not_covered', /node_modules.*Node version.*project\.db/is],
      ['heavy_run_detection', /regex.*command line.*wrongly.*BLOCKED.*no cost/is],
      ['promoted_id_format', /promoted_id.*memory promote.*TTY.*not exercised/is],
    ])
      assert.match(receipt.limits[key], pattern, key);
    for (const key of ['failure_paths_covered', 'failure_paths_not_covered']) assert.ok(receipt.limits[key].length >= 5, key);
    assert.deepEqual(receipt.limits.failure_paths_covered, PLAN.limits_declared.failure_paths_covered);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- cap reached: the proof is kept as the adapter wrote it, counted apart, and does not stop the campaign by itself ----

test('an execution that hits the request cap keeps its ORIGINAL proof, is marked and counted apart, and the campaign goes on', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-cap-'));
  try {
    const db = await fixtureDatabase(scratch);
    const { root, copy } = runnableCopy(scratch);
    const { run, receipt } = campaignFrom(copy, root, db, path.join(scratch, 'cap'), ['--pilots-only'], { F14V4_MOCK_FAULT: 'cap-loop' });
    assert.ok(receipt, run.stderr);
    assert.equal(receipt.totals.runs, 3, 'all three pilots run: the cap alone does not stop the campaign');
    assert.equal(receipt.stopped, undefined);
    assert.notEqual(receipt.verdict, 'STOPPED: protocol failure');
    for (const item of receipt.runs) {
      assert.equal(item.cap_reached, true);
      assert.deepEqual(item.cap, { made: 12, max: 12 });
      assert.equal(item.usage.requests, 12, 'twelve requests reached the provider');
      assert.equal(item.provider_proof.marker, 'cap-reached');
      assert.equal(item.proof_independent_checks.ok, true);
      // The adapter's own count is untouched: it counted the refused 13th call too, so requests_total is NOT the 12 that were made.
      assert.ok(
        item.provider_proof.proof.requests_total > item.cap.made,
        `requests_total ${item.provider_proof.proof.requests_total} was preserved`,
      );
      assert.notEqual(item.provider_proof.verdict, 'pass', 'the original proof is not a pass, and it is not made one');
      assert.equal(item.success, false);
      assert.notEqual(item.reason, 'request-cap-reached', 'the script no longer overwrites reason or task_result');
    }
    assert.equal(receipt.totals.cap_reached_runs, 3);
    assert.equal(receipt.totals.adapter_proof_pass, 0, 'a cap-reached run does not count as an adapter proof pass');
    assert.equal(receipt.totals.cap_reached_labels.length, 3);
    assert.equal(
      receipt.protocol_issues.filter((item) => item.includes('provider-proof-')).length,
      0,
      'the original proof is not a protocol issue for a cap-reached run',
    );
    // A diverged model still stops the campaign at once (the adapter refuses it on the first request, before any cap).
    const diverged = runnableCopy(fs.mkdtempSync(path.join(scratch, 'div-')));
    pinAlias(diverged.copy);
    const stopped = campaignFrom(diverged.copy, diverged.root, db, path.join(scratch, 'div-out'), ['--pilots-only'], {
      F14V4_MOCK_FAULT: 'cap-loop',
    });
    assert.equal(stopped.receipt.verdict, 'STOPPED: protocol failure');
    assert.equal(stopped.receipt.stopped.detail, 'CONTROL_PROVIDER_BACKEND_DIVERGED');
    assert.equal(stopped.receipt.totals.runs, 1);
    assert.equal(stopped.run.status, 5);
    // A run that hit the cap is judged ONLY by the checks that do not depend on the count: when one of them fails, the campaign stops.
    const failing = runnableCopy(fs.mkdtempSync(path.join(scratch, 'chk-')));
    const planFile = path.join(failing.copy, 'plan.cjs');
    const planSource = fs.readFileSync(planFile, 'utf8');
    const mutatedPlan = planSource.replace("proof.credential_source !== 'request-header'", "proof.credential_source !== 'something-else'");
    assert.notEqual(mutatedPlan, planSource, 'the mutation must apply');
    fs.writeFileSync(planFile, mutatedPlan);
    const checks = campaignFrom(failing.copy, failing.root, db, path.join(scratch, 'chk-out'), ['--pilots-only'], {
      F14V4_MOCK_FAULT: 'cap-loop',
    });
    assert.equal(checks.receipt.runs[0].cap_reached, true);
    assert.equal(checks.receipt.verdict, 'STOPPED: protocol failure');
    assert.equal(checks.receipt.stopped.detail, 'cap-reached-proof-checks:credential-source-not-request-header');
    assert.equal(checks.receipt.totals.runs, 1);
    assert.ok(checks.receipt.runs[0].provider_proof.proof.requests_total > 12, 'still the original count');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a run that did NOT hit the cap and whose proof is not pass still stops the campaign, and a mutation that skips the stop breaks it', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-stop-'));
  try {
    const db = await fixtureDatabase(scratch);
    const one = runnableCopy(fs.mkdtempSync(path.join(scratch, 'a-')));
    pinAlias(one.copy);
    const stopped = campaignFrom(one.copy, one.root, db, path.join(scratch, 'a-out'), ['--pilots-only']);
    assert.equal(stopped.receipt.runs[0].reason, 'CONTROL_PROVIDER_BACKEND_DIVERGED');
    assert.equal(stopped.receipt.runs[0].cap_reached, false);
    assert.equal(stopped.receipt.verdict, 'STOPPED: protocol failure');
    assert.equal(stopped.receipt.totals.runs, 1, 'one execution, not three');
    // Mutation: the protocol stop is removed; the same failure no longer ends the campaign.
    const two = runnableCopy(fs.mkdtempSync(path.join(scratch, 'b-')));
    pinAlias(two.copy);
    const file = path.join(two.copy, 'f14v4.cjs');
    const source = fs.readFileSync(file, 'utf8');
    const mutated = source.replace('if (failure) {', 'if (false && failure) {');
    assert.notEqual(mutated, source, 'the mutation must apply');
    fs.writeFileSync(file, mutated);
    const mutant = campaignFrom(two.copy, two.root, db, path.join(scratch, 'b-out'), ['--pilots-only']);
    assert.equal(mutant.receipt.totals.runs, 3, 'without the stop the three pilots run: the assertion above would fail');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('failure paths stop the campaign: non-SSE, zero usage and the per-request ceiling', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-faults-'));
  try {
    const db = await fixtureDatabase(scratch);
    const { root, copy } = runnableCopy(scratch);
    const go = (name, extra, env) => campaignFrom(copy, root, db, path.join(scratch, name), ['--pilots-only', ...extra], env);
    const nonSse = go('nonsse', [], { F14V4_MOCK_FAULT: 'nonsse' });
    assert.equal(nonSse.run.status, 6, nonSse.run.stderr);
    assert.equal(nonSse.receipt.totals.runs, 1, 'the next pilot must not start');
    assert.equal(nonSse.receipt.runs[0].stop_reason, 'usage-unreadable');
    assert.ok(nonSse.receipt.runs[0].cost_usd > 0, 'the unreadable call is charged at the worst-case projection');
    const zero = go('zero', [], { F14V4_MOCK_FAULT: 'zerousage' });
    assert.equal(zero.run.status, 6, zero.run.stderr);
    assert.equal(zero.receipt.runs[0].stop_reason, 'usage-unreadable');
    // A request cut by the timeout: charged pessimistically, logged, and the campaign stops at the FIRST occurrence.
    const cut = go('hang', ['--run-timeout-ms', '9000'], { F14V4_MOCK_FAULT: 'hang' });
    assert.equal(cut.receipt.verdict, 'STOPPED: timeout');
    assert.equal(cut.receipt.stopped.reason, 'timeout');
    assert.equal(cut.run.status, 5);
    assert.equal(cut.receipt.totals.runs, 1, 'the next pilot must not start');
    assert.equal(cut.receipt.runs[0].interrupted_request, true);
    assert.equal(cut.receipt.runs[0].stop_reason, 'interrupted-timeout');
    assert.ok(cut.receipt.runs[0].cost_usd >= interruptedCallUsd(1024, { priceInPerMillion: 2.5, priceOutPerMillion: 10 }) - 1e-9);
    assert.match(
      fs.readFileSync(path.join(scratch, 'hang', 'runs', 'pilot-oidc', 'provider-requests.jsonl'), 'utf8'),
      /"interrupted":true/,
    );
    assert.notEqual(cut.receipt.runs[0].provider_proof?.verdict, 'pass');
    assert.equal(cut.receipt.stopped.runs_done, 1);
    const capped = go('ceiling', ['--ceiling', '0.035'], {});
    assert.equal(capped.run.status, 5, capped.run.stderr);
    assert.equal(capped.receipt.stopped.reason, 'cumulative ceiling');
    assert.equal(capped.receipt.verdict, 'STOPPED: cumulative ceiling');
    assert.equal(capped.receipt.runs[0].stop_reason, 'ceiling-projection');
    assert.ok(capped.receipt.runs[0].cost_usd <= 0.035, 'the ceiling was not exceeded by the money actually spent');
    const late = go('time', ['--wall-clock-minutes', '0'], {});
    assert.equal(late.receipt.verdict, 'STOPPED: time limit');
    assert.equal(late.receipt.totals.runs, 0);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- the rehearsal receipt (generated by the leader with the commands of the report) ----

const rehearsalFile = path.join(dir, 'rehearsal', 'campaign.json');
/** A receipt made under another confirmation hash was produced by other code: it proves nothing about the current scripts. */
function assertFreshReceipt(receipt, current = confirmationHash()) {
  assert.equal(
    receipt.confirmation_sha256,
    current,
    'the rehearsal receipt is stale (confirmation_sha256 differs from the current hash): regenerate the rehearsal',
  );
}

test('a rehearsal receipt with another confirmation hash is rejected as stale', () => {
  assert.doesNotThrow(() => assertFreshReceipt({ confirmation_sha256: confirmationHash() }));
  assert.throws(() => assertFreshReceipt({ confirmation_sha256: 'f'.repeat(64) }), /stale.*regenerate the rehearsal/);
  assert.throws(() => assertFreshReceipt({}), /regenerate the rehearsal/);
});

test('the rehearsal receipt exists, is current, covers 42 runs, box A 0/5, box B 5/5, box C 0/3 in each task, all protocol checks clean', () => {
  assert.ok(fs.existsSync(rehearsalFile), 'rehearsal/campaign.json is missing: regenerate the rehearsal');
  const receipt = JSON.parse(fs.readFileSync(rehearsalFile, 'utf8'));
  assertFreshReceipt(receipt);
  assert.equal(receipt.evidence_kind, 'fixture-rehearsal');
  assert.equal(receipt.promotion_method, 'api-rehearsal');
  assert.equal(receipt.totals.runs, 42);
  assert.equal(receipt.totals.series_runs, 39);
  assert.equal(receipt.totals.prior_spend_usd, 0);
  assert.equal(receipt.seed_recorded_before_first_call, true);
  assert.deepEqual(receipt.protocol_issues, []);
  assert.equal(receipt.artifact_scan.clean, true);
  assert.equal(receipt.database.secret_scan.clean, true);
  assert.equal(receipt.verdict, 'CRITERION MET');
  assert.equal(receipt.totals.adapter_proof_pass, 42);
  assert.deepEqual(
    receipt.analysis.per_task.map((item) => [item.promoted, item.control]),
    [
      ['5/5', '0/5'],
      ['5/5', '0/5'],
      ['5/5', '0/5'],
    ],
  );
  assert.deepEqual(
    receipt.analysis.placebo_descriptive.map((item) => item.placebo),
    ['0/3', '0/3', '0/3'],
  );
  assert.ok(receipt.runs.filter((run) => run.kind === 'pilot').every((run) => !run.protected.pass));
  assert.ok(receipt.runs.every((run) => run.measure.reason === 'ok' && run.replay.contract_residue === false));
  assert.equal(JSON.stringify(receipt).includes('"credential_sha256":'), false);
});
