'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { after, test } = require('node:test');
const { MAX_BYTES, MAX_ENTRIES, PluginPackError, packPlugin } = require('../tools/lib/environment-plugin-pack');

const scratch = [];
after(() => {
  for (const directory of scratch) fs.rmSync(directory, { recursive: true, force: true });
});

/** A throwaway repo with plugins/demo/plugin.json and the listed core files. */
function repo({ files = { 'src/a.js': 'a\n', 'src/entry.js': 'e\n' }, manifest = {}, raw } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-pack-'));
  scratch.push(root);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  fs.mkdirSync(path.join(root, 'plugins/demo'), { recursive: true });
  const body = {
    schema: 'hseos.environment-plugin.v1',
    id: 'demo-plugin',
    capability: 'demo',
    version: '1.0.0',
    load: { strategy: 'lazy', entry: 'src/entry.js' },
    core_files: Object.keys(files),
    ...manifest,
  };
  fs.writeFileSync(path.join(root, 'plugins/demo/plugin.json'), raw ?? JSON.stringify(body));
  return root;
}

const pack = (root, capability = 'demo') => () => packPlugin({ repoRoot: root, capability });
const refuses = (call, code) => assert.throws(call, (error) => error instanceof PluginPackError && error.code === code, code);

test('a pack copies the listed core files, is deterministic and records a digest per entry', () => {
  const root = repo();
  const output = path.join(root, 'out');
  const first = packPlugin({ repoRoot: root, capability: 'demo', outputDirectory: output });
  const second = packPlugin({ repoRoot: root, capability: 'demo' });
  assert.equal(first.digest, second.digest);
  assert.equal(first.filename, 'demo-plugin-1.0.0.tgz');
  assert.deepEqual(first.entries.map((entry) => entry.path), ['package/plugin.json', 'package/src/a.js', 'package/src/entry.js']);
  assert.equal(fs.readFileSync(path.join(output, `${first.filename}.sha256`), 'utf8'), `${first.digest}  ${first.filename}\n`);
  assert.equal(fs.readFileSync(path.join(output, first.filename)).equals(first.tarball), true);
  const listing = execFileSync('tar', ['-tzf', path.join(output, first.filename)]).toString().trim().split('\n');
  assert.deepEqual(listing, first.entries.map((entry) => entry.path));
  assert.equal(execFileSync('tar', ['-xzOf', path.join(output, first.filename), 'package/src/a.js']).toString(), 'a\n');
  assert.ok(first.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.ok(first.unpacked_bytes < MAX_BYTES && first.entries.length <= MAX_ENTRIES);
});

test('a changed core file changes the digest', () => {
  const root = repo();
  const before = packPlugin({ repoRoot: root, capability: 'demo' });
  fs.writeFileSync(path.join(root, 'src/a.js'), 'changed\n');
  assert.notEqual(packPlugin({ repoRoot: root, capability: 'demo' }).digest, before.digest);
});

test('an invalid or missing manifest is refused', () => {
  refuses(pack(repo(), 'Bad Name'), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo(), 'other'), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo({ raw: 'not json' })), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo({ manifest: { schema: 'x' } })), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo({ manifest: { id: 'Bad Id' } })), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo({ manifest: { capability: 'mismatch' } })), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo({ manifest: { core_files: [] } })), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo({ manifest: { core_files: 'src/a.js' } })), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo({ raw: 'null' })), 'ENV_PACK_MANIFEST_INVALID');
  refuses(pack(repo({ manifest: { core_files: ['src/a.js', 'src/a.js', 'src/entry.js'] } })), 'ENV_PACK_MANIFEST_INVALID');
});

test('a plugin must load lazily from one of its own files', () => {
  refuses(pack(repo({ manifest: { load: { strategy: 'eager', entry: 'src/entry.js' } } })), 'ENV_PACK_NOT_LAZY');
  refuses(pack(repo({ manifest: { load: { strategy: 'lazy', entry: 'src/other.js' } } })), 'ENV_PACK_NOT_LAZY');
  refuses(pack(repo({ manifest: { load: undefined } })), 'ENV_PACK_NOT_LAZY');
});

test('more than 40 entries is refused, 40 is accepted', () => {
  const many = (count) => Object.fromEntries([['src/entry.js', 'e'], ...Array.from({ length: count - 1 }, (_, index) => [`src/f${index}.js`, 'x'])]);
  assert.equal(packPlugin({ repoRoot: repo({ files: many(MAX_ENTRIES - 1) }), capability: 'demo' }).entries.length, MAX_ENTRIES);
  refuses(pack(repo({ files: many(MAX_ENTRIES) })), 'ENV_PACK_TOO_MANY_ENTRIES');
});

test('unsafe paths, binaries, pins, links and missing files never enter a tarball', () => {
  const withFile = (name) => repo({ files: { 'src/entry.js': 'e', [name]: 'x' } });
  for (const name of ['src/a.tgz', 'src/lib.so', 'src/node_modules/x.js', 'src/toolchain/y.js', 'src/p.whl']) refuses(pack(withFile(name)), 'ENV_PACK_FORBIDDEN_CONTENT');
  for (const unsafe of ['../escape.js', '/abs.js', 'src/../a.js', 'sp ace.js']) {
    refuses(pack(repo({ manifest: { core_files: ['src/entry.js', unsafe] } })), 'ENV_PACK_PATH_UNSAFE');
  }
  refuses(pack(repo({ manifest: { core_files: ['src/entry.js', 7] } })), 'ENV_PACK_PATH_UNSAFE');
  refuses(pack(repo({ manifest: { core_files: ['src/entry.js', 'src/missing.js'] } })), 'ENV_PACK_FILE_MISSING');
  const linked = repo();
  fs.symlinkSync(path.join(linked, 'src/a.js'), path.join(linked, 'src/link.js'));
  fs.mkdirSync(path.join(linked, 'src/dir'));
  for (const name of ['src/link.js', 'src/dir']) {
    const manifestPath = path.join(linked, 'plugins/demo/plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, core_files: ['src/entry.js', name] }));
    refuses(pack(linked), 'ENV_PACK_PATH_UNSAFE');
  }
});

test('size limits apply to the unpacked content, the tarball and the entry names', () => {
  const big = crypto.randomBytes(MAX_BYTES + 1);
  refuses(pack(repo({ files: { 'src/entry.js': big } })), 'ENV_PACK_TOO_LARGE');
  // Incompressible content just under the unpacked limit: the archive framing pushes the tarball over.
  const dense = crypto.randomBytes(MAX_BYTES - 600);
  refuses(pack(repo({ files: { 'src/entry.js': dense } })), 'ENV_PACK_TOO_LARGE');
  refuses(pack(repo({ files: { 'src/entry.js': 'e', [`src/${'n'.repeat(120)}.js`]: 'x' } })), 'ENV_PACK_PATH_UNSAFE');
});
