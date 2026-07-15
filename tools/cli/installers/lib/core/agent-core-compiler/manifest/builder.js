'use strict';

const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const { PLATFORM_SURFACES } = require('../adapters/platforms');

// adapters{} is derived from the platforms that actually emitted during this
// compile — the manifest must never advertise surfaces (platforms or paths)
// the pipeline did not produce, because the instruction cascade tells agents
// to trust it.
function buildAdaptersBlock(platforms) {
  const adapters = {};
  for (const platform of platforms || []) {
    const surfaces = PLATFORM_SURFACES[platform];
    if (surfaces) adapters[platform.replaceAll('-', '_')] = surfaces;
  }
  return adapters;
}

async function writeManifest(root, data, agentsDirName = '.agents') {
  const manifest = {
    version: '1.0',
    generated_by: 'hseos-agent-core-compiler',
    source_of_truth: '.agents',
    adapters: buildAdaptersBlock(data.platforms),
    platforms: data.platforms,
    counts: {
      skills: data.skills.length,
      hooks: data.hooks.length,
      commands: data.commands.length,
    },
    skills: data.skills,
    hooks: data.hooks.map((hook) => ({
      id: hook.id,
      event: hook.event,
      matcher: hook.matcher,
      platform_support: hook.platform_support,
    })),
    commands: data.commands,
  };

  // Agents/plugins/MCP catalogs are additive: each is registered only when the
  // project exposes the corresponding definitions. Absent → the manifest keeps
  // its prior shape (v1.0 behaviour), so installs that compile none of these
  // stay byte-for-byte compatible.
  if (Array.isArray(data.handlers) && data.handlers.length > 0) {
    manifest.counts.handlers = data.handlers.length;
    manifest.handlers = data.handlers;
  }
  if (Array.isArray(data.agents) && data.agents.length > 0) {
    manifest.counts.agents = data.agents.length;
    manifest.agents = data.agents;
  }
  if (Array.isArray(data.plugins) && data.plugins.length > 0) {
    manifest.counts.plugins = data.plugins.length;
    manifest.plugins = data.plugins;
  }
  if (data.mcp && Array.isArray(data.mcp.servers) && data.mcp.servers.length > 0) {
    if (Array.isArray(data.mcp.bundles) && data.mcp.bundles.length > 0) {
      manifest.mcp_bundles_active = data.mcp.bundles;
    }
    manifest.counts.mcp_servers = data.mcp.servers.length;
    manifest.mcp_servers = data.mcp.servers;
  }

  const manifestPath = path.join(root, agentsDirName, 'manifest.yaml');
  await fs.writeFile(manifestPath, yaml.stringify(manifest, { lineWidth: 0 }), 'utf8');
  return path.relative(root, manifestPath).replaceAll(path.sep, '/');
}

module.exports = { writeManifest };
