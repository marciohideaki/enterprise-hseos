'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AgentLimitsSchema, IdentifierSchema, strictObject, deepFreeze, z } = require('../../../packages/agent-runtime-contracts');
const { canonicalJson } = require('../../../packages/agent-session-store');

const MAX_BYTES = 1_048_576;

/**
 * Project (v2) limits. The v1 limits stay as they were; these apply only to managed projects whose
 * dependencies live in a pnpm virtual store. Measured on a real consumer (cambio-real-platforms,
 * vitest 4.1.10): the vitest package alone is 116 files / 1.9 MB with 7 files above 64 KiB, and its
 * store directory name is 130 characters, so the plain 240-character path and 1 MiB budgets cannot hold a
 * test runner. Every limit stays finite and is tested at the limit and one past it.
 */
const PROJECT_LIMITS = Object.freeze({
  ordinary_paths: 64,
  store_paths: 256,
  total_paths: 256,
  ordinary_path_chars: 240,
  store_path_chars: 512,
  segment_chars: 255,
  file_chars: 65_536,
  // A v2 file above file_chars is "large": read by line range, changed by anchored patch, never held whole by the model.
  large_file_chars: 262_144,
  large_files_max: 4,
  large_files_bytes: 1_048_576,
  read_window_bytes: 12_288,
  read_window_lines: 300,
  artifact_bytes: 2_097_152,
  contract_bytes: 4_194_304,
});
const ORDINARY_PATH = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9_][a-zA-Z0-9._-]*)*$/;
// Only below node_modules/.pnpm: pnpm names store entries <package>@<version>_<peers> and scoped packages @scope+name.
const STORE_PATH = /^node_modules\/\.pnpm\/[a-zA-Z0-9_@][a-zA-Z0-9._+@-]*(?:\/[a-zA-Z0-9_@][a-zA-Z0-9._+@-]*)*$/;
const isStorePath = (value) =>
  typeof value === 'string' &&
  value.length <= PROJECT_LIMITS.store_path_chars &&
  STORE_PATH.test(value) &&
  value.split('/').every((segment) => segment.length <= PROJECT_LIMITS.segment_chars);
const isProjectPath = (value) =>
  typeof value === 'string' &&
  ((value.length <= PROJECT_LIMITS.ordinary_path_chars &&
    ORDINARY_PATH.test(value) &&
    value.split('/').every((segment) => segment.length <= PROJECT_LIMITS.segment_chars)) ||
    isStorePath(value));
const ordinaryCount = (list) => list.filter((entry) => !isStorePath(entry)).length;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const text = z.string().min(1).max(8192);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const relativePath = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/);
const ids = z.array(IdentifierSchema).min(1).max(64);
const paths = z.array(relativePath).min(1).max(64);
const source = strictObject({ id: IdentifierSchema, kind: z.enum(['specification', 'memory']), content: text, sha256: hash });
const requirement = strictObject({ id: IdentifierSchema, description: text, source_ids: ids });
const acceptance = strictObject({ id: IdentifierSchema, description: text, requirement_ids: ids });
const file = strictObject({ path: relativePath, content: z.string().max(65_536), sha256: hash });
const command = strictObject({
  id: IdentifierSchema,
  runtime: z.enum(['node', 'python']),
  entrypoint: relativePath,
  args: z
    .array(
      z
        .string()
        .max(1024)
        .refine((value) => !value.includes('\0')),
    )
    .max(16),
});
const schema = strictObject({
  schema_version: z.literal(1),
  task_id: IdentifierSchema,
  execution_profile: z.literal('disposable-engineering-candidate'),
  baseline_sha: z.string().regex(/^[a-f0-9]{40}$/),
  sources: z.array(source).min(1).max(32),
  requirements: z.array(requirement).min(1).max(64),
  acceptance: z.array(acceptance).min(1).max(64),
  initial_files: z.array(file).max(64),
  scope: strictObject({ read: paths, write: paths }),
  commands: z.array(command).min(1).max(16),
  limits: AgentLimitsSchema,
  max_failed_corrections: z.number().int().min(0).max(2),
  max_artifact_bytes: z.number().int().positive().max(MAX_BYTES),
  max_output_bytes: z.number().int().positive().max(65_536),
  verifier: strictObject({
    reference: z
      .string()
      .regex(/^verifier:\/\/[a-z0-9][a-z0-9._/-]*$/)
      .max(256),
    sha256: hash,
    acceptance_ids: ids,
  }),
  rollback: z.literal('discard-disposable-workspace'),
});

/**
 * Environment capabilities a task may opt into (schema 2 only). Names are the governed contract names; a task that
 * declares none keeps today's behavior and its digest, and a capability that is not declared is denied by the policy.
 */
const ENVIRONMENT_CAPABILITIES = Object.freeze([
  'environment.lsp.diagnostics',
  'environment.lsp.definition',
  'environment.lsp.references',
  'environment.lsp.hover',
  'environment.lsp.rename_preview',
  'environment.dap.run',
  'environment.browser.run',
  'environment.computer.start',
  'environment.computer.screenshot',
  'environment.computer.act',
  'environment.computer.stop',
  'memory.write',
  'memory.retrieve',
  'memory.delete',
]);
// A computer session is opened by `start`: every other computer capability is meaningless without it.
const COMPUTER_DEPENDENT = Object.freeze(['environment.computer.screenshot', 'environment.computer.act', 'environment.computer.stop']);

const projectPath = z.string().min(1).max(PROJECT_LIMITS.store_path_chars).refine(isProjectPath);
const projectPaths = z
  .array(projectPath)
  .min(1)
  .max(PROJECT_LIMITS.total_paths)
  .refine((list) => ordinaryCount(list) <= PROJECT_LIMITS.ordinary_paths);
const commandLimits = strictObject({
  pids_max: z.number().int().min(32).max(256).optional(),
  memory_max_bytes: z.number().int().min(268_435_456).max(2_147_483_648).optional(),
  nofile: z.number().int().min(64).max(4096).optional(),
});
const projectSchema = schema.extend({
  initial_files: z
    .array(file.extend({ path: projectPath, content: z.string().max(PROJECT_LIMITS.large_file_chars) }))
    .max(PROJECT_LIMITS.total_paths)
    .refine((list) => ordinaryCount(list.map((entry) => entry.path)) <= PROJECT_LIMITS.ordinary_paths),
  scope: strictObject({ read: projectPaths, write: projectPaths }),
  commands: z
    .array(command.extend({ entrypoint: projectPath, limits: commandLimits.optional() }))
    .min(1)
    .max(16),
  max_artifact_bytes: z.number().int().positive().max(PROJECT_LIMITS.artifact_bytes),
  schema_version: z.literal(2),
  execution_profile: z.literal('managed-project'),
  environment: strictObject({
    capabilities: z.array(z.enum(ENVIRONMENT_CAPABILITIES)).min(1).max(ENVIRONMENT_CAPABILITIES.length),
  }).optional(),
  workspace: strictObject({
    root: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => value.startsWith('/') && !value.includes('\0')),
    files_sha256: hash,
    // The controller mounts the project's own node_modules/.pnpm read-only; store files are then never copied into the task.
    store_mount: z.literal('pnpm-virtual-store').optional(),
  }),
  verifier: strictObject({
    reference: z.enum(['verifier://project/node-module-v1', 'verifier://project/python-module-v1', 'verifier://project/web-content-v1']),
    sha256: hash,
    acceptance_ids: ids,
    checks: z
      .array(
        strictObject({
          path: projectPath,
          export_name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
          args: z.array(z.json()).max(16),
          expected: z.json(),
        }),
      )
      .min(1)
      .max(64),
    command_checks: z
      .array(strictObject({ command_id: IdentifierSchema, timeout_ms: z.number().int().min(1).max(300_000).optional() }))
      .min(1)
      .max(16)
      .optional(),
    protected_paths: projectPaths.optional(),
  }),
});
const versionedSchema = z.discriminatedUnion('schema_version', [schema, projectSchema]);

class EngineeringTaskContractError extends Error {
  constructor(reason = 'ENGINEERING_CONTRACT_INVALID') {
    super('Engineering task contract is invalid, unbounded, inconsistent, or changed while reading.');
    this.code = 'ENGINEERING_TASK_CONTRACT_INVALID';
    // Curated cause surfaced as `detail.code` by the control API; `code` stays the compatibility category.
    this.reason = reason;
  }
}

function requireCondition(condition, reason) {
  if (!condition) throw new EngineeringTaskContractError(reason);
}

function unique(values, reason = 'ENGINEERING_DUPLICATE_ID') {
  requireCondition(new Set(values).size === values.length, reason);
  return new Set(values);
}

/**
 * Configuration files a command may read implicitly. When one is present in the workspace it must be protected so the
 * model cannot rewrite what judges it. The list only grows, by a new version; reading is never inferred from a command.
 */
const PROTECTED_CONFIG_FILES = Object.freeze({
  version: 1,
  patterns: Object.freeze([
    /^package\.json$/,
    /^tsconfig[^/]*\.json$/,
    /^vitest\.config\.[^/]+$/,
    /^vite\.config\.[^/]+$/,
    /^\.npmrc$/,
    /^pnpm-workspace\.yaml$/,
  ]),
});
const isKnownConfigFile = (entry) =>
  !isStorePath(entry) && PROTECTED_CONFIG_FILES.patterns.some((pattern) => pattern.test(entry.slice(entry.lastIndexOf('/') + 1)));

/** Conservative argument alphabet for acceptance commands: identifier/relative path, `--name[=value]` or one short flag. */
const ARG_WORD = '[A-Za-z0-9._@/-]+';
const ARG_FORMS = [/^[A-Za-z0-9._@/][A-Za-z0-9._@/-]*$/, new RegExp(`^--[A-Za-z0-9][A-Za-z0-9._@/-]*(?:=${ARG_WORD})?$`), /^-[A-Za-z]$/];
const isConservativeArg = (arg) => ARG_FORMS.some((form) => form.test(arg));

const declaredPaths = (contract) => [
  ...contract.scope.read,
  ...contract.scope.write,
  ...contract.initial_files.map((entry) => entry.path),
  ...contract.commands.map((entry) => entry.entrypoint),
  ...(contract.verifier.checks || []).map((entry) => entry.path),
  ...(contract.verifier.protected_paths || []),
];

/**
 * Admission rules for new schema 2 tasks (never applied when re-reading a contract that was already admitted):
 * acceptance must be executable, either through protected `command_checks` or through a pinned module verifier
 * (`node-module-v1`/`python-module-v1`) that runs the candidate against expectations fixed in the contract. The
 * checked module is the artifact under test, so it stays writable; `web-content-v1` is static text matching and never
 * satisfies this rule. Coverage is global through `verifier.acceptance_ids`, which the parse
 * already equates with every `acceptance.id`; a per-criterion link is not part of the contract.
 */
function requireExecutableAcceptance(contract, protectedPaths) {
  const commandChecks = contract.verifier.command_checks || [];
  const declared = new Map(contract.commands.map((item) => [item.id, item]));
  for (const { command_id: id } of commandChecks)
    for (const arg of declared.get(id).args) requireCondition(isConservativeArg(arg), 'ENGINEERING_COMMAND_ARG_INVALID');
  const present = [...new Set([...contract.scope.read, ...contract.initial_files.map((item) => item.path)])];
  const modules = ['verifier://project/node-module-v1', 'verifier://project/python-module-v1'].includes(contract.verifier.reference);
  if (commandChecks.length > 0) {
    for (const entry of present.filter(isKnownConfigFile))
      requireCondition(protectedPaths.has(entry), 'ENGINEERING_PROTECTED_CONFIG_MISSING');
    return;
  }
  requireCondition(modules, 'ENGINEERING_ACCEPTANCE_WEAK');
}

function parseEngineeringTask(value, { admission = false } = {}) {
  const parsed = versionedSchema.safeParse(value);
  requireCondition(parsed.success, 'ENGINEERING_CONTRACT_SCHEMA_INVALID');
  const contract = parsed.data;
  // The wider v2 ceilings exist only for contracts that carry pnpm store paths; everything else keeps the original limits.
  const storeBacked = contract.schema_version === 2 && declaredPaths(contract).some(isStorePath);
  requireCondition(
    Buffer.byteLength(canonicalJson(contract)) <= (storeBacked ? PROJECT_LIMITS.contract_bytes : MAX_BYTES),
    'ENGINEERING_CONTRACT_TOO_LARGE',
  );
  requireCondition(storeBacked || contract.max_artifact_bytes <= MAX_BYTES, 'ENGINEERING_CONTRACT_TOO_LARGE');
  requireCondition(!(contract.workspace?.store_mount && storeBacked), 'ENGINEERING_STORE_MOUNT_CONFLICT');
  const sourceIds = unique(contract.sources.map((item) => item.id));
  const requirementIds = unique(contract.requirements.map((item) => item.id));
  const acceptanceIds = unique(contract.acceptance.map((item) => item.id));
  const readPaths = unique(contract.scope.read, 'ENGINEERING_SCOPE_INVALID');
  const writePaths = unique(contract.scope.write, 'ENGINEERING_SCOPE_INVALID');
  unique(
    contract.initial_files.map((item) => item.path),
    'ENGINEERING_INITIAL_FILES_INVALID',
  );
  unique(contract.commands.map((item) => item.id));
  const allPaths = [...new Set([...readPaths, ...writePaths])];
  requireCondition(
    storeBacked
      ? allPaths.length <= PROJECT_LIMITS.total_paths && ordinaryCount(allPaths) <= PROJECT_LIMITS.ordinary_paths
      : allPaths.length <= 64,
    'ENGINEERING_SCOPE_INVALID',
  );
  requireCondition(!allPaths.some((entry) => allPaths.some((other) => other.startsWith(`${entry}/`))), 'ENGINEERING_SCOPE_INVALID');
  for (const entry of writePaths) requireCondition(readPaths.has(entry), 'ENGINEERING_SCOPE_INVALID');
  for (const item of contract.sources) requireCondition(sha(item.content) === item.sha256, 'ENGINEERING_SOURCE_DIGEST_MISMATCH');
  const usedSources = new Set();
  for (const item of contract.requirements) {
    for (const id of unique(item.source_ids)) {
      requireCondition(sourceIds.has(id), 'ENGINEERING_TRACEABILITY_BROKEN');
      usedSources.add(id);
    }
  }
  requireCondition(usedSources.size === sourceIds.size, 'ENGINEERING_TRACEABILITY_BROKEN');
  const covered = new Set();
  for (const item of contract.acceptance) {
    for (const id of unique(item.requirement_ids)) {
      requireCondition(requirementIds.has(id), 'ENGINEERING_TRACEABILITY_BROKEN');
      covered.add(id);
    }
  }
  requireCondition(covered.size === requirementIds.size, 'ENGINEERING_TRACEABILITY_BROKEN');
  const verified = unique(contract.verifier.acceptance_ids);
  requireCondition(
    verified.size === acceptanceIds.size && [...verified].every((id) => acceptanceIds.has(id)),
    'ENGINEERING_ACCEPTANCE_MISMATCH',
  );
  let initialBytes = 0;
  for (const item of contract.initial_files) {
    requireCondition(readPaths.has(item.path) && sha(item.content) === item.sha256, 'ENGINEERING_INITIAL_FILES_INVALID');
    initialBytes += Buffer.byteLength(item.content);
  }
  requireCondition(initialBytes <= contract.max_artifact_bytes, 'ENGINEERING_INITIAL_FILES_INVALID');
  const largeFiles = contract.initial_files.filter((item) => item.content.length > PROJECT_LIMITS.file_chars);
  requireCondition(
    largeFiles.length <= PROJECT_LIMITS.large_files_max &&
      largeFiles.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0) <= PROJECT_LIMITS.large_files_bytes,
    'ENGINEERING_INITIAL_FILES_INVALID',
  );
  for (const item of contract.commands) requireCondition(readPaths.has(item.entrypoint), 'ENGINEERING_COMMAND_ENTRYPOINT_UNREADABLE');
  requireCondition(Object.values(contract.limits).every(Number.isSafeInteger), 'ENGINEERING_LIMITS_INVALID');
  requireCondition(contract.limits.max_children === 0 && contract.limits.max_workflow_steps === 0, 'ENGINEERING_LIMITS_INVALID');
  if (contract.schema_version === 2) {
    if (contract.environment) {
      const declared = unique(contract.environment.capabilities, 'ENGINEERING_ENVIRONMENT_INVALID');
      requireCondition(
        !COMPUTER_DEPENDENT.some((name) => declared.has(name)) || declared.has('environment.computer.start'),
        'ENGINEERING_ENVIRONMENT_INVALID',
      );
    }
    for (const check of contract.verifier.checks) requireCondition(readPaths.has(check.path), 'ENGINEERING_CHECK_PATH_UNREADABLE');
    const protectedPaths = new Set(unique(contract.verifier.protected_paths || [], 'ENGINEERING_PROTECTED_PATH_INVALID'));
    for (const entry of protectedPaths)
      requireCondition(readPaths.has(entry) && !writePaths.has(entry), 'ENGINEERING_PROTECTED_PATH_INVALID');
    if (contract.verifier.command_checks) {
      const declared = new Map(contract.commands.map((item) => [item.id, item]));
      for (const id of unique(contract.verifier.command_checks.map((item) => item.command_id))) {
        const entry = declared.get(id);
        requireCondition(entry, 'ENGINEERING_COMMAND_CHECK_UNKNOWN');
        // The model must not be able to rewrite what judges it: entrypoint is protected, never writable.
        requireCondition(
          protectedPaths.has(entry.entrypoint) && !writePaths.has(entry.entrypoint),
          'ENGINEERING_COMMAND_ENTRYPOINT_UNPROTECTED',
        );
        for (const arg of entry.args) {
          // Check the whole argument and the value after `=`, resolved against the project root.
          for (const candidate of new Set([arg, arg.slice(arg.indexOf('=') + 1)])) {
            const relative = path.relative(contract.workspace.root, path.resolve(contract.workspace.root, candidate));
            requireCondition(!relative.startsWith('..') && !path.isAbsolute(relative), 'ENGINEERING_COMMAND_ARG_OUTSIDE_ROOT');
            requireCondition(!writePaths.has(relative), 'ENGINEERING_COMMAND_ARG_WRITABLE');
          }
        }
      }
    }
    if (contract.initial_files.length > 0) {
      const byPath = new Map(contract.initial_files.map((item) => [item.path, item.sha256]));
      requireCondition(
        sha(canonicalJson(contract.scope.read.map((path) => ({ path, sha256: byPath.get(path) || null })))) ===
          contract.workspace.files_sha256,
        'ENGINEERING_WORKSPACE_DIGEST_MISMATCH',
      );
    }
    if (admission) requireExecutableAcceptance(contract, protectedPaths);
  }
  return deepFreeze(contract);
}

function readEngineeringTask(filename) {
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    requireCondition(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= MAX_BYTES);
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const after = fs.fstatSync(fd);
    const current = fs.lstatSync(filename);
    requireCondition(
      bytes === before.size &&
        after.size === before.size &&
        after.mtimeMs === before.mtimeMs &&
        after.ctimeMs === before.ctimeMs &&
        current.ino === before.ino &&
        current.dev === before.dev &&
        !current.isSymbolicLink(),
    );
    let contract = parseEngineeringTask(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes))));
    if (contract.schema_version === 2) contract = parseEngineeringTask(require('./engineering-workspace').hydrateProjectTask(contract));
    return deepFreeze({ contract, sha256: sha(canonicalJson(contract)) });
  } catch {
    throw new EngineeringTaskContractError();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = {
  ENVIRONMENT_CAPABILITIES,
  EngineeringTaskContractError,
  PROJECT_LIMITS,
  PROTECTED_CONFIG_FILES,
  isProjectPath,
  isStorePath,
  parseEngineeringTask,
  readEngineeringTask,
};
