'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { fixture } = require('./helpers/engineering-project');
const {
  projectWorkspaceSnapshot,
  hydrateProjectTask,
  projectPatch,
  prepareProjectTask,
} = require('../tools/cli/lib/engineering-workspace');

for (const kind of ['root-link', 'root-file', 'file-directory', 'budget', 'traversal', 'missing-file', 'missing-parent', 'parent-link']) {
  test(`workspace boundary handles ${kind} without following an unsafe path`, (t) => {
    const f = fixture(t);
    const contract = structuredClone(f.contract);
    switch (kind) {
      case 'root-link': {
        const link = path.join(f.directory, 'link');
        fs.symlinkSync(f.root, link);
        contract.workspace.root = link;
        break;
      }
      case 'root-file': {
        contract.workspace.root = path.join(f.root, 'index.js');
        break;
      }
      case 'file-directory': {
        fs.unlinkSync(path.join(f.root, 'index.js'));
        fs.mkdirSync(path.join(f.root, 'index.js'));
        break;
      }
      case 'budget': {
        contract.max_artifact_bytes = 1;
        break;
      }
      case 'traversal': {
        contract.scope.read = ['../secret'];
        break;
      }
      case 'missing-file': {
        contract.scope.read = ['absent.js'];
        break;
      }
      case 'missing-parent': {
        contract.scope.read = ['absent/index.js'];
        break;
      }
      case 'parent-link': {
        fs.symlinkSync(f.root, path.join(f.root, 'link'));
        contract.scope.read = ['link/index.js'];
        break;
      }
      default: {
        throw new Error('Unknown scenario');
      }
    }
    if (kind.startsWith('missing'))
      assert.deepEqual(projectWorkspaceSnapshot(contract).files[0], { path: contract.scope.read[0], content: null, sha256: null });
    else assert.throws(() => projectWorkspaceSnapshot(contract));
  });
}

test('a file edited between read and stat cannot enter the baseline', (t) => {
  const f = fixture(t);
  const original = fs.readSync;
  let injected = false;
  fs.readSync = function (fd, ...args) {
    const result = original.call(this, fd, ...args);
    if (!injected && fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith('/index.js')) {
      injected = true;
      fs.writeFileSync(path.join(f.root, 'index.js'), 'changed');
    }
    return result;
  };
  try {
    assert.throws(() => projectWorkspaceSnapshot(f.contract), /changed during snapshot/);
    assert.equal(injected, true);
  } finally {
    fs.readSync = original;
  }
});

test('changing the workspace directory after reads invalidates its identity', (t) => {
  const f = fixture(t);
  const original = fs.lstatSync;
  let visits = 0;
  fs.lstatSync = function (filename, ...args) {
    if (filename === f.root && ++visits === 2) {
      fs.renameSync(f.root, f.root + '-previous');
      fs.mkdirSync(f.root);
    }
    return original.call(this, filename, ...args);
  };
  try {
    assert.throws(() => projectWorkspaceSnapshot(f.contract), /identity changed/);
  } finally {
    fs.lstatSync = original;
  }
});

test('project hydration rejects supplied file content even with the correct declared baseline', (t) => {
  const f = fixture(t);
  const embedded = { ...f.contract, initial_files: projectWorkspaceSnapshot(f.contract).files };
  assert.throws(() => hydrateProjectTask(embedded), /declared workspace/);
  assert.throws(() => prepareProjectTask({ ...f.contract, schema_version: 1 }));
});

test('whole-file patches round-trip creation, deletion, empty files and newline boundaries through Git', (t) => {
  const f = fixture(t, { files: { 'index.js': 'old\n', 'remove.txt': 'gone', 'empty.txt': '' } });
  const initial = projectWorkspaceSnapshot(f.contract).files;
  const contract = {
    ...f.contract,
    initial_files: initial,
    scope: {
      read: ['index.js', 'remove.txt', 'empty.txt', 'new.txt', 'blank.txt'],
      write: ['index.js', 'remove.txt', 'empty.txt', 'new.txt', 'blank.txt'],
    },
  };
  const files = [
    { path: 'index.js', content: 'new\n' },
    { path: 'remove.txt', content: null },
    { path: 'empty.txt', content: null },
    { path: 'new.txt', content: 'created' },
    { path: 'blank.txt', content: '' },
  ];
  const patch = projectPatch(contract, files);
  execFileSync('git', ['-C', f.root, 'apply', '--index', '-'], { input: patch });
  assert.equal(fs.readFileSync(path.join(f.root, 'index.js'), 'utf8'), 'new\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'new.txt'), 'utf8'), 'created');
  assert.equal(fs.readFileSync(path.join(f.root, 'blank.txt'), 'utf8'), '');
  assert.equal(fs.existsSync(path.join(f.root, 'empty.txt')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'remove.txt')), false);
  assert.throws(() => projectPatch({ ...contract, scope: { ...contract.scope, write: [] } }, files), /read-only/);
  assert.equal(projectPatch({ ...contract, initial_files: files.filter((file) => file.content !== null) }, files), '');
});

test('project snapshots reject Git conversion filters before any project extension can execute', (t) => {
  const f = fixture(t);
  const marker = path.join(f.directory, 'git-filter-effect');
  const script = path.join(f.directory, 'filter.sh');
  fs.writeFileSync(script, `#!/bin/sh\nprintf effect >> '${marker}'\ncat\n`, { mode: 0o700 });
  execFileSync('git', ['-C', f.root, 'config', 'filter.canary.clean', script]);
  fs.writeFileSync(path.join(f.root, '.gitattributes'), '*.js filter=canary\n');
  assert.throws(() => prepareProjectTask(f.contract), /Git conversion filters/);
  assert.throws(() => projectWorkspaceSnapshot(f.contract), /Git conversion filters/);
  assert.equal(fs.existsSync(marker), false);
});

test('project Git worktree redirection cannot change the declared workspace authority', (t) => {
  const f = fixture(t);
  execFileSync('git', ['-C', f.root, 'config', 'core.worktree', f.directory]);
  assert.throws(() => projectWorkspaceSnapshot(f.contract), /Git root/);
});

const { materializeProjectSnapshot } = require('../tools/cli/lib/engineering-workspace');
test('preparation completes only missing entries and reuses exact files', (t) => {
  const f = fixture(t);
  const files = { 'manifest.json': '{}', 'workspace/deep/index.js': 'pinned', 'workspace/empty.txt': '' };
  const destination = materializeProjectSnapshot(f.directory, 'jobs/one', files, ['workspace/empty/nested']);
  const inode = fs.statSync(path.join(destination, 'manifest.json')).ino;
  fs.unlinkSync(path.join(destination, 'workspace/deep/index.js'));
  assert.equal(materializeProjectSnapshot(f.directory, 'jobs/one', files, ['workspace/empty/nested']), destination);
  assert.equal(fs.statSync(path.join(destination, 'manifest.json')).ino, inode);
  assert.equal(fs.readFileSync(path.join(destination, 'workspace/deep/index.js'), 'utf8'), 'pinned');
});
for (const corruption of ['bytes', 'hardlink', 'symlink', 'directory-link', 'extra', 'traversal']) {
  test(`preparation refuses ${corruption} without repairing divergent entries`, (t) => {
    const f = fixture(t);
    const files = { 'workspace/file': 'pinned' };
    const destination = materializeProjectSnapshot(f.directory, 'jobs/one', files);
    const file = path.join(destination, 'workspace/file');
    if (corruption === 'bytes') fs.writeFileSync(file, 'altered');
    if (corruption === 'hardlink') fs.linkSync(file, path.join(f.directory, 'linked'));
    if (corruption === 'symlink') {
      fs.unlinkSync(file);
      fs.symlinkSync(path.join(f.root, 'index.js'), file);
    }
    if (corruption === 'directory-link') {
      fs.renameSync(path.join(destination, 'workspace'), path.join(f.directory, 'moved'));
      fs.symlinkSync(path.join(f.directory, 'moved'), path.join(destination, 'workspace'));
    }
    if (corruption === 'extra') fs.writeFileSync(path.join(destination, 'extra'), 'unexpected');
    assert.throws(() => materializeProjectSnapshot(f.directory, corruption === 'traversal' ? '../escape' : 'jobs/one', files));
    if (corruption === 'bytes') assert.equal(fs.readFileSync(file, 'utf8'), 'altered');
  });
}
for (const mutation of ['delete', 'replace-directory']) {
  test(`preparation detects ${mutation} after the first file was validated`, (t) => {
    const f = fixture(t);
    const files = { 'workspace/a': 'first', 'workspace/b': 'second' };
    const destination = materializeProjectSnapshot(f.directory, 'jobs/one', files);
    const original = fs.readSync;
    let injected = false;
    t.mock.method(fs, 'readSync', (fd, ...args) => {
      const result = original(fd, ...args);
      if (!injected && fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith('/workspace/b')) {
        injected = true;
        if (mutation === 'delete') fs.unlinkSync(path.join(destination, 'workspace/a'));
        else {
          fs.renameSync(path.join(destination, 'workspace'), path.join(destination, 'previous'));
          fs.mkdirSync(path.join(destination, 'workspace'));
          fs.writeFileSync(path.join(destination, 'workspace/a'), 'first');
          fs.writeFileSync(path.join(destination, 'workspace/b'), 'second');
        }
      }
      return result;
    });
    assert.throws(() => materializeProjectSnapshot(f.directory, 'jobs/one', files));
    assert.equal(injected, true);
  });
}
test('preparation syncs existing files and every directory with bounded descriptor reuse', (t) => {
  const f = fixture(t);
  const deep = Array.from({ length: 30 }, () => 'nested').join('/');
  const files = { [`${deep}/file`]: 'pinned' };
  materializeProjectSnapshot(f.directory, 'jobs/one', files, ['empty/child']);
  const original = fs.fsyncSync;
  const synced = new Set();
  let opens = 0;
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (...args) => {
    opens++;
    return open(...args);
  });
  t.mock.method(fs, 'fsyncSync', (fd) => {
    synced.add(fs.readlinkSync(`/proc/self/fd/${fd}`));
    return original(fd);
  });
  materializeProjectSnapshot(f.directory, 'jobs/one', files, ['empty/child']);
  assert.ok(opens < 45, `opened ${opens} descriptors`);
  for (const name of ['', '/jobs', '/jobs/one', '/jobs/one/empty', '/jobs/one/empty/child', `/jobs/one/${deep}/file`])
    assert.ok(synced.has(f.directory + name), `missing fsync ${name}`);
});
