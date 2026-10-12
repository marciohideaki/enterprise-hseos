'use strict';
/**
 * W5-CO1 — input safety for the coordination core: linear glob matching (no regular-expression backtracking),
 * path/ref/package/version validation and text sanitisation. Everything that reaches the store, a child process
 * argument list or a model prompt goes through here.
 */

const MAX_EXPR = 256;
const MAX_SEGMENTS = 32;
const MAX_PATHS = 200;
// Line/control characters (Cc, Zl, Zp) become a space in free text; invisible and formatting characters (Cf incl. U+00AD
// and U+180E, U+034F, variation selectors, U+3164, U+2800, U+115F) are dropped. Paths containing any of them are rejected.
const LINE_CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
// eslint-disable-next-line no-misleading-character-class -- combining marks are listed on purpose
const INVISIBLE = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180E\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
const LINE_CONTROL_RUN = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;
// eslint-disable-next-line no-misleading-character-class -- combining marks are listed on purpose
const INVISIBLE_RUN = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180E\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]+/gu;
const hasControl = (value) => LINE_CONTROL.test(value) || INVISIBLE.test(value);
const WILDCARD = /[*?]/;

const sanitizeText = (value, max = 200) =>
  String(value ?? '')
    .replaceAll(INVISIBLE_RUN, '')
    .replaceAll(LINE_CONTROL_RUN, ' ')
    .trim()
    .slice(0, max);
const validIdent = (value) => typeof value === 'string' && /^[\dA-Za-z][\w.:@-]{0,127}$/.test(value);
const validTool = (value) => typeof value === 'string' && /^[\da-z][\d._a-z-]{0,31}$/.test(value);
const validRef = (value) =>
  typeof value === 'string' &&
  /^[\dA-Za-z][\w./@-]{0,199}$/.test(value) &&
  !value.includes('..') &&
  !value.includes('@{') &&
  !/[./]$/.test(value) &&
  !value.endsWith('.lock');
const validPackage = (value) =>
  typeof value === 'string' &&
  value.length <= 214 &&
  /^(?:@[\d_a-z~-][\d._a-z~-]*\/)?[\d_a-z~-][\d._a-z~-]*$/.test(value) &&
  !value.startsWith('.') &&
  !value.startsWith('_');

const NUMERIC = String.raw`(?:0|[1-9]\d*)`;
const PRERELEASE_ID = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)`;
const SEMVER = new RegExp(
  String.raw`^(${NUMERIC})\.(${NUMERIC})\.(${NUMERIC})(?:-(${PRERELEASE_ID}(?:\.${PRERELEASE_ID})*))?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$`,
);

/** Strict semver, build metadata dropped (npm treats versions that differ only by build as the same). */
function canonicalVersion(value) {
  if (typeof value !== 'string' || value.length > 128) return null;
  const match = SEMVER.exec(value);
  return match ? `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}` : null;
}

/** posix, no `./`, no `//`, `..` or absolute rejected, `**` runs collapsed. Returns null when unusable. */
function normalizePathExpr(input) {
  if (typeof input !== 'string' || !input || input.length > MAX_EXPR || hasControl(input) || input.includes('\\') || input.startsWith('/'))
    return null;
  const out = [];
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    const clean = segment === '**' ? '**' : segment.replaceAll(/\*+/g, '*');
    if (clean === '**' && out.at(-1) === '**') continue;
    out.push(clean);
  }
  return out.length > 0 && out.length <= MAX_SEGMENTS ? out.join('/') : null;
}

const isLiteral = (normalized) => !WILDCARD.test(normalized);

/** Wildcard match of one segment (`*`, `?`) with a single backtrack point: O(n*m), never exponential. */
function matchSegment(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p;
      p += 1;
      mark = t;
    } else if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p += 1;
      t += 1;
    } else if (star >= 0) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/** `pattern` against a literal `file`; `**` spans zero or more segments (dynamic programming over segments). */
function matchGlob(pattern, file) {
  const normalizedPattern = normalizePathExpr(pattern);
  const normalizedFile = normalizePathExpr(file);
  if (!normalizedPattern || !normalizedFile) return false;
  const ps = normalizedPattern.split('/');
  const fs = normalizedFile.split('/');
  let previous = Array.from({ length: fs.length + 1 }, (_, j) => j === 0);
  for (const segment of ps) {
    const current = Array.from({ length: fs.length + 1 }, () => false);
    for (let j = 0; j <= fs.length; j += 1) {
      current[j] =
        segment === '**' ? previous[j] || (j > 0 && current[j - 1]) : j > 0 && previous[j - 1] && matchSegment(segment, fs[j - 1]);
    }
    previous = current;
  }
  return previous[fs.length];
}

function literalPrefix(normalized) {
  const out = [];
  for (const segment of normalized.split('/')) {
    if (WILDCARD.test(segment)) break;
    out.push(segment);
  }
  return out;
}

/**
 * Two path expressions overlap when equal, when one matches the other taken as a literal, or - glob against glob,
 * conservatively - when one literal prefix contains the other (a potential overlap, never a false negative).
 */
function globsOverlap(a, b) {
  const na = normalizePathExpr(a);
  const nb = normalizePathExpr(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (isLiteral(nb)) return matchGlob(na, nb);
  if (isLiteral(na)) return matchGlob(nb, na);
  const pa = literalPrefix(na);
  const pb = literalPrefix(nb);
  const shared = Math.min(pa.length, pb.length);
  return pa.slice(0, shared).every((segment, index) => segment === pb[index]);
}

module.exports = {
  MAX_PATHS,
  sanitizeText,
  validIdent,
  validTool,
  validRef,
  validPackage,
  canonicalVersion,
  normalizePathExpr,
  isLiteral,
  matchGlob,
  globsOverlap,
};
