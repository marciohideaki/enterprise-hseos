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
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/browser/plugin.json'), 'utf8'));

test('the browser pack is generated from the very same files the core ships (identical digests)', () => {
  const result = packPlugin({ repoRoot: ROOT, capability: 'browser' });
  const copied = result.entries.filter((entry) => entry.source);
  assert.deepEqual(copied.map((entry) => entry.source).sort(), [...manifest.core_files].sort());
  for (const entry of copied) assert.equal(entry.sha256, sha256(fs.readFileSync(path.join(ROOT, entry.source))), entry.source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-browser-parity-'));
  try {
    const written = packPlugin({ repoRoot: ROOT, capability: 'browser', outputDirectory: directory });
    assert.equal(written.digest, result.digest, 'packing is reproducible');
    assert.equal(fs.readFileSync(path.join(directory, `${written.filename}.sha256`), 'utf8').split(' ')[0], written.digest);
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

test('the browser pack stays inside 40 entries and 1 MB and carries no binary or pin', () => {
  const result = packPlugin({ repoRoot: ROOT, capability: 'browser' });
  assert.ok(result.entries.length <= MAX_ENTRIES, `${result.entries.length} entries`);
  assert.ok(result.unpacked_bytes <= MAX_BYTES && result.tarball.length <= MAX_BYTES);
  assert.ok(result.entries.every((entry) => !/\.(?:tgz|whl|node|so|zip)$|node_modules|toolchain\//.test(entry.path)));
  assert.deepEqual(
    [...manifest.toolchain_pins].sort(),
    ['chrome-headless-shell', 'playwright-core'],
    'the manifest names the pins as data only',
  );
  const claimed = fs
    .readdirSync(path.join(ROOT, 'plugins'))
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', name, 'plugin.json'), 'utf8')).toolchain_pins)
    .sort();
  assert.deepEqual(claimed, Object.keys(PINS).sort(), 'every pin belongs to exactly one capability');
  assert.equal(manifest.profile, 'P2', 'the browser needs the brokered network profile');
});

test('the browser pack adds only the browser files to the shared environment entry points', () => {
  const lsp = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/lsp/plugin.json'), 'utf8'));
  const added = manifest.core_files.filter((file) => !lsp.core_files.includes(file)).sort();
  assert.deepEqual(added, [
    'packages/agent-environment/browser-contract.js',
    'packages/agent-environment/browser-host.js',
    'packages/agent-environment/browser.js',
  ]);
  assert.deepEqual(
    lsp.core_files.filter((file) => !manifest.core_files.includes(file)),
    ['packages/agent-environment/lsp-host.js'],
  );
  const mirror = (root) => fs.readFileSync(path.join(ROOT, root, 'hseos-plugin-browser/plugin.yaml'), 'utf8');
  assert.equal(
    mirror('.enterprise/governance/plugins/definitions'),
    mirror('.agents/plugins/definitions'),
    'the compiled mirror equals the canonical definition',
  );
});

test('the capability loads lazily: requiring the package never loads the pin installer or the browser', () => {
  const entry = JSON.stringify(path.join(ROOT, 'packages/agent-environment'));
  const loaded = (code) => execFileSync(process.execPath, ['-e', code]).toString().trim();
  assert.equal(
    loaded(
      `require(${entry}); console.log(Object.keys(require.cache).some((file) => /environment-toolchain-pins|browser|playwright/.test(file)));`,
    ),
    'false',
  );
  assert.equal(
    loaded(
      `const environment = require(${entry}); environment.loadPins(); console.log(Object.keys(require.cache).some((file) => file.includes('environment-toolchain-pins')));`,
    ),
    'true',
  );
  assert.equal(
    loaded(
      `const environment = require(${entry}); void environment.createBrowserService; console.log(Object.keys(require.cache).some((file) => /playwright/.test(file)));`,
    ),
    'false',
  );
  assert.deepEqual(manifest.load, { strategy: 'lazy', entry: 'packages/agent-environment/index.js' });
});

// The environment pack is admitted through the repository's own pinned-hash admission (execution-plugin-manifest):
// an execution bundle is generated from the very files of the pack, its manifest hash is pinned in a grant, and
// admission refuses any divergence. There is no separate installer for the environment tarball itself, so the
// tarball digest is pinned and compared here and nowhere else.
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const { admitExecutionPlugin, readExecutionPluginBundle } = require('../tools/lib/execution-plugin-manifest');

const LIMITS = { timeout_ms: 75_000, max_output_bytes: 65_536, memory_max_bytes: 2_147_483_648, pids_max: 256 };
const ARTIFACTS = {
  max_files: 32,
  max_file_bytes: 5_242_880,
  max_total_bytes: 16_777_216,
  media_types: ['application/json', 'image/png'],
  shm_bytes: 268_435_456,
};

function executionBundle() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-browser-admission-'));
  const files = {};
  for (const relative of manifest.core_files) {
    const bytes = fs.readFileSync(path.join(ROOT, relative));
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.writeFileSync(path.join(directory, relative), bytes);
    files[relative] = sha256(bytes);
  }
  const document = {
    schema_version: 1,
    id: manifest.id,
    version: manifest.version,
    kind: 'tool',
    compatibility: { contract_version: 1, node_majors: [22, 24] },
    entrypoint: manifest.load.entry,
    files,
    capabilities: ['environment.browser'],
    limits: LIMITS,
    isolation_profile: manifest.profile,
    artifacts: ARTIFACTS,
    dependencies: [],
    conformance: ['packages/agent-environment/browser.js'],
  };
  fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(document));
  return { directory, document, pinned: sha256(canonicalize(document)) };
}

const grant = (pinned, overrides = {}) => ({
  id: manifest.id,
  version: manifest.version,
  manifest_sha256: pinned,
  kind: 'tool',
  allowed_capabilities: ['environment.browser'],
  limits: LIMITS,
  isolation_profile: 'P2',
  artifacts: ARTIFACTS,
  node_major: 24,
  contract_version: 1,
  ...overrides,
});

test('the browser pack is admitted by its pinned hash and refused on any divergence', () => {
  const { directory, pinned } = executionBundle();
  try {
    const admission = admitExecutionPlugin(directory, grant(pinned));
    assert.equal(admission.manifest_sha256, pinned);
    assert.equal(admission.isolation_profile, 'P2', 'the admitted profile is the one the plugin asks for');
    // A different pinned hash is a different plugin.
    assert.throws(
      () => admitExecutionPlugin(directory, grant('0'.repeat(64))),
      (error) => error.code === 'PLUGIN_IDENTITY_DENIED',
    );
    // P2 is opt-in per grant: a grant that stops at P1 refuses the browser.
    assert.throws(
      () => admitExecutionPlugin(directory, grant(pinned, { isolation_profile: 'P1' })),
      (error) => error.code === 'PLUGIN_PROFILE_DENIED',
    );
    // Content that no longer matches its declared digest never reads as a bundle.
    const target = path.join(directory, 'packages/agent-environment/browser.js');
    fs.appendFileSync(target, '\n// tampered\n');
    assert.throws(
      () => readExecutionPluginBundle(directory),
      (error) => error.code === 'PLUGIN_CONTENT_CHANGED',
    );
    assert.throws(
      () => admitExecutionPlugin(directory, grant(pinned)),
      (error) => error.code === 'PLUGIN_CONTENT_CHANGED',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the pack tarball digest equals its pinned hash; a divergent tarball does not', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-browser-tarball-'));
  try {
    const written = packPlugin({ repoRoot: ROOT, capability: 'browser', outputDirectory: directory });
    const pinned = fs.readFileSync(path.join(directory, `${written.filename}.sha256`), 'utf8').split(' ')[0];
    const admitted = (bytes) => sha256(bytes) === pinned;
    const tarball = fs.readFileSync(path.join(directory, written.filename));
    assert.equal(admitted(tarball), true);
    assert.equal(admitted(Buffer.concat([tarball, Buffer.from([0])])), false, 'one extra byte is a different artifact');
    assert.equal(pinned, written.digest);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
