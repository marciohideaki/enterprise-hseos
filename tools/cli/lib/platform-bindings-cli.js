const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');
const {
  PLATFORM_MODES,
  PROJECT_BINDINGS_FILE,
  loadPlatformBindings,
  readRecordedMode,
  parsePlatformBindingFlag,
  validateBindingsDocument,
  writePlatformBindings,
} = require('./platform-bindings');

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
// Points the user layer at a path that cannot exist, so project-only checks ignore the machine's configuration.
const NO_USER_LAYER_ENV = Object.freeze({ XDG_CONFIG_HOME: '/nonexistent-hseos-user-layer', HOME: '/nonexistent-hseos-user-layer' });

/** A request the user can fix (bad flag, invalid bindings): reported as one `error:` line, without a stack. */
class PlatformBindingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlatformBindingsError';
  }
}

class GitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitError';
  }
}

function git(projectDir, args, { buffer = false } = {}) {
  try {
    return execFileSync('git', ['-C', projectDir, ...args], {
      encoding: buffer ? 'buffer' : 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new GitError(`git ${args[0]} failed: ${detail}`);
  }
}

/**
 * Fails when an explicit git ref cannot be resolved. readRecordedMode treats an unknown
 * ref as "no recorded file", which is right for HEAD in a fresh repository but would
 * silently disable a downgrade check against a mistyped `--base`. Outside a git
 * repository there is nothing to resolve.
 */
function assertRefResolves(projectDir, ref) {
  if (typeof ref !== 'string' || ref.startsWith('-')) throw new GitError(`invalid git ref '${ref}'`);
  try {
    git(projectDir, ['rev-parse', '--is-inside-work-tree']);
  } catch (error) {
    if (/not a git repository/i.test(error.message)) return;
    throw error;
  }
  git(projectDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
}

/**
 * Baseline for init, install and show: the mode committed at HEAD (`platform` when
 * absent or outside git). Any git failure aborts with a clear error; the working
 * tree is never consulted, so a failing git cannot weaken the baseline.
 */
function baselineMode(projectDir) {
  try {
    return readRecordedMode(projectDir).mode;
  } catch (error) {
    throw new PlatformBindingsError(error.message);
  }
}

/** Reads the `platform*` install options into loader flags; null when none were given. */
function platformFlags(options = {}) {
  const raw = options.platformBinding;
  const bindings = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (options.platformMode === undefined && options.modeRef === undefined && bindings.length === 0) return null;
  if (options.platformMode !== undefined && !PLATFORM_MODES.includes(options.platformMode)) {
    throw new PlatformBindingsError(`--platform-mode must be one of ${PLATFORM_MODES.join(', ')}`);
  }
  if (options.modeRef !== undefined && options.platformMode === undefined) {
    throw new PlatformBindingsError('--mode-ref requires --platform-mode');
  }
  const parsed = bindings.map((spec) => {
    try {
      return parsePlatformBindingFlag(spec);
    } catch (error) {
      throw new PlatformBindingsError(error.message);
    }
  });
  const seen = new Set();
  for (const binding of parsed) {
    if (seen.has(binding.capability)) throw new PlatformBindingsError(`duplicate binding for ${binding.capability}`);
    seen.add(binding.capability);
  }
  return { mode: options.platformMode, modeRef: options.modeRef, bindings: parsed };
}

function readExistingProjectDocument(projectDir) {
  const file = path.join(path.resolve(projectDir), PROJECT_BINDINGS_FILE);
  if (!fs.existsSync(file)) return null;
  return yaml.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Validates the requested bindings and builds the project document to write. Returns
 * null when no platform option was given (nothing is ever written implicitly).
 * Throws with every problem listed when the request is invalid; writes nothing.
 */
function preparePlatformBindings({ projectDir, runtimeRoot, options, env = process.env, now = new Date() }) {
  const flags = platformFlags(options);
  if (!flags) return null;
  const baseMode = baselineMode(projectDir);
  const loaded = loadPlatformBindings({ runtimeRoot, projectDir, env, flags, now, baseMode });
  const projectErrors = loaded.errors.filter((entry) => entry.startsWith('project file:'));
  const blocking = flags.mode === undefined ? loaded.errors : loaded.errors.filter((entry) => !projectErrors.includes(entry));
  if (blocking.length > 0) {
    throw new PlatformBindingsError(`Platform bindings are invalid:\n${blocking.map((entry) => `  - ${entry}`).join('\n')}`);
  }
  const warnings = [...loaded.warnings];
  const replacing = projectErrors.length > 0;
  if (replacing) {
    warnings.push(`the existing ${PROJECT_BINDINGS_FILE} is invalid (${projectErrors[0]}); a new document is built from scratch`);
  }
  const existing = replacing ? null : readExistingProjectDocument(projectDir);
  const mode = flags.mode ?? (existing && existing.mode) ?? 'platform';
  const doc = { schema_version: '1.0.0', mode };
  const modeRef = flags.modeRef ?? (existing && existing.mode === mode ? existing.mode_ref : undefined);
  if (modeRef !== undefined) doc.mode_ref = modeRef;
  if (existing && existing.registry) doc.registry = existing.registry;
  if (existing && existing.stacks) doc.stacks = existing.stacks;
  const overrides = loaded.overrides.map(({ layer: _layer, ...override }) => override);
  if (overrides.length > 0) doc.overrides = overrides;
  validateBindingsDocument(doc, { layer: 'project', now, projectDir });
  return { doc, loaded, baseMode, warnings };
}

/** Writes a prepared document. Returns the written path, or null when nothing was prepared. */
function applyPlatformBindings(projectDir, prepared, { now = new Date() } = {}) {
  return prepared ? writePlatformBindings(projectDir, prepared.doc, { now }) : null;
}

module.exports = {
  GitError,
  PlatformBindingsError,
  NO_USER_LAYER_ENV,
  applyPlatformBindings,
  assertRefResolves,
  baselineMode,
  platformFlags,
  preparePlatformBindings,
};
