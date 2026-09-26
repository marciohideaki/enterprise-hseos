'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { AgentLimitsSchema, IdentifierSchema, strictObject, deepFreeze, z } = require('../../../packages/agent-runtime-contracts');
const { canonicalJson } = require('../../../packages/agent-session-store');

const MAX_BYTES = 1_048_576;
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

class EngineeringTaskContractError extends Error {
  constructor() {
    super('Engineering task contract is invalid, unbounded, inconsistent, or changed while reading.');
    this.code = 'ENGINEERING_TASK_CONTRACT_INVALID';
  }
}

function requireCondition(condition) {
  if (!condition) throw new EngineeringTaskContractError();
}

function unique(values) {
  requireCondition(new Set(values).size === values.length);
  return new Set(values);
}

function parseEngineeringTask(value) {
  const parsed = schema.safeParse(value);
  requireCondition(parsed.success);
  const contract = parsed.data;
  requireCondition(Buffer.byteLength(canonicalJson(contract)) <= MAX_BYTES);
  const sourceIds = unique(contract.sources.map((item) => item.id));
  const requirementIds = unique(contract.requirements.map((item) => item.id));
  const acceptanceIds = unique(contract.acceptance.map((item) => item.id));
  const readPaths = unique(contract.scope.read);
  const writePaths = unique(contract.scope.write);
  unique(contract.initial_files.map((item) => item.path));
  unique(contract.commands.map((item) => item.id));
  const allPaths = [...new Set([...readPaths, ...writePaths])];
  requireCondition(allPaths.length <= 64);
  requireCondition(!allPaths.some((entry) => allPaths.some((other) => other.startsWith(`${entry}/`))));
  for (const entry of writePaths) requireCondition(readPaths.has(entry));
  for (const item of contract.sources) requireCondition(sha(item.content) === item.sha256);
  const usedSources = new Set();
  for (const item of contract.requirements) {
    for (const id of unique(item.source_ids)) {
      requireCondition(sourceIds.has(id));
      usedSources.add(id);
    }
  }
  requireCondition(usedSources.size === sourceIds.size);
  const covered = new Set();
  for (const item of contract.acceptance) {
    for (const id of unique(item.requirement_ids)) {
      requireCondition(requirementIds.has(id));
      covered.add(id);
    }
  }
  requireCondition(covered.size === requirementIds.size);
  const verified = unique(contract.verifier.acceptance_ids);
  requireCondition(verified.size === acceptanceIds.size && [...verified].every((id) => acceptanceIds.has(id)));
  let initialBytes = 0;
  for (const item of contract.initial_files) {
    requireCondition(readPaths.has(item.path) && sha(item.content) === item.sha256);
    initialBytes += Buffer.byteLength(item.content);
  }
  requireCondition(initialBytes <= contract.max_artifact_bytes);
  for (const item of contract.commands) requireCondition(readPaths.has(item.entrypoint));
  requireCondition(Object.values(contract.limits).every(Number.isSafeInteger));
  requireCondition(contract.limits.max_children === 0 && contract.limits.max_workflow_steps === 0);
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
    const contract = parseEngineeringTask(JSON.parse(buffer.subarray(0, bytes).toString('utf8')));
    return deepFreeze({ contract, sha256: sha(canonicalJson(contract)) });
  } catch {
    throw new EngineeringTaskContractError();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { EngineeringTaskContractError, parseEngineeringTask, readEngineeringTask };
