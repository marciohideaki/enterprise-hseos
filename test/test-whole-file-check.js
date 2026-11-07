'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');

const SHARED = path.join(__dirname, '../docs/evolution/w3/evidence/shared');
// WHOLE_FILE_CHECK_MODULE lets the mutation proof run this same suite against a mutated copy of the module.
const { evaluateWholeFile, judgeReport, buildCommand } = require(
  process.env.WHOLE_FILE_CHECK_MODULE || path.join(SHARED, 'whole-file-check.cjs'),
);
const SUMMARIZE = path.join(SHARED, 'summarize-whole-file.cjs');
const v8 = require('node:v8');
const scratchRoot = process.env.TMPDIR || os.tmpdir();

const ORIGINAL = fs.readFileSync(path.join(__dirname, '../docs/evolution/w3/evidence/stab-f15c/numeric-helpers.fixture.txt'), 'utf8');
// The final file the reference run of `mini-3` left (347 bytes, one function), rebuilt from the verdict preview (see T4.md).
const MUTILATED = fs.readFileSync(path.join(__dirname, 'fixtures/whole-file-check/mini-3-mutilated.fixture.txt'), 'utf8');
const FIXED = ORIGINAL.replace('return a - b;', 'return a + b;');
const CLAMP = 'return Math.min(Math.max(value, min), max);';

const EXPORTS = ['.', 'sub', 'mul', 'clamp', 'sum'];
const SEGMENTS = [
  'function assertNumber(value, name)',
  CLAMP,
  "throw new RangeError('min must not be greater than max')",
  'total = total + assertNumber(value, ',
];
const CHECKS = [
  { export: '.', args: [2, 3], expected: 5 },
  { export: '.', args: [10, 1], expected: 11 },
  { export: '.', args: ['2', 3], throws: 'TypeError' },
  { export: 'sub', args: [5, 3], expected: 2 },
  { export: 'sub', args: [1, 4], expected: -3 },
  { export: 'mul', args: [4, 3], expected: 12 },
  { export: 'mul', args: [2, 5], expected: 10 },
  { export: 'clamp', args: [9, 0, 5], expected: 5 },
  { export: 'clamp', args: [-9, 0, 5], expected: 0 },
  { export: 'clamp', args: [1, 5, 0], throws: 'RangeError' },
  { export: 'sum', args: [[1, 2, 3]], expected: 6 },
  { export: 'sum', args: [[]], expected: 0 },
];
const input = (final, extra = {}) => ({
  original: ORIGINAL,
  final,
  requiredExports: EXPORTS,
  preservedSegments: SEGMENTS,
  checks: CHECKS,
  timeoutMs: 1500,
  ...extra,
});
const reproved = (result, label) => {
  assert.equal(result.verdict, 'fail', `${label}: ${JSON.stringify(result)}`);
  return result;
};

test('(a) the real mutilation of mini-3 is reproved', () => {
  assert.equal(Buffer.byteLength(MUTILATED), 347);
  const result = reproved(evaluateWholeFile(input(MUTILATED)), 'mini-3');
  for (const name of ['sub', 'mul', 'clamp', 'sum']) assert.ok(result.failures.includes(`export-missing:${name}`), name);
  assert.ok(result.failures.some((failure) => failure.startsWith('segment-missing:')));
  assert.ok(result.failures.includes('function-missing:assertNumber'), 'an unexported helper is checked too');
  assert.ok(result.failures.some((failure) => failure.startsWith('check-failed:')));
});

test('(a) the old criterion alone would have approved it: add(2, 3) is right', () => {
  const result = evaluateWholeFile(
    input(MUTILATED, {
      requiredExports: ['.'],
      preservedSegments: ['function add(a, b)'],
      checks: CHECKS.filter((check) => check.export === '.'),
      original: MUTILATED,
    }),
  );
  assert.equal(result.verdict, 'pass');
});

test('(b) an intact file with the requested change is approved', () => {
  const result = evaluateWholeFile(input(FIXED));
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
  assert.deepEqual(result.failures, []);
  reproved(evaluateWholeFile(input(ORIGINAL)), 'the unfixed original still subtracts');
});

test('(c) a deleted preserved segment is reproved even with the exports equal', () => {
  const result = reproved(evaluateWholeFile(input(FIXED.replace(CLAMP, 'return Math.max(Math.min(value, max), min);'))), 'segment');
  assert.deepEqual(result.failures, ['segment-missing:1']);
});

test('(c) a segment that survives only inside a comment or a string does not count', () => {
  const inComment = FIXED.replace(CLAMP, `return Math.max(Math.min(value, max), min); // ${CLAMP}`);
  assert.deepEqual(reproved(evaluateWholeFile(input(inComment)), 'comment').failures, ['segment-missing:1']);
  const inString = FIXED.replace(CLAMP, `const note = ${JSON.stringify(CLAMP)};\n  return Math.max(Math.min(value, max), min);`);
  assert.deepEqual(reproved(evaluateWholeFile(input(inString)), 'string').failures, ['segment-missing:1']);
});

test('(c) a deleted unexported helper is reproved by structure, not by a listed segment', () => {
  const renamed = FIXED.replaceAll('assertNumber', 'checkNumber');
  const result = reproved(evaluateWholeFile(input(renamed, { preservedSegments: [CLAMP] })), 'helper');
  assert.deepEqual(result.failures, ['function-missing:assertNumber']);
});

test('(d) a helper whose return changed is reproved', () => {
  const result = reproved(evaluateWholeFile(input(FIXED.replace('return a * b;', 'return a + b;'))), 'mul');
  assert.deepEqual(result.failures, ['check-failed:5:mul', 'check-failed:6:mul']);
});

test('(e) missing or invalid input is unknown, never approved', () => {
  const cases = [
    {},
    input(null),
    input(FIXED, { original: null }),
    input(FIXED, { requiredExports: [] }),
    input(FIXED, { checks: [] }),
    input(FIXED, { checks: [{ export: 'sub' }] }),
    input(FIXED, { preservedSegments: [] }),
    input(FIXED, { preservedSegments: ['function notInTheOriginal() {}'] }),
    input(FIXED, { requiredExports: [...EXPORTS, 'never-checked'] }),
    input(FIXED, { checks: CHECKS.filter((check) => check.export !== 'sub' || check.args[0] === 5) }),
    input(FIXED, { checks: CHECKS.map((check) => (check.export === 'sub' ? { ...check, expected: 2 } : check)) }),
    input(FIXED, { original: 'function (' }),
  ];
  for (const value of cases) {
    const result = evaluateWholeFile(value);
    assert.equal(result.verdict, 'unknown', JSON.stringify(Object.keys(value)));
    assert.ok(result.unknown.length > 0);
  }
});

test('(e) constants that satisfy one check per export no longer pass: two distinct outputs are required', () => {
  const constants = "module.exports = () => 5; for (const n of ['sub', 'mul', 'clamp', 'sum']) module.exports[n] = () => 2;\n";
  reproved(evaluateWholeFile(input(`${constants}${FIXED.replace(/module\.exports[\s\S]*$/, '')}`)), 'constants');
});

test('(f) a final file that hangs, throws or floods the output is reproved without hanging the verifier', () => {
  const started = Date.now();
  assert.ok(reproved(evaluateWholeFile(input(`${FIXED}\nwhile (true) {}\n`)), 'hang').failures.includes('final-timeout'));
  assert.ok(Date.now() - started < 10_000);
  const thrown = reproved(evaluateWholeFile(input("throw new Error('boom');\n")), 'throw');
  assert.ok(
    thrown.failures.some(
      (failure) => failure.startsWith('final-load-failed:') || failure === 'final-syntax-invalid' || failure.startsWith('segment-missing'),
    ),
  );
  const flood = `${FIXED}\nconst fs = require('node:fs');\nfor (let i = 0; i < 400; i++) fs.writeSync(1, 'x'.repeat(8192));\n`;
  assert.ok(reproved(evaluateWholeFile(input(flood)), 'flood').failures.includes('final-output-too-large'));
});

test('a final file cannot forge the verdict', () => {
  const forged = (extra) => `${FIXED}\n${extra}\n`;
  const exitZero = reproved(
    evaluateWholeFile(
      input(
        forged(
          `const fs = require('node:fs'); fs.writeSync(3, JSON.stringify({ nonce: 'x', loaded: true, exports: {}, checks: [] }) + '\\n'); process.exit(0);`,
        ),
      ),
    ),
    'exit',
  );
  assert.deepEqual(exitZero.failures, ['final-no-verdict']);
  const printed = reproved(
    evaluateWholeFile(input(forged(`console.log(JSON.stringify({ loaded: true, checks: [], exports: {} })); process.exit(0);`))),
    'stdout',
  );
  assert.deepEqual(printed.failures, ['final-no-verdict']);
  const lateWrite = forged(
    `process.on('exit', () => require('node:fs').writeSync(3, JSON.stringify({ nonce: process.argv.join(), loaded: true }) + '\\n'));`,
  );
  assert.equal(evaluateWholeFile(input(lateWrite)).verdict, 'pass', 'noise on the channel is ignored, not trusted');
  const replacedEqual = forged(`require('node:util').isDeepStrictEqual = () => true;`).replace('return a + b;', 'return a * b + 1;');
  reproved(evaluateWholeFile(input(replacedEqual)), 'isDeepStrictEqual');
  const replacedStringify = forged(`JSON.stringify = () => '{}'; JSON.parse = () => ({});`);
  reproved(evaluateWholeFile(input(replacedStringify.replace('return a - b;', 'return 0;'))), 'JSON');
});

test('exports that are accessors or proxies are reproved', () => {
  const getter = `${FIXED.replace('module.exports.sub = sub;', "Object.defineProperty(module.exports, 'sub', { enumerable: true, get: () => sub });")}`;
  assert.ok(reproved(evaluateWholeFile(input(getter)), 'getter').failures.includes('export-not-data:sub'));
  const proxy = `${FIXED.replace('module.exports = add;', 'module.exports = new Proxy(add, {});')}`;
  assert.ok(reproved(evaluateWholeFile(input(proxy)), 'proxy').failures.includes('export-not-data:.'));
});

test('the final file runs with a minimal environment', () => {
  const finalSource = `${FIXED}\nmodule.exports.envKeys = (count) => (count ? Object.keys(process.env).length : Object.keys(process.env));\n`;
  const checks = [...CHECKS, { export: 'envKeys', args: [false], expected: ['TMPDIR'] }, { export: 'envKeys', args: [true], expected: 1 }];
  process.env.WHOLE_FILE_SECRET_PROBE = 'must-not-leak';
  try {
    const result = evaluateWholeFile(input(finalSource, { requiredExports: [...EXPORTS, 'envKeys'], checks }));
    assert.equal(result.verdict, 'pass', JSON.stringify(result));
  } finally {
    delete process.env.WHOLE_FILE_SECRET_PROBE;
  }
});

test('the network namespace is used when the host allows it and the result says which isolation applied', () => {
  const probe = spawnSync('unshare', ['-rn', 'true'], { stdio: 'ignore' }).status === 0 ? 'namespace' : 'none';
  assert.equal(evaluateWholeFile(input(FIXED)).network_isolation, probe);
  assert.deepEqual(buildCommand('namespace', ['x']).args.slice(0, 2), ['-rn', process.execPath]);
  assert.equal(buildCommand('namespace', ['x']).command, 'unshare');
  assert.equal(buildCommand('none', ['x']).command, process.execPath);
});

test('a final file that connects to a local server makes no connection under the namespace', async (t) => {
  const server = spawn(
    process.execPath,
    [
      '-e',
      `const s = require('node:net').createServer((c) => { count++; c.destroy(); }); let count = 0;
       s.listen(0, '127.0.0.1', () => console.log(s.address().port));
       process.stdin.on('data', () => { console.log('count=' + count); process.exit(0); });`,
    ],
    { stdio: ['pipe', 'pipe', 'inherit'], env: { PATH: process.env.PATH } },
  );
  t.after(() => server.kill('SIGKILL'));
  let output = '';
  server.stdout.on('data', (chunk) => (output += chunk));
  const waitFor = async (pattern) => {
    for (let i = 0; i < 100 && !pattern.test(output); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    return output.match(pattern);
  };
  const port = (await waitFor(/^(\d+)/m))[1];
  const reach = `${FIXED}\nrequire('node:net').connect(${port}, '127.0.0.1').on('error', () => {});\n`;
  const result = await new Promise((resolve) => setImmediate(() => resolve(evaluateWholeFile(input(reach)))));
  server.stdin.write('stop\n');
  const connections = Number((await waitFor(/count=(\d+)/))[1]);
  if (result.network_isolation === 'namespace') assert.equal(connections, 0, 'no connection may cross the namespace');
  else {
    assert.equal(result.network_isolation, 'none');
    assert.equal(spawnSync('unshare', ['-rn', 'true'], { stdio: 'ignore' }).status === 0, false);
  }
});

test('the summarizer prints JSON, exits non-zero unless pass, and refuses a pass without isolation unless told', (t) => {
  const dir = fs.mkdtempSync(path.join(scratchRoot, 'whole-file-summary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'original.txt'), ORIGINAL);
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify({ requiredExports: EXPORTS, preservedSegments: SEGMENTS, checks: CHECKS }));
  const run = (...flags) => spawnSync(process.execPath, [SUMMARIZE, dir, ...flags], { encoding: 'utf8' });
  assert.equal(JSON.parse(run().stdout).verdict, 'unknown');
  assert.notEqual(run().status, 0);
  fs.writeFileSync(path.join(dir, 'final.txt'), MUTILATED);
  assert.equal(JSON.parse(run().stdout).verdict, 'fail');
  assert.notEqual(run().status, 0);
  fs.writeFileSync(path.join(dir, 'final.txt'), FIXED);
  const plain = run();
  const parsed = JSON.parse(plain.stdout);
  if (parsed.network_isolation === 'namespace') {
    assert.equal(parsed.verdict, 'pass');
    assert.equal(plain.status, 0);
  } else {
    assert.equal(parsed.verdict, 'unknown');
    assert.deepEqual(parsed.unknown, ['network-isolation-none']);
    assert.notEqual(plain.status, 0);
    const accepted = run('--accept-no-network-isolation');
    assert.equal(JSON.parse(accepted.stdout).verdict, 'pass');
    assert.equal(JSON.parse(accepted.stdout).accepted_no_network_isolation, true);
    assert.equal(accepted.status, 0);
  }
});

test('a final file that defines Object.prototype.toJSON cannot forge the verdict', () => {
  const forge = `${FIXED}
Object.prototype.toJSON = function () { return this; };
Array.prototype.toJSON = function () { return this; };
module.exports = () => 0;
`;
  const result = reproved(evaluateWholeFile(input(forge)), 'toJSON');
  assert.ok(result.failures.some((failure) => failure.startsWith('check-failed:')));
});

test('a final file that tampers with Object.prototype and Array.prototype never passes', () => {
  const cheat = 'module.exports = () => 0;';
  const tampering = [
    "Object.defineProperty(Object.prototype, 'nonce', { get() { return 'x'; }, configurable: true });",
    "Object.defineProperty(Object.prototype, 'status', { value: 'returned', writable: true, configurable: true });",
    'Array.prototype[Symbol.iterator] = function* () { yield 1; };',
    'Array.prototype.push = function () { return 0; }; Array.prototype.map = () => [];',
    "Object.prototype.toString = () => 'x'; Number.prototype.toString = () => '0'; String.prototype.padStart = () => '';",
    "JSON.parse = () => ({}); JSON.stringify = () => '{}'; Buffer.concat = () => Buffer.alloc(0);",
  ];
  for (const code of tampering) {
    const result = evaluateWholeFile(input(`${FIXED}\n${code}\n${cheat}\n`));
    assert.notEqual(result.verdict, 'pass', code);
  }
});

test('a frame written with another nonce is ignored', () => {
  const results = Object.fromEntries(
    CHECKS.map((check, index) => [
      index,
      check.throws ? { status: 'threw', name: check.throws } : { status: 'returned', bytes: v8.serialize(check.expected) },
    ]),
  );
  const exportsSeen = Object.fromEntries(EXPORTS.map((name) => [name, 'function']));
  const payload = v8.serialize({ loaded: true, exports: exportsSeen, results });
  const frame = Buffer.concat([Buffer.from('f'.repeat(32) + payload.length.toString(16).padStart(8, '0')), payload]);
  const forge = `${FIXED}\nrequire('node:fs').writeSync(3, Buffer.from('${frame.toString('base64')}', 'base64'));\nmodule.exports = () => 0;\n`;
  reproved(evaluateWholeFile(input(forge)), 'foreign nonce');
});

test('a check without an outcome, an extra outcome or an unusable outcome is reproved by the parent', () => {
  const returned = (value) => ({ status: 'returned', bytes: v8.serialize(value) });
  const full = Object.fromEntries(
    CHECKS.map((check, index) => [index, check.throws ? { status: 'threw', name: check.throws } : returned(check.expected)]),
  );
  const exportsSeen = Object.fromEntries(EXPORTS.map((name) => [name, 'function']));
  const judge = (results) =>
    judgeReport({ report: { loaded: true, exports: exportsSeen, results }, requiredExports: EXPORTS, checks: CHECKS });
  assert.deepEqual(judge(full), []);
  const { 3: _dropped, ...missing } = full;
  const withoutOne = judge(missing);
  assert.ok(withoutOne.includes('results-count-mismatch'));
  assert.ok(withoutOne.includes('check-failed:3:sub'));
  assert.ok(judge({ ...full, 99: returned(1) }).includes('results-count-mismatch'));
  assert.ok(judge({ ...full, 0: { status: 'returned' } }).includes('check-failed:0:.'));
  assert.ok(judge({ ...full, 0: { status: 'unserializable' } }).includes('check-failed:0:.'));
  assert.ok(judge({ ...full, 0: returned(6) }).includes('check-failed:0:.'));
});

test('a top-level function whose body was emptied is reproved even when nothing checks it', () => {
  const emptiedHelper = FIXED.replace(/function assertNumber\(value, name\) \{[\s\S]*?\n\}\n/, 'function assertNumber(value, name) {}\n');
  assert.ok(
    reproved(evaluateWholeFile(input(emptiedHelper, { preservedSegments: [CLAMP] })), 'helper').failures.includes(
      'function-emptied:assertNumber',
    ),
  );
  const emptiedExport = FIXED.replace(/function sum\(values\) \{[\s\S]*?\n\}\n/, 'function sum(values) {}\n');
  assert.ok(reproved(evaluateWholeFile(input(emptiedExport)), 'export').failures.includes('function-emptied:sum'));
});

test('references captured before the final file loads keep the verdict working under tampered built-ins', () => {
  const tamper = `${FIXED}
const fs = require('node:fs'); const util = require('node:util'); const v8 = require('node:v8');
fs.writeSync = () => 0; fs.readFileSync = () => '{}'; v8.serialize = () => Buffer.alloc(0); util.isDeepStrictEqual = () => false;
util.types.isProxy = () => true; JSON.parse = () => null;
`;
  assert.equal(evaluateWholeFile(input(tamper)).verdict, 'pass');
});
