'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('yaml');

const AGENTS = path.join(__dirname, '..', '.agents');
const TIER_ORDER = { core: 0, extended: 1, enterprise: 2 };
const read = (...segments) => yaml.parse(fs.readFileSync(path.join(AGENTS, ...segments), 'utf8'));

/** The servers a bundle source declares, with the highest tier winning on a duplicate id (as the compiler resolves it). */
function sourceServers(bundles) {
  const resolved = new Map();
  for (const bundle of [...bundles].sort((left, right) => TIER_ORDER[left] - TIER_ORDER[right])) {
    for (const server of read('mcp', 'bundles', `${bundle}.yaml`).servers ?? []) resolved.set(server.id, { ...server, bundle });
  }
  return resolved;
}

test('every MCP server in the derived manifest carries the transport and bundle of its source bundle', () => {
  const manifest = read('manifest.yaml');
  const bundles = manifest.mcp_bundles_active;
  assert.ok(Array.isArray(bundles) && bundles.length > 0, 'the manifest names its active bundles');
  const source = sourceServers(bundles);
  assert.ok(manifest.mcp_servers.length > 0);
  for (const server of manifest.mcp_servers) {
    const origin = source.get(server.id);
    assert.ok(origin, `${server.id} is declared by an active bundle`);
    assert.equal(
      server.transport,
      origin.transport,
      `${server.id}: transport differs from ${origin.bundle}.yaml (regenerate the manifest)`,
    );
    assert.equal(server.bundle, origin.bundle, `${server.id}: bundle differs from its source`);
  }
  assert.deepEqual(
    manifest.mcp_servers.map((server) => server.id).sort(),
    [...source.keys()].sort(),
    'the manifest lists exactly the servers of the active bundles',
  );
});
