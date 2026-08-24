'use strict';

const { stdin, stdout } = require('node:process');
const { runDelegatedDeepSeek } = require('./delegated-deepseek-runtime');

const MAX_INPUT_BYTES = 1_048_576;

function validatePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('worker payload must be an object');
  const allowed = new Set(['attestation', 'binding', 'binding_sha256', 'message', 'schema_version', 'session_id']);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    !Object.hasOwn(value, 'attestation') ||
    !Object.hasOwn(value, 'binding') ||
    !Object.hasOwn(value, 'binding_sha256')
  ) {
    throw new Error('worker payload has an invalid shape');
  }
  if (value.schema_version !== 1 || typeof value.binding !== 'string' || !/^[a-f0-9]{64}$/.test(value.binding_sha256)) {
    throw new Error('worker payload is unsupported');
  }
  if (value.message !== undefined && typeof value.message !== 'string') throw new Error('worker message is invalid');
  if (value.session_id !== undefined && typeof value.session_id !== 'string') throw new Error('worker session is invalid');
  return value;
}

async function readInput(stream = stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error('worker payload exceeds its byte limit');
    chunks.push(chunk);
  }
  return validatePayload(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

async function executeWorkerPayload(value, environment = process.env) {
  const payload = validatePayload(value);
  return runDelegatedDeepSeek({
    binding: payload.binding,
    environment,
    expectedBindingSha256: payload.binding_sha256,
    message: payload.message,
    sandboxAttestation: payload.attestation,
    sessionId: payload.session_id,
  });
}

async function main() {
  try {
    const result = await executeWorkerPayload(await readInput());
    stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    stdout.write(`${JSON.stringify({ ok: false, error: { code: error?.code || 'DELEGATED_DEEPSEEK_WORKER_FAILED', message: error?.message || 'worker failed' } })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { executeWorkerPayload, readInput, validatePayload };
