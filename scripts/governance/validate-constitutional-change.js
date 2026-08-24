'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('yaml');

const CONSTITUTION = '.enterprise/.specs/constitution/Enterprise-Constitution.md';
const ADR_DIR = '.enterprise/.specs/decisions';

function runGit(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseVersion(content, label) {
  const match = content.match(/^\*\*Version:\*\*\s*(\d+)\.(\d+)\s*$/m);
  if (!match) throw new Error(`${label} has no valid major.minor Version header`);
  return { major: Number(match[1]), minor: Number(match[2]), raw: `${match[1]}.${match[2]}` };
}

function isGreater(next, previous) {
  return next.major > previous.major || (next.major === previous.major && next.minor > previous.minor);
}

function resolveBase(root, explicitBase) {
  const candidates = [
    explicitBase,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    process.env.CONSTITUTION_BASE_REF,
    'master',
    'main',
    'HEAD^',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      runGit(root, ['rev-parse', '--verify', candidate]);
      return runGit(root, ['merge-base', candidate, 'HEAD']);
    } catch {
      // Try the next deterministic base candidate.
    }
  }
  throw new Error('cannot resolve a base revision for constitutional validation');
}

function changedFiles(root, base) {
  const output = runGit(root, ['diff', '--name-only', base, '--']);
  return output ? output.split('\n') : [];
}

function validateStructuralProtection(root) {
  const codeownersPath = path.join(root, '.github', 'CODEOWNERS');
  if (!fs.existsSync(codeownersPath)) throw new Error('.github/CODEOWNERS is required');
  const codeowners = fs.readFileSync(codeownersPath, 'utf8');
  if (!codeowners.split('\n').some((line) => line.trim().replace(/^\//, '').startsWith(`${CONSTITUTION} `))) {
    throw new Error(`CODEOWNERS must protect ${CONSTITUTION}`);
  }
  const branchPolicyPath = path.join(root, '.github', 'branch-protection.yaml');
  const branchPolicy = yaml.parse(fs.readFileSync(branchPolicyPath, 'utf8'));
  const master = branchPolicy.branches?.find((branch) => branch.name === 'master');
  if (master?.protection?.required_pull_request_reviews?.require_code_owner_reviews !== true) {
    throw new Error('master branch protection must require code-owner reviews');
  }
}

function validateConstitutionChange({ root = process.cwd(), base: explicitBase } = {}) {
  validateStructuralProtection(root);
  const currentContent = fs.readFileSync(path.join(root, CONSTITUTION), 'utf8');
  const currentVersion = parseVersion(currentContent, 'current Constitution');
  const base = resolveBase(root, explicitBase);
  const files = changedFiles(root, base);

  if (!files.includes(CONSTITUTION)) return { changed: false, base, version: currentVersion.raw };

  const previousContent = runGit(root, ['show', `${base}:${CONSTITUTION}`]);
  const previousVersion = parseVersion(previousContent, 'base Constitution');
  if (!isGreater(currentVersion, previousVersion)) {
    throw new Error(`Constitution version must increase (${previousVersion.raw} -> ${currentVersion.raw})`);
  }

  const changedAdrs = files.filter((file) => file.startsWith(`${ADR_DIR}/ADR-`) && file.endsWith('.md'));
  const acceptedLinkedAdrs = changedAdrs.filter((file) => {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    return /^\*\*Status:\*\* Accepted/m.test(content) && /^\*\*Affects Standards:\*\*.*Constitution/im.test(content);
  });
  if (acceptedLinkedAdrs.length === 0) {
    throw new Error('constitutional change requires a changed, Accepted ADR linked through Affects Standards');
  }
  if (!currentContent.includes('Code-owner approval enforced by branch protection')) {
    throw new Error('Constitution change control must require code-owner approval');
  }

  return {
    changed: true,
    base,
    previous_version: previousVersion.raw,
    version: currentVersion.raw,
    adrs: acceptedLinkedAdrs,
  };
}

function parseArgs(argv) {
  const options = { root: process.cwd(), base: undefined, json: false };
  for (let index = 0; index < argv.length; index++) {
    switch (argv[index]) {
      case '--root': {
        options.root = argv[++index];
        break;
      }
      case '--base': {
        options.base = argv[++index];
        break;
      }
      case '--json': {
        options.json = true;
        break;
      }
      default: {
        throw new Error(`unknown argument: ${argv[index]}`);
      }
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = validateConstitutionChange(options);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result)}\n`
        : `Constitution validation passed: ${result.changed ? `${result.previous_version} -> ${result.version}` : `unchanged at ${result.version}`}\n`,
    );
  } catch (error) {
    process.stderr.write(`Constitution validation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { isGreater, parseVersion, validateConstitutionChange, validateStructuralProtection };
