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

const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

// Bounds keep every scan linear: a regex candidate is abandoned after this many characters, template nesting after this depth.
const MAX_REGEX_LENGTH = 200;
const MAX_TEMPLATE_DEPTH = 64;

/** A `/` at `index` opens a regex literal (not a division) when the previous significant token is not an operand. */
function regexAllowed(content, index) {
  let j = index - 1;
  while (j >= 0 && /\s/.test(content[j])) j -= 1;
  if (j < 0) return true;
  const previous = content[j];
  // `++ /` and `-- /` end an operand; any other operator, bracket or separator starts a regex.
  if ((previous === '+' || previous === '-') && content[j - 1] === previous) return false;
  if (/[(,=:[!&|?{;+\-*%<>~^]/.test(previous)) return true;
  if (!/[\w$]/.test(previous)) return false;
  let start = j;
  while (start > 0 && /[\w$]/.test(content[start - 1])) start -= 1;
  // A keyword used as a property name (`o.in / 2`) is an operand.
  if (start > 0 && content[start - 1] === '.') return false;
  return REGEX_KEYWORDS.has(content.slice(start, j + 1));
}

/** End index (after the flags) of the regex literal opening at `start`, or -1 when it does not close on its line or within the bound. */
function scanRegex(content, start) {
  const limit = Math.min(content.length, start + MAX_REGEX_LENGTH);
  let i = start + 1;
  let inClass = false;
  while (i < limit) {
    const char = content[i];
    if (char === '\n') return -1;
    if (char === '/' && !inClass) {
      // A closing slash that is itself followed by `*` or `/` opens a comment, so this was a division.
      if (content[i + 1] === '*' || content[i + 1] === '/') return -1;
      i += 1;
      while (i < content.length && /[\w$]/.test(content[i])) i += 1;
      return i;
    }
    switch (char) {
      case '\\': {
        i += 2;
        break;
      }
      case '[': {
        inClass = true;
        i += 1;
        break;
      }
      case ']': {
        inClass = false;
        i += 1;
        break;
      }
      default: {
        i += 1;
      }
    }
  }
  return -1;
}

/** End index of the string opening at `start`, or -1 when it is unterminated (a line string ends at a newline). */
function scanString(content, start) {
  const quote = content[start];
  const n = content.length;
  let i = start + 1;
  while (i < n) {
    const char = content[i];
    if (char === quote) return i + 1;
    switch (char) {
      case '\\': {
        i += 2;
        break;
      }
      case '\n': {
        return -1;
      }
      default: {
        i += 1;
      }
    }
  }
  return -1;
}

/** End index of the template literal opening at `start` (its `${}` expressions are lexed), or -1 when unterminated or too deep. */
function scanTemplate(content, start, depth = 0) {
  if (depth > MAX_TEMPLATE_DEPTH) return -1;
  const n = content.length;
  let i = start + 1;
  while (i < n) {
    const char = content[i];
    switch (char) {
      case '\\': {
        i += 2;
        break;
      }
      case '`': {
        return i + 1;
      }
      case '$': {
        if (content[i + 1] === '{') {
          i = scanExpression(content, i + 2, depth + 1);
          if (i === -1) return -1;
        } else {
          i += 1;
        }
        break;
      }
      default: {
        i += 1;
      }
    }
  }
  return -1;
}

/** End index (after the closing brace) of the `${}` expression whose body starts at `start`, or -1 when unterminated. */
function scanExpression(content, start, depth) {
  const n = content.length;
  let braces = 1;
  let i = start;
  while (i < n) {
    const char = content[i];
    const next = content[i + 1];
    switch (char) {
      case '{': {
        braces += 1;
        i += 1;
        break;
      }
      case '}': {
        braces -= 1;
        i += 1;
        if (braces === 0) return i;
        break;
      }
      case '"':
      case "'": {
        i = scanString(content, i);
        if (i === -1) return -1;
        break;
      }
      case '`': {
        i = scanTemplate(content, i, depth);
        if (i === -1) return -1;
        break;
      }
      case '/': {
        if (next === '/') {
          while (i < n && content[i] !== '\n') i += 1;
        } else if (next === '*') {
          const end = content.indexOf('*/', i + 2);
          if (end === -1) return -1;
          i = end + 2;
        } else if (regexAllowed(content, i)) {
          const end = scanRegex(content, i);
          i = end === -1 ? i + 1 : end;
        } else {
          i += 1;
        }
        break;
      }
      default: {
        i += 1;
      }
    }
  }
  return -1;
}

/**
 * Replaces comments and string literals with blanks (strings become `""`) so that text inside them is never
 * mistaken for code. Small lexer, not a parser. Template literals are skipped through their `${}`
 * expressions (nested strings, templates, comments and regexes included) and a `/` that probably starts a regex
 * literal only shields that literal's `/*` and `//` from opening a comment: its text stays inspected, so a wrong
 * regex-versus-division guess can never hide code (a false positive asks for an intake; a false negative would not). Fail-safe: a construct that never closes (an unclosed block comment, a template or a
 * triple-quoted string without its end, a quote without its closing quote on the line) is kept as raw text so it
 * stays inspected instead of hiding the rest of the file. `language` is `cs` for C# (verbatim `@"…"`,
 * interpolated `$"…"`, raw `"""…"""`) and `js` otherwise.
 */
function lexAware(content, language = 'js') {
  const cs = language === 'cs';
  let out = '';
  let i = 0;
  let regexZoneEnd = 0;
  const n = content.length;
  const skipVerbatim = (start) => {
    // `start` is the opening quote; returns the end index or -1 when it never closes.
    let j = start + 1;
    while (j < n) {
      if (content[j] === '"') {
        if (content[j + 1] === '"') {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j += 1;
    }
    return -1;
  };
  while (i < n) {
    const char = content[i];
    const next = content[i + 1];
    if (char === '/' && i < regexZoneEnd) {
      out += char;
      i += 1;
    } else if (char === '/' && next === '/') {
      while (i < n && content[i] !== '\n') i += 1;
    } else if (char === '/' && next === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) {
        out += content.slice(i);
        i = n;
      } else {
        out += content.slice(i, end + 2).replaceAll(/[^\n]/g, ' ');
        i = end + 2;
      }
    } else if (cs && (char === '@' || char === '$') && /^[@$]{1,2}"/.test(content.slice(i, i + 3))) {
      const prefix = content.slice(i, i + 2).match(/^[@$]{1,2}/)[0];
      const quote = i + prefix.length;
      const end = prefix.includes('@') ? skipVerbatim(quote) : scanString(content, quote);
      if (end === -1) {
        out += content.slice(i);
        i = n;
      } else {
        i = end;
        out += '""';
      }
    } else if (cs && char === '"' && content.startsWith('"""', i)) {
      const quotes = content.slice(i, i + 64).match(/^"+/)[0];
      const end = content.indexOf(quotes, i + quotes.length);
      if (end === -1) {
        out += content.slice(i);
        i = n;
      } else {
        i = end + quotes.length;
        out += '""';
      }
    } else if (char === '"' || char === "'") {
      const end = scanString(content, i);
      if (end === -1) {
        const lineEnd = content.indexOf('\n', i);
        const stop = lineEnd === -1 ? n : lineEnd;
        out += content.slice(i, stop);
        i = stop;
      } else {
        i = end;
        out += '""';
      }
    } else if (!cs && char === '`') {
      const end = scanTemplate(content, i);
      if (end === -1) {
        out += content.slice(i);
        i = n;
      } else {
        i = end;
        out += '""';
      }
    } else if (!cs && char === '/' && regexAllowed(content, i)) {
      // A probable regex literal only shields the slashes inside it from opening a comment. Nothing is skipped or
      // hidden: strings and everything else are lexed as usual, so a wrong regex-versus-division guess can never
      // make the lexer see less than it would without the guess.
      const end = scanRegex(content, i);
      if (end !== -1) regexZoneEnd = end;
      out += char;
      i += 1;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/*
 * Union of two lexers (the property is true by construction, not by testing): the inspected text is the output of
 * `lexAware` followed by the output of `lexLegacy`, so everything the legacy lexer left visible is also inspected, and
 * `lexAware` can only reveal more (code the legacy lexer hid behind a `/*` inside a regex literal). A wrong regex
 * guess in `lexAware` can therefore never hide code. The cost is an occasional false positive, which asks for an
 * intake. `lexLegacy` below is the lexer of the previous release, byte for byte apart from its name (a test pins it).
 */
/**
 * Replaces comments and string literals with blanks (strings become `""`) so that text inside them is never
 * mistaken for code. Small lexer, not a parser: `${}` inside template literals is not evaluated, regex literals
 * are not recognised, and single- and double-quoted strings end at a newline so a stray quote cannot swallow the
 * rest of the file. `language` is `cs` for C# (verbatim `@"…"`, interpolated `$"…"`, raw `"""…"""`) and `js` otherwise.
 */
function lexLegacy(content, language = 'js') {
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

const blankReexports = (code) => code.replaceAll(REEXPORT, (match) => match.replaceAll(/[^\n]/g, ' '));

/** The text inspected for exports: both lexings, separated so that no match can span the boundary. */
function inspectedCode(content, language = 'js') {
  return `${blankReexports(lexAware(content, language))}\n;\n${blankReexports(lexLegacy(content, language))}`;
}

/** First export in document order: `{ symbol }` (null when anonymous) or null when `content` exports nothing. */
function detectExport(content, language = 'js') {
  const code = inspectedCode(content, language);
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
  stripNonCode: lexAware,
  lexAware,
  lexLegacy,
  inspectedCode,
  qualifies,
};
