'use strict';

/**
 * Stack vocabulary tests (ECP Decision 0011, resolution v1.1): normalization, the vocabulary invariants,
 * the verified snapshot loader (absent = v1), the `path` sibling and `platform-bindings sync`/`drift`.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const command = require('../tools/cli/commands/platform-bindings');
const {
  RegistryIntegrityError,
  SNAPSHOT_FILE,
  SNAPSHOT_LOCK_FILE,
  STACKS_LOCK_FILE,
  STACKS_SNAPSHOT_FILE,
  createVocabulary,
  deriveCoverage,
  loadCapabilityRegistry,
  missingTargets,
  normalizeToken,
  vocabularyProblems,
} = require('../tools/cli/lib/capability-registry');

const REPO_ROOT = path.join(__dirname, '..');
const STACKS_FIXTURE = path.join(__dirname, 'fixtures', 'ecp-resolution-v1.1', 'stacks.json');
const REGISTRY_FIXTURE = path.join(__dirname, 'fixtures', 'ecp-registry', 'registry-0.3.0.json');

const cleanup = [];
test.after(() => {
  for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true });
});

function temp(prefix = 'hseos-stacks-') {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), prefix));
  cleanup.push(directory);
  return directory;
}

function write(directory, relative, content) {
  const target = path.join(directory, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function git(directory, ...args) {
  return execFileSync(
    'git',
    ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stacksDocument = () => JSON.parse(fs.readFileSync(STACKS_FIXTURE, 'utf8'));
const vocabulary = () => createVocabulary(stacksDocument());

test('normalization: ids, aliases, separators, case and unknown tokens', () => {
  const v = vocabulary();
  const expected = {
    ts: 'typescript',
    js: 'typescript',
    JavaScript: 'typescript',
    csharp: 'dotnet',
    cs: 'dotnet',
    'c#': 'dotnet',
    '.net': 'dotnet',
    golang: 'go',
    py: 'python',
    python3: 'python',
    rn: 'react-native',
    reactnative: 'react-native',
    'React Native': 'react-native',
    react_native: 'react-native',
    '  React   Native  ': 'react-native',
    nodejs: 'node',
    'node.js': 'node',
    reactjs: 'react',
    rs: 'rust',
    TypeScript: 'typescript',
    cobol: 'cobol',
    'Cobol 85': 'cobol-85',
  };
  for (const [input, canonical] of Object.entries(expected)) assert.equal(v.normalize(input), canonical, input);
  assert.equal(normalizeToken('A_b  c-d'), 'a-b-c-d');
  // Same whitespace set as the ECP runtime: U+001C..U+001F and U+0085 separate, U+FEFF does not.
  assert.equal(normalizeToken('\u001Ctypescript\u0085'), 'typescript');
  assert.equal(normalizeToken('react native　'), 'react-native');
  assert.equal(normalizeToken('﻿typescript'), '﻿typescript');
});

test('accepts is directional and not transitive', () => {
  const v = vocabulary();
  assert.deepEqual([...v.expand('node')].sort(), ['node', 'typescript']);
  assert.deepEqual([...v.expand('typescript')], ['typescript']);
  const chain = stacksDocument();
  chain.stacks.find((stack) => stack.id === 'typescript').accepts = ['go'];
  const chained = createVocabulary(chain);
  assert.deepEqual([...chained.expand('node')].sort(), ['node', 'typescript'], 'node does not reach go through typescript');
});

test('vocabulary invariants are enforced', () => {
  assert.deepEqual(vocabularyProblems(stacksDocument()), []);
  const mutate = (fn) => {
    const document = stacksDocument();
    fn(document);
    return vocabularyProblems(document).join('; ');
  };
  const byId = (document, id) => document.stacks.find((stack) => stack.id === id);
  const cases = [
    ['not an object', () => vocabularyProblems([]).join('; '), 'must be an object'],
    ['unknown root key', (d) => (d.extra = 1), "unknown field 'extra'"],
    ['wrong schema_version', (d) => (d.schema_version = '2'), 'schema_version'],
    ['bad stacks_version', (d) => (d.stacks_version = 'x'), 'stacks_version'],
    ['unknown stack key', (d) => (d.stacks[0].extra = 1), "unknown field 'extra'"],
    ['duplicate id', (d) => d.stacks.push(structuredClone(d.stacks[0])), 'defined more than once'],
    ['alias that is an id', (d) => byId(d, 'go').aliases.push('rust'), 'also a stack id'],
    ['alias declared twice', (d) => byId(d, 'go').aliases.push('py'), "alias 'py' is declared by 'go' and 'python'"],
    ['alias not normalized', (d) => byId(d, 'go').aliases.push('Go Lang'), 'not in normalized form'],
    ['accepts itself', (d) => byId(d, 'go').accepts.push('go'), 'must not list itself'],
    ['accepts unknown', (d) => byId(d, 'go').accepts.push('cobol'), "unknown stack 'cobol'"],
    ['accepts duplicate', (d) => byId(d, 'node').accepts.push('typescript'), 'more than once'],
  ];
  for (const [label, mutation, fragment] of cases) {
    const message = mutation.length === 0 ? mutation() : mutate(mutation);
    assert.ok(message.includes(fragment), `${label}: ${message}`);
  }
  assert.throws(() => createVocabulary({}), /Invalid stack vocabulary/);
});

test('coverage: direct beats via, planned is not missing, deprecated never counts', () => {
  const v = vocabulary();
  const impl = (stack, status) => ({ stack, status });
  const targets = [{ stack: 'node' }, { stack: 'python', required: false }, { stack: 'go' }, { stack: 'flutter' }];
  const implementations = [
    impl('typescript', 'stable'),
    impl('node', 'experimental'),
    impl('go', 'deprecated'),
    impl('flutter', 'planned'),
  ];
  assert.deepEqual(deriveCoverage(targets, implementations, v), [
    { target: 'flutter', required: true, status: 'planned' },
    { target: 'go', required: true, status: 'missing' },
    { target: 'node', required: true, status: 'stable', via: 'typescript' },
    { target: 'python', required: false, status: 'missing' },
  ]);
  assert.deepEqual(missingTargets(targets, implementations, v), [
    { stack: 'go', required: true },
    { stack: 'python', required: false },
  ]);
  assert.deepEqual(deriveCoverage([{ stack: 'node' }], [impl('typescript', 'stable'), impl('node', 'stable')], v), [
    { target: 'node', required: true, status: 'stable' },
  ]);
  assert.deepEqual(missingTargets([], implementations, v), []);
});

function runtimeWith({ stacks = true, mutateLock, mutateStacks } = {}) {
  const root = temp('hseos-stacks-rt-');
  for (const file of [SNAPSHOT_FILE, SNAPSHOT_LOCK_FILE]) {
    write(root, file, fs.readFileSync(path.join(REPO_ROOT, file)));
  }
  if (stacks) {
    const bytes = Buffer.from(mutateStacks ? mutateStacks(fs.readFileSync(STACKS_FIXTURE, 'utf8')) : fs.readFileSync(STACKS_FIXTURE));
    const registryLock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, SNAPSHOT_LOCK_FILE), 'utf8'));
    const lock = { ...registryLock, sha256: sha(fs.readFileSync(STACKS_FIXTURE)) };
    write(root, STACKS_SNAPSHOT_FILE, bytes);
    write(root, STACKS_LOCK_FILE, JSON.stringify(mutateLock ? mutateLock(lock) : lock));
  }
  return root;
}

test('the shipped snapshot has no vocabulary: stack rules stay at v1', () => {
  const loaded = loadCapabilityRegistry({ runtimeRoot: REPO_ROOT, bindings: { registry: { source: 'snapshot' } } });
  assert.equal(loaded.vocabulary, null);
  assert.equal(loaded.stacks, null);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, STACKS_SNAPSHOT_FILE)), false);
});

test('a verified stacks snapshot is loaded with its lock', () => {
  const root = runtimeWith();
  const loaded = loadCapabilityRegistry({ runtimeRoot: root, bindings: { registry: { source: 'snapshot' } } });
  assert.equal(loaded.vocabulary.normalize('ts'), 'typescript');
  assert.deepEqual(loaded.stacks, { source: 'snapshot', version: '1.0.0', sha256: sha(fs.readFileSync(STACKS_FIXTURE)) });
});

test('stacks snapshot integrity fails closed', () => {
  const load = (root) => () => loadCapabilityRegistry({ runtimeRoot: root, bindings: { registry: { source: 'snapshot' } } });
  const integrity = (root, pattern) =>
    assert.throws(load(root), (error) => error instanceof RegistryIntegrityError && pattern.test(error.message));
  integrity(runtimeWith({ mutateStacks: (text) => `${text} ` }), /Stacks snapshot sha256 mismatch/);
  integrity(
    runtimeWith({ mutateLock: (lock) => ({ ...lock, ref: 'contracts-v9.9.9' }) }),
    /Stacks snapshot lock ref .* does not match the registry snapshot lock/,
  );
  integrity(runtimeWith({ mutateLock: (lock) => ({ ...lock, repository: 'x/y' }) }), /repository .* does not match/);
  integrity(runtimeWith({ mutateLock: (lock) => ({ ...lock, contracts_version: '9.9.9' }) }), /contracts_version 9.9.9 does not match/);
  integrity(runtimeWith({ mutateLock: (lock) => ({ ...lock, extra: 1 }) }), /unexpected shape/);
  const lockOnly = runtimeWith();
  fs.rmSync(path.join(lockOnly, STACKS_SNAPSHOT_FILE));
  integrity(lockOnly, /present together/);
  const fileOnly = runtimeWith();
  fs.rmSync(path.join(fileOnly, STACKS_LOCK_FILE));
  integrity(fileOnly, /present together/);
  // A vocabulary that fails its invariants is rejected even when the lock hash matches the bytes.
  const broken = stacksDocument();
  broken.stacks[0].accepts = ['cobol'];
  const root = runtimeWith({ mutateStacks: () => JSON.stringify(broken) });
  const lock = JSON.parse(fs.readFileSync(path.join(root, STACKS_LOCK_FILE), 'utf8'));
  write(root, STACKS_LOCK_FILE, JSON.stringify({ ...lock, sha256: sha(fs.readFileSync(path.join(root, STACKS_SNAPSHOT_FILE))) }));
  assert.throws(load(root), /Invalid stack vocabulary.*unknown stack 'cobol'/);
});

test('a path registry picks up <registry>.stacks.json or the ECP contracts/stacks.json beside catalog/', () => {
  const directory = temp('hseos-stacks-path-');
  const registry = write(directory, 'reg.json', fs.readFileSync(REGISTRY_FIXTURE));
  const bindings = { registry: { source: 'path', path: registry } };
  assert.equal(loadCapabilityRegistry({ bindings }).vocabulary, null);
  write(directory, 'reg.stacks.json', fs.readFileSync(STACKS_FIXTURE));
  assert.equal(loadCapabilityRegistry({ bindings }).vocabulary.normalize('golang'), 'go');
  const ecp = temp('hseos-stacks-ecp-');
  const catalogRegistry = write(ecp, 'catalog/capability-registry.json', fs.readFileSync(REGISTRY_FIXTURE));
  write(ecp, 'contracts/stacks.json', fs.readFileSync(STACKS_FIXTURE));
  const loaded = loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: catalogRegistry } } });
  assert.equal(loaded.stacks.source, 'path');
  assert.equal(loaded.stacks.sha256, sha(fs.readFileSync(STACKS_FIXTURE)));
  write(directory, 'reg.stacks.json', '{not json');
  assert.throws(() => loadCapabilityRegistry({ bindings }), /Invalid stack vocabulary/);
});

function ecpRepo({ stacks } = {}) {
  const directory = temp('hseos-stacks-sync-');
  git(directory, 'init', '-q');
  write(directory, 'catalog/capability-registry.json', fs.readFileSync(REGISTRY_FIXTURE));
  if (stacks !== undefined) write(directory, 'contracts/stacks.json', stacks);
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'registry');
  git(directory, 'tag', 'contracts-v0.3.0');
  return directory;
}

test('sync writes the stack vocabulary next to the registry when the ref ships one', () => {
  const ecpRoot = ecpRepo({ stacks: fs.readFileSync(STACKS_FIXTURE) });
  const output = path.join(temp(), 'out', 'registry.json');
  const outcome = command.runSync({ ref: 'contracts-v0.3.0', ecpRoot, output }, { env: {} });
  const stacksPath = path.join(path.dirname(output), 'registry.stacks.json');
  assert.deepEqual(outcome.result.stacks, { output: stacksPath, sha256: sha(fs.readFileSync(STACKS_FIXTURE)), stacks_version: '1.0.0' });
  assert.ok(fs.readFileSync(stacksPath).equals(fs.readFileSync(STACKS_FIXTURE)));
  assert.match(outcome.text, /stacks sha256: [a-f0-9]{64}/);
  assert.deepEqual(fs.readdirSync(path.dirname(output)).sort(), ['registry.json', 'registry.stacks.json'], 'no staging files left');
  const loaded = loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: output, sha256: outcome.result.sha256 } } });
  assert.equal(loaded.vocabulary.normalize('rn'), 'react-native', 'the synced pair works as a path registry');
  const explicit = path.join(temp(), 'vocab.json');
  assert.equal(
    command.runSync({ ref: 'contracts-v0.3.0', ecpRoot, output, stacksOutput: explicit }, { env: {} }).result.stacks.output,
    explicit,
  );
});

test('sync without a stacks file in the ref reports v1 and writes none; an invalid one fails before writing', () => {
  const output = path.join(temp(), 'registry.json');
  const none = command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: ecpRepo(), output }, { env: {} });
  assert.equal(none.result.stacks, null);
  assert.match(none.text, /stack rules stay at resolution v1/);
  assert.deepEqual(fs.readdirSync(path.dirname(output)), ['registry.json']);
  const target = path.join(temp(), 'registry.json');
  assert.throws(
    () => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: ecpRepo({ stacks: '{"schema_version":"1"}' }), output: target }, { env: {} }),
    /Invalid stack vocabulary/,
  );
  assert.throws(
    () => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: ecpRepo({ stacks: 'nope' }), output: target }, { env: {} }),
    /Invalid stack vocabulary: not valid JSON/,
  );
  assert.equal(fs.existsSync(target), false, 'nothing is written when the vocabulary is invalid');
});

test('drift also compares the stacks snapshot when its lock ships', () => {
  const stacksBytes = fs.readFileSync(STACKS_FIXTURE);
  const ecp = ecpRepo({ stacks: stacksBytes });
  const registryBytes = fs.readFileSync(REGISTRY_FIXTURE);
  const runtime = temp('hseos-stacks-drift-');
  const registryLock = {
    schema_version: '1.0.0',
    repository: 'x/y',
    ref: 'contracts-v0.3.0',
    contracts_version: '0.3.0',
    sha256: sha(registryBytes),
  };
  write(runtime, SNAPSHOT_LOCK_FILE, JSON.stringify(registryLock));
  assert.equal(command.runDrift({ ecpRoot: ecp }, { runtimeRoot: runtime }).result.stacks, undefined, 'no stacks lock, no stacks drift');
  write(runtime, STACKS_LOCK_FILE, JSON.stringify({ ...registryLock, sha256: sha(stacksBytes) }));
  const equal = command.runDrift({ ecpRoot: ecp }, { runtimeRoot: runtime });
  assert.equal(equal.code, 0);
  assert.equal(equal.result.stacks.diverged, false);
  write(runtime, STACKS_LOCK_FILE, JSON.stringify({ ...registryLock, sha256: '0'.repeat(64) }));
  const diverged = command.runDrift({ ecpRoot: ecp }, { runtimeRoot: runtime });
  assert.equal(diverged.code, 1);
  assert.equal(diverged.result.stacks.diverged, true);
  assert.match(diverged.text, /Stacks lock contracts-v0.3.0: DIVERGED/);
  assert.equal(
    command.runDrift({ ecpRoot: ecpRepo() }, { runtimeRoot: runtime }).result.stacks.upstream_sha256,
    null,
    'a ref without stacks.json diverges',
  );
});

test('sync refB (with stacks) then refA (without) leaves no vocabulary behind', () => {
  const stacksBytes = fs.readFileSync(STACKS_FIXTURE);
  const withStacks = ecpRepo({ stacks: stacksBytes });
  const without = ecpRepo();
  const output = path.join(temp(), 'registry.json');
  const stacksPath = path.join(path.dirname(output), 'registry.stacks.json');
  command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: withStacks, output }, { env: {} });
  assert.equal(fs.existsSync(stacksPath), true);
  const outcome = command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: without, output }, { env: {} });
  assert.equal(fs.existsSync(stacksPath), false, 'the stale vocabulary is removed');
  assert.equal(outcome.result.stacks_removed, stacksPath);
  assert.match(outcome.text, /Removed .*registry\.stacks\.json/);
  const loaded = loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: output } } });
  assert.equal(loaded.vocabulary, null);
  assert.deepEqual(fs.readdirSync(path.dirname(output)), ['registry.json']);
});

test('a failure while publishing the pair keeps the previous registry and vocabulary', () => {
  const ecpRoot = ecpRepo({ stacks: fs.readFileSync(STACKS_FIXTURE) });
  const output = path.join(temp(), 'registry.json');
  const stacksPath = path.join(path.dirname(output), 'registry.stacks.json');
  fs.writeFileSync(output, 'old registry');
  fs.writeFileSync(stacksPath, 'old stacks');
  const dir = path.dirname(output);
  // 1. staging fails for the second file (its parent is a regular file): nothing is replaced, no temporaries remain
  const blocker = path.join(temp(), 'file');
  fs.writeFileSync(blocker, 'x');
  assert.throws(() =>
    command.runSync({ ref: 'contracts-v0.3.0', ecpRoot, output, stacksOutput: path.join(blocker, 'v.json') }, { env: {} }),
  );
  assert.equal(fs.readFileSync(output, 'utf8'), 'old registry');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['registry.json', 'registry.stacks.json']);
  // 2. the second rename fails: both previous files are restored
  const realRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (from, to) => {
    if (String(from).endsWith('.tmp') && ++calls === 2) throw new Error('simulated rename failure');
    return realRename(from, to);
  };
  try {
    assert.throws(() => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot, output }, { env: {} }), /simulated rename failure/);
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(fs.readFileSync(output, 'utf8'), 'old registry');
  assert.equal(fs.readFileSync(stacksPath, 'utf8'), 'old stacks');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['registry.json', 'registry.stacks.json'], 'no temporaries or backups remain');
});

test('drift reads the stacks lock with the same integrity checks as the registry lock', () => {
  const ecp = ecpRepo({ stacks: fs.readFileSync(STACKS_FIXTURE) });
  const runtime = temp('hseos-stacks-drift-bad-');
  const registryLock = {
    schema_version: '1.0.0',
    repository: 'x/y',
    ref: 'contracts-v0.3.0',
    contracts_version: '0.3.0',
    sha256: sha(fs.readFileSync(REGISTRY_FIXTURE)),
  };
  write(runtime, SNAPSHOT_LOCK_FILE, JSON.stringify(registryLock));
  write(runtime, STACKS_LOCK_FILE, '{not json');
  assert.throws(
    () => command.runDrift({ ecpRoot: ecp }, { runtimeRoot: runtime }),
    (error) => error instanceof RegistryIntegrityError && /Stacks snapshot lock is unreadable/.test(error.message),
  );
  write(runtime, STACKS_LOCK_FILE, JSON.stringify({ ...registryLock, extra: 1 }));
  assert.throws(() => command.runDrift({ ecpRoot: ecp }, { runtimeRoot: runtime }), /Stacks snapshot lock has an unexpected shape/);
  write(runtime, STACKS_LOCK_FILE, JSON.stringify({ ...registryLock, ref: '--bad', sha256: sha('x') }));
  assert.throws(() => command.runDrift({ ecpRoot: ecp }, { runtimeRoot: runtime }), /Invalid stacks lock ref/);
});

test('an invalid vocabulary in the snapshot is an integrity error', () => {
  const load = (root) => () => loadCapabilityRegistry({ runtimeRoot: root, bindings: { registry: { source: 'snapshot' } } });
  const withBytes = (text) => {
    const root = runtimeWith({ mutateStacks: () => text });
    const lock = JSON.parse(fs.readFileSync(path.join(root, STACKS_LOCK_FILE), 'utf8'));
    write(root, STACKS_LOCK_FILE, JSON.stringify({ ...lock, sha256: sha(Buffer.from(text)) }));
    return root;
  };
  assert.throws(load(withBytes('{not json')), (error) => error instanceof RegistryIntegrityError && /not valid JSON/.test(error.message));
  const broken = stacksDocument();
  broken.stacks[0].accepts = ['cobol'];
  assert.throws(
    load(withBytes(JSON.stringify(broken))),
    (error) => error instanceof RegistryIntegrityError && /unknown stack 'cobol'/.test(error.message),
  );
});

// ---------------------------------------------------------------------------------------------
// Resolver and capability-check parity (resolution v1.1)

const yaml = require('yaml');
const { runCapabilityCheck, renderText } = require('../tools/cli/commands/capability-check');
const { createStackFilter, matchExport, resolveCapability } = require('../tools/cli/lib/capability-registry');

const SHIPPED = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, SNAPSHOT_FILE), 'utf8'));

/** A project whose bindings point at a `path` registry (with an optional sibling vocabulary) and declare stacks. */
function projectWith({ registry, withVocabulary, stacks }) {
  const dir = temp('hseos-stacks-project-');
  write(dir, 'registry.json', JSON.stringify(registry));
  if (withVocabulary) write(dir, 'registry.stacks.json', fs.readFileSync(STACKS_FIXTURE));
  const doc = { schema_version: '1.0.0', mode: 'platform', stacks, registry: { source: 'path', path: 'registry.json' } };
  write(dir, '.hseos/config/platform-bindings.yaml', yaml.stringify(doc));
  return dir;
}

const isolatedEnv = () => ({ HOME: temp('hseos-stacks-home-'), XDG_CONFIG_HOME: temp('hseos-stacks-xdg-') });
const run = (query, dir) => runCapabilityCheck(query, { directory: dir, env: isolatedEnv(), runtimeRoot: REPO_ROOT }).report;

function mutatedRegistry(mutation) {
  const registry = SHIPPED();
  mutation(registry, (name) => registry.capabilities.find((capability) => capability.name === name));
  return registry;
}

test('without a vocabulary stacks keep the v1 rule: lower-case equality, no alias, no accepts', () => {
  const dir = projectWith({ registry: SHIPPED(), withVocabulary: false, stacks: ['node'] });
  const [result] = run('auth.authenticate', dir).results;
  assert.equal(result.verdict, 'extend', 'node does not reach typescript');
  assert.deepEqual(result.other_stacks, ['python', 'typescript']);
  assert.deepEqual(result.missing_targets, []);
  const aliased = projectWith({ registry: SHIPPED(), withVocabulary: false, stacks: ['ts'] });
  assert.equal(run('auth.authenticate', aliased).results[0].verdict, 'extend', "'ts' is not an alias without a vocabulary");
  const upper = projectWith({ registry: SHIPPED(), withVocabulary: false, stacks: ['typescript'] });
  assert.equal(run('auth.authenticate', upper).results[0].verdict, 'consume');
  const filter = createStackFilter(['TypeScript'], null);
  assert.equal(filter.keeps({ stack: 'typescript' }), true);
  assert.equal(filter.keeps({ stack: 'node' }), false);
  assert.equal(filter.isDirect({ stack: 'node' }), true, 'every kept implementation is direct under v1');
});

test('with a vocabulary: aliases, directional accepts, canonical other_stacks', () => {
  const node = projectWith({ registry: SHIPPED(), withVocabulary: true, stacks: ['node'] });
  const [viaAccepts] = run('auth.authenticate', node).results;
  assert.equal(viaAccepts.verdict, 'consume', 'node accepts typescript');
  assert.equal(viaAccepts.verdict_text, 'consume ecp-client (experimental)');
  assert.deepEqual(viaAccepts.other_stacks, ['python']);
  assert.deepEqual(
    viaAccepts.implementations.map((implementation) => implementation.stack),
    ['typescript'],
  );
  const alias = projectWith({ registry: SHIPPED(), withVocabulary: true, stacks: ['ts'] });
  assert.equal(run('auth.authenticate', alias).results[0].verdict, 'consume');
  const typescript = projectWith({ registry: SHIPPED(), withVocabulary: true, stacks: ['typescript'] });
  const [reverse] = run('messaging.event-envelope', typescript).results;
  assert.equal(reverse.verdict, 'extend', 'typescript does not accept node (directional)');
  assert.deepEqual(reverse.other_stacks, ['dotnet', 'go', 'node', 'python']);
  const rn = projectWith({ registry: SHIPPED(), withVocabulary: true, stacks: ['rn'] });
  const [mobile] = run('design.mobile-tokens', rn).results;
  assert.equal(mobile.verdict, 'consume');
  assert.deepEqual(mobile.other_stacks, [], 'planned flutter is not consumable');
  const upperCase = projectWith({ registry: SHIPPED(), withVocabulary: true, stacks: ['golang'] });
  assert.deepEqual(
    run('security.authn', upperCase).results[0].implementations.map((implementation) => implementation.stack),
    ['go'],
  );
});

test('accepts is not transitive in the resolver', () => {
  const document = stacksDocument();
  document.stacks.find((stack) => stack.id === 'typescript').accepts = ['python'];
  const chained = createVocabulary(document);
  const registry = SHIPPED();
  const results = resolveCapability(registry, 'auth.authenticate', { stacks: ['node'], vocabulary: chained });
  assert.deepEqual([...new Set(results[0].implementations.map((implementation) => implementation.stack))], ['typescript']);
  const typescript = resolveCapability(registry, 'auth.authenticate', { stacks: ['typescript'], vocabulary: chained });
  assert.deepEqual([...new Set(typescript[0].implementations.map((implementation) => implementation.stack))].sort(), [
    'python',
    'typescript',
  ]);
});

test('the chosen implementation prefers the queried stack over one reached through accepts', () => {
  const registry = mutatedRegistry((r, capability) => {
    capability('auth.authenticate').implementations.push({
      stack: 'node',
      kind: 'library',
      package: 'ecp-node-client',
      contract_version: '0.4.0',
      status: 'experimental',
    });
  });
  const dir = projectWith({ registry, withVocabulary: true, stacks: ['node'] });
  const [result] = run('auth.authenticate', dir).results;
  assert.match(result.verdict_text, /^consume ecp-node-client \(experimental\)/, 'direct node before via typescript');
  const both = projectWith({ registry, withVocabulary: true, stacks: ['node', 'typescript'] });
  assert.match(run('auth.authenticate', both).results[0].verdict_text, /^consume ecp-client /, 'both direct: the v1 order applies');
  const without = projectWith({ registry, withVocabulary: false, stacks: ['node'] });
  assert.match(run('auth.authenticate', without).results[0].verdict_text, /^consume ecp-node-client/);
});

test('missing_targets: derived from targets and implementations, independent of the stack filter', () => {
  const registry = mutatedRegistry((r, capability) => {
    capability('auth.authenticate').targets = [
      { stack: 'go', required: false },
      { stack: 'node', required: true },
      { stack: 'python', required: true },
    ];
    // A stale coverage block must never be read.
    capability('auth.authenticate').coverage = [{ target: 'go', required: false, status: 'stable' }];
  });
  const dir = projectWith({ registry, withVocabulary: true, stacks: ['python'] });
  const [result] = run('auth.authenticate', dir).results;
  assert.deepEqual(result.missing_targets, [{ stack: 'go', required: false }]);
  assert.match(renderText(run('auth.authenticate', dir)), /missing targets: go \(optional\)/);
  const noVocabulary = projectWith({ registry, withVocabulary: false, stacks: ['python'] });
  assert.deepEqual(
    run('auth.authenticate', noVocabulary).results[0].missing_targets,
    [
      { stack: 'go', required: false },
      { stack: 'node', required: true },
    ],
    'without accepts, node is not satisfied by typescript',
  );
});

test('matchExport follows the same stack rules', () => {
  const registry = SHIPPED();
  const vocab = vocabulary();
  const withSymbol = mutatedRegistry((r, capability) => {
    capability('auth.authenticate').match = { symbols: ['AuthenticateUser'] };
  });
  const v1 = matchExport(withSymbol, { symbol: 'AuthenticateUser', stacks: ['node'] }).matches[0];
  assert.equal(v1.stableForStack, false);
  assert.equal(v1.implementations.length, 0);
  const v11 = matchExport(withSymbol, { symbol: 'AuthenticateUser', stacks: ['node'], vocabulary: vocab }).matches[0];
  assert.deepEqual(
    v11.implementations.map((implementation) => implementation.stack),
    ['typescript'],
  );
});
