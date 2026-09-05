'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const yaml = require('yaml');
const {
  loadAndValidate,
  jsonSchemaBreakingChanges,
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
    name: 'official composition fails closed when any registered fragment is deferred',
    fn: () => {
      expectFailure(
        'deferred official fragments',
        () => loadAndValidate({ root: REPO_ROOT, requireAllFragments: true }),
        /official composition requires all fragments; deferred:/,
      );
    },
  },
  {
    name: 'schema 2.0 is usable through the real registry entrypoint',
    fn: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-graph-v2-entrypoint-'));
      try {
        const schemaPath = '.enterprise/governance/capabilities/schemas/capability-graph-fragment-2.0.0.schema.json';
        const constitutionPath = '.enterprise/.specs/constitution/Enterprise-Constitution.md';
        const fragmentPath = 'fixture.json';
        const registryPath = 'registry.yaml';
        for (const relativePath of [schemaPath, constitutionPath])
          fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
        fs.copyFileSync(path.join(REPO_ROOT, schemaPath), path.join(root, schemaPath));
        fs.writeFileSync(path.join(root, constitutionPath), '# fixture constitution\n');
        fs.writeFileSync(
          path.join(root, fragmentPath),
          JSON.stringify({
            schema_version: '2.0.0',
            fragment_id: 'fragment.v2-entrypoint',
            repository: 'repo.v2-entrypoint',
            nodes: [
              { id: 'owner.v2-entrypoint', type: 'Owner', name: 'V2 owner', lifecycle: 'available' },
              {
                id: 'repo.v2-entrypoint',
                type: 'Repository',
                name: 'V2 repository',
                lifecycle: 'available',
                attributes: { ownership_layer: 'platform-core' },
              },
            ],
            edges: [
              {
                id: 'edge.repo.v2-entrypoint.owned-by',
                type: 'OWNED_BY',
                from: 'repo.v2-entrypoint',
                to: 'owner.v2-entrypoint',
                repository: 'repo.v2-entrypoint',
              },
            ],
            findings: [],
          }),
        );
        fs.writeFileSync(
          path.join(root, registryPath),
          yaml.stringify({
            schema_version: '1.0.0',
            graph_id: 'fixture.v2-entrypoint',
            authority: { constitution_version: '2.2', constitution_path: constitutionPath, adr: 'adr.0033' },
            fragment_schema: { version: '2.0.0', path: schemaPath },
            semantic_discovery: {
              authority: 'advisory',
              canonical_mutation: false,
              allowed_findings: ['CandidateEdge', 'DriftFinding'],
            },
            fragments: [
              {
                id: 'fragment.v2-entrypoint',
                repository: 'repo.v2-entrypoint',
                path: fragmentPath,
                revision: 'same-commit',
                enforcement: 'enforced',
                source: { kind: 'local' },
                validation: { mode: 'local', command: 'fixture' },
              },
            ],
          }),
        );
        const graph = loadAndValidate({ root, registryPath });
        assert.strictEqual(graph.registry.fragment_schema.version, '2.0.0');
        assert.ok(graph.nodes.has('owner.v2-entrypoint'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
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
          attributes: { immutable: true },
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
    name: 'PCCP schema 2.0 classifiers and critical negative fixtures fail closed',
    fn: () => {
      const canonical = loadAndValidate({ root: REPO_ROOT });
      const registry = clone(canonical.registry);
      registry.fragment_schema.version = '2.0.0';
      registry.fragments = [
        {
          id: 'fragment.pccp-fixture',
          repository: 'repo.pccp-fixture',
          path: 'fixture.json',
          revision: 'same-commit',
          enforcement: 'enforced',
          source: { kind: 'local' },
          validation: { mode: 'local', command: 'fixture' },
        },
      ];
      const introductionFragmentPath = '.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml';
      const repositoryUri = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      const baselinePath = '.enterprise/governance/capabilities/schemas/capability-graph-fragment.schema.json';
      const baselineRevision = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      const baselineContents = execFileSync('git', ['show', `${baselineRevision}:${baselinePath}`], { cwd: REPO_ROOT, encoding: 'utf8' });
      const compatibilityBaseline = {
        contract_id: 'contract.capability-graph.fragment.v1',
        repository_uri: repositoryUri,
        revision: baselineRevision,
        fragment_path: introductionFragmentPath,
        path: baselinePath,
        sha256: crypto.createHash('sha256').update(baselineContents).digest('hex'),
      };
      const base = {
        schema_version: '2.0.0',
        fragment_id: 'fragment.pccp-fixture',
        repository: 'repo.pccp-fixture',
        nodes: [
          { id: 'owner.pccp', type: 'Owner', name: 'PCCP Owner', lifecycle: 'available' },
          {
            id: 'repo.pccp-fixture',
            type: 'Repository',
            name: 'PCCP Core',
            lifecycle: 'available',
            attributes: { ownership_layer: 'platform-core' },
          },
          { id: 'capability.pccp-fixture', type: 'Capability', name: 'PCCP Fixture', lifecycle: 'available' },
          {
            id: 'contract.capability-graph.fragment.v1',
            type: 'Contract',
            name: 'PCCP Port',
            lifecycle: 'available',
            version: '1.0.0',
            kind: 'port',
            direction: 'provided',
            path: '.enterprise/governance/capabilities/schemas/capability-graph-fragment.schema.json',
            attributes: { compatibility_baseline: compatibilityBaseline },
          },
          {
            id: 'package.pccp-projection',
            type: 'Package',
            name: 'PCCP Projection',
            lifecycle: 'available',
            role: 'projection',
            path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
            attributes: { distribution_state: 'source-only', publication_state: 'unpublished', change_kind: 'additive' },
          },
          {
            id: 'module.pccp-legacy-projection',
            type: 'Module',
            name: 'Legacy PCCP Projection Representation',
            lifecycle: 'deprecated',
            path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
            rationale: 'Schema 1.0 represented the stack projection as a Module; Package is the PCCP representation.',
            migration_path: 'docs/migrations/pccp-graph-schema-2.0.md',
            attributes: {
              representation_migrated_to: 'package.pccp-projection',
              rollback_path: 'docs/migrations/pccp-graph-schema-2.0.md',
              compatibility_evidence: 'docs/migrations/pccp-graph-schema-2.0.md',
            },
          },
          {
            id: 'module.pccp-specification',
            type: 'Module',
            name: 'PCCP Specification',
            lifecycle: 'available',
            role: 'specification',
            path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
          },
          {
            id: 'module.pccp-reference',
            type: 'Module',
            name: 'PCCP Reference',
            lifecycle: 'available',
            role: 'reference-implementation',
            path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
          },
          { id: 'adapter.pccp', type: 'Adapter', name: 'PCCP Adapter', lifecycle: 'available', kind: 'persistence' },
          { id: 'testsuite.pccp', type: 'TestSuite', name: 'PCCP Suite', lifecycle: 'available' },
          {
            id: 'evidence.pccp',
            type: 'Evidence',
            name: 'PCCP Evidence',
            lifecycle: 'available',
            path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
          },
        ],
        edges: [],
        findings: [],
      };
      for (const node of base.nodes.filter((node) =>
        ['Repository', 'Capability', 'Contract', 'Package', 'Module', 'Adapter', 'TestSuite'].includes(node.type),
      )) {
        base.edges.push({
          id: `edge.${node.id}.owned-by`,
          type: 'OWNED_BY',
          from: node.id,
          to: 'owner.pccp',
          repository: 'repo.pccp-fixture',
        });
      }
      base.edges.push(
        {
          id: 'edge.capability.defined-by',
          type: 'DEFINED_BY',
          from: 'capability.pccp-fixture',
          to: 'contract.capability-graph.fragment.v1',
          repository: 'repo.pccp-fixture',
          evidence: ['evidence.pccp'],
        },
        {
          id: 'edge.capability.defined-by-specification',
          type: 'DEFINED_BY',
          from: 'capability.pccp-fixture',
          to: 'module.pccp-specification',
          repository: 'repo.pccp-fixture',
          evidence: ['evidence.pccp'],
        },
        {
          id: 'edge.capability.implemented-by',
          type: 'IMPLEMENTED_BY',
          from: 'capability.pccp-fixture',
          to: 'module.pccp-reference',
          repository: 'repo.pccp-fixture',
          evidence: ['evidence.pccp'],
        },
        {
          id: 'edge.capability.extended-by',
          type: 'EXTENDED_BY',
          from: 'capability.pccp-fixture',
          to: 'adapter.pccp',
          repository: 'repo.pccp-fixture',
          evidence: ['evidence.pccp'],
        },
        {
          id: 'edge.capability.validated-by',
          type: 'VALIDATED_BY',
          from: 'capability.pccp-fixture',
          to: 'testsuite.pccp',
          repository: 'repo.pccp-fixture',
          evidence: ['evidence.pccp'],
        },
        {
          id: 'edge.package.depends-on-contract',
          type: 'DEPENDS_ON',
          from: 'package.pccp-projection',
          to: 'contract.capability-graph.fragment.v1',
          repository: 'repo.pccp-fixture',
        },
        {
          id: 'edge.package.supersedes-legacy-projection-module',
          type: 'SUPERSEDES',
          from: 'package.pccp-projection',
          to: 'module.pccp-legacy-projection',
          repository: 'repo.pccp-fixture',
          evidence: ['evidence.pccp'],
        },
        {
          id: 'edge.adapter.depends-on-port',
          type: 'DEPENDS_ON',
          from: 'adapter.pccp',
          to: 'contract.capability-graph.fragment.v1',
          repository: 'repo.pccp-fixture',
        },
      );
      validateGraph(registry, [base], REPO_ROOT);
      const installedNotAdopted = clone(base);
      const installedPackage = installedNotAdopted.nodes.find((node) => node.id === 'package.pccp-projection');
      installedPackage.attributes = { distribution_state: 'published', publication_state: 'published' };
      installedNotAdopted.nodes.push(
        {
          id: 'artifact.pccp.install-only.v1',
          type: 'ArtifactVersion',
          name: 'Install-only artifact',
          lifecycle: 'available',
          version: '1.0.0',
          path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
          attributes: { immutable: true },
        },
        {
          id: 'consumer.pccp.install-only',
          type: 'Consumer',
          name: 'Verified but not adopted consumer',
          lifecycle: 'available',
          path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
          attributes: {
            installation_state: 'verified-install',
            adoption_state: 'not-adopted',
            artifact_version_id: 'artifact.pccp.install-only.v1',
          },
        },
      );
      installedNotAdopted.edges.push(
        {
          id: 'edge.artifact.pccp.install-only.owned-by',
          type: 'OWNED_BY',
          from: 'artifact.pccp.install-only.v1',
          to: 'owner.pccp',
          repository: 'repo.pccp-fixture',
        },
        {
          id: 'edge.package.pccp.install-only.published-as',
          type: 'PUBLISHED_AS',
          from: 'package.pccp-projection',
          to: 'artifact.pccp.install-only.v1',
          repository: 'repo.pccp-fixture',
          evidence: ['evidence.pccp'],
        },
        {
          id: 'edge.consumer.pccp.install-only.depends-on-package',
          type: 'DEPENDS_ON',
          from: 'consumer.pccp.install-only',
          to: 'package.pccp-projection',
          repository: 'repo.pccp-fixture',
        },
      );
      validateGraph(registry, [installedNotAdopted], REPO_ROOT);
      const fixtures = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/capability-graph/pccp-v2-negative-rules.json')));
      for (const fixture of fixtures) {
        const graph = clone(base);
        const edge = (id) => graph.edges.find((candidate) => candidate.id === id);
        switch (fixture.id) {
          case 'missing-owner': {
            graph.edges = graph.edges.filter((candidate) => candidate.id !== 'edge.package.pccp-projection.owned-by');
            break;
          }
          case 'available-without-contract': {
            graph.edges = graph.edges.filter((candidate) => candidate.id !== 'edge.capability.defined-by');
            break;
          }
          case 'available-without-specification': {
            graph.edges = graph.edges.filter((candidate) => candidate.id !== 'edge.capability.defined-by-specification');
            break;
          }
          case 'available-without-implementation': {
            graph.edges = graph.edges.filter((candidate) => candidate.id !== 'edge.capability.implemented-by');
            break;
          }
          case 'available-without-conformance': {
            graph.edges = graph.edges.filter((candidate) => candidate.id !== 'edge.capability.validated-by');
            break;
          }
          case 'projection-without-contract': {
            graph.edges = graph.edges.filter((candidate) => candidate.id !== 'edge.package.depends-on-contract');
            break;
          }
          case 'adapter-without-port': {
            graph.edges = graph.edges.filter((candidate) => candidate.id !== 'edge.adapter.depends-on-port');
            break;
          }
          case 'package-without-role': {
            delete graph.nodes.find((node) => node.id === 'package.pccp-projection').role;
            break;
          }
          case 'legacy-projection-tombstone-without-supersedes': {
            graph.edges = graph.edges.filter(
              (candidate) => candidate.id !== 'edge.package.supersedes-legacy-projection-module',
            );
            break;
          }
          case 'cross-type-supersedes-wrong-package-role': {
            graph.nodes.find((node) => node.id === 'package.pccp-projection').role = 'implementation';
            break;
          }
          case 'active-legacy-projection-tombstone': {
            graph.nodes.find((node) => node.id === 'module.pccp-legacy-projection').lifecycle = 'available';
            break;
          }
          case 'reference-implementation-production-ready': {
            graph.nodes.find((node) => node.id === 'module.pccp-reference').attributes = { production_ready: true };
            break;
          }
          case 'relationship-without-evidence': {
            delete edge('edge.capability.defined-by').evidence;
            break;
          }
          case 'dependency-cycle': {
            graph.edges.push({
              id: 'edge.contract.depends-on-package',
              type: 'DEPENDS_ON',
              from: 'contract.capability-graph.fragment.v1',
              to: 'package.pccp-projection',
              repository: 'repo.pccp-fixture',
            });
            break;
          }
          case 'product-to-core-inversion': {
            graph.nodes.push({
              id: 'project.product',
              type: 'Project',
              name: 'Product',
              lifecycle: 'available',
              attributes: { ownership_layer: 'product' },
            });
            graph.edges.push(
              {
                id: 'edge.project.product.owned-by',
                type: 'OWNED_BY',
                from: 'project.product',
                to: 'owner.pccp',
                repository: 'repo.pccp-fixture',
              },
              {
                id: 'edge.core.depends-on-product',
                type: 'DEPENDS_ON',
                from: 'repo.pccp-fixture',
                to: 'project.product',
                repository: 'repo.pccp-fixture',
              },
            );
            break;
          }
          case 'source-only-published': {
            graph.nodes.push({
              id: 'artifact.pccp.v1',
              type: 'ArtifactVersion',
              name: 'Artifact',
              lifecycle: 'available',
              version: '1.0.0',
              attributes: { immutable: true },
            });
            graph.edges.push(
              {
                id: 'edge.artifact.pccp.owned-by',
                type: 'OWNED_BY',
                from: 'artifact.pccp.v1',
                to: 'owner.pccp',
                repository: 'repo.pccp-fixture',
              },
              {
                id: 'edge.package.published-as',
                type: 'PUBLISHED_AS',
                from: 'package.pccp-projection',
                to: 'artifact.pccp.v1',
                repository: 'repo.pccp-fixture',
                evidence: ['evidence.pccp'],
              },
            );
            break;
          }
          case 'baseline-does-not-match-contract-path': {
            const contract = graph.nodes.find((node) => node.id === 'contract.capability-graph.fragment.v1');
            contract.path = '.enterprise/governance/capabilities/schemas/capability-graph-fragment-2.0.0.schema.json';
            contract.attributes = {
              compatibility_baseline: compatibilityBaseline,
            };
            break;
          }
          case 'declared-breaking-with-unrelated-baseline': {
            const successor = graph.nodes.find((node) => node.id === 'contract.capability-graph.fragment.v1');
            successor.path = '.enterprise/governance/capabilities/schemas/capability-graph-fragment-2.0.0.schema.json';
            successor.version = '2.0.0';
            successor.attributes = {
              compatibility_baseline: compatibilityBaseline,
              change_kind: 'breaking',
            };
            graph.nodes.push({
              id: 'contract.pccp-port.v1',
              type: 'Contract',
              name: 'PCCP Port predecessor',
              lifecycle: 'deprecated',
              version: '1.0.0',
              kind: 'port',
              direction: 'provided',
              path: baselinePath,
              attributes: { compatibility_baseline: compatibilityBaseline },
            });
            graph.edges.push(
              {
                id: 'edge.contract.pccp-port-v1.owned-by',
                type: 'OWNED_BY',
                from: 'contract.pccp-port.v1',
                to: 'owner.pccp',
                repository: 'repo.pccp-fixture',
              },
              {
                id: 'edge.contract.pccp-port.supersedes-v1',
                type: 'SUPERSEDES',
                from: 'contract.capability-graph.fragment.v1',
                to: 'contract.pccp-port.v1',
                repository: 'repo.pccp-fixture',
                evidence: ['evidence.pccp'],
              },
            );
            break;
          }
          case 'published-presented-as-adopted': {
            graph.nodes.find((node) => node.id === 'package.pccp-projection').attributes.adoption_state = 'adopted';
            break;
          }
          case 'node-without-traceable-evidence': {
            graph.nodes.push({
              id: 'module.pccp-untraced',
              type: 'Module',
              name: 'Untraced policy',
              lifecycle: 'available',
              role: 'policy',
            });
            graph.edges.push({
              id: 'edge.module.pccp-untraced.owned-by',
              type: 'OWNED_BY',
              from: 'module.pccp-untraced',
              to: 'owner.pccp',
              repository: 'repo.pccp-fixture',
            });
            break;
          }
          case 'implementation-is-specification': {
            edge('edge.capability.implemented-by').to = 'module.pccp-specification';
            break;
          }
          case 'published-distribution-unpublished': {
            graph.nodes.find((node) => node.id === 'package.pccp-projection').attributes.distribution_state = 'published';
            break;
          }
          case 'repository-without-ownership-layer': {
            delete graph.nodes.find((node) => node.id === 'repo.pccp-fixture').attributes.ownership_layer;
            break;
          }
          case 'published-without-artifact': {
            const packageNode = graph.nodes.find((node) => node.id === 'package.pccp-projection');
            packageNode.attributes.distribution_state = 'published';
            packageNode.attributes.publication_state = 'published';
            break;
          }
          case 'adopted-without-installation': {
            graph.nodes.push({
              id: 'consumer.pccp-invalid',
              type: 'Consumer',
              name: 'Invalid consumer',
              lifecycle: 'available',
              attributes: { installation_state: 'not-installed', adoption_state: 'adopted', artifact_version_id: 'artifact.pccp.v1' },
            });
            break;
          }
          case 'verified-install-without-publication-chain': {
            graph.nodes.push(
              {
                id: 'artifact.pccp.unpublished.v1',
                type: 'ArtifactVersion',
                name: 'Unpublished artifact',
                lifecycle: 'available',
                version: '1.0.0',
                path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
                attributes: { immutable: true },
              },
              {
                id: 'consumer.pccp.unproven-install',
                type: 'Consumer',
                name: 'Unproven install',
                lifecycle: 'available',
                path: '.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md',
                attributes: {
                  installation_state: 'verified-install',
                  adoption_state: 'not-adopted',
                  artifact_version_id: 'artifact.pccp.unpublished.v1',
                },
              },
            );
            graph.edges.push({
              id: 'edge.artifact.pccp.unpublished.owned-by',
              type: 'OWNED_BY',
              from: 'artifact.pccp.unpublished.v1',
              to: 'owner.pccp',
              repository: 'repo.pccp-fixture',
            });
            break;
          }
          default: {
            throw new Error(`unknown PCCP negative fixture: ${fixture.id}`);
          }
        }
        expectFailure(fixture.id, () => validateGraph(registry, [graph], REPO_ROOT), new RegExp(fixture.expected));
      }
    },
  },
  {
    name: 'automatic JSON Schema compatibility detects constraint tightening',
    fn: () => {
      const previous = {
        type: 'object',
        properties: {
          value: { type: ['string', 'null'], minLength: 1 },
          tags: { type: 'array', items: { type: 'string' } },
        },
      };
      const current = {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: {
          value: { type: 'string', minLength: 2, pattern: '^[a-z]+$', multipleOf: 2 },
          tags: { type: 'array', uniqueItems: true, items: { type: 'string', format: 'uuid' } },
        },
        if: { required: ['value'] },
        oneOf: [{ required: ['value'] }],
        not: { required: ['forbidden'] },
      };
      const findings = jsonSchemaBreakingChanges(previous, current);
      for (const expected of ['type was narrowed', 'required property added', 'additional properties', 'uniqueItems', 'format', 'if constraint added', 'minLength', 'pattern', 'multipleOf', 'oneOf constraint added', 'not constraint added']) {
        assert.ok(findings.some((finding) => finding.includes(expected)), `missing compatibility finding: ${expected}`);
      }
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
            'branches:\n  - name: master\n    protection:\n      enforce_admins: true\n      required_pull_request_reviews: null\n',
        },
        ({ root }) => {
          fs.writeFileSync(
            path.join(root, constitution),
            '**Version:** 2.2\n\nProtected ownership and explicit Engineering Leadership approval recorded on the PR.\n',
          );
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
