'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { accountDigest, isAccountDigest, sameAccount, sameAccountDigest } = require('../tools/cli/lib/campaign-evidence-store');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const { parseProviderControlManifest } = require('../tools/lib/provider-control-manifest');
const { manifest } = require('./helpers/provider-control');
const { setup, IDENTITY } = require('./helpers/claude-account');

const identity = { type: 'chatgpt', email: 'owner@example.invalid' };
function installation(t) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-account-digest-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  return state;
}
const keyOf = (state) => fs.readFileSync(path.join(state, 'account-digest.key'));

test('the same account has different digests in two installations and a stable one in the same installation', (t) => {
  const a = installation(t);
  const b = installation(t);
  const first = accountDigest(a, identity);
  assert.deepEqual(first, accountDigest(a, identity));
  assert.notDeepEqual(first, accountDigest(b, identity));
  assert.notDeepEqual(first, accountDigest(a, { ...identity, email: 'other@example.invalid' }));
  assert.deepEqual(Object.keys(first).sort(), ['alg', 'v', 'value']);
  assert.equal(first.v, 2);
  assert.equal(first.alg, 'hmac-sha256');
  assert.ok(isAccountDigest(first));
});

test('a dictionary of e-mails with plain sha256 does not reproduce the v2 digest', (t) => {
  const state = installation(t);
  const { value } = accountDigest(state, identity);
  for (const candidate of [identity, identity.email]) {
    assert.notEqual(engineeringDigest(candidate), value);
    assert.notEqual(createHash('sha256').update(JSON.stringify(candidate)).digest('hex'), value);
    assert.notEqual(
      createHash('sha256')
        .update(typeof candidate === 'string' ? candidate : candidate.email)
        .digest('hex'),
      value,
    );
  }
  // Knowing the derivation purpose but not the installation key is not enough either.
  const guessed = require('node:crypto').createHmac('sha256', 'hseos-campaign-account:account-digest:v2').update('x').digest('hex');
  assert.notEqual(guessed, value);
});

test('the installation key is 32 random bytes, 0600, created once and never part of a digest or an error', (t) => {
  const state = installation(t);
  assert.equal(fs.existsSync(path.join(state, 'account-digest.key')), false);
  const digest = accountDigest(state, identity);
  const stat = fs.statSync(path.join(state, 'account-digest.key'));
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(stat.size, 32);
  const key = keyOf(state);
  accountDigest(state, { ...identity, email: 'second@example.invalid' });
  assert.deepEqual(keyOf(state), key);
  assert.deepEqual(
    fs.readdirSync(state).filter((name) => name.startsWith('.tmp-')),
    [],
  );
  const text = JSON.stringify(digest);
  assert.ok(!text.includes(key.toString('hex')) && !text.includes(key.toString('base64')));
  // An existing key readable by others is refused instead of being trusted or silently fixed.
  fs.chmodSync(path.join(state, 'account-digest.key'), 0o644);
  assert.throws(() => accountDigest(state, identity), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  assert.throws(() => accountDigest('relative/state', identity), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
});

test('losing the key makes earlier v2 digests unverifiable', (t) => {
  const state = installation(t);
  const before = accountDigest(state, identity);
  fs.rmSync(path.join(state, 'account-digest.key'));
  const after = accountDigest(state, identity);
  assert.equal(sameAccountDigest(before, after), false);
});

test('v1 stays readable in the manifest, v2 is accepted, and the two are never equal', (t) => {
  const v1 = manifest('codex', 'account', 'client');
  v1.authentication.identity_kind = 'account';
  assert.equal(parseProviderControlManifest(structuredClone(v1)).authentication.account_sha256, 'c'.repeat(64));
  const digest = accountDigest(installation(t), identity);
  const v2 = structuredClone(v1);
  v2.authentication.account_sha256 = null;
  v2.authentication.account_digest = digest;
  assert.deepEqual(parseProviderControlManifest(v2).authentication.account_digest, digest);
  assert.throws(() => parseProviderControlManifest({ ...v1, authentication: { ...v1.authentication, account_digest: digest } }));
  assert.throws(() => parseProviderControlManifest({ ...v2, authentication: { ...v2.authentication, account_digest: undefined } }));
  assert.throws(() =>
    parseProviderControlManifest({ ...v2, authentication: { ...v2.authentication, account_digest: { ...digest, v: 3 } } }),
  );
  // Same hex on both sides, different formats: unverifiable, never equal.
  assert.equal(sameAccount({ account_sha256: digest.value }, { account_digest: digest, account_sha256: null }), false);
  assert.equal(sameAccount({ account_sha256: null, account_digest: digest }, { account_sha256: digest.value }), false);
  assert.equal(sameAccount({ account_sha256: digest.value }, { account_sha256: digest.value }), true);
  assert.equal(sameAccount({ account_sha256: null, account_digest: digest }, { account_digest: { ...digest } }), true);
  assert.equal(sameAccount({ account_sha256: null }, { account_sha256: null }), false);
  assert.equal(isAccountDigest({ ...digest, extra: 1 }), false);
  assert.equal(isAccountDigest(null), false);
});

test('the account worker neither prints nor returns the key, and its digest is not the unsalted one', (t) => {
  const f = setup(t);
  const group = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-account-group-'));
  t.after(() => fs.rmSync(group, { recursive: true, force: true }));
  fs.writeFileSync(path.join(group, 'cgroup.procs'), '');
  const input = {
    operation: 'inspect',
    binding: { executable: f.executable, cwd: f.cwd },
    environment: f.settings.environment,
    expected_version: '2.1.296',
    state: f.controlState,
    group,
  };
  const run = spawnSync(process.execPath, [require.resolve('../tools/cli/lib/provider-claude-account-worker')], {
    input: JSON.stringify(input),
    env: {},
    encoding: 'utf8',
  });
  const key = keyOf(f.controlState);
  for (const stream of [run.stdout, run.stderr]) {
    assert.ok(!stream.includes(key.toString('hex')) && !stream.includes(key.toString('base64')));
  }
  const { result } = JSON.parse(run.stdout);
  assert.deepEqual(result.account_digest, f.m.authentication.account_digest);
  assert.equal(result.account_sha256, undefined);
  assert.notEqual(result.account_digest.value, engineeringDigest(IDENTITY));
});

test('a missing or non-directory state is refused with a stable code', (t) => {
  const state = installation(t);
  assert.throws(() => accountDigest(path.join(state, 'absent'), identity), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  fs.writeFileSync(path.join(state, 'file'), '');
  assert.throws(() => accountDigest(path.join(state, 'file'), identity), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
});

test('concurrent first use in one state gives every process the same key and no error', (t) => {
  const state = installation(t);
  const script = `const { accountDigest } = require(${JSON.stringify(require.resolve('../tools/cli/lib/campaign-evidence-store'))});
    process.stdout.write(JSON.stringify(accountDigest(process.argv[1], { type: 'chatgpt', email: 'owner@example.invalid' })));`;
  return (async () => {
    for (let round = 0; round < 10; round++) {
      const dir = fs.mkdtempSync(path.join(state, 'par-'));
      const results = await Promise.all(
        Array.from(
          { length: 8 },
          () =>
            new Promise((resolve) => {
              const child = spawn(process.execPath, ['-e', script, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
              let out = '';
              let err = '';
              child.stdout.on('data', (c) => (out += c));
              child.stderr.on('data', (c) => (err += c));
              child.on('close', (code) => resolve({ code, out, err }));
            }),
        ),
      );
      for (const r of results) assert.equal(r.code, 0, r.err);
      assert.equal(new Set(results.map((r) => r.out)).size, 1);
      assert.deepEqual(
        fs.readdirSync(dir).filter((n) => n.startsWith('.tmp-')),
        [],
      );
    }
  })();
});

test('a persistent extra hard link to the key is refused after a short wait; a transient one is tolerated', (t) => {
  const state = installation(t);
  accountDigest(state, identity);
  const extra = path.join(state, '.tmp-extra');
  fs.linkSync(path.join(state, 'account-digest.key'), extra);
  const started = Date.now();
  assert.throws(() => accountDigest(state, identity), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  assert.ok(Date.now() - started >= 150);
  fs.rmSync(extra);
  assert.ok(isAccountDigest(accountDigest(state, identity)));
});

test('the manifest refuses an account digest on local-profile and credential identities and an unpinned account', (t) => {
  const digest = accountDigest(installation(t), identity);
  const account = manifest('codex', 'account', 'client');
  account.authentication.identity_kind = 'account';
  const pinned = (patch) => ({ ...account, authentication: { ...account.authentication, ...patch } });
  assert.throws(() => parseProviderControlManifest(pinned({ account_sha256: null })));
  assert.throws(() => parseProviderControlManifest(pinned({ account_digest: digest })));
  const api = manifest('deepseek', 'api', 'model');
  const credential = { ...api.authentication, identity_kind: 'credential', credential_sha256: 'e'.repeat(64) };
  assert.ok(parseProviderControlManifest({ ...api, authentication: { ...credential, account_sha256: null } }));
  assert.throws(() =>
    parseProviderControlManifest({ ...api, authentication: { ...credential, account_sha256: null, account_digest: digest } }),
  );
  assert.throws(() =>
    parseProviderControlManifest({
      ...api,
      authentication: { ...credential, account_sha256: null, account_digest: { ...digest, alg: 'sha256' } },
    }),
  );
  const local = manifest('codex', 'account', 'client');
  local.route = 'local';
  local.billing = { kind: 'local', currency: 'USD', max_request_microusd: 0 };
  local.authentication = {
    ...local.authentication,
    identity_kind: 'local_profile',
    profile_sha256: 'f'.repeat(64),
    credential: null,
    account_sha256: null,
    account_digest: digest,
  };
  assert.throws(() => parseProviderControlManifest(local));
});
