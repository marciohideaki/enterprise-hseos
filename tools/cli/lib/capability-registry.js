const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_FILE = path.join('.enterprise', 'governance', 'capabilities', 'ecp-registry.snapshot.json');
const SNAPSHOT_LOCK_FILE = path.join('.enterprise', 'governance', 'capabilities', 'ecp-registry.snapshot.lock.json');
const STACKS_SNAPSHOT_FILE = path.join('.enterprise', 'governance', 'capabilities', 'ecp-stacks.snapshot.json');
const STACKS_LOCK_FILE = path.join('.enterprise', 'governance', 'capabilities', 'ecp-stacks.snapshot.lock.json');
const MAX_REGISTRY_BYTES = 5 * 1024 * 1024;

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const PACKAGE_SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/;
const CAPABILITY_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;
const STACK_ID = /^[a-z][a-z0-9-]*$/;
const FILE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DATE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

const ROOT_KEYS = new Set(['schema_version', 'generated_from', 'capabilities']);
const GENERATED_FROM_KEYS = new Set(['repository', 'ref', 'contracts_version']);
const CAPABILITY_KEYS = new Set([
  'name',
  'kind',
  'version',
  'stability',
  'owner',
  'summary',
  'aliases',
  'related_capabilities',
  'deprecation',
  'match',
  'providers',
  'files',
  'implementations',
  'targets',
  'coverage',
]);
const CAPABILITY_REQUIRED = ['name', 'kind', 'version', 'stability', 'owner', 'summary', 'aliases', 'files', 'implementations'];
const KINDS = new Set(['service', 'library']);
const STABILITIES = new Set(['experimental', 'beta', 'stable', 'deprecated']);
const MATCH_KEYS = new Set(['symbols', 'path_globs', 'packages']);
const DEPRECATION_KEYS = new Set(['since', 'sunset', 'replaced_by']);
const REPLACED_BY = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+@(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const FILE_KEYS = new Set(['path', 'sha256', 'role']);
const FILE_ROLES = new Set([
  'contract',
  'schema',
  'specification',
  'conformance-valid',
  'conformance-invalid',
  'implementations',
  'interface',
  'migration',
  'example',
  'policy',
]);
const TARGET_KEYS = new Set(['stack', 'required']);
const COVERAGE_KEYS = new Set(['target', 'required', 'status', 'via']);
const COVERAGE_STATUSES = new Set(['stable', 'experimental', 'planned', 'missing']);
const IMPLEMENTATION_KEYS = new Set([
  'stack',
  'kind',
  'package',
  'package_version',
  'contract_version',
  'status',
  'repository',
  'path',
  'conformance',
  'operations',
  'guarantees',
]);
const IMPLEMENTATION_REQUIRED = ['stack', 'kind', 'package', 'contract_version', 'status'];
const IMPLEMENTATION_KINDS = new Set(['runtime', 'sdk', 'library']);
const IMPLEMENTATION_STATUSES = new Set(['planned', 'experimental', 'stable', 'deprecated']);
const CONFORMANCE_KEYS = new Set(['vectors_version', 'evidence']);
const LOCK_KEYS = new Set(['schema_version', 'repository', 'ref', 'contracts_version', 'sha256']);

const SCORES = { name: 100, alias: 90, contract: 80, package: 80, symbol: 60, path: 60, prefix: 40, heuristic: 10, tokens: 5 };

class RegistryIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryIntegrityError';
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** Collects every structural problem of an ECP capability registry (schema_version "1"). */
function registryProblems(registry) {
  const problems = [];
  const fail = (message) => problems.push(message);
  const shape = (value, label, allowed, required = []) => {
    if (!isPlainObject(value)) {
      fail(`${label} must be an object`);
      return false;
    }
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown field '${key}'`);
    for (const key of required) if (value[key] === undefined) fail(`${label}.${key} is required`);
    return true;
  };
  const stringList = (value, label) => {
    if (!Array.isArray(value) || value.some((entry) => !isNonEmptyString(entry))) fail(`${label} must be a list of non-empty strings`);
  };

  if (!shape(registry, 'registry', ROOT_KEYS, [...ROOT_KEYS])) return problems;
  if (registry.schema_version !== '1') fail("registry.schema_version must be '1'");
  if (shape(registry.generated_from, 'generated_from', GENERATED_FROM_KEYS, ['repository', 'contracts_version'])) {
    const source = registry.generated_from;
    if (source.repository !== undefined && !isNonEmptyString(source.repository))
      fail('generated_from.repository must be a non-empty string');
    if (source.ref !== undefined && !isNonEmptyString(source.ref)) fail('generated_from.ref must be a non-empty string');
    if (
      source.contracts_version !== undefined &&
      !(typeof source.contracts_version === 'string' && SEMVER.test(source.contracts_version))
    ) {
      fail('generated_from.contracts_version must be a semantic version');
    }
  }
  if (!Array.isArray(registry.capabilities)) {
    fail('registry.capabilities must be a list');
    return problems;
  }
  const names = new Set();
  for (const [index, capability] of registry.capabilities.entries()) {
    const label = `capabilities[${index}]`;
    if (!shape(capability, label, CAPABILITY_KEYS, CAPABILITY_REQUIRED)) continue;
    capabilityProblems(capability, label, { fail, shape, stringList });
    if (typeof capability.name === 'string') {
      if (names.has(capability.name)) fail(`${label}.name '${capability.name}' is duplicated`);
      names.add(capability.name);
    }
  }
  return problems;
}

function capabilityProblems(capability, label, { fail, shape, stringList }) {
  if (capability.name !== undefined && !(typeof capability.name === 'string' && CAPABILITY_NAME.test(capability.name))) {
    fail(`${label}.name must be a dotted capability name`);
  }
  if (capability.kind !== undefined && !KINDS.has(capability.kind)) fail(`${label}.kind must be one of ${[...KINDS].join(', ')}`);
  if (capability.version !== undefined && !(typeof capability.version === 'string' && SEMVER.test(capability.version))) {
    fail(`${label}.version must be a semantic version`);
  }
  if (capability.stability !== undefined && !STABILITIES.has(capability.stability)) {
    fail(`${label}.stability must be one of ${[...STABILITIES].join(', ')}`);
  }
  for (const key of ['owner', 'summary']) {
    if (capability[key] !== undefined && !isNonEmptyString(capability[key])) fail(`${label}.${key} must be a non-empty string`);
  }
  if (capability.aliases !== undefined) stringList(capability.aliases, `${label}.aliases`);
  if (capability.providers !== undefined) stringList(capability.providers, `${label}.providers`);
  if (capability.related_capabilities !== undefined) {
    const related = capability.related_capabilities;
    if (!Array.isArray(related) || related.some((entry) => !(typeof entry === 'string' && CAPABILITY_NAME.test(entry)))) {
      fail(`${label}.related_capabilities must be a list of capability names`);
    }
  }
  if (capability.stability === 'deprecated' && capability.deprecation === undefined)
    fail(`${label}.deprecation is required when deprecated`);
  if (
    capability.deprecation !== undefined &&
    shape(capability.deprecation, `${label}.deprecation`, DEPRECATION_KEYS, ['since', 'sunset'])
  ) {
    const { since, sunset, replaced_by: replacedBy } = capability.deprecation;
    if (since !== undefined && !(typeof since === 'string' && SEMVER.test(since)))
      fail(`${label}.deprecation.since must be a semantic version`);
    if (sunset !== undefined && !(typeof sunset === 'string' && DATE.test(sunset))) fail(`${label}.deprecation.sunset must be YYYY-MM-DD`);
    if (replacedBy !== undefined && !(typeof replacedBy === 'string' && REPLACED_BY.test(replacedBy))) {
      fail(`${label}.deprecation.replaced_by must be <capability>@<version>`);
    }
  }
  if (capability.match !== undefined && shape(capability.match, `${label}.match`, MATCH_KEYS)) {
    for (const key of MATCH_KEYS) if (capability.match[key] !== undefined) stringList(capability.match[key], `${label}.match.${key}`);
  }
  if (capability.files !== undefined) filesProblems(capability.files, label, { fail, shape });
  if (capability.targets !== undefined) targetsProblems(capability.targets, label, { fail, shape });
  if (capability.coverage !== undefined) coverageProblems(capability.coverage, label, { fail, shape });
  if (capability.implementations !== undefined) {
    if (Array.isArray(capability.implementations)) {
      for (const [index, implementation] of capability.implementations.entries()) {
        implementationProblems(implementation, `${label}.implementations[${index}]`, { fail, shape });
      }
    } else {
      fail(`${label}.implementations must be a list`);
    }
  }
}

function filesProblems(files, label, { fail, shape }) {
  if (!Array.isArray(files) || files.length === 0) {
    fail(`${label}.files must be a non-empty list`);
    return;
  }
  for (const [index, file] of files.entries()) {
    const fileLabel = `${label}.files[${index}]`;
    if (!shape(file, fileLabel, FILE_KEYS, [...FILE_KEYS])) continue;
    if (file.path !== undefined && !(typeof file.path === 'string' && FILE_PATH.test(file.path)))
      fail(`${fileLabel}.path is not a valid relative path`);
    if (file.sha256 !== undefined && !(typeof file.sha256 === 'string' && SHA256.test(file.sha256)))
      fail(`${fileLabel}.sha256 must be 64 hex characters`);
    if (file.role !== undefined && !FILE_ROLES.has(file.role)) fail(`${fileLabel}.role is not a known role`);
  }
}

/** `targets` (Decision 0011): the stacks a capability must reach, `required` materialized by the generator. */
function targetsProblems(targets, label, { fail, shape }) {
  if (!Array.isArray(targets) || targets.length === 0) {
    fail(`${label}.targets must be a non-empty list`);
    return;
  }
  for (const [index, target] of targets.entries()) {
    const targetLabel = `${label}.targets[${index}]`;
    if (!shape(target, targetLabel, TARGET_KEYS, [...TARGET_KEYS])) continue;
    if (target.stack !== undefined && !(typeof target.stack === 'string' && STACK_ID.test(target.stack)))
      fail(`${targetLabel}.stack must be a stack id`);
    if (target.required !== undefined && typeof target.required !== 'boolean') fail(`${targetLabel}.required must be a boolean`);
  }
}

/** `coverage` (Decision 0011): derived by the generator, one item per target; only its shape is checked here. */
function coverageProblems(coverage, label, { fail, shape }) {
  if (!Array.isArray(coverage)) {
    fail(`${label}.coverage must be a list`);
    return;
  }
  for (const [index, item] of coverage.entries()) {
    const itemLabel = `${label}.coverage[${index}]`;
    if (!shape(item, itemLabel, COVERAGE_KEYS, ['target', 'required', 'status'])) continue;
    for (const key of ['target', 'via']) {
      if (item[key] !== undefined && !(typeof item[key] === 'string' && STACK_ID.test(item[key])))
        fail(`${itemLabel}.${key} must be a stack id`);
    }
    if (item.required !== undefined && typeof item.required !== 'boolean') fail(`${itemLabel}.required must be a boolean`);
    if (item.status !== undefined && !COVERAGE_STATUSES.has(item.status)) {
      fail(`${itemLabel}.status must be one of ${[...COVERAGE_STATUSES].join(', ')}`);
    }
  }
}

function implementationProblems(implementation, label, { fail, shape }) {
  if (!shape(implementation, label, IMPLEMENTATION_KEYS, IMPLEMENTATION_REQUIRED)) return;
  if (implementation.stack !== undefined && !(typeof implementation.stack === 'string' && STACK_ID.test(implementation.stack))) {
    fail(`${label}.stack must be a stack id`);
  }
  if (implementation.kind !== undefined && !IMPLEMENTATION_KINDS.has(implementation.kind))
    fail(`${label}.kind must be runtime, sdk or library`);
  for (const key of ['package', 'repository', 'path']) {
    if (implementation[key] !== undefined && !isNonEmptyString(implementation[key])) fail(`${label}.${key} must be a non-empty string`);
  }
  if (
    implementation.package_version !== undefined &&
    !(typeof implementation.package_version === 'string' && PACKAGE_SEMVER.test(implementation.package_version))
  ) {
    fail(`${label}.package_version must be a semantic version`);
  }
  if (
    implementation.contract_version !== undefined &&
    !(typeof implementation.contract_version === 'string' && SEMVER.test(implementation.contract_version))
  ) {
    fail(`${label}.contract_version must be a semantic version`);
  }
  if (implementation.status !== undefined && !IMPLEMENTATION_STATUSES.has(implementation.status)) {
    fail(`${label}.status must be planned, experimental, stable or deprecated`);
  }
  if (implementation.status === 'stable') {
    if (implementation.package_version === undefined) fail(`${label}.package_version is required when stable`);
    if (implementation.conformance === undefined) fail(`${label}.conformance is required when stable`);
  }
  if (
    implementation.conformance !== undefined &&
    shape(implementation.conformance, `${label}.conformance`, CONFORMANCE_KEYS, ['vectors_version'])
  ) {
    const { vectors_version: vectors, evidence } = implementation.conformance;
    if (vectors !== undefined && !(typeof vectors === 'string' && SEMVER.test(vectors)))
      fail(`${label}.conformance.vectors_version must be a semantic version`);
    if (evidence !== undefined && !isNonEmptyString(evidence)) fail(`${label}.conformance.evidence must be a non-empty string`);
  }
  // ECP contracts 0.6.1 carries its canonical per-operation declaration in the
  // catalog. This reader checks the published structural shape and pairing;
  // ECP's producer owns family-profile semantics and behavioral conformance.
  // Older snapshots with neither optional field retain their original behavior.
  if (implementation.operations !== undefined || implementation.guarantees !== undefined) {
    const operation = /^[a-z][a-z0-9_-]*$/;
    const value = /^[a-z][a-z0-9_]*$/;
    const operations = implementation.operations;
    const guarantees = implementation.guarantees;
    const operationsValid =
      Array.isArray(operations) &&
      operations.length > 0 &&
      operations.every((item) => typeof item === 'string' && operation.test(item)) &&
      new Set(operations).size === operations.length;
    if (!operationsValid) fail(`${label}.operations must be a non-empty unique list of operation ids`);
    if (!Array.isArray(guarantees) || guarantees.length === 0) {
      fail(`${label}.guarantees must be a non-empty list`);
    } else {
      const declared = new Set();
      for (const [index, guarantee] of guarantees.entries()) {
        const itemLabel = `${label}.guarantees[${index}]`;
        if (!isPlainObject(guarantee)) {
          fail(`${itemLabel} must be an object`);
          continue;
        }
        if (typeof guarantee.operation !== 'string' || !operation.test(guarantee.operation)) {
          fail(`${itemLabel}.operation must be an operation id`);
        } else {
          if (declared.has(guarantee.operation)) fail(`${itemLabel}.operation is duplicated`);
          declared.add(guarantee.operation);
          if (operationsValid && !operations.includes(guarantee.operation)) fail(`${itemLabel}.operation is not declared`);
        }
        for (const [dimension, guaranteeValue] of Object.entries(guarantee)) {
          if (dimension !== 'operation' && !(typeof guaranteeValue === 'string' && value.test(guaranteeValue))) {
            fail(`${itemLabel}.${dimension} must be a guarantee value id`);
          }
        }
      }
      if (operationsValid && (declared.size !== operations.length || operations.some((item) => !declared.has(item)))) {
        fail(`${label}.guarantees must cover every declared operation exactly once`);
      }
    }
  }
}

/** Throws `Invalid capability registry: ...` listing every problem; returns the registry when valid. */
function validateCapabilityRegistry(registry) {
  const problems = registryProblems(registry);
  if (problems.length > 0) {
    const shown = problems.slice(0, 10).join('; ');
    throw new Error(`Invalid capability registry: ${shown}${problems.length > 10 ? `; and ${problems.length - 10} more` : ''}`);
  }
  return registry;
}

// ---------------------------------------------------------------------------------------------
// Stack vocabulary (ECP Decision 0011, resolution v1.1)
//
// Stack vocabulary, normalization, `accepts` and target coverage (ECP Decision 0011, resolution v1.1).
//
// Mirror of ecp_runtime/stacks.py. Pure and deterministic. The vocabulary document is the ECP
// `contracts/stacks.json`; HSEOS reads it from a verified snapshot (see capability-registry.js).
// Without a vocabulary the resolver keeps the v1 rules (lower-case equality), so nothing here runs.

const VOCABULARY_KEYS = new Set(['schema_version', 'stacks_version', 'stacks']);
const STACK_KEYS = new Set(['id', 'family', 'summary', 'aliases', 'accepts']);

const STATUS_RANK = { stable: 3, experimental: 2, planned: 1 };

// Python `str.isspace()` / `re` `\s` (what ECP uses) is not the ECP-agnostic JavaScript `\s`: it adds
// U+001C..U+001F and U+0085 and has no U+FEFF. Parity with the ECP vocabulary needs the exact set.
const SPACE = String.raw`\t\n\v\f\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
const EDGE_SPACE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'g');
const SEPARATORS = new RegExp(`[${SPACE}_-]+`, 'g');

/** Trim, lower-case and collapse whitespace, `_` and `-` runs into one `-` (no alias lookup). */
function normalizeToken(value) {
  return String(value).replaceAll(EDGE_SPACE, '').toLowerCase().replaceAll(SEPARATORS, '-');
}

/** Every structural and semantic problem of a `stacks.json` document (shape plus the invariants of ECP `vocabulary_problems`). */
function vocabularyProblems(document) {
  if (!isPlainObject(document)) return ['stacks.json must be an object'];
  const problems = [];
  for (const key of Object.keys(document)) if (!VOCABULARY_KEYS.has(key)) problems.push(`stacks.json has unknown field '${key}'`);
  if (document.schema_version !== '1') problems.push("stacks.json schema_version must be '1'");
  if (!(typeof document.stacks_version === 'string' && SEMVER.test(document.stacks_version))) {
    problems.push('stacks.json stacks_version must be a semantic version');
  }
  if (!Array.isArray(document.stacks) || document.stacks.length === 0) {
    problems.push("stacks.json must have a non-empty 'stacks' list");
    return problems;
  }
  const ids = new Set();
  const entries = [];
  for (const [index, entry] of document.stacks.entries()) {
    const label = `stacks[${index}]`;
    if (!isPlainObject(entry)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    for (const key of Object.keys(entry)) if (!STACK_KEYS.has(key)) problems.push(`${label} has unknown field '${key}'`);
    for (const key of ['family', 'summary']) {
      if (!(typeof entry[key] === 'string' && entry[key].length > 0)) problems.push(`${label}.${key} must be a non-empty string`);
    }
    for (const key of ['aliases', 'accepts']) {
      if (!Array.isArray(entry[key]) || entry[key].some((item) => typeof item !== 'string')) {
        problems.push(`${label}.${key} must be a list of strings`);
      }
    }
    if (!(typeof entry.id === 'string' && STACK_ID.test(entry.id))) {
      problems.push(`${label}.id must be a stack id`);
      continue;
    }
    if (ids.has(entry.id)) problems.push(`stack id '${entry.id}' is defined more than once`);
    ids.add(entry.id);
    entries.push(entry);
  }
  const seenAliases = new Map();
  for (const entry of entries) {
    const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter((alias) => typeof alias === 'string') : [];
    for (const alias of aliases) {
      if (normalizeToken(alias) !== alias) {
        problems.push(`${entry.id}: alias '${alias}' is not in normalized form ('${normalizeToken(alias)}')`);
      }
      if (ids.has(alias)) problems.push(`${entry.id}: alias '${alias}' is also a stack id (ids and aliases must be disjoint)`);
      if (seenAliases.has(alias)) {
        const owner = seenAliases.get(alias);
        problems.push(`alias '${alias}' is declared ${owner === entry.id ? 'twice' : `by '${owner}' and '${entry.id}'`}`);
      } else {
        seenAliases.set(alias, entry.id);
      }
    }
    const accepted = new Set();
    for (const other of Array.isArray(entry.accepts) ? entry.accepts.filter((item) => typeof item === 'string') : []) {
      if (other === entry.id) problems.push(`${entry.id}: accepts must not list itself`);
      else if (!ids.has(other)) problems.push(`${entry.id}: accepts refers to unknown stack '${other}'`);
      if (accepted.has(other)) problems.push(`${entry.id}: accepts lists '${other}' more than once`);
      accepted.add(other);
    }
  }
  return problems;
}

/**
 * Parsed vocabulary: `normalize` maps an id or alias to the canonical id (anything else stays as the normalized
 * token and matches nothing); `accepts` is directional and NOT transitive.
 */
function createVocabulary(document) {
  const problems = vocabularyProblems(document);
  if (problems.length > 0) {
    const shown = problems.slice(0, 10).join('; ');
    throw new Error(`Invalid stack vocabulary: ${shown}${problems.length > 10 ? `; and ${problems.length - 10} more` : ''}`);
  }
  const aliases = new Map();
  const acceptsMap = new Map();
  for (const entry of document.stacks) {
    for (const alias of entry.aliases) aliases.set(alias, entry.id);
    acceptsMap.set(entry.id, [...entry.accepts]);
  }
  const normalize = (value) => {
    const token = normalizeToken(value);
    return aliases.has(token) ? aliases.get(token) : token;
  };
  const acceptsOf = (stackId) => acceptsMap.get(stackId) || [];
  return {
    version: document.stacks_version,
    ids: document.stacks.map((entry) => entry.id),
    normalize,
    accepts: acceptsOf,
    expand: (stackId) => new Set([stackId, ...acceptsOf(stackId)]),
  };
}

/** Vocabulary of a registry shipped without `stacks.json`: ids compare by normalized token, nothing is accepted. */
const IDENTITY_VOCABULARY = Object.freeze({ normalize: normalizeToken, accepts: () => [] });

/** Targets with the `required` default materialized, sorted by stack (code-unit order, as the ids are ASCII). */
function normalizedTargets(targets) {
  return targets
    .map((target) => ({ stack: target.stack, required: target.required === undefined ? true : target.required }))
    .sort((a, b) => (a.stack < b.stack ? -1 : a.stack > b.stack ? 1 : 0));
}

/** Best `{status, via}` for one target: highest status rank, a direct implementation beats a via-accepts one; deprecated never counts. */
function satisfaction(targetStack, implementations, vocabulary) {
  const accepted = new Set(vocabulary.accepts(targetStack));
  let best = null;
  for (const implementation of implementations) {
    const rank = STATUS_RANK[implementation.status];
    if (rank === undefined || !Object.hasOwn(STATUS_RANK, implementation.status)) continue;
    const stack = vocabulary.normalize(implementation.stack === undefined ? '' : implementation.stack);
    let direct;
    let via;
    if (stack === targetStack) {
      direct = 1;
      via = null;
    } else if (accepted.has(stack)) {
      direct = 0;
      via = stack;
    } else {
      continue;
    }
    const better =
      best === null ||
      rank > best.rank ||
      (rank === best.rank && direct > best.direct) ||
      (rank === best.rank && direct === best.direct && (via || '') < (best.via || ''));
    if (better) best = { rank, direct, status: implementation.status, via };
  }
  return best === null ? { status: 'missing', via: null } : { status: best.status, via: best.via };
}

/** One item per target, sorted by stack: `{target, required, status[, via]}`. */
function deriveCoverage(targets, implementations, vocabulary) {
  return normalizedTargets(targets).map((target) => {
    const { status, via } = satisfaction(vocabulary.normalize(target.stack), implementations, vocabulary);
    const item = { target: target.stack, required: target.required, status };
    if (via) item.via = via;
    return item;
  });
}

/** Targets whose derived status is `missing` (a `planned` target is not missing). */
function missingTargets(targets, implementations, vocabulary) {
  return deriveCoverage(targets, implementations, vocabulary)
    .filter((item) => item.status === 'missing')
    .map((item) => ({ stack: item.target, required: item.required }));
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readBoundedFile(file, label, { rejectSymlink = false } = {}) {
  if (rejectSymlink && fs.lstatSync(file).isSymbolicLink()) throw new RegistryIntegrityError(`${label} must not be a symlink: ${file}`);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
  if (stat.size > MAX_REGISTRY_BYTES) throw new Error(`${label} is too large (${stat.size} bytes; limit ${MAX_REGISTRY_BYTES})`);
  return fs.readFileSync(file);
}

function parseRegistry(bytes, label) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid capability registry: ${label} is not valid JSON (${error.message})`);
  }
  return validateCapabilityRegistry(parsed);
}

function readSnapshotLock(runtimeRoot, { file = SNAPSHOT_LOCK_FILE, label = 'Registry snapshot lock' } = {}) {
  const lockFile = path.join(runtimeRoot, file);
  let lock;
  try {
    lock = JSON.parse(readBoundedFile(lockFile, label.toLowerCase(), { rejectSymlink: true }).toString('utf8'));
  } catch (error) {
    throw new RegistryIntegrityError(`${label} is unreadable (${lockFile}): ${error.message}`);
  }
  if (!isPlainObject(lock) || Object.keys(lock).some((key) => !LOCK_KEYS.has(key)) || lock.schema_version !== '1.0.0') {
    throw new RegistryIntegrityError(`${label} has an unexpected shape`);
  }
  if (
    !(typeof lock.sha256 === 'string' && SHA256.test(lock.sha256)) ||
    !isNonEmptyString(lock.ref) ||
    !isNonEmptyString(lock.repository) ||
    !SEMVER.test(String(lock.contracts_version))
  ) {
    throw new RegistryIntegrityError(`${label} is missing sha256, ref, repository or contracts_version`);
  }
  return lock;
}

function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function parseVocabulary(bytes, label) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid stack vocabulary: ${label} is not valid JSON (${error.message})`);
  }
  return createVocabulary(parsed);
}

/**
 * The shipped stack vocabulary (ECP `contracts/stacks.json`), or null when the snapshot ships none (contracts
 * before 0.5.0): null keeps the v1 stack rules. The file and its lock exist together or not at all, the file is
 * verified against the lock, and the lock must name the same repository, ref and contracts version as the registry
 * snapshot lock, so a registry and a vocabulary from different releases never combine.
 */
function loadStacksSnapshot(runtimeRoot, registryLock) {
  const file = path.join(runtimeRoot, STACKS_SNAPSHOT_FILE);
  const lockFile = path.join(runtimeRoot, STACKS_LOCK_FILE);
  const hasFile = exists(file);
  const hasLock = exists(lockFile);
  if (!hasFile && !hasLock) return null;
  if (hasFile !== hasLock) throw new RegistryIntegrityError('Stacks snapshot and its lock must be present together');
  const lock = readSnapshotLock(runtimeRoot, { file: STACKS_LOCK_FILE, label: 'Stacks snapshot lock' });
  for (const key of ['repository', 'ref', 'contracts_version']) {
    if (lock[key] !== registryLock[key]) {
      throw new RegistryIntegrityError(
        `Stacks snapshot lock ${key} ${lock[key]} does not match the registry snapshot lock (${registryLock[key]})`,
      );
    }
  }
  const bytes = readBoundedFile(file, 'stacks snapshot', { rejectSymlink: true });
  const sha256 = sha256Hex(bytes);
  if (sha256 !== lock.sha256) throw new RegistryIntegrityError(`Stacks snapshot sha256 mismatch: lock ${lock.sha256}, computed ${sha256}`);
  let vocabulary;
  try {
    vocabulary = parseVocabulary(bytes, STACKS_SNAPSHOT_FILE);
  } catch (error) {
    throw new RegistryIntegrityError(`Stacks snapshot is not a valid vocabulary: ${error.message}`);
  }
  return { vocabulary, sha256, version: vocabulary.version, source: 'snapshot' };
}

/**
 * Development vocabulary next to a `path` registry: `<registry>.stacks.json` (what `platform-bindings sync` writes),
 * or `contracts/stacks.json` beside an ECP checkout's `catalog/`. Hashed on read; the registry pin does not cover it.
 */
function loadStacksBesideRegistry(registryFile) {
  const resolved = path.resolve(registryFile);
  const candidates = [`${resolved.replace(/\.json$/i, '')}.stacks.json`];
  if (path.basename(path.dirname(resolved)) === 'catalog') {
    candidates.push(path.join(path.dirname(path.dirname(resolved)), 'contracts', 'stacks.json'));
  }
  const found = candidates.find((candidate) => exists(candidate));
  if (!found) return null;
  const bytes = readBoundedFile(found, 'stacks file');
  const vocabulary = parseVocabulary(bytes, found);
  return { vocabulary, sha256: sha256Hex(bytes), version: vocabulary.version, source: 'path' };
}

function verifyPin(pin, actual, label) {
  if (pin !== undefined && pin !== actual)
    throw new RegistryIntegrityError(`${label} sha256 mismatch: expected ${pin}, computed ${actual}`);
}

/**
 * Loads the ECP capability registry named by the resolved platform bindings
 * (ADR-0046 §3, §7). Offline: never reaches the network.
 *  - snapshot: shipped file verified against its lock (and an optional pinned sha256);
 *  - path: development file, hashed on read;
 *  - remote: only through the explicit sync command, never here.
 */
function loadCapabilityRegistry({ runtimeRoot, bindings } = {}) {
  const declared = (bindings && bindings.registry) || { source: 'snapshot' };
  if (declared.source === 'remote') {
    throw new Error('Remote capability registries are not read directly: run `hseos platform-bindings sync` first');
  }
  if (declared.source === 'path') {
    if (!isNonEmptyString(declared.path)) throw new Error('registry.path is required for source path');
    const bytes = readBoundedFile(path.resolve(declared.path), 'capability registry');
    const sha256 = sha256Hex(bytes);
    verifyPin(declared.sha256, sha256, 'Capability registry');
    const registry = parseRegistry(bytes, declared.path);
    const stacks = loadStacksBesideRegistry(declared.path);
    return {
      registry,
      source: 'path',
      ref: registry.generated_from.ref || null,
      sha256,
      vocabulary: stacks ? stacks.vocabulary : null,
      stacks: stacks ? { source: stacks.source, version: stacks.version, sha256: stacks.sha256 } : null,
    };
  }
  if (declared.source !== 'snapshot') throw new Error(`Unknown registry source '${declared.source}'`);
  if (!isNonEmptyString(runtimeRoot)) throw new Error('loadCapabilityRegistry requires runtimeRoot for the snapshot source');
  const lock = readSnapshotLock(runtimeRoot);
  const bytes = readBoundedFile(path.join(runtimeRoot, SNAPSHOT_FILE), 'registry snapshot', { rejectSymlink: true });
  const sha256 = sha256Hex(bytes);
  if (sha256 !== lock.sha256) {
    throw new RegistryIntegrityError(`Registry snapshot sha256 mismatch: lock ${lock.sha256}, computed ${sha256}`);
  }
  verifyPin(declared.sha256, sha256, 'Registry snapshot');
  const registry = parseRegistry(bytes, SNAPSHOT_FILE);
  if (registry.generated_from.contracts_version !== lock.contracts_version) {
    throw new RegistryIntegrityError(
      `Registry snapshot contracts_version ${registry.generated_from.contracts_version} does not match its lock (${lock.contracts_version})`,
    );
  }
  if (registry.generated_from.repository !== lock.repository) {
    throw new RegistryIntegrityError(
      `Registry snapshot repository ${registry.generated_from.repository} does not match its lock (${lock.repository})`,
    );
  }
  const stacks = loadStacksSnapshot(runtimeRoot, lock);
  return {
    registry,
    source: 'snapshot',
    ref: lock.ref,
    sha256,
    vocabulary: stacks ? stacks.vocabulary : null,
    stacks: stacks ? { source: stacks.source, version: stacks.version, sha256: stacks.sha256 } : null,
  };
}

/**
 * Stack semantics shared by resolveCapability and matchExport: names compare
 * case-insensitively; `stacks` undefined or empty means the stack is unknown and
 * is treated as ANY stack (fail toward blocking). Only a non-empty list filters.
 */
function stackSet(stacks) {
  if (!Array.isArray(stacks) || stacks.length === 0) return null;
  return new Set(stacks.map((stack) => String(stack).toLowerCase()));
}

function inStacks(implementation, wanted) {
  return !wanted || wanted.has(implementation.stack.toLowerCase());
}

/**
 * The stack filter of a lookup. Without a vocabulary it is the v1 rule (lower-case equality; every kept
 * implementation is a direct one; stacks are reported as written). With one (resolution v1.1, Decision 0011)
 * the query and implementation stacks are normalized to canonical ids (aliases), the kept set is each queried
 * stack plus the stacks it `accepts` (directional, not transitive), `isDirect` tells an implementation of a
 * queried stack from one kept only through `accepts`, and `canonical` names stacks by their id.
 */
function createStackFilter(stacks, vocabulary) {
  if (!vocabulary) {
    const wanted = stackSet(stacks);
    return {
      vocabulary: null,
      keeps: (implementation) => inStacks(implementation, wanted),
      isDirect: () => true,
      canonical: (stack) => stack,
    };
  }
  if (!Array.isArray(stacks) || stacks.length === 0) {
    return { vocabulary, keeps: () => true, isDirect: () => true, canonical: vocabulary.normalize };
  }
  const direct = new Set(stacks.map((stack) => vocabulary.normalize(stack)));
  const expanded = new Set([...direct].flatMap((stack) => [...vocabulary.expand(stack)]));
  return {
    vocabulary,
    keeps: (implementation) => expanded.has(vocabulary.normalize(implementation.stack)),
    isDirect: (implementation) => direct.has(vocabulary.normalize(implementation.stack)),
    canonical: vocabulary.normalize,
  };
}

function filterImplementations(capability, stacks, vocabulary) {
  const filter = createStackFilter(stacks, vocabulary);
  return capability.implementations.filter((implementation) => filter.keeps(implementation));
}

function matchHints(capability) {
  const hints = capability.match || {};
  return { symbols: hints.symbols || [], pathGlobs: hints.path_globs || [], packages: hints.packages || [] };
}

function packagesOf(capability) {
  const packages = new Set(matchHints(capability).packages);
  for (const implementation of capability.implementations) packages.add(implementation.package);
  return [...packages];
}

/**
 * Canonical form for name-like comparisons: lower case, and any run of
 * whitespace, `_` or `-` collapses to a single `-`, so `mobile tokens`,
 * `Mobile_Tokens` and `mobile-tokens` compare equal. Only separators are
 * touched: `.` and `/` stay, and glob matching (`globMatches`) never sees it;
 * path globs only take part in the substring fallback, see `containsQuery`.
 */
function canonical(value) {
  return String(value)
    .toLowerCase()
    .replaceAll(/[\s_-]+/g, '-');
}

function bestMatch(capability, query, queryLower) {
  const { symbols, pathGlobs } = matchHints(capability);
  const equal = (value) => canonical(value) === queryLower;
  const starts = (value) => startsAtTokenBoundary(canonical(value), queryLower);
  if (equal(capability.name)) return 'name';
  if (capability.aliases.some((alias) => !alias.includes('/') && equal(alias))) return 'alias';
  if (capability.aliases.some((alias) => alias.includes('/') && equal(alias))) return 'contract';
  if (packagesOf(capability).some(equal)) return 'package';
  if (symbols.some(equal)) return 'symbol';
  const queryPath = normalizeProjectPath(query);
  if (queryPath && pathGlobs.some((glob) => globMatches(glob, queryPath))) return 'path';
  if (
    alnumCount(query) >= MIN_FUZZY_ALNUM &&
    [capability.name, ...capability.aliases, ...symbols, ...packagesOf(capability)].some(starts)
  ) {
    return 'prefix';
  }
  return null;
}

const MIN_FUZZY_ALNUM = 3;
const TOKEN_SEPARATOR = /[./_\s-]/;

function alnumCount(text) {
  return (String(text).match(/[A-Za-z0-9]/g) || []).length;
}

/**
 * Prefix rule: the (canonical) query must open the value. When it stops inside a
 * token of the value, its last token must carry at least MIN_FUZZY_ALNUM
 * alphanumerics, so `mobile tok` finds `mobile-tokens` and `mo` does not.
 */
function startsAtTokenBoundary(value, queryCanonical) {
  if (!value.startsWith(queryCanonical)) return false;
  const next = value.charAt(queryCanonical.length);
  if (next === '' || TOKEN_SEPARATOR.test(next)) return true;
  // A query that ends on a separator ('sso-') already stops at a token boundary.
  if (TOKEN_SEPARATOR.test(queryCanonical.at(-1))) return true;
  return alnumCount(queryCanonical.split(TOKEN_SEPARATOR).pop()) >= MIN_FUZZY_ALNUM;
}

/**
 * True when `needle` occurs in `value` starting at a token start: the beginning
 * of the value, right after a separator, or at a camelCase hump (`Store` in
 * `ICacheStore`). `value` keeps its case so the hump can be seen; `needle` is
 * lower case and compared case-insensitively.
 */
function occursAtTokenStart(value, needle) {
  const lower = value.toLowerCase();
  // Same end rule as the prefix: a hit that stops inside a token of the value needs a
  // last query token with MIN_FUZZY_ALNUM alphanumerics (`mobile-t`, `ui.l` find nothing).
  const shortTail = !TOKEN_SEPARATOR.test(needle.at(-1)) && alnumCount(needle.split(TOKEN_SEPARATOR).pop()) < MIN_FUZZY_ALNUM;
  const endsAtBoundary = (index) => {
    const next = lower.charAt(index + needle.length);
    return !shortTail || next === '' || TOKEN_SEPARATOR.test(next);
  };
  if (lower.length !== value.length) return lower.includes(needle) && endsAtBoundary(lower.indexOf(needle));
  for (let index = lower.indexOf(needle); index !== -1; index = lower.indexOf(needle, index + 1)) {
    if (!endsAtBoundary(index)) continue;
    if (index === 0) return true;
    const before = value.charAt(index - 1);
    const here = value.charAt(index);
    if (TOKEN_SEPARATOR.test(before)) return true;
    if (/[a-z0-9]/.test(before) && /[A-Z]/.test(here)) return true;
  }
  return false;
}

/**
 * Separator-insensitive substring matching can bridge a separator (`d c` finds
 * `cache.typed-client`), which is noise for short queries. It is therefore limited
 * to queries whose every token has at least two alphanumerics and that carry at
 * least four alphanumerics in total; any other query keeps the literal match.
 */
function allowsSeparatorFallback(query) {
  const tokens = query.split(/[\s_-]+/).filter(Boolean);
  const alnum = (token) => (token.match(/[A-Za-z0-9]/g) || []).length;
  return tokens.length > 1 && tokens.every((token) => alnum(token) >= 2) && tokens.reduce((sum, t) => sum + alnum(t), 0) >= 4;
}

function containsQuery(capability, query, queryCanonical) {
  const { symbols, pathGlobs } = matchHints(capability);
  const haystack = [capability.name, ...capability.aliases, ...symbols, ...pathGlobs, ...packagesOf(capability)];
  const literal = query.toLowerCase();
  const bridge = allowsSeparatorFallback(query);
  const bridged = (value) => occursAtTokenStart(String(value).replaceAll(/[\s_-]+/g, '-'), queryCanonical);
  return haystack.some((value) => occursAtTokenStart(value, literal) || (bridge && bridged(value)));
}

/**
 * Resolves a query to capabilities. Order of precedence (ADR-0046 §7): exact
 * name, alias, package or contract identifier, match hints (symbol, path glob),
 * prefix. Exact matches work for any query length. `prefix` and `heuristic` are
 * assertive: they need at least three alphanumerics in the query; a prefix must
 * end on a token boundary of the value (or its last query token must have three
 * alphanumerics, so `mobile tok` finds `mobile-tokens` but `mo` does not); the
 * heuristic (substring) only matches at the start of a token of the value (start,
 * after `. / _ - space`, or a camelCase hump), never in the middle of a word.
 * Substring matching runs only when nothing else matched and is labelled
 * `heuristic`. Comparison is case-insensitive and treats space, `-` and `_` as
 * the same separator (in the heuristic only for queries of at least two tokens
 * and four alphanumerics); ties break by capability name.
 */
function resolveCapability(registry, query, { stacks, vocabulary } = {}) {
  if (typeof query !== 'string') return [];
  query = query.trim();
  if (query.length === 0) return [];
  const queryLower = canonical(query);
  const toResult = (capability, matchedBy) => ({
    capability,
    matchedBy,
    score: SCORES[matchedBy],
    implementations: filterImplementations(capability, stacks, vocabulary),
  });
  const ordered = (results) =>
    results.sort(
      (a, b) => b.score - a.score || (a.capability.name < b.capability.name ? -1 : a.capability.name > b.capability.name ? 1 : 0),
    );
  const matches = [];
  for (const capability of registry.capabilities) {
    const matchedBy = bestMatch(capability, query, queryLower);
    if (matchedBy) matches.push(toResult(capability, matchedBy));
  }
  if (matches.length > 0) return ordered(matches);
  // Substring matching is noisy: require at least three alphanumerics in the query.
  if (alnumCount(query) < MIN_FUZZY_ALNUM) return [];
  const heuristic = registry.capabilities
    .filter((capability) => containsQuery(capability, query, queryLower))
    .map((capability) => toResult(capability, 'heuristic'));
  if (heuristic.length > 0) return ordered(heuristic);
  return matchTokens(registry, query).map(({ capability, hits }) => ({ ...toResult(capability, 'tokens'), tokenHits: hits }));
}

/**
 * Multi-word fallback, used only when the whole query matched nothing: each word of at least three
 * alphanumerics is resolved on its own, and a capability qualifies when it matches all of them or, with
 * three or more words, a strict majority. Deterministic: more matched words first, then the stronger
 * single-word matches, then the capability name. Words are split on whitespace only, so an identifier
 * (`snake_case`, `kebab-case`) is never broken apart.
 */
const STOPWORDS = new Set(
  (
    'add new create get set make the and for with from into that this then use using need want how can ' +
    'um uma uns umas novo nova novos novas criar adicionar obter ler para com sem por uma que dos das nos nas ' +
    'del los las une des'
  ).split(' '),
);

/** Lower-case words of a registry value, split on separators and camelCase humps. */
function wordsOf(value) {
  return String(value)
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 2);
}

/** Whole-word match, or a shared stem: the shorter word has at least four letters and opens the longer one. */
function sameWord(word, candidate) {
  if (word === candidate) return 2;
  const [short, long] = word.length <= candidate.length ? [word, candidate] : [candidate, word];
  return short.length >= 4 && long.startsWith(short) && long.length - short.length <= 3 ? 1 : 0;
}

function matchTokens(registry, query) {
  const words = [
    ...new Set(
      query
        .split(/\s+/)
        .map((word) => word.toLowerCase())
        .filter((word) => alnumCount(word) >= MIN_FUZZY_ALNUM && !STOPWORDS.has(word)),
    ),
  ];
  if (words.length < 2) return [];
  const results = [];
  for (const capability of registry.capabilities) {
    const { symbols, pathGlobs } = matchHints(capability);
    const vocabulary = new Set(
      [capability.name, ...capability.aliases, ...symbols, ...pathGlobs, ...packagesOf(capability)].flatMap(wordsOf),
    );
    let hits = 0;
    let strength = 0;
    for (const word of words) {
      const best = Math.max(0, ...[...vocabulary].map((candidate) => sameWord(word, candidate)));
      if (best > 0) {
        hits += 1;
        strength += best;
      }
    }
    if (hits >= (words.length === 2 ? 2 : Math.floor(words.length / 2) + 1)) results.push({ capability, hits, strength });
  }
  return results.sort(
    (a, b) =>
      b.hits - a.hits ||
      b.strength - a.strength ||
      (a.capability.name < b.capability.name ? -1 : a.capability.name > b.capability.name ? 1 : 0),
  );
}

/**
 * Normalizes a project-relative path: backslashes become `/`, `.`/`..`/empty
 * segments are resolved, a leading `./` is dropped. Returns null when the result
 * is absolute or escapes the project, so such a path never matches a glob.
 */
function normalizeProjectPath(value) {
  const normalized = path.posix.normalize(String(value).replaceAll('\\', '/'));
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

const MAX_GLOB_LENGTH = 512;
const MAX_GLOB_SEGMENTS = 64;
const globCache = new Map();

/** Splits a glob into segments; returns null when it exceeds the safety caps. Consecutive `**` collapse. */
function parseGlob(glob) {
  if (globCache.has(glob)) return globCache.get(glob);
  let segments = null;
  if (typeof glob === 'string' && glob.length > 0 && glob.length <= MAX_GLOB_LENGTH) {
    const raw = glob.replaceAll('\\', '/').split('/');
    if (raw.length <= MAX_GLOB_SEGMENTS) {
      segments = [];
      for (const segment of raw) {
        const globstar = /^\*{2,}$/.test(segment);
        if (globstar && segments.at(-1) === '**') continue;
        segments.push(globstar ? '**' : segment.replaceAll(/\*+/g, '*'));
      }
    }
  }
  globCache.set(glob, segments);
  return segments;
}

/** One path segment against one glob segment: `*` any run of characters, `?` one character, linear time. */
function segmentMatches(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      resume = t;
    } else if (star === -1) {
      return false;
    } else {
      p = star + 1;
      t = ++resume;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/**
 * Small glob for `match.path_globs`, matched against a normalized project-relative
 * path, case-insensitively. A segment that is exactly `**` matches zero or more
 * directories; inside a segment `*` matches any run of characters and `?` one
 * character (neither crosses `/`). Everything else is literal. Matching is
 * dynamic programming over segments, so cost is bounded for any glob within the
 * length and segment caps (512 characters, 64 segments); a longer glob never matches.
 */
function globMatches(glob, normalizedPath) {
  const pattern = parseGlob(glob);
  if (!pattern) return false;
  const parts = normalizedPath.toLowerCase().split('/');
  const lowered = pattern.map((segment) => segment.toLowerCase());
  // reachable[i] = first i path segments consumed by the glob segments handled so far
  let reachable = Array.from({ length: parts.length + 1 }).fill(false);
  reachable[0] = true;
  for (const segment of lowered) {
    const next = Array.from({ length: parts.length + 1 }).fill(false);
    if (segment === '**') {
      let open = false;
      for (let i = 0; i <= parts.length; i++) {
        open = open || reachable[i];
        next[i] = open;
      }
    } else {
      for (let i = 0; i < parts.length; i++) if (reachable[i] && segmentMatches(segment, parts[i])) next[i + 1] = true;
    }
    reachable = next;
  }
  return reachable[parts.length];
}

/** Strips generic arguments and namespace qualifiers: `Foo.ICacheStore<T>` -> `ICacheStore`. */
function normalizeSymbol(value) {
  let text = String(value).trim();
  let previous;
  do {
    previous = text;
    text = text.replaceAll(/<[^<>]*>/g, '');
  } while (text !== previous);
  return text.split(/::|\./).at(-1).trim();
}

function byName(a, b) {
  return a.capability.name < b.capability.name ? -1 : a.capability.name > b.capability.name ? 1 : 0;
}

/**
 * Finds capabilities an exported symbol or file path belongs to (hybrid guard).
 * `filePath` must be project-relative; absolute paths and paths escaping the
 * project never match a glob (symbols still apply). Symbols are normalized (generic
 * arguments and qualifiers stripped) and then compared exactly, case-sensitively.
 * `stacks` follows the shared rule: undefined or empty = any stack. Returns
 * `{ matches, warnings }`; `warnings` lists path globs ignored for exceeding the safety caps.
 */
function matchExport(registry, { symbol, filePath, stacks, vocabulary } = {}) {
  const filter = createStackFilter(stacks, vocabulary);
  const relative = isNonEmptyString(filePath) ? normalizeProjectPath(filePath) : null;
  const wantedSymbol = isNonEmptyString(symbol) ? normalizeSymbol(symbol) : null;
  const results = [];
  const warnings = [];
  for (const capability of registry.capabilities) {
    const { symbols, pathGlobs } = matchHints(capability);
    for (const glob of pathGlobs) {
      if (!parseGlob(glob))
        warnings.push(`${capability.name}: path glob ignored (exceeds ${MAX_GLOB_LENGTH} characters or ${MAX_GLOB_SEGMENTS} segments)`);
    }
    let matchedBy = null;
    if (wantedSymbol && symbols.some((candidate) => normalizeSymbol(candidate) === wantedSymbol)) matchedBy = 'symbol';
    else if (relative && pathGlobs.some((glob) => globMatches(glob, relative))) matchedBy = 'path';
    if (!matchedBy) continue;
    const stableForStack = capability.implementations.some(
      (implementation) => implementation.status === 'stable' && filter.keeps(implementation),
    );
    results.push({ capability, matchedBy, stableForStack, implementations: filterImplementations(capability, stacks, vocabulary) });
  }
  results.sort(byName);
  return { matches: results, warnings: [...new Set(warnings)].sort() };
}

module.exports = {
  IDENTITY_VOCABULARY,
  createVocabulary,
  deriveCoverage,
  missingTargets,
  normalizeToken,
  normalizedTargets,
  satisfaction,
  vocabularyProblems,
  MAX_REGISTRY_BYTES,
  RegistryIntegrityError,
  SNAPSHOT_FILE,
  SNAPSHOT_LOCK_FILE,
  STACKS_LOCK_FILE,
  STACKS_SNAPSHOT_FILE,
  createStackFilter,
  loadCapabilityRegistry,
  matchExport,
  readSnapshotLock,
  resolveCapability,
  validateCapabilityRegistry,
};
