'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const yaml = require('yaml');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const {
  parseExecutionPluginManifest,
  inspectExecutionPlugin,
  readExecutionPluginBundle,
  admitExecutionPlugin,
  assertExecutionPluginAdmission,
  resolveExecutionPlugins,
} = require('../tools/lib/execution-plugin-manifest');
const {
  validatePluginRegistryDocument,
  loadActivePluginManifests,
  writePluginRegistry,
  verifyActivePluginConformance,
} = require('../tools/cli/installers/lib/core/agent-core-compiler/sources/plugins-source');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => sha(canonicalize(value));
const limits = { timeout_ms: 1000, max_output_bytes: 4096, memory_max_bytes: 268_435_456, pids_max: 32 };
const manifest = () => ({
  schema_version: 1,
  id: 'external-tool',
  version: '1.0.0',
  kind: 'tool',
  compatibility: { contract_version: 1, node_majors: [22, 24] },
  entrypoint: 'entry.cjs',
  files: { 'entry.cjs': sha('module.exports = {};'), 'conformance.cjs': sha('') },
  capabilities: ['read-context'],
  limits,
  dependencies: [],
  conformance: ['conformance.cjs'],
});
const entry = (value) => ({ manifest: value, manifest_sha256: digest(value) });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-execution-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plugin = path.join(root, 'plugin');
  fs.mkdirSync(plugin);
  const value = manifest();
  fs.writeFileSync(path.join(plugin, 'entry.cjs'), 'module.exports = {};');
  fs.writeFileSync(path.join(plugin, 'conformance.cjs'), '');
  const save = () => fs.writeFileSync(path.join(plugin, 'execution.json'), JSON.stringify(value));
  save();
  const policy = () => ({
    id: value.id,
    version: value.version,
    kind: value.kind,
    manifest_sha256: digest(value),
    allowed_capabilities: ['read-context'],
    limits: { ...limits },
    node_major: Number(process.versions.node.split('.')[0]),
    contract_version: 1,
  });
  return { root, plugin, value, save, policy };
}
function rejects(fn, code) {
  assert.throws(fn, (error) => error.code === code);
}

test('inspection and dependency resolution read bytes without importing external entry or conformance code', (t) => {
  const f = fixture(t);
  const marker = path.join(f.root, 'effect');
  const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected');throw Error('imported');`;
  for (const name of ['entry.cjs', 'conformance.cjs']) {
    fs.writeFileSync(path.join(f.plugin, name), source);
    f.value.files[name] = sha(source);
  }
  f.save();
  const inspected = inspectExecutionPlugin(f.plugin);
  assert.deepEqual(inspected.manifest, f.value);
  assert.equal(inspected.manifest_sha256, digest(f.value));
  assert.equal(Object.isFrozen(inspected.manifest.limits), true);
  assert.equal(resolveExecutionPlugins([inspected], ['external-tool']).length, 1);
  const admitted = admitExecutionPlugin(f.plugin, f.policy());
  assert.equal(assertExecutionPluginAdmission(admitted).files.get('entry.cjs').toString(), source);
  assert.equal(fs.existsSync(marker), false);
});

test('admission is private, versioned and fixed to identity, kind, digest, compatibility, capabilities and ceilings', (t) => {
  const f = fixture(t);
  const admitted = admitExecutionPlugin(f.plugin, f.policy());
  rejects(() => assertExecutionPluginAdmission({ ...admitted }), 'PLUGIN_ADMISSION_REQUIRED');
  for (const patch of [{ id: 'unknown' }, { version: '2.0.0' }, { kind: 'context-source' }, { manifest_sha256: '0'.repeat(64) }])
    rejects(() => admitExecutionPlugin(f.plugin, { ...f.policy(), ...patch }), 'PLUGIN_IDENTITY_DENIED');
  rejects(() => admitExecutionPlugin(f.plugin, { ...f.policy(), node_major: 20 }), 'PLUGIN_INCOMPATIBLE');
  rejects(() => admitExecutionPlugin(f.plugin, { ...f.policy(), contract_version: 2 }), 'PLUGIN_POLICY_INVALID');
  rejects(() => admitExecutionPlugin(f.plugin, { ...f.policy(), allowed_capabilities: [] }), 'PLUGIN_AUTHORITY_DENIED');
  rejects(() => admitExecutionPlugin(f.plugin, { ...f.policy(), limits: { ...limits, timeout_ms: 1 } }), 'PLUGIN_LIMIT_DENIED');
  const different = admitExecutionPlugin(f.plugin, { ...f.policy(), node_major: admitted.node_major === 22 ? 24 : 22 });
  if (different.node_major !== admitted.node_major) rejects(() => assertExecutionPluginAdmission(different), 'PLUGIN_INCOMPATIBLE');
});

test('content and descriptor are rechecked after admission', (t) => {
  const f = fixture(t);
  const admitted = admitExecutionPlugin(f.plugin, f.policy());
  fs.writeFileSync(path.join(f.plugin, 'entry.cjs'), 'changed');
  rejects(() => assertExecutionPluginAdmission(admitted), 'PLUGIN_CONTENT_CHANGED');
  f.value.files['entry.cjs'] = sha('changed');
  f.save();
  rejects(() => assertExecutionPluginAdmission(admitted), 'PLUGIN_CONTENT_CHANGED');
});

test('manifest rejects unknown versions, extra fields, unbounded limits and ambiguous compatibility', () => {
  for (const value of [
    null,
    [],
    { ...manifest(), schema_version: 2 },
    { ...manifest(), execute: 'code' },
    { ...manifest(), version: 'latest' },
    { ...manifest(), version: 'v1.0.0' },
    { ...manifest(), version: '1.0.0-01' },
    { ...manifest(), compatibility: { contract_version: 1, node_majors: [23] } },
    { ...manifest(), compatibility: { contract_version: 1, node_majors: [22, 22] } },
    { ...manifest(), capabilities: ['read-context', 'read-context'] },
    { ...manifest(), limits: { ...limits, timeout_ms: Infinity } },
    { ...manifest(), dependencies: [{ id: 'test', version: '1.0.0', manifest_sha256: 'short' }] },
  ])
    rejects(() => parseExecutionPluginManifest(value), 'PLUGIN_MANIFEST_INVALID');
  assert.equal(parseExecutionPluginManifest({ ...manifest(), version: '1.0.0-beta.1+build.2' }).version, '1.0.0-beta.1+build.2');
});

test('manifest rejects traversal, absolute paths, duplicate dependencies and conflicting file ancestry', () => {
  for (const name of ['../entry.cjs', '/entry.cjs', 'a/../entry.cjs', String.raw`a\entry.cjs`, 'a//entry.cjs', 'a/./entry.cjs', 'a/'])
    rejects(() => parseExecutionPluginManifest({ ...manifest(), entrypoint: name }), 'PLUGIN_MANIFEST_INVALID');
  rejects(() => parseExecutionPluginManifest({ ...manifest(), files: {} }), 'PLUGIN_FILES_INVALID');
  rejects(
    () => parseExecutionPluginManifest({ ...manifest(), files: { ...manifest().files, 'execution.json': sha('') } }),
    'PLUGIN_FILES_INVALID',
  );
  rejects(() => parseExecutionPluginManifest({ ...manifest(), entrypoint: 'missing.cjs' }), 'PLUGIN_ENTRYPOINT_INVALID');
  rejects(() => parseExecutionPluginManifest({ ...manifest(), conformance: ['missing.cjs'] }), 'PLUGIN_CONFORMANCE_INVALID');
  const dep = { id: 'other', version: '1.0.0', manifest_sha256: sha('') };
  rejects(() => parseExecutionPluginManifest({ ...manifest(), dependencies: [dep, dep] }), 'PLUGIN_DEPENDENCY_INVALID');
  rejects(
    () => parseExecutionPluginManifest({ ...manifest(), dependencies: [{ ...dep, id: 'external-tool' }] }),
    'PLUGIN_DEPENDENCY_INVALID',
  );
  rejects(
    () => parseExecutionPluginManifest({ ...manifest(), files: { ...manifest().files, 'entry.cjs/child': sha('') } }),
    'PLUGIN_FILES_INVALID',
  );
});

test('file and directory symlinks, hardlinks, missing files and special files fail closed', (t) => {
  const f = fixture(t);
  const filename = path.join(f.plugin, 'entry.cjs');
  const outside = path.join(f.root, 'outside');
  fs.writeFileSync(outside, 'module.exports = {};');
  fs.unlinkSync(filename);
  fs.symlinkSync(outside, filename);
  rejects(() => readExecutionPluginBundle(f.plugin), 'PLUGIN_PATH_UNSAFE');
  fs.unlinkSync(filename);
  fs.linkSync(outside, filename);
  rejects(() => readExecutionPluginBundle(f.plugin), 'PLUGIN_CONTENT_LIMIT');
  fs.unlinkSync(filename);
  fs.mkdirSync(filename);
  rejects(() => readExecutionPluginBundle(f.plugin), 'PLUGIN_CONTENT_LIMIT');
  fs.rmdirSync(filename);
  rejects(() => readExecutionPluginBundle(f.plugin), 'PLUGIN_BUNDLE_INVALID');
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.plugin, alias);
  rejects(() => readExecutionPluginBundle(alias), 'PLUGIN_PATH_UNSAFE');
});

test('oversized or malformed manifest and content are bounded', (t) => {
  const f = fixture(t);
  const descriptor = path.join(f.plugin, 'execution.json');
  fs.writeFileSync(descriptor, 'x'.repeat(65_537));
  rejects(() => readExecutionPluginBundle(f.plugin), 'PLUGIN_CONTENT_LIMIT');
  fs.writeFileSync(descriptor, '{');
  rejects(() => inspectExecutionPlugin(f.plugin), 'PLUGIN_BUNDLE_INVALID');
  fs.writeFileSync(descriptor, Buffer.from([0xff]));
  rejects(() => inspectExecutionPlugin(f.plugin), 'PLUGIN_BUNDLE_INVALID');
  f.save();
  fs.writeFileSync(path.join(f.plugin, 'entry.cjs'), 'x'.repeat(1_048_577));
  rejects(() => inspectExecutionPlugin(f.plugin), 'PLUGIN_CONTENT_LIMIT');
});

test('dependency resolution pins transitively, orders predecessors and rejects missing, conflicting and duplicate choices', () => {
  const child = { ...manifest(), id: 'child' };
  const parent = { ...manifest(), dependencies: [{ id: 'child', version: child.version, manifest_sha256: digest(child) }] };
  const catalog = [entry(parent), entry(child)];
  assert.deepEqual(
    resolveExecutionPlugins(catalog, ['external-tool', 'child']).map((e) => e.manifest.id),
    ['child', 'external-tool'],
  );
  assert.deepEqual(resolveExecutionPlugins(catalog, []), []);
  rejects(() => resolveExecutionPlugins(catalog, ['missing']), 'PLUGIN_DEPENDENCY_MISSING');
  rejects(() => resolveExecutionPlugins(catalog, ['child', 'child']), 'PLUGIN_SELECTION_INVALID');
  rejects(() => resolveExecutionPlugins([entry(parent)], ['external-tool']), 'PLUGIN_DEPENDENCY_MISMATCH');
  rejects(
    () => resolveExecutionPlugins([entry(parent), entry({ ...child, version: '2.0.0' })], ['external-tool']),
    'PLUGIN_DEPENDENCY_MISMATCH',
  );
  rejects(() => resolveExecutionPlugins([entry(child), entry(child)], []), 'PLUGIN_CATALOG_INVALID');
  rejects(() => resolveExecutionPlugins([{ ...entry(child), manifest_sha256: sha('wrong') }], []), 'PLUGIN_CATALOG_INVALID');
});

test('catalog v3 retains v2 compilation metadata and never routes execution descriptors through host conformance', async (t) => {
  const f = fixture(t);
  const registry = yaml.parse(fs.readFileSync(path.join(__dirname, '../.enterprise/governance/plugins/registry.yaml'), 'utf8'));
  assert.equal(validatePluginRegistryDocument(registry), true);
  registry.version = registry.schema_version = '3.0';
  registry.plugins = [
    {
      id: f.value.id,
      version: f.value.version,
      status: 'active',
      description: 'External execution plugin',
      type: 'execution',
      execution: { manifest_sha256: digest(f.value) },
    },
  ];
  assert.equal(validatePluginRegistryDocument(registry), true);
  const destination = path.join(f.root, '.agents/plugins/definitions', f.value.id);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination);
  for (const name of fs.readdirSync(f.plugin)) fs.copyFileSync(path.join(f.plugin, name), path.join(destination, name));
  fs.writeFileSync(path.join(f.root, '.agents/plugins/registry.yaml'), yaml.stringify(registry));
  const entries = await writePluginRegistry(f.root);
  assert.equal(entries.schemaVersion, '3.0');
  assert.deepEqual(await loadActivePluginManifests(f.root, entries), []);
  await assert.rejects(verifyActivePluginConformance(f.root, [{ type: 'execution' }]), /isolated execution/);
  entries[0].execution.manifest_sha256 = sha('bad');
  await assert.rejects(loadActivePluginManifests(f.root, entries), /catalog pin/);
  registry.version = registry.schema_version = '2.0';
  assert.throws(() => validatePluginRegistryDocument(registry), /unknown field/);
  registry.version = registry.schema_version = '3.0';
  delete registry.plugins[0].type;
  assert.throws(() => validatePluginRegistryDocument(registry), /explicit plugin type/);
});

test('admission requires every pinned dependency to have a live admitted identity', (t) => {
  const f = fixture(t);
  const child = fixture(t);
  child.value.id = 'child';
  child.save();
  f.value.dependencies = [{ id: 'child', version: '1.0.0', manifest_sha256: digest(child.value) }];
  f.save();
  rejects(() => admitExecutionPlugin(f.plugin, f.policy()), 'PLUGIN_DEPENDENCY_UNRESOLVED');
  rejects(() => admitExecutionPlugin(f.plugin, f.policy(), [{}]), 'PLUGIN_DEPENDENCY_UNRESOLVED');
  const admittedChild = admitExecutionPlugin(child.plugin, child.policy());
  const admitted = admitExecutionPlugin(f.plugin, f.policy(), [admittedChild]);
  assert.equal(assertExecutionPluginAdmission(admitted).manifest.id, 'external-tool');
  child.value.capabilities = [];
  child.save();
  rejects(() => assertExecutionPluginAdmission(admitted), 'PLUGIN_CONTENT_CHANGED');
});

test('v3 compilation entries retain the existing manifests and unknown execution fields fail closed', async (t) => {
  const f = fixture(t);
  const source = path.join(__dirname, '../.enterprise/governance/plugins');
  const target = path.join(f.root, '.agents/plugins');
  await require('fs-extra').copy(source, target);
  const registryFile = path.join(target, 'registry.yaml');
  const registry = yaml.parse(fs.readFileSync(registryFile, 'utf8'));
  registry.version = registry.schema_version = '3.0';
  for (const item of registry.plugins) item.type = 'compilation';
  fs.writeFileSync(registryFile, yaml.stringify(registry));
  assert.equal(validatePluginRegistryDocument(registry), true);
  assert.deepEqual(await loadActivePluginManifests(f.root, await writePluginRegistry(f.root)), []);
  registry.plugins[0].execution = { manifest_sha256: '0'.repeat(64) };
  assert.throws(() => validatePluginRegistryDocument(registry), /cannot declare execution/);
  registry.plugins[0].type = 'execution';
  registry.plugins[0].execution.command = 'external';
  assert.throws(() => validatePluginRegistryDocument(registry), /unknown field/);
  delete registry.plugins[0].execution.command;
  registry.plugins[0].execution.manifest_sha256 = 'invalid';
  assert.throws(() => validatePluginRegistryDocument(registry), /pinned execution descriptor/);
});

test('capability identifiers consume the canonical kernel vocabulary without widening grants', (t) => {
  const f = fixture(t);
  f.value.capabilities = ['engineering.patch'];
  f.save();
  rejects(() => admitExecutionPlugin(f.plugin, f.policy()), 'PLUGIN_AUTHORITY_DENIED');
  const admitted = admitExecutionPlugin(f.plugin, { ...f.policy(), allowed_capabilities: ['engineering.patch'] });
  assert.equal(assertExecutionPluginAdmission(admitted).manifest.capabilities[0], 'engineering.patch');
});

test('shared dependency graphs verify each admitted node once per revalidation', (t) => {
  const leaf = fixture(t);
  leaf.value.id = 'leaf';
  leaf.save();
  const shared = admitExecutionPlugin(leaf.plugin, leaf.policy());
  const branches = [];
  for (const name of ['left', 'right']) {
    const f = fixture(t);
    f.value.id = name;
    f.value.dependencies = [{ id: 'leaf', version: '1.0.0', manifest_sha256: shared.manifest_sha256 }];
    f.save();
    branches.push(admitExecutionPlugin(f.plugin, f.policy(), [shared]));
  }
  const root = fixture(t);
  root.value.dependencies = branches.map((item) => ({ id: item.manifest.id, version: '1.0.0', manifest_sha256: item.manifest_sha256 }));
  root.save();
  const admitted = admitExecutionPlugin(root.plugin, root.policy(), branches);
  const read = fs.readSync;
  let leafReads = 0;
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    if (fs.readlinkSync(`/proc/self/fd/${fd}`) === path.join(leaf.plugin, 'execution.json')) leafReads++;
    return read(fd, ...args);
  });
  assertExecutionPluginAdmission(admitted);
  assert.equal(leafReads, 2, 'one bounded content read and one EOF read');
});
