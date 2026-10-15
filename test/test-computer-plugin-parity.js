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
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const manifest = JSON.parse(read('plugins/computer-use/plugin.json'));
const definition = '.enterprise/governance/plugins/definitions/hseos-plugin-computer-use';
const COMPUTER_FILES = [
  'packages/agent-environment/computer-contract.js',
  'packages/agent-environment/computer-host.js',
  'packages/agent-environment/computer.js',
];

test('the computer-use pack is generated from the very same files the core ships (identical digests)', () => {
  const result = packPlugin({ repoRoot: ROOT, capability: 'computer-use' });
  const copied = result.entries.filter((entry) => entry.source);
  assert.deepEqual(copied.map((entry) => entry.source).sort(), [...manifest.core_files].sort());
  for (const entry of copied) assert.equal(entry.sha256, sha256(fs.readFileSync(path.join(ROOT, entry.source))), entry.source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-computer-parity-'));
  try {
    const written = packPlugin({ repoRoot: ROOT, capability: 'computer-use', outputDirectory: directory });
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

test('the computer-use pack stays inside 40 entries and 1 MB, carries no binary or pin, and is Linux only', () => {
  const result = packPlugin({ repoRoot: ROOT, capability: 'computer-use' });
  assert.ok(result.entries.length <= MAX_ENTRIES, `${result.entries.length} entries`);
  assert.ok(result.unpacked_bytes <= MAX_BYTES && result.tarball.length <= MAX_BYTES);
  assert.ok(result.entries.every((entry) => !/\.(?:tgz|whl|node|so|zip|deb)$|node_modules|toolchain\//.test(entry.path)));
  assert.deepEqual(manifest.toolchain_pins, ['xdotool'], 'the manifest names the pin as data only');
  assert.equal(manifest.platform, 'linux');
  assert.equal(manifest.profile, 'P1', 'the display server needs local sockets, nothing more');
  assert.equal(manifest.kind ?? 'tool', 'tool');
  const claimed = fs
    .readdirSync(path.join(ROOT, 'plugins'))
    .flatMap((name) => JSON.parse(read(`plugins/${name}/plugin.json`)).toolchain_pins ?? [])
    .sort();
  assert.deepEqual(claimed, Object.keys(PINS).sort(), 'every pin belongs to exactly one capability');
});

test('the approval gate and the policy lattice stay in the core: the pack carries only the capability and the pin installer', () => {
  const lsp = JSON.parse(read('plugins/lsp/plugin.json'));
  assert.deepEqual(manifest.core_files.filter((file) => !lsp.core_files.includes(file)).sort(), COMPUTER_FILES);
  assert.deepEqual(
    lsp.core_files.filter((file) => !manifest.core_files.includes(file)),
    ['packages/agent-environment/lsp-host.js'],
  );
  assert.equal(
    manifest.core_files.some((file) => /environment-approval|agent-policy-lattice/.test(file)),
    false,
  );
  assert.match(read('packages/agent-environment/computer.js'), /approvals\.consume\(/, 'the pack code calls the host-supplied gate');
  assert.doesNotMatch(read('packages/agent-environment/computer.js'), /require\('[^']*(?:environment-approval|agent-policy-lattice)/);
});

test('the governance surface agrees with the manifest and the compiled mirror equals the canonical definition', () => {
  for (const file of ['plugin.yaml', 'README.md', 'skills/computer-use/SKILL.md'])
    assert.ok(fs.existsSync(path.join(ROOT, definition, file)), file);
  assert.match(read(`${definition}/plugin.yaml`), new RegExp(`^id: ${manifest.id}$`, 'm'));
  assert.match(read(`${definition}/plugin.yaml`), /^version: "0\.1\.0"$/m);
  for (const registry of ['.enterprise/governance/plugins/registry.yaml', '.agents/plugins/registry.yaml']) {
    assert.match(
      read(registry),
      new RegExp(`- id: ${manifest.id}\\n\\s+version: "${manifest.version}"\\n\\s+status: scaffolded`),
      registry,
    );
  }
  const skill = read(`${definition}/skills/computer-use/SKILL.md`);
  assert.match(skill, /^plugin: hseos-plugin-computer-use$/m);
  assert.match(skill, /ENV_COMPUTER_APPROVAL_NOT_APPLICABLE/);
  assert.match(skill, /untrusted/);
  for (const file of ['plugin.yaml', 'README.md', 'skills/computer-use/SKILL.md']) {
    assert.equal(read(`${definition}/${file}`), read(`.agents/plugins/definitions/hseos-plugin-computer-use/${file}`), `${file} mirror`);
  }
});

test('core surface: no new npm dependency, files registered for the kernel suite and coverage, CI installs the binaries and the pin', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(
    Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }).some((name) =>
      /xdotool|x11|xvfb|robotjs|nut-js/.test(name),
    ),
    false,
  );
  for (const file of ['test/test-environment-computer.js', 'test/test-computer-plugin-parity.js']) {
    assert.ok(pkg.scripts['test:kernel'].includes(file), `${file} is part of test:kernel`);
  }
  const coverage = JSON.parse(read('.c8-kernel.json'));
  for (const file of [...COMPUTER_FILES, 'tools/cli/lib/environment-approval.js']) {
    assert.ok(coverage.include.includes(file), `${file} is in the kernel coverage`);
  }
  assert.equal(coverage['per-file'], true);
  assert.equal(coverage.lines, 90);
  assert.equal(coverage.branches, 80);
  for (const file of manifest.core_files) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
  const ci = read('.github/workflows/ci.yaml');
  assert.match(ci, /apt-get install -y -qq bubblewrap xdotool xvfb x11-apps x11-utils/);
  const provision = read('.github/scripts/provision-toolchain-cache.mjs');
  assert.match(provision, /download\(variant\.source_url, variant, place\)/);
  assert.doesNotMatch(provision, /apt-get|execFileSync/, 'the provisioner downloads the pinned archive URLs and runs no package manager');
});

test('toolchain surface: the injector pin is data with its licence read in the artifact, and nothing downloads at run time', () => {
  const pin = PINS.xdotool;
  assert.equal(pin.variants.length, 2, 'one variant per distro: the dev host and the CI runner');
  for (const variant of pin.variants) {
    assert.match(variant.sha256, /^[0-9a-f]{64}$/);
    assert.match(variant.license_sha256, /^[0-9a-f]{64}$/, 'each variant pins the digest of its licence text');
    assert.match(variant.artifact, /^apt\/xdotool_.*_amd64\.deb$/);
    assert.match(variant.source_url, /^https:\/\/archive\.ubuntu\.com\/ubuntu\/pool\/universe\/x\/xdotool\//);
    assert.ok(Number.isSafeInteger(variant.size_bytes));
    assert.ok(variant.version && variant.distro);
  }
  assert.equal(new Set(pin.variants.map((variant) => variant.sha256)).size, 2);
  assert.equal(pin.format, 'deb');
  assert.equal(pin.system_package, 'xdotool');
  assert.equal(pin.license, 'BSD-3-clause');
  assert.ok(pin.license_markers.length > 0 && pin.license_file, 'the pin names its licence file and markers');
  const runtime = COMPUTER_FILES.map(read).join('\n');
  assert.doesNotMatch(runtime, /\b(?:fetch|https?\.get|npm install|npx|apt-get|pip install)\b/, 'the runtime has no download path');
  assert.doesNotMatch(
    runtime,
    /process\.env\.(?:DISPLAY|XAUTHORITY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR)/,
    'the display environment is never inherited',
  );
});

test('the capability loads lazily: requiring the package never loads the controller, the host or the approval gate', () => {
  const entry = JSON.stringify(path.join(ROOT, 'packages/agent-environment'));
  const loaded = (code) => execFileSync(process.execPath, ['-e', code]).toString().trim();
  const cached = (pattern) => `Object.keys(require.cache).some((file) => ${pattern}.test(file))`;
  assert.equal(
    loaded(`require(${entry}); console.log(${cached('/agent-environment.computer|environment-approval|environment-toolchain-pins/')});`),
    'false',
  );
  assert.equal(
    loaded(
      `const environment = require(${entry}); void environment.createComputerService; console.log(${cached('/agent-environment.computer[.]js/')});`,
    ),
    'true',
  );
  assert.equal(
    loaded(`const environment = require(${entry}); void environment.COMPUTER_CONTRACT; console.log(${cached('/environment-approval/')});`),
    'false',
    'the approval gate belongs to the host, which passes it in',
  );
  assert.deepEqual(manifest.load, { strategy: 'lazy', entry: 'packages/agent-environment/index.js' });
});

// The environment pack is admitted through the repository's own pinned-hash admission (execution-plugin-manifest):
// an execution bundle is generated from the very files of the pack, its manifest hash is pinned in a grant, and
// admission refuses any divergence. The tarball digest is pinned and compared here and nowhere else.
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const { admitExecutionPlugin, readExecutionPluginBundle } = require('../tools/lib/execution-plugin-manifest');

const LIMITS = { timeout_ms: 300_000, max_output_bytes: 65_536, memory_max_bytes: 2_147_483_648, pids_max: 256 };
const ARTIFACTS = { max_files: 8, max_file_bytes: 1_048_576, max_total_bytes: 4_194_304, media_types: ['image/png'] };

function executionBundle() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-computer-admission-'));
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
    capabilities: ['environment.computer'],
    limits: LIMITS,
    isolation_profile: manifest.profile,
    artifacts: ARTIFACTS,
    dependencies: [],
    conformance: ['packages/agent-environment/computer.js'],
  };
  fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(document));
  return { directory, pinned: sha256(canonicalize(document)) };
}

const grant = (pinned, overrides = {}) => ({
  id: manifest.id,
  version: manifest.version,
  manifest_sha256: pinned,
  kind: 'tool',
  allowed_capabilities: ['environment.computer'],
  limits: LIMITS,
  isolation_profile: 'P1',
  artifacts: ARTIFACTS,
  node_major: 24,
  contract_version: 1,
  ...overrides,
});

test('the computer-use pack is admitted by its pinned hash and refused on any divergence', () => {
  const { directory, pinned } = executionBundle();
  try {
    const admission = admitExecutionPlugin(directory, grant(pinned));
    assert.equal(admission.manifest_sha256, pinned);
    assert.equal(admission.isolation_profile, 'P1', 'the admitted profile is the one the plugin asks for');
    assert.throws(
      () => admitExecutionPlugin(directory, grant('0'.repeat(64))),
      (error) => error.code === 'PLUGIN_IDENTITY_DENIED',
    );
    assert.throws(
      () => admitExecutionPlugin(directory, grant(pinned, { isolation_profile: 'P0' })),
      (error) => error.code === 'PLUGIN_PROFILE_DENIED',
      'a grant that stops at P0 refuses a display server that needs local sockets',
    );
    fs.appendFileSync(path.join(directory, 'packages/agent-environment/computer.js'), '\n// tampered\n');
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-computer-tarball-'));
  try {
    const written = packPlugin({ repoRoot: ROOT, capability: 'computer-use', outputDirectory: directory });
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
