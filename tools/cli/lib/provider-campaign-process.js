'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createResourceGroup, removeDrainedGroup } = require('../../../packages/agent-isolation-attestation/executor');
const { orphanTokenEnv } = require('../../../packages/agent-isolation-attestation/profiles');
const { redactDiagnosticText } = require('./campaign-evidence-store');

// 64 KiB of retained model text can escape to six bytes per character (\\u00XX) inside the JSON envelope.
const MAX_ENVELOPE_BYTES = 65_536 * 6 + 8192;

const STDERR_CAPTURE_CHARS = 4096;
const STDERR_KEPT_CHARS = 1024;
const TEXT_KEPT_CHARS = 512;
const DIAGNOSTIC_DEPTH = 3;
const WITHHELD = '<withheld: credential pattern>';
// Keys that could carry the prompt, model output or a secret never reach a diagnostic, whatever an adapter attaches.
const FORBIDDEN_KEY = /prompt|secret|password|credential|authorization|content|text/i;

/** Free text for a diagnostic: checked whole for credential shapes and key bodies (before any cut can split one), then cut. */
function clipText(value, limit = TEXT_KEPT_CHARS, fromEnd = false) {
  if (typeof value !== 'string') return null;
  const text = redactDiagnosticText(value);
  if (text === null) return WITHHELD;
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
    child = spawn(binary, args, { env: orphanTokenEnv(), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
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
