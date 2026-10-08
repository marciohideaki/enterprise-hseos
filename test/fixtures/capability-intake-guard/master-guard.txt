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

// Re-exports with a `from` clause forward an existing module; they introduce no new capability. Found by a scan that
// looks for the head of the statement and, for `{ ... }`, for the next closing brace once (a single regex with
// `[^}]*` rescans to the end of the file for every unclosed `export {`, which is quadratic).
const REEXPORT_HEAD = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{)/g;
const REEXPORT_TAIL = /\s*from\s*""/y;

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

/**
 * End index (after the flags) of the regex literal opening at `start`, or -1 when it does not close on its line or within the bound.
 * `lenient` also accepts a closing slash followed by `/` or `*` (a regex directly before a comment) when the body holds a slash.
 */
function scanRegex(content, start, lenient = false) {
  const limit = Math.min(content.length, start + MAX_REGEX_LENGTH);
  let i = start + 1;
  let inClass = false;
  while (i < limit) {
    const char = content[i];
    if (char === '\n') return -1;
    if (char === '/' && !inClass) {
      // A closing slash that is itself followed by `*` or `/` opens a comment, so this was a division.
      // Lenient: only a body that itself holds a slash (a class or escape holding `/*` or `//`) is worth reading as a regex
      // here; `b / c; // note` is a division followed by a comment and must keep its comment.
      if ((content[i + 1] === '*' || content[i + 1] === '/') && (!lenient || !content.slice(start + 1, i).includes('/'))) {
        return -1;
      }
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
function scanTemplate(content, start, depth = 0, ctx = null) {
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
          i = scanExpression(content, i + 2, depth + 1, ctx);
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
function scanExpression(content, start, depth, ctx = null) {
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
        i = scanTemplate(content, i, depth, ctx);
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
        } else if (ctx !== null && ctx.aggressive) {
          // Aggressive pass: every code `/` inside the expression is tried as a regex, whatever the guess says, so a
          // regex after `)`, `}` or a keyword (`if (x) /'/.test(y)`) cannot open a string that swallows the template's end.
          const end = scanRegex(content, i);
          i = end === -1 ? i + 1 : end;
        } else {
          if (ctx !== null) ctx.probe.slash = true;
          if (regexAllowed(content, i)) {
            const end = scanRegex(content, i);
            i = end === -1 ? i + 1 : end;
          } else {
            i += 1;
          }
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

// Characters that can open a comment, string, regex, template or C# string.
const LEXER_TRIGGER = /[/"'`@$]/;

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
function lexAware(content, language = 'js', opaqueRegex = false, probe = null, aggressive = false) {
  const cs = language === 'cs';
  // `probe` (default pass) records where a `/` that is code, not a comment, shares a line with a string or template
  // opener (`suspect` holds those line starts): the quote may really sit inside a regex literal the guess missed. The
  // `aggressive` pass (a further inspected text) reads it: it treats every such `/` as a possible regex, and leaves
  // quotes on the suspect lines unopened, so they cannot swallow the code after them. Both only add visible text.
  const suspect = aggressive ? probe.suspect : null;
  // Template expressions report their code slashes to the probe (default pass) or read every one as a regex (aggressive pass).
  const templateCtx = probe === null ? null : { aggressive, probe };
  let lineStart = -1;
  let lineEnd = -1;
  const lineStartOf = (index) => {
    if (index < lineStart || index > lineEnd) {
      lineStart = index === 0 ? 0 : content.lastIndexOf('\n', index - 1) + 1;
      lineEnd = content.indexOf('\n', index);
      if (lineEnd === -1) lineEnd = n;
    }
    return lineStart;
  };
  const noteSlash = () => {
    probe.slash = true;
    probe.slashLine = lineStartOf(i);
  };
  const noteOpener = () => {
    if (probe.slashLine !== -1 && lineStartOf(i) === probe.slashLine) probe.suspect.add(probe.slashLine);
  };
  // Opaque mode (a third inspected text, see `inspectedSegments`): a probable regex literal is skipped whole and kept as
  // raw text, so a quote or backtick inside it can never open a string that swallows the code after it. A candidate
  // that does not close on its line is kept raw up to the end of the line. `differs` records whether that changed
  // anything; when it did not, the mode returns null (the other two texts already hold the same output).
  let differs = false;
  // Output is built from slices of `content` (verbatim runs are copied lazily) instead of one character at a time.
  const out = [];
  let pending = 0;
  let i = 0;
  let regexZoneEnd = 0;
  const n = content.length;
  const flush = (upto) => {
    if (upto > pending) out.push(content.slice(pending, upto));
  };
  const replace = (replacement, end) => {
    flush(i);
    out.push(replacement);
    i = end;
    pending = end;
  };
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
    const code = content.codePointAt(i);
    // Only `/`, `"`, `'`, a backtick, `@` and `$` can open anything: every other character is copied as is.
    if (code !== 47 && code !== 34 && code !== 39 && code !== 96 && code !== 64 && code !== 36) {
      i += 1;
      continue;
    }
    const char = content[i];
    const next = content[i + 1];
    if (char === '/' && i < regexZoneEnd) {
      if (aggressive === 2) {
        // Wide pass: a regex can also start at a slash that a wider candidate swallowed (`a / /[/*]/`, a division then a regex). Strict close here: a lenient one would shield the `//` of a real comment after a regex.
        const reach = scanRegex(content, i);
        if (reach > regexZoneEnd) regexZoneEnd = reach;
      }
      i += 1;
    } else if (char === '/' && next === '/') {
      flush(i);
      while (i < n && content[i] !== '\n') i += 1;
      pending = i;
    } else if (char === '/' && next === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) i = n;
      else replace(content.slice(i, end + 2).replaceAll(/[^\n]/g, ' '), end + 2);
    } else if (cs && (char === '@' || char === '$') && /^[@$]{1,2}"/.test(content.slice(i, i + 3))) {
      const prefix = content.slice(i, i + 2).match(/^[@$]{1,2}/)[0];
      const quote = i + prefix.length;
      const end = prefix.includes('@') ? skipVerbatim(quote) : scanString(content, quote);
      if (end === -1) i = n;
      else replace('""', end);
    } else if (cs && char === '"' && content.startsWith('"""', i)) {
      const quotes = content.slice(i, i + 64).match(/^"+/)[0];
      const end = content.indexOf(quotes, i + quotes.length);
      if (end === -1) i = n;
      else replace('""', end + quotes.length);
    } else if (
      suspect !== null &&
      suspect.size > 0 &&
      (char === '"' || char === "'" || (!cs && char === '`')) &&
      suspect.has(lineStartOf(i))
    ) {
      i += 1;
    } else if (char === '"' || char === "'") {
      if (probe !== null && !aggressive) noteOpener();
      const end = scanString(content, i);
      if (end === -1) {
        const lineEnd = content.indexOf('\n', i);
        i = lineEnd === -1 ? n : lineEnd;
      } else {
        replace('""', end);
      }
    } else if (!cs && char === '`') {
      if (probe !== null && !aggressive) noteOpener();
      const end = scanTemplate(content, i, 0, templateCtx);
      if (end === -1) i = n;
      else replace('""', end);
    } else if (aggressive && !cs && char === '/') {
      const end = scanRegex(content, i, aggressive === 2);
      if (end > regexZoneEnd) regexZoneEnd = end;
      i += 1;
    } else if (!cs && char === '/' && regexAllowed(content, i)) {
      if (probe !== null) noteSlash();
      // A probable regex literal only shields the slashes inside it from opening a comment. Nothing is skipped or
      // hidden: strings and everything else are lexed as usual, so a wrong regex-versus-division guess can never
      // make the lexer see less than it would without the guess.
      const end = scanRegex(content, i);
      if (opaqueRegex) {
        if (end === -1) {
          differs = true;
          const lineEnd = content.indexOf('\n', i);
          i = lineEnd === -1 ? n : lineEnd;
        } else {
          if (!differs && /['"`]/.test(content.slice(i, end))) differs = true;
          i = end;
        }
      } else {
        if (end !== -1) regexZoneEnd = end;
        i += 1;
      }
    } else {
      if (probe !== null && !cs && char === '/') noteSlash();
      i += 1;
    }
  }
  if (opaqueRegex && (cs || !differs)) return null;
  flush(n);
  return out.join('');
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

/**
 * Same output as `lexLegacy` (a test compares them on a fuzzed corpus), built from slices instead of one character at
 * a time. `lexLegacy` stays as the pinned reference of the previous release; the union uses this one for speed.
 */
function lexLegacyFast(content, language = 'js') {
  const cs = language === 'cs';
  const out = [];
  let pending = 0;
  let i = 0;
  const n = content.length;
  const replace = (replacement, start) => {
    if (start > pending) out.push(content.slice(pending, start));
    out.push(replacement);
    pending = i;
  };
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
    const code = content.codePointAt(i);
    if (code !== 47 && code !== 34 && code !== 39 && code !== 96 && code !== 64 && code !== 36) {
      i += 1;
      continue;
    }
    const char = content[i];
    const next = content[i + 1];
    const start = i;
    if (char === '/' && next === '/') {
      while (i < n && content[i] !== '\n') i += 1;
      replace('', start);
    } else if (char === '/' && next === '*') {
      const end = content.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      replace(content.slice(start, i).replaceAll(/[^\n]/g, ' '), start);
    } else if (cs && (char === '@' || char === '$') && /^[@$]{1,2}"/.test(content.slice(i, i + 3))) {
      const prefix = content.slice(i, i + 3).match(/^[@$]{1,2}/)[0];
      i += prefix.length;
      skipQuoted('"', { verbatim: prefix.includes('@') });
      replace('""', start);
    } else if (cs && char === '"' && content.startsWith('"""', i)) {
      let quoteEnd = i;
      while (content[quoteEnd] === '"') quoteEnd += 1;
      const quotes = content.slice(i, quoteEnd);
      const end = content.indexOf(quotes, quoteEnd);
      i = end === -1 ? n : end + quotes.length;
      replace('""', start);
    } else if (char === '"' || char === "'" || (!cs && char === '`')) {
      skipQuoted(char);
      replace('""', start);
    } else {
      i += 1;
    }
  }
  if (n > pending) out.push(content.slice(pending, n));
  return out.join('');
}

function blankReexports(code) {
  const out = [];
  let copied = 0;
  let close = -2;
  REEXPORT_HEAD.lastIndex = 0;
  let head;
  while ((head = REEXPORT_HEAD.exec(code)) !== null) {
    let end = REEXPORT_HEAD.lastIndex;
    if (code[end - 1] === '{') {
      // Amortized linear: the next `}` is searched again only once the scan has passed the previous one.
      if (close !== -1 && close < end) close = code.indexOf('}', end);
      if (close === -1) {
        REEXPORT_HEAD.lastIndex = head.index + 1;
        continue;
      }
      end = close + 1;
    }
    REEXPORT_TAIL.lastIndex = end;
    const tail = REEXPORT_TAIL.exec(code);
    if (!tail) {
      REEXPORT_HEAD.lastIndex = head.index + 1;
      continue;
    }
    const stop = REEXPORT_TAIL.lastIndex;
    out.push(code.slice(copied, head.index), code.slice(head.index, stop).replaceAll(/[^\n]/g, ' '));
    copied = stop;
    REEXPORT_HEAD.lastIndex = stop;
  }
  out.push(code.slice(copied));
  return out.join('');
}

/** The inspected texts (regex-aware lexing, an optional regex-opaque lexing, then legacy lexing last), each with its local re-exports blanked. */
function inspectedSegments(content, language = 'js') {
  if (!LEXER_TRIGGER.test(content)) {
    // Nothing in the text can open a comment, string, regex or template, so both lexings return it unchanged.
    const code = blankReexports(content);
    return [code, code];
  }
  // The legacy lexing of the text as given stays the LAST segment; the extra views below go before it.
  const segments = lexedViews(content, language);
  const legacy = segments.pop();
  // JavaScript also ends a line at a lone CR, U+2028 and U+2029, while the lexers end a `//` comment at LF only: code after
  // such a terminator is real but would read as comment. A second set of views is taken over the text with those
  // terminators turned into LF (same length), so the code after them shows. CRLF files do not trigger this.
  const lone = LONE_TERMINATOR.test(content);
  const normalized = lone ? content.replaceAll(/[\r\u2028\u2029]/g, '\n') : content;
  if (lone) segments.push(...lexedViews(normalized, language));
  // A string line continuation written as backslash, CR, LF is one continuation in JavaScript, but the lexers skip the
  // backslash and the CR and then end the string at the LF. The same views are taken over the text with that sequence
  // turned into backslash, LF, space (same length), so the string reads as continued.
  if (CRLF_CONTINUATION.test(content)) {
    const continued = content.replaceAll('\\\r\n', '\\\n ');
    segments.push(...lexedViews(continued, language));
    if (LONE_TERMINATOR.test(continued)) segments.push(...lexedViews(continued.replaceAll(/[\r\u2028\u2029]/g, '\n'), language));
  }
  // A hashbang line (`#!` at the very start of a JavaScript file) is a line comment, but the lexers read its quotes,
  // backticks and `/*` as openers that swallow the code after it. The same views are taken over the text with that line
  // blanked (same length).
  if (language !== 'cs' && content.startsWith('#!')) segments.push(...lexedViews(blankHashbang(normalized), language));
  segments.push(legacy);
  return segments;
}

/** The text with a leading hashbang line replaced by spaces (a hashbang ends at LF, CR, U+2028 or U+2029). */
function blankHashbang(text) {
  const end = text.search(/[\n\r\u2028\u2029]/);
  const stop = end === -1 ? text.length : end;
  return ' '.repeat(stop) + text.slice(stop);
}

const LONE_TERMINATOR = /\r(?!\n)|[\u2028\u2029]/;
const CRLF_CONTINUATION = /\\\r\n/;

function lexedViews(content, language) {
  const probe = { slash: false, slashLine: -1, suspect: new Set() };
  const segments = [blankReexports(lexAware(content, language, false, probe))];
  // Fourth text, only when the default lexing met a `/` in code: every such `/` is tried as a regex and the quotes that
  // share its line stay unopened (`if (x) /'/.test(y); export class X {} // '`, where the regex follows `)`, `}` or a
  // keyword the guess calls an operand). It can only add to what is inspected, never remove.
  if (probe.slash && language !== 'cs') {
    // The second pass is a wide variant of the same pass: a closing slash may be followed by a comment, and a regex may start
    // at a slash an earlier candidate swallowed (`x = a / /[/*]/.source`, `if (a) /[/*]/// c`). Added next to the first, never in place of it.
    segments.push(
      blankReexports(lexAware(content, language, false, probe, true)),
      blankReexports(lexAware(content, language, false, probe, 2)),
    );
  }
  // Third text, only when a regex literal holds a quote or backtick (or does not close): the regex is read as opaque, so
  // `/'/; export class X {} // '` shows its export. It can only add to what is inspected, never remove.
  const opaque = lexAware(content, language, true);
  if (opaque !== null) segments.push(blankReexports(opaque));
  segments.push(blankReexports(lexLegacyFast(content, language)));
  return segments;
}

/** The text inspected for exports: both lexings, separated so that no match can span the boundary. */
function inspectedCode(content, language = 'js') {
  return inspectedSegments(content, language).join('\n;\n');
}

/**
 * Every export found in the inspected text (the union of both lexings), in document order:
 * `{ symbols, anonymous, symbol }` or null when `content` exports nothing. `symbols` holds each distinct exported
 * name, `anonymous` is true when some export carries no name (`export { a }`, `export default expr`, CommonJS
 * `module.exports`), and `symbol` is the first named export (null when none) for callers that need one.
 * The guard decides over ALL of them: a decision taken on the first export alone could be steered by a lexing
 * quirk that puts a harmless export ahead of a denied one.
 */
function detectExports(content, language = 'js') {
  // An identical second segment would only repeat the same matches, so it is scanned once.
  const code = [...new Set(inspectedSegments(content, language))].join('\n;\n');
  const found = [];
  for (const form of EXPORT_FORMS) {
    form.lastIndex = 0;
    for (const match of code.matchAll(form)) found.push({ index: match.index, symbol: match[1] || null });
  }
  if (found.length === 0) return null;
  // `export default class Name` matches both the named and the bare `export default` form at one index: keep the named one.
  const named = new Set(found.filter((entry) => entry.symbol).map((entry) => entry.index));
  const kept = found.filter((entry) => entry.symbol || !named.has(entry.index)).sort((a, b) => a.index - b.index);
  const symbols = [...new Set(kept.filter((entry) => entry.symbol).map((entry) => entry.symbol))];
  return { symbols, anonymous: kept.some((entry) => !entry.symbol), symbol: symbols[0] || null };
}

/** `{ symbol }` (the first named export, null when none is named) or null when `content` exports nothing; see `detectExports`. */
function detectExport(content, language = 'js') {
  const found = detectExports(content, language);
  return found && { symbol: found.symbol };
}

function languageOf(file) {
  return /\.cs$/i.test(file) ? 'cs' : 'js';
}

/** `file` is matched as given (a project-relative path gets a leading slash from the caller). */
function qualifies(file, content) {
  return !EXCLUDED_FILE.test(file) && WATCHED_FILE.test(file) && detectExports(content, languageOf(file)) !== null;
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
  const context = `[CAPABILITY-INTAKE] Export ${symbol || 'unknown'} requires a valid CORE_INTAKE_ACK=<intake-id> recorded in docs/decisions/*intake*.md. CORE_INTAKE_ACK=1 is invalid. Run: hseos capability-check ${(symbol || '').split(', ')[0] || '<symbol>'}.${candidates.length > 0 ? ` Candidates: ${candidates.join(', ')}` : ''}${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`;
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

  // Every export of the content, not just the first: the decision is taken over all of them (deny if any would be denied).
  const detected = detectExports(content, languageOf(target.real));
  const symbols = detected ? [...detected.symbols, ...(detected.anonymous || detected.symbols.length === 0 ? [null] : [])] : [null];
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
    return decide({ mode: 'platform', registry, symbols, relative: target.relative, root, env, bindings, notes });
  }
  return decide({ mode, registry, symbols, relative: target.relative, root, env, bindings, notes });
}

/** Names for messages: the named exports joined, or the fallback for an export without a name. */
function nameList(symbols, fallback) {
  const names = symbols.filter(Boolean);
  return names.length > 0 ? names.join(', ') : fallback;
}

function decide({ mode, registry, symbols, relative, root, env, bindings, notes }) {
  const stacks = bindings.stacks && bindings.stacks.length > 0 ? bindings.stacks : detectStacks(root);
  // One lookup per export; a capability matched by several exports is reported once and remembers which symbols hit it.
  const byCapability = new Map();
  const warningSet = new Set();
  const perSymbol = [];
  for (const symbol of symbols) {
    const result = registry
      ? matchExport(registry, { symbol: symbol || undefined, filePath: relative === null ? undefined : relative, stacks })
      : { matches: [], warnings: [] };
    perSymbol.push({ symbol, matches: result.matches });
    for (const warning of result.warnings) warningSet.add(warning);
    for (const match of result.matches) {
      const known = byCapability.get(match.capability.name);
      if (!known) byCapability.set(match.capability.name, { match, symbols: symbol ? [symbol] : [] });
      else if (symbol && !known.symbols.includes(symbol)) known.symbols.push(symbol);
    }
  }
  const matched = [...byCapability.values()].map((entry) => entry.match).sort((a, b) => (a.capability.name < b.capability.name ? -1 : 1));
  const warnings = [...warningSet].sort().map((warning) => `Registry warning: ${warning}.`);
  const overridden = matched.filter((match) => bindings.overrides.some((override) => override.capability === match.capability.name));
  const overrideNote =
    overridden.length > 0 ? `Override recorded in platform bindings for ${overridden.map((m) => m.capability.name).join(', ')}.` : '';
  const describe = (list) =>
    list
      .map((match) => {
        const hit = byCapability.get(match.capability.name).symbols;
        return `${describeMatches([match])}${hit.length > 0 ? ` <- ${hit.join(', ')}` : ''}`;
      })
      .join('; ');

  if (validAck(root, env)) return allowance([overrideNote, ...warnings].filter(Boolean).join(' '));

  if (mode === 'hybrid') {
    // Deny when ANY export of the content matches a stable, non-overridden capability.
    const blocking = matched.filter((match) => match.stableForStack && !overridden.includes(match));
    if (blocking.length > 0) {
      const named = [...new Set(blocking.flatMap((match) => byCapability.get(match.capability.name).symbols))];
      return denial(
        'capability-intake-required',
        `[CAPABILITY-INTAKE] Export ${nameList(named.length > 0 ? named : symbols, 'unknown')} matches stable platform capabilities for this project's stacks: ${describe(blocking)}. Consume them or record a valid CORE_INTAKE_ACK=<intake-id> in docs/decisions/*intake*.md (CORE_INTAKE_ACK=1 is invalid). Run: hseos capability-check ${named[0] || symbols.find(Boolean) || '<symbol>'}.${[...warnings, ...notes].length > 0 ? ` ${[...warnings, ...notes].join(' ')}` : ''}`,
      );
    }
    const advice =
      matched.length > 0
        ? `[CAPABILITY-INTAKE] Advisory: ${nameList(symbols, 'this export')} relates to platform capabilities: ${describe(matched)}. None is stable for this project's stacks yet.`
        : '';
    return allowance([advice, overrideNote, ...warnings, ...notes].filter(Boolean).join(' '));
  }

  // platform: today's decision, with registry candidates added to the filesystem ones.
  // An override only covers the exports whose own matches include an overridden capability; any uncovered export denies.
  const isOverridden = (match) => overridden.includes(match) || bindings.overrides.some((o) => o.capability === match.capability.name);
  const uncovered = perSymbol.filter((entry) => !entry.matches.some(isOverridden)).map((entry) => entry.symbol);
  if (uncovered.length === 0) return allowance([overrideNote, ...warnings].join(' '));
  const named = uncovered.filter(Boolean);
  const registryCandidates = registry
    ? named.flatMap((symbol) =>
        resolveCapability(registry, symbol, { stacks })
          .slice(0, MAX_CANDIDATES)
          .map((match) => match.capability.name),
      )
    : [];
  const candidates = [
    ...(named.length > 0 ? named : [null]).flatMap((symbol) => filesystemCandidates(root, symbol)),
    ...registryCandidates.filter((name) => !byCapability.has(name)),
    ...matched.map((m) => m.capability.name),
  ];
  return platformDenial(nameList(uncovered, ''), [...new Set(candidates)], [...warnings, ...notes]);
}

module.exports = {
  PROTECTED_MESSAGE,
  evaluateGuard,
  detectExport,
  detectExports,
  extractSymbol,
  isProtectedBindingsPath,
  stripNonCode: lexAware,
  lexAware,
  lexLegacy,
  lexLegacyFast,
  inspectedCode,
  qualifies,
};
