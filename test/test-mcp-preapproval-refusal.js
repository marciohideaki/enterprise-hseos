'use strict';

/**
 * W10/K11: a write whose scope or input can never succeed is refused before a person is asked, with the stable domain code and
 * no ledger fact of an uncertain outcome. A valid write still asks (accept executes, decline writes nothing). The check also
 * stays inside the execution (defence in depth): each layer is exercised on its own.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const Database = require('better-sqlite3');

const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  HSEOS_IDEMPOTENCY_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} = require('../tools/lib/mcp-2026-adapter');
const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');
const { activateExecutionLedger, openOperationalStateDatabase } = require('../tools/mcp-project-state/lib/operational-state-db');

const ROOT = path.join(__dirname, '..');
const NOW = () => Date.parse('2026-10-22T12:00:00.000Z');
const SCRIPTS = { swarm: 'mcp-hseos-swarm', project_state: 'mcp-project-state' };

async function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-k11-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisions = path.join(root, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(path.join(decisions, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nAccepted — 2026-10-22\n');
  const databasePath = path.join(root, 'state', 'project.db');
  openOperationalStateDatabase(databasePath).close();
  await activateExecutionLedger(databasePath, {
    adr: 'ADR-0048',
    backupDir: path.join(root, 'backups'),
    now: NOW,
    internal: { decisionsDirectory: decisions },
  });
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(root, '.hseos', 'runs', 'dev-squad'), { recursive: true });
  return { root, databasePath, outside, runs: path.join(root, '.hseos', 'runs', 'dev-squad') };
}

function startServer(box, key) {
  const env = { ...process.env, HSEOS_STATE_DB: box.databasePath };
  delete env.NODE_ENV;
  delete env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', SCRIPTS[key], 'index.js')], {
    cwd: box.root,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let buffer = '';
  const waiting = new Map();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const resolve = waiting.get(message.id);
      if (resolve) {
        waiting.delete(message.id);
        resolve(message);
      }
    }
  });
  const exited = new Promise((resolve) => child.on('close', resolve));
  let nextId = 1;
  const request = (method, params) => {
    const id = nextId++;
    const reply = new Promise((resolve, reject) => {
      waiting.set(id, resolve);
      setTimeout(() => reject(new Error(`timeout waiting for ${method}; stderr=${stderr}`)), 20_000).unref();
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return reply;
  };
  let keySeq = 0;
  const client = {
    stderr: () => stderr,
    /** One tools/call. `answer` completes the approval round (MRTR) when the server asks. */
    async call(name, args, { answer = null, elicitation = true } = {}) {
      const key = `k11-${(keySeq += 1)}`;
      const send = (extra) =>
        request('tools/call', {
          name,
          arguments: args,
          ...extra,
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
            [CLIENT_INFO_META_KEY]: { name: 'k11-test', version: '1.0.0' },
            [CLIENT_CAPABILITIES_META_KEY]: elicitation ? { elicitation: {} } : {},
            [HSEOS_IDEMPOTENCY_META_KEY]: key,
          },
        });
      const first = await send({});
      const prompts = [];
      if (first.result?.resultType === 'input_required' && answer) {
        prompts.push(first.result);
        const second = await send({ requestState: first.result.requestState, inputResponses: { confirm: answer } });
        return { response: second, prompts };
      }
      if (first.result?.resultType === 'input_required') prompts.push(first.result);
      return { response: first, prompts };
    },
    async close() {
      child.stdin.end();
      child.kill('SIGTERM');
      await exited;
    },
  };
  return client;
}

async function withServer(t, box, key) {
  await Promise.resolve();
  const client = startServer(box, key);
  t.after(() => client.close());
  await client.call(key === 'swarm' ? 'list_runs' : 'state_history', {});
  return client;
}

const ACCEPT = { action: 'accept', content: { approved: true } };
const DECLINE = { action: 'decline' };

function eventCounts(box) {
  const db = new Database(box.databasePath, { readonly: true });
  try {
    const rows = db.prepare('SELECT event_type, COUNT(*) AS n FROM execution_events GROUP BY event_type').all();
    return Object.fromEntries(rows.map((row) => [row.event_type, row.n]));
  } finally {
    db.close();
  }
}

const domainOutcome = (response) => response.result?.structuredContent;
const UNCERTAIN = 'ExecutionOutcomeUncertain';

function assertRefusedBeforeApproval({ response, prompts }, code, label) {
  assert.deepEqual(prompts, [], `${label}: no approval was requested`);
  const outcome = domainOutcome(response);
  assert.ok(outcome, `${label}: a domain outcome, not an RPC error: ${JSON.stringify(response)}`);
  assert.equal(outcome.ok, false, label);
  assert.equal(outcome.error.code, code, `${label}: ${JSON.stringify(outcome.error)}`);
}

const SCOPE_CASES = {
  'relative traversal': () => '../x',
  'deep traversal': () => '../../../etc/x',
  'absolute path': () => '/etc/hseos-k11',
  'nul byte': () => 'a\u0000b',
  'percent-encoded traversal': () => '%2e%2e%2fx',
  'symlink out of scope': (box) => {
    fs.symlinkSync(box.outside, path.join(box.runs, 'escape'));
    return 'escape';
  },
};

test('swarm: an out-of-scope plan_squad is refused before any approval prompt, with no uncertain outcome', async (t) => {
  const box = await sandbox(t);
  const client = await withServer(t, box, 'swarm');
  for (const [label, makeRunId] of Object.entries(SCOPE_CASES)) {
    const runId = makeRunId(box);
    const before = eventCounts(box);
    const result = await client.call('plan_squad', { batch_description: 'k11', run_id: runId }, { answer: ACCEPT });
    assertRefusedBeforeApproval(result, 'MCP_SCOPE_DENIED', `plan_squad ${label}`);
    const after = eventCounts(box);
    assert.equal(after[UNCERTAIN] ?? 0, before[UNCERTAIN] ?? 0, `plan_squad ${label}: no ExecutionOutcomeUncertain`);
    assert.equal(after.ExecutionAuthorized ?? 0, before.ExecutionAuthorized ?? 0, `plan_squad ${label}: nothing authorized`);
  }
  assert.deepEqual(fs.readdirSync(box.outside), [], 'nothing was written outside the scope');
});

test('swarm: an out-of-scope consolidate_handoff is refused before any approval prompt, with no uncertain outcome', async (t) => {
  const box = await sandbox(t);
  const client = await withServer(t, box, 'swarm');
  for (const [label, makeRunId] of Object.entries(SCOPE_CASES)) {
    const runId = makeRunId(box);
    const before = eventCounts(box);
    const result = await client.call(
      'consolidate_handoff',
      { run_id: runId, source_task: 'task-a', target_task: 'task-b' },
      { answer: ACCEPT },
    );
    assertRefusedBeforeApproval(result, 'MCP_SCOPE_DENIED', `consolidate_handoff ${label}`);
    const after = eventCounts(box);
    assert.equal(after[UNCERTAIN] ?? 0, before[UNCERTAIN] ?? 0, `consolidate_handoff ${label}: no ExecutionOutcomeUncertain`);
  }
  for (const [field, value] of [
    ['source_task', '../x'],
    ['target_task', '/abs'],
  ]) {
    const args = { run_id: 'valid-run', source_task: 'task-a', target_task: 'task-b', [field]: value };
    const result = await client.call('consolidate_handoff', args, { answer: ACCEPT });
    assertRefusedBeforeApproval(result, 'MCP_SCOPE_DENIED', `consolidate_handoff ${field}`);
  }
  assert.equal(eventCounts(box)[UNCERTAIN] ?? 0, 0);
  assert.deepEqual(fs.readdirSync(box.outside), []);
});

test('swarm: a valid plan_squad still asks; accept writes, decline writes nothing and leaves no uncertain outcome', async (t) => {
  const box = await sandbox(t);
  const client = await withServer(t, box, 'swarm');

  const accepted = await client.call('plan_squad', { batch_description: 'k11', run_id: 'k11-ok' }, { answer: ACCEPT });
  assert.equal(accepted.prompts.length, 1, 'a valid write asks for approval');
  assert.equal(domainOutcome(accepted.response).ok, true, JSON.stringify(accepted.response));
  assert.ok(fs.existsSync(path.join(box.runs, 'k11-ok', 'PLAN.md')), 'accept executed the write');

  const declined = await client.call('plan_squad', { batch_description: 'k11', run_id: 'k11-no' }, { answer: DECLINE });
  assert.equal(declined.prompts.length, 1, 'a valid write asks before a decline');
  assert.ok(declined.response.error || domainOutcome(declined.response)?.ok === false, 'a decline is a refusal');
  assert.equal(fs.existsSync(path.join(box.runs, 'k11-no')), false, 'decline wrote nothing');
  assert.equal(eventCounts(box)[UNCERTAIN] ?? 0, 0, 'no uncertain outcome for accept or decline');
});

test('swarm: a valid consolidate_handoff still asks and accept executes', async (t) => {
  const box = await sandbox(t);
  fs.mkdirSync(path.join(box.runs, 'k11-run'));
  fs.writeFileSync(path.join(box.runs, 'k11-run', 'HANDOFF-task-a.md'), '# handoff\nline\n');
  const client = await withServer(t, box, 'swarm');
  const result = await client.call(
    'consolidate_handoff',
    { run_id: 'k11-run', source_task: 'task-a', target_task: 'task-b' },
    { answer: ACCEPT },
  );
  assert.equal(result.prompts.length, 1);
  assert.equal(domainOutcome(result.response).ok, true, JSON.stringify(result.response));
  assert.ok(fs.existsSync(path.join(box.runs, 'k11-run', 'handoff-task-a-to-task-b.md')));
});

test('swarm: the in-execution scope check holds on its own (defence in depth)', () => {
  const { resolveRunDir, assertIdentifier } = require('../tools/mcp-hseos-swarm/lib/run-scope');
  const planSquad = require('../tools/mcp-hseos-swarm/tools/plan_squad')[0];
  const consolidate = require('../tools/mcp-hseos-swarm/tools/consolidate_handoff')[0];
  const denied = (error) => error.code === 'MCP_SCOPE_DENIED';
  assert.throws(() => planSquad.handler(null, { batch_description: 'x', run_id: '../x' }), denied);
  assert.throws(() => consolidate.handler(null, { run_id: '../x', source_task: 'a', target_task: 'b' }), denied);
  assert.throws(() => resolveRunDir('/abs'), denied);
  assert.throws(() => assertIdentifier('a\u0000b', 'source_task'), denied);
});

test('swarm: the early check is the same scope function and runs without side effects', () => {
  const planSquad = require('../tools/mcp-hseos-swarm/tools/plan_squad')[0];
  const consolidate = require('../tools/mcp-hseos-swarm/tools/consolidate_handoff')[0];
  assert.equal(typeof planSquad.preflight, 'function');
  assert.equal(typeof consolidate.preflight, 'function');
  assert.throws(() => planSquad.preflight({ batch_description: 'x', run_id: '../x' }), { code: 'MCP_SCOPE_DENIED' });
  assert.throws(() => consolidate.preflight({ run_id: 'ok', source_task: '../x', target_task: 'b' }), { code: 'MCP_SCOPE_DENIED' });
  assert.doesNotThrow(() => planSquad.preflight({ batch_description: 'x', run_id: 'fine-run' }));
  assert.doesNotThrow(() => planSquad.preflight({ batch_description: 'x' }));
  assert.doesNotThrow(() => consolidate.preflight({ run_id: 'fine-run', source_task: 'a', target_task: 'b' }));
  assert.equal(fs.existsSync(path.join(process.cwd(), '.hseos', 'runs', 'dev-squad', 'fine-run')), false, 'preflight creates nothing');
});

test('project_state: tasks_update on a missing task is refused before approval; an existing task still asks', async (t) => {
  const box = await sandbox(t);
  const client = await withServer(t, box, 'project_state');
  await client.call('tasks_add', { id: 'k11-task', owner: 'o', description: 'd' }, { answer: ACCEPT });

  const before = eventCounts(box);
  const missing = await client.call('tasks_update', { id: 'no-such-task', status: 'done' }, { answer: ACCEPT });
  assertRefusedBeforeApproval(missing, 'TASK_NOT_FOUND', 'tasks_update missing');
  assert.equal(eventCounts(box)[UNCERTAIN] ?? 0, before[UNCERTAIN] ?? 0, 'no uncertain outcome for a missing task');

  const declined = await client.call('tasks_update', { id: 'k11-task', status: 'done' }, { answer: DECLINE });
  assert.equal(declined.prompts.length, 1, 'an existing task still asks');
  const accepted = await client.call('tasks_update', { id: 'k11-task', status: 'done' }, { answer: ACCEPT });
  assert.equal(accepted.prompts.length, 1);
  assert.equal(domainOutcome(accepted.response).ok, true, JSON.stringify(accepted.response));
  assert.equal(eventCounts(box)[UNCERTAIN] ?? 0, 0);
});

test('a client without the elicitation capability keeps the capability error and leaves no uncertain outcome', async (t) => {
  const box = await sandbox(t);
  const client = await withServer(t, box, 'swarm');
  const { response } = await client.call('plan_squad', { batch_description: 'x', run_id: '../x' }, { elicitation: false });
  assert.equal(response.error?.code, -32_021);
  assert.equal(eventCounts(box)[UNCERTAIN] ?? 0, 0);
});
