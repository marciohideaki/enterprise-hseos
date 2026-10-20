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
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (problems.length > 0) {
    throw new Error(problems.map((problem) => `FAIL ${problem}`).join('\n'));
  }
  console.log(
    `OK ${items.length} items (${steps.length} from scripts.test + ${EXTRA_ITEMS.length} extra) covered once across ${count} shards`,
  );
}

function run(count, index) {
  const { shards } = loadPlan(count);
  const shard = shards[index - 1];
  const results = [];
  for (const { item } of shard.items) {
    console.log(`::group::${item}`);
    const started = Date.now();
    const child = spawnSync('bash', ['-c', item], { cwd: ROOT, stdio: 'inherit' });
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log('::endgroup::');
    const ok = child.status === 0;
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
