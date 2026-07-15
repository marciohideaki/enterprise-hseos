/**
 * Tests for the canonical installer idempotency primitive (FileOps.syncFileSafe)
 * and its consumers (FileOps.syncDirectory, ModuleManager.syncModule).
 *
 * Cycle-06 consolidation: three divergent comparison algorithms (hash+manifest
 * on reinstall, mtime-only in ModuleManager.update, hash-with-mtime-fallback in
 * updateCore) collapsed into one content-addressed decision table. These tests
 * pin that table.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { FileOps } = require('../tools/cli/lib/file-ops');

let passed = 0;
let failed = 0;

function assertPass(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${details ? ` - ${details}` : ''}`);
    failed++;
  }
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function makeTree(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-sync-'));
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

async function testSyncFileSafeDecisionTable() {
  const fileOps = new FileOps();
  const src = makeTree({ 'a.txt': 'v2' });
  const dst = makeTree({});
  const s = path.join(src, 'a.txt');
  const d = path.join(dst, 'a.txt');

  assertPass('missing dest → created', (await fileOps.syncFileSafe(s, d)) === 'created' && fs.readFileSync(d, 'utf8') === 'v2');
  assertPass('identical → in-sync', (await fileOps.syncFileSafe(s, d)) === 'in-sync');

  // User modifies dest; no recorded hash → preserved (safe default, mtime irrelevant)
  fs.writeFileSync(d, 'user-edit', 'utf8');
  assertPass(
    'modified dest without recordedHash → preserved-modified',
    (await fileOps.syncFileSafe(s, d)) === 'preserved-modified' && fs.readFileSync(d, 'utf8') === 'user-edit',
  );

  // overwriteModified forces the update
  assertPass(
    'overwriteModified → updated',
    (await fileOps.syncFileSafe(s, d, { overwriteModified: true })) === 'updated' && fs.readFileSync(d, 'utf8') === 'v2',
  );

  // 3-point: dest matches the recorded install state → source update flows
  fs.writeFileSync(d, 'v1', 'utf8');
  assertPass(
    'recordedHash == dest (untouched by user) → updated',
    (await fileOps.syncFileSafe(s, d, { recordedHash: sha256('v1') })) === 'updated' && fs.readFileSync(d, 'utf8') === 'v2',
  );

  // 3-point: only the user moved (source still equals the record) → preserved
  fs.writeFileSync(d, 'user-edit', 'utf8');
  assertPass(
    'recordedHash == source (only user moved) → preserved-modified',
    (await fileOps.syncFileSafe(s, d, { recordedHash: sha256('v2') })) === 'preserved-modified' &&
      fs.readFileSync(d, 'utf8') === 'user-edit',
  );

  // 3-point: both moved → conflict, dest preserved for the caller to report
  assertPass(
    'both sides moved → conflict-preserved',
    (await fileOps.syncFileSafe(s, d, { recordedHash: sha256('v0') })) === 'conflict-preserved' &&
      fs.readFileSync(d, 'utf8') === 'user-edit',
  );

  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(dst, { recursive: true, force: true });
}

async function testSyncDirectorySummaryAndOrphans() {
  const fileOps = new FileOps();
  const src = makeTree({ 'keep.txt': 'same', 'new.txt': 'fresh', 'sub/upd.txt': 'v2' });
  const dst = makeTree({ 'keep.txt': 'same', 'sub/upd.txt': 'user-edit', 'orphan.txt': 'gone-from-source' });

  const summary = await fileOps.syncDirectory(src, dst);

  assertPass('syncDirectory: new file created', summary.created.includes('new.txt') && fs.existsSync(path.join(dst, 'new.txt')));
  assertPass('syncDirectory: identical file in-sync', summary.inSync.includes('keep.txt'));
  assertPass(
    'syncDirectory: modified file preserved (never mtime-clobbered)',
    summary.preserved.includes(path.join('sub', 'upd.txt')) && fs.readFileSync(path.join(dst, 'sub', 'upd.txt'), 'utf8') === 'user-edit',
  );
  assertPass(
    'syncDirectory: orphan removed',
    summary.removedOrphans.includes('orphan.txt') && !fs.existsSync(path.join(dst, 'orphan.txt')),
  );

  // recordedHashes flow the update through when the user never touched the file
  const summary2 = await fileOps.syncDirectory(src, dst, {
    recordedHashes: new Map([[path.join('sub', 'upd.txt'), sha256('user-edit')]]),
  });
  assertPass(
    'syncDirectory: recordedHashes lets untouched-by-user file update',
    summary2.updated.includes(path.join('sub', 'upd.txt')) && fs.readFileSync(path.join(dst, 'sub', 'upd.txt'), 'utf8') === 'v2',
  );

  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(dst, { recursive: true, force: true });
}

async function testModuleManagerSyncModuleUsesPrimitive() {
  const { ModuleManager } = require('../tools/cli/installers/lib/modules/manager');
  const manager = new ModuleManager();
  const src = makeTree({ 'mod.md': 'v2', 'other.md': 'same' });
  const dst = makeTree({ 'mod.md': 'user-edit', 'other.md': 'same' });

  // Make source files mtime-NEWER than dest — the old mtime algorithm would
  // have clobbered the user edit; the content-addressed primitive must not.
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(src, 'mod.md'), future, future);

  const result = await manager.syncModule(src, dst);
  assertPass(
    'syncModule: user-modified file preserved even with newer source mtime',
    fs.readFileSync(path.join(dst, 'mod.md'), 'utf8') === 'user-edit' && result.preserved.includes('mod.md'),
    JSON.stringify(result),
  );
  assertPass('syncModule: identical file untouched, not reported preserved', !result.preserved.includes('other.md'));

  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(dst, { recursive: true, force: true });
}

async function run() {
  console.log('installer idempotency primitive tests');
  await testSyncFileSafeDecisionTable();
  await testSyncDirectorySummaryAndOrphans();
  await testModuleManagerSyncModuleUsesPrimitive();

  console.log(`\nFile-sync tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
