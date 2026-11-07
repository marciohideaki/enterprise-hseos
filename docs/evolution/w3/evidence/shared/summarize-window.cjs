'use strict';
// usage: node summarize-window.cjs <campaign-dir> --declared N --max-output N [--effective N] [--model-window N]
// Reads body_bytes from <campaign-dir>/provider-requests.jsonl (written by the shared fetch guard) and evaluates the declared window.
const fs = require('node:fs');
const path = require('node:path');
const { evaluateWindow } = require('./backend-window.cjs');

function summarizeWindow(lines, options) {
  const sizes = lines.map((line) => line.body_bytes).filter((value) => Number.isInteger(value) && value > 0);
  return evaluateWindow({ ...options, largestRequestBytes: sizes.length > 0 ? Math.max(...sizes) : undefined });
}

if (require.main === module) {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir)
    throw new Error('usage: node summarize-window.cjs <campaign-dir> --declared N --max-output N [--effective N] [--model-window N]');
  const option = (name) => {
    const index = rest.indexOf(name);
    return index === -1 ? undefined : Number(rest[index + 1]);
  };
  const lines = fs
    .readFileSync(path.join(dir, 'provider-requests.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const result = summarizeWindow(lines, {
    declaredContextTokens: option('--declared'),
    maxOutputTokens: option('--max-output'),
    modelWindow: option('--model-window'),
    effectiveContext: option('--effective'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.verdict === 'pass' ? 0 : 1;
}

module.exports = { summarizeWindow };
