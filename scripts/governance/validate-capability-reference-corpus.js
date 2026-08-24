'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_CORPUS = '.enterprise/governance/capabilities/reference-corpus.json';
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const REQUIRED_PRODUCT_SENTINELS = new Set([
  'reference.poynt-hub',
  'reference.cambio-real-v3',
  'reference.linked-out',
  'reference.cryptor',
  'reference.srm-asset',
]);
const REQUIRED_CORES = new Set([
  'reference.platform-core',
  'reference.backend-core',
  'reference.frontend-core',
  'reference.mobile-core',
  'reference.design-system-core',
]);

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

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !item.trim()) fail(`${label}[${index}] must be a non-empty string`);
    if (seen.has(item)) fail(`${label} contains duplicate value: ${item}`);
    seen.add(item);
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

function repositorySlug(uri) {
  if (typeof uri !== 'string') return '';
  const scp = /^[^:]+:(.+)$/.exec(uri);
  let repositoryPath;
  if (scp && !uri.includes('://')) {
    repositoryPath = scp[1];
  } else {
    try {
      repositoryPath = new URL(uri).pathname;
    } catch {
      return '';
    }
  }
  return repositoryPath
    .replace(/^\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function readCorpus(root, corpusPath = DEFAULT_CORPUS) {
  const resolved = safeResolve(root, corpusPath, 'corpus path');
  if (!fs.existsSync(resolved)) fail(`reference corpus does not exist: ${corpusPath}`);
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    fail(`cannot parse reference corpus ${corpusPath}: ${error.message}`);
  }
}

function validateSource(source, label, capabilityIds) {
  assertExactKeys(
    source,
    [
      'id',
      'repository',
      'kind',
      'evidence_role',
      'revision',
      'source_uri',
      'stacks',
      'architecture_signals',
      'evidence_paths',
      'candidate_capabilities',
    ],
    [
      'id',
      'repository',
      'kind',
      'evidence_role',
      'revision',
      'source_uri',
      'stacks',
      'architecture_signals',
      'evidence_paths',
      'candidate_capabilities',
    ],
    label,
  );
  assertId(source.id, `${label}.id`);
  assertId(source.repository, `${label}.repository`);
  if (!['product-sentinel', 'canonical-core'].includes(source.kind)) fail(`${label}.kind is invalid`);
  const expectedRole = source.kind === 'product-sentinel' ? 'candidate-source' : 'contract-or-projection-source';
  if (source.evidence_role !== expectedRole) {
    fail(`${label}.evidence_role must be ${expectedRole} for ${source.kind}`);
  }
  if (!/^[a-f0-9]{40}$/.test(source.revision)) fail(`${label}.revision must be a full Git SHA`);
  if (typeof source.source_uri !== 'string' || !source.source_uri.startsWith('https://') || !repositorySlug(source.source_uri)) {
    fail(`${label}.source_uri must be a valid HTTPS Git repository URI`);
  }
  assertStringArray(source.stacks, `${label}.stacks`);
  assertStringArray(source.architecture_signals, `${label}.architecture_signals`);
  assertStringArray(source.evidence_paths, `${label}.evidence_paths`);
  assertStringArray(source.candidate_capabilities, `${label}.candidate_capabilities`);
  for (const [index, evidencePath] of source.evidence_paths.entries()) {
    safeResolve('/reference-root', evidencePath, `${label}.evidence_paths[${index}]`);
  }
  for (const capabilityId of source.candidate_capabilities) {
    assertId(capabilityId, `${label}.candidate_capabilities`);
    if (!capabilityIds.has(capabilityId)) fail(`${label} references capability outside migration baseline: ${capabilityId}`);
  }
}

function validateCorpus(corpus) {
  assertExactKeys(
    corpus,
    ['schema_version', 'corpus_id', 'authority', 'capability_baseline', 'semantic_discovery', 'sources'],
    ['schema_version', 'corpus_id', 'authority', 'capability_baseline', 'semantic_discovery', 'sources'],
    'corpus',
  );
  if (corpus.schema_version !== '1.0.0') fail(`unsupported corpus schema_version: ${corpus.schema_version}`);
  assertId(corpus.corpus_id, 'corpus.corpus_id');

  assertExactKeys(
    corpus.authority,
    ['role', 'canonical_mutation', 'creates_adoption'],
    ['role', 'canonical_mutation', 'creates_adoption'],
    'corpus.authority',
  );
  if (corpus.authority.role !== 'discovery-only') fail('reference corpus role must be discovery-only');
  if (corpus.authority.canonical_mutation !== false) fail('reference corpus cannot mutate the canonical graph');
  if (corpus.authority.creates_adoption !== false) fail('reference corpus cannot create adoption claims');

  assertExactKeys(
    corpus.capability_baseline,
    ['authority', 'source_hint', 'as_of', 'count', 'capability_ids'],
    ['authority', 'source_hint', 'as_of', 'count', 'capability_ids'],
    'corpus.capability_baseline',
  );
  if (corpus.capability_baseline.authority !== 'migration-view') fail('capability baseline must remain a migration-view');
  if (typeof corpus.capability_baseline.source_hint !== 'string' || !corpus.capability_baseline.source_hint) {
    fail('capability baseline source_hint must be non-empty');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corpus.capability_baseline.as_of)) fail('capability baseline as_of must be an ISO date');
  assertStringArray(corpus.capability_baseline.capability_ids, 'corpus.capability_baseline.capability_ids');
  if (corpus.capability_baseline.count !== corpus.capability_baseline.capability_ids.length) {
    fail('capability baseline count does not match capability_ids');
  }
  const capabilityIds = new Set(corpus.capability_baseline.capability_ids);
  for (const capabilityId of capabilityIds) assertId(capabilityId, 'corpus.capability_baseline.capability_ids');

  assertExactKeys(
    corpus.semantic_discovery,
    ['authority', 'engine', 'query', 'executed_on'],
    ['authority', 'engine', 'query', 'executed_on'],
    'corpus.semantic_discovery',
  );
  if (corpus.semantic_discovery.authority !== 'advisory') fail('semantic discovery must remain advisory');
  for (const key of ['engine', 'query']) {
    if (typeof corpus.semantic_discovery[key] !== 'string' || !corpus.semantic_discovery[key]) {
      fail(`semantic discovery ${key} must be non-empty`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corpus.semantic_discovery.executed_on)) {
    fail('semantic discovery executed_on must be an ISO date');
  }

  if (!Array.isArray(corpus.sources) || corpus.sources.length === 0) fail('corpus.sources must not be empty');
  const sourceIds = new Set();
  const repositories = new Set();
  for (const [index, source] of corpus.sources.entries()) {
    validateSource(source, `corpus.sources[${index}]`, capabilityIds);
    if (sourceIds.has(source.id)) fail(`duplicate reference source id: ${source.id}`);
    if (repositories.has(source.repository)) fail(`duplicate reference repository: ${source.repository}`);
    sourceIds.add(source.id);
    repositories.add(source.repository);
  }
  for (const required of [...REQUIRED_PRODUCT_SENTINELS, ...REQUIRED_CORES]) {
    if (!sourceIds.has(required)) fail(`required reference source is missing: ${required}`);
  }

  const productSources = corpus.sources.filter((source) => source.kind === 'product-sentinel');
  const coreSources = corpus.sources.filter((source) => source.kind === 'canonical-core');
  const productCapabilities = new Set(productSources.flatMap((source) => source.candidate_capabilities));
  const allCapabilities = new Set(corpus.sources.flatMap((source) => source.candidate_capabilities));
  const productGaps = [...capabilityIds].filter((capabilityId) => !productCapabilities.has(capabilityId));
  const referenceGaps = [...capabilityIds].filter((capabilityId) => !allCapabilities.has(capabilityId));
  if (referenceGaps.length > 0) fail(`reference corpus does not cover migration baseline: ${referenceGaps.join(', ')}`);

  return {
    sources: corpus.sources.length,
    products: productSources.length,
    cores: coreSources.length,
    baseline_capabilities: capabilityIds.size,
    product_candidate_coverage: productCapabilities.size,
    product_candidate_gaps: productGaps,
    reference_coverage: allCapabilities.size,
  };
}

function verifyPinnedSource(source, repositoryRoot) {
  let remote;
  try {
    remote = execFileSync('git', ['-C', repositoryRoot, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail(`cannot read origin for ${source.repository}: ${error.stderr?.toString().trim() || error.message}`);
  }
  if (repositorySlug(remote) !== repositorySlug(source.source_uri)) {
    fail(`${source.id} repository origin does not match ${source.source_uri}`);
  }
  try {
    execFileSync('git', ['-C', repositoryRoot, 'cat-file', '-e', `${source.revision}^{commit}`], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    for (const evidencePath of source.evidence_paths) {
      execFileSync('git', ['-C', repositoryRoot, 'cat-file', '-e', `${source.revision}:${evidencePath}`], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    }
  } catch (error) {
    fail(`cannot verify pinned evidence for ${source.id}@${source.revision}: ${error.stderr?.toString().trim() || error.message}`);
  }
}

function loadAndValidate({ root = process.cwd(), corpusPath = DEFAULT_CORPUS, repositoryRoots = new Map(), requireAll = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const corpus = readCorpus(resolvedRoot, corpusPath);
  const stats = validateCorpus(corpus);
  const resolved = [];
  const deferred = [];
  for (const source of corpus.sources) {
    const repositoryRoot = repositoryRoots.get(source.repository);
    if (!repositoryRoot) {
      deferred.push(source.repository);
      continue;
    }
    verifyPinnedSource(source, path.resolve(repositoryRoot));
    resolved.push(source.repository);
  }
  if (requireAll && deferred.length > 0) fail(`reference roots required but missing: ${deferred.join(', ')}`);
  return { corpus, stats: { ...stats, resolved_sources: resolved.length, deferred_sources: deferred.length }, resolved, deferred };
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    corpusPath: DEFAULT_CORPUS,
    repositoryRoots: new Map(),
    requireAll: false,
    query: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case '--root': {
        options.root = argv[++index];
        break;
      }
      case '--corpus': {
        options.corpusPath = argv[++index];
        break;
      }
      case '--repository-root': {
        const mapping = argv[++index];
        const separator = mapping?.indexOf('=') ?? -1;
        if (separator < 1) fail('--repository-root must be repository.id=/absolute/path');
        options.repositoryRoots.set(mapping.slice(0, separator), mapping.slice(separator + 1));
        break;
      }
      case '--require-all': {
        options.requireAll = true;
        break;
      }
      case '--query': {
        options.query = argv[++index];
        break;
      }
      case '--json': {
        options.json = true;
        break;
      }
      default: {
        fail(`unknown argument: ${argument}`);
      }
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = loadAndValidate(options);
  if (options.query) {
    const term = options.query.toLowerCase();
    const matches = result.corpus.sources.filter(
      (source) =>
        source.id.toLowerCase() === term ||
        source.repository.toLowerCase() === term ||
        source.candidate_capabilities.some((capabilityId) => capabilityId.toLowerCase() === term),
    );
    process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
    return;
  }
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ corpus_id: result.corpus.corpus_id, ...result.stats, deferred: result.deferred }, null, 2)}\n`,
    );
    return;
  }
  const { stats } = result;
  console.log(`Capability reference corpus valid: ${stats.sources} sources (${stats.products} products, ${stats.cores} cores)`);
  console.log(`Product discovery coverage: ${stats.product_candidate_coverage}/${stats.baseline_capabilities}`);
  console.log(`Full reference coverage: ${stats.reference_coverage}/${stats.baseline_capabilities}`);
  console.log(`Pinned evidence: ${stats.resolved_sources} resolved, ${stats.deferred_sources} deferred`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Capability reference corpus validation failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_CORPUS,
  loadAndValidate,
  repositorySlug,
  safeResolve,
  validateCorpus,
  verifyPinnedSource,
};
