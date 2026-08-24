'use strict';

const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  loadAndValidate,
  readPinnedGitFragment,
  safeResolve,
  validateGraph,
  validateRegistry,
} = require('../scripts/governance/validate-capability-graph');
const { isGreater, parseVersion, validateConstitutionChange } = require('../scripts/governance/validate-constitutional-change');

const REPO_ROOT = path.join(__dirname, '..');

function clone(value) {
  return structuredClone(value);
}

function expectFailure(label, fn, pattern) {
  assert.throws(fn, pattern, label);
}

const cases = [
  {
    name: 'canonical federated graph passes deterministic validation',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      assert.ok(graph.nodes.has('capability.governance.capability-graph'));
      assert.ok(graph.edges.size > 0);
      assert.strictEqual(graph.registry.fragments.length, 2);
      assert.strictEqual(graph.deferredFragments.length, 1);
      assert.strictEqual(graph.deferredFragments[0].repository, 'repo.platform-core');
    },
  },
  {
    name: 'delegated Git fragments require immutable revision pins',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const registry = clone(graph.registry);
      const external = registry.fragments.find((fragment) => fragment.repository === 'repo.platform-core');
      external.revision = 'feature/platform-governance-hardening';
      expectFailure('mutable git revision', () => validateRegistry(registry, REPO_ROOT), /full Git SHA/);
    },
  },
  {
    name: 'mapped Git fragments are loaded from their pinned commit',
    fn: () => {
      const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      const fragment = readPinnedGitFragment(REPO_ROOT, {
        id: 'fragment.enterprise-hseos.fixture',
        revision,
        path: '.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml',
        source: { kind: 'git', uri: 'https://github.com/marciohideaki/enterprise-hseos.git' },
      });
      assert.strictEqual(fragment.fragment_id, 'fragment.enterprise-hseos');
      assert.ok(fragment.nodes.some((node) => node.id === 'capability.governance.capability-graph'));
    },
  },
  {
    name: 'repository traversal is rejected',
    fn: () => expectFailure('traversal', () => safeResolve(REPO_ROOT, '../outside.yaml', 'fixture'), /escapes repository root/),
  },
  {
    name: 'dangling graph edges fail closed',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const fragments = clone(graph.fragments);
      fragments[0].edges[0].to = 'owner.missing';
      expectFailure('dangling edge', () => validateGraph(graph.registry, fragments, REPO_ROOT), /dangling edge target/);
    },
  },
  {
    name: 'multiple canonical owners fail closed',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const fragments = clone(graph.fragments);
      fragments[0].nodes.push({ id: 'owner.secondary', type: 'Owner', name: 'Secondary Owner', lifecycle: 'available' });
      fragments[0].edges.push({
        id: 'edge.repo.enterprise-hseos.owned-by.secondary',
        type: 'OWNED_BY',
        from: 'repo.enterprise-hseos',
        to: 'owner.secondary',
        repository: 'repo.enterprise-hseos',
      });
      expectFailure('multiple owners', () => validateGraph(graph.registry, fragments, REPO_ROOT), /exactly one OWNED_BY/);
    },
  },
  {
    name: 'dependency cycles fail closed',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const fragments = clone(graph.fragments);
      fragments[0].edges.push(
        {
          id: 'edge.graph-validator.depends-on.constitution-validator',
          type: 'DEPENDS_ON',
          from: 'module.capability-graph.validator',
          to: 'module.constitution-change.validator',
          repository: 'repo.enterprise-hseos',
        },
        {
          id: 'edge.constitution-validator.depends-on.graph-validator',
          type: 'DEPENDS_ON',
          from: 'module.constitution-change.validator',
          to: 'module.capability-graph.validator',
          repository: 'repo.enterprise-hseos',
        },
      );
      expectFailure('cycle', () => validateGraph(graph.registry, fragments, REPO_ROOT), /cycle detected/);
    },
  },
  {
    name: 'expired exceptions fail closed',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const fragments = clone(graph.fragments);
      fragments[0].nodes.push({
        id: 'exception.expired',
        type: 'Exception',
        name: 'Expired migration exception',
        lifecycle: 'available',
        expires_on: '2000-01-01',
        rationale: 'negative fixture',
        scope: 'test only',
        migration_path: 'remove fixture',
      });
      expectFailure('expired exception', () => validateGraph(graph.registry, fragments, REPO_ROOT), /is expired/);
    },
  },
  {
    name: 'semantic findings cannot auto-promote canonical edges',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const fragments = clone(graph.fragments);
      fragments[0].findings.push({
        id: 'finding.semantic.autopromotion',
        kind: 'CandidateEdge',
        status: 'promoted',
        sources: ['capability.governance.capability-graph'],
        reason: 'negative fixture',
        provenance: 'test-index',
        promoted_edge_id: 'edge.capability.capability-graph.governed-by.adr-0022',
      });
      expectFailure(
        'semantic auto-promotion',
        () => validateGraph(graph.registry, fragments, REPO_ROOT),
        /requires Evidence review_evidence/,
      );
    },
  },
  {
    name: 'exact graph query returns typed relationships',
    fn: () => {
      const output = execFileSync(
        'node',
        ['scripts/governance/validate-capability-graph.js', '--query', 'capability.governance.capability-graph'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      const result = JSON.parse(output);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'Capability');
      assert.ok(result[0].outgoing.length >= 4);
    },
  },
  {
    name: 'constitutional versions require monotonic increase',
    fn: () => {
      assert.deepStrictEqual(parseVersion('**Version:** 2.2\n', 'fixture'), { major: 2, minor: 2, raw: '2.2' });
      assert.ok(isGreater({ major: 2, minor: 2 }, { major: 2, minor: 1 }));
      assert.ok(!isGreater({ major: 2, minor: 1 }, { major: 2, minor: 1 }));
    },
  },
  {
    name: 'current constitutional amendment is linked and protected',
    fn: () => {
      const result = validateConstitutionChange({ root: REPO_ROOT, base: 'master' });
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.previous_version, '2.1');
      assert.strictEqual(result.version, '2.2');
      assert.ok(result.adrs.some((file) => file.includes('ADR-0022')));
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

console.log(`\nCapability graph governance tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
