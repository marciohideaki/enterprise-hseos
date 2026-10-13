/**
 * `hseos liveness <action>` — agent liveness ("no silent idle").
 *
 *   report  validate and record a LIVENESS line (or a turn_end / heartbeat event)
 *   check   classify the recent runs and list pending wake requests (read-only)
 *   watch   one watchdog cycle (--once) or a loop; writes wake requests and escalations
 *   await   foreground wait on --pid | --file | --cmd-status, capped at foreground_wait_max_s
 *
 * With no `.hseos/config/agent-liveness.yaml`, or `enabled: false`, report/check/watch do
 * nothing and exit 0 (current behavior is unchanged). `await` is a pure helper and always works.
 */

const path = require('node:path');

const EXIT_USAGE = 2;
const EXIT_STILL_RUNNING = 75;
const EVENT_ACTIONS = ['report', 'turn_end', 'heartbeat'];
const AWAIT_HEARTBEAT_EVERY_S = 60;

class UsageError extends Error {}

function requireOption(options, name) {
  if (typeof options[name] !== 'string' || options[name] === '') throw new UsageError(`--${name} is required`);
  return options[name];
}

function toInteger(label, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new UsageError(`${label} must be a positive integer`);
  return parsed;
}

function buildTruth(options, io) {
  const truth = {};
  if (options.pid !== undefined) truth.pid = toInteger('--pid', options.pid);
  if (options.statusFile !== undefined) {
    if (!path.isAbsolute(options.statusFile)) throw new UsageError('--status-file must be an absolute path');
    truth.status_file = options.statusFile;
  }
  if (options.worktree !== undefined) {
    if (!path.isAbsolute(options.worktree)) throw new UsageError('--worktree must be an absolute path');
    truth.worktree = options.worktree;
    const head = io.readHead(options.worktree);
    if (head) truth.head = head;
  }
  return Object.keys(truth).length > 0 ? truth : null;
}

function loadContract(directory, remember = false) {
  const { loadLivenessConfigWithFallback } = require('../../lib/agent-liveness-contract');
  return loadLivenessConfigWithFallback(directory, { remember });
}

function disabledResult(loaded) {
  if (!loaded.valid) return { code: EXIT_USAGE, body: { enabled: false, valid: false, errors: loaded.errors } };
  return { code: 0, body: { enabled: false, recorded: false, message: 'liveness contract absent or disabled; nothing to do' } };
}

function doReport(options, directory, loaded, io) {
  const { parseLivenessLine } = require('../../lib/agent-liveness-contract');
  const liveness = require('../../lib/agent-liveness');
  const session = requireOption(options, 'session');
  const agent = requireOption(options, 'agent');
  liveness.assertSafeId('session', session);
  liveness.assertSafeId('agent', agent);
  const event = options.event ?? 'report';
  if (!EVENT_ACTIONS.includes(event)) throw new UsageError(`--event must be one of ${EVENT_ACTIONS.join(', ')}`);
  const truth = buildTruth(options, io);
  const now = io.now();
  const reasonCode = options.reasonCode;

  let parsed = null;
  if (event === 'report') {
    if (typeof options.json !== 'string') throw new UsageError('--json <LIVENESS line> is required for report');
    parsed = parseLivenessLine(options.json, {
      now,
      stallTimeoutS: loaded.config.stall_timeout_s,
      maxWaitDeadlineS: loaded.config.max_wait_deadline_s,
    });
    if (!parsed.ok) return { code: EXIT_USAGE, body: { enabled: true, recorded: false, errors: parsed.errors } };
  }

  const db = liveness.openLivenessDb(directory, { write: true });
  try {
    if (event === 'report') {
      const verification = liveness.verifyEvidence(parsed.value.evidence, { db, directory, worktree: options.worktree, io: io.reconcile });
      const extra = { evidence_verified: verification.verified, evidence_checks: verification.checks };
      const alerts = verification.verified === false ? [{ reason_code: 'evidence_unverified' }] : [];
      if (alerts.length > 0) extra.alerts = alerts.map((alert) => alert.reason_code);
      const recorded = liveness.recordReport(db, { session, agent, value: parsed.value, truth, extra, reasonCode, now });
      const body = {
        enabled: true,
        recorded: true,
        event,
        state: parsed.value.state,
        evidence_verified: verification.verified,
        event_ids: recorded.ids,
        ts: recorded.ts,
      };
      if (alerts.length > 0) body.alerts = alerts;
      return { code: 0, body };
    }
    const payload = truth ? { truth } : null;
    const recorded = liveness.recordEvent(db, { session, agent, kind: event, payload, now });
    return { code: 0, body: { enabled: true, recorded: true, event, event_ids: [recorded.id], ts: recorded.ts } };
  } finally {
    db.close();
  }
}

async function doWatch(options, directory, loaded, io) {
  const liveness = require('../../lib/agent-liveness');
  if (options.printSystemd) {
    const cliPath = path.resolve(__dirname, '..', 'hseos-cli.js');
    const units = liveness.renderSystemdUnits({
      directory,
      nodePath: process.execPath,
      cliPath,
      intervalS: loaded.config.watch_interval_s,
    });
    return {
      code: 0,
      text: `# --- hseos-liveness-watch.service ---\n${units.service}\n# --- hseos-liveness-watch.timer ---\n${units.timer}`,
    };
  }
  if (!loaded.valid || !loaded.enabled) return disabledResult(loaded);
  const maxCycles = options.maxCycles === undefined ? Infinity : toInteger('--max-cycles', options.maxCycles);
  const cycles = await liveness.runWatch({
    directory,
    loadConfig: (dir) => loadContract(dir, true),
    once: options.once === true,
    maxCycles,
    sleep: io.sleep,
    now: io.now,
    io: io.reconcile,
    notify: io.notify,
    shouldStop: io.shouldStop,
  });
  return { code: 0, body: options.once === true ? cycles[0] : { cycles } };
}

async function doAwait(options, directory, loaded, io) {
  const liveness = require('../../lib/agent-liveness');
  const heartbeatReady = loaded.valid && loaded.enabled && options.session && options.agent;
  let db = null;
  if (heartbeatReady) {
    liveness.assertSafeId('session', options.session);
    liveness.assertSafeId('agent', options.agent);
    db = liveness.openLivenessDb(directory, { write: true });
  }
  try {
    const outcome = await liveness.awaitCondition({
      pid: options.pid === undefined ? undefined : toInteger('--pid', options.pid),
      file: options.file,
      cmdStatus: options.cmdStatus,
      maxS: options.max === undefined ? undefined : Number(options.max),
      foregroundMaxS: loaded.config.foreground_wait_max_s,
      pollMs: options.pollMs === undefined ? 1000 : toInteger('--poll-ms', options.pollMs),
      now: io.now,
      sleep: io.sleep,
      isPidAlive: io.reconcile?.isPidAlive,
      tickEveryS: db ? AWAIT_HEARTBEAT_EVERY_S : 0,
      onTick: db
        ? () =>
            liveness.recordEvent(db, {
              session: options.session,
              agent: options.agent,
              kind: 'heartbeat',
              payload: { source: 'await' },
              now: io.now(),
            })
        : undefined,
    });
    return { code: outcome.status === 'done' ? 0 : EXIT_STILL_RUNNING, body: outcome };
  } finally {
    if (db) db.close();
  }
}

function formatCheck(body) {
  if (body.runs.length === 0) return '(no liveness runs)';
  const lines = body.runs.map((run) => `${run.state.padEnd(16)} ${run.session}/${run.agent}  last=${run.last_event_at}  ${run.detail}`);
  if (body.wake_requests.length > 0) lines.push(`${body.wake_requests.length} pending wake request(s)`);
  if (body.outbox.pending > 0 || body.outbox.gave_up > 0) {
    lines.push(`notifications: ${body.outbox.pending} pending, ${body.outbox.gave_up} gave up (see escalations.jsonl)`);
  }
  return lines.join('\n');
}

/**
 * Pure entry point (no process side effects) used by the CLI action and by tests.
 * @returns {Promise<{ code: number, body?: object, text?: string }>}
 */
async function route(action, options, directory, loaded, io) {
  const liveness = require('../../lib/agent-liveness');
  switch (action) {
    case 'await': {
      return doAwait(options, directory, loaded, io);
    }
    case 'watch': {
      return doWatch(options, directory, loaded, io);
    }
    case 'report':
    case 'check': {
      if (!loaded.valid || !loaded.enabled) return disabledResult(loaded);
      if (action === 'report') return doReport(options, directory, loaded, io);
      const body = liveness.checkRuns({ directory, config: loaded.config, now: io.now(), io: io.reconcile });
      return { code: 0, body: { enabled: true, ...body }, text: formatCheck(body) };
    }
    default: {
      throw new UsageError(`Unknown action: ${action}. Use report, check, watch or await.`);
    }
  }
}

async function run(action, options = {}, ioOverrides = {}) {
  const liveness = require('../../lib/agent-liveness');
  const io = { now: Date.now, reconcile: undefined, ...ioOverrides };
  io.readHead = io.reconcile?.readHead ?? liveness.defaultReadHead;
  try {
    const directory = path.resolve(options.directory || process.cwd());
    const remember = action === 'report' || (action === 'watch' && options.printSystemd !== true);
    const loaded = loadContract(directory, remember);
    const outcome = await route(action, options, directory, loaded, io);
    if (loaded.warnings.length > 0 && outcome.body) {
      outcome.body.warnings = loaded.warnings;
      for (const warning of loaded.warnings) console.error(`[hseos liveness] warning: ${warning}`);
    }
    return outcome;
  } catch (error) {
    if (error instanceof UsageError || error instanceof TypeError) return { code: EXIT_USAGE, body: { error: error.message } };
    return { code: 1, body: { error: error.message } };
  }
}

module.exports = {
  command: 'liveness <action>',
  description: 'Agent liveness ("no silent idle"): report, check, watch, await',
  options: [
    ['--directory <path>', 'Project directory (default: current directory)'],
    ['--session <id>', 'Session id of the agent (report, await heartbeats)'],
    ['--agent <id>', 'Agent id (report, await heartbeats)'],
    ['--json [line]', 'Print JSON; for report, the LIVENESS line to validate and record'],
    ['--event <kind>', 'report event: report (default), turn_end or heartbeat'],
    ['--pid <n>', 'report: pid of the awaited process; await: pid to wait on'],
    ['--status-file <path>', 'report: status file written by the awaited command'],
    ['--worktree <path>', 'report: worktree whose HEAD is the source of truth'],
    ['--file <path>', 'await: wait until this file exists'],
    ['--cmd-status <path>', 'await: wait for a status file with {"exit_code": n}'],
    ['--max <seconds>', 'await: maximum wait, capped at foreground_wait_max_s'],
    ['--poll-ms <n>', 'await: poll interval in milliseconds', '1000'],
    ['--reason-code <code>', 'report: enumerated reason_code (default declared, blocked_pending for BLOCKED)'],
    ['--once', 'watch: run a single cycle'],
    ['--max-cycles <n>', 'watch: stop after n cycles'],
    ['--print-systemd', 'watch: print the systemd --user service and timer units'],
  ],
  action: async (action, options) => {
    const { code, body, text } = await run(action, options);
    if (text !== undefined && (action === 'check' ? options.json === undefined : body === undefined)) console.log(text);
    else console.log(JSON.stringify(body));
    if (code !== 0) process.exitCode = code;
  },
  _internal: { run, formatCheck },
};
