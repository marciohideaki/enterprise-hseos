'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  loadAndValidate,
  repositorySlug,
  validateCorpus,
  verifyPinnedSource,
} = require('../scripts/governance/validate-capability-reference-corpus');

const REPO_ROOT = path.join(__dirname, '..');

function clone(value) {
  return structuredClone(value);
}

function expectFailure(label, fn, pattern) {
  assert.throws(fn, pattern, label);
}

function withGitFixture(files, remote, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-reference-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Capability Governance Tests'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'capability-tests@example.invalid'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents);
    }
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: root });
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    callback({ root, revision });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases = [
  {
    name: 'canonical reference corpus validates as discovery-only',
    fn: () => {
      const result = loadAndValidate({ root: REPO_ROOT });
      assert.strictEqual(result.corpus.authority.role, 'discovery-only');
      assert.strictEqual(result.corpus.authority.canonical_mutation, false);
      assert.strictEqual(result.corpus.authority.creates_adoption, false);
      assert.strictEqual(result.stats.sources, 10);
      assert.strictEqual(result.stats.products, 5);
      assert.strictEqual(result.stats.cores, 5);
    },
  },
  {
    name: 'five product sentinels cover 29 of 33 migration-view capabilities',
    fn: () => {
      const result = loadAndValidate({ root: REPO_ROOT });
      assert.strictEqual(result.stats.product_candidate_coverage, 29);
      assert.deepStrictEqual(result.stats.product_candidate_gaps, [
        'ai.token-metering',
        'ai.guardrails',
        'ai.mcp-gateway',
        'governance.capability-intake',
      ]);
      assert.strictEqual(result.stats.reference_coverage, 33);
    },
  },
  {
    name: 'reference corpus cannot claim canonical mutation or adoption',
    fn: () => {
      const result = loadAndValidate({ root: REPO_ROOT });
      const mutation = clone(result.corpus);
      mutation.authority.canonical_mutation = true;
      expectFailure('canonical mutation', () => validateCorpus(mutation), /cannot mutate/);
      const adoption = clone(result.corpus);
      adoption.authority.creates_adoption = true;
      expectFailure('adoption', () => validateCorpus(adoption), /cannot create adoption/);
    },
  },
  {
    name: 'product sentinel cannot masquerade as a contract or projection source',
    fn: () => {
      const result = loadAndValidate({ root: REPO_ROOT });
      const corpus = clone(result.corpus);
      corpus.sources.find((source) => source.kind === 'product-sentinel').evidence_role = 'contract-or-projection-source';
      expectFailure('false product authority', () => validateCorpus(corpus), /must be candidate-source/);
    },
  },
  {
    name: 'capability signals outside the migration baseline fail closed',
    fn: () => {
      const result = loadAndValidate({ root: REPO_ROOT });
      const corpus = clone(result.corpus);
      corpus.sources[0].candidate_capabilities.push('capability.unregistered');
      expectFailure('unknown capability', () => validateCorpus(corpus), /outside migration baseline/);
    },
  },
  {
    name: 'mutable revisions and evidence path traversal fail closed',
    fn: () => {
      const result = loadAndValidate({ root: REPO_ROOT });
      const mutable = clone(result.corpus);
      mutable.sources[0].revision = 'main';
      expectFailure('mutable revision', () => validateCorpus(mutable), /full Git SHA/);
      const traversal = clone(result.corpus);
      traversal.sources[0].evidence_paths[0] = '../outside';
      expectFailure('traversal', () => validateCorpus(traversal), /escapes repository root/);
    },
  },
  {
    name: 'repository aliases normalize to the same immutable identity',
    fn: () => {
      assert.strictEqual(repositorySlug('github-poynthub:HideakiSolutions/poynt-hub.git'), 'hideakisolutions/poynt-hub');
      assert.strictEqual(repositorySlug('https://github.com/HideakiSolutions/poynt-hub.git'), 'hideakisolutions/poynt-hub');
    },
  },
  {
    name: 'pinned evidence is loaded from the Git object, not the working tree',
    fn: () => {
      const remote = 'https://github.com/hideakisolutions/capability-fixture.git';
      withGitFixture({ 'evidence/proof.txt': 'committed proof\n' }, remote, ({ root, revision }) => {
        fs.writeFileSync(path.join(root, 'evidence/proof.txt'), 'uncommitted mutation\n');
        verifyPinnedSource(
          {
            id: 'reference.capability.fixture',
            repository: 'repo.capability-fixture',
            revision,
            source_uri: remote,
            evidence_paths: ['evidence/proof.txt'],
          },
          root,
        );
      });
    },
  },
  {
    name: 'exact capability query returns product and core discovery sources',
    fn: () => {
      const output = execFileSync(
        'node',
        ['scripts/governance/validate-capability-reference-corpus.js', '--query', 'messaging.event-envelope'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      const sources = JSON.parse(output);
      assert.ok(sources.some((source) => source.id === 'reference.poynt-hub'));
      assert.ok(sources.some((source) => source.id === 'reference.backend-core'));
    },
  },
];

let passed = 0;
let failed = 0;
for (const testCase of cases) {
  try {
    testCase.fn();
    console.log(`  PASS  ${testCase.name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL  ${testCase.name} - ${error.message}`);
    failed++;
  }
}

console.log(`\nCapability reference corpus tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
