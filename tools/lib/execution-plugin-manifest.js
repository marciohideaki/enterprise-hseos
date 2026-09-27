'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { z, IdentifierSchema, deepFreeze } = require('../../packages/agent-runtime-contracts/common');
const semver = require('semver');
const { canonicalize } = require('../../packages/managed-governance-contracts/canonical-json');

const id = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const version = z
  .string()
  .max(128)
  .refine((value) => Boolean(semver.valid(value)) && /^[0-9]/.test(value) && value.trim() === value);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const relative = z
  .string()
  .max(240)
  .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*)*$/);
const distinct = (values) => new Set(values).size === values.length;
const limits = z
  .object({
    timeout_ms: z.number().int().min(1).max(300_000),
    max_output_bytes: z.number().int().min(1).max(65_536),
    memory_max_bytes: z.number().int().min(268_435_456).max(2_147_483_648),
    pids_max: z.number().int().min(32).max(256),
  })
  .strict();
const manifestSchema = z
  .object({
    schema_version: z.literal(1),
    id,
    version,
    kind: z.enum(['tool', 'model-provider', 'runtime-provider', 'context-source']),
    compatibility: z
      .object({
        contract_version: z.literal(1),
        node_majors: z
          .array(z.union([z.literal(22), z.literal(24)]))
          .min(1)
          .max(2)
          .refine(distinct),
      })
      .strict(),
    entrypoint: relative,
    files: z.record(relative, hash),
    capabilities: z.array(IdentifierSchema).max(32).refine(distinct),
    limits,
    dependencies: z.array(z.object({ id, version, manifest_sha256: hash }).strict()).max(32),
    conformance: z.array(relative).min(1).max(16).refine(distinct),
  })
  .strict();
const admissions = new WeakSet();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

class ExecutionPluginError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ExecutionPluginError';
    this.code = code;
  }
}
function reject(code) {
  throw new ExecutionPluginError(code);
}
/** Parse data only. No plugin module is loaded by inspection or admission. */
function parseExecutionPluginManifest(value) {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) reject('PLUGIN_MANIFEST_INVALID');
  const manifest = parsed.data;
  const names = Object.keys(manifest.files);
  if (names.length === 0 || names.length > 128 || names.includes('execution.json')) reject('PLUGIN_FILES_INVALID');
  if (!/\.(?:cjs|mjs|js)$/.test(manifest.entrypoint) || !Object.hasOwn(manifest.files, manifest.entrypoint))
    reject('PLUGIN_ENTRYPOINT_INVALID');
  if (manifest.conformance.some((name) => !Object.hasOwn(manifest.files, name))) reject('PLUGIN_CONFORMANCE_INVALID');
  if (!distinct(manifest.dependencies.map((dependency) => dependency.id)) || manifest.dependencies.some((item) => item.id === manifest.id))
    reject('PLUGIN_DEPENDENCY_INVALID');
  // A file cannot also be an ancestor directory of a different declared file.
  if (names.some((name) => names.some((other) => other.startsWith(`${name}/`)))) reject('PLUGIN_FILES_INVALID');
  return deepFreeze(manifest);
}

function readBoundedFile(root, name, ceiling) {
  const filename = path.join(root, name);
  if (fs.realpathSync(filename) !== filename) reject('PLUGIN_PATH_UNSAFE');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > ceiling) reject('PLUGIN_CONTENT_LIMIT');
    // Bound the read even if a concurrent writer grows the file after fstat.
    const buffer = Buffer.alloc(ceiling + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, size);
      if (count === 0) break;
      size += count;
    }
    const after = fs.fstatSync(fd);
    if (size > ceiling || size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.nlink !== 1)
      reject('PLUGIN_CONTENT_CHANGED');
    return buffer.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}

/** Return verified bytes for a subsequent private snapshot, never executable host objects. */
function readExecutionPluginBundle(directory) {
  try {
    const root = path.resolve(directory);
    if (fs.realpathSync(root) !== root || !fs.lstatSync(root).isDirectory()) reject('PLUGIN_PATH_UNSAFE');
    const raw = readBoundedFile(root, 'execution.json', 65_536);
    const manifest = parseExecutionPluginManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    const files = new Map();
    let remaining = 8_388_608;
    for (const [name, digest] of Object.entries(manifest.files)) {
      const bytes = readBoundedFile(root, name, Math.min(1_048_576, remaining));
      if (sha(bytes) !== digest) reject('PLUGIN_CONTENT_CHANGED');
      remaining -= bytes.length;
      files.set(name, bytes);
    }
    return { root, manifest, manifest_sha256: sha(canonicalize(manifest)), files };
  } catch (error) {
    if (error instanceof ExecutionPluginError) throw error;
    reject('PLUGIN_BUNDLE_INVALID');
  }
}

function inspectExecutionPlugin(directory) {
  const { manifest, manifest_sha256 } = readExecutionPluginBundle(directory);
  return deepFreeze({ manifest, manifest_sha256 });
}

function admitExecutionPlugin(directory, policy, dependencies = []) {
  const { manifest, manifest_sha256 } = inspectExecutionPlugin(directory);
  const parsed = z
    .object({
      id,
      version,
      manifest_sha256: hash,
      kind: manifestSchema.shape.kind,
      allowed_capabilities: z.array(IdentifierSchema).max(32).refine(distinct),
      limits,
      node_major: z.number().int(),
      contract_version: z.literal(1),
    })
    .strict()
    .safeParse(policy);
  if (!parsed.success) reject('PLUGIN_POLICY_INVALID');
  const grant = parsed.data;
  if (
    manifest.id !== grant.id ||
    manifest.version !== grant.version ||
    manifest_sha256 !== grant.manifest_sha256 ||
    manifest.kind !== grant.kind
  )
    reject('PLUGIN_IDENTITY_DENIED');
  if (!manifest.compatibility.node_majors.includes(grant.node_major)) reject('PLUGIN_INCOMPATIBLE');
  if (manifest.capabilities.some((capability) => !grant.allowed_capabilities.includes(capability))) reject('PLUGIN_AUTHORITY_DENIED');
  for (const [name, requested] of Object.entries(manifest.limits)) if (requested > grant.limits[name]) reject('PLUGIN_LIMIT_DENIED');
  if (!Array.isArray(dependencies) || dependencies.length !== manifest.dependencies.length) reject('PLUGIN_DEPENDENCY_UNRESOLVED');
  for (const dependency of manifest.dependencies) {
    const candidate = dependencies.find((item) => admissions.has(item) && item.manifest.id === dependency.id);
    if (!candidate || candidate.manifest.version !== dependency.version || candidate.manifest_sha256 !== dependency.manifest_sha256)
      reject('PLUGIN_DEPENDENCY_UNRESOLVED');
    assertExecutionPluginAdmission(candidate);
  }
  const admission = deepFreeze({
    dependencies: [...dependencies],
    root: path.resolve(directory),
    manifest,
    manifest_sha256,
    node_major: grant.node_major,
  });
  admissions.add(admission);
  return admission;
}

function checkAdmission(admission, checked) {
  if (!admissions.has(admission)) reject('PLUGIN_ADMISSION_REQUIRED');
  if (checked.has(admission)) return;
  checked.add(admission);
  if (Number(process.versions.node.split('.')[0]) !== admission.node_major) reject('PLUGIN_INCOMPATIBLE');
  for (const dependency of admission.dependencies) checkAdmission(dependency, checked);
  const bundle = readExecutionPluginBundle(admission.root);
  if (bundle.manifest_sha256 !== admission.manifest_sha256) reject('PLUGIN_CONTENT_CHANGED');
  return bundle;
}

function assertExecutionPluginAdmission(admission) {
  return checkAdmission(admission, new Set());
}

/** Resolve an exact selection using metadata only; dependencies never load code. */
function resolveExecutionPlugins(catalog, selected) {
  if (!Array.isArray(catalog) || catalog.length > 128 || !Array.isArray(selected) || selected.length > 128 || !distinct(selected))
    reject('PLUGIN_SELECTION_INVALID');
  const byId = new Map();
  for (const entry of catalog) {
    const manifest = parseExecutionPluginManifest(entry.manifest);
    if (byId.has(manifest.id) || sha(canonicalize(manifest)) !== entry.manifest_sha256) reject('PLUGIN_CATALOG_INVALID');
    byId.set(manifest.id, { manifest, manifest_sha256: entry.manifest_sha256 });
  }
  const active = new Set();
  const done = new Set();
  const result = [];
  const visit = (name) => {
    if (active.has(name)) reject('PLUGIN_DEPENDENCY_CYCLE');
    if (done.has(name)) return;
    const entry = byId.get(name);
    if (!entry) reject('PLUGIN_DEPENDENCY_MISSING');
    active.add(name);
    for (const dependency of entry.manifest.dependencies) {
      const candidate = byId.get(dependency.id);
      if (!candidate || candidate.manifest.version !== dependency.version || candidate.manifest_sha256 !== dependency.manifest_sha256)
        reject('PLUGIN_DEPENDENCY_MISMATCH');
      visit(dependency.id);
    }
    active.delete(name);
    done.add(name);
    result.push(entry);
  };
  for (const name of selected) visit(name);
  return deepFreeze(result);
}

module.exports = {
  ExecutionPluginError,
  parseExecutionPluginManifest,
  readExecutionPluginBundle,
  inspectExecutionPlugin,
  admitExecutionPlugin,
  assertExecutionPluginAdmission,
  resolveExecutionPlugins,
};
