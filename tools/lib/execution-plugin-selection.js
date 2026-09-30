'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { z, IdentifierSchema, deepFreeze } = require('../../packages/agent-runtime-contracts');
const { canonicalize } = require('../../packages/managed-governance-contracts/canonical-json');
const { admitExecutionPlugin, ExecutionPluginError } = require('./execution-plugin-manifest');

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identifiers = z
  .array(IdentifierSchema)
  .max(128)
  .refine((values) => new Set(values).size === values.length);
const pinSchema = z
  .object({
    selection_id: IdentifierSchema,
    id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    version: z.string().min(1).max(128),
    kind: z.enum(['tool', 'model-provider', 'runtime-provider', 'context-source']),
    manifest_sha256: hash,
    configuration_sha256: hash,
    policy_sha256: hash,
    dependencies: identifiers,
  })
  .strict();
const selectionSchema = z
  .object({
    schema_version: z.literal(1),
    selected: identifiers,
    entries: z.array(pinSchema).max(128),
    selection_sha256: hash,
  })
  .strict();
const declarationSchema = z
  .object({
    directory: z
      .string()
      .max(4096)
      .refine((value) => path.isAbsolute(value)),
    policy: z.record(z.string(), z.json()),
    configuration: z.record(z.string(), z.json()),
    dependencies: identifiers,
  })
  .strict();
const digest = (value) => createHash('sha256').update(canonicalize(value)).digest('hex');
function reject(code) {
  throw new ExecutionPluginError(code);
}

/** Durable data only. Port-specific configuration is validated by its host adapter. */
function parseExecutionPluginSelection(value) {
  const parsed = selectionSchema.safeParse(value);
  if (!parsed.success) reject('PLUGIN_SELECTION_INVALID');
  const { selection_sha256, ...body } = parsed.data;
  if (digest(body) !== selection_sha256) reject('PLUGIN_SELECTION_DRIFT');
  const seen = new Set();
  const plugins = new Set();
  for (const pin of body.entries) {
    if (seen.has(pin.selection_id) || plugins.has(pin.id) || pin.dependencies.some((id) => !seen.has(id)))
      reject('PLUGIN_SELECTION_INVALID');
    seen.add(pin.selection_id);
    plugins.add(pin.id);
  }
  if (body.selected.some((id) => !seen.has(id))) reject('PLUGIN_SELECTION_INVALID');
  const reachable = new Set();
  const visit = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dependency of body.entries.find((entry) => entry.selection_id === id).dependencies) visit(dependency);
  };
  for (const id of body.selected) visit(id);
  if (reachable.size !== body.entries.length) reject('PLUGIN_SELECTION_INVALID');
  return deepFreeze(parsed.data);
}

/** Catalog declarations are trusted local data, never module paths supplied by HTTP clients. */
function pinExecutionPluginSelection(catalog, selected) {
  if (!catalog || ![Object.prototype, null].includes(Object.getPrototypeOf(catalog))) reject('PLUGIN_CATALOG_INVALID');
  const requested = identifiers.safeParse(selected);
  if (!requested.success) reject('PLUGIN_SELECTION_INVALID');
  const active = new Set();
  const resolved = new Map();
  const identities = new Map();
  const pins = [];
  const visit = (selectionId) => {
    if (active.has(selectionId)) reject('PLUGIN_DEPENDENCY_CYCLE');
    if (resolved.has(selectionId)) return resolved.get(selectionId);
    if (resolved.size + active.size >= 128) reject('PLUGIN_SELECTION_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(catalog, selectionId);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject('PLUGIN_SELECTION_UNKNOWN');
    // Validate only selected declarations and their dependencies. Unselected entries remain inert.
    const raw = descriptor.value;
    let declaration;
    try {
      if (Buffer.byteLength(canonicalize(raw)) > 65_536) reject('PLUGIN_CONFIGURATION_LIMIT');
      declaration = declarationSchema.parse(raw);
    } catch (error) {
      if (error instanceof ExecutionPluginError) throw error;
      reject('PLUGIN_CONFIGURATION_INVALID');
    }
    if (Object.hasOwn(declaration.policy, 'node_major')) reject('PLUGIN_POLICY_INVALID');
    active.add(selectionId);
    const dependencies = declaration.dependencies.map((id) => visit(id).admission);
    const admission = admitExecutionPlugin(
      declaration.directory,
      {
        ...declaration.policy,
        node_major: Number(process.versions.node.split('.')[0]),
      },
      dependencies,
    );
    const manifest = admission.manifest;
    // One execution cannot combine alternate versions or configurations for the same plugin.
    if (identities.has(manifest.id)) reject('PLUGIN_SELECTION_CONFLICT');
    identities.set(manifest.id, selectionId);
    const pin = {
      selection_id: selectionId,
      id: manifest.id,
      version: manifest.version,
      kind: manifest.kind,
      manifest_sha256: admission.manifest_sha256,
      configuration_sha256: digest(declaration.configuration),
      policy_sha256: digest(declaration.policy),
      dependencies: declaration.dependencies,
    };
    const entry = deepFreeze({ pin, admission, configuration: declaration.configuration });
    resolved.set(selectionId, entry);
    pins.push(pin);
    active.delete(selectionId);
    return entry;
  };
  for (const id of requested.data) visit(id);
  const body = { schema_version: 1, selected: requested.data, entries: pins };
  return Object.freeze({
    selection: parseExecutionPluginSelection({ ...body, selection_sha256: digest(body) }),
    entries: Object.freeze([...resolved.values()]),
  });
}

/** Resolve the original selection exactly; an updated catalog never silently replaces it. */
function restoreExecutionPluginSelection(catalog, value) {
  const pinned = parseExecutionPluginSelection(value);
  const restored = pinExecutionPluginSelection(catalog, pinned.selected);
  if (restored.selection.selection_sha256 !== pinned.selection_sha256) reject('PLUGIN_SELECTION_DRIFT');
  return restored;
}

module.exports = { parseExecutionPluginSelection, pinExecutionPluginSelection, restoreExecutionPluginSelection };
