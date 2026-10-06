const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  PROJECT_BINDINGS_FILE,
  detectStacks,
  isReferenceId,
  loadPlatformBindings,
  overrideRefResolves,
  readRecordedMode,
} = require('./platform-bindings');
const { RegistryIntegrityError, loadCapabilityRegistry, matchExport, resolveCapability } = require('./capability-registry');

// Path rules ported from .enterprise/governance/hooks/handlers/capability-intake-guard.sh (its globs let `*`
// cross `/`). They are matched against the project-relative path with a leading `/`, so top-level
// `packages/...` is watched like an absolute path under a project root.
const EXCLUDED_FILE =
  /^.*(?:\.test\..*|\.spec\..*|\.stories\..*)$|^.*\/__mocks__\/.*$|^.*\.generated\..*$|^.*\/dist\/.*$|^.*\.d\.(?:ts|mts|cts)$/s;
const WATCHED_FILE = /^(?:.*\/applications\/.*\/src\/.*|.*\/packages\/.*|.*\/src\/Services\/.*)$/s;

// Export detection is broader than the legacy shell guard (which misses `export async function`, `export enum`,
// `export default` without a name, CommonJS exports, multi-line declarations and most C# types) and is
// multi-line. Each form may capture the exported symbol; `export { ... }` and anonymous defaults have none.
const EXPORT_FORMS = [
  /\bexport\s+default\s+(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|class)\s+(?!(?:extends|implements)\b)([A-Za-z_$][\w$]*)/g,
  /\bexport\s+default\b/g,
  /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|class|const\s+enum|enum|const|let|var|interface|type|namespace)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s*[{*]/g,
  /\bmodule\.exports\b/g,
  /\bexports\.([A-Za-z_$][\w$]*)\s*=/g,
  /\b(?:public|internal)\s+(?:(?:sealed|static|abstract|partial|readonly|unsafe|new)\s+)*(?:(?:class|record|struct|interface|enum)\s+(?:(?:class|struct)\s+)?)([A-Za-z_]\w*)/g,
];
const PROTECTED_SUFFIX = PROJECT_BINDINGS_FILE.split(path.sep).join('/').toLowerCase();
const MAX_CANDIDATES = 3;

const PROTECTED_MESSAGE =
  'Platform bindings are human-owned (ADR-0046 §4): .hseos/config/platform-bindings.yaml must not be edited by an agent. Edit it yourself or run `hseos install --platform-mode <mode>`.';

function denial(reason, context) {
  return {
    exitCode: 2,
    // The reason also goes to stderr so it survives adapters that only surface stderr on exit 2.
    stderr: `${context}\n`,
    stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason, additionalContext: context } })}\n`,
  };
}

function allowance(context) {
  const stdout = context ? `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context } })}\n` : '';
  return { exitCode: 0, stdout, stderr: '' };
}

/** True when `file` is the project bindings file (any spelling that normalizes to it). */
function isProtectedBindingsPath(file) {
  if (typeof file !== 'string' || file === '') return false;
  const normalized = path.posix.normalize(file.replaceAll('\\', '/')).toLowerCase();
  return normalized === PROTECTED_SUFFIX || normalized.endsWith(`/${PROTECTED_SUFFIX}`);
}

// Re-exports with a `from` clause forward an existing module; they introduce no new capability.
const REEXPORT = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s*from\s*""/g;

/**
 * Replaces comments and string literals with blanks (strings become `""`) so that text inside them is never
 * mistaken for code. Small lexer, not a parser: `${}` inside template literals is not evaluated, regex literals
 * are not recognised, and single- and double-quoted strings end at a newline so a stray quote cannot swallow the
 * rest of the file. `language` is `cs` for C# (verbatim `@"…"`, interpolated `$"…"`, raw `"""…"""`) and `js` otherwise.
 */
function stripNonCode(content, language = 'js') {
  const cs = language === 'cs';
  let out = '';
  let i = 0;
  const n = content.length;
  const skipQuoted = (quote, { verbatim = false } = {}) => {
    i += 1;
    while (i < n) {
      const char = content[i];
      if (verbatim) {
        if (char === quote) {
          if (content[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          return;
        }
      } else {
        if (char === '\\') {
          i += 2;
          continue;
        }
        if (char === quote) {
          i += 1;
          return;
        }
        if (char === '\n' && quote !== '`') return;
      }
      i += 1;
    }
  };
  while (i < n) {
    const char = content[i];
    const next = content[i + 1];
    if (char === '/' && next === '/') {
      while (i < n && content[i] !== '\n') i += 1;
    } else if (char === '/' && next === '*') {
      const end = content.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += content.slice(i, stop).replaceAll(/[^\n]/g, ' ');
      i = stop;
    } else if (cs && (char === '@' || char === '$') && /^[@$]{1,2}"/.test(content.slice(i, i + 3))) {
      const prefix = content.slice(i).match(/^[@$]{1,2}/)[0];
      i += prefix.length;
      skipQuoted('"', { verbatim: prefix.includes('@') });
      out += '""';
    } else if (cs && char === '"' && content.startsWith('"""', i)) {
      const quotes = content.slice(i).match(/^"+/)[0];
      const end = content.indexOf(quotes, i + quotes.length);
      i = end === -1 ? n : end + quotes.length;
      out += '""';
    } else if (char === '"' || char === "'" || (!cs && char === '`')) {
      skipQuoted(char);
      out += '""';
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/** First export in document order: `{ symbol }` (null when anonymous) or null when `content` exports nothing. */
function detectExport(content, language = 'js') {
  const code = stripNonCode(content, language).replaceAll(REEXPORT, (match) => match.replaceAll(/[^\n]/g, ' '));
  let best = null;
  for (const form of EXPORT_FORMS) {
    form.lastIndex = 0;
    const match = form.exec(code);
    if (!match) continue;
    const symbol = match[1] || null;
    if (!best || match.index < best.index || (match.index === best.index && symbol && !best.symbol)) best = { index: match.index, symbol };
  }
  return best && { symbol: best.symbol };
}

function languageOf(file) {
  return /\.cs$/i.test(file) ? 'cs' : 'js';
}

/** `file` is matched as given (a project-relative path gets a leading slash from the caller). */
function qualifies(file, content) {
  return !EXCLUDED_FILE.test(file) && WATCHED_FILE.test(file) && detectExport(content, languageOf(file)) !== null;
}

function extractSymbol(content, language = 'js') {
  const found = detectExport(content, language);
  return found ? found.symbol : null;
}

function resolveTarget(root, file) {
  const absolute = path.resolve(root, file.replaceAll('\\', '/'));
  let existing = absolute;
  const rest = [];
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  let real = absolute;
  let realRoot = root;
  try {
    real = path.join(fs.realpathSync(existing), ...rest);
    realRoot = fs.realpathSync(root);
  } catch {
    // keep the lexical path
  }
  const relative = path.relative(realRoot, real);
  return { real, relative: relative.startsWith('..') || path.isAbsolute(relative) ? null : relative.split(path.sep).join('/') };
}

function projectRoot(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return cwd;
  }
}

function filesystemCandidates(root, symbol) {
  const needle = (symbol || '__none__').toLowerCase();
  const found = [];
  for (const searchRoot of ['packages', 'cores']) {
    const matches = [];
    const walk = (directory, depth) => {
      if (depth > 12 || matches.length >= MAX_CANDIDATES) return;
      let entries = [];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.isFile() && entry.name.toLowerCase().includes(needle) && matches.length < MAX_CANDIDATES)
          matches.push(path.relative(root, full));
      }
    };
    walk(path.join(root, searchRoot), 0);
    found.push(...matches);
  }
  return found;
}

function validAck(root, env) {
  const ack = env.CORE_INTAKE_ACK || '';
  // Same shape as an intake_ref, then a token-exact match in intake documents (the legacy rule is a substring match).
  return isReferenceId(ack) && overrideRefResolves(root, 'intake_ref', ack);
}

function describeMatches(matches) {
  return matches
    .map((match) => {
      const packages = [...new Set(match.implementations.map((implementation) => implementation.package))];
      return `${match.capability.name}${match.stableForStack ? ' [stable]' : ''}${packages.length > 0 ? ` (${packages.join(', ')})` : ''}`;
    })
    .join('; ');
}

function platformDenial(symbol, candidates, notes) {
  const context = `[CAPABILITY-INTAKE] Export ${symbol || 'unknown'} requires a valid CORE_INTAKE_ACK=<intake-id> recorded in docs/decisions/*intake*.md. CORE_INTAKE_ACK=1 is invalid. Run: hseos capability-check ${symbol || '<symbol>'}.${candidates.length > 0 ? ` Candidates: ${candidates.join(', ')}` : ''}${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`;
  return denial('capability-intake-required', context);
}

/** The target is the project's bindings file by location or by identity (symlinks, case, separators). */
function isProtectedTarget(root, target) {
  if (target.relative !== null && target.relative.toLowerCase() === PROTECTED_SUFFIX) return true;
  try {
    const bindingsFile = path.join(root, PROJECT_BINDINGS_FILE);
    return fs.realpathSync(bindingsFile).toLowerCase() === target.real.toLowerCase();
  } catch {
    return false;
  }
}

function safeBaseMode(root) {
  try {
    return { mode: readRecordedMode(root).mode, error: null };
  } catch (error) {
    return { mode: 'platform', error: error.message };
  }
}

/**
 * Decision of the capability intake guard when the project has platform bindings
 * (ADR-0046 §2, §4, §5). Returns `{ exitCode, stdout }` in the hook output format of
 * the shell guard: exit 2 with a deny JSON on stdout, or exit 0 (optionally with advisory context).
 * Any problem reading the bindings, the registry or git resolves to the `platform` decision.
 */
function evaluateGuard({ input, cwd = process.cwd(), env = process.env, runtimeRoot, now = new Date() }) {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return allowance('');
  }
  const toolInput = (event && event.tool_input) || {};
  const file = toolInput.file_path || toolInput.path || '';
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits.map((edit) => (edit && edit.new_string) || '').join('\n') : '';
  const content = toolInput.content || toolInput.new_string || edits;
  if (!file) return allowance('');
  const root = projectRoot(cwd);
  const target = resolveTarget(root, file);
  if (isProtectedBindingsPath(file) || isProtectedTarget(root, target)) return denial('platform-bindings-protected', PROTECTED_MESSAGE);
  if (!qualifies(target.relative === null ? target.real : `/${target.relative}`, content)) return allowance('');

  const symbol = extractSymbol(content, languageOf(target.real));
  const notes = [];
  const base = safeBaseMode(root);
  if (base.error) notes.push(`Bindings baseline unavailable (${base.error}); the platform decision applies.`);
  const bindings = loadPlatformBindings({ runtimeRoot, projectDir: root, env, now, baseMode: base.mode });
  for (const error of bindings.errors) notes.push(`Platform bindings problem: ${error}`);
  const mode = base.error ? 'platform' : bindings.mode;

  if (mode === 'local') return allowance('');

  let registry = null;
  try {
    registry = loadCapabilityRegistry({ runtimeRoot, bindings }).registry;
  } catch (error) {
    notes.push(
      `Capability registry unavailable${error instanceof RegistryIntegrityError ? ' (integrity check failed)' : ''}: ${error.message}`,
    );
  }
  if (!registry && mode === 'hybrid') {
    // Without registry data hybrid cannot identify a stable match: fall back to the platform decision.
    return decide({ mode: 'platform', registry, symbol, relative: target.relative, root, env, bindings, notes });
  }
  return decide({ mode, registry, symbol, relative: target.relative, root, env, bindings, notes });
}

function decide({ mode, registry, symbol, relative, root, env, bindings, notes }) {
  const stacks = bindings.stacks && bindings.stacks.length > 0 ? bindings.stacks : detectStacks(root);
  const exported = registry
    ? matchExport(registry, { symbol: symbol || undefined, filePath: relative === null ? undefined : relative, stacks })
    : { matches: [], warnings: [] };
  const warnings = exported.warnings.map((warning) => `Registry warning: ${warning}.`);
  const overridden = exported.matches.filter((match) =>
    bindings.overrides.some((override) => override.capability === match.capability.name),
  );
  const overrideNote =
    overridden.length > 0 ? `Override recorded in platform bindings for ${overridden.map((m) => m.capability.name).join(', ')}.` : '';

  if (validAck(root, env)) return allowance([overrideNote, ...warnings].filter(Boolean).join(' '));

  if (mode === 'hybrid') {
    const blocking = exported.matches.filter((match) => match.stableForStack && !overridden.includes(match));
    if (blocking.length > 0) {
      return denial(
        'capability-intake-required',
        `[CAPABILITY-INTAKE] Export ${symbol || 'unknown'} matches stable platform capabilities for this project's stacks: ${describeMatches(blocking)}. Consume them or record a valid CORE_INTAKE_ACK=<intake-id> in docs/decisions/*intake*.md (CORE_INTAKE_ACK=1 is invalid). Run: hseos capability-check ${symbol || '<symbol>'}.${[...warnings, ...notes].length > 0 ? ` ${[...warnings, ...notes].join(' ')}` : ''}`,
      );
    }
    const advice =
      exported.matches.length > 0
        ? `[CAPABILITY-INTAKE] Advisory: ${symbol || 'this export'} relates to platform capabilities: ${describeMatches(exported.matches)}. None is stable for this project's stacks yet.`
        : '';
    return allowance([advice, overrideNote, ...warnings, ...notes].filter(Boolean).join(' '));
  }

  // platform: today's decision, with registry candidates added to the filesystem ones.
  if (overridden.length > 0) return allowance([overrideNote, ...warnings].join(' '));
  const registryCandidates =
    registry && symbol
      ? resolveCapability(registry, symbol, { stacks })
          .slice(0, MAX_CANDIDATES)
          .map((match) => match.capability.name)
      : [];
  const candidates = [
    ...filesystemCandidates(root, symbol),
    ...registryCandidates.filter((name) => !exported.matches.some((m) => m.capability.name === name)),
    ...exported.matches.map((m) => m.capability.name),
  ];
  return platformDenial(symbol, [...new Set(candidates)], [...warnings, ...notes]);
}

module.exports = {
  PROTECTED_MESSAGE,
  evaluateGuard,
  detectExport,
  extractSymbol,
  isProtectedBindingsPath,
  stripNonCode,
  qualifies,
};
