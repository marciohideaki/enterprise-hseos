'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const yaml = require('yaml');
const { deepFreeze } = require('../../../../../packages/managed-governance-contracts');
const { validateRepositoryContract } = require('../../../../../scripts/governance/validate-repository-contract');
const { classifySource } = require('./classifiers');
const { getSourceProfile, getSourceProfileDigest, matchesSourceRule } = require('./source-profiles');

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

class GovernanceSourceError extends Error {
  constructor(message, code, sourcePath = null) {
    super(message);
    this.name = 'GovernanceSourceError';
    this.code = code;
    this.source_path = sourcePath;
  }
}

function assertInsideRoot(repositoryRoot, candidate, sourcePath) {
  const relative = path.relative(repositoryRoot, candidate);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new GovernanceSourceError('governance source escapes repository root', 'MANAGED_GOVERNANCE_SOURCE_ESCAPE', sourcePath);
}

async function assertRealDirectory(repositoryRoot, absolutePath, sourcePath) {
  assertInsideRoot(repositoryRoot, absolutePath, sourcePath);
  let linkStat;
  try {
    linkStat = await fs.promises.lstat(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new GovernanceSourceError('required governance source root is missing', 'MANAGED_GOVERNANCE_SOURCE_ROOT_MISSING', sourcePath);
    }
    throw error;
  }
  if (!linkStat.isDirectory() || linkStat.isSymbolicLink()) {
    throw new GovernanceSourceError(
      'governance source root must be a real directory',
      'MANAGED_GOVERNANCE_SOURCE_ROOT_INVALID',
      sourcePath,
    );
  }
  const realPath = await fs.promises.realpath(absolutePath);
  assertInsideRoot(repositoryRoot, realPath, sourcePath);
  if (realPath !== absolutePath) {
    throw new GovernanceSourceError('governance source root cannot traverse symbolic links', 'MANAGED_GOVERNANCE_SOURCE_LINK', sourcePath);
  }
}

function boundedLimit(value, profileMaximum, label) {
  if (value === undefined) return profileMaximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > profileMaximum) {
    throw new GovernanceSourceError(
      `${label} must be a positive integer within the source profile limit`,
      'MANAGED_GOVERNANCE_SOURCE_LIMIT_INVALID',
    );
  }
  return value;
}

async function secureReadRegularFile(repositoryRoot, absolutePath, sourcePath, maximumBytes) {
  assertInsideRoot(repositoryRoot, absolutePath, sourcePath);
  const linkStat = await fs.promises.lstat(absolutePath, { bigint: true });
  if (linkStat.isSymbolicLink()) {
    throw new GovernanceSourceError('symbolic links are forbidden in governance sources', 'MANAGED_GOVERNANCE_SOURCE_LINK', sourcePath);
  }
  if (!linkStat.isFile()) {
    throw new GovernanceSourceError('governance source is not a regular file', 'MANAGED_GOVERNANCE_SOURCE_SPECIAL_FILE', sourcePath);
  }
  if (linkStat.nlink !== 1n) {
    throw new GovernanceSourceError('hard-linked governance sources are forbidden', 'MANAGED_GOVERNANCE_SOURCE_LINK', sourcePath);
  }
  if (linkStat.size > BigInt(maximumBytes)) {
    throw new GovernanceSourceError(
      'governance source exceeds the configured byte limit',
      'MANAGED_GOVERNANCE_SOURCE_TOO_LARGE',
      sourcePath,
    );
  }

  const realPath = await fs.promises.realpath(absolutePath);
  assertInsideRoot(repositoryRoot, realPath, sourcePath);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let handle;
  try {
    handle = await fs.promises.open(absolutePath, flags);
  } catch (error) {
    throw new GovernanceSourceError(
      `governance source could not be opened safely: ${error.code || 'open_failed'}`,
      'MANAGED_GOVERNANCE_SOURCE_OPEN_FAILED',
      sourcePath,
    );
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (before.dev !== linkStat.dev || before.ino !== linkStat.ino || !before.isFile() || before.nlink !== 1n) {
      throw new GovernanceSourceError('governance source identity changed before read', 'MANAGED_GOVERNANCE_SOURCE_RACE', sourcePath);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      BigInt(bytes.length) !== before.size
    ) {
      throw new GovernanceSourceError('governance source changed while being read', 'MANAGED_GOVERNANCE_SOURCE_RACE', sourcePath);
    }
    try {
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new GovernanceSourceError('governance source is not valid UTF-8', 'MANAGED_GOVERNANCE_SOURCE_ENCODING', sourcePath);
    }
    const rawContent = bytes.toString('utf8');
    const contentWithoutBom = rawContent.startsWith('\uFEFF') ? rawContent.slice(1) : rawContent;
    const normalizedContent = contentWithoutBom.replaceAll(/\r\n?/g, '\n');
    const contentDigest = `sha256:${crypto.createHash('sha256').update(normalizedContent, 'utf8').digest('hex')}`;
    return { rawContent, normalizedContent, contentDigest };
  } finally {
    await handle.close();
  }
}

function git(repositoryRoot, arguments_, maximumBytes = 1024 * 1024) {
  try {
    return execFileSync('git', ['-C', repositoryRoot, ...arguments_], {
      encoding: 'utf8',
      maxBuffer: maximumBytes,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new GovernanceSourceError(`Git source verification failed: ${error.status ?? 'unknown'}`, 'MANAGED_GOVERNANCE_GIT_INVALID');
  }
}

function resolveGitMetadata(repositoryRoot, profile, reference = 'HEAD') {
  if (reference !== 'HEAD' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(reference)) {
    throw new GovernanceSourceError('Git reference must be HEAD or a full object ID', 'MANAGED_GOVERNANCE_GIT_REFERENCE_INVALID');
  }
  const commit = git(repositoryRoot, ['rev-parse', '--verify', `${reference}^{commit}`]);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) {
    throw new GovernanceSourceError('Git did not return a full commit ID', 'MANAGED_GOVERNANCE_GIT_REFERENCE_INVALID');
  }
  const headCommit = git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (commit !== headCommit) {
    throw new GovernanceSourceError(
      'filesystem discovery can only identify the commit currently checked out',
      'MANAGED_GOVERNANCE_GIT_REFERENCE_MISMATCH',
    );
  }
  const timestamp = git(repositoryRoot, ['show', '-s', '--format=%cI', commit]);
  const sourceRoots = ['repository-contract.yaml', ...new Set(profile.sources.map((source) => source.root))].sort(compareText);
  return { commit, timestamp, sourceRoots };
}

function assertGitSourcesClean(repositoryRoot, sourceRoots) {
  const status = git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--', ...sourceRoots], 4 * 1024 * 1024);
  if (status) {
    throw new GovernanceSourceError('canonical governance sources contain uncommitted changes', 'MANAGED_GOVERNANCE_GIT_DIRTY');
  }
}

async function loadRepositoryIdentity(repositoryRoot) {
  const sourcePath = 'repository-contract.yaml';
  const absolutePath = path.join(repositoryRoot, sourcePath);
  const { rawContent } = await secureReadRegularFile(repositoryRoot, absolutePath, sourcePath, 64 * 1024);
  let contract;
  try {
    const document = yaml.parseDocument(rawContent, {
      customTags: [],
      schema: 'core',
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) throw new Error('invalid repository contract');
    contract = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new GovernanceSourceError('repository contract is not valid YAML', 'MANAGED_GOVERNANCE_REPOSITORY_IDENTITY_INVALID', sourcePath);
  }
  const issues = validateRepositoryContract(contract, repositoryRoot);
  if (issues.length > 0) {
    throw new GovernanceSourceError('repository contract failed validation', 'MANAGED_GOVERNANCE_REPOSITORY_IDENTITY_INVALID', sourcePath);
  }
  return deepFreeze(contract);
}

class GitGovernanceSource {
  constructor(options = {}) {
    this.repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
    this.profile = getSourceProfile(options.profileId);
    this.maximumFileBytes = boundedLimit(options.maximumFileBytes, this.profile.max_file_bytes, 'maximumFileBytes');
    this.maximumFiles = boundedLimit(options.maximumFiles, this.profile.max_files, 'maximumFiles');
    this.maximumEntries = boundedLimit(options.maximumEntries, this.profile.max_entries, 'maximumEntries');
  }

  async discover(options = {}) {
    const rootStat = await fs.promises.lstat(this.repositoryRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new GovernanceSourceError('repository root must be a real directory', 'MANAGED_GOVERNANCE_REPOSITORY_ROOT_INVALID');
    }
    const rootRealPath = await fs.promises.realpath(this.repositoryRoot);
    if (rootRealPath !== this.repositoryRoot) {
      throw new GovernanceSourceError('repository root must use its canonical real path', 'MANAGED_GOVERNANCE_REPOSITORY_ROOT_INVALID');
    }

    const identity = await loadRepositoryIdentity(this.repositoryRoot);
    const gitMetadata = resolveGitMetadata(this.repositoryRoot, this.profile, options.reference);
    assertGitSourcesClean(this.repositoryRoot, gitMetadata.sourceRoots);

    const entries = [];
    let visitedEntries = 0;
    for (const sourceRule of this.profile.sources) {
      const absoluteRuleRoot = path.resolve(this.repositoryRoot, sourceRule.root);
      assertInsideRoot(this.repositoryRoot, absoluteRuleRoot, sourceRule.root);
      try {
        await assertRealDirectory(this.repositoryRoot, absoluteRuleRoot, sourceRule.root);
      } catch (error) {
        if (error.code === 'MANAGED_GOVERNANCE_SOURCE_ROOT_MISSING' && !sourceRule.required) continue;
        throw error;
      }

      const walk = async (directory) => {
        const directorySourcePath = path.relative(this.repositoryRoot, directory).split(path.sep).join('/');
        await assertRealDirectory(this.repositoryRoot, directory, directorySourcePath);
        const directoryEntries = await fs.promises.readdir(directory, { withFileTypes: true });
        directoryEntries.sort((left, right) => compareText(left.name, right.name));
        for (const directoryEntry of directoryEntries) {
          visitedEntries += 1;
          if (visitedEntries > this.maximumEntries) {
            throw new GovernanceSourceError('governance source entry limit exceeded', 'MANAGED_GOVERNANCE_SOURCE_ENTRY_LIMIT');
          }
          const absolutePath = path.join(directory, directoryEntry.name);
          const sourcePath = path.relative(this.repositoryRoot, absolutePath).split(path.sep).join('/');
          if (directoryEntry.isSymbolicLink()) {
            throw new GovernanceSourceError(
              'symbolic links are forbidden in governance source roots',
              'MANAGED_GOVERNANCE_SOURCE_LINK',
              sourcePath,
            );
          }
          if (directoryEntry.isDirectory()) {
            await walk(absolutePath);
            continue;
          }
          if (!directoryEntry.isFile()) {
            throw new GovernanceSourceError(
              'special files are forbidden in governance source roots',
              'MANAGED_GOVERNANCE_SOURCE_SPECIAL_FILE',
              sourcePath,
            );
          }
          const relativeToRuleRoot = path.relative(absoluteRuleRoot, absolutePath).split(path.sep).join('/');
          if (!matchesSourceRule(sourceRule, relativeToRuleRoot)) continue;
          if (entries.length >= this.maximumFiles) {
            throw new GovernanceSourceError('governance source file limit exceeded', 'MANAGED_GOVERNANCE_SOURCE_FILE_LIMIT');
          }
          const content = await secureReadRegularFile(this.repositoryRoot, absolutePath, sourcePath, this.maximumFileBytes);
          const baseEntry = {
            source_path: sourcePath,
            source_kind: sourceRule.source_kind,
            raw_content: content.rawContent,
            normalized_content: content.normalizedContent,
            content_digest: content.contentDigest,
          };
          entries.push(deepFreeze({ ...baseEntry, classification: classifySource(baseEntry) }));
        }
      };
      await walk(absoluteRuleRoot);
    }

    entries.sort((left, right) => compareText(left.source_path, right.source_path));
    const duplicates = entries.filter((entry, index) => index > 0 && entry.source_path === entries[index - 1].source_path);
    if (duplicates.length > 0) {
      throw new GovernanceSourceError(
        'source profile selects the same file more than once',
        'MANAGED_GOVERNANCE_SOURCE_DUPLICATE',
        duplicates[0].source_path,
      );
    }
    assertGitSourcesClean(this.repositoryRoot, gitMetadata.sourceRoots);
    const finalHead = git(this.repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
    if (finalHead !== gitMetadata.commit) {
      throw new GovernanceSourceError('Git HEAD changed during governance discovery', 'MANAGED_GOVERNANCE_GIT_RACE');
    }

    return deepFreeze({
      schema_version: 1,
      repository_id: identity.repository_id,
      source_commit: gitMetadata.commit,
      source_timestamp: gitMetadata.timestamp,
      source_profile: this.profile.profile_id,
      source_profile_digest: getSourceProfileDigest(this.profile),
      entries,
    });
  }
}

module.exports = {
  GitGovernanceSource,
  GovernanceSourceError,
  assertGitSourcesClean,
  assertRealDirectory,
  loadRepositoryIdentity,
  resolveGitMetadata,
  secureReadRegularFile,
};
