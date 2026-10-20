'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { fixture: projectFixture } = require('./helpers/engineering-project');
const { readEngineeringTask } = require('../tools/cli/lib/engineering-task-contract');
const { createEngineeringTools } = require('../tools/cli/lib/engineering-tools');
const sha = (value) => createHash('sha256').update(value).digest('hex');

const SMALL = 'module.exports = (n) => n + 1;\n';
const TARGET = 'module.exports = (n) => n - 1;';

/** About 123 KB of lines: two identical marker lines far apart, unique anchors, and the target at the end. */
function largeSource() {
  const lines = [];
  for (let index = 1; index <= 3000; index++) {
    if (index === 10 || index === 2000) lines.push('const marker = 1;');
    else if (index === 500) lines.push('const unique500 = 5;');
    else lines.push(`// filler line ${index} ${'.'.repeat(20)}`);
  }
  lines.push(TARGET, '');
  return lines.join('\n');
}

function fixture(t, given) {
  const files = given || { 'index.js': largeSource(), 'small.js': SMALL };
  const project = projectFixture(t, { files, maxArtifactBytes: 1_048_576 });
  const { contract } = readEngineeringTask(project.filename);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-tools-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace');
  fs.mkdirSync(workspace);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(workspace, name), content);
  const policy = { host_workspace: workspace, policy_digest: 'tools-test' };
  const tools = createEngineeringTools({ directory, contract, policy, deadline: Number.MAX_SAFE_INTEGER });
  const call = async (name, input) =>
    (await tools.bundles.find((bundle) => bundle.definition.name === name).provider.execute(input, {})).data;
  return { call, tools, workspace, contract, directory };
}
const codeOf = async (promise) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error.code;
  }
};

test('the fixture is a real large file: about 123 KB, above the plain 64 KB limit, inside the large limit', (t) => {
  const f = fixture(t);
  const size = Buffer.byteLength(largeSource());
  assert.ok(size > 120_000 && size < 130_000, String(size));
  assert.equal(f.contract.initial_files.find((entry) => entry.path === 'index.js').content.length, largeSource().length);
});

test('engineering.read: a large file needs a line range and a small file is read whole with its totals', async (t) => {
  const f = fixture(t);
  assert.equal(await codeOf(f.call('engineering.read', { path: 'index.js' })), 'ENGINEERING_RANGE_REQUIRED');
  const whole = await f.call('engineering.read', { path: 'small.js' });
  assert.equal(whole.content, SMALL);
  assert.deepEqual([whole.total_lines, whole.total_bytes], [1, Buffer.byteLength(SMALL)]);
  const ranged = await f.call('engineering.read', { path: 'index.js', start_line: 498, end_line: 502 });
  assert.equal(ranged.content.split('\n')[2], 'const unique500 = 5;');
  assert.deepEqual([ranged.start_line, ranged.end_line, ranged.truncated], [498, 502, false]);
  assert.equal(ranged.sha256, sha(largeSource()));
  assert.equal(ranged.total_lines, 3001);
  assert.equal(ranged.total_bytes, Buffer.byteLength(largeSource()));
});

test('engineering.read: every invalid range is ENGINEERING_RANGE_INVALID and none reads anything', async (t) => {
  const f = fixture(t);
  const invalid = [
    { start_line: 0, end_line: 5 },
    { start_line: -1, end_line: 5 },
    { start_line: 1.5, end_line: 5 },
    { start_line: 1, end_line: 2.5 },
    { start_line: 10, end_line: 5 },
    { start_line: 3002, end_line: 3010 },
    { start_line: 5 },
    { end_line: 5 },
    { start_line: Number.NaN, end_line: 5 },
  ];
  for (const range of invalid) {
    assert.equal(
      await codeOf(f.call('engineering.read', { path: 'index.js', ...range })),
      'ENGINEERING_RANGE_INVALID',
      JSON.stringify(range),
    );
  }
  assert.equal(await codeOf(f.call('engineering.read', { path: 'small.js', start_line: 2, end_line: 3 })), 'ENGINEERING_RANGE_INVALID');
});

test('engineering.read: a range past the window is cut and says so; a range past the end is cut silently', async (t) => {
  const f = fixture(t);
  const lines = await f.call('engineering.read', { path: 'index.js', start_line: 1, end_line: 1000 });
  assert.equal(lines.truncated, true);
  assert.ok(lines.end_line <= 300 && lines.end_line >= 1);
  assert.equal(lines.content.split('\n').length, lines.end_line);
  const bytes = await f.call('engineering.read', { path: 'index.js', start_line: 1, end_line: 300 });
  assert.ok(Buffer.byteLength(bytes.content) <= 12_288);
  const tail = await f.call('engineering.read', { path: 'index.js', start_line: 2999, end_line: 5000 });
  assert.equal(tail.truncated, false);
  assert.equal(tail.end_line, 3001);
  assert.equal(tail.content.split('\n').at(-1), TARGET);
});

test('engineering.read: a single line above 12 KiB is cut to the byte window', async (t) => {
  const files = { 'index.js': `${'x'.repeat(20_000)}\n${'y'.repeat(70_000)}\n`, 'small.js': SMALL };
  const f = fixture(t, files);
  const read = await f.call('engineering.read', { path: 'index.js', start_line: 1, end_line: 1 });
  assert.equal(read.truncated, true);
  assert.ok(Buffer.byteLength(read.content) <= 12_288);
  const many = await f.call('engineering.read', { path: 'index.js', start_line: 1, end_line: 2 });
  assert.equal(many.end_line, 1, 'a second line that does not fit the byte window is left out and reported');
  assert.equal(many.truncated, true);
});

test('engineering.read and engineering.write stay inside the declared scope and refuse unsafe files', async (t) => {
  const f = fixture(t);
  for (const bad of ['other.js', '../index.js', '/etc/passwd', 'index.js/../small.js']) {
    assert.match(
      String(await codeOf(f.call('engineering.read', { path: bad, start_line: 1, end_line: 2 }))),
      /ENGINEERING_SCOPE_DENIED/,
      bad,
    );
  }
  const target = path.join(f.workspace, 'index.js');
  fs.renameSync(target, `${target}.real`);
  fs.symlinkSync(`${target}.real`, target);
  await assert.rejects(f.call('engineering.read', { path: 'index.js', start_line: 1, end_line: 2 }), /safely read/);
  fs.rmSync(target);
  fs.linkSync(`${target}.real`, target);
  await assert.rejects(f.call('engineering.read', { path: 'index.js', start_line: 1, end_line: 2 }), /safely read/);
});
