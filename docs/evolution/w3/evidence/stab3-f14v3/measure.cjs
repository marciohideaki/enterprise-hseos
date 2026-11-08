'use strict';
// Final-source meter of the F14 v3 campaign. The final content of the task file is NOT read from a particular tool name or
// from the model's own claim: it is rebuilt from the ledger by applying, in call order, every write or patch that the product
// reports as succeeded, to the initial skeleton. The tool names and input shapes are the ones the product writes in its
// ledger (`engineering.write`: path, expected_sha256, content; `engineering.patch`: path, expected_sha256, before, after,
// optional within). The provider API renames dots in tool names; the ledger keeps the product name.
// Anything that cannot be rebuilt is `no-final-write` WITH a reason, never silence and never an approval.
const { createHash } = require('node:crypto');

const sha = (value) => createHash('sha256').update(value).digest('hex');
const WRITE = 'engineering.write';
const PATCH = 'engineering.patch';

/** Same lines the product counts: the text split on \n. */
const lineStart = (content, line) => {
  let offset = 0;
  for (let index = 1; index < line; index += 1) offset = content.indexOf('\n', offset) + 1;
  return offset;
};

/** Mirrors the product's anchored patch: `before` must occur exactly once (in the `within` line range, when given). */
function applyPatch(current, input) {
  if (typeof input.before !== 'string' || typeof input.after !== 'string' || input.before.length === 0) return null;
  let from = 0;
  let to = current.length;
  if (input.within) {
    const lines = current.split('\n');
    const { start_line: start, end_line: end } = input.within;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || start > lines.length) return null;
    from = lineStart(current, start);
    to = from + lines.slice(start - 1, Math.min(end, lines.length)).join('\n').length;
  }
  const parts = current.slice(from, to).split(input.before);
  if (parts.length !== 2) return null;
  const at = from + parts[0].length;
  return current.slice(0, at) + input.after + current.slice(at + input.before.length);
}

/**
 * events: the session events read from the ledger. initial: the skeleton the task starts from. file: the task file.
 * Returns { source, reason, applied, sha_checked, sha_mismatch }; source is null when nothing could be rebuilt.
 *   reason: 'ok' | 'no-write' | 'patch-failed' | 'unknown-tool-format'
 */
function reconstructFinalSource(events, initial, file) {
  const completed = new Map();
  for (const event of events) {
    if (event.event_type === 'tool.execution.completed') completed.set(event.payload.step_id, event.payload.outcome);
  }
  let state = initial;
  let applied = 0;
  let shaChecked = 0;
  for (const event of events) {
    if (event.event_type !== 'tool.execution.started') continue;
    const { name, input, step_id: stepId } = event.payload;
    const outcome = completed.get(stepId);
    if (outcome?.status !== 'succeeded' || outcome.error) continue;
    const writes = typeof name === 'string' && /write|patch|edit/i.test(name);
    if (!writes) continue;
    if (name !== WRITE && name !== PATCH)
      return { source: null, reason: 'unknown-tool-format', applied, sha_checked: shaChecked, detail: String(name).slice(0, 60) };
    if (!input || typeof input.path !== 'string')
      return { source: null, reason: 'unknown-tool-format', applied, sha_checked: shaChecked, detail: `${name}: input` };
    if (input.path !== file) continue;
    let next;
    if (name === WRITE) {
      if (typeof input.content !== 'string')
        return { source: null, reason: 'unknown-tool-format', applied, sha_checked: shaChecked, detail: `${name}: content` };
      next = input.content;
    } else {
      if (typeof input.before !== 'string' || typeof input.after !== 'string')
        return { source: null, reason: 'unknown-tool-format', applied, sha_checked: shaChecked, detail: `${name}: before/after` };
      next = sha(state) === input.expected_sha256 ? applyPatch(state, input) : null;
      if (next === null) return { source: null, reason: 'patch-failed', applied, sha_checked: shaChecked };
    }
    const reported = outcome.result?.sha256;
    if (typeof reported === 'string') {
      shaChecked += 1;
      if (sha(next) !== reported) return { source: null, reason: 'sha-mismatch', applied, sha_checked: shaChecked, sha_mismatch: true };
    }
    state = next;
    applied += 1;
  }
  return applied === 0
    ? { source: null, reason: 'no-write', applied, sha_checked: shaChecked }
    : { source: state, reason: 'ok', applied, sha_checked: shaChecked };
}

module.exports = { reconstructFinalSource, applyPatch, WRITE, PATCH };
