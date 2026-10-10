'use strict';

/*
 * Contract of adapter.run() for retained model output (consumed by ProviderCampaignControl):
 *   - on retention: the receipt carries `evidence_ref {schema_version:1, kind:'model_output', sha256, bytes}`
 *     and the return value carries `output_text` (stripped before the receipt is parsed);
 *   - when the output is intentionally not retained: the receipt carries `evidence_withheld`
 *     ('too_large' | 'credential_pattern' | 'integrity_mismatch') and no ref or text; the dispatch stays valid;
 *   - an adapter that declares a ref but fails the checks below invalidates the receipt (CONTROL_OUTCOME_UNCERTAIN).
 * An artifact written before its receipt transaction commits (crash in between) is an unreferenced, harmless orphan.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_EVIDENCE_BYTES = 65_536;
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
 * Returns { repaired } when a damaged artifact already occupied the content address and was replaced.
 */
function storeEvidence(state, text, ref) {
  if (typeof text !== 'string') fail('CONTROL_PROVIDER_RECEIPT_INVALID');
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length > MAX_EVIDENCE_BYTES || buffer.length !== ref.bytes || sha256(buffer) !== ref.sha256 || containsCredential(text))
    fail('CONTROL_PROVIDER_RECEIPT_INVALID');
  const directory = path.join(state, DIRECTORY);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, ref.sha256);
  if (isDirectory(target)) fail('CONTROL_CAMPAIGN_EVIDENCE_CORRUPT');
  let repaired = false;
  if (fs.existsSync(target) || isLink(target)) {
    try {
      if (readEvidence(state, ref) === text) return { repaired };
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

module.exports = { MAX_EVIDENCE_BYTES, containsCredential, storeEvidence, readEvidence, evidenceSha256: sha256 };
