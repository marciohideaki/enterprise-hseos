'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { ESLint } = require('eslint');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');

test('every authored package source is linted with correctness rules enabled', async () => {
  const eslint = new ESLint({ cwd: root });
  const files = fs
    .readdirSync(path.join(root, 'packages'), { recursive: true })
    .filter((name) => /\.(?:js|cjs|mjs)$/.test(name) && !name.split(path.sep).includes('node_modules'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const filePath = path.join(root, 'packages', name);
    assert.equal(await eslint.isPathIgnored(filePath), false, name);
    const config = await eslint.calculateConfigForFile(filePath);
    for (const rule of ['no-undef', 'no-unreachable', 'no-unsafe-finally']) {
      assert.equal(config.rules[rule][0], 2, `${name}: ${rule}`);
    }
  }
  const [result] = await eslint.lintText('missingKernelAuthority();\n', {
    filePath: path.join(root, 'packages', 'agent-runtime', 'quality-probe.js'),
  });
  assert.ok(result.messages.some((message) => message.ruleId === 'no-undef'));
});

function expandGlob(pattern) {
  const base = pattern.slice(0, pattern.search(/[*]/) === -1 ? undefined : pattern.search(/[*]/));
  const dir = base.endsWith('/') ? base : path.dirname(base);
  const source = pattern
    .replaceAll('.', String.raw`\.`)
    .replaceAll('**/', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '(?:.*/)?');
  const matcher = new RegExp(`^${source}$`);
  const found = fs.existsSync(path.join(root, pattern))
    ? [pattern]
    : fs
        .readdirSync(path.join(root, dir), { recursive: true })
        .map((name) => `${dir}/${name}`.replaceAll(path.sep, '/').replaceAll(/\/{2,}/g, '/'))
        .filter((name) => matcher.test(name));
  assert.ok(found.length > 0, `kernel include matches no file: ${pattern}`);
  return found;
}

test('undefined globals are detected on every kernel coverage surface', async () => {
  const eslint = new ESLint({ cwd: root });
  const config = JSON.parse(fs.readFileSync(path.join(root, '.c8-kernel.json'), 'utf8'));
  const files = config.include.flatMap((pattern) => expandGlob(pattern));
  assert.ok(files.length >= config.include.length);
  const probed = new Set();
  for (const name of files) {
    const filePath = path.join(root, name);
    const resolved = await eslint.calculateConfigForFile(filePath);
    for (const rule of ['no-undef', 'no-unreachable']) {
      assert.equal(resolved.rules[rule][0], 2, `${name}: ${rule}`);
    }
    // one live probe per top-level surface and extension, on a real kernel path
    const surface = `${name.split('/').slice(0, 2).join('/')}|${path.extname(name)}`;
    if (probed.has(surface)) continue;
    probed.add(surface);
    const [result] = await eslint.lintText('missingKernelAuthority();\n', { filePath });
    assert.ok(
      result.messages.some((message) => message.ruleId === 'no-undef'),
      `${name}: undefined variable not detected`,
    );
  }
  for (const extension of ['.js', '.cjs', '.mjs']) {
    assert.ok(
      [...probed].some((surface) => surface.endsWith(`|${extension}`)),
      `no ${extension} surface probed`,
    );
  }
  assert.ok([...probed].some((surface) => surface.startsWith('tools/')));
});

test('coverage counts unexecuted critical files and enforces per-file 90/80', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.c8-kernel.json'), 'utf8'));
  assert.equal(config.all, true);
  assert.equal(config['check-coverage'], true);
  assert.equal(config['per-file'], true);
  assert.ok(config.lines >= 90);
  assert.ok(config.branches >= 80);
  for (const entry of [
    'packages/agent-runtime/**/*.js',
    'packages/agent-session-store/**/*.js',
    'packages/agent-policy-lattice/**/*.js',
    'packages/agent-orchestration/**/*.js',
    'tools/cli/lib/engineering-*.js',
    'tools/cli/lib/job-materialization.js',
    'tools/cli/lib/job-dispatch.js',
    'tools/cli/lib/job-control.js',
    'tools/cli/lib/job-worker.js',
    'tools/lib/execution-plugin-manifest.js',
    'tools/cli/lib/execution-plugin-runtime.js',
    'tools/cli/lib/execution-plugin-campaign.js',
    'tools/cli/lib/provider-campaign-control.js',
    'tools/mcp-project-state/lib/execution-ledger-schema.js',
    'tools/cli/lib/provider-egress-broker.js',
    'packages/runtime-providers/codex-acp-peer.js',
    'packages/runtime-providers/codex-acp-composition.js',
    'packages/runtime-providers/codex-acp-launcher.js',
    'tools/cli/lib/provider-acp-adapter.js',
    'tools/cli/lib/provider-acp-worker.js',
  ])
    assert.ok(config.include.includes(entry), entry);
});

test('comparison inventory covers every source family and points to real sources and tests', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/evolution/requirements.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, inventory.source.path));
  assert.equal(createHash('sha256').update(source).digest('hex'), inventory.source.sha256);
  const rows = source
    .toString('utf8')
    .split('\n')
    .filter((line) => /^\| \d+\./.test(line));
  assert.equal(rows.length, 27);
  assert.deepEqual(
    inventory.families.map((family) => family.id),
    Array.from({ length: 27 }, (_, index) => `F${String(index + 1).padStart(2, '0')}`),
  );
  for (const [index, family] of inventory.families.entries()) {
    assert.equal(
      family.name,
      rows[index]
        .split('|')[1]
        .trim()
        .replace(/^\d+\. /, ''),
    );
    assert.ok(family.gap.length > 0);
    assert.ok(family.requirements.length > 0);
    assert.ok(family.requirements.every((requirement) => requirement.acceptance && requirement.verification));
    assert.ok(family.implementation.length > 0 && family.tests.length > 0);
    for (const reference of [...family.implementation, ...family.tests]) {
      const resolved = fs.realpathSync(path.resolve(root, reference));
      assert.ok(resolved.startsWith(`${root}${path.sep}`), reference);
      assert.ok(fs.statSync(resolved).isFile(), reference);
    }
  }
});

// `status.operational` is a closed enum. A family is promoted to the pilot value only with evidence that
// resolves inside the checkout (docs/evolution/operational-revalidation-2026-10-30.md holds the per-family table).
const OPERATIONAL_VALUES = ['not_authorized', 'pilot_enterprise_hseos_only'];

function operationalProblems(family) {
  const { operational } = family.status;
  const problems = [];
  if (!OPERATIONAL_VALUES.includes(operational)) {
    problems.push(`${family.id}: operational "${operational}" is not one of ${OPERATIONAL_VALUES.join(', ')}`);
  }
  const evidence = family.operational_evidence;
  if (operational !== 'pilot_enterprise_hseos_only') {
    if (evidence !== undefined) problems.push(`${family.id}: operational_evidence without a promoted status`);
    return problems;
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    problems.push(`${family.id}: pilot_enterprise_hseos_only requires a non-empty operational_evidence list`);
    return problems;
  }
  for (const reference of evidence) {
    try {
      const resolved = fs.realpathSync(path.resolve(root, reference));
      if (!resolved.startsWith(`${root}${path.sep}`) || !fs.statSync(resolved).isFile()) {
        problems.push(`${family.id}: operational_evidence "${reference}" is not a file inside the checkout`);
      }
    } catch {
      problems.push(`${family.id}: operational_evidence "${reference}" does not resolve`);
    }
  }
  return problems;
}

test('operational status is a closed enum and every promoted family cites resolvable evidence', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/evolution/requirements.json'), 'utf8'));
  assert.deepEqual(
    inventory.families.flatMap((family) => operationalProblems(family)),
    [],
  );
  const revalidation = fs.readFileSync(path.join(root, 'docs/evolution/operational-revalidation-2026-10-30.md'), 'utf8');
  for (const family of inventory.families) assert.match(revalidation, new RegExp(`\\| ${family.id}\\s+\\|`), family.id);
});

test('the operational guard refuses free text, a promotion without evidence and unresolvable evidence', () => {
  const family = (operational, extra = {}) => ({ id: 'F99', status: { operational }, ...extra });
  const here = 'docs/evolution/operational-revalidation-2026-10-30.md';
  assert.deepEqual(operationalProblems(family('not_authorized')), []);
  assert.deepEqual(operationalProblems(family('pilot_enterprise_hseos_only', { operational_evidence: [here] })), []);
  for (const [label, candidate] of [
    ['free text', family('authorized_everywhere')],
    ['empty value', family('')],
    ['promotion without evidence', family('pilot_enterprise_hseos_only')],
    ['promotion with empty evidence', family('pilot_enterprise_hseos_only', { operational_evidence: [] })],
    ['missing file', family('pilot_enterprise_hseos_only', { operational_evidence: ['docs/evolution/none.md'] })],
    ['directory', family('pilot_enterprise_hseos_only', { operational_evidence: ['docs/evolution'] })],
    ['path outside the checkout', family('pilot_enterprise_hseos_only', { operational_evidence: ['../outside'] })],
    ['evidence on a non-promoted family', family('not_authorized', { operational_evidence: [here] })],
  ]) {
    assert.notDeepEqual(operationalProblems(candidate), [], label);
  }
});

// `status.real_consumers` is a closed enum (ADR-0050, answer 9). The API-campaign value is admitted only with a
// `real_consumers_evidence` list of files inside the checkout; it states the campaign scope, nothing wider.
const REAL_CONSUMER_VALUES = ['not_verified', 'verified_installed_local_scope_only', 'verified_api_campaign_scope_only'];
const API_CAMPAIGN_VALUE = 'verified_api_campaign_scope_only';

function realConsumerProblems(family) {
  const { real_consumers: value } = family.status;
  const problems = [];
  if (!REAL_CONSUMER_VALUES.includes(value)) {
    problems.push(`${family.id}: real_consumers "${value}" is not one of ${REAL_CONSUMER_VALUES.join(', ')}`);
  }
  const evidence = family.real_consumers_evidence;
  if (value !== API_CAMPAIGN_VALUE) {
    if (evidence !== undefined) problems.push(`${family.id}: real_consumers_evidence without ${API_CAMPAIGN_VALUE}`);
    return problems;
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    problems.push(`${family.id}: ${API_CAMPAIGN_VALUE} requires a non-empty real_consumers_evidence list`);
    return problems;
  }
  for (const reference of evidence) {
    try {
      const resolved = fs.realpathSync(path.resolve(root, reference));
      if (!resolved.startsWith(`${root}${path.sep}`) || !fs.statSync(resolved).isFile()) {
        problems.push(`${family.id}: real_consumers_evidence "${reference}" is not a file inside the checkout`);
      }
    } catch {
      problems.push(`${family.id}: real_consumers_evidence "${reference}" does not resolve`);
    }
  }
  return problems;
}

test('real_consumers is a closed enum and the API campaign value cites resolvable evidence', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/evolution/requirements.json'), 'utf8'));
  assert.deepEqual(
    inventory.families.flatMap((family) => realConsumerProblems(family)),
    [],
  );
});

test('the real_consumers guard refuses free text, the API value without evidence and unresolvable evidence', (t) => {
  const family = (value, extra = {}) => ({ id: 'F99', status: { real_consumers: value }, ...extra });
  const here = 'docs/evolution/operational-revalidation-2026-10-30.md';
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'real-consumers-'));
  const outsideFile = path.join(scratch, 'receipt.json');
  fs.writeFileSync(outsideFile, '{}');
  const outsideRelative = path.relative(root, outsideFile);
  assert.ok(outsideRelative.startsWith('..'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  assert.deepEqual(realConsumerProblems(family('not_verified')), []);
  assert.deepEqual(realConsumerProblems(family('verified_installed_local_scope_only')), []);
  assert.deepEqual(realConsumerProblems(family(API_CAMPAIGN_VALUE, { real_consumers_evidence: [here] })), []);
  for (const [label, candidate] of [
    ['free text', family('verified_everywhere')],
    ['empty value', family('')],
    ['API value without evidence', family(API_CAMPAIGN_VALUE)],
    ['API value with empty evidence', family(API_CAMPAIGN_VALUE, { real_consumers_evidence: [] })],
    ['missing file', family(API_CAMPAIGN_VALUE, { real_consumers_evidence: ['docs/evolution/none.md'] })],
    ['directory', family(API_CAMPAIGN_VALUE, { real_consumers_evidence: ['docs/evolution'] })],
    ['path outside the checkout', family(API_CAMPAIGN_VALUE, { real_consumers_evidence: ['../outside'] })],
    ['existing file outside the checkout (relative)', family(API_CAMPAIGN_VALUE, { real_consumers_evidence: [outsideRelative] })],
    ['existing file outside the checkout (absolute)', family(API_CAMPAIGN_VALUE, { real_consumers_evidence: [outsideFile] })],
    ['evidence on another value', family('not_verified', { real_consumers_evidence: [here] })],
  ]) {
    assert.notDeepEqual(realConsumerProblems(candidate), [], label);
  }
});

// `status.deterministic` is a closed enum (ADR-0050, answer 4): `not_verified_for_evolution` or
// `verified_w<N>_scope_only`, N in 0..8 (the wave range of the PLAN). A promotion made from now on must cite a
// `deterministic_evidence` list of files inside the checkout. The families below were promoted before the axis had an
// evidence field; they are accepted as legacy with their ids and values pinned (no evidence is invented for them), so
// no new family, and no legacy family on a different wave, enters without evidence.
const DETERMINISTIC_NOT_VERIFIED = 'not_verified_for_evolution';
const DETERMINISTIC_VERIFIED = /^verified_w([0-8])_scope_only$/;
const LEGACY_DETERMINISTIC = {
  F01: 'verified_w2_scope_only',
  F02: 'verified_w1_scope_only',
  F03: 'verified_w1_scope_only',
  F04: 'verified_w4_scope_only',
  F05: 'verified_w1_scope_only',
  F06: 'verified_w4_scope_only',
  F09: 'verified_w1_scope_only',
  F10: 'verified_w1_scope_only',
  F11: 'verified_w2_scope_only',
  F12: 'verified_w4_scope_only',
  F13: 'verified_w4_scope_only',
  F14: 'verified_w5_scope_only',
  F15: 'verified_w5_scope_only',
  F16: 'verified_w2_scope_only',
  F19: 'verified_w1_scope_only',
  F20: 'verified_w5_scope_only',
  F21: 'verified_w4_scope_only',
  F22: 'verified_w4_scope_only',
};

function deterministicProblems(family) {
  const { deterministic: value } = family.status;
  const problems = [];
  const verified = typeof value === 'string' && DETERMINISTIC_VERIFIED.test(value);
  if (value !== DETERMINISTIC_NOT_VERIFIED && !verified) {
    problems.push(`${family.id}: deterministic "${value}" is not ${DETERMINISTIC_NOT_VERIFIED} or verified_w<0-8>_scope_only`);
  }
  const evidence = family.deterministic_evidence;
  if (!verified) {
    if (evidence !== undefined) problems.push(`${family.id}: deterministic_evidence without a verified status`);
    return problems;
  }
  if (evidence === undefined && LEGACY_DETERMINISTIC[family.id] === value) return problems;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    problems.push(`${family.id}: ${value} requires a non-empty deterministic_evidence list`);
    return problems;
  }
  for (const reference of evidence) {
    try {
      const resolved = fs.realpathSync(path.resolve(root, reference));
      if (!resolved.startsWith(`${root}${path.sep}`) || !fs.statSync(resolved).isFile()) {
        problems.push(`${family.id}: deterministic_evidence "${reference}" is not a file inside the checkout`);
      }
    } catch {
      problems.push(`${family.id}: deterministic_evidence "${reference}" does not resolve`);
    }
  }
  return problems;
}

test('deterministic is a closed enum and only the pinned legacy families lack evidence', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/evolution/requirements.json'), 'utf8'));
  assert.deepEqual(
    inventory.families.flatMap((family) => deterministicProblems(family)),
    [],
  );
  const promoted = inventory.families.filter((family) => family.status.deterministic !== 'not_verified_for_evolution');
  const unevidenced = promoted.filter((family) => family.deterministic_evidence === undefined);
  assert.deepEqual(Object.fromEntries(unevidenced.map((family) => [family.id, family.status.deterministic])), LEGACY_DETERMINISTIC);
});

test('the deterministic guard refuses free text, out-of-range waves, new promotions without evidence and bad evidence', (t) => {
  const family = (value, extra = {}, id = 'F99') => ({ id, status: { deterministic: value }, ...extra });
  const here = 'docs/evolution/operational-revalidation-2026-10-30.md';
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'deterministic-'));
  const outsideFile = path.join(scratch, 'receipt.json');
  fs.writeFileSync(outsideFile, '{}');
  const outsideRelative = path.relative(root, outsideFile);
  assert.ok(outsideRelative.startsWith('..'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  assert.deepEqual(deterministicProblems(family('not_verified_for_evolution')), []);
  assert.deepEqual(deterministicProblems(family('verified_w0_scope_only', { deterministic_evidence: [here] })), []);
  assert.deepEqual(deterministicProblems(family('verified_w8_scope_only', { deterministic_evidence: [here] })), []);
  const [legacyId, legacyValue] = Object.entries(LEGACY_DETERMINISTIC)[0];
  assert.deepEqual(deterministicProblems(family(legacyValue, {}, legacyId)), []);
  for (const [label, candidate] of [
    ['free text', family('verified_everywhere')],
    ['empty value', family('')],
    ['wave out of range', family('verified_w9_scope_only', { deterministic_evidence: [here] })],
    ['unpadded-wave variant', family('verified_w08_scope_only', { deterministic_evidence: [here] })],
    ['trailing text', family('verified_w1_scope_only_extra', { deterministic_evidence: [here] })],
    ['new promotion without evidence', family('verified_w1_scope_only')],
    ['new promotion with empty evidence', family('verified_w1_scope_only', { deterministic_evidence: [] })],
    ['legacy family re-promoted to another wave', family('verified_w8_scope_only', {}, legacyId)],
    ['missing file', family('verified_w1_scope_only', { deterministic_evidence: ['docs/evolution/none.md'] })],
    ['directory', family('verified_w1_scope_only', { deterministic_evidence: ['docs/evolution'] })],
    ['path outside the checkout', family('verified_w1_scope_only', { deterministic_evidence: ['../outside'] })],
    ['existing file outside the checkout (relative)', family('verified_w1_scope_only', { deterministic_evidence: [outsideRelative] })],
    ['existing file outside the checkout (absolute)', family('verified_w1_scope_only', { deterministic_evidence: [outsideFile] })],
    ['evidence on a non-promoted family', family('not_verified_for_evolution', { deterministic_evidence: [here] })],
  ]) {
    assert.notDeepEqual(deterministicProblems(candidate), [], label);
  }
});

for (const [wave, script, table] of [
  ['W4', 'check-w4-mutations.js', 'w4-mutation-cases.cjs'],
  ['W5', 'check-w5-mutations.js', 'w5-mutants.cjs'],
]) {
  const checker = require(path.join(root, 'scripts', 'governance', script));
  const data = Object.values(require(path.join(root, 'test', 'fixtures', table)))[0];
  const tap = ({ tests = checker.EXPECTED, pass = checker.EXPECTED, fail = 0, skipped = 0, todo = 0 } = {}) =>
    [
      'TAP version 13',
      `# tests ${tests}`,
      `# pass ${pass}`,
      `# fail ${fail}`,
      `# cancelled 0`,
      `# skipped ${skipped}`,
      `# todo ${todo}`,
      '',
    ].join('\n');

  test(`${wave} mutation gate derives its expected count from the mutant table`, () => {
    // W5 adds the group-coverage test to the one-test-per-mutant matrix; W4 has no group test.
    assert.equal(checker.EXPECTED, data.length + (wave === 'W5' ? 1 : 0));
    assert.deepEqual(checker.checkTap(tap(), checker.EXPECTED), { ok: true, problems: [] });
  });

  test(`${wave} mutation gate rejects a short, skipped, todo, failing or unreported run`, () => {
    const n = checker.EXPECTED;
    for (const [label, output] of [
      ['one test fewer', tap({ tests: n - 1, pass: n - 1 })],
      ['one test more', tap({ tests: n + 1, pass: n + 1 })],
      ['a skip', tap({ pass: n - 1, skipped: 1 })],
      ['a todo', tap({ todo: 1 })],
      ['a failure', tap({ pass: n - 1, fail: 1 })],
      ['fail reported with every test passing', tap({ fail: 1 })],
      ['one test not passing with fail 0', tap({ pass: n - 1 })],
      ['a repeated tests line', `${tap()}# tests 1\n`],
      ['a repeated pass line', `${tap()}# pass 1\n`],
      ['a repeated fail line', `${tap()}# fail 0\n`],
      ['a repeated skipped line', `${tap()}# skipped 0\n`],
      ['a repeated todo line', `${tap()}# todo 0\n`],
      ['no tests line', tap().replace(/^# tests .*\n/m, '')],
      ['no skipped line', tap().replace(/^# skipped .*\n/m, '')],
      ['empty output', ''],
    ]) {
      const verdict = checker.checkTap(output, n);
      assert.equal(verdict.ok, false, label);
      assert.ok(verdict.problems.length > 0, label);
    }
  });
}
