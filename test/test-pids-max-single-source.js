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

// Every pids_max declaration must take its range from the shared constants. The scan is
// formatting-independent: it finds each `pids_max:` property and inspects its whole
// expression (up to the next top-level comma), so multi-line chains are covered.
const SCANNED = [
  'tools/cli/lib/engineering-task-contract.js',
  'tools/lib/execution-plugin-manifest.js',
  'tools/cli/lib/provider-antigravity-adapter.js',
  'tools/cli/lib/provider-native-adapter.js',
  'tools/cli/lib/provider-claude-account-adapter.js',
];
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

test('every pids_max min/max in the scanned modules references the shared constants', () => {
  for (const file of SCANNED) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(/pids_max\s*:\s*[^,]*\.min\(/.test(source), `${file} must declare a pids_max range`);
    assert.deepEqual(rangeViolations(source), [], `${file} hardcodes the pids_max range`);
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
