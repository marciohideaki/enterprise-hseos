'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Database = require('better-sqlite3');
const yaml = require('yaml');

const { CONTRACT_SCHEMA_VERSION, validatePortResult } = require('../../packages/agent-runtime-contracts');
const { OpenAICompatibleModelProvider } = require('../../packages/model-providers');
const { resolveCapabilityPlan } = require('../cli/lib/capability-catalog');
const { sandboxDoctor } = require('../cli/lib/sandbox');
const { databaseFingerprint, snapshotTables } = require('./compatibility-audit');
const { createLiveSnapshot } = require('./compatibility-observation');
const { runMigrations } = require('../mcp-project-state/lib/migrations');
const { assertStableReadOnlyDatabase } = require('../mcp-project-state/lib/mcp-legacy-usage-store');
const { assertOperationalSchemaBoundary } = require('../mcp-project-state/lib/operational-state-db');

const CANDIDATE_PROFILE = 'agent-openai-compatible-candidate';
const CANDIDATE_MANIFEST = path.join('.agents', 'activation', `${CANDIDATE_PROFILE}.yaml`);
const PROVIDER_ID = 'model:openai-compatible';
const MODEL_ID = 'hseos/activation-rehearsal';
const EPHEMERAL_SECRET = 'hseos-rehearsal-ephemeral-secret';

class ActivationRehearsalError extends Error {
  constructor(message, code = 'ACTIVATION_REHEARSAL_INVALID') {
    super(message);
    this.name = 'ActivationRehearsalError';
    this.code = code;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ActivationRehearsalError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new ActivationRehearsalError(`${label} has an invalid shape`);
  }
}

function readCandidateManifest(repositoryRoot) {
  const filename = path.join(repositoryRoot, CANDIDATE_MANIFEST);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new ActivationRehearsalError('candidate manifest must be a single regular file');
  }
  const manifest = yaml.parse(fs.readFileSync(filename, 'utf8'));
  exactKeys(
    manifest,
    ['schema_version', 'profile_id', 'status', 'operational', 'execution', 'provider', 'sandbox', 'activation'],
    'candidate manifest',
  );
  exactKeys(manifest.execution, ['mode', 'model_provider_id', 'runtime_provider_id'], 'candidate execution');
  exactKeys(manifest.provider, ['protocol', 'base_url_ref', 'model_ref', 'secret_refs'], 'candidate provider');
  exactKeys(manifest.sandbox, ['provider', 'required', 'default_profile'], 'candidate sandbox');
  exactKeys(manifest.activation, ['authorized', 'requires'], 'candidate activation');
  if (
    manifest.schema_version !== '1.0' ||
    manifest.profile_id !== CANDIDATE_PROFILE ||
    manifest.status !== 'pre-activation' ||
    manifest.operational !== false ||
    manifest.execution.mode !== 'kernel' ||
    manifest.execution.model_provider_id !== PROVIDER_ID ||
    manifest.execution.runtime_provider_id !== 'runtime:hseos-kernel' ||
    manifest.provider.protocol !== 'openai-compatible-sse' ||
    manifest.provider.base_url_ref !== 'config://hseos/model-provider-base-url' ||
    manifest.provider.model_ref !== 'config://hseos/model-provider-model' ||
    manifest.sandbox.provider !== 'ai-jail' ||
    manifest.sandbox.required !== true ||
    manifest.sandbox.default_profile !== 'lockdown' ||
    manifest.activation.authorized !== false
  ) {
    throw new ActivationRehearsalError('candidate manifest weakens or changes the accepted activation boundary');
  }
  if (
    !Array.isArray(manifest.provider.secret_refs) ||
    manifest.provider.secret_refs.length !== 1 ||
    manifest.provider.secret_refs[0]?.name !== 'api-key' ||
    manifest.provider.secret_refs[0]?.source_ref !== 'secret://hseos/model-provider-api-key'
  ) {
    throw new ActivationRehearsalError('candidate manifest must declare exactly the canonical api-key secret reference');
  }
  exactKeys(manifest.provider.secret_refs[0], ['name', 'source_ref'], 'candidate secret reference');
  const requiredGates = [
    'ADR-0022',
    'ADR-0023',
    'ADR-0024',
    'migration-and-rollback-rehearsal',
    'required-sandbox-readiness',
    'provider-environment-validation',
    'g9-zero-legacy-window',
    'explicit-human-cutover',
  ];
  if (JSON.stringify(manifest.activation.requires) !== JSON.stringify(requiredGates)) {
    throw new ActivationRehearsalError('candidate manifest changes the accepted activation gates');
  }
  return Object.freeze(manifest);
}

function providerManifest(candidate) {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_type: 'model',
    provider_id: PROVIDER_ID,
    provider_version: '1.0.0',
    models: [MODEL_ID],
    capabilities: ['text_generation', 'streaming', 'usage', 'cancellation'],
    limits: { context_tokens: 32_768, max_output_tokens: 256, max_parallel_requests: 1 },
    secret_refs: candidate.provider.secret_refs,
  };
}

function deterministicFetch(expectedReference) {
  return async (url, init) => {
    if (url !== 'http://127.0.0.1/rehearsal/chat/completions')
      throw new ActivationRehearsalError('provider adapter changed its endpoint contract');
    if (init?.headers?.authorization !== `Bearer ${EPHEMERAL_SECRET}`) {
      throw new ActivationRehearsalError('provider adapter did not resolve the declared secret at dispatch');
    }
    const body = JSON.parse(init.body);
    if (body.model !== MODEL_ID || body.stream !== true || body.messages.at(-1)?.content !== 'activation rehearsal') {
      throw new ActivationRehearsalError('provider adapter emitted an unexpected request');
    }
    if (expectedReference.source_ref !== 'secret://hseos/model-provider-api-key') {
      throw new ActivationRehearsalError('provider secret reference changed');
    }
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'candidate-conformant' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } } })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name.toLowerCase() === 'content-type') return 'text/event-stream';
          if (name.toLowerCase() === 'x-request-id') return 'local-rehearsal';
          return null;
        },
      },
      body: (async function* stream() {
        yield Buffer.from(frames);
      })(),
    };
  };
}

async function certifyCandidateProfile(repositoryRoot) {
  const candidate = readCandidateManifest(repositoryRoot);
  const plan = resolveCapabilityPlan({ root: repositoryRoot, profile: CANDIDATE_PROFILE });
  const expectedSecret = candidate.provider.secret_refs[0];
  if (
    plan.agent?.model_provider_id !== PROVIDER_ID ||
    plan.agent?.runtime_provider_id !== 'runtime:hseos-kernel' ||
    JSON.stringify(plan.materialization.secret_refs) !== JSON.stringify([expectedSecret.source_ref]) ||
    !plan.components.some(({ id }) => id === 'capability:sandbox')
  ) {
    throw new ActivationRehearsalError('capability plan differs from the immutable candidate manifest');
  }
  let resolved = 0;
  const provider = new OpenAICompatibleModelProvider({
    manifest: providerManifest(candidate),
    base_url: 'http://127.0.0.1/rehearsal',
    fetch_impl: deterministicFetch(expectedSecret),
    secret_resolver: async (reference) => {
      if (JSON.stringify(reference) !== JSON.stringify(expectedSecret)) throw new ActivationRehearsalError('unexpected secret reference');
      resolved += 1;
      return EPHEMERAL_SECRET;
    },
    max_attempts: 1,
  });
  if (resolved !== 0) throw new ActivationRehearsalError('provider resolved a secret before dispatch');
  const input = {
    schema_version: CONTRACT_SCHEMA_VERSION,
    request_id: 'request:activation-rehearsal',
    provider_id: PROVIDER_ID,
    session_id: 'session:activation-rehearsal',
    turn_id: 'turn:activation-rehearsal',
    model: MODEL_ID,
    messages: [{ role: 'user', content: 'activation rehearsal' }],
    tools: [],
    parameters: { max_output_tokens: 64, temperature: null, stop: [] },
  };
  const events = [];
  for await (const event of validatePortResult('ModelProvider', 'stream', provider.stream(input), input)) events.push(event);
  provider.dispose({ schema_version: CONTRACT_SCHEMA_VERSION, request_id: 'request:activation-dispose', provider_id: PROVIDER_ID });
  const serialized = JSON.stringify(events);
  const ready =
    resolved === 1 &&
    events.map(({ event_type: type }) => type).join(',') === 'content.delta,usage,completed' &&
    events[0]?.payload?.text === 'candidate-conformant' &&
    !serialized.includes(EPHEMERAL_SECRET);
  return Object.freeze({
    ready,
    profile_id: CANDIDATE_PROFILE,
    operational: false,
    model_provider_id: PROVIDER_ID,
    runtime_provider_id: 'runtime:hseos-kernel',
    provider_protocol: candidate.provider.protocol,
    normalized_events: events.map(({ event_type: type }) => type),
    secret_resolved_at_dispatch: resolved === 1,
    secret_absent_from_evidence: !serialized.includes(EPHEMERAL_SECRET),
    manifest_sha256: sha256(fs.readFileSync(path.join(repositoryRoot, CANDIDATE_MANIFEST))),
  });
}

function checkRequiredSandbox(candidate, environment) {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-activation-sandbox-'));
  fs.chmodSync(sandboxRoot, 0o700);
  try {
    const configDirectory = path.join(sandboxRoot, '.hseos', 'config');
    fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(configDirectory, 'hseos.config.yaml'), yaml.stringify({ sandbox: candidate.sandbox }), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    const result = sandboxDoctor(sandboxRoot, environment);
    return Object.freeze({
      ready: result.ok && result.required === true && result.provider === 'ai-jail',
      required: result.required,
      provider: result.provider,
      profile: candidate.sandbox.default_profile,
      checks: result.checks.map(({ id, ok, required, details, remedy }) => ({ id, ok, required, details, ...(remedy ? { remedy } : {}) })),
      errors: result.errors,
    });
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

function compareSnapshots(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

async function prepareRehearsalSource(source, allowLiveSnapshot) {
  try {
    assertStableReadOnlyDatabase(source);
    return { path: source, mode: 'stable-read-only-source', cleanup() {} };
  } catch (error) {
    if (!allowLiveSnapshot || !/SQLite sidecars/.test(error.message)) throw error;
  }
  const snapshot = createLiveSnapshot(source);
  const stablePath = path.join(snapshot.directory, 'checkpointed.db');
  try {
    const db = new Database(snapshot.snapshotPath, { fileMustExist: true });
    try {
      await db.backup(stablePath);
    } finally {
      db.close();
    }
    fs.chmodSync(stablePath, 0o600);
    for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(`${stablePath}${suffix}`, { force: true });
    assertStableReadOnlyDatabase(stablePath);
  } catch (error) {
    fs.rmSync(snapshot.directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path: stablePath,
    mode: 'verified-snapshot-of-live-wal',
    cleanup() {
      fs.rmSync(snapshot.directory, { recursive: true, force: true });
    },
  };
}

async function runActivationRehearsal({ databasePath, repositoryRoot, environment = process.env, allowLiveSnapshot = false }) {
  const source = path.resolve(databasePath);
  const root = path.resolve(repositoryRoot);
  const sourceFilesBefore = databaseFingerprint(source);
  const rehearsalSource = await prepareRehearsalSource(source, allowLiveSnapshot);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-agentic-activation-rehearsal-'));
  fs.chmodSync(directory, 0o700);
  const baselinePath = path.join(directory, 'rollback-v4.db');
  const candidatePath = path.join(directory, 'candidate-v8.db');
  let baseline;
  let candidate;
  try {
    fs.copyFileSync(rehearsalSource.path, baselinePath, fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(rehearsalSource.path, candidatePath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(baselinePath, 0o600);
    fs.chmodSync(candidatePath, 0o600);

    baseline = new Database(baselinePath, { fileMustExist: true, readonly: true });
    baseline.pragma('foreign_keys = ON');
    assertOperationalSchemaBoundary(baseline);
    const sourceVersion = baseline.pragma('user_version', { simple: true });
    const baselineSnapshot = snapshotTables(baseline);
    baseline.close();
    baseline = null;

    candidate = new Database(candidatePath);
    candidate.pragma('foreign_keys = ON');
    const migration = runMigrations(candidate, path.join(root, 'tools', 'mcp-project-state', 'migrations-pending-activation'), {
      log: () => {},
    });
    const candidateVersion = candidate.pragma('user_version', { simple: true });
    const candidateIntegrity = candidate.pragma('integrity_check').map(({ integrity_check: value }) => value);
    const candidateSnapshot = snapshotTables(candidate);
    const changedLegacyTables = Object.entries(baselineSnapshot)
      .filter(([name, digest]) => JSON.stringify(candidateSnapshot[name]) !== JSON.stringify(digest))
      .map(([name]) => name);
    candidate.close();
    candidate = null;

    fs.rmSync(candidatePath, { force: true });
    baseline = new Database(baselinePath, { fileMustExist: true, readonly: true });
    baseline.pragma('foreign_keys = ON');
    assertOperationalSchemaBoundary(baseline);
    const rollbackVersion = baseline.pragma('user_version', { simple: true });
    const rollbackIntegrity = baseline.pragma('integrity_check').map(({ integrity_check: value }) => value);
    const rollbackSnapshot = snapshotTables(baseline);
    baseline.close();
    baseline = null;

    const candidateManifest = readCandidateManifest(root);
    const profile = await certifyCandidateProfile(root);
    const sandbox = checkRequiredSandbox(candidateManifest, environment);
    const sourceFilesAfter = databaseFingerprint(source);
    const sourceUnchanged = JSON.stringify(sourceFilesBefore) === JSON.stringify(sourceFilesAfter);
    const migrationReady =
      sourceVersion === 4 &&
      candidateVersion === 8 &&
      migration.applied.length === 4 &&
      candidateIntegrity.length === 1 &&
      candidateIntegrity[0] === 'ok' &&
      changedLegacyTables.length === 0;
    const rollbackReady =
      rollbackVersion === 4 &&
      rollbackIntegrity.length === 1 &&
      rollbackIntegrity[0] === 'ok' &&
      compareSnapshots(baselineSnapshot, rollbackSnapshot);
    const rehearsalReady = migrationReady && rollbackReady && profile.ready && sourceUnchanged;
    return Object.freeze({
      schema_version: '1.0',
      status: rehearsalReady ? 'rehearsal-passed' : 'rehearsal-failed',
      rehearsal_only: true,
      operational_activation: false,
      activation_authorized: false,
      ready_for_operational_activation: false,
      ready_for_provider_environment_gate: rehearsalReady && sandbox.ready,
      evidence: {
        migration: {
          ready: migrationReady,
          source_version: sourceVersion,
          target_version: candidateVersion,
          applied: migration.applied,
          integrity: candidateIntegrity,
          changed_legacy_tables: changedLegacyTables,
        },
        rollback: {
          ready: rollbackReady,
          restored_version: rollbackVersion,
          integrity: rollbackIntegrity,
          baseline_tables_preserved: compareSnapshots(baselineSnapshot, rollbackSnapshot),
          migrated_candidate_discarded: !fs.existsSync(candidatePath),
        },
        profile,
        sandbox,
        operational_source: {
          unchanged: sourceUnchanged,
          mode: rehearsalSource.mode,
          files_before: sourceFilesBefore,
          files_after: sourceFilesAfter,
        },
      },
      remaining_gates: [
        ...(sandbox.ready ? [] : ['required-sandbox-runtime']),
        'provider-environment-validation',
        'g9-zero-legacy-window',
        'explicit-human-cutover',
      ],
    });
  } finally {
    if (baseline?.open) baseline.close();
    if (candidate?.open) candidate.close();
    fs.rmSync(directory, { recursive: true, force: true });
    rehearsalSource.cleanup();
  }
}

module.exports = {
  ActivationRehearsalError,
  CANDIDATE_PROFILE,
  checkRequiredSandbox,
  certifyCandidateProfile,
  readCandidateManifest,
  runActivationRehearsal,
};
