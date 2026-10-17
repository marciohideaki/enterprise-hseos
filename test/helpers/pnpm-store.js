'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { projectWorkspaceSnapshot, trustPnpmStores } = require('../../tools/cli/lib/engineering-workspace');
const { projectVerifierDigest } = require('../../tools/cli/lib/engineering-project-verifier');
const base = require('../fixtures/engineering-task/addition.json');
const FIXTURE = path.join(__dirname, '../fixtures/pnpm-store');
const layout = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'layout.json'), 'utf8'));

// The controller trusts a pnpm store only through its own configuration, never through the project or the
// environment: the tests register each fixture store through the internal controller API, as an operator would
// through the controller configuration files.
const trustedStores = new Set();
function trustStore(t, directory) {
  trustedStores.add(directory);
  trustPnpmStores([...trustedStores]);
  t.after(() => {
    trustedStores.delete(directory);
    trustPnpmStores([...trustedStores]);
  });
}

const sha = (value) => createHash('sha256').update(value).digest('hex');
const source = (name) => fs.readFileSync(path.join(FIXTURE, name), 'utf8');

/**
 * A Git project whose dependencies live in a pnpm virtual store: scoped and peer-suffixed directory names,
 * symlinked package directories, a store file hardlinked into a shared content store, and a native test
 * runner that the contract declares as an acceptance command.
 */
function pnpmProject(t, { sum = source('project-sum.js'), limits, mounted = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-pnpm-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'project');
  const contentStore = path.join(directory, 'content-store');
  fs.mkdirSync(root);
  fs.mkdirSync(contentStore);
  trustStore(t, contentStore);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const place = (relative, content) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  };
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  for (const entry of [...layout.files, ...(mounted ? layout.mounted.files : [])]) {
    place(entry.path, entry.path === 'src/sum.js' ? sum : source(entry.source));
  }
  // pnpm keeps one copy per content in its store (files/<sha512[0..2]>/<rest>) and links every project file to it.
  place('node_modules/.modules.yaml', JSON.stringify({ storeDir: contentStore, virtualStoreDir: '.pnpm', layoutVersion: 5 }));
  const addressed = (content, suffix = '') => {
    const hex = createHash('sha512').update(content).digest('hex');
    const file = path.join(contentStore, 'files', hex.slice(0, 2), hex.slice(2) + suffix);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return file;
  };
  for (const entry of layout.hardlinks) {
    const shared = addressed(source(entry.source));
    fs.writeFileSync(shared, source(entry.source));
    fs.mkdirSync(path.dirname(path.join(root, entry.path)), { recursive: true });
    fs.linkSync(shared, path.join(root, entry.path));
  }
  for (const entry of layout.symlinks) {
    fs.mkdirSync(path.dirname(path.join(root, entry.path)), { recursive: true });
    fs.symlinkSync(entry.target, path.join(root, entry.path));
  }
  git('add', '.');
  git('commit', '-m', 'fixture');
  const spec = mounted ? { ...layout.contract, ...layout.mounted } : layout.contract;
  const contract = structuredClone(base);
  Object.assign(contract, {
    schema_version: 2,
    execution_profile: 'managed-project',
    baseline_sha: git('rev-parse', 'HEAD'),
    initial_files: [],
    scope: { read: [...spec.read], write: [...spec.write] },
    commands: [
      {
        id: 'native',
        runtime: 'node',
        entrypoint: spec.entrypoint,
        args: [...spec.args],
        ...(limits ? { limits } : {}),
      },
    ],
    workspace: { root, files_sha256: '0'.repeat(64), ...(mounted ? { store_mount: 'pnpm-virtual-store' } : {}) },
  });
  contract.limits.max_duration_ms = 60_000;
  contract.verifier = {
    reference: 'verifier://project/node-module-v1',
    sha256: '0'.repeat(64),
    acceptance_ids: ['a1'],
    checks: [{ path: 'src/sum.js', export_name: 'default', args: [2, 3], expected: 5 }],
    command_checks: [{ command_id: 'native' }],
    protected_paths: [...spec.protected],
  };
  const seal = () => {
    contract.workspace.files_sha256 = projectWorkspaceSnapshot(contract).sha256;
    contract.verifier.sha256 = projectVerifierDigest(contract);
  };
  seal();
  const filename = path.join(directory, 'task.json');
  const save = () => fs.writeFileSync(filename, JSON.stringify(contract));
  save();
  return { directory, root, contentStore, contract, filename, save, seal, git, layout, addressed };
}

module.exports = { pnpmProject, layout, FIXTURE, trustStore };
