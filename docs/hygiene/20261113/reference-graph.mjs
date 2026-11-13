// Reference graph for the repository hygiene run.
//
// For every versioned file that is a removal candidate, list who cites it, so that "not needed"
// can be proven deterministically instead of guessed. Usage:
//   node docs/hygiene/20261113/reference-graph.mjs [--config <file>] [--out <file>]
//
// Method limits: only literal path tokens are seen. Paths assembled at run time (path.join with
// variables, template strings) are invisible here; a simulated removal followed by the full test
// suite is the complementary check.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');

const KIND_RANK = { exact: 0, dir: 1, glob: 2, basename: 3 };
const STRONG_KINDS = new Set(['exact', 'dir', 'glob']);

const TOKEN_RE = /[\p{L}\p{N}_.@+~%/*-]+/gu;
const LINK_RE = /\]\(\s*<?([^\n)>]+?)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const QUOTE_RE = /(["'`])([^\n"'`]{2,300}?)\1/g;
const HAS_EXTENSION_RE = /\.[\dA-Za-z]{1,12}$/;

function parseArgs(argv) {
  const options = {
    config: path.join(here, 'reference-graph.config.json'),
    out: path.join(here, 'reference-graph.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--config' || flag === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${flag}`);
      options[flag.slice(2)] = path.resolve(process.cwd(), value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return options;
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...options });
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) return value;
    throw error;
  }
}

function startsWithAny(value, prefixes) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function matchesEntry(file, entry) {
  return (
    (entry.exact ?? []).includes(file) ||
    startsWithAny(file, entry.prefixes ?? []) ||
    (entry.regex ?? []).some((pattern) => new RegExp(pattern).test(file))
  );
}

function makeClassifier(categories) {
  return (file) => {
    for (const entry of categories) {
      if (entry.fallback) return entry.name;
      if (startsWithAny(file, entry.exclude_prefixes ?? [])) continue;
      if (matchesEntry(file, entry)) return entry.name;
    }
    throw new Error('categories must end with a fallback entry');
  };
}

function isCandidate(file, prefixes) {
  return prefixes.some((prefix) => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix));
}

function prefixOf(file, prefixDepth) {
  const segments = file.split('/');
  if (segments.length === 1) return file;
  const directories = segments.slice(0, -1);
  let depth = prefixDepth.default;
  for (const [key, value] of Object.entries(prefixDepth)) {
    if (key !== 'default' && (file === key || file.startsWith(`${key}/`))) depth = value;
  }
  return `${directories.slice(0, depth).join('/')}/`;
}

// Normalise one raw token; returns '' when it cannot be a path.
function cleanToken(raw) {
  let token = raw.trim();
  if (token.includes('%')) token = safeDecode(token);
  token = token.replace(/[#?].*$/s, '');
  token = token.replace(/^[([<"'`]+/, '');
  token = token.replace(/:\d+(?::\d+)?$/, '');
  while (token.startsWith('./')) token = token.slice(2);
  if (token.startsWith('**') && token[2] !== '/') token = token.replace(/^\*+/, '');
  token = token.replace(/[.,;:!)\]}'"`>]+$/, '');
  if (token.endsWith('**') && token.at(-3) !== '/') token = token.replace(/\*+$/, '');
  token = token.replace(/\/+$/, '');
  if (token.length === 0 || token.length > 300) return '';
  if (token.startsWith('/') || token.includes('://') || token === '.' || token === '..') return '';
  if (token.includes('*') && !/[/.]/.test(token)) return '';
  if (!token.includes('/') && !HAS_EXTENSION_RE.test(token)) return '';
  return token;
}

function extractTokens(text) {
  const tokens = new Set();
  const add = (raw) => {
    const token = cleanToken(raw);
    if (token) tokens.add(token);
  };
  for (const match of text.matchAll(TOKEN_RE)) add(match[0]);
  for (const match of text.matchAll(LINK_RE)) add(match[1]);
  for (const match of text.matchAll(QUOTE_RE)) {
    if (match[2].includes(' ')) add(match[2]);
  }
  return tokens;
}

function variantsOf(token, referentDir) {
  const found = new Set();
  const options = [token];
  if (referentDir !== '.') options.push(`${referentDir}/${token}`);
  for (const option of options) {
    const normalized = path.posix.normalize(option).replace(/\/+$/, '');
    if (normalized === '.' || normalized.startsWith('..') || normalized.startsWith('/')) continue;
    found.add(normalized);
  }
  return [...found];
}

function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else {
      source += char.replaceAll(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`);
    }
  }
  return new RegExp(`^${source}$`);
}

// A glob that is only wildcards below a broad directory (docs/**, .hseos/**) protects nothing specific.
function isBroadGlob(pattern, broadDirs) {
  const star = pattern.indexOf('*');
  const literal = pattern.slice(0, star).replace(/\/$/, '');
  return /^[*/]*$/.test(pattern.slice(star)) && (literal === '' || broadDirs.has(literal));
}

function isTextFile(absolute, limits) {
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.size > limits.maxFileBytes) return { text: false, stat, reason: stat.isFile() ? 'large' : 'special' };
  const buffer = fs.readFileSync(absolute);
  const sniff = buffer.subarray(0, limits.binarySniffBytes);
  if (sniff.includes(0)) return { text: false, stat, reason: 'binary' };
  return { text: true, stat, content: buffer.toString('utf8') };
}

function lstatOrNull(absolute) {
  try {
    return fs.lstatSync(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readPackedFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(output);
  return new Set(parsed[0].files.map((entry) => entry.path));
}

function addRef(map, referent, kind, via) {
  const existing = map.get(referent);
  if (existing && KIND_RANK[existing.kind] <= KIND_RANK[kind]) return;
  map.set(referent, via ? { kind, via } : { kind });
}

async function formatJson(text, outPath) {
  let prettier;
  try {
    prettier = await import('prettier');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      process.stderr.write('prettier not resolvable; writing unformatted JSON\n');
      return text;
    }
    throw error;
  }
  const options = (await prettier.resolveConfig(outPath)) ?? {};
  return prettier.format(text, { ...options, parser: 'json', filepath: outPath });
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function withoutCategory(item) {
  const copy = { ...item };
  delete copy.category;
  return copy;
}

function mebibytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configRaw = fs.readFileSync(options.config);
  const config = JSON.parse(configRaw.toString('utf8'));
  const limits = config.limits;
  const classify = makeClassifier(config.categories);
  const categoryOrder = config.categories.map((entry) => entry.name);
  const broadDirs = new Set(config.broadDirs);
  const generic = new Set(config.genericBasenames);

  const baseCommit = git(['rev-parse', 'HEAD']).trim();
  const allFiles = git(['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter((file) => !startsWithAny(file, config.excludeFromAnalysis))
    .sort();

  const basenameCount = new Map();
  for (const file of allFiles) {
    const name = path.posix.basename(file);
    basenameCount.set(name, (basenameCount.get(name) ?? 0) + 1);
  }

  const candidatePaths = new Set();
  const candidateBytes = new Map();
  const skipped = { binary: 0, large: 0, special: 0, missing: 0 };
  const referents = [];
  for (const file of allFiles) {
    const absolute = path.join(root, file);
    const lstat = lstatOrNull(absolute);
    if (!lstat) {
      skipped.missing += 1;
      continue;
    }
    if (isCandidate(file, config.candidates)) {
      candidatePaths.add(file);
      candidateBytes.set(file, lstat.size);
    }
    referents.push(file);
  }

  const dirSet = new Set();
  const eligibleBasenames = new Set();
  for (const candidate of candidatePaths) {
    const segments = candidate.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const directory = segments.slice(0, depth).join('/');
      if (!broadDirs.has(directory)) dirSet.add(directory);
    }
    const name = segments.at(-1);
    if (!generic.has(name) && HAS_EXTENSION_RE.test(name) && basenameCount.get(name) <= config.basenameMaxOccurrences) {
      eligibleBasenames.add(name);
    }
  }

  const exactHits = new Map();
  const dirHits = new Map();
  const baseHits = new Map();
  const globs = new Map();
  const noteHit = (map, key, referent) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(referent);
  };

  let scanned = 0;
  for (const referent of referents) {
    const result = isTextFile(path.join(root, referent), limits);
    if (!result.text) {
      skipped[result.reason] += 1;
      continue;
    }
    scanned += 1;
    const referentDir = path.posix.dirname(referent);
    for (const token of extractTokens(result.content)) {
      if (token.includes('*')) {
        for (const variant of variantsOf(token, referentDir)) noteHit(globs, variant, referent);
        continue;
      }
      const lastSegment = token.split('/').at(-1);
      if (eligibleBasenames.has(lastSegment)) noteHit(baseHits, lastSegment, referent);
      for (const variant of variantsOf(token, referentDir)) {
        if (candidatePaths.has(variant)) noteHit(exactHits, variant, referent);
        if (dirSet.has(variant)) noteHit(dirHits, variant, referent);
      }
    }
  }

  const globList = [...globs.entries()]
    .filter(([pattern]) => pattern.replaceAll(/[*/]/g, '').length > 0 && !isBroadGlob(pattern, broadDirs))
    .map(([pattern, hitReferents]) => ({
      pattern,
      regex: globToRegExp(pattern),
      prefix: pattern.slice(0, pattern.indexOf('*')),
      referents: hitReferents,
    }))
    .sort((a, b) => (a.pattern < b.pattern ? -1 : 1));

  const packedFiles = readPackedFiles();

  const candidates = [...candidatePaths].sort().map((candidatePath) => {
    const refs = new Map();
    for (const referent of exactHits.get(candidatePath) ?? []) {
      if (referent !== candidatePath) addRef(refs, referent, 'exact');
    }
    const segments = candidatePath.split('/');
    for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
      const directory = segments.slice(0, depth).join('/');
      for (const referent of dirHits.get(directory) ?? []) {
        if (referent !== candidatePath) addRef(refs, referent, 'dir', directory);
      }
    }
    for (const glob of globList) {
      if (!candidatePath.startsWith(glob.prefix) || !glob.regex.test(candidatePath)) continue;
      for (const referent of glob.referents) {
        if (referent !== candidatePath) addRef(refs, referent, 'glob', glob.pattern);
      }
    }
    const name = segments.at(-1);
    for (const referent of baseHits.get(name) ?? []) {
      if (referent !== candidatePath) addRef(refs, referent, 'basename');
    }
    return {
      path: candidatePath,
      bytes: candidateBytes.get(candidatePath),
      packaged: packedFiles.has(candidatePath),
      refs,
    };
  });

  // Closed chain: a candidate is removable only if every strong referrer is itself removable.
  const removable = new Set(candidates.filter((entry) => !entry.packaged).map((entry) => entry.path));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of candidates) {
      if (!removable.has(entry.path)) continue;
      const blocked = [...entry.refs].some(([referent, info]) => STRONG_KINDS.has(info.kind) && !removable.has(referent));
      if (blocked) {
        removable.delete(entry.path);
        changed = true;
      }
    }
  }

  const categoryCache = new Map();
  const categoryOf = (file) => {
    if (!categoryCache.has(file)) categoryCache.set(file, classify(file));
    return categoryCache.get(file);
  };
  const byRank = (a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || (a.file < b.file ? -1 : 1);

  const byPrefix = new Map();
  const totals = {
    referents_scanned: scanned,
    skipped,
    candidates: candidates.length,
    candidate_bytes: 0,
    packaged: 0,
    removable_by_graph: 0,
    removable_bytes: 0,
    kept: 0,
    kept_bytes: 0,
    kept_by_category: {},
    candidates_with_basename_only_referrers: 0,
  };

  const output = candidates.map((entry) => {
    const referrers = {};
    const historic = [];
    const blocking = [];
    let hasStrong = false;
    for (const [file, info] of entry.refs) {
      const category = categoryOf(file);
      const item = { file, kind: info.kind, ...(info.via ? { via: info.via } : {}), category };
      if (STRONG_KINDS.has(info.kind)) hasStrong = true;
      if (STRONG_KINDS.has(info.kind) && !removable.has(file)) blocking.push(item);
      if (category === 'historic') historic.push(item);
      else (referrers[category] ??= []).push(item);
    }
    const ordered = {};
    for (const category of categoryOrder) {
      if (category === 'historic') continue;
      if (referrers[category]) {
        ordered[category] = referrers[category].sort(byRank).map((item) => withoutCategory(item));
      }
    }
    historic.sort(byRank);
    if (historic.length > 0) {
      ordered.historic = historic.slice(0, limits.historicListMax).map((item) => withoutCategory(item));
    }
    const isRemovable = removable.has(entry.path);
    blocking.sort(byRank);

    // Statistics
    const prefix = prefixOf(entry.path, config.prefixDepth);
    if (!byPrefix.has(prefix)) {
      byPrefix.set(prefix, { files: 0, bytes: 0, removable_by_graph: 0, kept: 0, kept_by_category: {} });
    }
    const bucket = byPrefix.get(prefix);
    bucket.files += 1;
    bucket.bytes += entry.bytes;
    totals.candidate_bytes += entry.bytes;
    if (entry.packaged) totals.packaged += 1;
    if (isRemovable) {
      bucket.removable_by_graph += 1;
      totals.removable_by_graph += 1;
      totals.removable_bytes += entry.bytes;
    } else {
      const reason = entry.packaged ? 'packaged' : blocking[0].category;
      bucket.kept += 1;
      bucket.kept_by_category[reason] = (bucket.kept_by_category[reason] ?? 0) + 1;
      totals.kept += 1;
      totals.kept_bytes += entry.bytes;
      totals.kept_by_category[reason] = (totals.kept_by_category[reason] ?? 0) + 1;
    }
    if (!hasStrong && entry.refs.size > 0) totals.candidates_with_basename_only_referrers += 1;

    const result = {
      path: entry.path,
      bytes: entry.bytes,
      packaged: entry.packaged,
      removable_by_graph: isRemovable,
      referrers: ordered,
    };
    if (historic.length > 0) result.historic_count = historic.length;
    result.referrer_counts = Object.fromEntries(
      categoryOrder
        .filter((name) => (name === 'historic' ? historic.length : referrers[name]?.length) > 0)
        .map((name) => [name, name === 'historic' ? historic.length : referrers[name].length]),
    );
    if (!isRemovable) {
      result.blocking_count = blocking.length;
      result.blocking_referrers = blocking.slice(0, limits.blockingListMax).map(({ file, category, kind }) => ({ file, category, kind }));
    }
    return result;
  });

  totals.kept_by_category = sortObject(totals.kept_by_category);
  const prefixOut = {};
  for (const key of [...byPrefix.keys()].sort()) {
    const bucket = byPrefix.get(key);
    prefixOut[key] = { ...bucket, kept_by_category: sortObject(bucket.kept_by_category) };
  }

  const document = {
    base_commit: baseCommit,
    config_sha256: createHash('sha256').update(configRaw).digest('hex'),
    totals,
    by_prefix: prefixOut,
    candidates: output,
  };
  let text = await formatJson(JSON.stringify(document), options.out);
  if (Buffer.byteLength(text) > limits.outputSoftLimitBytes) {
    for (const entry of document.candidates) {
      if (!entry.removable_by_graph) continue;
      const onlyHistoric = Object.keys(entry.referrers).every((key) => key === 'historic');
      if (onlyHistoric) entry.referrers = {};
    }
    document.totals.referrers_trimmed_for_size = true;
    text = await formatJson(JSON.stringify(document), options.out);
  }
  if (Buffer.byteLength(text) > limits.outputSoftLimitBytes) {
    for (const entry of document.candidates) {
      for (const [category, list] of Object.entries(entry.referrers)) {
        if (list.length > limits.keptListMax) entry.referrers[category] = list.slice(0, limits.keptListMax);
      }
    }
    document.totals.referrer_lists_capped = limits.keptListMax;
    text = await formatJson(JSON.stringify(document), options.out);
  }
  fs.writeFileSync(options.out, text);

  process.stdout.write(`base_commit ${baseCommit}\n`);
  process.stdout.write(`${JSON.stringify(totals, null, 2)}\n`);
  process.stdout.write(`output ${path.relative(root, options.out)} ${Buffer.byteLength(text)} bytes\n\n`);
  process.stdout.write('prefix | files | MiB | removable | kept | kept_by_category\n');
  for (const [key, bucket] of Object.entries(prefixOut)) {
    process.stdout.write(
      `${key} | ${bucket.files} | ${mebibytes(bucket.bytes)} | ${bucket.removable_by_graph} | ${bucket.kept} | ${JSON.stringify(bucket.kept_by_category)}\n`,
    );
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`reference-graph failed: ${error.stack ?? error}\n`);
  process.exitCode = 1;
}
