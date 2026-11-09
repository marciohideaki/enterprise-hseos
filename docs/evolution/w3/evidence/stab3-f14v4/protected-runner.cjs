'use strict';
// Child process of the protected tests of the F14 v4 campaign: loads the candidate file and evaluates the cases. Prints one JSON line.
// usage: node protected-runner.cjs <candidate-file> <cases-json>
// Differs from the v3 runner in one point: values are compared with node:util isDeepStrictEqual, so an object matches whatever its key
// order, while undefined, NaN, -0 and a changed type are still told apart. The v3 runner compared JSON.stringify, where the key order
// of an object would fail a correct answer.
// The candidate is untrusted model output: the parent runs this with a timeout, a minimal environment and no secrets.
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const [file, casesJson] = process.argv.slice(2);
const cases = JSON.parse(casesJson);
const results = [];
let loadError = null;
let fn = null;
try {
  const loaded = require(path.resolve(file));
  fn = typeof loaded === 'function' ? loaded : loaded?.default;
  if (typeof fn !== 'function') loadError = 'export-not-a-function';
} catch (error) {
  loadError = `load-failed:${error?.name}`;
}
for (const testCase of cases) {
  if (loadError) {
    results.push({ id: testCase.id, pass: false, reason: loadError });
    continue;
  }
  try {
    const actual = fn(...testCase.args);
    const pass = !testCase.throws && isDeepStrictEqual(actual, testCase.expected);
    results.push({ id: testCase.id, pass, reason: pass ? 'ok' : testCase.throws ? `no-throw:${testCase.throws}` : 'value-mismatch' });
  } catch (error) {
    const pass = Boolean(testCase.throws) && error instanceof globalThis[testCase.throws];
    results.push({ id: testCase.id, pass, reason: pass ? 'ok' : `threw:${error?.constructor?.name}` });
  }
}
process.stdout.write(`${JSON.stringify(results)}\n`);
