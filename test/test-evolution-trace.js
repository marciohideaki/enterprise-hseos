'use strict';

// Guards the machine-readable promise-to-test traces of the W3 and W4 evolution waves (audit finding A-20).
// A trace entry may only cite things that exist: the source line must contain the quoted promise, every
// requirement must be in requirements.json, every test file (and test name) must exist and every receipt must
// be a file. Commits are checked for shape only, so the guard stays valid in shallow clones.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const EVOLUTION = path.join(ROOT, 'docs', 'evolution');
const WAVES = ['W3', 'W4'];
const STATUSES = new Set(['delivered', 'partial', 'not_delivered', 'blocked']);
const TOP_KEYS = ['schema_version', 'wave', 'description', 'entries'];
const ENTRY_KEYS = ['id', 'promise', 'requirements', 'tests', 'evidence', 'status', 'note'];
const REQUIRED_ENTRY_KEYS = ['id', 'promise', 'requirements', 'tests', 'evidence', 'status'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadTrace(wave) {
  return readJson(path.join(EVOLUTION, wave.toLowerCase(), 'TRACE.json'));
}

function knownRequirementIds() {
  const inventory = readJson(path.join(EVOLUTION, 'requirements.json'));
  return new Set(inventory.families.flatMap((family) => family.requirements.map((requirement) => requirement.id)));
}

function squash(text) {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function insideRoot(relativePath) {
  const resolved = path.resolve(ROOT, relativePath);
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

function exactKeys(value, allowed, required, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${label} has unknown key ${key}`);
  for (const key of required) assert.ok(key in value, `${label} is missing ${key}`);
}

// Test titles are read from lines that start a test(...)/it(...) call, so a name that only appears in a comment,
// a string or an assertion message does not count. Template titles are compared as written (before interpolation).
const TITLE_CALL = /^[ \t]*(?:test|it)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/gm;

function testTitles(source) {
  const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, (block) => block.replaceAll(/[^\n]/g, ' '));
  return new Set([...code.matchAll(TITLE_CALL)].map((match) => match[2]));
}

function defaultGit(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '' };
}

// 'present' | 'absent' (object missing in a full clone: a real error) | 'unverifiable' (shallow clone or no git).
function commitState(sha, git = defaultGit) {
  if (git(['cat-file', '-e', `${sha}^{commit}`]).status === 0) return 'present';
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  return shallow.status === 0 && shallow.stdout.trim() === 'false' ? 'absent' : 'unverifiable';
}

function checkSchema(trace, wave) {
  exactKeys(trace, TOP_KEYS, ['schema_version', 'wave', 'entries'], `${wave} trace`);
  assert.equal(trace.schema_version, 1, `${wave} schema_version`);
  assert.equal(trace.wave, wave, `${wave} trace declares another wave`);
  assert.ok(Array.isArray(trace.entries) && trace.entries.length > 0, `${wave} trace has no entries`);
  const ids = new Set();
  for (const entry of trace.entries) {
    exactKeys(entry, ENTRY_KEYS, REQUIRED_ENTRY_KEYS, `${wave} entry ${entry && entry.id}`);
    const label = `${wave} ${entry.id}`;
    assert.match(entry.id, new RegExp(`^${wave}-[A-Z0-9][A-Z0-9-]*$`), `${label} id shape`);
    assert.ok(!ids.has(entry.id), `${label} is duplicated`);
    ids.add(entry.id);
    exactKeys(entry.promise, ['text', 'source'], ['text', 'source'], `${label} promise`);
    assert.ok(typeof entry.promise.text === 'string' && entry.promise.text.length >= 8, `${label} promise text`);
    assert.match(entry.promise.source, /^[^:\s]+:[1-9][0-9]*$/, `${label} promise source must be file:line`);
    assert.ok(Array.isArray(entry.requirements), `${label} requirements must be an array`);
    assert.ok(Array.isArray(entry.tests), `${label} tests must be an array`);
    assert.ok(Array.isArray(entry.evidence), `${label} evidence must be an array`);
    assert.ok(STATUSES.has(entry.status), `${label} status ${entry.status} is not allowed`);
    for (const item of entry.tests) {
      exactKeys(item, ['file', 'name'], ['file'], `${label} test`);
      assert.match(item.file, /^test\/[A-Za-z0-9_.-]+$/, `${label} test file must be directly under test/`);
      if ('name' in item) assert.ok(typeof item.name === 'string' && item.name.length > 0, `${label} test name`);
    }
    for (const item of entry.evidence) {
      assert.ok(item && ['receipt', 'commit'].includes(item.kind), `${label} evidence kind`);
      if (item.kind === 'receipt') {
        exactKeys(item, ['kind', 'path'], ['kind', 'path'], `${label} receipt`);
      } else {
        exactKeys(item, ['kind', 'sha'], ['kind', 'sha'], `${label} commit`);
        assert.match(item.sha, /^[0-9a-f]{7,40}$/, `${label} commit sha shape`);
      }
    }
    if (entry.status === 'delivered' || entry.status === 'partial') {
      assert.ok(entry.evidence.length > 0, `${label} claims ${entry.status} without evidence`);
    }
  }
}

function checkPromiseSources(trace, wave) {
  for (const entry of trace.entries) {
    const label = `${wave} ${entry.id}`;
    const separator = entry.promise.source.lastIndexOf(':');
    const file = entry.promise.source.slice(0, separator);
    const line = Number(entry.promise.source.slice(separator + 1));
    const resolved = insideRoot(file);
    assert.ok(resolved && fs.existsSync(resolved), `${label} cites a missing source ${file}`);
    const lines = fs.readFileSync(resolved, 'utf8').split('\n');
    assert.ok(line <= lines.length, `${label} cites ${file}:${line} beyond the end of the file`);
    assert.ok(squash(lines[line - 1]).includes(squash(entry.promise.text)), `${label} promise text is not on ${file}:${line}`);
  }
}

function checkRequirements(trace, wave) {
  const known = knownRequirementIds();
  for (const entry of trace.entries) {
    for (const id of entry.requirements) {
      assert.ok(known.has(id), `${wave} ${entry.id} cites requirement ${id} that is not in requirements.json`);
    }
  }
}

function checkTests(trace, wave) {
  for (const entry of trace.entries) {
    for (const item of entry.tests) {
      const label = `${wave} ${entry.id}`;
      const resolved = insideRoot(item.file);
      assert.ok(resolved && fs.existsSync(resolved), `${label} cites a missing test file ${item.file}`);
      if (item.name) {
        assert.ok(
          testTitles(fs.readFileSync(resolved, 'utf8')).has(item.name),
          `${label} cites test name "${item.name}" that is not the title of a test in ${item.file}`,
        );
      }
    }
  }
}

function checkCommits(trace, wave, git = defaultGit) {
  for (const entry of trace.entries) {
    for (const item of entry.evidence.filter((evidence) => evidence.kind === 'commit')) {
      const state = commitState(item.sha, git);
      assert.notEqual(state, 'absent', `${wave} ${entry.id} cites commit ${item.sha} that is not in this repository`);
      if (state === 'unverifiable') {
        process.emitWarning(`${wave} ${entry.id}: commit ${item.sha} checked by shape only (shallow clone)`);
      }
    }
  }
}

function checkReceipts(trace, wave) {
  for (const entry of trace.entries) {
    for (const item of entry.evidence.filter((evidence) => evidence.kind === 'receipt')) {
      const resolved = insideRoot(item.path);
      assert.ok(
        resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile(),
        `${wave} ${entry.id} cites a missing receipt ${item.path}`,
      );
    }
  }
}

for (const wave of WAVES) {
  test(`${wave} trace has a strict schema with unique ids and coherent statuses`, () => {
    checkSchema(loadTrace(wave), wave);
  });

  test(`${wave} trace quotes each promise from the cited source line`, () => {
    checkPromiseSources(loadTrace(wave), wave);
  });

  test(`${wave} trace cites only requirements that exist in requirements.json`, () => {
    checkRequirements(loadTrace(wave), wave);
  });

  test(`${wave} trace cites only test files and test names that exist`, () => {
    checkTests(loadTrace(wave), wave);
  });

  test(`${wave} trace cites only receipts that exist`, () => {
    checkReceipts(loadTrace(wave), wave);
  });

  test(`${wave} trace cites only commits that exist in this repository`, () => {
    checkCommits(loadTrace(wave), wave);
  });
}

test('a test name counts only as the title of a test call, not as a comment or message', () => {
  const source = [
    "// test('only in a comment', () => {})",
    '/*',
    "test('inside a block comment', () => {})",
    '*/',
    "test('single quoted', () => {});",
    '  it("double quoted", () => {});',
    '  test.skip(`template ${variant} title`, () => {});',
    "assert.ok(true, 'only in a message');",
  ].join('\n');
  const titles = testTitles(source);
  for (const title of ['single quoted', 'double quoted', 'template ${variant} title']) assert.ok(titles.has(title), title);
  for (const title of ['only in a comment', 'inside a block comment', 'only in a message']) assert.ok(!titles.has(title), title);
});

test('commit evidence is verified when the object exists and degrades to shape only in a shallow clone', () => {
  const answers = (cat, shallow) => (args) =>
    args[0] === 'cat-file' ? { status: cat, stdout: '' } : { status: 0, stdout: `${shallow}\n` };
  assert.equal(commitState('abcdef1', answers(0, 'false')), 'present');
  assert.equal(commitState('abcdef1', answers(1, 'false')), 'absent');
  assert.equal(commitState('abcdef1', answers(1, 'true')), 'unverifiable');
  assert.equal(
    commitState('abcdef1', () => ({ status: 127, stdout: '' })),
    'unverifiable',
  );
  const trace = { entries: [{ id: 'W3-X', evidence: [{ kind: 'commit', sha: 'abcdef1' }] }] };
  assert.throws(() => checkCommits(trace, 'W3', answers(1, 'false')), /not in this repository/);
  assert.doesNotThrow(() => checkCommits(trace, 'W3', answers(1, 'true')));
});
