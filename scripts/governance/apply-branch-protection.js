'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

const DEFAULT_CONFIG = '.github/branch-protection.yaml';

function usage() {
  return [
    'Usage: node scripts/governance/apply-branch-protection.js [options]',
    '',
    'Options:',
    '  --branch <name>   Branch entry to apply (default: master)',
    '  --config <path>   Branch protection YAML path',
    '  --repo <owner/repo>',
    '  --dry-run         Print the GitHub REST payload without applying it',
    '  --help            Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    branch: 'master',
    config: DEFAULT_CONFIG,
    dryRun: false,
    repo: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--dry-run': {
        args.dryRun = true;
        break;
      }
      case '--help':
      case '-h': {
        args.help = true;
        break;
      }
      case '--branch':
      case '--config':
      case '--repo': {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error(`${arg} requires a value`);
        }
        args[arg.slice(2)] = value;
        index += 1;
        break;
      }
      default: {
        throw new Error(`Unsupported argument: ${arg}`);
      }
    }
  }

  return args;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseGithubRemote(remoteUrl) {
  const sshMatch = remoteUrl.match(/^git@github\.com:(?<slug>[^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch?.groups?.slug) {
    return sshMatch.groups.slug;
  }

  try {
    const url = new URL(remoteUrl);
    if (url.hostname !== 'github.com') {
      return null;
    }
    let slug = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    slug = slug.endsWith('.git') ? slug.slice(0, -4) : slug;
    return slug;
  } catch {
    return null;
  }
}

function detectRepoSlug(cwd) {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  try {
    const remote = run('git', ['config', '--get', 'remote.origin.url'], { cwd });
    const slug = parseGithubRemote(remote);
    if (slug) {
      return slug;
    }
  } catch {
    // Fall back to GitHub CLI below.
  }

  try {
    return run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd });
  } catch {
    return null;
  }
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return yaml.parse(raw);
}

function findBranch(config, branchName) {
  const branch = config?.branches?.find((candidate) => candidate.name === branchName);
  if (!branch) {
    throw new Error(`Branch protection entry not found: ${branchName}`);
  }
  if (!branch.protection || typeof branch.protection !== 'object') {
    throw new Error(`Branch protection entry has no protection object: ${branchName}`);
  }
  return branch;
}

function buildRequest({ repo, branchName, protection }) {
  return {
    endpoint: `repos/${repo}/branches/${branchName}/protection`,
    method: 'PUT',
    body: protection,
  };
}

function applyRequest(request, cwd) {
  return run('gh', ['api', '--method', request.method, request.endpoint, '--input', '-'], {
    cwd,
    input: `${JSON.stringify(request.body)}\n`,
  });
}

function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const configPath = path.resolve(cwd, args.config);
  const config = loadConfig(configPath);
  const branch = findBranch(config, args.branch);
  const repo = args.repo || detectRepoSlug(cwd);

  if (!repo) {
    throw new Error('Unable to determine GitHub repo. Pass --repo <owner/repo>.');
  }

  const request = buildRequest({
    repo,
    branchName: branch.name,
    protection: branch.protection,
  });

  if (args.dryRun) {
    console.log(JSON.stringify(request, null, 2));
    return 0;
  }

  const response = applyRequest(request, cwd);
  if (response) {
    console.log(response);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`branch-protection: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildRequest,
  findBranch,
  main,
  parseGithubRemote,
};
