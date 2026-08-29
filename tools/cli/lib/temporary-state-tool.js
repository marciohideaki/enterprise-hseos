'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { z } = require('zod');
const { governanceRef } = require('../../../packages/tool-runtime');

const TOOL_NAME = 'temporary.set-state';
const TOOL_PROVIDER = 'temporary-state-provider';
const WORLD_STATE = path.join('workspace', 'world-state.json');

class TemporaryStateToolError extends Error {
  constructor(message, code = 'TEMPORARY_STATE_TOOL_INVALID') {
    super(message);
    this.name = 'TemporaryStateToolError';
    this.code = code;
  }
}

function assertWorkspace(directory, { create = false } = {}) {
  const workspace = path.join(directory, 'workspace');
  if (create) fs.mkdirSync(workspace, { mode: 0o700 });
  let stat;
  try {
    stat = fs.lstatSync(workspace);
  } catch {
    throw new TemporaryStateToolError('temporary workspace is missing');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new TemporaryStateToolError('temporary workspace is not a private regular directory');
  }
  const canonical = fs.realpathSync(workspace);
  if (path.dirname(canonical) !== directory || canonical !== workspace) {
    throw new TemporaryStateToolError('temporary workspace escapes its fixture');
  }
  return Object.freeze({ path: workspace, dev: stat.dev, ino: stat.ino });
}

function assertSameWorkspace(directory, expected) {
  const current = assertWorkspace(directory);
  if (current.path !== expected.path || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new TemporaryStateToolError('temporary workspace identity changed before the governed effect');
  }
}

function executable(schema) {
  return Object.freeze({ version: 1, safeParse: schema.safeParse.bind(schema) });
}

function createTemporaryStateTool(directory, { createWorkspace = false, sandbox = null, evidenceRefs = [] } = {}) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.some((reference) => typeof reference !== 'string' || reference.length === 0)) {
    throw new TemporaryStateToolError('evidenceRefs must contain non-empty references');
  }
  const workspace = assertWorkspace(directory, { create: createWorkspace });
  const worldStatePath = path.join(directory, WORLD_STATE);
  const input = z.object({ value: z.string().min(1).max(4096) }).strict();
  const output = z.object({ path: z.string().min(1), value: z.string() }).strict();
  return Object.freeze({
    worldStatePath,
    bundle: Object.freeze({
      contract: {
        name: TOOL_NAME,
        capability: TOOL_NAME,
        provider: TOOL_PROVIDER,
        authority: 'temporary.execute',
        policy_version: 'temporary-policy-v1',
        reversibility: 'idempotent_mutation',
        cancellation_policy: 'cooperative',
        failure_mode: 'fail_closed',
        timeout_ms: 1000,
        requires_approval: false,
        exclusive: true,
        provider_accepts_idempotency: true,
        sandbox,
        prerequisites: [],
        input_schema: executable(input),
        output_schema: executable(output),
      },
      definition: {
        name: TOOL_NAME,
        description: 'Write deterministic state inside the private temporary Agent Kernel workspace.',
        input_schema: {
          type: 'object',
          properties: { value: { type: 'string', minLength: 1, maxLength: 4096 } },
          required: ['value'],
          additionalProperties: false,
        },
        governance_ref: governanceRef(TOOL_NAME),
      },
      provider: {
        async execute(value, context) {
          assertSameWorkspace(directory, workspace);
          if (sandbox !== null && JSON.stringify(context.sandbox) !== JSON.stringify(sandbox)) {
            throw new TemporaryStateToolError('governed sandbox binding changed before dispatch');
          }
          const temporary = `${worldStatePath}.${process.pid}.${randomUUID()}.tmp`;
          fs.writeFileSync(temporary, `${JSON.stringify({ schema_version: 1, value: value.value })}\n`, {
            encoding: 'utf8',
            mode: 0o600,
            flag: 'wx',
          });
          fs.renameSync(temporary, worldStatePath);
          return { data: { path: worldStatePath, value: value.value }, evidence: [...evidenceRefs, `file://${worldStatePath}`] };
        },
      },
    }),
  });
}

module.exports = { TOOL_NAME, TOOL_PROVIDER, WORLD_STATE, TemporaryStateToolError, createTemporaryStateTool };
