'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const {
  pinExecutionPluginSelection: pin,
  restoreExecutionPluginSelection: restore,
  parseExecutionPluginSelection: parse,
} = require('../tools/lib/execution-plugin-selection');
const sha = (value) => createHash('sha256').update(value).digest('hex');
function declaration(t, { id = 'test-plugin', version = '1.0.0', dependencies = [], selections = [] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-selection-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = 'throw Error("external module must not load on the host");';
  const manifest = {
    schema_version: 1,
    id,
    version,
    kind: 'tool',
    compatibility: { contract_version: 1, node_majors: [22, 24] },
    entrypoint: 'entry.cjs',
    files: { 'entry.cjs': sha(source) },
    capabilities: ['external.read'],
    limits: { timeout_ms: 1000, max_output_bytes: 4096, memory_max_bytes: 268_435_456, pids_max: 32 },
    dependencies,
    conformance: ['entry.cjs'],
  };
  fs.writeFileSync(path.join(directory, 'entry.cjs'), source);
  fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(manifest));
  return {
    directory,
    policy: {
      id,
      version,
      kind: manifest.kind,
      manifest_sha256: sha(canonicalize(manifest)),
      allowed_capabilities: manifest.capabilities,
      limits: manifest.limits,
      contract_version: 1,
    },
    configuration: { name: 'external.read', output_schema: { type: 'object' } },
    dependencies: selections,
  };
}
const rehash = (value) => {
  const { selection_sha256: _old, ...body } = value;
  return { ...body, selection_sha256: sha(canonicalize(body)) };
};

test('selection and restore read metadata only; unselected declarations remain inert', (t) => {
  const catalog = { 'test:1': declaration(t), ignored: { directory: '/missing' } };
  Object.defineProperty(catalog, 'accessor', {
    get() {
      return assert.fail('unselected accessor evaluated');
    },
  });
  const result = pin(catalog, ['test:1']);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].admission.manifest.id, 'test-plugin');
  assert.deepEqual(restore(catalog, result.selection).selection, result.selection);
  const serialized = JSON.stringify(result.selection);
  assert.deepEqual(parse(JSON.parse(serialized)), result.selection);
  assert.ok(Object.isFrozen(result.entries[0].configuration.output_schema));
  assert.ok(!canonicalize(result.selection).includes(catalog['test:1'].directory));
  assert.throws(() => pin(catalog, ['accessor']), { code: 'PLUGIN_SELECTION_UNKNOWN' });
  assert.deepEqual(pin(catalog, []).selection.selected, []);
});

test('upgrade, rollback and offline relocation preserve the original selection', (t) => {
  const old = declaration(t),
    next = declaration(t, { version: '2.0.0' });
  const catalog = { 'test:1': old, 'test:2': next };
  const original = pin(catalog, ['test:1']).selection;
  assert.notEqual(pin(catalog, ['test:2']).selection.selection_sha256, original.selection_sha256);
  const relocated = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-relocated-'));
  t.after(() => fs.rmSync(relocated, { recursive: true, force: true }));
  for (const file of ['execution.json', 'entry.cjs']) fs.copyFileSync(path.join(old.directory, file), path.join(relocated, file));
  assert.deepEqual(restore({ 'test:1': { ...old, directory: relocated } }, original).selection, original);
  assert.throws(() => restore({ 'test:1': next }, original), { code: 'PLUGIN_SELECTION_DRIFT' });
  assert.deepEqual(restore(catalog, original).selection, original);
  assert.throws(() => pin(catalog, ['test:1', 'test:2']), { code: 'PLUGIN_SELECTION_CONFLICT' });
});

test('configuration, permissions and dependency pins cannot drift on restore', (t) => {
  const entry = declaration(t);
  const selected = pin({ test: entry }, ['test']).selection;
  for (const changed of [
    { ...entry, configuration: { name: 'other' } },
    { ...entry, policy: { ...entry.policy, allowed_capabilities: ['external.read', 'extra'] } },
  ])
    assert.throws(() => restore({ test: changed }, selected), { code: 'PLUGIN_SELECTION_DRIFT' });
  entry.configuration.output_schema.type = 'string';
  assert.throws(() => restore({ test: entry }, selected), { code: 'PLUGIN_SELECTION_DRIFT' });
  assert.equal(selected.entries[0].configuration_sha256.length, 64);
  fs.writeFileSync(path.join(entry.directory, 'entry.cjs'), 'changed');
  assert.throws(() => restore({ test: entry }, selected), { code: 'PLUGIN_CONTENT_CHANGED' });
});

test('dependency graph is admitted once in topological order with exact content identities', (t) => {
  const dependency = declaration(t, { id: 'dependency' });
  const { id, version, manifest_sha256 } = dependency.policy;
  const parent = declaration(t, { dependencies: [{ id, version, manifest_sha256 }], selections: ['dep'] });
  const result = pin({ dep: dependency, parent }, ['parent', 'dep']);
  assert.deepEqual(
    result.selection.entries.map((entry) => entry.selection_id),
    ['dep', 'parent'],
  );
  assert.equal(result.entries[1].admission.dependencies[0], result.entries[0].admission);
  assert.throws(() => pin({ dep: { ...dependency, dependencies: ['parent'] }, parent }, ['parent']), { code: 'PLUGIN_DEPENDENCY_CYCLE' });
  assert.throws(() => pin({ parent }, ['parent']), { code: 'PLUGIN_SELECTION_UNKNOWN' });
  assert.throws(() => pin({ dep: declaration(t, { id: 'dependency', version: '2.0.0' }), parent }, ['parent']), {
    code: 'PLUGIN_DEPENDENCY_UNRESOLVED',
  });
});

test('invalid, executable, oversized and platform-specific declarations fail before admission', (t) => {
  const entry = declaration(t);
  for (const catalog of [null, [], new Map()]) assert.throws(() => pin(catalog, []), { code: 'PLUGIN_CATALOG_INVALID' });
  for (const selected of [['test', 'test'], ['../test'], Array.from({ length: 129 }, () => 'test')]) {
    assert.throws(() => pin({ test: entry }, selected), { code: 'PLUGIN_SELECTION_INVALID' });
  }
  assert.throws(() => pin({}, ['unknown']), { code: 'PLUGIN_SELECTION_UNKNOWN' });
  for (const changed of [
    { ...entry, directory: 'relative' },
    {
      ...entry,
      configuration: {
        execute() {
          assert.fail('must not invoke');
        },
      },
    },
    { ...entry, unexpected: true },
  ])
    assert.throws(() => pin({ test: changed }, ['test']), { code: 'PLUGIN_CONFIGURATION_INVALID' });
  assert.throws(() => pin({ test: { ...entry, configuration: { large: 'x'.repeat(65_536) } } }, ['test']), {
    code: 'PLUGIN_CONFIGURATION_LIMIT',
  });
  assert.throws(() => pin({ test: { ...entry, policy: { ...entry.policy, node_major: 24 } } }, ['test']), {
    code: 'PLUGIN_POLICY_INVALID',
  });
});

test('durable pins reject tampering, extra unreachable entries, cycles and duplicate identities', (t) => {
  const selected = pin({ test: declaration(t) }, ['test']).selection;
  assert.throws(() => parse({ ...selected, schema_version: 2 }), { code: 'PLUGIN_SELECTION_INVALID' });
  assert.throws(() => parse({ ...selected, selected: [] }), { code: 'PLUGIN_SELECTION_DRIFT' });
  const entry = selected.entries[0];
  for (const body of [
    { ...selected, selected: ['missing'] },
    { ...selected, selected: [] },
    { ...selected, entries: [entry, entry] },
    { ...selected, selected: ['test', 'alias'], entries: [entry, { ...entry, selection_id: 'alias' }] },
    { ...selected, entries: [{ ...entry, dependencies: ['test'] }] },
  ])
    assert.throws(() => parse(rehash(body)), { code: 'PLUGIN_SELECTION_INVALID' });
});

test('transitive catalog expansion is bounded before traversing more than 128 declarations', (t) => {
  const entry = declaration(t);
  const catalog = Object.fromEntries(
    Array.from({ length: 129 }, (_, index) => [`p${index}`, { ...entry, dependencies: index < 128 ? [`p${index + 1}`] : [] }]),
  );
  assert.throws(() => pin(catalog, ['p0']), { code: 'PLUGIN_SELECTION_INVALID' });
});
