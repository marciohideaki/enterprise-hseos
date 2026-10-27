'use strict';
// Diagnostic redaction of key material that lost its marker: the stderr tail keeps only the last 4096 characters, so a
// PEM block can reach the diagnostic as a bare base64 body (BEGIN cut off) with, at most, a loose END line.
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync } = require('node:crypto');
const { test } = require('node:test');
const { clipText, sanitizeDiagnostic } = require('../tools/cli/lib/provider-campaign-process');
const { redactDiagnosticText } = require('../tools/cli/lib/campaign-evidence-store');
const { safeStderr } = require('../tools/cli/lib/platform-bindings');
const { sessionEvidence } = require('../tools/cli/lib/engineering-task-runtime');

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

test('a single long base64 line (digest) is kept: only a private-key header makes a one-line body', () => {
  const digest = `sha512-${row(86)}`;
  assert.equal(clipText(`integrity ${digest}`), `integrity ${digest}`);
  const single = row(64);
  assert.equal(clipText(single), single);
  // A header with fewer than 20 characters after it is not a key body.
  const short = `x-MC4CAQAwBQYDK2Vw${row(10)}`;
  assert.equal(clipText(short), short);
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

// One-line and literal-`\\n` bodies, from keys generated in memory (nothing is written to disk).
const OPENSSH_HEADER = 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmU'; // base64 of the "openssh-key-v1" envelope that follows the BEGIN marker
const der = (key, type) => key.export({ type, format: 'der' }).toString('base64');
const privateKeys = () => {
  const keys = {
    'ed25519 pkcs8': der(generateKeyPairSync('ed25519').privateKey, 'pkcs8'),
    'x25519 pkcs8': der(generateKeyPairSync('x25519').privateKey, 'pkcs8'),
    'openssh ed25519': OPENSSH_HEADER + row(180),
  };
  for (const bits of [2048, 4096]) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: bits });
    keys[`rsa-${bits} pkcs8`] = der(privateKey, 'pkcs8');
    keys[`rsa-${bits} pkcs1`] = der(privateKey, 'pkcs1');
  }
  for (const namedCurve of ['prime256v1', 'secp384r1', 'secp521r1']) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve });
    keys[`${namedCurve} pkcs8`] = der(privateKey, 'pkcs8');
    keys[`${namedCurve} sec1`] = der(privateKey, 'sec1');
  }
  return keys;
};
const chunks = (value) => Array.from({ length: Math.floor(value.length / 20) }, (_, i) => value.slice(i * 20, i * 20 + 20));
const exposes = (output, value) => chunks(value).some((chunk) => output.includes(chunk));
const wrap = (value, width) => value.match(new RegExp(`.{1,${width}}`, 'g'));

for (const [name, key] of Object.entries(privateKeys())) {
  test(`${name}: the body is withheld as one line, wrapped, behind a prefix and with literal \\n`, () => {
    assert.equal(exposes(clipText(`worker failed: ${key}`, 100_000), key), false, 'inline');
    assert.equal(exposes(clipText(`[stderr] ${key}\nExit 1`, 100_000), key), false, 'line prefix');
    assert.equal(exposes(clipText(wrap(key, 64).join('\n'), 100_000), key), false, 'wrapped at 64');
    assert.equal(exposes(clipText(wrap(key, 76).join('\n'), 100_000), key), false, 'wrapped at 76');
    const escaped = `{"error":"boom\\n${wrap(key, 64).join(String.raw`\n`)}\\nExit 1"}`;
    assert.equal(escaped.includes(String.raw`\n`), true);
    assert.equal(exposes(clipText(escaped, 100_000), key), false, 'literal backslash-n');
    assert.equal(exposes(JSON.stringify(sanitizeDiagnostic({ stderr: key })), key), false, 'sanitizeDiagnostic');
  });
}

test('a one-line key keeps the error text around it', () => {
  const key = der(generateKeyPairSync('ed25519').privateKey, 'pkcs8');
  assert.equal(clipText(`before ${key} after`), 'before <withheld: key body, 1 line> after');
  assert.equal(clipText(`stderr: ${key}\nExit 1`), '<withheld: key body, 1 line>\nExit 1');
});

test('public keys and digests that merely look like base64 are kept', () => {
  const spki = der(generateKeyPairSync('ed25519').publicKey, 'spki');
  const rsaPublic = der(generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey, 'spki');
  for (const sample of [spki, rsaPublic, `sha256-${row(43)}=`, createHash('sha256').update('x').digest('base64')])
    assert.equal(clipText(sample), sample);
});

test('diagnostic text with a credential shape is withheld whole; the others pass through redactDiagnosticText', () => {
  assert.equal(redactDiagnosticText('token sk-' + 'a'.repeat(30)), null);
  assert.equal(redactDiagnosticText('plain error'), 'plain error');
});

test('git stderr that carries key material never reaches the message (platform-bindings)', () => {
  const key = der(generateKeyPairSync('ed25519').privateKey, 'pkcs8');
  const withKey = safeStderr({ stderr: Buffer.from(`fatal: bad object ${key}\n`) });
  assert.equal(exposes(withKey, key), false);
  assert.match(withKey, /^fatal: bad object <withheld: key body, 1 line>$/);
  assert.equal(safeStderr({ stderr: `-----BEGIN ${'OPENSSH'} PRIVATE KEY-----\n${key}` }), '[redacted: credential-like content]');
  assert.equal(safeStderr({ message: 'spawn git ENOENT' }), 'spawn git ENOENT');
});

test('probe stderr and the evidence message redact key material (engineering-task-runtime)', () => {
  const key = der(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, 'pkcs8');
  const probe = sessionEvidence.probeStderr(`launcher: ${key}`);
  assert.equal(exposes(probe, key), false);
  assert.equal(probe, '<withheld: key body, 1 line>');
  assert.equal(sessionEvidence.probeStderr('x'.repeat(500)).length, 200);
  assert.equal(sessionEvidence.probeStderr('password=Sup3rSecretValue'), '[redacted: credential-like content]');
  const message = sessionEvidence.evidenceMessage(`session failed: ${key}`);
  assert.equal(exposes(message, key), false);
  assert.equal(message, 'session failed: <withheld: key body, 1 line>');
  assert.equal(sessionEvidence.evidenceMessage('password=Sup3rSecretValue'), '[redacted: credential-like content]');
});

// F1: the header may sit anywhere in a base64 sequence; F2: the last line of a wrapped body may be glued to text.
const contexts = {
  'key=': (k) => `key=${k}`,
  'data=': (k) => `data=${k} done`,
  '?k=': (k) => `GET /x?k=${k}&v=1`,
  'path/': (k) => `/var/run/${k}`,
  'dash-': (k) => `k-${k}`,
  underscore_: (k) => `k_${k}`,
  json: (k) => JSON.stringify({ k }),
};
for (const [name, key] of Object.entries(privateKeys())) {
  test(`${name}: the body is withheld after =, -, _, / and inside JSON, and a glued last line goes too`, () => {
    for (const [context, build] of Object.entries(contexts)) assert.equal(exposes(clipText(build(key), 100_000), key), false, context);
    const rows = wrap(key, 64);
    const glued = [
      (k) => `${k}\nExit 1`,
      (k) => `${k} trailing text`,
      (k) => `key=${k}`,
      (k) => JSON.stringify({ stderr: k }),
      (k) => JSON.stringify({ stderr: `boom\n${k}`, code: 1 }),
    ];
    for (const build of glued) {
      const out = clipText(build(rows.join('\n')), 100_000);
      assert.equal(exposes(out, key), false, build(rows.join('\n')).slice(0, 20));
      assert.equal(
        rows.some((r) => r.length >= 16 && out.includes(r)),
        false,
      );
    }
  });
}

test('the text around a withheld body survives, and short prose after a block is kept', () => {
  const key = der(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, 'pkcs8');
  assert.equal(clipText(`key=${key}`), 'key=<withheld: key body, 1 line>');
  assert.equal(clipText(`{"k":"${key}","n":1}`), '{"k":"<withheld: key body, 1 line>","n":1}');
  const out = clipText(`${wrap(key, 64).join('\n')}\nExit 1`);
  assert.match(out, /^<withheld: key body, \d+ lines>\nExit 1$/);
  const prose = `${wrap(key, 64).slice(0, 8).join('\n')}\nworker failed: ECONNRESET`;
  assert.match(clipText(prose), /\nworker failed: ECONNRESET$/);
});

test('every branch of probeStderr and evidenceMessage', () => {
  const key = der(generateKeyPairSync('ed25519').privateKey, 'pkcs8');
  assert.equal(sessionEvidence.probeStderr(''), '');
  assert.equal(sessionEvidence.probeStderr('  plain failure \n'), 'plain failure');
  assert.equal(sessionEvidence.probeStderr(`k=${key}`), 'k=<withheld: key body, 1 line>');
  assert.equal(sessionEvidence.probeStderr('token=Sup3rSecretValue99'), '[redacted: credential-like content]');
  assert.equal(sessionEvidence.evidenceMessage('x'.repeat(600)), `${'x'.repeat(512)}...`);
  assert.equal(sessionEvidence.evidenceMessage('short'), 'short');
  assert.equal(sessionEvidence.evidenceMessage(`bad ${key}`), 'bad <withheld: key body, 1 line>');
  assert.equal(sessionEvidence.evidenceMessage('Authorization: Bearer ' + 'a1B2'.repeat(10)), '[redacted: credential-like content]');
});
