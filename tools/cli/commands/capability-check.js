const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot } = require('../lib/project-root');
const { loadPlatformBindings, readRecordedMode } = require('../lib/platform-bindings');
const { loadCapabilityRegistry, resolveCapability } = require('../lib/capability-registry');

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 2;
  }
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const MAX_DEPTH = 7;
const MAX_DIRECTORIES = 5000;
const MAX_CANDIDATES = 20;
const MAX_SIGNATURE_BYTES = 256 * 1024;
const CANDIDATE_FILE = /\.(?:[cm]?[jt]sx?|cs|md)$/;

function isInside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function sortedEntries(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

/**
 * Walks one search root. Symlinks are followed only when their real target stays inside the real root;
 * every directory is visited once (by real path), so loops cannot hang the scan.
 */
function scanRoot(root, label, queryLower, found, state) {
  const realRoot = realpathOrNull(root);
  if (!realRoot) return;
  const visit = (directory, realDirectory, depth) => {
    if (state.visited.has(realDirectory)) return;
    if (depth > MAX_DEPTH) {
      state.depthTruncated = true;
      return;
    }
    if (state.visited.size >= MAX_DIRECTORIES) {
      state.truncated = true;
      return;
    }
    state.visited.add(realDirectory);
    for (const entry of sortedEntries(directory)) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      let real = null;
      if (entry.isSymbolicLink()) {
        real = realpathOrNull(full);
        if (!real || !isInside(realRoot, real)) continue;
      }
      let kind = entry;
      if (real) {
        try {
          kind = fs.statSync(real);
        } catch {
          continue;
        }
      }
      if (kind.isDirectory()) visit(full, real || path.join(realDirectory, entry.name), depth + 1);
      else if (kind.isFile() && CANDIDATE_FILE.test(entry.name) && entry.name.toLowerCase().includes(queryLower)) {
        const realFile = real || path.join(realDirectory, entry.name);
        if (!found.has(realFile)) found.set(realFile, { full, label, root });
      }
    }
  };
  visit(root, realRoot, 0);
}

function signature(file, query) {
  let content = '';
  try {
    const descriptor = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(MAX_SIGNATURE_BYTES);
      content = buffer.toString('utf8', 0, fs.readSync(descriptor, buffer, 0, MAX_SIGNATURE_BYTES, 0));
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return 'name match; signature not found';
  }
  const line = content
    .split('\n')
    .find((value) => value.includes(query) && /\b(?:export\s+)?(?:function|class|const|interface|type)\b/.test(value));
  return line ? line.trim() : 'name match; signature not found';
}

function searchRoots(projectDir, bindings, env) {
  const roots = [
    { dir: path.join(projectDir, 'packages'), label: 'project' },
    { dir: path.join(projectDir, 'cores'), label: 'project' },
    { dir: path.join(projectDir, 'src', 'BuildingBlocks'), label: 'project' },
  ];
  const warnings = [];
  const addWorkspace = (name, value) => {
    const resolved = path.resolve(value);
    if (realpathOrNull(resolved) && fs.statSync(resolved).isDirectory()) roots.push({ dir: resolved, label: 'workspace' });
    else warnings.push(`${name} does not exist or is not a directory: ${resolved}`);
  };
  const coresRoot = bindings.workspace && bindings.workspace.cores_root;
  if (coresRoot) addWorkspace('workspace.cores_root', coresRoot); // flat layout: <root>/<repo>/...
  if (env.HSEOS_CAPABILITY_WORKSPACE) addWorkspace('HSEOS_CAPABILITY_WORKSPACE', env.HSEOS_CAPABILITY_WORKSPACE); // <ws>/cores/<repo> or flat <ws>/<repo>
  const seen = new Set();
  return { roots: roots.filter((root) => !seen.has(root.dir) && seen.add(root.dir)), warnings };
}

/** The filesystem heuristic needs at least two characters, one of them alphanumeric (like the registry heuristic). */
function scannable(query) {
  return query.length >= 2 && /[A-Za-z0-9]/.test(query);
}

/** Secondary, heuristic filename scan. Deterministic: sorted and capped. */
function scanFilesystem(query, projectDir, bindings, env) {
  if (!scannable(query)) {
    return { candidates: [], warnings: ['filesystem scan skipped: the query needs at least two characters, one alphanumeric'] };
  }
  const found = new Map();
  const state = { visited: new Set(), truncated: false, depthTruncated: false };
  const queryLower = query.toLowerCase();
  const { roots, warnings } = searchRoots(projectDir, bindings, env);
  for (const root of roots) scanRoot(root.dir, root.label, queryLower, found, state);
  const display = ({ full, label, root }) =>
    label === 'workspace'
      ? `<workspace>/${path.relative(root, full).split(path.sep).join('/')}`
      : path.relative(projectDir, full).split(path.sep).join('/');
  const all = [...found.values()]
    .map((entry) => ({
      file: path.basename(entry.full),
      path: display(entry),
      root: entry.label,
      signature: signature(entry.full, query),
      source: 'heuristic',
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (state.truncated) warnings.push(`filesystem scan stopped after ${MAX_DIRECTORIES} directories`);
  if (state.depthTruncated) warnings.push(`filesystem scan did not descend below depth ${MAX_DEPTH}`);
  if (all.length > MAX_CANDIDATES) warnings.push(`filesystem candidates truncated to ${MAX_CANDIDATES} of ${all.length}`);
  return { candidates: all.slice(0, MAX_CANDIDATES), warnings };
}

function describeImplementation(implementation) {
  return {
    stack: implementation.stack,
    kind: implementation.kind,
    package: implementation.package,
    package_version: implementation.package_version || null,
    contract_version: implementation.contract_version,
    status: implementation.status,
    repository: implementation.repository || null,
  };
}

function overrideFor(bindings, name) {
  const override = bindings.overrides.find((entry) => entry.capability === name);
  if (!override) return null;
  return {
    outcome: override.outcome,
    ref: override.intake_ref || override.exception_ref || null,
    expires: override.expires,
    layer: override.layer,
  };
}

const CONSUMABLE_STATUSES = new Set(['experimental', 'stable']);

/** Prefers a stable implementation, then the one whose package mentions the query, then the first. */
function bestImplementation(implementations, queryLower) {
  return (
    implementations.find((implementation) => implementation.status === 'stable') ||
    implementations.find((implementation) => implementation.package.toLowerCase().includes(queryLower)) ||
    implementations[0]
  );
}

function verdictFor({ mode, override, implementations, stacks, queryLower }) {
  if (mode === 'local') {
    return { code: 'informational', text: 'informational (local mode: no intake required)', advisory: false };
  }
  if (override) {
    return {
      code: 'overridden',
      text: `overridden: ${override.outcome} (${override.ref}, expires ${override.expires})`,
      advisory: false,
    };
  }
  const advisory = mode === 'hybrid' && !implementations.some((implementation) => implementation.status === 'stable');
  const suffix = advisory ? ' (advisory)' : '';
  // Only experimental or stable implementations can be consumed; planned or deprecated ones do not count.
  const consumable = implementations.filter((implementation) => CONSUMABLE_STATUSES.has(implementation.status));
  if (consumable.length > 0) {
    const chosen = bestImplementation(consumable, queryLower);
    return { code: 'consume', text: `consume ${chosen.package} (${chosen.status})${suffix}`, advisory };
  }
  const target = stacks.length > 0 ? stacks.join(', ') : 'the project stack';
  return { code: 'extend', text: `extend (implement the contract for ${target} in the owning core)${suffix}`, advisory };
}

function buildResult(entry, { mode, bindings, stacks, queryLower }) {
  const { capability } = entry;
  const implementations = entry.implementations.map(describeImplementation);
  const override = overrideFor(bindings, capability.name);
  const verdict = verdictFor({ mode, override, implementations, stacks, queryLower });
  return {
    capability: capability.name,
    kind: capability.kind,
    version: capability.version,
    stability: capability.stability,
    summary: capability.summary,
    matched_by: entry.matchedBy,
    implementations,
    override,
    verdict: verdict.code,
    verdict_text: verdict.text,
    advisory: verdict.advisory,
  };
}

/**
 * Runs the check and returns `{ report, exitCode }` without printing.
 * Resolution order: platform bindings -> ECP registry -> (secondary) filesystem heuristic.
 */
function runCapabilityCheck(rawQuery, { directory, env = process.env, runtimeRoot = getProjectRoot(), now } = {}) {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (query === '') throw new UsageError('capability-check requires a non-empty <query>');
  const projectDir = path.resolve(directory || process.cwd());
  let directoryStat = null;
  try {
    directoryStat = fs.statSync(projectDir);
  } catch {
    directoryStat = null;
  }
  if (!directoryStat || !directoryStat.isDirectory()) throw new UsageError(`--directory is not an existing directory: ${projectDir}`);

  const errors = [];
  let baseMode = 'platform';
  try {
    baseMode = readRecordedMode(projectDir).mode;
  } catch (error) {
    errors.push(error.message);
  }
  const bindings = loadPlatformBindings({ runtimeRoot, projectDir, env, baseMode, ...(now ? { now } : {}) });
  const report = {
    query,
    mode: bindings.mode,
    mode_source: bindings.source,
    stacks: [...bindings.stacks],
    registry: { source: bindings.registry.source, ref: null, sha256: null },
    results: [],
    filesystem_candidates: [],
    warnings: [...bindings.warnings],
    errors: [...errors, ...bindings.errors],
  };
  let exitCode = report.errors.length > 0 ? 1 : 0;

  try {
    const loaded = loadCapabilityRegistry({ runtimeRoot, bindings });
    report.registry = { source: loaded.source, ref: loaded.ref, sha256: loaded.sha256 };
    report.results = resolveCapability(loaded.registry, query, { stacks: bindings.stacks }).map((entry) =>
      buildResult(entry, { mode: bindings.mode, bindings, stacks: bindings.stacks, queryLower: query.toLowerCase() }),
    );
  } catch (error) {
    report.errors.push(`capability registry: ${error.message}`);
    exitCode = 1;
  }

  const scan = scanFilesystem(query, projectDir, bindings, env);
  report.filesystem_candidates = scan.candidates;
  report.warnings.push(...scan.warnings);
  return { report, exitCode };
}

function renderText(report) {
  const lines = [
    `Capability check: ${report.query}`,
    `Mode: ${report.mode} (source: ${report.mode_source})`,
    `Registry: ${report.registry.source}${report.registry.ref ? ` ref ${report.registry.ref}` : ''}${
      report.registry.sha256 ? ` sha256 ${report.registry.sha256.slice(0, 12)}` : ''
    }`,
    `Stacks: ${report.stacks.length > 0 ? report.stacks.join(', ') : '(none detected)'}`,
  ];
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  for (const error of report.errors) lines.push(`error: ${error}`);
  lines.push('');
  if (report.results.length === 0) {
    if (report.mode === 'local') lines.push(`no platform capability matches '${report.query}' (local mode: nothing to do)`);
    else {
      lines.push(
        `no platform capability matches '${report.query}'`,
        'Record a capability intake before adding an exported capability; inspect repeated local implementations for a promote candidate.',
      );
    }
  } else {
    lines.push('Registry results:');
    for (const [index, result] of report.results.entries()) {
      lines.push(`${index + 1}. ${result.capability} [${result.kind}] ${result.version} (${result.stability}) matchedBy: ${result.matched_by}`);
      if (result.implementations.length === 0) lines.push('   implementations: none for the project stacks');
      for (const implementation of result.implementations) {
        const version = implementation.package_version ? `@${implementation.package_version}` : '';
        const repository = implementation.repository ? ` ${implementation.repository}` : '';
        lines.push(`   implementation: ${implementation.stack} ${implementation.package}${version} ${implementation.status}${repository}`);
      }
      lines.push(`   verdict: ${result.verdict_text}`);
    }
  }
  if (report.filesystem_candidates.length > 0) {
    lines.push('', 'Filesystem candidates (heuristic):', 'Candidate\tLocation\tSignature');
    for (const candidate of report.filesystem_candidates) lines.push(`${candidate.file}\t${candidate.path}\t${candidate.signature}`);
  }
  return lines.join('\n');
}

module.exports = {
  command: 'capability-check <query>',
  description: 'Find governed capability candidates before implementation',
  options: [
    ['--directory <path>', 'Repository root to check (default: current directory)'],
    ['--json', 'Print the result as JSON'],
  ],
  action: async (query, options = {}) => {
    try {
      const { report, exitCode } = runCapabilityCheck(query, { directory: options.directory });
      console.log(options.json ? JSON.stringify(report, null, 2) : renderText(report));
      if (exitCode) process.exitCode = exitCode;
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      console.error(`error: ${error.message}`);
      process.exitCode = error.exitCode;
    }
  },
  UsageError,
  runCapabilityCheck,
  renderText,
  scanFilesystem,
};
