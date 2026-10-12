'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test, mock } = require('node:test');

const {
  ArtifactChannelError,
  HARD,
  MAGIC,
  REPAIR_BUDGET_MS,
  createArtifactChannel,
  verifyArtifacts,
} = require('../packages/agent-isolation-attestation/artifact-channel');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('payload')]);
const LIMITS = Object.freeze({ max_files: 4, max_file_bytes: 1024, max_total_bytes: 2048 });
const TYPES = Object.freeze(['image/png', 'text/plain', 'application/json']);

function directory(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-artifact-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function entry(name, bytes, mediaType = 'image/png') {
  return { path: `/artifacts/${name}`, media_type: mediaType, bytes: bytes.length, sha256: sha(bytes) };
}

function put(root, name, bytes) {
  fs.writeFileSync(path.join(root, name), bytes);
  return entry(name, bytes);
}

const verify = (root, manifest, overrides = {}) =>
  verifyArtifacts(root, typeof manifest === 'string' ? manifest : JSON.stringify(manifest), {
    limits: { ...LIMITS, ...overrides.limits },
    media_types: overrides.types || TYPES,
  });

function refused(action, code) {
  assert.throws(action, (error) => error instanceof ArtifactChannelError && error.code === code, `expected ${code}`);
}

test('a manifest that matches the files promotes verified bytes with recomputed digest and size', (context) => {
  const root = directory(context);
  const manifest = [put(root, 'shot.png', PNG), put(root, 'note.txt', Buffer.from('hello'))];
  manifest[1].media_type = 'text/plain';
  const result = verify(root, manifest);
  assert.deepEqual(
    result.map((item) => [item.name, item.bytes, item.sha256]),
    [
      ['shot.png', PNG.length, sha(PNG)],
      ['note.txt', 5, sha('hello')],
    ],
  );
  assert.ok(result[0].content.equals(PNG));
  refused(() => verify(root, []), 'ARTIFACT_MANIFEST_DIVERGED');
  const empty = directory(context);
  assert.deepEqual(verify(empty, []), []);
});

test('manifest shape, size and field violations are refused before any file is read', (context) => {
  const root = directory(context);
  const good = put(root, 'a.png', PNG);
  refused(() => verify(root, 'not json'), 'ARTIFACT_MANIFEST_INVALID');
  refused(() => verify(root, { not: 'a list' }), 'ARTIFACT_MANIFEST_INVALID');
  refused(() => verify(root, 'x'.repeat(65_537)), 'ARTIFACT_MANIFEST_INVALID');
  refused(() => verify(root, [null]), 'ARTIFACT_MANIFEST_INVALID');
  refused(() => verify(root, [[]]), 'ARTIFACT_MANIFEST_INVALID');
  refused(() => verify(root, [{ ...good, extra: 1 }]), 'ARTIFACT_MANIFEST_INVALID');
  refused(() => verify(root, [{ ...good, sha256: 'ZZ' }]), 'ARTIFACT_MANIFEST_INVALID');
  refused(() => verify(root, [good, good]), 'ARTIFACT_MANIFEST_INVALID');
  refused(
    () =>
      verify(
        root,
        Array.from({ length: 5 }, (_, i) => ({ ...good, path: `/artifacts/f${i}.png` })),
      ),
    'ARTIFACT_MANIFEST_INVALID',
  );
  refused(() => verify(root, [{ ...good, bytes: -1 }]), 'ARTIFACT_SIZE_REJECTED');
  refused(() => verify(root, [{ ...good, bytes: 1025 }]), 'ARTIFACT_SIZE_REJECTED');
  refused(() => verify(root, [{ ...good, bytes: 1.5 }]), 'ARTIFACT_SIZE_REJECTED');
});

test('paths outside /artifacts, traversal, nesting and hidden names are refused', (context) => {
  const root = directory(context);
  const good = put(root, 'a.png', PNG);
  for (const bad of [
    '/etc/passwd',
    'a.png',
    '/artifacts',
    '/artifacts/',
    '/artifacts/../a.png',
    '/artifacts/sub/a.png',
    '/artifacts/.hidden',
    '/artifacts/a..png/../x',
    '/artifactsx/a.png',
    7,
  ]) {
    refused(() => verify(root, [{ ...good, path: bad }]), 'ARTIFACT_PATH_REJECTED');
  }
  refused(() => verify(root, [{ ...good, path: `/artifacts/${'n'.repeat(129)}` }]), 'ARTIFACT_PATH_REJECTED');
  refused(() => verify(root, [{ ...good, path: '/artifacts/a..png' }]), 'ARTIFACT_PATH_REJECTED');
});

test('files the manifest does not declare, declared files that are absent and subdirectories diverge', (context) => {
  const root = directory(context);
  const good = put(root, 'a.png', PNG);
  fs.writeFileSync(path.join(root, 'stray.png'), PNG);
  refused(() => verify(root, [good]), 'ARTIFACT_MANIFEST_DIVERGED');
  fs.rmSync(path.join(root, 'stray.png'));
  fs.mkdirSync(path.join(root, 'sub'));
  refused(() => verify(root, [good]), 'ARTIFACT_MANIFEST_DIVERGED');
  fs.rmdirSync(path.join(root, 'sub'));
  refused(() => verify(root, [good, entry('missing.png', PNG)]), 'ARTIFACT_MANIFEST_DIVERGED');
});

test('symbolic links, hard links and non-regular entries are refused', (context) => {
  const root = directory(context);
  const outside = path.join(directory(context), 'secret.png');
  fs.writeFileSync(outside, PNG);
  fs.symlinkSync(outside, path.join(root, 'link.png'));
  refused(() => verify(root, [entry('link.png', PNG)]), 'ARTIFACT_LINK_REJECTED');
  fs.rmSync(path.join(root, 'link.png'));
  fs.linkSync(outside, path.join(root, 'hard.png'));
  refused(() => verify(root, [entry('hard.png', PNG)]), 'ARTIFACT_LINK_REJECTED');
  fs.rmSync(path.join(root, 'hard.png'));
  fs.symlinkSync(path.dirname(outside), path.join(root, 'dir.png'));
  refused(() => verify(root, [entry('dir.png', PNG)]), 'ARTIFACT_LINK_REJECTED');
});

test('size, digest and signature are recomputed and must match the claim and the media type', (context) => {
  const root = directory(context);
  const good = put(root, 'a.png', PNG);
  refused(() => verify(root, [{ ...good, bytes: good.bytes - 1 }]), 'ARTIFACT_SIZE_REJECTED');
  refused(() => verify(root, [{ ...good, bytes: good.bytes + 1 }]), 'ARTIFACT_SIZE_REJECTED');
  refused(() => verify(root, [{ ...good, sha256: sha('other') }]), 'ARTIFACT_DIGEST_REJECTED');
  const fake = put(root, 'b.png', Buffer.from('not a png at all'));
  refused(() => verify(root, [good, fake]), 'ARTIFACT_MEDIA_REJECTED');
  refused(() => verify(root, [{ ...good, media_type: 'image/gif' }]), 'ARTIFACT_MEDIA_REJECTED');
  refused(() => verify(root, [good, fake], { types: ['image/png'] }), 'ARTIFACT_MEDIA_REJECTED');
});

test('the total quota is enforced across files even when each file is within its own ceiling', (context) => {
  const root = directory(context);
  const big = Buffer.concat([PNG, Buffer.alloc(900)]);
  const manifest = ['a', 'b', 'c'].map((name) => put(root, `${name}.png`, big));
  refused(() => verify(root, manifest), 'ARTIFACT_SIZE_REJECTED');
  fs.rmSync(path.join(root, 'c.png'));
  assert.equal(verify(root, manifest.slice(0, 2)).length, 2);
});

test('a file that grows between the stat and the read is caught by the extra-byte read', (context) => {
  const root = directory(context);
  const good = put(root, 'a.png', PNG);
  const original = fs.fstatSync;
  mock.method(fs, 'fstatSync', (fd) => {
    const stat = original(fd);
    if (stat.isFile() && stat.size === PNG.length) fs.appendFileSync(path.join(root, 'a.png'), 'late');
    return stat;
  });
  context.after(() => mock.restoreAll());
  refused(() => verify(root, [good]), 'ARTIFACT_SIZE_REJECTED');
});

test('every media type accepts its own signature and rejects another', () => {
  const samples = {
    'image/png': PNG,
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    'image/gif': Buffer.from('GIF89a....'),
    'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]),
    'application/pdf': Buffer.from('%PDF-1.7'),
    'application/json': Buffer.from('{"a":1}'),
    'text/plain': Buffer.from('plain text'),
  };
  for (const [type, check] of Object.entries(MAGIC)) {
    assert.equal(check(samples[type]), true, `${type} accepts its sample`);
    assert.equal(check(Buffer.alloc(2)), false, `${type} rejects a short, zeroed buffer`);
  }
  assert.equal(MAGIC['image/gif'](Buffer.from('GIF87a')), true);
  assert.equal(MAGIC['image/gif'](Buffer.from('GIF90a')), false);
  assert.equal(MAGIC['application/json'](Buffer.from('{broken')), false);
  assert.equal(MAGIC['text/plain'](Buffer.from([0xff, 0xfe, 0xfd])), false);
  assert.equal(MAGIC['text/plain'](Buffer.from('a\0b')), false);
  assert.equal(MAGIC['image/png'](samples['image/jpeg']), false);
});

test('channel limits and media types are bounded and unknown names are refused', () => {
  for (const limits of [
    { max_files: 0 },
    { max_files: 33 },
    { max_file_bytes: HARD.max_file_bytes + 1 },
    { max_total_bytes: 1.5 },
    { max_file_bytes: 100, max_total_bytes: 50 },
    { surprise: 1 },
  ]) {
    refused(() => createArtifactChannel({ limits, media_types: ['image/png'] }), 'ARTIFACT_CHANNEL_LIMIT_INVALID');
  }
  for (const media_types of [undefined, [], ['image/bmp'], Array.from({ length: 17 }, () => 'image/png')]) {
    refused(() => createArtifactChannel({ media_types }), 'ARTIFACT_CHANNEL_LIMIT_INVALID');
  }
});

test('the channel lives on tmpfs, verifies a manifest, and cannot be used after disposal', (context) => {
  const channel = createArtifactChannel({ limits: LIMITS, media_types: TYPES });
  context.after(() => channel.dispose());
  assert.equal(channel.sandbox_path, '/artifacts');
  assert.equal(channel.max_file_bytes, LIMITS.max_file_bytes);
  assert.equal(fs.statSync(channel.directory).mode & 0o777, 0o700);
  const good = put(channel.directory, 'a.png', PNG);
  assert.equal(channel.verify(JSON.stringify([good])).length, 1);
  channel.dispose();
  assert.equal(fs.existsSync(channel.directory), false);
  refused(() => channel.verify('[]'), 'ARTIFACT_CHANNEL_DISPOSED');
});

test('a parent that is not memory-backed refuses the channel instead of silently using disk', (context) => {
  mock.method(fs, 'statfsSync', () => ({ type: 0xef_53 }));
  context.after(() => mock.restoreAll());
  refused(() => createArtifactChannel({ media_types: TYPES }), 'ARTIFACT_CHANNEL_UNAVAILABLE');
  mock.restoreAll();
  refused(() => createArtifactChannel({ media_types: TYPES, parent: '/nonexistent-parent' }), 'ARTIFACT_CHANNEL_UNAVAILABLE');
});

test('the path must start with /artifacts/ even when the remaining name is a real file', (context) => {
  const root = directory(context);
  const good = put(root, 'x.png', PNG);
  for (const forged of ['/aaaaaaaaa/x.png', '/artifactz/x.png', '//artifacts/x.png', '/Artifacts/x.png']) {
    refused(() => verify(root, [{ ...good, path: forged }]), 'ARTIFACT_PATH_REJECTED');
  }
  assert.equal(verify(root, [good]).length, 1);
});

test('removal does not depend on how many entries the plugin created before hiding a directory', (context) => {
  const channel = createArtifactChannel({ limits: LIMITS, media_types: TYPES });
  const hidden = path.join(channel.directory, 'hidden', 'deeper');
  fs.mkdirSync(hidden, { recursive: true });
  fs.writeFileSync(path.join(hidden, 'child'), 'x');
  for (let index = 0; index < 12_000; index += 1) fs.writeFileSync(path.join(channel.directory, `f${index}`), '');
  fs.chmodSync(hidden, 0);
  fs.chmodSync(path.join(channel.directory, 'hidden'), 0);
  const before = fs.readdirSync('/dev/shm').filter((name) => name.startsWith('hseos-artifacts-')).length;
  assert.deepEqual(channel.dispose(), { disposed: true });
  assert.equal(fs.existsSync(channel.directory), false);
  assert.equal(
    fs.readdirSync('/dev/shm').filter((name) => name.startsWith('hseos-artifacts-')).length,
    before - 1,
    'nothing is left in /dev/shm',
  );
  context.after(() => channel.dispose());
});

test('a spent repair budget is reported explicitly and the removal is still attempted', (context) => {
  assert.ok(REPAIR_BUDGET_MS >= 60_000, 'the budget is generous: it is a backstop, not a node limit');
  const channel = createArtifactChannel({ limits: LIMITS, media_types: TYPES });
  const hidden = path.join(channel.directory, 'hidden');
  fs.mkdirSync(path.join(hidden, 'inner'), { recursive: true });
  fs.chmodSync(hidden, 0);
  const real = Date.now();
  let calls = 0;
  mock.method(Date, 'now', () => real + (calls++ > 0 ? REPAIR_BUDGET_MS + 1 : 0));
  context.after(() => {
    mock.restoreAll();
    channel.dispose();
  });
  assert.deepEqual(channel.dispose(), { disposed: false, code: 'REPAIR_BUDGET_EXHAUSTED' });
  mock.restoreAll();
  assert.deepEqual(channel.dispose(), { disposed: true }, 'a later call finishes the job');
  const clean = createArtifactChannel({ limits: LIMITS, media_types: TYPES });
  mock.method(Date, 'now', () => real + (calls++ > 0 ? REPAIR_BUDGET_MS + 1 : 0));
  assert.deepEqual(clean.dispose(), { disposed: true }, 'nothing unreadable: the final attempt succeeds even with the budget spent');
});
