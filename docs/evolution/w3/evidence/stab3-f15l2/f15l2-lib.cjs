'use strict';
// Pure logic of the F15 L2 campaign script: stage evaluation, success rule, cost estimate, secret sweep, drain scan, Podman command.
// Nothing here spawns a model call. Tested by test/test-f15l2-campaign.js.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { sumUsage } = require('../shared/usage-from-sse.cjs');

const STAGES = Object.freeze([
  'reference_approved',
  'old_results_pruned',
  'compaction_before_checkpoint',
  'crash_proven',
  'resume_approved',
  'whole_file_pass',
  'fork_approved',
  'replay_resume_only',
  'drain_clean',
  'secrets_clean',
  'provider_proof_pass',
  'usage_complete',
]);

const LINEAGE_KEYS = Object.freeze([
  'ancestry_recomputed',
  'ancestry_event_count',
  'parent_session',
  'parent_sequence',
  'fork_prefix_equals_parent_prefix',
  'parent_unchanged_after_fork',
  'prefix_immutable_after_resume',
  'fork_criteria_equal',
]);

/** Replaces `require('./guards')` in the model's file by the trusted source of module B, so the single-file verifier can load it. */
function inlineGuards(finalText, guardsSource) {
  const wrapped = `(() => {\n  const module = { exports: {} };\n  ((module, exports) => {\n${guardsSource}\n  })(module, module.exports);\n  return module.exports;\n})()`;
  return String(finalText).replaceAll(/require\(\s*(['"])\.\/guards(?:\.js)?\1\s*\)/g, () => wrapped);
}

/** A run is approved on a stage only when the evidence says `true`; a missing value is a failure, never a pass. */
function stageResults(run) {
  const out = {};
  for (const stage of STAGES) out[stage] = run.stages?.[stage] === true;
  if (run.stages?.reference_approved === null) out.reference_approved = null;
  return out;
}

function lineageIntact(lineage) {
  return Boolean(lineage) && LINEAGE_KEYS.every((key) => lineage[key] === true);
}

/** Success rule of the pre-registered plan for the criterion series: every stage in at least `min_stage` of n and lineage in all n. */
function evaluateSeries(runs, { role, min_stage: minStage, lineage_required: lineageRequired, n }) {
  const counts = {};
  for (const stage of STAGES) {
    const values = runs.map((run) => stageResults(run)[stage]);
    counts[stage] = {
      passed: values.filter((value) => value === true).length,
      applicable: values.filter((value) => value !== null).length,
    };
  }
  const lineage = runs.filter((run) => lineageIntact(run.lineage)).length;
  const base = { n: runs.length, stage_counts: counts, lineage_intact: lineage };
  if (role !== 'criterion') return { ...base, verdict: 'informative' };
  // Fewer than n runs (a stop for cost, time or unreadable usage). The verdict depends on whether `pass` is still reachable with the runs
  // that are missing: INCOMPLETE if it is, `fail` if the criterion is already impossible (decisive failures are never hidden by a stop).
  if (Number.isInteger(n) && runs.length < n) {
    const missing = n - runs.length;
    const failuresIn = (stage) => runs.filter((run) => stageResults(run)[stage] === false).length;
    const stageImpossible = STAGES.filter((stage) => counts[stage].applicable > 0 && counts[stage].passed + missing < minStage);
    const lineageFailures = runs.length - lineage;
    const lineageImpossible = lineage + missing < lineageRequired;
    const impossible = stageImpossible.length > 0 || lineageImpossible;
    return {
      ...base,
      verdict: impossible ? 'fail' : 'INCOMPLETE',
      runs_missing: missing,
      pass_still_possible: !impossible,
      decisive: impossible
        ? { stages: stageImpossible.map((stage) => ({ stage, failures: failuresIn(stage) })), lineage_failures: lineageFailures }
        : null,
    };
  }
  const stagesOk = STAGES.every((stage) => counts[stage].applicable === 0 || counts[stage].passed >= minStage);
  const lineageOk = lineage >= lineageRequired;
  return { ...base, verdict: stagesOk && lineageOk ? 'pass' : 'fail', stages_ok: stagesOk, lineage_ok: lineageOk };
}

function readLog(dir) {
  const file = path.join(dir, 'provider-requests.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Evidence that old tool results were pruned while the newest one reached the model verbatim. */
function prunedOldKeptCurrent(entries) {
  return entries.some((entry) => {
    const results = entry.tool_results || [];
    return results.length >= 2 && results.slice(0, -1).some((item) => item.pruned) && results.at(-1).pruned === false;
  });
}

function estimateCost(entries, price) {
  return sumUsage(entries, { priceInPerMillion: price.in_per_million, priceOutPerMillion: price.out_per_million });
}

/** Linear projection of the whole series from the cost per run measured so far (an estimate, never a bill). */
function projectCost(perRunUsd, runs, capUsd) {
  const total = perRunUsd * runs;
  return { estimated_total_usd: total, over_cap: total > capUsd, cap_usd: capUsd };
}

const SECRET_PATTERNS = Object.freeze([
  ['api-key-shape', /sk-[A-Za-z0-9_-]{20,}/],
  ['bearer-header', /Bearer\s+[A-Za-z0-9._-]{16,}/],
]);

function walkFiles(root, out = []) {
  if (!fs.existsSync(root)) return out;
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) return out;
  if (!stat.isDirectory()) {
    out.push(root);
    return out;
  }
  for (const name of fs.readdirSync(root)) walkFiles(path.join(root, name), out);
  return out;
}

/** Scans every file under `roots` for the literal credential and for credential shapes. Returns paths and rule names, never the match. */
function scanSecrets(roots, secret, { allowHashes = [] } = {}) {
  const findings = [];
  let files = 0;
  for (const root of roots) {
    for (const file of walkFiles(root)) {
      files += 1;
      const text = fs.readFileSync(file).toString('latin1');
      if (secret && text.includes(secret)) findings.push({ file, rule: 'literal-credential' });
      for (const [rule, pattern] of SECRET_PATTERNS) if (pattern.test(text)) findings.push({ file, rule });
      for (const hash of allowHashes) if (hash && text.includes(hash)) findings.push({ file, rule: 'credential-sha256' });
    }
  }
  return { clean: findings.length === 0, files_scanned: files, findings };
}

/** Live processes whose working directory or command line points inside any of `roots` (the drain rule of C2/C3). */
function liveProcessesUnder(roots, { procRoot = '/proc', selfPid = process.pid } = {}) {
  const found = [];
  for (const entry of fs.readdirSync(procRoot)) {
    if (!/^\d+$/.test(entry) || Number(entry) === selfPid) continue;
    let cwd = '';
    let cmdline = '';
    try {
      cwd = fs.readlinkSync(path.join(procRoot, entry, 'cwd'));
      cmdline = fs.readFileSync(path.join(procRoot, entry, 'cmdline'), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES' && error.code !== 'ESRCH') throw error;
      continue;
    }
    if (roots.some((root) => cwd.startsWith(root) || cmdline.includes(root))) found.push({ pid: Number(entry) });
  }
  return found;
}

/** Tool invocations of a replayed session with no outcome, or with an `uncertain` outcome nobody reconciled (orphans). */
function orphanInvocations(replayedSession) {
  return Object.values(replayedSession.tool_invocations || {})
    .filter((invocation) => !invocation.outcome || (invocation.outcome.status === 'uncertain' && !invocation.uncertain_outcome))
    .map((invocation) => ({ name: invocation.name, status: invocation.outcome?.status ?? 'no-outcome' }));
}

function podmanArgs({ image, name, bundle, caseDir, cpus = '1', memory = '1g' }) {
  return [
    'run',
    '--rm',
    '--pull=never',
    '--name',
    name,
    '--network=none',
    '--user',
    '1000:1000',
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '256',
    '--cpus',
    cpus,
    '--memory',
    memory,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=64m,mode=1777',
    '-v',
    `${bundle}:/bundle:ro`,
    '-v',
    `${caseDir}:/case:ro`,
    image,
    'node',
    '/bundle/summarize-whole-file.cjs',
    '/case',
  ];
}

// ---- cost control -------------------------------------------------------------------------------------------------------------
const isPositiveFinite = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** A price pair is valid only when both numbers are finite and above zero. A missing price is never a default. */
function validatePrice(price) {
  return isPositiveFinite(price?.in) && isPositiveFinite(price?.out);
}

/** Worst case of one request: the real body in approximate tokens (3 bytes per token, pessimistic) plus the whole output cap. */
function worstCaseUsd({ bodyBytes, maxTokens, price }) {
  return (Math.ceil(bodyBytes / 3) * price.in + maxTokens * price.out) / 1_000_000;
}

/** Pessimistic cost of a request whose outcome is unknown (timeout, unreadable usage): the whole declared window as input. */
function pessimisticUsd({ windowTokens, maxTokens, price }) {
  return (windowTokens * price.in + maxTokens * price.out) / 1_000_000;
}

function usageUsd(usage, price) {
  if (!usage || !Number.isSafeInteger(usage.prompt_tokens) || !Number.isSafeInteger(usage.completion_tokens)) return null;
  return (usage.prompt_tokens * price.in + usage.completion_tokens * price.out) / 1_000_000;
}

function readSpend(file) {
  if (!fs.existsSync(file)) return { spent_usd: 0, pending_usd: 0, calls: 0 };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const writeSpend = (file, value) => fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });

/** Fingerprint of everything that decides what a real run does. Any changed byte changes it, so the owner's confirmation is void. */
function campaignFingerprint(files) {
  const entries = files.map((file) => [path.basename(file), createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

module.exports = {
  STAGES,
  LINEAGE_KEYS,
  inlineGuards,
  stageResults,
  lineageIntact,
  evaluateSeries,
  readLog,
  prunedOldKeptCurrent,
  estimateCost,
  projectCost,
  scanSecrets,
  liveProcessesUnder,
  orphanInvocations,
  podmanArgs,
  validatePrice,
  worstCaseUsd,
  pessimisticUsd,
  usageUsd,
  readSpend,
  writeSpend,
  campaignFingerprint,
};
