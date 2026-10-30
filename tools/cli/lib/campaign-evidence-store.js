'use strict';

/*
 * Contract of adapter.run() for retained model output (consumed by ProviderCampaignControl):
 *   - on retention: the receipt carries `evidence_ref {schema_version:1, kind:'model_output', sha256, bytes}`
 *     and the return value carries `output_text` (stripped before the receipt is parsed);
 *   - when the output is intentionally not retained: the receipt carries `evidence_withheld`
 *     ('too_large' | 'credential_pattern' | 'integrity_mismatch' | 'not_observable') and no ref or text; the dispatch
 *     stays valid. 'not_observable' means the adapter never sees the text (its client only reports a digest);
 *   - an adapter that declares a ref but fails the checks below invalidates the receipt (CONTROL_OUTCOME_UNCERTAIN).
 * Retention is EVIDENCE_RETENTION_DAYS days from the last time the same content was retained (storeEvidence renews the
 * mtime on repeated content); pruneEvidence removes what expired and runs from storeEvidence at most once a day per state.
 * A read of an artifact that is gone after its receipt passed the window answers CONTROL_CAMPAIGN_EVIDENCE_EXPIRED.
 * Retained text is withheld ('credential_pattern') when it matches containsCredential() or carries a private-key DER/OpenSSH
 * header followed by key text, even without a BEGIN marker; the broad base64-body heuristic is not applied to it.
 * An artifact written before its receipt transaction commits (crash in between) is an unreferenced, harmless orphan.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_EVIDENCE_BYTES = 65_536;
const EVIDENCE_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
// A temporary file older than this is the leftover of a crashed write.
const ORPHAN_TEMPORARY_MS = DAY_MS;
const PRUNE_INTERVAL_MS = DAY_MS;
const ADDRESS = /^[a-f0-9]{64}$/;
const lastPrune = new Map();
const DIRECTORY = 'campaign-evidence';
// Conservative credential shapes; a match withholds the artifact instead of persisting it.
const CREDENTIAL_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{32,}/,
  /\bAuthorization["']?\s*[:=]\s*["']?(?:Basic|Bearer|Token)\s+[A-Za-z0-9+/=._~-]{8,}/i,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\b[sr]k_live_[A-Za-z0-9]{16,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
];
const MIN_KNOWN_SECRET = 8;
// key = literal assignments; unquoted values only count when they cannot be an expression or a plain identifier.
const ASSIGNMENT =
  /(?<![A-Za-z0-9])(?:password|passwd|secret|api_?key|token|aws_secret_access_key)[A-Za-z_]*["']?\s*[=:]\s*(?:"([^"\s]{6,})"|'([^'\s]{6,})'|([^\s"',;(){}[\]]{6,}))/gi;
function literalAssignment(text) {
  for (const match of text.matchAll(ASSIGNMENT)) {
    if (match[1] || match[2]) return true;
    const value = match[3];
    const next = text[match.index + match[0].length];
    if (next === '(' || next === '.' || next === '[') continue;
    const mixed =
      /^[A-Za-z0-9+/_=-]+$/.test(value) &&
      /[a-z]/.test(value) &&
      /[A-Z]/.test(value) &&
      value.length >= 12 &&
      !/^[a-z]+(?:[A-Z][a-z]+)+$/.test(value);
    if (/\d/.test(value) && /[A-Za-z]/.test(value)) return true;
    if (mixed) return true;
  }
  return false;
}

// Key material that lost its marker. A stderr capture keeps only the last characters, so a PEM block can arrive with its
// BEGIN line cut off: a bare base64 body, maybe followed by a loose END line. A loose END line is a marker pattern like
// the older ones: it withholds the whole text.
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
// A one-line body (Ed25519 PKCS8 is 64 characters, or any key joined into a line) cannot be told from a digest by shape,
// so it is recognised by what it contains: the DER header of a private key (PKCS8 Ed25519/X25519/RSA/EC, PKCS1 RSA, SEC1
// EC) or the OpenSSH key envelope, at ANY position of a base64 sequence (`key=`, `?k=`, `path/`, a JSON value), with 20+
// characters after it; everything from the header to the end of the sequence is replaced. Digests and hashes do not
// contain these headers. A header that ends its line opens a block, so the following lines of a wrapped body go too, and
// the glued last line of a block (base64 of 16+ characters followed by text or `"}`) is taken as the block tail.
// A literal `\n` (JSON-escaped text) separates lines like a real newline.
// Trade-off, fail-closed per block: only the matching lines are replaced by a short marker and the rest of the text (the
// real cause of the error) is kept, but legitimate text of the same shape is lost as well: the output of `base64`, a
// wrapped data URI, three lines of mixed base64url tokens or of base64 hashes. Known limits: two-line bodies without a
// recognised header and lines under 40 characters (other than a block tail) are not covered; interleaved text breaks a
// block; a glued last line under 16 characters stays; an encrypted PKCS8 key or a one-line body of a format not listed
// above is not recognised. The heuristic is NOT applied to containsCredential()
// (retained model output, where base64 is legitimate and a false positive would drop evidence); diagnostic texts call
// redactDiagnosticText() instead.
const FULL_LINE = /^[A-Za-z0-9+/_-]{40,}={0,2}$/;
const TAIL_LINE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;
// A fragment must look like key text (8+ characters with a digit or upper case), not like a word such as `oops`.
const PARTIAL_LINE = /^(?=.*[0-9A-Z])[A-Za-z0-9+/_-]{8,}$/;
const HEX_ONLY = /^[0-9a-fA-F]+$/;
const LINE_PREFIX = /^(?:\[[A-Za-z0-9 _.:-]{1,24}\]|[A-Za-z]{3,12}:|\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?)\s*/;
const MIN_BODY_LINES = 3;
// DER headers of private keys, as base64: PKCS8 Ed25519/X25519 (`MC4CAQAwBQYDK2V`), PKCS8 RSA, PKCS1 RSA, PKCS8 EC, SEC1 EC
// (P-256 uses the short length form, `MHcCAQEE`), and the OpenSSH envelope (`openssh-key-v1`). The wildcard spans carry
// the length bytes of the structure. Public keys (SPKI) start differently and are not matched.
const KEY_HEADER =
  '(?:MC4CAQAwBQYDK2V[a-z]|MII[A-Za-z0-9+/]{3}IBADANBgkqhkiG9w0BAQEFAASC|MII[A-Za-z0-9+/]{3}IBAAK|' +
  'MI[GH][A-Za-z0-9+/]AgEAMB|MI[GH][A-Za-z0-9+/]AgEBB|MHcCAQEEI|b3BlbnNzaC1rZXktdjE)';
const ANCHOR_LINE = new RegExp(`^${KEY_HEADER}[A-Za-z0-9+/_-]{20,}={0,2}$`);
const SINGLE_LINE_BODY = new RegExp(`${KEY_HEADER}[A-Za-z0-9+/_-]{20,}={0,2}`, 'g');
// Narrow check for retained output: a private-key DER/OpenSSH header followed by 20+ base64 characters, anywhere in the text.
const KEY_HEADER_BODY = new RegExp(`${KEY_HEADER}[A-Za-z0-9+/_-]{20,}`);
const END_ANCHOR = new RegExp(`${KEY_HEADER}[A-Za-z0-9+/_-]{20,}={0,2}$`);
// The last line of a block glued to text or to the `"}` of a JSON value: its base64 head is key text.
const GLUED_TAIL = /^[A-Za-z0-9+/_-]{16,}={0,2}(?![A-Za-z0-9+/_=-])/;

const keyText = (text) => (/[A-Z]/.test(text) && /[a-z]/.test(text)) || /[0-9]/.test(text);
const mixed = (line) => /[A-Z]/.test(line) && /[a-z]/.test(line) && /[0-9]/.test(line);
function classify(raw) {
  const line = raw.trim();
  const candidates = [line, line.replace(LINE_PREFIX, '')];
  // A line that is a private-key header followed by body is certain by itself: it opens a block of any length.
  for (const candidate of candidates) {
    if (ANCHOR_LINE.test(candidate)) return { kind: 'full', padded: candidate.endsWith('='), anchor: true };
  }
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
  const normalized = text.replaceAll(String.raw`\n`, '\n');
  const redacted = redactLines(normalized);
  return redacted === normalized ? text : redacted;
}
function redactLines(text) {
  const lines = text.split('\n');
  const out = [];
  let run = [];
  let anchored = false;
  let lead = '';
  const flush = () => {
    if (run.length >= MIN_BODY_LINES || anchored) {
      const first = run[0];
      if (first === 1 && out.length === 1 && PARTIAL_LINE.test(out[0].trim().replace(LINE_PREFIX, ''))) {
        out.pop();
        run.unshift(0);
      }
      out.push(`${lead}<withheld: key body, ${run.length === 1 ? '1 line' : `${run.length} lines`}>`);
    } else {
      for (const index of run) out.push(lines[index]);
    }
    run = [];
    anchored = false;
    lead = '';
  };
  for (const [index, raw] of lines.entries()) {
    let kind = classify(raw);
    const ending = kind?.anchor ? null : END_ANCHOR.exec(raw.trimEnd());
    if (ending) kind = { kind: 'full', padded: raw.trimEnd().endsWith('='), anchor: true, lead: raw.slice(0, ending.index) };
    const joins = kind && (kind.kind === 'full' || run.length >= 2 || (anchored && run.length > 0));
    if (!joins) {
      const inBlock = run.length >= MIN_BODY_LINES || anchored;
      flush();
      // A header inside a longer line (`key=MIIE…`, a JSON value) is replaced in place.
      const glued = inBlock ? GLUED_TAIL.exec(raw) : null;
      const rest = glued && keyText(glued[0]) ? raw.slice(glued[0].length) : raw;
      out.push(rest.replaceAll(SINGLE_LINE_BODY, '<withheld: key body, 1 line>'));
      continue;
    }
    if (kind.anchor) {
      flush();
      anchored = true;
      lead = kind.lead ?? '';
    }
    run.push(index);
    if (kind.kind === 'tail' || kind.padded) flush();
  }
  flush();
  return out.join('\n');
}

/** Text for a diagnostic or an error message: null when it carries a credential shape, else with key bodies replaced. */
function redactDiagnosticText(text) {
  if (containsCredential(text) || LOOSE_KEY_END.test(text)) return null;
  return redactKeyBodies(text);
}

function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
function containsCredential(text, known = []) {
  return (
    CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text)) ||
    literalAssignment(text) ||
    known.some((value) => typeof value === 'string' && value.length >= MIN_KNOWN_SECRET && text.includes(value))
  );
}

/**
 * Persist model output content-addressed under the control state; the caller's reference must describe the text exactly.
 * Writes go to an exclusive temporary file, are fsynced and renamed, so a crash never leaves a truncated final name.
 * Retaining the same content again renews its retention window. Returns { repaired } when a damaged artifact already
 * occupied the content address and was replaced.
 */
function storeEvidence(state, text, ref, { now = Date.now() } = {}) {
  if (typeof text !== 'string') fail('CONTROL_PROVIDER_RECEIPT_INVALID');
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length > MAX_EVIDENCE_BYTES || buffer.length !== ref.bytes || sha256(buffer) !== ref.sha256 || containsCredential(text))
    fail('CONTROL_PROVIDER_RECEIPT_INVALID');
  const directory = path.join(state, DIRECTORY);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, ref.sha256);
  if (!(now - (lastPrune.get(state) ?? Number.NEGATIVE_INFINITY) < PRUNE_INTERVAL_MS)) {
    lastPrune.set(state, now);
    pruneEvidence(state, { now });
  }
  if (isDirectory(target)) fail('CONTROL_CAMPAIGN_EVIDENCE_CORRUPT');
  let repaired = false;
  if (fs.existsSync(target) || isLink(target)) {
    try {
      if (readEvidence(state, ref) === text) {
        fs.utimesSync(target, now / 1000, now / 1000);
        return { repaired };
      }
    } catch (error) {
      if (error.code !== 'CONTROL_CAMPAIGN_EVIDENCE_CORRUPT' && error.code !== 'CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE') throw error;
    }
    repaired = true;
  }
  const temporary = path.join(directory, `.tmp-${randomUUID()}`);
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    let offset = 0;
    while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temporary, target);
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {
      // already closed
    }
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { repaired };
}
/**
 * Removes artifacts whose mtime passed EVIDENCE_RETENTION_DAYS and orphan `.tmp-*` files older than a day. Only regular
 * files directly inside the store directory are touched: links, directories and unknown names stay.
 */
function pruneEvidence(state, { now = Date.now() } = {}) {
  const directory = path.join(state, DIRECTORY);
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch {
    return { removed: 0 };
  }
  let removed = 0;
  for (const name of names) {
    const limit = name.startsWith('.tmp-') ? ORPHAN_TEMPORARY_MS : ADDRESS.test(name) ? EVIDENCE_RETENTION_DAYS * DAY_MS : null;
    if (limit === null) continue;
    try {
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || now - stat.mtimeMs <= limit) continue;
      fs.unlinkSync(filename);
      removed++;
    } catch {
      // vanished or not removable: the next pass retries
    }
  }
  return { removed };
}
function isDirectory(filename) {
  try {
    return fs.lstatSync(filename).isDirectory();
  } catch {
    return false;
  }
}
function isLink(filename) {
  try {
    return fs.lstatSync(filename).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Read and re-verify a stored artifact; every discrepancy is explicit. */
function readEvidence(state, ref) {
  let fd;
  try {
    fd = fs.openSync(path.join(state, DIRECTORY, ref.sha256), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (error) {
    if (error.code === 'ENOENT') fail('CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE');
    fail('CONTROL_CAMPAIGN_EVIDENCE_CORRUPT');
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== ref.bytes || stat.size > MAX_EVIDENCE_BYTES)
      fail('CONTROL_CAMPAIGN_EVIDENCE_CORRUPT');
    const buffer = Buffer.alloc(stat.size);
    if (fs.readSync(fd, buffer, 0, buffer.length, 0) !== stat.size || sha256(buffer) !== ref.sha256)
      fail('CONTROL_CAMPAIGN_EVIDENCE_CORRUPT');
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Why retained output must not be persisted; null when the text may be kept, undefined when the worker returned none. */
function withholdReason(result, secrets) {
  const { text, text_too_large: tooLarge } = result;
  if (tooLarge === true) return 'too_large';
  if (text === undefined) return;
  if (typeof text !== 'string') return 'integrity_mismatch';
  if (Buffer.byteLength(text) > MAX_EVIDENCE_BYTES) return 'too_large';
  if (sha256(Buffer.from(text, 'utf8')) !== result.text_sha256) return 'integrity_mismatch';
  // The broad multi-line body heuristic stays out of here (base64 is legitimate model output); the header rule is narrow.
  return containsCredential(text, secrets) || KEY_HEADER_BODY.test(text) ? 'credential_pattern' : null;
}
/** Splits a worker result into the attested summary and the receipt fields that retain or withhold the output text. */
function retainOutput(result, secrets) {
  const { text, text_too_large: _tooLarge, ...attested } = result;
  const withheld = withholdReason(result, secrets);
  const fields =
    withheld === null
      ? {
          evidence_ref: { schema_version: 1, kind: 'model_output', sha256: result.text_sha256, bytes: Buffer.byteLength(text) },
          output_text: text,
        }
      : withheld
        ? { evidence_withheld: withheld }
        : {};
  return { attested, fields };
}

module.exports = {
  MAX_EVIDENCE_BYTES,
  EVIDENCE_RETENTION_DAYS,
  withholdReason,
  retainOutput,
  pruneEvidence,
  containsCredential,
  redactKeyBodies,
  redactDiagnosticText,
  storeEvidence,
  readEvidence,
  evidenceSha256: sha256,
};
