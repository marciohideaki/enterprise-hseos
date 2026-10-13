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

const { pnpmProject, trustStore } = require('./helpers/pnpm-store');
const { resolveStoreTarget } = require('../tools/cli/lib/engineering-workspace');
const STORE_BIN = 'node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-test/bin.js';
const STORE_ASSERT_VIA_LINK = 'node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-assert/index.js';
const STORE_KIT_VIA_LINK = 'node_modules/.pnpm/mini-test@1.0.0/node_modules/@scope/kit/index.js';

test('pnpm store files are read through symlinked package directories and hardlinked content, and keep their declared path', (t) => {
  const f = pnpmProject(t);
  const snapshot = projectWorkspaceSnapshot(f.contract);
  const byPath = new Map(snapshot.files.map((file) => [file.path, file]));
  assert.match(byPath.get(STORE_BIN).content, /mini-assert/);
  assert.match(byPath.get(STORE_ASSERT_VIA_LINK).content, /expected/);
  assert.match(byPath.get(STORE_KIT_VIA_LINK).content, /not ok/);
  const hardlinked = path.join(f.root, 'node_modules/.pnpm/mini-assert@2.0.0/node_modules/mini-assert/index.js');
  assert.equal(fs.statSync(hardlinked).nlink, 2, 'the fixture really shares its inode with the content store');
  assert.equal(
    byPath.get(STORE_ASSERT_VIA_LINK).sha256,
    require('node:crypto').createHash('sha256').update(fs.readFileSync(hardlinked)).digest('hex'),
  );
  assert.equal(hydrateProjectTask(f.contract).initial_files.length, f.contract.scope.read.length);
});

test('an ordinary path never follows a symlink and an ordinary file never accepts a second link', (t) => {
  const viaLink = pnpmProject(t);
  viaLink.contract.scope.read.push('node_modules/mini-test/bin.js');
  assert.throws(() => projectWorkspaceSnapshot(viaLink.contract), { reason: 'PROJECT_FILE_UNSAFE' });
  const second = pnpmProject(t);
  fs.linkSync(path.join(second.root, 'src/sum.js'), path.join(second.directory, 'alias.js'));
  assert.throws(() => projectWorkspaceSnapshot(second.contract), { reason: 'PROJECT_FILE_UNSAFE' });
});

function escapeCase(t, mutate) {
  const f = pnpmProject(t);
  mutate(f);
  return f;
}
const rejectsStore = (f, name, reason) => {
  f.contract.scope.read.push(name);
  assert.throws(() => projectWorkspaceSnapshot(f.contract), { reason }, name);
};

test('store links that leave the verified store are refused: absolute, relative, project-internal and chained', (t) => {
  const evil = 'node_modules/.pnpm/evil@1.0.0/node_modules/evil';
  const outside = (f) => {
    const target = path.join(f.directory, 'outside.js');
    fs.writeFileSync(target, 'secret');
    return target;
  };
  const link = (f, name, target) => {
    fs.mkdirSync(path.join(f.root, evil), { recursive: true });
    fs.symlinkSync(target, path.join(f.root, evil, name));
  };
  const absolute = escapeCase(t, (f) => link(f, 'abs.js', outside(f)));
  rejectsStore(absolute, `${evil}/abs.js`, 'PROJECT_STORE_LINK_ESCAPES');
  const relative = escapeCase(t, (f) => {
    outside(f);
    link(f, 'rel.js', '../../../../../../outside.js');
  });
  rejectsStore(relative, `${evil}/rel.js`, 'PROJECT_STORE_LINK_ESCAPES');
  const internal = escapeCase(t, (f) => link(f, 'inner.js', '../../../../../src/sum.js'));
  rejectsStore(internal, `${evil}/inner.js`, 'PROJECT_STORE_LINK_ESCAPES');
  const chained = escapeCase(t, (f) => {
    link(f, 'hop2.js', path.join(f.root, 'src/sum.js'));
    fs.symlinkSync('hop2.js', path.join(f.root, evil, 'hop1.js'));
  });
  rejectsStore(chained, `${evil}/hop1.js`, 'PROJECT_STORE_LINK_ESCAPES');
  const directory = escapeCase(t, (f) => {
    fs.mkdirSync(path.join(f.directory, 'elsewhere'));
    fs.writeFileSync(path.join(f.directory, 'elsewhere', 'x.js'), 'x');
    link(f, 'dir', path.join(f.directory, 'elsewhere'));
  });
  rejectsStore(directory, `${evil}/dir/x.js`, 'PROJECT_STORE_LINK_ESCAPES');
});

test('the store root itself must be a real directory inside the verified workspace', (t) => {
  const moved = escapeCase(t, (f) => {
    const real = path.join(f.root, 'node_modules/.pnpm');
    fs.renameSync(real, path.join(f.directory, 'pnpm-elsewhere'));
    fs.symlinkSync(path.join(f.directory, 'pnpm-elsewhere'), real);
  });
  assert.throws(() => projectWorkspaceSnapshot(moved.contract), { reason: 'PROJECT_FILE_UNSAFE' });
  const nodeModules = escapeCase(t, (f) => {
    const real = path.join(f.root, 'node_modules');
    fs.renameSync(real, path.join(f.directory, 'nm-elsewhere'));
    fs.symlinkSync(path.join(f.directory, 'nm-elsewhere'), real);
  });
  assert.throws(() => projectWorkspaceSnapshot(nodeModules.contract), { reason: 'PROJECT_FILE_UNSAFE' });
  const absent = pnpmProject(t);
  fs.rmSync(path.join(absent.root, 'node_modules'), { recursive: true, force: true });
  const snapshot = projectWorkspaceSnapshot(absent.contract);
  assert.equal(snapshot.files.find((file) => file.path === STORE_BIN).content, null, 'a missing store reads as absent, never as an error');
  assert.equal(resolveStoreTarget(absent.root, STORE_BIN), null);
  const dangling = pnpmProject(t);
  fs.rmSync(path.join(dangling.root, 'node_modules/.pnpm/mini-assert@2.0.0'), { recursive: true });
  assert.equal(projectWorkspaceSnapshot(dangling.contract).files.find((file) => file.path === STORE_ASSERT_VIA_LINK).content, null);
});

test('non-regular store entries and unreadable store files are refused with a curated reason', (t) => {
  const fifo = pnpmProject(t);
  const fifoPath = path.join(fifo.root, 'node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-test/pipe');
  execFileSync('mkfifo', [fifoPath]);
  fifo.contract.scope.read.push('node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-test/pipe');
  assert.throws(() => projectWorkspaceSnapshot(fifo.contract), { reason: 'PROJECT_FILE_UNSAFE' });
  const directory = pnpmProject(t);
  directory.contract.scope.read.push('node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-test');
  assert.throws(() => projectWorkspaceSnapshot(directory.contract), { reason: 'PROJECT_FILE_UNSAFE' });
});

function replaceStoreFile(f, content) {
  // Replacing the inode (not writing through it) leaves a single-link file, as for a project-local store file.
  const target = path.join(f.root, 'node_modules/.pnpm/mini-assert@2.0.0/node_modules/mini-assert/index.js');
  fs.rmSync(target);
  fs.writeFileSync(target, content);
}

test('a store file is read whole up to 65536 characters and refused, never truncated, one character beyond', (t) => {
  const big = (length) => `${'x'.repeat(length - 1)}\n`;
  const exact = pnpmProject(t);
  replaceStoreFile(exact, big(65_536));
  exact.contract.max_artifact_bytes = 2_097_152;
  const file = projectWorkspaceSnapshot(exact.contract).files.find((entry) => entry.path === STORE_ASSERT_VIA_LINK);
  assert.equal(file.content.length, 65_536);
  const over = pnpmProject(t);
  replaceStoreFile(over, big(65_537));
  over.contract.max_artifact_bytes = 2_097_152;
  assert.throws(() => projectWorkspaceSnapshot(over.contract), { reason: 'PROJECT_FILE_TOO_LARGE', file: STORE_ASSERT_VIA_LINK });
  // Characters, not bytes: 65536 two-byte characters fit the character limit and then the byte budget decides.
  const wide = pnpmProject(t);
  fs.writeFileSync(path.join(wide.root, 'src/sum.js'), 'é'.repeat(65_536));
  wide.contract.max_artifact_bytes = 2_097_152;
  assert.equal(projectWorkspaceSnapshot(wide.contract).files.find((entry) => entry.path === 'src/sum.js').content.length, 65_536);
  const budget = pnpmProject(t);
  fs.writeFileSync(path.join(budget.root, 'src/sum.js'), 'é'.repeat(65_536));
  budget.contract.max_artifact_bytes = 65_536;
  assert.throws(() => projectWorkspaceSnapshot(budget.contract), { reason: 'PROJECT_FILE_TOO_LARGE' });
});

test('scope diagnosis names the store limits instead of the old 64-path rule', (t) => {
  const f = pnpmProject(t);
  const diagnose = (scope) => {
    try {
      prepareProjectTask({ ...structuredClone(f.contract), scope });
      return null;
    } catch (error) {
      return error;
    }
  };
  const tooMany = diagnose({
    read: Array.from({ length: 257 }, (_, i) => `node_modules/.pnpm/p${i}@1/node_modules/p/i.js`),
    write: ['src/sum.js'],
  });
  assert.equal(tooMany.reason, 'PROJECT_SCOPE_INVALID');
  assert.match(tooMany.message, /1 to 256 paths \(64 outside node_modules\/\.pnpm\)/);
  const ordinary = diagnose({ read: Array.from({ length: 65 }, (_, i) => `f${i}.js`), write: ['f0.js'] });
  assert.equal(ordinary.reason, 'PROJECT_SCOPE_INVALID');
  assert.equal(ordinary.field, 'scope.read');
  assert.match(ordinary.message, /at most 64 paths outside/);
  const hidden = diagnose({ read: ['node_modules/.pnpm/../x'], write: ['src/sum.js'] });
  assert.equal(hidden.reason, 'PROJECT_PATH_INVALID');
});

const { runEngineeringTask, inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
const { reviewProjectResult, applyProjectResult } = require('../tools/cli/lib/engineering-workspace');
const sha256 = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex');

async function runProject(t, options, responses) {
  const f = fixture(t, options);
  const responsesFile = path.join(f.directory, 'responses.json');
  fs.writeFileSync(responsesFile, JSON.stringify(responses));
  const result = await runEngineeringTask({ taskContract: f.filename, scriptedResponses: responsesFile });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  return { f, result, evidence: () => inspectEngineeringTask({ state: result.state, action: 'evidence' }) };
}
const patchResponse = (before, after) => [
  { name: 'engineering.patch', input: { path: 'index.js', expected_sha256: sha256(before), before: 'n - 1', after: 'n + 1' } },
];

test('an approved project result is reviewed against the Git baseline and applied once, with staged changes only', async (t) => {
  const original = 'module.exports = n => n - 1;';
  const run = await runProject(t, { files: { 'index.js': original } }, patchResponse(original));
  assert.equal(run.result.task_result, 'approved', JSON.stringify(run.result));
  const evidence = await run.evidence();
  const review = reviewProjectResult(evidence);
  assert.equal(review.baseline_valid, true);
  assert.match(review.patch, /^diff --git a\/index\.js b\/index\.js/);
  assert.equal(fs.readFileSync(path.join(run.f.root, 'index.js'), 'utf8'), original, 'review never writes the project');
  const applied = applyProjectResult(evidence, review.review_sha256);
  assert.equal(applied.applied, true);
  assert.equal(fs.readFileSync(path.join(run.f.root, 'index.js'), 'utf8'), 'module.exports = n => n + 1;');
  assert.match(execFileSync('git', ['-C', run.f.root, 'diff', '--cached', '--name-only'], { encoding: 'utf8' }), /index\.js/);
  assert.equal(
    execFileSync('git', ['-C', run.f.root, 'log', '--oneline'], { encoding: 'utf8' }).trim().split('\n').length,
    1,
    'never auto-commits',
  );
  assert.throws(() => applyProjectResult(evidence, review.review_sha256), { reason: 'PROJECT_APPROVAL_STALE' });
});

test('a stale, mismatched or unapproved review refuses to apply and never changes the project', async (t) => {
  const original = 'module.exports = n => n - 1;';
  const run = await runProject(t, { files: { 'index.js': original } }, patchResponse(original));
  const evidence = await run.evidence();
  const review = reviewProjectResult(evidence);
  assert.throws(() => applyProjectResult(evidence, '0'.repeat(64)), { reason: 'PROJECT_APPROVAL_STALE' });
  fs.writeFileSync(path.join(run.f.root, 'index.js'), 'module.exports = n => n;');
  assert.equal(reviewProjectResult(evidence).baseline_valid, false);
  assert.throws(() => applyProjectResult(evidence, review.review_sha256), { reason: 'PROJECT_APPROVAL_STALE' });
  assert.equal(fs.readFileSync(path.join(run.f.root, 'index.js'), 'utf8'), 'module.exports = n => n;');

  const failed = await runProject(t, { files: { 'index.js': original }, expected: 99 }, []);
  assert.equal(failed.result.task_result, 'failed');
  assert.throws(() => reviewProjectResult(unapprovedEvidence(failed)), { reason: 'PROJECT_RESULT_NOT_APPROVED' });
  assert.throws(() => reviewProjectResult({ contract: { schema_version: 1 } }), { reason: 'PROJECT_RESULT_NOT_APPROVED' });
});
function unapprovedEvidence(run) {
  return { ...run.result, contract: run.f.contract, state: run.result.state, task_result: run.result.task_result, artifacts: null };
}

test('a candidate edited after verification invalidates the review', async (t) => {
  const original = 'module.exports = n => n - 1;';
  const run = await runProject(t, { files: { 'index.js': original } }, patchResponse(original));
  const evidence = await run.evidence();
  fs.writeFileSync(path.join(run.result.state, 'workspace', 'index.js'), 'module.exports = n => n + 100;');
  assert.throws(() => reviewProjectResult(evidence), { reason: 'PROJECT_CANDIDATE_CHANGED' });
});

test('an approved result without edits has an empty patch and applies as a no-op', async (t) => {
  const run = await runProject(t, {}, []);
  assert.equal(run.result.task_result, 'approved', JSON.stringify(run.result));
  const evidence = await run.evidence();
  const review = reviewProjectResult(evidence);
  assert.equal(review.patch, '');
  assert.equal(applyProjectResult(evidence, review.review_sha256).applied, true);
});

test('project patches describe new, deleted, emptied and rewritten files and refuse read-only paths', () => {
  const contract = {
    initial_files: [
      { path: 'keep.js', content: 'same\n' },
      { path: 'edit.js', content: 'one\ntwo' },
      { path: 'gone.js', content: 'bye\n' },
      { path: 'blank.js', content: '' },
    ],
    scope: { write: ['keep.js', 'edit.js', 'gone.js', 'blank.js', 'fresh.js', 'empty-new.js'] },
  };
  const patch = projectPatch(contract, [
    { path: 'keep.js', content: 'same\n' },
    { path: 'edit.js', content: 'one\nthree\n' },
    { path: 'gone.js', content: null },
    { path: 'blank.js', content: null },
    { path: 'fresh.js', content: 'new\n' },
    { path: 'empty-new.js', content: '' },
  ]);
  assert.doesNotMatch(patch, /keep\.js/);
  assert.match(patch, /\\ No newline at end of file/);
  assert.match(patch, /deleted file mode 100644\n--- a\/gone\.js\n\+\+\+ \/dev\/null/);
  assert.match(patch, /new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/fresh\.js/);
  assert.match(patch, /deleted file mode 100644\nindex e69de29\.\.0000000/);
  assert.match(patch, /new file mode 100644\nindex 0000000\.\.e69de29/);
  assert.throws(() => projectPatch({ ...contract, scope: { write: [] } }, [{ path: 'edit.js', content: 'x' }]), {
    reason: 'PROJECT_PATCH_READ_ONLY_PATH',
  });
});

const {
  verifyPnpmStoreMount,
  materializeStoreLinks,
  pnpmStoreDirectory,
  controllerStoreDirs,
  trustPnpmStores,
} = require('../tools/cli/lib/engineering-workspace');
const STORE_ENTRY_DIR = 'node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-test';

test('filesystem failures on a store path are reported with a fixed message and never with the host path', (t) => {
  const curated = (f, name, reason) => {
    f.contract.scope.read.push(name);
    let error;
    try {
      projectWorkspaceSnapshot(f.contract);
    } catch (error_) {
      error = error_;
    }
    assert.equal(error?.reason, reason, name);
    assert.equal(error.message.includes(f.root), false, 'the message carries no host path');
    assert.equal(error.message.includes(f.directory), false);
  };
  const loop = pnpmProject(t);
  const loopDirectory = path.join(loop.root, 'node_modules/.pnpm/loop@1.0.0/node_modules/loop');
  fs.mkdirSync(loopDirectory, { recursive: true });
  fs.symlinkSync('b', path.join(loopDirectory, 'a'));
  fs.symlinkSync('a', path.join(loopDirectory, 'b'));
  curated(loop, 'node_modules/.pnpm/loop@1.0.0/node_modules/loop/a/x.js', 'PROJECT_FILE_UNSAFE');
  const notDirectory = pnpmProject(t);
  curated(notDirectory, `${STORE_ENTRY_DIR}/package.json/inner.js`, 'PROJECT_FILE_UNSAFE');
  const locked = pnpmProject(t);
  const lockedDirectory = path.join(locked.root, 'node_modules/.pnpm/locked@1.0.0');
  fs.mkdirSync(path.join(lockedDirectory, 'inner'), { recursive: true });
  fs.writeFileSync(path.join(lockedDirectory, 'inner', 'f.js'), 'x');
  fs.chmodSync(lockedDirectory, 0);
  try {
    curated(locked, 'node_modules/.pnpm/locked@1.0.0/inner/f.js', 'PROJECT_FILE_UNREADABLE');
  } finally {
    fs.chmodSync(lockedDirectory, 0o700);
  }
});

test('a store file with several links is accepted only when it is the pnpm content-addressed inode', (t) => {
  const secretFile = (f) => {
    const secret = path.join(f.directory, 'private-key');
    fs.writeFileSync(secret, 'PRIVATE KEY MATERIAL\n');
    return secret;
  };
  const read = (f) => projectWorkspaceSnapshot(f.contract);
  const hardlinkTo = (f, secret) => {
    const target = path.join(f.root, 'node_modules/.pnpm/mini-assert@2.0.0/node_modules/mini-assert/index.js');
    fs.rmSync(target);
    fs.linkSync(secret, target);
  };
  // A hardlink to a private file is the exfiltration vector: it is refused with its own reason.
  const stolen = pnpmProject(t);
  hardlinkTo(stolen, secretFile(stolen));
  assert.throws(() => read(stolen), { reason: 'PROJECT_STORE_HARDLINK_UNVERIFIED' });
  // The same content copied into the store by name but as a different inode is not the store file either.
  const copied = pnpmProject(t);
  const secret = secretFile(copied);
  hardlinkTo(copied, secret);
  fs.writeFileSync(copied.addressed(fs.readFileSync(secret)), fs.readFileSync(secret));
  assert.throws(() => read(copied), { reason: 'PROJECT_STORE_HARDLINK_UNVERIFIED' });
  // The legitimate store inode is accepted, including the executable variant.
  assert.doesNotThrow(() => read(pnpmProject(t)));
  const executable = pnpmProject(t);
  const original = path.join(executable.root, 'node_modules/.pnpm/mini-assert@2.0.0/node_modules/mini-assert/index.js');
  const bytes = fs.readFileSync(original);
  const shared = executable.addressed(bytes, '-exec');
  fs.rmSync(original);
  fs.writeFileSync(shared, bytes);
  fs.linkSync(shared, original);
  assert.doesNotThrow(() => read(executable));
  // A legacy layout keeps its files below v<N>/files.
  const legacy = pnpmProject(t);
  const legacyOriginal = path.join(legacy.root, 'node_modules/.pnpm/mini-assert@2.0.0/node_modules/mini-assert/index.js');
  const legacyBytes = fs.readFileSync(legacyOriginal);
  const hex = require('node:crypto').createHash('sha512').update(legacyBytes).digest('hex');
  const versioned = path.join(legacy.contentStore, 'v3', 'files', hex.slice(0, 2));
  fs.mkdirSync(versioned, { recursive: true });
  fs.rmSync(legacyOriginal);
  fs.writeFileSync(path.join(versioned, hex.slice(2)), legacyBytes);
  fs.linkSync(path.join(versioned, hex.slice(2)), legacyOriginal);
  fs.rmSync(path.join(legacy.contentStore, 'files'), { recursive: true });
  assert.doesNotThrow(() => read(legacy));
});

test('a store the controller trusts must still be a real directory of the current user outside the project', (t) => {
  const f = pnpmProject(t);
  const modules = path.join(f.root, 'node_modules/.modules.yaml');
  const write = (value) => fs.writeFileSync(modules, typeof value === 'string' ? value : JSON.stringify(value));
  assert.equal(pnpmStoreDirectory(f.root), f.contentStore);
  const link = path.join(f.directory, 'store-link');
  fs.symlinkSync(f.contentStore, link);
  const inside = path.join(f.root, 'forged-store');
  fs.mkdirSync(inside);
  const file = path.join(f.directory, 'plain-file');
  fs.writeFileSync(file, 'x');
  const missing = path.join(f.directory, 'missing');
  for (const trusted of [link, inside, f.root, file, missing]) trustStore(t, trusted);
  for (const value of [
    { storeDir: link },
    { storeDir: inside },
    { storeDir: f.root },
    { storeDir: 'relative/store' },
    { storeDir: `${f.contentStore}/../content-store` },
    { storeDir: missing },
    { storeDir: file },
    { storeDir: 7 },
    { other: true },
    '[: not yaml',
  ]) {
    write(value);
    assert.equal(pnpmStoreDirectory(f.root), null, JSON.stringify(value));
  }
  fs.rmSync(modules);
  assert.equal(pnpmStoreDirectory(f.root), null, 'no .modules.yaml');
  fs.mkdirSync(modules);
  assert.equal(pnpmStoreDirectory(f.root), null, 'a directory instead of the file');
  fs.rmdirSync(modules);
  write(' '.repeat(4_194_305));
  assert.equal(pnpmStoreDirectory(f.root), null, 'oversized');
  write({ storeDir: inside });
  assert.throws(
    () => projectWorkspaceSnapshot(f.contract),
    { reason: 'PROJECT_STORE_HARDLINK_UNVERIFIED' },
    'no usable store: every second link is unverified',
  );
});

test('the owner of a trusted store is checked: a store of another user is unusable', (t) => {
  const f = pnpmProject(t);
  assert.equal(pnpmStoreDirectory(f.root), f.contentStore);
  t.mock.method(process, 'getuid', () => process.getuid.mock.calls.length + 4_000_000);
  assert.equal(pnpmStoreDirectory(f.root), null);
  assert.throws(() => projectWorkspaceSnapshot(f.contract), { reason: 'PROJECT_STORE_HARDLINK_UNVERIFIED' });
  assert.throws(() => verifyPnpmStoreMount(f.root), { reason: 'PROJECT_STORE_HARDLINK_UNVERIFIED' });
});

test('a storeDir named by the project is refused unless the controller trusts it, so a forged store cannot launder a private file', (t) => {
  const f = pnpmProject(t);
  const secret = path.join(f.directory, 'private-key');
  fs.writeFileSync(secret, 'TOPSECRET-A\n');
  const target = path.join(f.root, 'node_modules/.pnpm/mini-assert@2.0.0/node_modules/mini-assert/index.js');
  fs.rmSync(target);
  fs.linkSync(secret, target);
  // The forged store lives outside the project, belongs to the user, and holds the secret under a valid content address.
  const forged = path.join(f.directory, 'forged-store');
  const hex = require('node:crypto').createHash('sha512').update(fs.readFileSync(secret)).digest('hex');
  fs.mkdirSync(path.join(forged, 'files', hex.slice(0, 2)), { recursive: true });
  fs.linkSync(secret, path.join(forged, 'files', hex.slice(0, 2), hex.slice(2)));
  fs.writeFileSync(path.join(f.root, 'node_modules/.modules.yaml'), JSON.stringify({ storeDir: forged }));
  let leaked = null;
  try {
    leaked = projectWorkspaceSnapshot(f.contract).files.find((file) => file.path === STORE_ASSERT_VIA_LINK)?.content;
  } catch (error) {
    assert.equal(error.reason, 'PROJECT_STORE_DIR_NOT_ALLOWED');
    assert.equal(error.message.includes(forged), false);
  }
  assert.equal(leaked, null, 'TOPSECRET-A never reaches the snapshot');
  assert.throws(() => pnpmStoreDirectory(f.root), { reason: 'PROJECT_STORE_DIR_NOT_ALLOWED' });
  assert.throws(() => verifyPnpmStoreMount(f.root), { reason: 'PROJECT_STORE_DIR_NOT_ALLOWED' });
  // Same attack with the real store named but not trusted (a project cannot widen the allowlist either).
  fs.writeFileSync(path.join(f.root, 'node_modules/.modules.yaml'), JSON.stringify({ storeDir: f.contentStore }));
  trustPnpmStores([]);
  assert.throws(() => pnpmStoreDirectory(f.root), { reason: 'PROJECT_STORE_DIR_NOT_ALLOWED' });
  fs.writeFileSync(path.join(f.root, '.npmrc'), `store-dir=${f.contentStore}\n`);
  assert.throws(() => pnpmStoreDirectory(f.root), { reason: 'PROJECT_STORE_DIR_NOT_ALLOWED' }, 'a project .npmrc is not a trusted source');
  trustStore(t, f.contentStore);
  assert.equal(pnpmStoreDirectory(f.root), f.contentStore);
});

test('the trusted stores come only from controller files: the user rc, the pnpm default, the HSEOS configuration and the internal API', (t) => {
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hseos-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.config', 'pnpm'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'hseos'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'pnpm', 'rc'), 'registry=https://example.invalid\nstore-dir=/rc/store\n');
  fs.writeFileSync(
    path.join(home, '.config', 'hseos', 'config.yaml'),
    'toolchain:\n  pnpm_store_dirs:\n    - /controller/a\n    - relative\n    - /controller/b/\n',
  );
  const restore = trustPnpmStores(['/injected/store', 'relative-injected']);
  t.after(restore);
  const listed = controllerStoreDirs({ home });
  for (const expected of ['/injected/store', '/controller/a', '/controller/b', '/rc/store', path.join(home, '.local/share/pnpm/store')]) {
    assert.ok(listed.includes(expected), expected);
  }
  assert.equal(listed.includes('relative'), false, 'relative entries are dropped');
  assert.equal(listed.includes('relative-injected'), false);
  restore();
  assert.equal(controllerStoreDirs({ home }).includes('/injected/store'), false, 'the injected list is restored');
  // The user home comes from the account database, never from a variable a project script could set.
  assert.deepEqual(controllerStoreDirs().slice(-1), [path.join(require('node:os').userInfo().homedir, '.local/share/pnpm/store')]);
  // The v<N> directory below a trusted base is the store pnpm actually writes to; nothing else below it is.
  const f = pnpmProject(t);
  const base = path.join(f.directory, 'pnpm-base');
  for (const name of ['v11', 'v11x', 'other']) fs.mkdirSync(path.join(base, name), { recursive: true });
  trustStore(t, base);
  const declare = (name) =>
    fs.writeFileSync(path.join(f.root, 'node_modules/.modules.yaml'), JSON.stringify({ storeDir: path.join(base, name) }));
  declare('v11');
  assert.equal(pnpmStoreDirectory(f.root), path.join(base, 'v11'));
  for (const name of ['v11x', 'other']) {
    declare(name);
    assert.throws(() => pnpmStoreDirectory(f.root), { reason: 'PROJECT_STORE_DIR_NOT_ALLOWED' }, name);
  }
});

function forgedStoreProject(t) {
  const f = pnpmProject(t);
  const secret = path.join(f.directory, 'private-key');
  fs.writeFileSync(secret, 'TOPSECRET-A\n');
  const target = path.join(f.root, 'node_modules/.pnpm/mini-assert@2.0.0/node_modules/mini-assert/index.js');
  fs.rmSync(target);
  fs.linkSync(secret, target);
  const forged = path.join(f.directory, 'forged-store');
  const hex = require('node:crypto').createHash('sha512').update(fs.readFileSync(secret)).digest('hex');
  fs.mkdirSync(path.join(forged, 'files', hex.slice(0, 2)), { recursive: true });
  fs.linkSync(secret, path.join(forged, 'files', hex.slice(0, 2), hex.slice(2)));
  fs.writeFileSync(path.join(f.root, 'node_modules/.modules.yaml'), JSON.stringify({ storeDir: forged }));
  fs.writeFileSync(path.join(f.root, '.npmrc'), `store-dir=${forged}\n`);
  return { ...f, forged };
}

test('no environment variable can add a trusted store: a project script that exports them is refused', (t) => {
  const f = forgedStoreProject(t);
  trustPnpmStores([]);
  const variables = { HSEOS_PNPM_STORE_DIRS: f.forged, PNPM_STORE_DIR: f.forged, npm_config_store_dir: f.forged };
  const saved = Object.fromEntries(Object.keys(variables).map((name) => [name, process.env[name]]));
  Object.assign(process.env, variables);
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  assert.ok(!controllerStoreDirs().includes(f.forged));
  assert.throws(() => pnpmStoreDirectory(f.root), { reason: 'PROJECT_STORE_DIR_NOT_ALLOWED' });
  assert.throws(() => projectWorkspaceSnapshot(f.contract), { reason: 'PROJECT_STORE_DIR_NOT_ALLOWED' });
  assert.throws(() => verifyPnpmStoreMount(f.root), { reason: 'PROJECT_STORE_DIR_NOT_ALLOWED' });
  // The ignored variables are reported, once per process, instead of being silently dropped.
  const probe = `console.log(JSON.stringify(require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'lib', 'engineering-workspace.js'))}).controllerStoreDirs({ home: '/nonexistent-home' })))`;
  const child = require('node:child_process').spawnSync(process.execPath, ['-e', probe], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...variables },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(!JSON.parse(child.stdout).includes(f.forged));
  for (const name of Object.keys(variables)) assert.match(child.stderr, new RegExp(`${name} is ignored`));
  // A forged HOME does not move the user configuration either: the home comes from the account database.
  const homeProbe = `console.log(JSON.stringify(require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'lib', 'engineering-workspace.js'))}).controllerStoreDirs()))`;
  const forgedHome = require('node:child_process').spawnSync(process.execPath, ['-e', homeProbe], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: '/forged-home' },
  });
  assert.equal(forgedHome.status, 0, forgedHome.stderr);
  assert.ok(!JSON.parse(forgedHome.stdout).some((entry) => entry.startsWith('/forged-home')));
});

test('the exact attack through npm: run from a project npm script, the project .npmrc store-dir is exported and still refused', (t) => {
  const f = forgedStoreProject(t);
  trustPnpmStores([]);
  const npm = path.join(path.dirname(process.execPath), 'npm');
  const workspaceModule = path.join(__dirname, '..', 'tools', 'cli', 'lib', 'engineering-workspace.js');
  fs.writeFileSync(
    path.join(f.root, 'check.cjs'),
    `const w = require(${JSON.stringify(workspaceModule)});\nconst out = { exported: process.env.npm_config_store_dir };\ntry { out.store = w.pnpmStoreDirectory(${JSON.stringify(f.root)}); } catch (error) { out.reason = error.reason; }\nconsole.log(JSON.stringify(out));\n`,
  );
  fs.writeFileSync(
    path.join(f.root, 'package.json'),
    JSON.stringify({ name: 'forged-project', version: '1.0.0', scripts: { probe: 'node check.cjs' } }),
  );
  const output = execFileSync(npm, ['run', '--silent', 'probe'], {
    cwd: f.root,
    encoding: 'utf8',
    env: { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, HOME: f.directory, NODE_NO_WARNINGS: '1' },
  });
  const seen = JSON.parse(output.trim().split('\n').pop());
  assert.equal(seen.exported, f.forged, 'npm really exported the project store-dir as npm_config_store_dir');
  assert.equal(seen.reason, 'PROJECT_STORE_DIR_NOT_ALLOWED');
  assert.equal(seen.store, undefined);
});

test('the store mount verifies a real, confined and content-addressed store, and refuses every other shape', (t) => {
  const good = pnpmProject(t, { mounted: true });
  const verified = verifyPnpmStoreMount(good.root);
  assert.equal(verified.source, path.join(good.root, 'node_modules/.pnpm'));
  assert.equal(verified.target, '/opt/hseos/pnpm-store');
  assert.equal(verified.hardlinks, 1);
  assert.equal(verified.symlinks, 2);
  assert.ok(Object.isFrozen(verified));
  const refused = (mutate, reason, options = {}) => {
    const f = pnpmProject(t, { mounted: true, ...options });
    mutate(f);
    assert.throws(() => verifyPnpmStoreMount(f.root), { reason });
  };
  const inStore = (f, ...parts) => path.join(f.root, 'node_modules/.pnpm', ...parts);
  refused((f) => fs.symlinkSync('/etc/hostname', inStore(f, 'abs-link')), 'PROJECT_STORE_LINK_ESCAPES');
  refused((f) => fs.symlinkSync('../../../../src/sum.js', inStore(f, 'mini-test@1.0.0', 'escape')), 'PROJECT_STORE_LINK_ESCAPES');
  // A monorepo links its own workspace packages into the store: inside the project root that is accepted.
  fs.mkdirSync(path.join(good.root, 'packages/x'), { recursive: true });
  fs.symlinkSync('../../../packages/x', path.join(good.root, 'node_modules/.pnpm/mini-test@1.0.0/node_modules/workspace-x'));
  assert.equal(verifyPnpmStoreMount(good.root).symlinks, 3);
  refused((f) => fs.symlinkSync('../../../..', inStore(f, 'mini-test@1.0.0', 'parent')), 'PROJECT_STORE_LINK_ESCAPES');
  refused((f) => {
    const secret = path.join(f.directory, 'private-key');
    fs.writeFileSync(secret, 'PRIVATE KEY MATERIAL\n');
    fs.linkSync(secret, inStore(f, 'secret'));
  }, 'PROJECT_STORE_HARDLINK_UNVERIFIED');
  refused((f) => execFileSync('mkfifo', [inStore(f, 'pipe')]), 'PROJECT_FILE_UNSAFE');
  refused((f) => {
    const move = path.join(f.directory, 'pnpm-elsewhere');
    fs.renameSync(inStore(f), move);
    fs.symlinkSync(move, inStore(f));
  }, 'PROJECT_STORE_MOUNT_UNSAFE');
  refused((f) => fs.rmSync(inStore(f), { recursive: true }), 'PROJECT_STORE_MOUNT_UNSAFE');
  refused((f) => {
    const move = path.join(f.directory, 'nm-elsewhere');
    fs.renameSync(path.join(f.root, 'node_modules'), move);
    fs.symlinkSync(move, path.join(f.root, 'node_modules'));
  }, 'PROJECT_STORE_MOUNT_UNSAFE');
  const aliased = path.join(good.directory, 'project-alias');
  fs.symlinkSync(good.root, aliased);
  assert.throws(() => verifyPnpmStoreMount(aliased), { reason: 'PROJECT_WORKSPACE_UNSAFE' });
  assert.throws(() => verifyPnpmStoreMount(path.join(good.directory, 'absent')), { reason: 'PROJECT_WORKSPACE_UNSAFE' });
});

test('the store mount refuses a store beyond its entry budget instead of sampling it', (t) => {
  const f = pnpmProject(t, { mounted: true });
  const fake = (name) => ({ name, isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false });
  const original = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (target, options) =>
    options?.withFileTypes && String(target).endsWith('node_modules/.pnpm')
      ? Array.from({ length: 300_001 }, (_, index) => fake(`d${index}`))
      : original(target, options),
  );
  assert.throws(() => verifyPnpmStoreMount(f.root), { reason: 'PROJECT_STORE_TOO_LARGE' });
});

test('the store mount reports an unreadable store directory with a curated reason', (t) => {
  const f = pnpmProject(t, { mounted: true });
  const locked = path.join(f.root, 'node_modules/.pnpm/locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0);
  try {
    assert.throws(() => verifyPnpmStoreMount(f.root), { reason: 'PROJECT_FILE_UNREADABLE' });
  } finally {
    fs.chmodSync(locked, 0o700);
  }
});

test('store links are recreated in the task workspace: .pnpm points at the mount and only confined package links are copied', (t) => {
  const f = pnpmProject(t, { mounted: true });
  const nodeModules = path.join(f.root, 'node_modules');
  fs.symlinkSync('/etc', path.join(nodeModules, 'absolute-link'));
  fs.symlinkSync('../src', path.join(nodeModules, 'escaping-link'));
  fs.mkdirSync(path.join(nodeModules, '@scope'));
  fs.symlinkSync('../.pnpm/@scope+kit@3.1.0_mini-assert@2.0.0/node_modules/@scope/kit', path.join(nodeModules, '@scope', 'kit'));
  fs.symlinkSync('/etc', path.join(nodeModules, '@scope', 'bad'));
  fs.symlinkSync('../../src', path.join(nodeModules, '@scope', 'worse'));
  fs.mkdirSync(path.join(nodeModules, 'plain-directory'));
  fs.symlinkSync('.pnpm/mini-test@1.0.0/node_modules/mini-test', path.join(nodeModules, '.hidden-link'));
  const workspace = path.join(f.directory, 'task-workspace');
  fs.mkdirSync(workspace);
  const copied = materializeStoreLinks(f.root, workspace);
  assert.equal(copied, 2);
  const modules = path.join(workspace, 'node_modules');
  assert.equal(fs.readlinkSync(path.join(modules, '.pnpm')), '/opt/hseos/pnpm-store');
  assert.equal(fs.readlinkSync(path.join(modules, 'mini-test')), '.pnpm/mini-test@1.0.0/node_modules/mini-test');
  assert.equal(fs.readlinkSync(path.join(modules, '@scope', 'kit')), '../.pnpm/@scope+kit@3.1.0_mini-assert@2.0.0/node_modules/@scope/kit');
  assert.deepEqual(fs.readdirSync(modules).sort(), ['.pnpm', '@scope', 'mini-test']);
  assert.deepEqual(fs.readdirSync(path.join(modules, '@scope')), ['kit']);
});

const { summarizePnpmStore, pinStoreMount, assertStoreMountUnchanged } = require('../tools/cli/lib/engineering-workspace');
const { readEngineeringTask } = require('../tools/cli/lib/engineering-task-contract');
const { verifyEngineeringTask } = require('../tools/cli/lib/engineering-project-verifier');

test('the verified store is pinned by a content-free fingerprint and any change before a launch is refused', (t) => {
  const f = pnpmProject(t, { mounted: true });
  const mount = verifyPnpmStoreMount(f.root);
  assert.equal(summarizePnpmStore(f.root).sha256, mount.summary.sha256, 'the fingerprint is stable');
  assert.ok(mount.summary.entries >= 17);
  const policy = {};
  pinStoreMount(policy, f.root, mount);
  assert.doesNotThrow(() => assertStoreMountUnchanged(policy, f.contract));
  assert.doesNotThrow(() =>
    assertStoreMountUnchanged(policy, structuredClone({ ...f.contract, workspace: { ...f.contract.workspace, store_mount: undefined } })),
  );
  assert.doesNotThrow(() => assertStoreMountUnchanged(policy, { schema_version: 1 }));
  const drift = () => assert.throws(() => assertStoreMountUnchanged(policy, f.contract), { reason: 'PROJECT_STORE_DRIFT' });
  const inStore = (...parts) => path.join(f.root, 'node_modules/.pnpm', ...parts);
  // A hardlink to a private file added after the verification.
  const secret = path.join(f.directory, 'private-key');
  fs.writeFileSync(secret, 'TOPSECRET-B\n');
  fs.linkSync(secret, inStore('mini-test@1.0.0', 'late.js'));
  drift();
  fs.rmSync(inStore('mini-test@1.0.0', 'late.js'));
  drift(); // the directory it touched keeps a new modification time: the pin is not restored by hiding the evidence
  // Content rewritten in place, an entry removed, and a link retargeted are all visible without reading content.
  const target = inStore('mini-test@1.0.0', 'node_modules', 'mini-test', 'package.json');
  const original = fs.readFileSync(target);
  fs.appendFileSync(target, ' ');
  drift();
  fs.writeFileSync(target, original);
  fs.utimesSync(target, new Date(0), new Date(0));
  drift();
  const mutated = pnpmProject(t, { mounted: true });
  pinStoreMount(policy, mutated.root, verifyPnpmStoreMount(mutated.root));
  const retarget = path.join(mutated.root, 'node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-assert');
  fs.rmSync(retarget);
  fs.symlinkSync('../../mini-assert@2.0.0/node_modules', retarget);
  assert.throws(() => assertStoreMountUnchanged(policy, mutated.contract), { reason: 'PROJECT_STORE_DRIFT' });
  // A policy that was never pinned is verified in full instead of being trusted.
  const late = pnpmProject(t, { mounted: true });
  fs.linkSync(secret, path.join(late.root, 'node_modules/.pnpm/mini-test@1.0.0/late.js'));
  assert.throws(() => assertStoreMountUnchanged({}, late.contract), { reason: 'PROJECT_STORE_HARDLINK_UNVERIFIED' });
});

test('the protected verifier refuses to launch against a store that changed after it was pinned', async (t) => {
  const f = pnpmProject(t, { mounted: true });
  const { contract } = readEngineeringTask(f.filename);
  const policy = {};
  pinStoreMount(policy, f.root, verifyPnpmStoreMount(f.root));
  const secret = path.join(f.directory, 'private-key');
  fs.writeFileSync(secret, 'TOPSECRET-C\n');
  fs.linkSync(secret, path.join(f.root, 'node_modules/.pnpm/mini-test@1.0.0/late.js'));
  const verdict = await verifyEngineeringTask({ contract, policy, deadline: Date.now() + 30_000, files: contract.initial_files });
  assert.equal(verdict.approved, false);
  assert.equal(verdict.reason, 'store-drift');
});

test('an in-place rewrite with the same inode, the same size and a restored nanosecond mtime is still noticed (ctime cannot be restored)', (t) => {
  const f = pnpmProject(t, { mounted: true });
  const policy = {};
  pinStoreMount(policy, f.root, verifyPnpmStoreMount(f.root));
  const target = path.join(f.root, 'node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-test/package.json');
  const before = fs.lstatSync(target, { bigint: true });
  const content = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, content.replace('mini-test', 'mini-hack'));
  assert.equal(fs.statSync(target).size, Number(before.size), 'same size');
  // os.utime with nanoseconds, the way an attacker would restore the timestamps.
  execFileSync('python3', [
    '-c',
    'import os,sys; os.utime(sys.argv[1], ns=(int(sys.argv[2]), int(sys.argv[3])))',
    target,
    String(before.atimeNs),
    String(before.mtimeNs),
  ]);
  const after = fs.lstatSync(target, { bigint: true });
  assert.equal(after.ino, before.ino, 'same inode');
  assert.equal(after.mtimeNs, before.mtimeNs, 'mtime restored to the nanosecond');
  assert.notEqual(after.ctimeNs, before.ctimeNs, 'ctime moved');
  assert.throws(() => assertStoreMountUnchanged(policy, f.contract), { reason: 'PROJECT_STORE_DRIFT' });
});

test('every field of the store fingerprint matters on its own: dev, ino, size, mtime, ctime and nlink each change the digest', (t) => {
  const f = pnpmProject(t, { mounted: true });
  const baseline = summarizePnpmStore(f.root).sha256;
  const target = path.join(f.root, 'node_modules/.pnpm/mini-test@1.0.0/node_modules/mini-test/package.json');
  const original = fs.lstatSync;
  for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink']) {
    t.mock.method(fs, 'lstatSync', (file, options) => {
      const stat = original(file, options);
      return file === target && options?.bigint
        ? new Proxy(stat, { get: (value, key) => (key === field ? value[key] + 1n : value[key]) })
        : stat;
    });
    assert.notEqual(summarizePnpmStore(f.root).sha256, baseline, field);
    t.mock.restoreAll();
  }
  assert.equal(summarizePnpmStore(f.root).sha256, baseline);
});

test('a pin belongs to one project root, and a store that moves while it is verified is refused', (t) => {
  const first = pnpmProject(t, { mounted: true });
  const second = pnpmProject(t, { mounted: true });
  const policy = {};
  pinStoreMount(policy, first.root, verifyPnpmStoreMount(first.root));
  // The other project is verified on its own instead of being compared with the first project pin.
  assert.doesNotThrow(() => assertStoreMountUnchanged(policy, second.contract));
  assert.doesNotThrow(() => assertStoreMountUnchanged(policy, second.contract));
  const moving = pnpmProject(t, { mounted: true });
  const original = fs.readlinkSync;
  let moved = false;
  t.mock.method(fs, 'readlinkSync', (...args) => {
    if (!moved) {
      moved = true;
      fs.writeFileSync(path.join(moving.root, 'node_modules/.pnpm/appeared-during-verification'), 'x');
    }
    return original(...args);
  });
  assert.throws(() => verifyPnpmStoreMount(moving.root), { reason: 'PROJECT_STORE_DRIFT' });
  assert.equal(moved, true);
});
