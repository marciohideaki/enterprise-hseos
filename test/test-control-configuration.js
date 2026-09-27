'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { loadControlConfiguration } = require('../tools/cli/lib/control-configuration');
const { createExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { manifest } = require('./helpers/provider-control');

function fixture(t) {
  const handle = createExecutionLedgerFileFixture();
  handle.close();
  t.after(() => handle.cleanup());
  const physical = (filename) => {
    const stat = fs.lstatSync(filename, { bigint: true });
    return { device: String(stat.dev), inode: String(stat.ino) };
  };
  const value = manifest();
  const config = {
    workspaces: [handle.directory],
    provider_control: {
      schema_version: 1,
      state: handle.directory,
      state_identity: physical(handle.directory),
      ledger_identity: physical(handle.filename),
      bindings: { [value.binding_id]: { manifest: value, binding: '/trusted/binding.json' } },
      authorizations: {
        [randomUUID()]: {
          max_requests: 1,
          max_cost_microusd: 1000,
          deadline: Date.now() + 60_000,
          binding_ids: [value.binding_id],
          task_ids: [randomUUID()],
        },
      },
    },
  };
  let calls = 0;
  const loaded = { binding_sha256: value.binding_sha256, adapter: { inspect() {}, run() {} } };
  const adapterFactories = {
    'official-adapter': (input) => {
      calls++;
      assert.ok(Object.isFrozen(input));
      assert.ok(Object.isFrozen(input.manifest));
      return loaded;
    },
  };
  const filename = path.join(handle.directory, 'control.json');
  const read = (options = {}) => {
    fs.writeFileSync(filename, JSON.stringify(config));
    return loadControlConfiguration(filename, { adapterFactories, ...options });
  };
  return { handle, config, filename, read, loaded, adapterFactories, calls: () => calls };
}

test('loader preserves legacy configuration and constructs only registered lazy adapters', (t) => {
  const f = fixture(t);
  const loaded = f.read({ state: f.handle.directory });
  assert.equal(loaded.state, f.handle.directory);
  assert.equal(f.calls(), 1);
  assert.ok(Object.isFrozen(loaded.providerAuthorizations));
  delete f.config.provider_control;
  assert.deepEqual(f.read({ state: '/legacy/state' }), {
    workspaces: [f.handle.directory],
    bindings: {},
    port: 0,
    state: '/legacy/state',
  });
});

test('loader refuses state override, directory drift and replaced ledger before factory effects', (t) => {
  const f = fixture(t);
  assert.throws(() => f.read({ state: '/other' }), { code: 'CONTROL_PROVIDER_STATE_OVERRIDE' });
  const pinned = f.config.provider_control.state_identity.inode;
  f.config.provider_control.state_identity.inode = '0';
  assert.throws(() => f.read(), { code: 'CONTROL_PROVIDER_STATE_DRIFT' });
  f.config.provider_control.state_identity.inode = pinned;
  fs.renameSync(f.handle.filename, f.handle.filename + '.old');
  fs.copyFileSync(f.handle.filename + '.old', f.handle.filename);
  assert.throws(() => f.read(), { code: 'CONTROL_PROVIDER_STATE_DRIFT' });
  assert.equal(f.calls(), 0);
});

test('loader preserves temporary ledger activation gate', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.handle.directory, '.hseos-ledger-fixture.json'), '{}');
  assert.throws(() => f.read(), { code: 'EXECUTION_LEDGER_OPERATIONAL_MIGRATION_REQUIRES_APPROVAL' });
  assert.equal(f.calls(), 0);
});

test('loader validates all references and manifests before invoking any factory', (t) => {
  const f = fixture(t);
  assert.throws(() => f.read({ adapterFactories: {} }), { code: 'CONTROL_PROVIDER_ADAPTER_UNAVAILABLE' });
  const grant = Object.values(f.config.provider_control.authorizations)[0];
  grant.binding_ids = ['unknown'];
  assert.throws(() => f.read(), { code: 'CONTROL_PROVIDER_AUTHORIZATION_BINDING_UNKNOWN' });
  grant.binding_ids = ['binding:individual'];
  const entry = f.config.provider_control.bindings['binding:individual'];
  entry.manifest.binding_id = 'different';
  assert.throws(() => f.read(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  entry.manifest.schema_version = 2;
  assert.throws(() => f.read(), { code: 'CONTROL_PROVIDER_MANIFEST_INVALID' });
  assert.equal(f.calls(), 0);
});

test('loader checks observed digest and adapter interface, sanitizing factory exceptions', (t) => {
  const f = fixture(t);
  f.loaded.binding_sha256 = 'f'.repeat(64);
  assert.throws(() => f.read(), { code: 'CONTROL_PROVIDER_BINDING_DRIFT' });
  f.loaded.binding_sha256 = 'a'.repeat(64);
  delete f.loaded.adapter.run;
  assert.throws(() => f.read(), { code: 'CONTROL_PROVIDER_CONFIGURATION_INVALID' });
  for (const code of ['CONTROL_PROVIDER_BINDING_DRIFT', 'CONTROL_SECRET_TEXT', undefined]) {
    f.adapterFactories['official-adapter'] = () => {
      throw Object.assign(new Error('sensitive detail'), { code });
    };
    assert.throws(
      () => f.read(),
      (error) => !error.message.includes('sensitive') && !error.message.includes('SECRET'),
    );
  }
});

test('loader rechecks ledger identity after factory construction', (t) => {
  const f = fixture(t);
  f.adapterFactories['official-adapter'] = () => {
    fs.renameSync(f.handle.filename, f.handle.filename + '.old');
    fs.copyFileSync(f.handle.filename + '.old', f.handle.filename);
    return f.loaded;
  };
  assert.throws(() => f.read(), { code: 'CONTROL_PROVIDER_STATE_DRIFT' });
});

test('loader rejects malformed, oversized, symlink and hardlink configurations', (t) => {
  const f = fixture(t);
  f.read();
  const alias = path.join(f.handle.directory, 'alias.json');
  fs.symlinkSync(f.filename, alias);
  assert.throws(() => loadControlConfiguration(alias), { code: 'CONTROL_CONFIGURATION_INVALID' });
  fs.unlinkSync(alias);
  fs.linkSync(f.filename, alias);
  assert.throws(() => loadControlConfiguration(f.filename), { code: 'CONTROL_CONFIGURATION_INVALID' });
  fs.unlinkSync(alias);
  for (const value of ['{', '{}', ' '.repeat(1_048_577)]) {
    fs.writeFileSync(f.filename, value);
    assert.throws(() => loadControlConfiguration(f.filename), { code: 'CONTROL_CONFIGURATION_INVALID' });
  }
});
