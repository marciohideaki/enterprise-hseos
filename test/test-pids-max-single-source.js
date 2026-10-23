'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { createProjectExample } = require('../tools/examples/project-task');
const { parseEngineeringTask } = require('../tools/cli/lib/engineering-task-contract');
const { parseExecutionPluginManifest } = require('../tools/lib/execution-plugin-manifest');
const { LIMIT_CEILING, LIMIT_FLOOR, resolveCallLimits } = require('../packages/agent-isolation-attestation/profiles');

const sha = (value) => createHash('sha256').update(value).digest('hex');
const root = path.resolve(__dirname, '..');
const PROBES = [31, 32, 256, 257];

// Per-command limits exist only on the managed-project (schema 2) contract.
const base = (() => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-pids-'));
  try {
    return createProjectExample('typescript-report', directory).contract;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})();
const contractAccepts = (pids_max) => {
  const contract = structuredClone(base);
  contract.commands[0].limits = { pids_max };
  try {
    parseEngineeringTask(contract);
    return true;
  } catch {
    return false;
  }
};
const manifestAccepts = (pids_max) => {
  try {
    parseExecutionPluginManifest({
      schema_version: 1,
      id: 'external-tool',
      version: '1.0.0',
      kind: 'tool',
      compatibility: { contract_version: 1, node_majors: [22, 24] },
      entrypoint: 'entry.cjs',
      files: { 'entry.cjs': sha('module.exports = {};'), 'conformance.cjs': sha('') },
      capabilities: ['read-context'],
      limits: { timeout_ms: 1000, max_output_bytes: 4096, memory_max_bytes: 268_435_456, pids_max },
      dependencies: [],
      conformance: ['conformance.cjs'],
    });
    return true;
  } catch {
    return false;
  }
};
const profilesAccepts = (pids_max) => {
  try {
    resolveCallLimits({ pids_max });
    return true;
  } catch {
    return false;
  }
};

test('pids_max boundaries are identical across the three validators', () => {
  assert.deepEqual([LIMIT_FLOOR.pids_max, LIMIT_CEILING.pids_max], [32, 256]);
  for (const probe of PROBES) {
    const expected = probe >= LIMIT_FLOOR.pids_max && probe <= LIMIT_CEILING.pids_max;
    assert.equal(profilesAccepts(probe), expected, `profiles ${probe}`);
    assert.equal(contractAccepts(probe), expected, `task contract ${probe}`);
    assert.equal(manifestAccepts(probe), expected, `plugin manifest ${probe}`);
  }
});

// Known limits of this heuristic scan (it is a regex scan, not a proof): it does not see
// expressions such as `Math.min(256, pids_max)`, tuples such as `['pids_max', 256]`,
// arithmetic such as `3 * 32`, values built at run time, or files that are not js/cjs/mjs
// (.d.ts, .py). It also leaves test/ out on purpose. It catches the realistic regressions:
// a copied schema range, a comparison with a literal, or a bound-valued assignment.
// Every pids_max declaration must take its range from the shared constants. The scan is
// formatting-independent: it finds each `pids_max:` property and inspects its whole
// expression (up to the next top-level comma), so multi-line chains are covered.
// Files that must declare the range through the shared constants (positive check).
const RANGE_DECLARATIONS = [
  'tools/cli/lib/engineering-task-contract.js',
  'tools/lib/execution-plugin-manifest.js',
  'tools/cli/lib/provider-antigravity-adapter.js',
  'tools/cli/lib/provider-native-adapter.js',
  'tools/cli/lib/provider-claude-account-adapter.js',
];
// The sweep covers the whole code tree; these are the only files allowed to carry a literal.
const SWEEP_ROOTS = ['tools', 'packages', 'src'];
const SWEEP_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const EXCEPTIONS = new Map([
  ['packages/agent-isolation-attestation/profiles.js', 'the single source: it is where LIMIT_FLOOR and LIMIT_CEILING are defined'],
  [
    'packages/agent-environment/browser.js',
    'a profile value (pids_max: 256) validated at run time by createResourceGroup, not a range declaration; it happens to equal the ceiling',
  ],
]);
const BOUND_VALUES = new Set([LIMIT_FLOOR.pids_max, LIMIT_CEILING.pids_max]);
function rangeViolations(source) {
  const problems = [];
  for (const match of source.matchAll(/\bpids_max\s*:\s*/g)) {
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (char === ',' && depth === 0) break;
    }
    const expression = source.slice(match.index + match[0].length, end);
    for (const bound of expression.matchAll(/\.(min|max)\(([^()]*)\)/g)) {
      const expected = bound[1] === 'min' ? 'LIMIT_FLOOR.pids_max' : 'LIMIT_CEILING.pids_max';
      if (bound[2].trim() !== expected) problems.push(`.${bound[1]}(${bound[2].trim()})`);
    }
  }
  return problems;
}
// A pids limit (any spelling: pids_max, pidsMax, PIDS_MAX, pids-max, MAX_PIDS, quoted or
// bracketed keys; readings such as pids_peak are not limits and are not matched) compared with a numeric literal, or set to a literal equal to a range bound.
// Numeric literals may be decimal, hex, octal or binary, with `_` separators.
const PIDS_NAME = String.raw`["'\`]?[\w$-]*(?:pids[_-]?max|max[_-]?pids)[\w$-]*["'\`]?\]?`;
const NUMBER = String.raw`(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*)`;
const COMPARATOR = String.raw`(?:[<>]=?|[!=]==?)`;
const literalValue = (text) => Number(text.replaceAll('_', ''));
function literalViolations(source) {
  const problems = [];
  const record = (match) => problems.push(match[0].replaceAll(/\s+/g, ' '));
  for (const match of source.matchAll(new RegExp(String.raw`${PIDS_NAME}\s*${COMPARATOR}\s*${NUMBER}\b`, 'gi'))) record(match);
  for (const match of source.matchAll(new RegExp(String.raw`\b${NUMBER}\s*${COMPARATOR}\s*[\w$.]*${PIDS_NAME}`, 'gi'))) record(match);
  for (const match of source.matchAll(new RegExp(String.raw`${PIDS_NAME}\s*(?::|=(?!=))\s*(${NUMBER})\b`, 'gi'))) {
    if (BOUND_VALUES.has(literalValue(match[1]))) record(match);
  }
  return problems;
}
function codeFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) codeFiles(full, found);
    else if (SWEEP_EXTENSIONS.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}
const sweepFiles = () =>
  SWEEP_ROOTS.filter((dir) => fs.existsSync(path.join(root, dir)))
    .flatMap((dir) => codeFiles(path.join(root, dir)))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
function sweep(exceptions = EXCEPTIONS) {
  const offenders = [];
  const files = sweepFiles();
  for (const file of files) {
    if (exceptions.has(file)) continue;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const problems = [...rangeViolations(source), ...literalViolations(source)];
    if (problems.length > 0) offenders.push(`${file}: ${problems.join('; ')}`);
  }
  return { files, offenders };
}

test('every pids_max min/max in the declaring modules references the shared constants', () => {
  for (const file of RANGE_DECLARATIONS) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(/pids_max\s*:\s*[^,]*\.min\(/.test(source), `${file} must declare a pids_max range`);
  }
});

test('no file in the code tree hardcodes the pids_max range outside the single source', () => {
  const { files, offenders } = sweep();
  assert.ok(files.length > 300, `the sweep must cover the whole tree, found ${files.length} files`);
  for (const file of [...EXCEPTIONS.keys(), ...RANGE_DECLARATIONS]) assert.ok(files.includes(file), `${file} is not swept`);
  assert.deepEqual(offenders, [], 'pids_max literal outside the single source');
});

test('the sweep exceptions are real: dropping one makes the sweep fail', () => {
  for (const file of EXCEPTIONS.keys()) {
    const without = new Map(EXCEPTIONS);
    without.delete(file);
    assert.ok(
      sweep(without).offenders.some((entry) => entry.startsWith(`${file}:`)),
      `${file} is excepted but carries no literal`,
    );
  }
});

test('the scan rejects literal bounds regardless of value or formatting', () => {
  for (const mutated of [
    'pids_max: z.number().int().min(33).max(LIMIT_CEILING.pids_max),',
    'pids_max: z.number().int().min(\n32).max(LIMIT_CEILING.pids_max),',
    'pids_max: integer.min(LIMIT_FLOOR.pids_max).max(\n  256\n),',
    'pids_max: z.number().int().min(LIMIT_CEILING.pids_max).max(LIMIT_CEILING.pids_max),',
  ]) {
    assert.notDeepEqual(rangeViolations(mutated), [], mutated);
  }
  assert.deepEqual(rangeViolations('pids_max: z.number().int().min(LIMIT_FLOOR.pids_max).max(LIMIT_CEILING.pids_max).optional(),'), []);
});

test('the literal scan rejects comparisons and bound-valued assignments', () => {
  for (const mutated of [
    'if (pids_max > 256) fail();',
    'if (limits.pids_max < 32) fail();',
    'if (64 <= limits.pids_max) ok();',
    'pids_max: 32,',
    'pids_max = 256) {',
  ]) {
    assert.notDeepEqual(literalViolations(mutated), [], mutated);
  }
  for (const clean of [
    'pids_max: 128,',
    'pids_max: LIMIT_FLOOR.pids_max,',
    'pids_max < LIMIT_FLOOR.pids_max',
    '"pids_max": 128',
    'const MAX_PIDS = 128;',
    'rapids === other',
  ]) {
    assert.deepEqual(literalViolations(clean), [], clean);
  }
});
