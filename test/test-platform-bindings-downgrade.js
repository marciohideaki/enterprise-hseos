'use strict';

// ADR-0046 section 8, owner decision D6: a downgrade of the adoption mode needs a COMMITTED decision record
// whose content authorizes this exact downgrade and whose approver owns the bindings file in CODEOWNERS.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadPlatformBindings, ownersFromCodeowners, downgradeProblem } = require('../tools/cli/lib/platform-bindings');

const BINDINGS = '.hseos/config/platform-bindings.yaml';
const RECORD = 'docs/decisions/downgrade.md';
const CODEOWNERS = '.github/CODEOWNERS';
const OWNERS = `${BINDINGS} @marciohideaki\n`;
const NOW = new Date('2026-10-01T12:00:00Z');

const cleanup = [];
test.after(() => {
  for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true });
});

function git(directory, ...args) {
  return execFileSync(
    'git',
    ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function write(directory, relative, content) {
  const target = path.join(directory, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const record = ({ status = 'Accepted', from = 'platform', to = 'hybrid', approver = '"@marciohideaki"', extra = '' } = {}) =>
  `# Downgrade\n\n\`\`\`platform-bindings-downgrade\n${[
    status && `status: ${status}`,
    from && `from: ${from}`,
    to && `to: ${to}`,
    approver && `approver: ${approver}`,
  ]
    .filter(Boolean)
    .join('\n')}\n${extra}\`\`\`\n`;

const bindings = (mode, ref = RECORD) => `schema_version: 1.0.0\nmode: ${mode}\nmode_ref: ${ref}\n`;

/** A repo whose HEAD records `platform` plus the given committed files; the working-tree bindings are written after. */
function repo({ files = {}, codeowners = OWNERS } = {}) {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-pb-dg-'));
  cleanup.push(directory);
  git(directory, 'init', '-q');
  write(directory, BINDINGS, 'schema_version: 1.0.0\nmode: platform\n');
  if (codeowners !== null) write(directory, CODEOWNERS, codeowners);
  for (const [relative, content] of Object.entries(files)) write(directory, relative, content);
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'base');
  return directory;
}

function load(directory, { baseMode = 'platform', flags } = {}) {
  const home = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-pb-dg-home-'));
  cleanup.push(home);
  return loadPlatformBindings({
    projectDir: directory,
    env: { HOME: home, XDG_CONFIG_HOME: path.join(home, 'xdg') },
    now: NOW,
    baseMode,
    ...(flags ? { flags } : {}),
  });
}

function assertDenied(result, pattern) {
  assert.equal(result.source, 'downgrade-rejected', result.errors.join('; '));
  assert.equal(result.mode, 'platform');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], pattern);
}

test('a committed, unmodified, valid record from an owner authorizes the downgrade', () => {
  const directory = repo({ files: { [RECORD]: record() } });
  write(directory, BINDINGS, bindings('hybrid'));
  const result = load(directory);
  assert.deepEqual(result.errors, []);
  assert.equal(result.mode, 'hybrid');
  assert.equal(result.modeRef, RECORD);
});

test('approver matching ignores case and a leading @, and any of several owners is accepted', () => {
  const directory = repo({
    codeowners: `* @someone-else @MarcioHideaki\n`,
    files: { [RECORD]: record({ approver: 'marciohideaki', status: 'approved' }) },
  });
  write(directory, BINDINGS, bindings('hybrid'));
  assert.deepEqual(load(directory).errors, []);
});

test('a record that is not committed denies', () => {
  const directory = repo();
  write(directory, RECORD, record());
  write(directory, BINDINGS, bindings('hybrid'));
  assertDenied(load(directory), /not committed/);
});

test('a staged but uncommitted record denies', () => {
  const directory = repo();
  write(directory, RECORD, record());
  git(directory, 'add', RECORD);
  write(directory, BINDINGS, bindings('hybrid'));
  assertDenied(load(directory), /not committed/);
});

test('a committed record modified in the working tree denies', () => {
  const directory = repo({ files: { [RECORD]: record() } });
  write(directory, RECORD, record({ to: 'local' }));
  write(directory, BINDINGS, bindings('local'));
  assertDenied(load(directory), /differs from its committed content/);
});

test('a project that is not a git repository denies', () => {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-pb-dg-nogit-'));
  cleanup.push(directory);
  write(directory, RECORD, record());
  write(directory, BINDINGS, bindings('hybrid'));
  assertDenied(load(directory), /git failed|not committed/);
});

test('wrong from or wrong to denies and names what the record authorizes', () => {
  const wrongTo = repo({ files: { [RECORD]: record({ to: 'local' }) } });
  write(wrongTo, BINDINGS, bindings('hybrid'));
  assertDenied(load(wrongTo), /authorizes 'platform' -> 'local'/);

  const wrongFrom = repo({ files: { [RECORD]: record({ from: 'hybrid' }) } });
  write(wrongFrom, BINDINGS, bindings('hybrid'));
  assertDenied(load(wrongFrom), /authorizes 'hybrid' -> 'hybrid'/);
});

test('missing or unaccepted status, missing approver, bad block shape deny with a precise reason', () => {
  const cases = [
    [record({ status: '' }), /missing or has an empty status/],
    [record({ approver: '' }), /missing or has an empty approver/],
    [record({ status: 'Proposed' }), /status is 'Proposed'/],
    [record({ status: 'Rejected' }), /status is 'Rejected'/],
    [record({ extra: 'reviewer: x\n' }), /unknown keys: reviewer/],
    ['# Downgrade\n\nstatus: Accepted\nfrom: platform\nto: hybrid\napprover: @marciohideaki\n', /exactly one top-level fenced/],
    [`${record()}\n${record()}`, /found 2/],
    ['# empty\n', /found 0/],
    ['```platform-bindings-downgrade\n- a\n- b\n```\n', /YAML mapping/],
    ['```platform-bindings-downgrade\nstatus: [\n```\n', /not valid YAML/],
  ];
  for (const [content, pattern] of cases) {
    const directory = repo({ files: { [RECORD]: content } });
    write(directory, BINDINGS, bindings('hybrid'));
    assertDenied(load(directory), pattern);
  }
});

test('an approver who is not an owner denies', () => {
  const directory = repo({ files: { [RECORD]: record({ approver: '"@mallory"' }) } });
  write(directory, BINDINGS, bindings('hybrid'));
  assertDenied(load(directory), /approver '@mallory' is not an owner/);
});

test('no resolvable owner denies: no CODEOWNERS, no covering entry, uncovered path, edited only in the working tree', () => {
  const none = repo({ codeowners: null, files: { [RECORD]: record() } });
  write(none, BINDINGS, bindings('hybrid'));
  assertDenied(load(none), /no CODEOWNERS file at HEAD/);

  const uncovered = repo({ codeowners: '/docs/ @marciohideaki\n', files: { [RECORD]: record() } });
  write(uncovered, BINDINGS, bindings('hybrid'));
  assertDenied(load(uncovered), /no CODEOWNERS entry .* covers/);

  const cleared = repo({ codeowners: `* @marciohideaki\n${BINDINGS}\n`, files: { [RECORD]: record() } });
  write(cleared, BINDINGS, bindings('hybrid'));
  assertDenied(load(cleared), /no CODEOWNERS entry .* covers/);

  const workingTreeOnly = repo({ codeowners: '/docs/ @marciohideaki\n', files: { [RECORD]: record() } });
  write(workingTreeOnly, CODEOWNERS, OWNERS);
  write(workingTreeOnly, BINDINGS, bindings('hybrid'));
  assertDenied(load(workingTreeOnly), /no CODEOWNERS entry/);

  const sections = repo({ codeowners: `[Section]\n${OWNERS}`, files: { [RECORD]: record() } });
  write(sections, BINDINGS, bindings('hybrid'));
  assertDenied(load(sections), /syntax this check does not resolve/);
});

test('CODEOWNERS resolution: last match wins; star, directory and file patterns', () => {
  const owners = (text) => ownersFromCodeowners(text, BINDINGS).owners;
  assert.deepEqual(owners('* @a\n'), ['@a']);
  assert.deepEqual(owners('* @a\n/.hseos/ @b # note\n'), ['@b']);
  assert.deepEqual(owners('.hseos/config/ @c\n'), ['@c']);
  assert.deepEqual(owners('/.hseos/config/platform-bindings.yaml @d @e\n'), ['@d', '@e']);
  assert.deepEqual(owners('*.yaml @f\n'), ['@f']);
  assert.deepEqual(owners('/docs/ @g\n'), []);
  assert.deepEqual(owners('/.hseos/config/other.yaml @h\n'), []);
});

test('a record outside the allowed directories or with path traversal never authorizes', () => {
  for (const ref of [
    'README.md',
    'docs/other/downgrade.md',
    '../outside.md',
    'docs/decisions/../../README.md',
    '/etc/passwd',
    'docs/decisions/x.txt',
  ]) {
    const directory = repo({ files: { [RECORD]: record(), 'docs/other/downgrade.md': record() } });
    write(directory, BINDINGS, bindings('hybrid', ref));
    const result = load(directory);
    assert.equal(result.source, 'invalid-file', ref);
    assert.ok(result.errors.length > 0, ref);
  }
});

test('a symlinked record is denied', () => {
  const directory = repo({ files: { 'docs/decisions/real.md': record() } });
  fs.symlinkSync('real.md', path.join(directory, 'docs/decisions/link.md'));
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'link');
  write(directory, BINDINGS, bindings('hybrid', 'docs/decisions/link.md'));
  assertDenied(load(directory), /not a regular file at HEAD|symlink/);
});

test('upgrades and same-mode operations are unaffected', () => {
  const directory = repo();
  write(directory, BINDINGS, 'schema_version: 1.0.0\nmode: platform\n');
  assert.deepEqual(load(directory).errors, []);

  const hybridBase = repo();
  write(hybridBase, BINDINGS, 'schema_version: 1.0.0\nmode: platform\n');
  const upgraded = load(hybridBase, { baseMode: 'hybrid' });
  assert.deepEqual(upgraded.errors, []);
  assert.equal(upgraded.mode, 'platform');

  write(hybridBase, BINDINGS, bindings('hybrid', RECORD).replace(/mode_ref.*\n/, ''));
  assert.deepEqual(load(hybridBase, { baseMode: 'hybrid' }).errors, []);
});

test('a downgrade with no mode_ref says so', () => {
  const directory = repo();
  write(directory, BINDINGS, 'schema_version: 1.0.0\nmode: hybrid\n');
  assertDenied(load(directory), /no mode_ref was given/);
});

test('a flag downgrade is held to the same rule', () => {
  const ok = repo({ files: { [RECORD]: record() } });
  const allowed = load(ok, { flags: { mode: 'hybrid', modeRef: RECORD } });
  assert.deepEqual(allowed.errors, []);
  assert.equal(allowed.mode, 'hybrid');

  const uncommitted = repo();
  write(uncommitted, RECORD, record());
  assertDenied(load(uncommitted, { flags: { mode: 'hybrid', modeRef: RECORD } }), /not committed/);
});

test('CODEOWNERS matching follows GitHub: a single star does not cross a slash, a bare directory pattern does not need a trailing slash', () => {
  const owners = (text) => ownersFromCodeowners(text, BINDINGS).owners;
  assert.deepEqual(owners('* @admin\n.hseos/* @o\n'), ['@admin'], '.hseos/* does not reach .hseos/config/...');
  assert.deepEqual(owners('.hseos/** @o\n'), ['@o']);
  assert.deepEqual(owners('* @admin\n/.hseos/ @o\n'), ['@o']);
  assert.deepEqual(owners('* @admin\n.hseos/config/ @o\n'), ['@o']);
  assert.deepEqual(owners('* @admin\n.hseos/config @o\n'), ['@o'], 'a bare path may be a directory');
  assert.deepEqual(owners('* @admin\n*.yaml @o\n'), ['@o']);
  assert.deepEqual(owners('* @admin\n**/platform-bindings.yaml @o\n'), ['@o']);
  assert.deepEqual(owners('* @admin\n/platform-bindings.yaml @o\n'), ['@admin'], 'anchored at the root only');
  assert.deepEqual(owners('* @admin\n.hseos/*/ @o\n'), ['@o'], 'one-level directory wildcard');
  assert.deepEqual(owners('.hseos/** @o\n*.yaml @p\n'), ['@p'], 'last match wins');
  assert.deepEqual(owners('*.yaml @p\n.hseos/** @o\n'), ['@o'], 'last match wins, other order');
  assert.deepEqual(owners('* @admin\n/docs* @o\n'), ['@admin']);
});

test('the .hseos/* counterexample denies the over-broad owner and accepts the real one', () => {
  const codeowners = '* @admin\n.hseos/* @o\n';
  const wrong = repo({ codeowners, files: { [RECORD]: record({ approver: '"@o"' }) } });
  write(wrong, BINDINGS, bindings('hybrid'));
  assertDenied(load(wrong), /approver '@o' is not an owner/);
  const right = repo({ codeowners, files: { [RECORD]: record({ approver: '"@admin"' }) } });
  write(right, BINDINGS, bindings('hybrid'));
  assert.deepEqual(load(right).errors, []);
});

test('a block hidden in an HTML comment or inside another fence does not count', () => {
  const block = record().split('\n').slice(2, 8).join('\n'); // the tagged block itself
  const cases = [
    `<!--\n${block}\n-->\n`,
    `<!-- start\n${block}\nend -->\n`,
    `\`\`\`\`markdown\n${block}\n\`\`\`\`\n`,
    `~~~\n${block}\n~~~\n`,
    `    ${block.split('\n').join('\n    ')}\n`,
    `> ${block.split('\n').join('\n> ')}\n`,
  ];
  for (const content of cases) {
    const directory = repo({ files: { [RECORD]: content } });
    write(directory, BINDINGS, bindings('hybrid'));
    assertDenied(load(directory), /found 0/);
  }
  // A visible block next to a hidden one is still ambiguous only if both are top-level.
  const mixed = repo({ files: { [RECORD]: `<!--\n${block}\n-->\n${record()}` } });
  write(mixed, BINDINGS, bindings('hybrid'));
  assert.deepEqual(load(mixed).errors, []);
  const unterminated = repo({ files: { [RECORD]: block.replace(/\n```$/, '\n') } });
  write(unterminated, BINDINGS, bindings('hybrid'));
  assertDenied(load(unterminated), /unterminated/);
});

test('downgradeProblem re-checks the record location itself', () => {
  const directory = repo({ files: { [RECORD]: record(), 'docs/other.md': record() } });
  for (const ref of ['docs/other.md', 'docs/decisions/../other.md', 'docs/decisions/x.txt', undefined]) {
    assert.match(downgradeProblem(directory, ref, 'platform', 'hybrid'), /must be a \.md file under/, String(ref));
  }
  assert.equal(downgradeProblem(directory, RECORD, 'platform', 'hybrid'), null);
});

test('a project in a repository subdirectory resolves CODEOWNERS and the record from the repository root', () => {
  const directory = repo({
    codeowners: '/proj/.hseos/config/platform-bindings.yaml @marciohideaki\n',
    files: { [`proj/${RECORD}`]: record(), [`proj/${BINDINGS}`]: 'schema_version: 1.0.0\nmode: platform\n' },
  });
  const project = path.join(directory, 'proj');
  write(project, BINDINGS, bindings('hybrid'));
  const allowed = load(project);
  assert.deepEqual(allowed.errors, []);
  assert.equal(allowed.mode, 'hybrid');

  // Owner entry written for the project-relative path does not apply: the root-relative path is what matters.
  const other = repo({
    codeowners: `${BINDINGS} @someone\n/proj/ @marciohideaki\n`,
    files: { [`proj/${RECORD}`]: record(), [`proj/${BINDINGS}`]: 'schema_version: 1.0.0\nmode: platform\n' },
  });
  write(path.join(other, 'proj'), BINDINGS, bindings('hybrid'));
  assert.deepEqual(load(path.join(other, 'proj')).errors, []);

  const denied = repo({
    codeowners: '/proj/ @someone\n',
    files: { [`proj/${RECORD}`]: record(), [`proj/${BINDINGS}`]: 'schema_version: 1.0.0\nmode: platform\n' },
  });
  write(path.join(denied, 'proj'), BINDINGS, bindings('hybrid'));
  assertDenied(load(path.join(denied, 'proj')), /is not an owner/);

  const modified = repo({ codeowners: '/proj/ @marciohideaki\n', files: { [`proj/${RECORD}`]: record() } });
  write(path.join(modified, 'proj'), RECORD, record({ to: 'local' }));
  write(path.join(modified, 'proj'), BINDINGS, bindings('local'));
  assertDenied(load(path.join(modified, 'proj')), /differs from its committed content/);
});

test('a wildcard pattern that matches an ancestor directory of the bindings file fails closed', () => {
  for (const pattern of ['.hs*', '/.hs*', '.hseos/conf*', '.hseos/c?nfig']) {
    const result = ownersFromCodeowners(`* @base\n${pattern} @o\n`, BINDINGS);
    assert.match(result.error, /matches a parent directory/, pattern);
  }
  assert.deepEqual(ownersFromCodeowners('* @base\n.hseos/* @o\n', BINDINGS).owners, ['@base'], '.hseos/* is unchanged');
  assert.deepEqual(
    ownersFromCodeowners('* @base\n.hseos/config/*.yaml @o\n', BINDINGS).owners,
    ['@o'],
    'matches the file, not an ancestor',
  );
  const directory = repo({ codeowners: '* @marciohideaki\n.hs* @marciohideaki\n', files: { [RECORD]: record() } });
  write(directory, BINDINGS, bindings('hybrid'));
  assertDenied(load(directory), /matches a parent directory/);
});
