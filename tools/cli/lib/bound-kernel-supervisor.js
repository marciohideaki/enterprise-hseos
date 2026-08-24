'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { canonicalJson } = require('../../../packages/agent-session-store');
const { readProviderBinding } = require('../../lib/agent-provider-binding');
const { CANDIDATE_PROFILE } = require('../../lib/agentic-activation-rehearsal');
const { openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');
const { readBoundManifest } = require('./bound-kernel-agent-runtime');
const { buildAiJailArgs, getProfile, resolveCommand, resolveSandbox, sandboxDoctor } = require('./sandbox');

const WORKER = path.join(__dirname, 'bound-kernel-worker.js');
const PROFILE = 'lockdown';
const MAX_CHILD_OUTPUT_BYTES = 1_048_576;
const MAX_BINARY_BYTES = 67_108_864;
const DEFAULT_TIMEOUT_MS = 120_000;
const SAFE_FLAGS = new Set(['--lockdown', '--no-save-config', '--exec', '--private-home', '--no-docker', '--no-display', '--no-gpu']);
const REQUIRED_FLAGS = ['--lockdown', '--no-save-config', '--exec'];
const REQUIRED_MASKS = ['.env', '.env.local', 'credentials.json', 'secrets.yml'];

class BoundKernelSupervisorError extends Error {
  constructor(message, code = 'BOUND_KERNEL_SUPERVISOR_INVALID') {
    super(message);
    this.name = 'BoundKernelSupervisorError';
    this.code = code;
  }
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BoundKernelSupervisorError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new BoundKernelSupervisorError(`${label} has an invalid shape`);
}

function endpointPort(binding) {
  const endpoint = new URL(binding.provider.base_url);
  return endpoint.port || (endpoint.protocol === 'https:' ? '443' : '80');
}

function assertUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new BoundKernelSupervisorError(`${label} must contain non-empty strings`);
  }
  if (new Set(values).size !== values.length) throw new BoundKernelSupervisorError(`${label} must not contain duplicates`);
}

function validateLockdownProfile(profile, port) {
  exactObject(profile, ['allow_tcp_ports', 'flags', 'masks', 'ro_maps', 'rw_maps'], 'lockdown profile');
  assertUniqueStrings(profile.flags, 'lockdown flags');
  assertUniqueStrings(profile.masks, 'lockdown masks');
  if (profile.flags.some((flag) => !SAFE_FLAGS.has(flag)) || REQUIRED_FLAGS.some((flag) => !profile.flags.includes(flag))) {
    throw new BoundKernelSupervisorError('lockdown profile contains unapproved or missing flags');
  }
  if (REQUIRED_MASKS.some((mask) => !profile.masks.includes(mask))) {
    throw new BoundKernelSupervisorError('lockdown profile does not mask every required credential file');
  }
  if (!Array.isArray(profile.ro_maps) || profile.ro_maps.length > 0 || !Array.isArray(profile.rw_maps) || profile.rw_maps.length > 0) {
    throw new BoundKernelSupervisorError('bound kernel lockdown does not permit host filesystem maps');
  }
  const ports = (profile.allow_tcp_ports || []).map(String);
  if (ports.length !== 1 || ports[0] !== port) {
    throw new BoundKernelSupervisorError(`lockdown must allow exactly the selected provider TCP port ${port}`);
  }
  return Object.freeze({
    flags: [...profile.flags],
    masks: [...profile.masks],
    ro_maps: [],
    rw_maps: [],
    allow_tcp_ports: [port],
  });
}

function bindingForOperation(operation, options) {
  if (operation === 'run') return readProviderBinding(path.resolve(options.bindingPath)).binding;
  const handle = openExecutionLedgerFileFixture(path.resolve(options.state));
  try {
    return readBoundManifest(handle.directory).binding;
  } finally {
    handle.close();
  }
}

function validateReadiness(result) {
  if (
    !result ||
    result.ok !== true ||
    result.provider !== 'ai-jail' ||
    result.required !== true ||
    !Array.isArray(result.checks) ||
    result.checks.some((check) => check.required && !check.ok)
  ) {
    throw new BoundKernelSupervisorError('required ai-jail readiness checks did not pass', 'BOUND_KERNEL_SANDBOX_UNAVAILABLE');
  }
}

function binaryDigest(binary) {
  if (binary.size > MAX_BINARY_BYTES) throw new BoundKernelSupervisorError('sandbox binary exceeds the attestation byte limit');
  return createHash('sha256').update(fs.readFileSync(binary.path)).digest('hex');
}

function probeExactSandboxProfile({ binaryPath, cwd, environment, sandbox, spawnSyncImpl = spawnSync }) {
  const args = buildAiJailArgs({ sandbox, profileName: PROFILE, command: ['/usr/bin/true'] });
  let result;
  try {
    result = spawnSyncImpl(binaryPath, args, {
      cwd,
      env: { PATH: environment.PATH || '', HSEOS_DISABLE_UPDATE_CHECK: '1' },
      encoding: 'utf8',
      maxBuffer: 65_536,
      timeout: 15_000,
    });
  } catch {
    return false;
  }
  return result?.status === 0 && !result.signal && !result.error;
}

function createAttestation({ binary, profile, port }) {
  const evidence = {
    schema_version: 1,
    provider: 'ai-jail',
    profile: PROFILE,
    binary_path: binary.path,
    binary_sha256: binaryDigest(binary),
    flags: profile.flags,
    masks: profile.masks,
    ro_maps: profile.ro_maps,
    rw_maps: profile.rw_maps,
    allow_tcp_ports: [port],
  };
  const digest = createHash('sha256').update(canonicalJson(evidence)).digest('hex');
  return Object.freeze({ provider: 'ai-jail', profile: PROFILE, evidence_ref: `sandbox://ai-jail/lockdown/sha256/${digest}` });
}

function secretEnvironment(binding, operation, options, environment) {
  const child = { PATH: environment.PATH || '', HSEOS_DISABLE_UPDATE_CHECK: '1' };
  const dispatchPossible = operation === 'resume' || (operation === 'run' && options.createOnly !== true);
  if (!dispatchPossible || operation === 'cancel') return { environment: child, protectedValues: [] };
  const reference = binding.provider.secret_refs[0];
  if (!reference.source_ref.startsWith('env://')) {
    throw new BoundKernelSupervisorError('public bound-kernel execution currently supports only env secret references');
  }
  const name = reference.source_ref.slice('env://'.length);
  let value;
  try {
    value = Object.hasOwn(environment, name) ? environment[name] : undefined;
  } catch {
    value = undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new BoundKernelSupervisorError('declared provider secret is unavailable', 'BOUND_KERNEL_PROVIDER_SECRET_UNAVAILABLE');
  }
  child[name] = value;
  return { environment: child, protectedValues: [value] };
}

function collectChild(binary, args, { cwd, environment, input, spawnImpl = spawn, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(binary, args, { cwd, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      reject(new BoundKernelSupervisorError('sandboxed bound-kernel worker could not start', 'BOUND_KERNEL_WORKER_START_FAILED'));
      return;
    }
    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const fail = (message, code) => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may already be closed.
      }
      finish(() => reject(new BoundKernelSupervisorError(message, code)));
    };
    const timer = setTimeout(() => fail('sandboxed bound-kernel worker exceeded its deadline', 'BOUND_KERNEL_WORKER_TIMEOUT'), timeoutMs);
    timer.unref?.();
    child.on('error', () => fail('sandboxed bound-kernel worker could not start', 'BOUND_KERNEL_WORKER_START_FAILED'));
    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length > MAX_CHILD_OUTPUT_BYTES) return fail('sandboxed worker output exceeds its byte limit');
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_CHILD_OUTPUT_BYTES) fail('sandboxed worker error output exceeds its byte limit');
    });
    child.on('close', (status, signal) => finish(() => resolve({ status, signal, stdout: stdout.toString('utf8') })));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function validateWorkerResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ok !== 'boolean') {
    throw new BoundKernelSupervisorError('sandboxed worker returned a malformed envelope');
  }
  if (!value.ok) {
    const code = typeof value.error?.code === 'string' ? value.error.code : 'BOUND_KERNEL_WORKER_FAILED';
    const message = typeof value.error?.message === 'string' ? value.error.message : 'sandboxed bound-kernel worker failed';
    throw new BoundKernelSupervisorError(message, code);
  }
  exactObject(value, ['ok', 'result'], 'worker success');
  if (value.result?.profile !== CANDIDATE_PROFILE || value.result?.operational !== false) {
    throw new BoundKernelSupervisorError('sandboxed worker returned an invalid profile result');
  }
  return value.result;
}

function workerOptions(operation, options) {
  const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
  if (operation === 'run') {
    return compact({
      bindingPath: path.resolve(options.bindingPath),
      createOnly: options.createOnly === true,
      message: options.message,
      sessionId: options.sessionId,
      value: options.value,
    });
  }
  if (operation === 'resume') {
    return compact({ expectedSequence: options.expectedSequence, message: options.message, state: path.resolve(options.state) });
  }
  return compact({ reason: options.reason, state: path.resolve(options.state) });
}

function validateOperationOptions(operation, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new BoundKernelSupervisorError('bound-kernel options must be an object');
  }
  if (operation === 'run' && (typeof options.bindingPath !== 'string' || options.bindingPath.length === 0)) {
    throw new BoundKernelSupervisorError('bindingPath is required for a new bound-kernel run');
  }
  if (operation !== 'run' && (typeof options.state !== 'string' || options.state.length === 0)) {
    throw new BoundKernelSupervisorError(`state is required for bound-kernel ${operation}`);
  }
  if (operation === 'resume' && (!Number.isSafeInteger(options.expectedSequence) || options.expectedSequence < 0)) {
    throw new BoundKernelSupervisorError('expected_sequence is required and must be a non-negative safe integer');
  }
  const allowed = {
    run: ['bindingPath', 'createOnly', 'environment', 'message', 'projectDir', 'sessionId', 'value'],
    resume: ['environment', 'expectedSequence', 'message', 'projectDir', 'state'],
    cancel: ['environment', 'projectDir', 'reason', 'state'],
  };
  if (Object.entries(options).some(([key, value]) => value !== undefined && !allowed[operation].includes(key))) {
    throw new BoundKernelSupervisorError(`bound-kernel ${operation} options contain an unsupported field`);
  }
}

async function runSupervisedBoundKernel(operation, options = {}, dependencies = {}) {
  if (!['run', 'resume', 'cancel'].includes(operation)) throw new BoundKernelSupervisorError('bound-kernel operation is unsupported');
  validateOperationOptions(operation, options);
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const environment = options.environment || process.env;
  const binding = bindingForOperation(operation, options);
  const resolved = resolveSandbox(projectDir);
  if (resolved.parseError || resolved.sandbox.provider !== 'ai-jail') {
    throw new BoundKernelSupervisorError('required ai-jail configuration is invalid', 'BOUND_KERNEL_SANDBOX_UNAVAILABLE');
  }
  const { profile } = getProfile(resolved.sandbox, PROFILE);
  const port = endpointPort(binding);
  const exactProfile = validateLockdownProfile(profile, port);
  const readiness = await (dependencies.readinessCheck || sandboxDoctor)(projectDir, environment, { forceRequired: true });
  validateReadiness(readiness);
  const binary = resolveCommand(resolved.sandbox.binary || 'ai-jail', environment);
  const exactProfileReady = await (dependencies.profileReadinessCheck || probeExactSandboxProfile)({
    binaryPath: binary.path,
    cwd: projectDir,
    environment,
    sandbox: resolved.sandbox,
  });
  if (exactProfileReady !== true) {
    throw new BoundKernelSupervisorError(
      'the exact configured lockdown profile could not execute',
      'BOUND_KERNEL_SANDBOX_PROFILE_UNAVAILABLE',
    );
  }
  const attestation = createAttestation({ binary, profile: exactProfile, port });
  const command = [process.execPath, WORKER];
  const args = buildAiJailArgs({ sandbox: resolved.sandbox, profileName: PROFILE, command });
  const payload = { schema_version: 1, operation, options: workerOptions(operation, options), attestation };
  const protectedEnvironment = secretEnvironment(binding, operation, options, environment);
  const execution = await collectChild(binary.path, args, {
    cwd: projectDir,
    environment: protectedEnvironment.environment,
    input: `${JSON.stringify(payload)}\n`,
    spawnImpl: dependencies.spawnImpl,
    timeoutMs: dependencies.timeoutMs,
  });
  if (protectedEnvironment.protectedValues.some((value) => execution.stdout.includes(value))) {
    throw new BoundKernelSupervisorError('sandboxed worker output contains a protected value', 'BOUND_KERNEL_SECRET_EXPOSURE');
  }
  let envelope;
  try {
    envelope = JSON.parse(execution.stdout);
  } catch {
    envelope = null;
  }
  if (execution.status !== 0 || execution.signal) {
    if (envelope?.ok === false) return validateWorkerResult(envelope);
    throw new BoundKernelSupervisorError('sandboxed worker terminated unsuccessfully', 'BOUND_KERNEL_SANDBOX_EXECUTION_FAILED');
  }
  if (!envelope) throw new BoundKernelSupervisorError('sandboxed worker returned non-JSON output');
  return validateWorkerResult(envelope);
}

module.exports = {
  BoundKernelSupervisorError,
  MAX_CHILD_OUTPUT_BYTES,
  collectChild,
  createAttestation,
  probeExactSandboxProfile,
  runSupervisedBoundKernel,
  validateLockdownProfile,
  validateOperationOptions,
  validateReadiness,
};
