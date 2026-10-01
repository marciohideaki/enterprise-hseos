'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('yaml');
const command = require('../tools/cli/commands/platform-bindings');
const { SNAPSHOT_FILE, SNAPSHOT_LOCK_FILE, loadCapabilityRegistry } = require('../tools/cli/lib/capability-registry');
const { applyPlatformBindings, platformFlags, preparePlatformBindings, baselineMode } = require('../tools/cli/lib/platform-bindings-cli');
const { readRecordedMode } = require('../tools/cli/lib/platform-bindings');

const REPO_ROOT = path.join(__dirname, '..');
const HSEOS_CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'ecp-registry', 'registry-0.3.0.json');
const BINDINGS_FILE = '.hseos/config/platform-bindings.yaml';

const cleanup = [];
test.after(() => {
  for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true });
});

function temp(prefix = 'hseos-pb-cmd-') {
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

function gitProject(files = {}) {
  const directory = temp();
  git(directory, 'init', '-q');
  write(directory, 'README.md', '# project\n');
  for (const [relative, content] of Object.entries(files)) write(directory, relative, content);
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'base');
  return directory;
}

function userEnv() {
  const home = temp('hseos-pb-home-');
  return { HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache') };
}

const projectFile = (mode, extra = '') => `schema_version: 1.0.0\nmode: ${mode}\n${extra}`;
const DECISION = 'docs/decisions/why.md';

test('show reports the default for a project without a bindings file', () => {
  const directory = temp();
  write(directory, 'package.json', '{}');
  const { code, result } = command.runShow({ directory }, { runtimeRoot: REPO_ROOT, env: userEnv() });
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, SNAPSHOT_LOCK_FILE), 'utf8'));
  assert.equal(code, 0);
  assert.equal(result.mode, 'platform');
  assert.equal(result.source, 'default-no-file');
  assert.deepEqual(result.stacks, ['node']);
  assert.deepEqual(result.registry, { source: 'snapshot', ref: lock.ref, sha256: lock.sha256 });
  assert.deepEqual(result.errors, []);
  assert.equal(fs.existsSync(path.join(directory, BINDINGS_FILE)), false);
});

test('show text output lists mode, stacks, registry and problems', () => {
  const directory = temp();
  write(directory, BINDINGS_FILE, 'mode: off\n');
  const { text, result } = command.runShow({ directory }, { runtimeRoot: REPO_ROOT, env: userEnv() });
  assert.match(text, /Mode: platform \(source: invalid-file\)/);
  assert.match(text, /Registry: source=snapshot ref=contracts-v0\.3\.1 sha256=[a-f0-9]{64}/);
  assert.match(text, /error: project file:/);
  assert.equal(result.errors.length, 1);
});

test('show honors explicit stacks, overrides and a committed weaker mode without false downgrade errors', () => {
  const directory = gitProject({
    [DECISION]: '# why\nINTAKE-1\n',
    'docs/decisions/cache-intake.md': 'INTAKE-1\n',
    [BINDINGS_FILE]: projectFile(
      'hybrid',
      'stacks: [dotnet]\noverrides:\n  - {capability: cache.typed, outcome: keep-local, intake_ref: INTAKE-1, reason: r, expires: "2999-01-01"}\n',
    ),
  });
  const { code, result, text } = command.runShow({ directory }, { runtimeRoot: REPO_ROOT, env: userEnv() });
  assert.equal(code, 0);
  assert.equal(result.mode, 'hybrid');
  assert.deepEqual(result.stacks, ['dotnet']);
  assert.equal(result.overrides[0].capability, 'cache.typed');
  assert.deepEqual(result.errors, []);
  assert.match(text, /cache\.typed=keep-local \(project, expires 2999-01-01\)/);
});

test('show exits 1 only when the registry fails its integrity check', () => {
  const runtimeRoot = temp();
  for (const file of [SNAPSHOT_FILE, SNAPSHOT_LOCK_FILE]) {
    fs.mkdirSync(path.dirname(path.join(runtimeRoot, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(runtimeRoot, file));
  }
  fs.appendFileSync(path.join(runtimeRoot, SNAPSHOT_FILE), ' ');
  const directory = temp();
  const tampered = command.runShow({ directory }, { runtimeRoot, env: userEnv() });
  assert.equal(tampered.code, 1);
  assert.match(tampered.result.registry.error, /sha256 mismatch/);

  const env = userEnv();
  write(
    env.XDG_CONFIG_HOME,
    'hseos/platform-bindings.yaml',
    'schema_version: 1.0.0\nregistry:\n  source: path\n  path: /nonexistent/registry.json\n',
  );
  const missing = command.runShow({ directory }, { runtimeRoot: REPO_ROOT, env });
  assert.equal(missing.code, 0);
  assert.equal(missing.result.registry.source, 'path');
  assert.ok(missing.result.registry.error);
});

test('check passes a project without a bindings file and reports the HEAD baseline', () => {
  const directory = temp();
  const { code, result } = command.runCheck({ directory }, { runtimeRoot: REPO_ROOT });
  assert.equal(code, 0);
  assert.equal(result.mode, 'platform');
  assert.equal(result.baseRef, 'HEAD');
  assert.equal(result.baseMode, 'platform');
});

test('check fails on an invalid project file', () => {
  const directory = temp();
  write(directory, BINDINGS_FILE, projectFile('platform', 'unknown: 1\n'));
  const invalid = command.runCheck({ directory }, { runtimeRoot: REPO_ROOT });
  assert.equal(invalid.code, 1);
  assert.match(invalid.text, /error: project file: Invalid platform bindings \(project\)/);
});

test('check without --base uses HEAD as the baseline and prints it', () => {
  const directory = gitProject();
  write(directory, BINDINGS_FILE, projectFile('hybrid'));
  const downgrade = command.runCheck({ directory }, { runtimeRoot: REPO_ROOT });
  assert.equal(downgrade.code, 1, 'an uncommitted downgrade is caught against HEAD');
  assert.equal(downgrade.result.baseRef, 'HEAD');
  assert.equal(downgrade.result.baseMode, 'platform');
  assert.match(downgrade.text, /recorded mode at HEAD: platform/);
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'hybrid');
  const committed = command.runCheck({ directory }, { runtimeRoot: REPO_ROOT });
  assert.equal(committed.code, 0, 'once committed, HEAD records hybrid');
  assert.equal(committed.result.baseMode, 'hybrid');
  const explicit = command.runCheck({ directory, base: 'HEAD~1' }, { runtimeRoot: REPO_ROOT });
  assert.equal(explicit.code, 1);
  assert.equal(explicit.result.baseRef, 'HEAD~1');
});

test('check ignores the machine user layer', () => {
  const directory = temp();
  write(directory, BINDINGS_FILE, projectFile('platform'));
  const outcome = command.runCheck({ directory }, { runtimeRoot: REPO_ROOT });
  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.mode, 'platform');
});

test('check --base rejects a downgrade without a decision record and accepts one with it', () => {
  const directory = gitProject();
  write(directory, BINDINGS_FILE, projectFile('hybrid'));
  const rejected = command.runCheck({ directory, base: 'HEAD' }, { runtimeRoot: REPO_ROOT });
  assert.equal(rejected.code, 1);
  assert.equal(rejected.result.baseMode, 'platform');
  assert.match(rejected.text, /weaker than the recorded mode 'platform'/);

  write(directory, DECISION, '# why\n');
  write(directory, BINDINGS_FILE, projectFile('hybrid', `mode_ref: ${DECISION}\n`));
  const accepted = command.runCheck({ directory, base: 'HEAD' }, { runtimeRoot: REPO_ROOT });
  assert.equal(accepted.code, 0);
  assert.equal(accepted.result.mode, 'hybrid');
});

test('check --base compares with the committed mode, not the working tree', () => {
  const directory = gitProject({ [DECISION]: '# why\n', [BINDINGS_FILE]: projectFile('local', `mode_ref: ${DECISION}\n`) });
  assert.deepEqual(readRecordedMode(directory, 'HEAD'), { mode: 'local', source: 'committed' });
  write(directory, BINDINGS_FILE, projectFile('hybrid'));
  const outcome = command.runCheck({ directory, base: 'HEAD' }, { runtimeRoot: REPO_ROOT });
  assert.equal(outcome.code, 0, 'hybrid is stricter than the recorded local');
  assert.equal(outcome.result.baseMode, 'local');
  fs.rmSync(path.join(directory, BINDINGS_FILE));
  assert.equal(command.runCheck({ directory, base: 'HEAD' }, { runtimeRoot: REPO_ROOT }).code, 0, 'removing the file means platform');
});

test('check --base exits 2 on git errors', () => {
  const directory = gitProject();
  const badRef = command.runCheck({ directory, base: 'no-such-ref' }, { runtimeRoot: REPO_ROOT });
  assert.equal(badRef.code, 2);
  assert.match(badRef.text, /^error: git/);
  assert.equal(command.runCheck({ directory, base: '--upload-pack=x' }, { runtimeRoot: REPO_ROOT }).code, 2);
  assert.equal(command.runCheck({ directory: gitProject(), base: 'HEAD~5' }, { runtimeRoot: REPO_ROOT }).code, 2);
});

test('the canonical readRecordedMode answers platform for absent files, unborn HEAD and non-repositories', () => {
  assert.deepEqual(readRecordedMode(temp()), { mode: 'platform', source: 'default' });
  assert.deepEqual(readRecordedMode(gitProject()), { mode: 'platform', source: 'default' });
  const empty = temp();
  git(empty, 'init', '-q');
  assert.deepEqual(readRecordedMode(empty), { mode: 'platform', source: 'default' }, 'a repository without commits records platform');
});

function withoutGit(fn) {
  const original = process.env.PATH;
  process.env.PATH = temp('hseos-pb-nopath-');
  try {
    return fn();
  } finally {
    process.env.PATH = original;
  }
}

test('baselineMode reads only the committed mode and never falls back to the working tree', () => {
  assert.equal(baselineMode(temp()), 'platform');
  const empty = temp();
  git(empty, 'init', '-q');
  write(empty, BINDINGS_FILE, projectFile('local', `mode_ref: ${DECISION}\n`));
  assert.equal(baselineMode(empty), 'platform', 'a repository without commits is platform, whatever the working tree says');
  const committed = gitProject({ [BINDINGS_FILE]: projectFile('hybrid') });
  write(committed, BINDINGS_FILE, projectFile('local', `mode_ref: ${DECISION}\n`));
  assert.equal(baselineMode(committed), 'hybrid', 'HEAD wins over the working tree');
  const unreadable = gitProject({ [BINDINGS_FILE]: '{{{' });
  assert.equal(baselineMode(unreadable), 'platform');
});

test('baselineMode aborts with a clear error when git cannot run', () => {
  const directory = gitProject({ [BINDINGS_FILE]: projectFile('hybrid') });
  write(directory, BINDINGS_FILE, projectFile('local', `mode_ref: ${DECISION}\n`));
  const outcome = withoutGit(() => {
    try {
      baselineMode(directory);
    } catch (error) {
      return error;
    }
    return null;
  });
  assert.ok(outcome, 'fails closed instead of reading the working tree');
  assert.equal(outcome.name, 'PlatformBindingsError');
  assert.match(outcome.message, /cannot read the recorded platform mode: git failed/);
});

test('check exits 2 when git cannot run and show aborts', () => {
  const directory = gitProject();
  write(directory, BINDINGS_FILE, projectFile('platform'));
  const check = withoutGit(() => command.runCheck({ directory }, { runtimeRoot: REPO_ROOT }));
  assert.equal(check.code, 2);
  assert.match(check.text, /^error: cannot read the recorded platform mode/);
  assert.throws(
    () => withoutGit(() => command.runShow({ directory }, { runtimeRoot: REPO_ROOT, env: userEnv() })),
    /cannot read the recorded platform mode/,
  );
});

test('an unresolvable --base is a usage error (exit 2), not a silent platform baseline', () => {
  const directory = gitProject();
  const outcome = command.runCheck({ directory, base: 'no-such-ref' }, { runtimeRoot: REPO_ROOT });
  assert.equal(outcome.code, 2);
  assert.equal(command.runCheck({ directory, base: '-x' }, { runtimeRoot: REPO_ROOT }).code, 2);
  assert.equal(command.runCheck({ directory, base: 'HEAD' }, { runtimeRoot: REPO_ROOT }).code, 0);
});

function ecpRepo(registryText = fs.readFileSync(FIXTURE, 'utf8')) {
  const directory = temp('hseos-pb-ecp-');
  git(directory, 'init', '-q');
  write(directory, 'catalog/capability-registry.json', registryText);
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'registry');
  git(directory, 'tag', 'contracts-v0.3.0');
  return directory;
}

test('sync copies a tagged registry to the cache, verifies it and prints the user-layer snippet', () => {
  const ecpRoot = ecpRepo();
  const env = userEnv();
  const outcome = command.runSync({ ref: 'contracts-v0.3.0', ecpRoot }, { env });
  const expectedSha = crypto.createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex');
  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.sha256, expectedSha);
  assert.equal(outcome.result.output, path.join(env.XDG_CACHE_HOME, 'hseos', 'ecp-registry', 'contracts-v0.3.0.json'));
  assert.ok(fs.readFileSync(outcome.result.output).equals(fs.readFileSync(FIXTURE)));
  assert.equal(outcome.result.contracts_version, '0.3.0');
  const snippet = yaml.parse(outcome.result.user_layer_snippet);
  assert.deepEqual(snippet, { registry: { source: 'path', path: outcome.result.output, sha256: expectedSha } });
  assert.match(outcome.text, /nothing was edited/);
  const loaded = loadCapabilityRegistry({ bindings: snippet });
  assert.equal(loaded.sha256, expectedSha);
  assert.equal(fs.existsSync(path.join(env.XDG_CONFIG_HOME)), false, 'user configuration is never edited');
  assert.deepEqual(fs.readdirSync(path.dirname(outcome.result.output)), ['contracts-v0.3.0.json'], 'no staging files left');
});

test('sync honors --output and sanitizes refs in the default file name', () => {
  const ecpRoot = ecpRepo();
  const output = path.join(temp(), 'nested', 'registry.json');
  assert.equal(command.runSync({ ref: 'contracts-v0.3.0', ecpRoot, output }, { env: userEnv() }).result.output, output);
  assert.ok(fs.existsSync(output));
  git(ecpRoot, 'branch', 'feature/x');
  const env = userEnv();
  const outcome = command.runSync({ ref: 'feature/x', ecpRoot }, { env });
  assert.equal(path.basename(outcome.result.output), 'feature%2Fx.json');
  const lookalike = command.runSync({ ref: 'feature_x', ecpRoot: (git(ecpRoot, 'branch', 'feature_x'), ecpRoot) }, { env });
  assert.equal(path.basename(lookalike.result.output), 'feature_x.json');
  assert.notEqual(lookalike.result.output, outcome.result.output, 'a/b and a_b never share a cache file');
});

test('sync rejects a registry whose declared ref differs from --ref and accepts a matching one', () => {
  const withRef = (ref) =>
    ecpRepo(
      JSON.stringify({
        ...JSON.parse(fs.readFileSync(FIXTURE, 'utf8')),
        generated_from: { repository: 'x/y', contracts_version: '0.3.0', ref },
      }),
    );
  const env = userEnv();
  assert.throws(
    () => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: withRef('contracts-v0.2.0') }, { env }),
    /declares generated_from\.ref 'contracts-v0\.2\.0' but --ref is 'contracts-v0\.3\.0'/,
  );
  assert.equal(fs.existsSync(env.XDG_CACHE_HOME), false);
  assert.equal(command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: withRef('contracts-v0.3.0') }, { env }).code, 0);
});

test('sync requires a contracts-vX.Y.Z tag to match the registry contracts_version', () => {
  const ecpRoot = ecpRepo();
  git(ecpRoot, 'tag', 'contracts-v9.9.9');
  git(ecpRoot, 'tag', 'release-candidate');
  const env = userEnv();
  assert.throws(
    () => command.runSync({ ref: 'contracts-v9.9.9', ecpRoot }, { env }),
    /declares contracts_version 0\.3\.0, expected 9\.9\.9/,
  );
  assert.equal(fs.existsSync(env.XDG_CACHE_HOME), false, 'nothing is written on a version mismatch');
  assert.equal(command.runSync({ ref: 'contracts-v0.3.0', ecpRoot }, { env }).code, 0);
  assert.equal(command.runSync({ ref: 'release-candidate', ecpRoot }, { env }).code, 0, 'other refs are anchored by the printed sha256');
});

test('sync gives a clear message for a registry over the size cap', () => {
  const huge = ecpRepo(`{"pad":"${'x'.repeat(5 * 1024 * 1024 + 10)}"}`);
  const env = userEnv();
  assert.throws(() => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: huge }, { env }), /too large/);
  assert.equal(fs.existsSync(env.XDG_CACHE_HOME), false);
});

test('sync rejects bad input without writing', () => {
  const ecpRoot = ecpRepo();
  const env = userEnv();
  assert.throws(() => command.runSync({ ref: 'contracts-v0.3.0' }, { env }), /requires --ref/);
  assert.throws(() => command.runSync({ ecpRoot }, { env }), /requires --ref/);
  assert.throws(() => command.runSync({ ref: '--output=x', ecpRoot }, { env }), /Invalid --ref/);
  assert.throws(() => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: '/nonexistent/ecp' }, { env }), /not a directory/);
  assert.throws(
    () => command.runSync({ ref: 'contracts-v9.9.9', ecpRoot }, { env }),
    /Cannot read catalog\/capability-registry\.json at contracts-v9\.9\.9/,
  );
  assert.throws(() => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: temp() }, { env }), /Cannot read/);
  assert.equal(fs.existsSync(env.XDG_CACHE_HOME), false);
  const malformed = ecpRepo('{"schema_version":"1"}');
  assert.throws(() => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: malformed }, { env }), /Invalid capability registry/);
  const notJson = ecpRepo('not json');
  assert.throws(() => command.runSync({ ref: 'contracts-v0.3.0', ecpRoot: notJson }, { env }), /not valid JSON/);
  assert.equal(fs.existsSync(env.XDG_CACHE_HOME), false, 'nothing is written for an invalid registry');
});

test('the action dispatches show, check and sync, sets the exit code and rejects unknown actions', async () => {
  const directory = temp();
  const original = { log: console.log, exitCode: process.exitCode };
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    await command.action('show', { directory, json: true });
    assert.equal(JSON.parse(lines.pop()).mode, 'platform');
    await command.action('check', { directory });
    assert.match(lines.pop(), /Platform bindings: platform/);
    write(directory, BINDINGS_FILE, 'mode: off\n');
    await command.action('check', { directory });
    assert.equal(process.exitCode, 1);
    process.exitCode = original.exitCode;
    await assert.rejects(command.action('sync', { directory }), /requires --ref/);
    await assert.rejects(command.action('nope', {}), /Unknown platform-bindings action/);
  } finally {
    console.log = original.log;
    process.exitCode = original.exitCode;
  }
});

test('the command is registered in the CLI manifest with its options', () => {
  const manifest = require('../tools/cli/command-manifest.json');
  const entry = manifest.entries.find((candidate) => candidate.filename === 'platform-bindings.js');
  assert.equal(entry.command, 'platform-bindings <action>');
  assert.deepEqual(
    entry.options.map((option) => option[0]),
    ['--directory <path>', '--json', '--base <git-ref>', '--ref <tag>', '--ecp-root <path>', '--output <file>'],
  );
  const optionsOf = (file) => manifest.entries.find((candidate) => candidate.filename === file).options.map((option) => option[0]);
  for (const file of ['install.js', 'install-plan.js']) {
    assert.ok(optionsOf(file).includes('--platform-mode <mode>'), file);
    assert.ok(optionsOf(file).includes('--platform-binding <spec...>'), file);
    assert.ok(optionsOf(file).includes('--mode-ref <path>'), file);
  }
});

test('platformFlags maps install options and rejects inconsistent ones', () => {
  assert.equal(platformFlags({}), null);
  assert.equal(platformFlags({ profile: 'minimal' }), null);
  assert.deepEqual(platformFlags({ platformMode: 'platform' }), { mode: 'platform', modeRef: undefined, bindings: [] });
  const flags = platformFlags({ platformMode: 'local', modeRef: DECISION, platformBinding: 'cache.typed=keep-local:INTAKE-1:2027-01-01' });
  assert.equal(flags.bindings[0].capability, 'cache.typed');
  assert.equal(flags.bindings[0].reason, 'declared at installation');
  assert.equal(platformFlags({ platformBinding: ['a.b=exception:EXC-1:2027-01-01', 'c.d=exception:EXC-2:2027-01-01'] }).bindings.length, 2);
  assert.throws(() => platformFlags({ platformMode: 'off' }), /--platform-mode must be one of/);
  assert.throws(() => platformFlags({ modeRef: DECISION }), /--mode-ref requires --platform-mode/);
  assert.throws(() => platformFlags({ platformBinding: ['garbage'] }), /Invalid --platform-binding/);
  assert.throws(
    () => platformFlags({ platformBinding: ['cache.typed=keep-local:INTAKE-1:2027-01-01', 'cache.typed=exception:EXC-1:2027-01-01'] }),
    /duplicate binding for cache\.typed/,
  );
  for (const bad of [{ platformMode: 'off' }, { modeRef: DECISION }, { platformBinding: ['garbage'] }]) {
    assert.throws(
      () => platformFlags(bad),
      (error) => error.name === 'PlatformBindingsError',
    );
  }
});

test('an invalid existing project file is rebuilt from scratch when --platform-mode is explicit', () => {
  const env = userEnv();
  const directory = temp();
  write(directory, BINDINGS_FILE, projectFile('platform', 'unknown: 1\nstacks: [go]\n'));
  const prepare = (options) => preparePlatformBindings({ projectDir: directory, runtimeRoot: REPO_ROOT, env, options });
  const rebuilt = prepare({ platformMode: 'platform' });
  assert.deepEqual(rebuilt.doc, { schema_version: '1.0.0', mode: 'platform' }, 'nothing is kept from the invalid file');
  assert.equal(rebuilt.warnings.length, 1);
  assert.match(rebuilt.warnings[0], /invalid .*built from scratch/);
  assert.throws(
    () => prepare({ platformBinding: ['cache.typed=keep-local:INTAKE-1:2027-01-01'] }),
    /project file: Invalid platform bindings/,
  );
  assert.deepEqual(prepare({ platformMode: 'platform' }).loaded.errors.length, 1, 'the loader still reports the invalid file');
  assert.equal(applyPlatformBindings(directory, rebuilt), path.join(directory, BINDINGS_FILE));
  assert.equal(prepare({ platformMode: 'platform' }).warnings.length, 0, 'the rewritten file is valid');
});

test('preparePlatformBindings writes nothing and returns null without platform options', () => {
  const directory = temp();
  assert.equal(
    preparePlatformBindings({ projectDir: directory, runtimeRoot: REPO_ROOT, options: { profile: 'developer', directory } }),
    null,
  );
  assert.equal(applyPlatformBindings(directory, null), null);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('preparePlatformBindings builds the project document and validates before any write', () => {
  const env = userEnv();
  const prepare = (directory, options) => preparePlatformBindings({ projectDir: directory, runtimeRoot: REPO_ROOT, options, env });
  const directory = temp();
  const explicit = prepare(directory, { platformMode: 'platform' });
  assert.deepEqual(explicit.doc, { schema_version: '1.0.0', mode: 'platform' });
  assert.equal(fs.existsSync(path.join(directory, BINDINGS_FILE)), false, 'preparing never writes');
  assert.throws(() => prepare(directory, { platformMode: 'local' }), /Platform bindings are invalid:[\s\S]*requires --mode-ref/);
  assert.throws(() => prepare(directory, { platformMode: 'local', modeRef: DECISION }), /Platform bindings are invalid/);
  assert.throws(
    () => prepare(directory, { platformMode: 'platform', platformBinding: ['cache.typed=keep-local:INTAKE-1:2027-01-01'] }),
    /not recorded in the repository/,
  );
  assert.throws(
    () => prepare(directory, { platformMode: 'platform', platformBinding: ['cache.typed=keep-local:INTAKE-1:2000-01-01'] }),
    /Platform bindings are invalid/,
  );
  assert.deepEqual(fs.readdirSync(directory), [], 'invalid requests leave the project untouched');

  write(directory, DECISION, '# why\n');
  write(directory, 'docs/decisions/cache-intake.md', 'INTAKE-1 INTAKE-2\n');
  const weaker = prepare(directory, {
    platformMode: 'hybrid',
    modeRef: DECISION,
    platformBinding: ['cache.typed=keep-local:INTAKE-1:2999-01-01', 'auth.authn=keep-local:INTAKE-2:2999-01-01'],
  });
  assert.equal(weaker.doc.mode, 'hybrid');
  assert.equal(weaker.doc.mode_ref, DECISION);
  assert.deepEqual(
    weaker.doc.overrides.map((override) => override.capability),
    ['auth.authn', 'cache.typed'],
  );
  assert.equal(weaker.doc.overrides[0].reason, 'declared at installation');
  assert.equal('layer' in weaker.doc.overrides[0], false);
  const written = applyPlatformBindings(directory, weaker);
  assert.equal(written, path.join(directory, BINDINGS_FILE));
  assert.equal(yaml.parse(fs.readFileSync(written, 'utf8')).mode, 'hybrid');
});

test('preparePlatformBindings merges with an existing project file and keeps registry and stacks', () => {
  const env = userEnv();
  const directory = temp();
  write(directory, DECISION, '# why\n');
  write(directory, 'docs/decisions/cache-intake.md', 'INTAKE-1\n');
  write(directory, 'docs/decisions/exception-log.md', 'EXC-0007\n');
  write(
    directory,
    BINDINGS_FILE,
    projectFile(
      'hybrid',
      `mode_ref: ${DECISION}\nstacks: [go]\nregistry: {source: snapshot}\noverrides:\n  - {capability: cache.typed, outcome: keep-local, intake_ref: INTAKE-1, reason: kept, expires: "2999-01-01"}\n`,
    ),
  );
  const prepared = preparePlatformBindings({
    projectDir: directory,
    runtimeRoot: REPO_ROOT,
    env,
    options: { platformBinding: ['data.query=exception:EXC-0007:2999-01-01'] },
  });
  assert.equal(prepared.doc.mode, 'hybrid', 'the existing mode is kept when only bindings are given');
  assert.equal(prepared.doc.mode_ref, DECISION);
  assert.deepEqual(prepared.doc.stacks, ['go']);
  assert.deepEqual(prepared.doc.registry, { source: 'snapshot' });
  assert.deepEqual(
    prepared.doc.overrides.map((override) => [override.capability, override.reason]),
    [
      ['cache.typed', 'kept'],
      ['data.query', 'declared at installation'],
    ],
  );
  const strengthened = preparePlatformBindings({
    projectDir: directory,
    runtimeRoot: REPO_ROOT,
    env,
    options: { platformMode: 'platform' },
  });
  assert.equal(strengthened.doc.mode, 'platform');
  assert.equal(strengthened.doc.mode_ref, undefined, 'a decision record is dropped when the mode no longer needs one');

  write(directory, BINDINGS_FILE, projectFile('platform', 'unknown: 1\n'));
  assert.throws(
    () =>
      preparePlatformBindings({
        projectDir: directory,
        runtimeRoot: REPO_ROOT,
        env,
        options: { platformBinding: ['data.query=exception:EXC-0007:2999-01-01'] },
      }),
    /project file: Invalid platform bindings/,
  );
});

function runInstall(args) {
  return spawnSync(process.execPath, [HSEOS_CLI, 'install', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...userEnv() },
    timeout: 240_000,
  });
}

test('install reports malformed platform options as one error line with exit 1 and no stack', () => {
  const directory = temp();
  const cases = [
    [['--platform-mode', 'bogus'], /^error: --platform-mode must be one of platform, hybrid, local$/],
    [['--mode-ref', DECISION], /^error: --mode-ref requires --platform-mode$/],
    [['--platform-binding', 'garbage'], /^error: Invalid --platform-binding 'garbage'/],
    [
      ['--platform-binding', 'cache.typed=keep-local:INTAKE-1:2027-01-01', '--platform-binding', 'cache.typed=exception:EXC-1:2027-01-01'],
      /^error: duplicate binding for cache\.typed$/,
    ],
  ];
  for (const [flags, expected] of cases) {
    const result = runInstall(['--profile', 'minimal', '--directory', directory, '--yes', ...flags]);
    assert.equal(result.status, 1, result.stderr);
    const lines = result.stderr.trim().split('\n');
    assert.equal(lines.length, 1, result.stderr);
    assert.match(lines[0], expected);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\n\s+at /);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('install --profile minimal aborts on invalid bindings before writing anything', () => {
  const directory = temp();
  const result = runInstall(['--profile', 'minimal', '--directory', directory, '--yes', '--platform-mode', 'local']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(`${result.stdout}${result.stderr}`, /Platform bindings are invalid[\s\S]*--mode-ref/);
  assert.deepEqual(fs.readdirSync(directory), [], 'nothing was written');
});

test('install --profile minimal writes the requested bindings and nothing without platform options', () => {
  const withFlags = temp();
  write(withFlags, DECISION, '# why\n');
  write(withFlags, 'docs/decisions/cache-intake.md', 'INTAKE-1 INTAKE-2\n');
  const result = runInstall([
    '--profile',
    'minimal',
    '--directory',
    withFlags,
    '--yes',
    '--json',
    '--platform-mode',
    'hybrid',
    '--mode-ref',
    DECISION,
    '--platform-binding',
    'cache.typed=keep-local:INTAKE-1:2999-01-01',
    '--platform-binding',
    'auth.authn=keep-local:INTAKE-2:2999-01-01',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.equal(receipt.platform_bindings, path.join(withFlags, BINDINGS_FILE));
  const doc = yaml.parse(fs.readFileSync(receipt.platform_bindings, 'utf8'));
  assert.equal(doc.mode, 'hybrid');
  assert.equal(doc.mode_ref, DECISION);
  assert.deepEqual(
    doc.overrides.map((override) => override.capability),
    ['auth.authn', 'cache.typed'],
  );

  const plain = temp();
  const plainResult = runInstall(['--profile', 'minimal', '--directory', plain, '--yes', '--json']);
  assert.equal(plainResult.status, 0, plainResult.stderr);
  assert.equal(fs.existsSync(path.join(plain, BINDINGS_FILE)), false, 'no bindings file without explicit options');
  assert.equal('platform_bindings' in JSON.parse(plainResult.stdout.trim().split('\n').pop()), false);
});

test('install-plan previews the bindings without writing them', () => {
  const directory = temp();
  const run = (...args) =>
    spawnSync(process.execPath, [HSEOS_CLI, 'install-plan', '--profile', 'minimal', '--json', ...args], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, ...userEnv() },
    });
  const preview = run('--platform-mode', 'platform');
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout).platform_bindings, { schema_version: '1.0.0', mode: 'platform' });
  assert.deepEqual(fs.readdirSync(directory), []);
  const plain = run();
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal('platform_bindings' in JSON.parse(plain.stdout), false);
  assert.notEqual(run('--platform-mode', 'local').status, 0);
});
