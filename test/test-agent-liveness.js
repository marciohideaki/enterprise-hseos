'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const contract = require('../tools/lib/agent-liveness-contract');
const liveness = require('../tools/lib/agent-liveness');
const command = require('../tools/cli/commands/liveness');

const T0 = Date.parse('2026-10-12T12:00:00.000Z');
const S = 1000;
const CONFIG = { ...contract.DEFAULTS, enabled: true };
const NO_IO = {
  readHead: () => null,
  isPidAlive: () => true,
  statFile: () => ({ exists: false, modified_at: null }),
};

function tmpProject({ enabled = true, extra = '' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-liveness-'));
  fs.mkdirSync(path.join(directory, '.hseos', 'config'), { recursive: true });
  if (enabled !== null) fs.writeFileSync(path.join(directory, '.hseos', 'config', 'agent-liveness.yaml'), `enabled: ${enabled}\n${extra}`);
  return directory;
}

// The shipped example (disabled, defaults) copied into a throwaway project, so the tests do not depend on the live contract of this repository.
function exampleProject() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-liveness-example-'));
  fs.mkdirSync(path.join(directory, '.hseos', 'config'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'docs', 'evolution', 'contracts', 'agent-liveness.example.yaml'),
    path.join(directory, '.hseos', 'config', 'agent-liveness.yaml'),
  );
  return directory;
}

function withDb(directory, fn) {
  const db = liveness.openLivenessDb(directory, { write: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function emit(db, kind, atS, payload = null, who = {}) {
  return liveness.recordEvent(db, { session: who.session ?? 's1', agent: who.agent ?? 'a1', kind, payload, now: T0 + atS * S });
}

function waitLine(atS, deadlineInS, via = 'commander') {
  return {
    state: 'WAITING_ON',
    reason: 'pre-commit running',
    waiting_on: { condition: 'commit-done', wake_via: via, deadline_at: new Date(T0 + (atS + deadlineInS) * S).toISOString() },
  };
}

function classify(events, nowS, config = CONFIG) {
  return liveness.classifyRun(
    {
      session: 's1',
      agent: 'a1',
      events: events.map((e, index) => ({ id: index + 1, ts: new Date(T0 + e.at * S).toISOString(), payload: null, ...e })),
    },
    config,
    T0 + nowS * S,
  );
}

test('contract: absent file is disabled with defaults, example file validates and stays disabled', () => {
  const empty = tmpProject({ enabled: null });
  const loaded = contract.loadLivenessConfig(empty);
  assert.deepEqual([loaded.present, loaded.valid, loaded.enabled], [false, true, false]);
  assert.equal(loaded.config.foreground_wait_max_s, 540);
  const example = contract.loadLivenessConfig(exampleProject());
  assert.deepEqual([example.present, example.valid, example.enabled], [true, true, false]);
  assert.deepEqual(example.config, contract.DEFAULTS);
});

test('contract: the live contract of this repository is valid and enabled', () => {
  const live = contract.loadLivenessConfig(path.join(__dirname, '..'));
  assert.deepEqual([live.present, live.valid, live.enabled], [true, true, true], JSON.stringify(live.errors));
});

test('contract: schema rejects bad ranges and incoherent combinations but only warns on an unknown key', () => {
  for (const document of [
    { enabled: 'yes' },
    { foreground_wait_max_s: 600 },
    { stall_timeout_s: 30 },
    { escalate_to: 'nobody' },
    { max_wake_attempts: 0 },
    { max_wakes_per_cycle: 0 },
    { heartbeat_ttl_s: 1000, stall_timeout_s: 900 },
    { watch_interval_s: 1000, stall_timeout_s: 900 },
  ]) {
    const result = contract.validateLivenessConfig(document);
    assert.equal(result.ok, false, JSON.stringify(document));
    assert.ok(result.errors.length > 0);
  }
  const unknown = contract.validateLivenessConfig({ enabled: true, surprise: 1 });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.config.enabled, true);
  assert.equal('surprise' in unknown.config, false);
  assert.deepEqual(unknown.warnings, ['unknown key ignored: surprise']);
  const unknownAndInvalid = contract.validateLivenessConfig({ surprise: 1, max_wake_attempts: 0 });
  assert.equal(unknownAndInvalid.ok, false);
  assert.deepEqual(unknownAndInvalid.warnings, ['unknown key ignored: surprise']);
  assert.equal(contract.validateLivenessConfig().ok, true);
  assert.equal(contract.validateLivenessConfig({ enabled: true, max_stop_refusals: 0 }).config.max_stop_refusals, 0);
});

test('contract: invalid or unreadable file fails open (disabled) and reports errors', () => {
  const broken = tmpProject({ enabled: true, extra: 'max_wake_attempts: 0\n' });
  const loaded = contract.loadLivenessConfig(broken);
  assert.deepEqual([loaded.present, loaded.valid, loaded.enabled], [true, false, false]);
  assert.match(loaded.errors.join(' '), /max_wake_attempts/);
  const yamlBroken = tmpProject({ enabled: null });
  fs.writeFileSync(path.join(yamlBroken, '.hseos', 'config', 'agent-liveness.yaml'), 'enabled: [unterminated\n');
  const loadedYaml = contract.loadLivenessConfig(yamlBroken);
  assert.equal(loadedYaml.valid, false);
  assert.match(loadedYaml.errors[0], /^yaml:/);
});

test('contract: LIVENESS line validation (states, waiting_on rules, deadline cap, prose is never parsed)', () => {
  const opts = { now: T0, stallTimeoutS: 900 };
  const ok = contract.parseLivenessLine('LIVENESS: {"state":"DONE","reason":"all green","evidence":"abc123"}', opts);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.state, 'DONE');
  assert.equal(contract.parseLivenessLine({ state: 'BLOCKED', reason: 'needs input' }, opts).ok, true);
  assert.equal(contract.parseLivenessLine('{"state":"FAILED","reason":"boom"}', opts).ok, true);

  const multi = 'worked a lot\nLIVENESS: {"state":"BLOCKED","reason":"r"}\nbye';
  assert.equal(contract.extractLivenessLine(multi), '{"state":"BLOCKED","reason":"r"}');
  assert.equal(contract.parseLivenessLine(multi, opts).ok, true);
  assert.equal(contract.extractLivenessLine('aguardando o commit em segundo plano'), null);
  assert.equal(contract.extractLivenessLine(42), null);
  assert.equal(contract.parseLivenessLine('aguardando o commit', opts).ok, false);

  const failures = [
    ['{"state":"DONE","reason":"x"}', /evidence is required/],
    ['{"state":"WAITING_ON","reason":"x"}', /waiting_on is required/],
    [
      '{"state":"DONE","reason":"x","evidence":"e","waiting_on":{"condition":"c","wake_via":"human","deadline_at":"2026-10-12T12:05:00Z"}}',
      /waiting_on is forbidden/,
    ],
    ['{"state":"MAYBE","reason":"x"}', /state/],
    ['{"state":"BLOCKED","reason":""}', /reason/],
    ['{"state":"BLOCKED","reason":"x","extra":1}', /Unrecognized/],
    [
      '{"state":"WAITING_ON","reason":"x","waiting_on":{"condition":"c","wake_via":"self","deadline_at":"2026-10-12T12:05:00Z"}}',
      /wake_via/,
    ],
    ['{"state":"WAITING_ON","reason":"x","waiting_on":{"condition":"c","wake_via":"human","deadline_at":"tomorrow"}}', /ISO-8601/],
    [
      '{"state":"WAITING_ON","reason":"x","waiting_on":{"condition":"c","wake_via":"human","deadline_at":"2026-10-12T11:59:00Z"}}',
      /in the future/,
    ],
    [
      '{"state":"WAITING_ON","reason":"x","waiting_on":{"condition":"c","wake_via":"human","deadline_at":"2026-10-12T16:01:00Z"}}',
      /exceeds max_wait_deadline_s/,
    ],
    ['{not json', /invalid JSON/],
  ];
  for (const [line, pattern] of failures) {
    const result = contract.parseLivenessLine(line, opts);
    assert.equal(result.ok, false, line);
    assert.match(result.errors.join(' | '), pattern, line);
  }
  const edge = contract.parseLivenessLine(
    {
      state: 'WAITING_ON',
      reason: 'x',
      waiting_on: { condition: 'c', wake_via: 'commander', deadline_at: new Date(T0 + 900 * S).toISOString() },
    },
    opts,
  );
  assert.equal(edge.ok, true);
  const decision = (seconds) =>
    contract.parseLivenessLine(
      {
        state: 'WAITING_ON',
        reason: 'x',
        waiting_on: { condition: 'c', wake_via: 'commander', deadline_at: new Date(T0 + seconds * 1000).toISOString() },
      },
      opts,
    );
  assert.equal(decision(7200).ok, true, 'a review or human decision may outlast stall_timeout_s');
  assert.equal(decision(14_400).ok, true);
  assert.equal(decision(14_401).ok, false);
  assert.equal(
    contract.parseLivenessLine(decision(3600).value ? { ...decision(3600).value } : {}, { ...opts, maxWaitDeadlineS: 1800 }).ok,
    false,
    'the limit is configurable',
  );
});

test('classifier: running, lease lapse, stalled mid-turn', () => {
  assert.equal(classify([{ kind: 'wake_sent', at: 1 }], 5), null);
  const running = classify([{ kind: 'heartbeat', at: 0 }], 100);
  assert.deepEqual([running.state, running.overdue, running.violation], ['running', false, false]);
  const lapsed = classify([{ kind: 'heartbeat', at: 0 }], 400);
  assert.deepEqual([lapsed.state, lapsed.overdue, lapsed.violation], ['running', true, true]);
  assert.equal(liveness.planAction(lapsed, CONFIG, T0 + 400 * S), 'wake');
  assert.match(lapsed.detail, /not proof of death/);
  assert.equal(lapsed.reason_code, 'heartbeat_lease_expired');
  const stalled = classify([{ kind: 'heartbeat', at: 0 }], 901);
  assert.deepEqual([stalled.state, stalled.overdue, stalled.violation], ['stalled', true, true]);
  assert.equal(stalled.reason_code, 'stall_no_activity');
  const onlyReport = classify(
    [
      { kind: 'report', at: 0, payload: { state: 'DONE' } },
      { kind: 'heartbeat', at: 10 },
    ],
    20,
  );
  assert.equal(onlyReport.state, 'running');
});

test('classifier: turn_end is not a heartbeat (idle_no_state, then stalled)', () => {
  const events = [
    { kind: 'heartbeat', at: 0 },
    { kind: 'turn_end', at: 50 },
  ];
  const idle = classify(events, 60);
  assert.deepEqual([idle.state, idle.violation, idle.overdue], ['idle_no_state', true, false]);
  assert.equal(idle.last_activity_at, new Date(T0).toISOString());
  assert.equal(idle.last_turn_end_at, new Date(T0 + 50 * S).toISOString());
  const stalled = classify(events, 50 + 901);
  assert.deepEqual([stalled.state, stalled.violation, stalled.overdue], ['stalled', true, true]);
  assert.equal(classify([{ kind: 'turn_end', at: 0 }], 10).state, 'idle_no_state');
});

test('classifier: DONE is done; BLOCKED and FAILED are their own classes (not idle_no_state) and survive the closing turn_end', () => {
  const done = classify(
    [
      { kind: 'report', at: 0, payload: { state: 'DONE' } },
      { kind: 'turn_end', at: 1 },
    ],
    5000,
  );
  assert.deepEqual([done.state, done.reported, done.violation, done.blocked_age_s], ['done', 'DONE', false, null]);
  for (const [state, expected, code] of [
    ['BLOCKED', 'blocked', 'blocked_pending'],
    ['FAILED', 'failed', 'declared'],
  ]) {
    const run = classify(
      [
        { kind: 'report', at: 0, payload: { state } },
        { kind: 'turn_end', at: 1 },
      ],
      5000,
    );
    assert.deepEqual([run.state, run.reported, run.violation, run.blocked_age_s, run.reason_code], [expected, state, false, 5000, code]);
    assert.equal(liveness.planAction(run, CONFIG, T0 + 5000 * S), 'notify');
    assert.equal(liveness.planAction({ ...run, terminal_notified: true }, CONFIG, T0), 'none');
  }
});

test('classifier: WAITING_ON is waiting_ok until the deadline, then waiting_overdue', () => {
  const wait = waitLine(0, 600);
  const events = [
    { kind: 'report', at: 0, payload: wait },
    { kind: 'wait_declared', at: 0, payload: wait.waiting_on },
    { kind: 'turn_end', at: 1 },
  ];
  const ok = classify(events, 300);
  assert.deepEqual([ok.state, ok.violation, ok.deadline_at], ['waiting_ok', false, wait.waiting_on.deadline_at]);
  assert.equal(ok.reason_code, 'waiting_on_declared', 'declared waits are not counted with done/failed/running');
  const overdue = classify(events, 700);
  assert.deepEqual([overdue.state, overdue.violation, overdue.overdue], ['waiting_overdue', true, true]);
  assert.match(overdue.detail, /past its deadline/);
  const noWait = classify([{ kind: 'report', at: 0, payload: { state: 'WAITING_ON' } }], 5);
  assert.equal(noWait.state, 'waiting_overdue');
  assert.match(noWait.detail, /missing/);
  const afterWake = classify([...events, { kind: 'heartbeat', at: 800 }], 810);
  assert.equal(afterWake.state, 'running');
});

test('planAction: wake with backoff, escalate after max_wake_attempts, human waits escalate at once', () => {
  const base = { violation: true, attempts: 0, last_wake_at: null, escalated: false, wait: null };
  const at = (s) => T0 + s * S;
  assert.equal(liveness.planAction({ ...base, violation: false }, CONFIG, at(0)), 'none');
  assert.equal(liveness.planAction(base, CONFIG, at(0)), 'wake');
  const one = { ...base, attempts: 1, last_wake_at: new Date(T0).toISOString() };
  assert.equal(liveness.planAction(one, CONFIG, at(30)), 'none');
  assert.equal(liveness.planAction(one, CONFIG, at(60)), 'wake');
  const two = { ...base, attempts: 2, last_wake_at: new Date(T0).toISOString() };
  assert.equal(liveness.planAction(two, CONFIG, at(119)), 'none');
  assert.equal(liveness.planAction(two, CONFIG, at(120)), 'wake');
  const three = { ...base, attempts: 3, last_wake_at: new Date(T0).toISOString() };
  assert.equal(liveness.planAction(three, CONFIG, at(100)), 'none');
  assert.equal(liveness.planAction(three, CONFIG, at(240)), 'escalate');
  assert.equal(liveness.planAction({ ...three, escalated: true }, CONFIG, at(9999)), 'none');
  const human = { ...base, wait: { wake_via: 'human' } };
  assert.equal(liveness.planAction(human, CONFIG, at(0)), 'escalate');
  assert.equal(liveness.planAction({ ...human, escalated: true }, CONFIG, at(0)), 'none');
  assert.equal(liveness.wakeDelayS(1), 60);
  assert.equal(liveness.wakeDelayS(2), 120);
  assert.equal(liveness.wakeDelayS(9), liveness.WAKE_BACKOFF_MAX_S);
});

test('ledger: schema is additive, idempotent and leaves user_version and as_agent_runs alone', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    const before = db.pragma('user_version', { simple: true });
    liveness.ensureLivenessSchema(db);
    liveness.ensureLivenessSchema(db);
    assert.equal(db.pragma('user_version', { simple: true }), before);
    assert.ok(before <= 4);
    const { DAL } = { DAL: require('../tools/mcp-project-state/lib/agent-state-dal').AgentStateDAL };
    const dal = new DAL(db);
    dal.createRun({ id: 'r1', workflow_id: 'dev-squad', project: 'p' });
    dal.createTask({ id: 't1', run_id: 'r1', wave: 1 });
    db.prepare(`UPDATE as_tasks SET status = 'PENDING_EXECUTION' WHERE id = 't1'`).run();
    const claim = dal.claimTask('t1', 'agent');
    dal.recordHeartbeat(claim.agent_run_id);
    const heartbeatBefore = db
      .prepare(`SELECT last_heartbeat_at FROM as_agent_runs WHERE id = ?`)
      .get(claim.agent_run_id).last_heartbeat_at;
    emit(db, 'turn_end', 0);
    emit(db, 'heartbeat', 1);
    const heartbeatAfter = db.prepare(`SELECT last_heartbeat_at FROM as_agent_runs WHERE id = ?`).get(claim.agent_run_id).last_heartbeat_at;
    assert.equal(heartbeatAfter, heartbeatBefore);
    assert.deepEqual(dal.listOrphans(10), []);
    assert.throws(() => liveness.recordEvent(db, { session: 's1', agent: 'a1', kind: 'nope' }), /unknown liveness event kind/);
    assert.throws(() => liveness.recordEvent(db, { session: '../x', agent: 'a1', kind: 'heartbeat' }), /session must match/);
    assert.throws(() => liveness.assertSafeId('agent', 7), /agent must match/);
  });
  assert.equal(liveness.openLivenessDb(path.join(directory, 'nowhere')), null);
});

test('ledger: read-only open sees nothing before the table exists and loadRuns honors the lookback', () => {
  const directory = tmpProject();
  withDb(directory, () => {});
  const readonly = liveness.openLivenessDb(directory);
  try {
    assert.deepEqual(liveness.loadRuns(readonly, T0), []);
  } finally {
    readonly.close();
  }
  withDb(directory, (db) => {
    emit(db, 'heartbeat', 0);
    assert.equal(liveness.loadRuns(db, T0 + 10 * S).length, 1);
    assert.equal(liveness.loadRuns(db, T0 + 8 * 86_400 * S).length, 0);
    db.prepare(`UPDATE as_liveness_events SET payload_json = '{bad' WHERE 1 = 1`).run();
    assert.equal(liveness.loadRuns(db, T0 + 10 * S)[0].events[0].payload, null);
  });
});

test('watch: synthetic run without state is idle_no_state and gets a wake request within one cycle', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    emit(db, 'turn_end', 0);
    const result = liveness.runWatchCycle({
      db,
      directory,
      config: CONFIG,
      now: T0 + 30 * S,
      io: NO_IO,
      notify: () => assert.fail('no escalation expected'),
    });
    assert.equal(result.runs[0].state, 'idle_no_state');
    assert.equal(result.wake_requests.length, 1);
    const request = JSON.parse(fs.readFileSync(path.join(liveness.inboxDir(directory), result.wake_requests[0].file), 'utf8'));
    assert.deepEqual(Object.keys(request).sort(), ['agent', 'attempt', 'created_at', 'reason', 'session']);
    assert.equal(request.attempt, 1);
    assert.match(request.reason, /idle_no_state/);
    const kinds = db
      .prepare(`SELECT kind FROM as_liveness_events ORDER BY id`)
      .all()
      .map((row) => row.kind);
    assert.deepEqual(kinds, ['turn_end', 'idle_violation', 'wake_sent']);
    assert.equal(liveness.readInbox(directory).length, 1);
  });
});

test('watch: WAITING_ON overdue wakes with backoff, escalates after max_wake_attempts, never kills', () => {
  const directory = tmpProject();
  const escalations = [];
  withDb(directory, (db) => {
    const wait = waitLine(0, 100);
    liveness.recordReport(db, { session: 's1', agent: 'a1', value: wait, now: T0 });
    emit(db, 'turn_end', 1);
    const cycle = (atS) =>
      liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + atS * S, io: NO_IO, notify: (n) => escalations.push(n) });

    assert.equal(cycle(50).runs[0].state, 'waiting_ok');
    assert.equal(cycle(50).wake_requests.length, 0);
    const first = cycle(101);
    assert.equal(first.runs[0].state, 'waiting_overdue');
    assert.equal(first.wake_requests.length, 1);
    assert.equal(cycle(110).wake_requests.length, 0, 'backoff holds the second wake');
    assert.equal(cycle(101 + 60).wake_requests.length, 1);
    assert.equal(cycle(161 + 120).wake_requests.length, 1);
    assert.equal(escalations.length, 0);
    assert.equal(cycle(281 + 100).escalations.length, 0, 'last wake still gets its backoff window');
    const escalating = cycle(281 + 240);
    assert.equal(escalating.escalations.length, 1);
    assert.equal(escalating.escalations[0].cause, 'wake_exhausted');
    assert.equal(escalations.length, 1);
    assert.deepEqual(escalating.pruned.length, 1, 'inbox request is retired once escalated');
    assert.equal(liveness.readInbox(directory).length, 0);
    assert.equal(cycle(5000).escalations.length, 0, 'escalates once per episode');

    const lines = fs
      .readFileSync(path.join(directory, '.hseos', 'state', 'liveness', 'escalations.jsonl'), 'utf8')
      .trim()
      .split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).escalate_to, 'human');
    const wakeCount = db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_events WHERE kind = 'wake_sent'`).get().n;
    assert.equal(wakeCount, CONFIG.max_wake_attempts);
    assert.equal(db.prepare(`SELECT status FROM as_runs`).all().length, 0, 'the watchdog never touches workflow runs');
  });
});

test('watch: wake_via human escalates immediately without wake requests; notifier failure is contained', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    liveness.recordReport(db, { session: 's1', agent: 'a1', value: waitLine(0, 100, 'human'), now: T0 });
    const result = liveness.runWatchCycle({
      db,
      directory,
      config: CONFIG,
      now: T0 + 200 * S,
      io: NO_IO,
      notify: () => {
        throw new Error('notify-send missing');
      },
    });
    assert.equal(result.wake_requests.length, 0);
    assert.equal(result.escalations[0].cause, 'waiting_on_human');
    assert.equal(
      liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 300 * S, io: NO_IO, notify: () => {} }).escalations.length,
      0,
    );
  });
});

test('watch: a lapsed lease raises overdue and a wake in the same cycle, then escalates before stall_timeout_s; no takeover', () => {
  const directory = tmpProject();
  const notified = [];
  withDb(directory, (db) => {
    emit(db, 'heartbeat', 0);
    const cycle = (atS) =>
      liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + atS * S, io: NO_IO, notify: (n) => notified.push(n) });
    assert.equal(cycle(100).overdue.length, 0);
    const lapsed = cycle(400);
    assert.equal(lapsed.overdue.length, 1);
    assert.equal(lapsed.runs[0].overdue, true);
    assert.equal(lapsed.runs[0].state, 'running', 'an expired lease is not proof of death');
    assert.equal(lapsed.wake_requests.length, 1, 'no silence between heartbeat_ttl_s and stall_timeout_s');
    assert.match(lapsed.wake_requests[0].reason, /lease lapsed/);
    assert.equal(cycle(430).wake_requests.length, 0, 'backoff');
    assert.equal(cycle(460).wake_requests.length, 1);
    assert.equal(cycle(580).wake_requests.length, 1);
    assert.equal(cycle(700).escalations.length, 0, 'the last wake keeps its backoff window');
    const final = cycle(820);
    assert.equal(final.escalations.length, 1);
    assert.equal(notified.length, 1);
    const events = db.prepare(`SELECT kind, payload_json FROM as_liveness_events WHERE kind IN ('overdue', 'wake_sent')`).all();
    assert.equal(events.filter((e) => e.kind === 'overdue').length, 2);
    for (const row of events.filter((e) => e.kind === 'wake_sent'))
      assert.equal(JSON.parse(row.payload_json).reason_code, 'heartbeat_lease_expired');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM as_runs`).get().n, 0);
  });
});

test('incidents: ping-pong escalates; escalation closes the incident; the agent coming back and going silent again is woken and escalated again', () => {
  const directory = tmpProject();
  const notified = [];
  withDb(directory, (db) => {
    const cycle = (atS) =>
      liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + atS * S, io: NO_IO, notify: (n) => notified.push(n) });
    const count = (kind) => db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_events WHERE kind = ?`).get(kind).n;

    // Incident 1: three rounds of turn_end / wake without a LIVENESS report, then escalation.
    let escalations = 0;
    for (let round = 0; round < 3; round += 1) {
      emit(db, 'turn_end', round * 400);
      emit(db, 'heartbeat', round * 400 + 1);
      emit(db, 'turn_end', round * 400 + 2);
      escalations += cycle(round * 400 + 10).escalations.length;
    }
    assert.equal(count('wake_sent'), CONFIG.max_wake_attempts);
    escalations += cycle(1200 + 300).escalations.length;
    assert.equal(escalations, 1);
    assert.equal(notified.length, 1);
    assert.equal(count('idle_violation'), 1, 'recorded once per incident, not once per round');
    assert.equal(cycle(5000).wake_requests.length, 0, 'a closed incident stays quiet while the agent is silent');

    // Incident 2: the agent comes back (heartbeat) and goes silent again.
    emit(db, 'heartbeat', 6000);
    const back = cycle(6100);
    assert.deepEqual([back.runs[0].state, back.runs[0].wake_attempts, back.runs[0].escalated], ['running', 0, false]);
    assert.equal(cycle(6000 + 400).wake_requests.length, 1, 'lease lapse wakes it again');
    cycle(6000 + 460);
    cycle(6000 + 580);
    const second = cycle(6000 + 820);
    assert.equal(second.escalations.length, 1, 'and it is escalated again');
    assert.equal(notified.length, 2);
    assert.equal(count('wake_sent'), CONFIG.max_wake_attempts * 2);
    assert.equal(count('idle_violation'), 2);

    // A turn_end alone also opens an incident, and a valid report resets the count inside one.
    emit(db, 'turn_end', 9000);
    assert.equal(cycle(9010).wake_requests.length, 1);
    liveness.recordReport(db, { session: 's1', agent: 'a1', value: { state: 'BLOCKED', reason: 'declared' }, now: T0 + 9100 * S });
    const afterReport = liveness.evaluateRuns(db, CONFIG, T0 + 9110 * S, NO_IO)[0];
    assert.deepEqual([afterReport.state, afterReport.attempts, afterReport.escalated], ['blocked', 0, false]);
  });
});

test('incidents: a worktree HEAD change after an escalation reopens the incident through the reconcile heartbeat', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    const head1 = 'a'.repeat(40);
    const head2 = 'b'.repeat(40);
    liveness.recordEvent(db, {
      session: 's1',
      agent: 'a1',
      kind: 'heartbeat',
      payload: { truth: { worktree: '/wt/x', head: head1 } },
      now: T0,
    });
    emit(db, 'turn_end', 1);
    const cycle = (atS, head = head1) =>
      liveness.runWatchCycle({
        db,
        directory,
        config: CONFIG,
        now: T0 + atS * S,
        io: { ...NO_IO, readHead: () => head },
        notify: () => {},
      });
    cycle(30);
    cycle(100);
    cycle(250);
    assert.equal(cycle(500).escalations.length, 1);
    const moved = cycle(2000, head2);
    assert.equal(moved.reconciled.length, 1, 'progress observed after the escalation');
    const reopened = liveness.evaluateRuns(db, CONFIG, T0 + 2001 * S, { ...NO_IO, readHead: () => 'b'.repeat(40) })[0];
    assert.deepEqual([reopened.escalated, reopened.attempts], [false, 0]);
    emit(db, 'turn_end', 2010);
    assert.equal(cycle(2020, head2).wake_requests.length, 1, 'new incident, fresh count');
  });
});

test('watch: reconciles with the worktree HEAD before acting (moved HEAD is progress, not a stall)', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    const head1 = 'a'.repeat(40);
    const head2 = 'b'.repeat(40);
    liveness.recordEvent(db, {
      session: 's1',
      agent: 'a1',
      kind: 'heartbeat',
      payload: { truth: { worktree: '/wt/x', head: head1 } },
      now: T0,
    });
    emit(db, 'turn_end', 1);
    const moved = { ...NO_IO, readHead: () => head2 };
    const checked = liveness.evaluateRuns(db, CONFIG, T0 + 60 * S, moved)[0];
    assert.deepEqual([checked.state, checked.violation, checked.action], ['running', false, 'none']);
    assert.match(checked.detail, /HEAD moved/);

    const result = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 60 * S, io: moved, notify: () => {} });
    assert.equal(result.wake_requests.length, 0);
    assert.equal(result.reconciled.length, 1);
    const heartbeat = db.prepare(`SELECT payload_json FROM as_liveness_events WHERE kind = 'heartbeat' ORDER BY id DESC`).get();
    assert.equal(JSON.parse(heartbeat.payload_json).truth.head, head2, 'lease renewed only by observed progress');

    const stuck = liveness.runWatchCycle({
      db,
      directory,
      config: CONFIG,
      now: T0 + 70 * S,
      io: { ...NO_IO, readHead: () => head2 },
      notify: () => {},
    });
    assert.equal(stuck.reconciled.length, 0);
    assert.equal(stuck.runs[0].state, 'running', 'the reconcile heartbeat made the run active; no wake yet');
  });
});

test('reconcile: pid and status file enrich the wake reason without suppressing it', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    const wait = waitLine(0, 100);
    liveness.recordReport(db, { session: 's1', agent: 'a1', value: wait, truth: { pid: 4242, status_file: '/tmp/status.json' }, now: T0 });
    const io = { ...NO_IO, isPidAlive: () => false, statFile: () => ({ exists: true, modified_at: new Date(T0).toISOString() }) };
    const result = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 200 * S, io, notify: () => {} });
    assert.equal(result.wake_requests.length, 1);
    assert.match(result.wake_requests[0].reason, /awaited condition appears satisfied/);
    const run = result.runs[0];
    assert.equal(run.reconcile.observations.pid.alive, false);
    assert.equal(run.reconcile.observations.status_file.exists, true);
    assert.deepEqual(liveness.reconcileRun(null, NO_IO), { active: false, condition_met: false, observations: {} });
    const pending = liveness.reconcileRun({ pid: 1, status_file: '/x' }, NO_IO);
    assert.deepEqual([pending.active, pending.condition_met], [false, false]);
  });
});

test('watch: coordination entries in the shared inbox are counted, never read as wakes, rewritten or pruned', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    emit(db, 'turn_end', 0);
    const first = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 10 * S, io: NO_IO, notify: () => {} });
    assert.equal(first.wake_requests.length, 1);
    assert.equal(first.coordination_pending, 0);
    const dir = liveness.inboxDir(directory);
    const entry = {
      kind: 'coordination',
      schema: 'coordination-inbox/v1',
      recipient: 's1',
      reason: 'overlap',
      reason_code: 'path_overlap',
      created_at: new Date(T0).toISOString(),
      event: { type: 'overlap' },
    };
    fs.writeFileSync(path.join(dir, 's1-coordination-1-abc.json'), JSON.stringify(entry));
    // A typed entry that merely carries session/agent is still not a wake request.
    fs.writeFileSync(path.join(dir, 'typed.json'), JSON.stringify({ kind: 'other', session: 's1', agent: 'a1', reason: 'x' }));
    assert.equal(liveness.readInbox(directory).length, 1);
    assert.deepEqual(liveness.readCoordinationInbox(directory), [
      { file: 's1-coordination-1-abc.json', recipient: 's1', reason_code: 'path_overlap', created_at: entry.created_at },
    ]);
    emit(db, 'heartbeat', 20);
    const second = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 25 * S, io: NO_IO, notify: () => {} });
    assert.equal(second.pruned.length, 1);
    assert.equal(second.coordination_pending, 1);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['s1-coordination-1-abc.json', 'typed.json']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 's1-coordination-1-abc.json'), 'utf8')), entry);
  });
});

test('watch: the inbox is pruned once the agent answers; foreign and corrupt files are left alone', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    emit(db, 'turn_end', 0);
    const first = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 10 * S, io: NO_IO, notify: () => {} });
    assert.equal(first.wake_requests.length, 1);
    fs.writeFileSync(path.join(liveness.inboxDir(directory), 'corrupt.json'), '{nope');
    fs.writeFileSync(path.join(liveness.inboxDir(directory), 'note.txt'), 'x');
    emit(db, 'heartbeat', 20);
    const second = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 25 * S, io: NO_IO, notify: () => {} });
    assert.equal(second.pruned.length, 1);
    assert.equal(second.runs[0].state, 'running');
    assert.deepEqual(fs.readdirSync(liveness.inboxDir(directory)).sort(), ['corrupt.json', 'note.txt']);
    assert.deepEqual(liveness.readInbox(directory), []);
    assert.deepEqual(liveness.readInbox(path.join(directory, 'missing')), []);
  });
});

test('runWatch: loops, re-reads the contract every cycle, once and maxCycles stop it', async () => {
  const directory = tmpProject();
  const sleeps = [];
  const sleep = async (ms) => sleeps.push(ms);
  let clock = T0;
  const now = () => (clock += S);
  withDb(directory, (db) => emit(db, 'turn_end', 0));

  const once = await liveness.runWatch({
    directory,
    loadConfig: contract.loadLivenessConfig,
    once: true,
    sleep,
    now,
    io: NO_IO,
    notify: () => {},
  });
  assert.equal(once.length, 1);
  assert.equal(once[0].wake_requests.length, 1);
  assert.equal(sleeps.length, 0);

  const looped = await liveness.runWatch({
    directory,
    loadConfig: contract.loadLivenessConfig,
    maxCycles: 3,
    sleep,
    now,
    io: NO_IO,
    notify: () => {},
  });
  assert.equal(looped.length, 3);
  assert.deepEqual(sleeps, [120_000, 120_000]);

  const states = [
    { valid: true, enabled: false, config: { watch_interval_s: 5 } },
    { valid: false, enabled: false, errors: ['bad'], config: {} },
  ];
  let index = 0;
  const flipping = await liveness.runWatch({ directory, loadConfig: () => states[index++ % 2], maxCycles: 4, sleep, now });
  assert.deepEqual(
    flipping.map((c) => c.enabled),
    [false, false, false, false],
  );
  assert.deepEqual(flipping[1].errors, ['bad']);

  let stopAfter = 0;
  const stopped = await liveness.runWatch({
    directory,
    loadConfig: contract.loadLivenessConfig,
    sleep,
    now,
    io: NO_IO,
    notify: () => {},
    shouldStop: () => stopAfter++ >= 1,
  });
  assert.equal(stopped.length, 1);
});

test('checkRuns is read-only and reports the contract shape', () => {
  const directory = tmpProject();
  assert.deepEqual(liveness.checkRuns({ directory, config: CONFIG, now: T0 }), {
    runs: [],
    wake_requests: [],
    metrics: { runs_by_reason_code: {}, wakes_by_reason_code: {} },
    outbox: { pending: 0, gave_up: 0 },
  });
  assert.equal(fs.existsSync(path.join(directory, '.hseos', 'state', 'project.db')), false, 'check never creates the database');
  withDb(directory, (db) => emit(db, 'turn_end', 0));
  const result = liveness.checkRuns({ directory, config: CONFIG, now: T0 + 5 * S, io: NO_IO });
  const run = result.runs[0];
  for (const key of ['session', 'agent', 'state', 'last_event_at', 'overdue', 'violation']) assert.ok(key in run, key);
  assert.equal(run.state, 'idle_no_state');
  assert.deepEqual(result.wake_requests, []);
});

test('await: done on pid exit, file or cmd-status; running at the cap; never beyond foreground_wait_max_s', async () => {
  let clock = 0;
  const now = () => clock;
  const sleep = async (ms) => {
    clock += ms;
  };
  const common = { foregroundMaxS: 540, now, sleep, pollMs: 1000 };

  let alive = 3;
  const byPid = await liveness.awaitCondition({ ...common, pid: 999, isPidAlive: () => alive-- > 0 });
  assert.deepEqual([byPid.status, byPid.condition], ['done', 'pid']);

  const directory = tmpProject({ enabled: null });
  const file = path.join(directory, 'flag');
  const pending = await liveness.awaitCondition({ ...common, file, maxS: 5 });
  assert.deepEqual([pending.status, pending.max_s, pending.waited_s], ['running', 5, 5]);
  assert.match(pending.message, /ainda rodando, chame de novo/);
  fs.writeFileSync(file, 'x');
  assert.equal((await liveness.awaitCondition({ ...common, file, maxS: 5 })).status, 'done');

  clock = 0;
  const clamped = await liveness.awaitCondition({ ...common, file: path.join(directory, 'never'), maxS: 100_000 });
  assert.deepEqual([clamped.status, clamped.clamped, clamped.max_s, clamped.waited_s], ['running', true, 540, 540]);
  clock = 0;
  const defaulted = await liveness.awaitCondition({ ...common, file: path.join(directory, 'never') });
  assert.equal(defaulted.max_s, 540);

  const status = path.join(directory, 'status.json');
  fs.writeFileSync(status, '{"exit_code":');
  assert.equal(
    (await liveness.awaitCondition({ ...common, cmdStatus: status, maxS: 2 })).status,
    'running',
    'a partial status file keeps waiting',
  );
  fs.writeFileSync(status, '{"exit_code": 3, "finished_at": "2026-10-12T12:00:00Z"}');
  const finished = await liveness.awaitCondition({ ...common, cmdStatus: status, maxS: 2 });
  assert.deepEqual([finished.status, finished.exit_code, finished.finished_at], ['done', 3, '2026-10-12T12:00:00Z']);
  fs.writeFileSync(status, '{"exit_code": 0}');
  assert.equal((await liveness.awaitCondition({ ...common, cmdStatus: status, maxS: 2 })).finished_at, null);

  clock = 0;
  const ticks = [];
  await liveness.awaitCondition({
    ...common,
    file: path.join(directory, 'never'),
    maxS: 10,
    tickEveryS: 4,
    onTick: () => ticks.push(clock),
  });
  assert.deepEqual(ticks, [0, 4000, 8000]);
});

test('await: rejects ambiguous or unsafe arguments', async () => {
  const base = { foregroundMaxS: 540 };
  const bad = [
    {},
    { pid: 1, file: '/x' },
    { pid: 0 },
    { pid: 1.5 },
    { file: 'relative' },
    { cmdStatus: 'relative' },
    { file: '/x', maxS: 0 },
    { file: '/x', maxS: Number.NaN },
  ];
  for (const extra of bad) await assert.rejects(() => liveness.awaitCondition({ ...base, ...extra }), TypeError, JSON.stringify(extra));
});

test('systemd units are rendered, escaped and never installed', () => {
  const units = liveness.renderSystemdUnits({
    directory: '/work/my "proj" 100%',
    nodePath: '/usr/bin/node',
    cliPath: '/opt/hseos/cli.js',
    intervalS: 90,
  });
  assert.match(
    units.service,
    /ExecStart="\/usr\/bin\/node" "\/opt\/hseos\/cli.js" liveness watch --once --directory "\/work\/my \\"proj\\" 100%%"/,
  );
  assert.match(units.service, /Type=oneshot/);
  assert.match(units.timer, /OnUnitActiveSec=90s/);
  assert.match(units.timer, /WantedBy=timers.target/);
  assert.match(liveness.renderSystemdUnits({ directory: '/d', nodePath: '/n', cliPath: '/c', intervalS: 1 }).timer, /OnUnitActiveSec=120s/);
  assert.throws(() => liveness.renderSystemdUnits({ directory: '/d\nExecStart=evil', nodePath: '/n', cliPath: '/c' }), /single-line/);
  assert.throws(() => liveness.renderSystemdUnits({ directory: '', nodePath: '/n', cliPath: '/c' }), /single-line/);
});

test('cli: absent or disabled contract changes nothing and exits 0', async () => {
  for (const enabled of [null, false]) {
    const directory = tmpProject({ enabled });
    for (const [action, options] of [
      ['report', { session: 's1', agent: 'a1', json: '{"state":"BLOCKED","reason":"x"}' }],
      ['check', { json: true }],
      ['watch', { once: true }],
    ]) {
      const result = await command._internal.run(action, { directory, ...options });
      assert.equal(result.code, 0, `${action} enabled=${enabled}`);
      assert.equal(result.body.enabled, false);
    }
    assert.equal(fs.existsSync(path.join(directory, '.hseos', 'state')), false, 'no state is created');
  }
});

test('cli: an invalid contract is reported with exit 2, not silently ignored', async () => {
  const directory = tmpProject({ enabled: true, extra: 'max_wake_attempts: 0\n' });
  const result = await command._internal.run('check', { directory });
  assert.equal(result.code, 2);
  assert.equal(result.body.valid, false);
});

test('cli: an unknown key warns on stderr and keeps the contract active', async () => {
  const directory = tmpProject({ enabled: true, extra: 'surprise: 1\n' });
  const result = await command._internal.run('check', { directory });
  assert.equal(result.code, 0);
  assert.equal(result.body.enabled, true);
  assert.deepEqual(result.body.warnings, ['unknown key ignored: surprise']);
});

test('cli: report validates and records; turn_end and heartbeat events carry the source of truth', async () => {
  const directory = tmpProject();
  const clock = { now: () => T0 };
  const head = 'c'.repeat(40);
  const io = { ...clock, reconcile: { ...NO_IO, readHead: () => head } };
  const run = (action, options) => command._internal.run(action, { directory, session: 's1', agent: 'a1', ...options }, io);

  const done = await run('report', { json: 'LIVENESS: {"state":"DONE","reason":"ok","evidence":"abc"}' });
  assert.deepEqual([done.code, done.body.recorded, done.body.state], [0, true, 'DONE']);

  const wait = await run('report', { json: JSON.stringify(waitLine(0, 300)), pid: '77', statusFile: '/tmp/s.json', worktree: '/wt/y' });
  assert.equal(wait.code, 0);
  assert.equal(wait.body.event_ids.length, 2);
  const turnEnd = await run('report', { event: 'turn_end', worktree: '/wt/y' });
  assert.deepEqual([turnEnd.code, turnEnd.body.event], [0, 'turn_end']);
  const heartbeat = await run('report', { event: 'heartbeat' });
  assert.equal(heartbeat.code, 0);

  withDb(directory, (db) => {
    const rows = db.prepare(`SELECT kind, payload_json FROM as_liveness_events ORDER BY id`).all();
    assert.deepEqual(
      rows.map((r) => r.kind),
      ['report', 'report', 'wait_declared', 'turn_end', 'heartbeat'],
    );
    assert.deepEqual(JSON.parse(rows[1].payload_json).truth, { pid: 77, status_file: '/tmp/s.json', worktree: '/wt/y', head });
    assert.equal(rows[4].payload_json, null);
  });

  const failures = [
    [{ json: '{"state":"DONE","reason":"x"}' }, 2],
    [{ json: 'prose only' }, 2],
    [{}, 2],
    [{ session: '', json: '{}' }, 2],
    [{ agent: '../evil', json: '{}' }, 2],
    [{ event: 'wake_sent' }, 2],
    [{ event: 'heartbeat', pid: 'abc' }, 2],
    [{ event: 'heartbeat', statusFile: 'relative' }, 2],
    [{ event: 'heartbeat', worktree: 'relative' }, 2],
  ];
  for (const [options, code] of failures) {
    const result = await run('report', options);
    assert.equal(result.code, code, JSON.stringify(options));
    assert.ok(result.body.errors || result.body.error);
  }
  const noSession = await command._internal.run('report', { directory, agent: 'a1', json: '{}' }, io);
  assert.equal(noSession.code, 2);
});

test('cli: check, watch and await work end to end on the real ledger', async () => {
  const directory = tmpProject();
  let clock = T0;
  const io = { now: () => clock, sleep: async (ms) => (clock += ms), notify: () => {}, reconcile: NO_IO };
  await command._internal.run('report', { directory, session: 's1', agent: 'a1', event: 'turn_end' }, io);
  clock += 5 * S;

  const check = await command._internal.run('check', { directory, json: true }, io);
  assert.equal(check.body.runs[0].state, 'idle_no_state');
  assert.match(check.text, /idle_no_state\s+s1\/a1/);
  assert.equal((await command._internal.run('check', { directory }, io)).text.includes('pending wake'), false);

  const watched = await command._internal.run('watch', { directory, once: true }, io);
  assert.equal(watched.body.wake_requests.length, 1);
  const after = await command._internal.run('check', { directory, json: true }, io);
  assert.equal(after.body.wake_requests.length, 1);
  assert.match((await command._internal.run('check', { directory }, io)).text, /1 pending wake request/);

  const looped = await command._internal.run('watch', { directory, maxCycles: '2' }, io);
  assert.equal(looped.body.cycles.length, 2);
  assert.equal((await command._internal.run('watch', { directory, maxCycles: 'x' }, io)).code, 2);

  const units = await command._internal.run('watch', { directory, printSystemd: true }, io);
  assert.match(units.text, /hseos-liveness-watch\.timer/);

  const flag = path.join(directory, 'done.flag');
  const pending = await command._internal.run('await', { directory, file: flag, max: '3', pollMs: '1000' }, io);
  assert.deepEqual([pending.code, pending.body.status], [75, 'running']);
  fs.writeFileSync(flag, '');
  assert.equal((await command._internal.run('await', { directory, file: flag }, io)).code, 0);
  assert.equal((await command._internal.run('await', { directory }, io)).code, 2);
  assert.equal((await command._internal.run('await', { directory, pid: '0' }, io)).code, 2);
  assert.equal((await command._internal.run('nope', { directory }, io)).code, 2);
});

test('cli: await records heartbeats while it waits when the contract is on and an agent is named', async () => {
  const directory = tmpProject();
  let clock = T0;
  const io = { now: () => clock, sleep: async (ms) => (clock += ms), reconcile: NO_IO };
  const flag = path.join(directory, 'never');
  const result = await command._internal.run(
    'await',
    { directory, file: flag, max: '400', pollMs: '50000', session: 's1', agent: 'a1' },
    io,
  );
  assert.equal(result.body.status, 'running');
  withDb(directory, (db) => {
    const beats = db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_events WHERE kind = 'heartbeat'`).get().n;
    assert.ok(beats >= 2, `expected periodic heartbeats, got ${beats}`);
  });
  const disabled = tmpProject({ enabled: false });
  const quiet = await command._internal.run(
    'await',
    { directory: disabled, file: path.join(disabled, 'never'), max: '2', session: 's1', agent: 'a1' },
    io,
  );
  assert.equal(quiet.body.status, 'running');
  assert.equal(fs.existsSync(path.join(disabled, '.hseos', 'state')), false);
});

test('cli: unexpected failures surface as exit 1 and the registered action prints and sets the exit code', async () => {
  const directory = tmpProject();
  fs.mkdirSync(path.join(directory, '.hseos', 'state', 'project.db'), { recursive: true });
  const broken = await command._internal.run('report', { directory, session: 's1', agent: 'a1', event: 'heartbeat' });
  assert.equal(broken.code, 1);

  const lines = [];
  const original = console.log;
  const originalExitCode = process.exitCode;
  console.log = (line) => lines.push(line);
  try {
    await command.action('check', { directory: tmpProject({ enabled: false }), json: true });
    assert.equal(JSON.parse(lines[0]).enabled, false);
    assert.equal(process.exitCode, originalExitCode);
    await command.action('watch', { directory: tmpProject({ enabled: false }), printSystemd: true });
    assert.match(lines[1], /hseos-liveness-watch\.service/);
    await command.action('await', { directory, file: path.join(directory, 'never'), max: '1', pollMs: '1000' });
    assert.equal(process.exitCode, 75);
    await command.action('check', { directory: tmpProject({ enabled: null }) });
    assert.match(lines[3], /enabled/);
  } finally {
    console.log = original;
    process.exitCode = originalExitCode;
  }
});

test('manifest and package surface: the liveness command is registered and the example contract is shipped disabled', () => {
  const manifest = require('../tools/cli/command-manifest.json');
  const entry = manifest.entries.find((candidate) => candidate.filename === 'liveness.js');
  assert.equal(entry.command, 'liveness <action>');
  assert.equal(entry.governed, false);
  assert.deepEqual(
    entry.options.map((option) => option[0]).filter((name) => /--(json|once|max)\b/.test(name)),
    ['--json [line]', '--max <seconds>', '--once', '--max-cycles <n>'],
  );
});

// ---------------------------------------------------------------- Adendo 1 ----

const { AgentStateDAL } = require('../tools/mcp-project-state/lib/agent-state-dal');
const { takeSnapshot } = require('../tools/state-ui-server/lib/snapshot');

function seedIdleRuns(db, count) {
  for (let index = 0; index < count; index += 1) emit(db, 'turn_end', index, null, { agent: `a${index}` });
}

test('await renews the heartbeat every 60 s, so a full 540 s wait never goes overdue', async () => {
  const directory = tmpProject();
  let clock = T0;
  const io = { now: () => clock, sleep: async (ms) => (clock += ms), reconcile: NO_IO };
  const result = await command._internal.run(
    'await',
    { directory, file: path.join(directory, 'never'), max: '540', pollMs: '1000', session: 's1', agent: 'a1' },
    io,
  );
  assert.deepEqual([result.body.status, result.body.waited_s], ['running', 540]);
  withDb(directory, (db) => {
    const beats = db.prepare(`SELECT ts FROM as_liveness_events WHERE kind = 'heartbeat' ORDER BY id`).all();
    assert.ok(beats.length >= 9, `heartbeats: ${beats.length}`);
    const gaps = beats.slice(1).map((beat, index) => (Date.parse(beat.ts) - Date.parse(beats[index].ts)) / S);
    assert.ok(Math.max(...gaps) <= 60, `largest gap ${Math.max(...gaps)}s`);
    const events = liveness.loadRuns(db, clock)[0].events;
    for (let offset = 0; offset <= 540; offset += 30) {
      const during = liveness.classifyRun(
        { session: 's1', agent: 'a1', events: events.filter((e) => Date.parse(e.ts) <= T0 + offset * S) },
        CONFIG,
        T0 + offset * S,
      );
      assert.equal(during.overdue, false, `overdue at +${offset}s`);
    }
  });
});

test('reason_code is enumerated on every liveness event and counted per code', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    liveness.recordReport(db, { session: 's1', agent: 'wait', value: waitLine(0, 100), now: T0 });
    liveness.recordReport(db, { session: 's1', agent: 'blk', value: { state: 'BLOCKED', reason: 'needs input' }, now: T0 });
    liveness.recordReport(db, {
      session: 's1',
      agent: 'dne',
      value: { state: 'DONE', reason: 'ok', evidence: 'x' },
      reasonCode: 'declared',
      now: T0,
    });
    assert.throws(
      () =>
        liveness.recordReport(db, { session: 's1', agent: 'dne', value: { state: 'DONE', reason: 'ok' }, reasonCode: 'made_up', now: T0 }),
      /unknown reason_code/,
    );
    emit(db, 'turn_end', 0, null, { agent: 'idle' });
    emit(db, 'heartbeat', 0, null, { agent: 'lease' });
    const cycle = (atS) => liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + atS * S, io: NO_IO, notify: () => {} });
    cycle(400);
    cycle(1000);
    const events = db.prepare(`SELECT kind, payload_json FROM as_liveness_events`).all();
    const codes = new Set(contract.REASON_CODES);
    for (const row of events.filter((e) => ['report', 'wait_declared', 'idle_violation', 'overdue', 'wake_sent'].includes(e.kind))) {
      assert.ok(codes.has(JSON.parse(row.payload_json).reason_code), `${row.kind}: ${row.payload_json}`);
    }
    const byKind = Object.fromEntries(events.map((e) => [e.kind, JSON.parse(e.payload_json ?? 'null')]));
    assert.equal(byKind.report.reason_code, 'declared');
    const metrics = liveness.checkRuns({ directory, config: CONFIG, now: T0 + 1000 * S, io: NO_IO }).metrics;
    assert.ok(metrics.runs_by_reason_code.blocked_pending >= 1);
    assert.ok(metrics.runs_by_reason_code.no_state_at_stop >= 1);
    assert.ok(metrics.runs_by_reason_code.wait_deadline_exceeded >= 1);
    assert.ok(metrics.wakes_by_reason_code.no_state_at_stop >= 1);
    assert.ok(metrics.wakes_by_reason_code.wait_deadline_exceeded >= 1);
  });
});

test('blocked and failed notify the human once, appear with blocked_age_s, and are never woken', () => {
  const directory = tmpProject();
  const notices = [];
  withDb(directory, (db) => {
    liveness.recordReport(db, { session: 's1', agent: 'blk', value: { state: 'BLOCKED', reason: 'needs a decision' }, now: T0 });
    liveness.recordReport(db, { session: 's1', agent: 'bad', value: { state: 'FAILED', reason: 'compile error' }, now: T0 });
    emit(db, 'turn_end', 1, null, { agent: 'blk' });
    const cycle = (atS) =>
      liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + atS * S, io: NO_IO, notify: (n) => notices.push(n) });
    const first = cycle(30);
    assert.equal(first.notifications.length, 2);
    assert.equal(first.wake_requests.length, 0);
    const blocked = first.runs.find((run) => run.agent === 'blk');
    assert.deepEqual(
      [blocked.state, blocked.blocked_age_s, blocked.reason_code, blocked.violation],
      ['blocked', 30, 'blocked_pending', false],
    );
    assert.equal(notices.length, 2);
    assert.match(notices[0].title, /is (blocked|failed)/);
    emit(db, 'turn_end', 40, null, { agent: 'blk' });
    const second = cycle(3600);
    assert.equal(second.notifications.length, 0, 'notified once, even after another turn_end');
    assert.equal(second.runs.find((run) => run.agent === 'blk').blocked_age_s, 3600);
    const lines = fs
      .readFileSync(path.join(directory, '.hseos', 'state', 'liveness', 'escalations.jsonl'), 'utf8')
      .trim()
      .split('\n');
    assert.deepEqual(lines.map((line) => JSON.parse(line).cause).sort(), ['blocked', 'failed']);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_events WHERE kind = 'wake_sent'`).get().n, 0);
  });
});

test('a run already ended in the agent-state ledger is reconciled to done and never woken', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    const dal = new AgentStateDAL(db);
    dal.createRun({ id: 'r1', workflow_id: 'dev-squad', project: 'p' });
    dal.attachRunToSession({ run_id: 'r1', session_id: 's1' });
    dal.createTask({ id: 't1', run_id: 'r1', wave: 1 });
    db.prepare(`UPDATE as_tasks SET status = 'PENDING_EXECUTION' WHERE id = 't1'`).run();
    const claim = dal.claimTask('t1', 'a1');
    emit(db, 'turn_end', 0);
    const live = liveness.evaluateRuns(db, CONFIG, T0 + 10 * S, NO_IO)[0];
    assert.deepEqual([live.state, live.action], ['idle_no_state', 'wake']);
    dal.completeAgentRun(claim.agent_run_id, { status: 'completed' });
    const ended = liveness.evaluateRuns(db, CONFIG, T0 + 10 * S, NO_IO)[0];
    assert.deepEqual([ended.state, ended.violation, ended.action], ['done', false, 'none']);
    assert.match(ended.reconcile.run_status, /agent run completed/);
    const result = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 10 * S, io: NO_IO, notify: () => {} });
    assert.equal(result.wake_requests.length, 0);

    db.prepare(`UPDATE as_agent_runs SET status = 'running', ended_at = NULL`).run();
    db.prepare(`UPDATE as_runs SET status = 'aborted'`).run();
    assert.match(liveness.evaluateRuns(db, CONFIG, T0 + 10 * S, NO_IO)[0].reconcile.run_status, /run aborted/);
    db.prepare(`UPDATE as_runs SET status = 'active'`).run();
    assert.equal(liveness.evaluateRuns(db, CONFIG, T0 + 10 * S, NO_IO)[0].state, 'idle_no_state');
  });
});

test('config is re-read every call; an invalid edit falls back to the last valid one with a warning', () => {
  const directory = tmpProject({ enabled: true, extra: 'stall_timeout_s: 600\n' });
  const file = path.join(directory, '.hseos', 'config', 'agent-liveness.yaml');
  const first = contract.loadLivenessConfigWithFallback(directory, { remember: true });
  assert.deepEqual([first.valid, first.enabled, first.config.stall_timeout_s, first.warnings], [true, true, 600, []]);
  fs.writeFileSync(file, 'enabled: true\nstall_timeout_s: 700\n');
  assert.equal(contract.loadLivenessConfigWithFallback(directory, { remember: true }).config.stall_timeout_s, 700, 'no cache');
  fs.writeFileSync(file, 'enabled: true\nstall_timeout_s: 5\n');
  const fallback = contract.loadLivenessConfigWithFallback(directory, { remember: true });
  assert.deepEqual([fallback.valid, fallback.fallback, fallback.enabled, fallback.config.stall_timeout_s], [true, true, true, 700]);
  assert.match(fallback.warnings[0], /invalid .* using the last valid configuration/);

  fs.writeFileSync(file, 'enabled: false\n');
  assert.equal(contract.loadLivenessConfigWithFallback(directory, { remember: true }).enabled, false);
  fs.writeFileSync(file, 'max_wake_attempts: 0\n');
  const afterDisable = contract.loadLivenessConfigWithFallback(directory, { remember: true });
  assert.deepEqual([afterDisable.fallback, afterDisable.enabled], [true, false], 'the last valid config was the disabled one');

  const never = tmpProject({ enabled: true, extra: 'max_wake_attempts: 0\n' });
  const unremembered = contract.loadLivenessConfigWithFallback(never, { remember: true });
  assert.deepEqual([unremembered.valid, unremembered.fallback], [false, undefined]);
  const disabledOnly = tmpProject({ enabled: false });
  contract.loadLivenessConfigWithFallback(disabledOnly, { remember: true });
  assert.equal(fs.existsSync(path.join(disabledOnly, '.hseos', 'state')), false);
  const memory = tmpProject({ enabled: true });
  contract.loadLivenessConfigWithFallback(memory, { remember: true });
  fs.writeFileSync(path.join(memory, '.hseos', 'state', 'liveness', 'last-valid-config.json'), '{broken');
  fs.writeFileSync(path.join(memory, '.hseos', 'config', 'agent-liveness.yaml'), 'max_wake_attempts: 0\n');
  assert.equal(contract.loadLivenessConfigWithFallback(memory, { remember: true }).valid, false, 'a corrupt remembered config is ignored');
});

test('cli: a broken contract keeps the last valid one in force and surfaces a warning', async () => {
  const directory = tmpProject();
  await command._internal.run('report', { directory, session: 's1', agent: 'a1', json: '{"state":"BLOCKED","reason":"r"}' });
  fs.writeFileSync(path.join(directory, '.hseos', 'config', 'agent-liveness.yaml'), 'enabled: true\nstall_timeout_s: 5\n');
  const originalError = console.error;
  const errors = [];
  console.error = (line) => errors.push(line);
  try {
    const result = await command._internal.run('check', { directory, json: true });
    assert.equal(result.code, 0);
    assert.equal(result.body.enabled, true);
    assert.match(result.body.warnings[0], /last valid configuration/);
    assert.match(errors[0], /warning/);
  } finally {
    console.error = originalError;
  }
});

test('report verifies evidence (path, commit in HEAD, run id) and only alerts when it cannot', async () => {
  const directory = tmpProject();
  const artifact = path.join(directory, 'receipt.json');
  fs.writeFileSync(artifact, '{}');
  const io = { now: () => T0, reconcile: { ...NO_IO, commitInHead: (_base, commit) => commit === 'abc1234' } };
  const report = (evidence, extra = {}) =>
    command._internal.run(
      'report',
      {
        directory,
        session: 's1',
        agent: 'a1',
        json: JSON.stringify({ state: 'BLOCKED', reason: 'r', ...(evidence && { evidence }) }),
        ...extra,
      },
      io,
    );

  const byPath = await report('receipt.json');
  assert.deepEqual([byPath.code, byPath.body.evidence_verified, byPath.body.alerts], [0, true, undefined]);
  assert.equal((await report('abc1234')).body.evidence_verified, true);
  assert.equal((await report('deadbee')).body.evidence_verified, false);
  const none = await report(null);
  assert.equal(none.body.evidence_verified, null);
  const bad = await report('nothing at all');
  assert.deepEqual([bad.code, bad.body.evidence_verified, bad.body.alerts], [0, false, [{ reason_code: 'evidence_unverified' }]]);

  withDb(directory, (db) => {
    new AgentStateDAL(db).createRun({ id: 'run-77', workflow_id: 'w', project: 'p' });
    assert.equal(liveness.verifyEvidence('run-77', { db, directory, io: NO_IO }).verified, true);
    assert.deepEqual(
      liveness.verifyEvidence('with\u0000nul', { db, directory, io: NO_IO }).checks.map((c) => c.kind),
      ['run_id'],
    );
    const rows = db
      .prepare(`SELECT payload_json FROM as_liveness_events WHERE kind = 'report' ORDER BY id`)
      .all()
      .map((r) => JSON.parse(r.payload_json));
    assert.equal(rows[4].evidence_verified, false);
    assert.deepEqual(rows[4].alerts, ['evidence_unverified']);
    assert.equal(rows[3].evidence_verified, null);
    assert.equal(
      liveness.verifyEvidence('x', {
        db: {
          prepare: () => ({
            get: () => {
              throw new Error('no table');
            },
          }),
        },
        directory,
        io: NO_IO,
      }).verified,
      false,
    );
  });
  const real = liveness.verifyEvidence(path.basename(__filename), {
    db: { prepare: () => ({ get: () => {} }) },
    directory: __dirname,
    worktree: undefined,
  });
  assert.equal(real.verified, true, 'default path check sees real files');
  assert.equal(
    liveness.verifyEvidence('0000000', { db: { prepare: () => ({ get: () => {} }) }, directory: __dirname }).verified,
    false,
    'default commit check is false outside a repo ancestry',
  );
});

test('report: --reason-code must be coherent with the declared state; WAITING_ON uses waiting_on_declared', async () => {
  const directory = tmpProject();
  const io = { now: () => T0, reconcile: NO_IO };
  const run = (options) => command._internal.run('report', { directory, session: 's1', agent: 'a1', ...options }, io);
  const blocked = '{"state":"BLOCKED","reason":"r"}';
  const done = '{"state":"DONE","reason":"r","evidence":"e"}';
  const waiting = JSON.stringify(waitLine(0, 600));
  assert.equal((await run({ json: blocked, reasonCode: 'blocked_pending' })).code, 0);
  assert.equal((await run({ json: waiting, reasonCode: 'waiting_on_declared' })).code, 0);
  assert.equal((await run({ json: done, reasonCode: 'declared' })).code, 0);
  for (const [json, reasonCode] of [
    [blocked, 'declared'],
    [blocked, 'guard_internal_error'],
    [waiting, 'blocked_pending'],
    [waiting, 'declared'],
    [done, 'blocked_pending'],
    [done, 'waiting_on_declared'],
    [blocked, 'nope'],
  ]) {
    const result = await run({ json, reasonCode });
    assert.equal(result.code, 2, `${reasonCode} for ${json.slice(0, 22)}`);
    assert.match(result.body.error, /reason_code/);
  }
  assert.equal((await run({ event: 'heartbeat', tokensIn: '5' })).code, 0, 'unknown token flags are not part of the contract');
  withDb(directory, (db) => {
    const reports = db.prepare(`SELECT payload_json FROM as_liveness_events WHERE kind IN ('report', 'wait_declared') ORDER BY id`).all();
    assert.deepEqual(
      reports.map((row) => JSON.parse(row.payload_json).reason_code),
      ['blocked_pending', 'waiting_on_declared', 'waiting_on_declared', 'declared'],
    );
    const heartbeat = db.prepare(`SELECT payload_json FROM as_liveness_events WHERE kind = 'heartbeat'`).get();
    assert.equal(heartbeat.payload_json, null);
  });
});

test('metrics keep declared waits apart from declared completions and from blocked runs', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    liveness.recordReport(db, { session: 's1', agent: 'waiting', value: waitLine(0, 3600), now: T0 });
    liveness.recordReport(db, { session: 's1', agent: 'finished', value: { state: 'DONE', reason: 'ok', evidence: 'e' }, now: T0 });
    liveness.recordReport(db, { session: 's1', agent: 'stuck', value: { state: 'BLOCKED', reason: 'real impediment' }, now: T0 });
    const metrics = liveness.checkRuns({ directory, config: CONFIG, now: T0 + 10 * S, io: NO_IO }).metrics;
    assert.deepEqual(metrics.runs_by_reason_code, { waiting_on_declared: 1, declared: 1, blocked_pending: 1 });
  });
});

test('max_wakes_per_cycle caps wake requests per cycle; the rest are deferred, oldest first', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    seedIdleRuns(db, 5);
    const config = { ...CONFIG, max_wakes_per_cycle: 2 };
    const first = liveness.runWatchCycle({ db, directory, config, now: T0 + 30 * S, io: NO_IO, notify: () => {} });
    assert.deepEqual(
      first.wake_requests.map((w) => w.agent),
      ['a0', 'a1'],
    );
    assert.equal(first.deferred.length, 3);
    assert.equal(first.runs.filter((run) => run.action === 'deferred').length, 3);
    const second = liveness.runWatchCycle({ db, directory, config, now: T0 + 40 * S, io: NO_IO, notify: () => {} });
    assert.deepEqual(
      second.wake_requests.map((w) => w.agent),
      ['a2', 'a3'],
      'a0 and a1 are in backoff',
    );
    assert.equal(contract.DEFAULTS.max_wakes_per_cycle, 3);
  });
});

test('the inbox is rebuilt from the ledger when its directory is lost, and check reads the ledger', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    emit(db, 'turn_end', 0);
    const woke = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 10 * S, io: NO_IO, notify: () => {} });
    const [original] = liveness.readInbox(directory);
    assert.equal(original.file, woke.wake_requests[0].file);
    fs.rmSync(liveness.inboxDir(directory), { recursive: true });
    const lost = liveness.checkRuns({ directory, config: CONFIG, now: T0 + 15 * S, io: NO_IO });
    assert.deepEqual(
      lost.wake_requests.map((w) => [w.file, w.attempt]),
      [[original.file, 1]],
      'check does not depend on the directory',
    );
    const cycle = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 20 * S, io: NO_IO, notify: () => {} });
    assert.deepEqual(cycle.rebuilt, [original.file]);
    assert.equal(cycle.wake_requests.length, 0, 'rebuilding is not a new wake');
    const [rebuilt] = liveness.readInbox(directory);
    assert.deepEqual({ ...rebuilt }, { ...original });
    assert.deepEqual(liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 21 * S, io: NO_IO, notify: () => {} }).rebuilt, []);
  });
});

test('state-ui snapshot carries the liveness classification next to the agent-state view', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    const dal = new AgentStateDAL(db);
    dal.createRun({ id: 'r1', workflow_id: 'dev-squad', project: 'proj' });
    dal.createRun({ id: 'r2', workflow_id: 'dev-squad', project: 'other' });
    for (const [id, status] of [
      ['t1', 'PENDING_EXECUTION'],
      ['t2', 'BLOCKED'],
      ['t3', 'OK'],
    ]) {
      dal.createTask({ id, run_id: 'r1', wave: 1 });
      db.prepare(`UPDATE as_tasks SET status = ? WHERE id = ?`).run(status, id);
    }
    const claim = (id, name, status) => {
      const taskId = `c${id}`;
      dal.createTask({ id: taskId, run_id: 'r1', wave: 2 });
      db.prepare(`UPDATE as_tasks SET status = 'PENDING_EXECUTION' WHERE id = ?`).run(taskId);
      const { agent_run_id: agentRunId } = dal.claimTask(taskId, name);
      db.prepare(`UPDATE as_agent_runs SET status = ?, last_heartbeat_at = datetime('now', '-60 minutes') WHERE id = ?`).run(
        status,
        agentRunId,
      );
    };
    for (const [index, status] of ['running', 'completed', 'aborted', 'killed', 'checkpointed'].entries())
      claim(index, `n${index}`, status);
    emit(db, 'turn_end', 0, null, { agent: 'idle' });
    liveness.recordReport(db, { session: 's1', agent: 'blk', value: { state: 'BLOCKED', reason: 'r' }, now: T0 });
    const snapshot = takeSnapshot(db, { livenessConfig: CONFIG, livenessIo: NO_IO, eventLimit: 5, now: T0 + 1000 * S });
    const row = snapshot.liveness.find((entry) => entry.agent === 'idle');
    assert.deepEqual(Object.keys(row).sort(), ['agent', 'class', 'idle_for_s', 'reason_code', 'session', 'wake_attempts']);
    assert.equal(row.class, 'stalled', 'the injected clock is long past stall_timeout_s');
    assert.equal(snapshot.liveness.find((entry) => entry.agent === 'blk').blocked_age_s > 0, true);
    assert.equal(snapshot.counts.pending, 1);
    assert.ok(snapshot.counts.aborted >= 3);
    assert.ok(snapshot.counts.orphaned >= 1);
    assert.equal(takeSnapshot(db, { run: 'r2' }).runs.length, 1);
    assert.equal(takeSnapshot(db, { project: 'proj' }).runs.length, 1);
    assert.equal(takeSnapshot(db).runs.length, 2);
    assert.deepEqual(
      liveness.snapshotLiveness(
        {
          prepare: () => {
            throw new Error('boom');
          },
        },
        CONFIG,
      ),
      [],
    );
  });
  const plain = tmpProject();
  withDb(plain, (db) => assert.deepEqual(takeSnapshot(db).liveness, []));
});

// ------------------------------------------------------------ review round 1 ----

const { execFileSync } = require('node:child_process');
const { takeMultiSnapshot } = require('../tools/state-ui-server/lib/snapshot-multi');

const NO_DB = { prepare: () => ({ get: () => {} }) };

function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-liveness-git-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const inHead = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b');
  git('add', '.');
  git('commit', '-q', '-m', 'side');
  const onSide = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  return { root, inHead, onSide };
}

test('evidence: a path must resolve inside the worktree and not be the worktree itself; a commit must be reachable from HEAD', () => {
  const repo = gitRepo();
  fs.mkdirSync(path.join(repo.root, 'sub'));
  fs.symlinkSync('/etc/passwd', path.join(repo.root, 'escape'));
  const check = (evidence) => liveness.verifyEvidence(evidence, { db: NO_DB, directory: repo.root }).verified;
  assert.equal(check('a.txt'), true);
  assert.equal(check('sub'), true);
  for (const outside of [
    '.',
    './',
    '/',
    '/etc/passwd',
    'escape',
    '../a.txt',
    'missing.txt',
    `${repo.root}/../${path.basename(repo.root)}`,
  ]) {
    assert.equal(check(outside), false, outside);
  }
  assert.equal(check(repo.root), false, 'the worktree itself is not evidence');
  assert.equal(check(path.join(repo.root, 'a.txt')), true, 'an absolute path inside the worktree is fine');
  assert.equal(check(repo.inHead.slice(0, 7)), true);
  assert.equal(check(repo.inHead), true);
  assert.equal(check(repo.onSide.slice(0, 7)), false, 'a commit outside HEAD ancestry');
  assert.equal(check('abc'), false, 'prefixes shorter than 7 are not commits');
  assert.equal(check('0123456789abcdef0123456789abcdef01234567'), false);
  const worktree = liveness.verifyEvidence(repo.inHead.slice(0, 7), { db: NO_DB, directory: os.tmpdir(), worktree: repo.root });
  assert.equal(worktree.verified, true, 'the run worktree is the base when given');
});

test('state-ui: snapshot uses the project config, stays ledger-only, and the central snapshot carries liveness per project', () => {
  const enabled = tmpProject({ enabled: true, extra: 'stall_timeout_s: 60\nheartbeat_ttl_s: 30\nwatch_interval_s: 10\n' });
  const disabled = tmpProject({ enabled: false });
  for (const directory of [enabled, disabled]) withDb(directory, (db) => emit(db, 'turn_end', 0));
  const probes = [];
  const spying = { readHead: (w) => probes.push(w), isPidAlive: () => true, statFile: () => ({ exists: false }) };

  const open = (directory, fn) => {
    const db = liveness.openLivenessDb(directory);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };
  const rows = open(enabled, (db) => takeSnapshot(db, { projectDirectory: enabled, now: T0 + 1000 * S }).liveness);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].class, 'stalled', 'stall_timeout_s=60 from the project config, not the 900 s default');
  assert.deepEqual(
    open(disabled, (db) => takeSnapshot(db, { projectDirectory: disabled, now: T0 + 1000 * S }).liveness),
    [],
  );
  assert.deepEqual(
    open(enabled, (db) => takeSnapshot(db).liveness),
    [],
    'no project directory and no override: defaults are disabled',
  );
  open(enabled, (db) => takeSnapshot(db, { projectDirectory: enabled, livenessIo: spying, now: T0 + 1000 * S }));
  assert.deepEqual(probes, [], 'a worktree without recorded truth is never probed');

  withDb(enabled, (db) => emit(db, 'heartbeat', 0, { truth: { worktree: '/wt/never-probed', head: 'a'.repeat(40) } }, { agent: 'probe' }));
  withDb(enabled, (db) => emit(db, 'turn_end', 1, null, { agent: 'probe' }));
  const noGit = open(enabled, (db) => takeSnapshot(db, { projectDirectory: enabled, now: T0 + 1000 * S }).liveness);
  assert.equal(noGit.find((row) => row.agent === 'probe').class, 'stalled', 'the default snapshot io never reconciles through git');

  const central = takeMultiSnapshot(
    {
      projects: [
        { id: 'on', path: enabled, label: 'on' },
        { id: 'off', path: disabled, label: 'off' },
      ],
    },
    { now: T0 + 1000 * S },
  );
  assert.ok(central.liveness.length > 0);
  assert.deepEqual([...new Set(central.liveness.map((row) => row.project_id))], ['on']);
});

test('schema: a diverging as_liveness_events fails closed', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    assert.doesNotThrow(() => liveness.assertLivenessSchema(db));
    db.exec('DROP INDEX idx_as_liveness_run');
    assert.throws(() => liveness.assertLivenessSchema(db), { code: 'LIVENESS_SCHEMA_DRIFT' });
    assert.throws(() => liveness.loadRuns(db, T0), { code: 'LIVENESS_SCHEMA_DRIFT' });
    db.exec('CREATE INDEX idx_as_liveness_run ON as_liveness_events(session, agent, id)');
    db.exec('ALTER TABLE as_liveness_events ADD COLUMN extra TEXT');
    assert.throws(() => liveness.assertLivenessSchema(db), { code: 'LIVENESS_SCHEMA_DRIFT' });
  });
  assert.throws(() => liveness.openLivenessDb(directory, { write: true }), { code: 'LIVENESS_SCHEMA_DRIFT' });
});

test('systemd: backslash, dollar, percent and quote are escaped', () => {
  const units = liveness.renderSystemdUnits({ directory: String.raw`/tmp/a$HOME b\ 50%` + '"q"', nodePath: '/n', cliPath: '/c' });
  assert.ok(units.service.includes(String.raw`WorkingDirectory=/tmp/a$HOME b\ 50%%"q"`), units.service);
  assert.ok(!/WorkingDirectory="/.test(units.service), 'systemd rejects a quoted WorkingDirectory');
  assert.ok(units.service.includes(String.raw`--directory "/tmp/a$$HOME b\\ 50%%\"q\""`));
});

test('watch: an unknown key that appears on a later cycle warns once and never stops the watch', async () => {
  const directory = tmpProject();
  const file = path.join(directory, '.hseos', 'config', 'agent-liveness.yaml');
  let clock = T0;
  const sleeps = [];
  const sleep = async (ms) => {
    sleeps.push(ms);
    clock += ms;
    // The key shows up after the first cycle and stays for the following ones.
    fs.writeFileSync(file, 'enabled: true\nlater_key: 1\n');
  };
  const warnings = [];
  const original = console.error;
  console.error = (line) => warnings.push(String(line));
  let result;
  try {
    result = await command._internal.run(
      'watch',
      { directory, maxCycles: 3 },
      { now: () => clock, sleep, notify: () => {}, reconcile: NO_IO },
    );
  } finally {
    console.error = original;
  }
  assert.equal(result.code, 0);
  assert.equal(result.body.cycles.length, 3);
  assert.equal(
    result.body.cycles.every((cycle) => cycle.enabled === true),
    true,
  );
  assert.equal(sleeps.length, 2);
  assert.deepEqual(warnings, ['[hseos liveness] warning: unknown key ignored: later_key']);
});

test('last-valid config is written by report and watch only', async () => {
  const written = (directory) => fs.existsSync(path.join(directory, '.hseos', 'state', 'liveness', 'last-valid-config.json'));
  const directory = tmpProject();
  let clock = T0;
  const io = { now: () => clock, sleep: async (ms) => (clock += ms), notify: () => {}, reconcile: NO_IO };
  await command._internal.run('check', { directory, json: true }, io);
  await command._internal.run('await', { directory, file: path.join(directory, 'x'), max: '1', pollMs: '1000' }, io);
  await command._internal.run('watch', { directory, printSystemd: true }, io);
  assert.equal(written(directory), false);
  assert.equal(contract.loadLivenessConfigWithFallback(directory).enabled, true);
  assert.equal(written(directory), false, 'loading without remember never writes');
  await command._internal.run('watch', { directory, once: true }, io);
  assert.equal(written(directory), true);
  const reported = tmpProject();
  await command._internal.run('report', { directory: reported, session: 's1', agent: 'a1', json: '{"state":"BLOCKED","reason":"r"}' }, io);
  assert.equal(written(reported), true);
});

test('watch: reconciliation I/O runs before the write transaction, never under the lock', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    liveness.recordEvent(db, {
      session: 's1',
      agent: 'a1',
      kind: 'heartbeat',
      payload: { truth: { worktree: '/wt/x', head: 'a'.repeat(40), pid: 7 } },
      now: T0,
    });
    emit(db, 'turn_end', 1);
    const inTransaction = [];
    const io = {
      ...NO_IO,
      readHead: () => inTransaction.push(db.inTransaction) && 'a'.repeat(40),
      isPidAlive: () => inTransaction.push(db.inTransaction) && true,
    };
    const result = liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + 30 * S, io, notify: () => {} });
    assert.equal(result.wake_requests.length, 1);
    assert.ok(inTransaction.length >= 2);
    assert.deepEqual([...new Set(inTransaction)], [0].map(Boolean), 'no subprocess-like I/O while the IMMEDIATE transaction is open');
  });
});

test('central snapshot: merges healthy projects, reports missing and broken ones, honors the project filter', () => {
  const healthy = tmpProject();
  withDb(healthy, (db) => {
    const dal = new AgentStateDAL(db);
    dal.createRun({ id: 'r1', workflow_id: 'dev-squad', project: 'p' });
    dal.attachRunToSession({ run_id: 'r1', session_id: 's1', base_branch: 'main' });
    dal.createTask({ id: 't1', run_id: 'r1', wave: 1, branch: 'task/x' });
    db.prepare(`UPDATE as_tasks SET status = 'PENDING_EXECUTION' WHERE id = 't1'`).run();
    const { agent_run_id: agentRunId } = dal.claimTask('t1', 'a1');
    db.prepare(`UPDATE as_agent_runs SET last_heartbeat_at = datetime('now', '-60 minutes') WHERE id = ?`).run(agentRunId);
    dal.recordHeartbeat(agentRunId);
    db.prepare(`UPDATE as_agent_runs SET last_heartbeat_at = datetime('now', '-60 minutes') WHERE id = ?`).run(agentRunId);
  });
  const missing = tmpProject();
  const broken = tmpProject();
  fs.mkdirSync(path.join(broken, '.hseos', 'state'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.hseos', 'state', 'project.db'), 'this is not a sqlite database'.repeat(20));
  const registry = {
    projects: [
      { id: 'ok', path: healthy, label: 'Healthy', color: '#fff' },
      { id: 'gone', path: missing },
      { id: 'bad', path: broken },
    ],
  };
  const all = takeMultiSnapshot(registry);
  assert.deepEqual(Object.fromEntries(all.projects_meta.map((meta) => [meta.id, meta.db_status])), {
    ok: 'ok',
    gone: 'missing',
    bad: 'error',
  });
  assert.ok(all.projects_meta.find((meta) => meta.id === 'bad').error);
  assert.deepEqual(all.branches, ['main', 'task/x']);
  assert.equal(all.runs[0].project_id, 'ok');
  assert.equal(all.orphans[0].project_id, 'ok');
  assert.equal(all.counts.orphaned, 1);
  assert.deepEqual(all.counts_by_project.gone, all.counts_by_project.bad);
  assert.deepEqual(all.liveness, []);

  const filtered = takeMultiSnapshot(registry, { project: 'gone', eventLimit: 5, staleMinutes: 'x' });
  assert.deepEqual(
    filtered.projects_meta.map((meta) => meta.db_status),
    ['filtered', 'missing', 'filtered'],
  );
  assert.equal(filtered.stale_minutes, 10);
  assert.deepEqual(takeMultiSnapshot().projects, []);
});

test('central snapshot: an unopenable database and a missing sqlite driver degrade to a status, never to an exception', () => {
  const unopenable = tmpProject();
  fs.mkdirSync(path.join(unopenable, '.hseos', 'state', 'project.db'), { recursive: true });
  const registry = { projects: [{ id: 'dir', path: unopenable }] };
  assert.equal(takeMultiSnapshot(registry).projects_meta[0].db_status, 'error');

  const Module = require('node:module');
  const modulePath = require.resolve('../tools/state-ui-server/lib/snapshot-multi');
  const original = Module._load;
  delete require.cache[modulePath];
  Module._load = function (request, parent, ...rest) {
    if (request === 'better-sqlite3' && parent?.filename === modulePath) throw new Error('driver not installed');
    return Reflect.apply(original, this, [request, parent, ...rest]);
  };
  let withoutDriver;
  try {
    withoutDriver = require('../tools/state-ui-server/lib/snapshot-multi');
  } finally {
    Module._load = original;
    delete require.cache[modulePath];
  }
  const healthy = tmpProject();
  withDb(healthy, () => {});
  const result = withoutDriver.takeMultiSnapshot({ projects: [{ id: 'x', path: healthy }] });
  assert.equal(result.projects_meta[0].db_status, 'no-driver');
});

// ------------------------------------------------------------ review round 2 ----

const childProcess = require('node:child_process');

function spyOnProcesses() {
  const calls = [];
  const original = { execFileSync: childProcess.execFileSync, spawnSync: childProcess.spawnSync };
  childProcess.execFileSync = (...args) => {
    calls.push(['execFileSync', args[0], args[1]]);
    throw new Error('spawn blocked by test');
  };
  childProcess.spawnSync = (...args) => {
    calls.push(['spawnSync', args[0], args[1]]);
    return { status: 1 };
  };
  return {
    calls,
    restore() {
      Object.assign(childProcess, original);
    },
  };
}

test('escalations are durable: queued with the decision, delivered after the commit, redelivered after a simulated crash', () => {
  const directory = tmpProject();
  const notified = [];
  withDb(directory, (db) => {
    emit(db, 'turn_end', 0);
    const cycle = (atS) =>
      liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + atS * S, io: NO_IO, notify: (n) => notified.push(n) });
    const outbox = () => db.prepare(`SELECT id, kind, delivered_at FROM as_liveness_outbox ORDER BY id`).all();
    const jsonl = path.join(directory, '.hseos', 'state', 'liveness', 'escalations.jsonl');
    cycle(10);
    cycle(70);
    cycle(190);

    // Crash between the commit and the delivery: the line cannot be appended.
    const realAppend = fs.appendFileSync;
    fs.appendFileSync = () => {
      throw new Error('simulated crash before delivery');
    };
    let crashed;
    try {
      crashed = cycle(430);
    } finally {
      fs.appendFileSync = realAppend;
    }
    assert.equal(crashed.escalations.length, 1, 'the decision committed');
    assert.equal(crashed.delivered, 0);
    assert.deepEqual(
      outbox().map((row) => [row.kind, row.delivered_at]),
      [['escalation', null]],
    );
    assert.equal(fs.existsSync(jsonl), false);
    assert.equal(notified.length, 0);

    // The next cycle redelivers, without deciding again.
    const next = cycle(500);
    assert.deepEqual([next.escalations.length, next.delivered], [0, 1]);
    assert.equal(notified.length, 1);
    assert.equal(fs.readFileSync(jsonl, 'utf8').trim().split('\n').length, 1);
    assert.equal(JSON.parse(fs.readFileSync(jsonl, 'utf8')).outbox_id, outbox()[0].id);
    assert.notEqual(outbox()[0].delivered_at, null);
    assert.equal(cycle(510).delivered, 0, 'delivered rows are not delivered again');
  });
});

test('outbox delivery is idempotent: a line already written is not duplicated, a failing notifier is retried', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    liveness.recordReport(db, { session: 's1', agent: 'a1', value: { state: 'BLOCKED', reason: 'real impediment' }, now: T0 });
    let failures = 1;
    const notified = [];
    const notify = (n) => {
      if (failures-- > 0) throw new Error('notifier down');
      notified.push(n);
    };
    const cycle = (atS) => liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + atS * S, io: NO_IO, notify });
    const first = cycle(10);
    assert.deepEqual([first.notifications.length, first.delivered], [1, 0], 'the notifier failed, so the row stays pending');
    const second = cycle(100);
    assert.deepEqual([second.notifications.length, second.delivered], [0, 1], 'redelivered without deciding again');
    assert.equal(cycle(110).delivered, 0);
    const jsonl = path.join(directory, '.hseos', 'state', 'liveness', 'escalations.jsonl');
    assert.equal(fs.readFileSync(jsonl, 'utf8').trim().split('\n').length, 1, 'the line is written once even though delivery was retried');
    assert.equal(notified.length, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_outbox WHERE delivered_at IS NULL`).get().n, 0);
  });
});

test('the HTTP/kanban snapshot path never spawns git, while the watchdog does', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    liveness.recordEvent(db, {
      session: 's1',
      agent: 'a1',
      kind: 'heartbeat',
      payload: { truth: { worktree: '/wt/spied', head: 'a'.repeat(40) } },
      now: T0,
    });
    emit(db, 'turn_end', 1);
  });
  const spy = spyOnProcesses();
  try {
    const db = liveness.openLivenessDb(directory);
    try {
      const rows = takeSnapshot(db, { projectDirectory: directory, now: T0 + 1000 * S }).liveness;
      assert.equal(rows[0].class, 'stalled');
      takeMultiSnapshot({ projects: [{ id: 'p', path: directory }] }, { now: T0 + 1000 * S });
    } finally {
      db.close();
    }
    assert.deepEqual(spy.calls, [], 'no git, no notify-send on the read path');
    const watched = liveness.openLivenessDb(directory);
    try {
      liveness.evaluateRuns(watched, CONFIG, T0 + 1000 * S);
    } finally {
      watched.close();
    }
    assert.equal(spy.calls.length, 1, 'the control: the same run does reach git through the default io');
    assert.deepEqual(spy.calls[0].slice(0, 2), ['execFileSync', 'git']);
  } finally {
    spy.restore();
  }
});

test('state-ui takes the project directory from its configuration, never from the db path layout', () => {
  const { parseArgs } = require('../tools/state-ui-server');
  const originalArgv = process.argv;
  try {
    process.argv = [...originalArgv.slice(0, 2), '--db=/custom/place/state.sqlite', '--project-dir=/work/project'];
    assert.equal(parseArgs().projectDirectory, '/work/project');
    process.argv = [...originalArgv.slice(0, 2), '--db=/custom/place/state.sqlite'];
    assert.equal(parseArgs().projectDirectory, null, 'no guess from the db path');
  } finally {
    process.argv = originalArgv;
  }
  assert.match(
    fs.readFileSync(path.join(__dirname, '..', 'tools', 'cli', 'commands', 'state-ui.js'), 'utf8'),
    /--project-dir=\$\{directory\}/,
  );
});

test('central snapshot: partial snapshots and a failing db.close degrade quietly', () => {
  const Module = require('node:module');
  const modulePath = require.resolve('../tools/state-ui-server/lib/snapshot-multi');
  const original = Module._load;
  delete require.cache[modulePath];
  const healthy = tmpProject();
  withDb(healthy, () => {});
  Module._load = function (request, parent, ...rest) {
    if (parent?.filename === modulePath && request === 'better-sqlite3') {
      return class {
        close() {
          throw new Error('close failed');
        }
      };
    }
    if (parent?.filename === modulePath && request === './snapshot') {
      return { takeSnapshot: () => ({}) };
    }
    return Reflect.apply(original, this, [request, parent, ...rest]);
  };
  let fake;
  try {
    fake = require('../tools/state-ui-server/lib/snapshot-multi');
  } finally {
    Module._load = original;
    delete require.cache[modulePath];
  }
  const result = fake.takeMultiSnapshot({ projects: [{ id: 'bare', path: healthy }] });
  assert.equal(result.projects_meta[0].db_status, 'ok');
  assert.deepEqual([result.runs, result.liveness, result.orphans, result.branches], [[], [], [], []]);
  assert.deepEqual(result.counts_by_project.bare, { pending: 0, running: 0, completed: 0, aborted: 0, orphaned: 0 });
});

test('config: max_wait_deadline_s is part of the contract', () => {
  assert.equal(contract.DEFAULTS.max_wait_deadline_s, 14_400);
  assert.equal(contract.loadLivenessConfig(exampleProject()).config.max_wait_deadline_s, 14_400);
  for (const document of [
    { max_wait_deadline_s: 30 },
    { max_wait_deadline_s: 700_000 },
    { max_wait_deadline_s: 600, stall_timeout_s: 900 },
  ]) {
    assert.equal(contract.validateLivenessConfig(document).ok, false, JSON.stringify(document));
  }
  assert.equal(contract.validateLivenessConfig({ max_wait_deadline_s: 900 }).ok, true);
});

// ------------------------------------------------------------ review round 3 ----

const SPAWN_ENOENT = Object.assign(new Error('spawnSync notify-send ENOENT'), { code: 'ENOENT' });

function queueOutbox(db, count, { createdAt = new Date(T0).toISOString() } = {}) {
  const insert = db.prepare(`INSERT INTO as_liveness_outbox (kind, session, agent, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`);
  for (let index = 0; index < count; index += 1) {
    const entry = { session: 's1', agent: `a${index}`, state: 'stalled', cause: 'wake_exhausted', detail: 'queued' };
    insert.run('escalation', 's1', `a${index}`, JSON.stringify({ entry, title: `t${index}`, body: 'b' }), createdAt);
  }
}

function stubSpawn(result) {
  const original = childProcess.spawnSync;
  childProcess.spawnSync = () => result;
  return () => {
    childProcess.spawnSync = original;
  };
}

test('notifications are at-least-once: a missing or failing notify-send keeps the row pending, success delivers it', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    queueOutbox(db, 1);
    const attempt = (atS) => liveness.deliverOutbox(db, directory, liveness.defaultNotify, { now: T0 + atS * S, config: CONFIG });
    const row = () => db.prepare(`SELECT attempts, delivered_at, gave_up_at, last_error, next_attempt_at FROM as_liveness_outbox`).get();

    let restore = stubSpawn({ error: SPAWN_ENOENT, status: null });
    try {
      assert.equal(attempt(0), 0);
    } finally {
      restore();
    }
    assert.deepEqual([row().attempts, row().delivered_at, row().gave_up_at], [1, null, null]);
    assert.match(row().last_error, /ENOENT/);
    assert.equal(row().next_attempt_at, new Date(T0 + 60 * S).toISOString(), 'exponential backoff starts at 60 s');

    restore = stubSpawn({ status: 1 });
    try {
      assert.equal(attempt(30), 0, 'not due yet: no call is made');
      assert.equal(row().attempts, 1);
      assert.equal(attempt(60), 0);
    } finally {
      restore();
    }
    assert.match(row().last_error, /status 1/);
    assert.equal(row().next_attempt_at, new Date(T0 + (60 + 120) * S).toISOString());

    restore = stubSpawn({ status: 0 });
    try {
      assert.equal(attempt(180), 1);
    } finally {
      restore();
    }
    assert.notEqual(row().delivered_at, null);
    assert.equal(row().last_error, null);
  });
});

test('a permanently failing notifier gives up after max_notify_attempts; escalations.jsonl stays the durable record', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    queueOutbox(db, 1);
    let calls = 0;
    const notify = () => {
      calls += 1;
      throw new Error('notifier down');
    };
    const config = { ...CONFIG, max_notify_attempts: 3 };
    let at = 0;
    for (let round = 0; round < 6; round += 1) {
      liveness.deliverOutbox(db, directory, notify, { now: T0 + at * S, config });
      at += 4000;
    }
    assert.equal(calls, 3, 'no attempt after the ceiling');
    const row = db.prepare(`SELECT attempts, delivered_at, gave_up_at FROM as_liveness_outbox`).get();
    assert.deepEqual([row.attempts, row.delivered_at === null, row.gave_up_at !== null], [3, true, true]);
    const jsonl = path.join(directory, '.hseos', 'state', 'liveness', 'escalations.jsonl');
    assert.equal(fs.readFileSync(jsonl, 'utf8').trim().split('\n').length, 1, 'the durable line exists exactly once');
    const status = liveness.checkRuns({ directory, config, now: T0 + at * S, io: NO_IO });
    assert.deepEqual(status.outbox, { pending: 0, gave_up: 1 });
    assert.match(
      command._internal.formatCheck({ ...status, runs: [{ state: 'running', session: 's', agent: 'a', last_event_at: 'x', detail: '' }] }),
      /0 pending, 1 gave up/,
    );
  });
});

test('the outbox prunes delivered and given-up rows after 7 days and nothing else', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    queueOutbox(db, 4);
    const old = new Date(T0 - 8 * 86_400 * S).toISOString();
    const recent = new Date(T0 - 1 * 86_400 * S).toISOString();
    const set = db.prepare(`UPDATE as_liveness_outbox SET delivered_at = ?, gave_up_at = ? WHERE id = ?`);
    set.run(old, null, 1); // delivered long ago
    set.run(null, old, 2); // gave up long ago
    set.run(recent, null, 3); // delivered recently
    // id 4 stays pending and old, but its retry is not due yet.
    db.prepare(`UPDATE as_liveness_outbox SET created_at = ?, next_attempt_at = ? WHERE id = 4`).run(
      old,
      new Date(T0 + 99 * 86_400 * S).toISOString(),
    );
    liveness.deliverOutbox(db, directory, () => assert.fail('nothing is due'), { now: T0, config: CONFIG });
    const left = db
      .prepare(`SELECT id FROM as_liveness_outbox ORDER BY id`)
      .all()
      .map((row) => row.id);
    assert.deepEqual(left, [3, 4], 'only the delivered and given-up rows older than 7 days are pruned');
  });
});

test('delivery work per cycle is bounded: 200 pending rows are handled in batches within the time budget', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    queueOutbox(db, 200);
    const started = Date.now();
    const first = liveness.deliverOutbox(db, directory, () => {}, { now: T0, config: CONFIG });
    assert.equal(first, 10);
    assert.ok(Date.now() - started < (CONFIG.watch_interval_s * 1000) / 2, 'well inside the watch interval');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_outbox WHERE delivered_at IS NULL`).get().n, 190);
    for (let cycle = 0; cycle < 19; cycle += 1) liveness.deliverOutbox(db, directory, () => {}, { now: T0, config: CONFIG });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_outbox WHERE delivered_at IS NULL`).get().n,
      0,
      'the backlog drains over cycles',
    );

    queueOutbox(db, 5);
    // A one-second interval gives a 500 ms budget; a 200 ms notifier needs 1 s for five rows, so the budget must cut it
    // short, and the first row always starts well inside the budget. Neither bound depends on a clock tick.
    const slow = liveness.deliverOutbox(db, directory, () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200), {
      now: T0,
      config: { ...CONFIG, watch_interval_s: 1 },
    });
    assert.ok(slow >= 1 && slow < 5, `the time budget stops a slow notifier early (delivered ${slow})`);
  });
});

test('schema: columns, NOT NULL, primary keys and indexes are all verified; a lost table fails closed instead of being recreated', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    assert.doesNotThrow(() => liveness.assertLivenessSchema(db));
    db.exec('DROP INDEX idx_as_liveness_outbox_pending');
    assert.throws(() => liveness.assertLivenessSchema(db), { code: 'LIVENESS_SCHEMA_DRIFT' });
    db.exec('CREATE INDEX idx_as_liveness_outbox_pending ON as_liveness_outbox(delivered_at, gave_up_at, id)');
    db.exec('CREATE INDEX idx_rogue ON as_liveness_events(kind)');
    assert.throws(() => liveness.assertLivenessSchema(db), { code: 'LIVENESS_SCHEMA_DRIFT' });
    db.exec('DROP INDEX idx_rogue');
    assert.doesNotThrow(() => liveness.assertLivenessSchema(db));

    // Same names and types but a dropped NOT NULL: still drift.
    db.exec('DROP TABLE as_liveness_outbox');
    db.exec(`CREATE TABLE as_liveness_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, session TEXT NOT NULL, agent TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL, delivered_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, gave_up_at TEXT, last_error TEXT)`);
    db.exec('CREATE INDEX idx_as_liveness_outbox_pending ON as_liveness_outbox(delivered_at, gave_up_at, id)');
    assert.throws(() => liveness.assertLivenessSchema(db), { code: 'LIVENESS_SCHEMA_DRIFT' });
    db.exec('DROP TABLE as_liveness_outbox');
    assert.throws(() => liveness.assertLivenessSchema(db), /as_liveness_outbox is missing while the schema marker exists/);
    assert.throws(() => liveness.ensureLivenessSchema(db), { code: 'LIVENESS_SCHEMA_DRIFT' });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'as_liveness_outbox'`).get().n,
      0,
      'not silently recreated empty',
    );
    assert.throws(() => liveness.loadRuns(db, T0), { code: 'LIVENESS_SCHEMA_DRIFT' });
  });
  assert.throws(() => liveness.openLivenessDb(directory, { write: true }), { code: 'LIVENESS_SCHEMA_DRIFT' });
});

test('schema: a ledger that never carried the marker is upgraded in place, keeping its rows', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    db.exec('DROP TABLE as_liveness_meta');
    db.exec('DROP TABLE as_liveness_outbox');
    db.exec(`CREATE TABLE as_liveness_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, session TEXT NOT NULL, agent TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT)`);
    db.exec(`INSERT INTO as_liveness_outbox (kind, session, agent, payload_json, created_at) VALUES ('escalation', 's', 'a', '{}', 'x')`);
    emit(db, 'turn_end', 0);
  });
  withDb(directory, (db) => {
    assert.doesNotThrow(() => liveness.assertLivenessSchema(db));
    assert.equal(db.prepare(`SELECT attempts FROM as_liveness_outbox`).get().attempts, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_events`).get().n, 1);
    assert.equal(db.prepare(`SELECT value FROM as_liveness_meta WHERE key = 'schema'`).get().value, '1');
  });
  // A read-only ledger with only the events table (no outbox, no marker) is accepted.
  const bare = tmpProject();
  withDb(bare, (db) => {
    db.exec('DROP TABLE as_liveness_meta');
    db.exec('DROP TABLE as_liveness_outbox');
    assert.doesNotThrow(() => liveness.assertLivenessSchema(db));
    assert.deepEqual(liveness.outboxStats(db), { pending: 0, gave_up: 0 });
    assert.deepEqual(liveness.loadRuns(db, T0), []);
  });
});

// The line shape below is what the LV1 stop guard (commit 3a0a5ae6, liveness-guard.cjs) parks in
// pending-reports.jsonl when `hseos liveness report` is unavailable: {at, session, agent, reason_code, line}.
// The BLOCKED record was produced by running that guard; the other two follow the same code path.
function guardRecord({ at, session = 'sess 1/x', agent = 'agent:7', reasonCode, line }) {
  return JSON.stringify({ at: new Date(at).toISOString(), session, agent, reason_code: reasonCode, line });
}

test('watch drains the LV1 guard pending-reports.jsonl idempotently and keeps invalid lines', () => {
  const directory = tmpProject();
  const dir = path.join(directory, '.hseos', 'state', 'liveness');
  fs.mkdirSync(dir, { recursive: true });
  const parked = path.join(dir, 'pending-reports.jsonl');
  const realBlocked = String.raw`{"at":"2026-10-12T22:46:15.004Z","session":"sess 1/x","agent":"agent:7","reason_code":"blocked_pending","line":"LIVENESS: {\"state\":\"BLOCKED\",\"reason\":\"needs a key\",\"evidence\":\"none\"}"}`;
  const lines = [
    realBlocked,
    guardRecord({
      at: T0,
      agent: 'agent:8',
      reasonCode: 'declared',
      line: 'LIVENESS: {"state":"DONE","reason":"all green","evidence":"abc1234"}',
    }),
    guardRecord({
      at: T0,
      agent: 'agent:9',
      reasonCode: 'waiting_on_declared',
      line: `LIVENESS: {"state":"WAITING_ON","reason":"review","waiting_on":{"condition":"verdict","wake_via":"commander","deadline_at":"${new Date(T0 + 7200 * S).toISOString()}"}}`,
    }),
    guardRecord({
      at: T0,
      agent: 'agent:10',
      reasonCode: 'declared',
      line: 'LIVENESS: {"state":"BLOCKED","reason":"incoherent code","evidence":"x"}',
    }),
    guardRecord({ at: T0, agent: 'agent:11', reasonCode: 'declared', line: 'not a liveness line' }),
    '{this is not json',
    JSON.stringify({
      at: new Date(T0).toISOString(),
      session: 's',
      agent: '..',
      reason_code: 'declared',
      line: 'LIVENESS: {"state":"FAILED","reason":"r"}',
    }),
    '',
  ];
  fs.writeFileSync(parked, `${lines.join('\n')}\n`);
  withDb(directory, (db) => {
    const cycle = (atS) => liveness.runWatchCycle({ db, directory, config: CONFIG, now: T0 + atS * S, io: NO_IO, notify: () => {} });
    const first = cycle(10_000);
    assert.deepEqual([first.pending_reports.consumed, first.pending_reports.duplicates, first.pending_reports.invalid], [3, 0, 4]);
    assert.equal(first.pending_reports.warnings.length, 4);
    assert.match(first.pending_reports.warnings.join('\n'), /incoherent|not a safe id|not JSON|LIVENESS|reason_code/);
    assert.equal(fs.existsSync(parked), false, 'the parked file is consumed');
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.startsWith('pending-reports.draining-')),
      [],
    );
    const invalid = fs.readFileSync(path.join(dir, 'pending-reports.invalid.jsonl'), 'utf8').trim().split('\n');
    assert.equal(invalid.length, 4, 'invalid lines are preserved verbatim');
    assert.ok(invalid.includes('{this is not json'));

    const reports = db.prepare(`SELECT session, agent, payload_json FROM as_liveness_events WHERE kind = 'report' ORDER BY id`).all();
    assert.deepEqual(
      reports.map((row) => [row.session, row.agent]),
      [
        ['sess_1_x', 'agent_7'],
        ['sess_1_x', 'agent_8'],
        ['sess_1_x', 'agent_9'],
      ],
    );
    assert.deepEqual(
      reports.map((row) => JSON.parse(row.payload_json).reason_code),
      ['blocked_pending', 'declared', 'waiting_on_declared'],
    );
    assert.ok(reports.every((row) => JSON.parse(row.payload_json).source_key?.length === 64));
    const waiting = db.prepare(`SELECT ts FROM as_liveness_events WHERE kind = 'wait_declared'`).get();
    assert.equal(
      waiting.ts,
      new Date(T0).toISOString(),
      'recorded as of the line timestamp, so a deadline that has passed still validates',
    );

    // The guard parks the same lines again (retry) and a crash leaves a draining file behind: nothing duplicates.
    fs.writeFileSync(parked, `${lines.slice(0, 3).join('\n')}\n`);
    fs.writeFileSync(path.join(dir, 'pending-reports.draining-999-1'), `${lines[1]}\n`);
    const second = cycle(10_100);
    assert.deepEqual([second.pending_reports.consumed, second.pending_reports.duplicates, second.pending_reports.invalid], [0, 4, 0]);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM as_liveness_events WHERE kind = 'report'`).get().n, 3);
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.startsWith('pending-reports.draining-')),
      [],
    );
    assert.equal(cycle(10_200).pending_reports.consumed, 0);
  });
});

test('draining is a no-op without a liveness directory and survives a corrupt payload in the ledger', () => {
  const directory = tmpProject();
  withDb(directory, (db) => {
    assert.deepEqual(liveness.drainPendingReports({ db, directory, config: CONFIG, now: T0 }), {
      consumed: 0,
      duplicates: 0,
      invalid: 0,
      warnings: [],
    });
    emit(db, 'turn_end', 0, null, { agent: 'other' });
    db.prepare(`UPDATE as_liveness_events SET payload_json = '{bad' WHERE kind = 'turn_end'`).run();
    db.prepare(`UPDATE as_liveness_events SET kind = 'report' WHERE kind = 'turn_end'`).run();
    const dir = path.join(directory, '.hseos', 'state', 'liveness');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pending-reports.jsonl'),
      `${guardRecord({ at: T0, reasonCode: 'declared', line: 'LIVENESS: {"state":"FAILED","reason":"r"}' })}\n`,
    );
    assert.equal(liveness.drainPendingReports({ db, directory, config: CONFIG, now: T0 }).consumed, 1);
  });
});
