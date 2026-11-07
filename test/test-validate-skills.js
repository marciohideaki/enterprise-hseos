'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const SCRIPT = path.resolve(__dirname, '../scripts/governance/validate-skills.sh');
const ESC = String.fromCodePoint(27);
const strip = (s) => s.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

function run(args, script = SCRIPT) {
  const r = spawnSync('bash', [script, ...args], { encoding: 'utf8' });
  return { code: r.status, out: strip(`${r.stdout}${r.stderr}`) };
}

function catalog(skills) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'validate-skills-'));
  for (const [name, files] of Object.entries(skills)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(root, name, file), body);
  }
  return root;
}

const noDesc = '---\nname: x\n---\n# x\n';
const valid = '---\nname: ok\ndescription: Use when testing the validator.\n---\n# ok\n';

test('two skills without description are both reported as SKILL-03', () => {
  const dir = catalog({ a: { 'SKILL-QUICK.md': noDesc }, b: { 'SKILL-QUICK.md': noDesc } });
  try {
    const r = run(['--dir', dir]);
    assert.equal(r.code, 1);
    assert.equal(r.out.split('\n').filter((l) => l.includes('SKILL-03') && l.includes('FAIL')).length, 2);
    assert.match(r.out, /FAILURES\s+: 2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty description fails SKILL-03', () => {
  const dir = catalog({
    a: { 'SKILL-QUICK.md': '---\nname: a\ndescription:   \n---\n# a\n' },
  });
  try {
    const r = run(['--dir', dir]);
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL.*SKILL-03.*empty/);
    assert.match(r.out, /FAILURES\s+: 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('subdirectory with .md and no SKILL file still fails SKILL-01', () => {
  const dir = catalog({ ok: { 'SKILL-QUICK.md': valid }, ok2: { 'SKILL-QUICK.md': valid } });
  fs.mkdirSync(path.join(dir, 'ok', 'templates'));
  fs.writeFileSync(path.join(dir, 'ok', 'templates', 'layout.md'), '# layout\n');
  try {
    const r = run(['--dir', dir]);
    assert.equal(r.code, 1);
    assert.match(r.out, /SKILL-01.*'templates'/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('valid skill passes with exit 0', () => {
  const dir = catalog({ ok: { 'SKILL-QUICK.md': valid } });
  try {
    const r = run(['--dir', dir]);
    assert.equal(r.code, 0);
    assert.match(r.out, /FAILURES\s+: 0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('real catalog passes', () => {
  const r = run([]);
  assert.equal(r.code, 0, r.out.slice(-800));
  assert.match(r.out, /FAILURES\s+: 0/);
});

test('mutation: without the || true guard the missing-description case aborts early', () => {
  const dir = catalog({ a: { 'SKILL-QUICK.md': noDesc }, b: { 'SKILL-QUICK.md': noDesc } });
  const copyDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'validate-skills-mut-'));
  try {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.ok(src.includes('| xargs || true)'), 'guard not found');
    fs.mkdirSync(path.join(copyDir, 'scripts/governance'), { recursive: true });
    const mutated = path.join(copyDir, 'scripts/governance/validate-skills.sh');
    fs.writeFileSync(mutated, src.replace('| xargs || true)', '| xargs)'));
    const r = run(['--dir', dir], mutated);
    assert.doesNotMatch(r.out, /FAILURES\s+: 2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(copyDir, { recursive: true, force: true });
  }
});
