'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

const NODE_TYPES = new Set([
  'Capability',
  'Contract',
  'Package',
  'ArtifactVersion',
  'Repository',
  'Project',
  'Module',
  'Consumer',
  'Adapter',
  'Provider',
  'PartnerApi',
  'ErrorCatalog',
  'Adr',
  'Owner',
  'Evidence',
  'TestSuite',
  'Exception',
]);
const EDGE_TYPES = new Set([
  'DEFINED_BY',
  'OWNED_BY',
  'IMPLEMENTED_BY',
  'CONSUMED_BY',
  'EXTENDED_BY',
  'VALIDATED_BY',
  'PUBLISHED_AS',
  'GOVERNED_BY',
  'DEPENDS_ON',
  'SUPERSEDES',
  'EXCEPTED_BY',
]);
const LIFECYCLES = new Set(['proposed', 'available', 'deprecated', 'retired']);
const OWNERSHIP_REQUIRED = new Set([
  'Capability',
  'Contract',
  'Package',
  'ArtifactVersion',
  'Repository',
  'Project',
  'Module',
  'Adapter',
  'Provider',
  'PartnerApi',
  'ErrorCatalog',
  'Adr',
  'TestSuite',
]);
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DEFAULT_REGISTRY = '.enterprise/governance/capabilities/registry.yaml';

function fail(message) {
  throw new Error(message);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

function assertExactKeys(value, allowed, required, label) {
  assertObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} has unsupported property: ${key}`);
  }
  for (const key of required) {
    if (value[key] === undefined) fail(`${label} is missing required property: ${key}`);
  }
}

function assertId(value, label) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 160 || !ID_PATTERN.test(value)) {
    fail(`${label} is not a valid stable id: ${String(value)}`);
  }
}

function safeResolve(root, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    fail(`${label} must be a non-empty repository-relative path`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`${label} escapes repository root: ${relativePath}`);
  }
  return resolved;
}

function readYaml(filePath) {
  try {
    return yaml.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${filePath}: ${error.message}`);
  }
}

function validateRegistry(registry, root) {
  assertExactKeys(
    registry,
    ['schema_version', 'graph_id', 'authority', 'fragment_schema', 'semantic_discovery', 'fragments'],
    ['schema_version', 'graph_id', 'authority', 'fragment_schema', 'semantic_discovery', 'fragments'],
    'registry',
  );
  if (registry.schema_version !== '1.0.0') fail(`unsupported registry schema_version: ${registry.schema_version}`);
  assertId(registry.graph_id, 'registry.graph_id');

  assertExactKeys(
    registry.authority,
    ['constitution_version', 'constitution_path', 'adr'],
    ['constitution_version', 'constitution_path', 'adr'],
    'registry.authority',
  );
  if (registry.authority.constitution_version !== '2.2') fail('registry must bind to Constitution v2.2');
  if (registry.authority.adr !== 'adr.0022') fail('registry must bind to ADR-0022');
  const constitutionPath = safeResolve(root, registry.authority.constitution_path, 'constitution_path');
  if (!fs.existsSync(constitutionPath)) fail(`constitution does not exist: ${registry.authority.constitution_path}`);

  assertExactKeys(registry.fragment_schema, ['version', 'path'], ['version', 'path'], 'registry.fragment_schema');
  if (registry.fragment_schema.version !== '1.0.0') fail('unsupported fragment schema version');
  const fragmentSchemaPath = safeResolve(root, registry.fragment_schema.path, 'fragment_schema.path');
  if (!fs.existsSync(fragmentSchemaPath)) fail(`fragment schema does not exist: ${registry.fragment_schema.path}`);

  assertExactKeys(
    registry.semantic_discovery,
    ['authority', 'canonical_mutation', 'allowed_findings'],
    ['authority', 'canonical_mutation', 'allowed_findings'],
    'registry.semantic_discovery',
  );
  if (registry.semantic_discovery.authority !== 'advisory') fail('semantic discovery authority must be advisory');
  if (registry.semantic_discovery.canonical_mutation !== false) fail('semantic discovery canonical_mutation must be false');
  if (JSON.stringify(registry.semantic_discovery.allowed_findings) !== JSON.stringify(['CandidateEdge', 'DriftFinding'])) {
    fail('semantic discovery allowed_findings must be exactly CandidateEdge and DriftFinding');
  }

  if (!Array.isArray(registry.fragments) || registry.fragments.length === 0) fail('registry.fragments must not be empty');
  const fragmentIds = new Set();
  for (const [index, fragment] of registry.fragments.entries()) {
    const label = `registry.fragments[${index}]`;
    assertExactKeys(
      fragment,
      ['id', 'repository', 'path', 'revision', 'enforcement', 'exception'],
      ['id', 'repository', 'path', 'revision', 'enforcement'],
      label,
    );
    assertId(fragment.id, `${label}.id`);
    assertId(fragment.repository, `${label}.repository`);
    if (fragmentIds.has(fragment.id)) fail(`duplicate fragment id: ${fragment.id}`);
    fragmentIds.add(fragment.id);
    safeResolve(root, fragment.path, `${label}.path`);
    if (typeof fragment.revision !== 'string' || !fragment.revision) fail(`${label}.revision must be non-empty`);
    if (!['enforced', 'report-only'].includes(fragment.enforcement)) fail(`${label}.enforcement is invalid`);
    if (fragment.enforcement === 'report-only') {
      assertId(fragment.exception, `${label}.exception`);
    } else if (fragment.exception !== undefined) {
      fail(`${label}.exception is only allowed in report-only mode`);
    }
  }
}

function validateNode(node, label, root) {
  assertExactKeys(
    node,
    ['id', 'type', 'name', 'lifecycle', 'path', 'uri', 'version', 'expires_on', 'rationale', 'scope', 'migration_path', 'attributes'],
    ['id', 'type', 'name', 'lifecycle'],
    label,
  );
  assertId(node.id, `${label}.id`);
  if (!NODE_TYPES.has(node.type)) fail(`${label}.type is invalid: ${node.type}`);
  if (typeof node.name !== 'string' || !node.name.trim()) fail(`${label}.name must be non-empty`);
  if (!LIFECYCLES.has(node.lifecycle)) fail(`${label}.lifecycle is invalid: ${node.lifecycle}`);
  if (node.path !== undefined) {
    const resolved = safeResolve(root, node.path, `${label}.path`);
    if (!fs.existsSync(resolved)) fail(`${label}.path does not exist: ${node.path}`);
  }
  if (node.type === 'Exception') {
    for (const key of ['expires_on', 'rationale', 'scope', 'migration_path']) {
      if (typeof node[key] !== 'string' || !node[key]) fail(`${label}.${key} is required for Exception`);
    }
    const expiry = Date.parse(`${node.expires_on}T23:59:59Z`);
    if (!Number.isFinite(expiry)) fail(`${label}.expires_on must be an ISO date`);
    if (expiry < Date.now()) fail(`${label} is expired: ${node.expires_on}`);
  }
}

function hasCycle(adjacency) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (node) => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const target of adjacency.get(node) || []) {
      if (visit(target)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

function validateGraph(registry, fragments, root) {
  const nodes = new Map();
  const edges = new Map();
  const findings = new Map();
  const fragmentById = new Map(registry.fragments.map((entry) => [entry.id, entry]));

  for (const fragment of fragments) {
    assertExactKeys(
      fragment,
      ['schema_version', 'fragment_id', 'repository', 'nodes', 'edges', 'findings'],
      ['schema_version', 'fragment_id', 'repository', 'nodes', 'edges', 'findings'],
      `fragment ${fragment.fragment_id || '<unknown>'}`,
    );
    if (fragment.schema_version !== registry.fragment_schema.version) fail(`fragment ${fragment.fragment_id} schema version drift`);
    assertId(fragment.fragment_id, 'fragment.fragment_id');
    assertId(fragment.repository, `${fragment.fragment_id}.repository`);
    const registryEntry = fragmentById.get(fragment.fragment_id);
    if (!registryEntry) fail(`unregistered fragment: ${fragment.fragment_id}`);
    if (registryEntry.repository !== fragment.repository) fail(`repository mismatch for fragment ${fragment.fragment_id}`);
    if (!Array.isArray(fragment.nodes) || !Array.isArray(fragment.edges) || !Array.isArray(fragment.findings)) {
      fail(`fragment ${fragment.fragment_id} nodes, edges, and findings must be arrays`);
    }
    for (const [index, node] of fragment.nodes.entries()) {
      validateNode(node, `${fragment.fragment_id}.nodes[${index}]`, root);
      if (nodes.has(node.id)) fail(`duplicate node id: ${node.id}`);
      nodes.set(node.id, node);
    }
    for (const [index, edge] of fragment.edges.entries()) {
      const label = `${fragment.fragment_id}.edges[${index}]`;
      assertExactKeys(edge, ['id', 'type', 'from', 'to', 'repository', 'evidence'], ['id', 'type', 'from', 'to', 'repository'], label);
      assertId(edge.id, `${label}.id`);
      assertId(edge.from, `${label}.from`);
      assertId(edge.to, `${label}.to`);
      assertId(edge.repository, `${label}.repository`);
      if (!EDGE_TYPES.has(edge.type)) fail(`${label}.type is invalid: ${edge.type}`);
      if (edge.repository !== fragment.repository) fail(`${label}.repository must match fragment repository`);
      if (edge.evidence !== undefined && (!Array.isArray(edge.evidence) || edge.evidence.length === 0)) {
        fail(`${label}.evidence must be a non-empty array when present`);
      }
      if (edges.has(edge.id)) fail(`duplicate edge id: ${edge.id}`);
      edges.set(edge.id, edge);
    }
    for (const [index, finding] of fragment.findings.entries()) {
      const label = `${fragment.fragment_id}.findings[${index}]`;
      assertExactKeys(
        finding,
        ['id', 'kind', 'status', 'sources', 'reason', 'score', 'provenance', 'review_evidence', 'promoted_edge_id'],
        ['id', 'kind', 'status', 'sources', 'reason', 'provenance'],
        label,
      );
      assertId(finding.id, `${label}.id`);
      if (!['CandidateEdge', 'DriftFinding'].includes(finding.kind)) fail(`${label}.kind is invalid`);
      if (!['pending-review', 'rejected', 'promoted'].includes(finding.status)) fail(`${label}.status is invalid`);
      if (!Array.isArray(finding.sources) || finding.sources.length === 0) fail(`${label}.sources must not be empty`);
      if (typeof finding.reason !== 'string' || !finding.reason) fail(`${label}.reason must be non-empty`);
      if (typeof finding.provenance !== 'string' || !finding.provenance) fail(`${label}.provenance must be non-empty`);
      if (finding.score !== undefined && (typeof finding.score !== 'number' || finding.score < 0 || finding.score > 1))
        fail(`${label}.score must be between 0 and 1`);
      if (findings.has(finding.id)) fail(`duplicate finding id: ${finding.id}`);
      findings.set(finding.id, finding);
    }
  }

  for (const edge of edges.values()) {
    if (!nodes.has(edge.from)) fail(`dangling edge source ${edge.from} in ${edge.id}`);
    if (!nodes.has(edge.to)) fail(`dangling edge target ${edge.to} in ${edge.id}`);
    if (edge.type === 'OWNED_BY' && nodes.get(edge.to).type !== 'Owner') fail(`${edge.id} must target an Owner`);
    for (const evidenceId of edge.evidence || []) {
      if (nodes.get(evidenceId)?.type !== 'Evidence') fail(`${edge.id} evidence is missing or not Evidence: ${evidenceId}`);
    }
  }

  for (const node of nodes.values()) {
    if (OWNERSHIP_REQUIRED.has(node.type)) {
      const ownerEdges = [...edges.values()].filter((edge) => edge.type === 'OWNED_BY' && edge.from === node.id);
      if (ownerEdges.length !== 1) fail(`${node.id} must have exactly one OWNED_BY edge; found ${ownerEdges.length}`);
    }
    if (node.type === 'Capability' && node.lifecycle === 'available') {
      for (const requiredType of ['DEFINED_BY', 'IMPLEMENTED_BY', 'VALIDATED_BY']) {
        if (![...edges.values()].some((edge) => edge.from === node.id && edge.type === requiredType)) {
          fail(`available capability ${node.id} is missing ${requiredType}`);
        }
      }
    }
  }

  const dependencies = new Map();
  for (const edge of edges.values()) {
    if (edge.type !== 'DEPENDS_ON') continue;
    const targets = dependencies.get(edge.from) || [];
    targets.push(edge.to);
    dependencies.set(edge.from, targets);
  }
  if (hasCycle(dependencies)) fail('DEPENDS_ON cycle detected');

  for (const finding of findings.values()) {
    for (const source of finding.sources) {
      if (!nodes.has(source)) fail(`finding ${finding.id} has unknown source: ${source}`);
    }
    if (finding.status === 'promoted') {
      if (!finding.review_evidence || nodes.get(finding.review_evidence)?.type !== 'Evidence') {
        fail(`promoted finding ${finding.id} requires Evidence review_evidence`);
      }
      if (!finding.promoted_edge_id || !edges.has(finding.promoted_edge_id)) {
        fail(`promoted finding ${finding.id} requires an existing promoted_edge_id`);
      }
    } else if (finding.promoted_edge_id || finding.review_evidence) {
      fail(`unpromoted finding ${finding.id} cannot carry promotion fields`);
    }
  }

  return { nodes, edges, findings };
}

function loadAndValidate({ root = process.cwd(), registryPath = DEFAULT_REGISTRY } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedRegistry = safeResolve(resolvedRoot, registryPath, 'registry path');
  if (!fs.existsSync(resolvedRegistry)) fail(`registry does not exist: ${registryPath}`);
  const registry = readYaml(resolvedRegistry);
  validateRegistry(registry, resolvedRoot);
  const fragments = registry.fragments.map((entry) => {
    const fragmentPath = safeResolve(resolvedRoot, entry.path, `fragment ${entry.id} path`);
    if (!fs.existsSync(fragmentPath)) fail(`fragment does not exist: ${entry.path}`);
    return readYaml(fragmentPath);
  });
  const graph = validateGraph(registry, fragments, resolvedRoot);
  return { registry, fragments, ...graph };
}

function parseArgs(argv) {
  const options = { root: process.cwd(), registryPath: DEFAULT_REGISTRY, query: null, type: null, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--root': {
        options.root = argv[++index];
        break;
      }
      case '--registry': {
        options.registryPath = argv[++index];
        break;
      }
      case '--query': {
        options.query = argv[++index];
        break;
      }
      case '--type': {
        options.type = argv[++index];
        break;
      }
      case '--json': {
        options.json = true;
        break;
      }
      default: {
        fail(`unknown argument: ${arg}`);
      }
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const graph = loadAndValidate(options);
    if (options.query || options.type) {
      const query = options.query?.toLowerCase();
      const matches = [...graph.nodes.values()].filter((node) => {
        if (options.type && node.type !== options.type) return false;
        return !query || node.id === query || node.name.toLowerCase().includes(query);
      });
      const result = matches.map((node) => ({
        ...node,
        outgoing: [...graph.edges.values()].filter((edge) => edge.from === node.id),
        incoming: [...graph.edges.values()].filter((edge) => edge.to === node.id),
      }));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const summary = {
      graph_id: graph.registry.graph_id,
      schema_version: graph.registry.schema_version,
      fragments: graph.fragments.length,
      nodes: graph.nodes.size,
      edges: graph.edges.size,
      findings: graph.findings.size,
      status: 'valid',
    };
    process.stdout.write(
      options.json
        ? `${JSON.stringify(summary)}\n`
        : `Capability graph valid: ${summary.fragments} fragments, ${summary.nodes} nodes, ${summary.edges} edges, ${summary.findings} findings\n`,
    );
  } catch (error) {
    process.stderr.write(`Capability graph invalid: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { DEFAULT_REGISTRY, hasCycle, loadAndValidate, safeResolve, validateGraph, validateRegistry };
