'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fsExtra = require('fs-extra');
const { getSourceProfile } = require('../../tools/managed-governance-control-plane/lib/infrastructure/git/source-profiles');

function git(directory, arguments_) {
  return execFileSync('git', ['-C', directory, ...arguments_], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createCommittedGovernanceFixture(sourceRepository) {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-discovery-'));
  for (const sourceRoot of new Set(getSourceProfile().sources.map((source) => source.root))) {
    const destination = path.join(repository, sourceRoot);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fsExtra.copySync(path.join(sourceRepository, sourceRoot), destination);
  }
  for (const sourcePath of ['repository-contract.yaml', '.agents/capabilities/components.yaml']) {
    const destination = path.join(repository, sourcePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(sourceRepository, sourcePath), destination);
  }
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'user.email', 'test@example.invalid']);
  git(repository, ['config', 'user.name', 'Test']);
  git(repository, ['add', '.']);
  git(repository, ['commit', '--quiet', '-m', 'test: pin governance discovery fixture']);
  return repository;
}

module.exports = { createCommittedGovernanceFixture, git };
