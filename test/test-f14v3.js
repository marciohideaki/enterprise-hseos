'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const dir = process.env.F14V3_DIR || path.join(__dirname, '..', 'docs', 'evolution', 'w3', 'evidence', 'stab3-f14v3');
const repoRoot = path.join(__dirname, '..');
const { stratifiedExactTest, evaluateCriterion } = require(path.join(dir, 'stats.cjs'));
const { PLAN, buildSchedule, budgetDecision, costUsd, validateRealPrice, projectCallUsd, interruptedCallUsd } = require(
  path.join(dir, 'plan.cjs'),
);
const { TASKS, runFilter, runProtected } = require(path.join(dir, 'tasks.cjs'));
const { scanFile } = require(path.join(dir, 'secret-scan.cjs'));
const { publicProof, analyse } = require(path.join(dir, 'f14v3.cjs'));

const strata = (promoted, control) =>
  ['a', 'b', 'c'].map((id) => ({ id, promoted: { n: 5, successes: promoted }, control: { n: 5, successes: control } }));

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

test('the test is stratified: identical pooled counts give different p when the margins differ', () => {
  const stratified = stratifiedExactTest([
    { id: 'a', promoted: { n: 5, successes: 5 }, control: { n: 5, successes: 5 } },
    { id: 'b', promoted: { n: 5, successes: 0 }, control: { n: 5, successes: 0 } },
  ]);
  assert.equal(stratified.p, 1, 'tasks with no contrast carry no evidence, however the runs pool');
});

test('stratified test rejects malformed cells', () => {
  assert.throws(() => stratifiedExactTest([{ id: 'a', promoted: { n: 5, successes: 6 }, control: { n: 5, successes: 0 } }]), TypeError);
  assert.throws(() => stratifiedExactTest([]), TypeError);
});

test('filter (i): the naive reference fails the protected tests and the correct one passes, on all three tasks', () => {
  const filter = runFilter();
  assert.equal(filter.tasks.length, 3);
  for (const item of filter.tasks) {
    assert.equal(item.naive.pass, false, `${item.id}: naive must fail`);
    assert.ok(item.naive.failed.length > 0);
    assert.equal(item.correct.pass, true, `${item.id}: correct must pass`);
    assert.equal(item.stub_fails, true);
  }
  assert.equal(filter.accepted, true);
});

test('protected tests catch a missing throw and a loader failure', () => {
  const retry = TASKS.find((task) => task.id === 'retry');
  const noThrow = runProtected(retry, 'module.exports = (a) => (a === 1 ? 250 : a < 5 ? (a === 4 ? 5000 : 1000) : null);\n');
  assert.deepEqual(noThrow.failed.sort(), ['fraction', 'string', 'zero']);
  assert.equal(runProtected(retry, 'throw new Error("x");\n').pass, false);
});

test('the requirement never cites the rule or the memory', () => {
  for (const task of TASKS) {
    assert.match(task.requirement, /project convention/);
    assert.doesNotMatch(task.requirement, /memory|note|base 36|billing|exponential|mod 7/i);
    assert.ok(task.verifier_checks.length > 0 && task.verifier_checks.every((item) => item.expected !== undefined));
  }
});

test('schedule is deterministic, balanced 5 x 5 per task and interleaved', () => {
  const schedule = buildSchedule('seed-a');
  assert.deepEqual(schedule, buildSchedule('seed-a'));
  assert.notDeepEqual(
    schedule.map((item) => `${item.task}${item.condition}`),
    buildSchedule('seed-b').map((item) => `${item.task}${item.condition}`),
  );
  assert.equal(schedule.length, 30);
  for (const task of PLAN.tasks) {
    const runs = schedule.filter((item) => item.task === task.id);
    assert.equal(runs.filter((item) => item.condition === 'control').length, 5);
    assert.equal(runs.filter((item) => item.condition === 'promoted').length, 5);
  }
  const lengths = [];
  for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6']) {
    const first = buildSchedule(seed)
      .slice(0, 10)
      .map((item) => item.condition);
    lengths.push(first.join(''));
  }
  assert.ok(new Set(lengths).size > 1, 'order depends on the seed');
});

test('cost and stop rule: stop at 80% of the US$ 3 ceiling', () => {
  assert.equal(budgetDecision(2.39).stop, false);
  assert.equal(budgetDecision(2.4).stop, true);
  assert.ok(
    Math.abs(costUsd({ prompt_tokens: 1_000_000, completion_tokens: 100_000 }, { priceInPerMillion: 2.5, priceOutPerMillion: 10 }) - 3.5) <
      1e-9,
  );
});

test('PLAN.json is the registered plan and the seed is still to be drawn', () => {
  const registered = JSON.parse(fs.readFileSync(path.join(dir, 'PLAN.json'), 'utf8'));
  assert.deepEqual(registered, structuredClone(PLAN));
  assert.equal(registered.seed.value, null);
  assert.equal(registered.total_runs, 33);
  assert.equal(registered.model, 'gpt-4o');
  assert.equal(registered.budget.ceiling_usd, 3);
});

test('analysis uses the task as the unit and refuses an incomplete series', () => {
  assert.equal(analyse([]).complete, false);
  const rows = [];
  for (const task of TASKS)
    for (const condition of ['control', 'promoted'])
      for (let rep = 0; rep < 5; rep += 1)
        rows.push({ kind: 'series', task: task.id, condition, success: condition === 'promoted' ? rep < 4 : rep < 1 });
  assert.equal(analyse(rows).p.toFixed(4), '0.0041');
});

test('the public proof drops the credential hash', () => {
  const hash = 'a'.repeat(64);
  const shown = publicProof({ x: { provider_proof: { backend_verified: true, credential_sha256: hash, requests_total: 1 } } });
  assert.equal(JSON.stringify(shown).includes(hash), false);
  assert.equal(shown.proof.credential_sha256_present, true);
});

test('secret scan flags a credential and an exact literal, and passes clean text', () => {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f14v3-scan-'));
  try {
    const clean = path.join(scratch, 'clean.txt');
    const dirty = path.join(scratch, 'dirty.txt');
    fs.writeFileSync(clean, 'ordinary project text about invoices and retries\n'.repeat(20));
    fs.writeFileSync(dirty, `header\napi_key = sk-${'A1b2C3d4E5'.repeat(4)}\n`);
    assert.equal(scanFile(clean).clean, true);
    assert.equal(scanFile(dirty).clean, false);
    assert.equal(scanFile(clean, { literals: ['ordinary project'] }).clean, false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the guard refuses every real destination and any other host while offline', () => {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f14v3-guard-'));
  try {
    const probe = (mode, url, extra = {}) => {
      const run = spawnSync(
        process.execPath,
        [
          '--require',
          path.join(dir, 'guard.cjs'),
          '-e',
          `fetch(${JSON.stringify(url)}, { method: 'POST', body: '{"model":"m","messages":[]}' }).then(() => process.stdout.write('ALLOWED'), (e) => process.stdout.write(e.code || 'ERR'))`,
        ],
        { encoding: 'utf8', env: { PATH: process.env.PATH, F14V3_MODE: mode, C9_DIR: scratch, ...extra }, timeout: 20_000 },
      );
      return run.stdout;
    };
    assert.equal(probe('mock', 'https://api.openai.com/v1/chat/completions', { F14V3_OFFLINE: '1' }), 'F14V3_REAL_DESTINATION_REFUSED');
    assert.equal(probe('real', 'https://api.openai.com/v1/chat/completions', { F14V3_OFFLINE: '1' }), 'F14V3_REAL_DESTINATION_REFUSED');
    assert.equal(probe('mock', 'https://example.com/'), 'F14V3_DESTINATION_REFUSED');
    assert.equal(probe('real', 'https://mock.invalid/v1/chat/completions'), 'F14V3_DESTINATION_REFUSED');
    assert.equal(fs.existsSync(path.join(scratch, 'request-count.txt')), false, 'a refused destination is not counted as a request');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the rehearsal receipt covers 33 runs with all protocol checks clean', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'rehearsal', 'campaign.json'), 'utf8'));
  assert.equal(receipt.evidence_kind, 'fixture-rehearsal');
  assert.equal(receipt.totals.runs, 33);
  assert.equal(receipt.totals.series_runs, 30);
  assert.equal(receipt.seed_recorded_before_first_call, true);
  assert.deepEqual(receipt.protocol_issues, []);
  assert.equal(receipt.artifact_scan.clean, true);
  assert.equal(receipt.database.secret_scan.clean, true);
  assert.equal(receipt.database.in_repository, false);
  assert.equal(JSON.stringify(receipt).includes('"credential_sha256":'), false);
});

// ---- cost failure paths (round 1): price, non-SSE response, timeout and per-request ceiling ----

const tmpBase = () => process.env.TMPDIR || os.tmpdir();

/** An activated project database fixture, so the campaign can run end to end without the real one. */
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

function campaign(args, env = {}) {
  const run = spawnSync(process.execPath, [path.join(dir, 'f14v3.cjs'), 'campaign', '--root', repoRoot, ...args], {
    encoding: 'utf8',
    timeout: 240_000,
    env: { PATH: process.env.PATH, TMPDIR: tmpBase(), F14V3_OFFLINE: '1', ...env },
  });
  return run;
}

test('real mode aborts before any call on a missing, invalid or unregistered price', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v3-price-'));
  try {
    const out = path.join(scratch, 'out');
    for (const [flags, reason] of [
      [[], 'price-invalid'],
      [['--price-in', 'abc', '--price-out', '10'], 'price-invalid'],
      [['--price-in', '0', '--price-out', '10'], 'price-invalid'],
      [['--price-in', '-1', '--price-out', '10'], 'price-invalid'],
      [['--price-in', '2.5', '--price-out', 'Infinity'], 'price-invalid'],
      [['--price-in', '1', '--price-out', '1'], 'price-mismatch'],
    ]) {
      const run = campaign(['--mode', 'real', '--source-db', path.join(scratch, 'none.db'), '--out', out, ...flags], {
        F14V3_OPENAI_API_KEY: 'fake-key-for-test',
        F14V3_REAL_CONFIRMED: confirmationHash(),
      });
      assert.notEqual(run.status, 0, flags.join(' '));
      assert.match(run.stderr, new RegExp(reason), flags.join(' '));
      assert.equal(fs.existsSync(path.join(out, 'seed.json')), false, 'nothing starts before the price is validated');
    }
    assert.equal(validateRealPrice(2.5, 10).ok, true);
    assert.equal(validateRealPrice(Number.NaN, 10).ok, false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('failure paths of the campaign stop it: non-SSE, timeout and per-request ceiling', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v3-faults-'));
  try {
    const db = await fixtureDatabase(scratch);
    const go = (name, extra, env) => {
      const out = path.join(scratch, name);
      const run = campaign(['--mode', 'mock', '--source-db', db, '--out', out, '--seed', 'fault-test', '--pilots-only', ...extra], env);
      const receipt = fs.existsSync(path.join(out, 'campaign.json'))
        ? JSON.parse(fs.readFileSync(path.join(out, 'campaign.json'), 'utf8'))
        : null;
      return { run, receipt, out };
    };
    // A response that is not SSE: usage unreadable, the run ends, the campaign stops before the next run.
    const nonSse = go('nonsse', [], { F14V3_MOCK_FAULT: 'nonsse' });
    assert.equal(nonSse.run.status, 6, nonSse.run.stderr);
    assert.equal(nonSse.receipt.totals.runs, 1, 'the next pilot must not start');
    assert.equal(nonSse.receipt.runs[0].stop_reason, 'usage-unreadable');
    assert.equal(nonSse.receipt.stopped.reason, 'usage-unreadable');
    assert.ok(nonSse.receipt.runs[0].cost_usd > 0, 'the unreadable call is charged at the worst-case projection');
    // A request cut by the timeout is charged pessimistically and written to the log.
    const cut = go('hang', ['--run-timeout-ms', '9000'], { F14V3_MOCK_FAULT: 'hang' });
    assert.equal(cut.receipt.runs[0].interrupted_request, true);
    const floor = interruptedCallUsd(cut.receipt.runs[0].usage.requests ? 1024 : 1024, { priceInPerMillion: 2.5, priceOutPerMillion: 10 });
    assert.ok(cut.receipt.runs[0].cost_usd >= floor - 1e-9, `charged ${cut.receipt.runs[0].cost_usd}, floor ${floor}`);
    const log = fs.readFileSync(path.join(cut.out, 'runs', 'pilot-invoice', 'provider-requests.jsonl'), 'utf8');
    assert.match(log, /"interrupted":true/);
    assert.equal(cut.run.status, 1, 'the interrupted run leaves unreadable usage: the campaign does not pass');
    // Per-request ceiling: the projection overflows in the MIDDLE of a run, between two requests of the same execution.
    const capped = go('ceiling', ['--ceiling', '0.04'], {});
    assert.equal(capped.run.status, 5, capped.run.stderr);
    assert.equal(capped.receipt.stopped.reason, 'ceiling-projection');
    assert.equal(capped.receipt.totals.runs, 1);
    const first = capped.receipt.runs[0];
    assert.ok(first.usage.requests >= 1 && first.usage.requests < 5, `stopped mid-run after ${first.usage.requests} requests`);
    assert.ok(first.refusal.spent_usd + first.refusal.projected_usd > 0.04);
    assert.ok(first.cost_usd <= 0.04, 'the ceiling was not exceeded by the money actually spent');
    // pilots only is not a verdict on the hypothesis
    const ok = go('pilots', [], {});
    assert.equal(ok.run.status, 0, ok.run.stderr);
    assert.match(ok.receipt.verdict, /^NOT EVALUATED/);
    assert.equal(ok.receipt.database.kind, 'fixture-copy');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('worst-case projection uses the real body size and max_tokens', () => {
  const prices = { priceInPerMillion: 2.5, priceOutPerMillion: 10 };
  assert.ok(Math.abs(projectCallUsd(3000, 1000, prices) - (1000 * 2.5 + 1000 * 10) / 1_000_000) < 1e-12);
  assert.ok(projectCallUsd(30_000, 1000, prices) > projectCallUsd(3000, 1000, prices));
  assert.ok(interruptedCallUsd(1024, prices) > 0.25);
  assert.equal(PLAN.budget.max_requests_per_run, 8);
});

// ---- round 2: confirmation gate and fail-closed guard ----

const { GATED_FILES, confirmationHash } = require(path.join(dir, 'confirmation.cjs'));

function printConfirmation(scriptDir) {
  const run = spawnSync(process.execPath, [path.join(scriptDir, 'f14v3.cjs'), '--print-confirmation'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, TMPDIR: tmpBase() },
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

/** A copy of the campaign directory (and its sibling `shared`) under $TMPDIR, so a byte can be changed without touching the repository. */
function copyCampaign(scratch) {
  const evidence = path.join(scratch, 'docs', 'evolution', 'w3', 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  spawnSync('cp', ['-r', dir, path.join(evidence, 'stab3-f14v3')], { stdio: 'ignore' });
  spawnSync('cp', ['-r', path.join(dir, '..', 'shared'), path.join(evidence, 'shared')], { stdio: 'ignore' });
  fs.symlinkSync(path.join(repoRoot, 'tools'), path.join(scratch, 'tools'));
  return path.join(evidence, 'stab3-f14v3');
}

test('the confirmation hash changes with one byte of any gated file, the plan, the prices or the protected cases', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v3-confirm-'));
  try {
    const copy = copyCampaign(scratch);
    const baseline = printConfirmation(copy);
    assert.equal(baseline, confirmationHash());
    assert.match(baseline, /^[0-9a-f]{64}$/);
    const required = ['f14v3.cjs', 'guard.cjs', 'stats.cjs', 'protected-runner.cjs', 'tasks.cjs', 'plan.cjs', 'secret-scan.cjs'];
    for (const name of required) assert.ok(GATED_FILES.includes(name), `${name} must be listed in the gate`);
    for (const name of new Set([...required, ...GATED_FILES])) {
      const file = path.join(copy, name);
      const original = fs.readFileSync(file);
      fs.appendFileSync(file, name.endsWith('.txt') ? ' ' : '\n// one byte more\n');
      assert.notEqual(printConfirmation(copy), baseline, `${name} must be covered`);
      fs.writeFileSync(file, original);
    }
    assert.equal(printConfirmation(copy), baseline, 'restored files give the same hash');
    // The rehearsal is a result, not a decision: it is not covered.
    fs.appendFileSync(path.join(copy, 'rehearsal', 'campaign.json'), ' ');
    assert.equal(printConfirmation(copy), baseline);
    // Plan, prices and protected cases, through the overrides.
    const plan = structuredClone(PLAN);
    plan.budget.ceiling_usd = 4;
    assert.notEqual(confirmationHash({ plan }), baseline, 'plan');
    const priced = structuredClone(PLAN);
    priced.budget.price_usd_per_million.out = 11;
    assert.notEqual(confirmationHash({ plan: priced }), baseline, 'prices');
    const tasks = structuredClone(TASKS);
    tasks[1].cases[0].expected = 251;
    assert.notEqual(confirmationHash({ tasks }), baseline, 'protected cases');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('real mode is BLOCKED without the matching confirmation, before any call', () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v3-block-'));
  try {
    const out = path.join(scratch, 'out');
    const args = ['--mode', 'real', '--source-db', path.join(scratch, 'none.db'), '--out', out, '--price-in', '2.5', '--price-out', '10'];
    for (const confirmed of [undefined, '', 'x'.repeat(64), `${confirmationHash()} `]) {
      const run = campaign(args, {
        F14V3_OPENAI_API_KEY: 'fake-key-for-test',
        ...(confirmed === undefined ? {} : { F14V3_REAL_CONFIRMED: confirmed }),
      });
      assert.equal(run.status, 3, `confirmation ${JSON.stringify(confirmed)}`);
      assert.match(run.stderr, /BLOCKED/);
      assert.equal(fs.existsSync(out), false, 'nothing starts');
    }
    // With the right value the gate opens (this run then stops on the missing database, still without any call).
    const open = campaign(args, { F14V3_OPENAI_API_KEY: 'fake-key-for-test', F14V3_REAL_CONFIRMED: confirmationHash() });
    assert.doesNotMatch(open.stderr, /BLOCKED/);
    assert.notEqual(open.status, 3);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the guard fails closed on its own: empty price, bad max_tokens, zero usage with content', async () => {
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v3-closed-'));
  try {
    const probe = (extra, body) => {
      fs.rmSync(path.join(scratch, 'request-count.txt'), { force: true });
      const run = spawnSync(
        process.execPath,
        [
          '--require',
          path.join(dir, 'guard.cjs'),
          '-e',
          `fetch('https://mock.invalid/v1/chat/completions', { method: 'POST', body: ${JSON.stringify(JSON.stringify(body))} }).then(() => process.stdout.write('ALLOWED'), (e) => process.stdout.write(e.code || 'ERR'))`,
        ],
        {
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            F14V3_MODE: 'mock',
            F14V3_OFFLINE: '1',
            C9_DIR: scratch,
            F14V3_PRICE_IN: '2.5',
            F14V3_PRICE_OUT: '10',
            F14V3_CEILING_USD: '3',
            ...extra,
          },
          timeout: 20_000,
        },
      );
      return run.stdout;
    };
    const ok = { model: 'm', messages: [], max_tokens: 1024 };
    assert.equal(probe({}, ok), 'ALLOWED');
    assert.equal(probe({ F14V3_PRICE_IN: '' }, ok), 'F14V3_PRICE_INVALID');
    assert.equal(probe({ F14V3_PRICE_OUT: 'abc' }, ok), 'F14V3_PRICE_INVALID');
    assert.equal(probe({ F14V3_CEILING_USD: '' }, ok), 'F14V3_CEILING_INVALID');
    assert.equal(probe({}, { model: 'm', messages: [] }), 'F14V3_MAX_TOKENS_INVALID');
    assert.equal(probe({}, { ...ok, max_tokens: 0 }), 'F14V3_MAX_TOKENS_INVALID');
    assert.equal(probe({}, { ...ok, max_tokens: '1024' }), 'F14V3_MAX_TOKENS_INVALID');
    // Zero usage on a response that carries content ends the campaign as usage-unreadable.
    const db = await fixtureDatabase(scratch);
    const out = path.join(scratch, 'zero');
    const run = campaign(['--mode', 'mock', '--source-db', db, '--out', out, '--seed', 'zero-test', '--pilots-only'], {
      F14V3_MOCK_FAULT: 'zerousage',
    });
    assert.equal(run.status, 6, run.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(out, 'campaign.json'), 'utf8'));
    assert.equal(receipt.totals.runs, 1);
    assert.equal(receipt.runs[0].stop_reason, 'usage-unreadable');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
