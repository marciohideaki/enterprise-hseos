'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Mcp2026Adapter } = require('../mcp-2026-adapter');
const { EntrypointAdapterError } = require('./entrypoint-adapters');
const { LEGACY_TOOLS } = require('../../mcp-project-state/tool-catalog');

const NATIVE_MCP_SERVERS = Object.freeze({
  axon_bridge: Object.freeze({ directory: 'mcp-axon-bridge', name: 'axon-bridge' }),
  governance: Object.freeze({ directory: 'mcp-hseos-governance', name: 'hseos-governance' }),
  project_state: Object.freeze({ directory: 'mcp-project-state', name: 'hseos-project-state' }),
  swarm: Object.freeze({ directory: 'mcp-hseos-swarm', name: 'hseos-swarm' }),
});

function immutableCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutableCopy(child)])));
  }
  return value;
}

function publicDescriptor(tool, source) {
  if (
    !tool ||
    typeof tool !== 'object' ||
    typeof tool.name !== 'string' ||
    typeof tool.description !== 'string' ||
    !tool.inputSchema ||
    typeof tool.inputSchema !== 'object'
  ) {
    throw new EntrypointAdapterError(`Invalid native MCP tool descriptor in ${source}`);
  }
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    inputSchema: immutableCopy(tool.inputSchema),
    ...(tool.outputSchema ? { outputSchema: immutableCopy(tool.outputSchema) } : {}),
  });
}

function loadToolDirectory(directory) {
  const toolsDirectory = path.join(__dirname, '..', '..', directory, 'tools');
  const descriptors = [];
  for (const filename of fs.readdirSync(toolsDirectory).filter((name) => name.endsWith('.js')).sort()) {
    const source = path.join(toolsDirectory, filename);
    const exported = require(source);
    if (!Array.isArray(exported)) {
      throw new EntrypointAdapterError(`Native MCP tool module must export an array: ${source}`);
    }
    descriptors.push(...exported.map((tool) => publicDescriptor(tool, source)));
  }
  return descriptors;
}

function loadNativeMcpCatalogs() {
  const catalogs = {};
  for (const [id, server] of Object.entries(NATIVE_MCP_SERVERS)) {
    const descriptors = loadToolDirectory(server.directory);
    if (id === 'project_state') {
      descriptors.unshift(...LEGACY_TOOLS.map((tool) => publicDescriptor(tool, 'project-state/tool-catalog')));
    }
    const names = descriptors.map((tool) => tool.name);
    if (names.length === 0 || new Set(names).size !== names.length) {
      throw new EntrypointAdapterError(`Native MCP catalog is empty or contains duplicates: ${id}`);
    }
    catalogs[id] = Object.freeze(descriptors);
  }
  return Object.freeze(catalogs);
}

function createNativeMcpAdapters({ scheduler, resolvers, adapterOptions = {} }) {
  if (!scheduler || typeof scheduler.execute !== 'function') {
    throw new EntrypointAdapterError('Native MCP adapters require the governed scheduler');
  }
  if (!resolvers || typeof resolvers !== 'object') {
    throw new EntrypointAdapterError('Native MCP adapters require server-scoped resolvers');
  }
  const catalogs = loadNativeMcpCatalogs();
  const adapters = {};
  for (const [id, server] of Object.entries(NATIVE_MCP_SERVERS)) {
    const resolver = resolvers[id] || resolvers.default;
    if (!resolver || typeof resolver.resolveActor !== 'function' || typeof resolver.resolveResourceScope !== 'function') {
      throw new EntrypointAdapterError(`Missing actor/resource resolver for native MCP server: ${id}`);
    }
    adapters[id] = new Mcp2026Adapter({
      ...adapterOptions,
      serverInfo: { name: server.name, version: '2.0.0' },
      tools: catalogs[id],
      execute: (request) => scheduler.execute(request),
      resolveActor: resolver.resolveActor,
      resolveResourceScope: resolver.resolveResourceScope,
    });
  }
  return Object.freeze(adapters);
}

function createNativeMcpAdapter({ serverId, scheduler, resolver, adapterOptions = {} }) {
  const server = NATIVE_MCP_SERVERS[serverId];
  if (!server) throw new EntrypointAdapterError(`Unknown native MCP server: ${serverId}`);
  if (!scheduler || typeof scheduler.execute !== 'function') {
    throw new EntrypointAdapterError('Native MCP adapter requires the governed scheduler');
  }
  if (!resolver || typeof resolver.resolveActor !== 'function' || typeof resolver.resolveResourceScope !== 'function') {
    throw new EntrypointAdapterError(`Missing actor/resource resolver for native MCP server: ${serverId}`);
  }
  return new Mcp2026Adapter({
    ...adapterOptions,
    serverInfo: { name: server.name, version: '2.0.0' },
    tools: loadNativeMcpCatalogs()[serverId],
    execute: (request) => scheduler.execute(request),
    resolveActor: resolver.resolveActor,
    resolveResourceScope: resolver.resolveResourceScope,
  });
}

module.exports = { createNativeMcpAdapter, createNativeMcpAdapters, loadNativeMcpCatalogs, NATIVE_MCP_SERVERS };
