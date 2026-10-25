'use strict';
// Diagnostic redaction of key material that lost its marker: the stderr tail keeps only the last 4096 characters, so a
// PEM block can reach the diagnostic as a bare base64 body (BEGIN cut off) with, at most, a loose END line.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { clipText, sanitizeDiagnostic } = require('../tools/cli/lib/provider-campaign-process');

const WITHHELD = '<withheld: credential pattern>';
const STDERR_CAPTURE_CHARS = 4096;
const marker = (lines) => `<withheld: key body, ${lines} lines>`;

// Deterministic base64 of exactly `width` characters per counter value (hash-derived, no randomness). Every line has
// upper case, lower case and a digit, as real random base64 does at these widths.
let counter = 0;
function row(width, url = false) {
  for (;;) {
    counter += 1;
    let text = '';
    for (let block = 0; text.length < width; block++)
      text += createHash('sha512').update(`h9-${counter}-${block}`).digest('base64').replaceAll('=', '');
    text = text.slice(0, width);
    if (url) text = text.replaceAll('+', '-').replaceAll('/', '_');
    if (/[A-Z]/.test(text) && /[a-z]/.test(text) && /[0-9]/.test(text) && !/^[0-9a-fA-F]+$/.test(text)) return text;
  }
}
// A wrapped body: `lines` full rows, the last one padded; `lastWidth` shortens the final row (EC keys end short).
function body(lines, width, { lastWidth = width, padding = '=', url = false } = {}) {
  const rows = Array.from({ length: lines }, (_, i) => row(i === lines - 1 ? lastWidth : width, url));
  rows[lines - 1] = rows.at(-1).slice(0, lastWidth - padding.length) + padding;
  return rows;
}
// What the capture does to stderr: keep the last 4096 characters, so the BEGIN marker falls off the front.
const tail = (text) => text.slice(-STDERR_CAPTURE_CHARS);
const diagnosticOf = (stderr) => clipText(tail(stderr).trim(), 1024, true);
const leaks = (output, rows) => rows.some((line) => output.includes(line.slice(0, 30)));

for (const width of [64, 76]) {
  test(`a ${width}-column key body whose BEGIN marker was cut off is replaced, the error cause is kept`, () => {
    const rows = body(90, width);
    const pem = ['-----BEGIN ' + 'RSA PRIVATE KEY-----', ...rows, ''].join('\n');
    const stderr = `${'noise line\n'.repeat(400)}${pem}worker failed: ECONNRESET\n`;
    assert.equal(tail(stderr).includes('-----BEGIN'), false, 'the fixture must lose its marker');
    const out = diagnosticOf(stderr);
    assert.match(out, /<withheld: key body, \d+ lines>/);
    assert.match(out, /worker failed: ECONNRESET$/);
    assert.equal(leaks(out, rows), false);
  });

  test(`a ${width}-column body with no marker anywhere is replaced`, () => {
    const rows = body(12, width);
    assert.equal(clipText(`failed:\n${rows.join('\n')}\n`), `failed:\n${marker(12)}\n`);
  });
}

test('a tail that starts in the middle of the body takes the partial first line into the block', () => {
  const rows = body(10, 64);
  rows[0] = rows[0].slice(55);
  assert.equal(clipText(rows.join('\n')), marker(10));
});

test('a body without padding and with CRLF line ends is replaced', () => {
  assert.equal(clipText(body(8, 64, { padding: '' }).join('\r\n')), marker(8));
});

test('a loose END marker alone still withholds the whole text', () => {
  assert.equal(clipText('trailing\n-----END OPENSSH PRIVATE KEY-----\n'), WITHHELD);
});

test('the threshold is three lines: two are kept, three are replaced', () => {
  const rows = [row(64), row(64), row(64)];
  assert.equal(clipText(`ctx\n${rows.slice(0, 2).join('\n')}\nafter\n`), `ctx\n${rows.slice(0, 2).join('\n')}\nafter\n`);
  assert.equal(clipText(`ctx\n${rows.join('\n')}\nafter\n`), `ctx\n${marker(3)}\nafter\n`);
});

test('the column threshold is 40: lines of 39 are kept, lines of 40 are replaced', () => {
  const short = [row(39), row(39), row(39), row(39)];
  assert.equal(clipText(short.join('\n')), short.join('\n'));
  const full = [row(40), row(40), row(40)];
  assert.equal(clipText(full.join('\n')), marker(3));
});

test('an EC SEC1 P-256 shaped body (64 + 64 + 36 columns) is replaced through its short last line', () => {
  const rows = body(3, 64, { lastWidth: 36 });
  assert.equal(rows[2].length, 36);
  assert.equal(clipText(`oops\n${rows.join('\n')}\nexit 1`), `oops\n${marker(3)}\nexit 1`);
});

test('a short last line right after only one full line is not a block', () => {
  const rows = [row(64), row(20)];
  assert.equal(clipText(rows.join('\n')), rows.join('\n'));
});

test('base64url bodies and prefixed lines are replaced', () => {
  assert.equal(clipText(body(6, 64, { url: true }).join('\n')), marker(6));
  const prefixed = body(6, 64).map((line) => `[stderr] ${line}`);
  assert.equal(clipText(prefixed.join('\n')), marker(6));
  const labelled = body(6, 64).map((line) => `stderr: ${line}`);
  assert.equal(clipText(labelled.join('\n')), marker(6));
  const stamped = body(6, 64).map((line) => `2026-10-23T21:00:00.123Z ${line}`);
  assert.equal(clipText(stamped.join('\n')), marker(6));
});

test('padding in the middle ends a block: it does not chain across padded lines', () => {
  const lines = [row(64), `${row(62)}==`, row(64), `${row(62)}==`, row(64), row(64)];
  assert.equal(clipText(lines.join('\n')), lines.join('\n'));
});

test('an interrupted run does not accumulate across other lines', () => {
  const rows = body(4, 64);
  const text = `${rows[0]}\n${rows[1]}\nerror: something failed\n${rows[2]}\n${rows[3]}\n`;
  assert.equal(clipText(text), text);
});

test('multi-line hex (digests) is never replaced, even when long and mixed-looking', () => {
  // Mixed-case hex: it passes the upper/lower/digit check, so only the hex guard keeps it out.
  const hex = ['aB3dEf90'.repeat(8), 'Fe12cD4b'.repeat(8), 'c0DeB1a9'.repeat(8), '9aF8eD7c'.repeat(8)];
  assert.equal(clipText(hex.join('\n')), hex.join('\n'));
});

test('the diagnostic path replaces it too', () => {
  const out = sanitizeDiagnostic({ stderr: body(6, 64).join('\n'), exit_code: 1 });
  assert.equal(out.stderr, marker(6));
  assert.equal(out.exit_code, 1);
});

test('known false positives lose only the block: base64 output and a broken data URI keep the surrounding text', () => {
  const wrapped = body(5, 76);
  assert.equal(clipText(`encoded:\n${wrapped.join('\n')}\ndone`), `encoded:\n${marker(5)}\ndone`);
});

// Negative controls: legitimate text stays as it was.
test('ordinary error output, stack traces, tables, JSON, hex dumps and short log lines are kept', () => {
  const samples = [
    'Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect (node:net:1555:16)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    '| name | value |\n|------|-------|\n| a | 1 |\n| b | 2 |\n| c | 3 |',
    JSON.stringify({ code: 'E_FAIL', detail: { attempts: 3, retry: true, items: ['alpha', 'beta', 'gamma'] } }),
    [
      '00000000  48 65 6c 6c 6f 20 77 6f  72 6c 64 0a 00 00 00 00',
      '00000010  de ad be ef ca fe ba be  01 02 03 04 05 06 07 08',
      '00000020  ff ff ff ff 00 00 00 00  41 42 43 44 45 46 47 48',
    ].join('\n'),
    ['[info] start', '[warn] slow response', '[error] giving up', '[info] done', '[debug] x'].join('\n'),
    ['A'.repeat(64), 'A'.repeat(64), 'A'.repeat(64), 'A'.repeat(64)].join('\n'),
    [
      '/workspace/github/marciohideaki/enterprise-hseos/tools/cli/lib/provider-campaign-process.js',
      '/usr/local/lib/node_modules/some-package/index.js',
      '/usr/local/lib/node_modules/another-package/lib/main.js',
    ].join('\n'),
  ];
  for (const sample of samples) assert.equal(clipText(sample, 100_000), sample);
});

test('a single long base64 line (digest) is kept: a one-line body cannot be told from a hash', () => {
  const digest = `sha512-${row(86)}`;
  assert.equal(clipText(`integrity ${digest}`), `integrity ${digest}`);
  const single = row(64);
  assert.equal(clipText(single), single);
});

test('the classifier stays linear on pathological input', () => {
  const started = process.hrtime.bigint();
  clipText(`${'A1b'.repeat(1365)}\n`.repeat(1) + '['.repeat(1000), 100_000);
  clipText('a-'.repeat(2048), 100_000);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 50);
});

test('credential shapes that were already covered are withheld exactly as before', () => {
  for (const sample of [
    '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA\n-----END PRIVATE KEY-----',
    `token sk-${'a'.repeat(30)}`,
    `Bearer ${'A1b2'.repeat(10)}`,
    'password=Sup3rSecretValue',
  ])
    assert.equal(clipText(sample), WITHHELD);
});
