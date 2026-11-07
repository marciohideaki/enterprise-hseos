'use strict';
// Mutation rehearsal of the round-1 corrections: each correction is undone in a COPY of the campaign tree under $TMPDIR and the
// matching check must then fail (the mutant is "killed"); on the untouched copy the same check must pass.
// usage: node f15l2-mutations.cjs <repo-root> <out.json>      (exit 0 only when every mutant is killed and every baseline passes)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { runCases } = require('./f15l2-failure-paths.cjs');

const HERE = __dirname;
const TMP = process.env.TMPDIR || os.tmpdir();

function copyTree(sandbox) {
  const evidence = path.join(sandbox, 'evidence');
  fs.mkdirSync(evidence);
  execFileSync('cp', ['-r', HERE, path.join(evidence, 'stab3-f15l2')]);
  fs.rmSync(path.join(evidence, 'stab3-f15l2', 'rehearsal'), { recursive: true, force: true });
  execFileSync('cp', ['-r', path.join(HERE, '../shared'), path.join(evidence, 'shared')]);
  return path.join(evidence, 'stab3-f15l2');
}

function mutate(dir, file, from, to) {
  const target = path.join(dir, file);
  const before = fs.readFileSync(target, 'utf8');
  if (!before.includes(from)) throw new Error(`mutation anchor not found in ${file}: ${from.slice(0, 50)}`);
  fs.writeFileSync(target, before.replace(from, to));
}

const caseOk =
  (key, name) =>
  async ({ dir, root, work }) => {
    const cases = await runCases({ root, work, only: [key], scriptDir: dir });
    const found = cases.find((item) => item.case.startsWith(name)) ?? cases[0];
    return found?.ok === true;
  };

const MUTATIONS = [
  {
    id: 'M1-pre-call-budget-check',
    item: 1,
    file: 'f15l2-guard.cjs',
    from: 'spend.spent_usd + spend.pending_usd + worst > limitUsd',
    to: 'false',
    check: caseOk('per-request', 'per-request-cap'),
  },
  {
    id: 'M2-price-validation',
    item: 2,
    file: 'f15l2.cjs',
    from: 'if (!lib.validatePrice(options.price))',
    to: 'if (false)',
    check: caseOk('price', 'price-invalid'),
  },
  {
    id: 'M3a-not-sse-or-unreadable-usage-stops',
    item: 3,
    file: 'f15l2-guard.cjs',
    from: "if (cost === null) unreadable(worst, isSse && result.status === 200 ? 'usage-unreadable' : 'response-not-sse');",
    to: 'if (false) unreadable(worst);',
    check: caseOk('non-sse', 'non-sse'),
  },
  {
    id: 'M3b-cli-timeout-booked-and-stops',
    item: 3,
    file: 'f15l2.cjs',
    from: "fs.writeFileSync(STOP_FILE, JSON.stringify({ reason: 'cli-timeout'",
    to: "fs.writeFileSync(path.join(OUT, 'ignored.json'), JSON.stringify({ reason: 'cli-timeout'",
    check: caseOk('timeout', 'cli-timeout'),
  },
  {
    id: 'M4-fingerprint-omits-whole-file-check',
    item: 4,
    file: 'f15l2.cjs',
    from: "  path.join(SHARED, 'whole-file-check.cjs'),\n",
    to: '',
    check: async (context) => fingerprintChanges(context, '../shared/whole-file-check.cjs'),
  },
  {
    id: 'M5a-secret-hash-not-searched',
    item: 6,
    file: 'f15l2-lib.cjs',
    from: 'for (const hash of allowHashes) if (hash && text.includes(hash))',
    to: 'for (const hash of []) if (hash && text.includes(hash))',
    check: async ({ dir }) => hashFound(dir),
  },
  {
    id: 'M5b-final-sweep-after-summary-removed',
    item: 6,
    file: 'f15l2.cjs',
    from: "write(path.join(OUT, 'secret-sweep.json'",
    to: "write(path.join(OUT, 'secret-sweep.ignored.json'",
    check: async ({ dir, root, work }) => sweepAfterSummary(dir, root, work),
  },
  {
    id: 'M6-signal-handler-not-installed',
    item: 7,
    file: 'f15l2.cjs',
    from: 'for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);',
    to: '',
    check: caseOk('sigterm', 'sigterm'),
  },
  {
    id: 'M7-podman-no-cap-drop',
    item: 8,
    file: 'f15l2-lib.cjs',
    from: "    '--cap-drop=ALL',\n",
    to: '',
    check: async ({ dir }) => podmanFlags(dir),
  },
  {
    id: 'M8-reference-log-mixed-with-journey',
    item: 'minor',
    file: 'f15l2.cjs',
    from: "const refDir = path.join(dir, 'reference');",
    to: 'const refDir = dir;',
    check: async ({ dir, root, work }) => logsSeparate(dir, root, work),
  },
  {
    id: 'M10-decisive-failure-hidden-as-INCOMPLETE',
    item: 'R2-1',
    file: 'f15l2-lib.cjs',
    from: "verdict: impossible ? 'fail' : 'INCOMPLETE',",
    to: "verdict: 'INCOMPLETE',",
    check: async ({ dir }) => incompleteVerdicts(dir),
  },
  {
    id: 'M11-timeout-books-the-wrong-window',
    item: 'R2-2',
    file: 'f15l2.cjs',
    from: 'windowTokens, maxTokens: PLAN.max_output_tokens, price: PRICE });',
    to: 'windowTokens: PLAN.declared_window_tokens, maxTokens: PLAN.max_output_tokens, price: PRICE });',
    check: caseOk('timeout', 'cli-timeout'),
  },
  {
    id: 'M12-fingerprint-omits-the-product-files',
    item: 'R2-3',
    file: 'f15l2.cjs',
    from: '...PRODUCT_FILES.map((file) => path.join(root, file))',
    to: '',
    check: async (context) => fingerprintChanges(context, 'tools/cli/lib/engineering-model.js', true),
  },
  {
    id: 'M13-test-mode-may-still-reach-the-real-origin',
    item: 'R2-4',
    file: 'f15l2-guard.cjs',
    from: 'const isReal = TEST_MODE ? target.startsWith(TEST_ORIGIN) : target.startsWith(REAL_ORIGIN);',
    to: 'const isReal = target.startsWith(REAL_ORIGIN) || (TEST_MODE && target.startsWith(TEST_ORIGIN));',
    check: caseOk('test-mode', 'test-mode'),
  },
  {
    id: 'M9-incomplete-verdict-removed',
    item: 5,
    file: 'f15l2-lib.cjs',
    from: 'if (Number.isInteger(n) && runs.length < n)',
    to: 'if (false)',
    check: async ({ dir }) => incomplete(dir),
  },
];

const PRODUCT = [
  'tools/cli/lib/engineering-model.js',
  'tools/cli/lib/provider-api-adapter.js',
  'tools/cli/lib/engineering-task-runtime.js',
];

/** A root that holds copies of the product files the fingerprint covers, so the check can touch them without touching the repository. */
function productRoot(base, root) {
  const copy = path.join(base, 'product-root');
  for (const file of PRODUCT) {
    fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(copy, file));
  }
  return copy;
}
function fingerprintOf(dir, productDir) {
  return JSON.parse(spawnSync(process.execPath, [path.join(dir, 'f15l2.cjs'), '--fingerprint', productDir], { encoding: 'utf8' }).stdout)
    .campaign_sha256;
}
/** True when touching `relative` (under the campaign dir) or a product copy changes the fingerprint. */
function fingerprintChanges({ dir, root, work }, relative, product = false) {
  fs.mkdirSync(work, { recursive: true });
  const productDir = productRoot(work, root);
  const before = fingerprintOf(dir, productDir);
  fs.appendFileSync(product ? path.join(productDir, relative) : path.join(dir, relative), '\n// touched\n');
  return fingerprintOf(dir, productDir) !== before;
}
function incompleteVerdicts(dir) {
  const lib = require(path.join(dir, 'f15l2-lib.cjs'));
  const rule = { role: 'criterion', min_stage: 4, lineage_required: 5, n: 5 };
  const run = (fail) => ({
    stages: Object.fromEntries(lib.STAGES.map((stage) => [stage, stage !== fail])),
    lineage: Object.fromEntries(lib.LINEAGE_KEYS.map((key) => [key, true])),
  });
  const decisive = lib.evaluateSeries([run('whole_file_pass'), run('whole_file_pass')], rule).verdict === 'fail';
  const reachable = lib.evaluateSeries([run('whole_file_pass'), run(null)], rule).verdict === 'INCOMPLETE';
  return decisive && reachable;
}
function hashFound(dir) {
  const lib = require(path.join(dir, 'f15l2-lib.cjs'));
  const work = fs.mkdtempSync(path.join(TMP, 'f15l2-mut-hash-'));
  try {
    const hash = 'b2'.repeat(32);
    fs.writeFileSync(path.join(work, 'run.json'), hash);
    return lib.scanSecrets([work], 'k', { allowHashes: [hash] }).clean === false;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
function podmanFlags(dir) {
  const args = require(path.join(dir, 'f15l2-lib.cjs')).podmanArgs({ image: 'i', name: 'n', bundle: '/b', caseDir: '/c' });
  return (
    ['--cap-drop=ALL', '--network=none', '--read-only'].every((flag) => args.includes(flag)) &&
    args.includes('--user') &&
    args.includes('--pids-limit') &&
    args.includes('no-new-privileges')
  );
}
function incomplete(dir) {
  const lib = require(path.join(dir, 'f15l2-lib.cjs'));
  return lib.evaluateSeries([], { role: 'criterion', min_stage: 4, lineage_required: 5, n: 5 }).verdict === 'INCOMPLETE';
}
function oneRun(dir, root, work) {
  const out = path.join(work, 'one-run');
  const result = spawnSync(process.execPath, [path.join(dir, 'f15l2.cjs'), root, 'fixture', out, '--runs', '1'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, TMPDIR: TMP },
  });
  return { out, status: result.status };
}
function sweepAfterSummary(dir, root, work) {
  const { out } = oneRun(dir, root, work);
  const sweep = path.join(out, 'secret-sweep.json');
  const summary = path.join(out, 'summary.json');
  return fs.existsSync(sweep) && fs.existsSync(summary) && fs.statSync(sweep).mtimeMs >= fs.statSync(summary).mtimeMs;
}
function logsSeparate(dir, root, work) {
  const { out } = oneRun(dir, root, work);
  const run = JSON.parse(fs.readFileSync(path.join(out, 'runs/t2800-1/run.json'), 'utf8'));
  const refLog = path.join(out, 'runs/t2800-1/reference/provider-requests.jsonl');
  return fs.existsSync(refLog) && run.requests_by_dir?.reference > 0 && run.requests_by_dir.reference !== run.requests;
}

async function main(root, outFile, only = null) {
  const results = [];
  const base = fs.mkdtempSync(path.join(TMP, 'f15m-'));
  try {
    for (const [index, mutation] of MUTATIONS.entries()) {
      if (only && !only.some((prefix) => mutation.id.startsWith(prefix))) continue;
      // Short names on purpose: the product's provider broker listens on a unix socket under TMPDIR, whose path has a hard length limit.
      const baseline = path.join(base, `b${index}`);
      const mutant = path.join(base, `m${index}`);
      fs.mkdirSync(baseline);
      fs.mkdirSync(mutant);
      const baselineDir = copyTree(baseline);
      const mutantDir = copyTree(mutant);
      mutate(mutantDir, mutation.file, mutation.from, mutation.to);
      const baselinePasses = (await mutation.check({ dir: baselineDir, root, work: path.join(baseline, 'w') })) === true;
      const mutantPasses = (await mutation.check({ dir: mutantDir, root, work: path.join(mutant, 'w') })) === true;
      results.push({
        id: mutation.id,
        correction: mutation.item,
        file: mutation.file,
        baseline_passes: baselinePasses,
        mutant_passes: mutantPasses,
        killed: baselinePasses && !mutantPasses,
      });
      fs.rmSync(baseline, { recursive: true, force: true });
      fs.rmSync(mutant, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  fs.writeFileSync(
    outFile,
    `${JSON.stringify({ ok: results.every((item) => item.killed), mutants: results.length, killed: results.filter((item) => item.killed).length, results }, null, 2)}\n`,
  );
  process.exitCode = results.every((item) => item.killed) ? 0 : 1;
}

if (require.main === module) {
  const [root, outFile, only] = process.argv.slice(2);
  if (!root || !outFile) throw new Error('usage: node f15l2-mutations.cjs <repo-root> <out.json> [id-prefix,...]');
  main(root, outFile, only ? only.split(',') : null).catch((error) => {
    process.stderr.write(`${String(error.message).slice(0, 300)}\n`);
    process.exitCode = 1;
  });
}
