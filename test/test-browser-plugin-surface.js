'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { PINS } = require('../tools/lib/environment-toolchain-pins');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const manifest = JSON.parse(read('plugins/browser/plugin.json'));
const definition = '.enterprise/governance/plugins/definitions/hseos-plugin-browser';

test('governance surface: definition, skill and registry entry agree with the manifest', () => {
  for (const file of ['plugin.yaml', 'README.md', 'skills/browser/SKILL.md'])
    assert.ok(fs.existsSync(path.join(ROOT, definition, file)), file);
  assert.match(read(`${definition}/plugin.yaml`), new RegExp(`^id: ${manifest.id}$`, 'm'));
  assert.match(read(`${definition}/plugin.yaml`), /^version: "0\.1\.0"$/m);
  assert.match(
    read('.enterprise/governance/plugins/registry.yaml'),
    new RegExp(`- id: ${manifest.id}\\n\\s+version: "${manifest.version}"\\n\\s+status: scaffolded`),
  );
  const skill = read(`${definition}/skills/browser/SKILL.md`);
  assert.match(skill, /^plugin: hseos-plugin-browser$/m);
  assert.match(skill, /ENV_BROWSER_EGRESS_DENIED/);
  assert.match(skill, /untrusted/);
  for (const file of ['README.md', 'skills/browser/SKILL.md']) {
    assert.equal(read(`${definition}/${file}`), read(`.agents/plugins/definitions/hseos-plugin-browser/${file}`), `${file} mirror`);
  }
});

test('core surface: no new npm dependency, browser files registered for the kernel suite and coverage', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(
    Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }).some((name) =>
      /playwright|puppeteer|chrom/.test(name),
    ),
    false,
  );
  for (const file of ['test/test-environment-browser.js', 'test/test-browser-plugin-surface.js', 'test/test-browser-plugin-parity.js']) {
    assert.ok(pkg.scripts['test:kernel'].includes(file), `${file} is part of test:kernel`);
  }
  const coverage = JSON.parse(read('.c8-kernel.json'));
  for (const file of [
    'packages/agent-environment/browser-contract.js',
    'packages/agent-environment/browser.js',
    'packages/agent-environment/browser-host.js',
    'tools/cli/lib/environment-egress-broker.js',
  ]) {
    assert.ok(coverage.include.includes(file), `${file} is in the kernel coverage`);
  }
  assert.ok(coverage['per-file'] !== false);
  for (const file of manifest.core_files) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
});

test('isolation surface: the plugin asks for P2 and grants --no-sandbox only through the supervisor launch', () => {
  assert.equal(manifest.profile, 'P2');
  const sources = ['browser.js', 'browser-host.js', 'browser-contract.js']
    .map((file) => read(`packages/agent-environment/${file}`))
    .join('\n');
  const flagSites = sources.split('\n').filter((line) => line.includes('--no-sandbox'));
  assert.deepEqual(flagSites, [], 'the literal flag never appears in the capability: it comes from chromiumSandboxFlags');
  assert.match(read('packages/agent-environment/index.js'), /chromiumSandboxFlags\(prepareIsolatedExecution\(policy/);
  assert.match(read('packages/agent-environment/browser-host.js'), /chromiumSandbox: true/, 'playwright does not add the flag by itself');
  assert.match(sources, /broker\.allow\.includes\(urlAuthority/, 'navigation is checked against the allowlist before launch');
});

test('toolchain surface: both pins are data with a licence checked in the artifact, and nothing downloads at run time', () => {
  for (const name of manifest.toolchain_pins) {
    const pin = PINS[name];
    assert.match(pin.sha256, /^[0-9a-f]{64}$/);
    assert.ok(pin.license_markers.length > 0 && pin.license_file, `${name} names its licence file and markers`);
  }
  assert.deepEqual([PINS['playwright-core'].version, PINS['chrome-headless-shell'].version], ['1.61.0', '149.0.7827.55']);
  const runtime = ['browser.js', 'browser-host.js', 'browser-contract.js']
    .map((file) => read(`packages/agent-environment/${file}`))
    .join('\n');
  assert.doesNotMatch(runtime, /\b(?:fetch|https?\.get|npm install|npx)\b/, 'the runtime has no download path');
  const provision = read('.github/scripts/provision-toolchain-cache.mjs');
  assert.match(provision, /chrome-for-testing-public/);
  assert.match(provision, /expectedBytes|size/);
  assert.match(read('.github/workflows/ci.yaml'), /provision-toolchain-cache\.mjs/);
});
