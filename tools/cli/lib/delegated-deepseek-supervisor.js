'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildAiJailArgs, getProfile, resolveCommand, resolveSandbox, sandboxDoctor } = require('./sandbox');
const {
  BoundKernelSupervisorError,
  collectChild,
  createAttestation,
  probeExactSandboxProfile,
  validateLockdownProfile,
  validateReadiness,
} = require('./bound-kernel-supervisor');
const { PROFILE_ID, bindingDigest, readBinding } = require('./delegated-deepseek-runtime');

const WORKER = path.join(__dirname, 'delegated-deepseek-worker.js');

class DelegatedDeepSeekSupervisorError extends Error {
  constructor(message, code = 'DELEGATED_DEEPSEEK_SUPERVISOR_INVALID') {
    super(message);
    this.name = 'DelegatedDeepSeekSupervisorError';
    this.code = code;
  }
}

function canonicalDirectory(value, label) {
  try {
    const resolved = fs.realpathSync(path.resolve(value));
    if (!fs.statSync(resolved).isDirectory()) throw new Error('not a directory');
    return resolved;
  } catch {
    throw new DelegatedDeepSeekSupervisorError(`${label} must be an existing canonical directory`);
  }
}

function requireInside(projectDir, value, label) {
  const relative = path.relative(projectDir, value);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return;
  throw new DelegatedDeepSeekSupervisorError(`${label} must be inside the sandboxed project`);
}

function selectedEnvironment(binding, source) {
  const environment = { PATH: source.PATH || '', HSEOS_DISABLE_UPDATE_CHECK: '1' };
  const protectedValues = [];
  for (const name of binding.env_names) {
    let value;
    try {
      value = Object.hasOwn(source, name) ? source[name] : undefined;
    } catch {
      value = undefined;
    }
    if (binding.secret_env_names.includes(name) && (typeof value !== 'string' || value.length === 0)) {
      throw new DelegatedDeepSeekSupervisorError('declared DeepSeek secret is unavailable', 'DELEGATED_DEEPSEEK_SECRET_UNAVAILABLE');
    }
    if (value !== undefined) {
      environment[name] = value;
      if (binding.secret_env_names.includes(name)) protectedValues.push(value);
    }
  }
  return { environment, protectedValues };
}

function workerResult(execution, protectedValues) {
  if (protectedValues.some((value) => execution.stdout.includes(value))) {
    throw new DelegatedDeepSeekSupervisorError('sandboxed worker output contains a protected value', 'DELEGATED_DEEPSEEK_SECRET_EXPOSURE');
  }
  let envelope;
  try {
    envelope = JSON.parse(execution.stdout);
  } catch {
    envelope = null;
  }
  if (execution.status !== 0 || execution.signal) {
    if (envelope?.ok === false) {
      throw new DelegatedDeepSeekSupervisorError(envelope.error?.message || 'sandboxed DeepSeek worker failed', envelope.error?.code);
    }
    throw new DelegatedDeepSeekSupervisorError(
      'sandboxed DeepSeek worker terminated unsuccessfully',
      'DELEGATED_DEEPSEEK_SANDBOX_EXECUTION_FAILED',
    );
  }
  if (!envelope) throw new DelegatedDeepSeekSupervisorError('sandboxed DeepSeek worker returned non-JSON output');
  if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
    throw new DelegatedDeepSeekSupervisorError('sandboxed DeepSeek worker returned a malformed envelope');
  }
  if (!envelope.ok) throw new DelegatedDeepSeekSupervisorError(envelope.error?.message || 'sandboxed DeepSeek worker failed', envelope.error?.code);
  if (envelope.result?.profile !== PROFILE_ID || envelope.result?.lifecycle !== 'one_shot') {
    throw new DelegatedDeepSeekSupervisorError('sandboxed DeepSeek worker returned an invalid result');
  }
  return envelope.result;
}

async function runSupervisedDelegatedDeepSeek(options = {}, dependencies = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new DelegatedDeepSeekSupervisorError('options are invalid');
  if (typeof options.binding !== 'string' || options.binding.length === 0) throw new DelegatedDeepSeekSupervisorError('binding is required');
  const projectDir = canonicalDirectory(options.projectDir || process.cwd(), 'projectDir');
  const sourceEnvironment = options.environment || process.env;
  const bindingPath = fs.realpathSync(path.resolve(options.binding));
  const binding = readBinding(bindingPath);
  requireInside(projectDir, bindingPath, 'delegated DeepSeek binding');
  requireInside(projectDir, binding.entrypoint, 'delegated DeepSeek entrypoint');
  requireInside(projectDir, binding.composition, 'delegated DeepSeek composition');
  requireInside(projectDir, binding.cwd, 'delegated DeepSeek cwd');
  const resolved = resolveSandbox(projectDir);
  if (resolved.parseError || resolved.sandbox.provider !== 'ai-jail') {
    throw new DelegatedDeepSeekSupervisorError('required ai-jail configuration is invalid', 'DELEGATED_DEEPSEEK_SANDBOX_UNAVAILABLE');
  }
  const exactProfile = validateLockdownProfile(getProfile(resolved.sandbox, 'lockdown').profile, String(binding.network_port));
  const readiness = await (dependencies.readinessCheck || sandboxDoctor)(projectDir, sourceEnvironment, { forceRequired: true });
  try {
    validateReadiness(readiness);
  } catch (error) {
    if (error instanceof BoundKernelSupervisorError) {
      throw new DelegatedDeepSeekSupervisorError(error.message, 'DELEGATED_DEEPSEEK_SANDBOX_UNAVAILABLE');
    }
    throw error;
  }
  const binary = resolveCommand(resolved.sandbox.binary || 'ai-jail', sourceEnvironment);
  const exactProfileReady = await (dependencies.profileReadinessCheck || probeExactSandboxProfile)({
    binaryPath: binary.path,
    cwd: projectDir,
    environment: sourceEnvironment,
    sandbox: resolved.sandbox,
  });
  if (exactProfileReady !== true) {
    throw new DelegatedDeepSeekSupervisorError(
      'the exact configured lockdown profile could not execute',
      'DELEGATED_DEEPSEEK_SANDBOX_PROFILE_UNAVAILABLE',
    );
  }
  const attestation = createAttestation({ binary, profile: exactProfile, port: String(binding.network_port) });
  const args = buildAiJailArgs({ sandbox: resolved.sandbox, profileName: 'lockdown', command: [process.execPath, WORKER] });
  const childEnvironment = selectedEnvironment(binding, sourceEnvironment);
  const payload = {
    schema_version: 1,
    binding: bindingPath,
    binding_sha256: bindingDigest(binding),
    message: options.message,
    session_id: options.sessionId,
    attestation,
  };
  for (const key of ['message', 'session_id']) if (payload[key] === undefined) delete payload[key];
  const execution = await collectChild(binary.path, args, {
    cwd: projectDir,
    environment: childEnvironment.environment,
    input: `${JSON.stringify(payload)}\n`,
    spawnImpl: dependencies.spawnImpl,
    timeoutMs: dependencies.timeoutMs,
  });
  return workerResult(execution, childEnvironment.protectedValues);
}

module.exports = { DelegatedDeepSeekSupervisorError, runSupervisedDelegatedDeepSeek };
