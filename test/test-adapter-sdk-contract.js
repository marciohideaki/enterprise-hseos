'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { AdapterBase, checkAdapterConformance, normalizeHookEvent, resolveAdapterOutputDir } = require('../packages/adapter-sdk');

class Minimal extends AdapterBase {
  static get id() {
    return 'minimal';
  }
}

test('the base class defaults are inert and report success without touching the output directory', async () => {
  const adapter = new Minimal();
  assert.equal(Minimal.version, '1.0');
  assert.deepEqual(Minimal.capabilities, []);
  assert.deepEqual(await adapter.validate({}, {}), { ok: true, warnings: [], errors: [] });
  assert.deepEqual(await adapter.verify('/nonexistent/output'), { ok: true, drift: [] });
  assert.deepEqual(await adapter.clean('/nonexistent/output'), { removed: [] });
  assert.equal(adapter.mapHookEvent('PreToolUse'), 'PreToolUse');
  assert.equal(adapter.mapToolName('Bash'), 'Bash');
  assert.equal(adapter.resolvePath('.claude/x', { any: true }), '.claude/x');
});

test('an adapter that does not override emit fails loudly and names the subclass', async () => {
  await assert.rejects(() => new Minimal().emit({}, '/out'), /AdapterBase: Minimal must override async emit\(sources, outputDir\)/);
});

test('the base class has no id of its own', () => {
  assert.throws(() => AdapterBase.id, /subclass must override static id getter/);
});

test('hook events fall back to the raw name and output directories are dot-prefixed under the root', () => {
  assert.equal(normalizeHookEvent('Stop', { Stop: 'session_end' }), 'session_end');
  assert.equal(normalizeHookEvent('Stop', { Other: 'x' }), 'Stop');
  assert.equal(normalizeHookEvent('Stop'), 'Stop');
  assert.equal(resolveAdapterOutputDir('/proj', 'goose'), path.join('/proj', '.goose'));
});

test('conformance accepts a complete adapter and reports nothing missing', () => {
  class Complete extends AdapterBase {
    static get id() {
      return 'complete';
    }
    static get capabilities() {
      return ['hooks'];
    }
  }
  assert.deepEqual(checkAdapterConformance(Complete), { ok: true, missing: [] });
});

test('conformance reports every getter that throws or returns the wrong type', () => {
  class Broken extends AdapterBase {
    static get version() {
      throw new Error('no version');
    }
    static get capabilities() {
      throw new Error('no capabilities');
    }
  }
  const report = checkAdapterConformance(Broken);
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ['static id (string)', 'static version (string)', 'static capabilities (array)']);

  class WrongTypes extends AdapterBase {
    static get id() {
      return 7;
    }
    static get version() {
      return 1;
    }
    static get capabilities() {
      return 'hooks';
    }
  }
  assert.deepEqual(checkAdapterConformance(WrongTypes).missing, [
    'static id (string)',
    'static version (string)',
    'static capabilities (array)',
  ]);
});

test('conformance reports instance methods that a class lacks', () => {
  function Bare() {}
  Bare.id = 'bare';
  Bare.version = '1.0';
  Bare.capabilities = [];
  const report = checkAdapterConformance(Bare);
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, [
    'instance method: validate',
    'instance method: emit',
    'instance method: verify',
    'instance method: clean',
    'instance method: mapHookEvent',
    'instance method: mapToolName',
    'instance method: resolvePath',
  ]);
});
