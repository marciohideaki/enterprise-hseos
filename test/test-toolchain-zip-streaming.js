'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { Readable } = require('node:stream');
const path = require('node:path');
const zlib = require('node:zlib');
const { after, test } = require('node:test');

const pins = require('../tools/lib/environment-toolchain-pins');

const MODULE = path.join(__dirname, '../tools/lib/environment-toolchain-pins.js');
const LICENSE = 'Synthetic licence text, MIT-style marker.\n';
const scratch = [];

after(() => {
  for (const directory of scratch) fs.rmSync(directory, { recursive: true, force: true });
});

function temp(prefix) {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), prefix));
  scratch.push(directory);
  return directory;
}

/**
 * A zip writer small enough to forge headers with. `declared` lies about the uncompressed size, `mode` sets the unix
 * type bits, `method` 0 stores and 8 deflates.
 */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = file.data ?? Buffer.alloc(0);
    const method = file.method ?? 8;
    const body = method === 0 ? data : zlib.deflateRawSync(data);
    const crc = pins.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.declared ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = file.mode ?? (name.at(-1) === 0x2f ? 0o04_0755 : file.executable ? 0o10_0755 : 0o10_0644);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A cache holding one zip pin, and the matching pin table. */
function syntheticCache(files, zipLimits) {
  const cache = temp('hseos-zip-cache-');
  const zip = buildZip([{ name: 'tool/LICENSE', data: Buffer.from(LICENSE) }, ...files]);
  const artifact = 'playwright/tool.zip';
  fs.mkdirSync(path.join(cache, 'playwright'));
  fs.writeFileSync(path.join(cache, artifact), zip);
  const sha256 = createHash('sha256').update(zip).digest('hex');
  const pin = {
    version: '1.0.0',
    artifact,
    sha256,
    license: 'MIT',
    format: 'zip',
    license_file: 'tool/LICENSE',
    license_sha256: createHash('sha256').update(LICENSE).digest('hex'),
    license_markers: ['Synthetic licence text'],
    zip_limits: zipLimits,
  };
  fs.writeFileSync(
    path.join(cache, 'toolchain-manifest.json'),
    JSON.stringify({
      schema: 'hseos.toolchain-cache.v1',
      runtime_download: false,
      pins: [{ name: 'tool', version: pin.version, artifact, sha256, license: pin.license }],
    }),
  );
  return { cache, expected: { tool: pin }, zipBytes: zip.length };
}

function install(files, zipLimits) {
  const { cache, expected } = syntheticCache(files, zipLimits);
  const destination = temp('hseos-zip-dest-');
  return { destination, run: () => pins.installToolchain({ cacheDirectory: cache, destination, names: ['tool'], expected }) };
}

const refusal = (code) => (error) => error instanceof pins.ToolchainBlockedError && error.code === code;

test('zip extraction is byte-identical and keeps modes, directories and the licence', () => {
  const payload = Buffer.from(Array.from({ length: 5000 }, (_, index) => (index * 7) % 251));
  const files = [
    { name: 'tool/bin/', data: Buffer.alloc(0) },
    { name: 'tool/bin/run', data: payload, executable: true },
    { name: 'tool/stored.dat', data: Buffer.from('stored bytes'), method: 0 },
    { name: 'tool/empty', data: Buffer.alloc(0) },
    { name: 'tool/deep/er/file.txt', data: Buffer.from('deflated '.repeat(400)) },
  ];
  const { destination, run } = install(files, { entry_bytes: 1_000_000, total_bytes: 2_000_000 });
  assert.equal(run().status, 'ready');
  const root = path.join(destination, 'tool', 'tool');
  assert.deepEqual(fs.readFileSync(path.join(root, 'bin/run')), payload);
  assert.equal(fs.readFileSync(path.join(root, 'stored.dat'), 'utf8'), 'stored bytes');
  assert.equal(fs.readFileSync(path.join(root, 'empty')).length, 0);
  assert.equal(fs.readFileSync(path.join(root, 'deep/er/file.txt'), 'utf8'), 'deflated '.repeat(400));
  assert.equal(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), LICENSE);
  assert.equal(fs.statSync(path.join(root, 'bin/run')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(root, 'stored.dat')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(destination), ['tool'], 'no staging or previous directory is left');
});

test('zip ceilings still refuse: declared entry size, declared total, and headers that lie about sizes', () => {
  const big = Buffer.alloc(300_000, 7);
  const limits = { entry_bytes: 200_000, total_bytes: 450_000 };
  // The header tells the truth: one entry over the per-entry ceiling.
  assert.throws(install([{ name: 'tool/big', data: big }], limits).run, refusal('ENV_TOOLCHAIN_ARCHIVE_UNSAFE'));
  // Each entry fits, their sum does not.
  const part = Buffer.alloc(150_000, 3);
  const many = [1, 2, 3, 4].map((index) => ({ name: `tool/p${index}`, data: part }));
  assert.throws(install(many, limits).run, refusal('ENV_TOOLCHAIN_ARCHIVE_UNSAFE'));
  // The header claims a few bytes, the stream inflates to far more: the bomb is stopped at the entry ceiling.
  const bomb = install([{ name: 'tool/bomb', data: big, declared: 10 }], limits);
  assert.throws(bomb.run, refusal('ENV_TOOLCHAIN_INSTALL_FAILED'));
  assert.deepEqual(fs.readdirSync(bomb.destination), [], 'a refused install leaves nothing behind');
  // The header claims the real size but the CRC does not match.
  const forged = Buffer.from('forged content');
  const zip = buildZip([{ name: 'tool/f', data: forged }]);
  zip.writeUInt32LE(0, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 16);
  assert.throws(() => pins.readZipEntry(zip, pins.listZip(zip)[0]), refusal('ENV_TOOLCHAIN_ARCHIVE_UNSAFE'));
});

test('zip-slip, absolute names, links and incoherent trees are refused before anything is written', () => {
  const limits = { entry_bytes: 100_000, total_bytes: 200_000 };
  for (const name of ['tool/../../escape', '../escape', '/abs/path', String.raw`tool\win`, 'tool/./x']) {
    const { destination, run } = install([{ name, data: Buffer.from('x') }], limits);
    assert.throws(run, refusal('ENV_TOOLCHAIN_ARCHIVE_UNSAFE'), name);
    assert.deepEqual(fs.readdirSync(destination), [], name);
  }
  const link = install([{ name: 'tool/link', data: Buffer.from('target'), mode: 0o12_0777 }], limits);
  assert.throws(link.run, refusal('ENV_TOOLCHAIN_ARCHIVE_UNSAFE'));
  const clash = install(
    [
      { name: 'tool/a', data: Buffer.from('1') },
      { name: 'tool/A', data: Buffer.from('2') },
    ],
    limits,
  );
  assert.throws(clash.run, refusal('ENV_TOOLCHAIN_ARCHIVE_UNSAFE'));
});

test('a failure midway discards the staging directory and keeps the previous install', () => {
  const limits = { entry_bytes: 100_000, total_bytes: 200_000 };
  const good = syntheticCache([{ name: 'tool/ok', data: Buffer.from('first') }], limits);
  const destination = temp('hseos-zip-dest-');
  const options = { destination, names: ['tool'] };
  pins.installToolchain({ ...options, cacheDirectory: good.cache, expected: good.expected });
  const bad = syntheticCache(
    [
      { name: 'tool/first', data: Buffer.from('written before the failure') },
      { name: 'tool/bomb', data: Buffer.alloc(150_000, 1), declared: 4 },
    ],
    { entry_bytes: 100_000, total_bytes: 200_000 },
  );
  assert.throws(() => pins.installToolchain({ ...options, cacheDirectory: bad.cache, expected: bad.expected }));
  assert.deepEqual(fs.readdirSync(destination), ['tool']);
  assert.equal(fs.readFileSync(path.join(destination, 'tool/tool/ok'), 'utf8'), 'first');
});

test('entries above the inline threshold are streamed through a child and stay byte-identical, with the same refusals', () => {
  const entryBytes = 9 * 1024 * 1024;
  const pattern = Buffer.from(Array.from({ length: 4099 }, (_, index) => (index * 31) % 256));
  const data = Buffer.concat(Array.from({ length: Math.ceil(entryBytes / pattern.length) }, () => pattern)).subarray(0, entryBytes);
  const limits = { entry_bytes: entryBytes + 1024, total_bytes: entryBytes * 2 + 4096 };
  for (const method of [8, 0]) {
    const { destination, run } = install([{ name: 'tool/large.bin', data, method, executable: true }], limits);
    run();
    const file = path.join(destination, 'tool/tool/large.bin');
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), createHash('sha256').update(data).digest('hex'));
    assert.equal(fs.statSync(file).mode & 0o777, 0o700);
  }
  const bomb = install([{ name: 'tool/large.bin', data, declared: entryBytes - 1 }], limits);
  assert.throws(bomb.run, refusal('ENV_TOOLCHAIN_ARCHIVE_UNSAFE'));
  assert.deepEqual(fs.readdirSync(bomb.destination), []);
  const twice = install(
    [1, 2].map((index) => ({ name: `tool/large${index}.bin`, data })),
    { entry_bytes: limits.entry_bytes, total_bytes: entryBytes + 4096 },
  );
  assert.throws(twice.run, refusal('ENV_TOOLCHAIN_ARCHIVE_UNSAFE'));
});

test('inflateEntryToFile enforces ceiling, declared size and CRC on the bytes produced', async () => {
  const directory = temp('hseos-inflate-');
  const data = Buffer.from('payload '.repeat(2000));
  const base = { mode: 0o600, method: 8, maxBytes: data.length, size: data.length, crc: pins.crc32(data) };
  const run = (name, overrides = {}, bytes = zlib.deflateRawSync(data)) =>
    pins.inflateEntryToFile(Readable.from([bytes]), { ...base, file: path.join(directory, name), ...overrides });
  assert.equal(await run('ok'), data.length);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'ok')), data);
  assert.equal(await run('stored', { method: 0 }, data), data.length);
  await assert.rejects(run('ceiling', { maxBytes: data.length - 1 }), /declared size/);
  await assert.rejects(run('smaller', { size: data.length - 1 }), /declared size/);
  await assert.rejects(run('crc', { crc: base.crc ^ 1 }), /CRC/);
  await assert.rejects(run('short', { size: data.length + 1, maxBytes: data.length + 1 }), /CRC/);
  await assert.rejects(run('ok'), /EEXIST|exist/i);
});

// VmHWM is the peak resident set; clear_refs=5 resets it so building the fixture in this process is not counted.
const PEAK = `
  const fs = require('node:fs');
  const hwm = () => Number(/VmHWM:\\s+(\\d+) kB/.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1]) * 1024;
  const measure = (run) => {
    global.gc();
    fs.writeFileSync('/proc/self/clear_refs', '5');
    const before = hwm();
    return Promise.resolve(run()).then(() => hwm() - before);
  };
`;

function peakGrowth(body) {
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? os.tmpdir() };
  const script = `${PEAK}\n(async () => { ${body} })().then((growth) => process.stdout.write(String(growth)));`;
  return Number(execFileSync(process.execPath, ['--expose-gc', '-e', script], { env }));
}

test('peak memory does not depend on the size of the entries', { skip: process.platform !== 'linux' }, () => {
  const entryBytes = 40 * 1024 * 1024;
  const files = [1, 2, 3, 4, 5].map((index) => ({ name: `tool/part${index}.bin`, data: Buffer.alloc(entryBytes, index) }));
  const limits = { entry_bytes: entryBytes + 1024, total_bytes: entryBytes * 5 + 4096 };
  const { cache, expected } = syntheticCache(files, limits);
  const destination = temp('hseos-zip-dest-');
  const growth = peakGrowth(`
    const pins = require(${JSON.stringify(MODULE)});
    return measure(() => pins.installToolchain({ cacheDirectory: ${JSON.stringify(cache)}, destination: ${JSON.stringify(destination)}, names: ['tool'], expected: ${JSON.stringify(expected)} }));
  `);
  assert.ok(
    growth < entryBytes * 2,
    `install process peak grew by ${growth} bytes; sum of entries ${entryBytes * 5}, two entries ${entryBytes * 2}`,
  );
  for (const index of [1, 5]) assert.equal(fs.statSync(path.join(destination, 'tool/tool', `part${index}.bin`)).size, entryBytes);
  const directory = temp('hseos-inflate-');
  const deflated = zlib.deflateRawSync(Buffer.alloc(entryBytes, 9));
  const streamed = peakGrowth(`
    const pins = require(${JSON.stringify(MODULE)});
    const zlib = require('node:zlib');
    const { Readable } = require('node:stream');
    const deflated = Buffer.from(${JSON.stringify(deflated.toString('base64'))}, 'base64');
    const crc = pins.crc32(Buffer.alloc(${entryBytes}, 9));
    return measure(async () => {
      for (let index = 0; index < 5; index += 1)
        await pins.inflateEntryToFile(Readable.from([deflated]), { file: ${JSON.stringify(directory)} + '/e' + index, mode: 0o600, method: 8, maxBytes: ${entryBytes}, size: ${entryBytes}, crc });
    });
  `);
  assert.ok(streamed < entryBytes, `streaming five entries of ${entryBytes} bytes grew the peak by ${streamed} bytes`);
});
