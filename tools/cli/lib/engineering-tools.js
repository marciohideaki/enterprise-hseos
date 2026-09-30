'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { z } = require('zod');
const { governanceRef } = require('../../../packages/tool-runtime');
const { executeIsolatedCommand } = require('../../../packages/agent-isolation-attestation/executor');
const { parseEngineeringTask } = require('./engineering-task-contract');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const LEGACY_NAMES = Object.freeze(['engineering.read', 'engineering.write', 'engineering.command', 'engineering.diagnose']);
const NAMES = Object.freeze([...LEGACY_NAMES, 'engineering.search', 'engineering.patch', 'engineering.diff']);

class EngineeringToolError extends Error {
  constructor(message, code = 'ENGINEERING_SCOPE_DENIED') {
    super(message);
    this.code = code;
  }
}

function createEngineeringTools({ directory, contract: inputContract, policy, deadline, onDiagnosis }) {
  const contract = parseEngineeringTask(inputContract);
  const workspace = path.join(directory, 'workspace');
  const identity = fs.lstatSync(workspace);
  if (
    !identity.isDirectory() ||
    identity.isSymbolicLink() ||
    fs.realpathSync(workspace) !== workspace ||
    policy.host_workspace !== workspace ||
    !Number.isSafeInteger(deadline)
  ) {
    throw new EngineeringToolError('Invalid engineering workspace');
  }
  const active = new Set();
  let executorFailure = false;
  const assertWorkspace = () => {
    const current = fs.lstatSync(workspace);
    if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== identity.ino || current.dev !== identity.dev) {
      throw new EngineeringToolError('Workspace identity changed');
    }
  };
  const resolveFile = (relative, permission) => {
    assertWorkspace();
    if (!contract.scope[permission].includes(relative)) throw new EngineeringToolError('Path is outside the declared scope');
    let parent = workspace;
    const parts = relative.split('/');
    for (const segment of parts.slice(0, -1)) {
      parent = path.join(parent, segment);
      const stat = fs.lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new EngineeringToolError('Path has an unsafe parent');
    }
    return path.join(parent, parts.at(-1));
  };
  const read = (relative) => {
    const filename = resolveFile(relative, 'read');
    let fd;
    try {
      fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > contract.max_artifact_bytes) throw new EngineeringToolError('Unsafe artifact');
      const buffer = Buffer.alloc(contract.max_artifact_bytes + 1);
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const after = fs.fstatSync(fd);
      if (size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
        throw new EngineeringToolError('Artifact changed');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
      return { path: relative, content, sha256: hash(buffer.subarray(0, size)) };
    } catch (error) {
      if (error.code === 'ENOENT') return { path: relative, content: null, sha256: null };
      throw new EngineeringToolError('Artifact cannot be safely read');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };
  const snapshot = () => {
    const files = contract.scope.read.map(read);
    if (files.reduce((sum, file) => sum + Buffer.byteLength(file.content || ''), 0) > contract.max_artifact_bytes) {
      throw new EngineeringToolError('Artifact budget exceeded');
    }
    return files;
  };
  const write = ({ path: relative, expected_sha256, content }) => {
    const filename = resolveFile(relative, 'write');
    const current = read(relative);
    if (current.sha256 !== expected_sha256)
      throw new EngineeringToolError('Artifact precondition changed', 'ENGINEERING_EFFECT_RECONCILIATION_REQUIRED');
    const bytes = snapshot().reduce((sum, file) => sum + (file.path === relative ? 0 : Buffer.byteLength(file.content || '')), 0);
    if (bytes + Buffer.byteLength(content) > contract.max_artifact_bytes) throw new EngineeringToolError('Artifact budget exceeded');
    const temporary = path.join(path.dirname(filename), `.write-${randomUUID()}`);
    try {
      fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
      assertWorkspace();
      fs.renameSync(temporary, filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return read(relative);
  };
  const command = async ({ id }, context) => {
    const declared = contract.commands.find((entry) => entry.id === id);
    if (!declared) throw new EngineeringToolError('Command is not authorized');
    snapshot();
    const remaining = deadline - Date.now();
    if (remaining < 1) throw new EngineeringToolError('Task duration budget exhausted');
    const invocation = executeIsolatedCommand({
      policy,
      host_node: contract.schema_version === 2 && declared.runtime === 'node',
      command:
        declared.runtime === 'node'
          ? [
              '/usr/bin/node',
              ...(contract.schema_version === 2 ? ['--experimental-strip-types'] : []),
              `./${declared.entrypoint}`,
              ...declared.args,
            ]
          : ['/usr/bin/python3', '-I', '-B', `./${declared.entrypoint}`, ...declared.args],
      timeout_ms: Math.min(remaining, 300_000),
      max_output_bytes: contract.max_output_bytes,
      signal: context.signal,
    });
    active.add(invocation);
    try {
      return await invocation;
    } catch (error) {
      executorFailure = true;
      throw error;
    } finally {
      active.delete(invocation);
    }
  };
  const inputs = [
    z.object({ path: z.enum(contract.scope.read) }).strict(),
    z
      .object({
        path: z.enum(contract.scope.write),
        expected_sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        content: z.string().max(contract.max_artifact_bytes),
      })
      .strict(),
    z.object({ id: z.enum(contract.commands.map((entry) => entry.id)) }).strict(),
    z
      .object({
        cause: z.string().trim().min(1).max(2048),
        correction: z.string().trim().min(1).max(2048),
        requirement_ids: z
          .array(z.enum(contract.requirements.map((entry) => entry.id)))
          .min(1)
          .max(contract.requirements.length),
        files_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  ];
  const handlers = [
    (value) => read(value.path),
    write,
    command,
    (value) => {
      if (!onDiagnosis) throw new EngineeringToolError('Diagnostic recording is not configured');
      const files = snapshot();
      return onDiagnosis(value, files);
    },
  ];
  const names = contract.schema_version === 2 ? NAMES : LEGACY_NAMES;
  if (contract.schema_version === 2) {
    inputs.push(
      z.object({ text: z.string().min(1).max(1024), limit: z.number().int().min(1).max(100) }).strict(),
      z
        .object({
          path: z.enum(contract.scope.write),
          expected_sha256: z.string().regex(/^[a-f0-9]{64}$/),
          before: z.string().min(1).max(contract.max_artifact_bytes),
          after: z.string().max(contract.max_artifact_bytes),
        })
        .strict(),
      z.object({}).strict(),
    );
    handlers.push(
      ({ text, limit }) => {
        const matches = [];
        for (const file of snapshot()) {
          const lines = (file.content || '').split('\n');
          for (let index = 0; index < lines.length && matches.length < limit; index++) {
            if (lines[index].includes(text)) matches.push({ path: file.path, line: index + 1, text: lines[index].slice(0, 2048) });
          }
        }
        return { matches };
      },
      ({ path: relative, expected_sha256, before, after }) => {
        const current = read(relative);
        if (current.sha256 !== expected_sha256 || current.content === null || current.content.split(before).length !== 2)
          throw new EngineeringToolError('Patch precondition changed or match is ambiguous', 'ENGINEERING_EFFECT_RECONCILIATION_REQUIRED');
        return write({ path: relative, expected_sha256, content: current.content.replace(before, () => after) });
      },
      () => ({
        baseline_sha: contract.baseline_sha,
        changes: snapshot()
          .filter((file) => file.sha256 !== (contract.initial_files.find((initial) => initial.path === file.path)?.sha256 || null))
          .map((file) => ({
            path: file.path,
            before: contract.initial_files.find((initial) => initial.path === file.path)?.content ?? null,
            after: file.content,
          })),
      }),
    );
  }
  const bundles = names.map((name, index) => ({
    contract: {
      name,
      capability: name,
      provider: `${name}-provider`,
      authority: 'engineering.disposable',
      policy_version: 'engineering-v1',
      reversibility: index === 1 || index === 5 ? 'idempotent_mutation' : 'read_only',
      cancellation_policy: 'cooperative',
      failure_mode: 'fail_closed',
      timeout_ms: Math.min(contract.limits.max_duration_ms + 5000, 3_600_000),
      requires_approval: false,
      exclusive: true,
      provider_accepts_idempotency: true,
      sandbox: { policy_digest: policy.policy_digest },
      prerequisites: [],
      input_schema: { version: 1, safeParse: inputs[index].safeParse.bind(inputs[index]) },
      output_schema: { version: 1, safeParse: z.record(z.string(), z.unknown()).safeParse },
    },
    definition: {
      name,
      description: `Scoped disposable task operation: ${name}`,
      // Serialize to public JSON: Zod also exposes non-JSON standard-schema functions.
      // eslint-disable-next-line unicorn/prefer-structured-clone
      input_schema: JSON.parse(JSON.stringify(z.toJSONSchema(inputs[index]))),
      governance_ref: governanceRef(name),
    },
    provider: {
      async execute(value, context) {
        if (Date.now() >= deadline) throw new EngineeringToolError('Task duration budget exhausted');
        return { data: await handlers[index](value, context), evidence: [`isolation://${policy.policy_digest}`] };
      },
    },
  }));
  return {
    bundles,
    snapshot,
    assertQuiescent() {
      if (active.size > 0 || executorFailure)
        throw new EngineeringToolError('Executor completion could not be attested', 'ENGINEERING_TEARDOWN_UNCERTAIN');
    },
    async drain() {
      await Promise.allSettled(active);
    },
  };
}

module.exports = { EngineeringToolError, ENGINEERING_TOOL_NAMES: NAMES, createEngineeringTools };
