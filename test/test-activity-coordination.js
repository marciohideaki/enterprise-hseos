/**
 * W5-CO1 — activity coordination core: contract, machine store (fence/TTL, 2-process concurrency), project-aggregate,
 * overlap detector, version reservation (real scenario: contracts experimental.6), input safety and CLI.
 * Offline: the npm registry is always a fake (injected object or a shim on PATH).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const { loadConfig, validate } = require('../tools/lib/activity-coordination/config');
const { MachineStore, ProjectAggregateStore, openStore } = require('../tools/lib/activity-coordination/store');
const {
  Coordination,
  createCoordination,
  createNpmRegistry,
  parseKey,
  normalizeRepo,
} = require('../tools/lib/activity-coordination/service');
const paths = require('../tools/lib/activity-coordination/paths');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const cli = require('../tools/cli/commands/activity');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-activity-'));
const REPO = 'github.com/hideaki/cambio-real-platforms';
const REMOTE = 'git@github.com:Hideaki/cambio-real-platforms.git';
const PKG = 'design-system-contracts';
const VERSION = '0.1.0-experimental.6';

function writeContract(dir, body) {
  fs.mkdirSync(path.join(dir, '.hseos', 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.hseos', 'config', 'activity-coordination.yaml'), body);
}

function tree(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      out.push(path.relative(dir, full));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

function worktree(dir, name) {
  const full = path.join(dir, name);
  fs.mkdirSync(path.join(full, '.git'), { recursive: true });
  return full;
}

function setup({ hot = ['**/CHANGELOG.md', '**/package.json'], published = [], gitTags = '', extra = '' } = {}) {
  const dir = tmp();
  const db = path.join(dir, 'state', 'activity.db');
  writeContract(dir, `enabled: true\nstore:\n  path: ${db}\nhot_files: ${JSON.stringify(hot)}\nreservations:\n  ttl_s: 60\n${extra}`);
  const clock = { t: Date.parse('2026-10-12T10:00:00Z') };
  const now = () => clock.t;
  const gitCalls = [];
  const git = (cwd, args) => {
    gitCalls.push({ cwd, args });
    if (args[0] === 'tag') return gitTags;
    if (args[0] === 'remote') return REMOTE;
    if (args[0] === 'rev-parse') return 'main';
    return '';
  };
  const registry = (pkg) => {
    if (pkg === 'throws') throw new Error('ENOTFOUND registry');
    return published;
  };
  const { coordination } = createCoordination(dir, { now, git, registry });
  return { dir, db, clock, coordination, now, git, registry, gitCalls };
}

test('contract absent or disabled has no effect: no file, no directory, snapshot removed', () => {
  const dir = tmp();
  assert.equal(createCoordination(dir).coordination, null);
  assert.deepEqual(tree(dir), []);
  writeContract(dir, 'enabled: false\n');
  const before = tree(dir);
  const { coordination, loaded } = createCoordination(dir);
  assert.equal(coordination, null);
  assert.equal(loaded.source, 'disabled');
  assert.deepEqual(tree(dir), before, 'a disabled contract writes nothing');
  // a previous snapshot is removed when the contract is switched off
  writeContract(dir, 'enabled: true\nstore:\n  path: /tmp/x.db\n');
  assert.equal(loadConfig(dir).source, 'file');
  assert.ok(fs.existsSync(path.join(dir, '.hseos/state/activity-coordination.last-valid.json')));
  writeContract(dir, 'enabled: false\n');
  loadConfig(dir);
  assert.equal(fs.existsSync(path.join(dir, '.hseos/state/activity-coordination.last-valid.json')), false);
  // an invalid contract without a valid snapshot is the same as disabled and writes nothing
  const invalid = tmp();
  writeContract(invalid, 'enabled: maybe\n');
  const invalidBefore = tree(invalid);
  assert.equal(loadConfig(invalid).enabled, false);
  assert.deepEqual(tree(invalid), invalidBefore);
});

test('invalid contract falls back to the last valid configuration with a warning', () => {
  const dir = tmp();
  writeContract(dir, 'enabled: true\nstore:\n  path: /tmp/x.db\nhot_files: [a]\n');
  assert.equal(loadConfig(dir).source, 'file');
  writeContract(dir, 'enabled: maybe\n');
  const loaded = loadConfig(dir);
  assert.equal(loaded.source, 'last-valid');
  assert.equal(loaded.enabled, true);
  assert.match(loaded.warnings[0], /invalid/);
  writeContract(dir, ': : not yaml [');
  assert.equal(loadConfig(dir).source, 'last-valid');
  const fresh = tmp();
  writeContract(fresh, 'enabled: 3\n');
  const none = loadConfig(fresh);
  assert.equal(none.enabled, false);
  assert.match(none.warnings[0], /coordination disabled/);
});

test('validator rejects bad shapes', () => {
  assert.deepEqual(validate({}), []);
  const bad = validate({
    extra: 1,
    store: { backend: 'redis', path: '', adapters: [1], project_dirs: 'x' },
    hot_files: 'a',
    reservations: { kinds: ['x'], ttl_s: -1 },
    enforce: { publish_guard: 'y' },
    overlap: [],
  });
  assert.ok(bad.length >= 9, bad.join('|'));
  assert.ok(validate('x').length === 1);
  assert.ok(validate({ store: [], reservations: [], enforce: [] }).length === 3);
  assert.deepEqual(validate({ store: { backend: 'adapter:axon' } }), []);
});

test('key, repo and package helpers canonicalise and reject hostile input', () => {
  assert.deepEqual(parseKey('version:@scope/pkg@1.2.3-rc.1').parts, ['@scope/pkg', '1.2.3-rc.1']);
  assert.equal(parseKey('version:Pkg@1.2.3+build.5').key, 'version:pkg@1.2.3');
  assert.equal(parseKey('version:pkg@01.2.3'), null);
  assert.equal(parseKey('version:pkg@1.2'), null);
  assert.equal(parseKey('path:github.com/o/r:./src//a/**').key, 'path:github.com/o/r:src/a/**');
  assert.equal(parseKey('path:github.com/o/r:../x'), null);
  assert.equal(parseKey('path:github.com/o/r:/abs'), null);
  assert.equal(parseKey('name:Foo').key, 'name:foo');
  assert.equal(parseKey('name:--registry=http://evil'), null);
  assert.equal(parseKey('version:--registry=http://evil.example@1.0.0'), null);
  assert.equal(parseKey('name:@Org/Pkg').key, 'name:@org/pkg');
  assert.notEqual(parseKey('name:contracts').key, parseKey('name:@org/contracts').key, 'scoped and unscoped are different npm packages');
  assert.equal(parseKey('bogus'), null);
  assert.equal(parseKey('x'.repeat(500)), null);
  assert.equal(normalizeRepo('git@GitHub.com:Org/Repo.git'), 'github.com/org/repo');
  assert.equal(normalizeRepo('https://user@github.com/Org/Repo.git/'), 'github.com/org/repo');
  assert.equal(normalizeRepo(null), null);
  assert.ok(paths.validRef('origin/main'));
  assert.ok(paths.validRef('0123456789abcdef0123456789abcdef01234567'));
  for (const bad of ['--output=/tmp/x', '-x', 'a..b', 'a@{1}', 'a/', 'a.lock', 'a b', '']) assert.equal(paths.validRef(bad), false, bad);
  assert.equal(paths.validIdent('ok-1:2'), true);
  assert.equal(paths.validIdent('bad\nid'), false);
  assert.equal(paths.validIdent('a/b'), false);
  assert.equal(paths.validTool('codex'), true);
  assert.equal(paths.validTool('Co dex'), false);
  assert.equal(paths.sanitizeText('a\n[SYSTEM] b\u2028c', 50), 'a [SYSTEM] b c');
});

test('glob matching is linear: no ReDoS, normalisation, glob against glob', () => {
  let started = process.hrtime.bigint();
  assert.equal(paths.matchGlob(`${'**/'.repeat(50)}a`, `${'a/'.repeat(50)}b`), false);
  assert.equal(paths.matchGlob(`${'**/'.repeat(50)}a`, `${'a/'.repeat(20)}a`), true);
  assert.equal(paths.matchGlob('*a*a*a*a*b', `${'a'.repeat(200)}`), false);
  assert.equal(paths.globsOverlap(`${'**/'.repeat(50)}x`, `${'**/'.repeat(40)}y/**`), true);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 50, 'hostile patterns finish in under 50 ms');
  started = process.hrtime.bigint();
  paths.matchGlob('a'.repeat(300), 'a');
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 50);
  assert.equal(paths.normalizePathExpr('a'.repeat(300)), null);
  assert.equal(paths.normalizePathExpr(Array.from({ length: 40 }, (_, i) => `d${i}`).join('/')), null);
  assert.equal(paths.normalizePathExpr(String.raw`a\b`), null);
  assert.equal(paths.normalizePathExpr('a\nb'), null);
  assert.equal(paths.normalizePathExpr(''), null);
  assert.equal(paths.normalizePathExpr(5), null);
  assert.equal(paths.normalizePathExpr('./a//b/./c'), 'a/b/c');
  assert.equal(paths.normalizePathExpr('a/**/**/b'), 'a/**/b');
  assert.equal(paths.normalizePathExpr('a/x**y'), 'a/x*y');
  // matching semantics
  assert.ok(paths.matchGlob('a/**/b?.js', 'a/x/y/bc.js'));
  assert.ok(paths.matchGlob('a/**/b.js', 'a/b.js'));
  assert.ok(paths.matchGlob('**/CHANGELOG.md', 'packages/x/CHANGELOG.md'));
  assert.ok(paths.matchGlob('**', 'a/b'));
  assert.ok(!paths.matchGlob('src/*.js', 'src/a/b.js'));
  assert.ok(!paths.matchGlob('../x', 'x'));
  assert.ok(!paths.matchGlob('a', '/abs'));
  // overlap semantics
  assert.ok(paths.globsOverlap('./a.js', 'a.js'));
  assert.ok(paths.globsOverlap('src//a.js', 'src/a.js'));
  assert.ok(!paths.globsOverlap('src/../a.js', 'a.js'));
  assert.ok(paths.globsOverlap('src/**', 'src/a/**'));
  assert.ok(paths.globsOverlap('src/*.js', 'src/a*.js'));
  assert.ok(paths.globsOverlap('*.md', 'docs/*.md'));
  assert.ok(!paths.globsOverlap('src/**', 'docs/**'));
  assert.ok(!paths.globsOverlap('src/**', 'docs/a.md'));
  assert.ok(paths.globsOverlap('src/**', 'src/a/b.js'));
  assert.ok(paths.globsOverlap('src/a.js', 'src/*.js'));
  assert.ok(paths.globsOverlap('x', 'x'));
});

test('machine store: fence, late release and TTL overdue without takeover', () => {
  const { coordination, clock } = setup();
  const s = coordination.store;
  s.register({ id: 'a', tool: 'claude-code', repo: REPO });
  s.register({ id: 'b', tool: 'codex', repo: REPO });
  assert.equal(s.reserve({ owner: 'ghost', kind: 'name', key: 'name:x', ttlS: 60 }).reason_code, 'unknown_activity');
  const first = s.reserve({ owner: 'a', kind: 'name', key: 'name:x', ttlS: 60 });
  assert.ok(first.ok);
  assert.equal(s.reserve({ owner: 'a', kind: 'name', key: 'name:x', ttlS: 60 }).renewed, true);
  const conflict = s.reserve({ owner: 'b', kind: 'name', key: 'name:x', ttlS: 60 });
  assert.equal(conflict.reason_code, 'claim_held');
  // lease expires: overdue is flagged once, the claim is still held (no takeover)
  clock.t += 120_000;
  assert.equal(s.sweepOverdue().length, 1);
  assert.equal(s.sweepOverdue().length, 0);
  const afterExpiry = s.reserve({ owner: 'b', kind: 'name', key: 'name:x', ttlS: 60 });
  assert.equal(afterExpiry.ok, false);
  assert.equal(afterExpiry.conflict.overdue, true);
  assert.ok(s.eventsAfter(0).some((e) => e.type === 'claim_overdue' && e.reason_code === 'ttl_expired'));
  // owner heartbeat renews and clears overdue
  assert.equal(s.heartbeat('a', 60).claims_renewed, 1);
  assert.equal(s.listClaims()[0].overdue, false);
  // release then re-acquire by b with a new fence; a's late release with the old fence must not erase it
  assert.ok(s.release({ key: 'name:x', fence: first.claim.fence }).ok);
  const second = s.reserve({ owner: 'b', kind: 'name', key: 'name:x', ttlS: 60 });
  assert.ok(second.claim.fence > first.claim.fence);
  const late = s.release({ key: 'name:x', fence: first.claim.fence });
  assert.equal(late.reason_code, 'stale_fence');
  assert.equal(late.current_fence, second.claim.fence);
  assert.equal(s.listClaims().length, 1);
  assert.equal(s.release({ key: 'name:none', fence: 1 }).current_fence, null);
  // ending an activity releases its claims; unknown ids are refused
  assert.equal(s.end('b').claims_released, 1);
  assert.equal(s.end('b').reason_code, 'unknown_activity');
  assert.equal(s.heartbeat('b', 60).reason_code, 'unknown_activity');
  assert.equal(s.declare('b', {}).reason_code, 'unknown_activity');
  assert.deepEqual(s.eventsAfter(0, 3).length, 3);
  assert.equal(s.listActive({ repo: REPO }).length, 1);
  coordination.close();
});

test('reserve sweeps an expired lease first and still never takes it over', () => {
  const { coordination, clock } = setup();
  coordination.register({ session: 'a', tool: 'claude-code', repo: REPO, worktree: coordination.directory });
  coordination.register({ session: 'b', tool: 'codex', repo: REPO, worktree: coordination.directory });
  assert.ok(coordination.reserve('a', 'name:pkg').ok);
  clock.t += 30_000;
  coordination.heartbeat('b');
  clock.t += 45_000; // a is silent for 75 s > ttl 60 s
  const result = coordination.reserve('b', 'name:pkg');
  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].overdue, true);
  assert.equal(coordination.release('name:pkg', Number.NaN).reason_code, 'invalid_fence');
  coordination.close();
});

test('stale sessions leave the active list but are kept; heartbeat writes no event per call', () => {
  const { coordination, clock } = setup();
  const s = coordination.store;
  s.register({ id: 'a', tool: 'claude-code', repo: REPO });
  s.register({ id: 'b', tool: 'codex', repo: REPO });
  const before = s.eventsAfter(0).length;
  for (let i = 0; i < 20; i += 1) s.heartbeat('a', 60);
  assert.equal(s.eventsAfter(0).length, before, 'heartbeats do not grow the event log');
  clock.t += 90_000;
  s.heartbeat('a', 60);
  assert.deepEqual(
    s.listActive().map((x) => x.id),
    ['a'],
  );
  assert.deepEqual(
    s.listStale().map((x) => [x.id, x.stale]),
    [['b', true]],
  );
  assert.equal(coordination.list().stale.length, 1);
  assert.ok(s.get('b'), 'stale sessions are not deleted');
  assert.equal(s.heartbeat('b', 60).ok, true);
  assert.ok(s.eventsAfter(0).some((e) => e.type === 'activity_heartbeat' && e.reason_code === 'resumed'));
  assert.equal(s.listStale().length, 0);
  coordination.close();
});

test('store and inbox files are private regardless of umask', () => {
  const previous = process.umask(0);
  try {
    const dir = tmp();
    const dbPath = path.join(dir, 'a', 'b', 'activity.db');
    const store = new MachineStore({ dbPath });
    store.register({ id: 'a', tool: 'codex', repo: REPO });
    const mode = (target) => fs.statSync(target).mode & 0o777;
    assert.equal(mode(path.dirname(dbPath)), 0o700);
    assert.equal(mode(dbPath), 0o600);
    for (const suffix of ['-wal', '-shm']) if (fs.existsSync(dbPath + suffix)) assert.equal(mode(dbPath + suffix), 0o600);
    store.close();

    const ctx = setup();
    ctx.coordination.register({ session: 'a', tool: 'claude-code', repo: REPO, worktree: ctx.dir, paths: ['p.js'] });
    ctx.coordination.register({ session: 'b', tool: 'codex', repo: REPO, worktree: ctx.dir, paths: ['p.js'] });
    const inbox = path.join(path.dirname(ctx.db), 'inbox');
    assert.equal(mode(inbox), 0o700);
    const files = fs.readdirSync(inbox);
    assert.ok(files.length > 0 && files.every((name) => !name.endsWith('.tmp')));
    for (const name of files) assert.equal(mode(path.join(inbox, name)), 0o600);
    ctx.coordination.close();
  } finally {
    process.umask(previous);
  }
});

test('two processes on the same SQLite: exactly one wins the reservation', () => {
  const { db } = setup();
  const seed = new MachineStore({ dbPath: db });
  for (const id of ['p1', 'p2']) seed.register({ id, tool: 'claude-code', repo: REPO });
  seed.close();
  const script = `
    const { MachineStore } = require(${JSON.stringify(path.join(ROOT, 'tools/lib/activity-coordination/store'))});
    const s = new MachineStore({ dbPath: process.argv[1] });
    const out = [];
    for (let i = 0; i < 30; i++) out.push(s.reserve({ owner: process.argv[2], kind: 'name', key: 'name:k' + i, ttlS: 60 }).ok);
    s.close();
    console.log(JSON.stringify(out));`;
  const runChild = (owner) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script, db, owner], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))));
    });
  return Promise.all([runChild('p1'), runChild('p2')]).then(([a, b]) => {
    for (let i = 0; i < 30; i += 1) assert.equal(Number(a[i]) + Number(b[i]), 1, `key ${i} must have exactly one owner`);
    const check = new MachineStore({ dbPath: db });
    assert.equal(check.listClaims().length, 30);
    check.close();
  });
});

test('real scenario: contracts experimental.6 between a claude-code and a codex session', () => {
  const { dir, coordination } = setup({ published: ['0.1.0-experimental.4', '0.1.0-experimental.5', VERSION] });
  const wtA = worktree(dir, 'wt-a');
  const wtB = worktree(dir, 'wt-b');
  const changelog = 'packages/design-system-contracts/CHANGELOG.md';
  const a = coordination.register({
    session: 'cc-1',
    tool: 'claude-code',
    repo: REMOTE,
    worktree: wtA,
    branch: 'feat/a',
    paths: [changelog],
  });
  assert.ok(a.ok);
  assert.equal(a.activity.repo, REPO);
  const key = `version:${PKG}@${VERSION}`;
  // session A reserves .6 although it is published: advisory, acquired but flagged as conflicted
  const first = coordination.reserve('cc-1', key);
  assert.ok(first.ok);
  assert.equal(first.conflicted, true);
  assert.deepEqual(
    first.conflicts.map((c) => c.source),
    ['published'],
  );
  const b = coordination.register({ session: 'cx-1', tool: 'codex', repo: REPO, worktree: wtB, branch: 'feat/b', paths: [changelog] });
  assert.equal(b.overlaps[0].severity, 'hot_file');
  assert.equal(b.overlaps[0].file, changelog);
  const second = coordination.reserve('cx-1', key);
  assert.equal(second.ok, false);
  assert.deepEqual(second.conflicts.map((c) => c.source).sort(), ['claim', 'published']);
  const events = coordination.store.eventsAfter(0);
  assert.ok(events.some((e) => e.type === 'reservation_conflict' && e.source === 'published'));
  assert.ok(events.some((e) => e.type === 'reservation_conflict' && e.source === 'claim'));
  assert.equal(events.filter((e) => e.type === 'overlap_detected' && e.reason_code === 'hot_file').length, 1);
  coordination.overlaps('cx-1');
  assert.equal(
    coordination.store.eventsAfter(0).filter((e) => e.type === 'overlap_detected').length,
    1,
    'repeated detection does not duplicate',
  );
  // A received both warnings in the inbox of its (trusted) worktree; entries are not liveness wake requests
  const inbox = coordination.check('cc-1');
  assert.ok(inbox.inbox.length >= 2);
  for (const entry of inbox.inbox) {
    assert.equal(entry.kind, 'coordination');
    assert.equal(entry.schema, 'coordination-inbox/v1');
    assert.equal(entry.recipient, 'cc-1');
    assert.equal('session' in entry || 'agent' in entry, false, 'no session/agent: a wake reader cannot mistake it for a wake request');
  }
  assert.ok(inbox.inbox.some((e) => e.event.type === 'overlap_detected'));
  assert.ok(inbox.inbox.some((e) => e.event.type === 'reservation_conflict'));
  assert.equal(coordination.check('cc-1').inbox.length, 0, 'inbox is drained');
  assert.ok(fs.existsSync(path.join(wtA, '.hseos/state/liveness/inbox')));
  coordination.close();
});

test('version sources: tags, candidate.json, registry failure and publish guard', () => {
  const ctx = setup({ gitTags: `v1.0.0\n${PKG}@2.0.0\n` });
  const { dir, coordination } = ctx;
  const wt = worktree(dir, 'wt');
  fs.writeFileSync(path.join(wt, 'candidate.json'), JSON.stringify({ name: PKG, version: '3.0.0' }));
  coordination.register({ session: 's', tool: 'codex', repo: REPO, worktree: wt });
  assert.deepEqual(
    coordination.reserve('s', `version:${PKG}@1.0.0`).conflicts.map((c) => c.source),
    ['tag'],
  );
  assert.deepEqual(
    coordination.reserve('s', `version:${PKG}@2.0.0`).conflicts.map((c) => c.source),
    ['tag'],
  );
  assert.deepEqual(
    coordination.reserve('s', `version:${PKG}@3.0.0`).conflicts.map((c) => c.source),
    ['candidate'],
  );
  fs.writeFileSync(path.join(wt, 'candidate.json'), JSON.stringify({ name: 'other', version: '4.0.0' }));
  assert.deepEqual(coordination.reserve('s', `version:${PKG}@4.0.0`).conflicts, []);
  fs.writeFileSync(path.join(wt, 'candidate.json'), '{bad');
  assert.deepEqual(coordination.reserve('s', `version:${PKG}@5.0.0`).conflicts, []);
  const degraded = coordination.reserve('s', 'version:throws@9.9.9');
  assert.ok(degraded.ok, 'registry failure degrades, never blocks');
  assert.equal(degraded.conflicted, false);
  assert.ok(degraded.warnings.some((w) => /registry unavailable/.test(w)));
  assert.equal(coordination.reserve('s', 'bogus').reason_code, 'invalid_key');
  assert.equal(coordination.reserve('bad\nsession', 'name:x').reason_code, 'invalid_session');
  coordination.close();

  const guarded = setup({ published: ['1.0.0'], extra: 'enforce:\n  publish_guard: true\n' });
  guarded.coordination.register({ session: 's', tool: 'codex', repo: REPO });
  const refused = guarded.coordination.reserve('s', `version:${PKG}@1.0.0`);
  assert.equal(refused.reason_code, 'version_unavailable');
  assert.equal(guarded.coordination.store.listClaims().length, 0);
  guarded.coordination.close();

  const narrow = setup();
  writeContract(narrow.dir, `enabled: true\nstore:\n  path: ${narrow.db}\nreservations:\n  kinds: [path]\n`);
  const reloaded = createCoordination(narrow.dir).coordination;
  assert.equal(reloaded.reserve('x', 'name:foo').reason_code, 'kind_not_enabled');
  reloaded.close();
  narrow.coordination.close();
});

test('path reservations conflict by glob overlap, not only by identical key', () => {
  const { coordination } = setup();
  coordination.register({ session: 'a', tool: 'claude-code', repo: REPO, worktree: coordination.directory });
  coordination.register({ session: 'b', tool: 'codex', repo: REPO, worktree: coordination.directory });
  assert.equal(coordination.reserve('a', `path:${REPO}:src/**`).conflicted, false);
  const overlapping = coordination.reserve('b', `path:${REPO}:./src//api/a.js`);
  assert.ok(overlapping.ok, 'advisory: distinct keys are acquired');
  assert.equal(overlapping.conflicted, true);
  assert.equal(overlapping.conflicts[0].overlap, true);
  assert.equal(overlapping.key, `path:${REPO}:src/api/a.js`);
  assert.equal(coordination.reserve('b', `path:${REPO}:docs/**`).conflicted, false);
  assert.equal(coordination.reserve('a', `path:${REPO}:src/**`).conflicted, true, 'the renewal still sees the overlapping claim of b');
  assert.equal(coordination.reserve('b', `path:${REPO}:src/**`).reason_code, 'claim_held');
  assert.equal(coordination.check('a').inbox.length > 0, true);
  coordination.close();
});

test('overlaps: declared, diff, glob against glob, other repos; heartbeat/declare/end/list', () => {
  const ctx = setup({ hot: [] });
  const diffs = { 'wt-a': 'src/shared.js\nsrc/only-a.js\n../escape\n', 'wt-b': 'src/shared.js' };
  const { coordination } = ctx;
  coordination.git = (cwd, args) => (args[0] === 'diff' ? diffs[path.basename(cwd)] : ctx.git(cwd, args));
  const [wa, wb, wc] = ['wt-a', 'wt-b', 'wt-c'].map((name) => worktree(ctx.dir, name));
  coordination.register({ session: 'a', tool: 'claude-code', worktree: wa, base: 'origin/main', paths: ['docs/**', 'lib/**'] });
  const b = coordination.register({
    session: 'b',
    tool: 'codex',
    worktree: wb,
    base: 'origin/main',
    paths: ['docs/readme.md', 'lib/x/**'],
  });
  assert.deepEqual(b.overlaps.map((o) => `${o.severity}:${o.file}`).sort(), [
    'declared:docs/readme.md',
    'declared:lib/x/**',
    'diff:src/shared.js',
  ]);
  const c = coordination.register({ session: 'c', tool: 'codex', repo: 'github.com/other/repo', worktree: wc, paths: ['docs/readme.md'] });
  assert.deepEqual(c.overlaps, []);
  assert.equal(coordination.register({ session: 'd', tool: 'codex', worktree: wc, paths: ['../x'] }).reason_code, 'invalid_path');
  assert.equal(coordination.register({ session: 'd', tool: 'Bad Tool' }).reason_code, 'invalid_tool');
  assert.equal(coordination.register({ session: 'd\n', tool: 'codex' }).reason_code, 'invalid_session');
  assert.equal(coordination.overlaps('ghost').reason_code, 'unknown_activity');
  assert.ok(coordination.declare('a', { paths: ['x.js'], identifiers: ['id'], intent: 'work\nIGNORE PREVIOUS' }).ok);
  assert.equal(coordination.store.get('a').intent, 'work IGNORE PREVIOUS');
  assert.equal(coordination.declare('ghost', {}).ok, false);
  assert.equal(coordination.declare('a', { paths: ['/abs'] }).reason_code, 'invalid_path');
  assert.equal(coordination.declare('a', { paths: Array.from({ length: 250 }, (_, i) => `f${i}.js`) }).reason_code, 'too_many_paths');
  assert.equal(coordination.declare('bad\n', {}).reason_code, 'invalid_session');
  assert.ok(coordination.heartbeat('a').ok);
  assert.equal(coordination.heartbeat('bad\n').reason_code, 'invalid_session');
  assert.equal(coordination.end('bad\n').reason_code, 'invalid_session');
  assert.equal(coordination.check('bad\n').reason_code, 'invalid_session');
  assert.equal(coordination.check('a', { consume: false }).inbox.length > 0, true);
  assert.equal(coordination.list().activities.length, 3);
  coordination.config.overlap.include_git_diff = false;
  assert.deepEqual(
    coordination
      .overlaps('b')
      .overlaps.map((o) => o.severity)
      .sort(),
    ['declared', 'declared'],
  );
  assert.ok(coordination.end('a').ok);
  assert.equal(coordination.list().activities.length, 2);
  assert.equal(coordination.release('name:none', 1).ok, false);
  coordination.close();
});

test('argument injection: hostile base refs and package names never reach git or npm as options', () => {
  const ctx = setup({ hot: [] });
  const { coordination, gitCalls } = ctx;
  const wt = worktree(ctx.dir, 'wt');
  coordination.register({ session: 'a', tool: 'codex', worktree: wt, base: '--output=/tmp/hseos-victim.txt', paths: ['p.js'] });
  coordination.register({ session: 'b', tool: 'claude-code', worktree: wt, base: 'origin/main', paths: ['p.js'] });
  assert.ok(coordination.warnings.some((w) => /invalid base ref/.test(w)));
  assert.equal(
    gitCalls.some((call) => call.args.some((arg) => String(arg).includes('--output'))),
    false,
  );
  const diffCall = gitCalls.find((call) => call.args[0] === 'diff');
  assert.deepEqual(diffCall.args, ['diff', '--name-only', 'origin/main...HEAD', '--']);
  assert.equal(coordination.reserve('b', 'version:--registry=http://evil.example@1.0.0').reason_code, 'invalid_key');
  assert.equal(coordination.reserve('b', 'name:--userconfig=/tmp/x').reason_code, 'invalid_key');
  coordination.close();
});

test('git diff failure degrades with a warning', () => {
  const ctx = setup({ hot: [] });
  const { coordination } = ctx;
  coordination.git = (cwd, args) => (args[0] === 'diff' ? null : ctx.git(cwd, args));
  const wt = worktree(ctx.dir, 'wt');
  coordination.register({ session: 'a', tool: 'codex', worktree: wt, base: 'origin/main' });
  coordination.register({ session: 'b', tool: 'codex', worktree: wt, base: 'origin/main' });
  assert.ok(coordination.warnings.some((w) => /git diff failed/.test(w)));
  // a later invocation (the next prompt, another process) does not repeat the warning for the same session
  const again = createCoordination(ctx.dir, { now: ctx.now, git: coordination.git, registry: ctx.registry }).coordination;
  again.overlaps('b');
  assert.equal(
    again.warnings.some((w) => /git diff failed/.test(w)),
    false,
    'warned once per session',
  );
  again.close();
  coordination.close();
});

test('npm registry: package after --, cache, 404 and failures', () => {
  const dir = tmp();
  const cache = path.join(dir, 'c', 'cache.json');
  const calls = [];
  let reply = { status: 0, stdout: JSON.stringify(['1.0.0', '1.1.0']), stderr: '' };
  const clock = { t: 1000 };
  const registry = createNpmRegistry(cache, { spawn: (cmd, args) => (calls.push([cmd, args]), reply), now: () => clock.t });
  assert.deepEqual(registry('pkg'), ['1.0.0', '1.1.0']);
  assert.deepEqual(calls[0], ['npm', ['view', '--json', '--', 'pkg', 'versions']]);
  assert.deepEqual(registry('pkg'), ['1.0.0', '1.1.0']);
  assert.equal(calls.length, 1, 'served from the short cache');
  assert.equal(fs.statSync(cache).mode & 0o777, 0o600);
  clock.t += 120_000;
  reply = { status: 0, stdout: JSON.stringify('2.0.0'), stderr: '' };
  assert.deepEqual(registry('pkg'), ['2.0.0'], 'a single version comes back as a string');
  reply = { status: 0, stdout: '', stderr: '' };
  assert.deepEqual(registry('empty'), []);
  reply = { status: 1, stdout: '', stderr: 'npm ERR! code E404' };
  assert.deepEqual(registry('missing'), []);
  reply = { status: 1, stdout: '', stderr: 'boom', error: new Error('spawn failed') };
  assert.throws(() => registry('broken'), /spawn failed/);
  reply = { status: 7, stdout: '', stderr: 'boom' };
  assert.throws(() => registry('broken2'), /exited 7/);
  fs.writeFileSync(cache, '{bad');
  reply = { status: 0, stdout: '["3.0.0"]', stderr: '' };
  assert.deepEqual(registry('pkg'), ['3.0.0'], 'a corrupt cache is ignored');
  const blocked = createNpmRegistry(path.join(cache, 'nope', 'x.json'), { spawn: () => reply });
  assert.deepEqual(blocked('pkg'), ['3.0.0'], 'cache write failure is not fatal');
});

test('inbox hardening: symlinks, size, prefix collisions and unreadable entries', () => {
  const ctx = setup();
  const { coordination } = ctx;
  const inbox = path.join(path.dirname(ctx.db), 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const entry = (recipient, extra = {}) =>
    JSON.stringify({ kind: 'coordination', recipient, reason: 'r', reason_code: 'x', event: {}, ...extra });
  fs.writeFileSync(path.join(inbox, 'x-coordination-1-aa.json'), entry('x'));
  fs.writeFileSync(path.join(inbox, 'x-coordination-1-aa.json.keep'), 'ignored');
  fs.writeFileSync(path.join(inbox, 'x-coordination-1-coordination-2-bb.json'), entry('x-coordination-1'));
  const outside = path.join(ctx.dir, 'secret.json');
  fs.writeFileSync(outside, entry('x'));
  fs.symlinkSync(outside, path.join(inbox, 'x-coordination-3-cc.json'));
  fs.writeFileSync(path.join(inbox, 'x-coordination-4-dd.json'), entry('x', { pad: 'y'.repeat(70_000) }));
  fs.writeFileSync(path.join(inbox, 'x-coordination-5-ee.json'), entry('someone-else'));
  fs.writeFileSync(path.join(inbox, 'x-coordination-6-ff.json'), '{bad');
  const read = coordination.readInbox('x', { consume: false });
  assert.equal(read.length, 1, 'only the regular, small, well-formed entry addressed to x');
  assert.equal(coordination.readInbox('x').length, 1);
  assert.equal(coordination.readInbox('x').length, 0, 'consumed exactly once');
  assert.ok(coordination.warnings.some((w) => /unreadable inbox entry/.test(w)));
  assert.ok(fs.existsSync(path.join(inbox, 'x-coordination-1-coordination-2-bb.json')), 'a longer session id keeps its own entries');
  assert.deepEqual(coordination.readInbox('bad\nid'), []);
  fs.writeFileSync(path.join(inbox, 'y-coordination-1-aa.json'), 'null');
  fs.writeFileSync(path.join(inbox, 'y-coordination-2-bb.json'), '[1]');
  fs.writeFileSync(path.join(inbox, 'y-coordination-3-cc.json'), '"text"');
  fs.writeFileSync(path.join(inbox, 'y-coordination-4-dd.json'), entry('y'));
  coordination.warnings.length = 0;
  assert.equal(coordination.readInbox('y').length, 1, 'non-object entries are skipped without dropping the valid one');
  assert.equal(coordination.warnings.filter((w) => /not an object/.test(w)).length, 3);
  assert.deepEqual(coordination.readInbox('nobody'), []);
  fs.rmSync(inbox, { recursive: true });
  assert.deepEqual(coordination.readInbox('x'), []);
  coordination.close();
});

test('inbox delivery failure degrades with a warning', () => {
  const ctx = setup();
  const { coordination } = ctx;
  fs.mkdirSync(path.dirname(ctx.db), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(ctx.db), 'inbox'), 'a file where the directory should be');
  coordination.register({ session: 'a', tool: 'claude-code', repo: REPO, worktree: ctx.dir, paths: ['p'] });
  coordination.register({ session: 'b', tool: 'codex', repo: REPO, worktree: ctx.dir, paths: ['p'] });
  assert.ok(coordination.warnings.some((w) => /inbox delivery failed/.test(w)));
  coordination.close();
});

test('adapters degrade with a warning and never block; a missing adapter backend is reported', () => {
  const ctx = setup();
  writeContract(ctx.dir, `enabled: true\nstore:\n  backend: adapter:axon\n  path: ${ctx.db}\n  adapters: [axon, absent]\n`);
  const calls = [];
  const { coordination } = createCoordination(ctx.dir, {
    now: ctx.now,
    git: ctx.git,
    registry: ctx.registry,
    adapters: [
      {
        name: 'axon',
        mirror: (e) => {
          calls.push(e);
          throw new Error('axon down');
        },
      },
      { name: 'unlisted', mirror: () => assert.fail('unlisted adapter must not run') },
    ],
  });
  const result = coordination.register({ session: 's1', tool: 'claude-code', repo: REPO, worktree: ctx.dir, paths: ['a'] });
  assert.ok(result.ok);
  coordination.register({ session: 's2', tool: 'codex', repo: REPO, worktree: ctx.dir, paths: ['a'] });
  assert.ok(calls.length > 0);
  assert.ok(coordination.warnings.some((w) => /adapter axon failed/.test(w)));
  assert.ok(
    !coordination.warnings.some((w) => /adapter axon is not installed|adapter:axon is not installed/.test(w)),
    'the installed adapter is not reported missing',
  );
  assert.ok(
    coordination.warnings.some((w) => /adapter absent is not installed/.test(w)),
    'a configured but absent adapter degrades with a warning',
  );
  coordination.declare('s1', { paths: ['b.js'], identifiers: ['x@1.0.0'] });
  coordination.reserve('s1', 'name:held-pkg');
  coordination.reserve('s2', 'name:held-pkg');
  const types = new Set(calls.map((event) => event.type));
  assert.ok(types.has('activity_declared'), 'activity_declared is mirrored');
  assert.ok(types.has('reservation_conflict'), 'reservation_conflict is mirrored');
  coordination.close();
  const missing = createCoordination(ctx.dir, { now: ctx.now, git: ctx.git, registry: ctx.registry }).coordination;
  assert.ok(missing.warnings.some((w) => /adapter:axon is not installed/.test(w)));
  missing.close();
});

function projectStore(dir, sessions) {
  fs.mkdirSync(path.join(dir, '.hseos', 'state'), { recursive: true });
  const db = new Database(path.join(dir, '.hseos', 'state', 'project.db'));
  db.pragma('journal_mode = WAL');
  runMigrations(db, path.join(ROOT, 'tools/mcp-project-state/migrations'), { log: () => {} });
  db.prepare("INSERT INTO as_runs (id, workflow_id, project, repo_url, base_branch) VALUES ('r', 'w', ?, ?, 'main')").run(
    dir,
    `git@github.com:o/${path.basename(dir)}.git`,
  );
  for (const [id, status, branch] of sessions) {
    db.prepare('INSERT INTO as_sessions (id, host, status) VALUES (?, ?, ?)').run(id, 'h', status);
    if (id === 's-a1') db.prepare("UPDATE as_runs SET session_id = ? WHERE id = 'r'").run(id);
    if (branch) {
      db.prepare("INSERT INTO as_tasks (id, run_id, wave) VALUES (?, 'r', 1)").run(`t-${id}`);
      db.prepare('INSERT INTO as_worktree_state (task_id, branch_name, base_branch, claimed_by_session) VALUES (?, ?, ?, ?)').run(
        `t-${id}`,
        branch,
        'main',
        id,
      );
    }
  }
  db.close();
}

test('project-aggregate reads two project stores and reservations are advisory only', () => {
  const root = tmp();
  const p1 = path.join(root, 'p1');
  const p2 = path.join(root, 'p2');
  projectStore(p1, [
    ['s-a1', 'active', 'feat/one'],
    ['s-a2', 'completed', null],
  ]);
  projectStore(p2, [['s-b1', 'active', 'feat/two']]);
  const missing = path.join(root, 'missing');
  const store = new ProjectAggregateStore({ projectDirs: [p1, p2, missing] });
  const active = store.listActive();
  assert.deepEqual(active.map((a) => a.id).sort(), ['s-a1', 's-b1']);
  assert.ok(store.warnings.some((w) => /no project store/.test(w)));
  assert.equal(active.find((a) => a.id === 's-a1').branch, 'feat/one');
  const claims = store.listClaims();
  assert.equal(claims.length, 2);
  assert.ok(claims.every((c) => c.advisory && c.fence === null));
  const clash = store.reserve({ owner: 'other', key: claims[0].key });
  assert.equal(clash.ok, false);
  assert.equal(clash.advisory, true);
  const free = store.reserve({ owner: 'other', key: 'name:free' });
  assert.ok(free.ok && free.advisory && /advisory only/.test(free.warning));
  for (const op of ['register', 'heartbeat', 'declare', 'end', 'release']) assert.equal(store[op]().reason_code, 'read_only_backend');
  assert.deepEqual(store.sweepOverdue(), []);
  assert.deepEqual(store.listStale(), []);
  assert.deepEqual(store.eventsAfter(), []);
  assert.equal(store.recordEvent(), null);
  store.close();
  // unreadable store degrades with a warning
  fs.writeFileSync(path.join(p2, '.hseos', 'state', 'project.db'), 'not a database');
  const broken = new ProjectAggregateStore({ projectDirs: [p2] });
  assert.deepEqual(broken.listActive(), []);
  assert.ok(broken.warnings.some((w) => /unreadable/.test(w)));

  // wired through the contract
  const dir = tmp();
  writeContract(
    dir,
    `enabled: true\nstore:\n  backend: project-aggregate\n  project_dirs: [${JSON.stringify(p1)}, ${JSON.stringify(p2)}]\n`,
  );
  const { coordination } = createCoordination(dir);
  assert.ok(coordination.store instanceof ProjectAggregateStore);
  const listed = coordination.list();
  assert.equal(listed.activities.length, 1);
  assert.ok(
    openStore({ store: { backend: 'adapter:axon', path: path.join(dir, 'm.db') }, reservations: { ttl_s: 60 } }) instanceof MachineStore,
  );
  coordination.close();
});

function fakeNpmShim(dir, versions) {
  const bin = path.join(dir, 'shim');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'npm'),
    `#!/bin/sh\necho "$@" >> "${path.join(dir, 'npm-calls.log')}"\necho '${JSON.stringify(versions)}'\n`,
    { mode: 0o755 },
  );
  return bin;
}

test('CLI: disabled is a no-op, enabled round-trips offline with --json and exit codes', () => {
  const dir = tmp();
  const shimRoot = tmp();
  const shim = fakeNpmShim(shimRoot, ['1.0.0']);
  const run = (args) =>
    spawnSync(process.execPath, [path.join(ROOT, 'tools/cli/hseos-cli.js'), 'activity', ...args, '--directory', dir], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, HSEOS_GOVERNED_EXECUTION_FIXTURE: '1', NODE_ENV: 'test' },
      timeout: 20_000,
    });
  writeContract(dir, 'enabled: false\n');
  const before = tree(dir);
  const off = run(['list', '--json']);
  assert.equal(off.status, 0, off.stderr);
  assert.equal(JSON.parse(off.stdout).enabled, false);
  assert.match(run(['list']).stdout, /disabled/);
  assert.equal(run(['reserve', 'name:x', '--session', 's']).status, 0);
  assert.deepEqual(tree(dir), before, 'a disabled contract leaves the directory tree untouched');
  const db = path.join(dir, 'cli.db');
  writeContract(dir, `enabled: true\nstore:\n  path: ${db}\nhot_files: ['**/CHANGELOG.md']\n`);
  assert.equal(run(['bogus']).status, 1);
  assert.equal(run(['register', '--json']).status, 1);
  assert.equal(run(['register', '--session', 's1', '--json']).status, 1);
  const reg = (session, tool) =>
    run(['register', '--session', session, '--tool', tool, '--repo', REPO, '--worktree', dir, '--path', 'CHANGELOG.md', '--json']);
  assert.equal(reg('s1', 'claude-code').status, 0);
  const second = JSON.parse(reg('s2', 'codex').stdout);
  assert.equal(second.overlaps[0].severity, 'hot_file');
  const reserve = (session, key) => run(['reserve', key, '--session', session, '--json']);
  const got = JSON.parse(reserve('s1', 'name:pkg').stdout);
  assert.ok(got.ok);
  const refused = reserve('s2', 'name:pkg');
  assert.equal(refused.status, 2);
  assert.equal(JSON.parse(refused.stdout).reason_code, 'claim_held');
  assert.match(run(['reserve', 'name:pkg', '--session', 's2']).stdout, /refused/);
  // acquired with a published conflict: distinct exit code and flag
  const conflicted = reserve('s1', 'version:zz@1.0.0');
  assert.equal(conflicted.status, 3);
  assert.equal(JSON.parse(conflicted.stdout).conflicted, true);
  assert.match(run(['reserve', 'version:zz@1.0.0', '--session', 's1']).stdout, /acquired with conflicts/);
  assert.equal(reserve('s1', 'version:zz@1.0.1').status, 0);
  const npmLog = fs.readFileSync(path.join(shimRoot, 'npm-calls.log'), 'utf8');
  assert.match(npmLog, /^view --json -- zz versions$/m);
  assert.equal(run(['release', 'name:pkg', '--fence', String(got.claim.fence + 99), '--session', 's1', '--json']).status, 0);
  assert.equal(JSON.parse(run(['release', 'name:pkg', '--fence', String(got.claim.fence), '--json']).stdout).ok, true);
  assert.equal(run(['release', '--json']).status, 1);
  assert.equal(run(['release', 'name:pkg', '--fence', 'abc']).status, 1);
  assert.equal(run(['reserve', '--session', 's1']).status, 1);
  assert.equal(JSON.parse(run(['heartbeat', '--session', 's1', '--json']).stdout).ok, true);
  assert.equal(JSON.parse(run(['declare', '--session', 's1', '--path', 'x', '--json']).stdout).ok, true);
  assert.equal(JSON.parse(run(['overlaps', '--session', 's1', '--json']).stdout).overlaps.length, 1);
  assert.match(run(['check', '--session', 's1', '--no-consume']).stdout, /overlap hot_file/);
  const checked = JSON.parse(run(['check', '--session', 's1', '--json']).stdout);
  assert.ok(checked.inbox.length > 0);
  assert.equal(JSON.parse(run(['list', '--json']).stdout).activities.length, 2);
  assert.equal(JSON.parse(run(['end', '--session', 's2', '--json']).stdout).ok, true);
});

test('CLI: guard-publish is dispatched to the adapters module when present', async () => {
  const original = cli.loaders.guardPublish;
  const calls = [];
  try {
    cli.loaders.guardPublish = () => async (spec, options) => (calls.push([spec, options.json]), { exitCode: 4 });
    process.exitCode = undefined;
    await cli.action('guard-publish', 'zz@1.0.0', { json: true });
    assert.deepEqual(calls, [['zz@1.0.0', true]]);
    assert.equal(process.exitCode, 4);
    cli.loaders.guardPublish = () => async () => 1;
    await cli.action('guard-publish', 'zz@1.0.0', {});
    assert.equal(process.exitCode, 1, 'a bare number is accepted');
    cli.loaders.guardPublish = () => async () => ({ exitCode: 0, decision: 'allow' });
    process.exitCode = undefined;
    await cli.action('guard-publish', 'zz@1.0.0', {});
    assert.equal(process.exitCode, 0);
    const errors = console.error;
    console.error = () => {};
    cli.loaders.guardPublish = () => async () => {};
    await cli.action('guard-publish', 'zz@1.0.0', {});
    console.error = errors;
    assert.equal(process.exitCode, 2, 'a guard that returns no exit code is not a pass');
  } finally {
    cli.loaders.guardPublish = original;
    process.exitCode = undefined;
  }
});

test('foreign reservations: the session that tries to reserve is warned too (experimental.6, both sides)', () => {
  const { dir, coordination } = setup({ published: [] });
  const wtA = worktree(dir, 'wt-a');
  const wtB = worktree(dir, 'wt-b');
  const key = `version:${PKG}@${VERSION}`;
  coordination.register({ session: 'cc-1', tool: 'claude-code', repo: REPO, worktree: wtA, paths: ['packages/contracts/**'] });
  assert.equal(coordination.reserve('cc-1', key).conflicted, false);
  assert.ok(coordination.reserve('cc-1', `path:${REPO}:packages/contracts/**`).ok);
  assert.ok(coordination.reserve('cc-1', 'name:other-pkg').ok);
  coordination.register({
    session: 'cx-1',
    tool: 'codex',
    repo: REPO,
    worktree: wtB,
    paths: ['packages/contracts/CHANGELOG.md'],
    identifiers: [`${PKG}@${VERSION}`, 'other-pkg', 'unrelated', '??'],
  });
  // codex side: sees the claude reservations in its own check, before trying to reserve
  const seen = coordination.check('cx-1');
  assert.deepEqual(
    seen.foreign_reservations.map((r) => r.key).sort(),
    [key, 'name:other-pkg', `path:${REPO}:packages/contracts/**`].sort(),
  );
  assert.ok(seen.foreign_reservations.every((r) => r.owner === 'cc-1' && r.tool === 'claude-code' && Number.isInteger(r.fence)));
  // claude side: sees none (it holds them) and is warned about the overlap by the inbox
  const mine = coordination.check('cc-1');
  assert.deepEqual(mine.foreign_reservations, []);
  assert.ok(mine.inbox.some((e) => e.event.type === 'overlap_detected'));
  assert.deepEqual(coordination.check('ghost-session').foreign_reservations ?? [], []);
  // another repo or no declaration: nothing foreign
  coordination.register({
    session: 'z-1',
    tool: 'codex',
    repo: 'github.com/other/repo',
    worktree: wtB,
    paths: ['packages/contracts/CHANGELOG.md'],
  });
  assert.deepEqual(coordination.check('z-1').foreign_reservations, []);
  coordination.close();
});

test('CLI loads adapters from the contract and mirrors events; missing ones only warn', async () => {
  const dir = tmp();
  writeContract(dir, `enabled: true\nstore:\n  path: ${path.join(dir, 'cli.db')}\n  adapters: [axon, ghost, '../evil']\n`);
  const original = cli.loaders.adapter;
  const events = [];
  const log = console.log;
  const errors = console.error;
  const output = [];
  try {
    console.log = (line) => output.push(line);
    console.error = (line) => output.push(line);
    cli.loaders.adapter = (name) => (name === 'axon' ? { name, mirror: (event) => events.push(event) } : null);
    const base = { directory: dir, json: true };
    await cli.action('register', undefined, { ...base, session: 'a', tool: 'codex', repo: REPO, worktree: dir });
    await cli.action('declare', undefined, { ...base, session: 'a', path: ['x.js'] });
    assert.ok(events.some((event) => event.type === 'activity_declared'));
    assert.ok(output.some((line) => /adapter ghost is not installed/.test(line)));
    cli.loaders.adapter = original;
    assert.equal(original('../evil'), null, 'adapter names cannot traverse');
    assert.equal(original('ghost'), null, 'absent adapter module is null, not an error');
  } finally {
    cli.loaders.adapter = original;
    console.log = log;
    console.error = errors;
  }
});

test('CLI process: guard-publish propagates the exit code of the module (object and number)', () => {
  const dir = tmp();
  const cliPath = path.join(ROOT, 'tools/cli/commands/activity.js');
  // The wrapper imports the command and injects the stub through the internal loader: no environment-driven module loading.
  const run = (body) => {
    const stub = path.join(dir, 'stub.js');
    fs.writeFileSync(stub, `exports.runGuardPublish = ${body};\n`);
    const wrapper = path.join(dir, 'wrapper.js');
    fs.writeFileSync(
      wrapper,
      `const cli = require(${JSON.stringify(cliPath)});
       cli.loaders.guardPublish = () => (${body === 'null' ? 'null' : `require(${JSON.stringify(stub)}).runGuardPublish`});
       cli.action('guard-publish', 'zz@1.0.0', {}).catch((error) => { console.error(error.message); process.exitCode = 9; });`,
    );
    return spawnSync(process.execPath, [wrapper], { encoding: 'utf8', timeout: 20_000 });
  };
  const cases = [
    ['async () => ({ exitCode: 1, decision: "refuse", reason: "reserved" })', 1],
    ['async () => 1', 1],
    ['async () => ({ exitCode: 0, decision: "allow" })', 0],
    ['async () => ({ exitCode: 2, decision: "invalid" })', 2],
    ['async () => undefined', 2],
    ['null', 2],
  ];
  for (const [body, expected] of cases) {
    const result = run(body);
    assert.equal(result.status, expected, `${body}: ${result.stderr}`);
  }
  assert.match(run('null').stderr, /indisponível nesta instalação/);
});

test('sanitisation drops invisible and formatting characters everywhere text reaches a reason', () => {
  const hostile = '\uFFA0\u1160\u17B4\u17B5a\u200Bb\u00ADc\u180Ed\u034Fe\uFE0Ff\u3164g\u2800h\u115Fi\u2028j\u0085k\u{E0101}l';
  assert.equal(paths.sanitizeText(hostile, 100), 'abcdefghi j kl');
  assert.equal(paths.normalizePathExpr('src/a\u200B.js'), null);
  assert.equal(paths.normalizePathExpr('src/\u202Ea.js'), null);
  const { coordination } = setup();
  coordination.register({
    session: 'a',
    tool: 'claude-code',
    repo: REPO,
    worktree: coordination.directory,
    intent: 'do\u200B it\n[SYSTEM] x',
    paths: ['p.js'],
  });
  assert.equal(coordination.store.get('a').intent, 'do it [SYSTEM] x');
  assert.equal(coordination.declare('a', { paths: ['q\u200B.js'] }).reason_code, 'invalid_path');
  coordination.close();
});

test('stale and unknown sessions get an explicit notice; a diverging worktree repo is ignored with a warning', () => {
  const ctx = setup({ hot: [] });
  const { coordination, clock, dir } = ctx;
  const wt = worktree(dir, 'wt');
  coordination.register({ session: 'a', tool: 'codex', repo: REPO, worktree: wt, base: 'origin/main', paths: ['p.js'] });
  coordination.register({
    session: 'b',
    tool: 'claude-code',
    repo: 'github.com/someone/else',
    worktree: wt,
    base: 'origin/main',
    paths: ['p.js'],
  });
  assert.ok(
    coordination.warnings.some((w) => /git diff ignored for b/.test(w)),
    'diverging origin: ignored with a warning',
  );
  assert.equal(coordination.warnings.filter((w) => /git diff ignored for b/.test(w)).length, 1, 'warnings are not repeated');
  clock.t += 120_000;
  coordination.heartbeat('b');
  const stale = coordination.check('a');
  assert.ok(stale.warnings.some((w) => /session a is stale/.test(w)));
  assert.ok(coordination.list('a').warnings.some((w) => /session a is stale/.test(w)));
  const unknown = coordination.check('nobody');
  assert.ok(unknown.warnings.some((w) => /session nobody is not registered/.test(w)));
  coordination.close();
});

test('adapter loader: resolves <name>-adapter.js with create<Name>Adapter (CO2 format), stays inside its directory', async () => {
  const root = tmp();
  const adapters = path.join(root, 'activity-adapters');
  fs.mkdirSync(adapters);
  const write = (file, body) => fs.writeFileSync(path.join(file.startsWith('/') ? file : path.join(adapters, file)), body);
  // exact shape delivered by the adapters track
  write('axon-adapter.js', 'exports.createAxonAdapter = () => ({ mirror: (event) => (globalThis.__co1_mirrored ||= []).push(event) });\n');
  write('plain.js', 'exports.mirror = () => {};\n');
  write('my-tool-adapter.js', 'exports.createMyToolAdapter = () => ({ mirror: () => {} });\n');
  write('generic-adapter.js', 'exports.createAdapter = () => ({ mirror: () => {} });\n');
  write('nomirror-adapter.js', 'exports.createAdapter = () => ({});\n');
  write('broken-adapter.js', 'throw new Error("boom");\n');
  write(path.join(root, 'evil.js'), 'exports.mirror = () => { globalThis.__co1_evil = true; };\n');
  const original = cli.loaders.adapterDir;
  globalThis.__co1_mirrored = [];
  globalThis.__co1_evil = false;
  try {
    cli.loaders.adapterDir = adapters;
    const axon = cli.loaders.adapter('axon');
    assert.equal(axon.name, 'axon');
    axon.mirror({ type: 'activity_declared' });
    assert.equal(globalThis.__co1_mirrored.length, 1);
    for (const name of ['plain', 'my-tool', 'generic']) assert.equal(cli.loaders.adapter(name).name, name, name);
    for (const name of ['nomirror', 'broken', 'ghost']) assert.equal(cli.loaders.adapter(name), null, name);
    // the name regex bars traversal and anything outside the charset; evil.js outside the directory is never loaded
    for (const name of ['../evil', '..', '../../evil', 'a/b', 'Axon', '', '-x', 'evil.js', 'x'.repeat(40), 'a b', 'a\u0000b']) {
      assert.equal(cli.loaders.adapter(name), null, JSON.stringify(name));
    }
    assert.equal(cli.loaders.adapter('evil'), null, 'a file next to the directory is not an adapter');
    assert.equal(globalThis.__co1_evil, false, 'evil.js was never executed');
    // end to end through the real loader, no loader stub
    const dir = tmp();
    writeContract(dir, `enabled: true\nstore:\n  path: ${path.join(dir, 'cli.db')}\n  adapters: [axon]\n`);
    const log = console.log;
    console.log = () => {};
    try {
      await cli.action('register', undefined, { directory: dir, session: 'a', tool: 'codex', repo: REPO, worktree: dir, json: true });
      await cli.action('declare', undefined, { directory: dir, session: 'a', path: ['x.js'], json: true });
    } finally {
      console.log = log;
    }
    assert.ok(globalThis.__co1_mirrored.some((event) => event.type === 'activity_declared'));
  } finally {
    cli.loaders.adapterDir = original;
    delete globalThis.__co1_mirrored;
    delete globalThis.__co1_evil;
  }
});
