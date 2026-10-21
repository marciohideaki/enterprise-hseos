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

test('no module re-declares the pids_max range as a literal', () => {
  const files = [
    'tools/cli/lib/engineering-task-contract.js',
    'tools/lib/execution-plugin-manifest.js',
    'tools/cli/lib/provider-antigravity-adapter.js',
    'tools/cli/lib/provider-native-adapter.js',
    'tools/cli/lib/provider-claude-account-adapter.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const line of source.split('\n').filter((entry) => entry.includes('pids_max'))) {
      assert.doesNotMatch(line, /\.min\(\s*32\s*\)|\.max\(\s*256\s*\)/, `${file} hardcodes the pids_max range: ${line.trim()}`);
    }
  }
  const profiles = fs.readFileSync(path.join(root, 'packages/agent-isolation-attestation/profiles.js'), 'utf8');
  assert.doesNotMatch(profiles, /outside 32-256/, 'profiles message must derive from the constants');
});
