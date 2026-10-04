const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_FILE = path.join('.enterprise', 'governance', 'capabilities', 'ecp-registry.snapshot.json');
const SNAPSHOT_LOCK_FILE = path.join('.enterprise', 'governance', 'capabilities', 'ecp-registry.snapshot.lock.json');
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
]);
const IMPLEMENTATION_REQUIRED = ['stack', 'kind', 'package', 'contract_version', 'status'];
const IMPLEMENTATION_KINDS = new Set(['runtime', 'sdk', 'library']);
const IMPLEMENTATION_STATUSES = new Set(['planned', 'experimental', 'stable', 'deprecated']);
const CONFORMANCE_KEYS = new Set(['vectors_version', 'evidence']);
const LOCK_KEYS = new Set(['schema_version', 'repository', 'ref', 'contracts_version', 'sha256']);

const SCORES = { name: 100, alias: 90, contract: 80, package: 80, symbol: 60, path: 60, prefix: 40, heuristic: 10 };

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

function readSnapshotLock(runtimeRoot) {
  const lockFile = path.join(runtimeRoot, SNAPSHOT_LOCK_FILE);
  let lock;
  try {
    lock = JSON.parse(readBoundedFile(lockFile, 'registry snapshot lock', { rejectSymlink: true }).toString('utf8'));
  } catch (error) {
    throw new RegistryIntegrityError(`Registry snapshot lock is unreadable (${lockFile}): ${error.message}`);
  }
  if (!isPlainObject(lock) || Object.keys(lock).some((key) => !LOCK_KEYS.has(key)) || lock.schema_version !== '1.0.0') {
    throw new RegistryIntegrityError('Registry snapshot lock has an unexpected shape');
  }
  if (
    !(typeof lock.sha256 === 'string' && SHA256.test(lock.sha256)) ||
    !isNonEmptyString(lock.ref) ||
    !isNonEmptyString(lock.repository) ||
    !SEMVER.test(String(lock.contracts_version))
  ) {
    throw new RegistryIntegrityError('Registry snapshot lock is missing sha256, ref, repository or contracts_version');
  }
  return lock;
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
    return { registry, source: 'path', ref: registry.generated_from.ref || null, sha256 };
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
  return { registry, source: 'snapshot', ref: lock.ref, sha256 };
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

function filterImplementations(capability, stacks) {
  const wanted = stackSet(stacks);
  return capability.implementations.filter((implementation) => inStacks(implementation, wanted));
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
 * `Mobile_Tokens` and `mobile-tokens` compare equal. Never applied to path globs.
 */
function canonical(value) {
  return String(value)
    .toLowerCase()
    .replaceAll(/[\s_-]+/g, '-');
}

function bestMatch(capability, query, queryLower) {
  const { symbols, pathGlobs } = matchHints(capability);
  const equal = (value) => canonical(value) === queryLower;
  const starts = (value) => canonical(value).startsWith(queryLower);
  if (equal(capability.name)) return 'name';
  if (capability.aliases.some((alias) => !alias.includes('/') && equal(alias))) return 'alias';
  if (capability.aliases.some((alias) => alias.includes('/') && equal(alias))) return 'contract';
  if (packagesOf(capability).some(equal)) return 'package';
  if (symbols.some(equal)) return 'symbol';
  const queryPath = normalizeProjectPath(query);
  if (queryPath && pathGlobs.some((glob) => globMatches(glob, queryPath))) return 'path';
  if ([capability.name, ...capability.aliases, ...symbols, ...packagesOf(capability)].some(starts)) return 'prefix';
  return null;
}

function containsQuery(capability, queryLower) {
  const { symbols, pathGlobs } = matchHints(capability);
  const haystack = [capability.name, ...capability.aliases, ...symbols, ...pathGlobs, ...packagesOf(capability)];
  return haystack.some((value) => canonical(value).includes(queryLower));
}

/**
 * Resolves a query to capabilities. Order of precedence (ADR-0046 §7): exact
 * name, alias, package or contract identifier, match hints (symbol, path glob),
 * prefix. Substring matching runs only when nothing else matched and is labelled
 * `heuristic`. Comparison is case-insensitive and treats space, `-` and `_` as
 * the same separator; ties break by capability name.
 */
function resolveCapability(registry, query, { stacks } = {}) {
  if (typeof query !== 'string') return [];
  query = query.trim();
  if (query.length === 0) return [];
  const queryLower = canonical(query);
  const toResult = (capability, matchedBy) => ({
    capability,
    matchedBy,
    score: SCORES[matchedBy],
    implementations: filterImplementations(capability, stacks),
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
  // Substring matching is noisy: require at least two characters, one of them alphanumeric.
  if (query.length < 2 || !/[A-Za-z0-9]/.test(query)) return [];
  return ordered(
    registry.capabilities
      .filter((capability) => containsQuery(capability, queryLower))
      .map((capability) => toResult(capability, 'heuristic')),
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
function matchExport(registry, { symbol, filePath, stacks } = {}) {
  const wanted = stackSet(stacks);
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
      (implementation) => implementation.status === 'stable' && inStacks(implementation, wanted),
    );
    results.push({ capability, matchedBy, stableForStack, implementations: filterImplementations(capability, stacks) });
  }
  results.sort(byName);
  return { matches: results, warnings: [...new Set(warnings)].sort() };
}

module.exports = {
  MAX_REGISTRY_BYTES,
  RegistryIntegrityError,
  SNAPSHOT_FILE,
  SNAPSHOT_LOCK_FILE,
  loadCapabilityRegistry,
  matchExport,
  resolveCapability,
  validateCapabilityRegistry,
};
