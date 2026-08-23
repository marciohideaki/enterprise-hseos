'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const Database = require('better-sqlite3');

const { openOperationalStateDatabase } = require('../tools/mcp-project-state/lib/operational-state-db');

if (process.argv[2] === '--migration-worker') {
  const databasePath = process.argv[3];
  const startSignal = process.argv[4];
  const waitForSignal = () => {
    if (!fs.existsSync(startSignal)) return setTimeout(waitForSignal, 5);
    const db = openOperationalStateDatabase(databasePath, { activatePendingFixture: true });
    db.close();
  };
  waitForSignal();
} else {
  function runWorker(databasePath, startSignal) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [__filename, '--migration-worker', databasePath, startSignal], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HSEOS_GOVERNED_EXECUTION_FIXTURE: '1', NODE_ENV: 'test' },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`migration worker exited ${code}: ${stderr}`));
      });
    });
  }

  test('operational database remains at schema v4 without fixture activation', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-operational-gated-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const db = openOperationalStateDatabase(path.join(directory, 'project.db'));
    try {
      assert.equal(db.pragma('user_version', { simple: true }), 4);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'execution_events'").get().count, 0);
    } finally {
      db.close();
    }
  });

  test('production rejects a pre-existing pending schema even when its version is disguised', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-operational-reject-pending-'));
    const databasePath = path.join(directory, 'project.db');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const previous = { fixture: process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE, node: process.env.NODE_ENV };
    process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = '1';
    process.env.NODE_ENV = 'test';
    const fixtureDb = openOperationalStateDatabase(databasePath, { activatePendingFixture: true });
    fixtureDb.close();
    if (previous.fixture === undefined) delete process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
    else process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = previous.fixture;
    if (previous.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.node;
    assert.throws(() => openOperationalStateDatabase(databasePath), /schema v4/);
    const disguised = new Database(databasePath);
    disguised.pragma('user_version = 4');
    disguised.close();
    assert.throws(() => openOperationalStateDatabase(databasePath), /pending execution schema/);
  });

  test('concurrent gated fixture startups serialize pending schema migration through version 7', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-operational-db-'));
    const databasePath = path.join(directory, 'project.db');
    const startSignal = path.join(directory, 'start');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    const workers = Array.from({ length: 4 }, () => runWorker(databasePath, startSignal));
    fs.writeFileSync(startSignal, 'go');
    await Promise.all(workers);

    const db = new Database(databasePath, { readonly: true });
    try {
      assert.equal(db.pragma('user_version', { simple: true }), 7);
      const executionTables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'execution_%' ORDER BY name")
        .all()
        .map(({ name }) => name);
      assert.deepEqual(executionTables, [
        'execution_approval_uses',
        'execution_approvals',
        'execution_event_schemas',
        'execution_events',
        'execution_projection_checkpoints',
        'execution_projection_generations',
        'execution_run_projection',
      ]);
    } finally {
      db.close();
    }
  });

  test('pending fixtures reject direct, symlinked, and hard-linked escape paths', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-fixture-links-'));
    const outside = fs.mkdtempSync('/var/tmp/hseos-fixture-outside-');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const previous = { fixture: process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE, node: process.env.NODE_ENV };
    process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = '1';
    process.env.NODE_ENV = 'test';
    try {
      assert.throws(() => openOperationalStateDatabase(path.join(outside, 'direct.db'), { activatePendingFixture: true }), /temporary/);
      const target = path.join(outside, 'target.db');
      fs.writeFileSync(target, 'not-a-database');
      const symbolic = path.join(directory, 'symbolic.db');
      fs.symlinkSync(target, symbolic);
      assert.throws(() => openOperationalStateDatabase(symbolic, { activatePendingFixture: true }), /link/);
      const source = path.join(directory, 'source.db');
      fs.writeFileSync(source, 'not-a-database');
      const hard = path.join(directory, 'hard.db');
      fs.linkSync(source, hard);
      assert.throws(() => openOperationalStateDatabase(hard, { activatePendingFixture: true }), /link/);
    } finally {
      if (previous.fixture === undefined) delete process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
      else process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = previous.fixture;
      if (previous.node === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.node;
    }
  });
}
