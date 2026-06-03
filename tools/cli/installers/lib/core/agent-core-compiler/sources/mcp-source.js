'use strict';

/**
 * MCP source (per ADR-0008 + the ADR-0007 module layout).
 *
 * Resolves the active MCP bundles for the project and enumerates their servers
 * for the manifest's `mcp_bundles_active` + `mcp_servers[]` fields. Active
 * bundles are the union of registry-required bundles (e.g. `core`) and the
 * bundles selected in `hseos.config.yaml` (`mcp_bundles_active`). On duplicate
 * server ids the highest tier wins (enterprise > extended > core), per the
 * registry's `highest_tier_wins` resolution policy.
 *
 * Additive + graceful: a project without an MCP registry yields no servers and
 * the manifest keeps its prior shape.
 */

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');

const TIER_ORDER = { core: 0, extended: 1, enterprise: 2 };

async function parseYaml(filePath) {
  try {
    return yaml.parse(await fs.readFile(filePath, 'utf8')) || {};
  } catch {
    return null;
  }
}

async function readSelectedBundles(hseosDir) {
  if (!hseosDir) return [];
  const configPath = path.join(hseosDir, 'config', 'hseos.config.yaml');
  if (!(await fs.pathExists(configPath))) return [];
  const cfg = await parseYaml(configPath);
  return cfg && Array.isArray(cfg.mcp_bundles_active) ? cfg.mcp_bundles_active : [];
}

function mapServer(server, bundleName) {
  const resolver = Array.isArray(server.binary_resolver) ? server.binary_resolver[0] : null;
  const binary = (resolver && resolver.path) || server.package;
  const runtime = (resolver && resolver.runtime) || server.runtime;
  const entry = { id: server.id, transport: server.transport };
  if (binary) entry.binary = binary;
  if (runtime) entry.runtime = runtime;
  entry.bundle = bundleName;
  if (Array.isArray(server.capabilities)) entry.capabilities = server.capabilities;
  return entry;
}

async function collectMcp(root, agentsDirName, hseosDir) {
  const registryPath = path.join(root, agentsDirName, 'mcp', 'registry.yaml');
  if (!(await fs.pathExists(registryPath))) return { bundles: [], servers: [] };

  const registry = await parseYaml(registryPath);
  const bundleDefs = (registry && registry.bundles) || {};

  const required = Object.entries(bundleDefs)
    .filter(([, def]) => def && def.required)
    .map(([name]) => name);
  const selected = await readSelectedBundles(hseosDir);
  const active = [...new Set([...required, ...selected])].filter((name) => bundleDefs[name]);

  // Resolve low → high tier so a higher-tier server definition wins on id clash.
  active.sort((a, b) => (TIER_ORDER[a] ?? 99) - (TIER_ORDER[b] ?? 99));

  const byId = new Map();
  for (const name of active) {
    const bundleFile = path.join(root, agentsDirName, 'mcp', bundleDefs[name].file);
    if (!(await fs.pathExists(bundleFile))) continue;
    const bundle = await parseYaml(bundleFile);
    for (const server of (bundle && bundle.servers) || []) {
      if (!server || !server.id || !server.transport) continue;
      byId.set(server.id, mapServer(server, name));
    }
  }

  return {
    bundles: [...active].sort(),
    servers: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

module.exports = { collectMcp };
