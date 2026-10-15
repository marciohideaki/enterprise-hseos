'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { MAX_BYTES, MAX_ENTRIES, packPlugin } = require('../tools/lib/environment-plugin-pack');

const ROOT = path.join(__dirname, '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/memory/plugin.json'), 'utf8'));

test('the memory pack is generated from the very same files the core ships (identical digests)', () => {
  const result = packPlugin({ repoRoot: ROOT, capability: 'memory' });
  const copied = result.entries.filter((entry) => entry.source);
  assert.deepEqual(copied.map((entry) => entry.source).sort(), [...manifest.core_files].sort());
  for (const entry of copied) assert.equal(entry.sha256, sha256(fs.readFileSync(path.join(ROOT, entry.source))), entry.source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-memory-parity-'));
  try {
    const written = packPlugin({ repoRoot: ROOT, capability: 'memory', outputDirectory: directory });
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

test('the memory pack stays inside 40 entries and 1 MB and carries no binary, pin or ledger', () => {
  const result = packPlugin({ repoRoot: ROOT, capability: 'memory' });
  assert.ok(result.entries.length <= MAX_ENTRIES, `${result.entries.length} entries`);
  assert.ok(result.unpacked_bytes <= MAX_BYTES && result.tarball.length <= MAX_BYTES);
  assert.ok(result.entries.every((entry) => !/\.(?:tgz|whl|node|so)$|node_modules|toolchain\/|ledger/.test(entry.path)));
  assert.equal(manifest.toolchain_pins, undefined, 'memory needs no toolchain pin');
  assert.equal(manifest.profile, 'P1');
  assert.deepEqual(manifest.load, { strategy: 'lazy', entry: 'packages/agent-memory/index.js' });
});

test('the plugin ships no ledger of its own: the core files never open a database', () => {
  for (const file of manifest.core_files.filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, /better-sqlite3|node:sqlite|new Database\(/, file);
  }
});

test('the governance definition and registry entry exist for the plugin', () => {
  const definition = path.join(ROOT, '.enterprise/governance/plugins/definitions', manifest.id);
  for (const file of ['plugin.yaml', 'README.md', 'skills/memory/SKILL.md']) assert.ok(fs.existsSync(path.join(definition, file)), file);
  const registry = fs.readFileSync(path.join(ROOT, '.enterprise/governance/plugins/registry.yaml'), 'utf8');
  assert.match(registry, new RegExp(`- id: ${manifest.id}\\n\\s+version: "${manifest.version}"`));
  assert.match(fs.readFileSync(path.join(definition, 'plugin.yaml'), 'utf8'), new RegExp(`^id: ${manifest.id}$`, 'm'));
});
