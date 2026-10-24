'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createResourceGroup, removeDrainedGroup } = require('../../../packages/agent-isolation-attestation/executor');
const { containsCredential } = require('./campaign-evidence-store');

// 64 KiB of retained model text can escape to six bytes per character (\\u00XX) inside the JSON envelope.
const MAX_ENVELOPE_BYTES = 65_536 * 6 + 8192;

const STDERR_CAPTURE_CHARS = 4096;
const STDERR_KEPT_CHARS = 1024;
const TEXT_KEPT_CHARS = 512;
const DIAGNOSTIC_DEPTH = 3;
const WITHHELD = '<withheld: credential pattern>';
// Keys that could carry the prompt, model output or a secret never reach a diagnostic, whatever an adapter attaches.
const FORBIDDEN_KEY = /prompt|secret|password|credential|authorization|content|text/i;

// Key material that lost its marker. The stderr capture keeps only the last STDERR_CAPTURE_CHARS, so a PEM block can
// arrive with its BEGIN line cut off: a bare base64 body, maybe followed by a loose END line. A loose END line is a
// marker pattern like the older ones: it withholds the whole text.
const LOOSE_KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;
// Heuristic for the body itself (applied to one block at a time, see redactKeyBodies):
//  - a "full" line is base64 or base64url ([A-Za-z0-9+/_-]) of 40+ characters, optionally ending in `=` padding, that is not
//    hex-only and mixes upper case, lower case and digits (PEM wraps at 64, MIME at 76; EC keys end on a shorter line);
//  - a "tail" line (16+ characters, mixed) counts only right after two or more full lines, so a key whose last line is
//    short (EC SEC1 P-256: 64 + 64 + 36) is still caught; it ends the block;
//  - a line carrying `=` ends the block, so `=` in the middle of lines does not chain (a tampered body can escape);
//  - three lines is the threshold: two would catch pairs of digests, while real bodies run to dozens of lines and keep
//    enough of them when the capture window starts mid-block;
//  - a common line prefix (`[stderr] `, `stderr: `, a simple timestamp) is ignored when classifying a line.
// Trade-off, fail-closed per block: only the matching lines are replaced by a short marker and the rest of the text (the
// real cause of the error) is kept, but legitimate text of the same shape is lost as well: the output of `base64`, a
// wrapped data URI, three lines of mixed base64url tokens or of base64 hashes. Known limits: a one-line body (Ed25519
// PKCS8, 64 characters) cannot be told from a digest and is NOT covered; two-line bodies and lines under 40 characters
// (other than a block tail) are not covered; interleaved text breaks a block. The same heuristic is NOT applied to
// containsCredential() in campaign-evidence-store.js (retained model output, where base64 is legitimate and a false
// positive would drop evidence), nor to engineering-task-runtime.js (probe stderr) or platform-bindings.js (git stderr).
const FULL_LINE = /^[A-Za-z0-9+/_-]{40,}={0,2}$/;
const TAIL_LINE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;
// A fragment must look like key text (8+ characters with a digit or upper case), not like a word such as `oops`.
const PARTIAL_LINE = /^(?=.*[0-9A-Z])[A-Za-z0-9+/_-]{8,}$/;
const HEX_ONLY = /^[0-9a-fA-F]+$/;
const LINE_PREFIX = /^(?:\[[A-Za-z0-9 _.:-]{1,24}\]|[A-Za-z]{3,12}:|\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?)\s*/;
const MIN_BODY_LINES = 3;

const mixed = (line) => /[A-Z]/.test(line) && /[a-z]/.test(line) && /[0-9]/.test(line);
function classify(raw) {
  const line = raw.trim();
  const candidates = [line, line.replace(LINE_PREFIX, '')];
  for (const candidate of candidates) {
    if (FULL_LINE.test(candidate) && !HEX_ONLY.test(candidate) && mixed(candidate))
      return { kind: 'full', padded: candidate.endsWith('=') };
  }
  for (const candidate of candidates) {
    if (
      TAIL_LINE.test(candidate) &&
      !HEX_ONLY.test(candidate) &&
      ((/[A-Z]/.test(candidate) && /[a-z]/.test(candidate)) || /[0-9]/.test(candidate))
    )
      return { kind: 'tail', padded: candidate.endsWith('=') };
  }
  return null;
}

/**
 * Replaces each run of MIN_BODY_LINES or more key-body-like lines (see above) with `<withheld: key body, N lines>` and
 * keeps the rest. A leading fragment left by the capture window (a base64-only first line right before a block) belongs
 * to the block. Returns the text unchanged when nothing matched.
 */
function redactKeyBodies(text) {
  const lines = text.split('\n');
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= MIN_BODY_LINES) {
      const first = run[0];
      if (first === 1 && out.length === 1 && PARTIAL_LINE.test(out[0].trim().replace(LINE_PREFIX, ''))) {
        out.pop();
        run.unshift(0);
      }
      out.push(`<withheld: key body, ${run.length} lines>`);
    } else {
      for (const index of run) out.push(lines[index]);
    }
    run = [];
  };
  for (const [index, raw] of lines.entries()) {
    const kind = classify(raw);
    const joins = kind && (kind.kind === 'full' || run.length >= 2);
    if (!joins) {
      flush();
      out.push(raw);
      continue;
    }
    run.push(index);
    if (kind.kind === 'tail' || kind.padded) flush();
  }
  flush();
  return out.join('\n');
}

/** Free text for a diagnostic: checked whole for credential shapes (before any cut can split one), then cut. */
function clipText(value, limit = TEXT_KEPT_CHARS, fromEnd = false) {
  if (typeof value !== 'string') return null;
  if (containsCredential(value) || LOOSE_KEY_END.test(value)) return WITHHELD;
  const text = redactKeyBodies(value);
  if (text.length <= limit) return text;
  return fromEnd ? text.slice(-limit) : text.slice(0, limit);
}

/**
 * Structured, bounded and redacted copy of a failure description: scalars, short arrays and shallow objects with plain
 * snake_case keys. It is what the uncertain event and the error carry; the prompt and credentials are never part of it.
 */
function sanitizeDiagnostic(value, depth = 0) {
  if (typeof value === 'string') return clipText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (depth >= DIAGNOSTIC_DEPTH || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => sanitizeDiagnostic(item, depth + 1) ?? null);
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 16)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || FORBIDDEN_KEY.test(key)) continue;
    const kept = sanitizeDiagnostic(item, depth + 1);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/** Resource containment for trusted SDK clients; not a filesystem sandbox. */
async function runCampaignProcess({
  binary = process.execPath,
  args = [path.join(__dirname, 'provider-campaign-worker.js')],
  input,
  signal,
  timeout_ms,
  memory_max_bytes,
  pids_max,
}) {
  if (!(signal instanceof AbortSignal) || signal.aborted || !Number.isSafeInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > 300_000)
    throw new Error('CONTROL_CAMPAIGN_PROCESS_INVALID');
  const group = createResourceGroup({ memory_max_bytes, pids_max });
  let child;
  let timer;
  let failure;
  let timedOut = false;
  let outputLimit = false;
  const stop = () => {
    try {
      fs.writeFileSync(path.join(group, 'cgroup.kill'), '1');
    } catch {
      failure = true;
    }
    child?.kill('SIGKILL');
  };
  try {
    const encoded = JSON.stringify({ ...input, group });
    if (Buffer.byteLength(encoded) > 131_072) throw new Error('CONTROL_CAMPAIGN_PROCESS_INVALID');
    child = spawn(binary, args, { env: {}, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    // The tail of stderr is kept (bounded) as diagnostic evidence; it is never part of a result.
    let stderrTail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_CAPTURE_CHARS);
    });
    child.stderr.on('error', () => {});
    child.stdin.on('error', () => {
      failure = true;
    });
    let output = '';
    let outputBytes = 0;
    // Decode incrementally so multibyte characters split across pipe chunks are not corrupted.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_ENVELOPE_BYTES) {
        failure = true;
        outputLimit = true;
        stop();
      }
    });
    const completion = new Promise((resolve, reject) => {
      child.once('error', () => {
        failure = true;
      });
      child.once('close', (code, exitSignal) => {
        let envelope;
        try {
          envelope = JSON.parse(output);
        } catch {
          envelope = null;
        }
        if (!failure && !signal.aborted && code === 0 && envelope?.result) return resolve(envelope.result);
        // The outcome stays uncertain, but its cause is kept: how the worker ended, what it reported, the tail of stderr.
        const reported = envelope?.diagnostic;
        const worker =
          reported && typeof reported === 'object' ? { name: reported.name, code: reported.code, message: reported.message } : null;
        const error = new Error('CONTROL_OUTCOME_UNCERTAIN');
        error.code = 'CONTROL_OUTCOME_UNCERTAIN';
        error.diagnostic = sanitizeDiagnostic({
          exit_code: code,
          signal: exitSignal,
          timed_out: timedOut,
          aborted: signal.aborted,
          output_limit: outputLimit,
          worker,
          stderr: clipText(stderrTail.trim(), STDERR_KEPT_CHARS, true) ?? '',
        });
        reject(error);
      });
    });
    signal.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => {
      failure = true;
      timedOut = true;
      stop();
    }, timeout_ms);
    if (signal.aborted) stop();
    else child.stdin.end(encoded);
    return await completion;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    await removeDrainedGroup(group);
  }
}
module.exports = { runCampaignProcess, sanitizeDiagnostic, clipText };
