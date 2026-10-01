const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('yaml');
const { readYaml, assertObject, assertExactKeys, assertStringList } = require('./capability-catalog');

const PLATFORM_MODES = ['platform', 'hybrid', 'local'];
const SCHEMA_VERSION = '1.0.0';
const LAYERS = new Set(['runtime', 'user', 'project', 'flags']);
const RUNTIME_DEFAULTS_FILE = path.join('.enterprise', 'governance', 'capabilities', 'platform-bindings.defaults.yaml');
const PROJECT_BINDINGS_FILE = path.join('.hseos', 'config', 'platform-bindings.yaml');
const USER_BINDINGS_FILE = path.join('hseos', 'platform-bindings.yaml');
const ECP_REGISTRY_RELATIVE = path.join('catalog', 'capability-registry.json');

const DOCUMENT_KEYS = new Set(['schema_version', 'mode', 'mode_ref', 'registry', 'workspace', 'stacks', 'overrides']);
const REGISTRY_KEYS = new Set(['source', 'path', 'uri', 'ref', 'sha256']);
const REGISTRY_SOURCES = new Set(['snapshot', 'path', 'remote']);
const WORKSPACE_KEYS = new Set(['ecp_root', 'cores_root']);
const OVERRIDE_KEYS = new Set(['capability', 'outcome', 'intake_ref', 'exception_ref', 'reason', 'expires']);
const OVERRIDE_REF_BY_OUTCOME = { 'keep-local': 'intake_ref', exception: 'exception_ref' };
// A prefix, a hyphen and at least one digit (INTAKE-2026-10-cache, EXC-0007).
const REFERENCE_ID = /^[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9._-]*[0-9][A-Za-z0-9._-]*$/;
const REFERENCE_ID_MIN_LENGTH = 5;
const DECISION_RECORD_ROOTS = ['docs/decisions/', '.enterprise/.specs/decisions/'];
const MAX_BINDINGS_FILE_BYTES = 256 * 1024;
const DEFAULT_FLAG_REASON = 'declared at installation';
const PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const CAPABILITY_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;
const STACK_ID = /^[a-z][a-z0-9-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DATE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

const STACK_ROOTS = ['src', 'apps', 'services'];
const MAX_SCAN_ENTRIES = 500;

function modeStrength(mode) {
  const index = PLATFORM_MODES.indexOf(mode);
  return index === -1 ? 0 : PLATFORM_MODES.length - index;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRealDate(value) {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

function repositoryRelativeProblem(value) {
  if (!isNonEmptyString(value)) return 'must be a non-empty string';
  if (path.isAbsolute(value) || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return 'must not be an absolute path';
  if (value.includes('\\')) return 'must not contain backslashes';
  const segments = value.split('/');
  if (segments.includes('..')) return "must not contain a '..' segment";
  if (segments.some((segment) => segment === '.' || !PATH_SEGMENT.test(segment))) return 'must be a clean repository-relative path';
  return null;
}

/** Shape rule for `mode_ref`: a Markdown decision record under the decision directories. */
function modeRefProblem(value) {
  const problem = repositoryRelativeProblem(value);
  if (problem) return problem;
  if (!value.endsWith('.md') || !DECISION_RECORD_ROOTS.some((root) => value.startsWith(root))) {
    return `must be a .md file under ${DECISION_RECORD_ROOTS.join(' or ')}`;
  }
  return null;
}

/**
 * Validates one configuration layer. Throws `Invalid platform bindings (<layer>): ...`
 * listing every problem found; returns the document unchanged when valid.
 */
function validateBindingsDocument(doc, { layer, now = new Date(), projectDir } = {}) {
  if (!LAYERS.has(layer)) throw new Error(`Invalid platform bindings: unknown layer '${layer}'`);
  const errors = [];
  const check = (fn) => {
    try {
      fn();
    } catch (error) {
      errors.push(error.message.replace(/^Invalid capability schema v2: /, ''));
    }
  };
  const fail = (message) => errors.push(message);

  check(() => assertObject(doc, 'document'));
  if (errors.length === 0) {
    check(() => assertExactKeys(doc, DOCUMENT_KEYS, 'document'));
    validateTopLevel(doc, { layer, projectDir }, fail);
    if (doc.registry !== undefined) validateRegistry(doc.registry, layer, check, fail);
    if (doc.workspace !== undefined) validateWorkspace(doc.workspace, layer, check, fail);
    if (doc.stacks !== undefined) validateStacks(doc.stacks, check, fail);
    if (doc.overrides !== undefined) validateOverrides(doc.overrides, { today: utcDate(now), projectDir }, check, fail);
  }
  if (errors.length > 0) throw new Error(`Invalid platform bindings (${layer}): ${errors.join('; ')}`);
  return doc;
}

function validateTopLevel(doc, { layer, projectDir }, fail) {
  if (doc.schema_version !== SCHEMA_VERSION) fail(`schema_version must be '${SCHEMA_VERSION}'`);
  if (doc.mode !== undefined && !PLATFORM_MODES.includes(doc.mode)) fail(`mode must be one of ${PLATFORM_MODES.join(', ')}`);
  if (layer === 'project' && doc.mode === undefined) fail('the project file must declare mode');
  if (layer === 'runtime' && doc.mode !== undefined) fail('runtime defaults must not set mode');
  if (doc.mode === 'local' && doc.mode_ref === undefined) fail("mode 'local' requires mode_ref");
  if (doc.mode_ref !== undefined) {
    const problem = modeRefProblem(doc.mode_ref);
    if (problem) fail(`mode_ref ${problem}`);
    else if (projectDir && !repositoryRefExists(projectDir, doc.mode_ref))
      fail(`mode_ref '${doc.mode_ref}' does not exist in the repository`);
  }
}

function validateRegistry(registry, layer, check, fail) {
  check(() => assertObject(registry, 'registry'));
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return;
  check(() => assertExactKeys(registry, REGISTRY_KEYS, 'registry'));
  if (!REGISTRY_SOURCES.has(registry.source)) {
    fail(`registry.source must be one of ${[...REGISTRY_SOURCES].join(', ')}`);
    return;
  }
  if (layer === 'project' && registry.path !== undefined) {
    const problem = repositoryRelativeProblem(registry.path);
    if (problem) fail(`registry.path ${problem} in the project file`);
  }
  for (const key of ['path', 'uri', 'ref']) {
    if (registry[key] !== undefined && !isNonEmptyString(registry[key])) fail(`registry.${key} must be a non-empty string`);
  }
  if (registry.sha256 !== undefined && !(typeof registry.sha256 === 'string' && SHA256.test(registry.sha256))) {
    fail('registry.sha256 must be 64 lowercase hex characters');
  }
  if (registry.source === 'snapshot') {
    for (const key of ['path', 'uri', 'ref']) if (registry[key] !== undefined) fail(`registry.${key} is not allowed for source 'snapshot'`);
  } else if (registry.source === 'path') {
    if (registry.path === undefined) fail("registry.path is required for source 'path'");
    for (const key of ['uri', 'ref']) if (registry[key] !== undefined) fail(`registry.${key} is not allowed for source 'path'`);
  } else {
    for (const key of ['uri', 'ref', 'sha256']) if (registry[key] === undefined) fail(`registry.${key} is required for source 'remote'`);
  }
}

function validateWorkspace(workspace, layer, check, fail) {
  check(() => assertObject(workspace, 'workspace'));
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return;
  if (layer !== 'user') fail('workspace is accepted only in the user/organization layer');
  check(() => assertExactKeys(workspace, WORKSPACE_KEYS, 'workspace'));
  for (const key of WORKSPACE_KEYS) {
    if (workspace[key] !== undefined && !isNonEmptyString(workspace[key])) fail(`workspace.${key} must be a non-empty string`);
  }
}

function validateStacks(stacks, check, fail) {
  check(() => assertStringList(stacks, 'stacks'));
  if (Array.isArray(stacks)) {
    for (const stack of stacks)
      if (typeof stack === 'string' && !STACK_ID.test(stack)) fail(`stacks entry '${stack}' is not a valid stack id`);
  }
}

function validateOverrides(overrides, { today, projectDir }, check, fail) {
  if (!Array.isArray(overrides)) {
    fail('overrides must be a list');
    return;
  }
  const seen = new Set();
  for (const [index, override] of overrides.entries()) {
    const label = `overrides[${index}]`;
    check(() => assertObject(override, label));
    if (!override || typeof override !== 'object' || Array.isArray(override)) continue;
    check(() => assertExactKeys(override, OVERRIDE_KEYS, label));
    if (!(typeof override.capability === 'string' && CAPABILITY_ID.test(override.capability))) {
      fail(`${label}.capability must be a dotted capability id`);
    } else if (seen.has(override.capability)) {
      fail(`${label}.capability '${override.capability}' is declared more than once`);
    } else {
      seen.add(override.capability);
    }
    const refKey = OVERRIDE_REF_BY_OUTCOME[override.outcome];
    if (refKey) {
      for (const key of Object.values(OVERRIDE_REF_BY_OUTCOME)) {
        if (key !== refKey && override[key] !== undefined) fail(`${label}.${key} is not allowed for outcome '${override.outcome}'`);
      }
      if (override[refKey] === undefined) fail(`${label}.${refKey} is required for outcome '${override.outcome}'`);
      else {
        const value = override[refKey];
        if (typeof value !== 'string' || value.length < REFERENCE_ID_MIN_LENGTH || !REFERENCE_ID.test(value))
          fail(`${label}.${refKey} must be an identifier like INTAKE-2026-10-cache or EXC-0007 (prefix, hyphen, at least one digit)`);
        else if (projectDir && !overrideRefResolves(projectDir, refKey, value)) {
          fail(`${label}.${refKey} '${value}' is not recorded in the repository (${REF_LOCATIONS[refKey]})`);
        }
      }
    } else {
      fail(`${label}.outcome must be one of ${Object.keys(OVERRIDE_REF_BY_OUTCOME).join(', ')}`);
    }
    if (!isNonEmptyString(override.reason)) fail(`${label}.reason must be a non-empty string`);
    if (typeof override.expires !== 'string' || !isRealDate(override.expires))
      fail(`${label}.expires must be a real calendar date (YYYY-MM-DD)`);
    else if (override.expires < today) fail(`${label}.expires (${override.expires}) has passed`);
  }
}

const REF_LOCATIONS = {
  intake_ref: 'docs/decisions/*intake*.md',
  exception_ref: '.enterprise/exceptions/<id>.md, .enterprise/exceptions/<id>-*.md or docs/decisions/*exception*.md',
};

/** Real path of `<root>/<relative>` when it exists and stays inside the real project root; otherwise null. */
function realDirectoryInside(root, relative) {
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(path.join(root, relative));
    return real === path.join(realRoot, relative) ? real : null;
  } catch {
    return null;
  }
}

function isRegularFileInside(file, directory) {
  try {
    return path.dirname(fs.realpathSync(file)) === fs.realpathSync(directory);
  } catch {
    return false;
  }
}

function walkMarkdown(directory, nameFilter, depth = 0, found = []) {
  if (!directory || depth > 8 || found.length >= MAX_SCAN_ENTRIES) return found;
  for (const entry of listDirectory(directory)) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, nameFilter, depth + 1, found);
    else if (entry.isFile() && nameFilter(entry.name.toLowerCase()) && isRegularFileInside(full, directory)) found.push(full);
  }
  return found;
}

function fileMentionsToken(file, id) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const escaped = id.replaceAll('.', String.raw`\.`);
  // A trailing sentence period still ends the token; '.x' or '-x' continues it.
  return new RegExp(String.raw`(?<![A-Za-z0-9._-])${escaped}(?![A-Za-z0-9_-]|\.[A-Za-z0-9_-])`).test(text);
}

/**
 * Resolves an override reference like the capability intake guard resolves
 * CORE_INTAKE_ACK (recursive docs/decisions/*intake*.md), but matches the id as a
 * whole token instead of a substring, and only in intake documents. Exceptions
 * resolve through .enterprise/exceptions/<id>.md or <id>-*.md, or by token in
 * docs/decisions/**\/*exception*.md.
 */
function overrideRefResolves(projectDir, refKey, id) {
  const root = path.resolve(projectDir);
  const decisions = realDirectoryInside(root, path.join('docs', 'decisions'));
  const keyword = refKey === 'intake_ref' ? 'intake' : 'exception';
  const documents = walkMarkdown(decisions, (name) => name.endsWith('.md') && name.includes(keyword));
  if (documents.some((file) => fileMentionsToken(file, id))) return true;
  if (refKey !== 'exception_ref') return false;
  const exceptionsDir = realDirectoryInside(root, path.join('.enterprise', 'exceptions'));
  if (!exceptionsDir) return false;
  return listDirectory(exceptionsDir).some(
    (entry) =>
      entry.isFile() &&
      isRegularFileInside(path.join(exceptionsDir, entry.name), exceptionsDir) &&
      (entry.name === `${id}.md` || (entry.name.startsWith(`${id}-`) && entry.name.endsWith('.md'))),
  );
}

function resolveInside(projectDir, relative) {
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

/** True when a mode_ref names an existing regular file that stays inside projectDir. */
function repositoryRefExists(projectDir, relative) {
  if (modeRefProblem(relative)) return false;
  const resolved = resolveInside(projectDir, relative);
  if (!resolved) return false;
  try {
    const real = fs.realpathSync(resolved);
    const realRoot = fs.realpathSync(path.resolve(projectDir));
    if (!real.startsWith(`${realRoot}${path.sep}`) || !fs.statSync(real).isFile()) return false;
    // A symlink must still land on a decision record: re-apply the shape rule to the resolved location.
    return modeRefProblem(path.relative(realRoot, real).split(path.sep).join('/')) === null;
  } catch {
    return false;
  }
}

function readLayerFile(file, layer, now, projectDir, warnings) {
  const { size } = fs.statSync(file);
  if (size > MAX_BINDINGS_FILE_BYTES)
    throw new Error(`platform bindings file is too large (${size} bytes; limit ${MAX_BINDINGS_FILE_BYTES})`);
  let doc = readYaml(file, {});
  if ((layer === 'runtime' || layer === 'user') && doc && typeof doc === 'object' && !Array.isArray(doc) && doc.overrides !== undefined) {
    const { overrides, ...rest } = doc;
    if (!Array.isArray(overrides) || overrides.length > 0) {
      warnings.push(`${layer} layer overrides ignored: overrides are honored only from the project file and flags`);
    }
    doc = rest;
  }
  return validateBindingsDocument(doc, { layer, now, projectDir });
}

function userBindingsFile(env) {
  if (isNonEmptyString(env.HSEOS_PLATFORM_BINDINGS)) return { file: env.HSEOS_PLATFORM_BINDINGS, explicit: true };
  const configHome = isNonEmptyString(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(env.HOME || os.homedir(), '.config');
  return { file: path.join(configHome, USER_BINDINGS_FILE), explicit: false };
}

/** Parses `<capability>=<outcome>:<ref>:<YYYY-MM-DD>` into a flag binding. */
function parsePlatformBindingFlag(value) {
  const match = typeof value === 'string' ? /^([^=:\s]+)=([^=:\s]+):([^=:\s]+):([^=:\s]+)$/.exec(value) : null;
  if (!match) throw new Error(`Invalid --platform-binding '${value}': expected <capability>=<outcome>:<ref>:<YYYY-MM-DD>`);
  const [, capability, outcome, ref, expires] = match;
  return { capability, outcome, ref, expires, reason: DEFAULT_FLAG_REASON };
}

function flagOverrideDocument(binding) {
  const refKey = OVERRIDE_REF_BY_OUTCOME[binding && binding.outcome];
  const override = { capability: binding && binding.capability, outcome: binding && binding.outcome };
  if (refKey) override[refKey] = binding.ref;
  override.reason = binding && binding.reason !== undefined ? binding.reason : DEFAULT_FLAG_REASON;
  if (binding && binding.expires !== undefined) override.expires = binding.expires;
  return { schema_version: SCHEMA_VERSION, overrides: [override] };
}

/**
 * Resolves the effective platform bindings for a project (ADR-0046 §3-§5).
 * Never throws for configuration problems: they are returned in `errors` and the
 * result stays at the stricter mode.
 */
function loadPlatformBindings(options = {}) {
  const { runtimeRoot, projectDir, env = process.env, now = new Date(), baseMode = 'platform' } = options;
  const flags = options.flags ?? {};
  if (!PLATFORM_MODES.includes(baseMode)) throw new Error(`Invalid baseMode '${baseMode}'`);
  if (!isNonEmptyString(projectDir)) throw new Error('loadPlatformBindings requires projectDir');
  const warnings = [];
  const errors = [];
  const guarded = (label, fn) => {
    try {
      return fn();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
      return null;
    }
  };

  const runtimeFile = runtimeRoot ? path.join(runtimeRoot, RUNTIME_DEFAULTS_FILE) : null;
  const runtime =
    runtimeFile && fs.existsSync(runtimeFile)
      ? guarded('runtime defaults', () => ({ doc: readLayerFile(runtimeFile, 'runtime', now, undefined, warnings), baseDir: runtimeRoot }))
      : null;
  const user = loadUserLayer(env, now, warnings, guarded);
  const projectFile = path.join(path.resolve(projectDir), PROJECT_BINDINGS_FILE);
  let project = null;
  let mode = 'platform';
  let source = 'default-no-file';
  let modeRef = null;
  if (fs.existsSync(projectFile)) {
    project = guarded('project file', () => readLayerFile(projectFile, 'project', now, projectDir, warnings));
    if (project) {
      mode = project.mode;
      source = 'project';
      modeRef = project.mode_ref || null;
    } else {
      source = 'invalid-file';
    }
  }

  const userDoc = user && user.doc;
  if (userDoc && userDoc.mode !== undefined) {
    if (modeStrength(userDoc.mode) > modeStrength(mode)) {
      mode = userDoc.mode;
      source = 'user';
      modeRef = null;
    } else if (modeStrength(userDoc.mode) < modeStrength(mode)) {
      warnings.push(`user layer mode '${userDoc.mode}' ignored: it cannot weaken '${mode}'`);
    }
  }

  const flagMode = applyFlagMode({ flags, mode, projectDir, errors, warnings });
  if (flagMode) ({ mode, source, modeRef } = { ...flagMode });

  if (modeStrength(mode) < modeStrength(baseMode) && !(modeRef && repositoryRefExists(projectDir, modeRef))) {
    errors.push(`mode '${mode}' is weaker than the recorded mode '${baseMode}' and requires an existing mode_ref`);
    mode = baseMode;
    source = 'downgrade-rejected';
    modeRef = null;
  }

  const overrides = collectOverrides({ project, flags, now, projectDir, errors });
  return {
    mode,
    source,
    modeRef,
    registry: resolveRegistry({ runtime, user, project, projectDir }),
    workspace: (userDoc && userDoc.workspace) || {},
    stacks: project && project.stacks !== undefined ? [...project.stacks] : detectStacks(projectDir),
    overrides,
    warnings,
    errors,
  };
}

function loadUserLayer(env, now, warnings, guarded) {
  const { file, explicit } = userBindingsFile(env);
  if (!fs.existsSync(file)) {
    if (explicit) warnings.push(`HSEOS_PLATFORM_BINDINGS names a file that does not exist: ${file}`);
    return null;
  }
  return guarded('user layer', () => ({
    doc: readLayerFile(file, 'user', now, undefined, warnings),
    baseDir: path.dirname(path.resolve(file)),
  }));
}

function applyFlagMode({ flags, mode, projectDir, errors, warnings }) {
  if (flags.mode === undefined || flags.mode === null) {
    if (flags.modeRef) warnings.push('--mode-ref ignored: no --platform-mode was given');
    return null;
  }
  if (!PLATFORM_MODES.includes(flags.mode)) {
    errors.push(`flag platform-mode '${flags.mode}' must be one of ${PLATFORM_MODES.join(', ')}`);
    return null;
  }
  if (modeStrength(flags.mode) === modeStrength(mode)) return null;
  if (modeStrength(flags.mode) > modeStrength(mode)) return { mode: flags.mode, source: 'flags', modeRef: null };
  if (flags.modeRef && repositoryRefExists(projectDir, flags.modeRef)) {
    return { mode: flags.mode, source: 'flags', modeRef: flags.modeRef };
  }
  errors.push(`flag platform-mode '${flags.mode}' would weaken '${mode}' and requires --mode-ref pointing at an existing file`);
  return null;
}

function collectOverrides({ project, flags, now, projectDir, errors }) {
  const merged = new Map();
  for (const override of (project && project.overrides) || []) merged.set(override.capability, { ...override, layer: 'project' });
  const bindings = flags.bindings ?? [];
  if (!Array.isArray(bindings)) {
    errors.push('flags.bindings must be a list');
  }
  for (const binding of Array.isArray(bindings) ? bindings : []) {
    try {
      const parsed = typeof binding === 'string' ? parsePlatformBindingFlag(binding) : binding;
      const doc = validateBindingsDocument(flagOverrideDocument(parsed), { layer: 'flags', now, projectDir });
      const [override] = doc.overrides;
      merged.set(override.capability, { ...override, layer: 'flags' });
    } catch (error) {
      errors.push(`flag platform-binding: ${error.message}`);
    }
  }
  return [...merged.values()].sort((a, b) => a.capability.localeCompare(b.capability));
}

function absoluteRegistry(registry, baseDir) {
  const resolved = { ...registry };
  if (resolved.source === 'path' && !path.isAbsolute(resolved.path)) resolved.path = path.resolve(baseDir, resolved.path);
  return resolved;
}

/** Relative registry paths resolve against the directory of the file that declares them. */
function resolveRegistry({ runtime, user, project, projectDir }) {
  if (project && project.registry) return absoluteRegistry(project.registry, projectDir);
  if (user && user.doc.registry) return absoluteRegistry(user.doc.registry, user.baseDir);
  if (runtime && runtime.doc.registry) return absoluteRegistry(runtime.doc.registry, runtime.baseDir);
  if (user && user.doc.workspace && user.doc.workspace.ecp_root) {
    return { source: 'path', path: path.join(user.doc.workspace.ecp_root, ECP_REGISTRY_RELATIVE) };
  }
  return { source: 'snapshot' };
}

function stackFor(name) {
  if (/\.(csproj|sln|slnx)$/.test(name)) return 'dotnet';
  if (name === 'package.json') return 'node';
  if (name === 'pyproject.toml' || name === 'setup.py') return 'python';
  if (name === 'go.mod') return 'go';
  if (name === 'pom.xml' || name.startsWith('build.gradle')) return 'java';
  return null;
}

function listDirectory(directory) {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, MAX_SCAN_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Detects stacks from deterministic markers in the project root and in the
 * immediate children of `src/`, `apps/` and `services/` (bounded and sorted).
 */
function detectStacks(projectDir) {
  const root = path.resolve(projectDir);
  const directories = [root];
  for (const name of STACK_ROOTS) {
    const base = path.join(root, name);
    const entries = listDirectory(base);
    if (entries.length === 0) continue;
    directories.push(base);
    for (const entry of entries) if (entry.isDirectory()) directories.push(path.join(base, entry.name));
  }
  const stacks = new Set();
  for (const directory of directories) {
    for (const entry of listDirectory(directory)) {
      const stack = entry.isFile() ? stackFor(entry.name) : null;
      if (stack) stacks.add(stack);
    }
  }
  return [...stacks].sort();
}

function runGit(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
  });
}

/**
 * The mode recorded in version control: the `mode` of `.hseos/config/platform-bindings.yaml` as committed
 * at `ref`. Used as `baseMode` so an uncommitted weakening is rejected while a committed mode is not a
 * downgrade. Returns `{ mode: 'platform', source: 'default' }` when `projectDir` is not a git work tree,
 * the ref does not exist yet, the file is absent at `ref`, or its mode is missing or invalid. Any other
 * git failure throws.
 */
function readRecordedMode(projectDir, ref = 'HEAD') {
  const fallback = { mode: 'platform', source: 'default' };
  const directory = path.resolve(projectDir);
  try {
    runGit(directory, ['rev-parse', '--is-inside-work-tree']);
  } catch (error) {
    if (error.status === 128 && /not a git repository/i.test(String(error.stderr))) return fallback;
    throw new Error(`cannot read the recorded platform mode: git failed: ${String(error.stderr || error.message).trim()}`);
  }
  try {
    runGit(directory, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch (error) {
    if (error.status === 1) return fallback; // the ref does not exist (for example no commits yet)
    throw new Error(`cannot read the recorded platform mode: git failed: ${String(error.stderr || error.message).trim()}`);
  }
  const target = PROJECT_BINDINGS_FILE.split(path.sep).join('/');
  let text;
  try {
    if (runGit(directory, ['ls-tree', '--name-only', ref, '--', `./${target}`]).trim() === '') return fallback;
    text = runGit(directory, ['show', `${ref}:./${target}`]);
  } catch (error) {
    throw new Error(`cannot read the recorded platform mode: git failed: ${String(error.stderr || error.message).trim()}`);
  }
  let doc = null;
  try {
    doc = yaml.parse(text);
  } catch {
    return fallback;
  }
  return doc && typeof doc === 'object' && PLATFORM_MODES.includes(doc.mode) ? { mode: doc.mode, source: 'committed' } : fallback;
}

function assertNotSymlink(target) {
  let stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`Platform bindings target must not be a symlink: ${target}`);
}

/** Validates `doc` as the project layer and writes it atomically (staging file + rename). */
function writePlatformBindings(projectDir, doc, { now = new Date() } = {}) {
  validateBindingsDocument(doc, { layer: 'project', now, projectDir });
  const root = path.resolve(projectDir);
  const hseosDir = path.join(root, '.hseos');
  const configDir = path.join(hseosDir, 'config');
  const targetPath = path.join(configDir, 'platform-bindings.yaml');
  for (const directory of [hseosDir, configDir]) assertNotSymlink(directory);
  fs.mkdirSync(configDir, { recursive: true });
  for (const directory of [hseosDir, configDir]) assertNotSymlink(directory);
  assertNotSymlink(targetPath);
  const staged = path.join(configDir, `.platform-bindings.yaml.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(staged, yaml.stringify(doc), { encoding: 'utf8', flag: 'wx' });
    assertNotSymlink(targetPath);
    fs.renameSync(staged, targetPath);
  } finally {
    fs.rmSync(staged, { force: true });
  }
  return targetPath;
}

module.exports = {
  PLATFORM_MODES,
  PROJECT_BINDINGS_FILE,
  RUNTIME_DEFAULTS_FILE,
  detectStacks,
  loadPlatformBindings,
  modeStrength,
  parsePlatformBindingFlag,
  readRecordedMode,
  validateBindingsDocument,
  writePlatformBindings,
};
