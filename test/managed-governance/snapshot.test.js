'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { digestCanonical } = require('../../packages/managed-governance-contracts');
const { createSnapshotStore } = require('../../packages/managed-governance-client');
const { BINDING_DIGEST, REPOSITORY_ID, snapshot } = require('./client-fixtures');
let directory;
let snapshotPath;

before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-snapshot-'));
  snapshotPath = path.join(directory, '.hseos', 'state', 'snapshot.json');
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('promotion is atomic, private and digest-verified', () => {
  const store = createSnapshotStore({ snapshotPath, clock: () => new Date('2026-09-01T01:00:00.000Z') });
  const candidate = snapshot();
  const digest = digestCanonical(candidate);
  assert.deepEqual(store.promote(candidate, digest), { status: 'promoted', digest, snapshot_id: candidate.snapshot_id });
  assert.equal(fs.statSync(snapshotPath).mode & 0o077, 0);
  assert.equal(
    fs.readdirSync(path.dirname(snapshotPath)).some((name) => name.endsWith('.tmp')),
    false,
  );
  const loaded = store.load({ maximumAgeSeconds: 86_400, repositoryId: REPOSITORY_ID, bindingDigest: BINDING_DIGEST });
  assert.equal(loaded.status, 'valid');
  assert.equal(loaded.age_seconds, 3600);
  assert.throws(() => store.promote(candidate, `sha256:${'e'.repeat(64)}`), /digest/);
});

test('corrupt, expired and identity-mismatched snapshots are never valid', () => {
  const store = createSnapshotStore({ snapshotPath, clock: () => new Date('2026-09-03T00:00:00.000Z') });
  store.promote(snapshot());
  assert.throws(() => store.load({ maximumAgeSeconds: 86_400, repositoryId: REPOSITORY_ID, bindingDigest: BINDING_DIGEST }), /expired/);
  const envelope = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  envelope.snapshot.organization_id = 'tampered';
  fs.writeFileSync(snapshotPath, JSON.stringify(envelope));
  assert.throws(() => store.load({ maximumAgeSeconds: 86_400, repositoryId: REPOSITORY_ID, bindingDigest: BINDING_DIGEST }), /integrity/);
});
