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

test('engineering.patch: a large file is changed by a short anchored patch and answers with sha, totals and line only', async (t) => {
  const f = fixture(t);
  const source = largeSource();
  const result = await f.call('engineering.patch', { path: 'index.js', expected_sha256: sha(source), before: 'n - 1', after: 'n + 1' });
  const next = source.replace('n - 1', 'n + 1');
  assert.deepEqual(result, { path: 'index.js', sha256: sha(next), total_lines: 3001, total_bytes: Buffer.byteLength(next), line: 3001 });
  assert.equal(fs.readFileSync(path.join(f.workspace, 'index.js'), 'utf8'), next);
  assert.ok(JSON.stringify(result).length < 300);
});

test('engineering.patch: sequential patches chain the sha; the sha of the first state is stale after the first patch', async (t) => {
  const f = fixture(t);
  const source = largeSource();
  const first = await f.call('engineering.patch', {
    path: 'index.js',
    expected_sha256: sha(source),
    before: 'unique500 = 5',
    after: 'unique500 = 6',
  });
  const second = await f.call('engineering.patch', { path: 'index.js', expected_sha256: first.sha256, before: 'n - 1', after: 'n + 1' });
  assert.equal(first.line, 500);
  assert.equal(second.line, 3001);
  const final = source.replace('unique500 = 5', 'unique500 = 6').replace('n - 1', 'n + 1');
  assert.equal(second.sha256, sha(final));
  assert.equal(
    await codeOf(f.call('engineering.patch', { path: 'index.js', expected_sha256: sha(source), before: 'n + 1', after: 'n + 2' })),
    'ENGINEERING_EFFECT_RECONCILIATION_REQUIRED',
  );
  assert.equal(fs.readFileSync(path.join(f.workspace, 'index.js'), 'utf8'), final, 'a refused patch changes nothing');
});

test('engineering.patch: wrong sha, ambiguous or absent before, and within narrowing', async (t) => {
  const f = fixture(t);
  const source = largeSource();
  const attempt = (extra) =>
    codeOf(f.call('engineering.patch', { path: 'index.js', expected_sha256: sha(source), after: 'const marker = 2;', ...extra }));
  const refused = 'ENGINEERING_EFFECT_RECONCILIATION_REQUIRED';
  assert.equal(await attempt({ expected_sha256: '0'.repeat(64), before: 'n - 1' }), refused, 'wrong sha');
  assert.equal(await attempt({ before: 'const marker = 1;' }), refused, 'ambiguous in the file');
  assert.equal(await attempt({ before: 'absent text' }), refused, 'absent');
  assert.equal(await attempt({ before: 'const marker = 1;', within: { start_line: 1999, end_line: 2001 } }), 'resolved');
  const now = fs.readFileSync(path.join(f.workspace, 'index.js'), 'utf8').split('\n');
  assert.deepEqual([now[9], now[1999]], ['const marker = 1;', 'const marker = 2;'], 'only the occurrence inside the range changed');
});

test('engineering.patch within: ambiguous inside the range, outside the range, absent, invalid and past the end', async (t) => {
  const source = `${['a', 'dup', 'b', 'dup', 'c', 'target', 'd'].join('\n')}\n${'x'.repeat(70_000)}\n`;
  const f = fixture(t, { 'index.js': source, 'small.js': SMALL });
  const hash = sha(source);
  const patch = (before, within) =>
    codeOf(
      f.call('engineering.patch', { path: 'index.js', expected_sha256: hash, before, after: 'changed', ...(within ? { within } : {}) }),
    );
  const refused = 'ENGINEERING_EFFECT_RECONCILIATION_REQUIRED';
  assert.equal(await patch('dup'), refused, 'ambiguous in the file');
  assert.equal(await patch('dup', { start_line: 1, end_line: 5 }), refused, 'ambiguous inside the range');
  assert.equal(await patch('target', { start_line: 1, end_line: 5 }), refused, 'present, but outside the range');
  assert.equal(await patch('missing', { start_line: 1, end_line: 7 }), refused, 'absent');
  assert.equal(await patch('dup', { start_line: 0, end_line: 5 }), 'ENGINEERING_RANGE_INVALID');
  assert.equal(await patch('dup', { start_line: 4, end_line: 3 }), 'ENGINEERING_RANGE_INVALID');
  assert.equal(await patch('dup', { start_line: 100, end_line: 200 }), 'ENGINEERING_RANGE_INVALID');
  assert.equal(await patch('dup', { start_line: 4, end_line: 4 }), 'resolved', 'the second dup, alone in its range');
  const now = fs.readFileSync(path.join(f.workspace, 'index.js'), 'utf8');
  assert.equal(now.split('\n').slice(0, 4).join('\n'), 'a\ndup\nb\nchanged');
});

test('engineering.write refuses a large file and still serves a small one', async (t) => {
  const f = fixture(t);
  const source = largeSource();
  assert.equal(
    await codeOf(f.call('engineering.write', { path: 'index.js', expected_sha256: sha(source), content: 'short' })),
    'ENGINEERING_WRITE_REQUIRES_PATCH',
  );
  assert.equal(fs.readFileSync(path.join(f.workspace, 'index.js'), 'utf8'), source);
  const written = await f.call('engineering.write', { path: 'small.js', expected_sha256: sha(SMALL), content: 'module.exports = 1;\n' });
  assert.equal(written.content, 'module.exports = 1;\n');
});

test('engineering.diff: small files keep before/after, a large file reports its region and is read by range per side', async (t) => {
  const f = fixture(t);
  const source = largeSource();
  assert.deepEqual((await f.call('engineering.diff', {})).changes, []);
  await f.call('engineering.patch', { path: 'index.js', expected_sha256: sha(source), before: 'n - 1', after: 'n + 1' });
  await f.call('engineering.write', { path: 'small.js', expected_sha256: sha(SMALL), content: 'module.exports = 2;\n' });
  const all = await f.call('engineering.diff', {});
  const [large, small] = [all.changes.find((entry) => entry.path === 'index.js'), all.changes.find((entry) => entry.path === 'small.js')];
  assert.deepEqual(small, { path: 'small.js', before: SMALL, after: 'module.exports = 2;\n' });
  assert.equal(large.large, true);
  assert.equal(large.before, undefined);
  assert.deepEqual(large.region, { before_start: 3001, before_end: 3001, after_start: 3001, after_end: 3001 });
  assert.equal(large.before_sha256, sha(source));
  assert.equal(large.after_sha256, sha(source.replace('n - 1', 'n + 1')));
  assert.ok(JSON.stringify(all).length < 2000);
  const ranged = await f.call('engineering.diff', { path: 'index.js', start_line: 3000, end_line: 3001 });
  assert.equal(ranged.changes.length, 1);
  assert.equal(ranged.changes[0].before.content.split('\n').at(-1), TARGET);
  assert.equal(ranged.changes[0].after.content.split('\n').at(-1), 'module.exports = (n) => n + 1;');
  assert.equal(await codeOf(f.call('engineering.diff', { start_line: 1, end_line: 3 })), 'ENGINEERING_RANGE_INVALID');
  assert.equal(await codeOf(f.call('engineering.diff', { path: 'index.js', start_line: 0, end_line: 3 })), 'ENGINEERING_RANGE_INVALID');
});

test('engineering.diff: insertions, deletions and a range past one side are described without failing', async (t) => {
  const f = fixture(t);
  const source = largeSource();
  const first = await f.call('engineering.patch', {
    path: 'index.js',
    expected_sha256: sha(source),
    before: 'const unique500 = 5;',
    after: 'const a = 1;\nconst b = 2;',
  });
  const second = await f.call('engineering.patch', {
    path: 'index.js',
    expected_sha256: first.sha256,
    before: 'const marker = 1;',
    within: { start_line: 1, end_line: 20 },
    after: '',
  });
  assert.equal(second.total_lines, 3002);
  const diff = await f.call('engineering.diff', { path: 'index.js', start_line: 3002, end_line: 3010 });
  const [change] = diff.changes;
  assert.equal(change.before_total_lines, 3001);
  assert.equal(change.after_total_lines, 3002);
  assert.equal(change.before.content, '', 'the original has no line 3002');
  assert.ok(change.region.after_end >= change.region.after_start);
});

test('the tool surface: v2 gains optional range fields, v1 keeps its original input schemas', (t) => {
  const f = fixture(t);
  const properties = (tools, name) => tools.bundles.find((bundle) => bundle.definition.name === name).definition.input_schema.properties;
  assert.ok(properties(f.tools, 'engineering.read').start_line);
  assert.ok(properties(f.tools, 'engineering.patch').within);
  assert.ok(properties(f.tools, 'engineering.diff').path);
  assert.ok(
    f.tools.bundles.find((bundle) => bundle.definition.name === 'engineering.read').definition.input_schema.required.includes('path'),
  );
  assert.ok(
    !f.tools.bundles
      .find((bundle) => bundle.definition.name === 'engineering.read')
      .definition.input_schema.required.includes('start_line'),
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-tools-v1-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'workspace'));
  const workspace = path.join(directory, 'workspace');
  const { createEngineeringExample } = require('../tools/examples/engineering-task');
  const v1 = createEngineeringTools({
    directory,
    contract: structuredClone(createEngineeringExample('addition').contract),
    policy: { host_workspace: workspace, policy_digest: 'v1' },
    deadline: Number.MAX_SAFE_INTEGER,
  });
  assert.deepEqual(Object.keys(properties(v1, 'engineering.read')), ['path']);
  assert.equal(v1.bundles.length, 4);
});
