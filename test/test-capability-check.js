/**
 * capability-check tests (ADR-0046 §2, §6)
 *
 * Registry-first resolution through the platform bindings, with a labelled
 * filesystem heuristic. Uses temp projects only; never the real home directory.
 */

const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const fs = require('fs-extra');
const yaml = require('yaml');
const { UsageError, runCapabilityCheck, renderText } = require('../tools/cli/commands/capability-check');
const { readRecordedMode } = require('../tools/cli/lib/platform-bindings');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');
const SNAPSHOT = path.join(REPO_ROOT, '.enterprise', 'governance', 'capabilities', 'ecp-registry.snapshot.json');

let passed = 0;
let failed = 0;

function assertPass(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${details ? ` - ${details}` : ''}`);
    failed++;
  }
}

const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'capability-check-'));
let counter = 0;
const freshDir = (name) => fs.ensureDirSync(path.join(temp, `${name}-${counter++}`)) || path.join(temp, `${name}-${counter - 1}`);
const isolatedEnv = (extra = {}) => ({ HOME: path.join(temp, 'home'), XDG_CONFIG_HOME: path.join(temp, 'xdg'), ...extra });

function project({ marker = 'App.csproj', mode, files = {}, bindings } = {}) {
  const dir = freshDir('project');
  if (marker) fs.writeFileSync(path.join(dir, marker), '<Project/>');
  for (const [relative, content] of Object.entries(files)) fs.outputFileSync(path.join(dir, relative), content);
  const doc = bindings || (mode ? { schema_version: '1.0.0', mode } : null);
  if (doc) fs.outputFileSync(path.join(dir, '.hseos', 'config', 'platform-bindings.yaml'), yaml.stringify(doc));
  return dir;
}

const git = (dir, ...args) =>
  spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: os.devnull, GIT_CONFIG_SYSTEM: os.devnull },
  });

function gitCommit(dir, message = 'snapshot') {
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  const result = git(dir, 'commit', '-q', '-m', message);
  if (result.status !== 0) throw new Error(`git commit failed: ${result.stderr}`);
}

function usageCode(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof UsageError ? error.exitCode : `unexpected: ${error.message}`;
  }
}

const check = (query, dir, env = isolatedEnv()) => runCapabilityCheck(query, { directory: dir, env });
const names = (report) => report.results.map((result) => result.capability);

function tests() {
  console.log('\nRegistry resolution per mode');
  {
    const dir = project();
    const { report, exitCode } = check('Redis', dir);
    assertPass('no bindings file: platform / default-no-file', report.mode === 'platform' && report.mode_source === 'default-no-file');
    assertPass('Redis resolves cache.typed first', names(report)[0] === 'cache.typed', names(report).join(','));
    assertPass('stacks come from the .csproj marker', JSON.stringify(report.stacks) === '["dotnet"]');
    assertPass('registry ref comes from the shipped snapshot', report.registry.source === 'snapshot' && report.registry.ref === 'contracts-v0.3.1');
    const first = report.results[0];
    assertPass('platform verdict is consume <package>', first.verdict === 'consume' && /^consume Hideakisolutions\.Platform\.Caching\.Redis \(experimental\)$/.test(first.verdict_text), first.verdict_text);
    assertPass('exit code 0 for a completed query', exitCode === 0 && report.errors.length === 0);
    assertPass('auth query resolves security.authn', names(check('auth', dir).report).includes('security.authn'));
    assertPass('event-envelope resolves messaging.event-envelope', names(check('event-envelope', dir).report)[0] === 'messaging.event-envelope');
  }

  console.log('\nExtend verdict when no implementation exists for the stacks');
  {
    const dir = project({ marker: 'go.mod' });
    const { report } = check('cache', dir);
    const result = report.results.find((entry) => entry.capability === 'cache.typed');
    assertPass('stack filter drops non-matching implementations', result && result.implementations.length === 0);
    assertPass('verdict is extend for the project stack', result.verdict === 'extend' && result.verdict_text === 'extend (implement the contract for go in the owning core)', result.verdict_text);
    const node = check('event-envelope', project({ marker: 'package.json' })).report.results[0];
    assertPass('node project sees only node implementations', node.implementations.every((entry) => entry.stack === 'node') && node.implementations.length > 0);
  }

  console.log('\nHybrid, local and overrides');
  {
    const hybridDir = project({
      bindings: { schema_version: '1.0.0', mode: 'hybrid', mode_ref: 'docs/decisions/0001-hybrid.md' },
      files: { 'docs/decisions/0001-hybrid.md': '# hybrid\n' },
    });
    const hybrid = check('cache', hybridDir).report;
    assertPass('hybrid mode is honoured with its mode_ref', hybrid.mode === 'hybrid' && hybrid.mode_source === 'project', `${hybrid.mode}/${hybrid.mode_source}`);
    assertPass('hybrid shows consume with advisory when nothing is stable', hybrid.results[0].advisory === true && /\(advisory\)$/.test(hybrid.results[0].verdict_text), hybrid.results[0].verdict_text);

    const registry = fs.readJsonSync(SNAPSHOT);
    const cache = registry.capabilities.find((entry) => entry.name === 'cache.typed');
    cache.implementations[1].status = 'stable';
    cache.implementations[1].conformance = { vectors_version: '0.2.0' };
    const stableDir = project({
      bindings: {
        schema_version: '1.0.0',
        mode: 'hybrid',
        mode_ref: 'docs/decisions/0001-hybrid.md',
        registry: { source: 'path', path: 'registry.json' },
      },
      files: { 'docs/decisions/0001-hybrid.md': '# hybrid\n' },
    });
    fs.writeJsonSync(path.join(stableDir, 'registry.json'), registry);
    const stable = check('cache', stableDir).report;
    assertPass('a stable implementation removes the advisory', stable.mode === 'hybrid' && stable.results[0].advisory === false && !/advisory/.test(stable.results[0].verdict_text), stable.results[0].verdict_text);
    assertPass('path registry source is reported', stable.registry.source === 'path');

    const localDir = project({
      bindings: { schema_version: '1.0.0', mode: 'local', mode_ref: 'docs/decisions/0001-local.md' },
      files: { 'docs/decisions/0001-local.md': '# local\n' },
    });
    const local = check('cache', localDir).report;
    assertPass('local mode is informational', local.mode === 'local' && local.results[0].verdict_text === 'informational (local mode: no intake required)');
    const none = renderText(check('zzzqq', localDir).report);
    assertPass('local mode with no result has no intake hint', /no platform capability matches 'zzzqq'/.test(none) && !/intake/i.test(none));

    const overrideDir = project({
      bindings: {
        schema_version: '1.0.0',
        mode: 'platform',
        overrides: [{ capability: 'cache.typed', outcome: 'keep-local', intake_ref: 'INTAKE-2026-10-cache', reason: 'product boundary', expires: '2999-01-01' }],
      },
      files: { 'docs/decisions/0002-intake.md': 'Decision INTAKE-2026-10-cache keep-local\n' },
    });
    const overridden = check('cache', overrideDir).report;
    assertPass(
      'a matching override is shown',
      overridden.results[0].verdict === 'overridden' && overridden.results[0].verdict_text === 'overridden: keep-local (INTAKE-2026-10-cache, expires 2999-01-01)',
      overridden.results[0].verdict_text,
    );
    assertPass('an override only affects its capability', check('event-envelope', overrideDir).report.results[0].verdict === 'consume');
  }

  console.log('\nRecorded mode (git baseline)');
  {
    const hybridFiles = { 'docs/decisions/0001-hybrid.md': '# hybrid\n' };
    const committed = project({ bindings: { schema_version: '1.0.0', mode: 'hybrid', mode_ref: 'docs/decisions/0001-hybrid.md' }, files: hybridFiles });
    gitCommit(committed);
    assertPass('readRecordedMode reads the committed mode', JSON.stringify(readRecordedMode(committed)) === '{"mode":"hybrid","source":"committed"}');
    const result = check('cache', committed);
    assertPass('a committed hybrid is not a downgrade', result.report.mode === 'hybrid' && result.report.mode_source === 'project' && result.report.errors.length === 0 && result.exitCode === 0);

    const downgraded = project({ mode: 'platform' });
    gitCommit(downgraded);
    fs.writeFileSync(path.join(downgraded, '.hseos', 'config', 'platform-bindings.yaml'), yaml.stringify({ schema_version: '1.0.0', mode: 'hybrid' }));
    const rejected = check('cache', downgraded);
    assertPass('an uncommitted downgrade is rejected', rejected.report.mode === 'platform' && rejected.report.mode_source === 'downgrade-rejected' && rejected.exitCode === 1);

    assertPass('not a git repository means platform', JSON.stringify(readRecordedMode(project())) === '{"mode":"platform","source":"default"}');
    const unborn = project({ mode: 'platform' });
    git(unborn, 'init', '-q');
    assertPass('a repository without commits means platform', readRecordedMode(unborn).mode === 'platform');
    const absent = project({ marker: 'App.csproj' });
    gitCommit(absent);
    assertPass('a file absent at the ref means platform', readRecordedMode(absent).source === 'default');
    const invalidMode = project({ bindings: { schema_version: '1.0.0', mode: 'bogus' } });
    gitCommit(invalidMode);
    assertPass('an invalid committed mode means platform', readRecordedMode(invalidMode).mode === 'platform');
    assertPass('a missing ref means platform', readRecordedMode(committed, 'no-such-ref').source === 'default');
  }

  console.log('\nOnly experimental or stable implementations are consumable');
  {
    const registry = fs.readJsonSync(SNAPSHOT);
    const cache = registry.capabilities.find((entry) => entry.name === 'cache.typed');
    const withStatuses = (first, second) => {
      cache.implementations[0].status = first;
      cache.implementations[1].status = second;
      for (const implementation of cache.implementations) {
        if (implementation.status === 'stable') implementation.conformance = { vectors_version: '0.2.0' };
        else delete implementation.conformance;
      }
      const dir = project({ bindings: { schema_version: '1.0.0', mode: 'platform', registry: { source: 'path', path: 'registry.json' } } });
      fs.writeJsonSync(path.join(dir, 'registry.json'), registry);
      return check('cache', dir).report.results.find((entry) => entry.capability === 'cache.typed');
    };
    const onlyPlanned = withStatuses('planned', 'deprecated');
    assertPass('planned/deprecated only gives extend', onlyPlanned.verdict === 'extend', onlyPlanned.verdict_text);
    assertPass('those implementations are still listed with status', onlyPlanned.implementations.map((entry) => entry.status).join(',') === 'planned,deprecated');
    const mixed = withStatuses('planned', 'experimental');
    assertPass('an experimental one is chosen over planned', mixed.verdict === 'consume' && /Caching\.Redis \(experimental\)$/.test(mixed.verdict_text), mixed.verdict_text);
    const stable = withStatuses('experimental', 'stable');
    assertPass('stable is preferred and named in the verdict', /\(stable\)$/.test(stable.verdict_text), stable.verdict_text);
  }

  console.log('\nQuery and directory validation');
  {
    const dir = project();
    for (const bad of ['', '   ', undefined]) {
      assertPass(`query ${JSON.stringify(bad)} is a usage error (exit 2)`, usageCode(() => check(bad, dir)) === 2);
    }
    const dot = check('.', dir);
    assertPass('query "." completes with no results and no scan', dot.exitCode === 0 && dot.report.results.length === 0 && dot.report.filesystem_candidates.length === 0 && dot.report.warnings.some((entry) => /scan skipped/.test(entry)));
    const trimmed = check(' Redis ', dir).report;
    assertPass('the query is trimmed once', trimmed.query === 'Redis' && trimmed.results[0].capability === 'cache.typed');
    assertPass('a missing --directory is a usage error', usageCode(() => check('cache', path.join(temp, 'nope'))) === 2);
    const file = path.join(temp, 'a-file');
    fs.writeFileSync(file, 'x');
    assertPass('a --directory that is a file is a usage error', usageCode(() => check('cache', file)) === 2);
    const cli = spawnSync(process.execPath, [CLI, 'capability-check', 'cache', '--directory', path.join(temp, 'nope')], {
      encoding: 'utf8',
      env: { ...process.env, ...isolatedEnv() },
    });
    assertPass('the CLI exits 2 for a bad directory', cli.status === 2 && /--directory/.test(cli.stderr), `${cli.status} ${cli.stderr}`);
  }

  console.log('\nNo result and integrity failures');
  {
    const text = renderText(check('zzzqq', project()).report);
    assertPass('platform no-result prints the intake hint', /no platform capability matches 'zzzqq'/.test(text) && /intake/i.test(text));

    const dir = project({ bindings: { schema_version: '1.0.0', mode: 'platform', registry: { source: 'path', path: 'broken.json' } } });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
    const { report, exitCode } = check('cache', dir);
    assertPass('a corrupt registry fails with exit code 1 and an error', exitCode === 1 && report.errors.some((entry) => /capability registry/.test(entry)));
    const invalid = project({ bindings: { schema_version: '9', mode: 'platform' } });
    assertPass('invalid bindings exit 1 and stay strict', check('cache', invalid).exitCode === 1);
  }

  console.log('\n--json shape and determinism');
  {
    const dir = project();
    const first = JSON.stringify(check('Redis', dir).report);
    const second = JSON.stringify(check('Redis', dir).report);
    assertPass('two runs are identical', first === second);
    const report = JSON.parse(first);
    assertPass(
      'top-level keys',
      JSON.stringify(Object.keys(report)) === JSON.stringify(['query', 'mode', 'mode_source', 'stacks', 'registry', 'results', 'filesystem_candidates', 'warnings', 'errors']),
      Object.keys(report).join(','),
    );
    assertPass('registry keys', JSON.stringify(Object.keys(report.registry)) === '["source","ref","sha256"]' && /^[a-f0-9]{64}$/.test(report.registry.sha256));
    const cli = spawnSync(process.execPath, [CLI, 'capability-check', 'Redis', '--directory', dir, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, ...isolatedEnv(), HSEOS_CAPABILITY_WORKSPACE: '' },
    });
    let parsed = null;
    try {
      parsed = JSON.parse(cli.stdout);
    } catch {
      parsed = null;
    }
    assertPass('the CLI prints the same JSON with --json', cli.status === 0 && parsed && parsed.results[0].capability === 'cache.typed', cli.stderr);
  }

  console.log('\nFilesystem heuristic');
  {
    const flat = freshDir('flat-ws');
    fs.outputFileSync(path.join(flat, 'repo-a', 'src', 'RedisCache.ts'), 'export class RedisCache {}\n');
    const dir = project();
    const viaEnv = check('RedisCache', dir, isolatedEnv({ HSEOS_CAPABILITY_WORKSPACE: flat })).report;
    assertPass('flat <ws>/<repo> layout is scanned', viaEnv.filesystem_candidates.some((entry) => entry.file === 'RedisCache.ts' && entry.source === 'heuristic'));
    assertPass('the signature is extracted', viaEnv.filesystem_candidates[0].signature === 'export class RedisCache {}');

    const nested = freshDir('nested-ws');
    fs.outputFileSync(path.join(nested, 'cores', 'repo-b', 'RedisNested.cs'), 'public class RedisNested {}\n');
    const nestedReport = check('RedisNested', dir, isolatedEnv({ HSEOS_CAPABILITY_WORKSPACE: nested })).report;
    assertPass('<ws>/cores/<repo> layout is still scanned', nestedReport.filesystem_candidates.length === 1);

    const userFile = path.join(temp, 'user-bindings.yaml');
    fs.writeFileSync(userFile, yaml.stringify({ schema_version: '1.0.0', workspace: { cores_root: flat } }));
    const viaUser = check('RedisCache', dir, isolatedEnv({ HSEOS_PLATFORM_BINDINGS: userFile })).report;
    assertPass('user workspace.cores_root is scanned', viaUser.filesystem_candidates.length === 1);

    const own = project({ files: { 'packages/RedisLocal.ts': 'export const RedisLocal = 1;\n' } });
    assertPass('project packages/ is scanned', check('RedisLocal', own).report.filesystem_candidates.length === 1);

    const text = renderText(viaEnv);
    assertPass('text output labels the heuristic section', /Filesystem candidates \(heuristic\)/.test(text));
  }

  console.log('\nFilesystem labels, warnings and limits');
  {
    const ws = freshDir('label-ws');
    fs.outputFileSync(path.join(ws, 'repo-a', 'src', 'RedisLabel.ts'), 'export const RedisLabel = 1;\n');
    const dir = project({ files: { 'packages/RedisProj.ts': 'export const RedisProj = 1;\n' } });
    const report = check('Redis', dir, isolatedEnv({ HSEOS_CAPABILITY_WORKSPACE: ws })).report;
    const workspace = report.filesystem_candidates.find((entry) => entry.file === 'RedisLabel.ts');
    const local = report.filesystem_candidates.find((entry) => entry.file === 'RedisProj.ts');
    assertPass('workspace candidates are labelled relative to their root', workspace && workspace.path === '<workspace>/repo-a/src/RedisLabel.ts' && workspace.root === 'workspace', JSON.stringify(workspace));
    assertPass('project candidates are labelled project', local && local.path === 'packages/RedisProj.ts' && local.root === 'project');

    const missing = check('Redis', dir, isolatedEnv({ HSEOS_CAPABILITY_WORKSPACE: path.join(temp, 'ghost') })).report;
    assertPass('a missing HSEOS_CAPABILITY_WORKSPACE warns', missing.warnings.some((entry) => /HSEOS_CAPABILITY_WORKSPACE does not exist/.test(entry)));
    const userFile = path.join(temp, 'ghost-user.yaml');
    fs.writeFileSync(userFile, yaml.stringify({ schema_version: '1.0.0', workspace: { cores_root: path.join(temp, 'ghost-cores') } }));
    const ghost = check('Redis', dir, isolatedEnv({ HSEOS_PLATFORM_BINDINGS: userFile })).report;
    assertPass('a missing cores_root warns', ghost.warnings.some((entry) => /workspace\.cores_root does not exist/.test(entry)));

    const many = {};
    for (let index = 10; index < 40; index++) many[`packages/RedisMany${index}.ts`] = `export const RedisMany${index} = 1;\n`;
    const capped = check('RedisMany', project({ files: many })).report;
    assertPass('the 20-candidate cap warns', capped.filesystem_candidates.length === 20 && capped.warnings.some((entry) => /truncated to 20 of 30/.test(entry)), capped.warnings.join('|'));

    const deep = project({ files: { [`packages/${'d/'.repeat(9)}RedisDeep.ts`]: 'export const RedisDeep = 1;\n' } });
    const deepReport = check('RedisDeep', deep).report;
    assertPass('the depth cap warns', deepReport.filesystem_candidates.length === 0 && deepReport.warnings.some((entry) => /depth/.test(entry)));

    const big = project({ files: { 'packages/RedisBig.ts': `${'// padding\n'.repeat(30_000)}export const RedisBig = 1;\n` } });
    const bigReport = check('RedisBig', big).report;
    assertPass('only the first 256 KiB are read for the signature', bigReport.filesystem_candidates[0].signature === 'name match; signature not found');
  }

  console.log('\nSymlink safety');
  {
    const ws = freshDir('loop-ws');
    fs.outputFileSync(path.join(ws, 'repo', 'RedisLoop.ts'), 'export const RedisLoop = 1;\n');
    fs.symlinkSync(ws, path.join(ws, 'repo', 'loop'), 'dir');
    fs.symlinkSync(path.join(ws, 'repo'), path.join(ws, 'alias'), 'dir');
    const started = Date.now();
    const { report } = check('RedisLoop', project(), isolatedEnv({ HSEOS_CAPABILITY_WORKSPACE: ws }));
    assertPass('a symlink loop terminates', Date.now() - started < 5000);
    assertPass('the file is reported once despite aliases', report.filesystem_candidates.length === 1, String(report.filesystem_candidates.length));

    const outside = freshDir('outside');
    fs.outputFileSync(path.join(outside, 'RedisEscape.ts'), 'export const RedisEscape = 1;\n');
    const escapeWs = freshDir('escape-ws');
    fs.ensureDirSync(path.join(escapeWs, 'repo'));
    fs.symlinkSync(outside, path.join(escapeWs, 'repo', 'link'), 'dir');
    fs.symlinkSync(path.join(outside, 'RedisEscape.ts'), path.join(escapeWs, 'repo', 'RedisEscapeFile.ts'));
    const escaped = check('RedisEscape', project(), isolatedEnv({ HSEOS_CAPABILITY_WORKSPACE: escapeWs })).report;
    assertPass('symlinks resolving outside the root are ignored', escaped.filesystem_candidates.length === 0, JSON.stringify(escaped.filesystem_candidates));
  }
}

try {
  tests();
} finally {
  fs.removeSync(temp);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
