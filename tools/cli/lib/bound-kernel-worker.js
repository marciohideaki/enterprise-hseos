'use strict';

const { stdin, stdout } = require('node:process');
const fs = require('node:fs');

const { cancelBoundKernelAgent, resumeBoundKernelAgent, runBoundKernelAgent } = require('./bound-kernel-agent-runtime');
const { createUnixSocketFetch } = require('./provider-egress-broker');
const { captureStateSnapshot, restoreStateSnapshot } = require('./bound-kernel-state-snapshot');

const MAX_INPUT_BYTES = 1_048_576;
const OPERATIONS = new Set(['run', 'resume', 'cancel']);

class BoundKernelWorkerError extends Error {
  constructor(message, code = 'BOUND_KERNEL_WORKER_INVALID') {
    super(message);
    this.name = 'BoundKernelWorkerError';
    this.code = code;
  }
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BoundKernelWorkerError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new BoundKernelWorkerError(`${label} has an invalid shape`);
}

function allowedObject(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BoundKernelWorkerError(`${label} must be an object`);
  if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    throw new BoundKernelWorkerError(`${label} has an invalid shape`);
  }
}

function validatePayload(value) {
  exactObject(value, ['attestation', 'operation', 'options', 'schema_version', 'state_snapshot', 'transport'], 'worker payload');
  if (value.schema_version !== 1 || !OPERATIONS.has(value.operation)) throw new BoundKernelWorkerError('worker payload is unsupported');
  const optionShapes = {
    run: { allowed: ['bindingPath', 'createOnly', 'message', 'sessionId', 'value'], required: ['bindingPath', 'createOnly'] },
    resume: { allowed: ['expectedSequence', 'message', 'state'], required: ['expectedSequence', 'state'] },
    cancel: { allowed: ['reason', 'state'], required: ['state'] },
  };
  allowedObject(value.options, optionShapes[value.operation].allowed, optionShapes[value.operation].required, 'worker options');
  if (value.transport !== null) {
    exactObject(value.transport, ['kind', 'socket_path'], 'worker transport');
    if (value.transport.kind !== 'unix-socket' || typeof value.transport.socket_path !== 'string' || !value.transport.socket_path.startsWith('/')) {
      throw new BoundKernelWorkerError('worker transport must be an absolute Unix socket');
    }
  }
  if ((value.operation === 'run' && value.state_snapshot !== null) || (value.operation !== 'run' && !value.state_snapshot)) {
    throw new BoundKernelWorkerError('worker state snapshot does not match the operation');
  }
  return value;
}

async function executeWorkerPayload(input, environment = process.env) {
  const payload = validatePayload(input);
  let restoredState = null;
  if (payload.operation !== 'run') {
    restoredState = restoreStateSnapshot(payload.state_snapshot);
    payload.options = { ...payload.options, state: restoredState };
  }
  const executionAuthorizer = async () => payload.attestation;
  const fetch_impl = payload.transport ? createUnixSocketFetch(payload.transport.socket_path) : undefined;
  const secret_resolver = payload.transport ? async () => 'hseos-supervisor-owned-secret' : undefined;
  let result;
  try {
    if (payload.operation === 'run') {
      result = await runBoundKernelAgent({ ...payload.options, environment, executionAuthorizer, fetch_impl, secret_resolver });
    } else if (payload.operation === 'resume') {
      result = await resumeBoundKernelAgent({ ...payload.options, environment, executionAuthorizer, fetch_impl, secret_resolver });
    } else {
      result = await cancelBoundKernelAgent({ ...payload.options, environment });
    }
    return { result, state_snapshot: captureStateSnapshot(result.state) };
  } finally {
    const state = result?.state || restoredState;
    if (state && fs.existsSync(state)) fs.rmSync(state, { recursive: true, force: true });
  }
}

async function readInput(stream = stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new BoundKernelWorkerError('worker payload exceeds its byte limit');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BoundKernelWorkerError('worker payload is not valid JSON');
  }
}

async function main() {
  try {
    const executed = await executeWorkerPayload(await readInput());
    stdout.write(`${JSON.stringify({ ok: true, ...executed })}\n`);
  } catch (error) {
    stdout.write(
      `${JSON.stringify({
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code.slice(0, 128) : 'BOUND_KERNEL_WORKER_FAILED',
          message: typeof error?.message === 'string' ? error.message.slice(0, 4096) : 'bound kernel worker failed',
        },
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { BoundKernelWorkerError, MAX_INPUT_BYTES, executeWorkerPayload, readInput, validatePayload };
