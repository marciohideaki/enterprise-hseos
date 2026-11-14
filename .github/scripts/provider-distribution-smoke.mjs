// Run in a disposable Node container with only sealed assets and these two
// release scripts mounted read-only. No source checkout or host runtime is used.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { VERSION, verifyAssetDirectory, validateSnapshot } from './provider-distribution.mjs';

assert.equal(process.versions.node.split('.')[0], '22');
for (const name of [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITEA_PACKAGE_READER_TOKEN',
  'GITEA_PACKAGE_READER_USER',
  'NODE_AUTH_TOKEN',
  'NODE_PATH',
  'HSEOS_ROOT',
])
  assert.ok(!process.env[name], `${name} must not enter the clean consumer`);
assert.ok(!fs.existsSync('/workspace/github'), 'a source checkout must not be mounted');
assert.notEqual(spawnSync('sh', ['-c', 'command -v hseos'], { encoding: 'utf8' }).status, 0, 'a global HSEOS must not be available');
for (const directory of ['/build/tmp', '/build/home', '/build/npm', '/consumer']) fs.mkdirSync(directory, { recursive: true });
const env = { ...process.env, HOME: '/build/home', TMPDIR: '/build/tmp', npm_config_cache: '/build/npm' };
const run = (command, args) => execFileSync(command, args, { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const { manifest, hashes } = verifyAssetDirectory('/artifacts');
const prefix = '/consumer/runtime';
run('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', `/artifacts/hseos-${VERSION}.tgz`]);
const runtime = fs.realpathSync(path.join(prefix, 'node_modules/hseos'));
assert.ok(runtime.startsWith(`${prefix}/`), 'installed package must resolve inside the isolated consumer');
assert.ok(!fs.existsSync(path.join(runtime, '.git')));
const cli = path.join(runtime, 'tools/hseos-npx-wrapper.js');
assert.equal(run(process.execPath, [cli, '--version']), VERSION);
validateSnapshot(manifest, runtime);

const project = '/consumer/project';
fs.mkdirSync(project, { recursive: true });
const install = JSON.parse(
  run(process.execPath, [
    cli,
    'install',
    '--directory',
    project,
    '--profile',
    'minimal',
    '--tools',
    'none',
    '--no-git-hooks',
    '--yes',
    '--json',
  ]),
);
assert.ok(install, 'the installed CLI must produce its minimal-install receipt');
const lookups = [];
for (const [query, stack] of [
  ['ai.provider-access', 'node'],
  ['platform-core/ai/provider-connection', 'node'],
  ['platform-core/ai/inference-request', 'node'],
  ['@hideakisolutions/platform-node/ai-providers', 'node'],
  ['Hideakisolutions.Platform.Ai.ProviderAccess', 'dotnet'],
  ['IInferenceProvider', 'dotnet'],
  ['composePackagedSubscription', 'node'],
]) {
  fs.mkdirSync(path.join(project, '.hseos/config'), { recursive: true });
  fs.writeFileSync(
    path.join(project, '.hseos/config/platform-bindings.yaml'),
    JSON.stringify({ schema_version: '1.0.0', mode: 'platform', stacks: [stack], registry: { source: 'snapshot' } }),
  );
  const report = JSON.parse(run(process.execPath, [cli, 'capability-check', query, '--directory', project, '--json']));
  const result = report.results.find((item) => item.capability === 'ai.provider-access');
  assert.equal(result?.verdict, 'consume');
  assert.ok(
    result.implementations.some(
      (item) => item.package === manifest.sdks[stack].package && item.package_version === manifest.sdks[stack].version,
    ),
    `wrong SDK discovered for ${query}`,
  );
  assert.equal(report.registry.ref, manifest.ecp.source_sha);
  const implementation = result.implementations.find((item) => item.package === manifest.sdks[stack].package);
  assert.deepEqual(implementation.operations, ['generate']);
  assert.deepEqual(implementation.guarantees, [
    { operation: 'generate', billing_route: 'connection_pinned', cancellation: 'propagated', inference_retry: 'never_automatic' },
  ]);
  assert.equal(report.registry.sha256, manifest.ecp.registry_sha256);
  lookups.push({ query, stack, registry: report.registry, result });
}
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      classification: 'downloaded-asset clean consumer; no inference or global activation',
      version: VERSION,
      runtime,
      hashes,
      node: process.version,
      minimal_install: install,
      lookups,
    },
    null,
    2,
  ),
);
