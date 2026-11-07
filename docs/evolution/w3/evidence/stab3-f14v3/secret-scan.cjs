'use strict';
// Secret scan for the campaign: the copied project database BEFORE any use, and every artifact AFTER the series.
// Reports only counts and file names, never the matched text.
const fs = require('node:fs');
const path = require('node:path');
const { containsCredential } = require('../../../../../tools/cli/lib/campaign-evidence-store');

const BATCH_BYTES = 256 * 1024;

/** Scans a (possibly binary) file by its printable runs, in batches. Returns { clean, hits, bytes }. */
function scanFile(file, { literals = [] } = {}) {
  const buffer = fs.readFileSync(file);
  const text = buffer.toString('latin1');
  let hits = 0;
  for (const literal of literals) if (literal && text.includes(literal)) hits += 1;
  let batch = [];
  let size = 0;
  const flush = () => {
    if (batch.length > 0 && containsCredential(batch.join('\n'))) hits += 1;
    batch = [];
    size = 0;
  };
  for (const run of text.split(/[^\u0020-\u007E\n]+/)) {
    if (run.length < 8) continue;
    batch.push(run);
    size += run.length;
    if (size >= BATCH_BYTES) flush();
  }
  flush();
  return { clean: hits === 0, hits, bytes: buffer.length };
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Scans every file under a directory; `literals` are exact strings (the API key) that must never appear. */
function scanDirectory(dir, options) {
  const files = listFiles(dir).map((file) => ({ file: path.relative(dir, file), ...scanFile(file, options) }));
  return {
    clean: files.every((item) => item.clean),
    files: files.length,
    flagged: files.filter((item) => !item.clean).map((item) => item.file),
  };
}

module.exports = { scanFile, scanDirectory };
