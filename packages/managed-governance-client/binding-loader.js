'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');
const { ManagedGovernanceBindingSchema, parseContract } = require('../managed-governance-contracts');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANIFEST_PATTERN = /^\.agents\/capabilities\/[A-Za-z0-9._/-]+\.ya?ml$/;

class BindingError extends Error {
  constructor(message, code = 'MANAGED_GOVERNANCE_BINDING_INVALID') {
    super(message);
    this.name = 'BindingError';
    this.code = code;
  }
}

function secureRead(filePath, maximumBytes) {
  const absolute = path.resolve(filePath);
  let metadata;
  try {
    metadata = fs.lstatSync(absolute);
  } catch {
    throw new BindingError('binding input does not exist');
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > maximumBytes) {
    throw new BindingError('binding input is unsafe');
  }
  if (fs.realpathSync(absolute) !== absolute) throw new BindingError('binding input cannot traverse links');
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new BindingError('binding input changed during inspection');
    }
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function rejectSecretFields(value, location = 'binding') {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/(secret|token|password|credential|private.?key|bearer)/i.test(key)) {
      throw new BindingError(`${location} contains a forbidden secret field`);
    }
    rejectSecretFields(nested, `${location}.${key}`);
  }
}

function validateRepositoryContract(data, repositoryRoot) {
  const issues = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['root must be a YAML object'];
  }
  if (data.schema_version !== 'repository-contract/v1') {
    issues.push('schema_version must be repository-contract/v1');
  }
  if (typeof data.repository_id !== 'string' || !UUID_PATTERN.test(data.repository_id)) {
    issues.push('repository_id must be a RFC 4122 UUID');
  }
  const remotes = data.identity?.remotes;
  if (!Array.isArray(remotes) || remotes.some((value) => typeof value !== 'string' || !value.trim())) {
    issues.push('identity.remotes must be an array of non-empty strings');
  }
  if (Array.isArray(remotes) && new Set(remotes).size !== remotes.length) {
    issues.push('identity.remotes must not contain duplicates');
  }
  const manifest = data.capabilities?.manifest;
  if (manifest !== null && (typeof manifest !== 'string' || !MANIFEST_PATTERN.test(manifest))) {
    issues.push('capabilities.manifest must be null or a .agents/capabilities/*.yaml path');
  }
  if (typeof manifest === 'string' && !fs.existsSync(path.join(repositoryRoot, manifest))) {
    issues.push(`capabilities.manifest does not exist: ${manifest}`);
  }
  const allowed = new Set(['schema_version', 'repository_id', 'identity', 'capabilities']);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) issues.push(`unexpected root property: ${key}`);
  }
  return issues;
}

function loadManagedGovernanceBinding({ bindingPath, repositoryContractPath, repositoryRoot, expectedRepositoryId }) {
  if (!bindingPath || !repositoryContractPath || !repositoryRoot || !expectedRepositoryId) {
    throw new BindingError('binding, repository contract, root and expected identity are required');
  }
  let repositoryContract;
  let rawBinding;
  try {
    repositoryContract = yaml.parse(secureRead(repositoryContractPath, 64 * 1024));
    rawBinding = JSON.parse(secureRead(bindingPath, 64 * 1024));
  } catch (error) {
    if (error instanceof BindingError) throw error;
    throw new BindingError('binding input could not be parsed');
  }
  const issues = validateRepositoryContract(repositoryContract, path.resolve(repositoryRoot));
  if (issues.length > 0) throw new BindingError('repository contract is invalid');
  rejectSecretFields(rawBinding);
  const binding = parseContract(ManagedGovernanceBindingSchema, rawBinding, 'managed governance binding');
  if (repositoryContract.repository_id !== expectedRepositoryId || binding.repository_id !== expectedRepositoryId) {
    throw new BindingError('managed governance binding identity mismatch', 'MANAGED_GOVERNANCE_IDENTITY_MISMATCH');
  }
  return Object.freeze({ binding, repositoryContract: Object.freeze(structuredClone(repositoryContract)) });
}

module.exports = {
  BindingError,
  loadManagedGovernanceBinding,
  rejectSecretFields,
  secureRead,
  validateRepositoryContract,
};
