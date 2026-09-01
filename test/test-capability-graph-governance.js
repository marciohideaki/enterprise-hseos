'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
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

function withGitFixture(files, callback, remote) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-graph-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Capability Governance Tests'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'capability-tests@example.invalid'], { cwd: root });
    if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents);
    }
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'fixture baseline'], { cwd: root });
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    callback({ root, revision });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases = [
  {
    name: 'canonical federated graph passes deterministic validation',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      assert.ok(graph.nodes.has('capability.governance.capability-graph'));
      assert.ok(graph.edges.size > 0);
      assert.strictEqual(graph.registry.fragments.length, 4);
      assert.strictEqual(graph.deferredFragments.length, 3);
      assert.deepStrictEqual(
        graph.deferredFragments.map((fragment) => fragment.repository),
        ['repo.platform-core', 'repo.backend-core', 'repo.cambio-real-v2'],
      );
    },
  },
  {
    name: 'verified adoption requires a published installed artifact',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const fragments = clone(graph.fragments);
      const fragment = fragments[0];
      fragment.nodes.push(
        {
          id: 'package.fixture.messaging',
          type: 'Package',
          name: 'Fixture Package',
          lifecycle: 'available',
          attributes: { publication_state: 'published' },
        },
        {
          id: 'artifact.fixture.messaging.v1',
          type: 'ArtifactVersion',
          name: 'Fixture Package 1.0.0',
          lifecycle: 'available',
          version: '1.0.0',
        },
        {
          id: 'consumer.fixture.messaging',
          type: 'Consumer',
          name: 'Fixture Consumer',
          lifecycle: 'available',
          attributes: { adoption_state: 'verified-install', artifact_version_id: 'artifact.fixture.messaging.v1' },
        },
      );
      fragment.edges.push(
        {
          id: 'edge.package.fixture.owned-by.platform-architecture',
          type: 'OWNED_BY',
          from: 'package.fixture.messaging',
          to: 'owner.platform-architecture',
          repository: 'repo.enterprise-hseos',
        },
        {
          id: 'edge.artifact.fixture.owned-by.platform-architecture',
          type: 'OWNED_BY',
          from: 'artifact.fixture.messaging.v1',
          to: 'owner.platform-architecture',
          repository: 'repo.enterprise-hseos',
        },
        {
          id: 'edge.package.fixture.published-as.v1',
          type: 'PUBLISHED_AS',
          from: 'package.fixture.messaging',
          to: 'artifact.fixture.messaging.v1',
          repository: 'repo.enterprise-hseos',
          evidence: ['evidence.capability-graph.policy'],
        },
        {
          id: 'edge.consumer.fixture.depends-on.package',
          type: 'DEPENDS_ON',
          from: 'consumer.fixture.messaging',
          to: 'package.fixture.messaging',
          repository: 'repo.enterprise-hseos',
        },
        {
          id: 'edge.capability.graph.consumed-by.fixture',
          type: 'CONSUMED_BY',
          from: 'capability.governance.capability-graph',
          to: 'consumer.fixture.messaging',
          repository: 'repo.enterprise-hseos',
          evidence: ['evidence.capability-graph.policy'],
        },
      );
      validateGraph(graph.registry, fragments, REPO_ROOT);
      fragment.nodes.find((node) => node.id === 'consumer.fixture.messaging').attributes = {
        adoption_state: 'compatibility-evidence-only',
      };
      expectFailure('false adoption', () => validateGraph(graph.registry, fragments, REPO_ROOT), /verified-install/);
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
      const fragmentPath = '.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml';
      const fragmentContents = fs.readFileSync(path.join(REPO_ROOT, fragmentPath), 'utf8');
      const remote = 'https://github.com/hideakisolutions/capability-graph-fixture.git';
      withGitFixture(
        { [fragmentPath]: fragmentContents },
        ({ root, revision }) => {
          fs.writeFileSync(path.join(root, fragmentPath), 'fragment_id: uncommitted-mutation\n');
          const fragment = readPinnedGitFragment(root, {
            id: 'fragment.enterprise-hseos.fixture',
            revision,
            path: fragmentPath,
            source: { kind: 'git', uri: remote },
          });
          assert.strictEqual(fragment.fragment_id, 'fragment.enterprise-hseos');
          assert.ok(fragment.nodes.some((node) => node.id === 'capability.governance.capability-graph'));
        },
        remote,
      );
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
    name: 'typed relationship endpoints fail closed',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const fragments = clone(graph.fragments);
      fragments[0].edges.push({
        id: 'edge.invalid.implemented-by',
        type: 'IMPLEMENTED_BY',
        from: 'module.capability-graph.validator',
        to: 'module.constitution-change.validator',
        repository: 'repo.enterprise-hseos',
        evidence: ['evidence.capability-graph.policy'],
      });
      expectFailure('typed endpoint', () => validateGraph(graph.registry, fragments, REPO_ROOT), /invalid IMPLEMENTED_BY source type/);
    },
  },
  {
    name: 'semantic relationships require tracked evidence',
    fn: () => {
      const graph = loadAndValidate({ root: REPO_ROOT });
      const fragments = clone(graph.fragments);
      const governed = fragments[0].edges.find((edge) => edge.type === 'GOVERNED_BY');
      delete governed.evidence;
      expectFailure('missing evidence', () => validateGraph(graph.registry, fragments, REPO_ROOT), /requires tracked evidence/);
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
      const constitution = '.enterprise/.specs/constitution/Enterprise-Constitution.md';
      const adr = '.enterprise/.specs/decisions/ADR-0033-federated-platform-capability-graph.md';
      withGitFixture(
        {
          [constitution]: '**Version:** 2.1\n\nBaseline.\n',
          '.github/CODEOWNERS': `${constitution} @platform-architecture\n`,
          '.github/branch-protection.yaml':
            'branches:\n  - name: master\n    protection:\n      required_pull_request_reviews:\n        require_code_owner_reviews: true\n',
        },
        ({ root }) => {
          fs.writeFileSync(path.join(root, constitution), '**Version:** 2.2\n\nCode-owner approval enforced by branch protection.\n');
          const adrPath = path.join(root, adr);
          fs.mkdirSync(path.dirname(adrPath), { recursive: true });
          fs.writeFileSync(adrPath, '**Status:** Accepted\n**Affects Standards:** Enterprise Constitution\n');
          execFileSync('git', ['add', constitution, adr], { cwd: root });
          const result = validateConstitutionChange({ root, base: 'HEAD' });
          assert.strictEqual(result.changed, true);
          assert.strictEqual(result.previous_version, '2.1');
          assert.strictEqual(result.version, '2.2');
          assert.ok(result.adrs.some((file) => file.includes('ADR-0033')));
        },
      );
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
