'use strict';
// usage: node summarize-whole-file.cjs <dir> [--accept-no-network-isolation]
// <dir> holds original.txt, final.txt and spec.json ({ requiredExports, preservedSegments, checks }). Prints the verdict as JSON;
// exit 0 only for `pass`. A pass on a host without a network namespace (`network_isolation: "none"`) is reported as `unknown`
// unless --accept-no-network-isolation is given; the flag is then recorded in the output.
const fs = require('node:fs');
const path = require('node:path');
const { evaluateWholeFile } = require('./whole-file-check.cjs');

function readOptional(file, parse = (text) => text) {
  try {
    return parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function summarizeWholeFile(dir, { acceptNoNetworkIsolation = false } = {}) {
  const spec = readOptional(path.join(dir, 'spec.json'), JSON.parse) || {};
  const result = evaluateWholeFile({
    original: readOptional(path.join(dir, 'original.txt')),
    final: readOptional(path.join(dir, 'final.txt')),
    requiredExports: spec.requiredExports,
    preservedSegments: spec.preservedSegments,
    checks: spec.checks,
  });
  if (result.network_isolation !== 'none') return result;
  if (acceptNoNetworkIsolation) return { ...result, accepted_no_network_isolation: true };
  if (result.verdict !== 'pass') return result;
  return { ...result, verdict: 'unknown', underlying_verdict: 'pass', unknown: ['network-isolation-none'] };
}

if (require.main === module) {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir || rest.some((arg) => arg !== '--accept-no-network-isolation'))
    throw new Error('usage: node summarize-whole-file.cjs <dir> [--accept-no-network-isolation]');
  const result = summarizeWholeFile(dir, { acceptNoNetworkIsolation: rest.length > 0 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.verdict === 'pass' ? 0 : 1;
}

module.exports = { summarizeWholeFile };
