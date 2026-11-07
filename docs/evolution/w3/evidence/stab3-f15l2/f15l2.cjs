'use strict';
// F15 L2 campaign script (pre-registered in PLAN.json, protocol in docs/evolution/w3/stab2/T4.md).
// usage: node f15l2.cjs <repo-root> <fixture|real> <out-dir> [--runs N] [--negative] [--price-in N --price-out N]
//        node f15l2.cjs --fingerprint      (prints the hash the owner copies into F15L2_REAL_CONFIRMED)
//  fixture-only options: --fault non-sse|no-usage|hang, --cli-timeout-ms N, --cap-usd X (failure-path rehearsal).
//  fixture: every model call is answered by a scripted fake; nothing leaves the machine; the guard refuses any other destination.
//  real:    refuses to start unless F15L2_API_KEY (operator-supplied, never read from `pass`, never stored or printed) and
//           F15L2_REAL_CONFIRMED (= the campaign fingerprint: PLAN.json plus the files that decide the run) are present, and the
//           price comes from the explicit flags --price-in/--price-out, which must equal the price registered in PLAN.json.
// Journey per execution: reference without compaction, compaction confirmed before the checkpoint, crash (SIGKILL after a write result),
// resume, whole-file check in Podman, fork, replay, drain, secret sweep, adapter provider proof, usage. The explicit field
// `model_source` says `fixture` or `real` on every artifact.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const lib = require('./f15l2-lib.cjs');

const HERE = __dirname;
const PLAN_FILE = path.join(HERE, 'PLAN.json');
const planBytes = fs.readFileSync(PLAN_FILE);
const PLAN = JSON.parse(planBytes);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const PLAN_FILE_SHA256 = sha(planBytes);
const SHARED = path.join(HERE, '../shared');
// Everything that decides what a real run does. A changed byte in any of them voids the owner's confirmation.
const FINGERPRINT_FILES = [
  PLAN_FILE,
  path.join(HERE, 'f15l2.cjs'),
  path.join(HERE, 'f15l2-guard.cjs'),
  path.join(HERE, 'f15l2-lib.cjs'),
  path.join(HERE, 'f15l2-fake-model.cjs'),
  path.join(HERE, 'whole-file-spec.json'),
  path.join(HERE, 'project/add.fixture.txt'),
  path.join(HERE, 'project/guards.fixture.txt'),
  path.join(SHARED, 'whole-file-check.cjs'),
  path.join(SHARED, 'summarize-whole-file.cjs'),
  path.join(SHARED, 'summarize-provider-proof.cjs'),
  path.join(SHARED, 'usage-from-sse.cjs'),
];
// The product files this campaign exercises and that decide its result (adapter, provider proof, engineering runtime), by content, relative
// to the repository root the run uses. NOT in the hash, on purpose: rehearsal/, f15l2-mutations.cjs, f15l2-failure-paths.cjs,
// f15l2-test-server.cjs and the tests. They are rehearsal tooling: changing them does not change what a real run does.
const PRODUCT_FILES = [
  'tools/cli/lib/engineering-model.js',
  'tools/cli/lib/provider-api-adapter.js',
  'tools/cli/lib/engineering-task-runtime.js',
];
const DEFAULT_ROOT = path.resolve(HERE, '../../../../..');
const fingerprintFor = (root) => lib.campaignFingerprint([...FINGERPRINT_FILES, ...PRODUCT_FILES.map((file) => path.join(root, file))]);
let CAMPAIGN_SHA256 = null; // computed from the root the run uses (main) or the root given to --fingerprint
const PROFILE = 'disposable-engineering-candidate';

/** The only door to Podman. Real by default; a test may inject a fake with F15L2_PODMAN_EXECUTOR (module path), and only under F15L2_TEST_MODE=1. */
const realPodman = {
  inspect: (ref) => execFileSync('podman', ['image', 'inspect', '--format', '{{.Id}}|{{json .RepoDigests}}', ref], { encoding: 'utf8' }),
  run: ({ args, runChild, env, timeout }) =>
    runChild('heavy-run', ['--mem', '4G', '--wait-max', '1500', '--', 'podman', ...args], { env, timeout }),
  rm: (name) => spawnSync('podman', ['rm', '-f', name], { stdio: 'ignore' }),
};

function findKey(value, key) {
  if (!value || typeof value !== 'object') return;
  if (value[key] && typeof value[key] === 'object') return value[key];
  for (const child of Object.values(value)) {
    const found = findKey(child, key);
    if (found) return found;
  }
  return;
}

/** Read-only views of an engineering ledger: the events of a session, its replay, its writes and its protected-criteria refs. */
function ledgerTools({ RelationalSessionEventStore, ExecutionEventLedger, openExecutionLedgerFileFixture }) {
  const withLedger = (state, fn) => {
    const handle = openExecutionLedgerFileFixture(state);
    try {
      return fn(new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }));
    } finally {
      handle.close();
    }
  };
  return {
    events: (state, sid) => withLedger(state, (store) => store.readSession(sid)),
    replayed: (state, sid) => withLedger(state, (store) => store.replay(sid)),
    writes: (session) => Object.values(session.tool_invocations).filter((item) => item.name === 'engineering.write'),
    criteriaRefs: (list) =>
      [...new Set(list.filter((e) => e.event_type === 'context.assembled').flatMap((e) => e.payload.source_refs))].filter((r) =>
        r.endsWith('/protected-criteria'),
      ),
  };
}

const numberOrNaN = (value) => (value === undefined ? Number.NaN : Number(value));

function parseArgs(argv) {
  const [root, mode, out, ...rest] = argv;
  const options = { root, mode, out, runs: null, negative: false, price: {}, fault: null, cliTimeoutMs: null, capUsd: null, baseUrl: null };
  for (let index = 0; index < rest.length; index++) {
    switch (rest[index]) {
      case '--runs': {
        options.runs = Number(rest[++index]);
        break;
      }
      case '--negative': {
        options.negative = true;
        break;
      }
      case '--price-in': {
        options.price.in = numberOrNaN(rest[++index]);
        break;
      }
      case '--price-out': {
        options.price.out = numberOrNaN(rest[++index]);
        break;
      }
      case '--fault': {
        options.fault = rest[++index];
        break;
      }
      case '--cli-timeout-ms': {
        options.cliTimeoutMs = Number(rest[++index]);
        break;
      }
      case '--base-url': {
        options.baseUrl = rest[++index];
        break;
      }
      case '--cap-usd': {
        options.capUsd = Number(rest[++index]);
        break;
      }
      default: {
        throw new Error(`unknown option ${rest[index]}`);
      }
    }
  }
  if (!root || !['fixture', 'real'].includes(mode) || !out)
    throw new Error('usage: node f15l2.cjs <repo-root> <fixture|real> <out-dir> [--runs N] [--negative] [--price-in N --price-out N]');
  return options;
}

function blocked(why) {
  process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', why, campaign_sha256: CAMPAIGN_SHA256 })}\n`);
  process.exitCode = 3;
}

async function main(options) {
  const { root: ROOT, mode: MODE, out: OUT } = options;
  CAMPAIGN_SHA256 = fingerprintFor(ROOT);
  const TEST_MODE = process.env.F15L2_TEST_MODE === '1';
  const podman = TEST_MODE && process.env.F15L2_PODMAN_EXECUTOR ? require(process.env.F15L2_PODMAN_EXECUTOR) : realPodman;
  if (MODE === 'real') {
    if (!process.env.F15L2_API_KEY) return blocked('operator-credential-missing: set F15L2_API_KEY in the environment');
    if (process.env.F15L2_REAL_CONFIRMED !== CAMPAIGN_SHA256)
      return blocked('owner-confirmation-missing: F15L2_REAL_CONFIRMED must equal the campaign fingerprint (node f15l2.cjs --fingerprint)');
    if ((options.fault || options.cliTimeoutMs || options.capUsd) && !TEST_MODE) return blocked('test-only-option-without-F15L2_TEST_MODE');
    // The price has no default in real mode: it must come from the flags, be valid, and equal the price registered in the plan.
    if (!lib.validatePrice(options.price)) return blocked('price-invalid: --price-in and --price-out must be finite numbers above zero');
    if (options.price.in !== PLAN.price_usd_per_million.in || options.price.out !== PLAN.price_usd_per_million.out)
      return blocked('price-differs-from-the-plan');
  }
  const PRICE = MODE === 'real' ? options.price : PLAN.price_usd_per_million;
  const CAP_USD = options.capUsd ?? PLAN.cap_usd;
  const LIMIT_USD = CAP_USD * PLAN.stop_at_fraction;
  const CLI_TIMEOUT_MS = options.cliTimeoutMs ?? PLAN.cli_timeout_ms;
  const KEY = MODE === 'real' ? process.env.F15L2_API_KEY : `fake-${randomBytes(24).toString('hex')}`;
  const req = (p) => require(path.join(ROOT, p));
  const { RelationalSessionEventStore, canonicalJson } = req('packages/agent-session-store');
  const { createEngineeringExample } = req('tools/examples/engineering-task');
  const { ExecutionEventLedger } = req('tools/mcp-project-state/lib/execution-event-ledger');
  const { openExecutionLedgerFileFixture } = req('tools/mcp-project-state/lib/execution-ledger-schema');
  const ledger = ledgerTools({ RelationalSessionEventStore, ExecutionEventLedger, openExecutionLedgerFileFixture });
  const { sumUsage } = require('../shared/usage-from-sse.cjs');
  const CLI = path.join(ROOT, 'tools/cli/hseos-cli.js');
  const GUARD = path.join(HERE, 'f15l2-guard.cjs');
  // The destination of a real run is fixed. A local test server is possible ONLY with F15L2_TEST_MODE=1, and then ONLY on 127.0.0.1;
  // outside the test mode the test variable and the --base-url flag are ignored.
  const TEST_BASE = TEST_MODE && MODE === 'real' ? (options.baseUrl ?? process.env.F15L2_TEST_BASE_URL ?? null) : null;
  if (TEST_BASE !== null && !/^http:\/\/127\.0\.0\.1:\d{1,5}(\/.*)?$/.test(TEST_BASE))
    return blocked('test-base-url-must-be-http-127.0.0.1');
  const BASE = TEST_BASE ?? (MODE === 'real' ? 'https://api.openai.com/v1' : 'https://mock.invalid/v1');
  const TMP_BASE = process.env.TMPDIR || '/build/tmp';
  const started = Date.now();
  const deadline = started + PLAN.max_minutes * 60_000;
  const original = {
    'add.js': fs.readFileSync(path.join(HERE, 'project/add.fixture.txt'), 'utf8'),
    'guards.js': fs.readFileSync(path.join(HERE, 'project/guards.fixture.txt'), 'utf8'),
  };
  const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'whole-file-spec.json'), 'utf8'));
  fs.mkdirSync(path.join(OUT, 'runs'), { recursive: true, mode: 0o700 });
  const SPEND_FILE = path.join(OUT, 'spend.json');
  const STOP_FILE = path.join(OUT, 'STOP.json');
  if (fs.existsSync(STOP_FILE)) return blocked('stop-file-present-in-out-dir');
  lib.writeSpend(SPEND_FILE, { spent_usd: 0, pending_usd: 0, calls: 0 });
  // One private temporary root for the whole campaign, also for this process: the product accepts ledger states only as direct
  // children of the OS temporary directory, so the parent reads them under the same TMPDIR the children use. One removal cleans all.
  const TMP = fs.mkdtempSync(path.join(TMP_BASE, 'f15l2-campaign-'));
  process.env.TMPDIR = TMP;
  const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const redact = (text) => String(text || '').replaceAll(KEY, '[redacted]');

  // ---- signals, children and containers: whatever the campaign creates, a SIGINT/SIGTERM removes ---------------------------------
  const children = new Set();
  const containers = new Set();
  const scratchDirs = new Set();
  let aborted = null;
  const knownHashes = [];
  const removeContainers = () => {
    for (const name of containers) podman.rm(name);
    containers.clear();
  };
  const removeScratch = () => {
    for (const item of scratchDirs) fs.rmSync(item, { recursive: true, force: true });
    scratchDirs.clear();
    fs.rmSync(TMP, { recursive: true, force: true });
  };
  const onSignal = (name, code) => {
    if (aborted) return;
    aborted = { signal: name, code };
    for (const child of children) child.kill('SIGKILL');
    removeContainers();
  };
  const handlers = { SIGINT: () => onSignal('SIGINT', 130), SIGTERM: () => onSignal('SIGTERM', 143) };
  for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
  const stopReason = () => (fs.existsSync(STOP_FILE) ? JSON.parse(fs.readFileSync(STOP_FILE, 'utf8')).reason : null);

  /** Async child with a timeout: the event loop stays free, so a signal reaches the handler above while a child runs. */
  function runChild(command, args, { env, timeout }) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      children.add(child);
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeout);
      child.on('close', (status, signal) => {
        clearTimeout(timer);
        children.delete(child);
        resolve({ status, signal, stdout, stderr, timedOut });
      });
    });
  }

  const binding = (window) => `schema_version: "1.0"
binding_id: provider-binding:openai-compatible-example
profile_id: agent-openai-compatible-candidate
adapter: openai-compatible-sse
provider:
  provider_id: model:openai-compatible
  provider_version: 1.0.0
  base_url: ${BASE}
  model: ${PLAN.model}
  capabilities:
    - text_generation
    - streaming
    - tool_calls
    - usage
    - cancellation
  limits:
    context_tokens: ${window}
    max_output_tokens: ${PLAN.max_output_tokens}
    max_parallel_requests: 1
  secret_refs:
    - name: api-key
      source_ref: env://HSEOS_MODEL_PROVIDER_API_KEY
transport:
  max_attempts: 1
  retry_delay_ms: 250
activation:
  operational: false
  authorized: false
`;

  function makeContract() {
    const example = structuredClone(createEngineeringExample('addition'));
    example.contract.limits = { ...example.contract.limits, ...PLAN.contract_limits };
    example.contract.initial_files = Object.entries(original).map(([file, content]) => ({ path: file, content, sha256: sha(content) }));
    example.contract.scope = { read: ['add.js', 'guards.js'], write: ['add.js'] };
    return example.contract;
  }

  async function journey({ id, series, index, behavior, negative }) {
    const dir = path.join(OUT, 'runs', id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const scratch = fs.mkdtempSync(path.join(TMP, `f15l2-${id}-`));
    scratchDirs.add(scratch);
    const refDir = path.join(dir, 'reference');
    fs.mkdirSync(refDir, { recursive: true, mode: 0o700 });
    let credentialHash = null;
    const T = (name) => path.join(scratch, name);
    const states = [];
    const steps = [];
    const note = (name, value) => steps.push({ step: name, ...value });
    const countIn = (where) =>
      fs.existsSync(path.join(where, 'request-count.txt')) ? Number(fs.readFileSync(path.join(where, 'request-count.txt'), 'utf8')) : 0;
    const count = () => countIn(dir);
    const cli = async (
      args,
      extraEnv = {},
      guardDir = dir,
      maxRequests = PLAN.max_requests_per_run.journey,
      windowTokens = PLAN.declared_window_tokens,
    ) => {
      const env = {
        PATH: process.env.PATH,
        HOME: T('home'),
        TMPDIR: TMP,
        HSEOS_MODEL_PROVIDER_API_KEY: KEY,
        F15L2_MODE: MODE,
        F15L2_DIR: guardDir,
        F15L2_MAX_REQUESTS: String(maxRequests),
        F15L2_DEADLINE_MS: String(deadline),
        F15L2_FAKE_BEHAVIOR: behavior,
        F15L2_FAKE_MODEL: PLAN.model,
        ...(options.fault ? { F15L2_FAKE_FAULT: options.fault } : {}),
        F15L2_PLAN_SHA256: CAMPAIGN_SHA256,
        F15L2_SPEND_FILE: SPEND_FILE,
        F15L2_STOP_FILE: STOP_FILE,
        F15L2_LIMIT_USD: String(LIMIT_USD),
        F15L2_PRICE_IN: String(PRICE.in),
        F15L2_PRICE_OUT: String(PRICE.out),
        F15L2_WINDOW_TOKENS: String(windowTokens),
        ...(TEST_BASE ? { F15L2_TEST_MODE: '1', F15L2_TEST_BASE_URL: TEST_BASE } : {}),
        F15L2_MAX_OUT: String(PLAN.max_output_tokens),
        ...(MODE === 'real' ? { F15L2_REAL_CONFIRMED: process.env.F15L2_REAL_CONFIRMED } : {}),
        ...extraEnv,
      };
      fs.mkdirSync(env.HOME, { recursive: true });
      const result = await runChild(process.execPath, ['--require', GUARD, CLI, 'agent', ...args], { env, timeout: CLI_TIMEOUT_MS });
      if (aborted) throw Object.assign(new Error(`F15L2_ABORTED:${aborted.signal}`), { code: 'F15L2_ABORTED' });
      if (result.timedOut) {
        // No answer: the request may have been served and billed. Book the pessimistic cost (the whole declared window as input).
        const spend = lib.readSpend(SPEND_FILE);
        const booked = lib.pessimisticUsd({ windowTokens: windowTokens, maxTokens: PLAN.max_output_tokens, price: PRICE });
        lib.writeSpend(SPEND_FILE, { ...spend, spent_usd: spend.spent_usd + booked, pending_usd: 0 });
        fs.writeFileSync(STOP_FILE, JSON.stringify({ reason: 'cli-timeout', booked_usd: booked }), { mode: 0o600 });
        throw Object.assign(new Error('F15L2_CAMPAIGN_STOPPED: cli-timeout'), { code: 'F15L2_CAMPAIGN_STOPPED' });
      }
      if (stopReason()) throw Object.assign(new Error(`F15L2_CAMPAIGN_STOPPED: ${stopReason()}`), { code: 'F15L2_CAMPAIGN_STOPPED' });
      const text = (result.stdout || '').trim();
      let json = null;
      try {
        json = text ? JSON.parse(text.split('\n').at(-1)) : null;
      } catch (error) {
        note('json-parse-failed', { message: String(error.message).slice(0, 120) });
      }
      return { status: result.status, signal: result.signal, json, stderr: redact(result.stderr).slice(0, 500) };
    };
    const { events, replayed, writes, criteriaRefs } = ledger;
    const stateDigest = (state) => {
      const hash = createHash('sha256');
      const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
          const file = path.join(current, entry.name);
          if (entry.isDirectory()) walk(file);
          else hash.update(`${path.relative(state, file)}\0`).update(fs.readFileSync(file));
        }
      };
      walk(state);
      return hash.digest('hex');
    };
    const stages = {};
    const lineage = {};
    const info = { id, series, index, model_source: MODE === 'real' ? 'real' : 'fixture', behavior, negative_control: negative === true };
    const threshold = PLAN.series.find((item) => item.id === series).threshold_basis_points;
    fs.writeFileSync(T('task.json'), JSON.stringify(makeContract()));
    fs.writeFileSync(T('binding.yaml'), binding(PLAN.declared_window_tokens));
    fs.writeFileSync(T('binding-reference.yaml'), binding(PLAN.reference_window_tokens));
    fs.writeFileSync(
      T('compaction.json'),
      JSON.stringify({
        schema_version: 1,
        provider_id: 'compaction:deterministic',
        threshold_basis_points: threshold,
        context_tokens: PLAN.declared_window_tokens,
      }),
    );
    const runArgs = (extra = []) => ['run', '--task-contract', T('task.json'), '--binding', T('binding.yaml'), ...extra, '--json'];
    let created = null;
    try {
      // 1. reference without compaction
      if (PLAN.reference_run) {
        const ref = await cli(
          ['run', '--task-contract', T('task.json'), '--binding', T('binding-reference.yaml'), '--json'],
          {},
          refDir,
          PLAN.max_requests_per_run.reference,
          PLAN.reference_window_tokens,
        );
        if (ref.json?.state) states.push(ref.json.state);
        stages.reference_approved = ref.json?.task_result === 'approved';
        info.reference = { task_result: ref.json?.task_result, reason: ref.json?.reason };
        note('reference', { status: ref.status, task_result: ref.json?.task_result, requests: countIn(refDir) });
      } else stages.reference_approved = null;

      // 2. create with compaction, crash after the first write result
      created = await cli(runArgs(['--compaction', T('compaction.json'), '--create-only']));
      if (!created.json) throw new Error(`create-failed: ${created.stderr}`);
      states.push(created.json.state);
      const state = created.json.state;
      const sid = created.json.session_id;
      const crash = await cli(
        ['resume', '--profile', PROFILE, '--state', state, '--expected-sequence', String(created.json.current_sequence), '--json'],
        { F15L2_CRASH_AFTER_WRITE: '1' },
      );
      const record = fs.existsSync(path.join(dir, 'crash-record.json'))
        ? JSON.parse(fs.readFileSync(path.join(dir, 'crash-record.json'), 'utf8'))
        : null;
      let alive = true;
      try {
        process.kill(record?.pid, 0);
      } catch (error) {
        alive = error.code !== 'ESRCH';
      }
      stages.crash_proven = crash.signal === 'SIGKILL' && Boolean(record) && !alive;
      const crashed = events(state, sid);
      const compactions = crashed.filter((e) => e.event_type === 'compaction.completed');
      const firstWrite = crashed.find((e) => e.event_type === 'tool.execution.started' && e.payload.name === 'engineering.write');
      const writtenBefore = writes(replayed(state, sid)).map((item) => ({ outcome: item.outcome?.status ?? 'no-outcome' }));
      note('crash', {
        signal: crash.signal,
        pid_alive_after: alive,
        events: crashed.length,
        compactions: compactions.length,
        first_write_sequence: firstWrite?.sequence ?? null,
        writes_before_crash: writtenBefore,
      });

      // 3. resume, with reconciliation when the product asks for it
      const status = await cli(['status', '--profile', PROFILE, '--state', state, '--json']);
      let resumed = await cli([
        'resume',
        '--profile',
        PROFILE,
        '--state',
        state,
        '--expected-sequence',
        String(status.json?.current_sequence),
        '--json',
      ]);
      note('resume-1', { task_result: resumed.json?.task_result, reason: resumed.json?.reason, requests: count() });
      if (resumed.json?.task_result === 'blocked' && resumed.json.reason === 'effect-reconciliation-required') {
        fs.writeFileSync(
          T('decision.json'),
          JSON.stringify({
            report_sha256: resumed.json.reconciliation.sha256,
            decision: 'continue-from-observed-state',
            answer: 'The interrupted attempt is abandoned; continue from the durable history.',
          }),
        );
        info.reconciliation = { required: true, report_sha256: resumed.json.reconciliation.sha256 };
        resumed = await cli([
          'resume',
          '--profile',
          PROFILE,
          '--state',
          state,
          '--expected-sequence',
          String(resumed.json.current_sequence),
          '--reconciliation-decision',
          T('decision.json'),
          '--json',
        ]);
        note('resume-2', { task_result: resumed.json?.task_result, reason: resumed.json?.reason, requests: count() });
      } else info.reconciliation = { required: false };
      stages.resume_approved = resumed.json?.task_result === 'approved';
      const afterResume = events(state, sid);
      lineage.prefix_immutable_after_resume = afterResume.slice(0, crashed.length).every((e, i) => e.event_id === crashed[i].event_id);
      const parentCriteria = criteriaRefs(afterResume);
      info.compactions = afterResume
        .filter((e) => e.event_type === 'compaction.completed')
        .map((e) => ({
          sequence: e.sequence,
          event_id: e.event_id,
          strategy: e.payload.strategy ?? null,
          trigger: e.payload.trigger ?? null,
          sources: e.payload.source_event_ids?.length ?? null,
        }));
      const log = lib.readLog(dir);
      stages.old_results_pruned = info.compactions.length > 0 && lib.prunedOldKeptCurrent(log);
      info.criteria_refs = parentCriteria.length;
      const readSizes = log.flatMap((entry) =>
        (entry.tool_results || [])
          .filter((item) => item.tool.endsWith('read') && item.path === 'add.js' && !item.pruned)
          .map((item) => item.bytes),
      );
      info.observable_state_change = {
        writes_durable_before_crash: writtenBefore,
        add_js_verbatim_read_bytes_in_order: readSizes,
        workspace_change_observed_after_recovery: readSizes.length > 1 && readSizes.at(-1) !== readSizes[0],
        note: 'The file the model reads after the recovery differs in size from the one it read before the crash: the write landed before the process died.',
      };

      // 4. evidence: artifacts + adapter provider_proof, read from `agent evidence` (never from a loose file)
      const evidence = await cli(['evidence', '--profile', PROFILE, '--state', state]);
      const evidenceFile = T('evidence.json');
      fs.writeFileSync(evidenceFile, JSON.stringify(evidence.json ?? {}), { mode: 0o600 });
      const proofRun = spawnSync(process.execPath, [path.join(HERE, '../shared/summarize-provider-proof.cjs'), evidenceFile], {
        encoding: 'utf8',
      });
      let proofVerdict = { verdict: 'unknown', failures: ['summary-unreadable'] };
      try {
        proofVerdict = JSON.parse(proofRun.stdout);
      } catch (error) {
        note('proof-summary-unreadable', { message: String(error.message).slice(0, 100) });
      }
      const proof = findKey(evidence.json, 'provider_proof');
      credentialHash = proof?.credential_sha256 ?? null;
      stages.provider_proof_pass = proofVerdict.verdict === 'pass' && proofRun.status === 0;
      info.provider_proof = {
        summarizer_verdict: proofVerdict.verdict,
        failures: proofVerdict.failures,
        auth_mode: proof?.auth_mode ?? null,
        credential_source: proof?.credential_source ?? null,
        backend_verified: proof?.backend_verified ?? null,
        requests_total: proof?.requests_total ?? null,
        requests_verified: proof?.requests_verified ?? null,
        declared: proof?.declared ?? null,
        observed: proof?.observed ?? null,
        credential_sha256: 'omitted-from-public-receipt',
        counts_scope: 'process-after-resume-only',
      };

      // 5. whole-file check in Podman
      const finalText = (evidence.json?.artifacts?.files ?? []).find((file) => file.path === 'add.js')?.content ?? null;
      const caseDir = T('case');
      fs.mkdirSync(caseDir);
      fs.writeFileSync(path.join(caseDir, 'original.txt'), original['add.js']);
      fs.writeFileSync(path.join(caseDir, 'final.txt'), finalText === null ? '' : lib.inlineGuards(finalText, original['guards.js']));
      fs.writeFileSync(path.join(caseDir, 'spec.json'), JSON.stringify(spec));
      const whole = await runWholeFile(caseDir, id);
      stages.whole_file_pass = whole.verdict === 'pass';
      info.whole_file = whole;
      if (finalText !== null) fs.writeFileSync(path.join(dir, 'final-add.txt'), finalText, { mode: 0o600 });

      // 6. fork from a pre-write checkpoint, resume it, check the lineage
      const parentBefore = events(state, sid);
      const parentDigest = stateDigest(state);
      const writeAt = parentBefore.find((e) => e.event_type === 'tool.execution.started' && e.payload.name === 'engineering.write');
      let forked = null;
      let checkpoint = null;
      const refusals = [];
      for (let seq = (writeAt?.sequence ?? 2) - 1; seq >= 1 && !forked; seq--) {
        const attempt = await cli(['fork', '--profile', PROFILE, '--state', state, '--from-sequence', String(seq), '--json']);
        if (attempt.json?.fork) {
          forked = attempt;
          checkpoint = seq;
        } else refusals.push({ seq, stderr: attempt.stderr.slice(0, 100) });
      }
      const firstCompaction = info.compactions[0];
      stages.compaction_before_checkpoint = Boolean(forked) && Boolean(firstCompaction) && firstCompaction.sequence < checkpoint;
      let forkOk = false;
      if (forked) {
        states.push(forked.json.state);
        const prefix = parentBefore.slice(0, checkpoint);
        lineage.ancestry_recomputed = forked.json.fork.ancestry_sha256 === sha(canonicalJson(prefix));
        lineage.ancestry_event_count = forked.json.fork.ancestry_event_count === prefix.length;
        lineage.parent_session = forked.json.fork.parent_session_id === sid;
        lineage.parent_sequence = forked.json.fork.parent_sequence === checkpoint;
        lineage.fork_prefix_equals_parent_prefix = JSON.stringify(events(forked.json.state, sid)) === JSON.stringify(prefix);
        lineage.parent_unchanged_after_fork = stateDigest(state) === parentDigest;
        const done = await cli([
          'resume',
          '--profile',
          PROFILE,
          '--state',
          forked.json.state,
          '--expected-sequence',
          String(forked.json.current_sequence),
          '--json',
        ]);
        forkOk = done.json?.task_result === 'approved';
        const forkEvents = forkOk ? events(forked.json.state, sid) : [];
        lineage.fork_criteria_equal = forkOk && JSON.stringify(criteriaRefs(forkEvents)) === JSON.stringify(parentCriteria);
        note('fork', {
          checkpoint,
          checkpoint_event_type: parentBefore[checkpoint - 1].event_type,
          compaction_sequence: firstCompaction?.sequence ?? null,
          task_result: done.json?.task_result,
          refusals,
        });
        info.fork = {
          checkpoint_sequence: checkpoint,
          ancestry_event_count: forked.json.fork.ancestry_event_count,
          compactions_in_prefix: prefix.filter((e) => e.event_type === 'compaction.completed').length,
        };
      } else note('fork-failed', { refusals });
      stages.fork_approved = forkOk;
      for (const key of lib.LINEAGE_KEYS) lineage[key] ??= false;

      // 7. replay: resuming the completed task must change nothing and call no model
      const sequenceBefore = events(state, sid).length;
      const requestsBefore = count();
      const digestBefore = JSON.stringify(replayed(state, sid));
      const again = await cli([
        'resume',
        '--profile',
        PROFILE,
        '--state',
        state,
        '--expected-sequence',
        String(resumed.json?.current_sequence),
        '--json',
      ]);
      // Declared as resume-only: resuming a COMPLETED task changes no event and sends no request. It is not a replay of an interrupted
      // session and it is not claimed as idempotence of the engine.
      stages.replay_resume_only =
        events(state, sid).length === sequenceBefore &&
        count() === requestsBefore &&
        JSON.stringify(replayed(state, sid)) === digestBefore &&
        again.json?.task_result === 'approved';
      note('replay-resume-only', {
        events: sequenceBefore,
        requests_unchanged: count() === requestsBefore,
        task_result: again.json?.task_result,
      });

      // 8. drain: no orphan tool invocation, no live process under the campaign, request counter equals the log
      const orphans = states.flatMap((item) => {
        const sessionId = item === forked?.json?.state || item === state ? sid : null;
        return sessionId ? lib.orphanInvocations(replayed(item, sessionId)) : [];
      });
      const live = lib.liveProcessesUnder([scratch, ...states, dir]);
      const finalLog = [...lib.readLog(refDir), ...lib.readLog(dir)];
      const countedTotal = countIn(refDir) + count();
      stages.drain_clean = orphans.length === 0 && live.length === 0 && finalLog.length === countedTotal;
      info.drain = {
        orphan_tool_invocations: orphans.length,
        live_processes_under_campaign: live.length,
        requests_counted: countedTotal,
        requests_logged: finalLog.length,
      };

      // 9. usage
      const usage = sumUsage(finalLog, {
        priceInPerMillion: PLAN.price_usd_per_million.in,
        priceOutPerMillion: PLAN.price_usd_per_million.out,
      });
      stages.usage_complete = usage.complete && usage.requests > 0;
      info.usage = usage;
      info.requests_by_dir = { reference: countIn(refDir), journey: count() };
      info.requests = countedTotal;
      info.responding_models = [...new Set(finalLog.map((entry) => entry.responding_model))];
    } catch (error) {
      info.error = redact(error.message).slice(0, 300);
    } finally {
      // The sweep runs AFTER run.json is written: it must see the file the public receipt will quote.
      for (const stage of lib.STAGES) stages[stage] ??= false;
      const publicSecrets = [dir];
      const result = () => ({ ...info, stages, lineage, lineage_intact: lib.lineageIntact(lineage), steps });
      write(path.join(dir, 'run.json'), result());
      const hashes = credentialHash ? [credentialHash] : [];
      if (credentialHash) knownHashes.push(credentialHash);
      const open = lib.scanSecrets(publicSecrets, KEY, { allowHashes: hashes });
      // Ledgers legitimately hold the credential hash (it is how `agent evidence` proves the adapter); they must not hold the key.
      const internal = lib.scanSecrets([scratch, ...states], KEY);
      const sweep = {
        clean: open.clean && internal.clean,
        files_scanned: open.files_scanned + internal.files_scanned,
        findings: [...open.findings, ...internal.findings],
      };
      stages.secrets_clean = sweep.clean;
      info.secret_sweep = {
        clean: sweep.clean,
        files_scanned: sweep.files_scanned,
        searched: ['literal-credential', 'api-key-shape', 'bearer-header', 'credential-sha256 (public files only)'],
        findings: sweep.findings.map((item) => ({ rule: item.rule, file: path.basename(item.file) })),
      };
      write(path.join(dir, 'run.json'), result());
      for (const item of states) fs.rmSync(item, { recursive: true, force: true });
      fs.rmSync(scratch, { recursive: true, force: true });
      scratchDirs.delete(scratch);
    }
    return JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  }

  const bundle = fs.mkdtempSync(path.join(TMP, 'f15l2-bundle-'));
  scratchDirs.add(bundle);
  function prepareBundle() {
    fs.mkdirSync(path.join(bundle, 'node_modules'));
    for (const file of ['summarize-whole-file.cjs', 'whole-file-check.cjs'])
      fs.copyFileSync(path.join(SHARED, file), path.join(bundle, file));
    execFileSync('cp', [
      '-rL',
      path.dirname(require.resolve('acorn/package.json', { paths: [ROOT] })),
      path.join(bundle, 'node_modules/acorn'),
    ]);
    // The container runs as a non-root user: the mounted directories must be readable by it (public code, no secret).
    execFileSync('chmod', ['-R', 'a+rX', bundle]);
  }

  async function runWholeFile(caseDir, id) {
    const image = (() => {
      try {
        const [imageId, repoDigests] = podman.inspect(`${PLAN.verifier_image.name}@${PLAN.verifier_image.digest}`).trim().split('|');
        return {
          image_id: imageId,
          expected_digest_is_a_repo_digest: JSON.parse(repoDigests).some((item) => item.endsWith(`@${PLAN.verifier_image.digest}`)),
        };
      } catch (error) {
        return { image_id: null, expected_digest_is_a_repo_digest: false, error: String(error.message).slice(0, 80) };
      }
    })();
    const name = `f15l2-${id}-${process.pid}`;
    execFileSync('chmod', ['-R', 'a+rX', caseDir]);
    containers.add(name);
    const run = await podman.run({
      args: lib.podmanArgs({ image: `${PLAN.verifier_image.name}@${PLAN.verifier_image.digest}`, name, bundle, caseDir }),
      runChild,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: TMP, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR },
      timeout: 1_800_000,
    });
    podman.rm(name);
    containers.delete(name);
    if (aborted) throw Object.assign(new Error(`F15L2_ABORTED:${aborted.signal}`), { code: 'F15L2_ABORTED' });
    let parsed = null;
    try {
      parsed = JSON.parse((run.stdout || '').slice((run.stdout || '').indexOf('{')));
    } catch (error) {
      parsed = { verdict: 'unknown', failures: [], unknown: [`unreadable-verifier-output:${String(error.message).slice(0, 60)}`] };
    }
    return {
      ...parsed,
      runner:
        'podman --network=none --user 1000:1000 --cap-drop=ALL --security-opt no-new-privileges --pids-limit 256 --cpus 1 --memory 1g --read-only',
      image_digest_expected: PLAN.verifier_image.digest,
      ...image,
      pull: 'never',
      exit: run.status,
    };
  }

  const runs = [];
  const order = PLAN.order.slice(0, options.runs ?? PLAN.order.length);
  const counters = {};
  let stoppedBecause = null;
  let interrupted = null;
  let negative = null;
  try {
    prepareBundle();
    for (const series of order) {
      counters[series] = (counters[series] ?? 0) + 1;
      const spent = lib.readSpend(SPEND_FILE).spent_usd;
      if (spent >= LIMIT_USD) stoppedBecause = `cost-${Math.round(PLAN.stop_at_fraction * 100)}pct`;
      else if (Date.now() - started >= PLAN.max_minutes * 60_000 * PLAN.stop_at_fraction)
        stoppedBecause = `time-${Math.round(PLAN.stop_at_fraction * 100)}pct`;
      if (stoppedBecause || aborted) break;
      const result = await journey({ id: `${series}-${counters[series]}`, series, index: counters[series], behavior: 'good' });
      if (aborted) break;
      stoppedBecause = stopReason();
      if (stoppedBecause) {
        interrupted = { id: result.id, error: result.error ?? null };
        break;
      }
      runs.push(result);
      process.stdout.write(
        `${JSON.stringify({ run: result.id, stages_ok: lib.STAGES.filter((s) => result.stages[s] === true).length, lineage: result.lineage_intact, requests: result.requests, est_usd: result.usage?.estimated_cost_usd ?? null, spent_usd: lib.readSpend(SPEND_FILE).spent_usd })}\n`,
      );
    }
    // The series spend is frozen here. The negative control exists only in the rehearsal and has its own ledger, so it never eats the
    // budget of the 10 executions.
    const seriesSpend = lib.readSpend(SPEND_FILE);
    fs.copyFileSync(SPEND_FILE, path.join(OUT, 'spend-series.json'));
    if (options.negative && !stoppedBecause && !aborted) {
      lib.writeSpend(SPEND_FILE, { spent_usd: 0, pending_usd: 0, calls: 0 });
      negative = await journey({ id: 'negative-1', series: PLAN.series[0].id, index: 1, behavior: 'mutilate', negative: true });
      stoppedBecause = stopReason();
      if (!stoppedBecause && !aborted) {
        negative.expected = 'whole_file_pass must be false while the product verifier approves';
        negative.reproved_as_expected = negative.stages.whole_file_pass === false && negative.stages.resume_approved === true;
        write(path.join(OUT, 'runs', 'negative-1', 'run.json'), negative);
      }
    }
    if (aborted) {
      process.exitCode = aborted.code;
      return;
    }
    const bySeries = Object.fromEntries(
      PLAN.series.map((series) => [
        series.id,
        lib.evaluateSeries(
          runs.filter((run) => run.series === series.id),
          { role: series.role, ...PLAN.success, n: series.n },
        ),
      ]),
    );
    const costUsd = seriesSpend.spent_usd;
    const requests = runs.reduce((sum, run) => sum + (run.requests ?? 0), 0);
    const perRun = runs.length > 0 ? runs.reduce((sum, run) => sum + (run.usage?.estimated_cost_usd ?? 0), 0) / runs.length : 0;
    const criterion = PLAN.series.find((item) => item.role === 'criterion');
    const summary = {
      model_source: MODE === 'real' ? 'real' : 'fixture',
      campaign_sha256: CAMPAIGN_SHA256,
      plan_file_sha256: PLAN_FILE_SHA256,
      cap_usd: CAP_USD,
      limit_usd: LIMIT_USD,
      runs: runs.length,
      stopped_because: stoppedBecause,
      interrupted_run: interrupted,
      overall_verdict: bySeries[criterion.id].verdict === 'INCOMPLETE' ? 'INCOMPLETE' : bySeries[criterion.id].verdict,
      series: bySeries,
      negative_control: negative
        ? {
            reproved_as_expected: negative.reproved_as_expected ?? null,
            whole_file: negative.whole_file?.verdict,
            failures: negative.whole_file?.failures,
            product_resume_approved: negative.stages.resume_approved,
          }
        : null,
      requests,
      spend_ledger_usd: costUsd,
      spend_ledger_note:
        'Booked by the guard before and after every request: worst case first, then the measured usage; pessimistic when unreadable or on timeout.',
      estimated_cost_usd_projected_for_plan: lib.projectCost(perRun, PLAN.order.length, CAP_USD),
      cost_note:
        'Estimate from the tokens of the run and the declared price; for a fixture the tokens are synthetic (bytes/3 for the pre-call worst case, bytes/4 measured), so this is a sizing estimate, not a measurement.',
      elapsed_ms: Date.now() - started,
    };
    write(path.join(OUT, 'summary.json'), summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    // Final sweep: AFTER summary.json and every run.json exist, over the whole public output, with the key and every credential hash.
    const finalSweep = lib.scanSecrets([OUT], KEY, { allowHashes: knownHashes });
    write(path.join(OUT, 'secret-sweep.json'), {
      clean: finalSweep.clean,
      files_scanned: finalSweep.files_scanned,
      findings: finalSweep.findings.map((item) => ({ rule: item.rule, file: path.relative(OUT, item.file) })),
    });
    const complete = runs.length === PLAN.order.length && runs.every((run) => !run.error) && !stoppedBecause && finalSweep.clean;
    if (stoppedBecause) process.exitCode = 4;
    else if (MODE === 'fixture' && options.negative)
      process.exitCode = complete && negative?.reproved_as_expected === true && runs.every((run) => run.stages.secrets_clean) ? 0 : 1;
    else process.exitCode = complete ? 0 : 1;
  } finally {
    for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
    removeContainers();
    removeScratch();
  }
}

(process.argv.includes('--fingerprint')
  ? Promise.resolve(
      (() => {
        const root = process.argv[process.argv.indexOf('--fingerprint') + 1] ?? DEFAULT_ROOT;
        process.stdout.write(
          `${JSON.stringify({ campaign_sha256: fingerprintFor(root), plan_file_sha256: PLAN_FILE_SHA256, files: [...FINGERPRINT_FILES, ...PRODUCT_FILES].map((file) => path.basename(file)) })}\n`,
        );
      })(),
    )
  : main(parseArgs(process.argv.slice(2)))
).catch((error) => {
  process.stderr.write(`${String(error.message).slice(0, 400)}\n`);
  process.exitCode = 1;
});
