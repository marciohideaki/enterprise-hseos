'use strict';

/**
 * F14-R1 journey: a memory written through the MCP `memory.write` tool of an activated project.db is retrieved by a real
 * engineering task, enters the assembled context as quoted data, and the session ledger records which memories entered
 * and why: `source_ref` (which carries the project and the memory_id), `origin`, `trust`, `authority` and the content
 * digest. Negatives: a memory of another project never enters; an untrusted memory never enters without the host opt-in.
 * Promotion by the operator (owner decision b) is covered further down. Only the model is scripted; the MCP server (a child process), the ledger, the store, the assembler and the runtime are real.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const Database = require('better-sqlite3');
const yaml = require('yaml');

const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  HSEOS_IDEMPOTENCY_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} = require('../tools/lib/mcp-2026-adapter');
const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');
const { activateExecutionLedger, openOperationalStateDatabase } = require('../tools/mcp-project-state/lib/operational-state-db');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { createGovernedMemory, openOperatorMemory } = require('../tools/cli/lib/memory-context-source');
const { sha256Text } = require('../packages/agent-memory');
const { project, execute, ledgerRows, ALLOW, OPERATOR } = require('./helpers/environment-fixtures');

const ROOT = path.join(__dirname, '..');
const NOW = () => Date.parse('2026-10-22T12:00:00.000Z');
// The base task requirement is "Return the sum of two integers."; the notes share its words.
const NOTE = 'Remember: adding integers in this project never overflows, the sum is exact.';
const FOREIGN = 'Remember: the sum of two integers in the beta project wraps at 255.';

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-f14-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisions = path.join(root, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(path.join(decisions, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nAccepted — 2026-10-22\n');
  return { root, decisions, backups: path.join(root, 'backups'), databasePath: path.join(root, 'state', 'project.db') };
}

async function activated(box) {
  openOperationalStateDatabase(box.databasePath).close();
  await activateExecutionLedger(box.databasePath, {
    adr: 'ADR-0048',
    backupDir: box.backups,
    now: NOW,
    internal: { decisionsDirectory: box.decisions },
  });
}

function configFor(box, projectId) {
  const file = path.join(box.root, `config-${projectId}.yaml`);
  const memory = { rules: [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }] };
  fs.writeFileSync(
    file,
    yaml.stringify({ environment: { project_id: projectId, memory: { ...memory, operator: { id: 'owner', kind: 'operator' } } } }),
  );
  return file;
}

/** One project-state MCP server child over the box database; returns a modern JSON-RPC caller and a closer. */
const idempotencyKeyOf = (args) => `${args.scope?.project_id}-${args.memory_id}`;

function startServer(box, config) {
  const env = { ...process.env, HSEOS_STATE_DB: box.databasePath };
  delete env.NODE_ENV;
  delete env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'tools', 'mcp-project-state', 'index.js'), `--db=${box.databasePath}`, `--config=${config}`],
    {
      cwd: box.root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let buffer = '';
  let stderr = '';
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
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  const exited = new Promise((resolve) => child.on('close', resolve));
  let nextId = 1;
  return {
    rpc(method, params) {
      const id = nextId++;
      const reply = new Promise((resolve, reject) => {
        waiting.set(id, resolve);
        setTimeout(() => reject(new Error(`timeout on ${method}; stderr=${stderr}`)), 20_000).unref();
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return reply;
    },
    call(name, args) {
      const id = nextId++;
      const reply = new Promise((resolve, reject) => {
        waiting.set(id, resolve);
        setTimeout(() => reject(new Error(`timeout on ${name}; stderr=${stderr}`)), 20_000).unref();
      });
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: {
            name,
            arguments: args,
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
              [CLIENT_INFO_META_KEY]: { name: 'f14-journey', version: '1.0.0' },
              [CLIENT_CAPABILITIES_META_KEY]: {},
              [HSEOS_IDEMPOTENCY_META_KEY]: `f14-${name}-${idempotencyKeyOf(args)}`,
            },
          },
        })}\n`,
      );
      return reply;
    },
    async close() {
      child.stdin.end();
      child.kill('SIGTERM');
      await exited;
    },
  };
}

async function mcpWrite(box, projectId, memoryId, content) {
  const server = startServer(box, configFor(box, projectId));
  try {
    const response = await server.call('memory.write', {
      scope: { project_id: projectId },
      memory_id: memoryId,
      content,
      source_digest: sha256Text(content),
      classification: 'internal',
      source_ref: 'doc://runbook/sums',
      ttl_seconds: 3600,
    });
    assert.equal(response.result.structuredContent.ok, true, JSON.stringify(response));
  } finally {
    await server.close();
  }
}

/** The task host: a governed store over the SAME ledger the MCP server wrote to. */
function hostOver(box, t, extra = {}) {
  const db = new Database(box.databasePath);
  t.after(() => db.close());
  const store = createGovernedMemory({ ledger: new ExecutionEventLedger(db), now: NOW, db });
  return { project_id: 'proj-1', memory: { store, rules: ALLOW, operator: OPERATOR, ...extra } };
}

/** The `memory` entries of the `context.assembled` event of the task: what entered the context and with which record. */
function assembledMemories(result) {
  const event = ledgerRows(result, "SELECT payload_json FROM execution_events WHERE aggregate_type = 'agent_session' ORDER BY position")
    .map((row) => JSON.parse(JSON.parse(row.payload_json).session_event_json))
    .find((entry) => entry.event_type === 'context.assembled');
  const blocks = event.payload.request.messages
    .map((message) => message.content)
    .filter((content) => content.startsWith('[HSEOS MEMORY_DATA'));
  const sources = event.payload.sources.filter((source) => source.origin === 'memory');
  return { blocks, sources, refs: event.payload.source_refs };
}

const memoryIdOf = (sourceRef) => /^memory:\/\/([^/]+)\/(.+)$/.exec(sourceRef).slice(1);

async function seeded(t) {
  const box = sandbox(t);
  await activated(box);
  await mcpWrite(box, 'proj-1', 'note-1', NOTE);
  await mcpWrite(box, 'beta', 'foreign-1', FOREIGN);
  return box;
}

test('a memory written over MCP enters the task context, and the ledger records its provenance, authority and digest', async (t) => {
  const box = await seeded(t);
  const result = await execute(t, project(t, ['memory.retrieve']), [], hostOver(box, t, { include_untrusted: true }));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));

  const { blocks, sources } = assembledMemories(result);
  assert.equal(blocks.length, 1, blocks.join('\n'));
  assert.ok(blocks[0].includes(NOTE));
  assert.match(blocks[0], /authority=data/);
  assert.equal(sources.length, 1, JSON.stringify(sources));
  const [record] = sources;
  assert.deepEqual(memoryIdOf(record.source_ref), ['proj-1', 'note-1']);
  assert.equal(record.origin, 'memory');
  assert.equal(record.authority, 'data', 'a memory is data, never an instruction');
  assert.equal(record.trust, 'untrusted', 'the MCP write is an agent note: untrusted at the context boundary');
  assert.equal(record.digest, sha256Text(NOTE), 'the digest is the one of the content that entered');
});

test('a memory of another project never enters the context, even with the untrusted opt-in', async (t) => {
  const box = await seeded(t);
  const result = await execute(t, project(t, ['memory.retrieve']), [], hostOver(box, t, { include_untrusted: true }));
  const { blocks, sources, refs } = assembledMemories(result);
  assert.deepEqual(
    sources.map((source) => source.source_ref),
    ['memory://proj-1/note-1'],
  );
  assert.ok(!blocks.join('\n').includes('wraps at 255'));
  assert.ok(!refs.some((ref) => ref.includes('beta')), refs.join(','));
});

test('an untrusted memory does not enter the context without the host opt-in', async (t) => {
  const box = await seeded(t);
  const result = await execute(t, project(t, ['memory.retrieve']), [], hostOver(box, t));
  assert.equal(result.task_result, 'approved', JSON.stringify(result));
  const { blocks, sources } = assembledMemories(result);
  assert.deepEqual([blocks, sources], [[], []], 'no opt-in, no untrusted memory');
});

// --- F14 owner decision (b): the operator promotes one memory; the model, the task contract and MCP cannot ---

const memoryEvents = (box) => {
  const db = new Database(box.databasePath, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT event_type, operation_id, payload_json FROM execution_events WHERE aggregate_type = 'agent_memory' ORDER BY position",
      )
      .all()
      .map((row) => ({ type: row.event_type, operation_id: row.operation_id, payload: JSON.parse(row.payload_json) }));
  } finally {
    db.close();
  }
};

function operatorOver(box, id = 'owner') {
  return openOperatorMemory({ databasePath: box.databasePath, operator: { kind: 'operator', id }, now: NOW });
}

const NOTE_DIGEST = sha256Text(NOTE);

test('journey: the MCP note stays out, the operator promotes it with a single-use approval, the task then receives it as trusted data', async (t) => {
  const box = await seeded(t);
  const before = await execute(t, project(t, ['memory.retrieve']), [], hostOver(box, t));
  assert.deepEqual(assembledMemories(before).sources, [], 'the agent note is not in the context before the promotion');

  const operator = operatorOver(box);
  t.after(() => operator.close());
  const shown = operator.inspect('proj-1', 'note-1');
  assert.equal(shown.content_sha256, NOTE_DIGEST);
  assert.equal(shown.origin, 'agent');
  const receipt = operator.promote({ project_id: 'proj-1', memory_id: 'note-1', content_sha256: shown.content_sha256, reason: 'reviewed' });
  assert.equal(receipt.memory_id, 'note-1:promoted');

  const after = await execute(t, project(t, ['memory.retrieve']), [], hostOver(box, t));
  assert.equal(after.task_result, 'approved', JSON.stringify(after));
  const { blocks, sources } = assembledMemories(after);
  assert.equal(blocks.length, 1, blocks.join('\n'));
  assert.match(blocks[0], /authority=data/);
  assert.ok(blocks[0].includes(NOTE));
  assert.equal(sources.length, 1, JSON.stringify(sources));
  const [record] = sources;
  assert.deepEqual(memoryIdOf(record.source_ref), ['proj-1', 'note-1:promoted']);
  assert.equal(record.trust, 'trusted');
  assert.equal(record.authority, 'data', 'a promoted memory is data, never an instruction');
  assert.equal(record.digest, NOTE_DIGEST);

  // The ledger: the agent write, then the operator write that supersedes it with the promotion facts and the approval operation.
  const events = memoryEvents(box).filter((event) => event.payload.memory_id !== 'foreign-1');
  assert.deepEqual(
    events.map((event) => `${event.type}:${event.payload.memory_id}`),
    ['memory.written:note-1', 'memory.written:note-1:promoted', 'memory.superseded:note-1'],
  );
  assert.equal(events[0].payload.entry.origin, 'agent');
  assert.equal(events[1].payload.entry.origin, 'operator');
  assert.equal(events[1].payload.entry.source_ref, `memory://proj-1/note-1@${NOTE_DIGEST}`);
  assert.deepEqual(
    [events[1].payload.promotion.promoted_by, events[1].payload.promotion.content_sha256, events[1].operation_id],
    ['owner', NOTE_DIGEST, `memory.promote:proj-1:note-1:${NOTE_DIGEST}`],
  );
});

test('journey negatives: other project, replayed approval, wrong operator, other digest and a promotion by the model or over MCP', async (t) => {
  const box = await seeded(t);
  const operator = operatorOver(box);
  t.after(() => operator.close());
  const foreignDigest = sha256Text(FOREIGN);
  assert.throws(
    () => operator.promote({ project_id: 'proj-1', memory_id: 'foreign-1', content_sha256: foreignDigest, reason: 'x' }),
    (error) => error.code === 'AGENT_MEMORY_NOT_FOUND',
    'a memory of another project',
  );
  assert.throws(
    () => operator.promote({ project_id: 'proj-1', memory_id: 'note-1', content_sha256: sha256Text('edited'), reason: 'x' }),
    (error) => error.code === 'AGENT_MEMORY_DIGEST_MISMATCH',
  );
  assert.throws(
    () => openOperatorMemory({ databasePath: box.databasePath, operator: { kind: 'agent', id: 'planner' }, now: NOW }),
    /operator identity/,
  );
  assert.deepEqual(
    memoryEvents(box).map((event) => event.type),
    ['memory.written', 'memory.written'],
    'refusals appended nothing',
  );

  // MCP: the promotion is not a tool, listed or callable.
  const server = startServer(box, configFor(box, 'proj-1'));
  try {
    const listed = await server.rpc('tools/list', {
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
        [CLIENT_INFO_META_KEY]: { name: 'f14-journey', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    });
    const names = listed.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('memory.write'), names.join(','));
    assert.deepEqual(
      names.filter((name) => /promot/.test(name)),
      [],
    );
    const called = await server.call('memory.promote', {
      project_id: 'proj-1',
      memory_id: 'note-1',
      content_sha256: NOTE_DIGEST,
      reason: 'x',
    });
    assert.ok(called.error || called.result?.isError === true || called.result?.structuredContent?.ok === false, JSON.stringify(called));
  } finally {
    await server.close();
  }

  // The model: a scripted call to memory.promote is refused and the memory does not enter the context.
  const refused = await execute(
    t,
    project(t, ['memory.retrieve', 'memory.write']),
    [{ name: 'memory.promote', input: { project_id: 'proj-1', memory_id: 'note-1', content_sha256: NOTE_DIGEST, reason: 'x' } }],
    hostOver(box, t),
  );
  const { sources } = assembledMemories(refused);
  assert.deepEqual(sources, []);
  assert.deepEqual(
    memoryEvents(box).map((event) => event.type),
    ['memory.written', 'memory.written'],
    'neither MCP nor the model promoted anything',
  );
});

test('journey: a promotion approval is single-use end to end and a second promotion of the same note is refused', async (t) => {
  const box = await seeded(t);
  const operator = operatorOver(box);
  t.after(() => operator.close());
  const input = { project_id: 'proj-1', memory_id: 'note-1', content_sha256: NOTE_DIGEST, reason: 'reviewed' };
  operator.promote(input);
  assert.throws(
    () => operator.promote(input),
    (error) => error.code === 'AGENT_MEMORY_NOT_FOUND',
    'the note is superseded: nothing left to promote',
  );
  const db = new Database(box.databasePath, { readonly: true });
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM execution_approval_uses').get().n, 1);
});

test('hseos memory promote: the operator command confirms on the terminal or with a declared digest, and refuses everything else', async (t) => {
  const { _internal } = require('../tools/cli/commands/agent-activation-rehearsal');
  const box = await seeded(t);
  const base = { db: box.databasePath, project: 'proj-1', memory: 'note-1', reason: 'reviewed', operator: 'owner' };
  const quiet = (fn) => {
    const log = console.log;
    const lines = [];
    console.log = (line) => lines.push(line);
    return Promise.resolve(fn(lines)).finally(() => {
      console.log = log;
    });
  };
  const run = (options, confirm) =>
    quiet((lines) => _internal.memoryAction('promote', options, confirm, true).then((report) => ({ report, lines })));

  await assert.rejects(_internal.memoryAction('forget', base), /action must be one of: promote/);
  for (const field of ['db', 'project', 'memory', 'reason', 'operator']) {
    await assert.rejects(_internal.memoryAction('promote', { ...base, [field]: undefined }), new RegExp(`--${field} is required`));
  }
  await assert.rejects(_internal.memoryAction('promote', { ...base, yes: true }), /--yes needs --content-sha256/);
  await assert.rejects(
    _internal.memoryAction('promote', { ...base, yes: true, contentSha256: NOTE_DIGEST }, async () => true, false),
    /interactive terminal/,
    'no TTY: even --yes is refused',
  );
  await assert.rejects(
    _internal.memoryAction('promote', base, async () => true, false),
    /interactive terminal/,
  );
  await assert.rejects(
    _internal.memoryAction(
      'promote',
      { ...base, db: path.join(box.root, 'absent.db'), yes: true, contentSha256: NOTE_DIGEST },
      async () => true,
      true,
    ),
    /no state database/,
  );
  await assert.rejects(
    run({ ...base, yes: true, contentSha256: 'c'.repeat(64) }),
    (error) => error.code === 'AGENT_MEMORY_DIGEST_MISMATCH',
  );
  await assert.rejects(
    run(base, async () => false),
    /promotion declined/,
  );
  assert.equal(memoryEvents(box).length, 2, 'nothing was promoted by the refusals');

  const prompted = [];
  const { report, lines } = await run({ ...base, json: true }, async (question) => {
    prompted.push(question);
    return true;
  });
  assert.match(prompted[0], /Promote note-1 to trusted as owner/);
  assert.equal(report.memory_id, 'note-1:promoted');
  assert.equal(JSON.parse(lines.at(-1)).content_sha256, NOTE_DIGEST);
  const events = memoryEvents(box);
  assert.equal(events.at(-2).payload.promotion.promoted_by, 'owner');
});

test('hseos memory promote through the real CLI entrypoint refuses without a terminal, even with --yes and a digest', async (t) => {
  const box = await seeded(t);
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.NODE_ENV;
  const args = [
    'memory',
    'promote',
    '--db',
    box.databasePath,
    '--project',
    'proj-1',
    '--memory',
    'note-1',
    '--reason',
    'reviewed',
    '--operator',
    'owner',
  ];
  const cli = path.join(ROOT, 'tools', 'cli', 'hseos-cli.js');
  const refused = spawnSync(process.execPath, [cli, ...args, '--yes', '--content-sha256', NOTE_DIGEST], {
    env,
    encoding: 'utf8',
    input: '',
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /interactive terminal/);
  assert.equal(memoryEvents(box).length, 2, 'nothing was promoted');
});

test('the :promoted suffix is reserved: neither the MCP write nor any agent path can occupy a promotion id', async (t) => {
  const box = await seeded(t);
  const server = startServer(box, configFor(box, 'proj-1'));
  try {
    const response = await server.call('memory.write', {
      scope: { project_id: 'proj-1' },
      memory_id: 'note-1:promoted',
      content: NOTE,
      source_digest: NOTE_DIGEST,
      classification: 'internal',
      source_ref: 'doc://runbook/sums',
      ttl_seconds: 3600,
    });
    assert.notEqual(response.result?.structuredContent?.ok, true, JSON.stringify(response));
    assert.match(JSON.stringify(response), /AGENT_MEMORY_ID_RESERVED/);
  } finally {
    await server.close();
  }
  assert.equal(memoryEvents(box).length, 2);
  const operator = operatorOver(box);
  t.after(() => operator.close());
  assert.equal(
    operator.promote({ project_id: 'proj-1', memory_id: 'note-1', content_sha256: NOTE_DIGEST, reason: 'ok' }).memory_id,
    'note-1:promoted',
  );
});
