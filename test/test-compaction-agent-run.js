'use strict';

// F15-R1 through the CLI: compaction wired into `agent run` (explicit, off by default), crash, resume and fork, compared with
// the uncompacted history of the same task. The model is the keyless scripted provider; nothing here reaches a network.

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { RelationalSessionEventStore, canonicalJson } = require('../packages/agent-session-store');
const { createEngineeringExample } = require('../tools/examples/engineering-task');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'cli', 'hseos-cli.js');
const PROFILE = 'disposable-engineering-candidate';
const sha = (value) => createHash('sha256').update(value).digest('hex');
// A context window that fits the first request but not the first request plus the tool result of the padded file.
const CONTEXT_TOKENS = Number(process.env.HSEOS_TEST_CONTEXT_TOKENS || 20_000);

// A low threshold makes the tool-result pressure fire on the first read, while the window still holds the resumed turn.
const COMPACTION = {
  schema_version: 1,
  provider_id: 'compaction:deterministic',
  threshold_basis_points: 3000,
  context_tokens: CONTEXT_TOKENS,
};

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compaction-run-'));
  const example = structuredClone(createEngineeringExample('addition'));
  const initial = `module.exports = (a, b) => a - b;\n/* ${'padding '.repeat(400)} */\n`;
  example.contract.initial_files = [{ path: 'add.js', content: initial, sha256: sha(initial) }];
  example.contract.scope = { read: ['add.js'], write: ['add.js'] };
  example.contract.limits = { ...example.contract.limits, max_tokens: 900_000, max_duration_ms: 120_000, max_tool_calls: 8 };
  const write = example.responses.find((response) => response.name === 'engineering.write');
  write.input.expected_sha256 = sha(initial);
  example.responses = [{ name: 'engineering.read', input: { path: 'add.js' } }, ...example.responses];
  fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(example.contract));
  fs.writeFileSync(path.join(directory, 'responses.json'), JSON.stringify(example.responses));
  fs.writeFileSync(path.join(directory, 'compaction.json'), JSON.stringify(COMPACTION));
  // Kills the worker when the model is asked for the step after the compaction: the compaction event is durable, the write is not.
  fs.writeFileSync(
    path.join(directory, 'crash-after-compaction.cjs'),
    `const { ScriptedModelProvider } = require(${JSON.stringify(path.join(ROOT, 'packages', 'model-providers'))});
const original = ScriptedModelProvider.prototype.stream;
let streams = 0;
ScriptedModelProvider.prototype.stream = function (input) {
  streams += 1;
  if (streams === 2) process.kill(process.pid, 'SIGKILL');
  return original.call(this, input);
};
`,
  );
  return directory;
}

function cli(args, { preload, expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), CLI, 'agent', ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: os.tmpdir(), TMPDIR: os.tmpdir() },
    timeout: 120_000,
  });
  if (expectStatus === 'killed') {
    assert.equal(result.signal, 'SIGKILL', `${result.status}: ${result.stderr}`);
    return null;
  }
  assert.equal(result.status, expectStatus, `agent ${args[0]} exited ${result.status}: ${result.stderr}${result.stdout}`);
  return result.stdout.trim() ? JSON.parse(result.stdout.trim().split('\n').at(-1)) : null;
}

function run(directory, extra = []) {
  return cli([
    'run',
    '--task-contract',
    path.join(directory, 'task.json'),
    '--scripted-responses',
    path.join(directory, 'responses.json'),
    ...extra,
    '--json',
  ]);
}

function events(state, sessionId) {
  const handle = openExecutionLedgerFileFixture(state);
  try {
    return new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }).readSession(sessionId);
  } finally {
    handle.close();
  }
}

function replayed(state, sessionId) {
  const handle = openExecutionLedgerFileFixture(state);
  try {
    return new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }).replay(sessionId);
  } finally {
    handle.close();
  }
}

const criteriaRefs = (list) =>
  [...new Set(list.filter((event) => event.event_type === 'context.assembled').flatMap((event) => event.payload.source_refs))].filter(
    (ref) => ref.endsWith('/protected-criteria'),
  );
// Every file under a state directory (path and bytes), so a change anywhere in the parent is visible.
function stateDigest(directory) {
  const hash = createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(`${path.relative(directory, full)}\0`).update(fs.readFileSync(full));
    }
  };
  walk(directory);
  return hash.digest('hex');
}
const writes = (session) => Object.values(session.tool_invocations).filter((tool) => tool.name === 'engineering.write');

test('without the compaction option an engineering run never compacts', () => {
  const directory = workspace();
  try {
    const result = run(directory);
    assert.equal(result.task_result, 'approved', JSON.stringify(result));
    assert.equal(result.compaction, undefined);
    assert.equal(events(result.state, result.session_id).filter((event) => event.event_type === 'compaction.completed').length, 0);
    fs.rmSync(result.state, { recursive: true, force: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('compaction, crash, resume and fork through the CLI preserve criteria, acceptance and lineage against the full history', () => {
  const directory = workspace();
  const states = [];
  try {
    // The reference: the same task with no compaction, the full history.
    const reference = run(directory);
    states.push(reference.state);
    assert.equal(reference.task_result, 'approved', JSON.stringify(reference));
    const referenceEvents = events(reference.state, reference.session_id);

    // Create the compacted run, then let the worker die the instant the compaction is durable.
    const created = run(directory, ['--compaction', path.join(directory, 'compaction.json'), '--create-only']);
    states.push(created.state);
    assert.deepEqual(created.compaction, COMPACTION);
    cli(['resume', '--profile', PROFILE, '--state', created.state, '--expected-sequence', String(created.current_sequence), '--json'], {
      preload: path.join(directory, 'crash-after-compaction.cjs'),
      expectStatus: 'killed',
    });
    const crashed = events(created.state, created.session_id);
    const compaction = crashed.find((event) => event.event_type === 'compaction.completed');
    assert.ok(compaction, 'the crash must land after the compaction event is durable');
    assert.ok(crashed.at(-1).sequence >= compaction.sequence, 'nothing durable precedes the compaction');
    assert.ok(compaction.payload.source_event_ids.length > 0, 'the compaction records its source lineage');
    assert.deepEqual(writes(replayed(created.state, created.session_id)), [], 'the crash happened before the write effect');

    // Resume reclaims the task from the durable history, without compacting twice.
    const status = cli(['status', '--profile', PROFILE, '--state', created.state, '--json']);
    // The interrupted provider response is never replayed silently: the first resume reports what it observed and asks.
    const blocked = cli(
      ['resume', '--profile', PROFILE, '--state', created.state, '--expected-sequence', String(status.current_sequence), '--json'],
      {
        expectStatus: 1,
      },
    );
    assert.equal(blocked.task_result, 'blocked');
    assert.equal(blocked.reason, 'effect-reconciliation-required');
    const decision = path.join(directory, 'decision.json');
    fs.writeFileSync(
      decision,
      JSON.stringify({
        report_sha256: blocked.reconciliation.sha256,
        decision: 'continue-from-observed-state',
        answer: 'The interrupted attempt is abandoned; continue from the durable, compacted history.',
      }),
    );
    const resumed = cli([
      'resume',
      '--profile',
      PROFILE,
      '--state',
      created.state,
      '--expected-sequence',
      String(blocked.current_sequence),
      '--reconciliation-decision',
      decision,
      '--json',
    ]);
    assert.equal(resumed.task_result, 'approved', JSON.stringify(resumed));
    const afterResume = events(created.state, created.session_id);
    assert.deepEqual(
      afterResume.slice(0, crashed.length).map((event) => event.event_id),
      crashed.map((event) => event.event_id),
      'resume keeps the crashed history as an immutable prefix',
    );
    assert.equal(
      afterResume.filter((event) => event.event_type === 'compaction.completed' && event.event_id === compaction.event_id).length,
      1,
    );

    // Criteria, acceptance and effects match the full history.
    assert.deepEqual(criteriaRefs(afterResume), criteriaRefs(referenceEvents));
    assert.equal(criteriaRefs(afterResume).length, 1);
    assert.equal(
      writes(replayed(created.state, created.session_id)).length,
      writes(replayed(reference.state, reference.session_id)).length,
    );
    const evidence = (state) => cli(['evidence', '--profile', PROFILE, '--state', state]);
    const verified = evidence(created.state);
    const verifiedReference = evidence(reference.state);
    assert.equal(verified.verification.result, 'approved');
    assert.deepEqual(verified.verification.evidence.command_checks, verifiedReference.verification.evidence.command_checks);
    assert.deepEqual(verified.artifacts, verifiedReference.artifacts);

    // A second resume is a replay: the settled task reports the same state and appends nothing.
    const before = events(created.state, created.session_id).length;
    const replay = cli([
      'resume',
      '--profile',
      PROFILE,
      '--state',
      created.state,
      '--expected-sequence',
      String(resumed.current_sequence),
      '--json',
    ]);
    assert.equal(replay.task_result, 'approved');
    assert.equal(replay.current_sequence, resumed.current_sequence);
    assert.equal(events(created.state, created.session_id).length, before);

    // Fork from the compaction itself into a NEW state directory that carries the ancestry up to that checkpoint.
    const parentBefore = events(created.state, created.session_id);
    const parentDigest = stateDigest(created.state);
    const forked = cli(['fork', '--profile', PROFILE, '--state', created.state, '--from-sequence', String(compaction.sequence), '--json']);
    states.push(forked.state);
    assert.notEqual(forked.state, created.state);
    assert.notEqual(forked.task_run_id, created.task_run_id);
    const prefix = parentBefore.slice(0, compaction.sequence);
    assert.deepEqual(forked.fork, {
      schema_version: 1,
      parent_task_run_id: created.task_run_id,
      parent_session_id: created.session_id,
      parent_sequence: compaction.sequence,
      ancestry_event_count: prefix.length,
      ancestry_sha256: createHash('sha256').update(canonicalJson(prefix)).digest('hex'),
    });
    // The copy is verifiable against the parent, and the parent was only read.
    assert.deepEqual(events(forked.state, created.session_id), prefix);
    assert.deepEqual(events(created.state, created.session_id), parentBefore);
    assert.equal(stateDigest(created.state), parentDigest, 'forking leaves the parent state directory byte for byte unchanged');
    assert.equal(prefix.at(-1).event_id, compaction.event_id);
    assert.deepEqual(criteriaRefs(prefix), criteriaRefs(referenceEvents));
    assert.deepEqual(cli(['status', '--profile', PROFILE, '--state', forked.state, '--json']).fork, forked.fork);

    // The fork resumes on its own ledger, independently of the parent, and reaches the same acceptance.
    // The checkpoint holds no pending provider response, so no reconciliation question is needed.
    const forkDone = cli([
      'resume',
      '--profile',
      PROFILE,
      '--state',
      forked.state,
      '--expected-sequence',
      String(forked.current_sequence),
      '--json',
    ]);
    assert.equal(forkDone.task_result, 'approved', JSON.stringify(forkDone));
    const forkEvents = events(forked.state, created.session_id);
    assert.deepEqual(forkEvents.slice(0, prefix.length), prefix, 'the fork keeps the inherited ancestry as an immutable prefix');
    assert.equal(writes(replayed(forked.state, created.session_id)).length, 1);
    assert.deepEqual(criteriaRefs(forkEvents), criteriaRefs(referenceEvents));
    assert.deepEqual(evidence(forked.state).artifacts, verifiedReference.artifacts);
    assert.equal(
      cli(['status', '--profile', PROFILE, '--state', forked.state, '--json']).fork.ancestry_sha256,
      forked.fork.ancestry_sha256,
    );

    // Resuming the fork changed nothing in the parent, and the parent still replays on its own.
    assert.deepEqual(events(created.state, created.session_id), parentBefore);
    assert.equal(stateDigest(created.state), parentDigest);
    const parentReplay = cli([
      'resume',
      '--profile',
      PROFILE,
      '--state',
      created.state,
      '--expected-sequence',
      String(resumed.current_sequence),
      '--json',
    ]);
    assert.equal(parentReplay.task_result, 'approved');
    assert.deepEqual(events(created.state, created.session_id), parentBefore);

    // A tampered ancestry is refused before any step: the lineage digest is verified on every resume of the fork.
    const tampered = cli([
      'fork',
      '--profile',
      PROFILE,
      '--state',
      created.state,
      '--from-sequence',
      String(compaction.sequence),
      '--json',
    ]);
    states.push(tampered.state);
    const Database = require('better-sqlite3');
    const db = new Database(path.join(tampered.state, 'ledger.sqlite'));
    db.exec('DROP TRIGGER execution_events_no_update');
    const changed = db
      .prepare(
        `UPDATE execution_events SET payload_json = replace(payload_json, '\\"operational\\":false', '\\"operational\\":true') WHERE aggregate_id = ? AND stream_sequence = 1`,
      )
      .run(created.session_id);
    assert.equal(
      changed.changes,
      1,
      JSON.stringify(db.prepare('select aggregate_id, stream_sequence from execution_events limit 3').all()),
    );
    db.close();
    const refusal = spawnSync(
      process.execPath,
      [
        CLI,
        'agent',
        'resume',
        '--profile',
        PROFILE,
        '--state',
        tampered.state,
        '--expected-sequence',
        String(tampered.current_sequence),
        '--json',
      ],
      { encoding: 'utf8', env: { ...process.env, HOME: os.tmpdir(), TMPDIR: os.tmpdir() } },
    );
    assert.notEqual(refusal.status, 0, refusal.stdout.slice(0, 700));
    assert.match(`${refusal.stderr}${refusal.stdout}`, /ENGINEERING_FORK_ANCESTRY_MISMATCH/);

    // A checkpoint with a workspace effect or a terminal event cannot be forked.
    const failed = (args, pattern) => {
      const result = spawnSync(process.execPath, [CLI, 'agent', ...args], {
        encoding: 'utf8',
        env: { ...process.env, HOME: os.tmpdir(), TMPDIR: os.tmpdir() },
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stderr}${result.stdout}`, pattern);
    };
    failed(['fork', '--profile', PROFILE, '--state', created.state], /terminal/);
    const write = parentBefore.find((event) => event.event_type === 'tool.execution.started' && event.payload.name === 'engineering.write');
    failed(['fork', '--profile', PROFILE, '--state', created.state, '--from-sequence', String(write.sequence)], /workspace effect/);
    failed(['fork', '--profile', PROFILE, '--state', created.state, '--from-sequence', '9999'], /existing event/);
  } finally {
    for (const state of states) fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('fork and compaction options are refused where they do not apply', () => {
  const directory = workspace();
  try {
    const refused = (args, pattern) => {
      const result = spawnSync(process.execPath, [CLI, 'agent', ...args], {
        encoding: 'utf8',
        env: { ...process.env, HOME: os.tmpdir(), TMPDIR: os.tmpdir() },
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stderr}${result.stdout}`, pattern);
    };
    refused(['fork', '--state', directory], /disposable engineering profile/);
    refused(['fork', '--profile', PROFILE, '--json'], /requires state/);
    refused(['status', '--profile', PROFILE, '--state', directory, '--from-sequence', '2'], /applies only to fork/);
    refused(
      ['resume', '--profile', PROFILE, '--state', directory, '--compaction', path.join(directory, 'compaction.json')],
      /only to a new engineering run/,
    );
    refused(['run', '--compaction', path.join(directory, 'compaction.json')], /Engineering inputs require/);
    fs.writeFileSync(
      path.join(directory, 'bad.json'),
      JSON.stringify({ schema_version: 1, provider_id: 'compaction:deterministic', extra: true }),
    );
    refused(
      [
        'run',
        '--task-contract',
        path.join(directory, 'task.json'),
        '--scripted-responses',
        path.join(directory, 'responses.json'),
        '--compaction',
        path.join(directory, 'bad.json'),
      ],
      /Invalid compaction configuration/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the copy of a fork ancestry is proven against its lineage before the fork can run', () => {
  const { copyForkAncestry } = require('../tools/cli/lib/engineering-task-runtime');
  const ancestry = [{ event_id: 'a', sequence: 1 }];
  const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
  const fork = { ancestry_event_count: 1, ancestry_sha256: engineeringDigest(ancestry) };
  const store = (stored) => ({ append() {}, readSession: () => stored });
  assert.doesNotThrow(() => copyForkAncestry(store(ancestry), 's', ancestry, fork));
  assert.throws(() => copyForkAncestry(store([{ event_id: 'b', sequence: 1 }]), 's', ancestry, fork), /ENGINEERING_FORK_ANCESTRY_MISMATCH/);
  assert.throws(() => copyForkAncestry(store([]), 's', ancestry, fork), /ENGINEERING_FORK_ANCESTRY_MISMATCH/);
});
