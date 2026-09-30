'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { projectWorkspaceSnapshot } = require('../tools/cli/lib/engineering-workspace');
const { projectVerifierDigest, attestEngineeringVerifier } = require('../tools/cli/lib/engineering-project-verifier');
const { readEngineeringTask } = require('../tools/cli/lib/engineering-task-contract');
const { runEngineeringTask, inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
const base = require('./fixtures/engineering-task/addition.json');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const { fixture } = require('./helpers/engineering-project');

test('v2 snapshots a Git project and preserves its immutable input after external edits', (t) => {
  const f = fixture(t);
  const read = readEngineeringTask(f.filename);
  assert.equal(read.contract.initial_files.length, 1);
  assert.equal(read.contract.initial_files[0].sha256, sha('module.exports = (n) => n + 1;\n'));
  fs.writeFileSync(path.join(f.root, 'index.js'), 'changed');
  assert.throws(() => readEngineeringTask(f.filename), { code: 'ENGINEERING_TASK_CONTRACT_INVALID' });
  assert.equal(read.contract.initial_files[0].content, 'module.exports = (n) => n + 1;\n');
});

test('v2 refuses links, invalid UTF-8, changed Git baseline and embedded substitution', (t) => {
  for (const kind of ['symlink', 'hardlink', 'utf8', 'head', 'embedded']) {
    const f = fixture(t);
    const file = path.join(f.root, 'index.js');
    if (kind === 'symlink' || kind === 'hardlink') {
      fs.renameSync(file, file + '.original');
      fs[kind === 'symlink' ? 'symlinkSync' : 'linkSync'](file + '.original', file);
    }
    if (kind === 'utf8') fs.writeFileSync(file, Buffer.from([0xff]));
    if (kind === 'head') {
      f.contract.baseline_sha = '0'.repeat(40);
      f.save();
    }
    if (kind === 'embedded') {
      const content = 'fake';
      f.contract.initial_files = [{ path: 'index.js', content, sha256: sha(content) }];
      f.save();
    }
    assert.throws(() => readEngineeringTask(f.filename), { code: 'ENGINEERING_TASK_CONTRACT_INVALID' }, kind);
  }
});

test('project acceptance and verifier inputs cannot drift after pinning', (t) => {
  const f = fixture(t);
  attestEngineeringVerifier(f.contract);
  f.contract.verifier.checks[0].expected = 99;
  assert.throws(() => attestEngineeringVerifier(f.contract), /pinned/);
  f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  f.contract.acceptance[0].description = 'Changed acceptance';
  assert.throws(() => attestEngineeringVerifier(f.contract), /pinned/);
});

for (const scenario of [
  {
    name: 'Node multi-file',
    files: { 'index.js': "module.exports = require('./lib/calc.js');", 'lib/calc.js': 'module.exports = (n) => n + 1;' },
  },
  {
    name: 'TypeScript',
    files: { 'index.ts': 'function calculate(n: number): number { return n + 1; } module.exports = calculate;' },
    entry: 'index.ts',
  },
  {
    name: 'Python multi-file',
    files: {
      'main.py': 'from helpers import increment\ndef calculate(n): return increment(n)\n',
      'helpers.py': 'def increment(n): return n + 1\n',
    },
    entry: 'main.py',
    runtime: 'python',
  },
  {
    name: 'web static content',
    files: { 'index.html': '<h1>Project</h1>' },
    entry: 'index.html',
    reference: 'verifier://project/web-content-v1',
    expected: '<h1>Project</h1>',
    args: [],
  },
  { name: 'incorrect delivery', expected: 99, outcome: 'failed' },
]) {
  test(`protected verifier executes ${scenario.name} inside isolation`, async (t) => {
    const f = fixture(t, scenario);
    const responses = path.join(f.directory, 'responses.json');
    fs.writeFileSync(responses, '[]');
    const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
    t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
    assert.equal(result.task_result, scenario.outcome || 'approved', JSON.stringify(result));
    assert.equal(result.profile, 'managed-project');
    assert.equal((await inspectEngineeringTask({ state: result.state })).task_result, result.task_result);
    const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
    assert.equal(evidence.verification.evidence.descendants_terminated, true);
  });
}

test('project search, preconditioned patch and diff share governed task execution', async (t) => {
  const f = fixture(t, { files: { 'index.js': 'module.exports = n => n - 1;' } });
  const responses = path.join(f.directory, 'responses.json');
  fs.writeFileSync(
    responses,
    JSON.stringify([
      { name: 'engineering.search', input: { text: 'n - 1', limit: 10 } },
      {
        name: 'engineering.patch',
        input: { path: 'index.js', expected_sha256: sha('module.exports = n => n - 1;'), before: 'n - 1', after: 'n + 1' },
      },
      { name: 'engineering.diff', input: {} },
    ]),
  );
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responses });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  assert.equal(fs.readFileSync(path.join(f.root, 'index.js'), 'utf8'), 'module.exports = n => n - 1;');
  const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
  assert.equal(evidence.artifacts.files[0].content, 'module.exports = n => n + 1;');
});
