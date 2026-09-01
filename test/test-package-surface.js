'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');

function packageFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(output)[0];
}

test('published package exposes runtime and governance assets only', () => {
  const packed = packageFiles();
  const files = new Set(packed.files.map((file) => file.path));
  for (const required of [
    'LICENSE',
    'tools/hseos-npx-wrapper.js',
    'tools/cli/hseos-cli.js',
    '.agents/manifest.yaml',
    '.enterprise/.specs/constitution/Enterprise-Constitution.md',
    '.enterprise/governance/capabilities/profiles.yaml',
    '.enterprise/governance/capabilities/surfaces.yaml',
    '.agents/capabilities/surfaces.yaml',
    '.hseos/workflows/registry.yaml',
    'docs/MANAGED-GOVERNANCE.md',
    'docs/pt-br/governanca-gerenciada.md',
    'scripts/governance/quality-gates.sh',
    'packages/managed-governance-contracts/index.js',
    'packages/managed-governance-client/index.js',
    'tools/managed-governance-control-plane/server.js',
    'tools/managed-governance-control-plane/composition.js',
    'tools/managed-governance-control-plane/config.example.json',
    'tools/managed-governance-control-plane/migrations/0003_audit_correlation.sql',
    'tools/managed-governance-control-plane/migrations/0004_operational_health.sql',
    'tools/managed-governance-control-plane/public/index.html',
    'packages/agent-runtime/index.js',
    'src/core/agents/hseos-master.agent.yaml',
  ]) {
    assert.ok(files.has(required), `missing required package asset: ${required}`);
  }

  const forbiddenPrefixes = ['test/', '_graph/', '.hseos/runs/', '.github/', '.logs/'];
  for (const file of files) {
    assert.ok(!forbiddenPrefixes.some((prefix) => file.startsWith(prefix)), `internal artifact published: ${file}`);
    assert.notEqual(file, '.enterprise/.specs/specs.zip');
    assert.ok(!/\.(?:db|sqlite|pem|key)$/i.test(file), `state or key material published: ${file}`);
    assert.ok(!/(?:^|\/)(?:\.env|managed-governance\.json)$/i.test(file), `runtime configuration published: ${file}`);
  }
  assert.ok(packed.entryCount < 1310, `package entry count is not bounded: ${packed.entryCount}`);
  assert.ok(packed.unpackedSize < 22_000_000, `package unpacked size is not bounded: ${packed.unpackedSize}`);
});
