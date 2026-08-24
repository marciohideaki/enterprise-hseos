'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { resolveCapabilityPlan } = require('../tools/cli/lib/capability-catalog');
const {
  CANDIDATE_PROFILE,
  certifyCandidateProfile,
  readCandidateManifest,
  runActivationRehearsal,
} = require('../tools/lib/agentic-activation-rehearsal');
const { databaseFingerprint } = require('../tools/lib/compatibility-audit');
const { openOperationalStateDatabase } = require('../tools/mcp-project-state/lib/operational-state-db');

const ROOT = path.join(__dirname, '..');
function sourceFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-activation-source-'));
  fs.chmodSync(directory, 0o700);
  const filename = path.join(directory, 'project.db');
  const db = openOperationalStateDatabase(filename);
  db.prepare('INSERT INTO state (key, value) VALUES (?, ?)').run('activation.fixture', 'preserve-me');
  db.close();
  fs.chmodSync(filename, 0o600);
  return { directory, filename, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('candidate profile is explicit, key-referenced, sandbox-required and still non-operational', async () => {
  const manifest = readCandidateManifest(ROOT);
  const plan = resolveCapabilityPlan({ root: ROOT, profile: CANDIDATE_PROFILE });
  const certification = await certifyCandidateProfile(ROOT);

  assert.equal(manifest.operational, false);
  assert.equal(manifest.activation.authorized, false);
  assert.equal(manifest.sandbox.required, true);
  assert.equal(manifest.sandbox.default_profile, 'lockdown');
  assert.deepEqual(plan.materialization.selected_model_providers, ['model:openai-compatible']);
  assert.deepEqual(plan.materialization.selected_runtime_providers, ['runtime:hseos-kernel']);
  assert.deepEqual(plan.materialization.secret_refs, ['secret://hseos/model-provider-api-key']);
  assert.equal(certification.ready, true);
  assert.equal(certification.secret_resolved_at_dispatch, true);
  assert.equal(certification.secret_absent_from_evidence, true);
  assert.deepEqual(certification.normalized_events, ['content.delta', 'usage', 'completed']);
});

test('rehearsal migrates and discards a private candidate, restores v4 and leaves source byte-identical', async () => {
  const fixture = sourceFixture();
  try {
    const before = databaseFingerprint(fixture.filename);
    const report = await runActivationRehearsal({ databasePath: fixture.filename, repositoryRoot: ROOT, environment: { PATH: '' } });
    const after = databaseFingerprint(fixture.filename);

    assert.equal(report.status, 'rehearsal-passed');
    assert.equal(report.rehearsal_only, true);
    assert.equal(report.operational_activation, false);
    assert.equal(report.activation_authorized, false);
    assert.equal(report.ready_for_operational_activation, false);
    assert.equal(report.ready_for_provider_environment_gate, false);
    assert.equal(report.evidence.migration.ready, true);
    assert.equal(report.evidence.migration.source_version, 4);
    assert.equal(report.evidence.migration.target_version, 9);
    assert.deepEqual(report.evidence.migration.applied, [
      '005-governed-execution-ledger-v2.sql',
      '006-execution-projections.sql',
      '007-execution-approvals.sql',
      '008-delegated-runtime-event-catalog.sql',
      '009-delegated-worker-lifecycle.sql',
    ]);
    assert.deepEqual(report.evidence.migration.changed_legacy_tables, []);
    assert.equal(report.evidence.rollback.ready, true);
    assert.equal(report.evidence.rollback.restored_version, 4);
    assert.equal(report.evidence.rollback.baseline_tables_preserved, true);
    assert.equal(report.evidence.rollback.migrated_candidate_discarded, true);
    assert.equal(report.evidence.operational_source.unchanged, true);
    assert.deepEqual(after, before);
    assert.equal(report.evidence.sandbox.required, true);
    assert.equal(report.evidence.sandbox.ready, false);
    assert.ok(report.remaining_gates.includes('required-sandbox-runtime'));
    assert.ok(report.remaining_gates.includes('provider-environment-validation'));
    assert.ok(report.remaining_gates.includes('g9-zero-legacy-window'));
    assert.ok(report.remaining_gates.includes('explicit-human-cutover'));
  } finally {
    fixture.cleanup();
  }
});

test('rehearsal rejects link aliases and live SQLite sidecars before making a copy', async () => {
  const fixture = sourceFixture();
  const symbolic = path.join(fixture.directory, 'alias.db');
  const hardlink = path.join(fixture.directory, 'hardlink.db');
  try {
    fs.symlinkSync(fixture.filename, symbolic);
    await assert.rejects(() => runActivationRehearsal({ databasePath: symbolic, repositoryRoot: ROOT }), /regular, non-symlink/);
    fs.linkSync(fixture.filename, hardlink);
    await assert.rejects(() => runActivationRehearsal({ databasePath: fixture.filename, repositoryRoot: ROOT }), /hard-linked/);
    fs.unlinkSync(hardlink);
    fs.writeFileSync(`${fixture.filename}-wal`, 'writer-sidecar');
    await assert.rejects(() => runActivationRehearsal({ databasePath: fixture.filename, repositoryRoot: ROOT }), /SQLite sidecars/);
  } finally {
    fixture.cleanup();
  }
});

test('explicit live mode checkpoints a verified WAL snapshot without opening or changing the operational database', async () => {
  const fixture = sourceFixture();
  const writer = openOperationalStateDatabase(fixture.filename);
  try {
    writer.prepare('UPDATE state SET value = ? WHERE key = ?').run('visible-through-wal', 'activation.fixture');
    assert.equal(fs.existsSync(`${fixture.filename}-wal`), true);
    const before = databaseFingerprint(fixture.filename);
    const report = await runActivationRehearsal({
      databasePath: fixture.filename,
      repositoryRoot: ROOT,
      environment: { PATH: '' },
      allowLiveSnapshot: true,
    });
    assert.equal(report.status, 'rehearsal-passed');
    assert.equal(report.evidence.operational_source.mode, 'verified-snapshot-of-live-wal');
    assert.equal(report.evidence.operational_source.unchanged, true);
    assert.deepEqual(databaseFingerprint(fixture.filename), before);
  } finally {
    writer.close();
    fixture.cleanup();
  }
});
