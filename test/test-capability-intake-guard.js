'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  detectExport,
  detectExports,
  inspectedCode,
  lexLegacy,
  lexLegacyFast,
  evaluateGuard,
  extractSymbol,
  isProtectedBindingsPath,
  qualifies,
  stripNonCode,
  tokenizeJs,
  tokenizeJsViews,
} = require('../tools/cli/lib/capability-intake-guard');
const command = require('../tools/cli/commands/platform-bindings');

const REPO_ROOT = path.join(__dirname, '..');
const HANDLER = path.join(REPO_ROOT, '.enterprise', 'governance', 'hooks', 'handlers', 'capability-intake-guard.sh');
const COMPILED_HANDLER = path.join(REPO_ROOT, '.agents', 'hooks', 'handlers', 'capability-intake-guard.sh');
const LEGACY_HANDLER = path.join(__dirname, 'fixtures', 'capability-intake-guard', 'legacy-handler.sh');
const FIXTURE_REGISTRY = path.join(__dirname, 'fixtures', 'ecp-registry', 'registry-0.3.0.json');
const BINDINGS = '.hseos/config/platform-bindings.yaml';
const HAS_JQ = spawnSync('jq', ['--version']).status === 0;

const cleanup = [];
test.after(() => {
  for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true });
});

function temp(prefix = 'hseos-guard-') {
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

/** Records the working tree at HEAD, so a bindings mode written by a test is the recorded mode and not a downgrade (ADR-0046 section 8). */
function commitAll(directory) {
  const git = (...args) =>
    execFileSync(
      'git',
      ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      { stdio: 'ignore' },
    );
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'record bindings');
}

function gitProject(files = {}) {
  const directory = temp();
  const git = (...args) =>
    execFileSync(
      'git',
      ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      {
        stdio: 'ignore',
      },
    );
  git('init', '-q');
  write(directory, 'README.md', '# project\n');
  for (const [relative, content] of Object.entries(files)) write(directory, relative, content);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return directory;
}

const projectFile = (mode, extra = '') => `schema_version: 1.0.0\nmode: ${mode}\n${extra}`;
const hookInput = (file, content, tool = 'Write') =>
  JSON.stringify({ tool_name: tool, tool_input: { file_path: file, content, new_string: content } });
const EXPORT = 'export class ICacheStore {}';
const quietEnv = (extra = {}) => ({ HOME: '/nonexistent-hseos-guard-home', XDG_CONFIG_HOME: '/nonexistent-hseos-guard-home', ...extra });

function guard(directory, file, content, { env = quietEnv(), tool } = {}) {
  const outcome = evaluateGuard({ input: hookInput(file, content, tool), cwd: directory, env, runtimeRoot: REPO_ROOT });
  return { ...outcome, json: outcome.stdout ? JSON.parse(outcome.stdout) : null };
}

const contextOf = (outcome) => outcome.json.hookSpecificOutput.additionalContext;

/** A copy of the 0.3.0 registry inside the project where cache.typed is stable for dotnet. */
function stableRegistry(directory, { longGlob = false } = {}) {
  const registry = JSON.parse(fs.readFileSync(FIXTURE_REGISTRY, 'utf8'));
  const cache = registry.capabilities.find((capability) => capability.name === 'cache.typed');
  cache.implementations[0].status = 'stable';
  cache.implementations[0].package_version = '1.0.0';
  cache.implementations[0].conformance = { vectors_version: '0.1.0' };
  if (longGlob) cache.match.path_globs = ['a'.repeat(600)];
  write(directory, 'vendor/registry.json', JSON.stringify(registry));
  return 'registry: {source: path, path: vendor/registry.json}\n';
}

test('shared predicates port the shell rules', () => {
  assert.equal(qualifies('/p/packages/x/a.ts', EXPORT), true);
  assert.equal(qualifies('/p/applications/demo/src/a.ts', 'export default function A() {}'), true);
  assert.equal(qualifies('/p/src/Services/Demo/A.cs', 'public static class A {}'), true);
  assert.equal(qualifies('/p/packages/x/a.test.ts', EXPORT), false);
  assert.equal(qualifies('/p/packages/x/__mocks__/a.ts', EXPORT), false);
  assert.equal(qualifies('/p/packages/x/dist/a.ts', EXPORT), false);
  assert.equal(qualifies('/p/lib/a.ts', EXPORT), false, 'unwatched path');
  assert.equal(qualifies('/p/packages/x/a.ts', 'const a = 1'), false);
  assert.equal(qualifies('/p/packages/x/a.ts', 'export {a}'), true);
  assert.equal(qualifies('/p/packages/x/a.ts', 'export\nclass A {}'), true, 'declarations may span lines');
  assert.equal(extractSymbol('x\nexport default function Foo() {}\nexport class Bar {}'), 'Foo');
  assert.equal(extractSymbol('public static class AuditHelper {}'), 'AuditHelper');
  assert.equal(extractSymbol('export {a}'), null);
  assert.equal(isProtectedBindingsPath('/p/.hseos/config/platform-bindings.yaml'), true);
  assert.equal(isProtectedBindingsPath('.hseos/config/platform-bindings.yaml'), true);
  assert.equal(isProtectedBindingsPath('/p/a/../.hseos/./config//platform-bindings.yaml'), true);
  assert.equal(isProtectedBindingsPath('/P/.HSEOS/Config/Platform-Bindings.YAML'), true, 'case-folded');
  assert.equal(isProtectedBindingsPath(String.raw`C:\p\.hseos\config\platform-bindings.yaml`), true, 'backslashes are separators');
  assert.equal(isProtectedBindingsPath('/p/.hseos/config/other.yaml'), false);
  assert.equal(isProtectedBindingsPath('/p/x/platform-bindings.yaml'), false);
});

test('the compiled handler is identical to the canonical one', () => {
  assert.ok(fs.readFileSync(COMPILED_HANDLER).equals(fs.readFileSync(HANDLER)));
});

// ---- Golden: a project without bindings keeps today's behaviour byte for byte ----

function runHandler(handler, directory, input, env = {}) {
  const result = spawnSync('bash', [handler], {
    cwd: directory,
    input,
    encoding: 'utf8',
    env: { ...process.env, CORE_INTAKE_ACK: '', ...env },
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('golden: without a bindings file the handler output is identical to the frozen legacy handler', { skip: !HAS_JQ }, () => {
  const directory = gitProject({ 'docs/decisions/2026-intake.md': 'ack: intake-widget\n', 'packages/ui/WidgetHelper.ts': '//\n' });
  const src = (relative) => path.join(directory, relative);
  const cases = [
    ['export without ack', hookInput(src('applications/demo/src/Widget.tsx'), 'export function Widget() {}'), {}],
    [
      'export with a valid ack',
      hookInput(src('applications/demo/src/Widget.tsx'), 'export function Widget() {}'),
      { CORE_INTAKE_ACK: 'intake-widget' },
    ],
    [
      'ack that only substring-matches',
      hookInput(src('applications/demo/src/Widget.tsx'), 'export function Widget() {}'),
      { CORE_INTAKE_ACK: 'intake' },
    ],
    ['legacy ack 1', hookInput(src('applications/demo/src/Widget.tsx'), 'export function Widget() {}'), { CORE_INTAKE_ACK: '1' }],
    ['non-export', hookInput(src('applications/demo/src/Widget.tsx'), 'const Widget = 1'), {}],
    ['unwatched path', hookInput(src('lib/Widget.ts'), 'export function Widget() {}'), {}],
    ['test file', hookInput(src('applications/demo/src/Widget.test.tsx'), 'export function Widget() {}'), {}],
    ['edit export', hookInput(src('applications/demo/src/useDemo.ts'), 'export function useDemo() {}', 'Edit'), {}],
    ['dotnet public class', hookInput(src('src/Services/Demo/AuditHelper.cs'), 'public static class AuditHelper {}'), {}],
    ['export block without symbol', hookInput(src('packages/ui/index.ts'), 'export { a, b }'), {}],
    ['candidate lookup', hookInput(src('packages/ui/other.ts'), 'export const WidgetHelper = 1'), {}],
    ['no file path', JSON.stringify({ tool_input: {} }), {}],
    [
      'MultiEdit (legacy sees no content)',
      JSON.stringify({
        tool_name: 'MultiEdit',
        tool_input: { file_path: src('packages/ui/index.ts'), edits: [{ old_string: 'a', new_string: 'export class A {}' }] },
      }),
      {},
    ],
    ['unparseable input', 'not json', {}],
    ['bindings file path (new protection only applies with the protected path)', hookInput(src('docs/notes.md'), 'x'), {}],
  ];
  for (const [label, input, env] of cases) {
    const legacy = runHandler(LEGACY_HANDLER, directory, input, env);
    const current = runHandler(HANDLER, directory, input, env);
    assert.deepEqual(current, legacy, `golden mismatch: ${label}`);
  }
  assert.equal(runHandler(HANDLER, directory, cases[0][1]).status, 2);
  assert.equal(runHandler(HANDLER, directory, cases[1][1], cases[1][2]).status, 0);
});

// ---- Handler integration with bindings ----

function cliShim() {
  const bin = temp('hseos-guard-bin-');
  write(bin, 'hseos', `#!/usr/bin/env bash\nexec "${process.execPath}" "${path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js')}" "$@"\n`);
  fs.chmodSync(path.join(bin, 'hseos'), 0o755);
  return bin;
}

test('handler: with bindings the CLI decides; without a usable CLI the platform decision applies', { skip: !HAS_JQ }, () => {
  const directory = gitProject({
    [BINDINGS]: projectFile('local', 'mode_ref: docs/decisions/why.md\n'),
    'docs/decisions/why.md': '# why\n',
  });
  const input = hookInput(path.join(directory, 'applications/demo/src/Widget.tsx'), 'export function Widget() {}');
  const withCli = `${cliShim()}:${process.env.PATH}`;
  const started = Date.now();
  const local = runHandler(HANDLER, directory, input, { PATH: withCli, HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent' });
  const elapsed = Date.now() - started;
  assert.equal(local.status, 0, local.stderr);
  assert.equal(local.stdout, '');
  assert.ok(elapsed < 5000, `guard through the CLI took ${elapsed} ms`);
  const legacyOnSameInput = runHandler(LEGACY_HANDLER, directory, input);
  assert.equal(legacyOnSameInput.status, 2, 'today the same input is blocked');

  const noCli = runHandler(HANDLER, directory, input, {
    PATH: path.dirname(execFileSync('which', ['jq'], { encoding: 'utf8' }).trim()) + ':/bin',
  });
  assert.deepEqual(
    noCli,
    runHandler(LEGACY_HANDLER, directory, input, {
      PATH: path.dirname(execFileSync('which', ['jq'], { encoding: 'utf8' }).trim()) + ':/bin',
    }),
    'no CLI -> today path',
  );
  assert.equal(noCli.status, 2);

  const brokenBin = temp('hseos-guard-broken-');
  write(brokenBin, 'hseos', '#!/usr/bin/env bash\nexit 7\n');
  fs.chmodSync(path.join(brokenBin, 'hseos'), 0o755);
  const broken = runHandler(HANDLER, directory, input, { PATH: `${brokenBin}:${process.env.PATH}` });
  assert.equal(broken.status, 2, 'a failing CLI falls back to the platform decision');
  assert.equal(broken.stdout, legacyOnSameInput.stdout);
});

test('handler: platform mode through the CLI matches the legacy decision and adds registry candidates', { skip: !HAS_JQ }, () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const input = hookInput(path.join(directory, 'packages/cache/src/Store.ts'), 'export class ICacheStore {}');
  const env = { PATH: `${cliShim()}:${process.env.PATH}`, HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent' };
  const result = runHandler(HANDLER, directory, input, env);
  assert.equal(result.status, 2);
  const context = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(context.permissionDecision, 'deny');
  assert.equal(context.permissionDecisionReason, 'capability-intake-required');
  assert.match(context.additionalContext, /^\[CAPABILITY-INTAKE\] Export ICacheStore requires a valid CORE_INTAKE_ACK=<intake-id>/);
  assert.match(context.additionalContext, /Candidates: .*cache\.typed/);
});

test('handler: the bindings file is protected from Write and Edit, with or without bindings', { skip: !HAS_JQ }, () => {
  for (const withFile of [false, true]) {
    const directory = gitProject(withFile ? { [BINDINGS]: projectFile('platform') } : {});
    for (const tool of ['Write', 'Edit']) {
      for (const file of [path.join(directory, BINDINGS), BINDINGS, path.join(directory, 'x', '..', BINDINGS)]) {
        const result = runHandler(HANDLER, directory, hookInput(file, 'schema_version: 1.0.0\nmode: local\n', tool));
        assert.equal(result.status, 2, `${tool} ${file}`);
        const output = JSON.parse(result.stdout).hookSpecificOutput;
        assert.equal(output.permissionDecisionReason, 'platform-bindings-protected');
        assert.match(output.additionalContext, /human-owned \(ADR-0046 §4\).*hseos install --platform-mode/);
      }
    }
  }
  const sibling = gitProject();
  assert.equal(runHandler(HANDLER, sibling, hookInput(path.join(sibling, '.hseos/config/other.yaml'), 'x')).status, 0);
});

// ---- Guard action per mode ----

test('guard: local allows silently, even for an export with no intake', () => {
  const directory = gitProject({
    [BINDINGS]: projectFile('local', 'mode_ref: docs/decisions/why.md\n'),
    'docs/decisions/why.md': '# why\n',
  });
  const outcome = guard(directory, path.join(directory, 'packages/cache/Store.ts'), EXPORT);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.stdout, '');
});

test('guard: platform blocks without an ack, lists registry and filesystem candidates, honours token-exact acks and overrides', () => {
  const directory = gitProject({
    [BINDINGS]: projectFile('platform'),
    'docs/decisions/2026-intake-cache.md': 'ack: INTAKE-1\n',
    'packages/ui/ICacheStoreHelper.ts': '//\n',
  });
  const file = path.join(directory, 'packages/cache/src/Store.ts');
  const denied = guard(directory, file, EXPORT);
  assert.equal(denied.exitCode, 2);
  assert.equal(denied.json.hookSpecificOutput.permissionDecision, 'deny');
  const context = contextOf(denied);
  assert.match(
    context,
    /Export ICacheStore requires a valid CORE_INTAKE_ACK=<intake-id> recorded in docs\/decisions\/\*intake\*\.md\. CORE_INTAKE_ACK=1 is invalid\. Run: hseos capability-check ICacheStore\./,
  );
  assert.match(context, /Candidates: packages\/ui\/ICacheStoreHelper\.ts, .*cache\.typed/);
  assert.equal(guard(directory, file, EXPORT, { env: quietEnv({ CORE_INTAKE_ACK: 'INTAKE-1' }) }).exitCode, 0, 'valid ack');
  for (const weak of ['INTAKE', 'Intake', 'intake', 'the', 'ack']) {
    assert.equal(
      guard(directory, file, EXPORT, { env: quietEnv({ CORE_INTAKE_ACK: weak }) }).exitCode,
      2,
      `'${weak}' is not shaped like an intake id`,
    );
  }
  assert.equal(guard(directory, file, EXPORT, { env: quietEnv({ CORE_INTAKE_ACK: '1' }) }).exitCode, 2);
  write(directory, 'docs/decisions/2026-10-intake-cache-ref.md', 'recorded: INTAKE-2026-10-cache\n');
  assert.equal(
    guard(directory, file, EXPORT, { env: quietEnv({ CORE_INTAKE_ACK: 'INTAKE-2026-10-cache' }) }).exitCode,
    0,
    'a shaped, recorded id',
  );
  assert.equal(
    guard(directory, file, EXPORT, { env: quietEnv({ CORE_INTAKE_ACK: 'INTAKE-2026' }) }).exitCode,
    2,
    'shaped, but only a prefix of a recorded id',
  );
  assert.equal(
    guard(directory, file, EXPORT, { env: quietEnv({ CORE_INTAKE_ACK: 'a(b' }) }).exitCode,
    2,
    'ids with regex characters never match',
  );
  assert.equal(
    guard(directory, path.join(directory, 'packages/cache/src/Other.ts'), 'export class Unrelated {}').exitCode,
    2,
    'no registry match still blocks in platform mode',
  );

  write(
    directory,
    BINDINGS,
    projectFile(
      'platform',
      'overrides:\n  - {capability: cache.typed, outcome: keep-local, intake_ref: INTAKE-1, reason: latency, expires: "2999-01-01"}\n',
    ),
  );
  const overridden = guard(directory, file, EXPORT);
  assert.equal(overridden.exitCode, 0);
  assert.match(contextOf(overridden), /Override recorded in platform bindings for cache\.typed/);
});

test('guard: hybrid blocks only stable matches for the project stacks and advises otherwise', () => {
  const directory = gitProject({ 'docs/decisions/2026-intake-cache.md': 'ack: INTAKE-1\n', 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  const file = path.join(directory, 'packages/cache/src/Store.ts');
  const withBindings = (extra = '') =>
    write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}${extra}`));
  withBindings();
  commitAll(directory);

  const blocked = guard(directory, file, EXPORT);
  assert.equal(blocked.exitCode, 2);
  assert.match(
    contextOf(blocked),
    /matches stable platform capabilities for this project's stacks: cache\.typed \[stable\] \(Hideakisolutions\.Platform\.Caching\.Abstractions, Hideakisolutions\.Platform\.Caching\.Redis\)/,
  );
  assert.equal(
    guard(directory, file, EXPORT, { env: quietEnv({ CORE_INTAKE_ACK: 'INTAKE-1' }) }).exitCode,
    0,
    'a valid ack lifts the block',
  );

  const advisory = guard(directory, path.join(directory, 'packages/msg/src/Env.ts'), 'export class EventEnvelope {}');
  assert.equal(advisory.exitCode, 0, 'experimental capability: advisory only');
  assert.match(contextOf(advisory), /Advisory: EventEnvelope relates to platform capabilities: messaging\.event-envelope.*None is stable/);

  const unrelated = guard(directory, path.join(directory, 'packages/x/src/U.ts'), 'export class Unrelated {}');
  assert.equal(unrelated.exitCode, 0);
  assert.equal(unrelated.stdout, '', 'no match: nothing to say');

  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [node]\n${registryLine}`));
  commitAll(directory);
  const otherStack = guard(directory, file, EXPORT);
  assert.equal(otherStack.exitCode, 0, 'stable only for another stack');

  withBindings(
    'overrides:\n  - {capability: cache.typed, outcome: exception, exception_ref: EXC-0007, reason: legacy, expires: "2999-01-01"}\n',
  );
  assert.equal(
    guard(directory, file, EXPORT).exitCode,
    2,
    'an unrecorded exception reference invalidates the file and falls back to platform',
  );
  write(directory, 'docs/decisions/exception-log.md', 'EXC-0007 approved\n');
  const overridden = guard(directory, file, EXPORT);
  assert.equal(overridden.exitCode, 0, 'a recorded override covers the stable match');
  assert.match(contextOf(overridden), /Override recorded in platform bindings for cache\.typed/);
});

test('guard: hybrid matches by path glob and always surfaces registry warnings', () => {
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory, { longGlob: true });
  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  commitAll(directory);
  const advisory = guard(directory, path.join(directory, 'packages/msg/src/event-envelope.schema.json'), 'export const Schema = 1');
  assert.equal(advisory.exitCode, 0);
  assert.match(contextOf(advisory), /Registry warning: cache\.typed: path glob ignored/);
  const blocked = guard(directory, path.join(directory, 'packages/cache/src/Store.ts'), EXPORT);
  assert.equal(blocked.exitCode, 2);
  assert.match(contextOf(blocked), /Registry warning: cache\.typed: path glob ignored/);
});

test('guard: failures resolve to the platform decision and say why', () => {
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const file = path.join(directory, 'packages/cache/src/Store.ts');

  write(
    directory,
    BINDINGS,
    projectFile('platform', 'registry: {source: path, path: vendor/registry.json, sha256: "' + 'a'.repeat(64) + '"}\n'),
  );
  write(directory, 'vendor/registry.json', fs.readFileSync(FIXTURE_REGISTRY, 'utf8'));
  const integrity = guard(directory, file, EXPORT);
  assert.equal(integrity.exitCode, 2);
  assert.match(contextOf(integrity), /Capability registry unavailable \(integrity check failed\)/);

  write(
    directory,
    BINDINGS,
    projectFile(
      'hybrid',
      'mode_ref: docs/decisions/why.md\nregistry: {source: path, path: vendor/registry.json, sha256: "' + 'a'.repeat(64) + '"}\n',
    ),
  );
  const hybridIntegrity = guard(directory, file, EXPORT);
  assert.equal(hybridIntegrity.exitCode, 2, 'hybrid without registry data cannot prove a match: platform decision');

  write(directory, BINDINGS, projectFile('hybrid'));
  const downgrade = guard(directory, file, EXPORT);
  assert.equal(downgrade.exitCode, 2, 'an uncommitted downgrade without a decision record is not honoured');
  assert.match(contextOf(downgrade), /weaker than the recorded mode/);
  write(directory, BINDINGS, 'mode: off\n');
  const invalid = guard(directory, file, EXPORT);
  assert.equal(invalid.exitCode, 2);
  assert.match(contextOf(invalid), /Platform bindings problem: project file: Invalid platform bindings/);

  write(directory, BINDINGS, projectFile('local', 'mode_ref: docs/decisions/why.md\n'));
  const originalPath = process.env.PATH;
  process.env.PATH = temp('hseos-guard-nogit-');
  let gitFailure;
  try {
    gitFailure = guard(directory, file, EXPORT);
  } finally {
    process.env.PATH = originalPath;
  }
  assert.equal(gitFailure.exitCode, 2, 'git failure is fail closed: platform decision even for local mode');
  assert.match(contextOf(gitFailure), /Bindings baseline unavailable .*git failed/);
});

test('guard: protected path, unparseable input and non-qualifying input', () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const protectedWrite = guard(directory, path.join(directory, BINDINGS), 'mode: local');
  assert.equal(protectedWrite.exitCode, 2);
  assert.equal(protectedWrite.json.hookSpecificOutput.permissionDecisionReason, 'platform-bindings-protected');
  assert.equal(evaluateGuard({ input: 'not json', cwd: directory, env: quietEnv(), runtimeRoot: REPO_ROOT }).exitCode, 0);
  assert.equal(guard(directory, path.join(directory, 'packages/x/a.test.ts'), EXPORT).exitCode, 0);
  assert.equal(guard(directory, path.join(directory, 'packages/x/a.ts'), 'const a = 1').exitCode, 0);
  assert.equal(guard(directory, '', EXPORT).exitCode, 0);
});

test('guard: decisions are fast', () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const started = process.hrtime.bigint();
  for (let index = 0; index < 5; index++) guard(directory, path.join(directory, 'packages/cache/src/Store.ts'), EXPORT);
  const perCall = Number(process.hrtime.bigint() - started) / 1e6 / 5;
  assert.ok(perCall < 1000, `${perCall.toFixed(0)} ms per decision`);
});

test('the guard action reads stdin and sets the hook exit code', async () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const input = hookInput(path.join(directory, 'packages/cache/src/Store.ts'), EXPORT);
  const direct = command.runGuard(input, { runtimeRoot: REPO_ROOT, cwd: directory, env: quietEnv() });
  assert.equal(direct.exitCode, 2);
  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js'), 'platform-bindings', 'guard'], {
    cwd: directory,
    input,
    encoding: 'utf8',
    env: { ...process.env, ...quietEnv(), CORE_INTAKE_ACK: '' },
  });
  assert.equal(run.status, 2, run.stderr);
  assert.equal(run.stdout, direct.stdout);
  const allowed = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js'), 'platform-bindings', 'guard'], {
    cwd: directory,
    input: hookInput(path.join(directory, 'packages/cache/src/Store.ts'), 'const a = 1'),
    encoding: 'utf8',
    env: { ...process.env, ...quietEnv() },
  });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');
});

// ---- Correction round 1: detection, paths, MultiEdit, protection spellings, stderr ----

test('export detection covers the documented forms and extracts symbols', () => {
  const forms = [
    ['export async function Fetcher() {}', 'Fetcher'],
    ['export enum Color { Red }', 'Color'],
    ['export const enum Flags { A }', 'Flags'],
    ['export abstract class Base {}', 'Base'],
    ['export declare function declared(): void', 'declared'],
    ['export function* gen() {}', 'gen'],
    ['export let counter = 0', 'counter'],
    ['export namespace Ns {}', 'Ns'],
    ['export default function Named() {}', 'Named'],
    ['export default class Klass {}', 'Klass'],
    ['export default async function Later() {}', 'Later'],
    ['export default function () {}', null],
    ['export default () => 1', null],
    ['export default class extends Base {}', null],
    ['export { a, b }', null],
    ['module.exports = { a }', null],
    ['exports.helper = () => 1', 'helper'],
    ['export\nfunction Multi() {}', 'Multi'],
    ['export function\n  Spread() {}', 'Spread'],
    ['internal sealed class Svc {}', 'Svc'],
    ['public record Dto(int A);', 'Dto'],
    ['public record struct Pair(int A);', 'Pair'],
    ['public partial struct Pt {}', 'Pt'],
    ['public readonly struct Ro {}', 'Ro'],
    ['public enum Kind { A }', 'Kind'],
    ['public static partial class Ext {}', 'Ext'],
    ['public abstract class Abs {}', 'Abs'],
    ['public interface IThing {}', 'IThing'],
  ];
  for (const [content, symbol] of forms) {
    const found = detectExport(content);
    assert.ok(found, `detected: ${content}`);
    assert.equal(found.symbol, symbol, `symbol of: ${content}`);
  }
  for (const content of [
    'const a = 1',
    'class Internal {}',
    'function helper() {}',
    'private class Hidden {}',
    'public void Method() {}',
    'let exported = 1',
  ]) {
    assert.equal(detectExport(content), null, `not an export: ${content}`);
  }
  assert.equal(detectExport('const a = 1\nexport class First {}\nexport class Second {}').symbol, 'First', 'first export wins');
});

test('guard: every export form is evaluated, unknown symbols included', () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const file = path.join(directory, 'packages/lib/src/thing.ts');
  for (const content of [
    'export async function Fetcher() {}',
    'export enum Color {}',
    'export default () => 1',
    'module.exports = {}',
    'export\nfunction Multi() {}',
    'internal sealed class Svc {}',
    'public record Dto(int A);',
  ]) {
    assert.equal(guard(directory, file, content).exitCode, 2, content);
  }
  assert.match(contextOf(guard(directory, file, 'export { a }')), /Export unknown requires a valid CORE_INTAKE_ACK/);
  assert.match(contextOf(guard(directory, file, 'export async function Fetcher() {}')), /Export Fetcher requires/);
  assert.equal(guard(directory, file, 'const a = 1').exitCode, 0);
});

test('guard: relative paths resolve against the project root and symlink aliases are followed', () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform'), 'packages/cache/src/keep.ts': '//\n', 'sub/keep.txt': 'x\n' });
  fs.symlinkSync(path.join(directory, 'packages', 'cache'), path.join(directory, 'lib'));
  const run = (file, cwd = directory) =>
    evaluateGuard({ input: hookInput(file, EXPORT), cwd, env: quietEnv(), runtimeRoot: REPO_ROOT }).exitCode;
  assert.equal(run('packages/cache/src/Store.ts'), 2, 'relative path');
  assert.equal(
    run('packages/cache/src/Store.ts', path.join(directory, 'sub')),
    2,
    'relative to the project root, not the working directory',
  );
  assert.equal(run('./packages/cache/src/../src/Store.ts'), 2, 'dot segments');
  assert.equal(run(path.join(directory, 'lib', 'src', 'Store.ts')), 2, 'symlink alias into packages/');
  assert.equal(run('lib/src/Store.ts'), 2, 'relative path through the alias');
  assert.equal(run('src/Store.ts'), 0, 'unwatched relative path');
  assert.equal(run('docs/Store.ts'), 0);
  assert.equal(run('applications/demo/src/Widget.tsx'), 2, 'relative applications path');
  assert.equal(run('applications/demo/src/Widget.test.tsx'), 0, 'exclusions still apply');
});

test('guard: MultiEdit edits are concatenated and evaluated; the legacy handler allows them', { skip: !HAS_JQ }, () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const file = path.join(directory, 'packages/cache/src/Store.ts');
  const multi = (...edits) =>
    JSON.stringify({
      tool_name: 'MultiEdit',
      tool_input: { file_path: file, edits: edits.map((newString) => ({ old_string: 'x', new_string: newString })) },
    });
  const evaluate = (input) => evaluateGuard({ input, cwd: directory, env: quietEnv(), runtimeRoot: REPO_ROOT });
  const denied = evaluate(multi('const a = 1', 'export class Late {}'));
  assert.equal(denied.exitCode, 2);
  assert.match(JSON.parse(denied.stdout).hookSpecificOutput.additionalContext, /Export Late requires/);
  assert.equal(evaluate(multi('const a = 1', 'const b = 2')).exitCode, 0);
  assert.equal(evaluate(multi()).exitCode, 0);
  assert.equal(evaluate(JSON.stringify({ tool_input: { file_path: file, edits: [null, {}] } })).exitCode, 0, 'malformed edits are ignored');
  assert.equal(runHandler(LEGACY_HANDLER, directory, multi('export class Late {}')).status, 0, 'legacy sees no content for MultiEdit');
});

test('the intake guard is registered for MultiEdit in the registry and the compiled adapters', () => {
  const yaml = require('yaml');
  const entryOf = (entries) => entries.find((entry) => entry.id === 'pretooluse-write-edit-capability-intake-guard');
  const registry = yaml.parse(fs.readFileSync(path.join(REPO_ROOT, '.enterprise/governance/hooks/registry.yaml'), 'utf8'));
  assert.equal(entryOf(registry.hooks).matcher, 'Write|Edit|MultiEdit');
  assert.match(entryOf(registry.hooks).description, /Bash tool are not covered/);
  const compiled = yaml.parse(fs.readFileSync(path.join(REPO_ROOT, '.agents/hooks/registry.yaml'), 'utf8'));
  assert.equal(entryOf(compiled.hooks).matcher, 'Write|Edit|MultiEdit');
  const codex = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.codex/hseos-hooks.json'), 'utf8'));
  assert.equal(entryOf(codex.hooks).matcher, 'Write|Edit|MultiEdit');
  assert.match(
    fs.readFileSync(path.join(REPO_ROOT, '.claude/hooks.json'), 'utf8'),
    /"matcher": "Write\|Edit\|MultiEdit"[\s\S]*capability-intake-guard\.sh/,
  );
});

test('protection holds for case, separator, symlink and directory-alias spellings', () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  fs.symlinkSync(path.join(directory, '.hseos', 'config'), path.join(directory, 'cfg'));
  fs.symlinkSync(path.join(directory, '.hseos', 'config', 'platform-bindings.yaml'), path.join(directory, 'link.yaml'));
  const spellings = [
    '.HSEOS/Config/Platform-Bindings.YAML',
    String.raw`.hseos\config\platform-bindings.yaml`,
    path.join(directory, 'cfg', 'platform-bindings.yaml'),
    'cfg/platform-bindings.yaml',
    path.join(directory, 'link.yaml'),
    'link.yaml',
    './x/../.hseos//config/./platform-bindings.yaml',
  ];
  for (const spelling of spellings) {
    const outcome = guard(directory, spelling, 'mode: local');
    assert.equal(outcome.exitCode, 2, spelling);
    assert.equal(outcome.json.hookSpecificOutput.permissionDecisionReason, 'platform-bindings-protected', spelling);
  }
  assert.equal(guard(directory, '.hseos/config/other.yaml', 'x').exitCode, 0);
  assert.equal(guard(directory, 'cfg/other.yaml', 'x').exitCode, 0);
});

test('handler: the shell protection uses the same spellings and writes the reason to stderr', { skip: !HAS_JQ }, () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  fs.symlinkSync(path.join(directory, '.hseos', 'config'), path.join(directory, 'cfg'));
  for (const spelling of [
    '.HSEOS/Config/Platform-Bindings.YAML',
    String.raw`.hseos\config\platform-bindings.yaml`,
    'cfg/platform-bindings.yaml',
  ]) {
    const result = runHandler(HANDLER, directory, hookInput(spelling, 'x', 'Edit'));
    assert.equal(result.status, 2, spelling);
    assert.match(result.stderr, /human-owned \(ADR-0046 §4\)/);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, 'platform-bindings-protected');
  }
});

test('denials carry the reason on stderr as well as the JSON on stdout', { skip: !HAS_JQ }, () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const input = hookInput(path.join(directory, 'packages/cache/src/Store.ts'), EXPORT);
  const outcome = evaluateGuard({ input, cwd: directory, env: quietEnv(), runtimeRoot: REPO_ROOT });
  assert.equal(outcome.exitCode, 2);
  assert.equal(outcome.stderr, `${JSON.parse(outcome.stdout).hookSpecificOutput.additionalContext}\n`);
  const quiet = evaluateGuard({
    input: hookInput(path.join(directory, 'packages/x/a.ts'), 'const a = 1'),
    cwd: directory,
    env: quietEnv(),
    runtimeRoot: REPO_ROOT,
  });
  assert.equal(quiet.stderr, '');
  const handler = runHandler(HANDLER, directory, input, {
    PATH: `${cliShim()}:${process.env.PATH}`,
    HOME: '/nonexistent',
    XDG_CONFIG_HOME: '/nonexistent',
  });
  assert.equal(handler.status, 2);
  assert.match(handler.stderr, /^\[CAPABILITY-INTAKE\] Export ICacheStore requires/);
  assert.equal(JSON.parse(handler.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(runHandler(LEGACY_HANDLER, directory, input).stderr, '', 'the legacy handler writes nothing to stderr');
});

// ---- Correction round 2: hook-level delegation, declaration files, comments, strings, re-exports ----

const shimEnv = () => ({ PATH: `${cliShim()}:${process.env.PATH}`, HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent' });

test(
  'handler: with bindings the widened detection, relative paths, aliases and MultiEdit reach the CLI through the hook',
  { skip: !HAS_JQ },
  () => {
    const directory = gitProject({ [BINDINGS]: projectFile('platform'), 'packages/cache/src/keep.ts': '//\n' });
    fs.symlinkSync(path.join(directory, 'packages', 'cache'), path.join(directory, 'lib'));
    const env = shimEnv();
    const abs = (relative) => path.join(directory, relative);
    const multi = (file, ...edits) =>
      JSON.stringify({
        tool_name: 'MultiEdit',
        tool_input: { file_path: file, edits: edits.map((newString) => ({ old_string: 'x', new_string: newString })) },
      });
    const cases = [
      ['export async function', hookInput(abs('packages/shared/a.ts'), 'export async function Fetcher() {}')],
      ['export enum', hookInput(abs('packages/shared/a.ts'), 'export enum Color { Red }')],
      ['C# public sealed class', hookInput(abs('src/Services/Demo/Svc.cs'), 'public sealed class Svc {}')],
      ['relative path', hookInput('packages/shared/a.ts', 'export class Shared {}')],
      ['symlink alias', hookInput(abs('lib/src/Store.ts'), 'export class Store {}')],
      ['MultiEdit', multi(abs('packages/shared/a.ts'), 'const a = 1', 'export class Late {}')],
      ['multi-line declaration', hookInput(abs('packages/shared/a.ts'), 'export\nfunction Multi() {}')],
    ];
    for (const [label, input] of cases) {
      const result = runHandler(HANDLER, directory, input, env);
      assert.equal(result.status, 2, `${label}: ${result.stderr}`);
      assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny', label);
      assert.match(result.stderr, /CAPABILITY-INTAKE/, label);
      // The legacy handler lets most of these through (that is the gap being closed).
      if (
        ['export async function', 'export enum', 'relative path', 'symlink alias', 'MultiEdit', 'multi-line declaration'].includes(label)
      ) {
        assert.equal(runHandler(LEGACY_HANDLER, directory, input).status, 0, `legacy allows: ${label}`);
      }
    }
    assert.equal(runHandler(HANDLER, directory, hookInput(abs('packages/shared/a.ts'), 'const a = 1'), env).status, 0);
    assert.equal(runHandler(HANDLER, directory, hookInput(abs('packages/shared/a.test.ts'), 'export class A {}'), env).status, 0);
  },
);

test('handler: latency in a bindings project stays far below the 5 s timeout', { skip: !HAS_JQ }, () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const env = shimEnv();
  const noop = hookInput(path.join(directory, 'lib/readme.txt'), 'plain text');
  const qualifying = hookInput(path.join(directory, 'packages/shared/a.ts'), 'export class A {}');
  const measure = (handler, input, runEnv) => {
    const started = process.hrtime.bigint();
    for (let index = 0; index < 5; index++) runHandler(handler, directory, input, runEnv);
    return Number(process.hrtime.bigint() - started) / 1e6 / 5;
  };
  const withBindingsNoop = measure(HANDLER, noop, env);
  const withBindingsExport = measure(HANDLER, qualifying, env);
  const legacyNoop = measure(LEGACY_HANDLER, noop, {});
  console.log(
    `  latency per call: bindings non-export ${withBindingsNoop.toFixed(0)} ms, bindings export ${withBindingsExport.toFixed(0)} ms, legacy non-export ${legacyNoop.toFixed(0)} ms`,
  );
  assert.ok(withBindingsNoop < 2000, `${withBindingsNoop.toFixed(0)} ms`);
  assert.ok(withBindingsExport < 2000, `${withBindingsExport.toFixed(0)} ms`);
});

test('guard: TypeScript declaration files are exempt like tests and mocks', () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  for (const name of ['types.d.ts', 'types.d.mts', 'types.d.cts', 'deep/dir/api.d.ts']) {
    assert.equal(guard(directory, path.join(directory, 'packages/shared', name), 'export interface Api {}').exitCode, 0, name);
  }
  assert.equal(guard(directory, path.join(directory, 'packages/shared/types.ts'), 'export interface Api {}').exitCode, 2);
  assert.equal(
    guard(directory, path.join(directory, 'packages/shared/d.ts.bak'), 'export interface Api {}').exitCode,
    2,
    'only real declaration suffixes',
  );
});

test('comments and string literals are not exports', () => {
  const nonExports = [
    ['// export function x() {}', 'js'],
    ['/* export class A {} */', 'js'],
    ['/*\n * export default class A {}\n */\nconst a = 1', 'js'],
    ['const s = "export function x"', 'js'],
    ["const s = 'export class A {}'", 'js'],
    ['const s = `export class A {}`', 'js'],
    ['const s = `line\nexport class A {}\n${x}`', 'js'],
    [String.raw`const doc = "say \"export class A {}\" here"`, 'js'],
    ['const url = "http://x/export class A {}"', 'js'],
    ['// public class A {}', 'cs'],
    ['/* public class A {} */', 'cs'],
    ['var s = "public class A {}";', 'cs'],
    ['var s = @"public class A {}";', 'cs'],
    ['var s = @"line\npublic class A {}";', 'cs'],
    ['var s = $"public class {name}";', 'cs'],
    ['var s = """\npublic class A {}\n""";', 'cs'],
    ["var c = '\"'; // public class A {}", 'cs'],
  ];
  for (const [content, language] of nonExports) assert.equal(detectExport(content, language), null, `${language}: ${content}`);
  assert.equal(detectExport('/* export class Old {} */ export class Real {}').symbol, 'Real');
  assert.equal(detectExport('const s = "// not a comment"; export class Real {}').symbol, 'Real', 'a // inside a string is not a comment');
  assert.equal(detectExport('// c\nexport class Real {}').symbol, 'Real');
  assert.equal(detectExport('var s = @"a""b"; public class Real {}', 'cs').symbol, 'Real', 'verbatim quote escapes');
  assert.equal(detectExport('const re = "unterminated\nexport class Real {}').symbol, 'Real', 'a stray quote ends at the newline');
  assert.equal(stripNonCode('a /* x\ny */ b').split('\n').length, 2, 'line structure is preserved');
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  assert.equal(
    guard(directory, path.join(directory, 'packages/shared/a.ts'), '// export class Documented {}\nconst s = "export function x"').exitCode,
    0,
  );
  assert.equal(guard(directory, path.join(directory, 'src/Services/D/a.cs'), '// public class Documented {}').exitCode, 0);
  assert.equal(guard(directory, path.join(directory, 'src/Services/D/a.cs'), '/* c */ public sealed class Real {}').exitCode, 2);
});

test('re-exports with a from clause are not new capabilities; local export lists still are', () => {
  for (const content of [
    "export * from './x'",
    'export * from "./x"',
    "export * as ns from './x'",
    "export { a } from './x'",
    "export { a as b, c } from './x'",
    "export type { T } from './x'",
    "export type * from './x'",
    "export {\n  a,\n  b,\n} from './x'",
  ]) {
    assert.equal(detectExport(content), null, content);
  }
  assert.deepEqual(detectExport('export { a, b }'), { symbol: null });
  assert.deepEqual(detectExport('export {\n  a,\n}'), { symbol: null });
  assert.equal(detectExport("export { a } from './x'\nexport class Local {}").symbol, 'Local');
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const file = path.join(directory, 'packages/shared/index.ts');
  assert.equal(guard(directory, file, "export * from './x'\nexport { a } from './y'").exitCode, 0, 'a barrel file adds no capability');
  assert.equal(guard(directory, file, 'export { a, b }').exitCode, 2);
});

test('lexer: regex literals and nested templates hide their text; unclosed constructs stay inspected', () => {
  const E = 'export class Real {}';
  // Hidden: an exported-looking text inside a construct that really closes (nothing to detect).
  const hidden = [
    [String.raw`const r = /a\/*b/; // export class A {}`, 'regex with an escaped slash then a star'],
    ['const r = /\\/*/;\n// export class A {}', 'regex whose body is an escaped slash and a star'],
    ['const r = /[/*]/;\n/* export class A {} */', 'slash and star inside a character class'],
    ['x = a.replace(/\\/*/g, "");\nconst s = "export class A {}"', 'regex as a call argument with flags'],
    ['const s = `${`x`} export class A {}`', 'template nested in ${}'],
    ['const s = `${"`"} export class A {}`', 'backtick inside a string inside ${}'],
    ['const s = `a ${ {b: `c ${d}`}.b } export class A {}`', 'braces and templates nested in ${}'],
    ['const s = `${x /* } */}` + "export class A {}"', 'closing brace inside a comment inside ${}'],
    [String.raw`return /\/*/.test(s) ? 1 : 0 // export class A {}`, 'regex after a keyword'],
    ['const a = b / c; // export class A {}', 'division is not a regex'],
    ['const a = (b) / c / d; // export class A {}', 'division after a parenthesis'],
    ['const a = 1; // export class A {} (no trailing newline)', 'line comment without a final newline'],
  ];
  for (const [content, label] of hidden) assert.equal(detectExport(content), null, label);
  // Accepted false positives: the inspected text is the union of both lexings, and the legacy lexing ends the template
  // at the backtick inside the regex or the comment, so the text after it is inspected (an intake is asked for).
  assert.equal(detectExport('const s = `${/`/.test(x)} export class A {}`')?.symbol, 'A', 'backtick inside a regex inside ${}');
  assert.equal(detectExport('const s = `${/* ` */ 1} export class A {}`')?.symbol, 'A', 'backtick inside a comment inside ${}');
  // Accepted false positive (same as before the regex shield): a quote inside a regex still opens a string, so text
  // after it is inspected. Asking for an intake is the safe side; hiding code would not be.
  assert.equal(detectExport('const r = /"/; const s = "export class A {}"')?.symbol, 'A', 'quote inside a regex stays visible');
  // The code after the construct is still seen (the construct must not swallow it).
  const visible = [
    [`const r = /a\\/*b/;\n${E}`, String.raw`regex /a\/*b/`],
    [`const r = /\\/*/;\n${E}`, String.raw`regex /\/*/`],
    [`const s = \`\${\`x\`}\`;\n${E}`, 'nested template'],
    [`const s = \`\${"\`"}\`;\n${E}`, 'backtick in a string in ${}'],
    [`const s = \`a \${ {b: \`c \${d}\`}.b }\`;\n${E}`, 'deep nesting'],
    [`x = a.replace(/\\/*/g, "");\n${E}`, 'regex argument with flags'],
    [`const r = /[/*]/g; ${E}`, 'class with slash and star'],
    [`const a = b / c; /* x */ ${E}`, 'division then a real comment'],
    [`${E} // trailing comment without newline`, 'export before an unterminated line comment'],
  ];
  for (const [content, label] of visible) assert.equal(detectExport(content)?.symbol, 'Real', label);
  // Fail-safe: unclosed constructs are raw text, never ignored content.
  assert.equal(detectExport('/* never closed\nexport class Real {}').symbol, 'Real', 'unclosed block comment is raw text');
  assert.equal(detectExport('/*'), null, 'a bare opener has nothing to inspect');
  assert.equal(detectExport('const s = `never closed ${x}\nexport class Real {}').symbol, 'Real', 'unclosed template');
  assert.equal(detectExport('const s = `${ never closed\nexport class Real {}').symbol, 'Real', 'unclosed ${}');
  assert.equal(detectExport('const s = "never closed\nexport class Real {}').symbol, 'Real', 'unclosed double quote');
  assert.equal(detectExport("const s = 'never closed export class Real {}").symbol, 'Real', 'unclosed quote keeps the rest of its line');
  assert.equal(detectExport('var s = @"never closed\npublic class Real {}', 'cs').symbol, 'Real', 'unclosed verbatim string');
  assert.equal(detectExport('var s = """never closed\npublic class Real {}', 'cs').symbol, 'Real', 'unclosed raw string');
  assert.equal(detectExport('var s = $"never closed public class Real {}', 'cs').symbol, 'Real', 'unclosed interpolated string');
  assert.equal(detectExport('const r = /never closed\nexport class Real {}').symbol, 'Real', 'a slash that never closes is not a regex');
  assert.equal(detectExport('// only a comment'), null);
  // Through the hook: an unclosed comment can no longer hide an export.
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const file = path.join(directory, 'packages/shared/a.ts');
  assert.equal(guard(directory, file, 'const r = /\\/*/;\nexport function Hidden() {}').exitCode, 2);
  assert.equal(guard(directory, file, '/* open\nexport function Hidden() {}').exitCode, 2);
  assert.equal(guard(directory, file, String.raw`const r = /\/*/; // no export here`).exitCode, 0);
});

test('lexer: a division read as a regex never hides code, and pathological input stays linear', () => {
  const exported = [
    'let y = i++ / 2; export class H {} let z = k / 3;',
    'let y = i-- / 2; export class H {} let z = k / 3;',
    'a! / 2; export class H {} let z = k / 3;',
    'o.in / 2; export class H {} let z = k / 3;',
    'this.new / 2; export class H {} let z = k / 3;',
    '<b>x</b>; export class H {} <i>y</i>',
    'x = a / b; export class H {} y = c / d',
    'x = (a) / b; export class H {} y = c / d',
    'return a / 2; export class H {} y = c / d',
  ];
  for (const content of exported) assert.equal(detectExport(content)?.symbol, 'H', content);
  const timed = (content, language) => {
    const started = process.hrtime.bigint();
    const result = detectExport(content, language);
    return { result, milliseconds: Number(process.hrtime.bigint() - started) / 1e6 };
  };
  const normal = timed('const a = 1;\n'.repeat(80_000) + 'export class R {}');
  assert.equal(normal.result?.symbol, 'R');
  assert.ok(normal.milliseconds < 200, `1 MB took ${normal.milliseconds} ms`);
  const patterns = [
    ['x =' + '/['.repeat(128_000) + '\nexport class R {}', 'js'],
    ['`${ '.repeat(10_000) + '\nexport class R {}', 'js'],
    ['@"a" '.repeat(100_000) + 'public class R {}', 'cs'],
  ];
  for (const [content, language] of patterns) {
    const { result, milliseconds } = timed(content, language);
    assert.equal(result?.symbol, 'R', 'the export after a pathological prefix is still seen');
    assert.ok(milliseconds < 1000, `pathological input took ${milliseconds} ms`);
  }
});

test('lexer: a division read as a regex cannot swallow the slash that opens a real comment', () => {
  const cases = [
    'const a = <b>x</b> /* see http://x */ export class H {}',
    '</b> /* c // d */ export class H {}',
    'const n = a! / 2 /* c // d */ export class H {}',
    'const n = a! / 2 /* http://x */ export class H {}',
    'const n = i++ / 2 /* c // d */ export class H {}',
    'const n = i-- / 2 /* http://x */ export class H {}',
    'const n = (a) / 2 /* c // d */ export class H {}',
    'const n = a[0] / 2 /* c // d */ export class H {}',
    'const n = o.in / 2 /* c // d */ export class H {}',
    'const n = a! / 2 // c // d\nexport class H {}',
    'const n = a! / 2 /// c\nexport class H {}',
    "const n = a! / 2 /* it's */ export class H {}",
  ];
  for (const content of cases) assert.equal(detectExport(content)?.symbol, 'H', content);
  // The regex shield still protects a real regex that contains a slash and a star.
  assert.equal(detectExport(String.raw`const r = /a\/*b/; /* c */ // d` + '\nexport class H {}')?.symbol, 'H');
  assert.equal(detectExport(String.raw`const r = /a\/*b/; // export class A {}`), null);
});

// ---- The inspected text is the union of the legacy lexing and the new one ----

const LEGACY_LEXER_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'capability-intake-guard', 'master-lexer.txt'), 'utf8');
const frozenLexer = new Function(`${LEGACY_LEXER_SOURCE}; return stripNonCode;`)();
const blankReexports = (code) =>
  code.replaceAll(/\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s*from\s*""/g, (match) =>
    match.replaceAll(/[^\n]/g, ' '),
  );

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) sourceFiles(full, found);
    else if (/\.(?:c?js|mjs|tsx?|cs|py)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test('lexer union: lexLegacy is the previous lexer byte for byte and everything it leaves visible stays inspected', () => {
  assert.equal(
    lexLegacy.toString(),
    LEGACY_LEXER_SOURCE.slice(LEGACY_LEXER_SOURCE.indexOf('function stripNonCode'))
      .replace('function stripNonCode(', 'function lexLegacy(')
      .trimEnd(),
  );
  const repository = path.join(__dirname, '..');
  const files = [...sourceFiles(path.join(repository, 'tools')), ...sourceFiles(path.join(repository, 'test'))].slice(0, 400);
  assert.ok(files.length >= 50, `corpus has ${files.length} files`);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const language of ['js', 'cs']) {
      assert.equal(lexLegacy(content, language), frozenLexer(content, language), `${file} (${language})`);
      assert.ok(
        inspectedCode(content, language).endsWith(`\n;\n${blankReexports(frozenLexer(content, language))}`),
        `${file} (${language}) inspected text`,
      );
    }
  }
});

test('lexer union: a division read as a regex cannot make the guard see less than the previous release', () => {
  const cases = [
    'declare const a: any;\nconst y = a! /[/*]/ "*/ 1][0]; export class A {} // "',
    'let of = 2; let y = of /[/*]/ "*/ 1]; export class A {} // "',
    'let yield_ = 2; let y = yield /[/*]/ "*/ 1]; export class A {} // "',
    'let await_ = 2; let y = await /[/*]/ "*/ 1]; export class A {} // "',
    'const a = <b>x</b> /* see http://x */ export class A {}',
    '</b> /* c // d */ export class A {}',
    'const n = a! / 2 /* c // d */ export class A {}',
    'const n = i++ / 2 /* http://x */ export class A {}',
    'let y = i++ / 2; export class A {} let z = k / 3;',
    'a! / 2; export class A {} let z = k / 3;',
    'o.in / 2; export class A {} let z = k / 3;',
    'this.new / 2; export class A {} let z = k / 3;',
    '<b>x</b>; export class A {} <i>y</i>',
  ];
  for (const content of cases) assert.equal(detectExport(content)?.symbol, 'A', content);
  // Deterministic differential run against the frozen previous lexer: the guard never misses what it found.
  const tokens = [
    '/',
    '/',
    '*',
    '/*',
    '*/',
    '//',
    '"',
    "'",
    '`',
    '${',
    '}',
    '{',
    '\n',
    ' ',
    'a',
    '=',
    '(',
    ')',
    '[',
    ']',
    '\\',
    'i++',
    '!',
    'of',
    'yield',
    'await',
    'in',
    'new',
    'return',
    '[/*]',
    '/x/g',
    'http://x',
    ';',
    'export class A {}',
    'public class A {}',
    '@"',
    '$"',
    '"""',
  ];
  const frozenDetects = (content, language) => {
    const code = blankReexports(frozenLexer(content, language));
    return /\bexport\s*[{*]|\bexport\s+default\b|\bmodule\.exports\b|\b(?:export|public)\s+(?:(?:declare|async|abstract|static|sealed)\s+)*(?:function|class|const|let|var|interface|type|enum|namespace)\s+[A-Za-z_$][\w$]*/.test(
      code,
    );
  };
  for (const seed of [424_242, 7, 31_337, 1_234_567]) {
    let state = seed;
    const random = () => {
      state = (Math.imul(state, 1_103_515_245) + 12_345) & 0x7f_ff_ff_ff;
      return state / 0x7f_ff_ff_ff;
    };
    for (let round = 0; round < 3000; round += 1) {
      let content = '';
      for (let count = 2 + Math.floor(random() * 14); count > 0; count -= 1) content += tokens[Math.floor(random() * tokens.length)];
      const language = random() < 0.3 ? 'cs' : 'js';
      if (frozenDetects(content, language))
        assert.notEqual(detectExport(content, language), null, `seed ${seed}: ${JSON.stringify(content)}`);
    }
  }
});

// ---- All exports are decided, not the first one (owner decision D5a) ----

const MASTER_REGEX_SLASH = "const r = /'/; export class Other {}\nexport class ICacheStore {}";

test('detectExports returns every named export from both lexings', () => {
  const found = detectExports(MASTER_REGEX_SLASH);
  assert.deepEqual(found.symbols, ['Other', 'ICacheStore']);
  assert.equal(found.anonymous, false);
  assert.deepEqual(detectExports('export default class Foo {}\nexport { a }').symbols, ['Foo']);
  assert.equal(detectExports('export default class Foo {}\nexport { a }').anonymous, true);
  assert.equal(detectExports('export default class Foo {}').anonymous, false, 'a named default is not anonymous');
  assert.equal(detectExports('export default () => 1').anonymous, true);
  assert.equal(detectExports('const a = 1'), null);
});

test('guard: hybrid denies when ANY export is stable, whatever its position (minimal regression input)', () => {
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  commitAll(directory);
  const file = path.join(directory, 'packages/cache/src/Store.ts');
  const denied = guard(directory, file, MASTER_REGEX_SLASH);
  assert.equal(denied.exitCode, 2);
  assert.match(contextOf(denied), /Export ICacheStore matches stable platform capabilities/);
  const both = guard(directory, file, 'export class ICacheStore {}\nexport class Other {}\nexport class Third {}');
  assert.equal(both.exitCode, 2, 'denied export first');
  assert.equal(guard(directory, file, 'export class Other {}\nexport class Third {}').exitCode, 0, 'no stable export: allowed');
  const advisory = guard(
    directory,
    path.join(directory, 'packages/msg/src/Env.ts'),
    'export class EventEnvelope {}\nexport class Plain {}',
  );
  assert.match(
    contextOf(advisory),
    /Advisory: EventEnvelope, Plain relates to platform capabilities: messaging\.event-envelope \(.*\) <- EventEnvelope/,
  );
});

test('guard: platform denial names every exported symbol', () => {
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const outcome = guard(directory, path.join(directory, 'packages/x/src/a.ts'), 'export class Alpha {}\nexport const Beta = 1;');
  assert.equal(outcome.exitCode, 2);
  assert.match(contextOf(outcome), /Export Alpha, Beta requires/);
});

// ---- Non-regression against the pinned master guard: new denies must be a superset of master denies ----

function loadMasterGuard(fixture = 'master-guard.txt') {
  const lib = path.join(REPO_ROOT, 'tools', 'cli', 'lib');
  const source = fs
    .readFileSync(path.join(__dirname, 'fixtures', 'capability-intake-guard', fixture), 'utf8')
    .replaceAll("require('./", `require('${lib}/`);
  const file = path.join(temp('hseos-master-guard-'), 'master-guard.js');
  fs.writeFileSync(file, source);
  return require(file);
}

const SUPERSET_CORPUS = [
  MASTER_REGEX_SLASH,
  "const r = /'/; export class Other {}\nexport class ICacheStore {}",
  'export class ICacheStore {}',
  'export class Other {}\nexport class ICacheStore {}',
  // known master limitations
  'const r = /a/*b/; export class Hidden {}\nexport class ICacheStore {}',
  'const r = /\\/*/;\nexport class ICacheStore {}',
  'const s = `${/`/.test(x)}`;\nexport class ICacheStore {}',
  'const s = `${/* ` */ 1}`;\nexport class ICacheStore {}',
  'const s = `${"`"}`;\nexport class ICacheStore {}',
  'const n = (a) / 2; /* c */ export class ICacheStore {}',
  'const n = (a) / 2 /* http://x */ export class ICacheStore {}',
  '</b> /* c // d */ export class ICacheStore {}',
  // quirks around strings, comments, templates
  'const s = "export class Fake {}";\nexport class ICacheStore {}',
  "const s = 'x\nexport class ICacheStore {}",
  '/* open\nexport class ICacheStore {}',
  'const s = `never ${x}\nexport class ICacheStore {}',
  'const s = `${ never\nexport class ICacheStore {}',
  '// export class Fake {}\nexport default function ICacheStore() {}',
  'export default class ICacheStore {}',
  'export { ICacheStore }',
  'module.exports = { ICacheStore }',
  'exports.ICacheStore = class {}',
  'export const ICacheStore = 1; const r = /"/;',
  'x = a / b; export class Other {} y = c / d\nexport class ICacheStore {}',
  'export class EventEnvelope {}',
  'export class Unrelated {}',
  // seen only by the legacy lexing (the regex-aware lexing hides them inside a template): dropping the legacy segment must fail the test
  'const s = `${/`/.test(x)} export class ICacheStore {}`;',
  'const s = `${/* ` */ 1} export class ICacheStore {}`;',
  'const s = `${/`/.test(x)} export class Other {}`;\nexport class Other2 {}\nexport class ICacheStore {}',
  // master limitations the real tokenizer closes: a division followed by a regex that holds a comment opener or a quote
  "x = a / /[/*]/// '\nexport class ICacheStore {}",
  String.raw`x = y / /\//.source / /'/; export class ICacheStore {} // '`,
  "let a\n/'/.test(a); export class ICacheStore {} //'",
  // TypeScript: a non-null `!` or a type literal before a regex (the master denies them; the guard must too)
  "x = a! / /'/; export class ICacheStore {} // '",
  "type A = { a: 1 } /'/; export class ICacheStore {} // '",
  "/await /'/}*/export class ICacheStore {} </a'(=> /a",
  'const a = 1;',
];

test('guard: new denies are a superset of master denies over the corpus (hybrid and platform)', () => {
  const master = loadMasterGuard();
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  const file = path.join(directory, 'packages/cache/src/Store.ts');
  const decide = (evaluate, content) =>
    evaluate({ input: hookInput(file, content), cwd: directory, env: quietEnv(), runtimeRoot: REPO_ROOT }).exitCode === 2;
  const stricter = [];
  for (const mode of ['hybrid', 'platform']) {
    write(directory, BINDINGS, projectFile(mode, `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
    for (const content of SUPERSET_CORPUS) {
      const before = decide(master.evaluateGuard, content);
      const after = decide(evaluateGuard, content);
      if (before) assert.ok(after, `${mode}: master denies but the guard allows: ${JSON.stringify(content)}`);
      if (after && !before) stricter.push(`${mode}: ${JSON.stringify(content)}`);
    }
  }
  // Documented improvements: inputs the master lexer hid from the guard and the union now denies.
  assert.ok(stricter.length > 0, 'the corpus includes known master limitations that are now denied');
  for (const entry of stricter) assert.match(entry, /ICacheStore|Hidden|Fake/, entry);
  process.stderr.write(`# guard denies more than master on ${stricter.length} corpus entries (expected improvements)\n`);
});

test('guard: the inspected export set grows with the file but stays linear (5k lines)', () => {
  const body = Array.from(
    { length: 5000 },
    (_, index) => `export const value${index} = /a\\/*b/.test("x") ? \`\${index}\` : ${index} / 2;`,
  ).join('\n');
  const started = process.hrtime.bigint();
  const found = detectExports(body);
  const milliseconds = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(found.symbols.length, 5000);
  assert.ok(milliseconds < 1000, `5k lines took ${milliseconds} ms`);
  process.stderr.write(`# detectExports 5k lines: ${milliseconds.toFixed(1)} ms\n`);
});

// ---- Overrides cover only the exports they match; known hiding cases stay equal to master ----

const OVERRIDE = (capability, ref) =>
  `  - {capability: ${capability}, outcome: keep-local, intake_ref: ${ref}, reason: test, expires: "2999-01-01"}\n`;

function bothGuards(directory, file) {
  const master = loadMasterGuard();
  return (content) => {
    const run = (evaluate) =>
      evaluate({ input: hookInput(file, content), cwd: directory, env: quietEnv(), runtimeRoot: REPO_ROOT }).exitCode;
    return { before: run(master.evaluateGuard), after: run(evaluateGuard) };
  };
}

test('guard: an override covers only its own exports; newDeny is a superset of masterDeny with overrides (both orders, both modes)', () => {
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n', 'docs/decisions/2026-intake-cache.md': 'ack: INTAKE-1\n' });
  const registryLine = stableRegistry(directory);
  const file = path.join(directory, 'packages/cache/src/Store.ts');
  const run = bothGuards(directory, file);
  const contents = [
    'export class ICacheStore {}',
    'export class Other {}\nexport class ICacheStore {}',
    'export class ICacheStore {}\nexport class Other {}',
    'export class ICacheStore {}\nexport class EventEnvelope {}',
    'export class EventEnvelope {}\nexport class ICacheStore {}',
    'export class EventEnvelope {}\nexport class Other {}',
    'export class Other {}\nexport class EventEnvelope {}\nexport class ICacheStore {}',
    `const r = /'/; export class Other {}\nexport class ICacheStore {}`,
    'export class ICacheStore {}\nexport { x }',
    'const s = `${/`/.test(x)} export class ICacheStore {}`;',
    'const s = `${/* ` */ 1} export class ICacheStore {}`;',
    'const s = `${/`/.test(x)} export class Other {}`;\nexport class ICacheStore {}',
    'const s = `${/`/.test(x)} export class ICacheStore {}`;\nexport class EventEnvelope {}',
  ];
  const overrideSets = {
    cache: OVERRIDE('cache.typed', 'INTAKE-1'),
    envelope: OVERRIDE('messaging.event-envelope', 'INTAKE-1'),
    both: OVERRIDE('cache.typed', 'INTAKE-1') + OVERRIDE('messaging.event-envelope', 'INTAKE-1'),
  };
  for (const mode of ['platform', 'hybrid']) {
    for (const [name, overrides] of Object.entries(overrideSets)) {
      write(
        directory,
        BINDINGS,
        projectFile(mode, `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}overrides:\n${overrides}`),
      );
      for (const content of contents) {
        const { before, after } = run(content);
        if (before === 2) assert.equal(after, 2, `${mode}/${name}: master denies, guard allows: ${JSON.stringify(content)}`);
      }
    }
  }
  // The reported probe, and its covered counterpart.
  write(
    directory,
    BINDINGS,
    projectFile('platform', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}overrides:\n${overrideSets.cache}`),
  );
  assert.deepEqual(run('export class Other {}\nexport class ICacheStore {}'), { before: 2, after: 2 });
  assert.deepEqual(run('export class ICacheStore {}'), { before: 0, after: 0 });
  assert.equal(run('export class ICacheStore {}\nexport class Other {}').after, 2, 'covered first, uncovered after');
  write(
    directory,
    BINDINGS,
    projectFile('platform', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}overrides:\n${overrideSets.both}`),
  );
  assert.equal(run('export class EventEnvelope {}\nexport class ICacheStore {}').after, 0, 'every export covered');
  assert.equal(
    run('export class EventEnvelope {}\nexport class ICacheStore {}\nexport class Other {}').after,
    2,
    'one uncovered export denies',
  );
});

test('guard: a quote or backtick inside a regex before a same-line comment no longer hides an export', () => {
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  const run = bothGuards(directory, path.join(directory, 'packages/cache/src/Store.ts'));
  const formerlyAllowed = [
    "const r = /'/; export class ICacheStore {} // '",
    "const r = /'/; export class ICacheStore {} /* ' */",
    'x = /`/; export class ICacheStore {} // `',
    "const r = /[/'/]; export class ICacheStore {} // '",
  ];
  // Master allowed these (a known limitation); the guard now denies them. `before` pins the master behaviour.
  for (const content of formerlyAllowed) {
    assert.equal(run(content).after, 2, `${content} must be denied`);
    assert.ok(detectExports(content).symbols.includes('ICacheStore'), content);
  }
});

test('guard: a regex after `)`, `}` or a keyword, and lone CR / U+2028 / U+2029 line ends, no longer hide an export', () => {
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  const run = bothGuards(directory, path.join(directory, 'packages/cache/src/Store.ts'));
  const hiding = [
    "if (x) /'/.test(y); export class ICacheStore {} // '",
    "while (x) /'/.test(y); export class ICacheStore {} // '",
    'if (x) /`/.test(y);\nexport class ICacheStore {}\n// `',
    "function f(){} /'/.test(y); export class ICacheStore {} // '",
    "try{}finally /'/.test(y); export class ICacheStore {} // '",
    String.raw`if (x) /\//.test(y); export class ICacheStore {} // '`,
    "a = b / c; if (x) /'/.test(y); export class ICacheStore {} // '",
    '// c\rexport class ICacheStore {}',
    '// c\u2028export class ICacheStore {}',
    '// c\u2029export class ICacheStore {}',
    "x = 1; // c\rif (x) /'/.test(y); export class ICacheStore {} // '",
  ];
  for (const content of hiding) {
    assert.equal(run(content).after, 2, `${JSON.stringify(content)} must be denied`);
    assert.ok(detectExports(content).symbols.includes('ICacheStore'), JSON.stringify(content));
  }
  // Regex after `)` inside a template `${}` expression, and a hashbang line holding a quote, backtick or `/*`.
  const templateAndHashbang = [
    'var x=0,y="";\nx = `${ (()=>{ if (x) /\'/.test(y); "`"; })() }`; export class ICacheStore {} // \'\nif (x) /}}`/.test(1);\n',
    'x = `${ (()=>{ if (x) /}/.test(y); })() }`; export class ICacheStore {} // `',
    '#!`\nexport class ICacheStore {}\n// `',
    '#!/*\nexport class ICacheStore {}\n// */',
    "#!'\nexport class ICacheStore {}\n// '",
    '#!`\rexport class ICacheStore {}\n// `',
  ];
  for (const content of templateAndHashbang) {
    assert.equal(run(content).after, 2, `${JSON.stringify(content)} must be denied`);
    assert.ok(detectExports(content).symbols.includes('ICacheStore'), JSON.stringify(content));
  }
  // A `#!` that is not on the first line is not a hashbang; the guard still adds views only.
  assert.equal(detectExports('x\n#!`\nexport class ICacheStore {}\n// `'), null);
  // A regex after a division operator, a regex directly before a `//` comment, and a CRLF string line continuation.
  const wideAndContinuation = [
    'x = 1 / /[/*]/.source;\nexport class ICacheStore {}\n/* */',
    'x = a / /[/*]/;\nexport class ICacheStore {}\n/* */',
    'x = (a) / /[/*]/;\nexport class ICacheStore {}\n/* */',
    'x = a++ / /[/*]/.source;\nexport class ICacheStore {}\n/* */',
    'x = a / /[/*]/.source; export class ICacheStore {} /* */',
    'if (a) /[/*]/// c\nexport class ICacheStore {}\n/* */',
    'x="a\\\r\nb"; export class ICacheStore {} // "',
    "x='a\\\r\nb'; export class ICacheStore {} // '", // `for await (` is a loop header: the `/'/` body is a regex, not a division followed by a string.
    "for await (a of b) /'/.test(a); export class ICacheStore {} //'",
  ];
  for (const content of wideAndContinuation) {
    assert.equal(run(content).after, 2, `${JSON.stringify(content)} must be denied`);
    assert.ok(detectExports(content).symbols.includes('ICacheStore'), JSON.stringify(content));
  }
  // A division followed by a regex that holds `//` or a quote: the tokenizer reads both literals, so these are denied.
  const divisionThenRegex = [
    "x = a / /[/*]/// '\nexport class ICacheStore {}\n/* */",
    String.raw`x = y / /\//.source / /'/; export class ICacheStore {} // '`,
  ];
  for (const content of divisionThenRegex) {
    assert.equal(run(content).after, 2, `${JSON.stringify(content)} must be denied`);
    assert.ok(detectExports(content).symbols.includes('ICacheStore'), JSON.stringify(content));
  }
  // Automatic semicolon insertion: after a declarator, `debugger` or an import, a line break and `/` open a regex (the
  // division would be a syntax error), and the `/` after an ordinary operand and a line break may be either. The
  // tokenizer cannot tell without a parser, so the guard inspects every combination of readings.
  const semicolonInsertion = [
    "let a\n/'/.test(a); export class ICacheStore {} //'",
    "var a\n/'/.test(a); export class ICacheStore {} //'",
    "var a,b\n/'/.test(a); export class ICacheStore {} //'",
    "debugger\n/'/.test(a); export class ICacheStore {} //'",
    "import 'y'\n/'/.test(a); export class ICacheStore {} //'",
    "import x from 'y'\n/'/.test(a); export class ICacheStore {} //'",
    "import * as n from 'z'\n/'/.test(a); export class ICacheStore {} //'",
    "export * from 'z'\n/'/.test(a); export class ICacheStore {} //'",
    // A true division across a line break whose operands hold quotes: the regex reading would swallow the export, the division one shows it.
    'a\n/ 2 + "/" + "x" + "y"; export class ICacheStore {} //"',
    // Several ambiguous slashes: the readings combine, and beyond the limit the raw text is inspected.
    `a\n/ 2 + "/" + "x"; b\n/'/.test(b); export class ICacheStore {} //'`,
    `${'c\n/ 2 / 3;\n'.repeat(12)}d\n/'/.test(d); export class ICacheStore {} //'`,
  ];
  for (const content of semicolonInsertion) {
    assert.equal(run(content).after, 2, `${JSON.stringify(content)} must be denied`);
    assert.ok(detectExports(content).symbols.includes('ICacheStore'), JSON.stringify(content));
  }
  // No new false positives on the common shapes.
  for (const content of [
    'const a = b / c; // note\nconst s = "x";',
    'const t = "a/b"; // x\r\nconst u = 1;\r\n',
    "const s = '// not a comment';",
  ]) {
    assert.equal(detectExports(content), null, JSON.stringify(content));
  }
});

test('lexer: unclosed `export {` repeated many times stays linear', () => {
  for (const size of [160_000, 320_000]) {
    const started = process.hrtime.bigint();
    const found = detectExports('export {'.repeat(size / 8) + '\nexport class R {}');
    const milliseconds = Number(process.hrtime.bigint() - started) / 1e6;
    assert.deepEqual(found.symbols, ['R']);
    assert.ok(milliseconds < 1000, `${size} bytes took ${milliseconds} ms`);
  }
  assert.deepEqual(detectExports('export { a } from "x";\nexport * as q from "y";\nexport class K {}').symbols, ['K']);
  assert.equal(detectExports('export { a } from "x";\nexport * as q from "y";'), null, 're-exports with from stay ignored');
});

test('lexer: the sliced legacy lexer equals the pinned legacy lexer, and a realistic 1 MB file stays fast', () => {
  const pieces = [
    '/',
    '*',
    '//',
    '/*',
    '*/',
    '"',
    "'",
    '`',
    '${',
    '}',
    '\\',
    '\n',
    ' ',
    'a',
    'export class A {}',
    '@',
    '$',
    '"""',
    '(',
    ')',
    '[',
    ']',
    'x',
    'in ',
    '++',
  ];
  let state = 99_991;
  const random = () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) & 0x7f_ff_ff_ff;
    return state / 0x7f_ff_ff_ff;
  };
  for (let round = 0; round < 6000; round += 1) {
    let content = '';
    for (let count = 1 + Math.floor(random() * 16); count > 0; count -= 1) content += pieces[Math.floor(random() * pieces.length)];
    const language = random() < 0.4 ? 'cs' : 'js';
    assert.equal(lexLegacyFast(content, language), lexLegacy(content, language), JSON.stringify(content));
  }
  const module = [
    "import fs from 'node:fs';",
    "// a comment with a quote ' and export class Fake {}",
    String.raw`const re = /ab+c\/[x/]/gi; const half = total / 2; /* block */`,
    'const label = `item ${count > 1 ? "items" : \'item\'} of ${`nested ${name}`}`;',
    String.raw`function format(value) { return value.replace(/\s+/g, " ").trim() + "!"; }`,
    'export const helper = (a, b) => a / b + (a % b) / 2;',
    '',
  ].join('\n');
  const content = module.repeat(Math.ceil(1_000_000 / module.length)) + 'export class R {}';
  assert.ok(content.length >= 1_000_000);
  const started = process.hrtime.bigint();
  const found = detectExports(content);
  const milliseconds = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(found.symbols.includes('R') && found.symbols.includes('helper'));
  assert.ok(milliseconds < 200, `realistic 1 MB took ${milliseconds} ms`);
});

test('guard: ambiguous slashes cost a constant number of passes, however many there are (1 MB)', () => {
  const filler = "const q = 'x'; // c\n".repeat(Math.ceil(1_000_000 / 21)) + 'export class R {}';
  const fastest = (content) => {
    let best = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 4; round += 1) {
      const started = process.hrtime.bigint();
      const found = detectExports(content);
      best = Math.min(best, Number(process.hrtime.bigint() - started) / 1e6);
      assert.ok(found.symbols.includes('R'));
    }
    return best;
  };
  const baseline = fastest(filler);
  for (const count of [1, 2, 8, 9, 16, 64]) {
    const ambiguous = Array.from({ length: count }, (_, index) => `let v${index} = a\n/x${index}/g.test(b)\n`).join('');
    const milliseconds = fastest(ambiguous + filler);
    assert.ok(milliseconds < 200, `${count} ambiguous slashes + 1 MB took ${milliseconds} ms`);
    assert.ok(milliseconds < baseline * 2.5 + 20, `${count} ambiguous slashes took ${milliseconds} ms against ${baseline} ms without`);
  }
});

test('guard: deep unclosed braces with many templates, and unclosed export lists, stay linear', () => {
  const timed = (content) => {
    const started = process.hrtime.bigint();
    const found = detectExports(content);
    return { found, milliseconds: Number(process.hrtime.bigint() - started) / 1e6 };
  };
  // Every template opening used to scan the whole stack of unclosed braces.
  for (const length of [100_000, 400_000]) {
    const { found, milliseconds } = timed('{'.repeat(length / 2) + '`a` '.repeat(length / 2) + '\nexport class Z {}');
    assert.ok(found.symbols.includes('Z'));
    assert.ok(milliseconds < 400, `${length} chars of braces and templates took ${milliseconds} ms`);
  }
  // Every `export {` used to rescan and re-split the text up to one distant closing brace.
  for (const content of [
    'export {a,'.repeat(20_000) + '}',
    'export { a,'.repeat(10_000) + 'export class R {}',
    'export { '.repeat(20_000) + '}',
  ]) {
    const { milliseconds } = timed(content);
    assert.ok(milliseconds < 400, `${content.length} chars of unclosed export lists took ${milliseconds} ms`);
  }
  // The aliases of nested and shared lists are still all found, and a `from` list is still a forward.
  assert.deepEqual(detectExports('export { a as A1, export { b as B1, c as C1 }').symbols, ['A1', 'C1', 'B1']);
  assert.deepEqual(detectExports('export { x as X1 }\nexport { y as Y1 }').symbols, ['X1', 'Y1']);
  assert.equal(detectExports('export { export { b as B2 } from "m"'), null);
  assert.deepEqual(detectExports('export { type t as T1, default as d, z as default }').symbols, ['T1', 'd']);
});

test('guard: a hidden export behind an ambiguous slash shows however many other ones the text has', () => {
  for (const count of [0, 1, 8, 9, 64, 300]) {
    const ambiguous = Array.from({ length: count }, (_, index) => `let v${index} = a\n/x${index}/g.test(b)\n`).join('');
    const content = `${ambiguous}let a\n/'/.test(b); export class Hidden {} // '\n`;
    assert.ok(detectExports(content).symbols.includes('Hidden'), `${count} ambiguous slashes before it`);
    assert.ok(detectExports(`${content}${ambiguous}`).symbols.includes('Hidden'), `${count} ambiguous slashes around it`);
  }
  // Readings that leave a line in different states fail closed: the rest of the text is inspected as written.
  const diverging = "let a\n/'/.test(b)\nconst note = 'x'; export class Late {} // '\n";
  assert.ok(tokenizeJsViews(diverging).some((view) => /export class Late/.test(view)));
});

test('tokenizeJs: regex versus division is decided by the previous significant token', () => {
  const exportedAfter = (content, symbol) => {
    const found = detectExports(content);
    assert.ok(found && found.symbols.includes(symbol), `${JSON.stringify(content)} must export ${symbol}`);
  };
  // A regex after the `)` of if, while or for, after a keyword, an operator and at the start.
  exportedAfter("if (x) /'/.test(y); export class A1 {} // '", 'A1');
  exportedAfter("while (x) /'/.test(y); export class A2 {} // '", 'A2');
  exportedAfter("for (;;) /'/.test(y); export class A3 {} // '", 'A3');
  exportedAfter("function f() { return /'/.test(y); } export class A4 {} // '", 'A4');
  exportedAfter("x = typeof /'/; export class A5 {} // '", 'A5');
  exportedAfter("x = a || /'/.test(y); export class A6 {} // '", 'A6');
  exportedAfter("/'/.test(y); export class A7 {} // '", 'A7');
  exportedAfter("for (const k of /'/.source) k; export class A8 {} // '", 'A8');
  // A division after the `)` of a call, after an index, after a number, after `++` and after a property named like a keyword.
  for (const division of ['f(a) / 2', 'a[0] / 2', '10 / 2', 'a++ / 2', 'a.in / 2', 'this / 2', '(a + b) / 2', '"s" / 2']) {
    exportedAfter(`x = ${division}; // it's\nexport class B1 {}`, 'B1');
    exportedAfter(`x = ${division}; /* it's */ export class B2 {}`, 'B2');
  }
  assert.equal(tokenizeJs('x = f(a) / 2 / 3; y = "export class Hidden {}";'), 'x = f(a) / 2 / 3; y = "";');
  // A `}` that closes a block lets a regex follow, one that closes an object does not.
  exportedAfter("{ x; } /'/.test(y); export class C1 {} // '", 'C1');
  exportedAfter("if (a) { b; } else { c; } /'/.test(y); export class C2 {} // '", 'C2');
  exportedAfter("function g() {} /'/.test(y); export class C3 {} // '", 'C3');
  exportedAfter("class K {} /'/.test(y); export class C4 {} // '", 'C4');
  exportedAfter("function h() {}\n{ f(); } /'/.test(y); export class C8 {} // '", 'C8');
  exportedAfter("x = y\n{ f(); } /'/.test(y); export class C9 {} // '", 'C9');
  // After a line break `++` and `--` are prefix operators (no postfix across a line break), so a regex follows them.
  exportedAfter("x = a\n++/'/.y; export class H1 {} //'", 'H1');
  exportedAfter("x = a\n--/'/.y; export class H2 {} //'", 'H2');
  exportedAfter("x = a\n++/'/.y; export class H3 {} /'/g", 'H3');
  exportedAfter('a\n--/"/.y; export class H4 {} /"/.z', 'H4');
  exportedAfter("x = a\n++ /* c */ /'/.y; export class H5 {} //'", 'H5');
  exportedAfter("x = f(a)\r\n++/'/.y; export class H6 {} //'", 'H6');
  exportedAfter("x = a++ / 2; // '\nexport class H7 {}", 'H7');
  exportedAfter("x = {} / 2; // '\nexport class C5 {}", 'C5');
  exportedAfter("x = { k: 1 } / 2; // '\nexport class C6 {}", 'C6');
  exportedAfter("x = function () {} / 2; // '\nexport class C7 {}", 'C7');
  // Nested templates keep their expressions visible and their text blank.
  assert.equal(tokenizeJs("x = `a ${ `b ${c} '` } d`;").replaceAll(/\s+/g, ' '), 'x = "" "" c "" "";');
  assert.equal(tokenizeJs("a--\n{ x; }\n/'/.test(b); export class C8 {} // '").includes('export class C8'), true);
  assert.ok(!/Hidden/.test(tokenizeJs('x = `export class Hidden {} ${a} ${`export class Hidden {}`}`;')));
  assert.ok(/\ba\b/.test(tokenizeJs('x = `${a}`;')) && /\bb\b/.test(tokenizeJs('x = `${`${b}`}`;')));
  exportedAfter("x = `${/'/.test(a)}`; export class D1 {} // '", 'D1');
  exportedAfter('x = `${"}"} ${\'`\'}`; export class D2 {}', 'D2');
  // Line terminators: CR, U+2028 and U+2029 end a line comment; CRLF, CR and U+2028 continue a string.
  for (const terminator of ['\r', ' ', ' ']) {
    exportedAfter(`// note${terminator}export class E1 {}`, 'E1');
    exportedAfter(`#! node's${terminator}export class E2 {}`, 'E2');
  }
  exportedAfter('x = "a\\\r\nb"; export class E3 {} // "', 'E3');
  exportedAfter("x = 'a\\\rb'; export class E4 {} // '", 'E4');
  exportedAfter("x = 'a\\ b'; export class E5 {} // '", 'E5');
  exportedAfter("x = 'a\\ b'; export class E6 {} // '", 'E6');
  exportedAfter("#!/usr/bin/env node '\nexport class E7 {}", 'E7');
  // Unfinished constructs stay visible; the tokenizer never throws.
  exportedAfter('x = `unclosed export class F1 {}', 'F1');
  exportedAfter('/* unclosed export class F2 {}', 'F2');
  exportedAfter('x = "unclosed export class F3 {}\nexport class F4 {}', 'F4');
  assert.ok(tokenizeJs('x = "unclosed export class F3 {}\n').includes('export class F3'));
  for (const garbage of ['}}}', ')))', '${', '`${', '`${`${', '/', '//', '/*', '\\', '"\\', '((((', '{`}`}', 'a ? /']) {
    assert.equal(typeof tokenizeJs(garbage), 'string', garbage);
  }
  // TypeScript, JSX and decorators are tolerated without parsing.
  exportedAfter('@Injectable({ providedIn: "root" })\nexport class G1 { constructor(private a: Map<string, number>) {} }', 'G1');
  exportedAfter('const el = <div className="x">{a / 2}</div>;\nexport class G2 {}', 'G2');
});

// Differential fuzz against acorn (devDependency, tests only). The generator writes valid JavaScript from fragments (divisions,
// regex literals in every position, strings holding quotes and comment openers, nested templates, comments, blocks versus
// objects, `if (...)` followed by a regex); for each program that acorn parses, every token acorn reads must come out of
// `tokenizeJs` the same way: comments, strings and template text blank, everything else (identifiers, keywords, numbers,
// punctuators, regex literals, the code inside `${}`) visible. Fixed seed, so a failure reproduces.
const acorn = require('acorn');

const FUZZ_NEWLINES = ['\n', '\n', '\n', '\r\n', '\r', ' ', ' '];
const FUZZ_IDENTS = ['a', 'b', 'c', 'x', 'y', 'total', 'of', 'async', 'let', 'e1'];
const FUZZ_STRINGS = [
  '"it\'s // not"',
  "'a /* b'",
  '"`"',
  String.raw`'\''`,
  '"x"',
  "'//'",
  '"/*"',
  '"*/"',
  '"a\\\nb"',
  '"a\\\r\nb"',
  "'a\\ b'",
  String.raw`"\u0041"`,
  '""',
  '"}"',
  "'${'",
];
const FUZZ_REGEXES = [
  '/ab+/g',
  '/[/*]/',
  "/'/",
  '/"/',
  String.raw`/\//`,
  '/`/',
  '/[`]/',
  '/[/]/',
  String.raw`/a\/*b/`,
  String.raw`/\//g`,
  '/x/',
  '/[\'"]/u',
  '/${/',
  String.raw`/\*/`,
];
const FUZZ_NUMBERS = ['1', '2.5', '0x10', '1e3', '.5', '10n', '1_000', '0b11'];
const FUZZ_BINOPS = ['+', '-', '*', '/', '%', '&&', '||', '==', '<', '>', '??', '&', '|', '**'];

function fuzzRandom(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) & 0x7f_ff_ff_ff;
    return state / 0x7f_ff_ff_ff;
  };
}

function generateJs(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const nl = () => (random() < 0.7 ? '\n' : pick(FUZZ_NEWLINES));
  const ws = () => pick(['', ' ', ' ', '  ', '\t']);
  const comment = () =>
    pick(['', '', '', `// c ' " \` /*${nl()}`, '/* c \' " ` // */', `/* multi${nl()}line ' */`, `// export class Fake {}${nl()}`]);
  function templateExpr(depth) {
    return pick([
      () => FUZZ_IDENTS[0],
      () => `a ${pick(FUZZ_BINOPS)} b`,
      () => `a / b`,
      () => `${pick(FUZZ_STRINGS)}`,
      () => `/'/.test(a)`,
      () => `{ x: 1 }.x`,
      () => `f({ k: a / 2 })`,
      () => (depth < 3 ? template(depth + 1) : '1'),
      () => `(a) / ${pick(FUZZ_REGEXES)}.source`,
      () => `a ? "}" : '{'`,
      () => `() => { return a / 2 }`,
    ])();
  }
  function template(depth = 0) {
    let result = '`';
    for (let count = Math.floor(random() * 3); count >= 0; count -= 1) {
      result += pick(['', 'x', ' // ', " ' ", ' /* ', '"', '\\`', '\\${', '$', '{}', '}', '\n', '\r\n', ' ']);
      if (random() < 0.7) result += '${' + ws() + templateExpr(depth) + ws() + '}';
    }
    return result + pick(['', 'x', "'", '/']) + '`';
  }
  function atom(depth) {
    const roll = random();
    if (roll < 0.2) return pick(FUZZ_IDENTS);
    if (roll < 0.28) return pick(FUZZ_NUMBERS);
    if (roll < 0.4) return pick(FUZZ_STRINGS);
    if (roll < 0.5) return pick(FUZZ_REGEXES);
    if (roll < 0.6) return template();
    if (depth > 3) return pick(FUZZ_IDENTS);
    return pick([
      () => `(${expr(depth + 1)})`,
      () => `f(${expr(depth + 1)}, ${expr(depth + 1)})`,
      () => `[${expr(depth + 1)}, ${expr(depth + 1)}]`,
      () => `({ k: ${expr(depth + 1)}, "q": ${pick(FUZZ_REGEXES)} })`,
      () => `${pick(FUZZ_IDENTS)}${pick(['++', '--'])}`,
      () => `typeof ${pick(FUZZ_REGEXES)}`,
      () => `void ${pick(FUZZ_REGEXES)}`,
      () => `new ${pick(['RegExp', 'Date'])}(${pick(FUZZ_STRINGS)})`,
      () => `(() => { return ${expr(depth + 1)} })()`,
      () => `function (p) { return p / 2 }`,
      () => `(function () {}) / 2`,
      () => `a.in / 2`,
      () => `a.return / b / c`,
      () => `a?.b / 2`,
      () => `${pick(FUZZ_REGEXES)}.test(a) / 2`,
      () => `a[0] / ${pick(FUZZ_REGEXES)}.source`,
      () => `a\`tpl\` / 2`,
      () => `{} / 2`.replace('{} / 2', '({}) / 2'),
      () => `${pick(FUZZ_IDENTS)}${pick(['++', '--'])} / ${pick(FUZZ_REGEXES)}.source`,
      () => `await_ / ${pick(FUZZ_REGEXES)}.source`,
      () => `this / 1`,
      () => `null / 1`,
    ])();
  }
  function expr(depth = 0) {
    let result = atom(depth);
    for (let count = Math.floor(random() * 3); count > 0; count -= 1) {
      result += `${ws()}${pick(FUZZ_BINOPS)}${ws()}${atom(depth + 1)}`;
    }
    return result;
  }
  function statement(depth = 0) {
    const sep = nl();
    const stmts = {
      let: () => `let v${Math.floor(random() * 99)} = ${expr()};`,
      assign: () => `x = ${expr()}${pick([';', ';', ''])}${nl()}`,
      call: () => `f(${expr()});`,
      ifRegex: () => `if (${expr()}) ${pick(FUZZ_REGEXES)}.test(${pick(FUZZ_STRINGS)});`,
      ifBlock: () => `if (${expr()}) { ${statement(depth + 1)} } else { ${statement(depth + 1)} }`,
      ifElseRegex: () => `if (a) b; else ${pick(FUZZ_REGEXES)}.test(c);`,
      whileRegex: () => `while (${expr()}) ${pick(FUZZ_REGEXES)}.test(a);`,
      forRegex: () => `for (let i = 0; i < 2; i++) ${pick(FUZZ_REGEXES)}.test(a);`,
      forOf: () => `for (const k of ${pick(['[1]', '[a, b]', "'xy'"])}) ${pick(FUZZ_REGEXES)}.test(k);`,
      forOfRegex: () => `for (const k of ${pick(FUZZ_REGEXES)}.source) a;`,
      block: () => `{ ${statement(depth + 1)} } ${pick(FUZZ_REGEXES)}.test(a);`,
      blockDiv: () => `x = {} / 2;`,
      objDiv: () => `x = { k: 1 } / ${pick(FUZZ_REGEXES)}.source;`,
      func: () => `function fn${Math.floor(random() * 99)}(p, q) { ${statement(depth + 1)} return p / q; }`,
      funcThenRegex: () => `function g() {} ${pick(FUZZ_REGEXES)}.test(a);`,
      funcExprDiv: () => `x = function () {} / 2;`,
      arrow: () => `const h = (p) => { return p / ${expr()}; };`,
      arrowConcise: () => `const h2 = (p) => p / ${pick(FUZZ_REGEXES)}.source;`,
      cls: () => `class K${Math.floor(random() * 99)} extends Base { m() { return ${expr()}; } static n = ${pick(FUZZ_REGEXES)}; }`,
      classThenRegex: () => `class K2 { } ${pick(FUZZ_REGEXES)}.test(a);`,
      label: () => `lbl: { ${statement(depth + 1)} }`,
      doWhile: () => `do ${pick(FUZZ_REGEXES)}.test(a); while (b);`,
      switchStmt: () => `switch (a) { case ${pick(FUZZ_REGEXES)}.source: b; break; default: ${pick(FUZZ_REGEXES)}.test(c); }`,
      tryStmt: () => `try { ${statement(depth + 1)} } catch (e) { ${pick(FUZZ_REGEXES)}.test(e); } finally { x = 1 / 2; }`,
      ret: () => `function r() { return ${pick(FUZZ_REGEXES)}.test(a) ? 1 / 2 : /y/; }`,
      throwStmt: () => `function t() { throw ${pick(FUZZ_REGEXES)}; }`,
      template: () => `const t = ${template()};`,
      tagged: () => `const tt = tag${template()};`,
      exportClass: () => `export class E${Math.floor(random() * 99)} {}`,
      divChain: () => `x = a / b / c; y = a /b/ c;`,
      incDiv: () => `x = a++ / 2; y = b-- / 3;`,
      yieldGen: () => `function* gen() { yield ${pick(FUZZ_REGEXES)}; yield a / 2; }`,
      asyncFn: () => `async function af() { void ${pick(FUZZ_REGEXES)}.test(a); }`,
      objLit: () => `const o = { a: ${expr()}, b() { return 1 / 2; }, get c() { return ${pick(FUZZ_REGEXES)}; } };`,
      cond: () => `x = a ? ${pick(FUZZ_REGEXES)} : b / 2;`,
      asiDeclarator: () => `${pick(['let', 'var', 'const'])} av${Math.floor(random() * 99)} = 1${nl()}${pick(FUZZ_REGEXES)}.test(a);`,
      asiKeyword: () => `debugger${nl()}${pick(FUZZ_REGEXES)}.test(a);`,
      asiImport: () => `import 'y${Math.floor(random() * 99)}'${nl()}${pick(FUZZ_REGEXES)}.test(a);`,
      commentOnly: () => `${comment()}`,
    };
    const names = Object.keys(stmts);
    return `${comment()}${pick(['', ' '])}${stmts[pick(names)]()}${comment()}${sep}`;
  }
  let program = '';
  for (let count = 1 + Math.floor(random() * 4); count > 0; count -= 1) program += statement();
  return program;
}

function acornVisible(code) {
  // Parser-driven tokens: where the tokenizer's own regex/division guess is wrong, the parser re-reads the token.
  const tokens = [];
  acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', onToken: tokens, onComment() {} });
  let expected = '';
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    const label = token.type.label;
    switch (label) {
      case 'string': {
        expected += '""';
        break;
      }
      case 'template': {
        expected += '""';
        break;
      }
      case '`':
      case '${': {
        expected += '';
        break;
      }
      default: {
        if (label === '}' && tokens[k + 1] && tokens[k + 1].type.label === 'template') expected += '';
        else expected += code.slice(token.start, token.end);
      }
    }
  }
  return expected.replaceAll(/\s+/g, '');
}

function diffOne(code) {
  try {
    acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return 'skip';
  }
  let expected;
  try {
    expected = acornVisible(code);
  } catch {
    return 'skip';
  }
  // A `/` after an operand and a line break is ambiguous without a parser: one of the views must match acorn's reading.
  const actual = tokenizeJsViews(code).map((view) => view.replaceAll(/\s+/g, ''));
  return actual.includes(expected) ? 'ok' : { expected, actual };
}

test('tokenizeJs: differential fuzz against acorn (strings, comments and template text blank, all code visible)', () => {
  const random = fuzzRandom(123_457);
  let compared = 0;
  for (let round = 0; round < 6000; round += 1) {
    const code = generateJs(random);
    const result = diffOne(code);
    if (result === 'skip') continue;
    compared += 1;
    assert.equal(result, 'ok', `${JSON.stringify(code)}\n${JSON.stringify(result)}`);
  }
  assert.ok(compared > 4000, `only ${compared} programs compared`);
});

const TYPESCRIPT_DENIED = [
  "x = a! / /'/; export class ICacheStore {} // '",
  "type A = { a: 1 } /'/; export class ICacheStore {} // '",
  "/await /'/}*/export class ICacheStore {} </a'(=> /a",
];

test('guard: TypeScript non-null assertions and type literals before a regex cannot hide an export', () => {
  const master = loadMasterGuard();
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  const file = path.join(directory, 'packages/cache/src/Store.ts');
  const decide = (evaluate, content) =>
    evaluate({ input: hookInput(file, content), cwd: directory, env: quietEnv(), runtimeRoot: REPO_ROOT }).exitCode === 2;
  for (const content of TYPESCRIPT_DENIED) {
    assert.ok(decide(master.evaluateGuard, content), `master denies ${JSON.stringify(content)}`);
    assert.ok(decide(evaluateGuard, content), `the guard must deny ${JSON.stringify(content)}`);
    assert.ok(detectExports(content).symbols.includes('ICacheStore'), JSON.stringify(content));
  }
  // The tokenizer reads them on its own too: the non-null `!` and the type literal leave an operand, so the `/` after them is
  // also read as a division, and the regex reading is enumerated next to it.
  for (const content of TYPESCRIPT_DENIED.slice(0, 2)) {
    assert.ok(
      tokenizeJsViews(content).some((view) => /export class ICacheStore/.test(view)),
      JSON.stringify(content),
    );
  }
});

// Built with a variable so that the source holds no unicode escape of its own: the escapes belong to the fixtures.
const ESC = String.fromCodePoint(92) + 'u';
const UNICODE_DENIED = [
  ['export class ÉCacheStore {}', 'ÉCacheStore'],
  ['export class 日本 {}', '日本'],
  ['export const ℮ = 1', '℮'],
  ['export let ÉÉ=1', 'ÉÉ'],
  [`export function ${ESC}0061() {}`, 'a'],
  [`export const ${ESC}{61} = 1`, 'a'],
  [`export class ${ESC}{49}CacheStore {}`, 'ICacheStore'],
];

test('guard: exports named with a non-ASCII identifier or a unicode escape are detected', () => {
  for (const [content, symbol] of UNICODE_DENIED) {
    assert.deepEqual(detectExports(content).symbols, [symbol], JSON.stringify(content));
    assert.equal(qualifies('/packages/cache/src/Store.ts', content), true, JSON.stringify(content));
  }
  // An escape in the middle keeps the symbol the previous release reported, and adds the full name.
  assert.deepEqual(detectExports(`export class IC${ESC}0061cheStore {}`).symbols, ['IC', 'ICacheStore']);
  assert.equal(detectExports('const Ünused = 1;'), null);
});

// Exports that master and the previous tokenizer allowed (a few only in part) although TypeScript/JavaScript accepts them: an export form the list
// did not hold, and JSX element text, where `'`, `//` and `/*` open nothing.
const HUNTER_DENIED = [
  ['export function *ICacheStore(){}', ['ICacheStore']],
  ["const a = <div>it's</div>; export class ICacheStore {} // '", ['ICacheStore']],
  ['const a = <p>//</p>; export class ICacheStore {}', ['ICacheStore']],
  ['const a = <p>http://x</p>; export class ICacheStore {}', ['ICacheStore']],
  ['const a = <p>/*</p>; export class ICacheStore {} /* */', ['ICacheStore']],
  ["const a = <ul><li>it's</li><li>{x} it's</li></ul>; export class ICacheStore {} // '", ['ICacheStore']],
  ["const a = <Foo d={e > 1 ? 'x' : \"y\"}>it's {z}</Foo>; export class ICacheStore {} // '", ['ICacheStore']],
  ['export module ICacheStore {}', ['ICacheStore']],
  ['export declare module ICacheStore {}', ['ICacheStore']],
  ['export import ICacheStore = x.y', ['ICacheStore']],
  ['export import type ICacheStore = x.y', ['ICacheStore']],
  ['export @dec class ICacheStore {}', ['ICacheStore']],
  ['export @dec(1) class ICacheStore {}', ['ICacheStore']],
  ['export = ICacheStore', []],
  // Only the first declarator, a destructuring pattern and the `as` alias of a local list used to be read.
  ['export const a = 1, ICacheStore = 2', ['a', 'ICacheStore']],
  ['export let a, ICacheStore;', ['a', 'ICacheStore']],
  ['export declare var a: any, ICacheStore: any;', ['a', 'ICacheStore']],
  ['export const a: T = 1, ICacheStore: T = 2', ['a', 'ICacheStore']],
  ['export const a: Map<string, number> = f(1, 2), ICacheStore = 3\nconst z = 1, Y = 2', ['a', 'ICacheStore']],
  ['export const {ICacheStore} = x', ['ICacheStore']],
  ['export const [ICacheStore] = x', ['ICacheStore']],
  ['export const {a, b: {c: [ICacheStore]}, d = e, ...f} = x', ['a', 'ICacheStore', 'd', 'f']],
  ['export { x as ICacheStore }', ['ICacheStore']],
  ['export type { x as ICacheStore }', ['ICacheStore']],
  ['export { a, type b as ICacheStore, c as default }', ['ICacheStore']],
];

// Allowed on purpose: a `from` re-export forwards a binding defined (and checked) in its own module, and a barrel file
// would otherwise be denied; knownAllow, documented in the changelog.
const REEXPORTS_ALLOWED = [
  'export type { ICacheStore } from "./x"',
  'export { default as ICacheStore } from "x"',
  'export * as ICacheStore from "x"',
  'export { x as ICacheStore } from "y"',
];

test('guard: re-exports with a from clause stay allowed under any name (knownAllow)', () => {
  for (const content of REEXPORTS_ALLOWED) assert.equal(detectExports(content), null, content);
});

test('guard: JSX element text and the export forms master did not list cannot hide an export', () => {
  const master = loadMasterGuard();
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  const file = path.join(directory, 'packages/cache/src/Store.tsx');
  const decide = (evaluate, content) =>
    evaluate({ input: hookInput(file, content), cwd: directory, env: quietEnv(), runtimeRoot: REPO_ROOT }).exitCode;
  for (const [content, symbols] of HUNTER_DENIED) {
    const found = detectExports(content);
    for (const symbol of master.detectExports(content)?.symbols ?? []) assert.ok(found?.symbols.includes(symbol), JSON.stringify(content));
    assert.ok(found, JSON.stringify(content));
    assert.deepEqual(found.symbols, symbols, JSON.stringify(content));
    if (symbols.length > 0) assert.equal(decide(evaluateGuard, content), 2, `the guard must deny ${JSON.stringify(content)}`);
  }
  // Text that is not an export stays allowed: a comparison is not an element.
  assert.equal(detectExports('const a = b > c; // export class X {}\n'), null);
});

test('guard property: every symbol the master detects, the guard detects too (TypeScript-like and invalid input included)', () => {
  const master = loadMasterGuard();
  const random = fuzzRandom(777_001);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const typescript = [
    'const a: number = 1;',
    'function f<T>(a: T): T { return a }',
    'x = a! / b;',
    "x = a!.b! / /'/;",
    'y = f()! / /"/;',
    'z = a![0]! / 2;',
    'const v = a as T;',
    'const w = a satisfies T;',
    'type A = { a: 1 };',
    "type B = { a: '/' } | string;",
    'interface I { m(): void }',
    '@Dec()\nclass K {}',
    "const el = <div>/'</div>;",
    "const j = <p>it's // <b>/*</b></p>;",
    'export function *g() {}',
    '@dec export class Z {}',
    "let n = a\n/'/.test(a);",
    'enum E { A = 1 / 2 }',
    'abstract class Q<T extends U = V> implements W {}',
    'x = <T,>(a: T) => a / 2;',
    'declare module "m" { export const q: number }',
    "if (a) /'/.test(b);",
    'x = a / /[/*]/.source;',
    'const s = `${/`/.test(x)}`;',
    'return /a/.test(b) ? 1 / 2 : /y/;',
  ];
  const noise = [
    "'",
    '"',
    '`',
    '/',
    '//',
    '/*',
    '*/',
    '${',
    '}',
    '{',
    '(',
    ')',
    '\\',
    '\n',
    '\r',
    ' ',
    ' ',
    '!',
    '<',
    '>',
    '=>',
    ':',
    '#!',
  ];
  const tail = [
    "export class ICacheStore {} // '",
    'export class ICacheStore {}\n// `',
    'export const ICacheStore = 1; /* "',
    "export default class ICacheStore {} </a'(=> /a",
  ];
  const symbolsOf = (found) => (found ? found.symbols : []);
  let compared = 0;
  for (let round = 0; round < 4000; round += 1) {
    let content = '';
    const parts = 1 + Math.floor(random() * 5);
    for (let k = 0; k < parts; k += 1) {
      const roll = random();
      if (roll < 0.35) content += generateJs(random) + pick(['', '\n', ' ']);
      else if (roll < 0.75) content += pick(typescript) + pick(['', '\n', ' ']);
      else content += pick(noise) + pick(['', '', 'a', 'a ', '1 ']);
    }
    content += pick(['', ' ', '\n']) + pick(tail);
    const before = symbolsOf(master.detectExports(content, 'js'));
    const afterFound = detectExports(content, 'js');
    const after = new Set(symbolsOf(afterFound));
    for (const symbol of before) assert.ok(after.has(symbol), `the guard lost ${symbol}: ${JSON.stringify(content)}`);
    if (master.detectExports(content, 'js')?.anonymous) assert.ok(afterFound.anonymous, JSON.stringify(content));
    compared += 1;
  }
  assert.equal(compared, 4000);
});

test('deeply nested destructuring does not overflow the stack and later exports are still found', () => {
  for (const opener of ['[', '{a:', '[a,']) {
    const content = `export const ${opener.repeat(20_000)}\nexport class Denied {}\n`;
    const found = detectExports(content, 'js');
    assert.ok(found.symbols.includes('Denied'), opener);
  }
});

test('unclosed destructuring heads at 1 MB neither overflow the stack nor cost more than a fraction of a second', () => {
  for (const unit of ['export const [a,', 'export const {a:{b:', 'export const {a,']) {
    const content = `${unit.repeat(Math.ceil(1_000_000 / unit.length))}\nexport class Denied {}\n`;
    const started = process.hrtime.bigint();
    const found = detectExports(content, 'js');
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(found.symbols.includes('Denied'), unit);
    assert.ok(elapsed < 1500, `${unit}: ${elapsed} ms`);
  }
});

test('a later declarator stays visible after a type argument list or a regex literal with a comma in its initializer', () => {
  for (const initializer of [
    'new Map<string, number>()',
    '<T,U>(x:T)=>x',
    'f<A, B>(x)',
    'x as Map<string,number>',
    '/,/',
    '/[,]/g',
    "'x'.replace(/,/g, '')",
  ]) {
    for (const language of ['js', 'ts']) {
      const found = detectExports(`export const a = ${initializer}, Denied = 1;`, language);
      assert.ok(found.symbols.includes('Denied'), `${language}: ${initializer}`);
      assert.ok(found.symbols.includes('a'), `${language}: ${initializer}`);
    }
  }
});

test('unclosed destructuring heads at 1 MB stay under 200 ms', () => {
  for (const unit of ['export const {a=(', 'export const {[a]:', 'export const [a,']) {
    const content = `${unit.repeat(Math.ceil(1_000_000 / unit.length))}\nexport class Denied {}\n`;
    detectExports(content, 'js');
    const started = process.hrtime.bigint();
    const found = detectExports(content, 'js');
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(found.symbols.includes('Denied'), unit);
    assert.ok(elapsed < 200, `${unit}: ${elapsed} ms`);
  }
});

test('guard: a list the scanners abandon with text unread fails closed (an export with an unknown name)', () => {
  const maps = (count) => Array.from({ length: count }, (_, k) => `a${k} = new Map<string, number>()`).join(', ');
  const calls = (count) => Array.from({ length: count }, (_, k) => `c${k} = f<A, B>(x)`).join(', ');
  const abandoned = {
    'a pattern nested past the depth limit': `export const ${'['.repeat(120)}a${']'.repeat(120)} = 1, Denied = 1;`,
    'a token that is neither a name nor a pattern in the first declarator': 'export const 5x, Denied = 2;',
    'a token no binding holds after a default in an array pattern': 'export const [a = x < y, ?Denied] = o;',
    'the same inside an object pattern with a nested array': 'export const { k: [a = x < y, ?Denied] } = o;',
    'a property key that is not a key inside a pattern': 'export const { a, ) , Denied } = o;',
    'an export list that never closes': 'export { a, b',
    'export lists that open before the first one closes': 'export { a, export { b }',
  };
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const file = path.join(directory, 'packages/lib/src/thing.ts');
  for (const [label, content] of Object.entries(abandoned)) {
    for (const language of ['js', 'ts']) {
      const found = detectExports(content, language);
      assert.equal(found.incomplete, true, `${label} (${language})`);
      assert.equal(found.anonymous, true, `${label} (${language})`);
    }
    const outcome = guard(directory, file, content);
    assert.equal(outcome.exitCode, 2, label);
    assert.match(contextOf(outcome), /could not be fully read/, label);
  }
  // Defaults holding a comma of a type argument list are read through, so the binding after them is found by name.
  for (const content of [
    'export const [a = f<"a", "b">(x), Denied] = o;',
    'export const { k: [a = f<A, { k: 1 }>(x), Denied] } = o;',
    'export const [{ a = f<"a", "b">(x) }, Denied] = o;',
    'export const x = 1, [a = f<A, `b`>(x), Denied] = o',
  ]) {
    const found = detectExports(content, 'ts');
    assert.ok(found.symbols.includes('Denied'), content);
    assert.equal(found.incomplete, false, content);
  }
  // Commas of type argument lists no longer cap the reading: the declarator after any number of them is read by name.
  for (const count of [6, 7, 40]) {
    for (const content of [`export const ${maps(count)}, Denied = 1;`, `export const ${calls(count)}, Denied = 1;`]) {
      const found = detectExports(content, 'ts');
      assert.ok(found.symbols.includes('Denied'), content.slice(0, 60));
      assert.equal(found.incomplete, false);
    }
  }
  // Local mode allows everything; hybrid denies an unreadable list (decision tests at the end of the file) and allows a plain unknown export.
  const local = gitProject({ [BINDINGS]: projectFile('local', 'mode_ref: docs/decisions/why.md\n'), 'docs/decisions/why.md': '# why\n' });
  assert.equal(guard(local, path.join(local, 'packages/lib/src/thing.ts'), abandoned['an export list that never closes']).exitCode, 0);
  const hybrid = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(hybrid);
  write(hybrid, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  commitAll(hybrid);
  const hybridFile = path.join(hybrid, 'packages/lib/src/thing.ts');
  assert.equal(guard(hybrid, hybridFile, abandoned['an export list that never closes']).exitCode, 2);
  assert.equal(guard(hybrid, hybridFile, 'export class Unknown {}').exitCode, 0);
});

test('guard: exhausting the pattern budget reports the list as incomplete', () => {
  const content = `${'export const {a=('.repeat(5000)}\nexport class Denied {}\n`;
  const found = detectExports(content, 'js');
  assert.equal(found.incomplete, true);
  assert.ok(found.symbols.includes('Denied'));
});

test('guard: terminated lists, lists ending with the text and barrel files are not reported as incomplete', () => {
  for (const content of [
    'export const a = 1, b = 2;',
    'export const a = 1,\n  b = 2\nfoo();',
    'export const a = new Map<string, number>(), b = 2;',
    'export const { a, b: [c, d], ...rest } = o;',
    'export const a = 1,',
    'export const [a, b',
    'export { a, b as c };',
    'export { a } from "./x";\nexport type { B } from "./y";\nexport * from "./z";',
    'export const a = 1;\nexport { a as b }\n',
  ]) {
    for (const language of ['js', 'ts']) {
      const found = detectExports(content, language);
      assert.notEqual(found && found.incomplete, true, `${language}: ${content}`);
    }
  }
});

test('guard: JSX text and type parameter commas are not reported as unread lists', () => {
  for (const content of [
    'export const A = () => <p>Hello, 2 apples</p>;',
    'export const A = () => <p>Oops, 404 not found</p>',
    'export const A = () =>\n  <footer>\n    (c) 2024, 2025 Acme Inc.\n  </footer>;',
    'export const A = <p>Hello, (world)</p>;',
    'export const A = <b>Yes, </b>;',
    'export const A = <T,>(x: T) => x;',
    'export const A = async <T,>(x: T) => x;',
    'export const A = <T extends Record<string, unknown>,>(x: T) => x;',
    'export const A = <T,>(init: T): [T, (v: T) => void] => { const [s, set] = useState<T>(init); return [s, set]; };',
    'export const A = y.z<1, 2>(w);',
  ]) {
    const found = detectExports(content, 'tsx');
    assert.equal(found.incomplete, false, content);
    assert.ok(found.symbols.includes('A'), content);
  }
  // Nothing is hidden by reading past them: a declarator after the text is still read by name.
  assert.ok(detectExports('export const A = <p>x, 2</p>, Denied = 1;', 'tsx').symbols.includes('Denied'));
  assert.ok(detectExports('export const A = <T,>(x: T) => x, Denied = 1;', 'tsx').symbols.includes('Denied'));
  assert.ok(detectExports('export const a = 1, 5x, Denied = 2;', 'ts').symbols.includes('Denied'));
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const outcome = guard(directory, path.join(directory, 'packages/lib/src/thing.tsx'), 'export const A = () => <p>Hello, 2 apples</p>;');
  assert.doesNotMatch(contextOf(outcome), /could not be fully read/);
});

test('guard: a declarator hidden behind a continued line is read by name', () => {
  const hidden = [
    'export const a = x\n`t`, Denied = 1;',
    'export let [p, q] = x\n`t`, [Denied] = 1;',
    'export const a = typeof\n x, Denied = 1;',
    'export const a = void\n 0, Denied = 1;',
    'export const a = delete\n x.y, Denied = 1;',
    'export const a = await\n x, Denied = 1;',
    'export const a = class\n{}, Denied = 1;',
    'export const a = x instanceof\n Y, Denied = 1;',
    'export const a = x as\n Y, Denied = 1;',
    'export const a = x satisfies\n Y, Denied = 1;',
    'export const a = new\n Map<string, number>(), Denied = 1;',
    'export const a: typeof\n x = 1, Denied = 1;',
  ];
  for (const content of hidden) {
    const found = detectExports(content, 'ts');
    assert.ok(found.symbols.includes('Denied'), content);
  }
  // A statement end after an ordinary word still ends the list.
  assert.deepEqual(detectExports('export const a = x\nconst Denied = 1;', 'ts').symbols, ['a']);
});

test('guard: type literals cut by a type argument comma are not reported as unread lists', () => {
  const readable = [
    'export const ICacheStore = f<X, { a: 1; b: 2 }>();',
    'export const ICacheStore = f<{ a: 1 }, { b: 2; c: 3 }>();',
    'export const fetchUser = createAsyncThunk<User, string, { state: RootState; rejectValue?: string }>("u", async () => 1);',
    'export const ICacheStore = f<"a", "b">();',
  ];
  for (const content of readable) {
    const found = detectExports(content, 'ts');
    assert.equal(found.incomplete, false, content);
    assert.equal(found.anonymous, false, content);
  }
  // Nothing is hidden by skipping them: the declarator after the type literal is still read.
  assert.ok(detectExports('export const a = f<X, { a: 1; b?: 2 }>(), Denied = 1;', 'ts').symbols.includes('Denied'));
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  const outcome = guard(directory, path.join(directory, 'packages/lib/src/thing.ts'), readable[0]);
  assert.doesNotMatch(contextOf(outcome), /could not be fully read/);
});

test('guard: a JSX element followed by a comma and a declarator keeps the declarator (also with a division after it)', () => {
  for (const content of ['export const p = <div>x</div>, Denied = a/b;', 'export const p = <div>x</div>, Denied = a/b, c = 1/2;']) {
    const found = detectExports(content, 'tsx');
    assert.deepEqual(found.symbols.slice(0, 2), ['p', 'Denied'], content);
    assert.equal(found.incomplete, false, content);
  }
});

test('guard: JSX elements in an initializer are jumped over whole, so a declarator after them is read', () => {
  const elements = [
    '<ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>',
    '<div>{<b></b>}</div>',
    '<div>{<></>}</div>',
    '<div a={<b></b>}></div>',
    '<div>{cond && <b>t</b>}</div>',
    '<p>a &amp; b</p>',
    '() => <p>a &amp; b</p>',
    '() => <div>{b.map((c) => <i key={c}>{c}</i>)}</div>',
    '() => <p>:)</p>',
    '<p>x</p>',
    '<A render={() => <b />} />',
    '<div>{x}</div>',
  ];
  for (const element of elements) {
    for (const language of ['js', 'ts']) {
      const content = `export const a = ${element}, ICacheStore = 1;`;
      assert.ok(detectExports(content, language).symbols.includes('ICacheStore'), content);
      const last = `export const A = <p>x</p>, ICacheStore = ${element};`;
      assert.ok(detectExports(last, language).symbols.includes('ICacheStore'), last);
    }
  }
  // A generic arrow function is no element: the declarator after it is still read.
  for (const content of [
    'export const f = <T>(x: T) => x, ICacheStore = 1;',
    'export const f = <T extends X>(x: T) => x, ICacheStore = 1;',
  ]) {
    const found = detectExports(content, 'ts');
    assert.ok(found.symbols.includes('ICacheStore'), content);
    assert.equal(found.incomplete, false, content);
  }
});

test('guard: a non-null assertion after a string literal is followed by a division, not a regex', () => {
  for (const content of [
    'export const a = "s"! / (/a,b/.test(n), 1), ICacheStore = 1;',
    'export const a = this ?null : "s,s"! / (/a,b/g.test(null), new Map<\n any >()), ICacheStore = 1;',
    "export const a = 's'! / (/a,b/.test(n), 1), ICacheStore = 1;",
  ]) {
    assert.ok(detectExports(content, 'ts').symbols.includes('ICacheStore'), content);
  }
});

test('guard: a modifier on a type parameter ending a line continues onto the next one', () => {
  for (const content of [
    'export const a = <A,\nstatic\nB\n>(x) => x, ICacheStore = 1;',
    'export const a = <A,\r\nstatic\r\nB\r\n>(x) => x, ICacheStore = 1;',
  ]) {
    assert.ok(detectExports(content, 'ts').symbols.includes('ICacheStore'), content);
  }
});

test('guard: the first words of a string a code generator writes are no export list the scanner abandoned', () => {
  for (const content of [
    "const unquote = (s) => s.replaceAll(/`/g, '');\nexport function emit(name, value) {\n  return 'export const ' + unquote(name) + ' = ' + value + ';';\n}\n",
    "export const fence = /^```(\\w+)?$/;\nexport const tpl = (n: string) => 'export const ' + n + ' = 1;';",
    "const re = /[`]/g;\nconst s = 'export {';\nexport const real = 1;",
    "test('big', () => {\n  const src = 'export {'.repeat(size / 8) + '\\nexport class R {}';\n});\n",
    "x('export {'.repeat(n / 8) + 'a');",
  ]) {
    assert.equal(detectExports(content, 'ts').incomplete, false, content);
  }
  // Real unclosed lists (not directly after a quote) are still reported, however many heads follow a quoted one.
  assert.equal(detectExports("x('export {'); export { a, \nexport {\n", 'ts').incomplete, true);
  assert.equal(detectExports('export const [a = (', 'ts').incomplete, true);
});

test('guard: a division after a postfix operator, a non-null assertion or a type argument list does not hide a declarator', () => {
  const divisions = [
    ['export let n = 0, a = n++ / 2, Denied = 1, b = 1/2;', 'js'],
    ['export const a = x++/2, Denied = 1, b = /a/;', 'js'],
    ['export const a = x--/2, Denied = 1, b = /a/;', 'js'],
    ['export const a = x! / 2, Denied = 1, b = 1/2;', 'ts'],
    ['export const a = f()!/2, Denied = 1, b = /a/;', 'ts'],
    ['export const a = x?.y! / 2, Denied = 1, b = 1/2;', 'ts'],
    ['export const a = x as Array<number> / 2, Denied = 1, b = 1/2;', 'ts'],
  ];
  for (const [content, language] of divisions) {
    const found = detectExports(content, language);
    assert.ok(found.symbols.includes('a') && found.symbols.includes('Denied') && found.symbols.includes('b'), content);
    assert.equal(found.incomplete, false, content);
  }
  // A regex after an operator that starts an operand is still a regex: its comma does not split the list.
  for (const content of [
    'export const a = x => /,/.test(y), Denied = 1;',
    'export const a = !/,/.test(y), Denied = 1;',
    'export const a = b + +/,/.test(y), Denied = 1;',
    'export const a = f(), b = typeof !/,/.test(y), Denied = 1;',
  ]) {
    assert.deepEqual(
      detectExports(content, 'ts').symbols.filter((s) => s.length > 1),
      ['Denied'],
      content,
    );
  }
});

test('guard: type fragments cut by a type argument comma (mapped types, signatures, optional tuple elements) are not unread lists', () => {
  const fragments = [
    '{ [K in keyof B]?: B[K] }',
    '{ [K in keyof B]-?: B[K] }',
    '{ -readonly [K in keyof B]: B[K] }',
    '{ +readonly [K in keyof B]+?: B[K] }',
    '{ (): void }',
    '{ <T>(): T }',
    '{ a(): void }',
    '{ new (x: number): string }',
    '{ get a(): number }',
    '[B?]',
    '[x?: B]',
    '[1?, 2?]',
    '{ a: [1, 2] }',
  ];
  const directory = gitProject({ [BINDINGS]: projectFile('platform') });
  for (const fragment of fragments) {
    const content = `export const ICacheStore = f<A, ${fragment}>(x);`;
    const found = detectExports(content, 'ts');
    assert.equal(found.incomplete, false, content);
    assert.ok(found.symbols.includes('ICacheStore'), content);
    // A declarator after the fragment is still read by name.
    assert.ok(detectExports(`export const a = f<A, ${fragment}>(x), Denied = 1;`, 'ts').symbols.includes('Denied'), content);
    assert.doesNotMatch(contextOf(guard(directory, path.join(directory, 'packages/lib/src/thing.ts'), content)), /could not be fully read/);
  }
  // A pattern in the first declarator that no binding pattern can hold is still reported as unread.
  assert.equal(detectExports('export const { (): void } = x, Denied = 1;', 'ts').incomplete, true);
});

// ---- Fail-closed decision, multi-line generics, hidden bindings and symbol-level superset against master 7a0ff6db ----

const UNREADABLE = ['export { a, b', 'export const 5x, Denied = 2;', 'export const [a = x < y, ?Denied] = o;'];

test('guard: an unreadable export list is denied in hybrid (with and without a registry) and in platform (with and without override); local allows', () => {
  const ackFiles = { 'docs/decisions/why.md': '# why\n', 'docs/decisions/2026-intake-cache.md': 'ack: INTAKE-1\n' };
  const override = `overrides:\n${OVERRIDE('cache.typed', 'INTAKE-1')}`;
  const fileOf = (directory) => path.join(directory, 'packages/cache/src/Store.ts');
  const setup = (mode, { registry = true, overrides = '' } = {}) => {
    const directory = gitProject(ackFiles);
    const registryLine = registry ? stableRegistry(directory) : '';
    write(directory, BINDINGS, projectFile(mode, `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}${overrides}`));
    commitAll(directory);
    return directory;
  };
  const acked = quietEnv({ CORE_INTAKE_ACK: 'INTAKE-1' });
  for (const content of UNREADABLE) {
    // hybrid, stable registry: the hidden name could match a stable capability, so the unknown is denied with its own reason.
    const hybrid = setup('hybrid');
    const denied = guard(hybrid, fileOf(hybrid), content);
    assert.equal(denied.exitCode, 2, content);
    assert.match(denied.stdout, /capability-intake-unreadable-exports/, content);
    assert.match(contextOf(denied), /could not be read in full/, content);
    assert.match(contextOf(denied), /CORE_INTAKE_ACK/, content);
    // a valid acknowledgement lifts it; the legacy "1" does not
    assert.equal(guard(hybrid, fileOf(hybrid), content, { env: acked }).exitCode, 0, content);
    assert.equal(guard(hybrid, fileOf(hybrid), content, { env: quietEnv({ CORE_INTAKE_ACK: '1' }) }).exitCode, 2, content);
    // hybrid without a registry falls back to the platform decision: denied
    const bare = setup('hybrid', { registry: false });
    assert.equal(guard(bare, fileOf(bare), content).exitCode, 2, content);
    assert.equal(guard(bare, fileOf(bare), content, { env: acked }).exitCode, 0, content);
    // platform, with and without an override: the unreadable names are never covered by an override
    for (const overrides of ['', override]) {
      const platform = setup('platform', { overrides });
      assert.equal(
        guard(platform, fileOf(platform), content).exitCode,
        2,
        `platform ${overrides ? 'with' : 'without'} override: ${content}`,
      );
      assert.equal(guard(platform, fileOf(platform), content, { env: acked }).exitCode, 0, content);
    }
    // local mode allows
    const local = setup('local', { registry: false });
    assert.equal(guard(local, fileOf(local), content).exitCode, 0, content);
  }
  // A readable list is untouched by the new rule.
  const hybrid = setup('hybrid');
  assert.equal(guard(hybrid, fileOf(hybrid), 'export class Unknown {}').exitCode, 0);
  assert.equal(guard(hybrid, fileOf(hybrid), 'export const a = 1, b = 2;').exitCode, 0);
});

test('guard: a stable ICacheStore after JSX, a string assertion or a type parameter modifier is denied in hybrid; a code generator is allowed', () => {
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  commitAll(directory);
  for (const content of [
    'export const a = <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>, ICacheStore = 1;',
    'export const a = <div>{<></>}</div>, ICacheStore = 1;',
    'export const A = () => <p>a &amp; b</p>, ICacheStore = 1;',
    'export const a = "s"! / (/a,b/.test(n), 1), ICacheStore = 1;',
    'export const a = <A,\nstatic\nB\n>(x) => x, ICacheStore = 1;',
  ]) {
    for (const name of ['Store.tsx', 'Store.jsx', 'Store.ts']) {
      assert.equal(guard(directory, path.join(directory, 'packages/cache/src', name), content).exitCode, 2, `${name}: ${content}`);
    }
  }
  const generator =
    "const unquote = (s) => s.replaceAll(/`/g, '');\nexport function emit(name, value) {\n  return 'export const ' + unquote(name) + ' = ' + value;\n}\n";
  assert.equal(guard(directory, path.join(directory, 'packages/md/src/emit.js'), generator).exitCode, 0);
});

test('guard: a hidden ICacheStore behind an unreadable list is denied in hybrid like a plain ICacheStore', () => {
  const directory = gitProject({ 'docs/decisions/why.md': '# why\n' });
  const registryLine = stableRegistry(directory);
  write(directory, BINDINGS, projectFile('hybrid', `mode_ref: docs/decisions/why.md\nstacks: [dotnet]\n${registryLine}`));
  commitAll(directory);
  const file = path.join(directory, 'packages/cache/src/Store.ts');
  assert.equal(guard(directory, file, 'export class ICacheStore {}').exitCode, 2);
  assert.equal(guard(directory, file, 'export const 5x, ICacheStore = 2;').exitCode, 2);
  assert.equal(guard(directory, file, 'export const { a, ) , ICacheStore } = o;').exitCode, 2);
});

test('guard: multi-line type argument lists (prettier style) keep the next declarator and hidden bindings are reported as unread', () => {
  const read = [
    'export const a = new Map<string,\n number\n>(), Denied = 1;',
    'export const a = f<A,\n B\n>(x), Denied = 1;',
    'export const a = f<A,\n B\n  >(x), c = 2, Denied = 1;',
    'export const a = new Map<\n  string,\n  number\n>(), Denied = 1;',
    'export const a = f<A,\n B\n.c>(x), Denied = 1;',
    'export const a = f<A,\n B\n extends C>(x), Denied = 1;',
  ];
  for (const content of read) assert.ok(detectExports(content, 'ts').symbols.includes('Denied'), content);
  for (const content of ['export const a = 1, ...Denied;', 'export const a = 1, #Denied=1;', 'export const a = 1, b = 2, ...Z;']) {
    assert.equal(detectExports(content, 'ts').incomplete, true, content);
  }
  // A new statement on the next line is where the list ends, not unread text.
  for (const content of [
    'export const a = 1, b\nconst c = 2;',
    'export const a = 1, b\nfoo();',
    'export const a = 1,\n  b = 2\nexport const c = 3;',
  ]) {
    assert.equal(detectExports(content, 'ts').incomplete, false, content);
  }
});

test('guard: a type operator or a non-null mark ending a line of a multi-line type argument list does not hide the next declarator', () => {
  for (const operand of ['keyof\n B', 'typeof\n B', 'readonly\n B[]', 'unique\n symbol', 'infer\n U', 'abstract\n new () => B', 'B!']) {
    const content = `export const a = f<A,\n ${operand}\n>(x), ICacheStore = 1;`;
    assert.ok(detectExports(content, 'ts').symbols.includes('ICacheStore'), content);
  }
  // A new statement after a plain name is still where the list ends.
  assert.equal(detectExports('export const a = 1, b\nconst c = 2;', 'ts').incomplete, false);
});

test('guard: a type operator ending a variable annotation line or a class/function body on its own line does not hide the next declarator', () => {
  const heads = [
    'export let a: readonly\nstring[] = 1',
    'export let a: unique\nsymbol = Symbol()',
    'export let a: keyof\nB = 1',
    'export let a: typeof\nB = 1',
    'export const a = class Foo\n{}',
    'export const a = function foo()\n{}',
    'export const a = async function foo()\n{}',
    'export const a = function* foo()\n{}',
    'export const a = function foo(): string\n\n{}',
    'export const a = class Foo extends Bar\n{}',
    'export const a = class Foo\nimplements I\n{}',
    'export const a = class\n{ m()\n{} }',
  ];
  for (const head of heads) {
    for (const variant of [head, head.replaceAll('\n', '\r\n'), head.replace('\n', ' // c\n'), head.replace('\n', ' /* c */\n')]) {
      const content = `${variant}, Denied = 1;`;
      assert.ok(detectExports(content, 'ts').symbols.includes('Denied'), JSON.stringify(content));
    }
  }
  // No false end of list: a new statement on the next line still ends it, and invents no symbol.
  for (const content of ['export const a = 1, b\nconst c = 2;', 'export let a: readonly string[] = []\nfoo();']) {
    assert.equal(detectExports(content, 'ts').incomplete, false, content);
  }
  assert.deepEqual(detectExports('export let a: readonly string[] = []\nconst Q = 1, Z = 2;', 'ts').symbols, ['a']);
});

test('guard: a block opening on its own line after a head the scanner cannot place is reported unreadable, never silently skipped', () => {
  for (const content of ['export const a = 1\n{ b, Denied }', 'export const a = class Foo<A, B>\nimplements I\n{}, Denied = 1;']) {
    assert.equal(detectExports(content, 'ts').incomplete, true, content);
  }
});

test('guard: a default holding a comma of a type argument list is no unreadable list; a hidden binding after it still is read or reported', () => {
  for (const content of [
    'export const { a = new Map<string, number>() } = obj;',
    'export const [a = f<A,B>(1)] = arr;',
    'export const { a = <T,>(x: T) => x } = obj;',
    'export const { a = new Map<string, {k: 1}>(), Denied } = o;',
  ]) {
    assert.equal(detectExports(content, 'ts').incomplete, false, content);
  }
  for (const content of ['export const { a = f<A,B>(1), Denied } = o;', 'export const [a = f<A,B>(1), Denied] = o;']) {
    assert.ok(detectExports(content, 'ts').symbols.includes('Denied'), content);
  }
  // Comparisons are not type arguments: the binding after the comma stays visible.
  assert.ok(detectExports('export const { a = x < y, Denied } = o;', 'ts').symbols.includes('Denied'));
  assert.ok(detectExports('export const { a = x < y, Denied = 1 > 0 } = o;', 'ts').symbols.includes('Denied'));
});

test('guard: every symbol master 7a0ff6db detects is detected (property test: valid and invalid, TypeScript and JSX input)', () => {
  const master = loadMasterGuard('master-guard-7a0ff6db.txt');
  let state = 20_261_008;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const pieces = [
    'export ',
    'const ',
    'let ',
    'var ',
    'declare ',
    'a',
    'b',
    'Denied',
    ' = ',
    '1',
    ', ',
    ',\n',
    '\n',
    ';',
    '{',
    '}',
    '[',
    ']',
    '(',
    ')',
    '<',
    '>',
    '<A,\n B\n>',
    'new Map<string,\n number\n>()',
    'f<A, B>(x)',
    '...',
    '#',
    '"',
    "'",
    '`',
    '/',
    '/*',
    '*/',
    '//',
    ': ',
    'number',
    'string',
    'typeof ',
    'new ',
    'as ',
    '=> ',
    '!',
    '?',
    '.',
    '<p>',
    '</p>',
    '<div>{<b></b>}</div>',
    '&amp;',
    '"s"! / ',
    '2 apples',
    '{ a: 1; b?: string }',
    'export class Z {}',
    'export { ',
    ' as ',
    'default ',
    'function ',
    'class ',
    '\r\n',
    String.raw`\u0061`,
    'enum ',
    'interface ',
  ];
  let compared = 0;
  for (let round = 0; round < 6000; round += 1) {
    let content = random() < 0.8 ? `export ${['const', 'let', 'var'][Math.floor(random() * 3)]} ` : '';
    const count = 3 + Math.floor(random() * 16);
    for (let k = 0; k < count; k += 1) content += pieces[Math.floor(random() * pieces.length)];
    for (const language of ['js', 'cs']) {
      const before = master.detectExports(content, language);
      const after = detectExports(content, language);
      assert.ok(before === null || after !== null, JSON.stringify(content));
      for (const symbol of before ? before.symbols : []) {
        assert.ok(after.symbols.includes(symbol), `lost ${symbol}: ${JSON.stringify(content)} (${language})`);
      }
      if (before && before.anonymous) assert.ok(after.anonymous, JSON.stringify(content));
      compared += 1;
    }
  }
  assert.equal(compared, 12_000);
  // Invalid input where the earlier reader found [export, number, B]: still found.
  for (const content of ['export const a = f<A,\n number\n B', 'export const a = 1, b = 2, ...c', 'export const a = f<A,\n number B']) {
    const before = master.detectExports(content, 'js');
    for (const symbol of before.symbols) assert.ok(detectExports(content, 'js').symbols.includes(symbol), content);
  }
});
