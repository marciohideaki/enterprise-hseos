'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { projectWorkspaceSnapshot } = require('../../tools/cli/lib/engineering-workspace');
const { projectVerifierDigest } = require('../../tools/cli/lib/engineering-project-verifier');
const base = require('../fixtures/engineering-task/addition.json');
const sha = (s) => createHash('sha256').update(s).digest('hex');

function fixture(
  t,
  {
    files = { 'index.js': 'module.exports = (n) => n + 1;\n' },
    entry = 'index.js',
    runtime = 'node',
    expected = 4,
    args = [3],
    reference,
  } = {},
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-project-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'project');
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  git('add', '.');
  git('commit', '-m', 'fixture');
  const contract = structuredClone(base);
  Object.assign(contract, {
    schema_version: 2,
    execution_profile: 'managed-project',
    baseline_sha: git('rev-parse', 'HEAD'),
    initial_files: [],
    scope: { read: Object.keys(files), write: Object.keys(files) },
    commands: [{ id: 'check', runtime, entrypoint: entry, args: [] }],
    workspace: { root, files_sha256: '0'.repeat(64) },
  });
  contract.limits.max_duration_ms = 60_000;
  contract.verifier = {
    reference: reference || `verifier://project/${runtime}-module-v1`,
    sha256: '0'.repeat(64),
    acceptance_ids: ['a1'],
    checks: [{ path: entry, export_name: runtime === 'python' ? 'calculate' : 'default', args, expected }],
  };
  contract.workspace.files_sha256 = projectWorkspaceSnapshot(contract).sha256;
  contract.verifier.sha256 = projectVerifierDigest(contract);
  const filename = path.join(directory, 'task.json');
  const save = () => fs.writeFileSync(filename, JSON.stringify(contract));
  save();
  return { root, directory, contract, filename, save };
}

module.exports = { fixture };
