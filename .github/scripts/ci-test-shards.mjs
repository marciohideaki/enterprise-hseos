// Splits the full CI suite into deterministic shards and proves the split loses nothing.
//
// The suite is `scripts.test` in package.json (a chain of `npm run ...` steps joined by `&&`) plus the kernel
// coverage run that CI executes after it. Each step is one item; items are the unit of sharding, so no command is
// ever cut in half. Placement is longest-processing-time-first over the weights in ci-test-shard-weights.json
// (unlisted items weigh 1), ties broken by position, so the same inputs always give the same shards.
//
// Usage:
//   node .github/scripts/ci-test-shards.mjs plan   --shards N [--shard I]   print the plan (or one shard, 1-based)
//   node .github/scripts/ci-test-shards.mjs run    --shards N --shard I      run one shard, every item, then report
//   node .github/scripts/ci-test-shards.mjs verify --shards N               prove union(shards) == the full suite
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeOrphans, describeSegments, loadAllowlist, runGuarded, segmentsOf } from './suite-orphans.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTRA_ITEMS = ['npm run test:kernel-coverage'];
const SEPARATOR = ' && ';

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

export function suiteItems() {
  const chain = readJson('package.json').scripts.test;
  const steps = chain.split(SEPARATOR).map((step) => step.trim());
  if (steps.includes('')) throw new Error('scripts.test has an empty step');
  return { steps, items: [...steps, ...EXTRA_ITEMS] };
}

export function planShards(items, count, weights) {
  const shards = Array.from({ length: count }, () => ({ weight: 0, items: [] }));
  const order = items
    .map((item, index) => ({ item, index, weight: weights[item] ?? 1 }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of order) {
    let target = 0;
    for (let i = 1; i < shards.length; i += 1) if (shards[i].weight < shards[target].weight) target = i;
    shards[target].items.push(entry);
    shards[target].weight += entry.weight;
  }
  for (const shard of shards) shard.items.sort((a, b) => a.index - b.index);
  return shards;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!/^--(shards|shard)$/.test(key) || rest[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${key}`);
    options[key.slice(2)] = Number(rest[i + 1]);
  }
  if (!Number.isInteger(options.shards) || options.shards < 1) throw new Error('--shards N (integer >= 1) is required');
  if ('shard' in options && !(Number.isInteger(options.shard) && options.shard >= 1 && options.shard <= options.shards)) {
    throw new Error('--shard I must be an integer between 1 and --shards');
  }
  return { command, ...options };
}

function loadPlan(count) {
  const { steps, items } = suiteItems();
  const weights = readJson('.github/scripts/ci-test-shard-weights.json');
  const stale = Object.keys(weights).filter((key) => !items.includes(key));
  if (stale.length > 0) throw new Error(`Weights name items that are not in the suite: ${stale.join(', ')}`);
  return { steps, items, shards: planShards(items, count, weights) };
}

// Mirrors is_test_file in scripts/governance/quality-gates.sh: a real test file, not a helper, fixture or journey CLI.
const TEST_FILE_PATTERNS = [
  /^test\/test-[^/]*\.(js|cjs|mjs)$/,
  /^test\/[^/]+\/test-[^/]*\.(js|cjs|mjs)$/,
  /^test\/[^/]*\.test\.(js|cjs|mjs|sh)$/,
  /^test\/[^/]+\/[^/]*\.test\.(js|cjs|mjs|sh)$/,
];
const NOT_TESTS = /^test\/(fixtures|helpers|journeys)\//;

export function isTestFile(file) {
  return !NOT_TESTS.test(file) && TEST_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

export function trackedFiles(root = ROOT) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    throw new Error(`cannot list tracked files with git, so test coverage cannot be proven: ${error.message}`);
  }
}

// The text of every script the suite items can reach: each item, then every `npm run <name>` found in it, recursively.
export function expandedSuiteText(items, scripts) {
  const seen = new Set();
  const texts = [];
  const visit = (text) => {
    texts.push(text);
    for (const match of text.matchAll(/npm run ([\w:.-]+)/g)) {
      const name = match[1];
      if (seen.has(name) || typeof scripts[name] !== 'string') continue;
      seen.add(name);
      visit(scripts[name]);
    }
  };
  for (const item of items) visit(item);
  return texts.join('\n');
}

export function loadTestAllowlist(file = path.join(ROOT, '.github/scripts/suite-test-allowlist.json')) {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [key, reason] of Object.entries(entries)) {
    if (typeof reason !== 'string' || reason.trim() === '') throw new Error(`Test allowlist entry needs a reason: ${key}`);
  }
  return entries;
}

// A path counts as referenced only as a whole token: `test/test-zz.json` must not cover `test/test-zz.js`.
export function referencesPath(text, file) {
  const escaped = file.replaceAll(/[$()*+.?[\\\]^{|}]/g, (char) => `\\${char}`);
  return new RegExp(`(?:^|[\\s'"])${escaped}(?=$|[\\s'";&|])`).test(text);
}

// Problems for every tracked test file that no suite step references; the allowlist is the only exemption.
export function testCoverageProblems({ files, items, scripts, allowlist }) {
  const text = expandedSuiteText(items, scripts);
  const tests = files.filter((file) => isTestFile(file));
  const problems = [];
  for (const file of tests) if (!referencesPath(text, file) && !(file in allowlist)) problems.push(`not run by any suite step: ${file}`);
  for (const key of Object.keys(allowlist)) {
    if (!files.includes(key)) problems.push(`test allowlist names a file that is not tracked: ${key}`);
    else if (referencesPath(text, key)) problems.push(`test allowlist names a file that a suite step already runs: ${key}`);
  }
  return { problems, count: tests.length };
}

function verify(count) {
  const { steps, items, shards } = loadPlan(count);
  const placed = shards.flatMap((shard) => shard.items.map((entry) => entry.item));
  const problems = [];
  if (new Set(items).size !== items.length) problems.push('the suite lists the same command twice');
  if (placed.length !== new Set(placed).size) problems.push('an item is placed in more than one shard');
  for (const item of items) if (!placed.includes(item)) problems.push(`not covered by any shard: ${item}`);
  for (const item of placed) if (!items.includes(item)) problems.push(`shard runs something outside the suite: ${item}`);
  for (const [i, shard] of shards.entries()) if (shard.items.length === 0) problems.push(`shard ${i + 1} is empty`);
  // The npm test chain, rebuilt from the items, must be exactly the script that `npm test` runs locally.
  const rebuilt = items.slice(0, steps.length).join(SEPARATOR);
  if (rebuilt !== readJson('package.json').scripts.test) problems.push('items do not rebuild scripts.test');
  const coverage = testCoverageProblems({
    files: trackedFiles(),
    items,
    scripts: readJson('package.json').scripts,
    allowlist: loadTestAllowlist(),
  });
  problems.push(...coverage.problems);
  if (problems.length > 0) {
    throw new Error(problems.map((problem) => `FAIL ${problem}`).join('\n'));
  }
  console.log(
    `OK ${items.length} items (${steps.length} from scripts.test + ${EXTRA_ITEMS.length} extra) covered once across ${count} shards; ${coverage.count} test files each run by a suite step`,
  );
}

// Runs the segments of one item in order, stopping at the first failure like `&&` would. Each segment is supervised:
// a descendant still alive when it ends is killed and fails the item, naming the segment and the orphans.
export function runItem(item, { root = ROOT, allowlist = loadAllowlist(), settleMs, log = console.log } = {}) {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const segments = segmentsOf(item, scripts);
  for (const [index, segment] of segments.entries()) {
    const result = runGuarded(segment, { cwd: root, allowlist, settleMs, pathPrepend: path.join(root, 'node_modules', '.bin') });
    if (result.allowed.length > 0) log(`allowlisted long-lived processes after: ${segment}`);
    if (result.orphans.length > 0) {
      log(describeOrphans(segment, result.orphans));
      log(describeSegments(item, segments, index, scripts).join('\n'));
      return { ok: false };
    }
    if (result.status !== 0) {
      log(describeSegments(item, segments, index, scripts).join('\n'));
      return { ok: false };
    }
  }
  return { ok: true };
}

function run(count, index) {
  const { shards } = loadPlan(count);
  const shard = shards[index - 1];
  const results = [];
  for (const { item } of shard.items) {
    console.log(`::group::${item}`);
    const started = Date.now();
    const outcome = runItem(item);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log('::endgroup::');
    const ok = outcome.ok;
    results.push({ item, seconds, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${seconds}s ${item}`);
  }
  const total = results.reduce((sum, result) => sum + result.seconds, 0);
  const lines = [
    `### Shard ${index}/${count}: ${total}s`,
    '',
    '| seconds | result | item |',
    '| ---: | --- | --- |',
    ...results.map((result) => `| ${result.seconds} | ${result.ok ? 'pass' : 'FAIL'} | \`${result.item}\` |`),
  ];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    throw new Error(`${failed.length} item(s) failed in shard ${index}/${count}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { command, shards, shard } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'verify': {
      verify(shards);
      break;
    }
    case 'run': {
      if (shard === undefined) throw new Error('run needs --shard I');
      run(shards, shard);
      break;
    }
    case 'plan': {
      const { shards: plan } = loadPlan(shards);
      for (const [i, entry] of plan.entries()) {
        if (shard !== undefined && shard !== i + 1) continue;
        console.log(`shard ${i + 1}/${shards} weight=${entry.weight} items=${entry.items.length}`);
        for (const { item, weight } of entry.items) console.log(`  [${weight}] ${item}`);
      }
      break;
    }
    default: {
      throw new Error('Usage: ci-test-shards.mjs <plan|run|verify> --shards N [--shard I]');
    }
  }
}
