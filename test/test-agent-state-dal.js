/**
 * AgentStateDAL smoke tests.
 *
 * Uses an in-memory SQLite DB; runs all migrations from
 * `tools/mcp-project-state/migrations/` and exercises core DAL methods.
 * Skip cleanly if better-sqlite3 is not installed.
 */

const path = require('node:path');
const assert = require('node:assert');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  console.warn('[test-agent-state-dal] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const { AgentStateDAL } = require('../tools/mcp-project-state/lib/agent-state-dal');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  return new AgentStateDAL(db);
}

let pass = 0;
let fail = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    fail++;
  }
}

console.log('AgentStateDAL smoke tests');

it('migrations apply cleanly to in-memory db', () => {
  const dal = setup();
  assert.ok(dal);
});

it('createRun + describeRun roundtrip', () => {
  const dal = setup();
  dal.createRun({ id: 'R1', workflow_id: 'dev-squad', project: '/tmp/repo' });
  const desc = dal.describeRun('R1');
  assert.strictEqual(desc.run.id, 'R1');
  assert.strictEqual(desc.run.workflow_id, 'dev-squad');
});

it('createTask + claimTask atomic flow', () => {
  const dal = setup();
  dal.createRun({ id: 'R1', workflow_id: 'dev-squad', project: '/tmp/repo' });
  dal.createTask({ id: 'T1', run_id: 'R1', wave: 1, effort: 'small', model_tier: 'haiku' });
  dal.db.prepare(`UPDATE as_tasks SET status = 'PENDING_EXECUTION' WHERE id = ?`).run('T1');
  const result = dal.claimTask('T1', 'agent-A');
  assert.strictEqual(result.claimed, true);
  assert.ok(result.agent_run_id);
  const second = dal.claimTask('T1', 'agent-B');
  assert.strictEqual(second.claimed, false, 'second claim must fail');
});

it('emitEvent + searchEvents (FTS5)', () => {
  const dal = setup();
  dal.createRun({ id: 'R1', workflow_id: 'dev-squad', project: '/tmp/repo' });
  dal.createTask({ id: 'T1', run_id: 'R1', wave: 1 });
  dal.db.prepare(`UPDATE as_tasks SET status = 'PENDING_EXECUTION' WHERE id = ?`).run('T1');
  const { agent_run_id } = dal.claimTask('T1', 'agent-A');
  dal.emitEvent({ agent_run_id, kind: 'tool_call', payload: { tool: 'auth_provider' } });
  const hits = dal.searchEvents('auth_provider');
  assert.ok(hits.length > 0, 'FTS5 must find emitted payload');
});

it('listOrphans returns running agent_runs without recent heartbeat', () => {
  const dal = setup();
  dal.createRun({ id: 'R1', workflow_id: 'dev-squad', project: '/tmp/repo' });
  dal.createTask({ id: 'T1', run_id: 'R1', wave: 1 });
  dal.db.prepare(`UPDATE as_tasks SET status = 'PENDING_EXECUTION' WHERE id = ?`).run('T1');
  const { agent_run_id } = dal.claimTask('T1', 'agent-A');
  dal.db.prepare(
    `UPDATE as_agent_runs SET last_heartbeat_at = datetime('now', '-30 minutes') WHERE id = ?`
  ).run(agent_run_id);
  const orphans = dal.listOrphans(10);
  assert.strictEqual(orphans.length, 1);
});

it('createSession + claimWorktree atomic across sessions', () => {
  const dal = setup();
  dal.createSession({ id: 'sess-A', host: 'host1' });
  dal.createSession({ id: 'sess-B', host: 'host1' });
  dal.createRun({ id: 'R1', workflow_id: 'dev-squad', project: '/tmp/repo' });
  dal.createTask({ id: 'T1', run_id: 'R1', wave: 1 });
  dal.createTask({ id: 'T2', run_id: 'R1', wave: 1 });

  const claim1 = dal.claimWorktree({
    task_id: 'T1',
    branch_name: 'task/contested',
    base_branch: 'feature/x',
    session_id: 'sess-A',
  });
  assert.strictEqual(claim1.claimed, true);

  let raised = false;
  try {
    dal.claimWorktree({
      task_id: 'T2',
      branch_name: 'task/contested',
      base_branch: 'feature/x',
      session_id: 'sess-B',
    });
  } catch {
    raised = true;
  }
  assert.strictEqual(raised, true, 'second session must fail UNIQUE on active branch');

  dal.releaseWorktree('T1', 'sess-A');
  const claim2 = dal.claimWorktree({
    task_id: 'T2',
    branch_name: 'task/contested',
    base_branch: 'feature/x',
    session_id: 'sess-B',
  });
  assert.strictEqual(claim2.claimed, true, 'after release, claim succeeds');
});

it('listSessionRuns returns runs attached to a session', () => {
  const dal = setup();
  dal.createSession({ id: 'sess-X' });
  dal.createRun({ id: 'R1', workflow_id: 'dev-squad', project: '/tmp/repo' });
  dal.createRun({ id: 'R2', workflow_id: 'dev-squad', project: '/tmp/repo' });
  dal.attachRunToSession({ run_id: 'R1', session_id: 'sess-X' });
  const runs = dal.listSessionRuns('sess-X');
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].id, 'R1');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
