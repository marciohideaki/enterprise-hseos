'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const yaml = require('yaml');
const pluginCommand = require('../tools/cli/commands/plugin');
const prompts = require('../tools/cli/lib/prompts');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const { readExecutionPluginBundle } = require('../tools/lib/execution-plugin-manifest');
const { pinExecutionPluginSelection, restoreExecutionPluginSelection } = require('../tools/lib/execution-plugin-selection');

const sha = (value) => createHash('sha256').update(value).digest('hex');
const limits = { timeout_ms: 1000, max_output_bytes: 4096, memory_max_bytes: 268_435_456, pids_max: 32 };
async function quiet(operation) {
  const original = prompts.log;
  const messages = [];
  prompts.log = Object.fromEntries(
    ['success', 'warn', 'error', 'message'].map((level) => [level, async (value) => messages.push({ level, value })]),
  );
  try {
    await operation();
    return messages;
  } finally {
    prompts.log = original;
  }
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-execution-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = yaml.parse(fs.readFileSync(path.join(__dirname, '..', '.agents', 'plugins', 'registry.yaml'), 'utf8'));
  registry.version = '3.0';
  registry.schema_version = '3.0';
  registry.plugins = [];
  const publish = () => {
    const directory = path.join(root, '.agents', 'plugins');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'registry.yaml'), yaml.stringify(registry));
  };
  const add = ({ id = 'external-tool', version = '1.0.0', dependencies = [], marker = path.join(root, 'host-effect') } = {}) => {
    const directory = path.join(root, '.agents', 'plugins', 'definitions', id);
    fs.mkdirSync(directory, { recursive: true });
    const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`;
    const manifest = {
      schema_version: 1,
      id,
      version,
      kind: 'tool',
      compatibility: { contract_version: 1, node_majors: [22, 24] },
      entrypoint: 'entry.cjs',
      files: { 'entry.cjs': sha(code) },
      capabilities: ['external.read'],
      limits,
      dependencies,
      conformance: ['entry.cjs'],
    };
    fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(directory, 'entry.cjs'), code);
    const manifest_sha256 = sha(canonicalize(manifest));
    registry.plugins = registry.plugins.filter((item) => item.id !== id);
    registry.plugins.push({
      id,
      version,
      status: 'active',
      type: 'execution',
      description: 'External execution plugin for installation',
      execution: { manifest_sha256 },
    });
    publish();
    return { directory, manifest, manifest_sha256, marker };
  };
  const install = async (id = 'external-tool') => {
    const original = prompts.log;
    prompts.log = { ...original, success: async () => {} };
    try {
      await pluginCommand.action('install', id, { directory: root });
    } finally {
      prompts.log = original;
    }
  };
  return { root, registry, add, install, publish };
}

test('offline installation outside checkout pins bytes without importing plugin code', async (t) => {
  const f = fixture(t);
  const dep = f.add({ id: 'external-dependency' });
  const plugin = f.add({ dependencies: [{ id: 'external-dependency', version: '1.0.0', manifest_sha256: dep.manifest_sha256 }] });
  const unselected = f.add({ id: 'unselected' });
  fs.writeFileSync(path.join(unselected.directory, 'entry.cjs'), 'invalid unselected bytes');
  await f.install();
  const store = path.join(f.root, '.hseos', 'plugins', 'store');
  const installed = path.join(store, plugin.manifest_sha256);
  assert.equal(readExecutionPluginBundle(installed).manifest_sha256, plugin.manifest_sha256);
  assert.equal(readExecutionPluginBundle(path.join(store, dep.manifest_sha256)).manifest_sha256, dep.manifest_sha256);
  assert.equal(fs.existsSync(plugin.marker), false);
  assert.equal(fs.existsSync(dep.marker), false);
  assert.equal(fs.existsSync(path.join(store, unselected.manifest_sha256)), false);
  assert.deepEqual(fs.readdirSync(store).sort(), [dep.manifest_sha256, plugin.manifest_sha256].sort());
  await f.install();
  const cli = spawnSync(process.execPath, ['tools/cli/hseos-cli.js', 'plugin', 'install', 'external-tool', '--directory', f.root], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(fs.readdirSync(store).sort(), [dep.manifest_sha256, plugin.manifest_sha256].sort());
});

test('upgrade and rollback retain old bytes and the original execution selection', async (t) => {
  const f = fixture(t);
  const first = f.add();
  await f.install();
  const store = path.join(f.root, '.hseos', 'plugins', 'store');
  const declaration = (version, digest) => ({
    directory: path.join(store, digest),
    policy: {
      id: 'external-tool',
      version,
      kind: 'tool',
      manifest_sha256: digest,
      allowed_capabilities: ['external.read'],
      limits,
      contract_version: 1,
    },
    configuration: { name: 'external.read' },
    dependencies: [],
  });
  const selected = pinExecutionPluginSelection({ original: declaration('1.0.0', first.manifest_sha256) }, ['original']).selection;
  const next = f.add({ version: '2.0.0' });
  await f.install();
  const doctor = await quiet(() => pluginCommand.action('doctor', undefined, { directory: f.root }));
  assert.ok(doctor.some(({ value }) => value.includes('installed bytes verified')));
  assert.notEqual(next.manifest_sha256, first.manifest_sha256);
  assert.equal(readExecutionPluginBundle(path.join(store, first.manifest_sha256)).manifest.version, '1.0.0');
  assert.equal(readExecutionPluginBundle(path.join(store, next.manifest_sha256)).manifest.version, '2.0.0');
  assert.deepEqual(
    restoreExecutionPluginSelection({ original: declaration('1.0.0', first.manifest_sha256) }, selected).selection,
    selected,
  );
  assert.throws(() => restoreExecutionPluginSelection({ original: declaration('2.0.0', next.manifest_sha256) }, selected), {
    code: 'PLUGIN_SELECTION_DRIFT',
  });
  f.add({ version: '1.0.0' });
  await f.install();
  assert.deepEqual(fs.readdirSync(store).sort(), [first.manifest_sha256, next.manifest_sha256].sort());
  await quiet(() => pluginCommand.action('remove', 'external-tool', { directory: f.root }));
  assert.equal(fs.existsSync(path.join(store, first.manifest_sha256)), true);
});

test('catalog mismatch, source symlink and corrupt installed bytes fail closed', async (t) => {
  const f = fixture(t);
  const plugin = f.add();
  f.registry.plugins[0].execution.manifest_sha256 = '0'.repeat(64);
  f.publish();
  await assert.rejects(f.install(), /catalog pin/);
  assert.equal(fs.existsSync(path.join(f.root, '.hseos', 'plugins', 'store')), false);
  f.registry.plugins[0].execution.manifest_sha256 = plugin.manifest_sha256;
  f.publish();
  const source = path.join(plugin.directory, 'entry.cjs');
  fs.renameSync(source, `${source}.original`);
  fs.symlinkSync(`${source}.original`, source);
  await assert.rejects(f.install(), { code: 'PLUGIN_PATH_UNSAFE' });
  fs.rmSync(source);
  fs.renameSync(`${source}.original`, source);
  await f.install();
  const installed = path.join(f.root, '.hseos', 'plugins', 'store', plugin.manifest_sha256, 'entry.cjs');
  fs.chmodSync(installed, 0o600);
  fs.writeFileSync(installed, 'changed');
  await assert.rejects(f.install(), { code: 'PLUGIN_CONTENT_CHANGED' });
  await assert.rejects(
    quiet(() => pluginCommand.action('doctor', undefined, { directory: f.root })),
    /1 plugin\(s\) failed/,
  );
});

test('list reports only catalog data and missing registry without loading a bundle', async (t) => {
  const f = fixture(t);
  const absent = await quiet(() => pluginCommand.action('list', undefined, { directory: f.root }));
  assert.ok(absent.some(({ value }) => value.includes('No plugins declared')));
  f.add();
  const listed = await quiet(() => pluginCommand.action('list', undefined, { directory: f.root }));
  assert.ok(listed.some(({ value }) => value.includes('external-tool@1.0.0')));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-empty-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  await quiet(() => pluginCommand.action('doctor', undefined, { directory: empty }));
  assert.equal(fs.existsSync(path.join(f.root, 'host-effect')), false);
});

test('CLI refuses missing, inactive and unsafe plugin identities before creating the store', async (t) => {
  const f = fixture(t);
  await assert.rejects(pluginCommand.action('install', undefined, { directory: f.root }), /requires a plugin id/);
  await assert.rejects(pluginCommand.action('remove', undefined, { directory: f.root }), /requires a plugin id/);
  await assert.rejects(pluginCommand.action('install', '../escape', { directory: f.root }), /Invalid plugin id/);
  await assert.rejects(pluginCommand.action('unknown', 'external-tool', { directory: f.root }), /Unsupported plugin action/);
  await assert.rejects(pluginCommand.action('install', 'external-tool', { directory: f.root }), /No plugin registry found/);
  f.add();
  await assert.rejects(pluginCommand.action('install', 'missing', { directory: f.root }), /Plugin not found/);
  f.registry.plugins[0].status = 'disabled';
  f.publish();
  await assert.rejects(pluginCommand.action('install', 'external-tool', { directory: f.root }), /not installable/);
  fs.rmSync(path.join(f.root, '.agents', 'plugins', 'definitions', 'external-tool'), { recursive: true });
  const doctor = await quiet(() => pluginCommand.action('doctor', undefined, { directory: f.root }));
  assert.ok(doctor.some(({ value }) => value.includes('behavior checks skipped')));
  const listed = await quiet(() => pluginCommand.action('list', undefined, { directory: f.root }));
  assert.ok(listed.some(({ value }) => value.includes('○ external-tool')));
  assert.equal(fs.existsSync(path.join(f.root, '.hseos')), false);
});

test('project and store symlink boundaries fail before writing plugin bytes', async (t) => {
  const f = fixture(t);
  f.add();
  const alias = `${f.root}-alias`;
  fs.symlinkSync(f.root, alias);
  t.after(() => fs.rmSync(alias, { force: true }));
  await assert.rejects(pluginCommand.action('install', 'external-tool', { directory: alias }), /root must not be a symlink/);
  const pluginRoot = path.join(f.root, '.hseos', 'plugins');
  fs.mkdirSync(path.join(f.root, '.hseos'));
  fs.symlinkSync(os.tmpdir(), pluginRoot);
  await assert.rejects(f.install(), /store path is unsafe/);
});

test('concurrent store symlink swap cannot redirect installation outside the project', async (t) => {
  const f = fixture(t);
  const plugin = f.add();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const original = fs.mkdtempSync;
  let switched = false;
  fs.mkdtempSync = (...args) => {
    if (!switched && String(args[0]).startsWith('/proc/self/fd/')) {
      switched = true;
      const parent = path.join(f.root, '.hseos', 'plugins');
      fs.renameSync(parent, `${parent}.moved`);
      fs.symlinkSync(outside, parent);
    }
    return original(...args);
  };
  try {
    await assert.rejects(f.install());
  } finally {
    fs.mkdtempSync = original;
  }
  assert.equal(switched, true);
  assert.equal(fs.existsSync(path.join(outside, 'store', plugin.manifest_sha256)), false);
});

test('help and fresh command import leave an unselected execution plugin inert', (t) => {
  const f = fixture(t);
  const plugin = f.add();
  const imported = spawnSync(process.execPath, ['-e', "require('./tools/cli/commands/plugin')"], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(imported.status, 0, imported.stderr);
  const program = spawnSync(process.execPath, ['tools/cli/hseos-cli.js', 'plugin', '--help'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(program.status, 0, program.stderr);
  assert.equal(fs.existsSync(plugin.marker), false);
});
