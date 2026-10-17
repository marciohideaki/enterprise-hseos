// Retroactive idle metric over Claude Code agent transcripts (JSONL).
// Not shipped in the npm package: docs/ is outside the `files` allow-list, and the
// script reads host transcripts, so it has no place in the runtime.
//
// A `queued_command` attachment is a completion notice that reached the transcript.
// It does not wake an idle agent, so the interesting figure is how long the agent
// took to act on it:
//   reaction_latency  first assistant record after the notice minus the notice
//   idle_gap          the stretch of silence (no assistant or user record) that
//                     contains the notice
//   violations        notices whose reaction_latency exceeds the stall threshold
// Records are ordered by their own timestamp, not by file position: queued notices
// are appended out of order relative to the turn that finally consumes them.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_STALL_S = 900;

export function parseTranscript(text) {
  const records = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(record.timestamp);
    if (Number.isNaN(at)) continue;
    records.push({ at, type: record.type, attachment: record.attachment });
  }
  return records.sort((a, b) => a.at - b.at);
}

// The cause is derived from the notice itself, never guessed from the agent's prose.
export function causeOf(prompt) {
  const summary = /<summary>(.*?)<\/summary>/s.exec(String(prompt ?? ''))?.[1] ?? '';
  if (summary.startsWith('Monitor event:')) return 'monitor_event';
  if (/^Monitor\b.*(stream ended|expired)/.test(summary)) return 'monitor_stream_ended';
  if (/<task-id>/.test(String(prompt)) && /<output-file>/.test(String(prompt))) return 'background_task_completed';
  return 'other';
}

export function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
}

function byCause(reactions, stallMs) {
  const groups = {};
  for (const row of reactions) {
    const group = (groups[row.cause] ??= { count: 0, violations: 0, worst_reaction_latency_ms: null });
    group.count += 1;
    if (row.reaction_latency_ms === null) continue;
    if (row.reaction_latency_ms > stallMs) group.violations += 1;
    if (row.reaction_latency_ms > (group.worst_reaction_latency_ms ?? -1)) group.worst_reaction_latency_ms = row.reaction_latency_ms;
  }
  for (const group of Object.values(groups)) {
    group.worst_reaction_latency = group.worst_reaction_latency_ms === null ? null : formatDuration(group.worst_reaction_latency_ms);
  }
  return groups;
}

export function analyze(records, { stallTimeoutS = DEFAULT_STALL_S } = {}) {
  const activity = records.filter((record) => record.type === 'assistant' || record.type === 'user');
  const assistants = activity.filter((record) => record.type === 'assistant');
  const notices = records.filter((record) => record.type === 'attachment' && record.attachment?.type === 'queued_command');
  const reactions = [];
  for (const notice of notices) {
    const reaction = assistants.find((record) => record.at > notice.at);
    const before = activity.toReversed().find((record) => record.at <= notice.at);
    const after = activity.find((record) => record.at > notice.at);
    reactions.push({
      cause: causeOf(notice.attachment.prompt),
      queued_at: new Date(notice.at).toISOString(),
      reacted_at: reaction ? new Date(reaction.at).toISOString() : null,
      reaction_latency_ms: reaction ? reaction.at - notice.at : null,
      idle_gap_ms: before && after ? after.at - before.at : null,
      idle_from: before ? new Date(before.at).toISOString() : null,
      idle_until: after ? new Date(after.at).toISOString() : null,
    });
  }
  const stallMs = stallTimeoutS * 1000;
  const gaps = [];
  for (const row of reactions) {
    if (row.idle_gap_ms === null || row.idle_gap_ms <= stallMs) continue;
    if (gaps.some((gap) => gap.idle_from === row.idle_from && gap.idle_until === row.idle_until)) continue;
    gaps.push({
      idle_from: row.idle_from,
      idle_until: row.idle_until,
      idle_gap_ms: row.idle_gap_ms,
      idle_gap: formatDuration(row.idle_gap_ms),
    });
  }
  const violations = reactions.filter((row) => row.reaction_latency_ms !== null && row.reaction_latency_ms > stallMs);
  const unanswered = reactions.filter((row) => row.reaction_latency_ms === null);
  let worst = null;
  for (const row of reactions) {
    if ((row.reaction_latency_ms ?? -1) > (worst?.reaction_latency_ms ?? -1)) worst = row;
  }
  return {
    stall_timeout_s: stallTimeoutS,
    queued_commands: reactions.length,
    by_cause: byCause(reactions, stallMs),
    reaction_latency: reactions.map(({ cause, queued_at, reacted_at, reaction_latency_ms }) => ({
      cause,
      queued_at,
      reacted_at,
      reaction_latency_ms,
      reaction_latency: reaction_latency_ms === null ? null : formatDuration(reaction_latency_ms),
    })),
    idle_gap: gaps,
    violations: violations.map((row) => ({
      cause: row.cause,
      queued_at: row.queued_at,
      reaction_latency_ms: row.reaction_latency_ms,
      reaction_latency: formatDuration(row.reaction_latency_ms),
    })),
    unanswered: unanswered.length,
    worst_reaction_latency_ms: worst?.reaction_latency_ms ?? null,
    worst_reaction_latency: worst?.reaction_latency_ms == null ? null : formatDuration(worst.reaction_latency_ms),
  };
}

export function analyzeFile(file, options) {
  return analyze(parseTranscript(fs.readFileSync(file, 'utf8')), options);
}

const processIo = { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) };

export function main(argv, io = processIo) {
  const args = [...argv];
  let stallTimeoutS = DEFAULT_STALL_S;
  const flag = args.indexOf('--stall-timeout-s');
  if (flag !== -1) {
    stallTimeoutS = Number(args[flag + 1]);
    args.splice(flag, 2);
  }
  if (args.length !== 1 || !(stallTimeoutS > 0)) {
    io.stderr('usage: liveness-idle-metric.js [--stall-timeout-s N] <transcript.jsonl>\n');
    return 2;
  }
  io.stdout(`${JSON.stringify(analyzeFile(args[0], { stallTimeoutS }), null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
