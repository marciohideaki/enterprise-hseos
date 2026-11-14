'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadCapabilityRegistry, resolveCapability, SNAPSHOT_FILE, SNAPSHOT_LOCK_FILE } = require('../tools/cli/lib/capability-registry');

const root = path.resolve(__dirname, '..');
const queries = [
  ['ai.provider-access', 'name'],
  ['platform-core/ai/provider-connection', 'contract'],
  ['platform-core/ai/inference-request', 'contract'],
  ['@hideakisolutions/platform-node/ai-providers', 'package'],
  ['Hideakisolutions.Platform.Ai.ProviderAccess', 'package'],
  ['IInferenceProvider', 'symbol'],
  ['composePackagedSubscription', 'symbol'],
];

function requireProviderAccess(runtimeRoot) {
  const loaded = loadCapabilityRegistry({ runtimeRoot });
  const found = resolveCapability(loaded.registry, 'ai.provider-access');
  assert.equal(found[0]?.capability.name, 'ai.provider-access', 'candidate snapshot is stale or missing provider access');
  return loaded;
}

const loaded = requireProviderAccess(root);
for (const [query, matchedBy] of queries) {
  const found = resolveCapability(loaded.registry, query);
  assert.equal(found[0]?.capability.name, 'ai.provider-access', query);
  assert.equal(found[0]?.matchedBy, matchedBy, query);
}
const cli = JSON.parse(
  execFileSync(
    process.execPath,
    [path.join(root, 'tools/cli/hseos-cli.js'), 'capability-check', 'ai.provider-access', '--json', '--directory', root],
    { encoding: 'utf8', env: process.env },
  ),
);
assert.equal(cli.results[0]?.capability, 'ai.provider-access');
assert.equal(cli.registry.sha256, loaded.sha256);

const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'provider-discovery-'));
function copySnapshot() {
  for (const file of [SNAPSHOT_FILE, SNAPSHOT_LOCK_FILE]) {
    fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(scratch, file));
  }
}
try {
  copySnapshot();
  fs.appendFileSync(path.join(scratch, SNAPSHOT_FILE), ' ');
  assert.throws(() => requireProviderAccess(scratch), /sha256 mismatch/);

  copySnapshot();
  const registry = JSON.parse(fs.readFileSync(path.join(scratch, SNAPSHOT_FILE)));
  registry.capabilities = registry.capabilities.filter((entry) => entry.name !== 'ai.provider-access');
  const bytes = JSON.stringify(registry);
  fs.writeFileSync(path.join(scratch, SNAPSHOT_FILE), bytes);
  const lock = JSON.parse(fs.readFileSync(path.join(scratch, SNAPSHOT_LOCK_FILE)));
  lock.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(scratch, SNAPSHOT_LOCK_FILE), JSON.stringify(lock));
  assert.throws(() => requireProviderAccess(scratch), /stale or missing provider access/);

  copySnapshot();
  fs.rmSync(path.join(scratch, SNAPSHOT_FILE));
  assert.throws(() => requireProviderAccess(scratch), /snapshot/i);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(
  'Provider candidate discovery passed: 7 lookup surfaces, real CLI, corrupt hash, hash-valid stale snapshot and missing snapshot rejected.',
);
