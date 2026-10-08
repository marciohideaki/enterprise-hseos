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
  /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|class|const\s+enum|enum|const|let|var|interface|type|namespace|module)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s*[{*=]/g,
  /\bexport\s+type\s*\{/g,
  // Forms the first list does not match (a generator whose `*` is glued to the name, TypeScript's `export import X =`, a decorator
  // between `export` and `class`); added next to the others, never instead of them.
  /\bexport\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*\s*([A-Za-z_$][\w$]*)/g,
  /\bexport\s+import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*=/g,
  /\bexport\s+(?:default\s+)?(?:declare\s+)?(?:@[\w$.]+(?:\s*\([^()]*\))?\s*)+(?:abstract\s+)?class\s+(?!(?:extends|implements)\b)([A-Za-z_$][\w$]*)/g,
  /\bmodule\.exports\b/g,
  /\bexports\.([A-Za-z_$][\w$]*)\s*=/g,
  /\b(?:public|internal)\s+(?:(?:sealed|static|abstract|partial|readonly|unsafe|new)\s+)*(?:(?:class|record|struct|interface|enum)\s+(?:(?:class|struct)\s+)?)([A-Za-z_]\w*)/g,
];
// Identifiers may start with any Unicode ID_Start character or a `\uXXXX` / `\u{X}` escape, and continue with ID_Continue; the
// forms above only see ASCII. The same forms with that identifier class are scanned in addition (never instead), and only when
// the text holds a non-ASCII character or a `\u` escape, so every symbol found before is still found.
const UNICODE_ESCAPE = String.raw`\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})`;
const UNICODE_IDENTIFIER = String.raw`(?:[\p{ID_Start}$_]|${UNICODE_ESCAPE})(?:[\p{ID_Continue}$\u200c\u200d]|${UNICODE_ESCAPE})*`;
const UNICODE_FORMS = EXPORT_FORMS.flatMap((form) => {
  const source = form.source
    .replace(String.raw`[A-Za-z_$][\w$]*`, UNICODE_IDENTIFIER)
    .replace(String.raw`[A-Za-z_]\w*`, UNICODE_IDENTIFIER);
  return source === form.source ? [] : [new RegExp(source, 'gu')];
});
const UNICODE_TRIGGER = /[^\p{ASCII}]|\\u/u;
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

// ---- Real tokenizer (JavaScript and TypeScript), an extra view next to the legacy views below ----

// Bound that keeps every regex scan linear: a candidate is abandoned after this many characters.
const MAX_REGEX_LENGTH = 200;

const CLOSED_OPERANDS = new Set(['name', 'num', 'str', 'regex', 'tmpl', ']', 'incdec']);

const LINE_BREAK = /[\n\r\u2028\u2029]/;

// Contexts of the tokenizer stack (the model acorn's own tokenizer uses to tell a regex from a division).
const CTX_B_STAT = 0; // `{` of a block
const CTX_B_EXPR = 1; // `{` of an object or other expression
const CTX_B_TMPL = 2; // `${` of a template literal
const CTX_P_STAT = 3; // `(` after if, for, while or with
const CTX_P_EXPR = 4; // any other `(`
const CTX_F_STAT = 5; // a function or class declaration (until its body closes)
const CTX_F_EXPR = 6; // a function or class expression
const CTX_IS_EXPR = [false, true, true, false, true, false, true];

const KEYWORDS_BEFORE_EXPR = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'default',
  'extends',
  'try',
  'finally',
]);
const KEYWORDS = new Set([
  ...KEYWORDS_BEFORE_EXPR,
  'break',
  'catch',
  'continue',
  'debugger',
  'for',
  'function',
  'if',
  'switch',
  'var',
  'const',
  'while',
  'with',
  'this',
  'super',
  'class',
  'export',
  'import',
  'null',
  'true',
  'false',
]);

function isIdentChar(code) {
  if (code < 128)
    return (
      (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 95 || code === 36 || code === 92
    );
  return !/\s/.test(String.fromCodePoint(code));
}

/** End index of the string literal opening at `start`, or -1 when it is unterminated (a line ends it, an escaped terminator continues it). */
function scanJsString(content, start) {
  const quote = content.codePointAt(start);
  const n = content.length;
  let i = start + 1;
  while (i < n) {
    const code = content.codePointAt(i);
    if (code === quote) return i + 1;
    if (code === 92) {
      i += content.codePointAt(i + 1) === 13 && content.codePointAt(i + 2) === 10 ? 3 : 2;
    } else if (code === 10 || code === 13) {
      return -1;
    } else {
      i += 1;
    }
  }
  return -1;
}

/** End index (after the flags) of the regex literal opening at `start`, or -1 when it does not close on its line or within the bound. */
function scanTokenRegex(content, start) {
  const limit = Math.min(content.length, start + MAX_REGEX_LENGTH);
  let i = start + 1;
  let inClass = false;
  while (i < limit) {
    const code = content.codePointAt(i);
    if (code === 10 || code === 13 || code === 0x20_28 || code === 0x20_29) return -1;
    switch (code) {
      case 92: {
        const next = content.codePointAt(i + 1);
        if (next === 10 || next === 13 || next === 0x20_28 || next === 0x20_29) return -1;
        i += 2;

        break;
      }
      case 91: {
        inClass = true;
        i += 1;

        break;
      }
      case 93: {
        inClass = false;
        i += 1;

        break;
      }
      default: {
        if (code === 47 && !inClass) {
          i += 1;
          while (i < content.length && isIdentChar(content.codePointAt(i))) i += 1;
          return i;
        } else {
          i += 1;
        }
      }
    }
  }
  return -1;
}

/** End index of the end of the template quasi starting at `from`, and what ended it: `{ end, kind }`, kind `close`, `expr` (a `${`) or `eof`. */
function scanQuasi(content, from) {
  const n = content.length;
  let i = from;
  while (i < n) {
    const code = content.codePointAt(i);
    if (code === 92) {
      i += 2;
    } else if (code === 96) {
      return { end: i + 1, kind: 'close' };
    } else if (code === 36 && content.codePointAt(i + 1) === 123) {
      return { end: i + 2, kind: 'expr' };
    } else {
      i += 1;
    }
  }
  return { end: n, kind: 'eof' };
}

/**
 * Replaces comments and string literals with blanks (strings and the text parts of templates become `""`, line comments
 * disappear, block comments become spaces) so that text inside them is never mistaken for code. A single pass over the
 * text that never throws and holds a real token context, the model acorn's tokenizer uses: a stack of `(` (marked when
 * opened after if, while, for or with), blocks, objects and `${}`, plus the previous significant token. That decides
 * whether a `/` opens a regex literal or divides, and whether a `}` closes a block (a regex may follow) or an
 * expression (a division follows). A regex literal is left in the output as written (it is not a comment or a string),
 * and so is the code inside `${}`. An ambiguous or unfinished construct stays visible: an unterminated string keeps its
 * line, and an unclosed block comment or template keeps the rest of the text. TypeScript, JSX and decorators are
 * tolerated without being parsed.
 */
function tokenizeCore(content, jsx = false, readings = null) {
  const n = content.length;
  let ambiguous = 0;
  // JSX (only read when `jsx` is on, as an extra view): the text between tags is plain text, where `'`, `//` and `/*` open nothing.
  // `jsxCandidates` counts the `<` that may open an element, so the caller knows whether the extra view is worth taking.
  let jsxCandidates = 0;
  let jsxDepth = 0;
  let jsxText = false;
  let jsxTagLevel = -1; // stack length of the open tag head being read, -1 when none
  const jsxFrames = [];
  const out = [];
  let pending = 0;
  let i = 0;
  const stack = [CTX_B_STAT];
  // How many `${` of a template are open in `stack` (kept apart so asking is O(1), not a scan of a deep stack of braces).
  let templateDepth = 0;
  // The previous significant token: its kind (a keyword, `name`, `num`, `str`, `regex`, `tmpl`, or the punctuator), whether
  // an expression may follow it by itself (`prevBeforeExpr`), and whether a `/` after it starts a regex (`exprAllowed`).
  let prev = 'start';
  let forAwait = false; // the previous token is the `await` of `for await`
  let prevBeforeExpr = false;
  let exprAllowed = true;
  let lastEnd = 0;
  // The previous token ends an operand only under one reading (a TypeScript non-null `!`, an object or type-literal `}`): a `/` after
  // it on the same line is enumerated as a regex and as a division, like the one after a line break.
  let sameLineAmbiguous = false;
  let outermostTemplate = null;
  const flush = (upto) => {
    if (upto > pending) out.push(content.slice(pending, upto));
  };
  const token = (kind, beforeExpr, allowed) => {
    forAwait = false;
    prev = kind;
    prevBeforeExpr = beforeExpr;
    exprAllowed = allowed;
    lastEnd = i;
    sameLineAmbiguous = false;
  };
  const lineBreakBefore = (at) => {
    for (let k = lastEnd; k < at; k += 1) {
      const c = content.codePointAt(k);
      if (c === 10 || c === 13 || c === 0x20_28 || c === 0x20_29) return true;
    }
    return false;
  };
  // Ambiguous slashes (see the `/` case) are settled locally: both readings are run to the end of the line from a saved
  // state, and the line stays visible as written. Nothing is enumerated, so the passes over the text do not depend on how
  // many ambiguous slashes there are. A nested ambiguity inside a run, or readings that leave the line in different states,
  // fail closed: the rest of the text stays visible.
  let simulating = false;
  let simFailed = false;
  const save = () => ({
    i,
    pending,
    prev,
    forAwait,
    prevBeforeExpr,
    exprAllowed,
    lastEnd,
    sameLineAmbiguous,
    ambiguous,
    jsxCandidates,
    jsxDepth,
    jsxText,
    jsxTagLevel,
    jsxFrames: [...jsxFrames],
    stack: [...stack],
    templateDepth,
    outLength: out.length,
    outermostTemplate,
  });
  const restore = (state) => {
    ({ i, pending, prev, forAwait, prevBeforeExpr, exprAllowed, lastEnd, sameLineAmbiguous, ambiguous, jsxCandidates } = state);
    ({ jsxDepth, jsxText, jsxTagLevel, outermostTemplate } = state);
    jsxFrames.length = 0;
    jsxFrames.push(...state.jsxFrames);
    stack.length = 0;
    stack.push(...state.stack);
    templateDepth = state.templateDepth;
    out.length = state.outLength;
  };
  const sameState = (a, b, eol) => {
    if (
      a.i !== b.i ||
      a.stack.length !== b.stack.length ||
      a.exprAllowed !== b.exprAllowed ||
      a.prevBeforeExpr !== b.prevBeforeExpr ||
      a.forAwait !== b.forAwait ||
      a.sameLineAmbiguous !== b.sameLineAmbiguous ||
      a.lastEnd !== b.lastEnd ||
      a.jsxDepth !== b.jsxDepth ||
      a.jsxText !== b.jsxText ||
      a.jsxTagLevel !== b.jsxTagLevel ||
      a.jsxFrames.length !== b.jsxFrames.length
    )
      return false;
    for (let k = 0; k < a.stack.length; k += 1) if (a.stack[k] !== b.stack[k]) return false;
    for (let k = 0; k < a.jsxFrames.length; k += 1) if (a.jsxFrames[k] !== b.jsxFrames[k]) return false;
    if (a.prev === b.prev) return true;
    // Different last tokens that both end an operand: the next token follows a line break, which reads the same either way.
    return !a.exprAllowed && a.lastEnd <= eol && CLOSED_OPERANDS.has(a.prev) && CLOSED_OPERANDS.has(b.prev);
  };
  // True when the ambiguous slash at `i` (a regex literal would end at `regexEnd`) was settled; false to fail closed.
  const settle = (regexEnd) => {
    if (stack.length > 64) return false;
    let eol = i;
    while (eol < n) {
      const c = content.codePointAt(eol);
      if (c === 10 || c === 13 || c === 0x20_28 || c === 0x20_29) break;
      eol += 1;
    }
    const before = save();
    simulating = true;
    simFailed = false;
    i = regexEnd;
    token('regex', false, false);
    run(eol);
    const asRegex = simFailed ? null : save();
    let asDivision = null;
    if (asRegex) {
      restore(before);
      i += 1;
      token('/', true, true);
      run(eol);
      asDivision = simFailed ? null : save();
    }
    simulating = false;
    simFailed = false;
    restore(before);
    if (!asRegex || !asDivision || !sameState(asRegex, asDivision, eol)) return false;
    if (asRegex.stack.includes(CTX_B_TMPL) && !before.stack.includes(CTX_B_TMPL)) return false;
    restore(asRegex);
    out.length = before.outLength;
    pending = before.pending;
    outermostTemplate = before.outermostTemplate;
    return true;
  };
  const braceIsBlock = () => {
    const parent = stack.at(-1);
    if (parent === CTX_F_EXPR || parent === CTX_F_STAT) return true;
    if (prev === ':' && (parent === CTX_B_STAT || parent === CTX_B_EXPR)) return parent === CTX_B_STAT;
    if (prev === 'return' || (prev === 'name' && exprAllowed)) return lineBreakBefore(i);
    // An operand, a line break and a `{`: automatic semicolon insertion makes the brace a block (`x = y\n{ ... }`).
    if (CLOSED_OPERANDS.has(prev) && lineBreakBefore(i)) return true;
    if (
      prev === 'else' ||
      prev === ';' ||
      prev === 'start' ||
      prev === ')' ||
      prev === '}' ||
      prev === '=>' ||
      prev === 'do' ||
      prev === 'try' ||
      prev === 'finally'
    )
      return true;
    if (prev === '{') return parent === CTX_B_STAT;
    if (prev === 'var' || prev === 'const' || prev === 'name') return false;
    return !exprAllowed;
  };
  // Reads a template quasi that starts at `from`; `resumeAt` is the position kept raw when the template never closes.
  const quasi = (from, resumeAt, lead) => {
    const found = scanQuasi(content, from);
    if (found.kind === 'eof') {
      pending = resumeAt;
      i = n;
      return;
    }
    i = found.end;
    pending = found.end;
    if (found.kind === 'close') {
      out.push(`${lead}""`);
      token('tmpl', false, false);
    } else {
      out.push(`${lead}"" `);
      stack.push(CTX_B_TMPL);
      templateDepth += 1;
      token('${', true, true);
    }
  };
  if (content.startsWith('#!')) {
    while (i < n && !LINE_BREAK.test(content[i])) i += 1;
    pending = i;
  }
  // An identifier, keyword or private name that starts at `start`.
  const readWord = (start, code) => {
    i += 1;
    while (i < n) {
      const c = content.codePointAt(i);
      if (
        c < 128
          ? !((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36 || c === 92)
          : !isIdentChar(c)
      )
        break;
      i += 1;
    }
    const word = content.slice(start, i);
    if (prev === '.' || prev === '?.' || code === 35) {
      token('name', false, false);
    } else if (word === 'function' || word === 'class') {
      const top = stack.at(-1);
      const expression =
        prevBeforeExpr &&
        prev !== 'else' &&
        !(prev === ';' && top !== CTX_P_STAT) &&
        !(prev === 'return' && lineBreakBefore(start)) &&
        !((prev === ':' || prev === '{') && top === CTX_B_STAT);
      stack.push(expression ? CTX_F_EXPR : CTX_F_STAT);
      token(word, false, false);
    } else if (KEYWORDS_BEFORE_EXPR.has(word)) {
      token(word, true, true);
    } else if (KEYWORDS.has(word)) {
      token(word, false, false);
    } else {
      // `of` opens a regex only after an operand (`for (x of /re/)`); `yield` and `await` expect an operand.
      const isForAwait = word === 'await' && prev === 'for';
      token('name', false, word === 'yield' || word === 'await' || (word === 'of' && !exprAllowed));
      forAwait = isForAwait;
    }
  };
  const run = (limit) => {
    while (i < limit) {
      const code = content.codePointAt(i);
      if (jsxText) {
        // Element text: stays visible as written until a tag or an expression container starts.
        if (code === 123) {
          i += 1;
          stack.push(CTX_B_EXPR);
          jsxFrames.push(stack.length);
          jsxText = false;
          token('{', true, true);
        } else if (code === 60 && content[i + 1] === '/') {
          const close = content.indexOf('>', i);
          i = close === -1 ? n : close + 1;
          jsxDepth = Math.max(0, jsxDepth - 1);
          jsxText = jsxDepth > 0;
          if (!jsxText) token('str', false, false);
        } else if (code === 60 && /[A-Za-z_$>]/.test(content[i + 1] || '')) {
          i += 1;
          jsxText = false;
          jsxTagLevel = stack.length;
          token('jsx', true, true);
        } else {
          i += 1;
        }
        continue;
      }
      if (code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12) {
        i += 1;
        while (i < limit) {
          const c = content.codePointAt(i);
          if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 11 && c !== 12) break;
          i += 1;
        }
        continue;
      }
      const start = i;
      if ((code >= 97 && code <= 122) || (code >= 65 && code <= 90)) {
        readWord(start, code);
        continue;
      }
      switch (code) {
        case 60: {
          // A `<` where an operand is expected, followed by a name or `>`, may open a JSX element (or a TypeScript generic arrow).
          if (exprAllowed && /[A-Za-z_$>]/.test(content[i + 1] || '')) {
            jsxCandidates += 1;
            i += 1;
            if (jsx) jsxTagLevel = stack.length;
            token(jsx ? 'jsx' : 'op', true, true);
          } else {
            i += 1;
            token('op', true, true);
          }

          break;
        }
        case 62: {
          // The `>` that ends an open tag head (not one inside its braces): the element text follows unless the tag is `/>`.
          if (jsx && jsxTagLevel === stack.length) {
            i += 1;
            jsxTagLevel = -1;
            jsxDepth += 1;
            jsxText = true;
          } else {
            i += 1;
            token('op', true, true);
          }

          break;
        }
        case 34:
        case 39: {
          const end = scanJsString(content, i);
          if (end === -1) {
            // Unterminated: the rest of the line stays visible.
            while (i < n && content.codePointAt(i) !== 10 && content.codePointAt(i) !== 13) i += 1;
          } else {
            flush(i);
            out.push('""');
            i = end;
            pending = end;
          }
          token('str', false, false);

          break;
        }
        case 96: {
          flush(i);
          pending = i;
          // The outermost template remembers where it began: if its `${}` never closes, its text is shown again.
          if (templateDepth === 0) outermostTemplate = { at: i, outputLength: out.length };
          quasi(i + 1, i, '');
          break;
        }
        case 47: {
          const next = content.codePointAt(i + 1);
          if (jsx && jsxTagLevel === stack.length && next === 62) {
            // `/>` closes a self-closing tag: an element, so an operand, follows.
            i += 2;
            jsxTagLevel = -1;
            token('str', false, false);
            if (jsxDepth > 0) jsxText = true;
          } else if (next === 47) {
            flush(i);
            while (i < n && !LINE_BREAK.test(content[i])) i += 1;
            pending = i;
          } else if (next === 42) {
            const end = content.indexOf('*/', i + 2);
            if (end === -1) {
              i = n;
            } else {
              flush(i);
              out.push(content.slice(i, end + 2).replaceAll(/[^\n]/g, ' '));
              i = end + 2;
              pending = i;
            }
          } else {
            // After an operand a `/` divides, unless a line break comes first: automatic semicolon insertion may then end the
            // statement, and the `/` opens a regex (`let a\n/'/.test(a)`). Without a parser that cannot be decided, so the regex
            // reading wins (it keeps its text visible; the division reading would let a following quote hide code as a string).
            let end = exprAllowed ? scanTokenRegex(content, i) : -1;
            let settled = false;
            if (end === -1 && !exprAllowed && (sameLineAmbiguous || lineBreakBefore(i))) {
              // Ambiguous. Settled mode (`readings` null): both readings are run to the end of the line, which stays visible as
              // written. Enumerated mode: `readings` (a bit mask over the ambiguous slashes in order) picks the regex reading (1)
              // or the division (0) of each.
              const regexEnd = scanTokenRegex(content, i);
              if (regexEnd !== -1) {
                ambiguous += 1;
                if (readings === null) {
                  if (simulating) {
                    simFailed = true;
                    i = n;
                  } else if (!settle(regexEnd)) {
                    i = n;
                  }
                  settled = true;
                } else if (ambiguous > 30 || ((readings >> (ambiguous - 1)) & 1) === 1) {
                  end = regexEnd;
                }
              }
            }
            if (settled) {
              // handled above
            } else if (end === -1) {
              i += 1;
              token('/', true, true);
            } else {
              i = end;
              token('regex', false, false);
            }
          }

          break;
        }
        case 40: {
          i += 1;
          // `for await (` is a loop header too: its `)` is followed by a statement, so a `/` there opens a regex.
          const control = prev === 'if' || prev === 'for' || prev === 'while' || prev === 'with' || forAwait;
          stack.push(control ? CTX_P_STAT : CTX_P_EXPR);
          token('(', true, true);

          break;
        }
        case 41: {
          i += 1;
          const top = stack.at(-1);
          if (top === CTX_P_STAT || top === CTX_P_EXPR) {
            stack.pop();
            token(')', false, !CTX_IS_EXPR[top]);
          } else {
            token(')', false, true);
          }

          break;
        }
        case 123: {
          const block = braceIsBlock();
          i += 1;
          stack.push(block ? CTX_B_STAT : CTX_B_EXPR);
          token('{', true, true);

          break;
        }
        case 125: {
          // The closest brace context closes; anything above it (an unfinished paren or a function without a body) is dropped.
          let k = stack.length - 1;
          while (k > 0 && stack[k] !== CTX_B_STAT && stack[k] !== CTX_B_EXPR && stack[k] !== CTX_B_TMPL) k -= 1;
          const closing = stack[k];
          if (k === 0) {
            stack.length = 1;
            i += 1;
            token('}', false, true);
          } else if (closing === CTX_B_TMPL) {
            stack.length = k;
            templateDepth -= 1;
            flush(i);
            pending = i;
            quasi(i + 1, i, ' ');
          } else {
            stack.length = k;
            let popped = closing;
            const under = stack.at(-1);
            if (closing === CTX_B_STAT && (under === CTX_F_STAT || under === CTX_F_EXPR)) popped = stack.pop();
            i += 1;
            token('}', false, !CTX_IS_EXPR[popped]);
            // An object literal, or a TypeScript type literal, ends an operand under one reading only.
            sameLineAmbiguous = popped === CTX_B_EXPR;
          }
          // The `}` that ends a JSX expression container: the element text goes on.
          if (jsxFrames.length > 0 && jsxFrames.at(-1) > stack.length) {
            jsxFrames.pop();
            jsxText = jsxDepth > 0;
          }

          break;
        }
        case 91: {
          i += 1;
          token('[', true, true);

          break;
        }
        case 93: {
          i += 1;
          token(']', false, false);

          break;
        }
        case 33: {
          // A `!` right after an operand with nothing between (`a!`, `f()!`, `a[0]!`) may be TypeScript's non-null assertion, a
          // postfix that leaves an operand behind (`a! / b`); `!=`, `!==` and a prefix `!` after an operator are not. Where it is
          // postfix the `/` divides, otherwise it opens a regex: the slash after it is enumerated under both readings.
          const glued =
            start > 0 && (isIdentChar(content.codePointAt(start - 1)) || content[start - 1] === ')' || content[start - 1] === ']');
          const operandBefore = prev === 'name' || prev === ')' || prev === ']' || prev === 'str' || prev === 'num' || prev === 'this';
          if (glued && operandBefore && content[start + 1] !== '=') {
            i += 1;
            token('!', false, false);
            sameLineAmbiguous = true;
          } else {
            i += 1;
            token('op', true, true);
          }

          break;
        }
        case 59:
        case 44:
        case 58: {
          i += 1;
          token(content[start], true, true);

          break;
        }
        case 63: {
          const next = content.codePointAt(i + 1);
          const after = content.codePointAt(i + 2);
          if (next === 46 && !(after >= 48 && after <= 57)) {
            i += 2;
            token('?.', false, false);
          } else {
            i += 1;
            token('?', true, true);
          }

          break;
        }
        default: {
          if (code === 46 && !(content.codePointAt(i + 1) >= 48 && content.codePointAt(i + 1) <= 57)) {
            if (content.codePointAt(i + 1) === 46 && content.codePointAt(i + 2) === 46) {
              i += 3;
              token('...', true, true);
            } else {
              i += 1;
              token('.', false, false);
            }
          } else if ((code === 43 || code === 45) && content.codePointAt(i + 1) === code) {
            // A postfix `++` or `--` ends an operand, a prefix one leaves an operand expected: either way a regex is allowed exactly when it was.
            // A line break before `++`/`--` after an operand ends the statement (no postfix across a line break), so it is a prefix operator.
            const prefix = exprAllowed || lineBreakBefore(i);
            i += 2;
            if (prefix) token('preinc', true, true);
            else token('incdec', false, false);
          } else if (code === 61 && content.codePointAt(i + 1) === 62) {
            i += 2;
            token('=>', true, true);
          } else if ((code >= 48 && code <= 57) || code === 46) {
            i += 1;
            if (code === 48 && /[xXbBoO]/.test(content[i] || '')) {
              i += 1;
              while (i < n && isIdentChar(content.codePointAt(i))) i += 1;
            } else {
              const digits = () => {
                while (i < n && ((content.codePointAt(i) >= 48 && content.codePointAt(i) <= 57) || content.codePointAt(i) === 95)) i += 1;
              };
              digits();
              if (code !== 46 && content.codePointAt(i) === 46) {
                i += 1;
                digits();
              }
              if ((content.codePointAt(i) | 32) === 101) {
                let k = i + 1;
                if (content.codePointAt(k) === 43 || content.codePointAt(k) === 45) k += 1;
                if (content.codePointAt(k) >= 48 && content.codePointAt(k) <= 57) {
                  i = k;
                  digits();
                }
              }
              if (content.codePointAt(i) === 110) i += 1;
            }
            token('num', false, false);
          } else if (code === 35 || (code > 64 && isIdentChar(code)) || code === 36 || code === 95 || code === 92) {
            readWord(start, code);
          } else if (code > 127 && /\s/.test(content[i])) {
            i += 1;
          } else {
            // Any other operator or unknown character: an operand is expected after it.
            i += 1;
            token('op', true, true);
          }
        }
      }
    }
  };
  run(n);
  if (templateDepth > 0 && outermostTemplate !== null) {
    // A `${` that never closes: the template text is not trustworthy as text, so everything from its backtick stays visible.
    out.length = outermostTemplate.outputLength;
    out.push(content.slice(outermostTemplate.at));
    return { text: out.join(''), ambiguous, jsxCandidates };
  }
  flush(n);
  return { text: out.join(''), ambiguous, jsxCandidates };
}

// Small texts also get every combination of readings as views of their own, while the work stays bounded: the passes needed
// (2 to the number of ambiguous slashes) times the length may not exceed this many characters.
const ENUMERATION_BUDGET = 1_000_000;
const MAX_ENUMERATED_SLASHES = 8;

/**
 * Every reading of `content` that matters. A `/` that follows an operand and a line break may divide or, after an
 * automatic semicolon, open a regex (`let a\n/'/.test(a)`), and only a parser can tell. The first view settles each such
 * slash locally (`tokenizeCore`: its line stays visible when both readings leave it in the same state, the rest of the text
 * when not), so every mix of readings is covered however many slashes there are, in a constant number of passes. When the
 * text is small enough the combinations are also taken one by one, which gives the exact reading as a view of its own.
 * A `<` that may open a JSX element adds the same views with the element text kept visible (its text is plain text, where
 * `'`, `//` and `/*` open nothing).
 */
function tokenizeJsViews(content) {
  const views = new Set();
  const first = tokenizeCore(content);
  views.add(first.text);
  addEnumeratedReadings(content, first, false, views);
  if (first.jsxCandidates > 0) {
    const markup = tokenizeCore(content, true);
    views.add(markup.text);
    addEnumeratedReadings(content, markup, true, views);
  }
  return [...views];
}

/** Adds the view of every combination of readings to `views` when the text is small enough for that; the settled view covers the rest. */
function addEnumeratedReadings(content, settled, jsx, views) {
  if (settled.ambiguous === 0 || settled.ambiguous > MAX_ENUMERATED_SLASHES) return;
  if (content.length * 2 ** settled.ambiguous > ENUMERATION_BUDGET) return;
  const first = tokenizeCore(content, jsx, -1);
  views.add(first.text);
  // Which slashes are ambiguous depends on the readings chosen before them (a regex swallows the slashes inside it), so the
  // readings are explored as a tree: a run decides the first `decided` ambiguous slashes and reads every later one as a regex;
  // each later ambiguous slash of that run is then also tried as a division.
  const pending = [{ decided: 0, mask: -1, count: first.ambiguous }];
  while (pending.length > 0) {
    const { decided, mask, count } = pending.pop();
    for (let slash = decided; slash < count; slash += 1) {
      const branch = mask & ~(1 << slash);
      const run = tokenizeCore(content, jsx, branch);
      if (run.ambiguous > MAX_ENUMERATED_SLASHES) return;
      views.add(run.text);
      pending.push({ decided: slash + 1, mask: branch, count: run.ambiguous });
    }
  }
}

/** `content` with comments and strings blanked (the reading that treats an ambiguous slash as a regex); see `tokenizeCore`. */
function tokenizeJs(content) {
  return tokenizeCore(content).text;
}

// ---- Legacy views of the previous release, kept byte for byte so the guard never sees less ----

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
const OPENERS_JS = /[/"'`]/g;
const OPENERS_CS = /[/"'`@$]/g;

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
  // Only `/`, `"`, `'`, a backtick (and `@` and `$` in C#) can open anything: every other character is copied as is, and the
  // pattern jumps to the next one without visiting the characters between.
  const openers = cs ? OPENERS_CS : OPENERS_JS;
  openers.lastIndex = 0;
  while (i < n) {
    openers.lastIndex = i;
    if (!openers.test(content)) break;
    i = openers.lastIndex - 1;
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
  // JavaScript and TypeScript also get the real tokenizer's views: an addition to every legacy view below, never a replacement,
  // so the inspected text is a superset of the previous release's by construction.
  if (language !== 'cs') segments.push(...tokenizeJsViews(content).map((view) => blankReexports(view)));
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

// Names the single-regex forms cannot see: every declarator of `export const a = 1, B = 2`, the bindings of a destructuring
// pattern (`export const { B } = x`, `export const [B] = x`) and the `as` alias of a local export list (`export { x as B }`;
// `from` re-exports are forwards, not definitions, and stay out). A small scanner over the already-lexed text; it only ever
// adds symbols to what the forms above found.
const NAME_AT = new RegExp(UNICODE_IDENTIFIER, 'uy');
const DECLARATION_HEAD = /\bexport\s+(?:declare\s+)?(?:const|let|var)\b/g;
const LOCAL_LIST_HEAD = /\bexport\s+(?:type\s+)?\{/g;
const LIST_ALIAS = new RegExp(`^(?:type\\s+)?${UNICODE_IDENTIFIER}\\s+as\\s+(${UNICODE_IDENTIFIER})$`, 'u');
const EXPORT_WORD = /export(?![\w$])/y;
const CONTINUES_LINE = /^(?:[,.?:+\-*/%&|^=<>([!~]|in\b|instanceof\b|as\b|satisfies\b)/;

const ASCII_NAME_AT = /[A-Za-z_$][\w$]*/y;

function nameAt(code, i) {
  // Most names are plain ASCII: that match stands unless the name goes on with a non-ASCII character or an escape.
  ASCII_NAME_AT.lastIndex = i;
  const ascii = ASCII_NAME_AT.exec(code);
  if (ascii) {
    const next = code.codePointAt(i + ascii[0].length);
    if (next === undefined || (next < 128 && next !== 92)) return ascii[0];
  }
  NAME_AT.lastIndex = i;
  const match = NAME_AT.exec(code);
  return match ? match[0] : null;
}

/** Whether the UTF-16 unit is JavaScript whitespace (what `\s` matches). */
function isSpaceUnit(c) {
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return (
    c === 160 ||
    c === 5760 ||
    (c >= 8192 && c <= 8202) ||
    c === 8232 ||
    c === 8233 ||
    c === 8239 ||
    c === 8287 ||
    c === 12_288 ||
    c === 65_279
  );
}

function skipSpace(code, i) {
  let at = i;
  while (at < code.length && isSpaceUnit(code.codePointAt(at))) at++;
  return at;
}

// Characters `skipTo` stops at or counts, by UTF-16 unit.
const WORD_BEFORE = /[\w$.]/;

// Longest regex literal `regexEnd` looks for (a longer one is read as the plain characters it is made of, as before).
const MAX_SKIP_REGEX = 200;
const REGEX_PRECEDER = '=(,:[!&|?{;+-*%<>~^';

/** Index after the regex literal opening at the `/` at `at` when the previous character says a regex can start there and it closes on the line, else -1. */
function regexEnd(code, at) {
  const next = code.codePointAt(at + 1);
  if (next === 47 || next === 42) return -1;
  let back = at - 1;
  while (back >= 0 && isSpaceUnit(code.codePointAt(back))) back--;
  if (back >= 0 && !REGEX_PRECEDER.includes(code[back])) return -1;
  const limit = Math.min(code.length, at + MAX_SKIP_REGEX);
  let inClass = false;
  for (let i = at + 1; i < limit; i++) {
    const c = code.codePointAt(i);
    if (c === 10 || c === 13) return -1;
    // The next statement's `export` ends a declarator list; a regex swallowing it would let every head rescan the same tail.
    if (c === 101 && code.startsWith('export', i)) return -1;
    switch (c) {
      case 92: {
        i++;
        break;
      }
      case 91: {
        inClass = true;
        break;
      }
      case 93: {
        inClass = false;
        break;
      }
      case 47: {
        if (inClass) break;
        let end = i + 1;
        while (end < code.length && /[a-z]/.test(code[end])) end++;
        return end;
      }
    }
  }
  return -1;
}

/**
 * Index where an expression or type starting at `i` ends: a depth-0 `,` or `;`, a closer with no opener, the `export`
 * keyword of the next statement, or (statements only) a line break the expression cannot continue across.
 * `types` also counts `<>` and stops at a depth-0 `=`; `lines` lets a line break end the text.
 */
function skipTo(code, i, { types, lines }) {
  let depth = 0;
  let at = i;
  const length = code.length;
  while (at < length) {
    const unit = code.codePointAt(at);
    if (unit === 34 || unit === 39 || unit === 96) {
      const close = code.indexOf(code[at], at + 1);
      at = close === -1 ? at + 1 : close + 1;
      continue;
    }
    if (unit === 47 && !types) {
      // A regex literal may hold commas, quotes and brackets (`/,/`, `/[)]/`): jump over it when it clearly is one.
      const after = regexEnd(code, at);
      if (after !== -1) {
        at = after;
        continue;
      }
    }
    if (unit === 40 || unit === 91 || unit === 123 || (types && unit === 60)) depth++;
    else if (unit === 41 || unit === 93 || unit === 125 || (types && unit === 62 && code.codePointAt(at - 1) !== 61)) {
      if (depth === 0) return at;
      depth--;
    } else if (depth === 0 && (unit === 44 || unit === 59)) return at;
    else if (depth === 0 && types && unit === 61 && code.codePointAt(at + 1) !== 62) return at;
    else if (unit === 101 && code.codePointAt(at + 1) === 120 && !WORD_BEFORE.test(code[at - 1] || ' ')) {
      EXPORT_WORD.lastIndex = at;
      if (
        EXPORT_WORD.test(code) &&
        /^\s+(?:default|declare|async|abstract|function|class|const|let|var|enum|interface|type|namespace|module|import|\*|\{|@)/.test(
          code.slice(at + 6, at + 40),
        )
      )
        return at;
    } else if (lines && depth === 0 && unit === 10) {
      // The last character before the line break that is not whitespace ('' when there is none).
      let back = at - 1;
      while (back >= 0 && isSpaceUnit(code.codePointAt(back))) back--;
      const before = back >= 0 ? code[back] : '';
      const after = code.slice(skipSpace(code, at), skipSpace(code, at) + 12);
      if (!(',=+-*/%&|^?:<>(!~.'.includes(before) && before !== '') && !CONTINUES_LINE.test(after)) return at;
    }
    at++;
  }
  return at;
}

// Nesting depth past which a destructuring pattern is abandoned (names read so far are kept): the reading is recursive, and
// thousands of unclosed brackets would overflow the stack and abort the guard instead of letting the other export forms decide.
const MAX_PATTERN_DEPTH = 100;
// Returned by the readers (instead of -1) when the nesting limit is hit; the whole declarator is then dropped, since the names
// read inside such a pattern are noise and keeping them would make every unclosed head cost its depth in entries.
const TOO_DEEP = -2;
// Pattern-reading steps still allowed for the text being inspected (reset per call, 1 per character: honest code needs at most
// that). Unclosed heads that all read the same long tail would otherwise cost depth x heads; once spent, later patterns are dropped.
let patternBudget = 0;

/** Binding names of the target at `i` (a name, `{...}` or `[...]`) pushed to `names`; the index after it, or -1 when it is none. */
function readTarget(code, i, names, depth = 0) {
  const at = skipSpace(code, i);
  if (code[at] === '{' || code[at] === '[') return depth >= MAX_PATTERN_DEPTH ? TOO_DEEP : readPattern(code, at, names, depth + 1);
  const name = nameAt(code, at);
  if (name === null) return -1;
  names.push(decodeIdentifier(name));
  return at + name.length;
}

function readPattern(code, start, names, depth) {
  const object = code[start] === '{';
  const closer = object ? '}' : ']';
  let at = start + 1;
  for (;;) {
    if (--patternBudget < 0) return TOO_DEEP;
    at = skipSpace(code, at);
    if (at >= code.length) return -1;
    if (code[at] === closer) return at + 1;
    if (code[at] === ',') {
      at++;
      continue;
    }
    if (code.startsWith('...', at)) at = skipSpace(code, at + 3);
    else if (object) {
      // A property key: `[computed]`, a string, a number or a name; it is a binding only when no `:` follows (shorthand).
      let after;
      let shorthand = null;
      if (code[at] === '[') after = skipTo(code, at + 1, { types: false, lines: false }) + 1;
      else if (code[at] === '"' || code[at] === "'") after = code.indexOf(code[at], at + 1) + 1 || at + 1;
      else {
        shorthand = nameAt(code, at);
        const key = shorthand ?? /^[\d.]+/.exec(code.slice(at, at + 40))?.[0];
        if (!key) return -1;
        after = at + key.length;
      }
      const colon = skipSpace(code, after);
      if (code[colon] === ':') at = colon + 1;
      else {
        if (shorthand !== null) names.push(decodeIdentifier(shorthand));
        at = after;
        at = code[skipSpace(code, at)] === '=' ? skipTo(code, skipSpace(code, at) + 1, { types: false, lines: false }) : at;
        continue;
      }
    }
    at = readTarget(code, at, names, depth);
    if (at < 0) return at;
    at = skipSpace(code, at);
    if (code[at] === '=') at = skipTo(code, at + 1, { types: false, lines: false });
  }
}

// Most commas of type argument lists one declaration may jump over (`Map<string, Array<number>>` has one): text made of nothing
// but names and commas would otherwise make every head read the same tail.
const MAX_TYPE_ARGUMENT_COMMAS = 6;

/** Every name declared by the `const`/`let`/`var` list whose first declarator starts at `start`. */
function declaredNames(code, start) {
  const names = [];
  let at = skipSpace(code, start);
  if (/^enum\s/.test(code.slice(at, at + 6))) return names;
  let skipped = 0;
  for (;;) {
    const before = names.length;
    at = readTarget(code, at, names);
    if (at === TOO_DEEP) names.length = before;
    if (at < 0) break;
    const targetEnd = at;
    at = skipSpace(code, at);
    // Junk right after the name on the same line (not `:`, `=`, `!`, `,`, `;`): see below.
    const afterTarget = !':=!,;'.includes(code[at] ?? ';') && !code.slice(targetEnd, at).includes('\n');
    if (code[at] === '!') at = skipSpace(code, at + 1);
    if (code[at] === ':') at = skipSpace(code, skipTo(code, at + 1, { types: true, lines: true }));
    if (code[at] === '=') at = skipSpace(code, skipTo(code, at + 1, { types: false, lines: true }));
    if (code[at] !== ',') {
      // A name followed by anything else is not a declarator: it is the tail of an initializer that a comma inside a type argument
      // list (`Map<string, number>`, `f<A, B>(x)`, `<T, U>(x) => x`) cut short. Skip to the next depth-0 comma and read on.
      if (!afterTarget || at >= code.length || (skipped += 1) > MAX_TYPE_ARGUMENT_COMMAS) break;
      at = skipTo(code, at, { types: false, lines: true });
      if (code[at] !== ',') break;
    }
    at = skipSpace(code, at + 1);
  }
  return names;
}

/** `{ index, symbol }` entries for the names `declaredNames` and the local export lists add. */
function extraExportEntries(code) {
  // One entry per distinct name, at its first index: later copies add nothing to the decision and, on text made of thousands of
  // heads, would cost an entry (and its sorting) each.
  const first = new Map();
  const entries = {
    push({ index, symbol }) {
      const seen = first.get(symbol);
      if (seen === undefined || index < seen) first.set(symbol, index);
    },
  };
  patternBudget = code.length + 1000;
  for (const head of code.matchAll(DECLARATION_HEAD)) {
    for (const symbol of declaredNames(code, head.index + head[0].length)) entries.push({ index: head.index + 0.5, symbol });
  }
  // Heads that share their closing brace share the comma-separated parts after their first comma, so those parts are read once
  // (by the first head of the group); every later head only reads its own first part. Total work stays linear however many
  // unclosed `export {` precede one distant `}` (rescanning and re-splitting the same tail for each head is quadratic).
  const aliasOf = (from, to) => {
    // A brace cannot be part of `name as alias`; this keeps a first part that spans later heads from being sliced for each of them.
    const brace = code.indexOf('{', from);
    if (brace !== -1 && brace < to) return;
    const alias = LIST_ALIAS.exec(code.slice(from, to).trim());
    if (alias && alias[1] !== 'default') entries.push({ index: heads.at, symbol: decodeIdentifier(alias[1]) });
  };
  const heads = { at: 0 };
  let close = -2;
  let tailIsFrom = false;
  let commas = [];
  let next = 0;
  for (const head of code.matchAll(LOCAL_LIST_HEAD)) {
    const start = head.index + head[0].length;
    let first = false;
    if (close < start) {
      close = code.indexOf('}', start);
      if (close === -1) break;
      tailIsFrom = /^\s*from\b/.test(code.slice(close + 1, close + 40));
      commas = [];
      for (let at = start; at < close; at += 1) if (code.codePointAt(at) === 44) commas.push(at);
      next = 0;
      first = true;
    }
    if (tailIsFrom) continue;
    while (next < commas.length && commas[next] < start) next += 1;
    heads.at = head.index + 0.5;
    aliasOf(start, next < commas.length ? commas[next] : close);
    if (first) {
      for (let k = next; k < commas.length; k += 1) aliasOf(commas[k] + 1, k + 1 < commas.length ? commas[k + 1] : close);
    }
  }
  return [...first].map(([symbol, index]) => ({ index, symbol }));
}

/** The identifier with its `\uXXXX` and `\u{X}` escapes decoded (an out-of-range escape stays as written). */
function decodeIdentifier(name) {
  if (!name.includes('\\')) return name;
  return name.replaceAll(/\\u(?:([0-9a-fA-F]{4})|\{([0-9a-fA-F]+)\})/g, (whole, four, braced) => {
    const code = Number.parseInt(four || braced, 16);
    return code <= 0x10_ff_ff ? String.fromCodePoint(code) : whole;
  });
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
  if (UNICODE_TRIGGER.test(code)) {
    for (const form of UNICODE_FORMS) {
      form.lastIndex = 0;
      for (const match of code.matchAll(form)) found.push({ index: match.index, symbol: decodeIdentifier(match[1]) });
    }
  }
  for (const entry of extraExportEntries(code)) found.push(entry);
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
  tokenizeJs,
  tokenizeJsViews,
  lexAware,
  lexLegacy,
  lexLegacyFast,
  inspectedCode,
  qualifies,
};
