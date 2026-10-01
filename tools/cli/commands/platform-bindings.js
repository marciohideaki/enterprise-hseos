const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('yaml');
const { getProjectRoot } = require('../lib/project-root');
const { loadPlatformBindings, readRecordedMode } = require('../lib/platform-bindings');
const {
  RegistryIntegrityError,
  MAX_REGISTRY_BYTES,
  loadCapabilityRegistry,
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

/** `sync`: copies a tagged registry out of a local ECP checkout. No network, no edits of user configuration. */
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
  const output = path.resolve(options.output || defaultOutput(options.ref, env));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staged = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(staged, bytes, { flag: 'wx' });
    fs.renameSync(staged, output);
  } finally {
    fs.rmSync(staged, { force: true });
  }
  const snippet = yaml.stringify({ registry: { source: 'path', path: output, sha256 } });
  const result = {
    ref: options.ref,
    contracts_version: registry.generated_from.contracts_version,
    output,
    sha256,
    user_layer_snippet: snippet,
  };
  const text = [
    `Registry ${options.ref} (contracts ${result.contracts_version}) written to ${output}`,
    `sha256: ${sha256}`,
    '',
    'Add this to your user-layer bindings file to use it (nothing was edited):',
    snippet.trimEnd(),
  ].join('\n');
  return { code: 0, result, text };
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
    ['--ecp-root <path>', 'sync: local ECP checkout'],
    ['--output <file>', 'sync: destination file (default: user cache directory)'],
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
      case 'guard': {
        // Hook entry point: hook JSON on stdin, hook output format on stdout (exit 2 denies).
        const outcome = runGuard(fs.readFileSync(0, 'utf8'));
        process.stdout.write(outcome.stdout);
        if (outcome.stderr) process.stderr.write(outcome.stderr);
        if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
        return outcome;
      }
      default: {
        throw new Error(`Unknown platform-bindings action '${action}'. Use show, check, sync or guard.`);
      }
    }
  },
  runCheck,
  runGuard,
  runShow,
  runSync,
};
