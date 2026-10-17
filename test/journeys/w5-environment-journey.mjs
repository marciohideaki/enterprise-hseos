// HSEOS W5 environment journey (W5-11b): the installed core and the five capability packs, used on two real
// consumers outside the checkout. Consumer A (cambio-real platform-web) carries a real test and an injected defect and
// is the main proof; consumer B (axon-web) carries a SYNTHETIC test and defect and is a second UI proof only.
//
//   node test/journeys/w5-environment-journey.mjs --prefix <empty install dir> --consumer <A source> \
//        --second-consumer <B source> --assert-receipts [--evidence <dir>] [--only a,b] [--max-load 6] [--keep-work]
//
// Cost rule: dispatches go local, then subscription (<= 3 per binding), then paid API (<= US$ 1). A dispatch happens
// only when --allow-dispatch AND HSEOS_W5_DISPATCH_BINDING are both present; otherwise that step is BLOCKED. The
// consumers' originals are read-only: every action runs on a disposable clone under $TMPDIR.
//
// Every step records PASS | FAIL | BLOCKED. BLOCKED is never turned into PASS; a mock never stands in for a model.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);
const usage =
  'usage: w5-environment-journey.mjs --prefix <empty install dir> --consumer <A> --second-consumer <B> --assert-receipts [--evidence dir] [--only ids] [--max-load n] [--keep-work] [--allow-dispatch]';
if (!opt('prefix') || !opt('consumer') || !opt('second-consumer')) {
  console.error(usage);
  process.exit(2);
}
const PREFIX = path.resolve(opt('prefix'));
const CONSUMER_SOURCES = { A: path.resolve(opt('consumer')), B: path.resolve(opt('second-consumer')) };
const EVIDENCE = path.resolve(opt('evidence', path.join(REPO_ROOT, 'docs', 'evolution', 'w5', 'evidence', 'real')));
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
const MAX_LOAD = Number(opt('max-load', '6'));
const KEEP_WORK = flag('keep-work');
const ALLOW_DISPATCH = flag('allow-dispatch') && process.env.HSEOS_W5_DISPATCH_BINDING === 'claude';
const CACHE = process.env.HSEOS_TOOLCHAIN_CACHE || '/build/cache/hseos-toolchain';
const NPM_CACHES = {
  A: path.resolve(opt('npm-cache-a', '/build/cache/hseos-w5-consumers/npm-A')),
  B: path.resolve(opt('npm-cache-b', '/build/cache/hseos-w5-consumers/npm-B')),
};
const REPLAY_LEDGER = path.resolve(
  opt('replay-ledger', path.join(REPO_ROOT, 'docs', 'evolution', 'w5', 'evidence', 'real', 'ledger-rows.json')),
);
const MAX_CAMPAIGN_MICROUSD = 1_000_000;
const MAX_DISPATCHES_PER_BINDING = 3;
const WORK = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-w5-journey-'));
const PKG = path.join(PREFIX, 'node_modules', 'hseos');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const trim = (value, n = 600) => (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, n);

class Blocked extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}
const results = [];
const logs = [];
const state = {
  nodeModules: {},
  clones: {},
  pinned: {},
  originals: {},
  campaign: null,
  contracts: {},
  evidence: {},
  controlClones: {},
  dispatches: {},
  control: null,
};

// ---------------------------------------------------------------------------------------------- framework
const wanted = (id) => !ONLY || [...ONLY].some((prefix) => id.startsWith(prefix));

/** consumer: real or synthetic consumer steps; control: harness-patch steps; unit: self-tests; infra: everything else. */
function classify(id, consumer) {
  if (/^s0[789]c-/.test(id)) return 'control';
  if (/^(s03d|s11a)-/.test(id)) return 'unit';
  return consumer === 'A' || consumer === 'B' ? 'consumer' : 'infra';
}

async function step(id, consumer, title, fn) {
  const record = { id, consumer, title, kind: classify(id, consumer), status: 'PASS' };
  if (!wanted(id)) return null;
  const started = Date.now();
  try {
    const detail = await fn();
    if (detail?._evidence) {
      state.evidence[consumer] = detail._evidence;
      delete detail._evidence;
    }
    if (detail) record.detail = detail;
  } catch (error) {
    record.status = error instanceof Blocked ? 'BLOCKED' : 'FAIL';
    record.cause = trim(error.message ?? String(error), 900);
    if (error.detail) record.detail = error.detail;
  }
  record.duration_ms = Date.now() - started;
  results.push(record);
  console.log(`${record.status.padEnd(7)} ${id} [${consumer}] ${title}${record.cause ? ` -- ${record.cause.slice(0, 160)}` : ''}`);
  return record;
}

const statusOf = (id) => results.find((r) => r.id === id)?.status;
function needs(...ids) {
  const bad = ids.filter((id) => statusOf(id) !== 'PASS');
  if (bad.length > 0) throw new Blocked(`depends on ${bad.map((id) => `${id}=${statusOf(id) ?? 'not-run'}`).join(', ')}`);
}

function readLoad1() {
  return Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
}
async function loadGate(label) {
  const started = Date.now();
  while (readLoad1() > MAX_LOAD) {
    if (Date.now() - started > 15 * 60_000) throw new Blocked(`host load stayed above ${MAX_LOAD} for 15 min before ${label}`);
    await sleep(10_000);
  }
}

/** Run a command, keep its full output in a log (hashed into the result), return the outcome. */
function run(name, command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  const text = `$ ${[command, ...args].join(' ')}\n[exit ${result.status} signal ${result.signal}]\n--- stdout\n${result.stdout ?? ''}\n--- stderr\n${result.stderr ?? ''}\n`;
  const file = path.join(WORK, `log-${logs.length}-${name}.log`);
  fs.writeFileSync(file, text);
  logs.push({ name, file, exit: result.status, sha256: sha256(text), bytes: text.length });
  return result;
}

const requireInstalled = () => createRequire(path.join(PREFIX, 'noop.js'));
function load(relative) {
  return requireInstalled()(path.join(PKG, relative));
}

function hashTree(directory) {
  const hash = createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      hash.update(`${path.relative(directory, full)}\0`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(fs.readFileSync(full));
    }
  };
  walk(directory);
  return hash.digest('hex');
}

/** Read-only fingerprint of a consumer original: git head, status and a path/size/mtime digest (no contents read). */
function fingerprint(root) {
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : `git-error:${r.status}`;
  };
  const hash = createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const stat = fs.lstatSync(full);
        hash.update(`${path.relative(root, full)}\0${stat.size}\0${stat.mtimeMs}\0`);
      }
    }
  };
  walk(root);
  return { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain', '--', '.'), tree: hash.digest('hex') };
}

// ---------------------------------------------------------------------------------------------- consumers
const CONSUMERS = {
  A: {
    id: 'A',
    synthetic: false,
    title: 'cambio-real platform-web',
    target: 'src/components/Dashboard/StatsCard.tsx',
    test: 'src/components/Dashboard/StatsCard.test.tsx',
    testNames: ['shows green color for up trend', 'shows red color for down trend'],
    defect: { before: "trend === 'up' ? 'text-green-600' : 'text-red-600'", after: "trend === 'up' ? 'text-red-600' : 'text-green-600'" },
    expected: { up: 'text-green-600', down: 'text-red-600' },
    verifierModule: [
      "import { readFileSync } from 'node:fs';",
      "const source = readFileSync(new URL('../src/components/Dashboard/StatsCard.tsx', import.meta.url), 'utf8');",
      'export function observe() {',
      String.raw`  const match = /\$\{\s*trend === 'up' \? '([^']+)' : '([^']+)'\s*\}/.exec(source);`,
      '  return match ? { up: match[1], down: match[2] } : null;',
      '}',
      '',
    ].join('\n'),
    spec: 'StatsCard must show the up trend in green (text-green-600) and the down trend in red (text-red-600).',
  },
  B: {
    id: 'B',
    synthetic: true,
    title: 'axon-web',
    target: 'src/pages/DashboardPage.tsx',
    test: null,
    defect: { before: "{ label: 'Symbols', value", after: "{ label: 'Symbls', value" },
    expected: { label: 'Symbols' },
    verifierModule: [
      "import { readFileSync } from 'node:fs';",
      "const source = readFileSync(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8');",
      'export function observe() {',
      String.raw`  const match = /\{ label: '([A-Za-z]+)', value: overview\?\.symbols/.exec(source);`,
      '  return match ? { label: match[1] } : null;',
      '}',
      '',
    ].join('\n'),
    spec: 'The dashboard index summary must label the symbol count exactly "Symbols" (synthetic requirement for the second UI proof).',
  },
};

const DRIVER = [
  "import { readFileSync } from 'node:fs';",
  "const source = readFileSync(new URL('../src/components/Dashboard/StatsCard.tsx', import.meta.url), 'utf8');",
  String.raw`const match = /\$\{\s*(trend === 'up' \? '[^']+' : '[^']+')\s*\}/.exec(source);`,
  "if (!match) throw new Error('trend class expression not found');",
  'function classFor(trend) {',
  "  const choose = new Function('trend', `return ${match[1]};`);",
  '  const selected = choose(trend);',
  '  return selected;',
  '}',
  "console.log(JSON.stringify({ up: classFor('up'), down: classFor('down') }));",
  '',
].join('\n');

function cloneApp(consumer, label = consumer.id) {
  const dest = path.join(WORK, label, 'main', 'workspace');
  fs.mkdirSync(dest, { recursive: true });
  const excludes = ['node_modules', 'dist', '.git', 'coverage', 'coverage_output.txt', 'playwright-report', 'test-results'].flatMap((n) => [
    '--exclude',
    n,
  ]);
  const archive = run(`tar-${label}`, 'tar', [
    ...excludes,
    '-cf',
    path.join(WORK, `${label}.tar`),
    '-C',
    CONSUMER_SOURCES[consumer.id],
    '.',
  ]);
  if (archive.status !== 0) throw new Error(`cannot archive the consumer: ${trim(archive.stderr)}`);
  const extract = run(`untar-${label}`, 'tar', ['-xf', path.join(WORK, `${label}.tar`), '-C', dest]);
  if (extract.status !== 0) throw new Error('cannot extract the clone');
  fs.writeFileSync(path.join(path.dirname(dest), 'protected'), 'protected');
  const git = (...args) => execFileSync('git', ['-C', dest, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.appendFileSync(path.join(dest, '.gitignore'), '\nnode_modules\ndist\ndist-preview\n');
  git('init', '-q', '-b', 'task/w5-journey');
  git('config', 'user.name', 'HSEOS Journey');
  git('config', 'user.email', 'journey@example.invalid');
  git('add', '-A');
  git('commit', '-q', '-m', 'import consumer app');
  return { root: dest, main: path.dirname(dest), git };
}

// ---------------------------------------------------------------------------------------------- toolchains and policies
let environment;
let iso;
const toolchains = {};
function policyFor(clone, profile = 'P1', extra = {}) {
  return iso.createIsolationPolicy({
    backend: 'bwrap',
    host_workspace: clone.root,
    main_checkout: clone.main,
    protected_paths: [path.join(clone.main, 'protected')],
    profile,
    toolchain_roots: [toolchains.root],
    ...extra,
  });
}

const procsMentioning = (marker) => {
  const found = [];
  for (const entry of fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
    try {
      if (fs.readFileSync(`/proc/${entry}/cmdline`, 'latin1').includes(marker)) found.push(Number(entry));
    } catch {
      /* gone */
    }
  }
  return found.filter((pid) => pid !== process.pid);
};

// ---------------------------------------------------------------------------------------------- receipt assertions
const CAMPAIGN_REFERENCE = /^campaign:\/\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/;
const HEX64 = /^[a-f0-9]{64}$/;
const SELF_TEST_BINDING = 'f'.repeat(64);

/**
 * Pure checker over the campaign ledger (ProviderCampaignControl rows, the campaign report and the opening row).
 * Every rule has an id; `disabled` exists only so the self-test can prove each rule is load-bearing. Rules:
 * the opening ceiling and the committed cost stay <= US$ 1, the reported cost equals the cost recomputed from the
 * rows, at most 3 reservations per binding, a receipt needs an EARLIER reservation of the same command, receipts and
 * reservations agree on the binding, completed receipts carry model-output evidence, and every dispatch has a
 * well-formed `campaign://<campaign>/<dispatch>` reference.
 */
export function assertReceipts({ rows, report, opened, references, expectedBinding }, { disabled = new Set() } = {}) {
  const violations = [];
  const flagRule = (rule, message) => {
    if (!disabled.has(rule)) violations.push({ rule, message });
  };
  const reserved = rows.filter((r) => r.payload.kind === 'reserved');
  const receipts = rows.filter((r) => r.payload.kind === 'receipt');
  if (opened) {
    if (!(opened.max_cost_microusd <= MAX_CAMPAIGN_MICROUSD))
      flagRule('opened_ceiling', `campaign opened with max_cost_microusd ${opened.max_cost_microusd}`);
  } else flagRule('opened_present', 'the ledger has no opening row');
  if (!report) flagRule('report_present', 'no campaign report');
  let recomputed = 0;
  for (const row of reserved) {
    const receipt = receipts.find((r) => r.payload.command_id === row.payload.command_id)?.payload.receipt;
    recomputed += receipt?.cost_microusd ?? row.payload.reserved_microusd ?? 0;
  }
  if (report && report.committed_microusd !== recomputed)
    flagRule('committed_consistent', `report says ${report.committed_microusd} microusd, the rows say ${recomputed}`);
  const committed = Math.max(recomputed, report?.committed_microusd ?? 0);
  if (committed > MAX_CAMPAIGN_MICROUSD) flagRule('committed_ceiling', `committed ${committed} microusd exceeds the ceiling`);
  const perBinding = new Map();
  for (const row of reserved) perBinding.set(row.payload.binding_id, (perBinding.get(row.payload.binding_id) ?? 0) + 1);
  for (const [binding, count] of perBinding)
    if (count > MAX_DISPATCHES_PER_BINDING) flagRule('per_binding_cap', `${count} reserved rows for ${binding}`);
  const manifests = opened?.binding_manifests ?? {};
  for (const row of reserved) {
    if (opened && manifests[row.payload.binding_id] !== row.payload.manifest_sha256)
      flagRule('receipt_binding', `reservation ${row.payload.command_id} carries a manifest the campaign did not open with`);
  }
  const seen = new Map();
  for (const row of receipts) {
    const id = row.payload.command_id;
    const earlier = rows.slice(0, rows.indexOf(row)).find((r) => r.payload.kind === 'reserved' && r.payload.command_id === id);
    if (!earlier) flagRule('receipt_after_reserved', `receipt ${id} has no earlier reservation`);
    const receipt = row.payload.receipt ?? {};
    const sha = receipt.binding_sha256;
    if (HEX64.test(sha ?? '')) {
      if (expectedBinding && sha !== expectedBinding) flagRule('receipt_binding', `receipt ${id} names another binding digest`);
      const binding = earlier?.payload.binding_id ?? '?';
      if (seen.has(binding) && seen.get(binding) !== sha)
        flagRule('receipt_binding', `receipts of ${binding} disagree on the binding digest`);
      seen.set(binding, sha);
    } else {
      flagRule('receipt_binding', `receipt ${id} lacks binding_sha256`);
    }
    if (receipt.status === 'completed') {
      const evidence = receipt.evidence_ref;
      if (!(evidence && evidence.kind === 'model_output' && HEX64.test(evidence.sha256 ?? '') && Number.isInteger(evidence.bytes)))
        flagRule('receipt_evidence', `receipt ${id} lacks well-formed model-output evidence`);
    }
  }
  for (const row of reserved) {
    const id = row.payload.command_id;
    if (!receipts.some((r) => r.payload.command_id === id)) flagRule('reservation_has_receipt', `reservation ${id} has no receipt`);
    const reference = references?.[id] ?? `campaign://${report?.resource_id}/${id}`;
    const match = CAMPAIGN_REFERENCE.exec(reference);
    if (!match || match[2] !== id || (report?.resource_id && match[1] !== report.resource_id))
      flagRule('reference_format', `dispatch ${id} has a malformed or mismatched reference`);
  }
  if (report?.unresolved_commands?.length > 0) flagRule('unresolved', `unresolved commands: ${report.unresolved_commands.length}`);
  return {
    ok: violations.length === 0,
    violations,
    dispatches: reserved.length,
    receipts: receipts.length,
    per_binding: Object.fromEntries(perBinding),
  };
}

/**
 * Pure check of the fixed verifier: the digest recomputed now must equal the pin, and the pin must predate the
 * first reservation of the ledger. `disabled` exists only for the self-test.
 */
export function checkPin({ pinned, current, firstReservedAt }, { disabled = new Set() } = {}) {
  const violations = [];
  const flagRule = (rule, message) => {
    if (!disabled.has(rule)) violations.push({ rule, message });
  };
  if (pinned.verifier_sha256 !== current.verifier_sha256) flagRule('pin_digest', 'the verifier digest changed after it was pinned');
  if (firstReservedAt !== undefined && !(Date.parse(pinned.pinned_at) < Date.parse(firstReservedAt)))
    flagRule('pin_before_reserved', `pinned at ${pinned.pinned_at}, not before the first reservation at ${firstReservedAt}`);
  return { ok: violations.length === 0, violations };
}

// A synthetic, well-formed ledger in the exact shape the real campaign produces; the self-test mutates copies of it.
function syntheticLedger(count = 2) {
  const campaign = '11111111-1111-4111-8111-111111111111';
  const ids = Array.from({ length: count }, (_, i) => `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`);
  const manifest = 'a'.repeat(64);
  const rows = [{ payload: { kind: 'opened', max_cost_microusd: 0, binding_manifests: { 'binding:b': manifest } } }];
  for (const id of ids) {
    rows.push(
      { payload: { kind: 'reserved', command_id: id, binding_id: 'binding:b', manifest_sha256: manifest, reserved_microusd: 0 } },
      {
        payload: {
          kind: 'receipt',
          command_id: id,
          receipt: {
            status: 'completed',
            binding_sha256: SELF_TEST_BINDING,
            cost_microusd: null,
            evidence_ref: { kind: 'model_output', sha256: 'b'.repeat(64), bytes: 10 },
          },
        },
      },
    );
  }
  return {
    rows,
    opened: rows[0].payload,
    report: { resource_id: campaign, committed_microusd: 0, unresolved_commands: [] },
    references: Object.fromEntries(ids.map((id) => [id, `campaign://${campaign}/${id}`])),
    expectedBinding: SELF_TEST_BINDING,
    ids,
    campaign,
  };
}

const receiptOf = (ledger, index = 0) => ledger.rows.filter((r) => r.payload.kind === 'receipt')[index].payload.receipt;
const ADVERSARIAL_LEDGERS = [
  { name: 'four reservations on one binding', rules: ['per_binding_cap'], make: () => syntheticLedger(4) },
  {
    name: 'receipt whose reservation is missing',
    rules: ['receipt_after_reserved'],
    make: () => {
      const l = syntheticLedger(2);
      l.rows = l.rows.filter((r) => !(r.payload.kind === 'reserved' && r.payload.command_id === l.ids[0]));
      return l;
    },
  },
  {
    name: 'receipt recorded before its reservation',
    rules: ['receipt_after_reserved'],
    make: () => {
      const l = syntheticLedger(1);
      [l.rows[1], l.rows[2]] = [l.rows[2], l.rows[1]];
      return l;
    },
  },
  {
    name: 'committed above the ceiling and reported honestly',
    rules: ['committed_ceiling'],
    make: () => {
      const l = syntheticLedger(1);
      receiptOf(l).cost_microusd = 1_500_000;
      l.report.committed_microusd = 1_500_000;
      return l;
    },
  },
  {
    name: 'campaign opened above the ceiling',
    rules: ['opened_ceiling'],
    make: () => {
      const l = syntheticLedger(1);
      l.opened.max_cost_microusd = 2_000_000;
      return l;
    },
  },
  {
    name: 'receipt cost 5000000, report says 0',
    rules: ['committed_consistent', 'committed_ceiling'],
    make: () => {
      const l = syntheticLedger(1);
      receiptOf(l).cost_microusd = 5_000_000;
      return l;
    },
  },
  {
    name: 'receipt cost 500000 under the ceiling, report says 0',
    rules: ['committed_consistent'],
    make: () => {
      const l = syntheticLedger(1);
      receiptOf(l).cost_microusd = 500_000;
      return l;
    },
  },
  {
    name: 'dispatch reference not in campaign:// form',
    rules: ['reference_format'],
    make: () => {
      const l = syntheticLedger(1);
      l.references[l.ids[0]] = 'https://example.invalid/dispatch';
      return l;
    },
  },
  {
    name: 'dispatch reference of another campaign',
    rules: ['reference_format'],
    make: () => {
      const l = syntheticLedger(1);
      l.references[l.ids[0]] = `campaign://33333333-3333-4333-8333-333333333333/${l.ids[0]}`;
      return l;
    },
  },
  {
    name: 'receipt names another binding digest',
    rules: ['receipt_binding'],
    make: () => {
      const l = syntheticLedger(1);
      receiptOf(l).binding_sha256 = 'c'.repeat(64);
      return l;
    },
  },
  {
    name: 'receipts of one binding disagree',
    rules: ['receipt_binding'],
    make: () => {
      const l = syntheticLedger(2);
      receiptOf(l, 1).binding_sha256 = 'c'.repeat(64);
      l.expectedBinding = undefined;
      return l;
    },
  },
  {
    name: 'reservation under a manifest the campaign never opened with',
    rules: ['receipt_binding'],
    make: () => {
      const l = syntheticLedger(1);
      l.rows[1].payload.manifest_sha256 = 'd'.repeat(64);
      return l;
    },
  },
  {
    name: 'completed receipt without model-output evidence',
    rules: ['receipt_evidence'],
    make: () => {
      const l = syntheticLedger(1);
      delete receiptOf(l).evidence_ref;
      return l;
    },
  },
  {
    name: 'reservation without receipt',
    rules: ['reservation_has_receipt'],
    make: () => {
      const l = syntheticLedger(1);
      l.rows = l.rows.filter((r) => r.payload.kind !== 'receipt');
      return l;
    },
  },
  {
    name: 'no opening row',
    rules: ['opened_present'],
    make: () => {
      const l = syntheticLedger(1);
      l.opened = undefined;
      return l;
    },
  },
  {
    name: 'no report',
    rules: ['report_present'],
    make: () => {
      const l = syntheticLedger(1);
      l.report = undefined;
      return l;
    },
  },
  {
    name: 'unresolved command',
    rules: ['unresolved'],
    make: () => {
      const l = syntheticLedger(1);
      l.report.unresolved_commands = [l.ids[0]];
      return l;
    },
  },
];

/** The self-test: a good ledger passes, each adversarial one is rejected for its rule, and disabling that rule lets it through. */
function receiptSelfTest() {
  const good = assertReceipts(syntheticLedger(3));
  if (!good.ok) throw new Error(`a well-formed ledger was rejected: ${trim(good.violations)}`);
  const results = [];
  for (const entry of ADVERSARIAL_LEDGERS) {
    const verdict = assertReceipts(entry.make());
    const fired = new Set(verdict.violations.map((v) => v.rule));
    if (verdict.ok) throw new Error(`adversarial ledger accepted: ${entry.name}`);
    const missing = entry.rules.filter((rule) => !fired.has(rule));
    if (missing.length > 0) throw new Error(`adversarial ledger "${entry.name}" was not rejected for ${missing.join(', ')}`);
    const relaxed = assertReceipts(entry.make(), { disabled: new Set(entry.rules) });
    if (!relaxed.ok)
      throw new Error(`"${entry.name}" is rejected by something other than ${entry.rules.join(', ')}: ${trim(relaxed.violations)}`);
    results.push({ case: entry.name, rejected_by: [...fired] });
  }
  return { good_ledger: 'accepted', adversarial_cases: results.length, cases: results };
}

function pinSelfTest() {
  const pinned = { verifier_sha256: 'a'.repeat(64), pinned_at: '2026-10-16T21:00:00.000Z' };
  const current = { verifier_sha256: 'a'.repeat(64) };
  if (!checkPin({ pinned, current, firstReservedAt: '2026-10-16T21:00:05.000Z' }).ok) throw new Error('a valid pin was rejected');
  const cases = [
    { name: 'verifier altered after the pin', rules: ['pin_digest'], input: { pinned, current: { verifier_sha256: 'b'.repeat(64) } } },
    {
      name: 'pin later than the first reservation',
      rules: ['pin_before_reserved'],
      input: { pinned, current, firstReservedAt: '2026-10-16T20:59:59.000Z' },
    },
    {
      name: 'pin at the same instant as the first reservation',
      rules: ['pin_before_reserved'],
      input: { pinned, current, firstReservedAt: pinned.pinned_at },
    },
    {
      name: 'altered and late',
      rules: ['pin_digest', 'pin_before_reserved'],
      input: { pinned, current: { verifier_sha256: 'b'.repeat(64) }, firstReservedAt: '2026-10-16T20:59:59.000Z' },
    },
  ];
  for (const entry of cases) {
    const verdict = checkPin(entry.input);
    const fired = new Set(verdict.violations.map((v) => v.rule));
    if (verdict.ok || entry.rules.some((rule) => !fired.has(rule))) throw new Error(`pin case not rejected as expected: ${entry.name}`);
    if (!checkPin(entry.input, { disabled: new Set(entry.rules) }).ok) throw new Error(`pin case rejected by another rule: ${entry.name}`);
  }
  return { good_pin: 'accepted', adversarial_cases: cases.length };
}

const REDACTED_KEYS = new Set(['account_sha256', 'provider_session_id', 'owner']);
/** Account digests, provider session ids and the executor owner (pid, cgroup path) never reach the repository. */
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACTED_KEYS.has(k) ? '<redacted>' : redact(v)]));
  return value;
}

// ---------------------------------------------------------------------------------------------- the journey

const viteBin = (root) => path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

/** The managed-project contract for one consumer: scope, protected module check, limits. Built once, pinned by digest. */
function projectContract(consumer, root, taskId) {
  const { prepareProjectTask } = load('tools/cli/lib/engineering-workspace');
  const read = [consumer.target, 'hseos_w5/verify.mjs', 'package.json', ...(consumer.test ? [consumer.test] : [])];
  return prepareProjectTask({
    schema_version: 2,
    task_id: taskId,
    execution_profile: 'managed-project',
    workspace: { root },
    sources: [{ id: 'spec', kind: 'specification', content: consumer.spec, sha256: sha256(consumer.spec) }],
    requirements: [{ id: 'r1', description: consumer.spec, source_ids: ['spec'] }],
    acceptance: [{ id: 'a1', description: 'The protected module check observes the specified values.', requirement_ids: ['r1'] }],
    scope: { read, write: [consumer.target] },
    commands: [{ id: 'verify', runtime: 'node', entrypoint: 'hseos_w5/verify.mjs', args: [] }],
    limits: { max_turns: 8, max_tokens: 200_000, max_duration_ms: 120_000, max_tool_calls: 8, max_children: 0, max_workflow_steps: 0 },
    max_failed_corrections: 1,
    max_artifact_bytes: 65_536,
    max_output_bytes: 8192,
    verifier: {
      reference: 'verifier://project/node-module-v1',
      acceptance_ids: ['a1'],
      checks: [{ path: 'hseos_w5/verify.mjs', export_name: 'observe', args: [], expected: consumer.expected }],
    },
    rollback: 'discard-disposable-workspace',
  });
}

function buildPrompt(consumer, clone) {
  const file = fs.readFileSync(path.join(clone.root, consumer.target), 'utf8');
  return [
    'You are fixing one defect in a web application. Answer with ONE JSON array and nothing else: no prose, no code fence.',
    `Requirement: ${consumer.spec}`,
    `Observed evidence: ${state.evidence[consumer.id] ?? 'none'}`,
    `File to fix: ${consumer.target} (current sha256 ${sha256(file)}). Its content follows between the markers.`,
    '<<<FILE',
    file,
    'FILE>>>',
    `Output format, exactly: [{"name":"engineering.patch","input":{"path":"${consumer.target}","expected_sha256":"${sha256(file)}","before":"<exact substring of the file that occurs once>","after":"<replacement>"}},{"name":"engineering.diff","input":{}}]`,
    'Rules: edit only the file named above; do not touch tests, configuration or any other file; keep the change minimal.',
  ].join('\n');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};
/** Static server for a built app (single page fallback); loopback only, port chosen by the kernel. */
function serveStatic(directory) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    let file = path.join(directory, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(directory) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(directory, 'index.html');
    response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const PREVIEW_HTML =
  '<!doctype html><html><head><meta charset="UTF-8" /><title>hseos preview</title></head><body><div id="root"></div><script type="module" src="/hseos_w5/preview.tsx"></script></body></html>\n';
const PREVIEW_TSX = [
  "import { createRoot } from 'react-dom/client'",
  "import { Activity } from 'lucide-react'",
  "import '../src/index.css'",
  "import StatsCard from '../src/components/Dashboard/StatsCard'",
  '',
  'function Preview() {',
  '  return (',
  "    <div style={{ padding: 24, width: 380, display: 'grid', gap: 16 }}>",
  '      <StatsCard title="Revenue" value="$45,231" change="+20.1%" trend="up" icon={Activity} />',
  '      <StatsCard title="Error Rate" value="2.3%" change="-5.2%" trend="down" icon={Activity} />',
  '    </div>',
  '  )',
  '}',
  "createRoot(document.getElementById('root')!).render(<Preview />)",
  'setTimeout(() => {',
  '  const colour = (text: string) => {',
  "    const el = Array.from(document.querySelectorAll('span')).find((span) => span.textContent === text)",
  "    return el ? getComputedStyle(el).color : 'missing'",
  '  }',
  "  const report = document.createElement('pre')",
  "  report.id = 'hseos-report'",
  "  report.textContent = `up=${colour('+20.1%')} down=${colour('-5.2%')}`",
  '  document.body.append(report)',
  '}, 100)',
  '',
].join('\n');
const PREVIEW_CONFIG = [
  "import { defineConfig } from 'vite'",
  "import react from '@vitejs/plugin-react'",
  "export default defineConfig({ plugins: [react()], build: { outDir: 'dist-preview', emptyOutDir: true, rollupOptions: { input: 'preview.html' } } })",
  '',
].join('\n');

function vitestRun(clone, consumer) {
  const result = run(
    'vitest',
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', consumer.test, '--maxWorkers=2', '--minWorkers=1', '--reporter=json'],
    { cwd: clone.root, env: { ...process.env, CI: '1', NO_COLOR: '1' } },
  );
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  } catch {
    parsed = null;
  }
  const tests = (parsed?.testResults ?? [])
    .flatMap((file) => file.assertionResults ?? [])
    .map((t) => ({ title: t.title, status: t.status }));
  if (!parsed || parsed.numTotalTests === 0)
    return { exit: result.status === 0 ? 1 : result.status, tests, passed: 0, failed: 0, no_tests: true };
  return { exit: result.status, tests, passed: parsed?.numPassedTests ?? 0, failed: parsed?.numFailedTests ?? 0 };
}

/** Pin of one consumer from the clone as it is now. With the contract it is the full pin; without it, the static part. */
function buildPin(c, withContract) {
  const consumer = CONSUMERS[c];
  const clone = state.clones[c];
  const pin = {
    schema_version: 1,
    consumer: c,
    synthetic: consumer.synthetic,
    governance_check: {
      module: 'hseos_w5/verify.mjs',
      export: 'observe',
      expected: consumer.expected,
      module_sha256: sha256(fs.readFileSync(path.join(clone.root, 'hseos_w5/verify.mjs'))),
    },
    behavioral_acceptance: consumer.test
      ? {
          command: ['node', 'node_modules/vitest/vitest.mjs', 'run', consumer.test, '--maxWorkers=2', '--minWorkers=1'],
          test_file_sha256: sha256(fs.readFileSync(path.join(clone.root, consumer.test))),
          expected_exit: 0,
          named_tests: consumer.testNames,
        }
      : { synthetic_dom_check: { selector: '#root *', text: consumer.expected.label, absent: 'Symbls' } },
    baseline_sha: clone.baseline,
  };
  let contract;
  if (withContract) {
    contract = projectContract(consumer, clone.root, state.contracts[c].taskId);
    pin.task_contract_sha256 = sha256(JSON.stringify(contract));
  }
  return { pin, digest: sha256(JSON.stringify(pin)), contract };
}

/** External acceptance on a corrected clone. The pin is recomputed first: a verifier changed after the pin is refused. */
async function acceptanceFor(consumer, clone, { pinCheck = true } = {}) {
  const c = consumer.id;
  if (pinCheck) {
    const stat = checkPin({
      pinned: { verifier_sha256: state.pinned[c].static_sha256, pinned_at: state.pinned[c].pinned_at },
      current: { verifier_sha256: buildPin(c, false).digest },
    });
    if (!stat.ok) throw new Error(`the pinned verifier changed before acceptance: ${trim(stat.violations)}`);
  }
  if (consumer.test) {
    await loadGate(`vitest green ${c}`);
    const outcome = vitestRun(clone, consumer);
    const passed = new Set(outcome.tests.filter((t) => t.status === 'passed').map((t) => t.title));
    const missing = consumer.testNames.filter((n) => !passed.has(n));
    if (outcome.exit !== 0 || outcome.failed !== 0 || missing.length > 0)
      throw new Error(`the real test still fails: exit ${outcome.exit}, failed ${outcome.failed}, not passing ${missing.join(', ')}`);
    return {
      vitest_exit: outcome.exit,
      passed_tests: outcome.passed,
      previously_failing_now_passing: consumer.testNames,
      max_workers: 2,
      verifier_sha256: state.pinned[c].verifier_sha256,
      pin_rechecked_before_acceptance: pinCheck,
    };
  }
  const { observe } = await import(path.join(clone.root, 'hseos_w5/verify.mjs'));
  const observed = observe();
  if (JSON.stringify(observed) !== JSON.stringify(consumer.expected))
    throw new Error(`the synthetic check observes ${trim(observed)}, expected ${trim(consumer.expected)}`);
  return { synthetic: true, observed, verifier_sha256: state.pinned[c].verifier_sha256, pin_rechecked_before_acceptance: pinCheck };
}

/** Build, serve and browse. For A the page is a harness preview of the real StatsCard, not the app's own route. */
async function browserCheckFor(consumer, clone, label, { defective = false } = {}) {
  const c = consumer.id;
  let directory;
  let expectation;
  let served;
  if (c === 'A') {
    fs.writeFileSync(path.join(clone.root, 'preview.html'), PREVIEW_HTML);
    fs.writeFileSync(path.join(clone.root, 'hseos_w5/preview.tsx'), PREVIEW_TSX);
    fs.writeFileSync(path.join(clone.root, 'vite.preview.config.mjs'), PREVIEW_CONFIG);
    const build = run('vite-build-A', process.execPath, [viteBin(clone.root), 'build', '-c', 'vite.preview.config.mjs'], {
      cwd: clone.root,
    });
    if (build.status !== 0) throw new Error(`preview build failed: ${trim(build.stderr || build.stdout, 400)}`);
    directory = path.join(clone.root, 'dist-preview');
    fs.renameSync(path.join(directory, 'preview.html'), path.join(directory, 'index.html'));
    expectation = defective
      ? { selector: '#hseos-report', text: 'up=rgb(220, 38, 38) down=rgb(22, 163, 74)', absent: 'up=rgb(22, 163, 74)', label }
      : { selector: '#hseos-report', text: 'up=rgb(22, 163, 74) down=rgb(220, 38, 38)', absent: 'up=rgb(220, 38, 38)', label };
  } else {
    // Same-origin API base: the page must not reach for the owner's LAN host (egress is denied by policy).
    const build = run('vite-build-B', process.execPath, [viteBin(clone.root), 'build'], {
      cwd: clone.root,
      env: { ...process.env, VITE_API_BASE: '' },
    });
    if (build.status !== 0) throw new Error(`app build failed: ${trim(build.stderr || build.stdout, 400)}`);
    directory = path.join(clone.root, 'dist');
    // The page links a web-font stylesheet on a third-party host; egress there is denied by policy, which refuses the
    // whole call. The served copy drops those tags (source untouched) and the omission is recorded in the result.
    const indexFile = path.join(directory, 'index.html');
    const html = fs.readFileSync(indexFile, 'utf8');
    fs.writeFileSync(indexFile, html.replaceAll(/<link[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/g, ''));
    served = { third_party_font_tags_removed: (html.match(/<link[^>]+fonts\.g/g) ?? []).length };
    expectation = defective
      ? { selector: '#root *', text: 'Symbls', absent: 'Symbols', label }
      : { selector: '#root *', text: 'Symbols', absent: 'Symbls', label };
  }
  return {
    synthetic: consumer.synthetic,
    harness_preview_page: c === 'A',
    served,
    ...(await browse(c, { directory, ...expectation })),
  };
}

async function closeCampaign() {
  if (!state.control) return;
  const { control } = state;
  state.control = null;
  try {
    await control.providerCampaigns.shutdown();
    await control.terminals.shutdown();
  } finally {
    control.close();
  }
}

async function browse(c, { directory, selector, text, absent, label }) {
  const browserModule = load('packages/agent-environment/browser');
  const broker = load('tools/cli/lib/environment-egress-broker');
  const { ContextMediaStore } = load('packages/agent-context/media-store');
  const toolchain = browserModule.prepareBrowserToolchain({
    install: environment.loadPins().installToolchain,
    cacheDirectory: CACHE,
    destination: fs.mkdtempSync(path.join(WORK, 'browser-toolchain-')),
  });
  if (toolchain.status !== 'ready') throw new Blocked(`browser toolchain: ${toolchain.code}: ${toolchain.cause}`);
  const site = await serveStatic(directory);
  const egress = await broker.startEnvironmentEgressBroker({ allow: broker.localhostAllowlist(site.port) });
  try {
    const main = fs.mkdtempSync(path.join(WORK, 'browser-main-'));
    const workspace = path.join(main, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(main, 'protected'), 'protected');
    const policy = iso.createIsolationPolicy({
      backend: 'bwrap',
      host_workspace: workspace,
      main_checkout: main,
      protected_paths: [path.join(main, 'protected')],
      profile: 'P2',
      toolchain_roots: [toolchain.root],
      broker_socket: egress.socketPath,
    });
    const mediaStore = new ContextMediaStore({ root: fs.mkdtempSync(path.join(WORK, 'browser-media-')) });
    const events = [];
    const service = environment.createDefaultBrowserService({
      policy,
      toolchain,
      broker: egress,
      mediaStore,
      ledger: (e) => events.push(e),
    });
    const output = await service.run({
      steps: [
        { op: 'goto', url: `http://localhost:${site.port}/` },
        { op: 'wait_for', selector },
        { op: 'screenshot' },
        { op: 'dom_snapshot' },
      ],
      viewport: { width: 900, height: 700 },
      timeout_ms: 45_000,
    });
    if (output.status !== 'ok') throw new Error(`browser run failed: ${trim(output, 1600)}`);
    const shot = output.media[0];
    const png = mediaStore.load(shot);
    if (sha256(png) !== shot.digest) throw new Error('stored screenshot differs from its digest');
    fs.mkdirSync(path.join(EVIDENCE, 'screenshots'), { recursive: true });
    const name = `${c}-${label}.png`;
    fs.writeFileSync(path.join(EVIDENCE, 'screenshots', name), png);
    const dom = output.context[0].content;
    if (!dom.includes(text)) throw new Error(`the page does not show ${JSON.stringify(text)}: ${trim(dom, 800)}`);
    if (absent && dom.includes(absent)) throw new Error(`the page still shows ${JSON.stringify(absent)}`);
    const leftovers = procsMentioning(toolchain.root);
    if (output.execution.descendants_terminated !== true || leftovers.length > 0) throw new Error('browser processes survived the call');
    return {
      screenshot: `screenshots/${name}`,
      screenshot_sha256: shot.digest,
      screenshot_bytes: png.length,
      viewport: [shot.width, shot.height],
      dom_digest: output.context[0].provenance.digest,
      dom_excerpt: trim(dom.slice(Math.max(0, dom.indexOf(text) - 40)), 240),
      egress: { requests: output.egress.requests, denied: output.egress.denied.length },
      profile: output.execution.profile,
      orphans: 0,
    };
  } finally {
    await egress.close();
    site.server.closeAllConnections?.();
    await new Promise((resolve) => site.server.close(resolve));
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const baseSha = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  fs.mkdirSync(EVIDENCE, { recursive: true });

  // Self-tests of the two gates that guard the cost ceiling and the fixed verifier. They cost nothing and run first.
  await step('s11a-receipts-selftest', '-', 'receipt gate rejects adversarial ledgers (each rule proven load-bearing)', async () =>
    receiptSelfTest(),
  );
  await step('s03d-pin-selftest', '-', 'verifier pin gate rejects an altered verifier and a late pin', async () => pinSelfTest());

  // s00: the core and the five capability packs, installed offline into a new, empty directory.
  await step('s00-install', '-', 'core and plugin tarballs installed offline from the cache into an empty directory', async () => {
    if (fs.existsSync(PREFIX) && fs.readdirSync(PREFIX).length > 0) throw new Error(`install directory is not empty: ${PREFIX}`);
    fs.mkdirSync(PREFIX, { recursive: true });
    const pack = path.join(WORK, 'pack');
    fs.mkdirSync(pack);
    const packed = run('npm-pack', 'npm', ['pack', '--pack-destination', pack, '--ignore-scripts', '--json'], { cwd: REPO_ROOT });
    if (packed.status !== 0) throw new Error(`npm pack failed: ${trim(packed.stderr)}`);
    const manifest = JSON.parse(packed.stdout)[0];
    const tgz = path.join(pack, manifest.filename);
    run('npm-init', 'npm', ['init', '-y'], { cwd: PREFIX });
    const install = run('npm-install-core', 'npm', ['install', '--offline', '--no-audit', '--no-fund', tgz], { cwd: PREFIX });
    if (install.status !== 0) throw new Error(`offline install failed: ${trim(install.stderr)}`);
    if (!fs.existsSync(path.join(PKG, 'packages', 'agent-environment', 'index.js')))
      throw new Error('installed core lacks agent-environment');
    const { packPlugin } = createRequire(import.meta.url)(path.join(REPO_ROOT, 'tools/lib/environment-plugin-pack.js'));
    const plugins = [];
    for (const capability of ['lsp', 'dap', 'browser', 'computer-use', 'memory']) {
      const out = path.join(WORK, 'plugins');
      const packedPlugin = packPlugin({ repoRoot: REPO_ROOT, capability, outputDirectory: out });
      const extract = path.join(PREFIX, 'plugins', packedPlugin.id);
      fs.mkdirSync(extract, { recursive: true });
      const untar = run(`untar-${capability}`, 'tar', [
        '-xzf',
        path.join(out, packedPlugin.filename),
        '-C',
        extract,
        '--strip-components=1',
      ]);
      if (untar.status !== 0) throw new Error(`cannot extract plugin ${capability}`);
      const mismatched = packedPlugin.entries.filter((entry) => {
        if (!entry.source) return false;
        const installed = path.join(PKG, entry.source);
        return !fs.existsSync(installed) || sha256(fs.readFileSync(installed)) !== entry.sha256;
      });
      if (mismatched.length > 0)
        throw new Error(`plugin ${capability} differs from the installed core: ${mismatched.map((m) => m.path).join(', ')}`);
      plugins.push({
        id: packedPlugin.id,
        version: packedPlugin.version,
        digest: packedPlugin.digest,
        entries: packedPlugin.entries.length,
        bytes: packedPlugin.unpacked_bytes,
      });
    }
    environment = load('packages/agent-environment');
    iso = load('packages/agent-isolation-attestation');
    return {
      core: { filename: manifest.filename, entries: manifest.entryCount ?? manifest.files?.length, integrity: manifest.integrity },
      plugins,
    };
  });

  // s05b: which model routes exist on this host. Inspection only: no inference, no dispatch, no secret is read or printed.
  await step('s05b-routes', '-', 'model routes available (local, subscriptions, paid API) by inspection only', async () => {
    needs('s00-install');
    const detail = {
      local: {
        available: false,
        binaries_checked: ['ollama', 'llama-server', 'llama-cli', 'llamafile', 'lms', 'vllm'].filter(
          (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status !== 0,
        ),
      },
    };
    const found = ['ollama', 'llama-server', 'llama-cli', 'llamafile', 'lms', 'vllm'].filter(
      (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0,
    );
    detail.local = { available: found.length > 0, found, checked: 6 };
    // Not routed through run(): the raw output carries the account e-mail, which must never reach a log.
    const claudeStatus = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8' });
    try {
      const parsed = JSON.parse(claudeStatus.stdout);
      detail.claude_subscription = {
        logged_in: parsed.loggedIn === true,
        auth_method: parsed.authMethod,
        api_provider: parsed.apiProvider,
      };
    } catch {
      detail.claude_subscription = { logged_in: false, cause: 'status not parseable' };
    }
    const { CodexAppServerDriver } = load('packages/runtime-providers/codex-app-server-driver');
    const { engineeringDigest } = load('tools/cli/lib/engineering-task-state');
    const codexBin =
      '/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
    const driver = new CodexAppServerDriver({
      executable: codexBin,
      args: ['app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}', '-c', 'model_reasoning_effort="low"'],
      cwd: WORK,
      env: { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME || path.join(process.env.HOME, '.codex'), PATH: process.env.PATH },
    });
    try {
      const { identity, quota } = await driver.inspectAccount();
      const bucket = quota?.rateLimitsByLimitId?.codex || quota?.rateLimits;
      const windows = [bucket?.primary, bucket?.secondary].filter(Boolean);
      detail.codex_subscription = {
        account_type: identity?.account?.type,
        account_sha256: identity?.account?.email ? engineeringDigest({ type: identity.account.type, email: identity.account.email }) : null,
        paid_credits: bucket?.credits?.hasCredits === true,
        quota_used_percent: windows.map((w) => w.usedPercent),
        eligible:
          identity?.account?.type === 'chatgpt' &&
          bucket?.credits?.hasCredits === false &&
          windows.length > 0 &&
          windows.every((w) => w.usedPercent < 100),
        inference_executed: false,
      };
    } catch (error) {
      detail.codex_subscription = { eligible: false, cause: trim(error.code || error.message, 200) };
    } finally {
      await driver.close();
    }
    detail.paid_api = { used: false, note: 'not inspected and not used; needs a new owner question (G4)' };
    detail.network_queries = {
      claude_auth_status: 'local command; network use not measured',
      codex_inspect_account:
        'reads account and quota through the codex app-server, which contacts the provider (not measured at socket level); no inference',
    };
    if (!detail.codex_subscription.eligible && !detail.claude_subscription.logged_in)
      throw new Blocked('no subscription route is eligible', detail);
    return detail;
  });

  const consumers = ['A', 'B'].map((id) => CONSUMERS[id]);
  for (const consumer of consumers) {
    const c = consumer.id;
    state.originals[c] = { before: fingerprint(CONSUMER_SOURCES[c]) };

    await step(`s01-clone-${c}`, c, `disposable clone of ${consumer.title} with the defect injected`, async () => {
      const clone = cloneApp(consumer);
      state.clones[c] = clone;
      // Journey aids live in hseos_w5/ (the contract path alphabet has no leading dot).
      const aids = path.join(clone.root, 'hseos_w5');
      fs.mkdirSync(aids);
      fs.writeFileSync(path.join(aids, 'verify.mjs'), consumer.verifierModule);
      if (c === 'A') fs.writeFileSync(path.join(aids, 'repro-trend.mjs'), DRIVER);
      clone.git('add', '-A');
      clone.git('commit', '-q', '-m', 'journey aids');
      const target = path.join(clone.root, consumer.target);
      const text = fs.readFileSync(target, 'utf8');
      if (text.split(consumer.defect.before).length !== 2) throw new Error('defect anchor is not unique in the target');
      const line = text.slice(0, text.indexOf(consumer.defect.before)).split('\n').length;
      fs.writeFileSync(target, text.replace(consumer.defect.before, consumer.defect.after));
      clone.git('add', '-A');
      clone.git('commit', '-q', '-m', 'inject defect');
      clone.baseline = clone.git('rev-parse', 'HEAD');
      clone.defective_sha256 = sha256(fs.readFileSync(target));
      return {
        target: consumer.target,
        line,
        synthetic: consumer.synthetic,
        baseline_sha: clone.baseline,
        defective_sha256: clone.defective_sha256,
        original_untouched_checked_at_end: true,
      };
    });

    await step(`s02-deps-${c}`, c, `${consumer.title} dependencies installed offline from the dedicated npm cache`, async () => {
      needs(`s01-clone-${c}`);
      await loadGate(`deps ${c}`);
      const clone = state.clones[c];
      if (!fs.existsSync(NPM_CACHES[c])) throw new Blocked(`dedicated npm cache is absent: ${NPM_CACHES[c]}`);
      // No network namespace: the install proves it works without any route out. The proof is measured, not asserted.
      const sandbox = ['--bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--unshare-net'];
      const probe = run(`net-probe-${c}`, 'bwrap', [...sandbox, 'cat', '/proc/net/dev']);
      const interfaces = probe.stdout
        .split('\n')
        .slice(2)
        .map((line) => line.split(':')[0].trim())
        .filter(Boolean);
      if (probe.status !== 0 || interfaces.join(',') !== 'lo')
        throw new Error(`the sandbox is not network-isolated: interfaces ${interfaces.join(',')}`);
      const install = run(
        `npm-ci-${c}`,
        'bwrap',
        [...sandbox, 'npm', 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', NPM_CACHES[c]],
        { cwd: clone.root },
      );
      if (install.status !== 0) {
        const missing = /request to (\S+) failed/.exec(install.stderr)?.[1];
        throw new Blocked(
          `offline install from ${NPM_CACHES[c]} failed (first miss: ${missing ?? 'unknown'}): ${trim(install.stderr, 300)}`,
        );
      }
      state.nodeModules[c] = true;
      const lock = fs.readFileSync(path.join(clone.root, 'package-lock.json'));
      const du = spawnSync('du', ['-sk', NPM_CACHES[c]], { encoding: 'utf8' }).stdout.split('\t')[0];
      const modules = fs.readdirSync(path.join(clone.root, 'node_modules')).length;
      return {
        offline_without_network: interfaces.join(',') === 'lo',
        sandbox_interfaces: interfaces,
        cache: NPM_CACHES[c],
        cache_kib: Number(du),
        lockfile_sha256: sha256(lock),
        top_level_modules: modules,
        lifecycle_scripts: 'skipped (--ignore-scripts)',
      };
    });

    await step(`s03-verifier-${c}`, c, 'external verifier fixed (digest and commands) before any dispatch', async () => {
      needs(`s01-clone-${c}`);
      state.contracts[c] = { taskId: randomUUID() };
      // The whole task contract (scope, protected module check, limits) is fixed here too, before any dispatch.
      const full = buildPin(c, true);
      state.contracts[c].contract = full.contract;
      state.pinned[c] = {
        ...full.pin,
        verifier_sha256: full.digest,
        static_sha256: buildPin(c, false).digest,
        pinned_at: new Date().toISOString(),
      };
      return {
        verifier_sha256: full.digest,
        static_sha256: state.pinned[c].static_sha256,
        pinned_at: state.pinned[c].pinned_at,
        task_contract_sha256: full.pin.task_contract_sha256,
      };
    });

    if (consumer.test) {
      await step(`s03b-red-${c}`, c, 'the real test fails on the clone with the injected defect (vitest, no model)', async () => {
        needs(`s02-deps-${c}`, `s03-verifier-${c}`);
        await loadGate(`vitest red ${c}`);
        const outcome = vitestRun(state.clones[c], consumer);
        const failing = outcome.tests.filter((t) => t.status === 'failed').map((t) => t.title);
        if (outcome.exit === 0 || outcome.failed === 0) throw new Error(`the test did not fail on the defect: ${trim(outcome)}`);
        const missing = consumer.testNames.filter((n) => !failing.includes(n));
        if (missing.length > 0) throw new Error(`expected failing tests did not fail: ${missing.join(', ')}`);
        state.pinned[c].red = { exit: outcome.exit, failed: failing, passed: outcome.passed };
        return { exit: outcome.exit, failed_tests: failing, passed_tests: outcome.passed, max_workers: 2 };
      });
    }

    if (c === 'A') {
      await step(
        's03c-browser-defect-A',
        c,
        'browser on the DEFECTIVE state (before any correction): screenshot and DOM show the defect',
        async () => {
          needs('s02-deps-A', 's03b-red-A');
          await loadGate('browser defect A');
          return browserCheckFor(consumer, state.clones.A, 'defective', { defective: true });
        },
      );

      await step('s04-lsp-A', c, 'LSP over the defective component (definition, references, hover, scope denial)', async () => {
        needs('s00-install', 's01-clone-A');
        await loadGate('lsp');
        const clone = state.clones.A;
        const lspToolchain = environment.prepareLspToolchain({
          install: environment.loadPins().installToolchain,
          cacheDirectory: CACHE,
          destination: fs.mkdtempSync(path.join(WORK, 'lsp-toolchain-')),
        });
        if (lspToolchain.status !== 'ready') throw new Blocked(`LSP toolchain: ${lspToolchain.code}: ${lspToolchain.cause}`);
        toolchains.root = lspToolchain.root;
        const events = [];
        const service = environment.createDefaultLspService({
          policy: policyFor(clone),
          toolchain: lspToolchain,
          ledger: (e) => events.push(e),
        });
        const file = CONSUMERS.A.target;
        const text = fs.readFileSync(path.join(clone.root, file), 'utf8').split('\n');
        // The destructured `trend` parameter: the language server types it even where the dependencies are absent.
        const lineIndex = text.findIndex((l) => /^\s+trend,$/.test(l));
        const position = { line: lineIndex, character: text[lineIndex].indexOf('trend') + 1 };
        const before = hashTree(clone.root);
        const out = {};
        for (const action of ['diagnostics', 'definition', 'references', 'hover']) {
          const output = await service.run({ action, language: 'typescript', file, ...(action === 'diagnostics' ? {} : { position }) });
          if (output.status !== 'ok') throw new Error(`${action} did not return ok: ${trim(output)}`);
          if (output.source.authority !== 'data' || output.source.provenance.trust !== 'untrusted')
            throw new Error(`${action} result is not untrusted data`);
          if (output.execution.descendants_terminated !== true) throw new Error(`${action} left descendants`);
          out[action] = { digest: output.source.provenance.digest, pids_peak: output.execution.pids_peak };
          if (action === 'diagnostics') out.diagnostics.count = output.result.diagnostics.length;
          if (action === 'references') out.references.count = output.result.locations.length;
          if (action === 'hover') out.hover.text = trim(output.result.hover, 160);
        }
        if (out.references.count < 3)
          throw new Error(`references did not find the use of the parameter at ${JSON.stringify(position)}: ${trim(out, 2000)}`);
        const denied = await service.run({ action: 'diagnostics', language: 'typescript', file: '../outside.ts' });
        if (denied.status === 'ok') throw new Error('a file outside the workspace was answered');
        if (hashTree(clone.root) !== before) throw new Error('the workspace changed during LSP');
        return {
          ...out,
          outside_workspace: { status: denied.status, code: denied.code },
          deps_installed: Boolean(state.nodeModules.A),
          workspace_unchanged: true,
        };
      });

      await step('s05-dap-A', c, 'DAP session on the reproducer: breakpoint, stack and variables expose the defect', async () => {
        needs('s00-install', 's01-clone-A');
        await loadGate('dap');
        const clone = state.clones.A;
        const dapToolchain = environment.prepareDapToolchain({
          install: environment.loadPins().installToolchain,
          cacheDirectory: CACHE,
          destination: fs.mkdtempSync(path.join(WORK, 'dap-toolchain-')),
        });
        if (dapToolchain.status !== 'ready') throw new Blocked(`DAP toolchain: ${dapToolchain.code}: ${dapToolchain.cause}`);
        const events = [];
        const policy = iso.createIsolationPolicy({
          backend: 'bwrap',
          host_workspace: clone.root,
          main_checkout: clone.main,
          protected_paths: [path.join(clone.main, 'protected')],
          profile: 'P1',
          toolchain_roots: [dapToolchain.root],
        });
        const service = environment.createDefaultDapService({ policy, toolchain: dapToolchain, ledger: (e) => events.push(e) });
        const driver = fs.readFileSync(path.join(clone.root, 'hseos_w5/repro-trend.mjs'), 'utf8').split('\n');
        const breakLine = driver.findIndex((l) => l.includes('return selected;')) + 1;
        const before = hashTree(clone.root);
        const output = await service.run({
          runtime: 'node',
          launch: { program: 'hseos_w5/repro-trend.mjs' },
          breakpoints: [{ file: 'hseos_w5/repro-trend.mjs', line: breakLine }],
          steps: [{ op: 'continue' }, { op: 'continue' }],
          capture: { stack: true, variables_depth: 1 },
        });
        if (output.status !== 'ok') throw new Error(`debug session did not complete: ${trim(output)}`);
        const stop = output.result.stops[0];
        const locals = (stop?.scopes ?? []).flatMap((scope) => scope.variables ?? []);
        const up = locals.find((v) => v.name === 'selected')?.value ?? '';
        if (!/text-red-600/.test(up))
          throw new Error(`the debugger did not observe the defect (up=${up}): ${trim(stop?.scopes ?? output.result, 1500)}`);
        if (output.result.stops.length !== 2 || !output.result.terminated || output.execution.descendants_terminated !== true)
          throw new Error('the session left descendants');
        if (output.source.authority !== 'data') throw new Error('debug output is not data');
        if (hashTree(clone.root) !== before) throw new Error('the workspace changed during debugging');
        const denied = await service.run({ runtime: 'node', launch: { program: '../outside.js' } });
        if (denied.status === 'ok') throw new Error('a program outside the workspace was launched');
        return {
          stop_reason: stop.reason,
          observed_selected_for_up: up,
          observed_selected_for_down: (output.result.stops[1]?.scopes ?? [])
            .flatMap((scope) => scope.variables ?? [])
            .find((v) => v.name === 'selected')?.value,
          digest: output.source.provenance.digest,
          pids_peak: output.execution.pids_peak,
          outside_workspace: { status: denied.status, code: denied.code },
          note: 'the reproducer evaluates the class expression extracted from the component source (the component itself needs JSX and the dependencies)',
          _evidence: `a debugger stopped in the reproducer of the class selection and observed selected=${up} for trend="up" (expected text-green-600) and selected=${(output.result.stops[1]?.scopes ?? []).flatMap((scope) => scope.variables ?? []).find((v) => v.name === 'selected')?.value} for trend="down" (expected text-red-600)`,
        };
      });
    }
  }

  // s06a: the Claude subscription binding is built and inspected (no inference), then ONE campaign is opened for both
  // consumers. Cost ceiling: no paid spend at all (subscription route), and at most 2 dispatches on this binding.
  await step('s06a-campaign', '-', 'Claude subscription binding built and tested; campaign opened under the cost ceiling', async () => {
    needs('s00-install', 's03-verifier-A', 's03-verifier-B');
    const { engineeringDigest } = load('tools/cli/lib/engineering-task-state');
    const { createNativeCampaignAdapter, nativeArtifactDigest } = load('tools/cli/lib/provider-native-adapter');
    const executable = fs.realpathSync(spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim());
    const version = /^(\d+\.\d+\.\d+)/.exec(spawnSync(executable, ['--version'], { encoding: 'utf8' }).stdout)?.[1];
    if (!version) throw new Blocked('the claude client version cannot be read');
    const home = process.env.HOME;
    const bindingDir = fs.mkdtempSync(path.join(WORK, 'claude-binding-'));
    const cwd = path.join(bindingDir, 'cwd');
    fs.mkdirSync(cwd);
    const bindingFile = path.join(bindingDir, 'binding.yaml');
    fs.writeFileSync(
      bindingFile,
      [
        'schema_version: 1',
        'profile_id: agent-claude-cli-account-candidate',
        'runtime_provider_id: runtime:claude-cli',
        `executable: ${executable}`,
        `cwd: ${cwd}`,
        'env_names: []',
        'secret_refs: []',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    const tasks = {};
    for (const id of ['A', 'B']) tasks[state.contracts[id].taskId] = { prompt: buildPrompt(CONSUMERS[id], state.clones[id]) };
    const options = {
      model: 'claude-sonnet-5-5',
      pids_max: 128,
      memory_max_bytes: 1_073_741_824,
      tasks,
      environment: { HOME: home, PATH: process.env.PATH },
    };
    const { readBinding } = load('tools/cli/lib/provider-claude-account-adapter');
    const binding_sha256 = engineeringDigest({ binding: readBinding(bindingFile), options });
    const manifestFor = (accountSha) => ({
      schema_version: 1,
      binding_id: 'binding:claude-w5-account',
      binding_sha256,
      vendor: 'claude',
      provider_kind: 'client',
      provider_version: version,
      adapter: 'hseos-claude-campaign-v1',
      artifact_sha256: nativeArtifactDigest(),
      route: 'account',
      transport: 'stdio',
      authentication: {
        mode: 'native_account',
        identity_kind: 'account',
        credential: { name: 'claude-login', source_ref: `file://${home}/.claude` },
        account_sha256: accountSha,
        source: 'explicit',
      },
      billing: { kind: 'subscription', currency: 'USD', max_request_microusd: 0 },
      limits: { max_requests: 2, max_input_tokens: 65_536, max_output_tokens: 2048, max_duration_ms: 240_000 },
      controls: {
        authority: 'external_client',
        resume: 'not_verified',
        cancel: 'not_verified',
        quota: 'not_verified',
        evidence_sha256: null,
      },
    });
    // First pass with a placeholder identity only to read the account digest; inspection runs no inference.
    let probe;
    try {
      probe = createNativeCampaignAdapter({ manifest: manifestFor('a'.repeat(64)), binding: bindingFile, options });
    } catch (error) {
      throw new Error(`binding rejected: ${error.code || error.message}`);
    }
    let observed;
    try {
      observed = await probe.adapter.inspect();
    } catch (error) {
      throw new Blocked(`the Claude account is not eligible: ${error.code || error.message}`);
    }
    const manifest = manifestFor(observed.account_sha256);
    const configured = createNativeCampaignAdapter({ manifest, binding: bindingFile, options });
    const reobserved = await configured.adapter.inspect();
    if (reobserved.account_sha256 !== manifest.authentication.account_sha256) throw new Error('account digest drifted between inspections');
    const { EngineeringControl } = load('tools/cli/lib/engineering-control');
    const authorizationId = randomUUID();
    const deadline = Date.now() + 45 * 60_000;
    const control = new EngineeringControl({
      providerBindings: { [manifest.binding_id]: { manifest, binding_sha256: manifest.binding_sha256, adapter: configured.adapter } },
      providerAuthorizations: {
        [authorizationId]: {
          max_requests: 2,
          max_cost_microusd: 0,
          deadline,
          binding_ids: [manifest.binding_id],
          task_ids: [state.contracts.A.taskId, state.contracts.B.taskId],
          quota_exceptions: {
            [manifest.binding_id]: {
              reason:
                'Owner decision of 2026-10-16, relayed by the Commander in the W5-11b session; the Claude CLI exposes no quota window',
              expires_at: deadline,
            },
          },
        },
      },
    });
    state.control = control;
    const campaignId = randomUUID();
    state.campaignId = campaignId;
    state.binding = { manifest, binding_sha256: manifest.binding_sha256 };
    const campaign = control.providerCampaigns;
    await campaign.execute({
      schema_version: 1,
      command_id: randomUUID(),
      resource_id: campaignId,
      expected_sequence: 0,
      action: 'create',
      input: { authorization_id: authorizationId },
    });
    return {
      binding_id: manifest.binding_id,
      binding_sha256,
      provider_version: version,
      account_sha256: manifest.authentication.account_sha256,
      authenticated: observed.authenticated,
      inspections: 2,
      campaign_id: campaignId,
      authorization: { max_requests: 2, max_cost_microusd: 0, ceiling_microusd: MAX_CAMPAIGN_MICROUSD, tasks: 2 },
      inference_executed: false,
    };
  });

  for (const consumer of consumers) {
    const c = consumer.id;
    await step(`s06-dispatch-${c}`, c, 'model dispatch under the campaign ledger (reserve, then receipt)', async () => {
      needs(`s03-verifier-${c}`, 's06a-campaign');
      // The verifier and the contract are recomputed now and compared with the pin; nothing was reserved yet.
      const before = checkPin({ pinned: state.pinned[c], current: { verifier_sha256: buildPin(c, true).digest } });
      if (!before.ok) throw new Error(`the pinned verifier changed before dispatch: ${trim(before.violations)}`);
      if (!ALLOW_DISPATCH)
        throw new Blocked(
          'dispatch not authorized in this invocation (needs --allow-dispatch and HSEOS_W5_DISPATCH_BINDING=claude); no model was called',
        );
      const campaign = state.control.providerCampaigns;
      const dispatchOrder = Object.keys(state.dispatches).length;
      if (dispatchOrder >= 2) throw new Blocked('dispatch cap reached for this binding');
      const command = {
        schema_version: 1,
        command_id: randomUUID(),
        resource_id: state.campaignId,
        expected_sequence: campaign.rows(state.campaignId).length,
        action: 'run',
        input: { binding_id: state.binding.manifest.binding_id, task_id: state.contracts[c].taskId },
      };
      let outcome;
      try {
        outcome = await campaign.execute(command);
      } catch (error) {
        outcome = { error_code: error.code || error.message };
      }
      const rows = campaign.rows(state.campaignId);
      const report = campaign.query(state.campaignId);
      state.campaign = { rows, report, opened: rows.find((r) => r.payload.kind === 'opened')?.payload };
      if (outcome.error_code)
        throw new Error(`dispatch failed: ${outcome.error_code} (committed ${report.committed_microusd}, requests ${report.requests})`);
      const firstReserved = rows.find((r) => r.payload.kind === 'reserved')?.occurred_at;
      const after = checkPin({
        pinned: state.pinned[c],
        current: { verifier_sha256: buildPin(c, true).digest },
        firstReservedAt: firstReserved,
      });
      if (!after.ok) throw new Error(`the verifier pin does not hold against the ledger: ${trim(after.violations)}`);
      const evidence = campaign.evidence(state.campaignId, command.command_id);
      const receipt = rows.find((r) => r.payload.kind === 'receipt' && r.payload.command_id === command.command_id)?.payload.receipt;
      state.dispatches[c] = { command_id: command.command_id, ref: `campaign://${state.campaignId}/${command.command_id}`, evidence };
      return {
        reference: state.dispatches[c].ref,
        command_id: command.command_id,
        receipt_status: receipt?.status,
        input_tokens: receipt?.input_tokens,
        output_tokens: receipt?.output_tokens,
        cost_microusd: receipt?.cost_microusd,
        evidence_sha256: evidence.evidence_sha256,
        evidence_bytes: evidence.bytes,
        verifier_pin: { pinned_at: state.pinned[c].pinned_at, first_reserved_at: firstReserved, digest_unchanged: true },
        committed_microusd: report.committed_microusd,
        dispatches_on_binding: report.requests,
      };
    });

    // s07: governed correction with the model's own output as the scripted tool calls, admitted by campaign reference.
    await step(
      `s07-correction-${c}`,
      c,
      'governed correction with the model patch (scoped patch, protected verifier, review, apply)',
      async () => {
        needs(`s06-dispatch-${c}`);
        const { runEngineeringTask, inspectEngineeringTask } = load('tools/cli/lib/engineering-task-runtime');
        const { reviewProjectResult, applyProjectResult } = load('tools/cli/lib/engineering-workspace');
        const { engineeringDigest } = load('tools/cli/lib/engineering-task-state');
        const { contract, taskId } = state.contracts[c];
        const campaign = state.control.providerCampaigns;
        const sourced = campaign.resolveResponses(
          { ref: state.dispatches[c].ref, binding_sha256: state.binding.binding_sha256 },
          { task_id: taskId },
        );
        campaign.claimEvidence(sourced.source.command_id, randomUUID(), taskId, engineeringDigest(contract));
        const dir = fs.mkdtempSync(path.join(WORK, `task-${c}-`));
        fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(contract));
        fs.writeFileSync(path.join(dir, 'responses.json'), JSON.stringify(sourced.responses));
        const names = sourced.responses.map((r) => r.name);
        const patched = sourced.responses.find((r) => r.name === 'engineering.patch')?.input;
        const result = await runEngineeringTask({
          taskContract: path.join(dir, 'task.json'),
          scriptedResponses: path.join(dir, 'responses.json'),
          responseSource: sourced.source,
        });
        const detail = {
          task_result: result.task_result,
          reason: result.reason,
          response_names: names,
          patched_path: patched?.path,
          response_source_ref: result.response_source?.ref,
        };
        if (result.task_result !== 'approved') {
          throw Object.assign(new Error(`governed refusal: ${result.task_result} / ${result.reason}`), { detail });
        }
        const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
        const review = reviewProjectResult(evidence);
        const applied = applyProjectResult(evidence, review.review_sha256);
        fs.rmSync(result.state, { recursive: true, force: true });
        const clone = state.clones[c];
        const changed = clone.git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
        if (changed.length !== 1 || changed[0] !== consumer.target) throw new Error(`unexpected change set: ${changed.join(', ')}`);
        return { ...detail, review_sha256: review.review_sha256, applied: applied.applied, changed_files: changed, patch: review.patch };
      },
    );

    await step(`s07c-control-${c}`, c, 'CONTROL (harness patch, not a model): governed machinery on a second clone', async () => {
      needs('s00-install', `s01-clone-${c}`);
      await loadGate(`control ${c}`);
      const control = cloneApp(consumer, `${c}-control`);
      fs.mkdirSync(path.join(control.root, 'hseos_w5'), { recursive: true });
      fs.writeFileSync(path.join(control.root, 'hseos_w5/verify.mjs'), consumer.verifierModule);
      const target = path.join(control.root, consumer.target);
      fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(consumer.defect.before, consumer.defect.after));
      control.git('add', '-A');
      control.git('commit', '-q', '-m', 'inject defect');
      state.controlClones[c] = control;
      if (state.nodeModules[c])
        spawnSync('cp', ['-al', path.join(state.clones[c].root, 'node_modules'), path.join(control.root, 'node_modules')]);
      const { runEngineeringTask, inspectEngineeringTask } = load('tools/cli/lib/engineering-task-runtime');
      const { reviewProjectResult, applyProjectResult } = load('tools/cli/lib/engineering-workspace');
      const file = fs.readFileSync(target, 'utf8');
      const contract = projectContract(consumer, control.root, `w5-${c.toLowerCase()}-control`);
      const dir = fs.mkdtempSync(path.join(WORK, 'control-task-'));
      fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(contract));
      fs.writeFileSync(
        path.join(dir, 'responses.json'),
        JSON.stringify([
          {
            name: 'engineering.patch',
            input: { path: consumer.target, expected_sha256: sha256(file), before: consumer.defect.after, after: consumer.defect.before },
          },
          { name: 'engineering.diff', input: {} },
        ]),
      );
      const result = await runEngineeringTask({
        taskContract: path.join(dir, 'task.json'),
        scriptedResponses: path.join(dir, 'responses.json'),
      });
      if (result.task_result !== 'approved')
        throw new Error(`the protected verifier did not approve: ${result.task_result} ${result.reason}`);
      const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
      const review = reviewProjectResult(evidence);
      const applied = applyProjectResult(evidence, review.review_sha256);
      fs.rmSync(result.state, { recursive: true, force: true });
      const fixed = fs.readFileSync(target, 'utf8');
      if (!fixed.includes(consumer.defect.before)) throw new Error('the approved patch was not applied to the clone');
      return {
        control: true,
        not_a_model_result: true,
        task_result: result.task_result,
        reason: result.reason,
        review_sha256: review.review_sha256,
        applied: applied.applied,
        patch_bytes: review.patch?.length,
      };
    });

    const acceptance = (clone, options) => acceptanceFor(consumer, clone, options);
    const browserCheck = (clone, label) => browserCheckFor(consumer, clone, label);

    await step(`s08-accept-${c}`, c, 'external acceptance on the corrected clone', async () => {
      needs(`s07-correction-${c}`);
      return acceptance(state.clones[c]);
    });

    await step(`s09-browser-${c}`, c, 'browser verification with screenshot', async () => {
      needs(`s02-deps-${c}`, `s08-accept-${c}`);
      await loadGate(`browser ${c}`);
      return browserCheck(state.clones[c], 'fixed');
    });

    // The same two checks on the clone fixed by the harness patch: proves the pipeline before (and apart from) the model.
    await step(`s08c-accept-control-${c}`, c, 'CONTROL: external acceptance on the harness-corrected clone', async () => {
      needs(`s07c-control-${c}`, `s02-deps-${c}`, `s03-verifier-${c}`);
      return { control: true, ...(await acceptance(state.controlClones[c], { pinCheck: true })) };
    });

    await step(`s09c-browser-control-${c}`, c, 'CONTROL: browser verification with screenshot on the harness-corrected clone', async () => {
      needs(`s08c-accept-control-${c}`);
      await loadGate(`browser control ${c}`);
      return { control: true, ...(await browserCheck(state.controlClones[c], 'control-fixed')) };
    });
  }

  // s10: computer-use on a fixture of our own (a real X dialog in a private display), approval gated.
  await step('s10-computer', '-', 'computer-use on an own fixture: approval gate, display change, zero orphans', async () => {
    needs('s00-install');
    await loadGate('computer');
    const pins = environment.loadPins();
    const binaries = ['/usr/bin/Xvfb', '/usr/bin/xwd', '/usr/bin/xdotool', '/usr/bin/xmessage'];
    const probe = load('packages/agent-environment/computer').prepareComputerToolchain({
      verifySystemPin: (a) => pins.verifySystemPin(a),
      cacheDirectory: CACHE,
      destination: fs.mkdtempSync(path.join(WORK, 'computer-probe-')),
      binaries,
    });
    if (probe.status !== 'ready') throw new Blocked(`computer-use cannot run here (${probe.code}: ${probe.cause})`);
    const main = fs.mkdtempSync(path.join(WORK, 'computer-main-'));
    const workspace = path.join(main, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(main, 'protected'), 'protected');
    const ready = load('packages/agent-environment/computer').prepareComputerToolchain({
      verifySystemPin: (a) => pins.verifySystemPin(a),
      cacheDirectory: CACHE,
      destination: workspace,
    });
    if (ready.status !== 'ready') throw new Blocked(`${ready.code}: ${ready.cause}`);
    const policy = iso.createIsolationPolicy({
      backend: 'bwrap',
      host_workspace: workspace,
      main_checkout: main,
      protected_paths: [path.join(main, 'protected')],
      profile: 'P1',
    });
    const { createApprovalGate } = load('tools/cli/lib/environment-approval');
    const { ContextMediaStore } = load('packages/agent-context/media-store');
    const events = [];
    const approvals = createApprovalGate({ ledger: (e) => events.push(e) });
    const mediaStore = new ContextMediaStore({ root: fs.mkdtempSync(path.join(WORK, 'computer-media-')) });
    const service = environment.createDefaultComputerService({
      policy,
      toolchain: ready,
      approvals,
      mediaStore,
      ledger: (e) => events.push(e),
    });
    const markers = () => [...procsMentioning('Xvfb\0:99\0'), ...procsMentioning('/usr/bin/xmessage\0-buttons\0')];
    const preexisting = markers();
    const started = await service.start({
      target: { command: '/usr/bin/xmessage', args: ['-buttons', 'ok:0,cancel:1', 'hello hseos'] },
      timeout_ms: 60_000,
    });
    if (started.status !== 'started') throw new Error(`session did not start: ${trim(started)}`);
    const id = started.session_id;
    const detail = {};
    try {
      const first = await service.screenshot(id);
      if (first.status !== 'ok') throw new Error(`screenshot failed: ${trim(first)}`);
      const shot = first.media[0];
      if (sha256(mediaStore.load(shot)) !== shot.digest) throw new Error('stored screenshot differs from its digest');
      const denied = await service.act(id, { action: 'click', x: 15, y: 40 });
      if (denied.code !== 'ENV_COMPUTER_APPROVAL_REQUIRED') throw new Error(`an unapproved click was not refused: ${trim(denied)}`);
      const same = await service.screenshot(id);
      if (same.media[0].digest !== shot.digest) throw new Error('the display changed without an approved action');
      const pending = service.requestApproval(id, { action: 'click', x: 15, y: 40 });
      approvals.approve(pending.request_id, { approver: 'operator' });
      const clicked = await service.act(id, { action: 'click', x: 15, y: 40 }, { approval_id: pending.request_id });
      if (clicked.status !== 'ok') throw new Error(`approved click failed: ${trim(clicked)}`);
      const after = await service.screenshot(id);
      if (after.media[0].digest === shot.digest) throw new Error('the approved click did not change the display');
      Object.assign(detail, {
        unapproved: denied.code,
        shot_before: shot.digest,
        shot_after: after.media[0].digest,
        isolation: started.isolation,
      });
    } finally {
      const stopped = await service.stop(id);
      detail.stopped = { status: stopped.status, descendants_terminated: stopped.descendants_terminated };
    }
    const orphans = markers().filter((pid) => !preexisting.includes(pid));
    if (detail.stopped.descendants_terminated !== true) throw new Error('descendants were not terminated');
    if (orphans.length > 0) throw new Error(`orphan processes after stop: ${orphans.join(',')}`);
    return { ...detail, orphans: 0 };
  });

  // s11: receipts of THIS run. No dispatch means nothing to assert, and that is BLOCKED.
  await step('s11-receipts', '-', 'campaign ledger receipts (cost ceiling, dispatch cap, reservation before receipt)', async () => {
    if (!flag('assert-receipts')) throw new Blocked('--assert-receipts not requested');
    if (!state.campaign) throw new Blocked('no campaign was opened in this run (no dispatch took place): there are no receipts to assert');
    const { rows, report, opened } = state.campaign;
    const references = Object.fromEntries(Object.values(state.dispatches).map((d) => [d.command_id, d.ref]));
    const verdict = assertReceipts({ rows, report, opened, references, expectedBinding: state.binding?.binding_sha256 });
    if (!verdict.ok) throw new Error(verdict.violations.map((v) => `${v.rule}: ${v.message}`).join('; '));
    return verdict;
  });

  // s11b: REPLAY of the real ledger recorded by the run that dispatched (earlier revision of this journey). No model
  // is called; the same gates run over the recorded rows, and the recorded pins are checked against the first reservation.
  await step(
    's11b-receipts-replay',
    '-',
    'REPLAY of the recorded real ledger through the receipt and pin gates (no dispatch)',
    async () => {
      if (!fs.existsSync(REPLAY_LEDGER)) throw new Blocked(`no recorded ledger at ${REPLAY_LEDGER}`);
      const recorded = JSON.parse(fs.readFileSync(REPLAY_LEDGER, 'utf8'));
      if (!recorded?.rows?.length) throw new Blocked('the recorded ledger is empty');
      const verdict = assertReceipts({ rows: recorded.rows, report: recorded.report, opened: recorded.opened });
      if (!verdict.ok) throw new Error(verdict.violations.map((v) => `${v.rule}: ${v.message}`).join('; '));
      const result = JSON.parse(fs.readFileSync(path.join(path.dirname(REPLAY_LEDGER), 'journey-result.json'), 'utf8'));
      const firstReserved = recorded.rows.find((r) => r.payload.kind === 'reserved').occurred_at;
      const pins = {};
      for (const id of ['A', 'B']) {
        const pin = result.verifier_pins[id];
        const checked = checkPin({ pinned: pin, current: { verifier_sha256: pin.verifier_sha256 }, firstReservedAt: firstReserved });
        if (!checked.ok) throw new Error(`recorded pin ${id}: ${trim(checked.violations)}`);
        pins[id] = { pinned_at: pin.pinned_at, before_first_reservation: true };
      }
      return { replayed: true, dispatches_in_this_invocation: 0, first_reserved_at: firstReserved, pins, ...verdict };
    },
  );

  await closeCampaign();

  // Integrity of the originals and orphan sweep.
  for (const consumer of consumers) {
    const after = fingerprint(CONSUMER_SOURCES[consumer.id]);
    const before = state.originals[consumer.id].before;
    state.originals[consumer.id].after = after;
    state.originals[consumer.id].untouched = JSON.stringify(before) === JSON.stringify(after);
  }
  await step('s12-originals', '-', 'consumer originals untouched (git head, status and path/size/mtime digest)', async () => {
    const bad = Object.entries(state.originals).filter(([, v]) => !v.untouched);
    if (bad.length > 0) throw new Error(`originals changed: ${bad.map(([k]) => k).join(',')}`);
    return Object.fromEntries(Object.entries(state.originals).map(([k, v]) => [k, v.after]));
  });

  const copied = logs.map((l) => {
    const name = `${String(logs.indexOf(l)).padStart(2, '0')}-${l.name}.log.gz`;
    fs.writeFileSync(path.join(EVIDENCE, name), zlib.gzipSync(fs.readFileSync(l.file)));
    return { name, exit: l.exit, sha256: l.sha256, bytes: l.bytes };
  });
  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const countsByKind = {};
  for (const r of results) {
    countsByKind[r.kind] ??= {};
    countsByKind[r.kind][r.status] = (countsByKind[r.kind][r.status] ?? 0) + 1;
  }
  const report = {
    schema_version: 1,
    journey: 'w5-environment-journey',
    base_sha: baseSha,
    node: process.version,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    synthetic_consumers: ['B'],
    dispatch: {
      allowed: ALLOW_DISPATCH,
      ceiling_microusd: MAX_CAMPAIGN_MICROUSD,
      max_per_binding: MAX_DISPATCHES_PER_BINDING,
      executed: Object.keys(state.dispatches).length,
    },
    verifier_pins: state.pinned,
    steps: results,
    counts,
    counts_by_kind: countsByKind,
    logs: copied,
  };
  // The ledger is evidence of a dispatch: a run without one never overwrites the recorded ledger.
  if (state.campaign) fs.writeFileSync(path.join(EVIDENCE, 'ledger-rows.json'), `${JSON.stringify(redact(state.campaign), null, 2)}\n`);
  fs.writeFileSync(path.join(EVIDENCE, 'journey-result.json'), `${JSON.stringify(redact(report), null, 2)}\n`);
  console.log(`\n${JSON.stringify(counts)}  result: ${path.join(EVIDENCE, 'journey-result.json')}`);
  return report;
}

let exitCode = 1;
try {
  const report = await main();
  exitCode = report.counts.FAIL ? 1 : report.counts.BLOCKED ? 3 : 0;
} catch (error) {
  console.error(error);
} finally {
  await closeCampaign().catch(() => {});
  if (!KEEP_WORK) fs.rmSync(WORK, { recursive: true, force: true });
}
process.exit(exitCode);
