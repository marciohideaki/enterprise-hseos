'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { MAX_BYTES, MAX_ENTRIES, packPlugin } = require('../tools/lib/environment-plugin-pack');
const { PINS } = require('../tools/lib/environment-toolchain-pins');

const ROOT = path.join(__dirname, '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/lsp/plugin.json'), 'utf8'));

test('the lsp pack is generated from the very same files the core ships (identical digests)', () => {
  const result = packPlugin({ repoRoot: ROOT, capability: 'lsp' });
  const copied = result.entries.filter((entry) => entry.source);
  assert.deepEqual(copied.map((entry) => entry.source).sort(), [...manifest.core_files].sort());
  for (const entry of copied) assert.equal(entry.sha256, sha256(fs.readFileSync(path.join(ROOT, entry.source))), entry.source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-lsp-parity-'));
  try {
    const written = packPlugin({ repoRoot: ROOT, capability: 'lsp', outputDirectory: directory });
    assert.equal(written.digest, result.digest, 'packing is reproducible');
    for (const entry of copied) {
      const extracted = execFileSync('tar', ['-xzOf', path.join(directory, written.filename), entry.path]);
      assert.equal(
        sha256(extracted),
        sha256(fs.readFileSync(path.join(ROOT, entry.source))),
        `${entry.path} in the tarball equals the core file`,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the lsp pack stays inside 40 entries and 1 MB and carries no binary or pin', () => {
  const result = packPlugin({ repoRoot: ROOT, capability: 'lsp' });
  assert.ok(result.entries.length <= MAX_ENTRIES, `${result.entries.length} entries`);
  assert.ok(result.unpacked_bytes <= MAX_BYTES && result.tarball.length <= MAX_BYTES);
  assert.ok(result.entries.every((entry) => !/\.(?:tgz|whl|node|so)$|node_modules|toolchain\//.test(entry.path)));
  assert.deepEqual(
    [...manifest.toolchain_pins].sort(),
    ['pyright', 'typescript', 'typescript-language-server'],
    'the manifest names the pins as data only',
  );
  // Every plugin manifest on disk claims pins: together they cover the whole registry and each pin appears exactly once.
  const claimed = fs
    .readdirSync(path.join(ROOT, 'plugins'))
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', name, 'plugin.json'), 'utf8')).toolchain_pins ?? [])
    .sort();
  assert.deepEqual(claimed, Object.keys(PINS).sort(), 'every pin belongs to exactly one capability');
  assert.equal(manifest.profile, 'P1');
});

test('the capability loads lazily: requiring the package never loads the pin installer', () => {
  const probe = `require(${JSON.stringify(path.join(ROOT, 'packages/agent-environment'))});
console.log(Object.keys(require.cache).some((file) => file.includes('environment-toolchain-pins')));`;
  assert.equal(execFileSync(process.execPath, ['-e', probe]).toString().trim(), 'false');
  const lazy = `const environment = require(${JSON.stringify(path.join(ROOT, 'packages/agent-environment'))});
environment.loadPins();
console.log(Object.keys(require.cache).some((file) => file.includes('environment-toolchain-pins')));`;
  assert.equal(execFileSync(process.execPath, ['-e', lazy]).toString().trim(), 'true');
  assert.deepEqual(manifest.load, { strategy: 'lazy', entry: 'packages/agent-environment/index.js' });
});

test('the governance definition and registry entry exist for the plugin', () => {
  const definition = path.join(ROOT, '.enterprise/governance/plugins/definitions', manifest.id);
  for (const file of ['plugin.yaml', 'README.md', 'skills/lsp/SKILL.md']) assert.ok(fs.existsSync(path.join(definition, file)), file);
  const registry = fs.readFileSync(path.join(ROOT, '.enterprise/governance/plugins/registry.yaml'), 'utf8');
  assert.match(registry, new RegExp(`- id: ${manifest.id}\\n\\s+version: "${manifest.version}"`));
  assert.match(fs.readFileSync(path.join(definition, 'plugin.yaml'), 'utf8'), new RegExp(`^id: ${manifest.id}$`, 'm'));
});
