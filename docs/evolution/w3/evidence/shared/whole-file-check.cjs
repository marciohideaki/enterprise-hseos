'use strict';
// Pure whole-file check for a campaign: the model's final file is judged as a whole, not by the return of one export.
// THREAT MODEL: this protects against ACCIDENTAL mutilation by a model (deleted helpers, constants, a one-export fix). It is NOT a
// sandbox against adversarial code. The final code runs in a child process with a minimal `env`, a scratch directory, a time limit,
// the Node permission model (filesystem reads only inside the scratch directory; no child processes, no workers) and, when the host
// allows it, a network namespace (`unshare -rn`). Without the namespace there is NO network isolation: `network_isolation` says which
// one applied, and removing `fetch`/`WebSocket` from the globals is only a weak extra measure.
// JUDGMENT HAPPENS IN THE PARENT. The child only runs the module and reports raw outcomes, framed as nonce + length + v8.serialize
// (which never calls `toJSON`), written with a reference to `fs.writeSync` captured before the final file loads. The parent
// deserializes in its own, unmodified process, requires one outcome per declared check, and compares with `isDeepStrictEqual`.
// The child never receives the expected values. Declared limits: a preserved segment kept as dead code passes (presence, not
// semantics); an unexported helper is checked only for presence and for not having been emptied; code sharing a process with the
// harness may try other paths; `network_isolation` is `none` on hosts that deny `unshare -rn`. A missing or invalid input is
// `unknown`, never approved.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const v8 = require('node:v8');
const { spawnSync } = require('node:child_process');
const acorn = require('acorn');

const SELF = '.';
const DEFAULT_TIMEOUT_MS = 5000;
const SEP = '\u0001';
const NONCE_CHARS = 32;
const LENGTH_CHARS = 8;
const PARSE = { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true };

// Runs inside the child, wrapped so nothing it declares is visible to the final file. Everything it needs is captured BEFORE the
// final file loads; the nonce lives only in a closure string; the report is built from null-prototype objects.
const RUNNER = `(() => {
  const fs = require('node:fs');
  const util = require('node:util');
  const v8 = require('node:v8');
  const writeSync = fs.writeSync;
  const readFileSync = fs.readFileSync;
  const serialize = v8.serialize;
  const isProxy = util.types.isProxy;
  const parse = JSON.parse;
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const hasOwn = Object.hasOwn;
  const create = Object.create;
  const apply = Reflect.apply;
  const toText = String;
  const input = parse(readFileSync(0, 'utf8'));
  const nonce = input.nonce;
  const file = input.file;
  const names = input.names;
  const calls = input.calls;
  for (const name of ['fetch', 'WebSocket', 'EventSource']) delete globalThis[name];
  const report = create(null);
  report.loaded = false;
  report.exports = create(null);
  report.results = create(null);
  let mod;
  try {
    mod = require(file);
    report.loaded = true;
  } catch (error) {
    report.load_error = 'error';
  }
  if (report.loaded) {
    const resolve = (name) => {
      if (name === ${JSON.stringify(SELF)}) return isProxy(mod) ? { kind: 'proxy' } : { kind: typeof mod, value: mod };
      if (mod === null || (typeof mod !== 'object' && typeof mod !== 'function')) return { kind: 'absent' };
      if (isProxy(mod)) return { kind: 'proxy' };
      const descriptor = getDescriptor(mod, name);
      if (descriptor === undefined) return { kind: 'absent' };
      if (!hasOwn(descriptor, 'value')) return { kind: 'accessor' };
      return isProxy(descriptor.value) ? { kind: 'proxy' } : { kind: typeof descriptor.value, value: descriptor.value };
    };
    const found = create(null);
    for (let i = 0; i < names.length; i++) {
      found[names[i]] = resolve(names[i]);
      report.exports[names[i]] = found[names[i]].kind;
    }
    for (let i = 0; i < calls.length; i++) {
      const outcome = create(null);
      const target = found[calls[i].export];
      if (target.kind !== 'function') outcome.status = 'not-function';
      else {
        try {
          const value = apply(target.value, undefined, calls[i].args);
          try {
            outcome.bytes = serialize(value);
            outcome.status = 'returned';
          } catch (error) {
            outcome.status = 'unserializable';
          }
        } catch (error) {
          outcome.status = 'threw';
          try {
            outcome.name = toText(error && error.name);
          } catch (inner) {
            outcome.name = '';
          }
        }
      }
      report.results[i] = outcome;
    }
  }
  const payload = serialize(report);
  writeSync(3, nonce + ('00000000' + payload.length.toString(16)).slice(-8));
  let offset = 0;
  while (offset < payload.length) offset += writeSync(3, payload, offset);
})();`;

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isCheck = (check) =>
  check !== null &&
  typeof check === 'object' &&
  isNonEmptyString(check.export) &&
  Array.isArray(check.args) &&
  ('expected' in check || (typeof check.throws === 'string' && check.throws.length > 0) || check.throws === true);
const expectedKey = (check) => (check.throws === undefined ? `value:${JSON.stringify(check.expected)}` : `throws:${check.throws}`);

let cachedIsolation;
function networkIsolation() {
  if (cachedIsolation === undefined) {
    const probe = spawnSync('unshare', ['-rn', 'true'], { stdio: 'ignore', timeout: 3000 });
    cachedIsolation = probe.status === 0 ? 'namespace' : 'none';
  }
  return cachedIsolation;
}

function buildCommand(isolation, nodeArgs) {
  if (isolation === 'namespace') return { command: 'unshare', args: ['-rn', process.execPath, ...nodeArgs] }; // rule:network
  return { command: process.execPath, args: nodeArgs };
}

function codeTokens(source) {
  try {
    const tokens = [];
    for (const token of acorn.tokenizer(source, PARSE)) tokens.push(`${token.type.label}\u0000${token.value ?? ''}`);
    return tokens;
  } catch {
    return null;
  }
}

// Top-level function, class and function-valued binding names, with the number of statements (members for a class) in the body.
// Comments and strings never count.
function topLevelCallables(source) {
  try {
    const found = new Map();
    const size = (node) => (node.body.type === 'BlockStatement' || node.body.type === 'ClassBody' ? node.body.body.length : 1);
    for (const node of acorn.parse(source, PARSE).body) {
      if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') found.set(node.id.name, size(node));
      if (node.type === 'VariableDeclaration') {
        for (const declaration of node.declarations) {
          const type = declaration.init?.type;
          if (declaration.id.type === 'Identifier' && (type === 'FunctionExpression' || type === 'ArrowFunctionExpression'))
            found.set(declaration.id.name, size(declaration.init));
        }
      }
    }
    return found;
  } catch {
    return null;
  }
}

const hasSequence = (haystack, needle) => `${SEP}${haystack.join(SEP)}${SEP}`.includes(`${SEP}${needle.join(SEP)}${SEP}`);

// Runs the final file and returns the raw report (never a verdict) or a failure label.
function runFinal({ finalSource, names, calls, timeoutMs, isolation }) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'whole-file-'));
  try {
    const file = path.join(dir, 'final.cjs');
    fs.writeFileSync(file, finalSource);
    const nonce = crypto.randomBytes(NONCE_CHARS / 2).toString('hex');
    const { command, args } = buildCommand(isolation, ['--permission', `--allow-fs-read=${dir}`, '-e', RUNNER]);
    const result = spawnSync(command, args, {
      input: Buffer.from(JSON.stringify({ nonce, file, names, calls })),
      cwd: dir,
      env: { TMPDIR: dir }, // rule:env
      encoding: 'buffer',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 256 * 1024,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    if (result.error?.code === 'ETIMEDOUT') return { failure: 'final-timeout' };
    if (result.error?.code === 'ENOBUFS') return { failure: 'final-output-too-large' }; // rule:output
    if (result.error || result.signal || result.status !== 0) return { failure: 'final-crashed' };
    const out = Buffer.isBuffer(result.output?.[3]) ? result.output[3] : Buffer.alloc(0);
    const at = out.indexOf(Buffer.from(nonce)); // rule:nonce
    if (at === -1) return { failure: 'final-no-verdict' };
    const lengthText = out.subarray(at + NONCE_CHARS, at + NONCE_CHARS + LENGTH_CHARS).toString('latin1');
    if (!/^[0-9a-f]{8}$/.test(lengthText)) return { failure: 'final-no-verdict' };
    const start = at + NONCE_CHARS + LENGTH_CHARS;
    const payload = out.subarray(start, start + Number.parseInt(lengthText, 16));
    if (payload.length !== Number.parseInt(lengthText, 16)) return { failure: 'final-no-verdict' };
    try {
      return { report: v8.deserialize(payload) };
    } catch {
      return { failure: 'final-no-verdict' };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The parent decides: compares each raw outcome with what the check declares. Anything unexpected is a failure.
function judgeCheck(check, outcome) {
  if (outcome === undefined || outcome === null || typeof outcome !== 'object') return false;
  if (outcome.status === 'threw') return check.throws !== undefined && (check.throws === true || outcome.name === check.throws);
  if (outcome.status !== 'returned' || check.throws !== undefined || !Buffer.isBuffer(outcome.bytes)) return false;
  try {
    return isDeepStrictEqual(v8.deserialize(outcome.bytes), check.expected); // rule:compare
  } catch {
    return false;
  }
}

// Turns the raw report into failures. Pure and parent-side; exported so a test can feed it incomplete reports.
function judgeReport({ report, requiredExports, checks }) {
  const failures = [];
  if (report?.loaded === false) return [`final-load-failed:${report.load_error}`];
  if (report?.loaded !== true) return ['final-no-verdict'];
  const exportsSeen = report.exports || {};
  for (const name of requiredExports) {
    if (exportsSeen[name] === undefined || exportsSeen[name] === 'absent')
      failures.push(`export-missing:${name}`); // rule:exports
    else if (exportsSeen[name] === 'accessor' || exportsSeen[name] === 'proxy') failures.push(`export-not-data:${name}`); // rule:data
  }
  const results = report.results || {};
  if (Object.keys(results).length !== checks.length) failures.push('results-count-mismatch'); // rule:one-per-check
  for (const [index, check] of checks.entries()) {
    if (!judgeCheck(check, results[index])) failures.push(`check-failed:${index}:${check.export}`); // rule:checks
  }
  return failures;
}

function validate({ original, final, requiredExports, preservedSegments, checks }) {
  const unknown = [];
  if (!isNonEmptyString(original)) unknown.push('original-missing');
  if (!isNonEmptyString(final)) unknown.push('final-missing');
  const exportsValid =
    Array.isArray(requiredExports) && requiredExports.length > 0 && requiredExports.every((name) => isNonEmptyString(name));
  if (!exportsValid) unknown.push('required-exports-invalid');
  if (
    !Array.isArray(preservedSegments) ||
    preservedSegments.length === 0 ||
    !preservedSegments.every((segment) => isNonEmptyString(segment))
  )
    unknown.push('preserved-segments-invalid');
  const checksValid = Array.isArray(checks) && checks.length > 0 && checks.every((check) => isCheck(check));
  if (!checksValid) unknown.push('checks-invalid');
  if (unknown.length > 0) return unknown;
  const originalTokens = codeTokens(original);
  if (originalTokens === null) return ['original-unparseable'];
  for (const [index, segment] of preservedSegments.entries()) {
    const tokens = codeTokens(segment);
    if (tokens === null || tokens.length === 0 || !hasSequence(originalTokens, tokens))
      unknown.push(`preserved-segment-not-in-original-code:${index}`);
  }
  for (const name of requiredExports) {
    const distinct = new Set(checks.filter((check) => check.export === name).map((check) => expectedKey(check)));
    if (distinct.size < 2) unknown.push(`export-needs-2-distinct-checks:${name}`); // rule:min-checks
  }
  return unknown;
}

function evaluateWholeFile(options = {}) {
  const { original, final, requiredExports, preservedSegments, checks, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const isolation = networkIsolation();
  const base = {
    original_bytes: Buffer.byteLength(typeof original === 'string' ? original : ''),
    final_bytes: Buffer.byteLength(typeof final === 'string' ? final : ''),
    network_isolation: isolation,
  };
  const unknown = validate(options);
  if (unknown.length > 0) return { verdict: 'unknown', failures: [], unknown, ...base };

  const failures = [];
  const finalTokens = codeTokens(final);
  const finalCallables = topLevelCallables(final);
  if (finalTokens === null || finalCallables === null) return { verdict: 'fail', failures: ['final-syntax-invalid'], unknown: [], ...base };
  for (const [index, segment] of preservedSegments.entries()) {
    if (!hasSequence(finalTokens, codeTokens(segment))) failures.push(`segment-missing:${index}`); // rule:segments
  }
  for (const [name, statements] of topLevelCallables(original)) {
    if (!finalCallables.has(name))
      failures.push(`function-missing:${name}`); // rule:functions
    else if (statements > 0 && finalCallables.get(name) === 0) failures.push(`function-emptied:${name}`); // rule:empty
  }
  const names = [...new Set([...requiredExports, ...checks.map((check) => check.export)])];
  const calls = checks.map((check) => ({ export: check.export, args: structuredClone(check.args) }));
  const run = runFinal({ finalSource: final, names, calls, timeoutMs, isolation });
  if (run.failure) failures.push(run.failure);
  else failures.push(...judgeReport({ report: run.report, requiredExports, checks }));
  return { verdict: failures.length > 0 ? 'fail' : 'pass', failures, unknown: [], ...base };
}

module.exports = { evaluateWholeFile, judgeReport, buildCommand, networkIsolation, SELF };
