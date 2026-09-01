'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const yaml = require('yaml');
const { ManagedGovernanceSessionPreflightSchema, parseContract } = require('../managed-governance-contracts');
const { loadManagedGovernanceBinding, secureRead, validateRepositoryContract } = require('./binding-loader');

const CONFIG_PATH = path.join('.hseos', 'config', 'managed-governance.json');
const BINDING_PATH = path.join('.hseos', 'config', 'managed-governance-binding.json');
const REPOSITORY_CONTRACT_PATH = 'repository-contract.yaml';
const CONSTITUTION_PATH = path.join('.enterprise', '.specs', 'constitution', 'Enterprise-Constitution.md');
const EVIDENCE_PATH = path.join('.hseos', 'state', 'managed-governance', 'session-preflight.json');
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_OBJECT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REMOTE_ARTIFACTS = 20_000;

function secureReadUtf8(filePath, maximumBytes) {
  const absolute = path.resolve(filePath);
  let metadata;
  try {
    metadata = fs.lstatSync(absolute);
  } catch {
    throw new Error('Constitution input does not exist');
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > maximumBytes) {
    throw new Error('Constitution input is unsafe');
  }
  if (fs.realpathSync(absolute) !== absolute) throw new Error('Constitution input cannot traverse links');
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new Error('Constitution input changed during inspection');
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error('Constitution input changed while being read');
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error('Constitution input is not stable UTF-8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function digestConstitution(rawContent) {
  const contentWithoutBom = rawContent.startsWith('\uFEFF') ? rawContent.slice(1) : rawContent;
  const normalized = contentWithoutBom.replaceAll(/\r\n?/g, '\n');
  return `sha256:${crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

function checkedAt(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('session preflight clock is invalid');
  return value.toISOString();
}

function baseResult(status, reasonCode, timestamp, overrides = {}) {
  return {
    schema_version: 1,
    mode: 'managed-shadow',
    status,
    reason_code: reasonCode,
    blocking: false,
    authoritative_source: 'local',
    repository_id: overrides.repository_id || null,
    checked_at: timestamp,
    constitution: {
      source_path: CONSTITUTION_PATH.split(path.sep).join('/'),
      local_digest: overrides.local_digest || null,
      remote_digest: overrides.remote_digest || null,
      matched: overrides.matched ?? null,
    },
    remote: {
      status: overrides.remote_status || 'not_checked',
      source_commit: overrides.source_commit || null,
    },
    evidence_path: overrides.evidence_path || null,
  };
}

function loadLocalContext(projectRoot) {
  const repositoryContractPath = path.join(projectRoot, REPOSITORY_CONTRACT_PATH);
  let repositoryContract;
  try {
    repositoryContract = yaml.parse(secureRead(repositoryContractPath, 64 * 1024));
  } catch {
    throw new Error('repository contract could not be parsed');
  }
  const issues = validateRepositoryContract(repositoryContract, projectRoot);
  if (issues.length > 0) throw new Error('repository contract failed validation');
  const { binding } = loadManagedGovernanceBinding({
    bindingPath: path.join(projectRoot, BINDING_PATH),
    repositoryContractPath,
    repositoryRoot: projectRoot,
    expectedRepositoryId: repositoryContract.repository_id,
  });
  if (binding.mode !== 'managed-shadow') throw new Error('managed governance binding is not in shadow mode');
  const rawConstitution = secureReadUtf8(path.join(projectRoot, CONSTITUTION_PATH), 2 * 1024 * 1024);
  return { repository_id: repositoryContract.repository_id, local_digest: digestConstitution(rawConstitution) };
}

function compareRemoteContext(local, remote) {
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw new Error('remote context is not an object');
  if (
    JSON.stringify(Object.keys(remote).sort()) !== JSON.stringify(['artifacts', 'mode', 'repository_id', 'source_commit']) ||
    remote.mode !== 'managed-shadow' ||
    !UUID_PATTERN.test(remote.repository_id || '') ||
    !Array.isArray(remote.artifacts) ||
    remote.artifacts.length > MAX_REMOTE_ARTIFACTS
  ) {
    throw new Error('remote context contract is invalid');
  }
  if (remote.source_commit !== undefined && remote.source_commit !== null && !GIT_OBJECT_PATTERN.test(remote.source_commit)) {
    throw new Error('remote source commit is invalid');
  }
  const expectedPath = CONSTITUTION_PATH.split(path.sep).join('/');
  const matches = remote.artifacts.filter((entry) => entry?.source_path === expectedPath);
  if (matches.length !== 1 || !DIGEST_PATTERN.test(matches[0]?.content_digest || '')) {
    throw new Error('remote Constitution projection is missing or ambiguous');
  }
  const remoteDigest = matches[0].content_digest;
  const identityMatched = remote.repository_id === local.repository_id;
  return {
    matched: identityMatched && remoteDigest === local.local_digest,
    identity_matched: identityMatched,
    remote_digest: remoteDigest,
    source_commit: remote.source_commit || null,
  };
}

function ensurePrivateProjectDirectory(projectRoot, relativeDirectory) {
  const root = path.resolve(projectRoot);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw new Error('session preflight project root is unsafe');
  }
  let current = root;
  for (const segment of relativeDirectory.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const metadata = fs.lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || fs.realpathSync(current) !== current) {
      throw new Error('session preflight evidence directory is unsafe');
    }
  }
  return current;
}

function persistEvidence(projectRoot, result) {
  const target = path.join(projectRoot, EVIDENCE_PATH);
  const directory = ensurePrivateProjectDirectory(projectRoot, path.dirname(EVIDENCE_PATH));
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 1) {
      throw new Error('session preflight evidence target is unsafe');
    }
  }
  const persisted = parseContract(
    ManagedGovernanceSessionPreflightSchema,
    { ...result, evidence_path: EVIDENCE_PATH.split(path.sep).join('/') },
    'managed governance session preflight',
  );
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let descriptor;
  let published = false;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    published = true;
    fs.chmodSync(target, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (!published && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return persisted;
}

async function runManagedGovernanceSessionPreflight(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const timestamp = checkedAt(options.clock || (() => new Date()));
  const persist = options.persist !== false;
  let result;

  if (!fs.existsSync(path.join(projectRoot, CONFIG_PATH))) {
    result = baseResult('not_configured', 'managed_shadow.not_configured', timestamp);
  } else {
    let local;
    let queryAdapter;
    try {
      const queryModule = require('../../tools/mcp-hseos-governance/lib/governance-query-adapter');
      queryModule.loadProjectConfiguration(projectRoot);
      local = loadLocalContext(projectRoot);
      queryAdapter = options.queryAdapter || queryModule.createProjectGovernanceQueryAdapter({ projectRoot });
    } catch {
      result = baseResult('invalid_local_contract', 'managed_shadow.local_contract_invalid', timestamp);
    }
    if (local) {
      try {
        const remote = await queryAdapter.getEffectiveGovernanceContext({ repository_id: local.repository_id });
        const comparison = compareRemoteContext(local, remote);
        result = baseResult(
          comparison.matched ? 'equivalent' : 'drift_detected',
          comparison.matched
            ? 'managed_shadow.constitution_equivalent'
            : comparison.identity_matched
              ? 'managed_shadow.constitution_drift'
              : 'managed_shadow.repository_identity_drift',
          timestamp,
          {
            repository_id: local.repository_id,
            local_digest: local.local_digest,
            remote_digest: comparison.remote_digest,
            matched: comparison.matched,
            remote_status: 'available',
            source_commit: comparison.source_commit,
          },
        );
      } catch {
        result = baseResult('remote_unavailable', 'managed_shadow.remote_unavailable', timestamp, {
          repository_id: local.repository_id,
          local_digest: local.local_digest,
          remote_status: 'unavailable',
        });
      }
    }
  }
  const parsed = parseContract(ManagedGovernanceSessionPreflightSchema, result, 'managed governance session preflight');
  return persist ? persistEvidence(projectRoot, parsed) : parsed;
}

module.exports = {
  BINDING_PATH,
  CONFIG_PATH,
  CONSTITUTION_PATH,
  EVIDENCE_PATH,
  compareRemoteContext,
  digestConstitution,
  ensurePrivateProjectDirectory,
  loadLocalContext,
  persistEvidence,
  runManagedGovernanceSessionPreflight,
};
