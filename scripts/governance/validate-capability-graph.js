'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const yaml = require('yaml');
const semver = require('semver');

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
const EVIDENCE_REQUIRED_EDGES = new Set([
  'DEFINED_BY',
  'IMPLEMENTED_BY',
  'CONSUMED_BY',
  'EXTENDED_BY',
  'VALIDATED_BY',
  'PUBLISHED_AS',
  'GOVERNED_BY',
  'SUPERSEDES',
  'EXCEPTED_BY',
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

function readYamlText(contents, label) {
  try {
    return yaml.parse(contents);
  } catch (error) {
    fail(`cannot parse ${label}: ${error.message}`);
  }
}

function canonicalGitUri(uri) {
  const scpMatch = /^git@([^:]+):(.+)$/.exec(uri);
  const normalized = scpMatch ? `https://${scpMatch[1]}/${scpMatch[2]}` : uri;
  return normalized.replace(/\.git$/, '').replace(/\/$/, '');
}

function jsonSchemaBreakingChanges(previous, current, location = '$') {
  const findings = [];
  const previousTypes = new Set(Array.isArray(previous?.type) ? previous.type : previous?.type ? [previous.type] : []);
  const currentTypes = new Set(Array.isArray(current?.type) ? current.type : current?.type ? [current.type] : []);
  if (previousTypes.size > 0 && [...previousTypes].some((type) => !currentTypes.has(type))) {
    findings.push(`${location}: type was narrowed or changed`);
  }
  if (Array.isArray(previous?.enum) && Array.isArray(current?.enum)) {
    const currentValues = new Set(current.enum.map((value) => JSON.stringify(value)));
    if (previous.enum.some((value) => !currentValues.has(JSON.stringify(value)))) findings.push(`${location}: enum value removed`);
  }
  if (current?.const !== undefined && JSON.stringify(previous?.const) !== JSON.stringify(current.const)) {
    findings.push(`${location}: const added or changed`);
  }
  if (previous?.$ref !== undefined && previous.$ref !== current?.$ref) findings.push(`${location}: $ref changed`);
  if (current?.format !== undefined && previous?.format !== current.format) findings.push(`${location}: format added or changed`);
  for (const key of ['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties']) {
    if (typeof current?.[key] === 'number' && (typeof previous?.[key] !== 'number' || current[key] > previous[key])) {
      findings.push(`${location}: ${key} became stricter`);
    }
  }
  for (const key of ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties']) {
    if (typeof current?.[key] === 'number' && (typeof previous?.[key] !== 'number' || current[key] < previous[key])) {
      findings.push(`${location}: ${key} became stricter`);
    }
  }
  if (current?.pattern !== undefined && previous?.pattern !== current.pattern) findings.push(`${location}: pattern added or changed`);
  if (current?.multipleOf !== undefined && previous?.multipleOf !== current.multipleOf) findings.push(`${location}: multipleOf added or changed`);
  if (previous?.uniqueItems !== true && current?.uniqueItems === true) findings.push(`${location}: uniqueItems became required`);
  const previousRequired = new Set(previous?.required || []);
  for (const required of current?.required || []) {
    if (!previousRequired.has(required)) findings.push(`${location}: required property added: ${required}`);
  }
  for (const [name, previousProperty] of Object.entries(previous?.properties || {})) {
    const currentProperty = current?.properties?.[name];
    if (currentProperty === undefined) findings.push(`${location}: property removed: ${name}`);
    else findings.push(...jsonSchemaBreakingChanges(previousProperty, currentProperty, `${location}.properties.${name}`));
  }
  for (const [name, previousDefinition] of Object.entries(previous?.$defs || {})) {
    const currentDefinition = current?.$defs?.[name];
    if (currentDefinition === undefined) findings.push(`${location}: definition removed: ${name}`);
    else findings.push(...jsonSchemaBreakingChanges(previousDefinition, currentDefinition, `${location}.$defs.${name}`));
  }
  if (previous?.additionalProperties !== false && current?.additionalProperties === false) {
    findings.push(`${location}: additional properties became forbidden`);
  }
  if (previous?.unevaluatedProperties !== false && current?.unevaluatedProperties === false) {
    findings.push(`${location}: unevaluated properties became forbidden`);
  }
  if (previous?.items && current?.items) findings.push(...jsonSchemaBreakingChanges(previous.items, current.items, `${location}.items`));
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const before = previous?.[keyword];
    const after = current?.[keyword];
    if (!Array.isArray(before)) {
      if (Array.isArray(after)) findings.push(`${location}: ${keyword} constraint added`);
      continue;
    }
    if (!Array.isArray(after) || before.length !== after.length) {
      findings.push(`${location}: ${keyword} structure changed`);
      continue;
    }
    for (const [index, schema] of before.entries()) {
      findings.push(...jsonSchemaBreakingChanges(schema, after[index], `${location}.${keyword}[${index}]`));
    }
  }
  if (previous?.not && current?.not) findings.push(...jsonSchemaBreakingChanges(previous.not, current.not, `${location}.not`));
  else if (!previous?.not && current?.not) findings.push(`${location}: not constraint added`);
  for (const keyword of ['if', 'then', 'else', 'contains']) {
    if (previous?.[keyword] && current?.[keyword]) {
      findings.push(...jsonSchemaBreakingChanges(previous[keyword], current[keyword], `${location}.${keyword}`));
    } else if (!previous?.[keyword] && current?.[keyword]) {
      findings.push(`${location}: ${keyword} constraint added`);
    }
  }
  for (const [property, dependencies] of Object.entries(current?.dependentRequired || {})) {
    const previousDependencies = new Set(previous?.dependentRequired?.[property] || []);
    for (const dependency of dependencies) {
      if (!previousDependencies.has(dependency)) findings.push(`${location}: dependent requirement added: ${property} -> ${dependency}`);
    }
  }
  return findings;
}

function readPinnedGitFragment(repositoryRoot, entry) {
  let remote;
  let contents;
  try {
    remote = execFileSync('git', ['-C', repositoryRoot, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (canonicalGitUri(remote) !== canonicalGitUri(entry.source.uri)) {
      fail(`fragment ${entry.id} repository origin does not match ${entry.source.uri}`);
    }
    execFileSync('git', ['-C', repositoryRoot, 'cat-file', '-e', `${entry.revision}^{commit}`], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    contents = execFileSync('git', ['-C', repositoryRoot, 'show', `${entry.revision}:${entry.path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (error.message.startsWith('fragment ')) throw error;
    fail(`cannot load pinned fragment ${entry.id}@${entry.revision}: ${error.stderr?.toString().trim() || error.message}`);
  }
  return readYamlText(contents, `${entry.id}@${entry.revision}:${entry.path}`);
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
  if (registry.authority.adr !== 'adr.0033') fail('registry must bind to ADR-0033');
  const constitutionPath = safeResolve(root, registry.authority.constitution_path, 'constitution_path');
  if (!fs.existsSync(constitutionPath)) fail(`constitution does not exist: ${registry.authority.constitution_path}`);

  assertExactKeys(registry.fragment_schema, ['version', 'path'], ['version', 'path'], 'registry.fragment_schema');
  if (!['1.0.0', '2.0.0'].includes(registry.fragment_schema.version)) fail('unsupported fragment schema version');
  const fragmentSchemaPath = safeResolve(root, registry.fragment_schema.path, 'fragment_schema.path');
  if (!fs.existsSync(fragmentSchemaPath)) fail(`fragment schema does not exist: ${registry.fragment_schema.path}`);
  const expectedSchemaPath =
    registry.fragment_schema.version === '2.0.0'
      ? '.enterprise/governance/capabilities/schemas/capability-graph-fragment-2.0.0.schema.json'
      : '.enterprise/governance/capabilities/schemas/capability-graph-fragment.schema.json';
  if (registry.fragment_schema.path !== expectedSchemaPath) {
    fail(`fragment schema ${registry.fragment_schema.version} must use ${expectedSchemaPath}`);
  }

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
      ['id', 'repository', 'path', 'revision', 'enforcement', 'exception', 'source', 'validation'],
      ['id', 'repository', 'path', 'revision', 'enforcement', 'source', 'validation'],
      label,
    );
    assertId(fragment.id, `${label}.id`);
    assertId(fragment.repository, `${label}.repository`);
    if (fragmentIds.has(fragment.id)) fail(`duplicate fragment id: ${fragment.id}`);
    fragmentIds.add(fragment.id);
    if (typeof fragment.revision !== 'string' || !fragment.revision) fail(`${label}.revision must be non-empty`);
    if (!['enforced', 'report-only'].includes(fragment.enforcement)) fail(`${label}.enforcement is invalid`);
    assertExactKeys(fragment.source, ['kind', 'uri'], ['kind'], `${label}.source`);
    assertExactKeys(fragment.validation, ['mode', 'command', 'workflow_path'], ['mode', 'command'], `${label}.validation`);
    if (typeof fragment.validation.command !== 'string' || !fragment.validation.command) {
      fail(`${label}.validation.command must be non-empty`);
    }
    if (fragment.source.kind === 'local') {
      if (fragment.source.uri !== undefined) fail(`${label}.source.uri is not allowed for local fragments`);
      if (fragment.revision !== 'same-commit') fail(`${label}.revision must be same-commit for local fragments`);
      if (fragment.validation.mode !== 'local') fail(`${label}.validation.mode must be local`);
      safeResolve(root, fragment.path, `${label}.path`);
    } else if (fragment.source.kind === 'git') {
      if (typeof fragment.source.uri !== 'string' || !fragment.source.uri.startsWith('https://')) {
        fail(`${label}.source.uri must be an https URI`);
      }
      if (!/^[a-f0-9]{40}$/.test(fragment.revision)) fail(`${label}.revision must be a full Git SHA`);
      if (fragment.validation.mode !== 'delegated') fail(`${label}.validation.mode must be delegated`);
      if (!fragment.validation.workflow_path) fail(`${label}.validation.workflow_path is required`);
    } else {
      fail(`${label}.source.kind is invalid: ${fragment.source.kind}`);
    }
    if (fragment.enforcement === 'report-only') {
      assertId(fragment.exception, `${label}.exception`);
    } else if (fragment.exception !== undefined) {
      fail(`${label}.exception is only allowed in report-only mode`);
    }
  }
}

function validateNode(
  node,
  label,
  root,
  schemaVersion = '1.0.0',
  pinnedPathExists = null,
  pinnedContentReader = null,
  authoritativeRevision = null,
  authoritativeFragmentPath = null,
) {
  assertExactKeys(
    node,
    [
      'id',
      'type',
      'name',
      'lifecycle',
      'path',
      'uri',
      'version',
      'kind',
      'direction',
      'role',
      'expires_on',
      'rationale',
      'scope',
      'migration_path',
      'attributes',
    ],
    ['id', 'type', 'name', 'lifecycle'],
    label,
  );
  assertId(node.id, `${label}.id`);
  if (!NODE_TYPES.has(node.type)) fail(`${label}.type is invalid: ${node.type}`);
  if (typeof node.name !== 'string' || !node.name.trim()) fail(`${label}.name must be non-empty`);
  if (!LIFECYCLES.has(node.lifecycle)) fail(`${label}.lifecycle is invalid: ${node.lifecycle}`);
  if (node.path !== undefined) {
    const resolved = safeResolve(root, node.path, `${label}.path`);
    const exists = pinnedPathExists ? pinnedPathExists(node.path) : fs.existsSync(resolved);
    if (!exists) fail(`${label}.path does not exist in its authoritative revision: ${node.path}`);
  }
  if (schemaVersion === '2.0.0') {
    for (const [field, relativePath] of [
      ['migration_path', node.migration_path],
      ['attributes.rollback_path', node.attributes?.rollback_path],
      ['attributes.compatibility_evidence', node.attributes?.compatibility_evidence],
    ]) {
      if (relativePath === undefined) continue;
      const resolved = safeResolve(root, relativePath, `${label}.${field}`);
      const exists = pinnedPathExists ? pinnedPathExists(relativePath) : fs.existsSync(resolved);
      if (!exists) fail(`${label}.${field} does not exist in its authoritative revision: ${relativePath}`);
    }
  }
  if (schemaVersion === '1.0.0' && (node.kind !== undefined || node.direction !== undefined || node.role !== undefined)) {
    fail(`${label} uses PCCP classifiers under schema 1.0.0`);
  }
  if (schemaVersion === '2.0.0') {
    const contractKinds = new Set(['data', 'behavioral', 'api', 'event', 'configuration', 'error-catalog', 'port']);
    const moduleRoles = new Set(['specification', 'policy', 'reference-implementation', 'conformance-suite']);
    const packageRoles = new Set(['abstractions', 'projection', 'implementation', 'adapter', 'composition']);
    const adapterKinds = new Set(['persistence', 'messaging', 'policy-engine', 'identity', 'cache', 'provider', 'transport']);
    if (
      ['Repository', 'Project'].includes(node.type) &&
      !['platform-core', 'stack-core', 'product', 'external'].includes(node.attributes?.ownership_layer)
    ) {
      fail(`${label}.attributes.ownership_layer is required and invalid for ${node.type}`);
    }
    if (node.type === 'Contract') {
      if (!contractKinds.has(node.kind)) fail(`${label}.kind is required and invalid for Contract`);
      if (!['provided', 'required', 'not-applicable'].includes(node.direction)) fail(`${label}.direction is required for Contract`);
      if (node.kind === 'port' && node.direction === 'not-applicable') fail(`${label} port direction must be provided or required`);
      if (node.kind !== 'port' && node.direction !== 'not-applicable') fail(`${label} non-port direction must be not-applicable`);
      const initial = node.attributes?.initial_contract;
      const baseline = node.attributes?.compatibility_baseline;
      if (Boolean(initial) === Boolean(baseline)) {
        fail(`${label} Contract requires exactly one of initial_contract provenance or compatibility_baseline`);
      }
      if (initial && node.attributes?.change_kind !== undefined) {
        fail(`${label} initial Contract cannot declare change_kind`);
      }
      if (initial) {
        for (const key of ['repository_uri', 'parent_revision', 'fragment_path', 'parent_state']) {
          if (typeof initial[key] !== 'string' || !initial[key]) fail(`${label}.attributes.initial_contract.${key} is required`);
        }
        if (!/^[a-f0-9]{40}$/.test(initial.parent_revision)) fail(`${label} initial Contract parent_revision must be a full Git SHA`);
        if (!['present', 'absent'].includes(initial.parent_state)) fail(`${label} initial Contract parent_state is invalid`);
        if (initial.parent_state === 'present' && !/^[a-f0-9]{64}$/.test(initial.sha256 ?? '')) fail(`${label} initial Contract sha256 is invalid`);
        if (!authoritativeRevision) fail(`${label} initial Contract requires an authoritative Git revision`);
        if (initial.fragment_path !== authoritativeFragmentPath) fail(`${label} initial Contract must inspect the authoritative fragment path`);
        safeResolve(root, initial.fragment_path, `${label}.attributes.initial_contract.fragment_path`);
        try {
          const remote = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
          if (canonicalGitUri(remote) !== canonicalGitUri(initial.repository_uri)) fail(`${label} initial Contract repository origin mismatch`);
          const actualParent = execFileSync('git', ['-C', root, 'rev-parse', `${authoritativeRevision}^`], { encoding: 'utf8' }).trim();
          if (actualParent !== initial.parent_revision) fail(`${label} initial Contract evidence is not the immediate authoritative parent`);
        } catch (error) {
          if (error.message.includes('initial Contract') || error.message.includes('origin mismatch')) throw error;
          fail(`${label} initial Contract parent is not available from immutable Git evidence`);
        }
        let parentContents;
        try {
          parentContents = execFileSync('git', ['-C', root, 'show', `${initial.parent_revision}:${initial.fragment_path}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch {
          parentContents = null;
        }
        if ((parentContents === null) !== (initial.parent_state === 'absent')) fail(`${label} initial Contract parent_state does not match Git`);
        if (parentContents !== null) {
          if (crypto.createHash('sha256').update(parentContents).digest('hex') !== initial.sha256) fail(`${label} initial Contract parent fragment digest mismatch`);
          const parent = readYamlText(parentContents, `${initial.parent_revision}:${initial.fragment_path}`);
          if (parent?.nodes?.some((candidate) => candidate.id === node.id)) fail(`${label} initial Contract already existed before claimed introduction`);
        }
      }
      if (baseline) {
        for (const key of ['contract_id', 'repository_uri', 'revision', 'fragment_path', 'path', 'sha256']) {
          if (typeof baseline[key] !== 'string' || !baseline[key]) fail(`${label}.attributes.compatibility_baseline.${key} is required`);
        }
        if (baseline.contract_id !== node.id || baseline.path !== node.path) {
          fail(`${label} compatibility baseline must identify the exact Contract id and canonical path`);
        }
        if (!authoritativeRevision) fail(`${label} compatibility baseline requires an authoritative Git revision`);
        if (baseline.revision === authoritativeRevision) {
          fail(`${label} compatibility baseline must be a strict predecessor of the authoritative revision`);
        }
        if (!/^[a-f0-9]{40}$/.test(baseline.revision)) fail(`${label} compatibility baseline revision must be a full Git SHA`);
        if (!/^[a-f0-9]{64}$/.test(baseline.sha256)) fail(`${label} compatibility baseline sha256 is invalid`);
        safeResolve(root, baseline.path, `${label}.attributes.compatibility_baseline.path`);
        let previousContents;
        try {
          const remote = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
          if (canonicalGitUri(remote) !== canonicalGitUri(baseline.repository_uri)) {
            fail(`${label} compatibility baseline repository origin mismatch`);
          }
          previousContents = execFileSync('git', ['-C', root, 'show', `${baseline.revision}:${baseline.path}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const fragmentContents = execFileSync('git', ['-C', root, 'show', `${baseline.revision}:${baseline.fragment_path}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const fragment = readYamlText(fragmentContents, `${baseline.revision}:${baseline.fragment_path}`);
          const predecessor = fragment?.nodes?.find((candidate) => candidate.id === node.id && candidate.type === 'Contract');
          if (!predecessor || predecessor.path !== baseline.path) fail(`${label} compatibility baseline does not prove the predecessor id and path`);
          execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', baseline.revision, authoritativeRevision], {
            stdio: ['ignore', 'ignore', 'pipe'],
          });
        } catch (error) {
          if (error.message.includes('origin mismatch') || error.message.includes('does not prove')) throw error;
          fail(`${label} compatibility baseline is not available from immutable Git evidence`);
        }
        const digest = crypto.createHash('sha256').update(previousContents).digest('hex');
        if (digest !== baseline.sha256) fail(`${label} compatibility baseline digest mismatch`);
        if (!node.path?.endsWith('.json') || !baseline.path.endsWith('.json')) {
          fail(`${label} automatic compatibility requires JSON Schema paths`);
        }
        let currentContents;
        try {
          currentContents = pinnedContentReader
            ? pinnedContentReader(node.path)
            : fs.readFileSync(safeResolve(root, node.path, `${label}.path`), 'utf8');
          const previousSchema = JSON.parse(previousContents);
          const currentSchema = JSON.parse(currentContents);
          if (
            typeof previousSchema.$schema !== 'string' ||
            !previousSchema.$schema.includes('json-schema.org') ||
            typeof currentSchema.$schema !== 'string' ||
            !currentSchema.$schema.includes('json-schema.org')
          ) {
            fail(`${label} automatic compatibility requires JSON Schema documents`);
          }
          const findings = jsonSchemaBreakingChanges(previousSchema, currentSchema);
          if (findings.length > 0 && node.attributes?.change_kind !== 'breaking') {
            fail(`${label} automatic compatibility diff detected breaking changes without change_kind=breaking: ${findings[0]}`);
          }
          if (findings.length === 0 && node.attributes?.change_kind === 'breaking') {
            fail(`${label} declares breaking but automatic compatibility diff found no breaking change`);
          }
        } catch (error) {
          if (error.message.includes('automatic compatibility')) throw error;
          fail(`${label} automatic compatibility comparison failed: ${error.message}`);
        }
      }
    }
    if (node.type === 'Module') {
      const legacyProjectionTombstone =
        node.role === undefined &&
        ['deprecated', 'retired'].includes(node.lifecycle) &&
        typeof node.rationale === 'string' &&
        typeof node.migration_path === 'string' &&
        typeof node.attributes?.representation_migrated_to === 'string' &&
        typeof node.attributes?.rollback_path === 'string' &&
        typeof node.attributes?.compatibility_evidence === 'string';
      if (!moduleRoles.has(node.role) && !legacyProjectionTombstone) {
        fail(`${label}.role is required and invalid for Module unless it is a governed legacy projection tombstone`);
      }
      if (legacyProjectionTombstone) {
        assertId(node.attributes.representation_migrated_to, `${label}.attributes.representation_migrated_to`);
      }
    }
    if (node.type === 'Package') {
      if (!packageRoles.has(node.role)) fail(`${label}.role is required and invalid for Package`);
      if (!['source-only', 'ci-validated', 'published'].includes(node.attributes?.distribution_state)) {
        fail(`${label}.attributes.distribution_state is required and invalid for Package`);
      }
      if (!['unpublished', 'published'].includes(node.attributes?.publication_state)) {
        fail(`${label}.attributes.publication_state is required and invalid for Package`);
      }
      if (node.attributes?.adoption_state !== undefined || node.attributes?.installation_state !== undefined) {
        fail(`${label} Package cannot carry consumer installation or adoption state`);
      }
    }
    if (node.type === 'Adapter' && !adapterKinds.has(node.kind)) fail(`${label}.kind is required and invalid for Adapter`);
    if (node.type === 'ArtifactVersion' && (!semver.valid(node.version) || node.attributes?.immutable !== true)) {
      fail(`${label} ArtifactVersion requires immutable SemVer evidence`);
    }
    if (
      node.type === 'Consumer' &&
      (!['not-installed', 'verified-install'].includes(node.attributes?.installation_state) ||
        !['not-adopted', 'adopted'].includes(node.attributes?.adoption_state))
    ) {
      fail(`${label} Consumer requires separate installation and adoption states`);
    }
    if (
      node.type === 'Consumer' &&
      node.attributes?.installation_state === 'verified-install' &&
      typeof node.attributes?.artifact_version_id !== 'string'
    ) {
      fail(`${label} verified installation requires artifact_version_id`);
    }
    if (
      node.type === 'Consumer' &&
      node.attributes?.adoption_state === 'adopted' &&
      node.attributes?.installation_state !== 'verified-install'
    ) {
      fail(`${label} adoption requires installation_state=verified-install`);
    }
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

function validateGraph(
  registry,
  fragments,
  root,
  fragmentRoots = new Map(),
  fragmentPathReaders = new Map(),
  fragmentContentReaders = new Map(),
) {
  const nodes = new Map();
  const nodeRepositories = new Map();
  const edges = new Map();
  const findings = new Map();
  const fragmentById = new Map(registry.fragments.map((entry) => [entry.id, entry]));

  for (const fragment of fragments) {
    const fragmentRoot = fragmentRoots.get(fragment.fragment_id) || root;
    const pinnedPathExists = fragmentPathReaders.get(fragment.fragment_id) || null;
    const pinnedContentReader = fragmentContentReaders.get(fragment.fragment_id) || null;
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
    let authoritativeRevision = registryEntry.revision;
    if (registryEntry.revision === 'same-commit') {
      try {
        authoritativeRevision = execFileSync('git', ['-C', fragmentRoot, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        authoritativeRevision = null;
      }
    }
    if (registryEntry.repository !== fragment.repository) fail(`repository mismatch for fragment ${fragment.fragment_id}`);
    if (!Array.isArray(fragment.nodes) || !Array.isArray(fragment.edges) || !Array.isArray(fragment.findings)) {
      fail(`fragment ${fragment.fragment_id} nodes, edges, and findings must be arrays`);
    }
    for (const [index, node] of fragment.nodes.entries()) {
      validateNode(
        node,
        `${fragment.fragment_id}.nodes[${index}]`,
        fragmentRoot,
        fragment.schema_version,
        pinnedPathExists,
        pinnedContentReader,
        authoritativeRevision,
        registryEntry.path,
      );
      if (nodes.has(node.id)) fail(`duplicate node id: ${node.id}`);
      nodes.set(node.id, node);
      nodeRepositories.set(node.id, fragment.repository);
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
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    const endpointRules = {
      DEFINED_BY: [['Capability'], ['Contract', 'Module', 'ErrorCatalog']],
      OWNED_BY: [null, ['Owner']],
      IMPLEMENTED_BY: [['Capability'], ['Package', 'Module', 'Adapter']],
      CONSUMED_BY: [['Capability'], ['Consumer']],
      EXTENDED_BY: [['Capability'], ['Adapter']],
      VALIDATED_BY: [null, ['TestSuite']],
      PUBLISHED_AS: [['Package'], ['ArtifactVersion']],
      GOVERNED_BY: [null, ['Adr']],
      SUPERSEDES: [null, null],
      EXCEPTED_BY: [null, ['Exception']],
    };
    const rule = endpointRules[edge.type];
    if (rule?.[0] && !rule[0].includes(fromNode.type)) fail(`${edge.id} has invalid ${edge.type} source type ${fromNode.type}`);
    if (rule?.[1] && !rule[1].includes(toNode.type)) fail(`${edge.id} has invalid ${edge.type} target type ${toNode.type}`);
    if (edge.type === 'SUPERSEDES' && fromNode.type !== toNode.type) {
      const projectionRepresentationMigration =
        fromNode.type === 'Package' &&
        fromNode.role === 'projection' &&
        toNode.type === 'Module' &&
        toNode.role === undefined &&
        ['deprecated', 'retired'].includes(toNode.lifecycle) &&
        toNode.attributes?.representation_migrated_to === fromNode.id;
      if (!projectionRepresentationMigration) {
        fail(`${edge.id} cross-type SUPERSEDES is restricted to a projection Package replacing its governed legacy Module tombstone`);
      }
    }
    if (
      registry.fragment_schema.version === '2.0.0' &&
      edge.type === 'DEFINED_BY' &&
      toNode.type === 'Module' &&
      toNode.role !== 'specification'
    ) {
      fail(`${edge.id} DEFINED_BY Module must have role=specification`);
    }
    if (registry.fragment_schema.version === '2.0.0' && edge.type === 'IMPLEMENTED_BY') {
      const validImplementation =
        toNode.type === 'Adapter' ||
        (toNode.type === 'Module' && ['policy', 'reference-implementation'].includes(toNode.role)) ||
        (toNode.type === 'Package' && ['implementation', 'adapter'].includes(toNode.role));
      if (!validImplementation) fail(`${edge.id} target is not an implementation`);
    }
    if (EVIDENCE_REQUIRED_EDGES.has(edge.type) && (!edge.evidence || edge.evidence.length === 0)) {
      fail(`${edge.id} requires tracked evidence`);
    }
    for (const evidenceId of edge.evidence || []) {
      if (nodes.get(evidenceId)?.type !== 'Evidence') fail(`${edge.id} evidence is missing or not Evidence: ${evidenceId}`);
    }
  }

  if (registry.fragment_schema.version === '2.0.0') {
    for (const fragment of fragments) {
      if (nodes.get(fragment.repository)?.type !== 'Repository') {
        fail(`fragment ${fragment.fragment_id} requires its repository node ${fragment.repository}`);
      }
    }
  }

  for (const node of nodes.values()) {
    if (
      node.type === 'Package' &&
      node.attributes?.distribution_state === 'source-only' &&
      [...edges.values()].some((edge) => edge.type === 'PUBLISHED_AS' && edge.from === node.id)
    ) {
      fail(`source-only package ${node.id} cannot be PUBLISHED_AS`);
    }
    if (
      node.type === 'Package' &&
      ['source-only', 'ci-validated'].includes(node.attributes?.distribution_state) &&
      node.attributes?.publication_state === 'published'
    ) {
      fail(`${node.attributes.distribution_state} package ${node.id} cannot claim publication_state=published`);
    }
    if (
      node.type === 'Package' &&
      node.attributes?.distribution_state === 'published' &&
      node.attributes?.publication_state !== 'published'
    ) {
      fail(`published package ${node.id} must claim publication_state=published`);
    }
    if (node.type === 'Package' && node.attributes?.distribution_state === 'published') {
      const publications = [...edges.values()].filter((edge) => edge.type === 'PUBLISHED_AS' && edge.from === node.id);
      if (publications.length === 0) fail(`published package ${node.id} requires PUBLISHED_AS ArtifactVersion evidence`);
      for (const publication of publications) {
        const artifact = nodes.get(publication.to);
        if (artifact?.type !== 'ArtifactVersion' || artifact.attributes?.immutable !== true) {
          fail(`published package ${node.id} has invalid immutable ArtifactVersion evidence`);
        }
      }
    }
    if (
      node.type === 'Package' &&
      node.attributes?.distribution_state !== undefined &&
      node.attributes?.distribution_state !== 'published' &&
      [...edges.values()].some((edge) => edge.type === 'PUBLISHED_AS' && edge.from === node.id)
    ) {
      fail(`${node.attributes?.distribution_state} package ${node.id} cannot be PUBLISHED_AS`);
    }
  }

  if (registry.fragment_schema.version === '2.0.0') {
    for (const node of nodes.values()) {
      const outgoingDependencies = [...edges.values()].filter((edge) => edge.type === 'DEPENDS_ON' && edge.from === node.id);
      if (
        node.type === 'Package' &&
        node.role === 'projection' &&
        !outgoingDependencies.some((edge) => nodes.get(edge.to)?.type === 'Contract')
      ) {
        fail(`projection package ${node.id} must DEPENDS_ON a canonical Contract`);
      }
      if (
        node.type === 'Package' &&
        node.role === 'adapter' &&
        !outgoingDependencies.some((edge) => nodes.get(edge.to)?.type === 'Contract' && nodes.get(edge.to)?.kind === 'port')
      ) {
        fail(`adapter package ${node.id} must DEPENDS_ON a port Contract`);
      }
      if (
        node.type === 'Adapter' &&
        !outgoingDependencies.some((edge) => nodes.get(edge.to)?.type === 'Contract' && nodes.get(edge.to)?.kind === 'port')
      ) {
        fail(`adapter ${node.id} must DEPENDS_ON a port Contract`);
      }
      if (node.type === 'Module' && node.role === 'reference-implementation' && node.attributes?.production_ready === true) {
        fail(`reference implementation ${node.id} cannot be production-ready`);
      }
      if (node.type === 'Module' && node.role === undefined) {
        const representationEdges = [...edges.values()].filter(
          (edge) => edge.type === 'SUPERSEDES' && edge.to === node.id,
        );
        if (
          representationEdges.length !== 1 ||
          nodes.get(representationEdges[0].from)?.type !== 'Package' ||
          nodes.get(representationEdges[0].from)?.role !== 'projection' ||
          representationEdges[0].from !== node.attributes?.representation_migrated_to
        ) {
          fail(`legacy projection tombstone ${node.id} requires exactly one matching projection Package SUPERSEDES edge`);
        }
      }
      if (node.attributes?.change_kind === 'breaking') {
        const predecessorEdge = [...edges.values()].find((edge) => edge.type === 'SUPERSEDES' && edge.from === node.id);
        const predecessor = predecessorEdge && nodes.get(predecessorEdge.to);
        if (!predecessor) fail(`breaking change ${node.id} requires a SUPERSEDES predecessor`);
        if (
          !semver.valid(node.version) ||
          !semver.valid(predecessor.version) ||
          semver.major(node.version) <= semver.major(predecessor.version)
        ) {
          fail(`breaking change ${node.id} requires a major SemVer increase over its predecessor`);
        }
        if (!node.migration_path || !node.attributes?.rollback_path || !node.attributes?.compatibility_evidence) {
          fail(`breaking change ${node.id} requires migration, rollback and compatibility evidence paths`);
        }
      }
    }
    for (const edge of [...edges.values()].filter((candidate) => candidate.type === 'SUPERSEDES')) {
      const successor = nodes.get(edge.from);
      const predecessor = nodes.get(edge.to);
      if ((successor.version || predecessor.version) && !['additive', 'breaking'].includes(successor.attributes?.change_kind)) {
        fail(`${successor.id} SUPERSEDES a versioned node without declared change_kind`);
      }
      if (semver.valid(successor.version) && semver.valid(predecessor.version) && !semver.gt(successor.version, predecessor.version)) {
        fail(`${successor.id} SUPERSEDES requires a greater SemVer than ${predecessor.id}`);
      }
    }
    const repositoryLayers = new Map(
      [...nodes.values()].filter((node) => node.type === 'Repository').map((node) => [node.id, node.attributes?.ownership_layer]),
    );
    const layerOf = (node) => node.attributes?.ownership_layer || repositoryLayers.get(nodeRepositories.get(node.id));
    for (const edge of [...edges.values()].filter((candidate) => candidate.type === 'DEPENDS_ON')) {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      const fromLayer = layerOf(from);
      const toLayer = layerOf(to);
      if (['platform-core', 'stack-core'].includes(fromLayer) && toLayer === 'product') {
        fail(`product-to-core ownership inversion in ${edge.id}`);
      }
      if (fromLayer === 'platform-core' && to.type === 'Adapter') {
        fail(`Platform Core cannot depend on stack adapter in ${edge.id}`);
      }
    }
  }

  if (registry.fragment_schema.version === '2.0.0') {
    for (const consumer of [...nodes.values()].filter((node) => node.type === 'Consumer')) {
      if (consumer.attributes?.installation_state === 'not-installed') {
        if (consumer.attributes?.artifact_version_id !== undefined) {
          fail(`${consumer.id} not-installed consumer cannot reference artifact_version_id`);
        }
        continue;
      }
      const artifactId = consumer.attributes?.artifact_version_id;
      const artifact = nodes.get(artifactId);
      if (artifact?.type !== 'ArtifactVersion' || artifact.attributes?.immutable !== true) {
        fail(`${consumer.id} verified installation requires an immutable ArtifactVersion`);
      }
      const packages = new Set(
        [...edges.values()]
          .filter((edge) => edge.type === 'DEPENDS_ON' && edge.from === consumer.id && nodes.get(edge.to)?.type === 'Package')
          .map((edge) => edge.to),
      );
      const installedArtifactIsPublished = [...edges.values()].some(
        (edge) => edge.type === 'PUBLISHED_AS' && packages.has(edge.from) && edge.to === artifactId,
      );
      if (!installedArtifactIsPublished) {
        fail(`${consumer.id} verified installation has no package dependency publishing ${artifactId}`);
      }
    }
  }

  for (const adoption of [...edges.values()].filter((edge) => edge.type === 'CONSUMED_BY')) {
    const consumer = nodes.get(adoption.to);
    const artifactId = consumer.attributes?.artifact_version_id;
    const pccpV2 = registry.fragment_schema.version === '2.0.0';
    const validState = pccpV2
      ? consumer.attributes?.installation_state === 'verified-install' && consumer.attributes?.adoption_state === 'adopted'
      : consumer.attributes?.adoption_state === 'verified-install';
    if (!validState || typeof artifactId !== 'string') {
      fail(
        pccpV2
          ? `${adoption.id} requires separate installation_state=verified-install, adoption_state=adopted and artifact_version_id`
          : `${adoption.id} requires consumer adoption_state=verified-install and artifact_version_id`,
      );
    }
    if (nodes.get(artifactId)?.type !== 'ArtifactVersion') fail(`${adoption.id} references unknown ArtifactVersion ${artifactId}`);
    if (nodes.get(artifactId)?.attributes?.immutable !== true) fail(`${adoption.id} requires an immutable ArtifactVersion`);
    const packages = new Set(
      [...edges.values()]
        .filter((edge) => edge.type === 'DEPENDS_ON' && edge.from === consumer.id && nodes.get(edge.to)?.type === 'Package')
        .map((edge) => edge.to),
    );
    const installedArtifactIsPublished = [...edges.values()].some(
      (edge) => edge.type === 'PUBLISHED_AS' && packages.has(edge.from) && edge.to === artifactId,
    );
    if (!installedArtifactIsPublished) fail(`${adoption.id} has no package PUBLISHED_AS installed artifact ${artifactId}`);
  }

  for (const node of nodes.values()) {
    if (OWNERSHIP_REQUIRED.has(node.type)) {
      const ownerEdges = [...edges.values()].filter((edge) => edge.type === 'OWNED_BY' && edge.from === node.id);
      if (ownerEdges.length !== 1) fail(`${node.id} must have exactly one OWNED_BY edge; found ${ownerEdges.length}`);
    }
    if (node.type === 'Capability' && node.lifecycle === 'available') {
      const outgoing = [...edges.values()].filter((edge) => edge.from === node.id);
      for (const requiredType of ['DEFINED_BY', 'IMPLEMENTED_BY', 'VALIDATED_BY']) {
        if (!outgoing.some((edge) => edge.type === requiredType)) fail(`available capability ${node.id} is missing ${requiredType}`);
      }
      if (registry.fragment_schema.version === '2.0.0') {
        const definitions = outgoing.filter((edge) => edge.type === 'DEFINED_BY').map((edge) => nodes.get(edge.to));
        if (!definitions.some((target) => target.type === 'Contract')) {
          fail(`available capability ${node.id} is missing a canonical Contract definition`);
        }
        if (!definitions.some((target) => target.type === 'Module' && target.role === 'specification')) {
          fail(`available capability ${node.id} is missing a specification Module definition`);
        }
      }
    }
  }

  if (registry.fragment_schema.version === '2.0.0') {
    for (const node of nodes.values()) {
      if (['Owner', 'Repository'].includes(node.type)) continue;
      const hasEvidenceRelationship = [...edges.values()].some(
        (edge) => (edge.from === node.id || edge.to === node.id) && Array.isArray(edge.evidence) && edge.evidence.length > 0,
      );
      if (!node.path && !node.uri && !hasEvidenceRelationship) {
        fail(`${node.id} has no traceable path, URI, or evidenced relationship`);
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

  return { nodes, nodeRepositories, edges, findings };
}

function loadAndValidate({
  root = process.cwd(),
  registryPath = DEFAULT_REGISTRY,
  repositoryRoots = new Map(),
  requireAllFragments = false,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedRegistry = safeResolve(resolvedRoot, registryPath, 'registry path');
  if (!fs.existsSync(resolvedRegistry)) fail(`registry does not exist: ${registryPath}`);
  const registry = readYaml(resolvedRegistry);
  validateRegistry(registry, resolvedRoot);
  const fragmentRoots = new Map();
  const fragmentPathReaders = new Map();
  const fragmentContentReaders = new Map();
  const deferredFragments = [];
  const fragments = [];
  for (const entry of registry.fragments) {
    const fragmentRoot = entry.source.kind === 'local' ? resolvedRoot : repositoryRoots.get(entry.repository);
    if (!fragmentRoot) {
      deferredFragments.push(entry);
      continue;
    }
    const resolvedFragmentRoot = path.resolve(fragmentRoot);
    let document;
    if (entry.source.kind === 'git') {
      document = readPinnedGitFragment(resolvedFragmentRoot, entry);
      fragmentPathReaders.set(entry.id, (relativePath) => {
        safeResolve(resolvedFragmentRoot, relativePath, `fragment ${entry.id} node path`);
        try {
          execFileSync('git', ['-C', resolvedFragmentRoot, 'cat-file', '-e', `${entry.revision}:${relativePath}`], {
            stdio: ['ignore', 'ignore', 'pipe'],
          });
          return true;
        } catch {
          return false;
        }
      });
      fragmentContentReaders.set(entry.id, (relativePath) => {
        safeResolve(resolvedFragmentRoot, relativePath, `fragment ${entry.id} node path`);
        return execFileSync('git', ['-C', resolvedFragmentRoot, 'show', `${entry.revision}:${relativePath}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      });
    } else {
      const fragmentPath = safeResolve(resolvedFragmentRoot, entry.path, `fragment ${entry.id} path`);
      if (!fs.existsSync(fragmentPath)) fail(`fragment does not exist: ${entry.path}`);
      document = readYaml(fragmentPath);
    }
    fragments.push(document);
    fragmentRoots.set(entry.id, resolvedFragmentRoot);
  }
  if (requireAllFragments && deferredFragments.length > 0) {
    fail(`official composition requires all fragments; deferred: ${deferredFragments.map((entry) => entry.id).join(', ')}`);
  }
  const graph = validateGraph(registry, fragments, resolvedRoot, fragmentRoots, fragmentPathReaders, fragmentContentReaders);
  return { registry, fragments, deferredFragments, ...graph };
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    registryPath: DEFAULT_REGISTRY,
    query: null,
    type: null,
    json: false,
    requireAllFragments: false,
    repositoryRoots: new Map(),
  };
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
      case '--require-all-fragments': {
        options.requireAllFragments = true;
        break;
      }
      case '--repository-root': {
        const mapping = argv[++index] || '';
        const separator = mapping.indexOf('=');
        if (separator < 1) fail('--repository-root must use repository.id=/absolute/path');
        const repository = mapping.slice(0, separator);
        const repositoryRoot = mapping.slice(separator + 1);
        assertId(repository, '--repository-root repository id');
        if (!path.isAbsolute(repositoryRoot)) fail('--repository-root path must be absolute');
        options.repositoryRoots.set(repository, repositoryRoot);
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
        authoritative_repository: graph.nodeRepositories.get(node.id),
        outgoing: [...graph.edges.values()].filter((edge) => edge.from === node.id),
        incoming: [...graph.edges.values()].filter((edge) => edge.to === node.id),
      }));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const summary = {
      graph_id: graph.registry.graph_id,
      schema_version: graph.registry.schema_version,
      registered_fragments: graph.registry.fragments.length,
      validated_fragments: graph.fragments.length,
      deferred_fragments: graph.deferredFragments.length,
      nodes: graph.nodes.size,
      edges: graph.edges.size,
      findings: graph.findings.size,
      status: 'valid',
    };
    process.stdout.write(
      options.json
        ? `${JSON.stringify(summary)}\n`
        : `Capability graph valid: ${summary.validated_fragments}/${summary.registered_fragments} fragments validated (${summary.deferred_fragments} delegated), ${summary.nodes} nodes, ${summary.edges} edges, ${summary.findings} findings\n`,
    );
  } catch (error) {
    process.stderr.write(`Capability graph invalid: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_REGISTRY,
  hasCycle,
  jsonSchemaBreakingChanges,
  loadAndValidate,
  readPinnedGitFragment,
  safeResolve,
  validateGraph,
  validateRegistry,
};
