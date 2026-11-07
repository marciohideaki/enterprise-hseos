'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { evaluateWindow } = require('../docs/evolution/w3/evidence/shared/backend-window.cjs');

const SUMMARIZE = path.join(__dirname, '../docs/evolution/w3/evidence/shared/summarize-window.cjs');
const BASE = {
  declaredContextTokens: 16_384,
  maxOutputTokens: 1024,
  modelWindow: 32_768,
  effectiveContext: 16_384,
  largestRequestBytes: 7400,
};

test('an unknown effective context is never approved', () => {
  for (const effectiveContext of [null, undefined]) {
    const result = evaluateWindow({ ...BASE, effectiveContext });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.effective_context, null);
  }
});

test('a declaration above the effective context is a false declaration', () => {
  const result = evaluateWindow({ ...BASE, effectiveContext: 4096 });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.failures.includes('declaration-exceeds-backend'));
});

test('a request that does not fit the declared window with the output cap fails admission', () => {
  assert.equal(evaluateWindow({ ...BASE, largestRequestBytes: 15_360 }).verdict, 'pass');
  const result = evaluateWindow({ ...BASE, largestRequestBytes: 15_361 });
  assert.equal(result.verdict, 'fail');
  assert.deepEqual(result.failures, ['admission-exceeded']);
});

test('a failure is reported even when the effective context is unknown', () => {
  assert.equal(evaluateWindow({ ...BASE, effectiveContext: null, largestRequestBytes: 20_000 }).verdict, 'fail');
});

test('the summarizer reads the largest body_bytes of the request log', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-window-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'provider-requests.jsonl'),
      [{ body_bytes: 3000 }, { body_bytes: 9000 }].map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
    const run = (...extra) =>
      spawnSync(process.execPath, [SUMMARIZE, dir, '--declared', '16384', '--max-output', '1024', '--model-window', '32768', ...extra], {
        encoding: 'utf8',
      });
    const ok = run('--effective', '16384');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).largest_request_bytes, 9000);
    assert.equal(JSON.parse(ok.stdout).verdict, 'pass');
    const unknown = run();
    assert.equal(JSON.parse(unknown.stdout).verdict, 'unknown');
    assert.notEqual(unknown.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing or invalid largest request is unknown, never approved', () => {
  for (const largestRequestBytes of [null, undefined, Number.NaN, '7400', 0, -1, 7400.5, Number.POSITIVE_INFINITY]) {
    const result = evaluateWindow({ ...BASE, largestRequestBytes });
    assert.equal(result.verdict, 'unknown', String(largestRequestBytes));
    assert.ok(result.unknown.includes('largest-request-bytes'));
  }
});

test('an invalid output cap fails', () => {
  for (const maxOutputTokens of ['1024', null, undefined, Number.NaN, -1]) {
    const result = evaluateWindow({ ...BASE, maxOutputTokens });
    assert.equal(result.verdict, 'fail', String(maxOutputTokens));
    assert.ok(result.failures.includes('max-output-invalid'));
  }
});

test('a missing or invalid model window is unknown and a declaration above it fails', () => {
  for (const modelWindow of [null, undefined, Number.NaN, '32768', 0]) {
    assert.equal(evaluateWindow({ ...BASE, modelWindow }).verdict, 'unknown', String(modelWindow));
  }
  const result = evaluateWindow({ ...BASE, modelWindow: 8192 });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.failures.includes('declaration-exceeds-model-window'));
});

test('the summarizer never approves an empty log, a log without body_bytes or a missing directory', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-window-'));
  try {
    const args = ['--declared', '16384', '--max-output', '1024', '--model-window', '32768', '--effective', '32768'];
    const run = (target) => spawnSync(process.execPath, [SUMMARIZE, target, ...args], { encoding: 'utf8' });
    for (const content of [
      '',
      '\n',
      `${JSON.stringify({ n: 1 })}\n${JSON.stringify({ body_bytes: '9' })}\n${JSON.stringify({ body_bytes: 0 })}\n`,
    ]) {
      fs.writeFileSync(path.join(dir, 'provider-requests.jsonl'), content);
      const result = run(dir);
      assert.notEqual(result.status, 0);
      assert.equal(JSON.parse(result.stdout).verdict, 'unknown');
    }
    const missing = run(path.join(dir, 'absent'));
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /ENOENT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
