'use strict';

// W5-11a mutation matrix. Each mutant removes one guard in memory (a loader generated under $TMPDIR and deleted after the
// run, so the working tree is never touched) and the W5 negative matrix must then fail with an assertion. The control run
// without the mutation must pass first, and the mutant must prove it was applied.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const REPO = path.resolve(__dirname, '..');
const MATRIX = 'test/test-w5-negative-matrix.js';
const { MUTANTS } = require('./fixtures/w5-mutants.cjs');

// The loader replays the recorded replacement in memory when the target module is compiled.
const LOADER = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const spec = JSON.parse(fs.readFileSync(process.env.HSEOS_W5_MUTATION_SPEC, 'utf8'));
const target = path.resolve(spec.repo, spec.file);
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (filename !== target) return original(module, filename);
  let source = fs.readFileSync(filename, 'utf8');
  for (const [before, after] of spec.replacements) {
    if (source.split(before).length !== 2) throw new Error('Mutation anchor must occur exactly once: ' + before);
    source = source.replace(before, () => after);
  }
  process.stderr.write('HSEOS_TEST_MUTATION_APPLIED:' + spec.id + '\\n');
  module._compile(source, filename);
};
`;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-mutation-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const loader = path.join(scratch, 'loader.cjs');
fs.writeFileSync(loader, LOADER);

function runSuite(suite, pattern, extraEnv) {
  const env = { ...process.env, NODE_V8_COVERAGE: '', ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  if (extraEnv.NODE_OPTIONS) env.NODE_OPTIONS = extraEnv.NODE_OPTIONS;
  const selection = pattern === null ? [] : [`--test-name-pattern=${pattern}`];
  return spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...selection, suite], {
    cwd: REPO,
    env,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

const status = () => spawnSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout;

for (const [id, group, pattern, file, replacements, options = {}] of MUTANTS) {
  const suite = options.suite ?? MATRIX;
  test(`the ${options.suite ? 'unit suite' : 'negative matrix'} detects removal of the ${id} guard (${group})`, () => {
    const dirty = status();
    const control = runSuite(suite, pattern, {});
    assert.equal(control.error, undefined);
    assert.equal(control.status, 0, control.stdout + control.stderr);
    assert.match(control.stdout, /^# tests 1$/m, 'the pattern selects exactly one case');
    assert.match(control.stdout, /^# fail 0$/m);
    assert.doesNotMatch(control.stdout + control.stderr, /HSEOS_TEST_MUTATION_APPLIED/);

    const specFile = path.join(scratch, `${id}.json`);
    fs.writeFileSync(specFile, JSON.stringify({ id, repo: REPO, file, replacements }));
    const mutant = runSuite(suite, pattern, { HSEOS_W5_MUTATION_SPEC: specFile, NODE_OPTIONS: `--require ${loader}` });
    assert.equal(mutant.error, undefined);
    assert.equal(mutant.status, 1, mutant.stdout + mutant.stderr);
    assert.match(mutant.stdout + mutant.stderr, new RegExp(`HSEOS_TEST_MUTATION_APPLIED:${id}`), 'the mutation was applied');
    assert.match(mutant.stdout, /^# fail 1$/m);
    if (options.failure) assert.match(mutant.stdout + mutant.stderr, options.failure);
    else assert.match(mutant.stdout, /ERR_ASSERTION/);
    assert.equal(status(), dirty, 'the working tree is exactly as before the mutant');
  });
}

test('every mutation group of the W5 contract has at least one mutant', () => {
  const groups = new Set(MUTANTS.map((mutant) => mutant[1]));
  for (const group of ['authority', 'provenance', 'approval', 'weak', 'args']) assert.ok(groups.has(group), group);
  assert.equal(new Set(MUTANTS.map((mutant) => mutant[0])).size, MUTANTS.length, 'mutant ids are unique');
});
