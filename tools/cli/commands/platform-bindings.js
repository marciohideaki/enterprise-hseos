const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('yaml');
const { getProjectRoot } = require('../lib/project-root');
const { loadPlatformBindings, readRecordedMode } = require('../lib/platform-bindings');
const {
  MAX_REGISTRY_BYTES,
  RegistryIntegrityError,
  STACKS_LOCK_FILE,
  createVocabulary,
  loadCapabilityRegistry,
  readSnapshotLock,
  validateCapabilityRegistry,
} = require('../lib/capability-registry');
const { evaluateGuard } = require('../lib/capability-intake-guard');
const { NO_USER_LAYER_ENV, assertRefResolves, baselineMode } = require('../lib/platform-bindings-cli');

const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function projectDirectory(options) {
  return path.resolve(options.directory || process.cwd());
}

function registrySummary(runtimeRoot, bindings) {
  try {
    const loaded = loadCapabilityRegistry({ runtimeRoot, bindings });
    return { ok: true, summary: { source: loaded.source, ref: loaded.ref, sha256: loaded.sha256 } };
  } catch (error) {
    return {
      ok: false,
      integrity: error instanceof RegistryIntegrityError,
      summary: { source: bindings.registry.source, error: error.message },
    };
  }
}

/** `show`: effective bindings. Exit code 1 only when the registry fails its integrity check. */
function runShow(options = {}, { runtimeRoot = getProjectRoot(), env = process.env } = {}) {
  const projectDir = projectDirectory(options);
  const bindings = loadPlatformBindings({ runtimeRoot, projectDir, env, baseMode: baselineMode(projectDir) });
  const registry = registrySummary(runtimeRoot, bindings);
  const result = {
    directory: projectDir,
    mode: bindings.mode,
    source: bindings.source,
    modeRef: bindings.modeRef,
    stacks: bindings.stacks,
    overrides: bindings.overrides,
    registry: registry.summary,
    warnings: bindings.warnings,
    errors: bindings.errors,
  };
  const lines = [
    `Mode: ${result.mode} (source: ${result.source})`,
    `Mode ref: ${result.modeRef || '(none)'}`,
    `Stacks: ${result.stacks.join(', ') || '(none detected)'}`,
    `Registry: ${Object.entries(result.registry)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')}`,
    `Overrides: ${result.overrides.length === 0 ? '(none)' : result.overrides.map((o) => `${o.capability}=${o.outcome} (${o.layer}, expires ${o.expires})`).join('; ')}`,
    ...result.warnings.map((entry) => `warning: ${entry}`),
    ...result.errors.map((entry) => `error: ${entry}`),
  ];
  return { code: registry.ok || !registry.integrity ? 0 : 1, result, text: lines.join('\n') };
}

/** `check`: CI validation of the project file; with `base`, also rejects an unjustified downgrade. */
function runCheck(options = {}, { runtimeRoot = getProjectRoot() } = {}) {
  const projectDir = projectDirectory(options);
  const baseRef = options.base || 'HEAD';
  let baseMode;
  try {
    if (options.base) assertRefResolves(projectDir, baseRef);
    baseMode = readRecordedMode(projectDir, baseRef).mode;
  } catch (error) {
    // Git and usage failures are exit code 2; violations of the bindings rules are exit code 1.
    return { code: 2, result: { directory: projectDir, baseRef, error: error.message }, text: `error: ${error.message}` };
  }
  const bindings = loadPlatformBindings({ runtimeRoot, projectDir, env: NO_USER_LAYER_ENV, baseMode });
  const result = {
    directory: projectDir,
    mode: bindings.mode,
    source: bindings.source,
    baseRef,
    baseMode,
    warnings: bindings.warnings,
    errors: bindings.errors,
  };
  const lines = [
    `Platform bindings: ${result.mode} (source: ${result.source}); recorded mode at ${baseRef}: ${baseMode}`,
    ...result.warnings.map((entry) => `warning: ${entry}`),
    ...result.errors.map((entry) => `error: ${entry}`),
  ];
  return { code: bindings.errors.length > 0 ? 1 : 0, result, text: lines.join('\n') };
}

function defaultOutput(ref, env) {
  const cacheHome = env.XDG_CACHE_HOME || path.join(env.HOME || os.homedir(), '.cache');
  // Lossless: '%' and '/' are percent-encoded, so 'a/b' and 'a_b' (or 'a%2Fb') never share a file.
  return path.join(cacheHome, 'hseos', 'ecp-registry', `${ref.replaceAll('%', '%25').replaceAll('/', '%2F')}.json`);
}

/** Default stacks file next to the registry output: `<output>.stacks.json` (what a `path` registry source finds on its own). */
function stacksOutputFor(output) {
  return `${output.replace(/\.json$/i, '')}.stacks.json`;
}

/**
 * Publishes the registry and its stack vocabulary as one unit. `entries` are `{ target, bytes }`; `bytes: null`
 * removes the target (a vocabulary left over from another ref). Everything is staged first, existing targets are
 * moved aside, and any failure puts the previous files back and removes the temporaries, so a new registry never
 * ends up next to an old vocabulary.
 */
function publishPair(entries) {
  const suffix = `.${process.pid}.tmp`;
  const staged = [];
  const moved = [];
  const placed = [];
  const cleanup = () => {
    for (const entry of staged) fs.rmSync(`${entry.target}${suffix}`, { force: true });
  };
  try {
    for (const entry of entries) {
      if (entry.bytes === null) continue;
      fs.mkdirSync(path.dirname(entry.target), { recursive: true });
      fs.writeFileSync(`${entry.target}${suffix}`, entry.bytes, { flag: 'wx' });
      staged.push(entry);
    }
    for (const entry of entries) {
      if (!fs.existsSync(entry.target)) continue;
      fs.renameSync(entry.target, `${entry.target}.bak${suffix}`);
      moved.push(entry);
    }
    for (const entry of staged) {
      fs.renameSync(`${entry.target}${suffix}`, entry.target);
      placed.push(entry);
    }
  } catch (error) {
    for (const entry of placed) fs.rmSync(entry.target, { force: true });
    for (const entry of moved) fs.renameSync(`${entry.target}.bak${suffix}`, entry.target);
    cleanup();
    throw error;
  }
  for (const entry of moved) fs.rmSync(`${entry.target}.bak${suffix}`, { force: true, recursive: true });
}

/**
 * Reads `contracts/stacks.json` at `ref` (resolution v1.1, Decision 0011). Contracts before 0.5.0 ship none:
 * that is `null`, not an error, and the resolver then keeps the v1 stack rules. A vocabulary that exists but is
 * invalid fails the sync.
 */
function readStacksAtRef(ecpRoot, ref) {
  const run = (args) =>
    execFileSync('git', ['-C', ecpRoot, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      maxBuffer: MAX_REGISTRY_BYTES + 1,
    });
  try {
    run(['cat-file', '-e', `${ref}:contracts/stacks.json`]);
  } catch {
    return null;
  }
  let bytes;
  try {
    bytes = run(['show', `${ref}:contracts/stacks.json`]);
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`Cannot read contracts/stacks.json at ${ref} in ${ecpRoot}: ${detail}`);
  }
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid stack vocabulary: not valid JSON (${error.message})`);
  }
  const vocabulary = createVocabulary(document);
  return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), version: vocabulary.version };
}

/**
 * `sync`: copies a tagged registry (and, when the ref ships one, the stack vocabulary) out of a local ECP checkout.
 * No network, no edits of user configuration. The registry is validated, and the vocabulary is written only after it validates.
 */
function runSync(options = {}, { env = process.env } = {}) {
  if (!options.ref || !options.ecpRoot) throw new Error('sync requires --ref <tag> and --ecp-root <path>');
  if (!REF_PATTERN.test(options.ref)) throw new Error(`Invalid --ref '${options.ref}'`);
  const ecpRoot = path.resolve(options.ecpRoot);
  if (!fs.existsSync(ecpRoot) || !fs.statSync(ecpRoot).isDirectory()) throw new Error(`--ecp-root is not a directory: ${ecpRoot}`);
  let bytes;
  try {
    bytes = execFileSync('git', ['-C', ecpRoot, 'show', `${options.ref}:catalog/capability-registry.json`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      maxBuffer: MAX_REGISTRY_BYTES + 1,
    });
  } catch (error) {
    if (error.code === 'ENOBUFS') throw new Error(`Registry at ${options.ref} is too large (over ${MAX_REGISTRY_BYTES} bytes)`);
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`Cannot read catalog/capability-registry.json at ${options.ref} in ${ecpRoot}: ${detail}`);
  }
  if (bytes.length > MAX_REGISTRY_BYTES) throw new Error(`Registry at ${options.ref} is too large (${bytes.length} bytes)`);
  let registry;
  try {
    registry = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid capability registry: not valid JSON (${error.message})`);
  }
  validateCapabilityRegistry(registry);
  // A contracts-vX.Y.Z tag pins the contracts version; for any other ref the printed sha256 is the anchor.
  const tagVersion = /^contracts-v(\d+\.\d+\.\d+)$/.exec(options.ref);
  if (tagVersion && registry.generated_from.contracts_version !== tagVersion[1]) {
    throw new Error(
      `Registry at ${options.ref} declares contracts_version ${registry.generated_from.contracts_version}, expected ${tagVersion[1]}`,
    );
  }
  const declaredRef = registry.generated_from.ref;
  if (declaredRef !== undefined && declaredRef !== options.ref) {
    throw new Error(`Registry declares generated_from.ref '${declaredRef}' but --ref is '${options.ref}'`);
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const stacks = readStacksAtRef(ecpRoot, options.ref);
  const output = path.resolve(options.output || defaultOutput(options.ref, env));
  const stacksTarget = path.resolve(options.stacksOutput || stacksOutputFor(output));
  const stacksOutput = stacks ? stacksTarget : null;
  // A ref without a vocabulary must not leave one from another ref next to this registry.
  const staleStacks = !stacks && fs.existsSync(stacksTarget) ? stacksTarget : null;
  publishPair([
    { target: stacksTarget, bytes: stacks ? stacks.bytes : null },
    { target: output, bytes },
  ]);
  const snippet = yaml.stringify({ registry: { source: 'path', path: output, sha256 } });
  const result = {
    ref: options.ref,
    contracts_version: registry.generated_from.contracts_version,
    output,
    sha256,
    stacks: stacks ? { output: stacksOutput, sha256: stacks.sha256, stacks_version: stacks.version } : null,
    stacks_removed: staleStacks,
    user_layer_snippet: snippet,
  };
  const text = [
    `Registry ${options.ref} (contracts ${result.contracts_version}) written to ${output}`,
    `sha256: ${sha256}`,
    ...(stacks
      ? [
          `Stack vocabulary ${stacks.version} written to ${stacksOutput}`,
          `stacks sha256: ${stacks.sha256}`,
          `(a snapshot refresh also needs ${path.basename(STACKS_LOCK_FILE)} with this sha256, the same ref, repository and contracts_version)`,
        ]
      : [
          `No contracts/stacks.json at ${options.ref}: stack rules stay at resolution v1 (lower-case equality)`,
          ...(staleStacks ? [`Removed ${staleStacks}: a vocabulary from another ref must not sit next to this registry`] : []),
        ]),
    '',
    'Add this to your user-layer bindings file to use it (nothing was edited):',
    snippet.trimEnd(),
  ].join('\n');
  return { code: 0, result, text };
}

/** Orders contracts-vX.Y.Z tags; returns those strictly newer than `ref`. Non-matching refs yield none. */
function newerContractsTags(ref, tags) {
  const parse = (tag) => {
    const match = /^contracts-v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    return match ? match.slice(1).map(Number) : null;
  };
  const base = parse(ref);
  if (!base) return [];
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return tags
    .filter((tag) => {
      const version = parse(tag);
      return version && cmp(version, base) > 0;
    })
    .sort((a, b) => cmp(parse(a), parse(b)));
}

/**
 * `drift`: compares the sha256 of the registry at the lock `ref` in a local ECP checkout with the snapshot lock.
 * Read-only. Code 1 when the upstream bytes diverge from the lock; newer contracts-v* tags are a warning only.
 */
function runDrift(options = {}, { runtimeRoot = getProjectRoot() } = {}) {
  if (!options.ecpRoot) throw new Error('drift requires --ecp-root <path>');
  const ecpRoot = path.resolve(options.ecpRoot);
  const lockPath = path.join(runtimeRoot, '.enterprise', 'governance', 'capabilities', 'ecp-registry.snapshot.lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!REF_PATTERN.test(lock.ref)) throw new Error(`Invalid lock ref '${lock.ref}'`);
  const run = (args) =>
    execFileSync('git', ['-C', ecpRoot, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: MAX_REGISTRY_BYTES + 1,
    });
  let bytes;
  try {
    bytes = run(['show', `${lock.ref}:catalog/capability-registry.json`]);
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`Cannot read catalog/capability-registry.json at ${lock.ref} in ${ecpRoot}: ${detail}`);
  }
  const upstream = crypto.createHash('sha256').update(bytes).digest('hex');
  const newerTags = newerContractsTags(
    lock.ref,
    String(run(['tag', '--list', 'contracts-v*']))
      .split('\n')
      .filter(Boolean),
  );
  const registryDiverged = upstream !== lock.sha256;
  // The stack vocabulary snapshot (resolution v1.1) is checked the same way when its lock ships.
  const stacksLockPath = path.join(runtimeRoot, STACKS_LOCK_FILE);
  let stacksDrift = null;
  if (fs.existsSync(stacksLockPath)) {
    const stacksLock = readSnapshotLock(runtimeRoot, { file: STACKS_LOCK_FILE, label: 'Stacks snapshot lock' });
    if (!REF_PATTERN.test(stacksLock.ref)) throw new Error(`Invalid stacks lock ref '${stacksLock.ref}'`);
    let stacksBytes = null;
    try {
      stacksBytes = run(['show', `${stacksLock.ref}:contracts/stacks.json`]);
    } catch {
      stacksBytes = null;
    }
    const stacksUpstream = stacksBytes ? crypto.createHash('sha256').update(stacksBytes).digest('hex') : null;
    stacksDrift = {
      ref: stacksLock.ref,
      locked_sha256: stacksLock.sha256,
      upstream_sha256: stacksUpstream,
      diverged: stacksUpstream !== stacksLock.sha256,
    };
  }
  const diverged = registryDiverged || Boolean(stacksDrift && stacksDrift.diverged);
  const result = {
    ref: lock.ref,
    repository: lock.repository,
    locked_sha256: lock.sha256,
    upstream_sha256: upstream,
    diverged,
    newer_tags: newerTags,
    ...(stacksDrift ? { stacks: stacksDrift } : {}),
  };
  const text = [
    `Lock ${lock.ref}: ${registryDiverged ? 'DIVERGED' : 'equal'} (locked ${lock.sha256}, upstream ${upstream})`,
    ...(stacksDrift
      ? [
          `Stacks lock ${stacksDrift.ref}: ${stacksDrift.diverged ? 'DIVERGED' : 'equal'} (locked ${stacksDrift.locked_sha256}, upstream ${stacksDrift.upstream_sha256 || 'absent'})`,
        ]
      : []),
    newerTags.length > 0 ? `Newer contracts tags than ${lock.ref}: ${newerTags.join(', ')}` : `No contracts tag newer than ${lock.ref}`,
  ].join('\n');
  return { code: diverged ? 1 : 0, result, text };
}

/** `guard`: the capability intake decision for a project with platform bindings (see capability-intake-guard). */
function runGuard(input, { runtimeRoot = getProjectRoot(), cwd = process.cwd(), env = process.env } = {}) {
  return evaluateGuard({ input, cwd, env, runtimeRoot });
}

function emit(outcome, options) {
  console.log(options.json ? JSON.stringify(outcome.result, null, 2) : outcome.text);
  if (outcome.code !== 0) process.exitCode = outcome.code;
  return outcome;
}

module.exports = {
  command: 'platform-bindings <action>',
  description: 'Inspect (show), verify (check), sync the registry for, or guard intake with platform bindings (ADR-0046)',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--json', 'Emit JSON'],
    ['--base <git-ref>', 'check: revision whose recorded mode is the downgrade baseline (default: HEAD; for example origin/main)'],
    [
      '--ref <tag>',
      'sync: ECP tag or revision to read the capability registry from (a contracts-vX.Y.Z tag must match the registry contracts_version; for other refs the printed sha256 is the integrity anchor)',
    ],
    ['--ecp-root <path>', 'sync/drift: local ECP checkout'],
    ['--output <file>', 'sync: destination file (default: user cache directory)'],
    ['--stacks-output <file>', 'sync: destination of the stack vocabulary when the ref ships one (default: <output>.stacks.json)'],
  ],
  action: async (action, options = {}) => {
    switch (action) {
      case 'show': {
        return emit(runShow(options), options);
      }
      case 'check': {
        return emit(runCheck(options), options);
      }
      case 'sync': {
        return emit(runSync(options), options);
      }
      case 'drift': {
        return emit(runDrift(options), options);
      }
      case 'guard': {
        // Hook entry point: hook JSON on stdin, hook output format on stdout (exit 2 denies).
        const outcome = runGuard(fs.readFileSync(0, 'utf8'));
        process.stdout.write(outcome.stdout);
        if (outcome.stderr) process.stderr.write(outcome.stderr);
        if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
        return outcome;
      }
      default: {
        throw new Error(`Unknown platform-bindings action '${action}'. Use show, check, sync, drift or guard.`);
      }
    }
  },
  runCheck,
  runGuard,
  newerContractsTags,
  runDrift,
  runShow,
  runSync,
};
