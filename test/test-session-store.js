const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  buildSessionSnapshot,
  completeWorker,
  createLocalSession,
  listSessions,
  recordWorkerHandoff,
  spawnWorker,
} = require('../tools/cli/lib/session/store');

function git(cwd, ...args) {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });
}

async function main() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hseos-session-store-'));
  await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'session-store-test', version: '1.0.0' }, { spaces: 2 });
  await fs.writeFile(path.join(projectDir, 'README.md'), '# session test\n', 'utf8');

  git(projectDir, 'init');
  git(projectDir, 'config', 'user.email', 'test@example.com');
  git(projectDir, 'config', 'user.name', 'HSEOS Test');
  git(projectDir, 'add', '.');
  git(projectDir, 'commit', '-m', 'initial commit');

  const session = await createLocalSession({
    sessionName: 'local-session',
    repoRoot: projectDir,
    workers: [
      {
        name: 'Worker A',
        task: 'Inspect the runtime state',
        seedPaths: ['README.md'],
      },
    ],
  }, { projectDir });

  assert.equal(session.id, 'local-session');
  assert.equal(session.workers.length, 1);
  assert.equal(await fs.pathExists(session.workers[0].worktreePath), true);
  assert.equal(await fs.pathExists(session.workers[0].taskPath), true);

  const spawned = await spawnWorker(projectDir, session.id, session.workers[0].id);
  assert.equal(spawned.state, 'running');

  const handoff = await recordWorkerHandoff(projectDir, session.id, session.workers[0].id, {
    summary: ['Completed worker task'],
    validation: ['Checked status file'],
    remainingRisks: ['No launcher attached'],
  });
  assert.equal(handoff.summary[0], 'Completed worker task');

  const completed = await completeWorker(projectDir, session.id, session.workers[0].id);
  assert.equal(completed.state, 'completed');

  const snapshot = await buildSessionSnapshot(projectDir, session.id);
  assert.equal(snapshot.workerCount, 1);
  assert.equal(snapshot.workerStates.completed, 1);

  const sessions = await listSessions(projectDir);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'local-session');

  console.log('test-session-store: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
